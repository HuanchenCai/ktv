export type Song = {
  id: number;
  title: string;
  artist: string;
  lang: string | null;
  genre: string | null;
  pinyin: string;
  cloud_path: string;
  size_bytes: number | null;
  cached: 0 | 1;
  local_path: string | null;
  vocal_channel: "L" | "R";
  last_played_at: number | null;
  play_count: number;
};

export type DownloadTask = {
  id: number;
  song_id: number;
  status: "pending" | "downloading" | "done" | "failed";
  progress: number;
  speed_bps: number | null;
  eta_seconds: number | null;
  error: string | null;
};

export type QueueItem = {
  queue_id: number;
  position: number;
  song: Song;
  download: DownloadTask | null;
  is_current: boolean;
};

function clientId(): string {
  let id = localStorage.getItem("ktv_client_id");
  if (!id) {
    id = generateClientId();
    localStorage.setItem("ktv_client_id", id);
  }
  return id;
}

/**
 * Stable per-browser identifier. Doesn't need cryptographic strength — it
 * only tags "who pointed this song" in the queue. crypto.randomUUID() is
 * unavailable in non-secure contexts (http on a LAN IP, which is exactly
 * how phones reach us), so we hand-roll.
 */
function generateClientId(): string {
  const bytes = new Uint8Array(8);
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const hex = Array.from(bytes, (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return `c-${Date.now().toString(36)}-${hex}`;
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export const api = {
  searchSongs(
    q: string,
    limit = 30,
    artist?: string,
    sort?: "popular" | "pinyin" | "length" | "year",
  ) {
    const u = new URLSearchParams({ q, limit: String(limit) });
    if (artist) u.set("artist", artist);
    if (sort) u.set("sort", sort);
    return request<{ songs: Song[]; count: number }>(`/api/songs?${u}`);
  },
  popularArtists() {
    return request<{
      artists: Array<{
        artist: string;
        count: number;
        portrait: string | null;
      }>;
    }>("/api/popular-artists");
  },
  fetchPortraits(opts?: { min_song_count?: number; force?: boolean }) {
    return request<{
      running: boolean;
      progress: {
        total: number;
        done: number;
        ok: number;
        missed: number;
        current: string | null;
      } | null;
    }>("/api/admin/fetch-portraits", {
      method: "POST",
      body: JSON.stringify(opts ?? {}),
    });
  },
  portraitProgress() {
    return request<{
      running: boolean;
      progress: {
        total: number;
        done: number;
        ok: number;
        missed: number;
        current: string | null;
      } | null;
    }>("/api/admin/portrait-progress");
  },
  listQueue() {
    return request<{ items: QueueItem[] }>("/api/queue");
  },
  enqueue(song_id: number, opts?: { top?: boolean }) {
    return request<{ queued: unknown }>("/api/queue", {
      method: "POST",
      body: JSON.stringify({
        song_id,
        added_by: clientId(),
        top: !!opts?.top,
      }),
    });
  },
  removeQueue(queue_id: number) {
    return request<{ ok: true }>(`/api/queue/${queue_id}`, { method: "DELETE" });
  },
  moveToFront(queue_id: number) {
    return request<{ ok: true }>(`/api/queue/${queue_id}/top`, {
      method: "POST",
    });
  },
  skip() {
    return request<{ ok: true }>("/api/control/skip", { method: "POST" });
  },
  replay() {
    return request<{ ok: true }>("/api/control/replay", { method: "POST" });
  },
  reopen() {
    return request<{ ok: boolean }>("/api/control/reopen", { method: "POST" });
  },
  toggleVocal() {
    return request<{ ok: true }>("/api/control/toggle-vocal", {
      method: "POST",
    });
  },
  swapVocalChannel() {
    return request<{ ok: true }>("/api/control/swap-vocal-channel", {
      method: "POST",
    });
  },
  setChannel(channel: "L" | "R" | "both") {
    return request<{ ok: true }>("/api/control/channel", {
      method: "POST",
      body: JSON.stringify({ channel }),
    });
  },
  pause(paused: boolean) {
    return request<{ ok: true }>("/api/control/pause", {
      method: "POST",
      body: JSON.stringify({ paused }),
    });
  },
  setVolume(volume: number) {
    return request<{ ok: true; volume: number }>("/api/control/volume", {
      method: "POST",
      body: JSON.stringify({ volume }),
    });
  },
  setEq(bands: { low: number; mid: number; high: number } | { off: true }) {
    return request<{ ok: true }>("/api/control/eq", {
      method: "POST",
      body: JSON.stringify(bands),
    });
  },
  player() {
    return request<{
      current_song: Song | null;
      paused?: boolean;
      position?: number;
      duration?: number;
      volume?: number;
      vocal_channel?: "L" | "R" | "both";
    }>("/api/player");
  },
  health() {
    return request<{
      ok: boolean;
      openlist_up: boolean;
      openlist_admin_url: string;
      mpv_ready: boolean;
      library_path: string;
      db_songs: number;
      db_cached: number;
    }>("/api/health");
  },
  qr() {
    return request<{ url: string; qr_data_url: string; lan_ips: string[] }>(
      "/api/admin/qrcode",
    );
  },
  scan(max_depth = 3) {
    return request<{ inserted: number; updated: number; skipped: number }>(
      "/api/admin/scan",
      {
        method: "POST",
        body: JSON.stringify({ max_depth }),
      },
    );
  },
  importLocal(path?: string) {
    return request<{
      added: number;
      skipped: number;
      scanned: number;
      scanned_path: string;
    }>("/api/admin/import-local", {
      method: "POST",
      body: JSON.stringify(path ? { path } : {}),
    });
  },
  pickFolder() {
    return request<{ path: string | null }>("/api/admin/pick-folder", {
      method: "POST",
      body: "{}",
    });
  },
  downloadBatch(ids: number[]) {
    return request<{ enqueued: number; total_in_session: number }>(
      "/api/admin/download/batch",
      {
        method: "POST",
        body: JSON.stringify({ ids }),
      },
    );
  },
  downloadState() {
    return request<{
      counts: Record<string, number>;
      tasks: Array<{
        id: number;
        cloud_path: string;
        artist: string;
        title: string;
        size_bytes: number | null;
        state: "queued" | "downloading" | "done" | "failed" | "skipped";
        bytesWritten: number;
        bytesTotal: number | null;
        error: string | null;
      }>;
    }>("/api/admin/download/state");
  },
  abortDownloads() {
    return request<{ aborted: true }>("/api/admin/download/abort", {
      method: "POST",
    });
  },
  baiduScan(opts?: { root?: string; max_depth?: number }) {
    return request<{
      running: boolean;
      progress: {
        phase: string;
        current_dir: string | null;
        dirs: number;
        inserted: number;
        updated: number;
        skipped: number;
      } | null;
    }>("/api/admin/baidu-scan", {
      method: "POST",
      body: JSON.stringify(opts ?? {}),
    });
  },
  baiduScanState() {
    return request<{
      running: boolean;
      progress: {
        phase: string;
        current_dir: string | null;
        dirs: number;
        inserted: number;
        updated: number;
        skipped: number;
        pruned?: number;
      } | null;
      last_scanned_at: number | null;
    }>("/api/admin/baidu-scan/state");
  },
  baiduScanAbort() {
    return request<{ aborted: true }>("/api/admin/baidu-scan/abort", {
      method: "POST",
    });
  },
  reparseFilenames(apply: boolean) {
    return request<{
      dry_run: boolean;
      scanned: number;
      changed: number;
      sample: Array<{
        id: number;
        before: { title: string; artist: string };
        after: { title: string; artist: string };
      }>;
    }>("/api/admin/reparse-filenames", {
      method: "POST",
      body: JSON.stringify({ apply }),
    });
  },
  dedupe(apply: boolean) {
    return request<{
      dry_run: boolean;
      groups_with_dupes: number | string;
      candidates_to_delete: number;
      deleted: number;
      sample: Array<{
        kept: { id: number; title: string; artist: string };
        removed: Array<{ id: number; title: string; artist: string }>;
      }>;
    }>("/api/admin/dedupe", {
      method: "POST",
      body: JSON.stringify({ apply }),
    });
  },
};
