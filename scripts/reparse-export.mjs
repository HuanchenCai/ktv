// Re-parse cloud_path -> title/artist/lang/genre/pinyin without re-scanning
// the cloud, then re-export CSV / MD / JSON.
//
// Why: backend/src/scanner.ts:parseFilename assumes BIN-MUSIC-style
// "<title>[tag]-<artist>-<lang>-<genre>", but the user's library uses
// THREE conventions:
//   A) "<artist>-<title>(tag)-<lang>-<genre>.mkv"  -- 95% of files
//   B) "<title>[tag]-<artist>-<lang>-<genre>.mkv"  -- /KTV/MKV(7300首)
//   C) "<num> <title> - <artist>.mkv"              -- 经典老歌800首
//
// This script supplies a smarter parser for them and only updates rows
// already in the songs table (cloud_path stays the source of truth).

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

import { openDb } from "../backend/src/db.ts";
import { toPinyinInitials } from "../backend/src/pinyin.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = process.env.ROOT ?? "/KTV";

const stripTags = (s) => s.replace(/\[[^\]]*\]/g, "").trim();
const hasTag = (s) => /\[[^\]]+\]/.test(s);
const stripLeadingNum = (s) => s.replace(/^\d+\s+/, "").trim();

function parseSmart(filename, parentDir) {
  const noExt = filename.replace(/\.[^.]+$/, "");

  // Format C: "<num> <title> - <artist>" (space-dash-space, no lang/genre).
  // Detect when filename has " - " AND no language tag like "-国语-" "-英语-".
  // Cheap signal: " - " present, and not the multi-dash 4-segment shape.
  // NOTE: do NOT split on `_` — in this library underscore separates
  // collaborating artists ("许馨文_Alex Hong"), not fields.
  const parts0 = noExt.split(/[-—]/).map((s) => s.trim()).filter(Boolean);
  if (/ - /.test(noExt) && parts0.length <= 3) {
    const m = noExt.match(/^(.+?)\s+-\s+(.+)$/);
    if (m) {
      return {
        title: stripTags(stripLeadingNum(m[1])),
        artist: m[2].trim() || parentDir || "unknown",
        lang: null,
        genre: null,
      };
    }
  }

  // Standard formats A / B: split by - or em-dash
  const parts = parts0;
  if (parts.length === 0) {
    return {
      title: noExt,
      artist: parentDir || "unknown",
      lang: null,
      genre: null,
    };
  }
  if (parts.length === 1) {
    return {
      title: stripTags(parts[0]),
      artist: parentDir || "unknown",
      lang: null,
      genre: null,
    };
  }

  let title, artist;

  // Heuristic: [tag] usually attaches to the song name, not the artist.
  if (hasTag(parts[0]) && !hasTag(parts[1])) {
    // Format B: title-with-tag in front (BIN MUSIC convention)
    title = stripTags(parts[0]);
    artist = parts[1] || parentDir;
  } else {
    // Format A: artist in front (95% of user's library)
    artist = parts[0] || parentDir;
    title = stripTags(parts[1] ?? parts[0]);
  }

  return {
    title: title || noExt,
    artist: artist || parentDir || "unknown",
    lang: parts[2] ?? null,
    genre: parts[3] ?? null,
  };
}

// --- exporters (same shape as baidu-direct-scan.mjs) -----------------------

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
  writeFileSync(
    file,
    JSON.stringify(
      {
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
      },
      null,
      2,
    ),
    "utf8",
  );
}

// --- main ------------------------------------------------------------------

const dbPath = resolve(projectRoot, "data", "ktv.db");
const db = openDb(dbPath);

const all = db
  .prepare(
    `SELECT id, cloud_path, size_bytes
     FROM songs
     WHERE cloud_path LIKE ?`,
  )
  .all(`${ROOT}/%`);

console.log(`[reparse] processing ${all.length} rows...`);

const update = db.prepare(
  `UPDATE songs
   SET title = ?, artist = ?, lang = ?, genre = ?, pinyin = ?
   WHERE id = ?`,
);

db.exec("BEGIN");
let n = 0;
try {
  for (const row of all) {
    const filename = basename(row.cloud_path);
    const parentDir = basename(dirname(row.cloud_path));
    const { title, artist, lang, genre } = parseSmart(filename, parentDir);
    const pinyin = toPinyinInitials(title);
    update.run(title, artist, lang, genre, pinyin, row.id);
    if (++n % 10000 === 0) process.stdout.write(`\r[reparse] ${n}/${all.length}`);
  }
  db.exec("COMMIT");
  console.log(`\r[reparse] ${n}/${all.length} done`);
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}

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
writeCsv(rows, join(outDir, "songs.csv"));
writeMarkdown(rows, join(outDir, "songs.md"), ROOT);
writeJson(rows, join(outDir, "songs.json"), ROOT);

const distinctArtists = new Set(rows.map((r) => r.artist));
console.log(
  `[reparse] exported ${rows.length} songs, ${distinctArtists.size} artists`,
);

db.close();
