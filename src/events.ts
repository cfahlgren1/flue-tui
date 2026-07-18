import type {
  ConversationStreamChunk,
  FlueConversationMessage,
  FlueConversationSnapshot,
} from "@flue/sdk";

export type TuiEvent =
  | { type: "user-message"; text: string }
  | { type: "assistant-delta"; text: string }
  | { type: "assistant-complete"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "reasoning-complete" }
  | {
      type: "tool-start";
      toolCallId: string;
      toolName: string;
      input?: unknown;
    }
  | {
      type: "tool-end";
      toolCallId: string;
      toolName: string;
      ok: boolean;
      output?: unknown;
      errorMessage?: string;
      durationMs: number;
    }
  | { type: "reset" }
  | { type: "settled" };

interface ActiveTool {
  toolName: string;
  startedAt: number;
}

function getMessageText(message: FlueConversationMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export function hydrateFromSnapshot(
  snapshot: FlueConversationSnapshot,
): TuiEvent[] {
  const events: TuiEvent[] = [];

  for (const message of snapshot.messages) {
    events.push({
      type:
        message.role === "user" ? "user-message" : "assistant-complete",
      text: getMessageText(message),
    });

    for (const part of message.parts) {
      if (part.type !== "dynamic-tool" || part.state === "input-available") {
        continue;
      }

      events.push({
        type: "tool-start",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
      });

      if (part.state === "output-available") {
        events.push({
          type: "tool-end",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          ok: true,
          output: part.output,
          durationMs: 0,
        });
      } else {
        events.push({
          type: "tool-end",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          ok: false,
          errorMessage: part.errorText,
          durationMs: 0,
        });
      }
    }
  }

  return events;
}

export function createTranslator(now: () => number = Date.now) {
  const activeTools = new Map<string, ActiveTool>();
  let currentMessageId: string | undefined;
  let currentText = "";
  let currentDeltaKind: "text" | "reasoning" | undefined;

  const resetMessage = (messageId?: string) => {
    currentMessageId = messageId;
    currentText = "";
    currentDeltaKind = undefined;
  };

  const translate = (chunk: ConversationStreamChunk): TuiEvent[] => {
    switch (chunk.type) {
      case "conversation-reset":
        activeTools.clear();
        resetMessage();
        return [{ type: "reset" }];
      case "message-appended": {
        const text = getMessageText(chunk.message);
        if (chunk.message.role === "user") {
          return [{ type: "user-message", text }];
        }
        return [{ type: "assistant-complete", text }];
      }
      case "message-started":
        resetMessage(chunk.messageId);
        return [];
      case "message-delta": {
        if (currentMessageId !== chunk.messageId) {
          resetMessage(chunk.messageId);
        }

        if (chunk.kind === "reasoning") {
          currentDeltaKind = "reasoning";
          return [{ type: "reasoning-delta", text: chunk.delta }];
        }

        currentText += chunk.delta;
        const events: TuiEvent[] = [];
        if (currentDeltaKind === "reasoning") {
          events.push({ type: "reasoning-complete" });
        }
        currentDeltaKind = "text";
        events.push({ type: "assistant-delta", text: chunk.delta });
        return events;
      }
      case "tool-input":
        activeTools.set(chunk.toolCallId, {
          toolName: chunk.toolName,
          startedAt: now(),
        });
        return [
          {
            type: "tool-start",
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            input: chunk.input,
          },
        ];
      case "tool-output": {
        const tool = activeTools.get(chunk.toolCallId);
        activeTools.delete(chunk.toolCallId);
        return [
          {
            type: "tool-end",
            toolCallId: chunk.toolCallId,
            toolName: tool?.toolName ?? chunk.toolCallId,
            ok: true,
            output: chunk.output,
            durationMs: tool ? now() - tool.startedAt : 0,
          },
        ];
      }
      case "tool-output-error": {
        const tool = activeTools.get(chunk.toolCallId);
        activeTools.delete(chunk.toolCallId);
        return [
          {
            type: "tool-end",
            toolCallId: chunk.toolCallId,
            toolName: tool?.toolName ?? chunk.toolCallId,
            ok: false,
            errorMessage: chunk.errorText,
            durationMs: tool ? now() - tool.startedAt : 0,
          },
        ];
      }
      case "message-completed": {
        const events: TuiEvent[] = [];
        if (currentDeltaKind === "reasoning") {
          events.push({ type: "reasoning-complete" });
        }
        events.push({ type: "assistant-complete", text: currentText });
        resetMessage();
        return events;
      }
      case "submission-settled":
        return [{ type: "settled" }];
      default: {
        const exhaustive: never = chunk;
        return exhaustive;
      }
    }
  };

  return { translate };
}
