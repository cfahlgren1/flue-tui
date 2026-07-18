import { describe, expect, it } from "vitest";

import { summarize } from "../src/ui/format.js";

describe("summarize", () => {
  it("returns short strings unchanged", () => {
    expect(summarize("hello", 80)).toBe("hello");
  });

  it("truncates long strings with an ellipsis", () => {
    expect(summarize("abcdefghij", 6)).toBe("abcde…");
  });

  it("formats primitive object properties as key=value pairs", () => {
    expect(summarize({ query: "cats", limit: 5, exact: true }, 80)).toBe(
      'query="cats" limit=5 exact=true',
    );
  });

  it("uses compact placeholders for nested values", () => {
    expect(summarize({ filter: { active: true }, ids: [1, 2, 3] }, 80)).toBe(
      "filter={…} ids=[3]",
    );
  });

  it("summarizes top-level arrays by length", () => {
    expect(summarize(["a", "b", "c"], 80)).toBe("[3 items]");
  });

  it("handles null and undefined", () => {
    expect(summarize(null, 80)).toBe("null");
    expect(summarize(undefined, 80)).toBe("undefined");
  });

  it("collapses whitespace to keep summaries on one line", () => {
    expect(summarize({ message: "first\n  second" }, 80)).toBe(
      'message="first second"',
    );
  });

  it("respects the total character budget", () => {
    const summary = summarize(
      { query: "a long search query", path: "/a/long/path/to/a/file" },
      24,
    );

    expect(summary).toHaveLength(24);
    expect(summary.endsWith("…")).toBe(true);
  });
});
