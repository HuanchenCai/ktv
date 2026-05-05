<script setup lang="ts">
import { ref, watch, onMounted, computed } from "vue";
import { useRoute, useRouter, RouterLink } from "vue-router";
import { api, type Song } from "../lib/api";
import SongRow from "./SongRow.vue";
import PopularArtistsRail from "./PopularArtistsRail.vue";
void RouterLink; // referenced in template

type ArtistRow = { artist: string; count: number; portrait: string | null };

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
// "popular" = heat list with rail; "artists" = grid of artists (tap one
// to drill into their songs). Lets the user pick a singer first instead
// of always landing on the heat list. Persisted in URL ?mode= so the
// browser back button works.
type ListMode = "popular" | "artists";
const mode = ref<ListMode>("popular");
const artists = ref<ArtistRow[]>([]);
const artistsLoading = ref(false);

// Stable for the lifetime of the page — used to gate desktop-only UI hints
// (e.g. "go to admin" links). The route guard already prevents phones
// from actually navigating to /admin, this just hides the dangling link.
const isDesktop =
  typeof window !== "undefined" && window.innerWidth >= 1024;

const hasQuery = computed(() => q.value.trim().length > 0);
const showRail = computed(
  // Hide the popular-artists rail once the user is actively searching
  // (input non-empty) or has drilled into a single artist — the screen
  // should be all results, no decoration. Also hide it in "artists"
  // mode where the whole grid IS the artist picker.
  () => mode.value === "popular" && !hasQuery.value && !selectedArtist.value,
);

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

async function loadArtists() {
  artistsLoading.value = true;
  try {
    const u = new URLSearchParams({
      limit: "300",
      // Same min_count default as /artists page; cuts filename-parsed
      // junk artists (~25k single-song noise rows) out.
      min_count: "2",
    });
    if (q.value.trim()) u.set("q", q.value.trim());
    const res = (await fetch(`/api/artists?${u}`).then((r) => r.json())) as {
      artists: ArtistRow[];
    };
    artists.value = res.artists ?? [];
  } catch {
    /* not fatal */
  } finally {
    artistsLoading.value = false;
  }
}

function setMode(m: ListMode) {
  if (mode.value === m) return;
  mode.value = m;
  selectedArtist.value = null;
  q.value = "";
  const query = { ...route.query };
  if (m === "artists") query.mode = "artists";
  else delete query.mode;
  delete query.artist;
  router.replace({ path: route.path, query });
  if (m === "artists") loadArtists();
  else run("");
}

function colorFor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  const hues = [340, 200, 160, 280, 30, 0, 220, 50, 100, 320];
  return `hsl(${hues[Math.abs(h) % hues.length]}, 60%, 22%)`;
}

onMounted(async () => {
  // Honor ?artist=… and ?mode= in the URL so /artists or the rail can
  // deep-link a filter and the back button restores the current view.
  const fromUrl = (route.query.artist as string | undefined) ?? null;
  if (fromUrl) selectedArtist.value = fromUrl;
  if (route.query.mode === "artists") mode.value = "artists";
  await Promise.all([run(""), loadPortraits()]);
  if (mode.value === "artists" && !selectedArtist.value) loadArtists();
});

