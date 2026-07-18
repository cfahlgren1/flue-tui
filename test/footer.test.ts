import { visibleWidth } from "@earendil-works/pi-tui";
import type { PromptUsage } from "@flue/sdk";
import { describe, expect, it } from "vitest";

import {
  accumulateUsage,
  emptyUsageTotals,
  formatStatusFooter,
  StatusFooter,
} from "../src/ui/footer.js";

function usage(
  input: number,
  output: number,
  totalCost: number,
): PromptUsage {
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + output,
    cost: {
      input: totalCost,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: totalCost,
    },
  };
}

describe("status footer", () => {
  it("accumulates input, output, and total cost across turns", () => {
    const first = accumulateUsage(emptyUsageTotals(), usage(1_000, 200, 0.01));
    const second = accumulateUsage(first, usage(234, 56, 0.0023));

    expect(second).toEqual({ input: 1_234, output: 256, cost: 0.0123 });
  });

  it("formats the connection, session, token flow, cost, and state", () => {
    expect(
      formatStatusFooter({
        agent: "demo",
        url: "http://127.0.0.1:3583/api",
        id: "tui-test",
        usage: { input: 1_234, output: 256, cost: 0.0123 },
        state: "working",
      }),
    ).toBe(
      "demo@127.0.0.1:3583 · tui-test · ↑ 1,234 ↓ 256 · $0.0123 · working",
    );
  });

  it("renders as one dimmed line truncated to the available width", () => {
    const footer = new StatusFooter({
      agent: "demo",
      url: "http://127.0.0.1:3583",
      id: "tui-long-session-id",
      usage: { input: 1_234, output: 256, cost: 0.0123 },
      state: "idle",
    });

    const lines = footer.render(32);

    expect(lines).toHaveLength(1);
    expect(visibleWidth(lines[0]!)).toBeLessThanOrEqual(32);
    expect(lines[0]).toContain("\u001b[");
  });
});
