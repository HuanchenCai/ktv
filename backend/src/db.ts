import { DatabaseSync } from "node:sqlite";
import { resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";

/**
 * We use Node 22+ built-in node:sqlite (stable in Node 24).
 * No native compilation, no build tools required.
 */

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

export type QueueItem = {
  id: number;
  song_id: number;
  position: number;
  added_by: string | null;
  added_at: number;
};

export type DownloadTask = {
  id: number;
  song_id: number;
  openlist_task_id: string | null;
  status: "pending" | "downloading" | "done" | "failed";
  progress: number;
  speed_bps: number | null;
  eta_seconds: number | null;
  started_at: number | null;
  finished_at: number | null;
  error: string | null;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  lang TEXT,
  genre TEXT,
  pinyin TEXT NOT NULL,
  cloud_path TEXT NOT NULL UNIQUE,
  size_bytes INTEGER,
  cached INTEGER NOT NULL DEFAULT 0,
  local_path TEXT,
  vocal_channel TEXT NOT NULL DEFAULT 'L',
  last_played_at INTEGER,
  play_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_songs_pinyin ON songs(pinyin);
CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist);
CREATE INDEX IF NOT EXISTS idx_songs_cached ON songs(cached);

CREATE TABLE IF NOT EXISTS queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  added_by TEXT,
  added_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_queue_position ON queue(position);

CREATE TABLE IF NOT EXISTS download_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  openlist_task_id TEXT,
  status TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  speed_bps INTEGER,
  eta_seconds INTEGER,
  started_at INTEGER,
  finished_at INTEGER,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_dl_status ON download_tasks(status);
CREATE INDEX IF NOT EXISTS idx_dl_song ON download_tasks(song_id);
`;

export type Db = DatabaseSync;

export function openDb(filePath: string): Db {
  mkdirSync(dirname(resolve(filePath)), { recursive: true });
  const db = new DatabaseSync(resolve(filePath));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

/**
 * Run a set of statements in a single transaction. node:sqlite does not expose
 * a convenience `.transaction()` like better-sqlite3, so we implement it here.
 * Throws if the function throws — caller sees original exception.
 */
export function withTransaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
