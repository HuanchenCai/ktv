import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openInMemoryDb } from "./db.ts";
import { Orchestrator } from "./queue-orchestrator.ts";
import type { DownloadManager } from "./download-manager.ts";
import type { MpvController } from "./mpv-controller.ts";

const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).forEach((f) => f()); });
const tick = () => new Promise<void>((r) => setImmediate(r));
function fixture(resolveLibraryUrl: (path: string) => Promise<string>) {
  const db = openInMemoryDb();
  for (let i = 1; i <= 3; i++) db.prepare("INSERT INTO songs (title, artist, pinyin, cloud_path) VALUES (?, 'artist', 's', ?)").run(`song${i}`, `openlist:///nas/${i}.mkv`);
  const mpv = Object.assign(new EventEmitter(), {
    loadFile: vi.fn().mockResolvedValue(undefined), setChannel: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined),
    isPaused: () => false,
  });
  const downloads = Object.assign(new EventEmitter(), { enqueue: vi.fn(), start: vi.fn(), getTasks: () => [] });
  const orch = new Orchestrator(db, downloads as unknown as DownloadManager, mpv as unknown as MpvController, ".", {
    prefetchAhead: 2, pollIntervalMs: 500, baiduRoot: "/baidu", resolveLibraryUrl,
  });
  cleanup.push(() => { orch.stop(); db.close(); });
  return { db, mpv, downloads, orch };
}

describe("portable remote playback", () => {
  it("streams without downloading and retains karaoke channel switching", async () => {
    const { orch, mpv, downloads } = fixture(async () => "https://nas.example/p/song?sign=1");
    orch.enqueue(1, "phone-on-mobile-data");
    await tick();
    expect(mpv.loadFile).toHaveBeenCalledWith("https://nas.example/p/song?sign=1", "L");
    expect(downloads.enqueue).not.toHaveBeenCalled();
    mpv.emit("audio-detected");
    await tick();
    expect(mpv.setChannel).toHaveBeenCalledWith("R");
    expect(orch.getCurrentSong()?.id).toBe(1);
  });

  it("does not resolve or load twice when multiple guests enqueue during lookup", async () => {
    let release!: (value: string) => void;
    const resolver = vi.fn(() => new Promise<string>((r) => { release = r; }));
    const { orch, mpv } = fixture(resolver);
    orch.enqueue(1, "a");
    orch.enqueue(2, "b");
    expect(resolver).toHaveBeenCalledTimes(1);
    release("https://nas.example/1");
    await tick(); await tick();
    expect(mpv.loadFile).toHaveBeenCalledTimes(1);
    expect(orch.listQueue().map((r) => r.song.id)).toEqual([1, 2]);
  });

  it("does not start a song after stop was pressed during resolution", async () => {
    let release!: (value: string) => void;
    const { orch, mpv } = fixture(() => new Promise((r) => { release = r; }));
    orch.enqueue(1, null);
    await orch.stopPlayback();
    release("https://nas.example/1");
    await tick(); await tick();
    expect(mpv.loadFile).not.toHaveBeenCalled();
    expect(orch.getCurrentSong()).toBeNull();
  });

  it("skips the resolving item and plays the next instead of the stale URL", async () => {
    let release!: (value: string) => void;
    const { orch, mpv } = fixture((path) => path.endsWith("1.mkv")
      ? new Promise((r) => { release = r; }) : Promise.resolve("https://nas.example/2"));
    orch.enqueue(1, null); orch.enqueue(2, null);
    await orch.skipCurrent();
    release("https://nas.example/1");
    await vi.waitFor(() => expect(orch.getCurrentSong()?.id).toBe(2));
    expect(mpv.loadFile).toHaveBeenCalledTimes(1);
    expect(mpv.loadFile.mock.calls[0][0]).toBe("https://nas.example/2");
  });

  it("does not remove a replacement queue head when a stale request fails", async () => {
    let reject!: (error: Error) => void;
    const { orch } = fixture((path) => path.endsWith("1.mkv")
      ? new Promise((_r, j) => { reject = j; }) : Promise.resolve("https://nas.example/2"));
    const first = orch.enqueue(1, null); orch.enqueue(2, null);
    orch.removeQueueItem(first.id);
    reject(new Error("NAS went offline"));
    await vi.waitFor(() => expect(orch.getCurrentSong()?.id).toBe(2));
    expect(orch.listQueue().map((r) => r.song.id)).toEqual([2]);
  });

  it("refreshes the remote link when reopening the current song", async () => {
    const resolver = vi.fn().mockResolvedValueOnce("https://nas.example/old").mockResolvedValueOnce("https://nas.example/new");
    const { orch, mpv } = fixture(resolver);
    orch.enqueue(1, null); await tick();
    expect(await orch.reopenCurrent()).toBe(true);
    expect(mpv.loadFile).toHaveBeenLastCalledWith("https://nas.example/new", "L");
  });
});
