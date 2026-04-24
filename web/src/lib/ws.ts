import { ref } from "vue";

export type WsMessage =
  | { type: "queue.updated" }
  | { type: "download.progress"; payload: unknown }
  | { type: "player.state"; payload: unknown };

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
