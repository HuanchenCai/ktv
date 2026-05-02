import type { FastifyInstance } from "fastify";
import type { EventEmitter } from "node:events";
import type { Orchestrator } from "./queue-orchestrator.ts";

type WsMessage =
  | { type: "queue.updated" }
  | { type: "download.progress"; payload: unknown }
  | { type: "player.state"; payload: unknown }
  | { type: "portrait.progress"; payload: unknown }
  | { type: "scan.progress"; payload: unknown }
  | { type: "import.progress"; payload: unknown };

// @fastify/websocket v10+ passes the WebSocket itself as the first argument
// (older versions wrapped it in `{ socket }`). The minimal shape we need:
type WsLike = {
  readyState: number;
  send: (data: string) => void;
  on: (event: string, cb: (...a: unknown[]) => void) => void;
};

export async function registerWs(
  fastify: FastifyInstance,
  orchestrator: Orchestrator,
  adminEvents?: EventEmitter,
): Promise<void> {
  const clients = new Set<WsLike>();

  const broadcast = (msg: WsMessage) => {
    const payload = JSON.stringify(msg);
    for (const sock of clients) {
      try {
        if (sock.readyState === 1) sock.send(payload);
      } catch {
        /* ignore broken sockets */
      }
    }
  };

  orchestrator.on("queue.updated", () => broadcast({ type: "queue.updated" }));
  orchestrator.on("download.progress", (task) =>
    broadcast({ type: "download.progress", payload: task }),
  );
  orchestrator.on("player.state", (state) =>
    broadcast({ type: "player.state", payload: state }),
  );
  adminEvents?.on("portrait.progress", (p) =>
    broadcast({ type: "portrait.progress", payload: p }),
  );
  adminEvents?.on("scan.progress", (p) =>
    broadcast({ type: "scan.progress", payload: p }),
  );
  adminEvents?.on("import.progress", (p) =>
    broadcast({ type: "import.progress", payload: p }),
  );

  const wsHandler = (sock: WsLike) => {
    clients.add(sock);
    sock.on("close", () => clients.delete(sock));
    sock.on("error", () => clients.delete(sock));
    // Initial sync nudge: tell the client to refresh queue.
    try {
      sock.send(JSON.stringify({ type: "queue.updated" }));
    } catch {
      /* ignore */
    }
  };

  // @fastify/websocket options aren't part of the base Fastify route types.
  (fastify.get as unknown as (
    path: string,
    opts: { websocket: boolean },
    handler: typeof wsHandler,
  ) => void)("/ws", { websocket: true }, wsHandler);
}
