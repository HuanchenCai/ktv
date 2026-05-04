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

  fastify.get<{ Querystring: { sort?: string } }>(
    "/api/artists",
    async (req) => {
      // Default back to count-desc; pinyin is opt-in via ?sort=pinyin.
      const sort = req.query.sort === "pinyin" ? "pinyin" : "count";
      const orderClause =
        sort === "pinyin" ? "ORDER BY pinyin ASC" : "ORDER BY count DESC";
      const rows = db
        .prepare(
          `SELECT
             artist,
             COUNT(*) AS count,
             COALESCE(MAX(artist_pinyin), '') AS pinyin
           FROM songs GROUP BY artist
           ${orderClause}`,
        )
        .all() as Array<{ artist: string; count: number; pinyin: string }>;
      const portraits = portraitMap();
      return {
        artists: rows.map((r) => ({
          ...r,
          portrait: portraits.get(r.artist) ?? null,
        })),
      };
    },
  );

  /**
   * Curated KTV artists that actually have songs in the user's library.
   * Returns at most ~30 names in curated (recognizability) order, each
   * with its current song count so the UI can show "30 首" badges.
   */
  fastify.get("/api/popular-artists", async () => {
    const rows = db
      .prepare(
        `SELECT artist, COUNT(*) AS count,
                COALESCE(MAX(artist_pinyin), '') AS pinyin
         FROM songs GROUP BY artist`,
      )
      .all() as Array<{ artist: string; count: number; pinyin: string }>;
    const map = new Map(rows.map((r) => [r.artist, r]));
    const present = new Set(rows.map((r) => r.artist));
    const portraits = portraitMap();
    // Order is the curated "recognizability" order from popular-artists.ts —
    // most-known names first. Don't sort by pinyin/count here.
    const inLib = popularArtistsInLibrary(present);
    return {
      artists: inLib.map((a) => {
        const r = map.get(a);
        return {
          artist: a,
          count: r?.count ?? 0,
          pinyin: r?.pinyin ?? "",
          portrait: portraits.get(a) ?? null,
        };
      }),
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

  /** Rich stats for the library management page. */
  fastify.get("/api/library/stats", async () => {
    const totalsRow = db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN cached = 1 THEN 1 ELSE 0 END) AS cached,
           COALESCE(SUM(CASE WHEN cached = 1 THEN size_bytes ELSE 0 END), 0) AS bytes
         FROM songs`,
      )
      .get() as { total: number; cached: number; bytes: number };
    const artistCount = (
      db
        .prepare(
          "SELECT COUNT(DISTINCT artist) AS c FROM songs WHERE artist != ''",
        )
        .get() as { c: number }
    ).c;
    const byLang = db
      .prepare(
        `SELECT COALESCE(lang, '未知') AS lang, COUNT(*) AS count
         FROM songs GROUP BY lang ORDER BY count DESC`,
      )
      .all() as Array<{ lang: string; count: number }>;
    const topArtists = db
      .prepare(
        `SELECT artist, COUNT(*) AS count FROM songs
         WHERE artist != ''
         GROUP BY artist ORDER BY count DESC LIMIT 10`,
      )
      .all() as Array<{ artist: string; count: number }>;
    return {
      total: totalsRow.total,
      cached: totalsRow.cached,
      bytes: totalsRow.bytes,
      artist_count: artistCount,
      by_lang: byLang,
      top_artists: topArtists,
    };
  });

  /**
   * Paginated, sortable, filterable list for the library table.
   * Query params:
   *   page (1-based, default 1)
   *   limit (default 50, max 200)
   *   sort: title | artist | last_played_at | play_count | size_bytes
   *   order: asc | desc
   *   filter: text (matches title/artist/pinyin/artist_pinyin)
   *   artist, lang: exact match filters
   *   cached_only: "1" to restrict to cached
   */
  fastify.get<{
    Querystring: {
      page?: string;
      limit?: string;
      sort?: string;
      order?: string;
      filter?: string;
      artist?: string;
      lang?: string;
      cached_only?: string;
    };
  }>("/api/library/songs", async (req) => {
    const page = Math.max(1, parseInt(req.query.page ?? "1", 10) || 1);
    const limit = Math.min(
      200,
      Math.max(1, parseInt(req.query.limit ?? "50", 10) || 50),
    );
    const sortAllow = new Set([
      "title",
      "artist",
      "last_played_at",
      "play_count",
      "size_bytes",
      "id",
    ]);
    const sort = sortAllow.has(req.query.sort ?? "")
      ? (req.query.sort as string)
      : "id";
    const order = req.query.order?.toLowerCase() === "asc" ? "ASC" : "DESC";

    const where: string[] = [];
    const params: Array<string | number> = [];
    if (req.query.filter?.trim()) {
      const like = `%${req.query.filter.trim()}%`;
      where.push(
        "(title LIKE ? OR artist LIKE ? OR pinyin LIKE ? OR artist_pinyin LIKE ?)",
      );
      params.push(like, like, like, like);
    }
    if (req.query.artist) {
      where.push("artist = ?");
      params.push(req.query.artist);
    }
    if (req.query.lang) {
      where.push("lang = ?");
      params.push(req.query.lang);
    }
    if (req.query.cached_only === "1") where.push("cached = 1");
    const whereClause = where.length ? " WHERE " + where.join(" AND ") : "";

    const total = (
      db
        .prepare(`SELECT COUNT(*) AS c FROM songs${whereClause}`)
        .get(...params) as { c: number }
    ).c;

    // NULLS-LAST so songs that never played sort to the bottom by date.
    const orderClause =
      sort === "last_played_at"
        ? `ORDER BY (last_played_at IS NULL), last_played_at ${order}`
        : `ORDER BY ${sort} ${order}`;
    const offset = (page - 1) * limit;
    const rows = db
      .prepare(
        `SELECT * FROM songs${whereClause} ${orderClause} LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);

    return { songs: rows, total, page, limit };
  });
}
