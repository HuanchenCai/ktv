import type { FastifyInstance } from "fastify";
import type { MpvController } from "../mpv-controller.ts";
import type { Orchestrator } from "../queue-orchestrator.ts";

export async function registerControlRoutes(
  fastify: FastifyInstance,
  orchestrator: Orchestrator,
  mpv: MpvController,
): Promise<void> {
  fastify.post("/api/control/skip", async () => {
    await orchestrator.skipCurrent();
    return { ok: true };
  });

  fastify.post("/api/control/replay", async () => {
    await orchestrator.replay();
    return { ok: true };
  });

  fastify.post("/api/control/reopen", async () => {
    const ok = await orchestrator.reopenCurrent();
    return { ok };
  });

  fastify.post("/api/control/toggle-vocal", async () => {
    await orchestrator.toggleVocal();
    return { ok: true, channel: orchestrator.getChannelState() };
  });

  fastify.post("/api/control/swap-vocal-channel", async () => {
    await orchestrator.swapVocalChannel();
    return { ok: true };
  });

  fastify.post<{ Body: { channel: "L" | "R" | "both" } }>(
    "/api/control/channel",
    async (req, rep) => {
      const { channel } = req.body ?? { channel: "both" };
      if (!["L", "R", "both"].includes(channel)) {
        return rep.code(400).send({ error: "channel must be L|R|both" });
      }
      await mpv.setChannel(channel);
      return { ok: true };
    },
  );

  fastify.post<{ Body: { paused: boolean } }>(
    "/api/control/pause",
    async (req) => {
      if (req.body?.paused) {
        await mpv.pause();
      } else {
        await mpv.resume();
      }
      return { ok: true };
    },
  );

  fastify.post<{ Body: { volume: number } }>(
    "/api/control/volume",
    async (req, rep) => {
      const vol = Number(req.body?.volume);
      if (!Number.isFinite(vol)) {
        return rep.code(400).send({ error: "volume number required" });
      }
      await mpv.setVolume(vol);
      return { ok: true, volume: vol };
    },
  );

  fastify.get("/api/player", async () => {
    const state = await mpv.getState();
    return {
      ...state,
      current_song: orchestrator.getCurrentSong(),
    };
  });
}
