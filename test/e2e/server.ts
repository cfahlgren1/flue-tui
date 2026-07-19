import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

import { setTimeout as delay } from "node:timers/promises";

const demoAgentDirectory = fileURLToPath(
  new URL("../../examples/demo-agent/", import.meta.url),
);
const flueCli = fileURLToPath(
  new URL(
    "../../examples/demo-agent/node_modules/@flue/cli/bin/flue.mjs",
    import.meta.url,
  ),
);

export interface DemoServer {
  url: string;
  stop(): Promise<void>;
}

interface DemoServerOptions {
  env?: Record<string, string>;
}

async function waitForHealth(
  child: ChildProcess,
  url: string,
  readLogs: () => string,
) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `flue dev exited with ${child.exitCode ?? child.signalCode} before becoming healthy\n${readLogs()}`,
      );
    }

    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // The process is still starting.
    }
    await delay(100);
  }

  throw new Error(`timed out waiting for ${url}/health\n${readLogs()}`);
}

async function stopChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  child.kill("SIGTERM");
  const timedOut = await Promise.race([
    exited.then(() => false),
    delay(5_000).then(() => true),
  ]);
  if (timedOut && child.exitCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
}

export async function startDemoServer({
  env = {},
}: DemoServerOptions = {}): Promise<DemoServer> {
  const portProbe = createServer();
  await new Promise<void>((resolve, reject) => {
    portProbe.once("error", reject);
    portProbe.listen(0, "127.0.0.1", () => resolve());
  });
  const address = portProbe.address();
  if (address === null || typeof address === "string") {
    portProbe.close();
    throw new Error("port probe did not bind a TCP port");
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    portProbe.close((error) => (error ? reject(error) : resolve())),
  );

  let logs = "";
  const child = spawn(
    process.execPath,
    [flueCli, "dev", "--port", String(port)],
    {
      cwd: demoAgentDirectory,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const capture = (chunk: Buffer) => {
    logs = `${logs}${chunk.toString("utf8")}`.slice(-20_000);
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  const url = `http://127.0.0.1:${port}`;

  try {
    await waitForHealth(child, url, () => logs);
  } catch (error) {
    await stopChild(child);
    throw error;
  }

  let stopped = false;
  return {
    url,
    async stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      await stopChild(child);
    },
  };
}
