import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadRemote } from "./remote-download.ts";
import { DownloadManager } from "./download-manager.ts";
import { openInMemoryDb } from "./db.ts";

const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function temp() { const dir = await mkdtemp(join(tmpdir(), "ktv-remote-test-")); dirs.push(dir); return dir; }

describe("explicit remote offline downloads", () => {
  it("writes atomically and reports exact progress", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("abcdef", { headers: { "content-length": "6" } })));
    const file = join(await temp(), "song.mkv");
    const progress = vi.fn();
    expect(await downloadRemote("https://nas.example/song", file, { expectedSize: 6, onProgress: progress })).toMatchObject({ ok: true, bytes: 6 });
    expect(await readFile(file, "utf8")).toBe("abcdef");
    expect(existsSync(file + ".part")).toBe(false);
    expect(progress).toHaveBeenLastCalledWith(6, 6);
  });
  it("does not mark a truncated file as usable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("short")));
    const file = join(await temp(), "song.mkv");
    expect(await downloadRemote("https://nas.example/song", file, { expectedSize: 100 })).toMatchObject({ ok: false });
    expect(existsSync(file)).toBe(false);
    expect(existsSync(file + ".part")).toBe(false);
  });
  it("rejects an HTML login response even if the server returns 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>login</html>", { headers: { "content-type": "text/html" } })));
    const file = join(await temp(), "song.mkv");
    expect(await downloadRemote("https://nas.example/song", file, {})).toMatchObject({ ok: false });
    expect(existsSync(file)).toBe(false);
  });
  it("retries failed source lookups and records the completed offline copy", async () => {
    const db = openInMemoryDb();
    try {
      db.prepare("INSERT INTO songs(title, artist, pinyin, cloud_path) VALUES('song','artist','s','openlist:///nas/song.mkv')").run();
      const resolver = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue("https://nas.example/song");
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("video!")));
      const manager = new DownloadManager({ db, bduss: "", libraryPath: await temp(), concurrency: 1, requestDelayMs: 0, resolveLibraryUrl: resolver });
      const rows = [{ id: 1, artist: "artist", title: "song", cloud_path: "openlist:///nas/song.mkv", size_bytes: 6 }];
      manager.enqueue(rows); manager.start();
      await vi.waitFor(() => expect(manager.getTasks()[0].state).toBe("failed"));
      manager.enqueue(rows); manager.start();
      await vi.waitFor(() => expect(manager.getTasks()[0].state).toBe("done"));
      const song = db.prepare("SELECT cached, local_path FROM songs WHERE id=1").get();
      expect(song?.cached).toBe(1);
      expect(await readFile(String(song?.local_path), "utf8")).toBe("video!");
      expect(resolver).toHaveBeenCalledTimes(2);
    } finally { db.close(); }
  });
});
