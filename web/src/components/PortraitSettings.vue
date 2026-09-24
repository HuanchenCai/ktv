<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { api } from "../lib/api";
import { onWs } from "../lib/ws";

const progress = ref<{ total: number; done: number; ok: number; missed: number; current: string | null } | null>(null);
const running = ref(false);
const minSongs = ref(2);
const error = ref("");
let unsub: (() => void) | null = null;

onMounted(async () => {
  unsub = onWs((msg) => {
    if (msg.type !== "portrait.progress") return;
    progress.value = msg.payload as typeof progress.value;
    running.value = !!progress.value && progress.value.done < progress.value.total;
  });
  try {
    const state = await api.portraitProgress();
    progress.value = state.progress;
    running.value = state.running;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
});
onUnmounted(() => unsub?.());

async function run() {
  running.value = true;
  error.value = "";
  try {
    await api.fetchPortraits({ min_song_count: minSongs.value });
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    running.value = false;
  }
}
</script>

<template>
  <div class="card space-y-3">
    <h3 class="h-section">歌手头像</h3>
    <p class="text-xs text-muted">从 Wikipedia / Wikidata 补全歌手照片。已抓取的会跳过；曲库越大，耗时越久。</p>
    <div class="flex flex-wrap items-center gap-2">
      <label for="portrait-min-songs" class="text-xs text-muted">最少歌曲数</label>
      <input id="portrait-min-songs" v-model.number="minSongs" type="number" min="1" max="20" class="bg-elevated rounded px-2 py-1 text-sm w-20" />
      <button class="btn-primary text-sm" :disabled="running" @click="run">{{ running ? "抓取中..." : "开始抓取" }}</button>
    </div>
    <div v-if="progress" class="space-y-1.5 text-xs pt-1">
      <div class="flex items-center gap-2">
        <div class="flex-1 h-1.5 bg-black/40 rounded overflow-hidden">
          <div class="h-full bg-accent transition-all" :style="{ width: progress.total > 0 ? (progress.done / progress.total) * 100 + '%' : '0%' }"></div>
        </div>
        <span class="font-mono tabular-nums w-20 text-right text-muted">{{ progress.done }} / {{ progress.total }}</span>
      </div>
      <p class="text-muted">成功 {{ progress.ok }} · 未找到 {{ progress.missed }}<span v-if="progress.current"> · 正在处理 {{ progress.current }}</span></p>
    </div>
    <p v-if="error" class="text-rose-400 text-xs">{{ error }}</p>
  </div>
</template>
