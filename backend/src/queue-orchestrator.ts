import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import type { MpvController } from "./mpv-controller.ts";
import { withTransaction } from "./db.ts";
import type { Db, Song, QueueItem, DownloadTask } from "./db.ts";
import type { DownloadManager, DownloadTask as MgrTask } from "./download-manager.ts";

export type QueueViewRow = {
  queue_id: number;
  position: number;
  song: Song;
  download: DownloadTask | null;
  is_current: boolean;
};

export type OrchestratorEvents = {
  "queue.updated": () => void;
  "download.progress": (task: DownloadTask) => void;
  "player.state": (state: {
    current_song: Song | null;
    playing: boolean;
    vocal_channel: "L" | "R" | "both";
  }) => void;
};

export interface Orchestrator {
  on<K extends keyof OrchestratorEvents>(
    e: K,
    h: OrchestratorEvents[K],
  ): this;
  emit<K extends keyof OrchestratorEvents>(
    e: K,
    ...a: Parameters<OrchestratorEvents[K]>
  ): boolean;
}

export class Orchestrator extends EventEmitter {
  private pollTimer: NodeJS.Timeout | null = null;
  private running = false;
  private currentSongId: number | null = null;
  /**
   * True when mpv is playing a random cached song as filler because the
   * queue head can't play yet (uncached / downloading) or the queue is
   * empty. currentSongId stays null in this state — the filler is not a
   * "real" current song from the queue.
   */
  private fillerActive = false;
  private currentChannelState: "L" | "R" | "both" = "both";
  /**
   * The user's remembered channel choice. Carries from one song to the
   * next so "上一首切了伴奏，下一首保持伴奏" works.
   *   "auto-accompaniment" — initial state, picks the side opposite the
   *      song's vocal_channel. (KTV default: tap a song, hear the
   *      accompaniment, sing along.)
   *   "L" / "R" / "both" — explicit raw channel the user landed on
   *      (toggleVocal flips L↔R; setChannel sets directly).
   * Filler uses currentVocalChannel directly to play the original
   * vocals during random filler — without disturbing this preference.
   */
  private lastChannel: "L" | "R" | "both" | "auto-accompaniment" =
    "auto-accompaniment";
  /** vocal_channel of whatever's currently loaded in mpv (real or filler). */
  private currentVocalChannel: "L" | "R" = "L";
  /**
   * Race guard for skipCurrent. mpv.stop() emits a "stopped" event
   * asynchronously; by the time it arrives we may have already loaded the
   * next song via maybeAutoPlay(). Without this flag, the stale stop event
   * triggers onTrackEnded which removes the freshly-loaded song from the
   * queue and advances again — i.e. one song silently gets skipped.
   * Set during the manual transition; auto-cleared after 600ms.
   */
  private skipping = false;
  private skippingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private db: Db,
    private downloads: DownloadManager,
    private mpv: MpvController,
    private libraryPath: string,
    private opts: {
      prefetchAhead: number;
      pollIntervalMs: number;
      baiduRoot: string;
      /** Resolver for online:// cloud_paths → direct mpv-playable URL.
       *  Optional: when missing, online rows are skipped (logged + popped
       *  from the queue so playback doesn't stall). */
      resolveOnlineUrl?: (cloudPath: string) => Promise<string>;
    },
  ) {
    super();

    this.mpv.on("track-ended", () => {
      // Manual skip drives the advance itself; the stale "stopped" event
      // that arrives after mpv processes our explicit stop must NOT trigger
      // a second advance.
      if (this.skipping) return;
      void this.onTrackEnded();
    });
    this.mpv.on("channel-changed", (info: { channel: "L" | "R" | "both" }) => {
      this.currentChannelState = info.channel;
      // Filler runs on its own forced "vocal" channel; don't let that
      // pollute the user's remembered preference.
      if (!this.fillerActive) this.lastChannel = info.channel;
      this.broadcastPlayerState();
    });
    this.mpv.on("paused", () => this.broadcastPlayerState());
    this.mpv.on("resumed", () => this.broadcastPlayerState());
    this.mpv.on("track-started", () => this.broadcastPlayerState());
    this.mpv.on("audio-detected", () => {
      void this.applyChannelDecision().catch(() => {});
    });

    // Bridge DownloadManager events into the legacy `download.progress`
    // event so the existing /ws fan-out keeps working unchanged.
    this.downloads.on("task_started", (t: MgrTask) =>
      this.handleManagerEvent(t, "downloading"),
    );
    this.downloads.on("task_progress", (t: MgrTask) =>
      this.handleManagerEvent(t, "downloading"),
    );
    this.downloads.on("task_done", (t: MgrTask) => {
      this.handleManagerEvent(t, "done");
      void this.maybeAutoPlay().catch(() => {});
    });
    this.downloads.on("task_skipped", (t: MgrTask) => {
      this.handleManagerEvent(t, "done");
      void this.maybeAutoPlay().catch(() => {});
    });
    this.downloads.on("task_failed", (t: MgrTask) =>
      this.handleManagerEvent(t, "failed"),
    );
  }

  private handleManagerEvent(
    t: MgrTask,
    status: "pending" | "downloading" | "done" | "failed",
  ): void {
    const progress =
      status === "done"
        ? 1
        : t.bytesTotal && t.bytesTotal > 0
          ? Math.min(1, t.bytesWritten / t.bytesTotal)
          : 0;
    const legacy: DownloadTask = {
      id: 0, // synthetic — frontend keys on song_id
      song_id: t.id,
      openlist_task_id: null,
      status,
      progress,
      speed_bps: null,
      eta_seconds: null,
      started_at: t.startedAt,
      finished_at: t.finishedAt,
      error: t.error,
    };
    this.emit("download.progress", legacy);
  }

  start(): void {
    // No periodic polling needed — DownloadManager pushes events directly.
    this.running = true;
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // --- Queue ops -----------------------------------------------------------

  enqueue(
    songId: number,
    addedBy: string | null,
    opts?: { top?: boolean },
  ): QueueItem {
    const song = this.db
      .prepare("SELECT * FROM songs WHERE id = ?")
      .get(songId) as Song | undefined;
    if (!song) throw new Error(`song ${songId} not found`);

    const maxPos = (
      this.db.prepare("SELECT COALESCE(MAX(position), 0) AS m FROM queue").get() as {
        m: number;
      }
    ).m;
    const info = this.db
      .prepare(
        "INSERT INTO queue (song_id, position, added_by, added_at) VALUES (?, ?, ?, ?)",
      )
      .run(songId, maxPos + 1, addedBy, Date.now());

    const item = this.db
      .prepare("SELECT * FROM queue WHERE id = ?")
      .get(info.lastInsertRowid) as QueueItem;

    if (opts?.top) {
      this.moveToFront(item.id);
    } else {
      this.emit("queue.updated");
    }
    void this.scheduleDownloads().catch(() => {});
    // If filler was playing, stop it so the new real song can take over
    // immediately (if cached) or so we drop back to a black mpv window
    // (if not — the download will then resolve and play kicks in).
    if (this.fillerActive) {
      void (async () => {
        try {
          this.armSkipGuard();
          await this.mpv.stop();
          this.fillerActive = false;
          await this.maybeAutoPlay();
          await this.maybeStartIdleFallback();
        } catch {
          /* ignore */
        }
      })();
    } else {
      void this.maybeAutoPlay().catch(() => {});
    }
    return item;
  }

  removeQueueItem(queueId: number): void {
    this.db.prepare("DELETE FROM queue WHERE id = ?").run(queueId);
    this.compactPositions();
    this.emit("queue.updated");
  }

  /**
   * Move a queue item to "play next". If a song is currently playing
   * (position 1), the target lands at position 2, never displacing the
   * playing track. Otherwise it goes to position 1.
   */
  moveToFront(queueId: number): void {
    const item = this.db
      .prepare("SELECT * FROM queue WHERE id = ?")
      .get(queueId) as QueueItem | undefined;
    if (!item) return;

    const insertPos = this.currentSongId !== null ? 2 : 1;

    // Item already at the right spot — no-op.
    if (item.position === insertPos) {
      this.emit("queue.updated");
      return;
    }

    withTransaction(this.db, () => {
      // Shift other items in [insertPos, item.oldPos) up by 1, then place
      // the target at insertPos. We use a temp position to avoid uniqueness
      // conflicts during the shift even though we don't have a unique index.
      const oldPos = item.position;
      this.db
        .prepare("UPDATE queue SET position = -1 WHERE id = ?")
        .run(queueId);
      if (oldPos > insertPos) {
        this.db
          .prepare(
            "UPDATE queue SET position = position + 1 WHERE position >= ? AND position < ?",
          )
          .run(insertPos, oldPos);
      } else {
        // oldPos < insertPos shouldn't really happen for "promote", but
        // handle for symmetry: shift items down between (oldPos, insertPos].
        this.db
          .prepare(
            "UPDATE queue SET position = position - 1 WHERE position > ? AND position <= ?",
          )
          .run(oldPos, insertPos);
      }
      this.db
        .prepare("UPDATE queue SET position = ? WHERE id = ?")
        .run(insertPos, queueId);
    });
    this.compactPositions();
    this.emit("queue.updated");
    void this.scheduleDownloads().catch(() => {});
  }

  reorder(queueId: number, newPosition: number): void {
    const item = this.db
      .prepare("SELECT * FROM queue WHERE id = ?")
      .get(queueId) as QueueItem | undefined;
    if (!item) return;
    const old = item.position;
    if (old === newPosition) return;

    withTransaction(this.db, () => {
      if (newPosition < old) {
        this.db
          .prepare(
            "UPDATE queue SET position = position + 1 WHERE position >= ? AND position < ?",
          )
          .run(newPosition, old);
      } else {
        this.db
          .prepare(
            "UPDATE queue SET position = position - 1 WHERE position > ? AND position <= ?",
          )
          .run(old, newPosition);
      }
      this.db
        .prepare("UPDATE queue SET position = ? WHERE id = ?")
        .run(newPosition, queueId);
    });
    this.compactPositions();
    this.emit("queue.updated");
    void this.scheduleDownloads().catch(() => {});
  }

  listQueue(): QueueViewRow[] {
    const rows = this.db
      .prepare(
        `SELECT q.id AS queue_id, q.position, q.song_id
         FROM queue q ORDER BY q.position ASC`,
      )
      .all() as Array<{ queue_id: number; position: number; song_id: number }>;

    const mgrTasks = new Map(
      this.downloads.getTasks().map((t) => [t.id, t]),
    );
    return rows.map((r) => {
      const song = this.db
        .prepare("SELECT * FROM songs WHERE id = ?")
        .get(r.song_id) as Song;
      const t = mgrTasks.get(r.song_id);
      const download: DownloadTask | null = t
        ? {
            id: 0,
            song_id: t.id,
            openlist_task_id: null,
            status:
              t.state === "downloading"
                ? "downloading"
                : t.state === "done" || t.state === "skipped"
                  ? "done"
                  : t.state === "failed"
                    ? "failed"
                    : "pending",
            progress:
              t.state === "done" || t.state === "skipped"
                ? 1
                : t.bytesTotal && t.bytesTotal > 0
                  ? Math.min(1, t.bytesWritten / t.bytesTotal)
                  : 0,
            speed_bps: null,
            eta_seconds: null,
            started_at: t.startedAt,
            finished_at: t.finishedAt,
            error: t.error,
          }
        : null;
      return {
        queue_id: r.queue_id,
        position: r.position,
        song,
        download,
        is_current:
          this.currentSongId === r.song_id && r.position === 1,
      };
    });
  }

  private compactPositions(): void {
    const rows = this.db
      .prepare("SELECT id FROM queue ORDER BY position ASC")
      .all() as Array<{ id: number }>;
    const update = this.db.prepare("UPDATE queue SET position = ? WHERE id = ?");
    withTransaction(this.db, () => {
      rows.forEach((r, i) => update.run(i + 1, r.id));
    });
  }

  // --- Download scheduler --------------------------------------------------

  private async scheduleDownloads(): Promise<void> {
    const top = this.db
      .prepare(
        `SELECT q.song_id FROM queue q
         ORDER BY q.position ASC LIMIT ?`,
      )
      .all(this.opts.prefetchAhead + 1) as Array<{ song_id: number }>;

    const songsToFetch: Song[] = [];
    for (const { song_id } of top) {
      const song = this.db
        .prepare("SELECT * FROM songs WHERE id = ?")
        .get(song_id) as Song | undefined;
      if (!song) continue;
      if (song.cached) continue;
      // Online rows stream straight from the source; DownloadManager has no
      // business pulling them.
      if (song.cloud_path.startsWith("online://")) continue;
      songsToFetch.push(song);
    }
    if (songsToFetch.length === 0) return;
    this.downloads.enqueue(
      songsToFetch.map((s) => ({
        id: s.id,
        title: s.title,
        artist: s.artist,
        cloud_path: s.cloud_path,
        size_bytes: s.size_bytes,
      })),
    );
    this.downloads.start();
  }

  // --- Playback ------------------------------------------------------------

  /**
   * Picked once per loaded file (driven by mpv's audio-detected event).
   *   Filler: always vocal — random idle playback should let the room
   *           hear the original singer, not a karaoke instrumental.
   *   Real song, lastChannel = "auto-accompaniment": KTV default —
   *           opposite side from the song's vocal_channel so the
   *           customer can sing along.
   *   Real song, lastChannel = "L"|"R"|"both": honor the user's last
   *           explicit pick from the previous song.
   */
  private async applyChannelDecision(): Promise<void> {
    if (this.fillerActive) {
      await this.mpv.setChannel(this.currentVocalChannel);
      return;
    }
    let ch: "L" | "R" | "both";
    if (this.lastChannel === "auto-accompaniment") {
      ch = this.currentVocalChannel === "L" ? "R" : "L";
    } else {
      ch = this.lastChannel;
    }
    await this.mpv.setChannel(ch);
  }

  private async maybeAutoPlay(): Promise<void> {
    // If a real queue song is playing, do nothing. Filler is OK to
    // displace if the queue head is now playable.
    if (this.currentSongId !== null) return;

    const head = this.db
      .prepare(
        `SELECT q.song_id FROM queue q ORDER BY q.position ASC LIMIT 1`,
      )
      .get() as { song_id: number } | undefined;
    if (!head) return;

    const song = this.db
      .prepare("SELECT * FROM songs WHERE id = ?")
      .get(head.song_id) as Song;
    const isOnline = song.cloud_path.startsWith("online://");

    let playablePath: string | null = null;
    if (isOnline) {
      if (!this.opts.resolveOnlineUrl) {
        console.warn(
          `[orchestrator] online song queued but no resolver wired: ${song.cloud_path}`,
        );
        return;
      }
      try {
        playablePath = await this.opts.resolveOnlineUrl(song.cloud_path);
      } catch (err) {
        console.error(
          `[orchestrator] failed to resolve online URL for song ${song.id}:`,
          err,
        );
        // Pop it from the queue so the next song can advance — leaving
        // an unresolvable head in place would stall everything.
        const qh = this.db
          .prepare("SELECT id FROM queue ORDER BY position ASC LIMIT 1")
          .get() as { id: number } | undefined;
        if (qh) this.removeQueueItem(qh.id);
        // Let the rest of the queue try.
        void this.maybeAutoPlay().catch(() => {});
        return;
      }
    } else {
      if (!song.cached || !song.local_path) return;
      if (!existsSync(song.local_path)) {
        console.warn(
          `[orchestrator] local_path missing on disk: ${song.local_path} — marking cache=0`,
        );
        this.db
          .prepare("UPDATE songs SET cached=0, local_path=NULL WHERE id = ?")
          .run(song.id);
        return;
      }
      playablePath = song.local_path;
    }

    this.currentSongId = song.id;
    this.currentVocalChannel = song.vocal_channel;
    // Promoting from filler → real song; clear the flag so onTrackEnded
    // treats the next end-of-file as a real-song completion.
    this.fillerActive = false;
    this.db
      .prepare(
        "UPDATE songs SET last_played_at = ?, play_count = play_count + 1 WHERE id = ?",
      )
      .run(Date.now(), song.id);
    try {
      await this.mpv.loadFile(playablePath, song.vocal_channel);
    } catch (err) {
      console.error("[orchestrator] mpv.loadFile failed", err);
      this.currentSongId = null;
      return;
    }
    this.broadcastPlayerState();
  }

  /**
   * Arm the suppression flag so any "stopped" event triggered by an
   * imminent stop()/load() arrives while we're still ignoring them.
   * 600 ms is conservative; mpv usually delivers within ~50 ms.
   */
  private armSkipGuard(): void {
    if (this.skippingTimer) clearTimeout(this.skippingTimer);
    this.skipping = true;
    this.skippingTimer = setTimeout(() => {
      this.skipping = false;
      this.skippingTimer = null;
    }, 600);
  }

  async skipCurrent(): Promise<void> {
    this.armSkipGuard();
    try {
      await this.mpv.stop();
    } catch {
      /* ignore */
    }
    // Only pop the queue head if a REAL queue song was playing. Filler
    // is ephemeral and isn't represented in the queue.
    if (this.currentSongId !== null) {
      const head = this.db
        .prepare("SELECT id FROM queue ORDER BY position ASC LIMIT 1")
        .get() as { id: number } | undefined;
      if (head) this.removeQueueItem(head.id);
    }
    this.currentSongId = null;
    this.fillerActive = false;
    await this.maybeAutoPlay();
    void this.maybeStartIdleFallback().catch(() => {});
  }

  async replay(): Promise<void> {
    await this.mpv.replay();
  }

  async toggleVocal(): Promise<void> {
    if (!this.currentSongId) return;
    await this.mpv.toggleVocal();
  }

  /**
   * Reload the currently-playing song from the start. Useful when mpv's
   * window was closed manually (X) or AirPlay/mirror dropped — calling this
   * makes mpv re-open the file and the host re-pushes it to the TV.
   */
  async reopenCurrent(): Promise<boolean> {
    if (!this.currentSongId) return false;
    const song = this.db
      .prepare("SELECT * FROM songs WHERE id = ?")
      .get(this.currentSongId) as Song | undefined;
    if (!song?.local_path || !existsSync(song.local_path)) return false;
    try {
      await this.mpv.loadFile(song.local_path, song.vocal_channel);
      return true;
    } catch (err) {
      console.error("[orchestrator] reopen failed", err);
      return false;
    }
  }

  async swapVocalChannel(): Promise<void> {
    if (!this.currentSongId) return;
    const song = this.db
      .prepare("SELECT * FROM songs WHERE id = ?")
      .get(this.currentSongId) as Song;
    const swapped: "L" | "R" = song.vocal_channel === "L" ? "R" : "L";
    this.db
      .prepare("UPDATE songs SET vocal_channel = ? WHERE id = ?")
      .run(swapped, song.id);
    // also re-apply filter for the current playback
    await this.mpv.setChannel(song.vocal_channel === "L" ? "L" : "R");
  }

  getCurrentSong(): Song | null {
    if (!this.currentSongId) return null;
    return (
      (this.db
        .prepare("SELECT * FROM songs WHERE id = ?")
        .get(this.currentSongId) as Song | undefined) ?? null
    );
  }

  getChannelState(): "L" | "R" | "both" {
    return this.currentChannelState;
  }

  private broadcastPlayerState(): void {
    this.emit("player.state", {
      current_song: this.getCurrentSong(),
      playing: this.currentSongId !== null,
      vocal_channel: this.currentChannelState,
    });
  }

  private async onTrackEnded(): Promise<void> {
    // Either a real queue song or a filler ended. If neither was playing,
    // ignore (stale event).
    if (this.currentSongId === null && !this.fillerActive) return;
    this.armSkipGuard();

    if (this.currentSongId !== null) {
      // Real-song completion: pop the head from the queue.
      const head = this.db
        .prepare("SELECT id FROM queue ORDER BY position ASC LIMIT 1")
        .get() as { id: number } | undefined;
      if (head) this.removeQueueItem(head.id);
    }
    // For filler: don't touch the queue, just clear the state.
    this.currentSongId = null;
    this.fillerActive = false;
    this.broadcastPlayerState();

    // Always re-schedule downloads after head may have changed — the new
    // top might be a Baidu placeholder that nobody asked to download yet,
    // and without this kick the queue silently stalls.
    void this.scheduleDownloads().catch(() => {});
    void this.maybeAutoPlay().catch(() => {});
    // Filler-cover: if the new head isn't immediately playable (or queue
    // is empty), start a random cached song so the TV doesn't go black.
    void this.maybeStartIdleFallback().catch(() => {});
  }

  /**
   * When the queue's head can't play yet (uncached, still downloading) or
   * the queue is empty, pick a random already-cached song and play it as
   * filler. The TV doesn't go to the desktop and the room doesn't go
   * silent. The filler is NOT a queue item — when it ends, onTrackEnded
   * sees fillerActive and skips queue mutation; if a real song became
   * playable in the meantime, maybeAutoPlay promotes it.
   */
  private async maybeStartIdleFallback(): Promise<void> {
    if (this.currentSongId !== null || this.fillerActive) return;
    // If the queue head IS playable now, the regular advance path will
    // handle it via task_done / maybeAutoPlay — don't override.
    const head = this.db
      .prepare(
        `SELECT s.id, s.cached, s.local_path FROM queue q
         JOIN songs s ON s.id = q.song_id
         ORDER BY q.position ASC LIMIT 1`,
      )
      .get() as
      | { id: number; cached: number; local_path: string | null }
      | undefined;
    if (head && head.cached === 1 && head.local_path) return;
    // Random cached song.
    const filler = this.db
      .prepare(
        `SELECT id, local_path, vocal_channel FROM songs
         WHERE cached = 1 AND local_path IS NOT NULL
         ORDER BY RANDOM() LIMIT 1`,
      )
      .get() as
      | { id: number; local_path: string; vocal_channel: "L" | "R" }
      | undefined;
    if (!filler || !existsSync(filler.local_path)) return;
    try {
      this.fillerActive = true;
      this.currentVocalChannel = filler.vocal_channel;
      await this.mpv.loadFile(filler.local_path, filler.vocal_channel);
      this.broadcastPlayerState();
    } catch (err) {
      this.fillerActive = false;
      console.warn("[orchestrator] idle filler load failed:", err);
    }
  }
}

