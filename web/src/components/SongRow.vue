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

import type { Song as SongType } from "../lib/api";
function onQueue(song: SongType) {
  emit("queue", song);
}
function onTop(song: SongType) {
  emit("top", song);
}
</script>

<template>
  <li
    v-if="variant !== 'card'"
    class="card flex items-center justify-between gap-3"
  >
    <div class="flex-1 min-w-0">
      <div class="truncate">{{ song.title }}</div>
      <div class="text-xs text-muted truncate">
        {{ song.artist }}
        <span v-if="song.lang"> · {{ song.lang }}</span>
        <span v-if="song.cached" class="text-green-400"> · 已缓存</span>
      </div>
    </div>
    <div class="flex flex-col gap-1 shrink-0">
      <button
        class="btn-primary text-xs px-3 py-1"
        :disabled="queued"
        @click="onQueue(song)"
      >
        {{ queued ? "已点" : "点歌" }}
      </button>
      <button
        class="btn-ghost text-xs px-3 py-1"
        :disabled="queued"
        @click="onTop(song)"
      >
        置顶
      </button>
    </div>
  </li>

  <li
    v-else
    class="card flex flex-col gap-2 hover:ring-1 hover:ring-accent/50 transition-all"
  >
    <div class="min-w-0">
      <div class="truncate text-base font-medium">{{ song.title }}</div>
      <div class="text-xs text-muted truncate">
        {{ song.artist }}
        <span v-if="song.lang"> · {{ song.lang }}</span>
      </div>
      <div class="text-xs text-green-400 h-4">
        {{ song.cached ? "已缓存" : "" }}
      </div>
    </div>
    <div class="flex gap-2">
      <button
        class="btn-primary text-sm flex-1"
        :disabled="queued"
        @click="onQueue(song)"
      >
        {{ queued ? "已点" : "点歌" }}
      </button>
      <button
        class="btn-ghost text-sm flex-1"
        :disabled="queued"
        @click="onTop(song)"
      >
        置顶
      </button>
    </div>
  </li>
</template>
