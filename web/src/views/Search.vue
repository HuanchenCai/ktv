<script setup lang="ts">
import { ref, watch } from "vue";
import { api, type Song } from "../lib/api";

const q = ref("");
const loading = ref(false);
const songs = ref<Song[]>([]);
const error = ref("");
const queuedIds = ref<Set<number>>(new Set());

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

watch(q, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => run(val), 150);
});

async function run(query: string) {
  if (!query.trim()) {
    songs.value = [];
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const res = await api.searchSongs(query.trim());
    songs.value = res.songs;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function enqueue(song: Song) {
  queuedIds.value.add(song.id);
  try {
    await api.enqueue(song.id);
  } catch (err) {
    queuedIds.value.delete(song.id);
    error.value = err instanceof Error ? err.message : String(err);
  }
}
</script>

<template>
  <div class="p-4 space-y-3">
    <input
      v-model="q"
      class="input"
      placeholder="拼音首字母搜歌，例：zyn"
      autofocus
      autocomplete="off"
      spellcheck="false"
      inputmode="search"
    />

    <div v-if="error" class="text-red-400 text-sm">{{ error }}</div>
    <div v-if="loading" class="text-muted text-sm">搜索中...</div>

    <ul v-if="songs.length" class="space-y-2">
      <li
        v-for="song in songs"
        :key="song.id"
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
        <button
          class="btn-primary text-sm"
          :disabled="queuedIds.has(song.id)"
          @click="enqueue(song)"
        >
          {{ queuedIds.has(song.id) ? "已点" : "点歌" }}
        </button>
      </li>
    </ul>

    <div
      v-else-if="!loading && q"
      class="text-center text-muted text-sm mt-8"
    >
      没找到，换个首字母试试
    </div>

    <div v-else-if="!q" class="text-center text-muted text-xs mt-8 space-y-1">
      <div>输入每个字的拼音首字母</div>
      <div>例："只有你" → zyn, "我承担得起你" → wcddqn</div>
    </div>
  </div>
</template>
