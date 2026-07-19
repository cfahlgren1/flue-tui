import { isDeepStrictEqual } from "node:util";

import type {
  FlueConversationMessage,
  FlueConversationPart,
  FlueConversationSnapshot,
  FlueConversationState,
} from "@flue/sdk";

export type TextPart = Extract<FlueConversationPart, { type: "text" }>;
export type ReasoningPart = Extract<
  FlueConversationPart,
  { type: "reasoning" }
>;
export type ToolPart = Extract<FlueConversationPart, { type: "dynamic-tool" }>;

interface ReconciledBlock<TBlock, TPart extends FlueConversationPart> {
  block?: TBlock;
  update(part: TPart): void;
}

export interface ReconcileUi<TBlock> {
  createTextBlock(
    role: FlueConversationMessage["role"],
    part: TextPart,
  ): ReconciledBlock<TBlock, TextPart>;
  createReasoningBlock(
    part: ReasoningPart,
  ): ReconciledBlock<TBlock, ReasoningPart>;
  createToolBlock(part: ToolPart): ReconciledBlock<TBlock, ToolPart>;
  appendTranscriptBlock(block: TBlock): void;
  replaceTranscript(blocks: TBlock[]): void;
}

type RenderablePart = TextPart | ReasoningPart | ToolPart;

interface PartRecord<TBlock> {
  key: string;
  part: RenderablePart;
  block?: TBlock;
  update(part: RenderablePart): void;
}

interface MessageRecord<TBlock> {
  id: string;
  role: FlueConversationMessage["role"];
  parts: PartRecord<TBlock>[];
}

type Conversation = FlueConversationSnapshot | FlueConversationState;

export interface ReconcileResult {
  changed: boolean;
  changedMessageIds: Set<string>;
}

function renderableParts(message: FlueConversationMessage) {
  return message.parts.flatMap((part, index) => {
    if (part.type === "file") {
      return [];
    }

    const key =
      part.type === "dynamic-tool"
        ? `tool:${part.toolCallId}`
        : `part:${index}:${part.type}`;
    return [{ key, part }];
  });
}

function samePart(left: RenderablePart, right: RenderablePart): boolean {
  if (left === right) {
    return true;
  }
  if (left.type !== right.type) {
    return false;
  }
  if (left.type === "text" || left.type === "reasoning") {
    return (
      right.type === left.type &&
      left.text === right.text &&
      left.state === right.state
    );
  }
  if (right.type !== "dynamic-tool") {
    return false;
  }
  if (
    left.toolCallId !== right.toolCallId ||
    left.toolName !== right.toolName ||
    left.state !== right.state ||
    !isDeepStrictEqual(left.input, right.input)
  ) {
    return false;
  }
  if (left.state === "output-available") {
    return (
      right.state === "output-available" &&
      isDeepStrictEqual(left.output, right.output)
    );
  }
  if (left.state === "output-error") {
    return right.state === "output-error" && left.errorText === right.errorText;
  }
  return true;
}

export function createReconciler<TBlock>(ui: ReconcileUi<TBlock>) {
  let conversationId: string | undefined;
  let messages: MessageRecord<TBlock>[] = [];

  const createPartRecord = (
    role: FlueConversationMessage["role"],
    key: string,
    part: RenderablePart,
  ): PartRecord<TBlock> => {
    const entry =
      part.type === "text"
        ? ui.createTextBlock(role, part)
        : part.type === "reasoning"
          ? ui.createReasoningBlock(part)
          : ui.createToolBlock(part);

    return {
      key,
      part,
      block: entry.block,
      update: entry.update as (nextPart: RenderablePart) => void,
    };
  };

  const createMessageRecord = (
    message: FlueConversationMessage,
  ): MessageRecord<TBlock> => ({
    id: message.id,
    role: message.role,
    parts: renderableParts(message).map(({ key, part }) =>
      createPartRecord(message.role, key, part),
    ),
  });

  const requiresReplacement = (conversation: Conversation): boolean => {
    if (
      conversationId !== undefined &&
      conversationId !== conversation.conversationId
    ) {
      return true;
    }
    if (conversation.messages.length < messages.length) {
      return true;
    }

    return messages.some((record, messageIndex) => {
      const message = conversation.messages[messageIndex];
      if (
        message === undefined ||
        message.id !== record.id ||
        message.role !== record.role
      ) {
        return true;
      }

      const parts = renderableParts(message);
      if (parts.length < record.parts.length) {
        return true;
      }
      return record.parts.some(
        (partRecord, partIndex) => parts[partIndex]?.key !== partRecord.key,
      );
    });
  };

  const replace = (conversation: Conversation): ReconcileResult => {
    messages = conversation.messages.map(createMessageRecord);
    conversationId = conversation.conversationId;
    ui.replaceTranscript(
      messages.flatMap((message) =>
        message.parts.flatMap((part) =>
          part.block === undefined ? [] : [part.block],
        ),
      ),
    );
    return {
      changed: true,
      changedMessageIds: new Set(messages.map((message) => message.id)),
    };
  };

  const reconcile = (conversation: Conversation): ReconcileResult => {
    if (requiresReplacement(conversation)) {
      return replace(conversation);
    }

    conversationId = conversation.conversationId;
    const changedMessageIds = new Set<string>();

    for (const [messageIndex, message] of conversation.messages.entries()) {
      let record = messages[messageIndex];
      if (record === undefined) {
        record = createMessageRecord(message);
        messages.push(record);
        changedMessageIds.add(message.id);
        for (const part of record.parts) {
          if (part.block !== undefined) {
            ui.appendTranscriptBlock(part.block);
          }
        }
        continue;
      }

      const parts = renderableParts(message);
      for (const [partIndex, { key, part }] of parts.entries()) {
        const partRecord = record.parts[partIndex];
        if (partRecord === undefined) {
          const nextRecord = createPartRecord(message.role, key, part);
          record.parts.push(nextRecord);
          changedMessageIds.add(message.id);
          if (nextRecord.block !== undefined) {
            ui.appendTranscriptBlock(nextRecord.block);
          }
        } else if (!samePart(partRecord.part, part)) {
          partRecord.update(part);
          partRecord.part = part;
          changedMessageIds.add(message.id);
        }
      }
    }

    return {
      changed: changedMessageIds.size > 0,
      changedMessageIds,
    };
  };

  return { reconcile };
}
