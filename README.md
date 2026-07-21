# flue-tui

An interactive terminal chat for any [Flue](https://flueframework.com) agent — streaming responses and thinking, live tool-call blocks, durable sessions you can resume, and a token/cost footer.

![flue-tui demo](https://raw.githubusercontent.com/cfahlgren1/flue-tui/main/demo.gif)

## Quick start

Run it once without installing:

```sh
npx flue-tui@latest demo
```

Or with pnpm:

```sh
pnpm dlx flue-tui@latest demo
```

`demo` is the Flue agent name; replace it with the agent your app exports. Without `--server`, every invocation connects to `http://127.0.0.1:3583`. Pass `--server https://your-app.example` to connect elsewhere.

Install it globally if you use it regularly:

```sh
npm install --global flue-tui
flue-tui demo
```

Requires Node.js 22.19+ and a running Flue app with an agent that exports `route`.

## Use

```sh
flue-tui demo                                              # chat (server defaults to http://127.0.0.1:3583)
flue-tui support --server https://my-app.dev --id ticket-42 # resume a durable session
flue-tui support "what changed today?" --json              # one-shot, pipe-friendly
```

For authenticated agents set `FLUE_TOKEN` (or `--token` / repeatable `--header k=v`). `--tools collapsed|full|hidden` controls tool-call display.

**In chat:** Enter sends, Shift+Enter inserts a newline, Up/Down recall history, Ctrl+T expands tool blocks. Esc or Ctrl+C interrupts your local wait — admitted work keeps running server-side; `/abort` stops it for real. Commands: `/help` `/id` `/new` `/abort` `/tools` `/exit`.

**Sessions** are durable on the Flue server and addressed by `--id`. Without one, flue-tui generates an id and shows it so you can come back. Resuming hydrates the transcript — even if the agent is still mid-answer, the response streams in.

## Try it with the bundled demo agent

```sh
cd examples/demo-agent && npm install
export ANTHROPIC_API_KEY=your-key   # or ANTHROPIC_BASE_URL for a gateway
npm run dev                          # serves the demo agent on :3583
```

Then in another terminal: `flue-tui demo`.

## How it works

`@earendil-works/pi-tui` renders; `@flue/sdk`'s `observe({ live: "sse" })` stream is the canonical transcript. A reconciler maps each text, reasoning, and tool part to a stable block and updates it in place — rendering is always derived from durable server state, never a separate client transcript.

## Development

```sh
corepack enable pnpm && pnpm install --frozen-lockfile
pnpm format                    # format source and configuration
pnpm check                     # format check, lint, types, unit tests, and build
E2E=1 pnpm test:e2e            # boots the demo agent against a mock model server
```

Apache-2.0.
