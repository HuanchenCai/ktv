import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { DownloadOpts, DownloadResult } from "./baidu-downloader.ts";

/** Explicit offline download only; normal remote playback never calls this. */
export async function downloadRemote(
  url: string, dest: string, opts: Pick<DownloadOpts, "signal" | "expectedSize" | "onProgress">,
): Promise<DownloadResult> {
  const partial = `${dest}.part`;
  try {
    const signal = AbortSignal.any([AbortSignal.timeout(30 * 60 * 1000), ...(opts.signal ? [opts.signal] : [])]);
    const res = await fetch(url, { signal });
    if (!res.ok || !res.body) throw new Error(`Remote download failed (${res.status})`);
    if (/text\/html|application\/json/i.test(res.headers.get("content-type") ?? "")) {
      await res.body.cancel();
      throw new Error("Remote source returned a login page or error instead of a video");
    }
    const length = Number(res.headers.get("content-length")) || null;
    let bytes = 0;
    let lastReport = 0;
    const meter = new Transform({ transform(chunk, _encoding, done) {
      bytes += chunk.length;
      if (Date.now() - lastReport > 250) {
        opts.onProgress?.(bytes, opts.expectedSize ?? length);
        lastReport = Date.now();
      }
      done(null, chunk);
    } });
    await mkdir(dirname(dest), { recursive: true });
    await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), meter, createWriteStream(partial), { signal });
    const expected = opts.expectedSize ?? length;
    if (expected !== null && expected !== undefined && bytes !== expected) throw new Error("Remote file size changed or download is incomplete; rescan the library and retry");
    await rename(partial, dest);
    opts.onProgress?.(bytes, bytes);
    return { ok: true, bytes, localPath: dest };
  } catch (err) {
    await rm(partial, { force: true }).catch(() => {});
    return { ok: false, error: err instanceof Error ? err.message : String(err), retryable: true };
  }
}
