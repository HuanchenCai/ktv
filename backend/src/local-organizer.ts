/**
 * Re-organize the local MKV library into `<libraryPath>/<artist>/<file>`.
 *
 * Picks the *primary* artist out of collab strings ("林俊杰_周杰伦" →
 * "林俊杰", "范玮琪&张韶涵" → "范玮琪"). Sanitizes path components so
 * they're legal on Windows/macOS/Linux. Renames the file AND updates
 * the matching DB row's cloud_path + local_path in one go so the
 * playback pipeline keeps pointing at the right file afterwards.
 *
 * Two-step API:
 *   planMoves(db, libraryPath) → return everything we'd do (no fs touch)
 *   applyMoves(db, libraryPath, moves, opts) → actually move N at a time
 *
 * Safety:
 *   - Skips rows that are already in <artist>/ form
 *   - Skips songs currently in the queue (would yank a playing file)
 *   - On filename collision, appends " (2)", " (3)", … instead of overwriting
 *   - Only touches cached=1 / cloud_path starts with "local://"
 *   - Detects collisions across the whole batch (two distinct source
 *     files trying to land at the same target both get suffixed)
 */
import { renameSync, mkdirSync, existsSync } from "node:fs";
import { resolve, basename, dirname, extname } from "node:path";
import type { Db } from "./db.ts";

