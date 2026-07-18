import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startMockModel, type MockModelServer } from "./mock-model.js";
import { startDemoServer, type DemoServer } from "./server.js";

const execFileAsync = promisify(execFile);
const describeE2e = process.env.E2E === "1" ? describe : describe.skip;

describeE2e("send against a live flue server", () => {
  let model: MockModelServer;
  let server: DemoServer;

  beforeAll(async () => {
    model = await startMockModel();
    server = await startDemoServer({
      env: {
        ANTHROPIC_API_KEY: "e2e-dummy-key",
        ANTHROPIC_BASE_URL: model.url,
      },
    });
  }, 30_000);

  afterAll(async () => {
    await server?.stop();
    await model?.stop();
  });

  it("runs a tool turn through the real CLI protocol", async () => {
    const id = `e2e-${randomUUID()}`;
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [
        "dist/index.js",
        "demo",
        "roll",
        "--server",
        server.url,
        "--id",
        id,
        "--json",
      ],
      { cwd: process.cwd() },
    );
    const result = JSON.parse(stdout) as Record<string, unknown>;

    expect(result).toMatchObject({
      agent: "demo",
      id,
      text: expect.stringContaining("done rolling:"),
      submissionId: expect.any(String),
      usage: expect.any(Object),
      model: expect.any(Object),
    });
    expect(stderr).toContain("tool roll_dice");
  }, 30_000);
});
