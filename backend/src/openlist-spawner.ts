import { spawn, ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

export type OpenListSpawnOptions = {
  binaryPath: string;
  dataDir: string;
  port: number;
};

/**
 * Launch the bundled OpenList Go binary as a child process.
 * Returns the ChildProcess so the caller can cleanup on SIGTERM.
 */
export function spawnOpenList(opts: OpenListSpawnOptions): ChildProcess {
  const { binaryPath, dataDir, port } = opts;
  if (!existsSync(binaryPath)) {
    throw new Error(
      `openlist binary not found at ${binaryPath} — run \`npm run fetch:openlist\``,
    );
  }

  mkdirSync(resolve(dataDir), { recursive: true });

  const args = ["server", "--data", resolve(dataDir)];
  const child = spawn(binaryPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      // OpenList reads config from its data dir; port override happens via its
      // generated config.json on first run. For first run we leave the default
      // 5244 — user can adjust in OpenList admin UI later.
    },
  });

  child.stdout?.on("data", (chunk: Buffer) => {
    process.stdout.write(`[openlist] ${chunk.toString()}`);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(`[openlist] ${chunk.toString()}`);
  });
  child.on("exit", (code, signal) => {
    console.log(`[openlist] exited code=${code} signal=${signal}`);
  });

  // Best-effort cleanup
  const cleanup = () => {
    if (!child.killed) child.kill("SIGTERM");
  };
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);
  process.once("beforeExit", cleanup);

  console.log(
    `[openlist] spawned pid=${child.pid}; admin UI at http://localhost:${port}`,
  );
  return child;
}

/**
 * Wait until OpenList HTTP is responsive.
 */
export async function waitForOpenList(
  baseUrl: string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/ping`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`openlist did not become ready within ${timeoutMs} ms`);
}
