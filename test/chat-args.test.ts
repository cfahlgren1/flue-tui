import { describe, expect, it } from "vitest";

import { resolveInvocation } from "../src/cli.js";

describe("resolveInvocation", () => {
  it("routes a no-subcommand invocation to chat", () => {
    expect(
      resolveInvocation([
        "https://flue.example.test/api",
        "--agent",
        "demo",
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
    expect(
      resolveInvocation(["--agent", "demo", "--tools", "full"]),
    ).toMatchObject({ kind: "chat", tools: "full" });
  });

  it("does not resume chat when the instance id was generated", () => {
    expect(resolveInvocation(["--agent", "demo"])).toMatchObject({
      kind: "chat",
      resume: false,
    });
  });

  it("requires an agent for chat", () => {
    expect(() => resolveInvocation([])).toThrow("chat requires --agent <name>");
  });

  it("keeps send routed separately", () => {
    expect(
      resolveInvocation(["send", "hello", "--agent", "demo", "--id", "one"]),
    ).toMatchObject({
      kind: "send",
      agent: "demo",
      id: "one",
      message: "hello",
    });
  });
});
