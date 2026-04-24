import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { platform } from "node:os";

/**
 * node-mpv 1.x — constructor spawns mpv immediately (no .start() method).
 * Methods relevant to us: load, command, getProperty, setProperty, pause,
 * resume, stop, quit, volume. Events: started, stopped, paused, resumed.
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

export type MpvState = {
  current_file: string | null;
  paused: boolean;
  position: number;
  duration: number;
  volume: number;
  vocal_channel: "L" | "R" | "both";
};

/**
 * High-level wrapper. Channel switch strategy:
 *   Persistent labelled filter "@karaoke" carrying a pan= param.
 *   To toggle we remove-then-add in place (no filter chain teardown, no pop).
 *
 *   pan=stereo|c0=c0|c1=c0   -> play left channel on both speakers
 *   pan=stereo|c0=c1|c1=c1   -> play right channel on both speakers
 *   (no filter)              -> stereo mix (original + accompaniment)
 */
export class MpvController extends EventEmitter {
  private mpv: MpvLike | null = null;
  private ready = false;
  private vocalChannelDefault: "L" | "R";
  private currentChannel: "L" | "R" | "both" = "both";
  private binaryPath: string;
  private fullscreen: boolean;

  constructor(opts: {
    vocalChannelDefault: "L" | "R";
    binaryPath?: string;
    fullscreen?: boolean;
  }) {
    super();
    this.vocalChannelDefault = opts.vocalChannelDefault;
    this.binaryPath = opts.binaryPath ?? "";
    this.fullscreen = opts.fullscreen ?? false;
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

    const mpvOpts: Record<string, unknown> = {
      audio_only: false,
      auto_restart: true,
      verbose: false,
      debug: false,
      binary: resolvedBinary,
    };

    const mpvArgs: string[] = ["--keep-open=yes", "--idle=yes"];
    if (this.fullscreen) mpvArgs.push("--fullscreen");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.mpv = new (MpvCtor as any)(mpvOpts, mpvArgs) as MpvLike;

    // node-mpv 1.x attaches the IPC socket asynchronously inside the ctor;
    // give it a moment to wire up before we try to send commands.
    await new Promise<void>((r) => setTimeout(r, 500));

    this.mpv.on("stopped", () => this.emit("track-ended"));
    this.mpv.on("started", () =>
      this.emit("track-started", { channel: this.currentChannel }),
    );
    this.mpv.on("resumed", () => this.emit("resumed"));
    this.mpv.on("paused", () => this.emit("paused"));
    this.ready = true;
    console.log("[mpv] ready");
  }

  async loadFile(path: string, vocalChannel?: "L" | "R"): Promise<void> {
    if (!this.mpv) throw new Error("mpv not started");
    await Promise.resolve(this.removeKaraokeFilter()).catch(() => {});
    await Promise.resolve(this.mpv.load(path, "replace"));
    this.currentChannel = "both";
    const defaultCh = vocalChannel ?? this.vocalChannelDefault;
    // Default to accompaniment on load (opposite of vocal channel).
    const accompaniment: "L" | "R" = defaultCh === "L" ? "R" : "L";
    await this.setChannel(accompaniment);
  }

  async setChannel(ch: "L" | "R" | "both"): Promise<void> {
    if (!this.mpv) throw new Error("mpv not started");
    if (ch === "both") {
      await Promise.resolve(this.removeKaraokeFilter()).catch(() => {});
    } else {
      const pan =
        ch === "L" ? "stereo|c0=c0|c1=c0" : "stereo|c0=c1|c1=c1";
      const filter = `@karaoke:lavfi=[pan=${pan}]`;
      try {
        await Promise.resolve(this.mpv.command("af", ["remove", "@karaoke"]));
      } catch {
        /* nothing to remove yet */
      }
      await Promise.resolve(this.mpv.command("af", ["add", filter]));
    }
    this.currentChannel = ch;
    this.emit("channel-changed", { channel: ch });
  }

  private removeKaraokeFilter(): Promise<void> | void {
    if (!this.mpv) return;
    return Promise.resolve(this.mpv.command("af", ["remove", "@karaoke"]));
  }

  async toggleVocal(
    vocalChannel: "L" | "R",
  ): Promise<"original" | "accompaniment" | "both"> {
    const accompaniment: "L" | "R" = vocalChannel === "L" ? "R" : "L";
    if (this.currentChannel === accompaniment) {
      await this.setChannel(vocalChannel);
      return "original";
    } else if (this.currentChannel === vocalChannel) {
      await this.setChannel("both");
      return "both";
    } else {
      await this.setChannel(accompaniment);
      return "accompaniment";
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
    await Promise.resolve(
      this.mpv.command("seek", [seconds, "absolute"]),
    );
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
