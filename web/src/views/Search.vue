<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { api, type Song } from "../lib/api";

const q = ref("");
const loading = ref(false);
const songs = ref<Song[]>([]);
const error = ref("");
const queuedIds = ref<Set<number>>(new Set());
const heading = ref("热门");

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

watch(q, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => run(val), 150);
});

onMounted(() => run(""));

async function run(query: string) {
  loading.value = true;
  error.value = "";
  heading.value = query.trim() ? `搜索 "${query.trim()}"` : "热门";
  try {
    const res = await api.searchSongs(query.trim(), 50);
    songs.value = res.songs;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function add(song: Song, top: boolean) {
  queuedIds.value.add(song.id);
  try {
    await api.enqueue(song.id, { top });
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

    <div class="flex items-baseline justify-between text-xs text-muted">
      <span>{{ heading }}</span>
      <span v-if="songs.length">{{ songs.length }} 首</span>
    </div>

    <div v-if="loading && !songs.length" class="text-muted text-sm">加载中...</div>

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
        <div class="flex flex-col gap-1 shrink-0">
          <button
            class="btn-primary text-xs px-3 py-1"
            :disabled="queuedIds.has(song.id)"
            @click="add(song, false)"
          >
            {{ queuedIds.has(song.id) ? "已点" : "点歌" }}
          </button>
          <button
            class="btn-ghost text-xs px-3 py-1"
            :disabled="queuedIds.has(song.id)"
            @click="add(song, true)"
          >
            置顶
          </button>
        </div>
      </li>
    </ul>

    <div
      v-else-if="!loading && q"
      class="text-center text-muted text-sm mt-8"
    >
      没找到，换个首字母试试
    </div>

    <div
      v-else-if="!loading && !songs.length"
      class="text-center text-muted text-sm mt-8 space-y-1"
    >
      <div>曲库还是空的</div>
      <div class="text-xs">
        去 admin 页扫百度盘或导入本地 MKV
      </div>
    </div>
  </div>
</template>
