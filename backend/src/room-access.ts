import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";

export type RoomAccess = {
  public_url: string;
  guest_code: string;
  admin_code: string;
};

declare module "fastify" {
  interface FastifyRequest { roomRole: "admin" | "guest" | null; roomExpiresAt: number | null }
}

const equal = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** No loopback bypass: an internet tunnel also connects from loopback. */
export function registerRoomAccess(app: FastifyInstance, room: RoomAccess, port: number) {
  const enabled = !!room.public_url;
  const key = randomBytes(32);
  const sign = (value: string) => createHmac("sha256", key).update(value).digest("hex");
  const publicOrigin = enabled ? new URL(room.public_url).origin : "";
  const allowedOrigins = new Set([publicOrigin, `http://localhost:${port}`, `http://127.0.0.1:${port}`]);
  const attempts = new Map<string, { count: number; expires: number }>();
  let globalAttempts = { count: 0, expires: 0 };
  app.decorateRequest("roomRole", null);
  app.decorateRequest("roomExpiresAt", null);

  function role(req: FastifyRequest): "admin" | "guest" | null {
    if (!enabled) return "admin";
    const cookie = req.headers.cookie?.split(";").map((v) => v.trim()).find((v) => v.startsWith("ktv_session="))?.slice(12);
    if (!cookie || cookie.length > 256) return null;
    const [r, expiry, nonce, signature] = cookie.split(".");
    if ((r !== "admin" && r !== "guest") || !expiry || !nonce || !signature || Number(expiry) < Date.now()) return null;
    if (!equal(signature, sign(`${r}.${expiry}.${nonce}`))) return null;
    req.roomExpiresAt = Number(expiry);
    return r;
  }

  app.addHook("onRequest", async (req, rep) => {
    req.roomRole = role(req);
    if (!enabled) return;
    rep.header("Referrer-Policy", "no-referrer");
    const path = req.routeOptions.url ?? req.url.split("?")[0];
    if (path.startsWith("/api/") || path === "/ws") {
      rep.header("Cache-Control", "no-store");
      if ((req.method !== "GET" && req.method !== "HEAD") || path === "/ws") {
        if (req.headers.origin && !allowedOrigins.has(req.headers.origin)) {
          return rep.code(403).send({ error: "不允许跨站操作" });
        }
      }
      if (path === "/api/session" || path === "/api/session/join") return;
      if (!req.roomRole) return rep.code(401).send({ error: "请先输入房间口令" });
      if (req.roomRole === "guest" && (
        (path.startsWith("/api/admin/") && path !== "/api/admin/qrcode" && path !== "/api/admin/qrcode/wifi") ||
        path === "/api/health" || path.startsWith("/api/library") || path === "/api/control/display-mode"
      )) return rep.code(403).send({ error: "此操作需要主持人口令" });
    }
  });

  app.get("/api/session", async (req) => ({ enabled, role: req.roomRole }));
  app.post<{ Body: { code?: string } }>("/api/session/join", { bodyLimit: 2048 }, async (req, rep) => {
    if (!enabled) return { role: "admin" };
    const now = Date.now();
    for (const [ip, value] of attempts) if (value.expires <= now) attempts.delete(ip);
    if (globalAttempts.expires <= now) globalAttempts = { count: 0, expires: now + 60_000 };
    if (++globalAttempts.count > 120) return rep.header("Retry-After", "60").code(429).send({ error: "尝试次数过多，请一分钟后再试" });
    const attempt = attempts.get(req.ip) ?? { count: 0, expires: now + 60_000 };
    attempts.set(req.ip, attempt);
    if (++attempt.count > 20) {
      return rep.header("Retry-After", "60").code(429).send({ error: "尝试次数过多，请一分钟后再试" });
    }
    const code = typeof req.body?.code === "string" ? req.body.code : "";
    const r = equal(code, room.admin_code) ? "admin" : equal(code, room.guest_code) ? "guest" : null;
    if (!r) return rep.code(401).send({ error: "口令不正确" });
    const payload = `${r}.${now + 12 * 60 * 60 * 1000}.${randomBytes(16).toString("hex")}`;
    const local = req.headers.host === `localhost:${port}` || req.headers.host === `127.0.0.1:${port}`;
    rep.header("Set-Cookie", `ktv_session=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${local ? "" : "; Secure"}`);
    return { role: r };
  });
  app.post("/api/session/leave", async (_req, rep) => {
    rep.header("Set-Cookie", "ktv_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");
    return { ok: true };
  });
}
