import { afterEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { registerRoomAccess } from "./room-access.ts";
import { registerControlRoutes } from "./api/control.ts";
import type { Orchestrator } from "./queue-orchestrator.ts";
import type { MpvController } from "./mpv-controller.ts";

const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((a) => a.close())); });
const room = { public_url: "https://party.example", guest_code: "friends-2026", admin_code: "a-private-host-password-12345" };
async function setup(enabled = true) {
  const app = Fastify();
  apps.push(app);
  registerRoomAccess(app, { ...room, public_url: enabled ? room.public_url : "" }, 8080);
  await app.register(websocket);
  app.get("/api/songs", async () => ({ songs: [] }));
  app.post("/api/control/skip", async () => ({ ok: true }));
  app.get("/api/control/display-mode", async () => ({ mode: "fullscreen" }));
  app.post("/api/control/display-mode", async () => ({ mode: "window" }));
  app.post("/api/control/fullscreen", async () => ({ ok: true }));
  app.get("/api/admin/openlist-status", async () => ({ initial_password: "never-share" }));
  app.post("/api/admin/import-local", async () => ({ ok: true }));
  app.get("/ws", { websocket: true }, (socket) => { socket.send("connected"); });
  await app.ready();
  return app;
}
async function login(app: FastifyInstance, code = room.guest_code) {
  const res = await app.inject({ method: "POST", url: "/api/session/join", payload: { code }, headers: { origin: room.public_url } });
  expect(res.statusCode).toBe(200);
  expect(res.headers["set-cookie"]).toContain("HttpOnly");
  expect(res.headers["set-cookie"]).toContain("Secure");
  return String(res.headers["set-cookie"]).split(";")[0];
}

describe("public room access", () => {
  it("does not disclose signed media URLs to guests", async () => {
    const app = Fastify(); apps.push(app);
    registerRoomAccess(app, room, 8080);
    await registerControlRoutes(app,
      { getCurrentSong: () => null } as unknown as Orchestrator,
      { getState: async () => ({ current_file: "https://nas.example/song?sign=private", position: 3 }) } as unknown as MpvController,
    );
    const cookie = await login(app);
    const state = (await app.inject({ url: "/api/player", headers: { cookie } })).json();
    expect(state.position).toBe(3);
    expect(state.current_file).toBeUndefined();
  });
  it("requires a session even for requests arriving from the local tunnel", async () => {
    const app = await setup();
    expect((await app.inject("/api/songs")).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/control/skip" })).statusCode).toBe(401);
    expect((await app.inject("/api/session")).json()).toEqual({ enabled: true, role: null });
  });
  it("lets a guest select songs and control, but blocks administration", async () => {
    const app = await setup();
    const cookie = await login(app);
    expect((await app.inject({ url: "/api/songs", headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/control/skip", headers: { cookie, origin: room.public_url } })).statusCode).toBe(200);
    for (const url of ["/api/admin/openlist-status", "/api/admin/openlist-status?x=1"]) {
      const res = await app.inject({ url, headers: { cookie } });
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain("never-share");
    }
    expect((await app.inject({ method: "POST", url: "/api/admin/import-local", headers: { cookie } })).statusCode).toBe(403);
    expect((await app.inject({ url: "/api/control/display-mode", headers: { cookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/control/display-mode", payload: { mode: "window" }, headers: { cookie, origin: room.public_url } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/control/fullscreen", headers: { cookie, origin: room.public_url } })).statusCode).toBe(403);
  });
  it("allows the host, rejects forged cookies and rejects cross-site commands", async () => {
    const app = await setup();
    const cookie = await login(app, room.admin_code);
    expect((await app.inject({ url: "/api/admin/openlist-status", headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/control/display-mode", headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/songs", headers: { cookie: cookie + "bad" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/control/skip", headers: { cookie, origin: "https://evil.example" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/session/join", payload: { code: room.guest_code }, headers: { origin: "https://evil.example" } })).statusCode).toBe(403);
  });
  it("requires authentication and validates origin for WebSocket upgrades", async () => {
    const app = await setup();
    await expect(app.injectWS("/ws")).rejects.toThrow();
    const cookie = await login(app);
    await expect(app.injectWS("/ws", { headers: { cookie, origin: "https://evil.example" } })).rejects.toThrow();
    const ws = await app.injectWS("/ws", { headers: { cookie, origin: room.public_url } });
    ws.close();
  });
  it("rate limits repeated incorrect codes", async () => {
    const app = await setup();
    for (let i = 0; i < 20; i++) {
      expect((await app.inject({ method: "POST", url: "/api/session/join", payload: { code: "bad" } })).statusCode).toBe(401);
    }
    expect((await app.inject({ method: "POST", url: "/api/session/join", payload: { code: "bad" } })).statusCode).toBe(429);
  });
  it("preserves legacy LAN mode when internet access is disabled", async () => {
    const app = await setup(false);
    expect((await app.inject("/api/songs")).statusCode).toBe(200);
    expect((await app.inject("/api/session")).json()).toEqual({ enabled: false, role: "admin" });
  });
});
