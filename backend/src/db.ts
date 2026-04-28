import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";

// Vite 5 mishandles `import ... from "node:sqlite"` (strips the scheme and
// then can't find bare "sqlite"). Fall back to CommonJS require — node:sqlite
// is a built-in since Node 22 (stable in 24+).
const nodeRequire = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { DatabaseSync } = nodeRequire("node:sqlite") as {
  DatabaseSync: new (path: string) => DatabaseSyncInstance;
};

type DatabaseSyncInstance = {
  exec: (sql: string) => void;
  prepare: (sql: string) => StatementSyncInstance;
  close: () => void;
};
type StatementSyncInstance = {
  run: (
    ...params: Array<string | number | bigint | Buffer | null>
  ) => { changes: number; lastInsertRowid: number | bigint };
  get: (
    ...params: Array<string | number | bigint | Buffer | null>
  ) => Record<string, unknown> | undefined;
  all: (
    ...params: Array<string | number | bigint | Buffer | null>
  ) => Array<Record<string, unknown>>;
};

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

// Two-stage schema: first create the tables, then run idempotent migrations
// (ALTER TABLE) so a fresh DB and a pre-existing DB both end up with the same
// columns, THEN create the indexes — the indexes can reference columns that
// were only added by a migration.
const TABLES = `
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

CREATE TABLE IF NOT EXISTS queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  added_by TEXT,
  added_at INTEGER NOT NULL
);

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
`;

const MIGRATIONS: Array<{ name: string; sql: string }> = [
  {
    name: "add artist_pinyin",
    sql: "ALTER TABLE songs ADD COLUMN artist_pinyin TEXT NOT NULL DEFAULT ''",
  },
];

const INDEXES = `
CREATE INDEX IF NOT EXISTS idx_songs_pinyin ON songs(pinyin);
CREATE INDEX IF NOT EXISTS idx_songs_artist_pinyin ON songs(artist_pinyin);
CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist);
CREATE INDEX IF NOT EXISTS idx_songs_cached ON songs(cached);
CREATE INDEX IF NOT EXISTS idx_queue_position ON queue(position);
CREATE INDEX IF NOT EXISTS idx_dl_status ON download_tasks(status);
CREATE INDEX IF NOT EXISTS idx_dl_song ON download_tasks(song_id);
`;

export type Db = DatabaseSyncInstance;

function applyMigrations(db: Db) {
  for (const m of MIGRATIONS) {
    try {
      db.exec(m.sql);
    } catch (err) {
      // SQLite throws on ADD COLUMN when the column already exists; that's
      // expected for an already-migrated DB. Anything else we surface.
      const msg = err instanceof Error ? err.message : String(err);
      if (!/duplicate column name/i.test(msg)) {
        console.warn(`[db] migration "${m.name}" skipped: ${msg}`);
      }
    }
  }
}

export function openDb(filePath: string): Db {
  mkdirSync(dirname(resolve(filePath)), { recursive: true });
  const db = new DatabaseSync(resolve(filePath));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(TABLES);
  applyMigrations(db);
  db.exec(INDEXES);
  return db;
}

/** Open an in-memory DB; used by tests. */
export function openInMemoryDb(): Db {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(TABLES);
  applyMigrations(db);
  db.exec(INDEXES);
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
