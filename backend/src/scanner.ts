import type { OpenListClient, FsListItem } from "./openlist-client.ts";
import { extractYear, type Db } from "./db.ts";
import { toPinyinInitials } from "./pinyin.ts";

/**
 * Parse KTV MV filename into {title, artist, lang, genre}. The library is
 * organized "按人分" (`<artist>/<file>.mkv`), so the parent directory name
 * is authoritative for the artist when present.
 *
 * Observed conventions:
 *   B'in MUSIC: title-artist-lang-genre.mkv     (title comes first)
 *   公关流通版: artist-title-lang-genre.mkv     (artist comes first)
 *   裸名:       title.mkv                       (no separators)
 *   带 tag:     title[MTV]-artist-...mkv        ([MTV]/[HD]/[MV] etc.)
 *
 * Heuristic: if `parentDir` matches one of the parts, use that as the
 * artist and pick the title from the *other* candidate. Otherwise default
 * to the B'in title-first convention.
 */
export function parseFilename(
  filename: string,
  parentDir: string,
): {
  title: string;
  artist: string;
  lang: string | null;
  genre: string | null;
} {
  const noExt = filename.replace(/\.[^.]+$/, "");
  const stripTags = (s: string) => s.replace(/\[[^\]]*\]/g, "").trim();
  // Split only on hyphens (ASCII and the wide variants). Underscores are
  // used WITHIN the artist segment to mark collaborations
  // ("林俊杰_周杰伦-可惜没如果-国语-合唱"), so we MUST NOT split on _.
  const parts = noExt
    .split(/[-—–]/)
    .map((s) => stripTags(s))
    .filter(Boolean);

  if (parts.length === 0) {
    return {
      title: noExt,
      artist: parentDir || "unknown",
      lang: null,
      genre: null,
    };
  }

  // Single-part filename: just the title.
  if (parts.length === 1) {
    return {
      title: parts[0],
      artist: parentDir || "unknown",
      lang: null,
      genre: null,
    };
  }

  // If a part exactly matches the directory name, that part is the artist
  // and we trust the directory.
  const artistIdx = parentDir
    ? parts.findIndex((p) => p === parentDir)
    : -1;

  let title: string;
  let artist: string;
  let lang: string | null = null;
  let genre: string | null = null;

  if (artistIdx === 0) {
    // artist-title-lang-genre
    artist = parts[0];
    title = parts[1];
    lang = parts[2] ?? null;
    genre = parts[3] ?? null;
  } else if (artistIdx > 0) {
    // title-artist-lang-genre (artist matches dir)
    title = parts[0];
    artist = parts[artistIdx];
    lang = parts[artistIdx + 1] ?? null;
    genre = parts[artistIdx + 2] ?? null;
  } else {
    // No dir match — pick artist-first as the default. Empirically the
    // user's library is overwhelmingly "<artist>-<title>-<lang>-<genre>"
    // (e.g. "周杰伦-纽约地铁-国语-流行.mkv"), and the previous fallback
    // (title-first, "B'in convention") was silently flipping artist and
    // title for every file in undated bulk dirs.
    artist = parts[0];
    title = parts[1] ?? parts[0];
    lang = parts[2] ?? null;
    genre = parts[3] ?? null;
  }

  return { title, artist: artist || "unknown", lang, genre };
}

/**
 * Pull "<parentDir>/<filename>" out of a stored cloud_path so we can
 * re-run parseFilename on existing rows (e.g. after a parser bugfix)
 * without going back to the filesystem. Strips the local:// prefix on
 * the way in so the same code handles Baidu paths and local rows.
 */
export function parseCloudPath(cloudPath: string): {
  dir: string;
  file: string;
} {
  const path = cloudPath.replace(/^local:\/\//, "");
  const i = path.lastIndexOf("/");
  if (i < 0) return { dir: "", file: path };
  const file = path.slice(i + 1);
  const before = path.slice(0, i);
  const j = before.lastIndexOf("/");
  return { dir: j < 0 ? before : before.slice(j + 1), file };
}

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

export type ScanProgress = {
  phase: "listing" | "indexing" | "done";
  current_dir?: string;
  files_seen: number;
  inserted: number;
  updated: number;
  skipped: number;
};

export class Scanner {
  constructor(
    private db: Db,
    private openlist: OpenListClient,
    private baiduRoot: string,
  ) {}

  /**
   * Walk the Baidu storage tree under baiduRoot. Default layout:
   *   /baidu/KTV/<artist>/<file>
   *
   * We go two levels deep by default (artist dirs then files), but fall back
   * to recursive if we find more subdirs.
   */
  async scan(
    options: {
      maxDepth?: number;
      progress?: (msg: string) => void;
      onProgress?: (p: ScanProgress) => void;
    } = {},
  ): Promise<{ inserted: number; updated: number; skipped: number }> {
    const maxDepth = options.maxDepth ?? 3;
    const progress = options.progress ?? ((m) => console.log(`[scan] ${m}`));

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    const insert = this.db.prepare(
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
    const exists = this.db.prepare(
      "SELECT id FROM songs WHERE cloud_path = ?",
    );

    const onProgress = options.onProgress;
    let filesSeen = 0;
    const tick = (phase: ScanProgress["phase"], dir?: string) => {
      onProgress?.({
        phase,
        current_dir: dir,
        files_seen: filesSeen,
        inserted,
        updated,
        skipped,
      });
    };

    const walk = async (path: string, depth: number, parentDir: string) => {
      if (depth > maxDepth) return;
      tick("listing", path);
      let items: FsListItem[];
      try {
        items = await this.openlist.list(path);
      } catch (err) {
        progress(`list failed at ${path}: ${err}`);
        return;
      }
      for (const item of items) {
        const childPath = `${path.replace(/\/$/, "")}/${item.name}`;
        if (item.is_dir) {
          await walk(childPath, depth + 1, item.name);
        } else if (isVideoFile(item.name)) {
          filesSeen++;
          const { title, artist, lang, genre } = parseFilename(
            item.name,
            parentDir,
          );
          const pinyinInitials = toPinyinInitials(title);
          const artistPinyin = toPinyinInitials(artist);
          const already = exists.get(childPath);
          insert.run(
            title,
            artist,
            lang,
            genre,
            pinyinInitials,
            artistPinyin,
            childPath,
            item.size,
            "L",
            extractYear(title),
          );
          if (already) updated++;
          else inserted++;
          // Throttle progress emits to every 25 files (avoid WS flood).
          if (filesSeen % 25 === 0) tick("indexing", path);
        } else {
          skipped++;
        }
      }
    };

    progress(`scanning ${this.baiduRoot}`);
    tick("listing");
    await walk(this.baiduRoot, 0, "");
    tick("done");
    progress(`done — inserted=${inserted} updated=${updated} skipped=${skipped}`);
    return { inserted, updated, skipped };
  }
}
