import type { FastifyInstance } from "fastify";
import type { Scanner } from "../scanner.ts";
import type { OpenListClient } from "../openlist-client.ts";
import type { Db } from "../db.ts";
import type { DownloadManager } from "../download-manager.ts";
import { importLocalLibrary } from "../local-importer.ts";
import { fetchPortraits, type PortraitProgress } from "../portrait-fetcher.ts";
import type { ScanProgress } from "../scanner.ts";
import type { ImportProgress } from "../local-importer.ts";
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
    return {
      running: baiduJob !== null,
      progress: lastBaiduProgress,
      error: lastBaiduError,
    };
  });

  fastify.post("/api/admin/baidu-scan/abort", async () => {
    if (baiduAbort) baiduAbort.abort();
    return { aborted: true };
  });

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