// In "artists" mode (no specific artist selected), q reloads the artist
// grid; in song-list mode, q is the song text search.
let artistDebounce: ReturnType<typeof setTimeout> | null = null;
watch(q, () => {
  if (mode.value !== "artists" || selectedArtist.value) return;
  if (artistDebounce) clearTimeout(artistDebounce);
  artistDebounce = setTimeout(loadArtists, 200);
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
    songs.value = res.songs;
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
  if (selectedArtist.value) {
    run("");
  } else if (mode.value === "artists") {
    // Backed out of an artist while in the artist-grid mode → show the
    // grid again instead of running a song search.
    loadArtists();
  } else {
    run("");
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
  <div class="space-y-3">
    <!-- Mode toggle: heat list with rail vs artist-first grid. -->
    <div class="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-elevated/60">
      <button
        class="py-2 text-sm rounded-lg transition-colors"
        :class="
          mode === 'popular'
            ? 'bg-accent text-white shadow'
            : 'text-muted hover:text-white'
        "
        @click="setMode('popular')"
      >
        🔥 热门
      </button>
      <button
        class="py-2 text-sm rounded-lg transition-colors"
        :class="
          mode === 'artists'
            ? 'bg-accent text-white shadow'
            : 'text-muted hover:text-white'
        "
        @click="setMode('artists')"
      >
        🎤 按歌手
      </button>
    </div>

    <input
      v-model="q"
      class="input"
      :placeholder="
        mode === 'artists' && !selectedArtist
          ? '搜歌手名或拼音首字母'
          : '拼音首字母搜歌，例：zyn'
      "
      autocomplete="off"
      spellcheck="false"
      inputmode="search"
    />

    <!-- Rail only on popular mode without active query/filter; gets in
         the way when the user is actively searching or drilling. -->
    <PopularArtistsRail
      v-if="showRail"
      :size="variant === 'card' ? 'hero' : 'compact'"
    />

    <button
      v-if="selectedArtist"
      class="chip chip-active"
      @click="selectArtist(null)"
    >
      × 清除筛选 {{ selectedArtist }}
    </button>

    <div v-if="error" class="text-red-400 text-sm">{{ error }}</div>

    <div
      v-if="mode !== 'artists' || selectedArtist"
      class="flex items-center justify-between text-xs gap-2 flex-wrap"
    >
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

    <!-- Artist grid (only in "artists" mode without a chosen artist).
         Tapping one drills into selectedArtist and the grid hides. -->
    <div
      v-if="mode === 'artists' && !selectedArtist"
      class="grid gap-3 grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6"
    >
      <button
        v-for="row in artists"
        :key="row.artist"
        class="group flex flex-col items-center text-center gap-2 p-2 rounded-xl hover:bg-panel-hover transition-colors"
        @click="selectArtist(row.artist)"
      >
        <div
          class="w-16 h-16 lg:w-20 lg:h-20 rounded-full overflow-hidden ring-1 ring-border group-hover:ring-accent transition-all"
          :style="!row.portrait ? { background: colorFor(row.artist) } : undefined"
        >
          <img
            v-if="row.portrait"
            :src="row.portrait"
            :alt="row.artist"
            class="w-full h-full object-cover"
            loading="lazy"
          />
          <div
            v-else
            class="w-full h-full grid place-items-center text-xl font-bold text-white/90"
          >
            {{ row.artist[0] }}
          </div>
        </div>
        <div class="font-medium text-xs leading-tight truncate w-full">
          {{ row.artist }}
        </div>
        <div class="text-[10px] text-muted">{{ row.count }} 首</div>
      </button>
      <div
        v-if="!artists.length && !artistsLoading"
        class="col-span-full text-center text-muted text-sm py-8"
      >
        没找到
      </div>
    </div>

    <ul
      v-if="(mode !== 'artists' || selectedArtist) && songs.length && variant === 'row'"
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
      v-else-if="(mode !== 'artists' || selectedArtist) && songs.length"
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
      v-else-if="(mode !== 'artists' || selectedArtist) && !loading && q"
      class="text-center text-muted text-sm mt-12 space-y-2"
    >
      <div class="text-3xl">🤔</div>
      <div>没找到</div>
      <div class="text-xs">换个首字母试试，或者从上方筛选歌手</div>
    </div>

    <div
      v-else-if="(mode !== 'artists' || selectedArtist) && !loading && !songs.length"
      class="text-center text-muted text-sm mt-12 space-y-2"
    >
      <div class="text-3xl">📀</div>
      <div>曲库还是空的</div>
      <div v-if="isDesktop" class="text-xs">
        去
        <RouterLink to="/admin" class="text-accent">管理页</RouterLink>
        扫百度盘或导入本地 MKV
      </div>
      <div v-else class="text-xs">联系主人去电脑端导入歌曲</div>
    </div>
  </div>
</template>
