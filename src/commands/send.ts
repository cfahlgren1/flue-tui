import type { AgentPromptResponse, ConversationStreamChunk } from "@flue/sdk";
import chalk from "chalk";

import type { FlueConnection } from "../client.js";
import { summarize } from "../ui/format.js";
import { sanitizeText } from "../ui/sanitize.js";
import { formatPostAdmissionWaitError } from "../wait-error.js";

interface SendCommandOptions {
  connection: FlueConnection;
  agent: string;
  id: string;
  idProvided?: boolean;
  message: string;
  json: boolean;
}

interface ActiveTool {
  name: string;
  startedAt: number;
}

function createProgressRenderer(stderr: NodeJS.WritableStream) {
  const activeTools = new Map<string, ActiveTool>();
  let atLineStart = true;
  let lastDeltaKind: "text" | "reasoning" | undefined;
  let thinkingPrefixWritten = false;

  const write = (value: string) => {
    stderr.write(value);
    atLineStart = value.endsWith("\n");
  };

  const startLine = () => {
    if (!atLineStart) {
      write("\n");
    }
  };

  const render = (event: ConversationStreamChunk) => {
    switch (event.type) {
      case "message-delta": {
        if (event.kind === "reasoning") {
          if (lastDeltaKind === "text") {
            startLine();
          }
          if (!thinkingPrefixWritten) {
            write(chalk.dim("thinking "));
            thinkingPrefixWritten = true;
          }
          write(chalk.dim(sanitizeText(event.delta)));
        } else {
          if (lastDeltaKind === "reasoning") {
            startLine();
          }
          write(sanitizeText(event.delta));
        }
        lastDeltaKind = event.kind;
        break;
      }
      case "tool-input": {
        startLine();
        write(
          chalk.dim(
            `tool ${sanitizeText(event.toolName)} ${summarize(event.input, 80)}\n`,
          ),
        );
        activeTools.set(event.toolCallId, {
          name: sanitizeText(event.toolName),
          startedAt: Date.now(),
        });
        lastDeltaKind = undefined;
        break;
      }
      case "tool-output":
      case "tool-output-error": {
        const tool = activeTools.get(event.toolCallId);
        const name = tool?.name ?? sanitizeText(event.toolCallId);
        const durationMs = tool ? Date.now() - tool.startedAt : 0;
        const status = event.type === "tool-output" ? "done" : "error";
        const result =
          event.type === "tool-output" ? event.output : event.errorText;

        startLine();
        write(
          chalk.dim(
            `tool ${status} ${name} (${durationMs}ms) → ${summarize(result, 80)}\n`,
          ),
        );
        activeTools.delete(event.toolCallId);
        lastDeltaKind = undefined;
        break;
      }
      case "conversation-reset":
      case "message-appended":
      case "message-started":
      case "message-completed":
      case "submission-settled":
        break;
      default: {
        const exhaustive: never = event;
        return exhaustive;
      }
    }
  };

  return {
    render,
    finish: startLine,
  };
}

export function formatSendResult(
  agent: string,
  id: string,
  submissionId: string,
  result: AgentPromptResponse,
) {
  return {
    agent,
    id,
    submissionId,
    text: result.text,
    usage: result.usage,
    model: result.model,
  };
}

function writeResult(
  result: AgentPromptResponse,
  json: boolean,
  identity: { agent: string; id: string; submissionId: string },
) {
  if (json) {
    process.stdout.write(
      `${JSON.stringify(
        formatSendResult(
          identity.agent,
          identity.id,
          identity.submissionId,
          result,
        ),
      )}\n`,
    );
    return;
  }

  if (!process.stdout.isTTY) {
    process.stdout.write(`${result.text}\n`);
  }
}

export async function runSendCommand({
  connection,
  agent,
  id,
  idProvided = true,
  message,
  json,
}: SendCommandOptions): Promise<number> {
  const controller = new AbortController();
  const progress = createProgressRenderer(process.stderr);
  let interrupted = false;
  let admission: Awaited<ReturnType<FlueConnection["send"]>> | undefined;

  const handleSigint = () => {
    if (interrupted) {
      return;
    }

    interrupted = true;
    controller.abort();
  };

  process.once("SIGINT", handleSigint);

  try {
    if (!json && !idProvided) {
      process.stderr.write(chalk.dim(`session ${sanitizeText(id)}\n`));
    }

    const confirmedAdmission = await connection.send(message, {
      signal: controller.signal,
    });
    admission = confirmedAdmission;
    let result: AgentPromptResponse;
    let settlement:
      | Extract<ConversationStreamChunk, { type: "submission-settled" }>
      | undefined;

    try {
      result = await connection.wait(confirmedAdmission, {
        signal: controller.signal,
        onEvent: (event) => {
          progress.render(event);
          if (
            event.type === "submission-settled" &&
            event.submissionId === confirmedAdmission.submissionId
          ) {
            settlement = event;
          }
        },
      });
    } catch (error) {
      progress.finish();
      if (!interrupted) {
        process.stderr.write(
          `${formatPostAdmissionWaitError({
            agent: sanitizeText(agent),
            id: sanitizeText(id),
            submissionId: confirmedAdmission.submissionId,
            settlement,
            error,
          })}\n`,
        );
      }
      throw error;
    }

    progress.finish();
    writeResult(result, json, {
      agent,
      id,
      submissionId: confirmedAdmission.submissionId,
    });
    return 0;
  } catch (error) {
    progress.finish();
    if (interrupted) {
      const interruptionNotice =
        admission === undefined
          ? "interrupted before server admission could be confirmed"
          : "interrupted — agent keeps running server-side";
      process.stderr.write(`${chalk.dim(interruptionNotice)}\n`);
      return 130;
    }
    throw error;
  } finally {
    process.removeListener("SIGINT", handleSigint);
  }
}
