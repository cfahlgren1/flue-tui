import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import { setTimeout as delay } from "node:timers/promises";

interface AnthropicRequest {
  messages?: unknown;
  model?: string;
  stream?: boolean;
}

export interface MockModelServer {
  url: string;
  stop(): Promise<void>;
}

function findToolResult(value: unknown): unknown {
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findToolResult(item);
      if (result !== undefined) {
        return result;
      }
    }
    return undefined;
  }

  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (record.type === "tool_result") {
    return record.content;
  }

  for (const item of Object.values(record)) {
    const result = findToolResult(item);
    if (result !== undefined) {
      return result;
    }
  }
  return undefined;
}

function echoToolResult(result: unknown): string {
  return typeof result === "string" ? result : JSON.stringify(result);
}

function latestMessage(messages: unknown): unknown {
  return Array.isArray(messages) ? messages.at(-1) : messages;
}

function toolCallId(messages: unknown): string {
  return `tool-e2e-roll-${Array.isArray(messages) ? messages.length : 1}`;
}

function responseContent(request: AnthropicRequest) {
  const toolResult = findToolResult(latestMessage(request.messages));
  if (toolResult === undefined) {
    return {
      content: [
        {
          type: "tool_use" as const,
          id: toolCallId(request.messages),
          name: "roll_dice",
          input: { sides: 6, count: 1 },
        },
      ],
      stopReason: "tool_use",
    };
  }

  return {
    content: [
      {
        type: "text" as const,
        text: `done rolling: ${echoToolResult(toolResult)}`,
      },
    ],
    stopReason: "end_turn",
  };
}

function writeJson(response: ServerResponse, request: AnthropicRequest) {
  const result = responseContent(request);
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      id: "msg_e2e",
      type: "message",
      role: "assistant",
      model: request.model ?? "claude-haiku-4-5",
      content: result.content,
      stop_reason: result.stopReason,
      stop_sequence: null,
      usage: { input_tokens: 3, output_tokens: 5 },
    }),
  );
}

function writeSseEvent(
  response: ServerResponse,
  event: string,
  data: unknown,
) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function writeStream(response: ServerResponse, request: AnthropicRequest) {
  const result = responseContent(request);
  response.writeHead(200, {
    "cache-control": "no-cache",
    connection: "keep-alive",
    "content-type": "text/event-stream",
  });
  writeSseEvent(response, "message_start", {
    type: "message_start",
    message: {
      id: "msg_e2e",
      type: "message",
      role: "assistant",
      model: request.model ?? "claude-haiku-4-5",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 3, output_tokens: 0 },
    },
  });

  const block = result.content[0]!;
  if (block.type === "tool_use") {
    writeSseEvent(response, "content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: {},
      },
    });
    writeSseEvent(response, "content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: {
        type: "input_json_delta",
        partial_json: JSON.stringify(block.input),
      },
    });
  } else {
    writeSseEvent(response, "content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    });
    writeSseEvent(response, "content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: block.text },
    });
  }

  writeSseEvent(response, "content_block_stop", {
    type: "content_block_stop",
    index: 0,
  });
  writeSseEvent(response, "message_delta", {
    type: "message_delta",
    delta: { stop_reason: result.stopReason, stop_sequence: null },
    usage: { output_tokens: 5 },
  });
  writeSseEvent(response, "message_stop", { type: "message_stop" });
  response.end();
}

async function readRequest(request: IncomingMessage): Promise<AnthropicRequest> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as AnthropicRequest;
}

export async function startMockModel(): Promise<MockModelServer> {
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/messages") {
      response.writeHead(404).end();
      return;
    }

    try {
      const body = await readRequest(request);
      const isDelayedTurn =
        findToolResult(latestMessage(body.messages)) === undefined &&
        JSON.stringify(latestMessage(body.messages)).includes("delay");
      if (isDelayedTurn) {
        await delay(750);
      }
      if (body.stream) {
        writeStream(response, body);
      } else {
        writeJson(response, body);
      }
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          type: "error",
          error: {
            type: "api_error",
            message: error instanceof Error ? error.message : String(error),
          },
        }),
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("mock model did not bind a TCP port");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    async stop() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
