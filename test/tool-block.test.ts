import { describe, expect, it } from "vitest";

import type { ToolPart } from "../src/ui/reconcile.js";
import { ToolBlock } from "../src/ui/tool-block.js";

describe("ToolBlock", () => {
  it("omits a duration for a materialized completed tool", () => {
    const part = {
      type: "dynamic-tool",
      toolCallId: "tool-1",
      toolName: "search",
      state: "output-available",
      input: { query: "cats" },
      output: ["result"],
    } satisfies ToolPart;
    const block = new ToolBlock(part, "collapsed");

    block.update(part);

    expect(block.render(80).join("\n")).toContain("✓ search");
    expect(block.render(80).join("\n")).not.toContain("0ms");
  });

  it("can reveal a tool block that started in hidden mode", () => {
    const part = {
      type: "dynamic-tool",
      toolCallId: "tool-1",
      toolName: "search",
      state: "output-available",
      input: { query: "cats" },
      output: ["result"],
    } satisfies ToolPart;
    const block = new ToolBlock(part, "hidden");

    expect(block.render(80)).toEqual([]);
    block.setDisplayMode("full");
    expect(block.render(80).join("\n")).toContain("search");
    expect(block.render(80).join("\n")).toContain('"query": "cats"');
  });
});
