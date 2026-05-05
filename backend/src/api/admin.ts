import type { FastifyInstance } from "fastify";
import type { Scanner } from "../scanner.ts";
import type { OpenListClient } from "../openlist-client.ts";
import type { Db } from "../db.ts";
import type { DownloadManager } from "../download-manager.ts";
import { importLocalLibrary } from "../local-importer.ts";
import { fetchPortraits, type PortraitProgress } from "../portrait-fetcher.ts";
import { parseFilename, type ScanProgress } from "../scanner.ts";
import type { ImportProgress } from "../local-importer.ts";
import { extractYear } from "../db.ts";
import { toPinyinInitials } from "../pinyin.ts";
import {
  scanBaidu,
  type BaiduScanProgress,
} from "../baidu-scanner.ts";
import { pickFolder } from "../folder-picker.ts";
import QRCode from "qrcode";
import { networkInterfaces } from "node:os";
import { EventEmitter } from "node:events";

export type AdminEvents = EventEmitter & {
  emit(event: "portrait.progress", data: PortraitProgress): boolean;
  emit(event: "scan.progress", data: ScanProgress): boolean;
  emit(event: "import.progress", data: ImportProgress): boolean;
  emit(event: "baidu-scan.progress", data: BaiduScanProgress): boolean;
};

