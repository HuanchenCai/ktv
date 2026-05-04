import type { FastifyInstance } from "fastify";
import type { Scanner } from "../scanner.ts";
import type { OpenListClient } from "../openlist-client.ts";
import type { Db } from "../db.ts";
import type { DownloadManager } from "../download-manager.ts";
import { importLocalLibrary } from "../local-importer.ts";
import QRCode from "qrcode";
import { networkInterfaces } from "node:os";

export async function registerAdminRoutes(
  fastify: FastifyInstance,
  scanner: Scanner,
  openlist: OpenListClient,
  http_port: number,
  getOpenlistInitialPassword: () => string | null = () => null,
  db?: Db,
  libraryPath?: string,
  downloads?: DownloadManager,
): Promise<void> {
  fastify.post<{ Body: { max_depth?: number } }>(
    "/api/admin/scan",
    async (req, rep) => {
      try {
        const result = await scanner.scan({
          maxDepth: req.body?.max_depth ?? 3,
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
        const result = await importLocalLibrary(db, target);
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
