import { spawn } from "node:child_process";
import { platform } from "node:os";

/**
 * Pop up a native "choose folder" dialog on the host machine and return the
 * absolute path the user selected, or null if they canceled. Blocks the
 * caller until the dialog closes.
 *
 * Win32: PowerShell + System.Windows.Forms.FolderBrowserDialog (STA mode).
 *        Supports UNC paths via the Network node.
 * macOS: osascript "choose folder" → POSIX path.
 * Linux: zenity --file-selection --directory.
 */
export async function pickFolder(initialDir?: string): Promise<string | null> {
  const plat = platform();
  if (plat === "win32") return pickWindows(initialDir);
  if (plat === "darwin") return pickMac(initialDir);
  return pickLinux(initialDir);
}

function pickWindows(initialDir?: string): Promise<string | null> {
  return new Promise((resolve) => {
    // PS escaping: single quotes survive as literal in PS strings; for a
    // single quote inside the string we double it (PS convention).
    const psInitial = initialDir
      ? `$d.SelectedPath = '${initialDir.replace(/'/g, "''")}'`
      : "";
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "Add-Type -AssemblyName System.Windows.Forms",
      "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
      "$d.Description = 'Select your KTV library folder'",
      "$d.ShowNewFolderButton = $false",
      psInitial,
      "$result = $d.ShowDialog()",
      "if ($result -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }",
    ]
      .filter(Boolean)
      .join("; ");

    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-STA",
      "-Command",
      script,
    ]);
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("close", () => {
      if (err.trim()) console.warn("[folder-picker] ps stderr:", err.trim());
      const trimmed = out.trim();
      resolve(trimmed.length > 0 ? trimmed : null);
    });
    child.on("error", (e) => {
      console.warn("[folder-picker] spawn failed:", e);
      resolve(null);
    });
  });
}

function pickMac(initialDir?: string): Promise<string | null> {
  return new Promise((resolve) => {
    const args = [
      "-e",
      initialDir
        ? `tell application "Finder" to set p to choose folder default location POSIX file "${initialDir.replace(/"/g, '\\"')}"`
        : `tell application "Finder" to set p to choose folder`,
      "-e",
      "POSIX path of p",
    ];
    const child = spawn("osascript", args);
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.on("close", (code) => {
      if (code === 0) {
        const path = out.trim().replace(/\/$/, "");
        resolve(path.length > 0 ? path : null);
      } else {
        resolve(null);
      }
    });
    child.on("error", () => resolve(null));
  });
}

function pickLinux(initialDir?: string): Promise<string | null> {
  return new Promise((resolve) => {
    const args = ["--file-selection", "--directory"];
    if (initialDir) args.push(`--filename=${initialDir}`);
    const child = spawn("zenity", args);
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.on("close", (code) => {
      if (code === 0) {
        const path = out.trim();
        resolve(path.length > 0 ? path : null);
      } else {
        resolve(null);
      }
    });
    child.on("error", () => resolve(null));
  });
}
