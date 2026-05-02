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
        where.push(
          "(pinyin LIKE ? OR artist_pinyin LIKE ? OR title LIKE ? OR artist LIKE ?)",
        );
        const like = `%${q}%`;
        params.push(like, like, like, like);
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

  // Map from artist name → portrait URL ("/portraits/<file>"), built on the
  // fly per request from the artist_portraits table.
  function portraitMap(): Map<string, string> {
    const rows = db
      .prepare(
        "SELECT artist, rel_path FROM artist_portraits WHERE status = 'ok' AND rel_path IS NOT NULL",
      )
      .all() as Array<{ artist: string; rel_path: string }>;
    const map = new Map<string, string>();
    for (const r of rows) {
      // rel_path is "data/portraits/<file>"; we serve via /portraits/<file>.
      const fileName = r.rel_path.split(/[\\/]/).pop();
      if (fileName) map.set(r.artist, `/portraits/${fileName}`);
    }
    return map;
  }

  fastify.get("/api/artists", async () => {
    const rows = db
      .prepare(
        "SELECT artist, COUNT(*) AS count FROM songs GROUP BY artist ORDER BY count DESC",
      )
      .all() as Array<{ artist: string; count: number }>;
    const portraits = portraitMap();
    return {
      artists: rows.map((r) => ({
        ...r,
        portrait: portraits.get(r.artist) ?? null,
      })),
    };
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
    const portraits = portraitMap();
    const ordered = popularArtistsInLibrary(present);
    return {
      artists: ordered.map((a) => ({
        artist: a,
        count: counts.get(a) ?? 0,
        portrait: portraits.get(a) ?? null,
      })),
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
