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
  private currentChannelState: "L" | "R" | "both" = "both";

  constructor(
    private db: Db,
    private downloads: DownloadManager,
    private mpv: MpvController,
    private libraryPath: string,
    private opts: {
      prefetchAhead: number;
      pollIntervalMs: number;
      baiduRoot: string;
    },
  ) {
    super();

    this.mpv.on("track-ended", () => {
      void this.onTrackEnded();
    });
    this.mpv.on("channel-changed", (info: { channel: "L" | "R" | "both" }) => {
      this.currentChannelState = info.channel;
      this.broadcastPlayerState();
    });
    this.mpv.on("paused", () => this.broadcastPlayerState());
    this.mpv.on("resumed", () => this.broadcastPlayerState());
    this.mpv.on("track-started", () => this.broadcastPlayerState());

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
    void this.maybeAutoPlay().catch(() => {});
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

  private async maybeAutoPlay(): Promise<void> {
    if (this.currentSongId !== null) return; // already playing something

    const head = this.db
      .prepare(
        `SELECT q.song_id FROM queue q ORDER BY q.position ASC LIMIT 1`,
      )
      .get() as { song_id: number } | undefined;
    if (!head) return;

    const song = this.db
      .prepare("SELECT * FROM songs WHERE id = ?")
      .get(head.song_id) as Song;
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

    this.currentSongId = song.id;
    this.db
      .prepare(
        "UPDATE songs SET last_played_at = ?, play_count = play_count + 1 WHERE id = ?",
      )
      .run(Date.now(), song.id);
    try {
      await this.mpv.loadFile(song.local_path, song.vocal_channel);
    } catch (err) {
      console.error("[orchestrator] mpv.loadFile failed", err);
      this.currentSongId = null;
      return;
    }
    this.broadcastPlayerState();
  }

  async skipCurrent(): Promise<void> {
    const head = this.db
      .prepare("SELECT id FROM queue ORDER BY position ASC LIMIT 1")
      .get() as { id: number } | undefined;
    if (head) this.removeQueueItem(head.id);
    this.currentSongId = null;
    try {
      await this.mpv.stop();
    } catch {
      /* ignore */
    }
    void this.maybeAutoPlay().catch(() => {});
  }

  async replay(): Promise<void> {
    await this.mpv.replay();
  }

  async toggleVocal(): Promise<void> {
    if (!this.currentSongId) return;
    const song = this.db
      .prepare("SELECT * FROM songs WHERE id = ?")
      .get(this.currentSongId) as Song;
    await this.mpv.toggleVocal(song.vocal_channel);
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
    if (!this.currentSongId) return;
    // remove current from queue; advance
    const head = this.db
      .prepare("SELECT id FROM queue ORDER BY position ASC LIMIT 1")
      .get() as { id: number } | undefined;
    if (head) this.removeQueueItem(head.id);
    this.currentSongId = null;
    this.broadcastPlayerState();
    void this.maybeAutoPlay().catch(() => {});
  }
}

