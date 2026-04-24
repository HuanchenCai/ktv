import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

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

  // --- mpv ------------------------------------------------------------------

  const mpv = new MpvController({
    vocalChannelDefault: config.vocal_channel_default,
    binaryPath: config.mpv.binary_path || undefined,
    fullscreen: config.mpv.fullscreen,
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

  const fastify = Fastify({ logger: { level: "info" } });

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
  await registerAdminRoutes(
    fastify,
    scanner,
    openlist,
    config.http_port,
    () => openlistProc?.getInitialPassword() ?? null,
  );
  await registerWs(fastify, orchestrator);

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
    console.log(`[main] KTV backend on http://localhost:${config.http_port}`);
    console.log(`[main] OpenList admin on ${openlistUrl}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }

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

main().catch((err) => {
  console.error("[main] fatal:", err);
  process.exit(1);
});
