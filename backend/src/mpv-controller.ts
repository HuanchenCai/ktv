import { EventEmitter } from "node:events";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { platform, tmpdir } from "node:os";
import { resolve, dirname, join, relative } from "node:path";

/**
 * node-mpv 1.x — constructor spawns mpv immediately (no .start() method).
 */
type MpvLike = {
  load: (path: string, mode?: string) => Promise<void> | void;
  command: (cmd: string, args: unknown[]) => Promise<void> | void;
  getProperty: (prop: string) => Promise<unknown>;
  setProperty: (prop: string, value: unknown) => Promise<void> | void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  quit: () => void;
  volume: (v: number) => void;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let MpvCtor: any;

function findMpvBinary(): string | null {
  try {
    const out = execSync(platform() === "win32" ? "where mpv" : "which mpv", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .split(/\r?\n/)[0]
      .trim();
    if (out && existsSync(out)) return out;
  } catch {
    /* not on PATH */
  }
  const candidates =
    platform() === "win32"
      ? [
          "C:/Program Files/MPV Player/mpv.exe",
          "C:/Program Files/mpv/mpv.exe",
          "C:/Program Files (x86)/mpv/mpv.exe",
          `${process.env.LOCALAPPDATA ?? ""}/Programs/mpv/mpv.exe`,
        ]
      : platform() === "darwin"
        ? [
            "/opt/homebrew/bin/mpv",
            "/usr/local/bin/mpv",
            "/Applications/mpv.app/Contents/MacOS/mpv",
          ]
        : ["/usr/bin/mpv", "/usr/local/bin/mpv"];
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return null;
}

/**
 * Render a path that's safe to drop into an FFmpeg filtergraph (`movie=...`).
 * Uses a relative path from `cwd` when possible to dodge the drive-colon
 * escaping problem on Windows entirely. Falls back to absolute + escape if
 * the file isn't reachable via a relative path.
 */
function ffmpegMoviePath(absPath: string, cwd: string): string {
  try {
    const rel = relative(cwd, absPath).replace(/\\/g, "/");
    if (rel && !rel.startsWith("..") && !rel.includes(":")) return rel;
  } catch {
    /* fall through */
  }
  // Absolute fallback: forward-slash path with drive colon escaped.
  return absPath.replace(/\\/g, "/").replace(/:/g, "\\:");
}

export type MpvState = {
  current_file: string | null;
  paused: boolean;
  position: number;
  duration: number;
  volume: number;
  vocal_channel: "L" | "R" | "both";
};

/**
 * Channel-switching strategy:
 *   - Single-stream stereo files (typical Chinese KTV: L=vocal, R=accompaniment
 *     or reversed): use a labelled `@karaoke` pan filter, swap params in place.
 *   - Multi-track files (separate aid=1 / aid=2 streams): switch via the
 *     `aid` property; pan filter is left out of the chain.
 * The mode is decided per-loadfile by inspecting `track-list` audio entries.
 */
export class MpvController extends EventEmitter {
  private mpv: MpvLike | null = null;
  private ready = false;
  private vocalChannelDefault: "L" | "R";
  private currentChannel: "L" | "R" | "both" = "both";
  private binaryPath: string;
  private fullscreen: boolean;
  private qrOverlayPath: string | null;
  private inputConfPath: string | null = null;

  /** "stereo" = single-stream pan mode; "tracks" = multi-track aid mode */
  private audioMode: "stereo" | "tracks" = "stereo";
  private audioTrackIds: number[] = [];

  constructor(opts: {
    vocalChannelDefault: "L" | "R";
    binaryPath?: string;
    fullscreen?: boolean;
    qrOverlayPath?: string | null;
  }) {
    super();
    this.vocalChannelDefault = opts.vocalChannelDefault;
    this.binaryPath = opts.binaryPath ?? "";
    this.fullscreen = opts.fullscreen ?? false;
    this.qrOverlayPath = opts.qrOverlayPath ?? null;
  }

  async start(): Promise<void> {
    if (this.ready) return;
    if (!MpvCtor) {
      const mod = await import("node-mpv");
      MpvCtor = (mod as { default?: unknown }).default ?? mod;
    }

    const resolvedBinary = this.binaryPath || findMpvBinary();
    if (!resolvedBinary) {
      throw new Error(
        "mpv binary not found. Install via `winget install shinchiro.mpv` or `brew install mpv`, or set config.mpv.binary_path.",
      );
    }
    console.log(`[mpv] using binary ${resolvedBinary}`);

    // Write a tiny input.conf overriding bindings we don't want active. mpv
    // appends user input.conf on top of default bindings, so we can disable
    // a single key without losing the rest.
    const confDir = join(tmpdir(), "ktv-mpv");
    mkdirSync(confDir, { recursive: true });
    this.inputConfPath = join(confDir, "input.conf");
    writeFileSync(
      this.inputConfPath,
      [
        "# ignore", // disable the default cycle-audio that lands on -/N (mute)
      ].join("\n"),
      "utf8",
    );

    const mpvOpts: Record<string, unknown> = {
      audio_only: false,
      auto_restart: true,
      verbose: false,
      debug: false,
      binary: resolvedBinary,
    };

    const mpvArgs: string[] = [
      "--keep-open=yes",
      "--idle=yes",
      `--input-conf=${this.inputConfPath}`,
    ];
    if (this.fullscreen) mpvArgs.push("--fullscreen");
    // QR overlay: --lavfi-complex routes both video (with overlay) and audio
    // (passthrough). Using a relative path for the QR PNG sidesteps Windows
    // drive-colon escaping in FFmpeg's filter parser.
    if (this.qrOverlayPath && existsSync(this.qrOverlayPath)) {
      const cwd = process.cwd();
      const moviePath = ffmpegMoviePath(resolve(this.qrOverlayPath), cwd);
      mpvArgs.push(
        `--lavfi-complex=[vid1]format=yuva420p[v];movie=${moviePath}:loop=0,scale=220:220,format=rgba[wm];[v][wm]overlay=W-w-40:40[vo];[aid1]anull[ao]`,
      );
      console.log(`[mpv] QR overlay enabled (movie=${moviePath})`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.mpv = new (MpvCtor as any)(mpvOpts, mpvArgs) as MpvLike;

    // node-mpv 1.x attaches the IPC socket asynchronously inside the ctor;
    // give it a moment to wire up before we try to send commands.
    await new Promise<void>((r) => setTimeout(r, 500));

    this.mpv.on("stopped", () => this.emit("track-ended"));
    this.mpv.on("started", () => {
      void this.detectAudioMode().catch(() => {});
      this.emit("track-started", { channel: this.currentChannel });
    });
    this.mpv.on("resumed", () => this.emit("resumed"));
    this.mpv.on("paused", () => this.emit("paused"));
    this.ready = true;
    console.log("[mpv] ready");
  }

  /**
   * Inspect the freshly loaded file's audio streams and pick the right
   * channel-switching strategy.
   */
  private async detectAudioMode(): Promise<void> {
    if (!this.mpv) return;
    try {
      const list = (await this.mpv.getProperty("track-list")) as
        | Array<{ type?: string; id?: number }>
        | undefined;
      const audio = (list ?? []).filter((t) => t.type === "audio");
      const ids = audio.map((t) => Number(t.id)).filter((n) => Number.isFinite(n));
      this.audioTrackIds = ids;
      this.audioMode = ids.length >= 2 ? "tracks" : "stereo";
      console.log(
        `[mpv] audio mode = ${this.audioMode}, tracks = ${ids.join(",") || "(stereo)"}`,
      );
      // Re-apply the desired vocal/accompaniment selection now that we know
      // the file's structure.
      const accompaniment: "L" | "R" =
        this.vocalChannelDefault === "L" ? "R" : "L";
      await this.setChannel(accompaniment);
    } catch (err) {
      console.warn("[mpv] detectAudioMode failed", err);
    }
  }

  async loadFile(path: string, vocalChannel?: "L" | "R"): Promise<void> {
    if (!this.mpv) throw new Error("mpv not started");
    if (vocalChannel) this.vocalChannelDefault = vocalChannel;
    // Reset to a known state before loading; channel will be re-applied
    // by detectAudioMode after the 'started' event.
    await Promise.resolve(this.removeKaraokeFilter()).catch(() => {});
    await Promise.resolve(this.mpv.load(path, "replace"));
    this.currentChannel = "both";
  }

  /**
   * "L" / "R" semantics:
   *   - stereo mode: pan the named channel to both speakers
   *   - tracks mode: select audio track #1 ("L") or track #2 ("R")
   * "both": removes any pan filter and (in tracks mode) defaults to track #1.
   */
  async setChannel(ch: "L" | "R" | "both"): Promise<void> {
    if (!this.mpv) throw new Error("mpv not started");
    if (this.audioMode === "tracks") {
      const ids = this.audioTrackIds;
      if (ch === "L" && ids[0] !== undefined) {
        await Promise.resolve(this.mpv.setProperty("aid", ids[0]));
      } else if (ch === "R" && ids[1] !== undefined) {
        await Promise.resolve(this.mpv.setProperty("aid", ids[1]));
      } else if (ch === "both" && ids[0] !== undefined) {
        // Multi-track files don't have a real "mix"; default to first track.
        await Promise.resolve(this.mpv.setProperty("aid", ids[0]));
      }
      // Drop any leftover pan filter in case we just switched modes.
      await Promise.resolve(this.removeKaraokeFilter()).catch(() => {});
    } else {
      if (ch === "both") {
        await Promise.resolve(this.removeKaraokeFilter()).catch(() => {});
      } else {
        const pan =
          ch === "L" ? "stereo|c0=c0|c1=c0" : "stereo|c0=c1|c1=c1";
        const filter = `@karaoke:lavfi=[pan=${pan}]`;
        try {
          await Promise.resolve(this.mpv.command("af", ["remove", "@karaoke"]));
        } catch {
          /* not present yet */
        }
        await Promise.resolve(this.mpv.command("af", ["add", filter]));
      }
    }
    this.currentChannel = ch;
    this.emit("channel-changed", { channel: ch });
  }

  private removeKaraokeFilter(): Promise<void> | void {
    if (!this.mpv) return;
    return Promise.resolve(this.mpv.command("af", ["remove", "@karaoke"]));
  }

  /**
   * Two-state toggle between the song's "原唱" (vocal) and "伴唱"
   * (accompaniment). No mute / no "both" middle state — that confused users.
   */
  async toggleVocal(
    vocalChannel: "L" | "R",
  ): Promise<"original" | "accompaniment"> {
    const accompaniment: "L" | "R" = vocalChannel === "L" ? "R" : "L";
    if (this.currentChannel === vocalChannel) {
      await this.setChannel(accompaniment);
      return "accompaniment";
    } else {
      await this.setChannel(vocalChannel);
      return "original";
    }
  }

  async pause(): Promise<void> {
    this.mpv?.pause();
  }

  async resume(): Promise<void> {
    this.mpv?.resume();
  }

  async seekTo(seconds: number): Promise<void> {
    if (!this.mpv) return;
    await Promise.resolve(this.mpv.command("seek", [seconds, "absolute"]));
  }

  async setVolume(vol: number): Promise<void> {
    if (!this.mpv) return;
    const clamped = Math.max(0, Math.min(130, vol));
    this.mpv.volume(clamped);
  }

  async replay(): Promise<void> {
    await this.seekTo(0);
    await this.resume();
  }

  async stop(): Promise<void> {
    this.mpv?.stop();
  }

  async getState(): Promise<Partial<MpvState>> {
    if (!this.mpv) return { vocal_channel: this.currentChannel };
    try {
      const [path, paused, pos, dur, vol] = await Promise.all([
        this.mpv.getProperty("path"),
        this.mpv.getProperty("pause"),
        this.mpv.getProperty("time-pos"),
        this.mpv.getProperty("duration"),
        this.mpv.getProperty("volume"),
      ]);
      return {
        current_file: (path as string) ?? null,
        paused: Boolean(paused),
        position: Number(pos) || 0,
        duration: Number(dur) || 0,
        volume: Number(vol) || 0,
        vocal_channel: this.currentChannel,
      };
    } catch {
      return { vocal_channel: this.currentChannel };
    }
  }

  async shutdown(): Promise<void> {
    if (this.mpv) {
      try {
        this.mpv.quit();
      } catch {
        /* ignore */
      }
    }
    this.ready = false;
  }
}

// silence unused-import warning
void dirname;
