import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";
import { z } from "zod";

const ConfigSchema = z.object({
  http_port: z.number().int().positive().default(8080),
  openlist: z.object({
    port: z.number().int().positive().default(5244),
    data_dir: z.string().default("./openlist-data"),
    binary_path: z.string().default("./bin/openlist"),
    auto_spawn: z.boolean().default(true),
    api_token: z.string().default(""),
  }),
  library_path: z.string().min(1),
  baidu_root: z.string().default("/baidu"),
  mpv: z.object({
    binary_path: z.string().default(""),
    start_paused: z.boolean().default(false),
    fullscreen: z.boolean().default(true),
    // Now safe to default on: overlay is drawn via the OSD layer
    // (overlay-add IPC), independent of the filter chain — audio routing
    // and aid switching are unaffected.
    qr_overlay: z.boolean().default(true),
  }),
  scheduler: z.object({
    prefetch_ahead: z.number().int().min(0).max(10).default(2),
    poll_interval_ms: z.number().int().min(100).max(10000).default(500),
  }),
  // Whether to walk library_path on every boot. Off by default — for big
  // NAS-mounted libraries, stat'ing 25k+ files over SMB on each restart is
  // measurable. Manual scan (the "扫本地目录" button) still works.
  auto_scan_on_startup: z.boolean().default(false),
  vocal_channel_default: z.enum(["L", "R"]).default("L"),
  baidu: z
    .object({
      bduss: z.string().default(""),
      stoken: z.string().default(""),
      concurrency: z.number().int().min(1).max(8).default(4),
      request_delay_ms: z.number().int().min(0).max(5000).default(300),
    })
    .default({}),
  /**
   * Optional WiFi info baked into a second QR code on /tv (and on the
   * always-on-top floater if enabled). Scanning it joins the network;
   * the guest then scans the URL QR to point a song.
   * Leave ssid empty to skip the WiFi QR entirely.
   */
  wifi: z
    .object({
      ssid: z.string().default(""),
      password: z.string().default(""),
      security: z.enum(["WPA", "WEP", "nopass"]).default("WPA"),
      hidden: z.boolean().default(false),
    })
    .default({}),
  /**
   * "Sticker" QR: a borderless, always-on-top, click-through window
   * pinned to a screen corner so the QR is visible even when mpv
   * isn't fullscreen, isn't running, or the user switched apps.
   * Windows only for now (PowerShell + WinForms subprocess).
   */
  qr_floater: z
    .object({
      enabled: z.boolean().default(false),
      // top-right | top-left | bottom-right | bottom-left
      corner: z
        .enum(["top-right", "top-left", "bottom-right", "bottom-left"])
        .default("top-right"),
      size: z.number().int().min(80).max(600).default(220),
      margin: z.number().int().min(0).max(200).default(24),
    })
    .default({}),
  /**
   * Online video sources (YouTube / Douyin via yt-dlp). When enabled,
   * `🌐 线上` mode shows up in the phone search UI: type a query,
   * tap a result, and the video streams from the original CDN
   * straight into mpv — nothing is downloaded.
   *
   * proxy: HTTP proxy URL for yt-dlp + mpv (empty = direct connection).
   *        Mostly relevant for users behind GFW who need YouTube.
   * yt_dlp_path: explicit path to the yt-dlp binary. Empty = auto-detect
   *              on PATH. Install via `winget install yt-dlp.yt-dlp` /
   *              `brew install yt-dlp` / `pip install yt-dlp`.
   */
  online: z
    .object({
      enabled: z.boolean().default(true),
      youtube_enabled: z.boolean().default(true),
      douyin_enabled: z.boolean().default(true),
      proxy: z.string().default(""),
      yt_dlp_path: z.string().default(""),
      search_timeout_ms: z.number().int().min(2000).max(60000).default(15000),
      resolve_timeout_ms: z
        .number()
        .int()
        .min(2000)
        .max(60000)
        .default(10000),
    })
    .default({}),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(projectRoot?: string): Config {
  const root =
    projectRoot ??
    resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const configPath = resolve(root, "config.json");
  const examplePath = resolve(root, "config.example.json");

  if (!existsSync(configPath)) {
    if (existsSync(examplePath)) {
      copyFileSync(examplePath, configPath);
      console.log(
        `[config] created config.json from config.example.json — edit it before running`,
      );
    } else {
      throw new Error(
        `config.json not found at ${configPath} and no config.example.json to seed from`,
      );
    }
  }

  const raw = JSON.parse(readFileSync(configPath, "utf8"));
  const parsed = ConfigSchema.parse(raw);

  // Auto-append .exe on Windows if the resolved path doesn't exist but .exe does.
  let binaryPath = resolve(root, parsed.openlist.binary_path);
  if (platform() === "win32" && !existsSync(binaryPath)) {
    const withExe = binaryPath + ".exe";
    if (existsSync(withExe)) binaryPath = withExe;
  }

  return {
    ...parsed,
    openlist: {
      ...parsed.openlist,
      data_dir: resolve(root, parsed.openlist.data_dir),
      binary_path: binaryPath,
    },
    library_path: resolve(parsed.library_path),
  };
}

export function projectRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}
