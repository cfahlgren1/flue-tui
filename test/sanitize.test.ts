import { describe, expect, it } from "vitest";

import { sanitizeText } from "../src/ui/sanitize.js";

describe("sanitizeText", () => {
  it("strips CSI terminal control sequences", () => {
    expect(sanitizeText("before\u001b[2J\u001b[31mafter")).toBe(
      "beforeafter",
    );
  });

  it("strips OSC 52 clipboard sequences", () => {
    expect(
      sanitizeText("before\u001b]52;c;c2VjcmV0\u0007after"),
    ).toBe("beforeafter");
    expect(
      sanitizeText("before\u001b]52;c;c2VjcmV0\u001b\\after"),
    ).toBe("beforeafter");
  });

  it("strips APC sequences", () => {
    expect(sanitizeText("before\u001b_payload\u001b\\after")).toBe(
      "beforeafter",
    );
  });

  it("strips DCS, SS2, and SS3 sequences", () => {
    expect(sanitizeText("a\u001bPpayload\u001b\\b")).toBe("ab");
    expect(sanitizeText("a\u001bNxb\u001bOyc")).toBe("abc");
  });

  it("keeps newlines and tabs while removing other C0 controls", () => {
    expect(sanitizeText("first\nsecond\tcolumn\u0000\u0008")).toBe(
      "first\nsecond\tcolumn",
    );
  });

  it("leaves plain Unicode text untouched", () => {
    expect(sanitizeText("Hello, 世界 👋 café")).toBe(
      "Hello, 世界 👋 café",
    );
  });
});
