import { toPinyinInitials } from "./pinyin.ts";
import { parseFilename } from "./scanner.ts";
import { extractYear, type Db } from "./db.ts";

/**
 * Walk a Baidu Netdisk subtree via the cookie-authenticated /api/list
 * endpoint and upsert one row per video file into `songs` (cached=0).
 *
 * Pulled out of scripts/baidu-direct-scan.mjs so the same logic powers the
 * web UI's "扫百度盘" button. Emits structured progress so the WS layer
 * can stream it to clients.
 */

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

function isVideoFile(name: string): boolean {
  const i = name.lastIndexOf(".");
  if (i < 0) return false;
  return VIDEO_EXTS.has(name.substring(i).toLowerCase());
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

type ListedItem = { name: string; size: number; is_dir: boolean };

async function listBaidu(
  dir: string,
  cookie: string,
  abortSignal?: AbortSignal,
): Promise<ListedItem[]> {
  const all: ListedItem[] = [];
  let start = 0;
  const limit = 1000;
  // Paginate; Baidu caps `limit` per request even though `dir` is fixed.
  while (true) {
    if (abortSignal?.aborted) throw new Error("aborted");
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
        "User-Agent": UA,
        Referer: "https://pan.baidu.com/disk/main",
      },
      signal: abortSignal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${dir}`);
    const j = (await res.json()) as {
      errno: number;
      list?: Array<{ server_filename: string; size?: number; isdir: number }>;
      request_id?: string | number;
    };
    if (j.errno !== 0) {
      throw new Error(
        `errno=${j.errno} request_id=${j.request_id ?? ""} for ${dir}`,
      );
    }
    const list = j.list ?? [];
    for (const it of list) {
      all.push({
        name: it.server_filename,
        size: it.size ?? 0,
        is_dir: it.isdir === 1,
      });
    }
    if (list.length < limit) break;
    start += limit;
  }
  return all;
}

export type BaiduScanProgress = {
  phase: "listing" | "indexing" | "done" | "failed";
  current_dir: string | null;
  dirs: number;
  inserted: number;
  updated: number;
  skipped: number;
  error?: string | null;
};

export type BaiduScanOptions = {
  bduss: string;
  stoken?: string;
  root?: string;
  maxDepth?: number;
  onProgress?: (p: BaiduScanProgress) => void;
  abortSignal?: AbortSignal;
};

export async function scanBaidu(
  db: Db,
  opts: BaiduScanOptions,
): Promise<{ inserted: number; updated: number; skipped: number; dirs: number }> {
  if (!opts.bduss) {
    throw new Error("BDUSS is required to scan Baidu Netdisk");
  }
  const root = opts.root ?? "/KTV";
  const maxDepth = opts.maxDepth ?? 20;
  const cookie = `BDUSS=${opts.bduss}; STOKEN=${opts.stoken ?? ""}`;

  const insert = db.prepare(
    `INSERT INTO songs
       (title, artist, lang, genre, pinyin, artist_pinyin, cloud_path, size_bytes, vocal_channel, year_int)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(cloud_path) DO UPDATE SET
       title=excluded.title,
       artist=excluded.artist,
       lang=excluded.lang,
       genre=excluded.genre,
       pinyin=excluded.pinyin,
       artist_pinyin=excluded.artist_pinyin,
       size_bytes=excluded.size_bytes,
       year_int=excluded.year_int`,
  );
  const exists = db.prepare("SELECT id FROM songs WHERE cloud_path = ?");

  const stats: BaiduScanProgress = {
    phase: "listing",
    current_dir: null,
    dirs: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
  };
  const tick = (phase: BaiduScanProgress["phase"], dir: string | null) => {
    stats.phase = phase;
    stats.current_dir = dir;
    opts.onProgress?.({ ...stats });
  };

  let lastEmitTs = 0;
  const emitThrottled = (dir: string) => {
    const now = Date.now();
    if (now - lastEmitTs > 500) {
      lastEmitTs = now;
      tick("indexing", dir);
    }
  };

  async function walk(path: string, depth: number, parentDir: string) {
    if (depth > maxDepth) return;
    if (opts.abortSignal?.aborted) throw new Error("aborted");
    stats.dirs++;
    tick("listing", path);
    let items: ListedItem[];
    try {
      items = await listBaidu(path, cookie, opts.abortSignal);
    } catch (e) {
      const msg = (e as Error).message;
      console.warn(`[baidu-scan] list failed ${path}: ${msg}`);
      // The root listing failing is the whole job failing — bubble up so
      // the API layer can report it. For deeper subdirs we tolerate
      // permissioned/empty failures and skip.
      if (depth === 0) {
        throw new Error(`list ${path} failed: ${msg}`);
      }
      return;
    }
    for (const item of items) {
      const childPath = `${path.replace(/\/$/, "")}/${item.name}`;
      if (item.is_dir) {
        await walk(childPath, depth + 1, item.name);
      } else if (isVideoFile(item.name)) {
        const { title, artist, lang, genre } = parseFilename(
          item.name,
          parentDir,
        );
        const pinyin = toPinyinInitials(title);
        const artistPinyin = toPinyinInitials(artist);
        const already = exists.get(childPath);
        insert.run(
          title,
          artist,
          lang,
          genre,
          pinyin,
          artistPinyin,
          childPath,
          item.size,
          "L",
          extractYear(title),
        );
        if (already) stats.updated++;
        else stats.inserted++;
        emitThrottled(path);
      } else {
        stats.skipped++;
      }
    }
  }

  try {
    await walk(root, 0, "");
  } catch (err) {
    stats.phase = "failed";
    stats.current_dir = null;
    const msg = err instanceof Error ? err.message : String(err);
    opts.onProgress?.({ ...stats, error: msg });
    throw err;
  }
  tick("done", null);
  return {
    inserted: stats.inserted,
    updated: stats.updated,
    skipped: stats.skipped,
    dirs: stats.dirs,
  };
}
