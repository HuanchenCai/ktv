import type { FastifyInstance } from "fastify";
import type { Db, Song } from "../db.ts";
import { popularArtistsInLibrary } from "../popular-artists.ts";

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

  /**
   * Curated KTV artists that actually have songs in the user's library.
   * Returns at most ~30 names in curated (recognizability) order, each
   * with its current song count so the UI can show "30 首" badges.
   */
  fastify.get("/api/popular-artists", async () => {
    const rows = db
      .prepare("SELECT artist, COUNT(*) AS count FROM songs GROUP BY artist")
      .all() as Array<{ artist: string; count: number }>;
    const counts = new Map(rows.map((r) => [r.artist, r.count]));
    const present = new Set(rows.map((r) => r.artist));
    const ordered = popularArtistsInLibrary(present);
    return {
      artists: ordered.map((a) => ({ artist: a, count: counts.get(a) ?? 0 })),
    };
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
