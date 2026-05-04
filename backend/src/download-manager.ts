/**
 * In-memory download manager. Wraps baidu-downloader.downloadOne with:
 *  - bounded concurrency
 *  - request stagger (anti-风控)
 *  - SQLite cached/local_path updates on success
 *  - EventEmitter for UI/CLI consumers (task_added, task_started,
 *    task_progress, task_done, task_failed, task_skipped, queue_drained).
 *
 * Designed to be shared between the batch CLI and the web UI server.
 */

import { EventEmitter } from "node:events";
import { stat } from "node:fs/promises";
import {
  downloadOne,
  mirrorDestPath,
  artistDestPath,
} from "./baidu-downloader.ts";
import type { Db } from "./db.ts";

export type TaskState =
  | "queued"
  | "downloading"
  | "done"
  | "failed"
  | "skipped";

export type DownloadTask = {
  /** songs.id */
  id: number;
  cloud_path: string;
  dest: string;
  artist: string;
  title: string;
  size_bytes: number | null;
  state: TaskState;
  bytesWritten: number;
  bytesTotal: number | null;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
};

export type SongRow = {
  id: number;
  title: string;
  artist: string;
  cloud_path: string;
  size_bytes: number | null;
};

export type DownloadManagerOpts = {
  db: Db;
  bduss: string;
  stoken?: string;
  libraryPath: string;
  rootPrefix?: string;
  concurrency?: number;
  requestDelayMs?: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class DownloadManager extends EventEmitter {
  private readonly db: Db;
  private readonly bduss: string;
  private readonly stoken: string;
  private readonly libraryPath: string;
  private readonly rootPrefix: string;
  private readonly concurrency: number;
  private readonly requestDelayMs: number;

  private tasks = new Map<number, DownloadTask>();
  private queue: DownloadTask[] = [];
  private cursor = 0;
  private active = 0;
  private running = false;
  private ac = new AbortController();
  private updateStmt: ReturnType<Db["prepare"]>;

  constructor(opts: DownloadManagerOpts) {
    super();
    this.db = opts.db;
    this.bduss = opts.bduss;
    this.stoken = opts.stoken ?? "";
    this.libraryPath = opts.libraryPath;
    this.rootPrefix = opts.rootPrefix ?? "/KTV/";
    this.concurrency = opts.concurrency ?? 4;
    this.requestDelayMs = opts.requestDelayMs ?? 300;
    this.updateStmt = this.db.prepare(
      "UPDATE songs SET cached = 1, local_path = ? WHERE id = ?",
    );
  }

  /** Returns a snapshot of all tasks ever submitted (queued/active/done/failed). */
  getTasks(): DownloadTask[] {
    return [...this.tasks.values()];
  }

  /** Counts tasks by state. */
  getCounts(): Record<TaskState, number> & { total: number } {
    const counts: Record<TaskState, number> = {
      queued: 0,
      downloading: 0,
      done: 0,
      failed: 0,
      skipped: 0,
    };
    for (const t of this.tasks.values()) counts[t.state]++;
    return { ...counts, total: this.tasks.size };
  }

  /**
   * Add songs to the queue. Songs already enqueued (by id) are ignored.
   * Returns the tasks actually added.
   */
  enqueue(rows: SongRow[]): DownloadTask[] {
    const added: DownloadTask[] = [];
    for (const row of rows) {
      if (this.tasks.has(row.id)) continue;
      const task: DownloadTask = {
        id: row.id,
        cloud_path: row.cloud_path,
        dest: artistDestPath(row.cloud_path, row.artist, this.libraryPath),
        artist: row.artist,
        title: row.title,
        size_bytes: row.size_bytes,
        state: "queued",
        bytesWritten: 0,
        bytesTotal: row.size_bytes,
        error: null,
        startedAt: null,
        finishedAt: null,
      };
      this.tasks.set(row.id, task);
      this.queue.push(task);
      added.push(task);
      this.emit("task_added", task);
    }
    return added;
  }

  /** Start workers if not already running. Idempotent. */
  start(): void {
    if (this.running) return;
    this.running = true;
    if (this.ac.signal.aborted) {
      this.ac = new AbortController();
    }
    for (let i = 0; i < this.concurrency; i++) {
      this.spawnWorker(i + 1);
    }
  }

  /** Abort all in-flight downloads and stop accepting new work from the queue. */
  abortAll(): void {
    this.ac.abort();
    this.running = false;
  }

  private async spawnWorker(workerId: number): Promise<void> {
    this.active++;
    try {
      while (this.cursor < this.queue.length && !this.ac.signal.aborted) {
        const task = this.queue[this.cursor++];
        if (!task) break;
        if (task.state !== "queued") continue;
        await this.runOne(task, workerId);
      }
    } finally {
      this.active--;
      if (this.active === 0) {
        this.running = false;
        this.emit("queue_drained", this.getCounts());
      }
    }
  }

  private async runOne(task: DownloadTask, workerId: number): Promise<void> {
    task.state = "downloading";
    task.startedAt = Date.now();
    this.emit("task_started", task, workerId);

    // Skip-check (size match) happens inside downloadOne too, but we mirror
    // the check here so we can publish a `skipped` event before we even hit
    // the API. We also accept files at the LEGACY mirrored path so the
    // user's pre-existing 歌星分类大全/... tree is recognized as already-
    // downloaded — the SQLite local_path then points at the legacy file.
    if (task.size_bytes != null) {
      const candidates = [
        task.dest,
        mirrorDestPath(task.cloud_path, this.libraryPath, this.rootPrefix),
      ];
      for (const cand of candidates) {
        try {
          const st = await stat(cand);
          if (Math.abs(st.size - task.size_bytes) <= 1024) {
            task.state = "skipped";
            task.bytesWritten = st.size;
            task.finishedAt = Date.now();
            // Persist whichever location we found, not necessarily task.dest.
            this.updateStmt.run(cand, task.id);
            this.emit("task_skipped", task);
            return;
          }
        } catch {
          /* not present at this candidate, try next */
        }
      }
    }

    if (this.requestDelayMs > 0) await sleep(this.requestDelayMs);

    const result = await downloadOne(task.cloud_path, task.dest, {
      bduss: this.bduss,
      stoken: this.stoken,
      signal: this.ac.signal,
      expectedSize: task.size_bytes,
      retries: 3,
      onProgress: (written, total) => {
        task.bytesWritten = written;
        task.bytesTotal = total;
        this.emit("task_progress", task);
      },
    });

    task.finishedAt = Date.now();
    if (result.ok) {
      this.updateStmt.run(result.localPath, task.id);
      task.state = result.skipped ? "skipped" : "done";
      task.bytesWritten = result.bytes;
      this.emit(result.skipped ? "task_skipped" : "task_done", task);
    } else {
      task.state = "failed";
      task.error = result.error;
      this.emit("task_failed", task);
    }
  }
}
