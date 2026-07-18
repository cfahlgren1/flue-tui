import { describe, expect, it } from "vitest";

import { parseCliArgs } from "../src/cli.js";

describe("parseCliArgs", () => {
  it("uses the local Flue URL by default", () => {
    const args = parseCliArgs(["send", "hello", "--agent", "demo"]);

    expect(args.url).toBe("http://127.0.0.1:3583");
  });

  it("parses repeated headers and preserves equals signs in values", () => {
    const args = parseCliArgs([
      "https://flue.example.test/api",
      "send",
      "hello",
      "--agent",
      "demo",
      "--header",
      "x-tenant=acme",
      "--header",
      "authorization=custom=value",
    ]);

    expect(args.headers).toEqual({
      "x-tenant": "acme",
      authorization: "custom=value",
    });
  });

  it("generates a lowercase base36-style id", () => {
    const args = parseCliArgs(["send", "hello", "--agent", "demo"]);

    expect(args.id).toMatch(/^tui-[a-z0-9]{8}$/);
  });
});
