import type {
  AgentPromptResponse,
  ConversationStreamChunk,
} from "@flue/sdk";
import chalk from "chalk";

import type { FlueConnection } from "../client.js";

interface SendCommandOptions {
  connection: FlueConnection;
  agent: string;
  id: string;
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
          write(chalk.dim(event.delta));
        } else {
          if (lastDeltaKind === "reasoning") {
            startLine();
          }
          write(event.delta);
        }
        lastDeltaKind = event.kind;
        break;
      }
      case "tool-input": {
        startLine();
        write(chalk.dim(`tool ${event.toolName}\n`));
        activeTools.set(event.toolCallId, {
          name: event.toolName,
          startedAt: Date.now(),
        });
        lastDeltaKind = undefined;
        break;
      }
      case "tool-output":
      case "tool-output-error": {
        const tool = activeTools.get(event.toolCallId);
        const name = tool?.name ?? event.toolCallId;
        const durationMs = tool ? Date.now() - tool.startedAt : 0;
        const status = event.type === "tool-output" ? "done" : "error";

        startLine();
        write(chalk.dim(`tool ${status} ${name} (${durationMs}ms)\n`));
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

function writeResult(result: AgentPromptResponse, json: boolean) {
  if (json) {
    process.stdout.write(
      `${JSON.stringify({
        text: result.text,
        usage: result.usage,
        model: result.model,
      })}\n`,
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
  message,
  json,
}: SendCommandOptions): Promise<number> {
  const controller = new AbortController();
  const progress = createProgressRenderer(process.stderr);
  let interrupted = false;

  const handleSigint = () => {
    if (interrupted) {
      return;
    }

    interrupted = true;
    controller.abort();
  };

  process.once("SIGINT", handleSigint);

  try {
    const admission = await connection.send(message, {
      signal: controller.signal,
    });
    let result: AgentPromptResponse;

    try {
      result = await connection.wait(admission, {
        signal: controller.signal,
        onEvent: progress.render,
      });
    } catch (error) {
      progress.finish();
      process.stderr.write(
        `wait failed for agent "${agent}", instance id "${id}", submissionId "${admission.submissionId}"; ` +
          "the durable submission may still be running and can be observed by re-running against the same instance id.\n",
      );
      throw error;
    }

    progress.finish();
    writeResult(result, json);
    return 0;
  } catch (error) {
    progress.finish();
    if (interrupted) {
      return 130;
    }
    throw error;
  } finally {
    process.removeListener("SIGINT", handleSigint);
  }
}
