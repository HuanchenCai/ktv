<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from "vue";
import { api, type Song } from "../lib/api";
import { onWs } from "../lib/ws";

withDefaults(
  defineProps<{
    /** "card" small, "hero" big for TV */
    size?: "card" | "hero";
  }>(),
  { size: "card" },
);

const song = ref<Song | null>(null);
const vocalChannel = ref<"L" | "R" | "both">("both");
const position = ref(0);
const duration = ref(0);
const paused = ref(false);

async function refresh() {
  try {
    const state = await api.player();
    song.value = state.current_song;
    if (state.vocal_channel) vocalChannel.value = state.vocal_channel;
    if (typeof state.position === "number") position.value = state.position;
    if (typeof state.duration === "number") duration.value = state.duration;
    if (typeof state.paused === "boolean") paused.value = state.paused;
  } catch {
    /* may fail if no current song */
  }
}

let unsub: (() => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  refresh();
  unsub = onWs((msg) => {
    if (msg.type === "player.state") {
      const p = msg.payload as {
        current_song: Song | null;
        vocal_channel?: "L" | "R" | "both";
      };
      song.value = p.current_song;
      if (p.vocal_channel) vocalChannel.value = p.vocal_channel;
    }
  });
  pollTimer = setInterval(refresh, 2000);
});

onUnmounted(() => {
  unsub?.();
  if (pollTimer) clearInterval(pollTimer);
});

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const mm = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

function channelLabel(c: "L" | "R" | "both") {
  return c === "L" ? "L 声道" : c === "R" ? "R 声道" : "双声道";
}

const progressPct = computed(() =>
  duration.value > 0
    ? Math.min(100, (position.value / duration.value) * 100)
    : 0,
);

defineExpose({ song, vocalChannel });
</script>

<template>
  <!-- HERO: TV display, generous padding, glow when playing -->
  <div
    v-if="size === 'hero'"
    class="relative card overflow-hidden p-7 min-h-[200px]"
    :class="song ? 'shadow-glow ring-1 ring-accent/40' : ''"
  >
    <!-- decorative gradient -->
    <div
      v-if="song"
      class="absolute inset-0 -z-10 opacity-30 bg-gradient-to-br from-accent/30 via-transparent to-transparent"
    ></div>

    <div v-if="song" class="space-y-3">
      <div class="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-accent font-semibold">
        <span class="inline-block w-2 h-2 rounded-full bg-accent animate-shimmer"></span>
        <span>{{ paused ? "已暂停" : "正在唱" }}</span>
      </div>
      <div class="text-4xl font-bold leading-tight truncate">{{ song.title }}</div>
      <div class="text-xl text-white/70 truncate">
        {{ song.artist
        }}<span v-if="song.lang" class="text-muted"> · {{ song.lang }}</span>
      </div>

      <div class="flex items-center gap-3 pt-2">
        <span class="font-mono tabular-nums text-sm text-muted w-12 text-right">
          {{ fmt(position) }}
        </span>
        <div class="flex-1 h-2 bg-black/40 rounded-full overflow-hidden">
          <div
            class="h-full bg-gradient-to-r from-accent to-accent-soft rounded-full transition-all"
            :style="{ width: progressPct + '%' }"
          ></div>
        </div>
        <span class="font-mono tabular-nums text-sm text-muted w-12">
          {{ fmt(duration) }}
        </span>
      </div>

      <div class="flex items-center gap-3 text-xs text-muted pt-1">
        <span class="px-2 py-0.5 rounded-md bg-panel">
          当前 {{ channelLabel(vocalChannel) }}
        </span>
        <span>原唱在 {{ song.vocal_channel }}</span>
      </div>
    </div>

    <div v-else class="text-center py-8 space-y-3">
      <div class="text-7xl">🎤</div>
      <div class="text-xl font-medium">没人在唱</div>
      <div class="text-sm text-muted">扫右边二维码点首歌开嗓</div>
    </div>
  </div>

  <!-- CARD: phone size -->
  <div v-else class="card overflow-hidden p-5">
    <div v-if="song" class="space-y-3">
      <div class="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] font-semibold">
        <span class="inline-flex gap-0.5 items-end h-3.5">
          <span class="eq-bar"></span>
          <span class="eq-bar"></span>
          <span class="eq-bar"></span>
          <span class="eq-bar"></span>
        </span>
        <span class="text-gradient-brand">
          {{ paused ? "已暂停" : "正在唱" }}
        </span>
      </div>
      <div class="text-2xl font-bold truncate leading-tight tracking-tight">
        {{ song.title }}
      </div>
      <div class="text-sm text-white/65 truncate">{{ song.artist }}</div>
      <div class="flex items-center gap-2 pt-1">
        <span class="font-mono text-xs text-white/50 w-10 text-right tabular-nums">
          {{ fmt(position) }}
        </span>
        <div class="flex-1 h-1 rounded-full overflow-hidden" style="background: rgba(255,255,255,0.08)">
          <div
            class="h-full rounded-full transition-all"
            :style="{
              width: progressPct + '%',
              background: 'linear-gradient(to right, #ff2e6b, #d946ef)',
              boxShadow: '0 0 8px rgba(255,46,107,0.6)'
            }"
          ></div>
        </div>
        <span class="font-mono text-xs text-white/50 w-10 tabular-nums">
          {{ fmt(duration) }}
        </span>
      </div>
      <div class="text-xs text-white/45 flex items-center gap-2">
        <span class="px-2 py-0.5 rounded-full text-[10px]"
              style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08)">
          当前 {{ channelLabel(vocalChannel) }}
        </span>
        <span>原唱在 {{ song.vocal_channel }}</span>
      </div>
    </div>
    <div v-else class="text-center py-6 space-y-3">
      <!-- Spinning vinyl placeholder so the idle screen has motion -->
      <div class="relative w-20 h-20 mx-auto">
        <div
          class="absolute inset-0 rounded-full animate-spin-slow"
          style="
            background:
              repeating-radial-gradient(circle, rgba(255,255,255,0.04) 0 1px, transparent 1px 3px),
              radial-gradient(circle at center, #18182a 35%, #0b0b14 100%);
            box-shadow: 0 0 24px rgba(217,70,239,0.25), inset 0 0 12px rgba(0,0,0,0.6);
          "
        ></div>
        <div
          class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-5 rounded-full"
          style="background: linear-gradient(135deg, #ff2e6b, #d946ef)"
        ></div>
      </div>
      <div class="text-base font-medium text-white/85">空闲中</div>
      <div class="text-xs text-white/45">点首歌开嗓</div>
    </div>
  </div>
</template>
