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
  it("requires an agent unless help was requested", () => {
    expect(() => parseCliArgs([])).toThrow("flue-tui <agent>");
    expect(parseCliArgs(["--help"]).help).toBe(true);
  });

  it("uses the local Flue URL by default", () => {
    const args = parseCliArgs(["demo", "hello"]);

    expect(args.url).toBe("http://127.0.0.1:3583");
  });

  it("accepts --server and its -s alias", () => {
    expect(
      parseCliArgs(["demo", "--server", "https://flue.example.test/api"]).url,
    ).toBe("https://flue.example.test/api");
    expect(parseCliArgs(["demo", "-s", "http://localhost:4000"]).url).toBe(
      "http://localhost:4000",
    );
  });

  it("defaults tool blocks to collapsed and accepts full or hidden", () => {
    expect(parseCliArgs(["demo"]).tools).toBe("collapsed");
    expect(parseCliArgs(["demo", "--tools", "full"]).tools).toBe("full");
    expect(parseCliArgs(["demo", "--tools", "hidden"]).tools).toBe("hidden");
  });

  it("rejects invalid tool display modes", () => {
    expect(() => parseCliArgs(["demo", "--tools", "verbose"])).toThrow(
      "expected collapsed, full, or hidden",
    );
  });

  it("parses repeated headers and preserves equals signs in values", () => {
    const args = parseCliArgs([
      "demo",
      "hello",
      "--server",
      "https://flue.example.test/api",
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
    const args = parseCliArgs(["demo", "hello"]);

    expect(args.id).toMatch(/^tui-[a-z0-9]{8}$/);
  });

  it("uses FLUE_TOKEN when --token is omitted", () => {
    vi.stubEnv("FLUE_TOKEN", "env-secret");

    const args = parseCliArgs(["demo", "hello"]);

    expect(args.token).toBe("env-secret");
  });

  it("prefers --token over FLUE_TOKEN", () => {
    vi.stubEnv("FLUE_TOKEN", "env-secret");

    const args = parseCliArgs(["demo", "hello", "--token", "cli-secret"]);

    expect(args.token).toBe("cli-secret");
  });

  it.each(["not-a-url", "ftp://flue.example.test", "file:///tmp/flue.sock"])(
    "rejects the invalid URL %s",
    (url) => {
      expect(() => parseCliArgs(["demo", "--server", url])).toThrow(
        /http\(s\) URL/,
      );
    },
  );

  it.each([
    "https://user@flue.example.test",
    "https://user:secret@flue.example.test",
    "https://:secret@flue.example.test",
  ])("rejects URL credentials in %s", (url) => {
    expect(() => parseCliArgs(["demo", "--server", url])).toThrow(
      "must not include credentials",
    );
  });

  it("rejects empty agent and instance ids", () => {
    expect(() => parseCliArgs([""])).toThrow("agent cannot be empty");
    expect(() => parseCliArgs(["demo", "hello", "--id", ""])).toThrow(
      "--id cannot be empty",
    );
  });

  it("rejects more than two positionals", () => {
    expect(() => parseCliArgs(["demo", "hello", "extra"])).toThrow(
      "accepts at most two positional arguments",
    );
  });

  it("rejects the removed --agent option", () => {
    expect(() => parseCliArgs(["demo", "--agent", "other"])).toThrow(
      "Unknown option '--agent'",
    );
  });
});

describe("main", () => {
  it.each([
    ["unknown option", ["--unknown"]],
    ["too many positionals", ["demo", "hello", "extra"]],
    ["invalid URL", ["demo", "--server", "not-a-url"]],
    ["URL credentials", ["demo", "--server", "https://user:secret@flue.test"]],
    ["chat --json", ["demo", "--json"]],
    ["send --tools", ["demo", "hello", "--tools", "full"]],
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
    expect(log.mock.calls[0]?.[0]).toContain("flue-tui <agent> [chat options]");
    expect(log.mock.calls[0]?.[0]).toContain(
      "flue-tui <agent> <message> [send options]",
    );
    expect(log.mock.calls[0]?.[0]).toContain("--server <url>, -s <url>");
    expect(log.mock.calls[0]?.[0]).not.toContain("--agent");
  });

  it("prints the demo quickstart when chat has no agent", async () => {
    const write = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(main([])).resolves.toBe(2);
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0]?.[0]).toContain(
      "cd examples/demo-agent && npm run dev; then flue-tui demo",
    );
  });

  it("does not echo URL credentials in usage errors", async () => {
    const write = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(
      main(["demo", "--server", "https://user:secret@flue.test"]),
    ).resolves.toBe(2);
    expect(String(write.mock.calls[0]?.[0])).not.toContain("secret");
  });
});
