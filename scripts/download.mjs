// CLI: search the songs table, optionally filter, then batch-download from
// Baidu Netdisk to library_path on NAS. Mirrors the cloud directory tree
// (cloud_path /KTV/X/Y/foo.mkv -> <library_path>/X/Y/foo.mkv).
//
//   npm run download -- "周杰伦"             # search and confirm
//   npm run download -- "zjl"                # pinyin works (matches via LIKE)
//   npm run download -- "周杰伦" --filter MTV
//   npm run download -- "周杰伦" -y          # skip confirmation
//   npm run download -- --cloud-path "/KTV/foo.mkv"
//   npm run download -- --retry-failed
//   npm run download -- "周杰伦" --limit 5
//
// BDUSS / STOKEN are read from config.json baidu block, but env vars
// (BDUSS, STOKEN) override if set.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

import { loadConfig, projectRoot } from "../backend/src/config.ts";
import { openDb } from "../backend/src/db.ts";
import {
  downloadOne,
  mirrorDestPath,
  probeAuth,
} from "../backend/src/baidu-downloader.ts";

// --- args ------------------------------------------------------------------

function parseArgs(argv) {
  const out = {
    query: null,
    cloudPath: null,
    filter: null,
    yes: false,
    retryFailed: false,
    limit: null,
    edit: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cloud-path") out.cloudPath = argv[++i];
    else if (a === "--filter") out.filter = argv[++i];
    else if (a === "-y" || a === "--yes") out.yes = true;
    else if (a === "--retry-failed") out.retryFailed = true;
    else if (a === "--limit") out.limit = Number(argv[++i]);
    else if (a === "--edit" || a === "--pick") out.edit = true;
    else if (a === "-h" || a === "--help") {
      console.log(
        "usage: npm run download -- <query> [--filter TEXT] [-y] [--limit N] [--edit]\n" +
          "       npm run download -- --cloud-path /KTV/foo.mkv\n" +
          "       npm run download -- --retry-failed",
      );
      process.exit(0);
    } else if (a.startsWith("--")) {
      throw new Error(`unknown flag: ${a}`);
    } else if (out.query === null) {
      out.query = a;
    } else {
      throw new Error(`unexpected positional arg: ${a}`);
    }
  }
  return out;
}

// --- helpers ---------------------------------------------------------------

