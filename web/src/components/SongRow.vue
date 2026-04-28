<script setup lang="ts">
import type { Song } from "../lib/api";

defineProps<{
  song: Song;
  /** Whether the user has already clicked one of the queue buttons. */
  queued?: boolean;
  /** Visual variant: "row" (compact, phone) or "card" (grid cell, TV). */
  variant?: "row" | "card";
}>();

const emit = defineEmits<{
  (e: "queue", song: Song): void;
  (e: "top", song: Song): void;
}>();

function onQueue(song: Song) {
  emit("queue", song);
}
function onTop(song: Song) {
  emit("top", song);
}

// Stable color hash for the song "art" tile so the same artist gets the
// same accent color across re-renders.
function colorFor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  const hues = [340, 200, 160, 280, 30, 0, 220, 50];
  return `hsl(${hues[Math.abs(h) % hues.length]}, 60%, 18%)`;
}
function initialFor(s: string): string {
  return s ? s[0].toUpperCase() : "?";
}
</script>

<template>
  <li
    v-if="variant !== 'card'"
    class="card-hoverable flex items-center gap-3"
  >
    <div
      class="w-12 h-12 rounded-lg shrink-0 grid place-items-center text-xl font-semibold"
      :style="{ background: colorFor(song.artist) }"
    >
      {{ initialFor(song.title) }}
    </div>
    <div class="flex-1 min-w-0">
      <div class="truncate font-medium">{{ song.title }}</div>
      <div class="text-xs text-muted truncate flex items-center gap-1.5">
        <span>{{ song.artist }}</span>
        <span v-if="song.lang" class="text-muted/60">·</span>
        <span v-if="song.lang">{{ song.lang }}</span>
        <span v-if="song.cached" class="text-emerald-400">·</span>
        <span v-if="song.cached" class="text-emerald-400">已缓存</span>
      </div>
    </div>
    <div class="flex flex-col gap-1 shrink-0">
      <button
        class="btn-primary text-xs px-3 py-1.5"
        :disabled="queued"
        @click="onQueue(song)"
      >
        {{ queued ? "已点" : "点歌" }}
      </button>
      <button
        class="btn-ghost text-xs px-3 py-1.5"
        :disabled="queued"
        @click="onTop(song)"
      >
        置顶
      </button>
    </div>
  </li>

  <li v-else class="card-hoverable flex flex-col gap-3 p-4">
    <div
      class="aspect-square rounded-lg grid place-items-center text-5xl font-bold shadow-inner"
      :style="{ background: colorFor(song.artist) }"
    >
      <span class="opacity-90">{{ initialFor(song.title) }}</span>
    </div>
    <div class="min-w-0">
      <div class="truncate text-base font-semibold leading-tight">
        {{ song.title }}
      </div>
      <div class="text-xs text-muted truncate mt-1">{{ song.artist }}</div>
      <div class="flex gap-2 mt-1 text-[11px]">
        <span v-if="song.lang" class="text-muted">{{ song.lang }}</span>
        <span v-if="song.cached" class="text-emerald-400">已缓存</span>
      </div>
    </div>
    <div class="flex gap-2">
      <button
        class="btn-primary text-sm flex-1 py-1.5"
        :disabled="queued"
        @click="onQueue(song)"
      >
        {{ queued ? "已点" : "点歌" }}
      </button>
      <button
        class="btn-ghost text-sm flex-1 py-1.5"
        :disabled="queued"
        @click="onTop(song)"
      >
        置顶
      </button>
    </div>
  </li>
</template>
