import type {
  AgentConversationObservation,
  AgentConversationObservationSnapshot,
  FlueConversationSnapshot,
  FlueConversationState,
} from "@flue/sdk";
import { describe, expect, it, vi } from "vitest";

import type { ConnectionOptions, FlueConnection } from "../src/client.js";
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
    this.publishSnapshot({
      conversation,
      offset: "1",
      phase: "live",
      error: undefined,
    });
  }

  publishSnapshot(snapshot: AgentConversationObservationSnapshot) {
    this.snapshot = snapshot;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function createFakeUi() {
  const transcript: TestBlock[] = [];
  const notices: string[] = [];
  const ids: string[] = [];
  const reconnectingStates: boolean[] = [];
  let recoveredMarkers = 0;
  let usageResets = 0;
  let submit: ((text: string) => void) | undefined;
  let input: ((data: string, text?: string) => void) | undefined;

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
    setReconnecting(reconnecting) {
      reconnectingStates.push(reconnecting);
    },
    recordUsage() {},
    resetUsage() {
      usageResets++;
    },
    addRecoveredMarker() {
      recoveredMarkers++;
    },
    setToolsMode() {},
    toggleToolsExpanded() {},
    readLoop(handlers) {
      submit = (text) =>
        handlers.onSubmit(text, {
          addToHistory() {},
          getText: () => text,
          setText() {},
        });
      input = (data, text = "") => {
        handlers.onInput(data, {
          addToHistory() {},
          getText: () => text,
          setText() {},
        });
      };
      return () => undefined;
    },
    stop() {},
  };

  return {
    ui,
    transcript,
    notices,
    ids,
    reconnectingStates,
    get recoveredMarkers() {
      return recoveredMarkers;
    },
    get usageResets() {
      return usageResets;
    },
    submit(text: string) {
      submit?.(text);
    },
    input(data: string, text?: string) {
      input?.(data, text);
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
    expect(fakeUi.usageResets).toBe(1);

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

  it("treats an unreachable new session as an initial connection", async () => {
    vi.useFakeTimers();
    try {
      const firstObservation = new FakeObservation();
      const nextObservation = new FakeObservation();
      const firstConnection = {
        observe: vi.fn(() => firstObservation),
      } as unknown as FlueConnection;
      const nextConnection = {
        observe: vi.fn(() => nextObservation),
      } as unknown as FlueConnection;
      const fakeUi = createFakeUi();
      const done = createChatController({
        options,
        connection: firstConnection,
        connectionFactory: vi.fn(() => nextConnection),
        ui: fakeUi.ui,
      }).run();

      firstObservation.publish({
        conversationId: "conversation-old",
        settlements: [],
        messages: [],
      });
      fakeUi.submit("/new");
      nextObservation.publishSnapshot({
        conversation: undefined,
        offset: undefined,
        phase: "connecting",
        error: new Error("refused"),
      });

      expect(fakeUi.notices).not.toContain("connection lost — retrying");
      expect(fakeUi.notices).not.toContain(
        "cannot reach https://flue.test — retrying",
      );

      await vi.advanceTimersByTimeAsync(2_000);
      expect(fakeUi.notices).toContain(
        "cannot reach https://flue.test — retrying",
      );

      fakeUi.submit("/exit");
      await expect(done).resolves.toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows one reconnecting notice per live connection loss", async () => {
    const observation = new FakeObservation();
    const connection = {
      observe: vi.fn(() => observation),
    } as unknown as FlueConnection;
    const fakeUi = createFakeUi();
    const done = createChatController({
      options,
      connection,
      connectionFactory: vi.fn(() => connection),
      ui: fakeUi.ui,
    }).run();

    observation.publish({
      conversationId: "conversation-1",
      settlements: [],
      messages: [],
    });
    const reconnectingSnapshot: AgentConversationObservationSnapshot = {
      conversation: observation.getSnapshot().conversation,
      offset: "1",
      phase: "connecting",
      error: new Error("socket closed"),
    };
    observation.publishSnapshot(reconnectingSnapshot);
    observation.publishSnapshot({
      ...reconnectingSnapshot,
      error: new Error("retry failed"),
    });

    expect(fakeUi.reconnectingStates.at(-1)).toBe(true);
    expect(
      fakeUi.notices.filter(
        (notice) => notice === "connection lost — retrying",
      ),
    ).toHaveLength(1);

    observation.publish({
      conversationId: "conversation-1",
      settlements: [],
      messages: [],
    });
    expect(fakeUi.reconnectingStates.at(-1)).toBe(false);

    fakeUi.submit("/exit");
    await expect(done).resolves.toBe(0);
  });

  it("delays the initial unreachable-server notice for two seconds", async () => {
    vi.useFakeTimers();
    try {
      const observation = new FakeObservation();
      const connection = {
        observe: vi.fn(() => observation),
      } as unknown as FlueConnection;
      const fakeUi = createFakeUi();
      const done = createChatController({
        options: { ...options, url: "https://flue.test/path?secret=value" },
        connection,
        connectionFactory: vi.fn(() => connection),
        ui: fakeUi.ui,
      }).run();

      observation.publishSnapshot({
        conversation: undefined,
        offset: undefined,
        phase: "connecting",
        error: new Error("refused"),
      });
      expect(fakeUi.reconnectingStates.at(-1)).toBe(true);
      expect(fakeUi.notices).not.toContain(
        "cannot reach https://flue.test — retrying",
      );

      await vi.advanceTimersByTimeAsync(2_000);
      expect(fakeUi.notices).toContain(
        "cannot reach https://flue.test — retrying",
      );

      fakeUi.submit("/exit");
      await expect(done).resolves.toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses pre-admission wording when a local wait is interrupted early", async () => {
    const observation = new FakeObservation();
    const connection = {
      observe: vi.fn(() => observation),
      send: vi.fn(
        (_message: string, sendOptions: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            sendOptions.signal?.addEventListener("abort", () =>
              reject(new Error("locally aborted")),
            );
          }),
      ),
    } as unknown as FlueConnection;
    const fakeUi = createFakeUi();
    const done = createChatController({
      options,
      connection,
      connectionFactory: vi.fn(() => connection),
      ui: fakeUi.ui,
    }).run();

    fakeUi.submit("hello");
    fakeUi.input("\u001b");

    expect(fakeUi.notices).toContain(
      "interrupted before server admission could be confirmed",
    );
    expect(fakeUi.notices).not.toContain(
      "interrupted — agent keeps running server-side",
    );

    fakeUi.submit("/exit");
    await expect(done).resolves.toBe(0);
  });

  it.each([
    ["a completed settlement", true, false, 1],
    ["completed message parts alone", false, false, 0],
    ["an already-rendered completed response", true, true, 0],
  ])(
    "marks recovery only from %s",
    async (_case, hasSettlement, alreadyRendered, expectedMarkers) => {
      try {
        const observation = new FakeObservation();
        const historySnapshot = {
          v: 1,
          conversationId: "conversation-1",
          offset: "2",
          settlements: hasSettlement
            ? [
                {
                  submissionId: "submission-1",
                  outcome: "completed",
                },
              ]
            : [],
          messages: [
            {
              id: "assistant-1",
              role: "assistant",
              submissionId: "submission-1",
              parts: [{ type: "text", text: "done", state: "done" }],
            },
          ],
        } satisfies FlueConversationSnapshot;
        const history = vi.fn().mockResolvedValue(historySnapshot);
        const connection = {
          observe: vi.fn(() => observation),
          send: vi.fn().mockResolvedValue({
            streamUrl: "https://flue.test/stream",
            offset: "0",
            submissionId: "submission-1",
          }),
          wait: vi.fn().mockRejectedValue(new TypeError("stream disconnected")),
          history,
        } as unknown as FlueConnection;
        const fakeUi = createFakeUi();
        const done = createChatController({
          options,
          connection,
          connectionFactory: vi.fn(() => connection),
          ui: fakeUi.ui,
          recoveryDelay: vi.fn().mockResolvedValue(undefined),
        }).run();

        if (alreadyRendered) {
          observation.publish(historySnapshot);
        }
        fakeUi.submit("hello");
        await vi.waitFor(() => expect(history).toHaveBeenCalledOnce());

        expect(fakeUi.recoveredMarkers).toBe(expectedMarkers);

        fakeUi.submit("/exit");
        await expect(done).resolves.toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );
});
