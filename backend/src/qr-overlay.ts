import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PNG } from "pngjs";

export type BgraOverlay = {
  /** Path to the raw BGRA byte file (mpv reads from disk for overlay-add) */
  path: string;
  width: number;
  height: number;
  stride: number;
};

/**
 * Decode a PNG into raw BGRA bytes for mpv's `overlay-add` command.
 * mpv expects bgra (B, G, R, A) byte order — pngjs gives us RGBA, so we swap
 * the R and B channels in place.
 *
 * The output file is written to a fixed path inside the OS temp dir; we
 * overwrite on every call so the bytes track the current QR.
 */
export function prepareQrBgra(pngPath: string): BgraOverlay {
  const buf = readFileSync(pngPath);
  const png = PNG.sync.read(buf);
  const data = Buffer.from(png.data); // copy out of pngjs's internal buffer
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    data[i] = data[i + 2]; // B
    data[i + 2] = r; // R
    // G (i+1) and A (i+3) unchanged
  }
  const stageDir = join(tmpdir(), "ktv-mpv");
  mkdirSync(stageDir, { recursive: true });
  const outPath = join(stageDir, "qr.bgra");
  writeFileSync(outPath, data);
  return {
    path: outPath,
    width: png.width,
    height: png.height,
    stride: png.width * 4,
  };
}
