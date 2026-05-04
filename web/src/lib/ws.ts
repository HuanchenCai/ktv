import { ref } from "vue";

export type ManagerTask = {
  id: number;
  cloud_path: string;
  artist: string;
  title: string;
  size_bytes: number | null;
  state: "queued" | "downloading" | "done" | "failed" | "skipped";
  bytesWritten: number;
  bytesTotal: number | null;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
};

export type WsMessage =
  | { type: "queue.updated" }
  | { type: "download.progress"; payload: unknown }
  | { type: "player.state"; payload: unknown }
  | { type: "portrait.progress"; payload: unknown }
  | { type: "scan.progress"; payload: unknown }
  | { type: "import.progress"; payload: unknown }
  | { type: "downloads.task"; payload: ManagerTask }
  | {
      type: "downloads.snapshot";
      payload: { tasks: ManagerTask[]; counts: Record<string, number> };
    };

export const wsStatus = ref<"connecting" | "open" | "closed">("connecting");

type Listener = (msg: WsMessage) => void;
const listeners = new Set<Listener>();

export function onWs(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let sock: WebSocket | null = null;
let retry = 0;

function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${proto}//${location.host}/ws`;
  sock = new WebSocket(url);
  wsStatus.value = "connecting";
  sock.onopen = () => {
    wsStatus.value = "open";
    retry = 0;
  };
  sock.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data) as WsMessage;
      for (const fn of listeners) fn(msg);
    } catch (e) {
      console.error("[ws] parse failed", e);
    }
  };
  sock.onclose = () => {
    wsStatus.value = "closed";
    const delay = Math.min(10_000, 500 * 2 ** retry);
    retry++;
    setTimeout(connect, delay);
  };
  sock.onerror = () => {
    sock?.close();
  };
}

export function startWs() {
  if (!sock) connect();
}
