import { createRequire } from "node:module";

import chalk from "chalk";

import { resolveInvocation, type CliInvocation } from "./args.js";
import { createConnection } from "./client.js";
import { runChatCommand } from "./commands/chat.js";
import { runSendCommand } from "./commands/send.js";
import { sanitizeText } from "./ui/sanitize.js";

const { version: VERSION } = createRequire(import.meta.url)(
  "../package.json",
) as { version: string };

export {
  generateId,
  parseCliArgs,
  resolveInvocation,
  type CliInvocation,
  type ParsedCliArgs,
} from "./args.js";

function printUsage() {
  console.log(`Usage:
  flue-tui [url] --agent <name> [chat options]
  flue-tui [url] send <message> --agent <name> [send options]

Shared options:
  --agent <name>    agent name (required for chat and send)
  --id <id>         persistent agent instance id
  --token <bearer>  bearer token
  --header k=v      additional request header (repeatable)

Chat options:
  --tools <mode>    tool blocks: collapsed, full, or hidden (default: collapsed)

Send options:
  --json            print the final result as JSON

Other options:
  --help, -h
  --version`);
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const optionBoundary = args.indexOf("--");
  const options = optionBoundary === -1 ? args : args.slice(0, optionBoundary);

  if (options.includes("--version")) {
    console.log(VERSION);
    return 0;
  }

  let invocation: CliInvocation;

  try {
    invocation = resolveInvocation(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${chalk.red(`error: ${sanitizeText(message)}`)}\n`);
    return 2;
  }

  try {
    if (invocation.kind === "help") {
      printUsage();
      return 0;
    }

    if (invocation.kind === "chat") {
      return await runChatCommand(invocation);
    }

    return await runSendCommand({
      connection: createConnection({
        url: invocation.url,
        agent: invocation.agent,
        id: invocation.id,
        token: invocation.token,
        headers: invocation.headers,
      }),
      agent: invocation.agent,
      id: invocation.id,
      idProvided: invocation.idProvided,
      message: invocation.message,
      json: invocation.json,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${chalk.red(`error: ${sanitizeText(message)}`)}\n`);
    return 1;
  }
}
