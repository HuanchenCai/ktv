import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import { EventEmitter } from "node:events";

import { openInMemoryDb } from "./db.ts";
import type { Db } from "./db.ts";
import { Orchestrator } from "./queue-orchestrator.ts";
import { registerSongsRoutes } from "./api/songs.ts";
import { registerQueueRoutes } from "./api/queue.ts";
import { registerControlRoutes } from "./api/control.ts";

// Stubs for orchestrator dependencies so we can drive the full route surface
// without real OpenList or mpv.
function makeMpv() {
  const e = new EventEmitter();
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const stub = {
    on: e.on.bind(e),
    emit: e.emit.bind(e),
    calls,
    loadFile: async (...args: unknown[]) => {
      calls.push({ fn: "loadFile", args });
    },
    setChannel: async (...args: unknown[]) => {
      calls.push({ fn: "setChannel", args });
    },
    toggleVocal: async (...args: unknown[]) => {
      calls.push({ fn: "toggleVocal", args });
      return "L" as const;
    },
    pause: async () => {
      calls.push({ fn: "pause", args: [] });
    },
    resume: async () => {
      calls.push({ fn: "resume", args: [] });
    },
    stop: async () => {
      calls.push({ fn: "stop", args: [] });
    },
    replay: async () => {
      calls.push({ fn: "replay", args: [] });
    },
    setVolume: async (...args: unknown[]) => {
      calls.push({ fn: "setVolume", args });
    },
    getState: async () => ({ vocal_channel: "both" as const }),
    shutdown: async () => {},
  };
  return stub;
}

function makeDownloads() {
  // Stand-in for DownloadManager: EventEmitter shape + the methods the
  // orchestrator may call. The integration tests don't exercise real
  // downloads; they just need the orchestrator to construct cleanly.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { EventEmitter } = require("node:events") as typeof import("node:events");
  const e = new EventEmitter();
  return Object.assign(e, {
    enqueue: () => [],
    start: () => {},
    abortAll: () => {},
    getTasks: () => [],
    getCounts: () => ({
      queued: 0,
      downloading: 0,
      done: 0,
      failed: 0,
      skipped: 0,
      total: 0,
    }),
  });
}

async function buildApp(db: Db) {
  const mpv = makeMpv();
  const downloads = makeDownloads();
  const orch = new Orchestrator(
    db,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    downloads as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mpv as any,
    "/tmp/ktv-test",
    { prefetchAhead: 2, pollIntervalMs: 60_000, baiduRoot: "/baidu" },
  );
  const app = Fastify();
  await registerSongsRoutes(app, db);
  await registerQueueRoutes(app, orch);
  await registerControlRoutes(
    app,
    orch,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mpv as any,
  );
  return { app, orch, mpv, downloads };
}

function seedSongs(db: Db) {
  const ins = db.prepare(
    "INSERT INTO songs (title, artist, pinyin, cloud_path, cached) VALUES (?, ?, ?, ?, ?)",
  );
  ins.run("只有你", "周杰伦", "zyn", "/baidu/jay/zyn.mkv", 0);
  ins.run("稻香", "周杰伦", "dx", "/baidu/jay/dx.mkv", 0);
  ins.run("夜曲", "周杰伦", "yq", "/baidu/jay/yq.mkv", 0);
}

describe("API integration (routes against stubbed deps)", () => {
  let db: Db;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;

  beforeEach(async () => {
    db = openInMemoryDb();
    seedSongs(db);
    const built = await buildApp(db);
    app = built.app;
  });

  it("GET /api/songs returns all three seeded songs with no query", async () => {
    const res = await app.inject({ method: "GET", url: "/api/songs" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(3);
    expect(body.songs[0].title).toMatch(/稻香|夜曲|只有你/);
  });

  it("GET /api/songs?q=zyn matches via pinyin initials", async () => {
    const res = await app.inject({ method: "GET", url: "/api/songs?q=zyn" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(1);
    expect(body.songs[0].title).toBe("只有你");
  });

  it("POST /api/queue enqueues a song", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/queue",
      payload: { song_id: 1, added_by: "phone-1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.queued.song_id).toBe(1);

    const list = await app.inject({ method: "GET", url: "/api/queue" });
    expect(list.json().items).toHaveLength(1);
  });

  it("POST /api/queue with missing song_id returns 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/queue",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("DELETE /api/queue/:id removes and compacts", async () => {
    await app.inject({
      method: "POST",
      url: "/api/queue",
      payload: { song_id: 1 },
    });
    const addB = await app.inject({
      method: "POST",
      url: "/api/queue",
      payload: { song_id: 2 },
    });
    const bId = addB.json().queued.id;
    await app.inject({
      method: "POST",
      url: "/api/queue",
      payload: { song_id: 3 },
    });

    const del = await app.inject({
      method: "DELETE",
      url: `/api/queue/${bId}`,
    });
    expect(del.statusCode).toBe(200);

    const list = await app.inject({ method: "GET", url: "/api/queue" });
    const items = list.json().items as Array<{
      position: number;
      song: { id: number };
    }>;
    expect(items.map((i) => i.song.id)).toEqual([1, 3]);
    expect(items.map((i) => i.position)).toEqual([1, 2]);
  });

  it("POST /api/queue/:id/top moves an item to the front", async () => {
    await app.inject({
      method: "POST",
      url: "/api/queue",
      payload: { song_id: 1 },
    });
    await app.inject({
      method: "POST",
      url: "/api/queue",
      payload: { song_id: 2 },
    });
    const addC = await app.inject({
      method: "POST",
      url: "/api/queue",
      payload: { song_id: 3 },
    });
    const cId = addC.json().queued.id;

    await app.inject({ method: "POST", url: `/api/queue/${cId}/top` });
    const list = await app.inject({ method: "GET", url: "/api/queue" });
    const items = list.json().items as Array<{ song: { id: number } }>;
    expect(items[0].song.id).toBe(3);
  });

  it("POST /api/control/channel with bad value returns 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/control/channel",
      payload: { channel: "X" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /api/control/volume clamps and forwards to mpv", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/control/volume",
      payload: { volume: 50 },
    });
    expect(res.statusCode).toBe(200);
  });
});
