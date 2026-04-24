#!/usr/bin/env node
/**
 * Sanity-check the KTV environment. Prints pass/fail for each prerequisite
 * so the user can fix them before `npm start`.
 *
 * Checks:
 *   - Node >= 22 (node:sqlite needs it)
 *   - node:sqlite loadable
 *   - mpv binary reachable (PATH or common locations)
 *   - OpenList binary fetched (bin/)
 *   - config.json present
 *   - library_path exists and is writable
 */
import { existsSync, accessSync, constants, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

const checks = [];

function check(name, fn) {
  checks.push({ name, fn });
}

function pass(name, detail = "") {
  console.log(`\u2713 ${name}${detail ? "  " + detail : ""}`);
}
function fail(name, detail = "") {
  console.log(`\u2717 ${name}${detail ? "  " + detail : ""}`);
}
function info(name, detail = "") {
  console.log(`\u25cb ${name}${detail ? "  " + detail : ""}`);
}

check("Node >= 22", () => {
  const [maj] = process.versions.node.split(".").map(Number);
  if (maj >= 22) pass("Node >= 22", `(v${process.versions.node})`);
  else fail("Node >= 22", `got v${process.versions.node}; upgrade to 22 or newer`);
});

check("node:sqlite builtin", () => {
  try {
    const mod = require("node:sqlite");
    if (mod?.DatabaseSync) pass("node:sqlite builtin", "DatabaseSync found");
    else fail("node:sqlite builtin", "DatabaseSync not exported");
  } catch (err) {
    fail("node:sqlite builtin", err.message);
  }
});

check("mpv reachable", () => {
  try {
    const found = execSync(platform() === "win32" ? "where mpv" : "which mpv", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim()
      .split(/\r?\n/)[0];
    if (found && existsSync(found)) {
      pass("mpv reachable", found);
      return;
    }
  } catch {
    /* try fallbacks */
  }
  const candidates =
    platform() === "win32"
      ? [
          "C:/Program Files/MPV Player/mpv.exe",
          "C:/Program Files/mpv/mpv.exe",
          "C:/Program Files (x86)/mpv/mpv.exe",
        ]
      : platform() === "darwin"
        ? ["/opt/homebrew/bin/mpv", "/usr/local/bin/mpv"]
        : ["/usr/bin/mpv", "/usr/local/bin/mpv"];
  const hit = candidates.find((c) => existsSync(c));
  if (hit) pass("mpv reachable", hit);
  else
    fail(
      "mpv reachable",
      platform() === "win32"
        ? "install: winget install shinchiro.mpv"
        : platform() === "darwin"
          ? "install: brew install mpv"
          : "install: apt install mpv",
    );
});

check("OpenList binary", () => {
  const name = platform() === "win32" ? "openlist.exe" : "openlist";
  const path = resolve(rootDir, "bin", name);
  if (existsSync(path)) pass("OpenList binary", path);
  else fail("OpenList binary", "run: npm run fetch:openlist");
});

check("config.json", () => {
  const path = resolve(rootDir, "config.json");
  if (existsSync(path)) pass("config.json", path);
  else
    info(
      "config.json",
      "will be auto-created from config.example.json on first `npm start`",
    );
});

check("library_path writable", () => {
  const configPath = resolve(rootDir, "config.json");
  let libraryPath = null;
  if (existsSync(configPath)) {
    try {
      libraryPath = JSON.parse(
        require("node:fs").readFileSync(configPath, "utf8"),
      ).library_path;
    } catch {
      /* ignore */
    }
  }
  if (!libraryPath) {
    info("library_path", "skipped (config.json not ready yet)");
    return;
  }
  try {
    mkdirSync(libraryPath, { recursive: true });
    accessSync(libraryPath, constants.W_OK);
    pass("library_path writable", libraryPath);
  } catch (err) {
    fail("library_path writable", `${libraryPath}: ${err.message}`);
  }
});

console.log("\nKTV doctor\n==========\n");
for (const { fn } of checks) fn();
console.log(
  "\nAll ✓ means you can `npm start`. Any ✗ needs fixing first. ○ items are informational.",
);
