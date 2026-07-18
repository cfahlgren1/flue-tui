import { Container, Spacer, Text } from "@earendil-works/pi-tui";

import { summarize } from "./format.js";
import type { ToolPart } from "./reconcile.js";
import { sanitizeText } from "./sanitize.js";
import { theme } from "./theme.js";

const SUMMARY_MAX_LENGTH = 80;
const MAX_BLOCK_LINES = 40;

export type ToolDisplayMode = "collapsed" | "full" | "hidden";

export interface ToolBlockResult {
  toolName: string;
  ok: boolean;
  output?: unknown;
  errorMessage?: string;
}

function prettyJson(value: unknown): string {
  const seen = new WeakSet<object>();

  try {
    const result = JSON.stringify(
      value,
      (_key, nestedValue: unknown) => {
        if (typeof nestedValue === "string") {
          return sanitizeText(nestedValue);
        }

        if (typeof nestedValue === "bigint") {
          return `${nestedValue}n`;
        }

        if (nestedValue !== null && typeof nestedValue === "object") {
          if (seen.has(nestedValue)) {
            return "[Circular]";
          }
          seen.add(nestedValue);
        }

        return nestedValue;
      },
      2,
    );

    return sanitizeText(result ?? String(value));
  } catch {
    return sanitizeText(String(value));
  }
}

function capLines(lines: string[], maxLines: number): string[] {
  if (lines.length <= maxLines) {
    return lines;
  }

  const hiddenLineCount = lines.length - maxLines + 1;
  return [
    ...lines.slice(0, maxLines - 1),
    `… truncated (${hiddenLineCount} more lines)`,
  ];
}

function jsonSection(
  label: string,
  value: unknown,
  maxLines: number,
): string[] {
  return [label, ...capLines(prettyJson(value).split("\n"), maxLines - 1)];
}

function detailLines(
  input: unknown,
  result: ToolBlockResult | undefined,
): string[] {
  if (result === undefined) {
    return jsonSection("input", input, MAX_BLOCK_LINES - 1);
  }

  const inputLines = jsonSection("input", input, 19);
  if (result.ok) {
    return [...inputLines, ...jsonSection("output", result.output, 20)];
  }

  return [...inputLines, ...jsonSection("error", result.errorMessage, 20)];
}

export class ToolBlock extends Container {
  readonly toolCallId: string;

  private input: unknown;
  private initialToolName: string;
  private displayMode: ToolDisplayMode;
  private result: ToolBlockResult | undefined;

  constructor(part: ToolPart, displayMode: ToolDisplayMode) {
    super();
    this.toolCallId = part.toolCallId;
    this.initialToolName = sanitizeText(part.toolName);
    this.input = part.input;
    this.displayMode = displayMode;
    this.applyPart(part);
  }

  update(part: ToolPart): void {
    this.applyPart(part);
  }

  private applyPart(part: ToolPart): void {
    this.initialToolName = sanitizeText(part.toolName);
    this.input = part.input;
    if (part.state === "input-available") {
      this.result = undefined;
    } else if (part.state === "output-available") {
      this.result = {
        toolName: sanitizeText(part.toolName),
        ok: true,
        output: part.output,
      };
    } else {
      this.result = {
        toolName: sanitizeText(part.toolName),
        ok: false,
        errorMessage: sanitizeText(part.errorText),
      };
    }
    this.rebuild();
  }

  setDisplayMode(displayMode: ToolDisplayMode): void {
    if (this.displayMode === displayMode) {
      return;
    }

    this.displayMode = displayMode;
    this.rebuild();
  }

  private rebuild(): void {
    this.clear();
    if (this.displayMode === "hidden") {
      return;
    }

    this.addChild(new Spacer(1));

    const toolName = this.result?.toolName ?? this.initialToolName;
    if (this.result === undefined) {
      const args =
        this.input === undefined
          ? ""
          : ` ${summarize(this.input, SUMMARY_MAX_LENGTH)}`;
      this.addChild(
        new Text(theme.toolRunning(`◌ tool ${toolName}${args}`), 1, 0),
      );
    } else if (this.result.ok) {
      this.addChild(
        new Text(theme.toolSuccess(`✓ ${toolName}`), 1, 0),
      );
    } else {
      this.addChild(new Text(theme.toolError(`✗ ${toolName}`), 1, 0));
    }

    if (this.displayMode === "full") {
      const lines = detailLines(this.input, this.result);
      const splitAt = lines.indexOf("error");

      if (splitAt === -1) {
        this.addChild(new Text(theme.muted(lines.join("\n")), 1, 0));
      } else {
        this.addChild(
          new Text(theme.muted(lines.slice(0, splitAt).join("\n")), 1, 0),
        );
        this.addChild(
          new Text(theme.toolError(lines.slice(splitAt).join("\n")), 1, 0),
        );
      }
    } else if (this.result?.ok) {
      this.addChild(
        new Text(
          theme.muted(`→ ${summarize(this.result.output, SUMMARY_MAX_LENGTH)}`),
          1,
          0,
        ),
      );
    } else if (this.result !== undefined) {
      this.addChild(
        new Text(
          theme.toolError(
            summarize(this.result.errorMessage, SUMMARY_MAX_LENGTH),
          ),
          1,
          0,
        ),
      );
    }
  }
}
