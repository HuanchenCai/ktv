<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { api, type Song } from "../lib/api";

const PAGE_SIZE = 50;

// --- Search state ---------------------------------------------------------
const q = ref("");
const songs = ref<Song[]>([]);
const total = ref(0);
const loading = ref(false);
const error = ref("");
const queuedIds = ref<Set<number>>(new Set());

const batchMode = ref(false);
const selectedIds = ref<Set<number>>(new Set());
const submitting = ref(false);
const flash = ref("");

// --- Artist state --------------------------------------------------------
type Artist = { artist: string; count: number; cached_count: number };
const artists = ref<Artist[]>([]);
const artistTotal = ref(0);
const artistLoading = ref(false);
const focusedArtist = ref<string | null>(null);

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let activeRequestId = 0;
const sentinelRef = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;
const artistSentinelRef = ref<HTMLElement | null>(null);
let artistObserver: IntersectionObserver | null = null;

watch(q, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => firstPage(val), 200);
});

onMounted(() => {
  firstPage("");
  loadArtists("", 0);
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) loadMore();
    },
    { rootMargin: "300px" },
  );
  artistObserver = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) loadMoreArtists();
    },
    { rootMargin: "300px" },
  );
  watch(sentinelRef, (el, oldEl) => {
    if (oldEl) observer?.unobserve(oldEl);
    if (el) observer?.observe(el);
  });
  watch(artistSentinelRef, (el, oldEl) => {
    if (oldEl) artistObserver?.unobserve(oldEl);
    if (el) artistObserver?.observe(el);
  });
});

onUnmounted(() => {
  observer?.disconnect();
  artistObserver?.disconnect();
});

// --- Search logic --------------------------------------------------------

async function firstPage(query: string) {
  const reqId = ++activeRequestId;
  loading.value = true;
  error.value = "";
  // If user types, drop artist filter
  if (focusedArtist.value && query !== focusedArtist.value) {
    focusedArtist.value = null;
  }
  try {
    const res = await api.searchSongs(query.trim(), PAGE_SIZE, 0);
    if (reqId !== activeRequestId) return;
    songs.value = res.songs;
    total.value = res.total;
    selectedIds.value = new Set();
  } catch (err) {
    if (reqId !== activeRequestId) return;
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    if (reqId === activeRequestId) loading.value = false;
  }
}

