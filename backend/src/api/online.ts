import type { FastifyInstance } from "fastify";
import type { Db } from "../db.ts";
import type { Orchestrator } from "../queue-orchestrator.ts";
import {
  search,
  hotlist,
  probeYtDlp,
  makeCloudPath,
  type OnlineSource,
  type OnlineConfig,
} from "../online-source.ts";
import { toPinyinInitials } from "../pinyin.ts";

/**
 * Online search + enqueue. The search endpoints don't touch the DB;
 * `/enqueue` UPSERTs one row into songs (cloud_path = online://...)
 * and then defers to the orchestrator's normal enqueue path, so the
 * online video shows up in the same /queue with the same lifecycle
 * as a local or Baidu song.
 */
export async function registerOnlineRoutes(
  fastify: FastifyInstance,
  db: Db,
  orchestrator: Orchestrator,
  cfg: OnlineConfig,
): Promise<void> {
  fastify.get("/api/online/status", async () => {
    return {
      enabled: cfg.enabled,
      youtube_enabled: cfg.youtube_enabled,
      douyin_enabled: cfg.douyin_enabled,
      yt_dlp_installed: probeYtDlp(cfg) !== null,
      yt_dlp_path: probeYtDlp(cfg),
    };
  });

  fastify.post<{
    Body: { source: OnlineSource; query: string; limit?: number };
  }>("/api/online/search", async (req, rep) => {
    if (!cfg.enabled) return rep.code(400).send({ error: "online disabled" });
    const { source, query, limit } = req.body ?? {};
    if (!source || !query || !query.trim()) {
      return rep.code(400).send({ error: "source and query required" });
    }
    try {
      const results = await search(cfg, source, query.trim(), limit ?? 20);
      return { results };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return rep.code(500).send({ error: msg });
    }
  });

  fastify.post<{ Body: { source: OnlineSource; limit?: number } }>(
    "/api/online/hot",
    async (req, rep) => {
      if (!cfg.enabled) return rep.code(400).send({ error: "online disabled" });
      const { source, limit } = req.body ?? { source: "yt" };
      try {
        const results = await hotlist(cfg, source, limit ?? 50);
        return { results };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return rep.code(500).send({ error: msg });
      }
    },
  );

  /**
   * Add a remote video to the queue.
   * UPSERTs one row in songs (cloud_path = "online://<src>/<id>") so the
   * row is discoverable from /api/songs etc.; then calls
   * orchestrator.enqueue with the new id. Idempotent — clicking 点歌
   * twice doesn't create two rows.
   */
  fastify.post<{
    Body: {
      source: OnlineSource;
      video_id: string;
      title: string;
      channel?: string | null;
      duration_seconds?: number | null;
      thumbnail?: string | null;
      added_by?: string | null;
      top?: boolean;
    };
  }>("/api/online/enqueue", async (req, rep) => {
    if (!cfg.enabled) return rep.code(400).send({ error: "online disabled" });
    const body = req.body;
    if (!body?.source || !body.video_id || !body.title) {
      return rep
        .code(400)
        .send({ error: "source, video_id, title required" });
    }
    const cloudPath = makeCloudPath(body.source, body.video_id);
    const artist = body.channel || "online";
    const pinyin = toPinyinInitials(body.title);
    const artistPinyin = toPinyinInitials(artist);
    // Cache the thumbnail URL in genre (closest unused free-form column);
    // duration_seconds gets stashed in size_bytes (negative to flag it as
    // "seconds, not bytes" — a touch hacky, but avoids a migration just
    // for online metadata that won't apply to local files).
    db.prepare(
      `INSERT INTO songs
         (title, artist, lang, genre, pinyin, artist_pinyin, cloud_path,
          size_bytes, vocal_channel, year_int)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(cloud_path) DO UPDATE SET
         title = excluded.title,
         artist = excluded.artist,
         genre = excluded.genre,
         pinyin = excluded.pinyin,
         artist_pinyin = excluded.artist_pinyin,
         size_bytes = excluded.size_bytes`,
    ).run(
      body.title,
      artist,
      "online",
      body.thumbnail ?? null,
      pinyin,
      artistPinyin,
      cloudPath,
      body.duration_seconds ? -body.duration_seconds : null,
      "L",
      0,
    );
    const row = db
      .prepare("SELECT id FROM songs WHERE cloud_path = ?")
      .get(cloudPath) as { id: number };
    const item = orchestrator.enqueue(row.id, body.added_by ?? null, {
      top: !!body.top,
    });
    return { queued: item };
  });
}
