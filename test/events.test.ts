import type { ConversationStreamChunk } from "@flue/sdk";
import { describe, expect, it } from "vitest";

import { createTranslator } from "../src/events.js";

const position = { batch: 1, index: 1 };

describe("createTranslator", () => {
  it.each([
    {
      name: "text delta",
      chunk: {
        type: "message-delta",
        conversationId: "conversation-1",
        messageId: "message-1",
        kind: "text",
        delta: "hello",
        position,
      } satisfies ConversationStreamChunk,
      expected: [{ type: "assistant-delta", text: "hello" }],
    },
    {
      name: "reasoning delta",
      chunk: {
        type: "message-delta",
        conversationId: "conversation-1",
        messageId: "message-1",
        kind: "reasoning",
        delta: "checking",
        position,
      } satisfies ConversationStreamChunk,
      expected: [{ type: "reasoning-delta", text: "checking" }],
    },
    {
      name: "message start",
      chunk: {
        type: "message-started",
        conversationId: "conversation-1",
        messageId: "message-1",
        position,
      } satisfies ConversationStreamChunk,
      expected: [],
    },
    {
      name: "conversation reset",
      chunk: {
        type: "conversation-reset",
        conversationId: "conversation-1",
        snapshot: {
          v: 1,
          conversationId: "conversation-1",
          offset: "1",
          messages: [],
          settlements: [],
        },
        position,
      } satisfies ConversationStreamChunk,
      expected: [{ type: "reset" }],
    },
    {
      name: "submission settlement",
      chunk: {
        type: "submission-settled",
        conversationId: "conversation-1",
        submissionId: "submission-1",
        outcome: "completed",
        position,
      } satisfies ConversationStreamChunk,
      expected: [{ type: "settled" }],
    },
  ])("translates $name", ({ chunk, expected }) => {
    expect(createTranslator().translate(chunk)).toEqual(expected);
  });

  it("ends reasoning before the next text delta", () => {
    const translator = createTranslator();
    const reasoning = {
      type: "message-delta",
      conversationId: "conversation-1",
      messageId: "message-1",
      kind: "reasoning",
      delta: "thinking",
      position,
    } satisfies ConversationStreamChunk;
    const text = {
      type: "message-delta",
      conversationId: "conversation-1",
      messageId: "message-1",
      kind: "text",
      delta: "answer",
      position: { batch: 1, index: 2 },
    } satisfies ConversationStreamChunk;

    expect(translator.translate(reasoning)).toEqual([
      { type: "reasoning-delta", text: "thinking" },
    ]);
    expect(translator.translate(text)).toEqual([
      { type: "reasoning-complete" },
      { type: "assistant-delta", text: "answer" },
    ]);
  });

  it("tracks a successful tool call and its duration", () => {
    let time = 100;
    const translator = createTranslator(() => time);
    const input = {
      type: "tool-input",
      conversationId: "conversation-1",
      messageId: "message-1",
      toolCallId: "tool-1",
      toolName: "weather",
      input: { city: "London" },
      position,
    } satisfies ConversationStreamChunk;
    const output = {
      type: "tool-output",
      conversationId: "conversation-1",
      toolCallId: "tool-1",
      output: { temperature: 20 },
      position: { batch: 1, index: 2 },
    } satisfies ConversationStreamChunk;

    expect(translator.translate(input)).toEqual([
      {
        type: "tool-start",
        toolCallId: "tool-1",
        toolName: "weather",
        input: { city: "London" },
      },
    ]);

    time = 145;
    expect(translator.translate(output)).toEqual([
      {
        type: "tool-end",
        toolCallId: "tool-1",
        toolName: "weather",
        ok: true,
        output: { temperature: 20 },
        durationMs: 45,
      },
    ]);
  });

  it("translates a tool error and preserves its message", () => {
    let time = 500;
    const translator = createTranslator(() => time);
    const input = {
      type: "tool-input",
      conversationId: "conversation-1",
      messageId: "message-1",
      toolCallId: "tool-2",
      toolName: "lookup",
      input: undefined,
      position,
    } satisfies ConversationStreamChunk;
    const error = {
      type: "tool-output-error",
      conversationId: "conversation-1",
      toolCallId: "tool-2",
      errorText: "not found",
      position: { batch: 1, index: 2 },
    } satisfies ConversationStreamChunk;

    translator.translate(input);
    time = 512;

    expect(translator.translate(error)).toEqual([
      {
        type: "tool-end",
        toolCallId: "tool-2",
        toolName: "lookup",
        ok: false,
        errorMessage: "not found",
        durationMs: 12,
      },
    ]);
  });

  it.each([
    {
      role: "user" as const,
      expected: { type: "user-message", text: "hello world" },
    },
    {
      role: "assistant" as const,
      expected: { type: "assistant-complete", text: "hello world" },
    },
  ])("translates an appended $role message", ({ role, expected }) => {
    const chunk = {
      type: "message-appended",
      conversationId: "conversation-1",
      message: {
        id: "message-1",
        role,
        parts: [
          { type: "text", text: "hello ", state: "done" },
          { type: "file", mediaType: "image/png", id: "attachment-1" },
          { type: "text", text: "world", state: "done" },
        ],
      },
      position,
    } satisfies ConversationStreamChunk;

    expect(createTranslator().translate(chunk)).toEqual([expected]);
  });

  it("emits the accumulated assistant text when a message completes", () => {
    const translator = createTranslator();
    const firstDelta = {
      type: "message-delta",
      conversationId: "conversation-1",
      messageId: "message-1",
      kind: "text",
      delta: "hello ",
      position,
    } satisfies ConversationStreamChunk;
    const secondDelta = {
      ...firstDelta,
      delta: "world",
      position: { batch: 1, index: 2 },
    } satisfies ConversationStreamChunk;
    const completed = {
      type: "message-completed",
      conversationId: "conversation-1",
      messageId: "message-1",
      position: { batch: 1, index: 3 },
    } satisfies ConversationStreamChunk;

    translator.translate(firstDelta);
    translator.translate(secondDelta);

    expect(translator.translate(completed)).toEqual([
      { type: "assistant-complete", text: "hello world" },
    ]);
  });

  it("ends active reasoning when a message completes", () => {
    const translator = createTranslator();
    const reasoning = {
      type: "message-delta",
      conversationId: "conversation-1",
      messageId: "message-1",
      kind: "reasoning",
      delta: "thinking",
      position,
    } satisfies ConversationStreamChunk;
    const completed = {
      type: "message-completed",
      conversationId: "conversation-1",
      messageId: "message-1",
      position: { batch: 1, index: 2 },
    } satisfies ConversationStreamChunk;

    translator.translate(reasoning);

    expect(translator.translate(completed)).toEqual([
      { type: "reasoning-complete" },
      { type: "assistant-complete", text: "" },
    ]);
  });
});
