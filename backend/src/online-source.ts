/**
 * yt-dlp wrapper for "online" video sources (YouTube + Douyin).
 *
 * Three operations:
 *   search(source, query, limit) — returns a list of {videoId, title, ...}
 *   hotlist(source, limit)       — top-N trending list (no query)
 *   resolveDirectUrl(cloudPath)  — converts our "online://yt/<id>" pseudo-
 *                                   path into a CDN URL mpv can stream.
 *
 * We spawn yt-dlp as a subprocess. Its JSON-Lines output (--dump-json
 * --flat-playlist) lets us collect entries without loading the entire
 * playlist into memory.
 *
 * Direct URLs from YouTube expire after ~6 hours; we never cache them.
 * Every play decision goes through resolveDirectUrl().
 */
import { spawn, spawnSync } from "node:child_process";
import { platform } from "node:os";

export type OnlineSource = "yt" | "dy";

export type OnlineResult = {
  source: OnlineSource;
  video_id: string;
  /** Original watch-page URL (used as yt-dlp input later) */
  url: string;
  title: string;
  channel: string | null;
  duration_seconds: number | null;
  thumbnail: string | null;
};

export type OnlineConfig = {
  enabled: boolean;
  youtube_enabled: boolean;
  douyin_enabled: boolean;
  proxy: string;
  yt_dlp_path: string;
  search_timeout_ms: number;
  resolve_timeout_ms: number;
};

/** Cached probe so we don't shell out on every request. */
let probedBinary: string | null = null;
let probedAt = 0;

/** Find yt-dlp on PATH (or use the explicit config override). */
export function probeYtDlp(cfg: OnlineConfig): string | null {
  if (cfg.yt_dlp_path) return cfg.yt_dlp_path;
  if (probedBinary && Date.now() - probedAt < 60_000) return probedBinary;
  const which = platform() === "win32" ? "where" : "which";
  const probe = spawnSync(which, ["yt-dlp"], { encoding: "utf8" });
  if (probe.status === 0 && probe.stdout.trim()) {
    probedBinary = probe.stdout.trim().split(/\r?\n/)[0];
    probedAt = Date.now();
    return probedBinary;
  }
  // Also try yt-dlp.exe on Windows in case `where` returns 1 (it does
  // for some PATH setups).
  if (platform() === "win32") {
    const probe2 = spawnSync(which, ["yt-dlp.exe"], { encoding: "utf8" });
    if (probe2.status === 0 && probe2.stdout.trim()) {
      probedBinary = probe2.stdout.trim().split(/\r?\n/)[0];
      probedAt = Date.now();
      return probedBinary;
    }
  }
  return null;
}

/** Run yt-dlp with the given args, capture stdout, enforce a timeout. */
function runYtDlp(
  bin: string,
  args: string[],
  timeoutMs: number,
  proxy: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const fullArgs = [...args, "--no-warnings"];
    if (proxy) fullArgs.push("--proxy", proxy);
    const proc = spawn(bin, fullArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    proc.stdout.on("data", (b: Buffer) => (stdout += b.toString()));
    proc.stderr.on("data", (b: Buffer) => (stderr += b.toString()));
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
      reject(new Error(`yt-dlp timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `yt-dlp exit ${code}: ${stderr.trim().slice(0, 500) || "(no stderr)"}`,
          ),
        );
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

/**
 * Parse the --dump-json output (one JSON object per line) into our
 * OnlineResult shape. Silently drops lines that don't parse.
 */
function parseEntries(
  source: OnlineSource,
  stdout: string,
): OnlineResult[] {
  const out: OnlineResult[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("{")) continue;
    try {
      const j = JSON.parse(trimmed) as Record<string, unknown>;
      const videoId = String(j.id ?? "");
      if (!videoId) continue;
      const url =
        (j.webpage_url as string | undefined) ??
        (j.url as string | undefined) ??
        (source === "yt"
          ? `https://www.youtube.com/watch?v=${videoId}`
          : `https://www.douyin.com/video/${videoId}`);
      // yt-dlp sometimes emits thumbnail as an array of {url, ...}
      let thumbnail: string | null = null;
      if (typeof j.thumbnail === "string") thumbnail = j.thumbnail;
      else if (Array.isArray(j.thumbnails) && j.thumbnails.length > 0) {
        const last = j.thumbnails[j.thumbnails.length - 1] as
          | { url?: string }
          | undefined;
        thumbnail = last?.url ?? null;
      }
      out.push({
        source,
        video_id: videoId,
        url,
        title: String(j.title ?? "(untitled)"),
        channel:
          (j.uploader as string | undefined) ??
          (j.channel as string | undefined) ??
          null,
        duration_seconds:
          typeof j.duration === "number" ? Math.floor(j.duration) : null,
        thumbnail,
      });
    } catch {
      /* ignore bad lines */
    }
  }
  return out;
}

