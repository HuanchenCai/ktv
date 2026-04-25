<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
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

async function refresh() {
  try {
    const state = await api.player();
    song.value = state.current_song;
    if (state.vocal_channel) vocalChannel.value = state.vocal_channel;
    if (typeof state.position === "number") position.value = state.position;
    if (typeof state.duration === "number") duration.value = state.duration;
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
  return c === "L" ? "左声道" : c === "R" ? "右声道" : "双声道";
}

defineExpose({ song, vocalChannel });
</script>

<template>
  <div v-if="size === 'hero'" class="card space-y-2">
    <div v-if="song" class="space-y-2">
      <div class="text-xs text-muted">正在唱</div>
      <div class="text-3xl font-semibold truncate">{{ song.title }}</div>
      <div class="text-lg text-muted truncate">
        {{ song.artist }}
        <span v-if="song.lang"> · {{ song.lang }}</span>
      </div>
      <div class="flex items-center gap-2 text-sm">
        <span class="font-mono w-12 text-right">{{ fmt(position) }}</span>
        <div class="flex-1 h-1.5 bg-black/40 rounded overflow-hidden">
          <div
            class="h-full bg-accent transition-all"
            :style="{
              width:
                duration > 0
                  ? Math.min(100, (position / duration) * 100) + '%'
                  : '0%',
            }"
          ></div>
        </div>
        <span class="font-mono w-12">{{ fmt(duration) }}</span>
      </div>
      <div class="text-xs text-muted">
        当前声道：{{ channelLabel(vocalChannel) }}
        · 这首原唱在 {{ song.vocal_channel }} 声道
      </div>
    </div>
    <div v-else class="text-center text-muted py-12 text-lg">空闲中</div>
  </div>

  <div v-else class="card">
    <div v-if="song" class="space-y-1">
      <div class="text-xs text-muted">正在唱</div>
      <div class="text-lg font-semibold truncate">{{ song.title }}</div>
      <div class="text-muted text-sm truncate">{{ song.artist }}</div>
      <div class="text-xs text-muted">
        原唱声道：{{ song.vocal_channel }} · 当前：{{ channelLabel(vocalChannel) }}
      </div>
    </div>
    <div v-else class="text-center text-muted py-6">空闲中</div>
  </div>
</template>
