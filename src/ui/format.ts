import { sanitizeText } from "./sanitize.js";

function truncate(value: string, maxLen: number): string {
  if (maxLen <= 0) {
    return "";
  }

  if (value.length <= maxLen) {
    return value;
  }

  if (maxLen === 1) {
    return "…";
  }

  return `${value.slice(0, maxLen - 1)}…`;
}

function compactString(value: string): string {
  return sanitizeText(value).replace(/\s+/g, " ").trim();
}

function formatPrimitive(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(compactString(value));
  }

  if (typeof value === "bigint") {
    return `${value}n`;
  }

  if (typeof value === "symbol" || typeof value === "function") {
    return String(value);
  }

  return String(value);
}

function formatObject(value: object): string {
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return "{}";
  }

  return entries
    .map(([key, entryValue]) => {
      if (Array.isArray(entryValue)) {
        return `${key}=[${entryValue.length}]`;
      }

      if (entryValue !== null && typeof entryValue === "object") {
        return `${key}={…}`;
      }

      return `${key}=${formatPrimitive(entryValue)}`;
    })
    .join(" ");
}

export function summarize(value: unknown, maxLen: number): string {
  let summary: string;

  if (typeof value === "string") {
    summary = compactString(value);
  } else if (Array.isArray(value)) {
    summary = `[${value.length} ${value.length === 1 ? "item" : "items"}]`;
  } else if (value !== null && typeof value === "object") {
    summary = formatObject(value);
  } else {
    summary = formatPrimitive(value);
  }

  return truncate(sanitizeText(summary), Math.max(0, Math.floor(maxLen)));
}
