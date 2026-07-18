# flue-tui

flue-tui is an interactive terminal chat client for any [Flue](https://flueframework.com) agent. It renders streaming responses and thinking, updates live tool-call blocks in place, resumes durable sessions, and keeps cumulative token usage and cost visible in the footer.

> Status: beta.

## Requirements

- Node.js 22.19 or newer
- A running Flue application with an exposed agent

## Install and run

From this checkout:

```sh
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm build
node dist/index.js --help
```

Once the package is published, the equivalent one-off invocation will be:

```sh
npx flue-tui --agent demo
```

flue-tui is not yet published to npm.

## Quickstart

The included demo agent runs on `http://127.0.0.1:3583`. Start it in one terminal with either a direct Anthropic API key or an Anthropic-compatible gateway override:

```sh
cd examples/demo-agent
npm install

# Direct Anthropic access:
export ANTHROPIC_API_KEY=your-key

# Or use a gateway:
# export ANTHROPIC_BASE_URL=https://your-gateway.example

npm run dev
```

From the repository root in a second terminal:

```sh
node dist/index.js --agent demo
```

Send a message with Enter. The footer shows the target, session id, cumulative input and output tokens, cost, and current state.

## Command-line reference

```text
flue-tui [url] --agent <name> [chat options]
flue-tui [url] send <message> --agent <name> [send options]
```

`[url]` defaults to `http://127.0.0.1:3583` and must appear before `send`. The one-shot `send` command streams response, thinking, and tool progress to stderr. It writes the final response to stdout when stdout is piped or redirected; `--json` always writes structured output.

| Flag | Chat | Send | Description |
| --- | :---: | :---: | --- |
| `[url]` | Yes | Yes | Flue base URL; defaults to `http://127.0.0.1:3583` |
| `--agent <name>` | Yes | Yes | Agent name; required |
| `--id <id>` | Yes | Yes | Durable server-side session id; resumes that session when supplied |
| `--token <bearer>` | Yes | Yes | Bearer token; overrides `FLUE_TOKEN` |
| `--header k=v` | Yes | Yes | Additional request header; repeat for multiple headers |
| `--tools <mode>` | Yes | No | Initial tool display: `collapsed`, `full`, or `hidden`; defaults to `collapsed` |
| `--json` | No | Yes | Write the final text, identity, model, and usage as JSON |
| `--help`, `-h` | Yes | Yes | Show usage |
| `--version` | Yes | Yes | Print the installed version |

| Environment variable | Description |
| --- | --- |
| `FLUE_TOKEN` | Default bearer token when `--token` is omitted |

| Exit code | Meaning |
| ---: | --- |
| `0` | Success or a normal interactive exit |
| `1` | Runtime, network, or agent error |
| `2` | Invalid command-line usage |
| `130` | One-shot `send` interrupted with Ctrl+C |

## Keybindings and slash commands

| Key | Action |
| --- | --- |
| Enter | Submit the editor contents; non-command submissions are ignored while a turn is active |
| Alt+Enter | Insert a newline |
| Up / Down | Move through submitted message history |
| Ctrl+C while working | Interrupt the local wait; the agent keeps running server-side |
| Ctrl+C with editor text | Clear the editor |
| Ctrl+C with an empty, idle editor | Exit flue-tui |
| Esc while working | Interrupt the local wait; the agent keeps running server-side |
| Ctrl+T | Toggle tool blocks between collapsed and full; hidden mode remains hidden |

| Command | Action |
| --- | --- |
| `/help` | Show the available slash commands |
| `/id` | Show the current agent and session id |
| `/new` | Switch to a new generated session and clear the transcript |
| `/abort` | Abort running and queued server-side work for the current session |
| `/tools <collapsed\|full\|hidden>` | Change the tool display mode |
| `/exit` | Exit flue-tui |

## Sessions

Flue sessions are durable on the server. Without `--id`, flue-tui generates and displays a new id. Supply an existing id to hydrate its transcript and continue the conversation:

```sh
node dist/index.js --agent support --id ticket-42
```

`/new` switches to a fresh id and clears the local transcript. The previous session remains on the server and can be resumed later with `--id`.

Esc and Ctrl+C during an active turn interrupt only the local wait; server-side work continues. Use `/abort` to abort running and queued work for the current server session. If an admitted submission's wait stream disconnects, flue-tui keeps a recovery notice visible and performs one history refresh after two seconds; a completed response found there is rendered with a dim `(recovered)` marker.

## Architecture

`@earendil-works/pi-tui` provides terminal rendering and input. `@flue/sdk`'s `observe({ live: "sse" })` stream is the canonical transcript: the reconciler maps each text, reasoning, and tool part to a stable block, updates changed parts in place, and replaces the transcript only when its identity or structure changes.

```text
agent server --observe() SSE--> reconciler --> pi-tui blocks
input editor ------send()-----> submission --> wait() --> usage footer
```

This keeps rendering derived from durable server state instead of maintaining a separate client-side transcript.

## Development

```sh
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

| Script | Purpose |
| --- | --- |
| `pnpm dev --agent demo` | Run the CLI directly from TypeScript |
| `pnpm typecheck` | Type-check without emitting files |
| `pnpm test` | Run unit tests; E2E suites remain skipped unless `E2E=1` |
| `pnpm build` | Compile the executable to `dist/` |
| `E2E=1 pnpm test:e2e` | Run the serial end-to-end suites against the demo server and mock model |

GitHub Actions runs three jobs on pushes and pull requests:

| Job | Checks |
| --- | --- |
| `ci` | Install, type-check, unit tests, build, and built CLI version smoke test |
| `demo-agent` | Install and type-check `examples/demo-agent` |
| `e2e` | Build the CLI and run the E2E suites with `E2E=1` |
