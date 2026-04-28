import type { OpenListClient, FsListItem } from "./openlist-client.ts";
import type { Db } from "./db.ts";
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
  const parts = noExt
    .split(/[-_—]/)
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
    // No match: fall back to B'in convention. parts[1] is the artist;
    // if absent, the directory name wins.
    title = parts[0];
    artist = parts[1] ?? parentDir ?? "unknown";
    lang = parts[2] ?? null;
    genre = parts[3] ?? null;
  }

  return { title, artist: artist || "unknown", lang, genre };
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
    options: { maxDepth?: number; progress?: (msg: string) => void } = {},
  ): Promise<{ inserted: number; updated: number; skipped: number }> {
    const maxDepth = options.maxDepth ?? 3;
    const progress = options.progress ?? ((m) => console.log(`[scan] ${m}`));

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    const insert = this.db.prepare(
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
    const exists = this.db.prepare(
      "SELECT id FROM songs WHERE cloud_path = ?",
    );

    const walk = async (path: string, depth: number, parentDir: string) => {
      if (depth > maxDepth) return;
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
          const { title, artist, lang, genre } = parseFilename(
            item.name,
            parentDir,
          );
          const pinyinInitials = toPinyinInitials(title);
          const already = exists.get(childPath);
          insert.run(
            title,
            artist,
            lang,
            genre,
            pinyinInitials,
            childPath,
            item.size,
            "L",
          );
          if (already) updated++;
          else inserted++;
        } else {
          skipped++;
        }
      }
    };

    progress(`scanning ${this.baiduRoot}`);
    await walk(this.baiduRoot, 0, "");
    progress(`done — inserted=${inserted} updated=${updated} skipped=${skipped}`);
    return { inserted, updated, skipped };
  }
}