export async function registerAdminRoutes(
  fastify: FastifyInstance,
  scanner: Scanner,
  openlist: OpenListClient,
  http_port: number,
  getOpenlistInitialPassword: () => string | null = () => null,
  db?: Db,
  libraryPath?: string,
  projectRoot?: string,
  events?: AdminEvents,
  downloads?: DownloadManager,
  baiduCreds?: { bduss?: string; stoken?: string },
): Promise<void> {
  let portraitJob: Promise<PortraitProgress> | null = null;
  let lastPortraitProgress: PortraitProgress | null = null;

  // Baidu cloud scan: one job at a time, abortable
  let baiduJob: Promise<unknown> | null = null;
  let baiduAbort: AbortController | null = null;
  let lastBaiduProgress: BaiduScanProgress | null = null;
  let lastBaiduError: string | null = null;
  fastify.post<{ Body: { max_depth?: number } }>(
    "/api/admin/scan",
    async (req, rep) => {
      try {
        const result = await scanner.scan({
          maxDepth: req.body?.max_depth ?? 3,
          onProgress: (p) => events?.emit("scan.progress", p),
        });
        return result;
      } catch (err) {
        return rep.code(500).send({
          error: err instanceof Error ? err.message : String(err),
          hint:
            "check config.json.baidu_root and that OpenList has the Baidu storage configured + api_token is set",
        });
      }
    },
  );

  fastify.get("/api/admin/openlist-status", async () => {
    const alive = await openlist.ping();
    return {
      alive,
      initial_password: getOpenlistInitialPassword(),
    };
  });

  fastify.get("/api/admin/qrcode", async () => {
    const lanIps = getLanIps();
    const host = lanIps[0] ?? "localhost";
    const url = `http://${host}:${http_port}`;
    const dataUrl = await QRCode.toDataURL(url, {
      errorCorrectionLevel: "M",
      width: 256,
    });
    return { url, qr_data_url: dataUrl, lan_ips: lanIps };
  });

  /**
   * Kick off the portrait fetcher in the background. Returns immediately
   * (200 with current progress); progress updates fan out via WebSocket as
   * the `portrait.progress` event.
   */
  fastify.post<{
    Body: { min_song_count?: number; force?: boolean };
  }>("/api/admin/fetch-portraits", async (req, rep) => {
    if (!db || !projectRoot) {
      return rep.code(500).send({ error: "fetch-portraits not wired up" });
    }
    if (portraitJob) {
      return { running: true, progress: lastPortraitProgress };
    }
    const minSongCount = req.body?.min_song_count ?? 1;
    const force = !!req.body?.force;
    portraitJob = fetchPortraits(db, {
      minSongCount,
      force,
      projectRoot,
      onProgress: (p) => {
        lastPortraitProgress = { ...p };
        events?.emit("portrait.progress", lastPortraitProgress);
      },
    })
      .catch((err) => {
        console.error("[portraits] job failed:", err);
        const errored: PortraitProgress = {
          total: 0,
          done: 0,
          ok: 0,
          missed: 0,
          current: null,
        };
        return errored;
      })
      .finally(() => {
        portraitJob = null;
      });
    return { running: true, progress: lastPortraitProgress };
  });

  fastify.get("/api/admin/portrait-progress", async () => {
    return {
      running: portraitJob !== null,
      progress: lastPortraitProgress,
    };
  });

  /**
   * Walk the user's Baidu cloud (via cookie / BDUSS) and upsert songs into
   * the DB as cached=0 placeholders. Same logic as the baidu-direct-scan
   * CLI, just exposed for the web UI. Job runs in the background; progress
   * fans out via WS as `baidu-scan.progress`.
   */
  fastify.post<{
    Body: { root?: string; max_depth?: number };
  }>("/api/admin/baidu-scan", async (req, rep) => {
    if (!db) {
      return rep.code(500).send({ error: "baidu-scan not wired up" });
    }
    if (baiduJob) {
      return { running: true, progress: lastBaiduProgress };
    }
    const bduss = baiduCreds?.bduss ?? "";
    if (!bduss) {
      return rep.code(400).send({
        error: "BDUSS not configured. Set baidu.bduss in config.json.",
      });
    }
    baiduAbort = new AbortController();
    lastBaiduError = null;
    const requestedRoot = req.body?.root ?? "/KTV";
    console.log(
      `[baidu-scan] starting root=${requestedRoot} bduss.len=${bduss.length} stoken=${baiduCreds?.stoken ? "set" : "empty"}`,
    );
    baiduJob = scanBaidu(db, {
      bduss,
      stoken: baiduCreds?.stoken,
      root: requestedRoot,
      maxDepth: req.body?.max_depth ?? 20,
      abortSignal: baiduAbort.signal,
      onProgress: (p) => {
        lastBaiduProgress = p;
        events?.emit("baidu-scan.progress", p);
      },
    })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        lastBaiduError = msg;
        console.error("[baidu-scan] failed:", msg);
      })
      .finally(() => {
        baiduJob = null;
        baiduAbort = null;
      });
    return { running: true, progress: lastBaiduProgress };
  });

  fastify.get("/api/admin/baidu-scan/state", async () => {
    // MAX(last_seen_at) is the timestamp of the most-recently-finished
    // scan (every UPSERT in the scan stamps this column). Lets the UI
    // show "上次扫描: 2024-01-02 13:45" so the user can decide whether
    // to bother running it again.
    let lastScannedAt: number | null = null;
    if (db) {
      const r = db
        .prepare(
          "SELECT MAX(last_seen_at) AS m FROM songs WHERE last_seen_at IS NOT NULL",
        )
        .get() as { m: number | null } | undefined;
      lastScannedAt = r?.m ?? null;
    }
    return {
      running: baiduJob !== null,
      progress: lastBaiduProgress,
      error: lastBaiduError,
      last_scanned_at: lastScannedAt,
    };
  });

  fastify.post("/api/admin/baidu-scan/abort", async () => {
    if (baiduAbort) baiduAbort.abort();
    return { aborted: true };
  });

  /**
   * Re-run parseFilename() over every song row's cloud_path, rewriting
   * title / artist / lang / genre / pinyin / artist_pinyin / year_int
   * in place. Use after a parser bugfix so the existing 25k+ rows pick
   * up the corrected logic without re-scanning the filesystem.
   *
   * Defaults to dry_run=true. Returns up to 30 sample changes for review.
   */
  fastify.post<{ Body: { apply?: boolean } }>(
    "/api/admin/reparse-filenames",
    async (req) => {
      if (!db) return { error: "no db" };
      const apply = req.body?.apply === true;

      type Row = {
        id: number;
        title: string;
        artist: string;
        cloud_path: string;
      };
      const rows = db
        .prepare("SELECT id, title, artist, cloud_path FROM songs")
        .all() as Row[];

      let changed = 0;
      const sample: Array<{
        id: number;
        before: { title: string; artist: string };
        after: { title: string; artist: string };
      }> = [];

      const update = db.prepare(
        `UPDATE songs SET
           title = ?, artist = ?, lang = ?, genre = ?,
           pinyin = ?, artist_pinyin = ?, year_int = ?
         WHERE id = ?`,
      );

      // For UNIX-style paths (incl. local:////host/share/...) the parent
      // directory is between the last two slashes.
      function dirAndFile(p: string): { dir: string; file: string } {
        const path = p.replace(/^local:\/\//, "");
        const i = path.lastIndexOf("/");
        if (i < 0) return { dir: "", file: path };
        const file = path.slice(i + 1);
        const before = path.slice(0, i);
        const j = before.lastIndexOf("/");
        const dir = j < 0 ? before : before.slice(j + 1);
        return { dir, file };
      }

      const tx = (): void => {
        for (const r of rows) {
          const { dir, file } = dirAndFile(r.cloud_path);
          const parsed = parseFilename(file, dir);
          if (parsed.title === r.title && parsed.artist === r.artist) continue;
          if (sample.length < 30) {
            sample.push({
              id: r.id,
              before: { title: r.title, artist: r.artist },
              after: { title: parsed.title, artist: parsed.artist },
            });
          }
          changed++;
          if (apply) {
            update.run(
              parsed.title,
              parsed.artist,
              parsed.lang,
              parsed.genre,
              toPinyinInitials(parsed.title),
              toPinyinInitials(parsed.artist),
              extractYear(parsed.title),
              r.id,
            );
          }
        }
      };

      if (apply) {
        db.exec("BEGIN");
        try {
          tx();
          db.exec("COMMIT");
        } catch (err) {
          db.exec("ROLLBACK");
          throw err;
        }
      } else {
        tx();
      }

      return {
        dry_run: !apply,
        scanned: rows.length,
        changed,
        sample,
      };
    },
  );

  /**
   * Dedupe the songs library by (artist, normalized title).
   *
   * Normalization: lowercase, NFKC, drop ALL bracketed annotations such as
   * [HD] / (MV) / 【MTV】 / 【演唱会版】 — those are publisher tags, not
   * different songs. But a literal "演唱会" / "现场" / "MV" / "MTV" word
   * in the title is treated as a *different* song variant (kept).
   *
   * Among duplicates we KEEP the row with the strongest provenance:
   *   1. cached + local file exists  (we have it on disk)
   *   2. cached but local missing
   *   3. cloud_path starts with "local://" (intent: local library)
   *   4. anything else (Baidu placeholder)
   * On ties, lowest id wins (oldest row).
   *
   * Defaults to dry_run=true. Pass { apply: true } to actually delete.
   */
  fastify.post<{ Body: { apply?: boolean } }>(
    "/api/admin/dedupe",
    async (req) => {
      if (!db) return { error: "no db" };
      const apply = req.body?.apply === true;

      // Tag = a *different* variant — keep these even if title-base matches.
      const variantWords = [
        "演唱会", "现场", "Live", "live", "LIVE",
      ];
      const variantRe = new RegExp(`(${variantWords.join("|")})`);

      function normTitle(raw: string): { base: string; variantTag: string } {
        let s = (raw ?? "").trim();
        // Strip all bracketed annotations (any of () [] 【】 （）).
        s = s
          .replace(/[\[【(（][^\]】)）]*[\]】)）]/g, "")
          .replace(/\s+/g, " ")
          .trim();
        // Capture variant words in the surviving title (live, 演唱会, ...)
        const m = s.match(variantRe);
        const variantTag = m ? m[1] : "";
        // Drop the variant word from the comparison base too — but the
        // tag itself is what differentiates rows of the same song.
        const base = s.replace(variantRe, "").trim().toLowerCase();
        return { base, variantTag };
      }

      type Row = {
        id: number;
        title: string;
        artist: string;
        cached: number;
        local_path: string | null;
        cloud_path: string;
      };
      const rows = db
        .prepare(
          `SELECT id, title, artist, cached, local_path, cloud_path
           FROM songs ORDER BY id ASC`,
        )
        .all() as Row[];

      // Group key = artist (lowercased+trimmed) + normalized title base
      // + variant tag. Different variants (live vs studio) get different
      // keys so they don't collapse.
      const fs = await import("node:fs");
      function score(r: Row): number {
        if (
          r.cached === 1 &&
          r.local_path &&
          fs.existsSync(r.local_path)
        )
          return 4;
        if (r.cached === 1) return 3;
        if (r.cloud_path.startsWith("local://")) return 2;
        return 1;
      }

      const groups = new Map<string, Row[]>();
      for (const r of rows) {
        const a = (r.artist ?? "").trim().toLowerCase();
        if (!a || !r.title) continue;
        const { base, variantTag } = normTitle(r.title);
        if (!base) continue;
        const key = `${a}${base}${variantTag}`;
        const arr = groups.get(key);
        if (arr) arr.push(r);
        else groups.set(key, [r]);
      }

      const toDelete: number[] = [];
      const sample: Array<{ kept: Row; removed: Row[] }> = [];
      for (const arr of groups.values()) {
        if (arr.length < 2) continue;
        // Keep highest-scoring; ties → lowest id.
        arr.sort((a, b) => {
          const s = score(b) - score(a);
          if (s !== 0) return s;
          return a.id - b.id;
        });
        const [kept, ...rest] = arr;
        for (const r of rest) toDelete.push(r.id);
        if (sample.length < 20) sample.push({ kept, removed: rest });
      }

      let deleted = 0;
      if (apply && toDelete.length) {
        // Refuse to delete a row that's currently in the queue. Drop those
        // ids from the delete list.
        const inQueue = new Set(
          (
            db
              .prepare("SELECT song_id FROM queue")
              .all() as Array<{ song_id: number }>
          ).map((r) => r.song_id),
        );
        const safe = toDelete.filter((id) => !inQueue.has(id));
        const stmt = db.prepare("DELETE FROM songs WHERE id = ?");
        for (const id of safe) {
          stmt.run(id);
          deleted++;
        }
      }

      return {
        dry_run: !apply,
        groups_with_dupes: sample.length === 20 ? "20+" : sample.length,
        candidates_to_delete: toDelete.length,
        deleted,
        sample: sample.slice(0, 10).map((g) => ({
          kept: { id: g.kept.id, title: g.kept.title, artist: g.kept.artist },
          removed: g.removed.map((r) => ({
            id: r.id,
            title: r.title,
            artist: r.artist,
          })),
        })),
      };
    },
  );

  /**
   * Pop up a native folder picker on the host machine and return whatever
   * the user selected. Used by the admin page so the user can graphically
   * choose a folder instead of typing its absolute path. Network shares
   * (UNC) are reachable from the picker too.
   */
  fastify.post("/api/admin/pick-folder", async (_req, rep) => {
    try {
      const path = await pickFolder(libraryPath);
      return { path };
    } catch (err) {
      return rep
        .code(500)
        .send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * Add any local MKV/MP4 files in library_path as already-cached songs.
   * Bypass for smoke-testing playback without Baidu configuration.
   * Optional body: { path: "H:/SomeFolder" } to scan a different directory.
   */
  // --- batch download via BDUSS-direct downloader -------------------------
  if (downloads && db) {
    fastify.post<{ Body: { ids?: number[] } }>(
      "/api/admin/download/batch",
      async (req, rep) => {
        const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
        if (ids.length === 0) {
          return rep.code(400).send({ error: "ids required" });
        }
        const placeholders = ids.map(() => "?").join(",");
        const rows = db
          .prepare(
            `SELECT id, title, artist, cloud_path, size_bytes
             FROM songs WHERE id IN (${placeholders})`,
          )
          .all(...ids) as Array<{
          id: number;
          title: string;
          artist: string;
          cloud_path: string;
          size_bytes: number | null;
        }>;
        const added = downloads.enqueue(rows);
        downloads.start();
        return {
          enqueued: added.length,
          total_in_session: downloads.getCounts().total,
        };
      },
    );

    fastify.get("/api/admin/download/state", async () => {
      return {
        counts: downloads.getCounts(),
        tasks: downloads.getTasks(),
      };
    });

    fastify.post("/api/admin/download/abort", async () => {
      downloads.abortAll();
      return { aborted: true };
    });
  }

  fastify.post<{ Body: { path?: string } }>(
    "/api/admin/import-local",
    async (req, rep) => {
      if (!db || !libraryPath) {
        return rep.code(500).send({ error: "import-local not wired up" });
      }
      const target = req.body?.path?.trim() || libraryPath;
      try {
        const result = await importLocalLibrary(db, target, (p) =>
          events?.emit("import.progress", p),
        );
        return { ...result, scanned_path: target };
      } catch (err) {
        return rep
          .code(500)
          .send({
            error: err instanceof Error ? err.message : String(err),
            scanned_path: target,
          });
      }
    },
  );
}

function getLanIps(): string[] {
  const nets = networkInterfaces();
  const ips: string[] = [];
  for (const ifaces of Object.values(nets)) {
    if (!ifaces) continue;
    for (const net of ifaces) {
      if (net.family === "IPv4" && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}
