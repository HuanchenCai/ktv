#!/usr/bin/env node
/**
 * Standalone CLI: scan Baidu Netdisk via OpenList, populate songs table,
 * and export a song list as CSV / Markdown / JSON.
 *
 * Usage:
 *   npm run scan                    # default: depth=3, exports to data/exports/
 *   npm run scan -- --depth 5
 *   npm run scan -- --no-export
 *   npm run scan -- --out some/dir
 *
 * Reuses the existing Scanner / OpenListClient / Db modules — no scanning
 * logic is reimplemented here. Spawns OpenList only if it isn't already
 * listening on the configured port.
 */

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

import { loadConfig, projectRoot } from "../backend/src/config.ts";
import { openDb } from "../backend/src/db.ts";
import { OpenListClient } from "../backend/src/openlist-client.ts";
import {
  spawnOpenList,
  waitForOpenList,
} from "../backend/src/openlist-spawner.ts";
import { Scanner } from "../backend/src/scanner.ts";

function parseArgs(argv) {
  const out = { depth: undefined, export: true, outDir: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--depth") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 0) {
        throw new Error(`invalid --depth value: ${argv[i]}`);
      }
      out.depth = n;
    } else if (a === "--no-export") {
      out.export = false;
    } else if (a === "--out") {
      out.outDir = argv[++i];
      if (!out.outDir) throw new Error("--out requires a directory argument");
    } else if (a === "--help" || a === "-h") {
      console.log(
        "usage: npm run scan [-- --depth N] [--no-export] [--out DIR]",
      );
      process.exit(0);
    } else {
      throw new Error(`unknown arg: ${a}`);
    }
  }
  return out;
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function fmtMb(bytes) {
  if (!bytes || bytes <= 0) return "";
  return (bytes / 1024 / 1024).toFixed(1);
}

function fmtLocalDateTime(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

function writeCsv(songs, file) {
  const header = [
    "歌名",
    "歌手",
    "语言",
    "流派",
    "拼音首字母",
    "云盘路径",
    "大小(MB)",
    "已缓存",
  ];
  const rows = [header.join(",")];
  for (const s of songs) {
    rows.push(
      [
        s.title,
        s.artist,
        s.lang ?? "",
        s.genre ?? "",
        s.pinyin,
        s.cloud_path,
        fmtMb(s.size_bytes),
        s.cached ? "是" : "否",
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  // UTF-8 BOM so Excel on Chinese Windows opens it correctly.
  writeFileSync(file, "﻿" + rows.join("\r\n") + "\r\n", "utf8");
}

function writeMarkdown(songs, file, baiduRoot) {
  const groups = new Map();
  for (const s of songs) {
    const k = s.artist || "未知歌手";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  const sortedArtists = [...groups.keys()].sort((a, b) =>
    a.localeCompare(b, "zh-Hans-CN"),
  );

  const lines = [];
  lines.push("# KTV 歌曲清单");
  lines.push("");
  lines.push(`生成时间: ${fmtLocalDateTime(new Date())}`);
  lines.push(`百度云盘根目录: ${baiduRoot}`);
  lines.push(`共 ${songs.length} 首,${sortedArtists.length} 位歌手`);
  lines.push("");

  for (const artist of sortedArtists) {
    const list = groups.get(artist);
    lines.push(`## ${artist} (${list.length} 首)`);
    list.sort((a, b) => a.title.localeCompare(b.title, "zh-Hans-CN"));
    for (const s of list) {
      const tags = [s.lang, s.genre].filter(Boolean).join("/");
      const tagPart = tags ? ` [${tags}]` : "";
      const sizePart = s.size_bytes ? ` · ${fmtMb(s.size_bytes)} MB` : "";
      lines.push(`- ${s.title}${tagPart}${sizePart}`);
    }
    lines.push("");
  }
  writeFileSync(file, lines.join("\n"), "utf8");
}

function writeJson(songs, file, baiduRoot) {
  const payload = {
    generated_at: new Date().toISOString(),
    baidu_root: baiduRoot,
    count: songs.length,
    songs: songs.map((s) => ({
      title: s.title,
      artist: s.artist,
      lang: s.lang,
      genre: s.genre,
      pinyin: s.pinyin,
      cloud_path: s.cloud_path,
      size_bytes: s.size_bytes,
      cached: !!s.cached,
      play_count: s.play_count,
    })),
  };
  writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = projectRoot();
  const config = loadConfig(root);

  const openlistUrl = `http://localhost:${config.openlist.port}`;
  const openlist = new OpenListClient({
    baseUrl: openlistUrl,
    token: config.openlist.api_token,
  });

  let openlistProc = null;
  const alreadyUp = await openlist.ping();
  if (alreadyUp) {
    console.log(`[scan] reusing OpenList already running at ${openlistUrl}`);
  } else if (config.openlist.auto_spawn) {
    if (!existsSync(config.openlist.binary_path)) {
      console.error(
        `[scan] OpenList binary not at ${config.openlist.binary_path}.\n` +
          `       run: npm run fetch:openlist`,
      );
      process.exit(1);
    }
    openlistProc = spawnOpenList({
      binaryPath: config.openlist.binary_path,
      dataDir: config.openlist.data_dir,
      port: config.openlist.port,
    });
    try {
      await waitForOpenList(openlistUrl, 30_000);
      console.log("[scan] OpenList is up");
    } catch (err) {
      console.error("[scan] OpenList failed to become ready:", err);
      try {
        openlistProc.child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      process.exit(1);
    }
  } else {
    console.error(
      `[scan] OpenList is not running at ${openlistUrl} and auto_spawn is disabled.\n` +
        `       start it manually or set openlist.auto_spawn=true in config.json`,
    );
    process.exit(1);
  }

  const dbPath = resolve(root, "data", "ktv.db");
  const db = openDb(dbPath);

  const scanner = new Scanner(db, openlist, config.baidu_root);

  let result;
  try {
    result = await scanner.scan({
      maxDepth: args.depth,
      progress: (m) => console.log(`[scan] ${m}`),
    });
  } catch (err) {
    console.error("[scan] failed:", err);
    db.close();
    if (openlistProc) {
      try {
        openlistProc.child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
    process.exit(1);
  }

  let exportSummary = "";
  if (args.export) {
    const outDir = resolve(root, args.outDir ?? join("data", "exports"));
    mkdirSync(outDir, { recursive: true });

    const rows = db
      .prepare(
        `SELECT title, artist, lang, genre, pinyin, cloud_path,
                size_bytes, cached, last_played_at, play_count
         FROM songs
         ORDER BY artist COLLATE NOCASE, title COLLATE NOCASE`,
      )
      .all();

    const csvFile = join(outDir, "songs.csv");
    const mdFile = join(outDir, "songs.md");
    const jsonFile = join(outDir, "songs.json");

    writeCsv(rows, csvFile);
    writeMarkdown(rows, mdFile, config.baidu_root);
    writeJson(rows, jsonFile, config.baidu_root);

    exportSummary =
      `\n  CSV : ${csvFile}` +
      `\n  MD  : ${mdFile}` +
      `\n  JSON: ${jsonFile}`;
    console.log(`[scan] exported ${rows.length} songs:` + exportSummary);
  }

  db.close();
  if (openlistProc) {
    try {
      openlistProc.child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }

  console.log(
    `\n扫描完成:新增 ${result.inserted} / 更新 ${result.updated} / 跳过 ${result.skipped}` +
      (args.export ? `\n清单已写入 data/exports/` : ""),
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[scan] fatal:", err);
  process.exit(1);
});
