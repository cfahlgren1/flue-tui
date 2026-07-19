import { describe, expect, it } from "vitest";

import { resolveInvocation } from "../src/cli.js";

describe("resolveInvocation", () => {
  it("routes a no-subcommand invocation to chat", () => {
    expect(
      resolveInvocation([
        "demo",
        "--server",
        "https://flue.example.test/api",
        "--id",
        "instance-1",
        "--token",
        "secret",
        "--header",
        "x-tenant=acme",
      ]),
    ).toEqual({
      kind: "chat",
      url: "https://flue.example.test/api",
      agent: "demo",
      id: "instance-1",
      resume: true,
      token: "secret",
      headers: { "x-tenant": "acme" },
      tools: "collapsed",
    });
  });

  it("passes the initial tool display mode to chat", () => {
    expect(resolveInvocation(["demo", "--tools", "full"])).toMatchObject({
      kind: "chat",
      tools: "full",
    });
  });

  it("does not resume chat when the instance id was generated", () => {
    expect(resolveInvocation(["demo"])).toMatchObject({
      kind: "chat",
      resume: false,
    });
  });

  it("requires an agent for chat", () => {
    expect(() => resolveInvocation([])).toThrow("flue-tui <agent>");
  });

  it("routes a second positional to send", () => {
    expect(resolveInvocation(["demo", "hello", "--id", "one"])).toMatchObject({
      kind: "send",
      agent: "demo",
      id: "one",
      message: "hello",
    });
  });

  it("treats an empty second positional as send mode", () => {
    expect(resolveInvocation(["demo", ""])).toMatchObject({
      kind: "send",
      agent: "demo",
      message: "",
    });
  });

  it("rejects --json for chat", () => {
    expect(() => resolveInvocation(["demo", "--json"])).toThrow(
      "--json is only available for send",
    );
  });

  it("rejects --tools for send", () => {
    expect(() =>
      resolveInvocation(["demo", "hello", "--tools", "full"]),
    ).toThrow("--tools is only available for chat");
  });
});