const WIN_RESERVED = /[<>:"/\\|?*\x00-\x1f]/g;

export function sanitizeFilename(name: string): string {
  // Replace Windows-illegal characters; collapse runs of whitespace.
  // Trailing dots / spaces are illegal on Windows too — trim them.
  const cleaned = (name ?? "")
    .replace(WIN_RESERVED, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  return cleaned.length > 0 ? cleaned : "_";
}

/**
 * Pull the leading "primary" artist out of a multi-singer artist string.
 * Splits on `_` (collab convention from the filename parser), ` & ` /
 * `&`, ` / `, `^`, plain whitespace and a couple of full-width variants.
 * If there are no separators, returns the whole string.
 */
export function primaryArtist(artist: string): string {
  const a = (artist ?? "").trim();
  if (!a) return "unknown";
  // Common multi-artist separators in this library.
  const parts = a.split(/[_&/／^＆,，、]| {2,}/).map((s) => s.trim());
  const first = parts.find((p) => p.length > 0);
  return first ?? a;
}

type Row = {
  id: number;
  title: string;
  artist: string;
  cloud_path: string;
  local_path: string | null;
};

export type PlannedMove = {
  id: number;
  artist: string;
  title: string;
  from: string;
  to: string;
  /** True when an earlier item in the same plan already claims `to`. */
  collides_with_plan: boolean;
};

export type PlanResult = {
  total_local_rows: number;
  in_queue_skipped: number;
  already_organized: number;
  to_move: number;
  sample: PlannedMove[];
};

export type ApplyResult = {
  attempted: number;
  moved: number;
  failed: Array<{ id: number; from: string; to: string; error: string }>;
};

export type OrganizeProgress = {
  phase: "planning" | "moving" | "done" | "failed";
  total: number;
  moved: number;
  failed: number;
  current_from: string | null;
  current_to: string | null;
  error?: string | null;
};

/**
 * Return the absolute target path for a row, given a library root.
 * Doesn't reserve / collision-check — that's the planner's job.
 */
function targetPathFor(
  row: Row,
  libraryPath: string,
): string {
  const ext = extname(row.local_path ?? row.cloud_path) || ".mkv";
  const artistDir = sanitizeFilename(primaryArtist(row.artist));
  // Keep the original title verbatim in the new filename so the user can
  // still see "周杰伦-纽约地铁-国语-流行" style on disk if that's what
  // they have. We DO sanitize for filesystem safety.
  const safeTitle = sanitizeFilename(row.title);
  return resolve(libraryPath, artistDir, safeTitle + ext);
}

/**
 * Path components on Windows / SMB are case-insensitive but the OS
 * preserves case. Use a normalized form for collision detection so two
 * rows that differ only in case don't both succeed.
 */
function normKey(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

export function planMoves(db: Db, libraryPath: string): PlanResult {
  const rows = db
    .prepare(
      `SELECT id, title, artist, cloud_path, local_path FROM songs
       WHERE cached = 1
         AND cloud_path LIKE 'local://%'
         AND local_path IS NOT NULL`,
    )
    .all() as Row[];

  const queueIds = new Set(
    (db.prepare("SELECT song_id FROM queue").all() as Array<{ song_id: number }>)
      .map((r) => r.song_id),
  );

  let inQueueSkipped = 0;
  let alreadyOrganized = 0;
  const moves: PlannedMove[] = [];
  // Collision tracking: any normalized target path already claimed by a
  // prior move (or by a file we're not moving) suffixes the next claimant.
  const claimed = new Set<string>();

  for (const r of rows) {
    if (queueIds.has(r.id)) {
      inQueueSkipped++;
      continue;
    }
    const from = r.local_path ?? "";
    if (!from) continue;

    const ideal = targetPathFor(r, libraryPath);
    if (normKey(ideal) === normKey(from)) {
      alreadyOrganized++;
      claimed.add(normKey(ideal));
      continue;
    }

    // Resolve collisions: append " (2)", " (3)", … until free.
    let to = ideal;
    let collides = claimed.has(normKey(to));
    if (collides) {
      const ext = extname(ideal);
      const stem = ideal.slice(0, -ext.length || undefined);
      let n = 2;
      while (claimed.has(normKey(`${stem} (${n})${ext}`))) n++;
      to = `${stem} (${n})${ext}`;
    }
    claimed.add(normKey(to));

    moves.push({
      id: r.id,
      artist: r.artist,
      title: r.title,
      from,
      to,
      collides_with_plan: collides,
    });
  }

  return {
    total_local_rows: rows.length,
    in_queue_skipped: inQueueSkipped,
    already_organized: alreadyOrganized,
    to_move: moves.length,
    sample: moves.slice(0, 50),
  };
}

/**
 * Execute a list of moves, updating the matching DB rows in lock-step so
 * cloud_path / local_path always agree with what's on disk.
 *
 * Runs synchronously per move (cross-directory rename inside the same
 * SMB share is a metadata-only operation, ~ms). The opts.onProgress
 * callback is invoked every few moves so a long batch can stream status.
 *
 * NOT wrapped in a single DB transaction by design: if a rename fails
 * mid-batch we want to keep the already-moved rows' DB pointers correct
 * (file is at `to`), not roll the whole thing back.
 */
export function applyMoves(
  db: Db,
  libraryPath: string,
  opts: {
    maxFiles?: number;
    abortSignal?: AbortSignal;
    onProgress?: (p: OrganizeProgress) => void;
  } = {},
): ApplyResult {
  const plan = planMoves(db, libraryPath);
  const max = opts.maxFiles ?? Number.POSITIVE_INFINITY;

  // We need the full plan (not just sample) for an apply.
  // planMoves returned sample-only — replay the full list here.
  const rows = db
    .prepare(
      `SELECT id, title, artist, cloud_path, local_path FROM songs
       WHERE cached = 1
         AND cloud_path LIKE 'local://%'
         AND local_path IS NOT NULL`,
    )
    .all() as Row[];
  const queueIds = new Set(
    (db.prepare("SELECT song_id FROM queue").all() as Array<{ song_id: number }>)
      .map((r) => r.song_id),
  );
  const claimed = new Set<string>();
  const fullMoves: PlannedMove[] = [];
  for (const r of rows) {
    if (queueIds.has(r.id)) continue;
    const from = r.local_path ?? "";
    if (!from) continue;
    const ideal = targetPathFor(r, libraryPath);
    if (normKey(ideal) === normKey(from)) {
      claimed.add(normKey(ideal));
      continue;
    }
    let to = ideal;
    let collides = claimed.has(normKey(to));
    if (collides) {
      const ext = extname(ideal);
      const stem = ideal.slice(0, -ext.length || undefined);
      let n = 2;
      while (claimed.has(normKey(`${stem} (${n})${ext}`))) n++;
      to = `${stem} (${n})${ext}`;
    }
    claimed.add(normKey(to));
    fullMoves.push({
      id: r.id,
      artist: r.artist,
      title: r.title,
      from,
      to,
      collides_with_plan: collides,
    });
    if (fullMoves.length >= max) break;
  }
  void plan; // sample is for the dry-run path; not needed here

  const update = db.prepare(
    "UPDATE songs SET local_path = ?, cloud_path = ? WHERE id = ?",
  );

  const result: ApplyResult = { attempted: 0, moved: 0, failed: [] };
  const total = fullMoves.length;
  const tick = (
    phase: OrganizeProgress["phase"],
    from: string | null,
    to: string | null,
    error?: string,
  ) => {
    opts.onProgress?.({
      phase,
      total,
      moved: result.moved,
      failed: result.failed.length,
      current_from: from,
      current_to: to,
      error: error ?? null,
    });
  };

  tick("moving", null, null);
  let lastEmitTs = 0;

  for (const mv of fullMoves) {
    if (opts.abortSignal?.aborted) break;
    result.attempted++;
    try {
      // Target collisions with an existing file ON DISK (not just the
      // plan) — bump suffix until free. The plan-level collision check
      // covered cross-row claims; this catches files we never indexed.
      let dest = mv.to;
      if (existsSync(dest) && normKey(dest) !== normKey(mv.from)) {
        const ext = extname(mv.to);
        const stem = mv.to.slice(0, -ext.length || undefined);
        let n = 2;
        while (existsSync(`${stem} (${n})${ext}`)) n++;
        dest = `${stem} (${n})${ext}`;
      }
      mkdirSync(dirname(dest), { recursive: true });
      renameSync(mv.from, dest);
      const newCloudPath = "local://" + dest.replace(/\\/g, "/");
      update.run(dest, newCloudPath, mv.id);
      result.moved++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.failed.push({ id: mv.id, from: mv.from, to: mv.to, error: msg });
    }
    const now = Date.now();
    if (now - lastEmitTs > 300) {
      lastEmitTs = now;
      tick("moving", mv.from, mv.to);
    }
  }
  tick("done", null, null);
  // unused vars on some platforms
  void basename;
  return result;
}
