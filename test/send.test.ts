import type { AgentPromptResponse, AgentSendResult } from "@flue/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FlueConnection } from "../src/client.js";
import {
  formatSendResult,
  runSendCommand,
} from "../src/commands/send.js";

const admission: AgentSendResult = {
  streamUrl: "https://flue.example.test/stream",
  offset: "0",
  submissionId: "submission-123",
};

const result: AgentPromptResponse = {
  text: "hello",
  usage: {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  },
  model: { provider: "test", id: "test-model" },
};

function createTestConnection(
  overrides: Partial<FlueConnection> = {},
): FlueConnection {
  return {
    send: vi.fn().mockResolvedValue(admission),
    wait: vi.fn().mockResolvedValue(result),
    observe: vi.fn(),
    abort: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as FlueConnection;
}

function setStdoutTty(value: boolean) {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value,
  });

  return () => {
    if (descriptor) {
      Object.defineProperty(process.stdout, "isTTY", descriptor);
    } else {
      delete (process.stdout as { isTTY?: boolean }).isTTY;
    }
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runSendCommand", () => {
  it("formats JSON with invocation identity and the final result", () => {
    expect(
      formatSendResult("demo", "instance-1", admission.submissionId, result),
    ).toEqual({
      agent: "demo",
      id: "instance-1",
      submissionId: "submission-123",
      text: result.text,
      usage: result.usage,
      model: result.model,
    });
  });

  it("does not repeat the final text on stdout when stdout is a TTY", async () => {
    const restoreTty = setStdoutTty(true);
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const wait = vi.fn().mockImplementation(async (_admission, options) => {
      await options.onEvent?.({
        type: "message-delta",
        conversationId: "conversation-1",
        messageId: "message-1",
        kind: "text",
        delta: "hello",
        position: { batch: 1, index: 1 },
      });
      return result;
    });

    try {
      await expect(
        runSendCommand({
          connection: createTestConnection({ wait }),
          agent: "demo",
          id: "instance-1",
          message: "hello",
          json: false,
        }),
      ).resolves.toBe(0);
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).toHaveBeenCalledWith("hello");
      expect(stderr).toHaveBeenCalledWith("\n");
    } finally {
      restoreTty();
    }
  });

  it("writes JSON output even when stdout is a TTY", async () => {
    const restoreTty = setStdoutTty(true);
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      await runSendCommand({
        connection: createTestConnection(),
        agent: "demo",
        id: "instance-1",
        message: "hello",
        json: true,
      });
      expect(stdout).toHaveBeenCalledWith(
        `${JSON.stringify({
          agent: "demo",
          id: "instance-1",
          submissionId: admission.submissionId,
          text: result.text,
          usage: result.usage,
          model: result.model,
        })}\n`,
      );
    } finally {
      restoreTty();
    }
  });

  it("summarizes tool inputs and outputs in progress lines", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const wait = vi.fn().mockImplementation(async (_admission, options) => {
      await options.onEvent?.({
        type: "tool-input",
        toolCallId: "tool-1",
        toolName: "search",
        input: { query: "cats", filters: { recent: true } },
      });
      await options.onEvent?.({
        type: "tool-output",
        toolCallId: "tool-1",
        output: ["one", "two"],
      });
      return result;
    });

    await runSendCommand({
      connection: createTestConnection({ wait }),
      agent: "demo",
      id: "instance-1",
      message: "hello",
      json: false,
    });

    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining('tool search query="cats" filters={…}'),
    );
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("→ [2 items]"));
  });

  it("writes the final text to piped stdout", async () => {
    const restoreTty = setStdoutTty(false);
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      await runSendCommand({
        connection: createTestConnection(),
        agent: "demo",
        id: "instance-1",
        message: "hello",
        json: false,
      });
      expect(stdout).toHaveBeenCalledWith("hello\n");
    } finally {
      restoreTty();
    }
  });

  it("prints a generated session id to stderr before sending", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await runSendCommand({
      connection: createTestConnection(),
      agent: "demo",
      id: "tui-generated",
      idProvided: false,
      message: "hello",
      json: false,
    });

    expect(stderr.mock.calls[0]?.[0]).toContain("session tui-generated");
  });

  it("aborts only local fetches on SIGINT", async () => {
    const abort = vi.fn();
    const wait = vi.fn().mockImplementation(async () => {
      process.emit("SIGINT");
      throw new Error("locally aborted");
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(
      runSendCommand({
        connection: createTestConnection({ abort, wait }),
        agent: "demo",
        id: "instance-1",
        message: "hello",
        json: false,
      }),
    ).resolves.toBe(130);
    expect(abort).not.toHaveBeenCalled();
  });

  it("prints durable submission details when waiting fails", async () => {
    const error = new Error("stream disconnected");
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(
      runSendCommand({
        connection: createTestConnection({
          wait: vi.fn().mockRejectedValue(error),
        }),
        agent: "demo",
        id: "instance-1",
        message: "hello",
        json: false,
      }),
    ).rejects.toBe(error);

    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining(
        'agent "demo", instance id "instance-1", submissionId "submission-123"',
      ),
    );
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("durable submission may still be running"),
    );
  });

  it.each([
    ["failed" as const, "submission failed"],
    ["aborted" as const, "submission aborted"],
  ])("reports a definitive %s settlement plainly", async (outcome, wording) => {
    const error = new Error(`submission ${outcome}`);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const wait = vi.fn().mockImplementation(async (_admission, options) => {
      await options.onEvent?.({
        type: "submission-settled",
        conversationId: "conversation-1",
        submissionId: admission.submissionId,
        outcome,
        error: outcome === "failed" ? { message: "model failed" } : undefined,
        position: { batch: 1, index: 1 },
      });
      throw error;
    });

    await expect(
      runSendCommand({
        connection: createTestConnection({ wait }),
        agent: "demo",
        id: "instance-1",
        message: "hello",
        json: false,
      }),
    ).rejects.toBe(error);

    expect(stderr).toHaveBeenCalledWith(expect.stringContaining(wording));
    expect(stderr).not.toHaveBeenCalledWith(
      expect.stringContaining("may still be running"),
    );
  });
});
