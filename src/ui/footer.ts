import type { PromptUsage } from "@flue/sdk";
import {
  truncateToWidth,
  type Component,
} from "@earendil-works/pi-tui";

import { theme } from "./theme.js";

export interface UsageTotals {
  input: number;
  output: number;
  cost: number;
}

export type ChatState = "idle" | "working";

interface StatusFooterOptions {
  agent: string;
  url: string;
  id: string;
  usage: UsageTotals;
  state: ChatState;
}

const tokenNumber = new Intl.NumberFormat("en-US");

export function emptyUsageTotals(): UsageTotals {
  return { input: 0, output: 0, cost: 0 };
}

export function accumulateUsage(
  totals: UsageTotals,
  usage: PromptUsage,
): UsageTotals {
  return {
    input: totals.input + usage.input,
    output: totals.output + usage.output,
    cost: totals.cost + usage.cost.total,
  };
}

export function formatStatusFooter({
  agent,
  url,
  id,
  usage,
  state,
}: StatusFooterOptions): string {
  const host = new URL(url).host;
  return (
    `${agent}@${host} · ${id} · ` +
    `↑ ${tokenNumber.format(usage.input)} ↓ ${tokenNumber.format(usage.output)} · ` +
    `$${usage.cost.toFixed(4)} · ${state}`
  );
}

export class StatusFooter implements Component {
  private options: StatusFooterOptions;

  constructor(options: StatusFooterOptions) {
    this.options = options;
  }

  setId(id: string): void {
    this.options = { ...this.options, id };
  }

  setState(state: ChatState): void {
    this.options = { ...this.options, state };
  }

  recordUsage(usage: PromptUsage): void {
    this.options = {
      ...this.options,
      usage: accumulateUsage(this.options.usage, usage),
    };
  }

  invalidate(): void {}

  render(width: number): string[] {
    return [
      truncateToWidth(theme.muted(formatStatusFooter(this.options)), width),
    ];
  }
}
