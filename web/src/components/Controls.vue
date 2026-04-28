<script setup lang="ts">
import { ref } from "vue";
import { api } from "../lib/api";

const volume = ref(80);
const lastAction = ref("");

async function flash(label: string, fn: () => Promise<unknown>) {
  lastAction.value = label;
  setTimeout(() => {
    if (lastAction.value === label) lastAction.value = "";
  }, 1200);
  try {
    await fn();
  } catch {
    /* ignore */
  }
}

const doSkip = () => flash("切歌", () => api.skip());
const doReplay = () => flash("重唱", () => api.replay());
const doToggle = () => flash("切声道", () => api.toggleVocal());
const doReopen = () => flash("重开视频", () => api.reopen());
const setChan = (c: "L" | "R" | "both") =>
  flash(`声道 ${c}`, () => api.setChannel(c));
async function onVolume() {
  await api.setVolume(volume.value);
}
</script>

<template>
  <div class="card space-y-3 p-4">
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-semibold">控制</h3>
      <span
        v-if="lastAction"
        class="text-xs text-accent animate-fade-in"
      >
        {{ lastAction }}
      </span>
    </div>

    <button class="btn-primary w-full py-2.5 text-sm" @click="doToggle">
      🎙 切原唱 / 伴唱
    </button>

    <div class="grid grid-cols-3 gap-2">
      <button
        class="btn-ghost text-xs py-1.5"
        @click="setChan('L')"
        title="只播左声道"
      >
        只 L
      </button>
      <button
        class="btn-ghost text-xs py-1.5"
        @click="setChan('both')"
        title="双声道一起播"
      >
        双声道
      </button>
      <button
        class="btn-ghost text-xs py-1.5"
        @click="setChan('R')"
        title="只播右声道"
      >
        只 R
      </button>
    </div>

    <div class="grid grid-cols-3 gap-2">
      <button class="btn-ghost text-xs py-1.5" @click="doReplay">↻ 重唱</button>
      <button
        class="btn-ghost text-xs py-1.5"
        @click="doReopen"
        title="窗口被关掉了？再开"
      >
        🔁 重开视频
      </button>
      <button class="btn-ghost text-xs py-1.5" @click="doSkip">⏭ 切歌</button>
    </div>

    <div class="space-y-1.5 pt-1">
      <div class="flex justify-between text-[11px] text-muted">
        <span>音量</span>
        <span class="font-mono tabular-nums">{{ volume }}</span>
      </div>
      <input
        v-model.number="volume"
        type="range"
        min="0"
        max="130"
        class="w-full"
        @change="onVolume"
      />
    </div>
  </div>
</template>
