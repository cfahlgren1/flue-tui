import { createRequire } from "node:module";

import { afterEach, describe, expect, it, vi } from "vitest";

import { main, parseCliArgs } from "../src/cli.js";

const { version } = createRequire(import.meta.url)("../package.json") as {
  version: string;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("parseCliArgs", () => {
  it("uses the local Flue URL by default", () => {
    const args = parseCliArgs(["send", "hello", "--agent", "demo"]);

    expect(args.url).toBe("http://127.0.0.1:3583");
  });

  it("defaults tool blocks to collapsed and accepts full or hidden", () => {
    expect(parseCliArgs(["--agent", "demo"]).tools).toBe("collapsed");
    expect(parseCliArgs(["--agent", "demo", "--tools", "full"]).tools).toBe(
      "full",
    );
    expect(parseCliArgs(["--agent", "demo", "--tools", "hidden"]).tools).toBe(
      "hidden",
    );
  });

  it("rejects invalid tool display modes", () => {
    expect(() =>
      parseCliArgs(["--agent", "demo", "--tools", "verbose"]),
    ).toThrow("expected collapsed, full, or hidden");
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

  it("uses FLUE_TOKEN when --token is omitted", () => {
    vi.stubEnv("FLUE_TOKEN", "env-secret");

    const args = parseCliArgs(["send", "hello", "--agent", "demo"]);

    expect(args.token).toBe("env-secret");
  });

  it("prefers --token over FLUE_TOKEN", () => {
    vi.stubEnv("FLUE_TOKEN", "env-secret");

    const args = parseCliArgs([
      "send",
      "hello",
      "--agent",
      "demo",
      "--token",
      "cli-secret",
    ]);

    expect(args.token).toBe("cli-secret");
  });

  it.each(["not-a-url", "ftp://flue.example.test", "file:///tmp/flue.sock"])(
    "rejects the invalid URL %s",
    (url) => {
      expect(() =>
        parseCliArgs([url, "send", "hello", "--agent", "demo"]),
      ).toThrow(/http\(s\) URL/);
    },
  );

  it("rejects empty agent and instance ids", () => {
    expect(() => parseCliArgs(["send", "hello", "--agent", ""])).toThrow(
      "--agent cannot be empty",
    );
    expect(() =>
      parseCliArgs(["send", "hello", "--agent", "demo", "--id", ""]),
    ).toThrow("--id cannot be empty");
  });

  it("rejects extra send positionals", () => {
    expect(() =>
      parseCliArgs(["send", "hello", "extra", "--agent", "demo"]),
    ).toThrow("send accepts exactly one message argument");
  });
});

describe("main", () => {
  it.each([
    ["unknown option", ["--unknown"]],
    ["missing send message", ["send", "--agent", "demo"]],
    ["invalid URL", ["not-a-url", "send", "hello", "--agent", "demo"]],
    ["chat --json", ["--agent", "demo", "--json"]],
    [
      "send --tools",
      ["send", "hello", "--agent", "demo", "--tools", "full"],
    ],
  ])("returns exit code 2 for %s", async (_name, args) => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(main(args)).resolves.toBe(2);
  });

  it("prints the package version regardless of other arguments", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(main(["--unknown", "--version"])).resolves.toBe(0);
    expect(log).toHaveBeenCalledWith(version);
  });

  it("shows help without requiring an agent", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(main(["--help"])).resolves.toBe(0);
    expect(log).toHaveBeenCalledOnce();
  });

  it("prints the demo quickstart when chat has no agent", async () => {
    const write = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(main([])).resolves.toBe(2);
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0]?.[0]).toContain(
      "cd examples/demo-agent && npm run dev; then flue-tui --agent demo",
    );
  });
});
