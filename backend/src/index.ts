import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { networkInterfaces as netIfaces } from "node:os";
import QRCode from "qrcode";

import { loadConfig, projectRoot } from "./config.ts";
import { openDb } from "./db.ts";
import { OpenListClient } from "./openlist-client.ts";
import { spawnOpenList, waitForOpenList } from "./openlist-spawner.ts";
import type { OpenListProcess } from "./openlist-spawner.ts";
import { MpvController } from "./mpv-controller.ts";
import { Orchestrator } from "./queue-orchestrator.ts";
import { Scanner } from "./scanner.ts";
import { registerSongsRoutes } from "./api/songs.ts";
import { registerQueueRoutes } from "./api/queue.ts";
import { registerControlRoutes } from "./api/control.ts";
import { registerAdminRoutes } from "./api/admin.ts";
import { registerWs } from "./ws.ts";

async function main() {
  const root = projectRoot();
  const config = loadConfig(root);

  mkdirSync(config.library_path, { recursive: true });

  const dbPath = resolve(root, "data", "ktv.db");
  const db = openDb(dbPath);

  // Backfill artist_pinyin for rows that pre-date the column. The migration
  // sets the column to '' by default — fill from the JS pinyin lib so old
  // libraries work with the new artist-pinyin search without needing a rescan.
  const stale = db
    .prepare(
      "SELECT id, artist FROM songs WHERE artist_pinyin = '' AND artist != ''",
    )
    .all() as Array<{ id: number; artist: string }>;
  if (stale.length > 0) {
    const { toPinyinInitials } = await import("./pinyin.ts");
    const upd = db.prepare("UPDATE songs SET artist_pinyin = ? WHERE id = ?");
    for (const row of stale) {
      upd.run(toPinyinInitials(row.artist), row.id);
    }
    console.log(`[main] backfilled artist_pinyin for ${stale.length} songs`);
  }

  // Drop locally-imported songs whose cloud_path doesn't match the current
  // library_path. This handles the case where the user changed library_path
  // (e.g. switched from a mapped drive Z: to a UNC path \\nas\share). Without
  // this, a re-scan of the new path inserts a parallel set of rows and the
  // catalog ~doubles. Baidu-pulled songs (cloud_path doesn't start with
  // "local://") and artist_portraits are preserved.
  {
    const expectedPrefix =
      "local://" + config.library_path.replace(/\\/g, "/");
    const orphanCount = (
      db
        .prepare(
          "SELECT COUNT(*) AS c FROM songs WHERE cloud_path LIKE 'local://%' AND cloud_path NOT LIKE ?",
        )
        .get(expectedPrefix + "%") as { c: number }
    ).c;
    if (orphanCount > 0) {
      const res = db
        .prepare(
          "DELETE FROM songs WHERE cloud_path LIKE 'local://%' AND cloud_path NOT LIKE ?",
        )
        .run(expectedPrefix + "%");
      console.log(
        `[main] library_path changed → dropped ${res.changes} stale local songs`,
      );
    }
  }

  // --- OpenList subprocess --------------------------------------------------

  const openlistUrl = `http://localhost:${config.openlist.port}`;
  let openlistProc: OpenListProcess | null = null;
  if (config.openlist.auto_spawn) {
    if (existsSync(config.openlist.binary_path)) {
      openlistProc = spawnOpenList({
        binaryPath: config.openlist.binary_path,
        dataDir: config.openlist.data_dir,
        port: config.openlist.port,
      });
      try {
        await waitForOpenList(openlistUrl, 30_000);
        console.log("[main] openlist is up");
      } catch (err) {
        console.warn("[main] openlist readiness timeout; continuing anyway:", err);
      }
    } else {
      console.warn(
        `[main] openlist binary not at ${config.openlist.binary_path} — run \`npm run fetch:openlist\`. skipping auto-spawn.`,
      );
    }
  }

  const openlist = new OpenListClient({
    baseUrl: openlistUrl,
    token: config.openlist.api_token,
  });

  // --- QR for the on-TV overlay ---------------------------------------------

  let qrPath: string | null = null;
  if (config.mpv.qr_overlay) {
    try {
      qrPath = resolve(root, "data", "qr.png");
      const lan = primaryLanIp();
      const url = `http://${lan ?? "localhost"}:${config.http_port}`;
      const png = await QRCode.toBuffer(url, {
        errorCorrectionLevel: "M",
        margin: 2,
        // 240px gives ~8 px/module for typical LAN URLs while staying
        // discreet as a corner overlay on a 1080p+ output.
        width: 240,
        color: { dark: "#000000", light: "#ffffff" },
      });
      mkdirSync(resolve(root, "data"), { recursive: true });
      writeFileSync(qrPath, png);
      console.log(`[main] QR for ${url} written to ${qrPath}`);
    } catch (err) {
      console.warn("[main] QR generation failed; overlay disabled:", err);
      qrPath = null;
    }
  }

  // --- mpv ------------------------------------------------------------------

  const mpv = new MpvController({
    vocalChannelDefault: config.vocal_channel_default,
    binaryPath: config.mpv.binary_path || undefined,
    fullscreen: config.mpv.fullscreen,
    qrOverlayPath: qrPath,
  });

  try {
    await mpv.start();
  } catch (err) {
    console.warn(
      `[main] mpv failed to start (will retry on first playback attempt):`,
      err,
    );
  }

  // --- Orchestrator ---------------------------------------------------------

  const orchestrator = new Orchestrator(db, openlist, mpv, config.library_path, {
    prefetchAhead: config.scheduler.prefetch_ahead,
    pollIntervalMs: config.scheduler.poll_interval_ms,
    baiduRoot: config.baidu_root,
  });
  orchestrator.start();

  const scanner = new Scanner(db, openlist, config.baidu_root);

  // --- HTTP server ----------------------------------------------------------

  const fastify = Fastify({
    logger: {
      level: "info",
      // Drop hostname/pid from every log line. On Chinese Windows the OS
      // hostname is multi-byte UTF-8 ("我的机") and cmd's default GBK code
      // page renders it as garbage. We don't need either field.
      base: undefined,
    },
  });

  // Be lenient about empty JSON bodies on POST: many of our control endpoints
  // (skip, replay, toggle-vocal, queue/:id/top, import-local) take no payload,
  // and our web client sends application/json without a body for those.
  fastify.removeContentTypeParser("application/json");
  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      if (typeof body !== "string" || body.length === 0) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(body));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  await fastify.register(fastifyWebsocket);

  // Serve built web UI if present
  const webDist = resolve(root, "web", "dist");
  if (existsSync(webDist)) {
    await fastify.register(fastifyStatic, {
      root: webDist,
      prefix: "/",
      wildcard: false,
    });
    // SPA fallback
    fastify.setNotFoundHandler(async (req, rep) => {
      if (req.url.startsWith("/api") || req.url === "/ws") {
        return rep.code(404).send({ error: "not found" });
      }
      return rep.sendFile("index.html");
    });
  } else {
    fastify.get("/", async () => ({
      ok: true,
      message: "KTV backend running. Web UI not yet built.",
      build_command: "npm run build:web",
    }));
  }

  await registerSongsRoutes(fastify, db);
  await registerQueueRoutes(fastify, orchestrator);
  await registerControlRoutes(fastify, orchestrator, mpv);
  // Static serve cached portraits (data/portraits/<sha>.{jpg,png,...}).
  // Wikidata/Wikipedia images are CC-BY/CC-BY-SA — attribution lives on the
  // /api/artists rows, not in the file response, but the file itself is fine
  // to serve directly.
  const portraitsDir = resolve(root, "data", "portraits");
  mkdirSync(portraitsDir, { recursive: true });
  await fastify.register(fastifyStatic, {
    root: portraitsDir,
    prefix: "/portraits/",
    decorateReply: false,
    wildcard: false,
  });

  // Admin events: portrait fetcher progress is broadcast via WS.
  const adminEvents = new (await import("node:events")).EventEmitter();

  await registerAdminRoutes(
    fastify,
    scanner,
    openlist,
    config.http_port,
    () => openlistProc?.getInitialPassword() ?? null,
    db,
    config.library_path,
    root,
    adminEvents as Parameters<typeof registerAdminRoutes>[8],
  );
  await registerWs(fastify, orchestrator, adminEvents);

  fastify.get("/api/health", async () => {
    const songCount = (
      db.prepare("SELECT COUNT(*) AS c FROM songs").get() as { c: number }
    ).c;
    const cachedCount = (
      db
        .prepare("SELECT COUNT(*) AS c FROM songs WHERE cached = 1")
        .get() as { c: number }
    ).c;
    return {
      ok: true,
      openlist_up: await openlist.ping(),
      openlist_admin_url: openlistUrl,
      mpv_ready: !!config.mpv.binary_path || true, // controller warns if unavailable
      library_path: config.library_path,
      db_songs: songCount,
      db_cached: cachedCount,
    };
  });

  try {
    await fastify.listen({ port: config.http_port, host: "0.0.0.0" });
    const nets = netIfaces();
    const lan: string[] = [];
    for (const ifaces of Object.values(nets)) {
      for (const net of ifaces ?? []) {
        if (net.family === "IPv4" && !net.internal) lan.push(net.address);
      }
    }
    console.log("");
    console.log("================================================");
    console.log("  KTV is up.");
    console.log(`    local:       http://localhost:${config.http_port}`);
    if (lan.length) {
      console.log(`    LAN (phone): http://${lan[0]}:${config.http_port}`);
    }
    console.log(`    admin:       http://localhost:${config.http_port}/admin`);
    console.log(`    OpenList:    ${openlistUrl}`);
    const pw = openlistProc?.getInitialPassword();
    if (pw) {
      console.log(`    OpenList initial admin password: ${pw}`);
    }
    console.log(`    library:     ${config.library_path}`);
    console.log("================================================");
    console.log("");
  } catch (err) {
    console.error(err);
    process.exit(1);
  }

  // Auto-import any new MKV files in library_path on every boot. The DB is
  // sticky across restarts (UPSERT on cloud_path), so re-runs are cheap; new
  // downloads since last boot show up automatically without the user
  // clicking 扫描. Runs in the background — we don't block startup on it.
  setTimeout(() => {
    void (async () => {
      try {
        const { importLocalLibrary } = await import("./local-importer.ts");
        const before = (
          db.prepare("SELECT COUNT(*) AS c FROM songs").get() as {
            c: number;
          }
        ).c;
        const r = await importLocalLibrary(db, config.library_path, (p) =>
          adminEvents.emit("import.progress", p),
        );
        const after = (
          db.prepare("SELECT COUNT(*) AS c FROM songs").get() as {
            c: number;
          }
        ).c;
        const added = after - before;
        if (added > 0 || r.scanned > 0) {
          console.log(
            `[startup-import] scanned ${r.scanned} files, +${added} new (now ${after} in db)`,
          );
        }
      } catch (err) {
        console.warn("[startup-import] failed:", err);
      }
    })();
  }, 5000);

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n[main] shutting down ...");
    orchestrator.stop();
    try {
      await mpv.shutdown();
    } catch {
      /* ignore */
    }
    try {
      await fastify.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

function primaryLanIp(): string | null {
  const nets = netIfaces();
  for (const ifaces of Object.values(nets)) {
    for (const net of ifaces ?? []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return null;
}

// Last-ditch crash visibility. Without these handlers, an unhandled
// rejection from any fire-and-forget background task would silently kill
// the process with no stack trace in the user's terminal.
process.on("uncaughtException", (err, origin) => {
  console.error(`\n[uncaughtException] origin=${origin}\n`, err);
});
process.on("unhandledRejection", (reason, p) => {
  console.error("\n[unhandledRejection]\n", reason, "\nat:", p);
});

main().catch((err) => {
  console.error("[main] fatal:", err);
  process.exit(1);
});
