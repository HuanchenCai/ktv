<script setup lang="ts">
import { ref } from "vue";
import { api } from "../lib/api";

const volume = ref(80);

async function doSkip() {
  await api.skip();
}
async function doReplay() {
  await api.replay();
}
async function doToggle() {
  await api.toggleVocal();
}
async function doSwap() {
  await api.swapVocalChannel();
}
async function setChan(c: "L" | "R" | "both") {
  await api.setChannel(c);
}
async function onVolume() {
  await api.setVolume(volume.value);
}
</script>

<template>
  <div class="space-y-3">
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
