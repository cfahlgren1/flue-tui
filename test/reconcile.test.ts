import type { FlueConversationPart, FlueConversationState } from "@flue/sdk";
import { describe, expect, it } from "vitest";

import { createReconciler, type ReconcileUi } from "../src/ui/reconcile.js";

type RenderedBlock = {
  kind: "text" | "reasoning" | "tool";
  role?: "user" | "assistant";
  part: FlueConversationPart;
  updates: number;
};

function createTestUi() {
  const transcript: RenderedBlock[] = [];
  let replacements = 0;

  const ui: ReconcileUi<RenderedBlock> = {
    createTextBlock(role, part) {
      const block: RenderedBlock = {
        kind: "text",
        role,
        part,
        updates: 0,
      };
      return {
        block,
        update(nextPart) {
          block.part = nextPart;
          block.updates++;
        },
      };
    },
    createReasoningBlock(part) {
      const block: RenderedBlock = {
        kind: "reasoning",
        part,
        updates: 0,
      };
      return {
        block,
        update(nextPart) {
          block.part = nextPart;
          block.updates++;
        },
      };
    },
    createToolBlock(part) {
      const block: RenderedBlock = {
        kind: "tool",
        part,
        updates: 0,
      };
      return {
        block,
        update(nextPart) {
          block.part = nextPart;
          block.updates++;
        },
      };
    },
    appendTranscriptBlock(block) {
      transcript.push(block);
    },
    replaceTranscript(blocks) {
      replacements++;
      transcript.splice(0, transcript.length, ...blocks);
    },
  };

  return {
    ui,
    transcript,
    get replacements() {
      return replacements;
    },
  };
}

function state(
  messages: FlueConversationState["messages"],
): FlueConversationState {
  return {
    conversationId: "conversation-1",
    messages,
    settlements: [],
  };
}

