# flue-tui

Talk to Flue agents from the terminal with streaming Markdown responses, live
tool calls, durable sessions, slash commands, and token/cost tracking.

## Requirements

- Node.js 22.19 or newer
- A running Flue application with an exposed agent

## Install

Install the CLI from npm:

```sh
npm install --global flue-tui
```

To install this checkout instead:

```sh
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm build
pnpm link --global
```

## Quickstart

The included demo agent runs locally on port 3583. In one terminal:

```sh
cd examples/demo-agent
npm install
export ANTHROPIC_API_KEY=your-key
npm run dev
```

In another terminal, start an interactive chat:

```sh
flue-tui --agent demo
```

Enter submits a message. The last line shows the connection target, session
id, cumulative input/output tokens and cost, and whether the client is idle or
working. Type `/help` for the in-chat command list or `/exit` to leave.

## Usage

Start an interactive chat against the default local URL:

```sh
flue-tui --agent demo
```

Pass a Flue base URL as the first positional argument for a remote app:

```sh
flue-tui https://flue.example.com/api --agent support --id ticket-42
```

Send one prompt without opening the TUI:

```sh
flue-tui send "roll two dice and tell me the time" --agent demo
```

The one-shot command streams progress and tool activity to stderr. Its final
assistant response is written to stdout when output is piped or redirected;
use `--json` for the response text, identity, model, and usage as JSON.

```sh
flue-tui https://flue.example.com/api send "hello" \
  --agent support \
  --id ticket-42 \
  --token "$FLUE_TOKEN" \
  --header x-tenant=acme \
  --json
```

### Flags

| Flag | Applies to | Description |
| --- | --- | --- |
| `[url]` | chat, send | Flue base URL; defaults to `http://127.0.0.1:3583` |
| `--agent <name>` | chat, send | Agent name; required |
| `--id <id>` | chat, send | Persistent agent session id; chat resumes when supplied |
| `--token <bearer>` | chat, send | Bearer token; overrides `FLUE_TOKEN` |
| `--header k=v` | chat, send | Additional request header; repeat for multiple headers |
| `--tools <mode>` | chat | Initial tool display: `collapsed`, `full`, or `hidden` |
| `--json` | send | Print the final one-shot result as JSON |
| `--help`, `-h` | all | Show CLI usage |
| `--version` | all | Print the installed version |

### Chat commands

| Command | Description |
| --- | --- |
| `/help` | Show available commands with descriptions |
| `/id` | Show the current agent and session id |
| `/new` | Start a new generated session and clear the transcript |
| `/abort` | Abort running and queued server-side work for this session |
| `/exit` | Exit flue-tui |
| `/tools <collapsed\|full\|hidden>` | Change the tool display mode at runtime |

Type `/` to open slash autocomplete. Tab accepts a command completion and also
completes file paths where pi-tui supports them.

## Keybindings

| Key | Action |
| --- | --- |
| Enter | Submit the editor contents |
| Alt+Enter | Insert a newline; Shift+Enter and Ctrl+Enter also work when the terminal reports them distinctly |
| Tab | Accept autocomplete or complete a file path |
| Esc | Interrupt the local wait for a busy turn; the agent keeps running server-side |
| Ctrl+T | Toggle tool blocks between collapsed and full; hidden mode remains hidden |
| Ctrl+C while working | Interrupt the local wait; the agent keeps running server-side |
| Ctrl+C with editor text | Clear the editor |
| Ctrl+C with an empty idle editor | Exit flue-tui |

## Sessions

Flue agent sessions are durable on the server. Without `--id`, flue-tui creates
and displays a new id. Supply an existing id to hydrate its transcript and
continue the conversation:

```sh
flue-tui --agent support --id ticket-42
```

`/new` switches to a freshly generated id. The previous session remains on the
server and can be resumed later with `--id`. Esc and Ctrl+C only stop the local
wait during a turn; use `/abort` when the server-side work itself should stop.

If the wait stream disconnects after a submission is admitted, flue-tui keeps
the durable recovery notice visible and performs one history refresh after two
seconds. A completed response found by that refresh is rendered with a dim
`(recovered)` marker.

## Environment variables

| Variable | Description |
| --- | --- |
| `FLUE_TOKEN` | Default bearer token for the CLI when `--token` is omitted |
| `ANTHROPIC_API_KEY` | Anthropic API key used by the demo agent |
| `ANTHROPIC_BASE_URL` | Optional Anthropic-compatible gateway or proxy URL for the demo |
| `DEMO_AGENT_MODEL` | Optional demo model override; defaults to `anthropic/claude-haiku-4-5` |

## Development

```sh
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```
