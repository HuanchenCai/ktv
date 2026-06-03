import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
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

export function startQrFloater(opts: {
  imagePath: string;
  /** Optional second QR (e.g. WiFi). When supplied, the sticker shows
   * two QRs side by side: WiFi (left, cyan label) + URL (right, pink). */
  imagePath2?: string | null;
  corner: "top-right" | "top-left" | "bottom-right" | "bottom-left";
  size: number;
  margin: number;
  scriptPath: string;
  /** Single-image mode only: label text above the QR. */
  label?: string;
  /** Single-image mode only: #rrggbb label background. */
  labelColor?: string;
}): FloaterHandle | null {
  if (platform() !== "win32") {
    console.log("[qr-floater] not on Windows; skipping sticker window");
    return null;
  }
  if (!existsSync(opts.imagePath)) {
    console.warn(`[qr-floater] image missing: ${opts.imagePath}`);
    return null;
  }
  if (!existsSync(opts.scriptPath)) {
    console.warn(`[qr-floater] script missing: ${opts.scriptPath}`);
    return null;
  }
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
  proc.stdout?.on("data", (b: Buffer) =>
    process.stdout.write(`[qr-floater] ${b.toString()}`),
  );
  proc.stderr?.on("data", (b: Buffer) =>
    process.stderr.write(`[qr-floater] ${b.toString()}`),
  );
  proc.on("exit", (code) => {
    console.log(`[qr-floater] exited code=${code}`);
    proc = null;
  });
  console.log(
    `[qr-floater] window started at ${opts.corner} size=${opts.size}`,
  );
  void resolve; // keep import
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
