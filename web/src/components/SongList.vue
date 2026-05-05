<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { useRoute, useRouter, RouterLink } from "vue-router";
import { api, type Song } from "../lib/api";
import SongRow from "./SongRow.vue";
import PopularArtistsRail from "./PopularArtistsRail.vue";
void RouterLink; // referenced in template

const props = withDefaults(
  defineProps<{
    /** "row" for phone list, "card" for desktop grid */
    variant?: "row" | "card";
    /** Tailwind grid-cols class applied when variant=card */
    gridClass?: string;
    /** Limit for unfiltered (heat / search) view. Artist mode pulls full
        list regardless. */
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
const selectedArtist = ref<string | null>(null);
const portraitByArtist = ref<Map<string, string>>(new Map());
type SortMode = "popular" | "pinyin" | "length" | "year";
const sort = ref<SortMode>("popular");

async function loadPortraits() {
  try {
    const r = (await fetch("/api/artists").then((rr) => rr.json())) as {
      artists: Array<{ artist: string; portrait: string | null }>;
    };
    const map = new Map<string, string>();
    for (const a of r.artists) {
      if (a.portrait) map.set(a.artist, a.portrait);
    }
    portraitByArtist.value = map;
  } catch {
    /* not fatal */
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

watch(q, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => run(val), 150);
});

const route = useRoute();
const router = useRouter();

onMounted(async () => {
  // Honor ?artist=… in the URL so /artists or the rail can deep-link a filter.
  const fromUrl = (route.query.artist as string | undefined) ?? null;
  if (fromUrl) selectedArtist.value = fromUrl;
  await Promise.all([run(""), loadPortraits()]);
});

watch(
  () => route.query.artist,
  (v) => {
    const next = (v as string | undefined) ?? null;
    if (next !== selectedArtist.value) {
      selectedArtist.value = next;
      run("");
    }
  },
);

function extractYear(title: string): number {
  // Pull the first 4-digit substring in 1900-2099 from the title; songs
  // without an explicit year sink to the bottom (return 0 → asc) or top
  // (handled per direction outside).
  const m = title.match(/(19|20)\d{2}/);
  return m ? parseInt(m[0], 10) : 0;
}

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
    // In artist-filtered mode, pull EVERYTHING (capped at 5000) so the
    // sort order is meaningful and we don't truncate at 50. In free-text
    // search / heat mode, the prop limit still applies.
    const limitToUse = selectedArtist.value ? 5000 : props.limit;
    const res = await api.searchSongs(
      query.trim(),
      limitToUse,
      selectedArtist.value ?? undefined,
      sort.value,
    );
    let list = res.songs;
    // Year mode: backend returns pinyin order; we re-sort here using the
    // title regex (descending — newest songs first).
    if (sort.value === "year") {
      list = [...list].sort((a, b) => extractYear(b.title) - extractYear(a.title));
    }
    songs.value = list;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

watch(sort, () => run(q.value));

function selectArtist(name: string | null) {
  selectedArtist.value = selectedArtist.value === name ? null : name;
  q.value = "";
  // Default to pinyin order when entering artist mode (popularity sort
  // doesn't mean much within a single artist's discography).
  sort.value = selectedArtist.value ? "pinyin" : "popular";
  // Reflect the selection in the URL so it survives a refresh and the
  // browser history "back" button.
  const query = { ...route.query };
  if (selectedArtist.value) query.artist = selectedArtist.value;
  else delete query.artist;
  router.replace({ path: route.path, query });
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

    <PopularArtistsRail :size="variant === 'card' ? 'hero' : 'compact'" />

    <button
      v-if="selectedArtist"
      class="chip chip-active"
      @click="selectArtist(null)"
    >
      × 清除筛选 {{ selectedArtist }}
    </button>

    <div v-if="error" class="text-red-400 text-sm">{{ error }}</div>

    <div class="flex items-center justify-between text-xs gap-2 flex-wrap">
      <span class="text-white/60 font-medium">{{ heading }}</span>
      <div class="flex items-center gap-2">
        <select
          v-if="selectedArtist || q"
          v-model="sort"
          class="bg-elevated rounded px-2 py-1 text-[11px] text-muted border-0"
          title="排序"
        >
          <option value="popular">热度</option>
          <option value="pinyin">拼音</option>
          <option value="length">字数</option>
          <option value="year">年代</option>
        </select>
        <span v-if="songs.length" class="text-muted tabular-nums">
          {{ songs.length }} 首
        </span>
      </div>
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
        :artist-portrait="portraitByArtist.get(song.artist) ?? null"
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
        :artist-portrait="portraitByArtist.get(song.artist) ?? null"
        variant="card"
        @queue="(s) => add(s, false)"
        @top="(s) => add(s, true)"
      />
    </ul>

    <div
      v-else-if="!loading && q"
      class="text-center text-muted text-sm mt-12 space-y-2"
    >
      <div class="text-3xl">🤔</div>
      <div>没找到</div>
      <div class="text-xs">换个首字母试试，或者从上方筛选歌手</div>
    </div>

    <div
      v-else-if="!loading && !songs.length"
      class="text-center text-muted text-sm mt-12 space-y-2"
    >
      <div class="text-3xl">📀</div>
      <div>曲库还是空的</div>
      <div class="text-xs">
        去
        <RouterLink to="/admin" class="text-accent">管理页</RouterLink>
        扫百度盘或导入本地 MKV
      </div>
    </div>
  </div>
</template>
