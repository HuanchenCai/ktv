import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openInMemoryDb } from "./db.ts";
import { importLocalLibrary } from "./local-importer.ts";

describe("importLocalLibrary", () => {
  it("restores a song after its NAS mount disappears and returns", async () => {
    const folder = await mkdtemp(join(tmpdir(), "ktv-nas-import-"));
    const video = join(folder, "test.mkv");
    const db = openInMemoryDb();
    try {
      await writeFile(video, "video");
      expect((await importLocalLibrary(db, folder)).added).toBe(1);
      db.prepare("UPDATE songs SET cached = 0, local_path = NULL").run();

      expect((await importLocalLibrary(db, folder)).added).toBe(1);
      expect(db.prepare("SELECT cached, local_path FROM songs").get()).toMatchObject({
        cached: 1,
        local_path: video,
      });
      expect((await importLocalLibrary(db, folder)).skipped).toBe(1);
    } finally {
      db.close();
      await rm(folder, { recursive: true, force: true });
    }
  });

  it("reports a missing mount instead of a successful empty scan", async () => {
    const folder = await mkdtemp(join(tmpdir(), "ktv-nas-import-"));
    const db = openInMemoryDb();
    try {
      await expect(importLocalLibrary(db, join(folder, "disconnected"))).rejects.toThrow(
        "Cannot read song folder",
      );
    } finally {
      db.close();
      await rm(folder, { recursive: true, force: true });
    }
  });
});
