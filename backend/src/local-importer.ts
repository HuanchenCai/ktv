import { readdir, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { resolve, basename, extname, dirname } from "node:path";
import { extractYear, type Db } from "./db.ts";
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

export type ImportProgress = {
  phase: "listing" | "indexing" | "done";
  current_dir?: string;
  scanned: number;
  added: number;
  skipped: number;
};

/**
 * Walk a local directory, register any MKV/MP4 files as already-cached songs.
 * Useful for smoke-testing the playback pipeline without touching Baidu:
 *   drop one file into library_path, hit POST /api/admin/import-local, search
 *   for it, enqueue, confirm mpv plays.
 */
export async function importLocalLibrary(
  db: Db,
  libraryPath: string,
  onProgress?: (p: ImportProgress) => void,
): Promise<{ added: number; skipped: number; scanned: number }> {
  let added = 0;
  let skipped = 0;
  let scanned = 0;

  // Pre-load the set of cloud_paths we already have rows for. Lets us skip
  // stat() on the SMB share for the (overwhelming) common case of "file
  // already in DB". Cheap: ~25k strings is small, the table-scan is one
  // local SQLite query.
  const known = new Set<string>(
    (
      db
        .prepare(
          "SELECT cloud_path FROM songs WHERE cloud_path LIKE 'local://%'",
        )
        .all() as Array<{ cloud_path: string }>
    ).map((r) => r.cloud_path),
  );

  const insert = db.prepare(
    `INSERT INTO songs
     (title, artist, lang, genre, pinyin, artist_pinyin, cloud_path, size_bytes,
      cached, local_path, vocal_channel, year_int)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'L', ?)
     ON CONFLICT(cloud_path) DO UPDATE SET
       cached=1,
       local_path=excluded.local_path,
       size_bytes=excluded.size_bytes,
       artist=excluded.artist,
       artist_pinyin=excluded.artist_pinyin,
       year_int=excluded.year_int`,
  );

  const tick = (phase: ImportProgress["phase"], dir?: string) => {
    onProgress?.({ phase, current_dir: dir, scanned, added, skipped });
  };

  async function walk(dir: string, artistDir: string) {
    tick("listing", dir);
    let entries: Dirent[] = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const name = ent.name;
      const full = resolve(dir, name);
      if (ent.isDirectory()) {
        await walk(full, name);
        continue;
      }
      if (!VIDEO_EXTS.has(extname(name).toLowerCase())) continue;
      const cloudPath = `local://${full.replace(/\\/g, "/")}`;
      if (known.has(cloudPath)) {
        // already indexed — don't stat, don't UPSERT
        skipped++;
        scanned++;
        continue;
      }
      let st;
      try {
        st = await stat(full);
      } catch {
        continue;
      }
      scanned++;
      const parentDir = basename(dirname(full));
      const { title, artist, lang, genre } = parseFilename(name, parentDir);
      const pinyin = toPinyinInitials(title);
      const artistPinyin = toPinyinInitials(artist);
      try {
        insert.run(
          title,
          artist,
          lang,
          genre,
          pinyin,
          artistPinyin,
          cloudPath,
          st.size,
          full,
          extractYear(title),
        );
        known.add(cloudPath);
        added++;
        if (scanned % 25 === 0) tick("indexing", dirname(full));
      } catch {
        skipped++;
      }
      void artistDir;
    }
  }

  await walk(resolve(libraryPath), basename(libraryPath));
  tick("done");
  return { added, skipped, scanned };
}
