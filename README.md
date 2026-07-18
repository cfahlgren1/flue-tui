# flue-tui

talk to your flue agents from the terminal — streaming responses, live tool calls, durable sessions

## Status

Early development.

## Usage

Send a one-shot prompt to an agent. Progress and tool activity stream to
stderr; the final assistant response is written to stdout.

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

## Development

```sh
pnpm install
pnpm dev
```
