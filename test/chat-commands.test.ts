import { describe, expect, it } from "vitest";

import {
  CHAT_COMMANDS,
  createChatAutocompleteProvider,
  helpLines,
} from "../src/ui/commands.js";

describe("chat commands", () => {
  it("exposes every runtime command to slash autocomplete", async () => {
    expect(CHAT_COMMANDS.map((command) => command.name)).toEqual([
      "help",
      "id",
      "new",
      "abort",
      "exit",
      "tools",
    ]);

    const suggestions = await createChatAutocompleteProvider().getSuggestions(
      ["/"],
      0,
      1,
      { signal: new AbortController().signal },
    );

    expect(suggestions?.items.map((item) => item.value)).toEqual([
      "help",
      "id",
      "new",
      "abort",
      "exit",
      "tools",
    ]);
  });

  it("provides a one-line help description for every command", () => {
    expect(helpLines()).toEqual([
      "/help — show available commands",
      "/id — show the current agent and session id",
      "/new — start a new session",
      "/abort — abort running and queued work for this session",
      "/exit — exit flue-tui",
      "/tools <collapsed|full|hidden> — set the tool display mode",
    ]);
  });
});
