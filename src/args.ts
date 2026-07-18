import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";

import type { ToolDisplayMode } from "./ui/tool-block.js";

const DEFAULT_URL = "http://127.0.0.1:3583";
const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export interface ParsedCliArgs {
  url: string;
  command?: "send";
  message?: string;
  agent?: string;
  id: string;
  idProvided: boolean;
  token?: string;
  headers: Record<string, string>;
  json: boolean;
  tools: ToolDisplayMode;
  help: boolean;
  version: boolean;
}

export type CliInvocation =
  | { kind: "help" }
  | {
      kind: "chat";
      url: string;
      agent: string;
      id: string;
      resume: boolean;
      token?: string;
      headers: Record<string, string>;
      tools: ToolDisplayMode;
    }
  | {
      kind: "send";
      url: string;
      agent: string;
      id: string;
      idProvided: boolean;
      token?: string;
      headers: Record<string, string>;
      message: string;
      json: boolean;
    };

export function generateId(): string {
  const bytes = randomBytes(8);
  let suffix = "";

  for (const byte of bytes) {
    suffix += ID_ALPHABET[byte % ID_ALPHABET.length];
  }

  return `tui-${suffix}`;
}

function parseHeaders(values: string[] | undefined): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const value of values ?? []) {
    const separator = value.indexOf("=");
    const key = value.slice(0, separator).trim();

    if (separator < 1 || key.length === 0) {
      throw new Error(`invalid header "${value}": expected k=v`);
    }

    headers[key] = value.slice(separator + 1);
  }

  return headers;
}

function validateUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`invalid URL "${value}": expected an http(s) URL`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`invalid URL "${value}": expected an http(s) URL`);
  }

  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error("invalid URL: must not include credentials");
  }

  return value;
}

export function parseCliArgs(args: string[]): ParsedCliArgs {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      agent: { type: "string" },
      id: { type: "string" },
      token: { type: "string" },
      header: { type: "string", multiple: true },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", default: false },
      tools: { type: "string", default: "collapsed" },
    },
    strict: true,
  });

  const remaining = [...positionals];
  const url = validateUrl(
    remaining[0] === "send" ? DEFAULT_URL : (remaining.shift() ?? DEFAULT_URL),
  );
  const command = remaining.shift();
  const toolsProvided = args.some(
    (arg) => arg === "--tools" || arg.startsWith("--tools="),
  );

  if (command !== undefined && command !== "send") {
    throw new Error(`unknown command "${command}"`);
  }

  const message = remaining.shift();
  if (remaining.length > 0) {
    throw new Error("send accepts exactly one message argument");
  }

  if (command === "send" && message === undefined && !values.help) {
    throw new Error("send requires a message");
  }

  if (command === "send" && values.agent === undefined && !values.help) {
    throw new Error("send requires --agent <name>");
  }

  if (command === "send" && toolsProvided) {
    throw new Error("--tools is only available for chat");
  }

  if (command === undefined && values.json) {
    throw new Error("--json is only available for send");
  }

  if (values.agent !== undefined && values.agent.trim().length === 0) {
    throw new Error("--agent cannot be empty");
  }

  if (values.id !== undefined && values.id.trim().length === 0) {
    throw new Error("--id cannot be empty");
  }

  if (
    !(["collapsed", "full", "hidden"] as const).includes(
      values.tools as ToolDisplayMode,
    )
  ) {
    throw new Error(
      `invalid --tools value "${values.tools}": expected collapsed, full, or hidden`,
    );
  }

  return {
    url,
    command,
    message,
    agent: values.agent,
    id: values.id ?? generateId(),
    idProvided: values.id !== undefined,
    token: values.token ?? process.env.FLUE_TOKEN,
    headers: parseHeaders(values.header),
    json: values.json,
    tools: values.tools as ToolDisplayMode,
    help: values.help,
    version: values.version,
  };
}

export function resolveInvocation(args: string[]): CliInvocation {
  const parsed = parseCliArgs(args);

  if (parsed.help) {
    return { kind: "help" };
  }

  if (parsed.command === "send") {
    return {
      kind: "send",
      url: parsed.url,
      agent: parsed.agent!,
      id: parsed.id,
      idProvided: parsed.idProvided,
      token: parsed.token,
      headers: parsed.headers,
      message: parsed.message!,
      json: parsed.json,
    };
  }

  if (parsed.agent === undefined) {
    throw new Error(
      "chat requires --agent <name>; quickstart: " +
        "cd examples/demo-agent && npm run dev; then flue-tui --agent demo",
    );
  }

  return {
    kind: "chat",
    url: parsed.url,
    agent: parsed.agent,
    id: parsed.id,
    resume: parsed.idProvided,
    token: parsed.token,
    headers: parsed.headers,
    tools: parsed.tools,
  };
}
