<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { api, type Song } from "../lib/api";

const props = defineProps<{
  artist: string;
}>();

const songs = ref<Song[]>([]);
const total = ref(0);
const loading = ref(false);
const queuedIds = ref<Set<number>>(new Set());
const filter = ref("");

async function load(a: string) {
  loading.value = true;
  songs.value = [];
  try {
    const r = await fetch(
      `/api/library/songs?artist=${encodeURIComponent(a)}&limit=400&sort=title&order=asc`,
    ).then((rr) => rr.json());
    songs.value = (r.songs ?? []) as Song[];
    total.value = r.total ?? songs.value.length;
  } finally {
    loading.value = false;
  }
}

watch(() => props.artist, (a) => load(a), { immediate: true });

const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return songs.value;
  return songs.value.filter(
    (s) =>
      s.title.toLowerCase().includes(q) ||
      s.pinyin.toLowerCase().includes(q),
  );
});

async function add(s: Song, top: boolean) {
  if (queuedIds.value.has(s.id)) return;
  queuedIds.value.add(s.id);
  try {
    await api.enqueue(s.id, { top });
  } catch {
    queuedIds.value.delete(s.id);
  }
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-baseline justify-between gap-3">
      <h3 class="text-lg font-semibold">
        <span>{{ artist }}</span>
        <span class="text-sm text-muted ml-2">{{ total }} 首</span>
      </h3>
      <input
        v-model="filter"
        class="input !py-1.5 !px-3 text-sm w-40 lg:w-56"
        placeholder="过滤..."
        spellcheck="false"
      />
    </div>

    <div v-if="loading" class="text-sm text-muted">加载中...</div>

    <ul
      v-if="filtered.length"
      class="grid grid-cols-1 lg:grid-cols-2 gap-x-4 gap-y-0.5"
    >
      <li
        v-for="(s, i) in filtered"
        :key="s.id"
        class="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-panel-hover/60 transition-colors"
      >
        <span class="text-xs text-muted/70 font-mono w-7 text-right tabular-nums shrink-0">
          {{ i + 1 }}
        </span>
        <div class="flex-1 min-w-0">
          <div class="truncate text-sm">{{ s.title }}</div>
          <div v-if="s.lang || s.genre" class="text-[11px] text-muted truncate">
            {{ [s.lang, s.genre].filter(Boolean).join(" · ") }}
          </div>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <button
            class="btn-primary text-xs px-2.5 py-1"
            :disabled="queuedIds.has(s.id)"
            @click="add(s, false)"
          >
            {{ queuedIds.has(s.id) ? "已点" : "点歌" }}
          </button>
          <button
            class="btn-ghost text-xs px-2 py-1"
            :disabled="queuedIds.has(s.id)"
            @click="add(s, true)"
            title="插到下一首"
          >
            ↑
          </button>
        </div>
      </li>
    </ul>

    <div
      v-else-if="!loading && filter"
      class="text-sm text-muted text-center py-4"
    >
      该歌手没有匹配 "{{ filter }}" 的歌
    </div>
    <div v-else-if="!loading" class="text-sm text-muted text-center py-4">
      该歌手暂无歌曲
    </div>
  </div>
</template>