async function loadMore() {
  if (loading.value) return;
  if (songs.value.length >= total.value) return;
  const reqId = activeRequestId;
  loading.value = true;
  try {
    const res = await api.searchSongs(
      q.value.trim(),
      PAGE_SIZE,
      songs.value.length,
    );
    if (reqId !== activeRequestId) return;
    const seen = new Set(songs.value.map((s) => s.id));
    for (const s of res.songs) if (!seen.has(s.id)) songs.value.push(s);
    total.value = res.total;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

// --- Artist logic --------------------------------------------------------

async function loadArtists(query: string, offset: number) {
  if (artistLoading.value) return;
  artistLoading.value = true;
  try {
    const res = await api.listArtists({ q: query, limit: 60, offset });
    if (offset === 0) {
      artists.value = res.artists;
    } else {
      const seen = new Set(artists.value.map((a) => a.artist));
      for (const a of res.artists)
        if (!seen.has(a.artist)) artists.value.push(a);
    }
    artistTotal.value = res.total;
  } catch (err) {
    /* surfaces in error */
  } finally {
    artistLoading.value = false;
  }
}
async function loadMoreArtists() {
  if (artists.value.length >= artistTotal.value) return;
  await loadArtists("", artists.value.length);
}

function focusArtist(a: Artist) {
  // Filter songs panel to this artist; keep search box visually clean.
  focusedArtist.value = a.artist;
  q.value = a.artist;
  // searchSongs's like-match on artist will pull this in; firstPage runs via watch.
}

async function downloadArtist(a: Artist) {
  if (a.count === a.cached_count) {
    flash.value = `${a.artist} 全部已下载`;
    return;
  }
  submitting.value = true;
  flash.value = "";
  try {
    // Pull all songs for this artist (paginated to be safe)
    const all: Song[] = [];
    let offset = 0;
    while (true) {
      const res = await api.searchSongs(a.artist, 500, offset);
      const matching = res.songs.filter((s) => s.artist === a.artist);
      all.push(...matching);
      if (matching.length === 0 || res.songs.length < 500) break;
      offset += res.songs.length;
      if (offset > 5000) break; // safety
    }
    const ids = all.filter((s) => !s.cached).map((s) => s.id);
    if (ids.length === 0) {
      flash.value = `${a.artist} 全部已下载`;
      return;
    }
    if (
      !confirm(
        `${a.artist} 共 ${all.length} 首,${ids.length} 首未下载。全部下载?`,
      )
    ) {
      return;
    }
    const r = await api.downloadBatch(ids);
    flash.value = `${a.artist}:加入下载队列 ${r.enqueued} 首`;
    // refresh artist count after a beat
    setTimeout(() => loadArtists("", 0), 1500);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    submitting.value = false;
  }
}

// --- Song actions --------------------------------------------------------

async function add(song: Song, top = false) {
  queuedIds.value.add(song.id);
  try {
    await api.enqueue(song.id, { top });
  } catch (err) {
    queuedIds.value.delete(song.id);
    error.value = err instanceof Error ? err.message : String(err);
  }
}

const uncached = computed(() => songs.value.filter((s) => !s.cached));

function toggleBatch() {
  batchMode.value = !batchMode.value;
  if (!batchMode.value) selectedIds.value.clear();
}
function toggleSelect(id: number) {
  if (selectedIds.value.has(id)) selectedIds.value.delete(id);
  else selectedIds.value.add(id);
}
function selectAllUncachedLoaded() {
  for (const s of uncached.value) selectedIds.value.add(s.id);
}
function clearSelection() {
  selectedIds.value.clear();
}
async function downloadSelected() {
  if (selectedIds.value.size === 0) return;
  submitting.value = true;
  flash.value = "";
  try {
    const r = await api.downloadBatch([...selectedIds.value]);
    flash.value = `已加入下载队列:${r.enqueued} 首`;
    selectedIds.value.clear();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    submitting.value = false;
  }
}
async function downloadAllMatching() {
  if (!q.value.trim()) return;
  submitting.value = true;
  flash.value = "";
  try {
    const all: Song[] = [];
    let offset = 0;
    while (true) {
      const res = await api.searchSongs(q.value.trim(), 500, offset);
      all.push(...res.songs);
      if (all.length >= res.total || res.songs.length === 0) break;
      offset += res.songs.length;
    }
    const ids = all.filter((s) => !s.cached).map((s) => s.id);
    if (ids.length === 0) {
      flash.value = "全部已下载";
      return;
    }
    if (!confirm(`共 ${all.length} 首,${ids.length} 首未下载。全部下载?`)) return;
    const r = await api.downloadBatch(ids);
    flash.value = `加入下载队列 ${r.enqueued} 首`;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="p-4">
    <!-- 桌面双列(md+),手机单列 -->
    <div class="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-4">
      <!-- 左侧:搜索 + 结果 -->
      <section class="space-y-3 min-w-0">
        <input
          v-model="q"
          class="input"
          placeholder="拼音首字母搜歌,例:zyn"
          autofocus
          autocomplete="off"
          spellcheck="false"
          inputmode="search"
        />

        <div class="flex flex-wrap items-center gap-2 text-xs">
          <button
            class="btn-ghost px-3 py-1"
            :class="{ 'bg-blue-600 text-white': batchMode }"
            @click="toggleBatch"
          >
            {{ batchMode ? "退出批量" : "批量模式" }}
          </button>
          <template v-if="batchMode">
            <button class="btn-ghost px-3 py-1" @click="selectAllUncachedLoaded">
              全选当前 ({{ uncached.length }})
            </button>
            <button
              v-if="selectedIds.size"
              class="btn-ghost px-3 py-1"
              @click="clearSelection"
            >
              清空
            </button>
            <button
              class="btn-primary px-3 py-1"
              :disabled="!selectedIds.size || submitting"
              @click="downloadSelected"
            >
              下载选中 ({{ selectedIds.size }})
            </button>
          </template>
          <button
            v-if="q.trim()"
            class="btn-ghost px-3 py-1"
            :disabled="submitting"
            @click="downloadAllMatching"
          >
            全部下载({{ total }})↓
          </button>
          <span v-if="flash" class="text-green-400">{{ flash }}</span>
        </div>

        <div v-if="error" class="text-red-400 text-sm">{{ error }}</div>

        <div class="flex items-baseline justify-between text-xs text-muted">
          <span>
            {{ focusedArtist ? "歌手:" + focusedArtist : q.trim() ? "搜索 " + q : "热门" }}
          </span>
          <span v-if="total">{{ songs.length }} / {{ total }} 首</span>
        </div>

        <div v-if="loading && !songs.length" class="text-muted text-sm">
          加载中...
        </div>

        <ul
          v-if="songs.length"
          class="grid grid-cols-1 lg:grid-cols-2 gap-2"
        >
          <li
            v-for="song in songs"
            :key="song.id"
            class="card flex items-center gap-3"
          >
            <input
              v-if="batchMode"
              type="checkbox"
              :disabled="!!song.cached"
              :checked="selectedIds.has(song.id)"
              @change="toggleSelect(song.id)"
              class="shrink-0 w-4 h-4"
            />
            <div class="flex-1 min-w-0">
              <div class="truncate">{{ song.title }}</div>
              <div class="text-xs text-muted truncate">
                {{ song.artist }}
                <span v-if="song.lang"> · {{ song.lang }}</span>
                <span v-if="song.cached" class="text-green-400"> · 已缓存</span>
              </div>
            </div>
            <div v-if="!batchMode" class="flex flex-col gap-1 shrink-0">
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
          v-if="songs.length && songs.length < total"
          ref="sentinelRef"
          class="text-center text-xs text-muted py-4"
        >
          {{ loading ? "加载中..." : "下拉加载更多" }}
        </div>
        <div
          v-else-if="songs.length && songs.length >= total && total > PAGE_SIZE"
          class="text-center text-xs text-muted py-4"
        >
          已显示全部 {{ total }} 首
        </div>
      </section>

      <!-- 右侧:歌手列表 -->
      <aside class="space-y-3 min-w-0">
        <div class="flex items-baseline justify-between">
          <h2 class="font-semibold">歌手</h2>
          <span class="text-xs text-muted">{{ artistTotal }} 位</span>
        </div>
        <ul class="space-y-1.5">
          <li
            v-for="a in artists"
            :key="a.artist"
            class="card flex items-center gap-2 cursor-pointer"
            :class="{ 'ring-1 ring-accent': focusedArtist === a.artist }"
            @click="focusArtist(a)"
          >
            <div class="flex-1 min-w-0">
              <div class="truncate">{{ a.artist }}</div>
              <div class="text-xs text-muted">
                {{ a.count }} 首
                <span v-if="a.cached_count > 0" class="text-green-400">
                  · 已下 {{ a.cached_count }}
                </span>
              </div>
            </div>
            <button
              class="btn-ghost text-xs px-2 py-1 shrink-0"
              :disabled="submitting || a.cached_count === a.count"
              @click.stop="downloadArtist(a)"
            >
              {{ a.cached_count === a.count ? "✓" : "全下" }}
            </button>
          </li>
        </ul>
        <div
          v-if="artists.length && artists.length < artistTotal"
          ref="artistSentinelRef"
          class="text-center text-xs text-muted py-2"
        >
          {{ artistLoading ? "..." : "加载更多" }}
        </div>
      </aside>
    </div>
  </div>
</template>