function fmtBytes(b) {
  if (!b || b <= 0) return "0 B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
  if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + " MB";
  return (b / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

function fmtDuration(seconds) {
  if (!isFinite(seconds) || seconds < 0) return "?";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h) return `${h}h${m}m`;
  if (m) return `${m}m`;
  return `${Math.round(seconds)}s`;
}

async function ask(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(prompt);
  rl.close();
  return answer.trim().toLowerCase();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- main ------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = projectRoot();
  const config = loadConfig(root);

  const bduss = process.env.BDUSS || config.baidu.bduss;
  const stoken = process.env.STOKEN || config.baidu.stoken;
  if (!bduss) {
    console.error(
      "[download] BDUSS not set. Either put it in config.json baidu.bduss or set the BDUSS env var.",
    );
    process.exit(1);
  }

  const dbPath = resolve(root, "data", "ktv.db");
  const db = openDb(dbPath);

  // --- pick the song list to download ---
  let candidates;
  if (args.cloudPath) {
    const row = db
      .prepare(
        "SELECT id, title, artist, cloud_path, size_bytes FROM songs WHERE cloud_path = ?",
      )
      .get(args.cloudPath);
    if (!row) {
      console.error(`[download] cloud_path not in database: ${args.cloudPath}`);
      process.exit(1);
    }
    candidates = [row];
  } else if (args.retryFailed) {
    const failedFile = resolve(root, "data", "exports", "failed.txt");
    if (!existsSync(failedFile)) {
      console.error(`[download] no ${failedFile} to retry`);
      process.exit(1);
    }
    const paths = readFileSync(failedFile, "utf8")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("#"));
    candidates = db
      .prepare(
        `SELECT id, title, artist, cloud_path, size_bytes
         FROM songs WHERE cloud_path IN (${paths.map(() => "?").join(",")})`,
      )
      .all(...paths);
  } else if (args.query) {
    const q = `%${args.query}%`;
    candidates = db
      .prepare(
        `SELECT id, title, artist, cloud_path, size_bytes
         FROM songs
         WHERE (pinyin LIKE ? OR title LIKE ? OR artist LIKE ?)
           AND cloud_path LIKE '/KTV/%'
         ORDER BY artist COLLATE NOCASE, title COLLATE NOCASE`,
      )
      .all(q, q, q);
  } else {
    console.error("[download] need a query, --cloud-path, or --retry-failed");
    process.exit(1);
  }

  if (args.filter) {
    const f = args.filter.toLowerCase();
    candidates = candidates.filter(
      (r) =>
        (r.title ?? "").toLowerCase().includes(f) ||
        (r.cloud_path ?? "").toLowerCase().includes(f),
    );
  }
  if (args.limit && args.limit > 0) {
    candidates = candidates.slice(0, args.limit);
  }

  if (candidates.length === 0) {
    console.log("[download] no matches");
    db.close();
    return;
  }

  // --- separate already-on-NAS from todo ---
  const destBase = config.library_path;
  let alreadyHave = 0;
  let alreadyBytes = 0;
  const todo = [];
  for (const row of candidates) {
    const dest = mirrorDestPath(row.cloud_path, destBase);
    let onDisk = null;
    try {
      onDisk = await stat(dest);
    } catch {
      /* not present */
    }
    if (
      onDisk &&
      row.size_bytes &&
      Math.abs(onDisk.size - row.size_bytes) <= 1024
    ) {
      alreadyHave++;
      alreadyBytes += onDisk.size;
      continue;
    }
    todo.push({ ...row, dest });
  }

  const todoBytes = todo.reduce((s, r) => s + (r.size_bytes ?? 0), 0);
  const totalBytes = candidates.reduce((s, r) => s + (r.size_bytes ?? 0), 0);

  console.log(`匹配 ${candidates.length} 首,共 ${fmtBytes(totalBytes)}`);
  console.log(`已在 NAS:${alreadyHave} 首 (${fmtBytes(alreadyBytes)})`);
  console.log(`待下载:${todo.length} 首 (${fmtBytes(todoBytes)})`);
  if (todoBytes > 0) {
    console.log(
      `预估时间(SVIP 5 MB/s):约 ${fmtDuration(
        todoBytes / (5 * 1024 * 1024),
      )}`,
    );
  }
  console.log(`目标目录:${destBase}\n`);

  if (todo.length === 0) {
    console.log("[download] nothing to do (all present on NAS).");
    db.close();
    return;
  }

  // --- queue.txt edit mode ---
  if (args.edit) {
    const queueFile = resolve(root, "data", "exports", "queue.txt");
    mkdirSync(dirname(queueFile), { recursive: true });
    const lines = [
      "# Edit this file: delete lines for songs you DON'T want to download.",
      "# Save and press Enter at the prompt to continue.",
      "",
      ...todo.map(
        (r) =>
          `${r.cloud_path}    # ${r.artist} - ${r.title} [${fmtBytes(r.size_bytes)}]`,
      ),
    ];
    writeFileSync(queueFile, lines.join("\n"), "utf8");
    console.log(`已写入 ${queueFile}`);
    console.log("用编辑器打开,删掉不想下载的行,保存后回到这里按回车继续。");
    await ask("准备好了? 回车继续,Ctrl+C 取消:");
    const kept = new Set(
      readFileSync(queueFile, "utf8")
        .split(/\r?\n/)
        .map((s) => s.split("#")[0].trim())
        .filter((s) => s && s.startsWith("/KTV/")),
    );
    const before = todo.length;
    const filtered = todo.filter((r) => kept.has(r.cloud_path));
    console.log(`你保留 ${filtered.length}/${before} 首,继续...\n`);
    todo.length = 0;
    todo.push(...filtered);
    if (todo.length === 0) {
      console.log("[download] queue empty after edit");
      db.close();
      return;
    }
  } else if (!args.yes) {
    const ans = await ask("继续? (y/n) ");
    if (ans !== "y" && ans !== "yes") {
      console.log("取消。");
      db.close();
      return;
    }
  }

  // --- auth probe (catches bad BDUSS before doing real work) ---
  console.log("[download] checking BDUSS auth...");
  const authErr = await probeAuth({ bduss, stoken });
  if (authErr) {
    console.error(
      `[download] auth probe failed: ${authErr}\n` +
        "       BDUSS may be expired/wrong. Re-login at pan.baidu.com and refresh.",
    );
    db.close();
    process.exit(1);
  }
  console.log("[download] auth OK\n");

  // --- run downloads with bounded concurrency ---
  const concurrency = config.baidu.concurrency;
  const delayMs = config.baidu.request_delay_ms;
  const ac = new AbortController();
  const onSigint = () => {
    console.log("\n[download] caught Ctrl+C, aborting in-flight downloads...");
    ac.abort();
  };
  process.once("SIGINT", onSigint);

  const updateCached = db.prepare(
    "UPDATE songs SET cached = 1, local_path = ? WHERE id = ?",
  );

  const failedPaths = [];
  let done = 0;
  let bytesDone = 0;
  const startedAt = Date.now();

  const indexedTodo = todo.map((row, i) => ({ row, idx: i + 1 }));
  let cursor = 0;

  async function worker(workerId) {
    while (cursor < indexedTodo.length && !ac.signal.aborted) {
      const my = indexedTodo[cursor++];
      if (!my) break;
      const { row, idx } = my;
      const sizeStr = fmtBytes(row.size_bytes);
      const label = `[${idx}/${indexedTodo.length}] ${row.artist} - ${row.title} (${sizeStr})`;
      const prefix = `\n${label}`;
      console.log(prefix);

      // Stagger requests to dampen 风控
      if (delayMs > 0) await sleep(delayMs);

      const result = await downloadOne(row.cloud_path, row.dest, {
        bduss,
        stoken,
        signal: ac.signal,
        expectedSize: row.size_bytes,
        retries: 3,
        onProgress: (written, total) => {
          if (total) {
            const pct = ((written / total) * 100).toFixed(0);
            process.stdout.write(
              `\r  [w${workerId}] ${fmtBytes(written)} / ${fmtBytes(total)}  ${pct}%   `,
            );
          }
        },
      });
      process.stdout.write("\r" + " ".repeat(70) + "\r"); // clear progress line

      if (result.ok) {
        updateCached.run(result.localPath, row.id);
        done++;
        bytesDone += result.bytes;
        const elapsed = (Date.now() - startedAt) / 1000;
        const rate = bytesDone / elapsed;
        console.log(
          `  ✓ ${result.skipped ? "skipped (already on NAS)" : "done"} — overall ${done}/${indexedTodo.length}, ${fmtBytes(rate)}/s`,
        );
      } else {
        failedPaths.push(row.cloud_path);
        console.log(`  ✗ FAILED: ${result.error}`);
      }
    }
  }

  const workers = Array.from({ length: concurrency }, (_, i) =>
    worker(i + 1),
  );
  await Promise.all(workers);

  process.removeListener("SIGINT", onSigint);

  // --- write failed list for retry ---
  if (failedPaths.length) {
    const failedFile = resolve(root, "data", "exports", "failed.txt");
    mkdirSync(dirname(failedFile), { recursive: true });
    writeFileSync(failedFile, failedPaths.join("\n") + "\n", "utf8");
    console.log(
      `\n失败 ${failedPaths.length} 首,已写入 ${failedFile}\n二次跑:npm run download -- --retry-failed`,
    );
  }

  const elapsed = (Date.now() - startedAt) / 1000;
  console.log(
    `\n完成 ${done} / ${indexedTodo.length} 首,${fmtBytes(bytesDone)},耗时 ${fmtDuration(
      elapsed,
    )},均速 ${fmtBytes(bytesDone / Math.max(1, elapsed))}/s`,
  );

  db.close();
  if (ac.signal.aborted) process.exit(130);
}

main().catch((err) => {
  console.error("[download] fatal:", err);
  process.exit(1);
});
