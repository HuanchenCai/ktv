/**
 * Baidu Netdisk downloader using BDUSS cookie auth.
 *
 * Why this exists: OpenList's BaiduNetdisk driver only accepts a refresh_token
 * (OAuth via the open platform), and the third-party token helper api.nn.ci is
 * unreachable from CN. With a regular Baidu login (BDUSS cookie) we can hit
 * the web /api/filemetas endpoint directly to obtain a CDN download link.
 *
 * Endpoint chain:
 *   1. GET https://pan.baidu.com/api/filemetas?target=["<path>"]&dlink=1
 *          &app_id=250528&web=1
 *      Cookie: BDUSS=...; STOKEN=...
 *      User-Agent: netdisk;P2SP;3.5.0;netdisk;
 *      Returns JSON  { errno, info: [ { dlink, fs_id, ... } ] }
 *   2. GET <dlink>   (8h validity)
 *      Cookie: BDUSS=...
 *      User-Agent: pan.baidu.com    <-- MUST be this; browsers get 302'd to H5
 *      redirect: "follow"           <-- 302 to qdall01.baidupcs.com CDN
 *   3. Stream Response.body to a *.part file; rename on success.
 *
 * SVIP accounts get full-speed CDN; non-SVIP gets ~150-300 KB/s and may also
 * see a 31363 (限速) errno on the metadata call.
 */

import { createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export type DownloadOpts = {
  bduss: string;
  stoken?: string;
  /** Called periodically during stream; bytesWritten is cumulative. */
  onProgress?: (bytesWritten: number, totalBytes: number | null) => void;
  /** Abort signal to cancel a running download. */
  signal?: AbortSignal;
  /** Expected size in bytes. If provided, mismatch fails the download. */
  expectedSize?: number | null;
  /** UA override. Default `pan.baidu.com` (works with BDUSS). */
  userAgent?: string;
  /** Number of retries on retryable errors (network, 5xx). Default 3. */
  retries?: number;
};

export type DownloadResult =
  | { ok: true; bytes: number; localPath: string; skipped?: boolean }
  | { ok: false; error: string; retryable: boolean };

/** UA used for the dlink fetch (the CDN check). MUST be this string or a
 *  similar non-browser UA, otherwise Baidu serves an HTML "open in app" page. */
const DLINK_UA = "pan.baidu.com";
/** UA used for the JSON metadata API. Mimics the official client. */
const META_UA = "netdisk;P2SP;3.5.0;netdisk;";

function buildCookie(bduss: string, stoken?: string): string {
  const parts = [`BDUSS=${bduss}`];
  if (stoken) parts.push(`STOKEN=${stoken}`);
  return parts.join("; ");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolve a Baidu cloud path to a 8-hour CDN download link via /api/filemetas.
 * Returns the dlink string, or throws with a descriptive message.
 */
export async function getDownloadLink(
  cloudPath: string,
  opts: DownloadOpts,
): Promise<string> {
  const url =
    "https://pan.baidu.com/api/filemetas?" +
    new URLSearchParams({
      target: JSON.stringify([cloudPath]),
      dlink: "1",
      app_id: "250528",
      web: "1",
    }).toString();
  const res = await fetch(url, {
    headers: {
      Cookie: buildCookie(opts.bduss, opts.stoken),
      "User-Agent": opts.userAgent ?? META_UA,
      Referer: "https://pan.baidu.com/disk/main",
    },
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`filemetas HTTP ${res.status}`);
  const json = (await res.json()) as {
    errno: number;
    info?: Array<{ dlink?: string; fs_id?: number }>;
  };
  if (json.errno !== 0) {
    throw new Error(`filemetas errno=${json.errno}`);
  }
  const dlink = json.info?.[0]?.dlink;
  if (!dlink) throw new Error("filemetas: no dlink in response");
  return dlink;
}

/**
 * Probe whether BDUSS can authenticate against PCS. Returns null on success,
 * an error string otherwise. Does not download a body (uses HEAD-style flow).
 */
export async function probeAuth(opts: DownloadOpts): Promise<string | null> {
  // We probe by hitting /api/list /, which requires a logged-in session.
  // If this is OK, dlink fetches are very likely OK too.
  const res = await fetch(
    "https://pan.baidu.com/api/list?dir=/&order=name&start=0&limit=1&web=1",
    {
      headers: {
        Cookie: buildCookie(opts.bduss, opts.stoken),
        "User-Agent": META_UA,
        Referer: "https://pan.baidu.com/disk/main",
      },
    },
  );
  if (!res.ok) return `HTTP ${res.status}`;
  const json = (await res.json()) as { errno: number; request_id?: string };
  if (json.errno !== 0) return `errno=${json.errno}`;
  return null;
}

/**
 * Download a single file from Baidu Netdisk to destPath.
 * Writes to <destPath>.part first, then renames on success.
 *
 * If destPath already exists with matching size, returns `{ok:true, skipped:true}`.
 */
export async function downloadOne(
  cloudPath: string,
  destPath: string,
  opts: DownloadOpts,
): Promise<DownloadResult> {
  const retries = opts.retries ?? 3;

  // --- skip if already present with matching size ---------------------------
  if (opts.expectedSize) {
    try {
      const st = await stat(destPath);
      if (st.size === opts.expectedSize) {
        return { ok: true, bytes: st.size, localPath: destPath, skipped: true };
      }
    } catch {
      /* file doesn't exist -> proceed */
    }
  }

  await mkdir(dirname(destPath), { recursive: true });
  const partPath = destPath + ".part";

  // best-effort cleanup of any prior partial
  await unlink(partPath).catch(() => {});

  let lastError = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.signal?.aborted) {
      return { ok: false, error: "aborted", retryable: false };
    }
    if (attempt > 0) {
      const backoff = Math.min(16000, 1000 * Math.pow(4, attempt - 1));
      await sleep(backoff);
    }

    const result = await attempt_(cloudPath, destPath, partPath, opts);
    if (result.ok) return result;
    if (!result.retryable) return result;
    lastError = result.error;
  }
  return { ok: false, error: `gave up after ${retries + 1} tries: ${lastError}`, retryable: false };
}

async function attempt_(
  cloudPath: string,
  destPath: string,
  partPath: string,
  opts: DownloadOpts,
): Promise<DownloadResult> {
  // Step 1: get a fresh dlink (8h validity).
  let dlink: string;
  try {
    dlink = await getDownloadLink(cloudPath, opts);
  } catch (err) {
    const msg = (err as Error).message;
    // errno 31363 = rate limited; -6 / -9 = auth issues
    const retryable = /HTTP 5|31363|timeout|fetch failed/.test(msg);
    return { ok: false, error: msg, retryable };
  }

  // Step 2: GET dlink with cookie + non-browser UA, follow 302 to CDN.
  let res: Response;
  try {
    res = await fetch(dlink, {
      headers: {
        Cookie: buildCookie(opts.bduss, opts.stoken),
        "User-Agent": opts.userAgent ?? DLINK_UA,
      },
      redirect: "follow",
      signal: opts.signal,
    });
  } catch (err) {
    return {
      ok: false,
      error: `fetch failed: ${(err as Error).message}`,
      retryable: true,
    };
  }

  if (!res.ok) {
    // 4xx auth / not-found errors are not retryable; 5xx / 429 are.
    const text = await res.text().catch(() => "");
    const retryable = res.status >= 500 || res.status === 429;
    return {
      ok: false,
      error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
      retryable,
    };
  }

  // The body might be a JSON error envelope if BDUSS is bad / file missing —
  // PCS returns 200 with `{ "error_code": ..., "error_msg": ... }` in that case.
  // Sniff the content-type: real downloads come as application/octet-stream
  // (or video/* for videos served inline from CDN).
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const text = await res.text();
    return {
      ok: false,
      error: `PCS error envelope: ${text.slice(0, 300)}`,
      retryable: false,
    };
  }
  if (!res.body) {
    return { ok: false, error: "empty body", retryable: true };
  }

  const totalHeader = res.headers.get("content-length");
  const total = totalHeader ? Number(totalHeader) : null;
  if (
    opts.expectedSize &&
    total !== null &&
    Math.abs(total - opts.expectedSize) > 1024
  ) {
    // Differ by more than 1 KB → suspicious. Tolerate small rounding.
    return {
      ok: false,
      error: `size mismatch: server=${total} expected=${opts.expectedSize}`,
      retryable: false,
    };
  }

  let written = 0;
  const reportInterval = 1024 * 1024; // every 1 MB
  let lastReport = 0;

  const reader = Readable.fromWeb(res.body as never);
  const writer = createWriteStream(partPath);

  reader.on("data", (chunk: Buffer) => {
    written += chunk.length;
    if (opts.onProgress && written - lastReport >= reportInterval) {
      lastReport = written;
      try {
        opts.onProgress(written, total);
      } catch {
        /* swallow */
      }
    }
  });

  try {
    await pipeline(reader, writer);
  } catch (err) {
    await unlink(partPath).catch(() => {});
    return {
      ok: false,
      error: `stream failed: ${(err as Error).message}`,
      retryable: true,
    };
  }

  // Final progress tick
  if (opts.onProgress) {
    try {
      opts.onProgress(written, total);
    } catch {
      /* swallow */
    }
  }

  if (opts.expectedSize && Math.abs(written - opts.expectedSize) > 1024) {
    await unlink(partPath).catch(() => {});
    return {
      ok: false,
      error: `truncated: wrote ${written}, expected ${opts.expectedSize}`,
      retryable: true,
    };
  }

  try {
    await rename(partPath, destPath);
  } catch (err) {
    return {
      ok: false,
      error: `rename failed: ${(err as Error).message}`,
      retryable: false,
    };
  }
  return { ok: true, bytes: written, localPath: destPath };
}

/**
 * Convert a Baidu cloud path under /KTV/ to a destination under destBase,
 * preserving the rest of the directory tree.
 *   /KTV/歌星分类大全/L-开头歌星6/林志炫/foo.mkv
 * -> destBase/歌星分类大全/L-开头歌星6/林志炫/foo.mkv
 *
 * Paths outside /KTV/ are written under destBase preserving the absolute path
 * minus the leading slash.
 */
export function mirrorDestPath(
  cloudPath: string,
  destBase: string,
  rootPrefix = "/KTV/",
): string {
  const rel = cloudPath.startsWith(rootPrefix)
    ? cloudPath.slice(rootPrefix.length)
    : cloudPath.replace(/^\/+/, "");
  const base = destBase.replace(/[/\\]+$/, "");
  return `${base}/${rel}`;
}
