import { randomUUID } from "node:crypto";

import { setTimeout as delay } from "node:timers/promises";

import type { FlueConversationPart } from "@flue/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runChatCommand } from "../../src/commands/chat.js";
import type { ChatUi } from "../../src/ui/app.js";
import { startMockModel, type MockModelServer } from "./mock-model.js";
import { startDemoServer, type DemoServer } from "./server.js";

interface HeadlessBlock {
  kind: "text" | "reasoning" | "tool";
  part: FlueConversationPart;
  role?: "user" | "assistant";
}

function createHeadlessUi() {
  const transcript: HeadlessBlock[] = [];
  const notices: string[] = [];
  const ids: string[] = [];
  let busy = false;
  let currentText = "";
  let submitHandler: ((text: string) => void) | undefined;
  let inputHandler: ((data: string) => unknown) | undefined;

  const ui: ChatUi<HeadlessBlock> = {
    reconcileUi: {
      createTextBlock(role, part) {
        const block: HeadlessBlock = { kind: "text", role, part };
        return {
          block,
          update(nextPart) {
            block.part = nextPart;
          },
        };
      },
      createReasoningBlock(part) {
        const block: HeadlessBlock = { kind: "reasoning", part };
        return {
          block,
          update(nextPart) {
            block.part = nextPart;
          },
        };
      },
      createToolBlock(part) {
        const block: HeadlessBlock = { kind: "tool", part };
        return {
          block,
          update(nextPart) {
            block.part = nextPart;
          },
        };
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
    setBusy(nextBusy) {
      busy = nextBusy;
    },
    setReconnecting() {},
    recordUsage() {},
    resetUsage() {},
    addRecoveredMarker() {},
    setToolsMode() {},
    toggleToolsExpanded() {},
    readLoop(handlers) {
      const editor = {
        addToHistory() {},
        getText: () => currentText,
        setText(text: string) {
          currentText = text;
        },
      };
      submitHandler = (text) => {
        currentText = text;
        handlers.onSubmit(text, editor);
        currentText = "";
      };
      inputHandler = (data) => handlers.onInput(data, editor);
      return () => {
        submitHandler = undefined;
        inputHandler = undefined;
      };
    },
    stop() {},
  };

  return {
    ui,
    transcript,
    notices,
    ids,
    get busy() {
      return busy;
    },
    submit(text: string) {
      submitHandler?.(text);
    },
    input(data: string) {
      return inputHandler?.(data);
    },
  };
}

async function waitUntil(
  predicate: () => boolean,
  description: string,
  timeoutMs = 15_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await delay(25);
  }
  throw new Error(`timed out waiting for ${description}`);
}

function textRows(ui: ReturnType<typeof createHeadlessUi>) {
  return ui.transcript.flatMap((block) =>
    block.kind === "text" && block.part.type === "text"
      ? [{ role: block.role, text: block.part.text }]
      : [],
  );
}

const describeE2e = process.env.E2E === "1" ? describe : describe.skip;

describeE2e("chat against a live flue server", () => {
  let model: MockModelServer;
  let server: DemoServer;

  beforeAll(async () => {
    model = await startMockModel();
    server = await startDemoServer({
      env: {
        ANTHROPIC_API_KEY: "e2e-dummy-key",
        ANTHROPIC_BASE_URL: model.url,
      },
    });
  }, 30_000);

  afterAll(async () => {
    await server?.stop();
    await model?.stop();
  });

  it("renders canonical user and assistant transcript rows", async () => {
    const headless = createHeadlessUi();
    const done = runChatCommand(
      {
        url: server.url,
        agent: "demo",
        id: `e2e-${randomUUID()}`,
        tools: "collapsed",
        resume: false,
      },
      { uiFactory: () => headless.ui },
    );

    headless.submit("roll");
    await waitUntil(
      () =>
        textRows(headless).some((row) => row.text.includes("done rolling:")),
      "assistant text",
    );

    expect(textRows(headless)).toEqual([
      { role: "user", text: "roll" },
      { role: "assistant", text: expect.stringContaining("done rolling:") },
    ]);

    headless.submit("/exit");
    await expect(done).resolves.toBe(0);
  }, 30_000);

  it("resets the instance id for /new", async () => {
    const initialId = `e2e-${randomUUID()}`;
    const headless = createHeadlessUi();
    const done = runChatCommand(
      {
        url: server.url,
        agent: "demo",
        id: initialId,
        tools: "collapsed",
        resume: false,
      },
      { uiFactory: () => headless.ui },
    );

    headless.submit("/new");

    expect(headless.ids).toHaveLength(1);
    expect(headless.ids[0]).not.toBe(initialId);

    headless.submit("/exit");
    await expect(done).resolves.toBe(0);
  });

  it("interrupts a delayed turn and renders the next prompt cleanly", async () => {
    const headless = createHeadlessUi();
    const done = runChatCommand(
      {
        url: server.url,
        agent: "demo",
        id: `e2e-${randomUUID()}`,
        tools: "collapsed",
        resume: false,
      },
      { uiFactory: () => headless.ui },
    );

    headless.submit("delay roll");
    await waitUntil(
      () => textRows(headless).some((row) => row.text === "delay roll"),
      "the delayed user row",
    );
    expect(headless.input("\u001b")).toEqual({ consume: true });
    await waitUntil(
      () =>
        !headless.busy &&
        headless.notices.some((notice) => notice.startsWith("interrupted")),
      "the local wait to stop",
    );

    headless.submit("roll");
    await waitUntil(
      () =>
        textRows(headless).filter(
          (row) =>
            row.role === "assistant" && row.text.includes("done rolling:"),
        ).length === 2,
      "both server-side turns",
    );

    const rows = textRows(headless);
    expect(rows.filter((row) => row.role === "user")).toEqual([
      { role: "user", text: "delay roll" },
      { role: "user", text: "roll" },
    ]);
    expect(rows.filter((row) => row.role === "assistant")).toHaveLength(2);

    headless.submit("/exit");
    await expect(done).resolves.toBe(0);
  }, 30_000);
});
