import {
  CombinedAutocompleteProvider,
  type AutocompleteItem,
  type SlashCommand,
} from "@earendil-works/pi-tui";

import type { ToolDisplayMode } from "./tool-block.js";

const TOOL_MODES = ["collapsed", "full", "hidden"] as const;

export const CHAT_COMMANDS = [
  { name: "help", description: "show available commands" },
  { name: "id", description: "show the current agent and session id" },
  { name: "new", description: "start a new session" },
  {
    name: "abort",
    description: "abort running and queued work for this session",
  },
  { name: "exit", description: "exit flue-tui" },
  {
    name: "tools",
    argumentHint: "<collapsed|full|hidden>",
    description: "set the tool display mode",
    getArgumentCompletions(argumentPrefix: string): AutocompleteItem[] {
      return TOOL_MODES.filter((mode) => mode.startsWith(argumentPrefix)).map(
        (mode) => ({
          value: mode,
          label: mode,
        }),
      );
    },
  },
] satisfies SlashCommand[];

export function isToolDisplayMode(value: string): value is ToolDisplayMode {
  return TOOL_MODES.some((mode) => mode === value);
}

export function helpLines(): string[] {
  return CHAT_COMMANDS.map((command) => {
    const argumentHint =
      "argumentHint" in command && command.argumentHint
        ? ` ${command.argumentHint}`
        : "";
    return `/${command.name}${argumentHint} — ${command.description}`;
  });
}

export function createChatAutocompleteProvider(
  basePath = process.cwd(),
): CombinedAutocompleteProvider {
  return new CombinedAutocompleteProvider(CHAT_COMMANDS, basePath);
}
