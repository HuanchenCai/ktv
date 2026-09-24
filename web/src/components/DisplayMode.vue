<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../lib/api";

type Mode = "fullscreen" | "window";
const mode = ref<Mode | null>(null);
const busy = ref(false);
const error = ref("");

onMounted(async () => {
  try { mode.value = (await api.displayMode()).mode; }
  catch (e) { error.value = e instanceof Error ? e.message : String(e); }
});

async function choose(next: Mode) {
  if (busy.value || mode.value === next) return;
  busy.value = true;
  error.value = "";
  try { mode.value = (await api.setDisplayMode(next)).mode; }
  catch (e) { error.value = e instanceof Error ? e.message : String(e); }
  finally { busy.value = false; }
}
</script>

<template>
  <section class="card space-y-3" aria-labelledby="display-mode-title">
    <div>
      <h2 id="display-mode-title" class="font-semibold">播放画面</h2>
      <p class="mt-1 text-sm text-muted">选择本次聚会的视频窗口方式。房主可从手机切换，来宾无权修改。</p>
    </div>
    <div class="grid gap-2 sm:grid-cols-2">
      <button type="button" class="rounded-xl border p-4 text-left transition-colors" :class="mode === 'fullscreen' ? 'border-accent bg-accent/10' : 'border-border bg-panel'" :disabled="busy" @click="choose('fullscreen')">
        <strong class="block">电视全屏</strong>
        <span class="mt-1 block text-xs text-muted">把播放器移到扩展的电视屏幕后使用。</span>
      </button>
      <button type="button" class="rounded-xl border p-4 text-left transition-colors" :class="mode === 'window' ? 'border-accent bg-accent/10' : 'border-border bg-panel'" :disabled="busy" @click="choose('window')">
        <strong class="block">独立窗口</strong>
        <span class="mt-1 block text-xs text-muted">只采集 KTV 播放窗口；笔记本仍可打开设置。</span>
      </button>
    </div>
    <p class="text-xs text-muted">镜像整个桌面会把笔记本的操作也显示在电视上；要分开画面，请使用扩展显示器或仅共享窗口。本次选择会保持到服务重启。</p>
    <p v-if="error" role="alert" class="text-sm text-red-400">{{ error }}</p>
  </section>
</template>
