#!/usr/bin/env node

import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    help: {
      type: "boolean",
      short: "h",
    },
    version: {
      type: "boolean",
    },
  },
  allowPositionals: true,
});

if (values.version) {
  console.log("0.0.1");
} else {
  console.log(`Usage:
  flue-tui [url] [options]
  flue-tui send <message>

Options:
  --agent <name>
  --id <id>
  --token <bearer>
  --header k=v
  --help, -h
  --version`);
}
