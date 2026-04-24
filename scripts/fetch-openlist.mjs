#!/usr/bin/env node
/**
 * Download the OpenList binary for the current platform into ./bin/.
 *
 * Usage:
 *   node scripts/fetch-openlist.mjs            (auto-detect platform)
 *   node scripts/fetch-openlist.mjs --force    (re-download even if present)
 *   node scripts/fetch-openlist.mjs windows-amd64   (explicit target)
 */
import { mkdir, writeFile, chmod, rm, readdir, rename, copyFile } from "node:fs/promises";
import { existsSync, createReadStream, createWriteStream } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir, platform, arch } from "node:os";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const binDir = resolve(rootDir, "bin");

function detectTarget() {
  const plat = platform();
  const a = arch();
  if (plat === "win32" && a === "x64") return "windows-amd64";
  if (plat === "win32" && a === "arm64") return "windows-arm64";
  if (plat === "darwin" && a === "arm64") return "darwin-arm64";
  if (plat === "darwin" && a === "x64") return "darwin-amd64";
  if (plat === "linux" && a === "x64") return "linux-amd64";
  if (plat === "linux" && a === "arm64") return "linux-arm64";
  throw new Error(`unsupported platform: ${plat}/${a}`);
}

async function latestReleaseTag() {
  const res = await fetch(
    "https://api.github.com/repos/OpenListTeam/OpenList/releases/latest",
    { headers: { "User-Agent": "ktv-fetch-openlist" } },
  );
  if (!res.ok) throw new Error(`github api ${res.status}`);
  const body = await res.json();
  return body.tag_name;
}

async function downloadTo(url, dest) {
  console.log(`[fetch] GET ${url}`);
  const res = await fetch(url, { headers: { "User-Agent": "ktv-fetch-openlist" } });
  if (!res.ok) throw new Error(`download ${res.status}: ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function extractArchive(archivePath, outDir, kind) {
  // kind: "zip" or "tar.gz"
  await mkdir(outDir, { recursive: true });
  if (kind === "zip") {
    // Prefer built-in tooling
    if (platform() === "win32") {
      const r = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `Expand-Archive -Path '${archivePath}' -DestinationPath '${outDir}' -Force`,
        ],
        { stdio: "inherit" },
      );
      if (r.status !== 0) throw new Error("Expand-Archive failed");
    } else {
      const r = spawnSync("unzip", ["-o", archivePath, "-d", outDir], {
        stdio: "inherit",
      });
      if (r.status !== 0) throw new Error("unzip failed");
    }
  } else if (kind === "tar.gz") {
    const r = spawnSync("tar", ["-xzf", archivePath, "-C", outDir], {
      stdio: "inherit",
    });
    if (r.status !== 0) throw new Error("tar -xzf failed");
  }
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const explicit = args.find((a) => !a.startsWith("--"));
  const target = explicit ?? detectTarget();

  const binaryName = platform() === "win32" ? "openlist.exe" : "openlist";
  const finalPath = resolve(binDir, binaryName);

  if (existsSync(finalPath) && !force) {
    console.log(`[fetch] ${finalPath} already present (use --force to refetch)`);
    return;
  }

  await mkdir(binDir, { recursive: true });
  const tag = await latestReleaseTag();
  console.log(`[fetch] latest OpenList release: ${tag}`);

  const isWin = target.startsWith("windows");
  const ext = isWin ? "zip" : "tar.gz";
  const asset = `openlist-${target}.${ext}`;
  const url = `https://github.com/OpenListTeam/OpenList/releases/download/${tag}/${asset}`;

  const tmpRoot = join(tmpdir(), `openlist-${randomBytes(6).toString("hex")}`);
  await mkdir(tmpRoot, { recursive: true });
  const archivePath = join(tmpRoot, asset);

  try {
    await downloadTo(url, archivePath);
    await extractArchive(archivePath, tmpRoot, ext);

    // Find the binary in the extracted dir (may be at root or in a subfolder)
    const candidates = [];
    async function walk(dir) {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.name === binaryName) candidates.push(p);
      }
    }
    await walk(tmpRoot);

    if (candidates.length === 0) {
      throw new Error(
        `archive did not contain ${binaryName} — extracted tree: ${tmpRoot}`,
      );
    }
    // rename fails across drives (EXDEV on Windows when tmp is C: and project on H:) — fall back to copy.
    try {
      await rename(candidates[0], finalPath);
    } catch (err) {
      if (err && err.code === "EXDEV") {
        await copyFile(candidates[0], finalPath);
      } else {
        throw err;
      }
    }
    if (!isWin) await chmod(finalPath, 0o755);
    console.log(`[fetch] installed -> ${finalPath}`);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error("[fetch] error:", err.message);
  process.exit(1);
});

// appease eslint
void createReadStream;
