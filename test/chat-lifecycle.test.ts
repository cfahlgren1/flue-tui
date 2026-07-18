import type {
  AgentConversationObservation,
  AgentConversationObservationSnapshot,
  FlueConversationState,
} from "@flue/sdk";
import { describe, expect, it, vi } from "vitest";

import type {
  ConnectionOptions,
  FlueConnection,
} from "../src/client.js";
import {
  createChatController,
  shouldIgnoreChatInput,
  type ChatCommandOptions,
} from "../src/commands/chat.js";
import type { ChatUi } from "../src/ui/app.js";

interface TestBlock {
  role: "user" | "assistant";
  text: string;
}

class FakeObservation implements AgentConversationObservation {
  private snapshot: AgentConversationObservationSnapshot = {
    conversation: undefined,
    offset: undefined,
    phase: "loading",
    error: undefined,
  };

  private readonly listeners = new Set<() => void>();

  getSnapshot() {
    return this.snapshot;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  refresh() {}

  close() {
    this.snapshot = { ...this.snapshot, phase: "closed" };
  }

  publish(conversation: FlueConversationState) {
    this.snapshot = {
      conversation,
      offset: "1",
      phase: "live",
      error: undefined,
    };
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function createFakeUi() {
  const transcript: TestBlock[] = [];
  const notices: string[] = [];
  const ids: string[] = [];
  let submit: ((text: string) => void) | undefined;

  const ui: ChatUi<TestBlock> = {
    reconcileUi: {
      createTextBlock(role, part) {
        const block = { role, text: part.text };
        return {
          block,
          update(nextPart) {
            block.text = nextPart.text;
          },
        };
      },
      createReasoningBlock() {
        return { update() {} };
      },
      createToolBlock() {
        return { update() {} };
      },
      appendTranscriptBlock(block) {
        transcript.push(block);
      },
      replaceTranscript(blocks) {
        transcript.splice(0, transcript.length, ...blocks);
      },
    },
    requestRender() {},
    addNotice(text) {
      notices.push(text);
    },
    setId(id) {
      ids.push(id);
    },
    clearTranscript() {
      transcript.splice(0);
    },
    setBusy() {},
    recordUsage() {},
    addRecoveredMarker() {},
    setToolsMode() {},
    toggleToolsExpanded() {},
    readLoop(handlers) {
      submit = (text) =>
        handlers.onSubmit(text, {
          addToHistory() {},
          getText: () => text,
          setText() {},
        });
      return () => undefined;
    },
    stop() {},
  };

  return {
    ui,
    transcript,
    notices,
    ids,
    submit(text: string) {
      submit?.(text);
    },
  };
}

const options: ChatCommandOptions = {
  url: "https://flue.test",
  agent: "demo",
  id: "session-1",
  tools: "collapsed",
  resume: false,
};

describe("chat lifecycle", () => {
  it.each([
    ["ctrl+c", "\u001b[99;5:3u"],
    ["ctrl+t", "\u001b[116;5:3u"],
    ["escape", "\u001b[27;1:3u"],
  ])("filters a Kitty %s release before shortcut matching", (_key, data) => {
    expect(shouldIgnoreChatInput(data)).toBe(true);
  });

  it("does not filter a Kitty key press", () => {
    expect(shouldIgnoreChatInput("\u001b[99;5:1u")).toBe(false);
  });

  it("does not append duplicate transcript rows when an observation repeats", async () => {
    const observation = new FakeObservation();
    const connection = {
      observe: vi.fn(() => observation),
    } as unknown as FlueConnection;
    const fakeUi = createFakeUi();
    const controller = createChatController({
      options,
      connection,
      connectionFactory: vi.fn(() => connection),
      ui: fakeUi.ui,
    });
    const done = controller.run();
    const conversation: FlueConversationState = {
      conversationId: "conversation-1",
      settlements: [],
      messages: [
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "roll", state: "done" }],
        },
      ],
    };

    observation.publish(conversation);
    observation.publish(conversation);

    expect(fakeUi.transcript).toEqual([{ role: "user", text: "roll" }]);

    fakeUi.submit("/exit");
    await expect(done).resolves.toBe(0);
  });

  it("uses only the active submission settlement when a wait fails", async () => {
    const observation = new FakeObservation();
    const connection = {
      observe: vi.fn(() => observation),
      send: vi.fn().mockResolvedValue({
        streamUrl: "https://flue.test/stream",
        offset: "0",
        submissionId: "submission-active",
      }),
      wait: vi.fn().mockImplementation(async (_admission, waitOptions) => {
        await waitOptions.onEvent?.({
          type: "submission-settled",
          conversationId: "conversation-1",
          submissionId: "submission-other",
          outcome: "failed",
          error: "wrong settlement",
          position: { batch: 1, index: 1 },
        });
        await waitOptions.onEvent?.({
          type: "submission-settled",
          conversationId: "conversation-1",
          submissionId: "submission-active",
          outcome: "aborted",
          error: "active settlement",
          position: { batch: 1, index: 2 },
        });
        throw new Error("stream ended");
      }),
    } as unknown as FlueConnection;
    const fakeUi = createFakeUi();
    const done = createChatController({
      options,
      connection,
      connectionFactory: vi.fn(() => connection),
      ui: fakeUi.ui,
    }).run();

    fakeUi.submit("roll");

    await vi.waitFor(() => {
      expect(fakeUi.notices).toContain(
        'submission aborted for agent "demo", instance id "session-1", submissionId "submission-active": active settlement',
      );
    });
    expect(fakeUi.notices.join("\n")).not.toContain("wrong settlement");

    fakeUi.submit("/exit");
    await expect(done).resolves.toBe(0);
  });

  it("swaps observations and transcript state for /new", async () => {
    const firstObservation = new FakeObservation();
    const nextObservation = new FakeObservation();
    const firstConnection = {
      observe: vi.fn(() => firstObservation),
    } as unknown as FlueConnection;
    const nextConnection = {
      observe: vi.fn(() => nextObservation),
    } as unknown as FlueConnection;
    const connectionFactory = vi.fn(
      (_options: ConnectionOptions) => nextConnection,
    );
    const fakeUi = createFakeUi();
    const done = createChatController({
      options,
      connection: firstConnection,
      connectionFactory,
      ui: fakeUi.ui,
    }).run();

    firstObservation.publish({
      conversationId: "conversation-old",
      settlements: [],
      messages: [
        {
          id: "old-user",
          role: "user",
          parts: [{ type: "text", text: "old", state: "done" }],
        },
      ],
    });
    fakeUi.submit("/new");

    expect(firstObservation.getSnapshot().phase).toBe("closed");
    expect(connectionFactory).toHaveBeenCalledOnce();
    expect(connectionFactory.mock.calls[0]?.[0].id).not.toBe(options.id);
    expect(fakeUi.ids).toEqual([connectionFactory.mock.calls[0]?.[0].id]);
    expect(fakeUi.transcript).toEqual([]);

    nextObservation.publish({
      conversationId: "conversation-new",
      settlements: [],
      messages: [
        {
          id: "new-user",
          role: "user",
          parts: [{ type: "text", text: "new", state: "done" }],
        },
      ],
    });
    expect(fakeUi.transcript).toEqual([{ role: "user", text: "new" }]);

    fakeUi.submit("/exit");
    await expect(done).resolves.toBe(0);
  });
});
