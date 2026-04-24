import { readdir, stat } from "node:fs/promises";
import { resolve, basename, extname, dirname } from "node:path";
import type { Db } from "./db.ts";
import { toPinyinInitials } from "./pinyin.ts";
import { parseFilename } from "./scanner.ts";

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

/**
 * Walk a local directory, register any MKV/MP4 files as already-cached songs.
 * Useful for smoke-testing the playback pipeline without touching Baidu:
 *   drop one file into library_path, hit POST /api/admin/import-local, search
 *   for it, enqueue, confirm mpv plays.
 */
export async function importLocalLibrary(
  db: Db,
  libraryPath: string,
): Promise<{ added: number; skipped: number; scanned: number }> {
  let added = 0;
  let skipped = 0;
  let scanned = 0;

  const insert = db.prepare(
    `INSERT INTO songs
     (title, artist, lang, genre, pinyin, cloud_path, size_bytes,
      cached, local_path, vocal_channel)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 'L')
     ON CONFLICT(cloud_path) DO UPDATE SET
       cached=1, local_path=excluded.local_path, size_bytes=excluded.size_bytes`,
  );

  async function walk(dir: string, artistDir: string) {
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = resolve(dir, name);
      let st;
      try {
        st = await stat(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        await walk(full, name);
      } else if (VIDEO_EXTS.has(extname(name).toLowerCase())) {
        scanned++;
        const parentDir = basename(dirname(full));
        const { title, artist, lang, genre } = parseFilename(name, parentDir);
        const pinyin = toPinyinInitials(title);
        const cloudPath = `local://${full.replace(/\\/g, "/")}`;
        try {
          insert.run(
            title,
            artist,
            lang,
            genre,
            pinyin,
            cloudPath,
            st.size,
            full,
          );
          added++;
        } catch {
          skipped++;
        }
      }
      // unused but keeps lint happy about parameter
      void artistDir;
    }
  }

  await walk(resolve(libraryPath), basename(libraryPath));
  return { added, skipped, scanned };
}
