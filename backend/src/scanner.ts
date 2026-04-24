import type { OpenListClient, FsListItem } from "./openlist-client.ts";
import type { Db } from "./db.ts";
import { toPinyinInitials } from "./pinyin.ts";

/**
 * Parse KTV MV filename into {title, lang, genre}.
 *
 * Observed convention (B'in MUSIC et al):
 *   如果明天世界末日[MTV]-魔幻力量-国语-流行.mkv
 *            ^title       ^artist  ^lang ^genre
 *
 * But titles also sometimes carry no [MTV] tag, or artist comes from the directory.
 * We keep this tolerant: title = first segment stripped of tags; artist/lang/genre
 * optional; directory name wins for artist since user's library is organized "按人分".
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
  const parts = noExt.split(/[-_—]/).map((s) => s.trim()).filter(Boolean);
  // Strip [MTV] [MV] etc tags from title
  const stripTags = (s: string) => s.replace(/\[[^\]]*\]/g, "").trim();

  const title = stripTags(parts[0] ?? noExt);
  const artist = parts[1] ?? parentDir;
  const lang = parts[2] ?? null;
  const genre = parts[3] ?? null;

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