export async function search(
  cfg: OnlineConfig,
  source: OnlineSource,
  query: string,
  limit = 20,
): Promise<OnlineResult[]> {
  const bin = probeYtDlp(cfg);
  if (!bin) throw new Error("yt-dlp not installed (run `winget install yt-dlp.yt-dlp` or `brew install yt-dlp`)");
  if (source === "yt" && !cfg.youtube_enabled) {
    throw new Error("YouTube is disabled in config (online.youtube_enabled=false)");
  }
  if (source === "dy" && !cfg.douyin_enabled) {
    throw new Error("Douyin is disabled in config (online.douyin_enabled=false)");
  }
  const cappedLimit = Math.min(Math.max(1, limit), 50);
  // yt-dlp doesn't implement Douyin search — only watch URLs and the
  // hot feed. For Douyin we accept the query AS a URL (someone pastes
  // a video link from the share sheet); YouTube uses ytsearch.
  const target =
    source === "yt"
      ? `ytsearch${cappedLimit}:${query}`
      : query.trim();
  if (source === "dy" && !/^https?:\/\//.test(target)) {
    throw new Error(
      "Douyin 搜索不支持关键词；请粘贴抖音视频链接（v.douyin.com 短链或 douyin.com/video/...）",
    );
  }
  const args = [
    target,
    "--dump-json",
    "--flat-playlist",
    "--no-playlist", // for single-video URLs that get accidentally matched
    "--playlist-end",
    String(cappedLimit),
  ];
  const { stdout } = await runYtDlp(bin, args, cfg.search_timeout_ms, cfg.proxy);
  return parseEntries(source, stdout);
}

export async function hotlist(
  cfg: OnlineConfig,
  source: OnlineSource,
  limit = 50,
): Promise<OnlineResult[]> {
  const bin = probeYtDlp(cfg);
  if (!bin) throw new Error("yt-dlp not installed");
  if (source === "yt" && !cfg.youtube_enabled) {
    throw new Error("YouTube is disabled in config");
  }
  if (source === "dy" && !cfg.douyin_enabled) {
    throw new Error("Douyin is disabled in config");
  }
  const cappedLimit = Math.min(Math.max(1, limit), 50);
  const target =
    source === "yt"
      ? "https://www.youtube.com/feed/trending"
      : "https://www.douyin.com/hot";
  const args = [
    target,
    "--dump-json",
    "--flat-playlist",
    "--playlist-end",
    String(cappedLimit),
  ];
  const { stdout } = await runYtDlp(bin, args, cfg.search_timeout_ms, cfg.proxy);
  return parseEntries(source, stdout);
}

/**
 * Pull a direct-stream URL out of a YouTube/Douyin watch page. mpv
 * needs the actual media URL because we don't want it to spawn its
 * own yt-dlp (different binary path, different proxy, harder to debug).
 *
 * Format preference: video+audio mux ≤ 1080p, fall back to 'best' if
 * the site only ships a single stream.
 */
export async function resolveDirectUrl(
  cfg: OnlineConfig,
  url: string,
): Promise<string> {
  const bin = probeYtDlp(cfg);
  if (!bin) throw new Error("yt-dlp not installed");
  const args = [
    url,
    "-g",
    "--no-playlist",
    "--format",
    "best[height<=1080]/best",
  ];
  const { stdout } = await runYtDlp(bin, args, cfg.resolve_timeout_ms, cfg.proxy);
  // -g may return one (single muxed) or two (video+audio) lines. Take
  // the first; for separate streams we'd need mpv's --audio-file, which
  // complicates the load path — sticking to a single best-mux file.
  const lines = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length) throw new Error("yt-dlp returned no direct URL");
  return lines[0];
}

/**
 * Build the synthetic cloud_path used to represent an online video in
 * the songs table. We squeeze type + id into the URL so the
 * orchestrator can route by prefix without a new schema column.
 */
export function makeCloudPath(source: OnlineSource, videoId: string): string {
  return `online://${source}/${videoId}`;
}

/**
 * Inverse: parse a cloud_path back into (source, videoId). Returns null
 * if it isn't one of ours.
 */
export function parseCloudPath(
  cloudPath: string,
): { source: OnlineSource; videoId: string } | null {
  const m = cloudPath.match(/^online:\/\/(yt|dy)\/(.+)$/);
  if (!m) return null;
  return { source: m[1] as OnlineSource, videoId: m[2] };
}

export function watchUrlFor(
  source: OnlineSource,
  videoId: string,
): string {
  return source === "yt"
    ? `https://www.youtube.com/watch?v=${videoId}`
    : `https://www.douyin.com/video/${videoId}`;
}
