<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { api, type Song } from "../lib/api";
import SongRow from "./SongRow.vue";

const props = withDefaults(
  defineProps<{
    /** "row" for phone list, "card" for desktop grid */
    variant?: "row" | "card";
    /** Tailwind grid-cols class applied when variant=card */
    gridClass?: string;
    /** Initial limit */
    limit?: number;
  }>(),
  {
    variant: "row",
    gridClass: "grid-cols-2 md:grid-cols-3 lg:grid-cols-4",
    limit: 50,
  },
);

const q = ref("");
const loading = ref(false);
const songs = ref<Song[]>([]);
const error = ref("");
const queuedIds = ref<Set<number>>(new Set());
const heading = ref("热门");
const popular = ref<Array<{ artist: string; count: number }>>([]);
const selectedArtist = ref<string | null>(null);

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

watch(q, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => run(val), 150);
});

onMounted(async () => {
  await run("");
  try {
    const r = await api.popularArtists();
    popular.value = r.artists;
  } catch {
    /* not fatal */
  }
});

async function run(query: string) {
  loading.value = true;
  error.value = "";
  if (selectedArtist.value) {
    heading.value = `${selectedArtist.value}的歌`;
  } else if (query.trim()) {
    heading.value = `搜索 "${query.trim()}"`;
  } else {
    heading.value = "热门";
  }
  try {
    const res = await api.searchSongs(
      query.trim(),
      props.limit,
      selectedArtist.value ?? undefined,
    );
    songs.value = res.songs;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

function selectArtist(name: string | null) {
  selectedArtist.value = selectedArtist.value === name ? null : name;
  q.value = "";
  run("");
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
  <div class="space-y-3">
    <input
      v-model="q"
      class="input"
      placeholder="拼音首字母搜歌，例：zyn"
      autocomplete="off"
      spellcheck="false"
      inputmode="search"
    />

    <div
      v-if="popular.length"
      class="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1"
    >
      <button
        v-if="selectedArtist"
        class="shrink-0 px-3 py-1.5 rounded-full text-xs bg-accent text-white"
        @click="selectArtist(null)"
      >
        × 清除筛选
      </button>
      <button
        v-for="a in popular"
        :key="a.artist"
        class="shrink-0 px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors"
        :class="
          selectedArtist === a.artist
            ? 'bg-accent text-white'
            : 'bg-panel text-white/80 hover:text-white'
        "
        @click="selectArtist(a.artist)"
      >
        {{ a.artist }}
        <span class="text-muted ml-1">{{ a.count }}</span>
      </button>
    </div>

    <div v-if="error" class="text-red-400 text-sm">{{ error }}</div>

    <div class="flex items-baseline justify-between text-xs text-muted">
      <span>{{ heading }}</span>
      <span v-if="songs.length">{{ songs.length }} 首</span>
    </div>

    <div v-if="loading && !songs.length" class="text-muted text-sm">加载中...</div>

    <ul
      v-if="songs.length && variant === 'row'"
      class="space-y-2"
    >
      <SongRow
        v-for="song in songs"
        :key="song.id"
        :song="song"
        :queued="queuedIds.has(song.id)"
        variant="row"
        @queue="(s) => add(s, false)"
        @top="(s) => add(s, true)"
      />
    </ul>

    <ul
      v-else-if="songs.length"
      class="grid gap-3"
      :class="gridClass"
    >
      <SongRow
        v-for="song in songs"
        :key="song.id"
        :song="song"
        :queued="queuedIds.has(song.id)"
        variant="card"
        @queue="(s) => add(s, false)"
        @top="(s) => add(s, true)"
      />
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
      <div class="text-xs">去 admin 页扫百度盘或导入本地 MKV</div>
    </div>
  </div>
</template>
