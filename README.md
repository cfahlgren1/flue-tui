# flue-tui

talk to your flue agents from the terminal — streaming responses, live tool calls, durable sessions

## Status

Early development.

## Usage

Send a one-shot prompt to an agent. Progress and tool activity stream to
stderr. The final assistant response is written to stdout when output is piped
or redirected; on an interactive terminal, the stream already displays it.

```sh
flue-tui send "roll two dice and tell me the time" --agent demo
```

Pass an explicit Flue URL and persistent instance id when needed:

```sh
flue-tui https://flue.example.com/api send "hello" \
  --agent support \
  --id ticket-42 \
  --token "$FLUE_TOKEN" \
  --header x-tenant=acme \
  --json
```

Set `FLUE_TOKEN` to avoid putting a bearer token in process arguments.
An explicit `--token` value overrides the environment variable.

## Sessions

Flue agent sessions are durable on the server. Start chat with an explicit
instance id to hydrate its existing transcript and continue the conversation:

```sh
flue-tui --agent support --id ticket-42
```

Inside chat, `/id` prints the current agent and instance id, and `/new` clears
the transcript and starts a freshly generated session. Pressing Esc or Ctrl+C
during a busy turn only interrupts the local wait; the agent keeps running on
the server. Use `/abort` to interrupt the local wait and durably abort all
running and queued work for the current session on the server.

## Development

```sh
pnpm install
pnpm dev
```
