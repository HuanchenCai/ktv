import { EventEmitter } from "node:events";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { platform, tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { prepareQrBgra, type BgraOverlay } from "./qr-overlay.ts";

type OverlayCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

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

// (Filter-based overlay was reverted — the lavfi-complex form forced [aid1] to
// [ao] at startup, which broke runtime aid switching for multi-track files.
// We now overlay via the `overlay-add` OSD command instead, which leaves the
// audio chain alone.)

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
  private qrOverlaySpecs: Array<{ path: string; corner: OverlayCorner }>;
  private inputConfPath: string | null = null;
  private overlays: Array<{ bgra: BgraOverlay; corner: OverlayCorner }> = [];

  /** "stereo" = single-stream pan mode; "tracks" = multi-track aid mode */
  private audioMode: "stereo" | "tracks" = "stereo";
  private audioTrackIds: number[] = [];

  /**
   * EOF watcher state. mpv with `--keep-open=yes` (which we need so the
   * AirPlay/Miracast mirror doesn't drop when a song ends) does NOT emit
   * a `stopped` event at EOF — it just sets pause=true and parks on the
   * last frame. Without an active poller, the orchestrator never learns
   * the song ended and queue advance silently breaks.
   *
   * Strategy: poll `eof-reached`; on the false→true edge, emit
   * `track-ended` exactly once. Reset the latch on every load so the next
   * song's EOF fires again.
   */
  private eofPoller: ReturnType<typeof setInterval> | null = null;
  private eofLatched = false;
  /**
   * True from the moment loadFile() starts swapping in a new file until mpv
   * emits "started" for it. During this window the OLD file may still report
   * eof-reached=true (it was parked at EOF under --keep-open), which would
   * make the EOF poller fire a spurious track-ended and yank the song the
   * user just queued. Suppress the poller while loading to close that race.
   */
  private loading = false;
  private loadingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: {
    vocalChannelDefault: "L" | "R";
    binaryPath?: string;
    fullscreen?: boolean;
    qrOverlayPath?: string | null;
    /** Multiple in-video QR overlays, each pinned to a screen corner. */
    qrOverlays?: Array<{ path: string; corner: OverlayCorner }>;
  }) {
    super();
    this.vocalChannelDefault = opts.vocalChannelDefault;
    this.binaryPath = opts.binaryPath ?? "";
    this.fullscreen = opts.fullscreen ?? false;
    this.qrOverlayPath = opts.qrOverlayPath ?? null;
    // Prefer the explicit multi-overlay list; fall back to the single
    // top-right overlay for backward compatibility.
    this.qrOverlaySpecs =
      opts.qrOverlays ??
      (opts.qrOverlayPath
        ? [{ path: opts.qrOverlayPath, corner: "top-right" }]
        : []);
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
      // No --force-window: mpv stays headless until the first file
      // loads, so on boot the TV (browser-mirrored) keeps showing the
      // /tv page (artist list + QR code + queue) instead of a black
      // mpv window. After the first song, the window stays open between
      // tracks (keep-open=yes pauses on the last frame) and the
      // orchestrator's filler logic keeps something playing if the
      // queue head can't go yet.
      "--ontop=yes",
      "--title=KTV",
      "--cursor-autohide=1000",
      "--osc=no", // we draw our own controls in the web UI
      `--input-conf=${this.inputConfPath}`,
    ];
    if (platform() === "darwin") {
      // macOS-specific: kill the native-fullscreen Space behaviour. By
      // default mpv on macOS opens a brand-new Space when fullscreen is
      // toggled, and `load(replace)` between songs briefly tears down
      // and rebuilds the window — that triggers macOS's Space switch
      // animation and the desktop flashes through. --no-native-fs makes
      // fullscreen a borderless window on the current Space instead, so
      // the song change is seamless. The animation-duration override
      // also kills the residual zoom-in animation if we ever hit a
      // path that does enter native fs.
      mpvArgs.push("--no-native-fs", "--macos-fs-animation-duration=0");
    }
    // Fullscreen is applied per-load via setProperty("fullscreen", true)
    // (see loadFile). Passing --fs=yes here would also force the idle
    // window into existence on some Windows builds, which we don't want.

    // Decode the QR PNG into raw BGRA bytes upfront. mpv's `overlay-add` IPC
    // command consumes a raw BGRA file and draws on the OSD layer — that's
    // independent of the filter chain, so audio routing (incl. multi-track
    // aid switching) is unaffected.
    this.overlays = [];
    this.qrOverlaySpecs.forEach((spec, i) => {
      if (!existsSync(spec.path)) return;
      try {
        const bgra = prepareQrBgra(spec.path, `qr-${i}.bgra`);
        this.overlays.push({ bgra, corner: spec.corner });
        console.log(
          `[mpv] QR overlay #${i} prepared (${bgra.width}x${bgra.height} @ ${spec.corner})`,
        );
      } catch (err) {
        console.warn(`[mpv] QR overlay #${i} prep failed; skipping:`, err);
      }
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.mpv = new (MpvCtor as any)(mpvOpts, mpvArgs) as MpvLike;

    // node-mpv 1.x attaches the IPC socket asynchronously inside the ctor;
    // give it a moment to wire up before we try to send commands.
    await new Promise<void>((r) => setTimeout(r, 500));

    this.mpv.on("stopped", () => this.emit("track-ended"));
    this.mpv.on("started", () => {
      // New file is playing — clear the EOF latch so the next end-of-file
      // can fire track-ended again, and end the load-suppression window.
      this.eofLatched = false;
      this.loading = false;
      if (this.loadingTimer) {
        clearTimeout(this.loadingTimer);
        this.loadingTimer = null;
      }
      void this.detectAudioMode().catch(() => {});
      void this.applyQrOverlay().catch(() => {});
      this.emit("track-started", { channel: this.currentChannel });
    });
    this.mpv.on("resumed", () => this.emit("resumed"));
    this.mpv.on("paused", () => this.emit("paused"));
    this.startEofPoller();
    this.ready = true;
    console.log("[mpv] ready");
  }

  /**
   * Poll mpv's `eof-reached` property. With --keep-open=yes mpv pauses on
   * the last frame instead of emitting "stopped", so we synthesize a
   * track-ended event ourselves.
   */
  private startEofPoller(): void {
    if (this.eofPoller) return;
    this.eofPoller = setInterval(async () => {
      if (!this.mpv || this.loading) return;
      try {
        const eof = await this.mpv.getProperty("eof-reached");
        if (eof === true && !this.eofLatched) {
          this.eofLatched = true;
          this.emit("track-ended");
        } else if (eof !== true && this.eofLatched) {
          // Belt-and-suspenders: if something else cleared eof-reached
          // (loadfile, seek-back, etc.), reset the latch.
          this.eofLatched = false;
        }
      } catch {
        /* ignore — likely no file loaded yet */
      }
    }, 500);
  }

  /**
   * Push the prepared QR bitmap onto mpv's OSD via the `overlay-add` command.
   * Must be called after a file is loaded — mpv computes osd-width from the
   * actual video stream / output size, which we use to pin the QR to the
   * top-right corner with a 40 px margin.
   */
  private async applyQrOverlay(): Promise<void> {
    if (!this.mpv || this.overlays.length === 0) return;
    const margin = 28;
    let osdW = 1920;
    let osdH = 1080;
    try {
      osdW = Number(await this.mpv.getProperty("osd-width")) || osdW;
      osdH = Number(await this.mpv.getProperty("osd-height")) || osdH;
    } catch {
      /* use defaults */
    }
    for (let i = 0; i < this.overlays.length; i++) {
      const { bgra, corner } = this.overlays[i];
      const left = corner.endsWith("left");
      const top = corner.startsWith("top");
      const x = left ? margin : Math.max(0, osdW - bgra.width - margin);
      const y = top ? margin : Math.max(0, osdH - bgra.height - margin);
      try {
        await Promise.resolve(
          this.mpv.command("overlay-add", [
            i,
            x,
            y,
            bgra.path,
            0,
            "bgra",
            bgra.width,
            bgra.height,
            bgra.stride,
          ]),
        );
      } catch (err) {
        console.warn(`[mpv] overlay-add #${i} failed:`, err);
      }
    }
  }

  /**
   * Inspect the freshly loaded file's audio streams and pick the right
   * channel-switching strategy. Doesn't pick a channel itself — the
   * orchestrator owns that policy (so it can apply a remembered
   * preference, switch filler to vocal mode, etc.) — and listens for
   * `audio-detected` to act once the structure is known.
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
      this.emit("audio-detected");
    } catch (err) {
      console.warn("[mpv] detectAudioMode failed", err);
    }
  }

  async loadFile(path: string, vocalChannel?: "L" | "R"): Promise<void> {
    if (!this.mpv) throw new Error("mpv not started");
    if (vocalChannel) this.vocalChannelDefault = vocalChannel;
    // Clear the EOF latch immediately so a poll between load() returning
    // and the "started" event can't accidentally re-fire track-ended.
    this.eofLatched = false;
    // Suppress the EOF poller until the new file's "started" event arrives,
    // so a stale eof-reached from the just-parked previous file can't fire a
    // spurious track-ended mid-swap. Safety timer clears it if "started" is
    // somehow never emitted (e.g. a load error), so the poller can't wedge.
    this.loading = true;
    if (this.loadingTimer) clearTimeout(this.loadingTimer);
    this.loadingTimer = setTimeout(() => {
      this.loading = false;
      this.loadingTimer = null;
    }, 5000);
    // Reset to a known state before loading; channel will be re-applied
    // by detectAudioMode after the 'started' event.
    await Promise.resolve(this.removeKaraokeFilter()).catch(() => {});
    await Promise.resolve(this.mpv.load(path, "replace"));
    // mpv may carry pause=true from a previous EOF (--keep-open=yes parks
    // pause=true on the last frame). Force play so the new song actually
    // starts — without this, "next" after a parked end-of-file would load
    // but stay paused.
    try {
      await Promise.resolve(this.mpv.setProperty("pause", false));
    } catch {
      /* ignore */
    }
    // Drive fullscreen on every load so:
    //   1. The first song after boot goes straight to true fullscreen
    //      (taskbar hidden) without the user double-clicking.
    //   2. If the user manually exited fullscreen mid-session, the next
    //      song still re-asserts it.
    if (this.fullscreen) {
      try {
        await Promise.resolve(this.mpv.setProperty("fullscreen", true));
      } catch {
        /* ignore */
      }
    }
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
   * Flip between L and R channel (or between the two audio tracks for
   * multi-stream files). Doesn't try to label them as 原唱 vs 伴唱 — the
   * convention varies per publisher and per file, and the DB's
   * `vocal_channel` field is unreliable. Users learn which side has the
   * vocal by ear and just keep tapping the toggle until they like it.
   */
  async toggleVocal(): Promise<"L" | "R"> {
    const next: "L" | "R" = this.currentChannel === "L" ? "R" : "L";
    await this.setChannel(next);
    return next;
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
    // node-mpv 1.x's `volume()` helper has been flaky: it returns void
    // without an awaitable, and silently no-ops when the player is in
    // idle state (between songs). The IPC `set_property volume` form
    // works regardless of playback state, so use that.
    try {
      await Promise.resolve(this.mpv.setProperty("volume", clamped));
    } catch (err) {
      console.warn("[mpv] setVolume failed:", err);
    }
  }

  async replay(): Promise<void> {
    await this.seekTo(0);
    await this.resume();
  }

  async stop(): Promise<void> {
    this.mpv?.stop();
  }

  /**
   * Apply a 3-band EQ on top of the current audio chain. Uses three
   * `equalizer` lavfi nodes labelled `@ktv_eq` so we can replace them in
   * place. Gains are in dB, range -12..+12. Pass null to remove the EQ.
   *
   * Frequencies picked for vocal-friendly tuning:
   *   low  = 100 Hz  (warmth / boom)
   *   mid  = 1 kHz   (presence / nasal)
   *   high = 8 kHz   (air / sibilance)
   */
  async setEq(
    bands: { low: number; mid: number; high: number } | null,
  ): Promise<void> {
    if (!this.mpv) return;
    try {
      await Promise.resolve(this.mpv.command("af", ["remove", "@ktv_eq"]));
    } catch {
      /* not present yet */
    }
    if (!bands) return;
    const clamp = (v: number) => Math.max(-12, Math.min(12, v));
    const eqBands: Array<[number, number]> = [
      [100, clamp(bands.low)],
      [1000, clamp(bands.mid)],
      [8000, clamp(bands.high)],
    ];
    const chain = eqBands
      .map(([f, g]) => `equalizer=f=${f}:t=q:w=1:g=${g}`)
      .join(",");
    try {
      await Promise.resolve(
        this.mpv.command("af", ["add", `@ktv_eq:lavfi=[${chain}]`]),
      );
    } catch (err) {
      console.warn("[mpv] setEq failed:", err);
    }
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
    if (this.eofPoller) {
      clearInterval(this.eofPoller);
      this.eofPoller = null;
    }
    if (this.mpv) {
      try {
        for (let i = 0; i < Math.max(1, this.overlays.length); i++) {
          await Promise.resolve(this.mpv.command("overlay-remove", [i]));
        }
      } catch {
        /* ignore */
      }
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
