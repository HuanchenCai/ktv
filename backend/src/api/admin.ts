import type { FastifyInstance } from "fastify";
import type { Scanner } from "../scanner.ts";
import type { OpenListClient } from "../openlist-client.ts";
import type { Db } from "../db.ts";
import { importLocalLibrary } from "../local-importer.ts";
import { fetchPortraits, type PortraitProgress } from "../portrait-fetcher.ts";
import type { ScanProgress } from "../scanner.ts";
import type { ImportProgress } from "../local-importer.ts";
import { pickFolder } from "../folder-picker.ts";
import QRCode from "qrcode";
import { networkInterfaces } from "node:os";
import { EventEmitter } from "node:events";

export type AdminEvents = EventEmitter & {
  emit(event: "portrait.progress", data: PortraitProgress): boolean;
  emit(event: "scan.progress", data: ScanProgress): boolean;
  emit(event: "import.progress", data: ImportProgress): boolean;
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
): Promise<void> {
  let portraitJob: Promise<PortraitProgress> | null = null;
  let lastPortraitProgress: PortraitProgress | null = null;
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
