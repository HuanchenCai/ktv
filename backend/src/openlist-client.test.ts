import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenListClient } from "./openlist-client.ts";
import { Scanner } from "./scanner.ts";
import { openInMemoryDb } from "./db.ts";

afterEach(() => vi.unstubAllGlobals());

describe("remote library", () => {
  it("resolves signed proxy URLs without exposing the API token or NAS-private raw URL", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 200, data: { raw_url: "http://192.168.1.20/private.mkv", sign: "ab+c=:123", is_dir: false },
    })));
    vi.stubGlobal("fetch", fetcher);
    const client = new OpenListClient({ baseUrl: "https://nas.example/openlist", token: "secret" });
    const url = new URL(await client.playbackUrl("/KTV/周杰伦/稻香 #1.mkv"));
    expect(decodeURIComponent(url.pathname)).toBe("/openlist/p/KTV/周杰伦/稻香 #1.mkv");
    expect(url.searchParams.get("sign")).toBe("ab+c=:123");
    expect(url.href).not.toContain("secret");
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("secret");
    expect(JSON.parse(fetcher.mock.calls[0][1].body).path).toBe("/KTV/周杰伦/稻香 #1.mkv");
  });

  it("surfaces expired credentials and never returns a fake playable URL", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 401, message: "expired" }))));
    await expect(new OpenListClient({ baseUrl: "https://nas.example", token: "bad" }).playbackUrl("/song.mkv")).rejects.toThrow("401");
  });

  it("logs in once and retries concurrent source reads after token invalidation", async () => {
    const fetcher = vi.fn().mockImplementation(async (input: string, init: RequestInit) => {
      if (input.endsWith("/api/auth/login")) {
        expect(JSON.parse(init.body as string)).toEqual({ username: "ktv", password: "private" });
        return new Response(JSON.stringify({ code: 200, data: { token: "fresh" } }));
      }
      if ((init.headers as Record<string, string>).Authorization !== "fresh") {
        return new Response(JSON.stringify({ code: 401, message: "token is invalidated" }));
      }
      if (input.endsWith("/api/fs/list")) return new Response(JSON.stringify({ code: 200, data: { content: [] } }));
      return new Response(JSON.stringify({ code: 200, data: { sign: "signed", is_dir: false } }));
    });
    vi.stubGlobal("fetch", fetcher);
    const client = new OpenListClient({ baseUrl: "https://nas.example", token: "stale", username: "ktv", password: "private" });
    const [files, url] = await Promise.all([client.list("/KTV"), client.playbackUrl("/KTV/song.mkv")]);
    expect(files).toEqual([]);
    expect(url).toContain("sign=signed");
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/api/auth/login"))).toHaveLength(1);
  });

  it("signs in before listing a private mount when no token was saved", async () => {
    const fetcher = vi.fn().mockImplementation(async (input: string, init: RequestInit) => {
      if (input.endsWith("/api/auth/login")) return new Response(JSON.stringify({ code: 200, data: { token: "fresh" } }));
      expect((init.headers as Record<string, string>).Authorization).toBe("fresh");
      return new Response(JSON.stringify({ code: 200, data: { content: [] } }));
    });
    vi.stubGlobal("fetch", fetcher);
    const client = new OpenListClient({ baseUrl: "https://nas.example", token: "", username: "ktv", password: "private" });
    expect(await client.list("/private")).toEqual([]);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "https://nas.example/api/auth/login",
      "https://nas.example/api/fs/list",
    ]);
  });

  it("indexes NAS and cloud mounts as streamable songs, without downloading, and is repeatable", async () => {
    const db = openInMemoryDb();
    try {
      const list = vi.fn().mockResolvedValue([{ name: "歌手-歌名.mkv", size: 300000000, is_dir: false }]);
      const scanner = new Scanner(db, { list } as unknown as OpenListClient, "/nas");
      expect((await scanner.scan()).inserted).toBe(1);
      expect((await scanner.scan()).updated).toBe(1);
      expect(db.prepare("SELECT cloud_path, cached, local_path FROM songs").get()).toMatchObject({
        cloud_path: "openlist:///nas/歌手-歌名.mkv", cached: 0, local_path: null,
      });
    } finally { db.close(); }
  });

  it("reports a disconnected source instead of claiming a successful empty scan", async () => {
    const db = openInMemoryDb();
    try {
      const scanner = new Scanner(db, { list: vi.fn().mockRejectedValue(new Error("offline")) } as unknown as OpenListClient, "/nas");
      await expect(scanner.scan()).rejects.toThrow("offline");
    } finally { db.close(); }
  });
});
