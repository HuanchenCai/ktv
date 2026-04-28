<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from "vue";
import { useRouter } from "vue-router";
import { api, type Song } from "../lib/api";
import { onWs } from "../lib/ws";

const router = useRouter();
const song = ref<Song | null>(null);
const position = ref(0);
const duration = ref(0);

async function refresh() {
  try {
    const s = await api.player();
    song.value = s.current_song;
    if (typeof s.position === "number") position.value = s.position;
    if (typeof s.duration === "number") duration.value = s.duration;
  } catch {
    /* ignore */
  }
}

let unsub: (() => void) | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  refresh();
  unsub = onWs((m) => {
    if (m.type === "player.state") {
      const p = m.payload as { current_song: Song | null };
      song.value = p.current_song;
    }
  });
  timer = setInterval(refresh, 2000);
});
onUnmounted(() => {
  unsub?.();
  if (timer) clearInterval(timer);
});

const progressPct = computed(() =>
  duration.value > 0
    ? Math.min(100, (position.value / duration.value) * 100)
    : 0,
);

function open() {
  router.push("/now");
}
async function skip() {
  await api.skip();
}
async function toggleVocal() {
  await api.toggleVocal();
}
</script>

<template>
  <div
    v-if="song"
    class="fixed left-2 right-2 bottom-[calc(56px+env(safe-area-inset-bottom))] z-20 animate-slide-up"
  >
    <div
      class="bg-panel/95 backdrop-blur-md rounded-2xl px-3 py-2.5 shadow-deep border border-border/60 flex items-center gap-3"
      @click="open"
    >
      <div
        class="w-10 h-10 rounded-lg bg-accent/20 grid place-items-center text-lg shrink-0"
      >
        🎤
      </div>
      <div class="flex-1 min-w-0">
        <div class="truncate text-sm font-medium">{{ song.title }}</div>
        <div class="text-[11px] text-muted truncate">{{ song.artist }}</div>
        <div class="mt-1 h-0.5 bg-black/30 rounded overflow-hidden">
          <div
            class="h-full bg-accent transition-all"
            :style="{ width: progressPct + '%' }"
          ></div>
        </div>
      </div>
      <div class="flex items-center gap-1 shrink-0" @click.stop>
        <button
          class="btn-icon !w-9 !h-9 text-sm"
          title="原唱/伴唱"
          @click="toggleVocal"
        >
          🎙
        </button>
        <button
          class="btn-icon !w-9 !h-9 text-sm"
          title="切歌"
          @click="skip"
        >
          ⏭
        </button>
      </div>
    </div>
  </div>
</template>
