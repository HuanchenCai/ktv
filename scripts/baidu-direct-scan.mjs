// One-shot: walk Baidu Netdisk /KTV via the web API using BDUSS,
// reuse parseFilename + toPinyinInitials to populate songs table,
// then export CSV / MD / JSON via the same shape as scan.mjs.
//
// Cookies are read from env (BDUSS, STOKEN) so they don't end up in argv
// or shell history. Run via:
//   BDUSS=... STOKEN=... node scripts/baidu-direct-scan.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { openDb } from "../backend/src/db.ts";
import { toPinyinInitials } from "../backend/src/pinyin.ts";
import { parseFilename } from "../backend/src/scanner.ts";

const BDUSS = process.env.BDUSS;
const STOKEN = process.env.STOKEN ?? "";
const ROOT = process.env.ROOT ?? "/KTV";
const MAX_DEPTH = Number(process.env.MAX_DEPTH ?? 20);

if (!BDUSS) {
  console.error("set BDUSS env var");
  process.exit(2);
}

const cookie = `BDUSS=${BDUSS}; STOKEN=${STOKEN}`;
const ua =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const VIDEO_EXTS = new Set([
  ".mkv",
  ".mp4",
  ".vob",
  ".avi",
  ".mov",
  ".wmv",
  ".flv",
  ".ts",
]);
function isVideoFile(name) {
  const i = name.lastIndexOf(".");
  if (i < 0) return false;
  return VIDEO_EXTS.has(name.substring(i).toLowerCase());
}

async function listBaidu(dir) {
  const all = [];
  let start = 0;
  const limit = 1000;
  while (true) {
    const url =
      "https://pan.baidu.com/api/list?" +
      new URLSearchParams({
        dir,
        order: "name",
        start: String(start),
        limit: String(limit),
        web: "1",
        showempty: "0",
      }).toString();
    const res = await fetch(url, {
      headers: {
        Cookie: cookie,
        "User-Agent": ua,
        Referer: "https://pan.baidu.com/disk/main",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${dir}`);
    const j = await res.json();
    if (j.errno !== 0) {
      throw new Error(`errno=${j.errno} request_id=${j.request_id} for ${dir}`);
    }
    const list = j.list || [];
    all.push(...list);
    if (list.length < limit) break;
    start += limit;
  }
  return all.map((it) => ({
    name: it.server_filename,
    size: it.size ?? 0,
    is_dir: it.isdir === 1,
  }));
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
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
      ]
        .map(csvEscape)
        .join(","),
    );
  }
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
  lines.push(`百度网盘根目录: ${baiduRoot}`);
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
    })),
  };
  writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = resolve(projectRoot, "data", "ktv.db");
const db = openDb(dbPath);

const insert = db.prepare(
  `INSERT INTO songs
    (title, artist, lang, genre, pinyin, cloud_path, size_bytes, vocal_channel)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(cloud_path) DO UPDATE SET
     title=excluded.title,
     artist=excluded.artist,
     lang=excluded.lang,
     genre=excluded.genre,
     pinyin=excluded.pinyin,
     size_bytes=excluded.size_bytes`,
);
const exists = db.prepare("SELECT id FROM songs WHERE cloud_path = ?");

const stats = { inserted: 0, updated: 0, skipped: 0, dirs: 0 };

async function walk(path, depth, parentDir) {
  if (depth > MAX_DEPTH) return;
  stats.dirs++;
  let items;
  try {
    items = await listBaidu(path);
  } catch (e) {
    console.warn(`\n[scan] list failed ${path}: ${e.message}`);
    return;
  }
  for (const item of items) {
    const childPath = `${path.replace(/\/$/, "")}/${item.name}`;
    if (item.is_dir) {
      await walk(childPath, depth + 1, item.name);
    } else if (isVideoFile(item.name)) {
      const { title, artist, lang, genre } = parseFilename(item.name, parentDir);
      const pinyin = toPinyinInitials(title);
      const already = exists.get(childPath);
      insert.run(
        title,
        artist,
        lang,
        genre,
        pinyin,
        childPath,
        item.size,
        "L",
      );
      if (already) stats.updated++;
      else stats.inserted++;
    } else {
      stats.skipped++;
    }
  }
  process.stdout.write(
    `\r[scan] dirs=${stats.dirs} inserted=${stats.inserted} updated=${stats.updated} skipped=${stats.skipped}   `,
  );
}

console.log(`[scan] walking baidu netdisk ${ROOT} (max depth ${MAX_DEPTH})`);
await walk(ROOT, 0, "");
console.log("\n[scan] done");

const rows = db
  .prepare(
    `SELECT title, artist, lang, genre, pinyin, cloud_path, size_bytes
     FROM songs
     WHERE cloud_path LIKE ?
     ORDER BY artist COLLATE NOCASE, title COLLATE NOCASE`,
  )
  .all(`${ROOT}/%`);

const outDir = resolve(projectRoot, "data", "exports");
mkdirSync(outDir, { recursive: true });
const csvFile = join(outDir, "songs.csv");
const mdFile = join(outDir, "songs.md");
const jsonFile = join(outDir, "songs.json");

writeCsv(rows, csvFile);
writeMarkdown(rows, mdFile, ROOT);
writeJson(rows, jsonFile, ROOT);

console.log(
  `[scan] exported ${rows.length} songs:\n  CSV : ${csvFile}\n  MD  : ${mdFile}\n  JSON: ${jsonFile}`,
);

db.close();
console.log(
  `\n扫描完成:新增 ${stats.inserted} / 更新 ${stats.updated} / 跳过 ${stats.skipped} (${stats.dirs} 个目录)`,
);
