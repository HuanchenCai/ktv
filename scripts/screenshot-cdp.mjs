#!/usr/bin/env node
/**
 * Headless-Chrome via CDP: navigate, wait for network-idle, capture PNG.
 * Skips Chrome's --screenshot virtual-time quirks that break SPA mounts.
 *
 * Usage:
 *   node scripts/screenshot-cdp.mjs <url> <outFile> [width] [height]
 */
import { spawn } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const [, , url, out, w = "414", h = "896"] = process.argv;
if (!url || !out) {
  console.error("usage: screenshot-cdp.mjs <url> <out.png> [w] [h]");
  process.exit(2);
}
const width = Number(w);
const height = Number(h);

function findChrome() {
  const candidates = [
    "C:\\Users\\huanc\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error("chrome.exe not found");
}

const chrome = findChrome();
const port = 9223 + Math.floor(Math.random() * 100);
const userDataDir = `${process.env.TEMP}\\chrome-cdp-${Date.now()}`;
mkdirSync(userDataDir, { recursive: true });

const args = [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDir}`,
  `--window-size=${width},${height}`,
  "about:blank",
];
const proc = spawn(chrome, args, { stdio: ["ignore", "pipe", "pipe"] });

let nextId = 1;
const pending = new Map();
let ws;

async function cdp(method, params = {}) {
  const id = nextId++;
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function getPageWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* keep polling */
    }
    await sleep(150);
  }
  throw new Error("chrome devtools never came up");
}

try {
  const wsUrl = await getPageWsUrl();
  ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) rej(new Error(m.error.message));
      else res(m.result);
    }
  });

  await cdp("Page.enable");
  await cdp("Network.enable");
  await cdp("Runtime.enable");
  await cdp("Log.enable");
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === "Runtime.exceptionThrown") {
      console.error("[js-exc]", JSON.stringify(m.params.exceptionDetails).slice(0, 500));
    } else if (m.method === "Runtime.consoleAPICalled") {
      const args = m.params.args.map((a) => a.value ?? a.description ?? JSON.stringify(a));
      console.error(`[console.${m.params.type}]`, ...args);
    } else if (m.method === "Log.entryAdded") {
      console.error(`[log.${m.params.entry.level}]`, m.params.entry.text);
    }
  });
  await cdp("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: true,
  });

  await cdp("Page.navigate", { url });
  // Poll until <div id="app"> has children (Vue mounted) or we time out.
  let mounted = 0;
  let lastUrl = "";
  for (let i = 0; i < 80; i++) {
    await sleep(150);
    const r = await cdp("Runtime.evaluate", {
      expression:
        "JSON.stringify({n: document.querySelector('#app')?.children.length ?? 0, u: location.href, ready: document.readyState, scripts: document.scripts.length})",
      returnByValue: true,
    });
    try {
      const obj = JSON.parse(r.result?.value ?? "{}");
      mounted = obj.n;
      lastUrl = obj.u;
      if (i % 10 === 0) console.error(`[${i}] app.children=${obj.n} ready=${obj.ready} scripts=${obj.scripts} url=${obj.u}`);
    } catch {}
    if (mounted > 0) break;
  }
  console.error(`mounted children=${mounted} final url=${lastUrl}`);
  await sleep(1500);

  const shot = await cdp("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log(`OK ${out}`);
} finally {
  try {
    ws?.close();
  } catch {}
  try {
    proc.kill("SIGKILL");
  } catch {}
}
