import type { FastifyInstance } from "fastify";
import type { Orchestrator } from "../queue-orchestrator.ts";

export async function registerQueueRoutes(
  fastify: FastifyInstance,
  orchestrator: Orchestrator,
): Promise<void> {
  fastify.get("/api/queue", async () => {
    return { items: orchestrator.listQueue() };
  });

  fastify.post<{
    Body: { song_id: number; added_by?: string; top?: boolean };
  }>("/api/queue", async (req, rep) => {
    const { song_id, added_by, top } = req.body ?? { song_id: 0 };
    if (!song_id || typeof song_id !== "number") {
      return rep.code(400).send({ error: "song_id required" });
    }
    try {
      const item = orchestrator.enqueue(song_id, added_by ?? null, {
        top: !!top,
      });
      return { queued: item };
    } catch (err) {
      return rep
        .code(400)
        .send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  fastify.delete<{ Params: { id: string } }>(
    "/api/queue/:id",
    async (req) => {
      const id = parseInt(req.params.id, 10);
      orchestrator.removeQueueItem(id);
      return { ok: true };
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/queue/:id/top",
    async (req) => {
      const id = parseInt(req.params.id, 10);
      orchestrator.moveToFront(id);
      return { ok: true };
    },
  );

  fastify.patch<{
    Params: { id: string };
    Body: { position: number };
  }>("/api/queue/:id", async (req, rep) => {
    const id = parseInt(req.params.id, 10);
    const { position } = req.body ?? { position: -1 };
    if (!Number.isInteger(position) || position < 1) {
      return rep.code(400).send({ error: "position must be positive int" });
    }
    orchestrator.reorder(id, position);
    return { ok: true };
  });
}
