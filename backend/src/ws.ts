import type { FastifyInstance } from "fastify";
import type { Orchestrator } from "./queue-orchestrator.ts";
import type { DownloadManager, DownloadTask as MgrTask } from "./download-manager.ts";

type WsMessage =
  | { type: "queue.updated" }
  | { type: "download.progress"; payload: unknown }
  | { type: "player.state"; payload: unknown }
  | { type: "downloads.task"; payload: MgrTask }
  | { type: "downloads.snapshot"; payload: { tasks: MgrTask[]; counts: Record<string, number> } };

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
  downloads?: DownloadManager,
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

  if (downloads) {
    const relayTask = (t: MgrTask) =>
      broadcast({ type: "downloads.task", payload: t });
    for (const ev of [
      "task_added",
      "task_started",
      "task_progress",
      "task_done",
      "task_failed",
      "task_skipped",
    ]) {
      downloads.on(ev, relayTask);
    }
  }

  const wsHandler = (sock: WsLike) => {
    clients.add(sock);
    sock.on("close", () => clients.delete(sock));
    sock.on("error", () => clients.delete(sock));
    // Initial sync: tell the client to refresh queue + ship the current
    // download manager snapshot so the UI doesn't have to round-trip.
    try {
      sock.send(JSON.stringify({ type: "queue.updated" }));
      if (downloads) {
        sock.send(
          JSON.stringify({
            type: "downloads.snapshot",
            payload: {
              tasks: downloads.getTasks(),
              counts: downloads.getCounts(),
            },
          } satisfies WsMessage),
        );
      }
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
