<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { api, type Song } from "../lib/api";
import { onWs } from "../lib/ws";

const song = ref<Song | null>(null);
const vocalChannel = ref<"L" | "R" | "both">("both");
const volume = ref(80);

async function refresh() {
  try {
    const state = await api.player();
    song.value = state.current_song;
    if (state.vocal_channel) vocalChannel.value = state.vocal_channel;
    if (typeof state.volume === "number") volume.value = state.volume;
  } catch {
    /* may fail if no current song */
  }
}

let unsub: (() => void) | null = null;
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
});
onUnmounted(() => unsub?.());

async function doSkip() {
  await api.skip();
}
async function doReplay() {
  await api.replay();
}
async function doToggle() {
  await api.toggleVocal();
  await refresh();
}
async function doSwap() {
  await api.swapVocalChannel();
}
async function setChan(c: "L" | "R" | "both") {
  await api.setChannel(c);
  vocalChannel.value = c;
}
async function onVolume() {
  await api.setVolume(volume.value);
}

const channelLabel = (c: "L" | "R" | "both") =>
  c === "L" ? "左声道" : c === "R" ? "右声道" : "双声道";
</script>

<template>
  <div class="p-4 space-y-4">
    <div class="card">
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

    <div class="grid grid-cols-3 gap-2">
      <button class="btn-ghost" @click="setChan('L')">只 L</button>
      <button class="btn-ghost" @click="setChan('both')">双声道</button>
      <button class="btn-ghost" @click="setChan('R')">只 R</button>
    </div>

    <div class="grid grid-cols-2 gap-2">
      <button class="btn-primary" @click="doToggle">原唱/伴唱</button>
      <button class="btn-ghost" @click="doSwap">这首 L/R 反了</button>
    </div>

    <div class="grid grid-cols-2 gap-2">
      <button class="btn-ghost" @click="doReplay">重唱</button>
      <button class="btn-ghost" @click="doSkip">切歌</button>
    </div>

    <div class="card space-y-2">
      <div class="flex justify-between text-xs text-muted">
        <span>音量</span><span>{{ volume }}</span>
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
