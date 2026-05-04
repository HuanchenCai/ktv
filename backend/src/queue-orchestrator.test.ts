import { describe, it, expect, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { Orchestrator } from "./queue-orchestrator.ts";
import { openInMemoryDb } from "./db.ts";
import type { Db } from "./db.ts";

// Minimal stubs for the dependencies the orchestrator touches in queue ops tests.
// Only queue-mutation behaviour is exercised here; download scheduling and
// playback are tested via integration elsewhere.
function makeMpvStub(): {
  emit: (ev: string, payload?: unknown) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
} {
  const e = new EventEmitter();
  return {
    on: e.on.bind(e),
    emit: e.emit.bind(e),
    loadFile: async () => {},
    setChannel: async () => {},
    toggleVocal: async () => "both" as const,
    pause: async () => {},
    resume: async () => {},
    stop: async () => {},
    replay: async () => {},
    setVolume: async () => {},
    getState: async () => ({ vocal_channel: "both" as const }),
    shutdown: async () => {},
  };
}

function makeDownloadsStub() {
  // Orchestrator subscribes to DownloadManager events and may call enqueue/
  // start. We track enqueued songs as 'queued' tasks so listQueue() sees a
  // non-null download field, mirroring the contract that scheduleDownloads
  // creates a pending row immediately.
  const e = new EventEmitter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tasks = new Map<number, any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enqueue = (rows: Array<any>) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const added: Array<any> = [];
    for (const r of rows) {
      if (tasks.has(r.id)) continue;
      const t = {
        id: r.id,
        cloud_path: r.cloud_path,
        artist: r.artist,
        title: r.title,
        size_bytes: r.size_bytes ?? null,
        state: "queued" as const,
        bytesWritten: 0,
        bytesTotal: r.size_bytes ?? null,
        error: null,
        startedAt: null,
        finishedAt: null,
        dest: `/tmp/ktv-test/${r.artist}/${r.id}.mkv`,
      };
      tasks.set(r.id, t);
      added.push(t);
    }
    return added;
  };
  return Object.assign(e, {
    enqueue,
    start: () => {},
    abortAll: () => {},
    getTasks: () => [...tasks.values()],
    getCounts: () => ({
      queued: tasks.size,
      downloading: 0,
      done: 0,
      failed: 0,
      skipped: 0,
      total: tasks.size,
    }),
  });
}

function setupDb(): Db {
  const db = openInMemoryDb();
  const ins = db.prepare(
    "INSERT INTO songs (title, artist, pinyin, cloud_path) VALUES (?, ?, ?, ?)",
  );
  for (let i = 1; i <= 5; i++) {
    ins.run(`song${i}`, `artist${i}`, `s${i}`, `/baidu/${i}.mkv`);
  }
  return db;
}

function makeOrchestrator(db: Db) {
  const mpv = makeMpvStub();
  const downloads = makeDownloadsStub();
  const orch = new Orchestrator(
    db,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    downloads as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mpv as any,
    "/tmp/ktv-test",
    { prefetchAhead: 2, pollIntervalMs: 60_000, baiduRoot: "/baidu" },
  );
  return { orch, mpv, downloads };
}

function queuePositions(db: Db): number[] {
  return (
    db
      .prepare("SELECT position FROM queue ORDER BY position ASC")
      .all() as Array<{ position: number }>
  ).map((r) => r.position);
}
function queueSongIds(db: Db): number[] {
  return (
    db
      .prepare("SELECT song_id FROM queue ORDER BY position ASC")
      .all() as Array<{ song_id: number }>
  ).map((r) => r.song_id);
}

