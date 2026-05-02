import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join, extname } from "node:path";
import { createHash } from "node:crypto";
import type { Db } from "./db.ts";

/**
 * Fetch a portrait image for each artist in the library and cache it on disk
 * + record the result in `artist_portraits`. Resilient: throttled, polite
 * User-Agent, fallback chain across sources, negative-cache so we don't hammer
 * APIs for artists we already failed to find.
 *
 *   Source priority:
 *     1. Wikidata SPARQL (P18 image)  — best metadata, explicit license
 *     2. zh.wikipedia.org REST summary — thumbnail.source
 *     3. en.wikipedia.org REST summary — fallback for Western/JP/KR artists
 *
 *   Throttle: ~1 req/s per host (be polite, no rate-limit yet).
 *   Negative cache TTL: 7 days for misses, 90 days for hits (re-verify rarely).
 */

const NEG_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const POS_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const UA = "ktv-app/1.0 (https://github.com/HuanchenCai/ktv)";
const REQ_DELAY_MS = 1100;

export type PortraitProgress = {
  total: number;
  done: number;
  ok: number;
  missed: number;
  current: string | null;
};

export type FetchPortraitsOptions = {
  /** Only fetch artists with this many or more songs in the library. */
  minSongCount?: number;
  /** Project root used for `data/portraits/` resolution. */
  projectRoot: string;
  /** Force re-fetch even if cached. */
  force?: boolean;
  onProgress?: (p: PortraitProgress) => void;
};

type Hit = {
  url: string;
  source: string;
  license?: string;
  attribution?: string;
};

async function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function fetchJson(url: string, timeoutMs = 8000): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function fetchBuffer(url: string, timeoutMs = 20_000): Promise<{
  buf: ArrayBuffer;
  contentType: string;
}> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return {
    buf: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
  };
}

function sparqlEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function tryWikidata(name: string): Promise<Hit | null> {
  const query = `SELECT ?image ?artist WHERE {
    ?artist rdfs:label "${sparqlEscape(name)}"@zh .
    ?artist wdt:P18 ?image .
  } LIMIT 1`;
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
  const json = (await fetchJson(url)) as {
    results?: { bindings?: Array<{ image?: { value: string } }> };
  };
  const img = json.results?.bindings?.[0]?.image?.value;
  if (!img) return null;
  return { url: img, source: "wikidata", license: "Wikimedia Commons (see source)" };
}

async function tryWikipedia(
  name: string,
  lang: "zh" | "en",
): Promise<Hit | null> {
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`;
  const json = (await fetchJson(url)) as {
    thumbnail?: { source?: string };
    originalimage?: { source?: string };
    content_urls?: { desktop?: { page?: string } };
    extract?: string;
    title?: string;
  };
  const src = json.originalimage?.source ?? json.thumbnail?.source;
  if (!src) return null;
  return {
    url: src,
    source: `wikipedia-${lang}`,
    license: "Wikimedia Commons (see source)",
    attribution: json.content_urls?.desktop?.page ?? "",
  };
}

const PROVIDERS: Array<(name: string) => Promise<Hit | null>> = [
  tryWikidata,
  (n) => tryWikipedia(n, "zh"),
  (n) => tryWikipedia(n, "en"),
];

function inferExt(url: string, contentType: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes("jpeg") || ct.includes("jpg")) return ".jpg";
  if (ct.includes("png")) return ".png";
  if (ct.includes("webp")) return ".webp";
  if (ct.includes("svg")) return ".svg";
  if (ct.includes("gif")) return ".gif";
  const fromUrl = extname(new URL(url).pathname).toLowerCase();
  if (
    fromUrl &&
    [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"].includes(fromUrl)
  ) {
    return fromUrl === ".jpeg" ? ".jpg" : fromUrl;
  }
  return ".jpg";
}

export async function fetchPortraits(
  db: Db,
  opts: FetchPortraitsOptions,
): Promise<PortraitProgress> {
  const minSongCount = opts.minSongCount ?? 1;
  const portraitsDir = resolve(opts.projectRoot, "data", "portraits");
  await mkdir(portraitsDir, { recursive: true });

  const artists = db
    .prepare(
      `SELECT artist, COUNT(*) AS c FROM songs
       WHERE artist != '' AND artist != 'unknown'
       GROUP BY artist
       HAVING c >= ?
       ORDER BY c DESC`,
    )
    .all(minSongCount) as Array<{ artist: string; c: number }>;

  const progress: PortraitProgress = {
    total: artists.length,
    done: 0,
    ok: 0,
    missed: 0,
    current: null,
  };
  opts.onProgress?.(progress);

  const lookup = db.prepare(
    "SELECT * FROM artist_portraits WHERE artist = ?",
  );
  const upsert = db.prepare(
    `INSERT INTO artist_portraits
       (artist, status, rel_path, source, license, attribution, source_url, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(artist) DO UPDATE SET
       status=excluded.status,
       rel_path=excluded.rel_path,
       source=excluded.source,
       license=excluded.license,
       attribution=excluded.attribution,
       source_url=excluded.source_url,
       fetched_at=excluded.fetched_at`,
  );

  const now = Date.now();

  for (const row of artists) {
    progress.current = row.artist;
    opts.onProgress?.(progress);

    const cached = lookup.get(row.artist) as
      | {
          status: string;
          rel_path?: string | null;
          fetched_at: number;
        }
      | undefined;

    if (cached && !opts.force) {
      const ttl = cached.status === "ok" ? POS_TTL_MS : NEG_TTL_MS;
      const fresh = now - cached.fetched_at < ttl;
      const fileOk =
        cached.status === "ok" &&
        cached.rel_path &&
        existsSync(resolve(opts.projectRoot, cached.rel_path));
      if (fresh && (cached.status === "missed" || fileOk)) {
        if (cached.status === "ok") progress.ok++;
        else progress.missed++;
        progress.done++;
        opts.onProgress?.(progress);
        continue;
      }
    }

    let hit: Hit | null = null;
    for (const provider of PROVIDERS) {
      try {
        hit = await provider(row.artist);
        if (hit) break;
      } catch {
        /* try next */
      }
      await sleep(REQ_DELAY_MS);
    }

    if (!hit) {
      upsert.run(row.artist, "missed", null, null, null, null, null, now);
      progress.missed++;
      progress.done++;
      opts.onProgress?.(progress);
      await sleep(REQ_DELAY_MS);
      continue;
    }

    try {
      const { buf, contentType } = await fetchBuffer(hit.url);
      const buffer = Buffer.from(buf);
      const sha = createHash("sha1").update(buffer).digest("hex").slice(0, 16);
      const ext = inferExt(hit.url, contentType);
      const fileName = `${sha}${ext}`;
      const absPath = join(portraitsDir, fileName);
      await writeFile(absPath, buffer);
      const relPath = `data/portraits/${fileName}`;
      upsert.run(
        row.artist,
        "ok",
        relPath,
        hit.source,
        hit.license ?? null,
        hit.attribution ?? null,
        hit.url,
        now,
      );
      progress.ok++;
    } catch (err) {
      console.warn(`[portraits] download failed for ${row.artist}:`, err);
      upsert.run(row.artist, "missed", null, null, null, null, hit.url, now);
      progress.missed++;
    }
    progress.done++;
    opts.onProgress?.(progress);
    await sleep(REQ_DELAY_MS);
  }

  progress.current = null;
  opts.onProgress?.(progress);
  return progress;
}
