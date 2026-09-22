import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "./config.ts";

function parse(changes: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ktv-config-test-"));
  try {
    writeFileSync(join(dir, "config.json"), JSON.stringify({ openlist: {}, mpv: {}, scheduler: {}, library_path: "./library", ...changes }));
    return loadConfig(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe("portable configuration", () => {
  it("preserves local defaults for existing installations", () => {
    const cfg = parse();
    expect(cfg.room.public_url).toBe("");
    expect(cfg.openlist.auto_spawn).toBe(true);
    expect(cfg.library_path).toContain("ktv-config-test-");
  });
  it("requires explicit remote mode without spawning another OpenList", () => {
    expect(() => parse({ openlist: { base_url: "https://nas.example" } })).toThrow();
    expect(parse({ openlist: { base_url: "https://nas.example", auto_spawn: false, root: "/nas" } }).openlist.root).toBe("/nas");
  });
  it("rejects public mode without separate sufficient credentials", () => {
    expect(() => parse({ room: { public_url: "https://party.example" } })).toThrow();
    expect(() => parse({ room: { public_url: "https://party.example", guest_code: "short", admin_code: "long-admin-secret-123456789" } })).toThrow();
  });
  it("rejects insecure or subpath public URLs and accepts HTTPS origin", () => {
    const codes = { guest_code: "guest-code-2026", admin_code: "long-private-admin-code-2026" };
    for (const public_url of ["http://party.example", "https://party.example/ktv", "https://user:pass@party.example"]) {
      expect(() => parse({ room: { ...codes, public_url } })).toThrow();
    }
    expect(parse({ room: { ...codes, public_url: "https://party.example" } }).room.public_url).toBe("https://party.example");
  });
});