describe("createReconciler", () => {
  it("hydrates message parts in their canonical order", () => {
    const testUi = createTestUi();
    const reconciler = createReconciler(testUi.ui);

    reconciler.reconcile(
      state([
        {
          id: "assistant-1",
          role: "assistant",
          parts: [
            { type: "reasoning", text: "thinking", state: "done" },
            { type: "text", text: "first", state: "done" },
            {
              type: "dynamic-tool",
              toolCallId: "tool-1",
              toolName: "search",
              state: "output-available",
              input: { query: "cats" },
              output: ["result"],
            },
            { type: "text", text: "second", state: "done" },
          ],
        },
      ]),
    );

    expect(testUi.transcript.map((block) => block.kind)).toEqual([
      "reasoning",
      "text",
      "tool",
      "text",
    ]);
  });

  it("mutates an existing streaming text block", () => {
    const testUi = createTestUi();
    const reconciler = createReconciler(testUi.ui);
    const initial = state([
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "hel", state: "streaming" }],
      },
    ]);

    reconciler.reconcile(initial);
    const block = testUi.transcript[0];
    reconciler.reconcile(
      state([
        {
          ...initial.messages[0]!,
          parts: [{ type: "text", text: "hello", state: "streaming" }],
        },
      ]),
    );

    expect(testUi.transcript[0]).toBe(block);
    expect(block?.part).toMatchObject({ text: "hello" });
    expect(block?.updates).toBe(1);
  });

  it("replaces streaming text with the authoritative completed text once", () => {
    const testUi = createTestUi();
    const reconciler = createReconciler(testUi.ui);
    const message = {
      id: "assistant-1",
      role: "assistant" as const,
      parts: [
        {
          type: "text" as const,
          text: "**partial",
          state: "streaming" as const,
        },
      ],
    };

    reconciler.reconcile(state([message]));
    const block = testUi.transcript[0];
    const completed = state([
      {
        ...message,
        parts: [{ type: "text", text: "**final**", state: "done" as const }],
      },
    ]);

    reconciler.reconcile(completed);
    reconciler.reconcile(completed);

    expect(testUi.transcript).toEqual([block]);
    expect(block?.part).toMatchObject({ text: "**final**", state: "done" });
    expect(block?.updates).toBe(1);
  });

  it("mutates one tool block through running, done, and error states", () => {
    const testUi = createTestUi();
    const reconciler = createReconciler(testUi.ui);
    const message = {
      id: "assistant-1",
      role: "assistant" as const,
      parts: [
        {
          type: "dynamic-tool" as const,
          toolCallId: "tool-1",
          toolName: "search",
          state: "input-available" as const,
          input: { query: "cats" },
        },
      ],
    };

    reconciler.reconcile(state([message]));
    const block = testUi.transcript[0];
    reconciler.reconcile(
      state([
        {
          ...message,
          parts: [
            {
              ...message.parts[0],
              state: "output-available",
              output: ["result"],
            },
          ],
        },
      ]),
    );
    expect(testUi.transcript[0]).toBe(block);
    expect(block?.part).toMatchObject({ state: "output-available" });

    reconciler.reconcile(
      state([
        {
          ...message,
          parts: [
            {
              ...message.parts[0],
              state: "output-error",
              errorText: "failed",
            },
          ],
        },
      ]),
    );
    expect(testUi.transcript[0]).toBe(block);
    expect(block?.part).toMatchObject({
      state: "output-error",
      errorText: "failed",
    });
  });

  it("rebuilds directly from a replacement snapshot", () => {
    const testUi = createTestUi();
    const reconciler = createReconciler(testUi.ui);

    reconciler.reconcile(
      state([
        {
          id: "old-user",
          role: "user",
          parts: [{ type: "text", text: "old", state: "done" }],
        },
      ]),
    );
    reconciler.reconcile(
      state([
        {
          id: "replacement-user",
          role: "user",
          parts: [{ type: "text", text: "replacement", state: "done" }],
        },
      ]),
    );

    expect(testUi.replacements).toBe(1);
    expect(testUi.transcript).toHaveLength(1);
    expect(testUi.transcript[0]).toMatchObject({
      kind: "text",
      role: "user",
      part: { text: "replacement" },
    });
  });

  it("does not duplicate a canonical user message across updates", () => {
    const testUi = createTestUi();
    const reconciler = createReconciler(testUi.ui);
    const userMessage = {
      id: "user-1",
      role: "user" as const,
      parts: [{ type: "text" as const, text: "hello", state: "done" as const }],
    };

    reconciler.reconcile(state([userMessage]));
    const block = testUi.transcript[0];
    reconciler.reconcile(
      state([{ ...userMessage, parts: [...userMessage.parts] }]),
    );

    expect(testUi.transcript).toEqual([block]);
  });

  it("reports only messages whose rendered state changed", () => {
    const testUi = createTestUi();
    const reconciler = createReconciler(testUi.ui);
    const userMessage = {
      id: "user-1",
      role: "user" as const,
      parts: [{ type: "text" as const, text: "hello", state: "done" as const }],
    };

    expect(reconciler.reconcile(state([userMessage]))).toEqual({
      changed: true,
      changedMessageIds: new Set(["user-1"]),
    });
    expect(
      reconciler.reconcile(
        state([{ ...userMessage, parts: [...userMessage.parts] }]),
      ),
    ).toEqual({
      changed: false,
      changedMessageIds: new Set(),
    });
    expect(
      reconciler.reconcile(
        state([
          {
            ...userMessage,
            parts: [
              { type: "text", text: "hello again", state: "done" as const },
            ],
          },
        ]),
      ),
    ).toEqual({
      changed: true,
      changedMessageIds: new Set(["user-1"]),
    });
  });

  it("does not report cloned tool payloads as changes", () => {
    const testUi = createTestUi();
    const reconciler = createReconciler(testUi.ui);
    const toolMessage = {
      id: "assistant-1",
      role: "assistant" as const,
      parts: [
        {
          type: "dynamic-tool" as const,
          toolCallId: "tool-1",
          toolName: "search",
          state: "output-available" as const,
          input: { query: "cats" },
          output: [{ title: "Cats" }],
        },
      ],
    };

    reconciler.reconcile(state([toolMessage]));

    expect(
      reconciler.reconcile(
        state([
          {
            ...toolMessage,
            parts: [
              {
                ...toolMessage.parts[0],
                input: { query: "cats" },
                output: [{ title: "Cats" }],
              },
            ],
          },
        ]),
      ),
    ).toEqual({
      changed: false,
      changedMessageIds: new Set(),
    });
  });
});
