import { spawn, ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

export type OpenListSpawnOptions = {
  binaryPath: string;
  dataDir: string;
  port: number;
};

export type OpenListProcess = {
  child: ChildProcess;
  /** Initial admin password scraped from stdout on first run. `null` if not seen. */
  getInitialPassword: () => string | null;
};

/**
 * Launch the bundled OpenList Go binary as a child process.
 * Scrapes the initial admin password from stdout on first run so the admin UI
 * can surface it to the user.
 */
export function spawnOpenList(opts: OpenListSpawnOptions): OpenListProcess {
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
    },
  });

  let initialPassword: string | null = null;

  const pwRegex =
    /initial password is[:\s]+([A-Za-z0-9!@#$%^&*()_+=\-]{6,32})/i;

  const handleOutput = (chunk: Buffer, isErr: boolean) => {
    const text = chunk.toString();
    (isErr ? process.stderr : process.stdout).write(`[openlist] ${text}`);
    if (!initialPassword) {
      const m = text.match(pwRegex);
      if (m) {
        initialPassword = m[1];
        console.log(
          `[openlist] captured initial admin password (${initialPassword.length} chars)`,
        );
      }
    }
  };

  child.stdout?.on("data", (c: Buffer) => handleOutput(c, false));
  child.stderr?.on("data", (c: Buffer) => handleOutput(c, true));
  child.on("exit", (code, signal) => {
    console.log(`[openlist] exited code=${code} signal=${signal}`);
  });

  const cleanup = () => {
    if (!child.killed) child.kill("SIGTERM");
  };
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);
  process.once("beforeExit", cleanup);

  console.log(
    `[openlist] spawned pid=${child.pid}; admin UI at http://localhost:${port}`,
  );
  return {
    child,
    getInitialPassword: () => initialPassword,
  };
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
