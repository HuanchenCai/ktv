import { EventEmitter } from "node:events";
import { basename, resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import type { OpenListClient, OpenListTask } from "./openlist-client.ts";
import type { MpvController } from "./mpv-controller.ts";
import { withTransaction } from "./db.ts";
import type { Db, Song, QueueItem, DownloadTask } from "./db.ts";

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
    private openlist: OpenListClient,
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
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.pollTimer = setInterval(() => {
      void this.tick().catch((err) => {
        console.error("[orchestrator] tick error", err);
      });
    }, this.opts.pollIntervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // --- Queue ops -----------------------------------------------------------

  enqueue(songId: number, addedBy: string | null): QueueItem {
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
    this.emit("queue.updated");
    void this.scheduleDownloads().catch(() => {});
    void this.maybeAutoPlay().catch(() => {});
    return item;
  }

  removeQueueItem(queueId: number): void {
    this.db.prepare("DELETE FROM queue WHERE id = ?").run(queueId);
    this.compactPositions();
    this.emit("queue.updated");
  }

  moveToFront(queueId: number): void {
    const item = this.db
      .prepare("SELECT * FROM queue WHERE id = ?")
      .get(queueId) as QueueItem | undefined;
    if (!item) return;

    // Insert at position 1 (assuming positions start at 1 — see compact).
    withTransaction(this.db, () => {
      // bump everything up, then place item at 1
      this.db
        .prepare("UPDATE queue SET position = position + 1 WHERE id != ?")
        .run(queueId);
      this.db
        .prepare("UPDATE queue SET position = 1 WHERE id = ?")
        .run(queueId);
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

    return rows.map((r) => {
      const song = this.db
        .prepare("SELECT * FROM songs WHERE id = ?")
        .get(r.song_id) as Song;
      const download = this.db
        .prepare(
          "SELECT * FROM download_tasks WHERE song_id = ? ORDER BY id DESC LIMIT 1",
        )
        .get(r.song_id) as DownloadTask | undefined;
      return {
        queue_id: r.queue_id,
        position: r.position,
        song,
        download: download ?? null,
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

    for (const { song_id } of top) {
      const song = this.db
        .prepare("SELECT * FROM songs WHERE id = ?")
        .get(song_id) as Song;
      if (song.cached) continue;

      const activeTask = this.db
        .prepare(
          "SELECT * FROM download_tasks WHERE song_id = ? AND status IN ('pending','downloading') LIMIT 1",
        )
        .get(song_id) as DownloadTask | undefined;
      if (activeTask) continue;

      const info = this.db
        .prepare(
          `INSERT INTO download_tasks (song_id, status, progress, started_at)
           VALUES (?, 'pending', 0, ?)`,
        )
        .run(song_id, Date.now());
      const task = this.db
        .prepare("SELECT * FROM download_tasks WHERE id = ?")
        .get(info.lastInsertRowid) as DownloadTask;
      this.emit("download.progress", task);

      const cloud = song.cloud_path;
      const srcDir = cloud.substring(0, cloud.lastIndexOf("/")) || "/";
      const srcFilename = basename(cloud);
      try {
        await this.openlist.copy({
          src_dir: srcDir,
          // dst_dir is OpenList's "local" storage mount path (user configured).
          // We assume it's mounted at `/local` per the M0 runbook convention.
          dst_dir: "/local",
          names: [srcFilename],
        });
        this.db
          .prepare(
            "UPDATE download_tasks SET status = 'downloading' WHERE id = ?",
          )
          .run(task.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.db
          .prepare(
            "UPDATE download_tasks SET status = 'failed', error = ?, finished_at = ? WHERE id = ?",
          )
          .run(msg, Date.now(), task.id);
        this.emit("download.progress", {
          ...task,
          status: "failed",
          error: msg,
        });
      }
    }
  }

  // --- Polling loop --------------------------------------------------------

  private async tick(): Promise<void> {
    // Refresh open tasks from OpenList, match them to our pending rows, update.
    let undone: OpenListTask[] = [];
    let done: OpenListTask[] = [];
    try {
      [undone, done] = await Promise.all([
        this.openlist.undoneCopyTasks(),
        this.openlist.doneCopyTasks(),
      ]);
    } catch {
      return; // openlist not ready yet
    }

    const pendingRows = this.db
      .prepare(
        "SELECT * FROM download_tasks WHERE status IN ('pending','downloading')",
      )
      .all() as DownloadTask[];

    for (const row of pendingRows) {
      const song = this.db
        .prepare("SELECT * FROM songs WHERE id = ?")
        .get(row.song_id) as Song;
      const filename = basename(song.cloud_path);
      const match =
        undone.find((t) => t.name.includes(filename)) ??
        done.find((t) => t.name.includes(filename));

      if (!match) continue;

      // Map OpenList state (best effort — task APIs return numeric state codes).
      if (match.state === 2) {
        // success
        const localPath = resolve(this.libraryPath, filename);
        this.db
          .prepare(
            `UPDATE download_tasks SET status='done', progress=1, finished_at=?, openlist_task_id=? WHERE id = ?`,
          )
          .run(Date.now(), match.id, row.id);
        this.db
          .prepare(
            `UPDATE songs SET cached=1, local_path=? WHERE id = ?`,
          )
          .run(localPath, song.id);
        const finalTask = this.db
          .prepare("SELECT * FROM download_tasks WHERE id = ?")
          .get(row.id) as DownloadTask;
        this.emit("download.progress", finalTask);
        void this.maybeAutoPlay().catch(() => {});
      } else if (match.state === 4 || match.state === 3) {
        // errored / cancelled
        this.db
          .prepare(
            `UPDATE download_tasks SET status='failed', error=?, finished_at=?, openlist_task_id=? WHERE id = ?`,
          )
          .run(match.error ?? match.status, Date.now(), match.id, row.id);
        this.emit("download.progress", {
          ...row,
          status: "failed",
          error: match.error ?? null,
        });
      } else {
        // running
        const progress = Math.min(1, Math.max(0, (match.progress ?? 0) / 100));
        this.db
          .prepare(
            `UPDATE download_tasks SET status='downloading', progress=?, openlist_task_id=? WHERE id = ?`,
          )
          .run(progress, match.id, row.id);
        this.emit("download.progress", {
          ...row,
          status: "downloading",
          progress,
          openlist_task_id: match.id,
        });
      }
    }
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

// Silence unused import warning during development
void dirname;
