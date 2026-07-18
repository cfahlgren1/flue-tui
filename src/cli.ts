import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";

import chalk from "chalk";

import { createConnection } from "./client.js";
import { runSendCommand } from "./commands/send.js";

const DEFAULT_URL = "http://127.0.0.1:3583";
const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export interface ParsedCliArgs {
  url: string;
  command?: "send";
  message?: string;
  agent?: string;
  id: string;
  token?: string;
  headers: Record<string, string>;
  json: boolean;
  help: boolean;
  version: boolean;
}

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
    },
    strict: true,
  });

  const remaining = [...positionals];
  const url =
    remaining[0] === "send"
      ? DEFAULT_URL
      : (remaining.shift() ?? DEFAULT_URL);
  const command = remaining.shift();

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

  return {
    url,
    command,
    message,
    agent: values.agent,
    id: values.id ?? generateId(),
    token: values.token,
    headers: parseHeaders(values.header),
    json: values.json,
    help: values.help,
    version: values.version,
  };
}

function printUsage() {
  console.log(`Usage:
  flue-tui [url] send <message> --agent <name> [options]

Options:
  --agent <name>    agent name (required for send)
  --id <id>         persistent agent instance id
  --token <bearer>  bearer token
  --header k=v      additional request header (repeatable)
  --json            print the final result as JSON
  --help, -h
  --version`);
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    const parsed = parseCliArgs(args);

    if (parsed.version) {
      console.log("0.0.1");
      return 0;
    }

    if (parsed.help || parsed.command === undefined) {
      printUsage();
      return 0;
    }

    return await runSendCommand({
      connection: createConnection({
        url: parsed.url,
        agent: parsed.agent!,
        id: parsed.id,
        token: parsed.token,
        headers: parsed.headers,
      }),
      message: parsed.message!,
      json: parsed.json,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${chalk.red(`error: ${message}`)}\n`);
    return 1;
  }
}
