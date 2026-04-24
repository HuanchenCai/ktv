import { EventEmitter } from "node:events";

// node-mpv has no TS types, CommonJS default export
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let MpvModule: any;

type MpvLike = {
  start: () => Promise<void>;
  load: (path: string, mode?: string) => Promise<void>;
  stop: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  setProperty: (prop: string, val: unknown) => Promise<void>;
  getProperty: (prop: string) => Promise<unknown>;
  command: (cmd: string, args: unknown[]) => Promise<void>;
  addListener: (event: string, cb: (...a: unknown[]) => void) => void;
  on: (event: string, cb: (...a: unknown[]) => void) => void;
  quit: () => Promise<void>;
};

export type MpvState = {
  current_file: string | null;
  paused: boolean;
  position: number;
  duration: number;
  volume: number;
  vocal_channel: "L" | "R" | "both";
};

/**
 * High-level wrapper around mpv via JSON IPC (node-mpv).
 *
 * Channel switching strategy:
 *   We keep a persistent pan filter labelled "@karaoke". Toggling is done by
 *   af-command to rewrite the pan params — no filter chain teardown, no pop.
 *
 *   pan=stereo|c0=c0|c1=c0   -> both speakers play L (accompaniment if L=acc)
 *   pan=stereo|c0=c1|c1=c1   -> both speakers play R
 *   (no filter)              -> both channels mixed (= original + accompaniment)
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
    if (!MpvModule) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = await import("node-mpv");
      // node-mpv default export
      MpvModule = (mod as { default?: unknown }).default ?? mod;
    }

    const mpvOpts: Record<string, unknown> = {
      audio_only: false,
      auto_restart: true,
      verbose: false,
      debug: false,
    };
    if (this.binaryPath) {
      mpvOpts.binary = this.binaryPath;
    }

    const mpvArgs: string[] = ["--keep-open=yes", "--idle=yes"];
    if (this.fullscreen) mpvArgs.push("--fullscreen");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.mpv = new (MpvModule as any)(mpvOpts, mpvArgs) as MpvLike;

    await this.mpv.start();
    this.ready = true;

    this.mpv.on("stopped", () => this.emit("track-ended"));
    this.mpv.on("started", () =>
      this.emit("track-started", { channel: this.currentChannel }),
    );
    this.mpv.on("resumed", () => this.emit("resumed"));
    this.mpv.on("paused", () => this.emit("paused"));
    console.log("[mpv] ready");
  }

  async loadFile(path: string, vocalChannel?: "L" | "R"): Promise<void> {
    if (!this.mpv) throw new Error("mpv not started");
    // Reset filter before loading; we re-apply after load based on desired mode.
    await this.removeKaraokeFilter().catch(() => {});
    await this.mpv.load(path, "replace");
    this.currentChannel = "both";
    const defaultCh = vocalChannel ?? this.vocalChannelDefault;
    // After load, switch to accompaniment mode by default (opposite of vocal).
    const accompaniment: "L" | "R" = defaultCh === "L" ? "R" : "L";
    await this.setChannel(accompaniment);
  }

  /**
   * Switch between original / accompaniment / both.
   *   "L" -> both speakers play left channel
   *   "R" -> both speakers play right channel
   *   "both" -> remove filter, play stereo mixed
   */
  async setChannel(ch: "L" | "R" | "both"): Promise<void> {
    if (!this.mpv) throw new Error("mpv not started");
    if (ch === "both") {
      await this.removeKaraokeFilter().catch(() => {});
    } else {
      const pan =
        ch === "L"
          ? "stereo|c0=c0|c1=c0"
          : "stereo|c0=c1|c1=c1";
      const filter = `@karaoke:lavfi=[pan=${pan}]`;
      // Try update-in-place; fall back to add if not present yet.
      try {
        await this.mpv.command("af", ["remove", "@karaoke"]);
      } catch {
        /* first call, nothing to remove */
      }
      await this.mpv.command("af", ["add", filter]);
    }
    this.currentChannel = ch;
    this.emit("channel-changed", { channel: ch });
  }

  private async removeKaraokeFilter(): Promise<void> {
    if (!this.mpv) return;
    await this.mpv.command("af", ["remove", "@karaoke"]);
  }

  /**
   * Given the song's vocal_channel, toggle between "original" and "accompaniment".
   *   vocal=L -> accompaniment is R
   *   vocal=R -> accompaniment is L
   */
  async toggleVocal(vocalChannel: "L" | "R"): Promise<"original" | "accompaniment" | "both"> {
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
    if (!this.mpv) return;
    await this.mpv.pause();
  }

  async resume(): Promise<void> {
    if (!this.mpv) return;
    await this.mpv.resume();
  }

  async seekTo(seconds: number): Promise<void> {
    if (!this.mpv) return;
    await this.mpv.command("seek", [seconds, "absolute"]);
  }

  async setVolume(vol: number): Promise<void> {
    if (!this.mpv) return;
    const clamped = Math.max(0, Math.min(130, vol));
    await this.mpv.setProperty("volume", clamped);
  }

  async replay(): Promise<void> {
    await this.seekTo(0);
    await this.resume();
  }

  async stop(): Promise<void> {
    if (!this.mpv) return;
    await this.mpv.stop();
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
        await this.mpv.quit();
      } catch {
        /* ignore */
      }
    }
    this.ready = false;
  }
}
