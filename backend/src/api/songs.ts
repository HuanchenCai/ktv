import type { FastifyInstance } from "fastify";
import type { Db, Song } from "../db.ts";

export async function registerSongsRoutes(
  fastify: FastifyInstance,
  db: Db,
): Promise<void> {
  fastify.get<{ Querystring: { q?: string; limit?: string; artist?: string } }>(
    "/api/songs",
    async (req) => {
      const q = (req.query.q ?? "").toLowerCase().trim();
      const limit = Math.min(
        200,
        Math.max(1, parseInt(req.query.limit ?? "50", 10)),
      );
      const artist = req.query.artist;

      let sql = "SELECT * FROM songs";
      const where: string[] = [];
      const params: Array<string | number> = [];
      if (q) {
        where.push("(pinyin LIKE ? OR title LIKE ? OR artist LIKE ?)");
        const like = `%${q}%`;
        params.push(like, like, like);
      }
      if (artist) {
        where.push("artist = ?");
        params.push(artist);
      }
      if (where.length) sql += " WHERE " + where.join(" AND ");
      sql += " ORDER BY play_count DESC, title ASC LIMIT ?";
      params.push(limit);

      const rows = db.prepare(sql).all(...params) as unknown as Song[];
      return { songs: rows, count: rows.length };
    },
  );

  fastify.get<{ Params: { id: string } }>("/api/songs/:id", async (req, rep) => {
    const id = parseInt(req.params.id, 10);
    const row = db
      .prepare("SELECT * FROM songs WHERE id = ?")
      .get(id) as Song | undefined;
    if (!row) return rep.code(404).send({ error: "not found" });
    return row;
  });

  fastify.get("/api/artists", async () => {
    const rows = db
      .prepare(
        "SELECT artist, COUNT(*) AS count FROM songs GROUP BY artist ORDER BY count DESC",
      )
      .all();
    return { artists: rows };
  });

  fastify.get("/api/stats", async () => {
    const total = (
      db.prepare("SELECT COUNT(*) AS c FROM songs").get() as { c: number }
    ).c;
    const cached = (
      db
        .prepare("SELECT COUNT(*) AS c FROM songs WHERE cached = 1")
        .get() as { c: number }
    ).c;
    return { total, cached };
  });
}
