import type { FastifyInstance } from "fastify";
import type { Orchestrator } from "./queue-orchestrator.ts";

type WsMessage =
  | { type: "queue.updated" }
  | { type: "download.progress"; payload: unknown }
  | { type: "player.state"; payload: unknown };

// Fastify WebSocket route accepts a handler where `connection` has `.socket` (ws)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WsConnection = { socket: any };

export async function registerWs(
  fastify: FastifyInstance,
  orchestrator: Orchestrator,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clients = new Set<any>();

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

  const wsHandler = (connection: WsConnection) => {
    const sock = connection.socket;
    clients.add(sock);
    sock.on("close", () => clients.delete(sock));
    sock.on("error", () => clients.delete(sock));
    // Initial sync: send current queue snapshot
    sock.send(JSON.stringify({ type: "queue.updated" }));
  };

  // @fastify/websocket options aren't part of the base Fastify route types;
  // cast to unblock typecheck without giving up handler typing.
  (fastify.get as unknown as (
    path: string,
    opts: { websocket: boolean },
    handler: typeof wsHandler,
  ) => void)("/ws", { websocket: true }, wsHandler);
}