describe("Orchestrator.enqueue", () => {
  let db: Db;
  beforeEach(() => {
    db = setupDb();
  });

  it("appends with monotonic positions", () => {
    const { orch } = makeOrchestrator(db);
    orch.enqueue(1, null);
    orch.enqueue(2, null);
    orch.enqueue(3, null);
    expect(queuePositions(db)).toEqual([1, 2, 3]);
    expect(queueSongIds(db)).toEqual([1, 2, 3]);
  });

  it("throws on unknown song", () => {
    const { orch } = makeOrchestrator(db);
    expect(() => orch.enqueue(999, null)).toThrow();
  });

  it("with top:true, inserts at front when nothing playing", () => {
    const { orch } = makeOrchestrator(db);
    orch.enqueue(1, null);
    orch.enqueue(2, null);
    orch.enqueue(3, null, { top: true });
    expect(queueSongIds(db)).toEqual([3, 1, 2]);
  });
});

describe("Orchestrator.removeQueueItem + compact", () => {
  let db: Db;
  beforeEach(() => {
    db = setupDb();
  });

  it("renumbers positions 1..n after middle removal", () => {
    const { orch } = makeOrchestrator(db);
    const a = orch.enqueue(1, null);
    const b = orch.enqueue(2, null);
    const c = orch.enqueue(3, null);
    orch.removeQueueItem(b.id);
    expect(queuePositions(db)).toEqual([1, 2]);
    expect(queueSongIds(db)).toEqual([1, 3]);
    // silence unused
    void a;
    void c;
  });
});

describe("Orchestrator.moveToFront", () => {
  let db: Db;
  beforeEach(() => {
    db = setupDb();
  });

  it("promotes selected item to position 1", () => {
    const { orch } = makeOrchestrator(db);
    orch.enqueue(1, null);
    orch.enqueue(2, null);
    const c = orch.enqueue(3, null);
    orch.moveToFront(c.id);
    expect(queueSongIds(db)).toEqual([3, 1, 2]);
    expect(queuePositions(db)).toEqual([1, 2, 3]);
  });

  it("no-op on already-first item", () => {
    const { orch } = makeOrchestrator(db);
    const a = orch.enqueue(1, null);
    orch.enqueue(2, null);
    orch.moveToFront(a.id);
    expect(queueSongIds(db)).toEqual([1, 2]);
  });
});

describe("Orchestrator.reorder", () => {
  let db: Db;
  beforeEach(() => {
    db = setupDb();
  });

  it("moves item forward (higher position)", () => {
    const { orch } = makeOrchestrator(db);
    const a = orch.enqueue(1, null);
    orch.enqueue(2, null);
    orch.enqueue(3, null);
    orch.enqueue(4, null);
    orch.reorder(a.id, 3);
    // 1 was at pos 1 → now pos 3; 2,3 shift up to 1,2; 4 stays at 4
    expect(queueSongIds(db)).toEqual([2, 3, 1, 4]);
  });

  it("moves item backward (lower position)", () => {
    const { orch } = makeOrchestrator(db);
    orch.enqueue(1, null);
    orch.enqueue(2, null);
    orch.enqueue(3, null);
    const d = orch.enqueue(4, null);
    orch.reorder(d.id, 1);
    expect(queueSongIds(db)).toEqual([4, 1, 2, 3]);
  });

  it("same position no-op", () => {
    const { orch } = makeOrchestrator(db);
    const a = orch.enqueue(1, null);
    orch.enqueue(2, null);
    orch.reorder(a.id, 1);
    expect(queueSongIds(db)).toEqual([1, 2]);
  });
});

describe("Orchestrator.listQueue", () => {
  let db: Db;
  beforeEach(() => {
    db = setupDb();
  });

  it("returns rows with embedded song and (possibly scheduled) download task", () => {
    const { orch } = makeOrchestrator(db);
    orch.enqueue(1, "client-a");
    orch.enqueue(2, "client-b");
    const rows = orch.listQueue();
    expect(rows).toHaveLength(2);
    expect(rows[0].song.title).toBe("song1");
    // enqueue triggers scheduleDownloads for top `prefetchAhead + 1` songs,
    // so a download_task row is expected to exist in pending/downloading state.
    expect(rows[0].download).not.toBeNull();
    expect(["pending", "downloading", "failed"]).toContain(
      rows[0].download?.status,
    );
    expect(rows[0].is_current).toBe(false); // nothing playing yet
    expect(rows[1].song.id).toBe(2);
  });
});
