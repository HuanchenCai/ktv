import { spawn, type ChildProcess, spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { platform } from "node:os";
import { existsSync } from "node:fs";

/**
 * Spawn the always-on-top QR "sticker" window on Windows. The actual
 * window is implemented in scripts/qr-floater.ps1 (PowerShell + WinForms),
 * because the Node side has no business loading System.Windows.Forms.
 *
 * Returns a handle with .stop() so index.ts can clean up on shutdown.
 * On non-Windows platforms this is a no-op — the sticker UX is Win-only
 * for now (different WM mechanism per OS).
 */
export type FloaterHandle = { stop: () => void };

type FloaterOpts = {
  imagePath: string;
  /** Optional second QR (Windows two-pane mode only). */
  imagePath2?: string | null;
  corner: "top-right" | "top-left" | "bottom-right" | "bottom-left";
  size: number;
  margin: number;
  /** Path to the platform-specific helper script. */
  scriptPath: string;
  label?: string;
  labelColor?: string;
};

function startWindowsFloater(opts: FloaterOpts): FloaterHandle | null {
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-WindowStyle",
    "Hidden",
    "-File",
    opts.scriptPath,
    "-ImagePath",
    opts.imagePath,
    "-Corner",
    opts.corner,
    "-Size",
    String(opts.size),
    "-Margin",
    String(opts.margin),
  ];
  if (opts.imagePath2 && existsSync(opts.imagePath2)) {
    args.push("-ImagePath2", opts.imagePath2);
  }
  if (opts.label) args.push("-Label", opts.label);
  if (opts.labelColor) args.push("-LabelColor", opts.labelColor);
  let proc: ChildProcess | null;
  try {
    proc = spawn("powershell.exe", args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (err) {
    console.warn("[qr-floater] spawn failed:", err);
    return null;
  }
  attach(proc, opts.corner, opts.size);
  return {
    stop: () => {
      if (proc && !proc.killed) {
        try {
          proc.kill();
        } catch {
          /* ignore */
        }
      }
    },
  };
}

/** macOS path: `swift scripts/qr-floater.swift --image ...` */
function startMacFloater(opts: FloaterOpts): FloaterHandle | null {
  // Bail if `swift` isn't installed. Friendly hint to install Xcode CLT.
  const probe = spawnSync("which", ["swift"]);
  if (probe.status !== 0) {
    console.warn(
      "[qr-floater] `swift` not found on PATH — install Xcode Command " +
        "Line Tools (`xcode-select --install`) to enable the sticker " +
        "window on macOS, or set qr_floater.enabled=false to silence this.",
    );
    return null;
  }
  const args = [
    opts.scriptPath,
    "--image",
    opts.imagePath,
    "--corner",
    opts.corner,
    "--size",
    String(opts.size),
    "--margin",
    String(opts.margin),
  ];
  if (opts.label) args.push("--label", opts.label);
  if (opts.labelColor) args.push("--label-color", opts.labelColor);
  let proc: ChildProcess | null;
  try {
    proc = spawn("swift", args, { stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    console.warn("[qr-floater] spawn failed:", err);
    return null;
  }
  attach(proc, opts.corner, opts.size);
  return {
    stop: () => {
      if (proc && !proc.killed) {
        try {
          proc.kill();
        } catch {
          /* ignore */
        }
      }
    },
  };
}

function attach(proc: ChildProcess, corner: string, size: number): void {
  proc.stdout?.on("data", (b: Buffer) =>
    process.stdout.write(`[qr-floater] ${b.toString()}`),
  );
  proc.stderr?.on("data", (b: Buffer) =>
    process.stderr.write(`[qr-floater] ${b.toString()}`),
  );
  proc.on("exit", (code) => {
    console.log(`[qr-floater] exited code=${code}`);
  });
  console.log(`[qr-floater] window started at ${corner} size=${size}`);
}

export function startQrFloater(opts: FloaterOpts): FloaterHandle | null {
  if (!existsSync(opts.imagePath)) {
    console.warn(`[qr-floater] image missing: ${opts.imagePath}`);
    return null;
  }
  if (!existsSync(opts.scriptPath)) {
    console.warn(`[qr-floater] script missing: ${opts.scriptPath}`);
    return null;
  }
  if (platform() === "win32") return startWindowsFloater(opts);
  if (platform() === "darwin") return startMacFloater(opts);
  console.log("[qr-floater] only Windows/macOS supported; skipping");
  void dirname;
  return null;
}
