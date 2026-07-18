import { describe, expect, it } from "vitest";

import { shouldIgnoreChatInput } from "../src/commands/chat.js";

describe("shouldIgnoreChatInput", () => {
  it.each([
    ["ctrl+c", "\u001b[99;5:3u"],
    ["ctrl+t", "\u001b[116;5:3u"],
    ["escape", "\u001b[27;1:3u"],
  ])("filters a Kitty %s release before shortcut matching", (_key, data) => {
    expect(shouldIgnoreChatInput(data)).toBe(true);
  });

  it("does not filter a Kitty key press", () => {
    expect(shouldIgnoreChatInput("\u001b[99;5:1u")).toBe(false);
  });
});
