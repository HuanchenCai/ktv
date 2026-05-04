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

type SortMode = "default" | "pinyin" | "chars" | "year";
const sortMode = ref<SortMode>("default");

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

// Year guess: pull a 4-digit 1900-2039 year out of the title if present.
// Many KTV releases stamp the year inside parens — `(2003)`, `(2008演唱会)`,
// `2000年` etc. Returns 0 when nothing matches so those songs sort to the bottom.
function yearOf(s: Song): number {
  const m = s.title.match(/(?<![0-9])(19[0-9]{2}|20[0-3][0-9])(?![0-9])/);
  return m ? parseInt(m[1], 10) : 0;
}
// Real character count (Array.from handles surrogate pairs / CJK correctly).
function charCount(t: string): number {
  return Array.from(t).length;
}

const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return songs.value;
  return songs.value.filter(
    (s) =>
      s.title.toLowerCase().includes(q) ||
      s.pinyin.toLowerCase().includes(q),
  );
});

// Plain ASCII / lowercase byte comparison — produces "dx" < "rgmtsjmr" < "zyn"
// reliably across browsers. localeCompare can return surprising orderings
// for short strings under some locales; this is the dumb-correct version.
function byPinyin(a: Song, b: Song): number {
  const pa = (a.pinyin ?? "").toLowerCase();
  const pb = (b.pinyin ?? "").toLowerCase();
  if (pa === pb) return 0;
  return pa < pb ? -1 : 1;
}

const sorted = computed(() => {
  const arr = [...filtered.value];
  if (sortMode.value === "pinyin") {
    arr.sort(byPinyin);
  } else if (sortMode.value === "chars") {
    arr.sort(
      (a, b) =>
        charCount(a.title) - charCount(b.title) || byPinyin(a, b),
    );
  } else if (sortMode.value === "year") {
    arr.sort((a, b) => {
      const ya = yearOf(a);
      const yb = yearOf(b);
      // Newer first; songs with no year guess to the bottom
      if (ya === 0 && yb === 0) return byPinyin(a, b);
      if (ya === 0) return 1;
      if (yb === 0) return -1;
      return yb - ya;
    });
  }
  return arr;
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
    <div class="flex items-baseline justify-between gap-3 flex-wrap">
      <h3 class="text-lg font-semibold">
        <span>{{ artist }}</span>
        <span class="text-sm text-muted ml-2">{{ total }} 首</span>
      </h3>
      <div class="flex items-center gap-2">
        <select
          v-model="sortMode"
          class="bg-elevated border border-border rounded-lg px-2.5 py-1.5 text-xs text-white/90 outline-none focus:ring-2 focus:ring-accent"
          title="排序"
        >
          <option value="default">默认（标题）</option>
          <option value="pinyin">拼音</option>
          <option value="chars">字数（短→长）</option>
          <option value="year">年代（新→老）</option>
        </select>
        <input
          v-model="filter"
          class="input !py-1.5 !px-3 text-sm w-40 lg:w-48"
          placeholder="过滤..."
          spellcheck="false"
        />
      </div>
    </div>

    <div v-if="loading" class="text-sm text-muted">加载中...</div>

    <ul
      v-if="sorted.length"
      class="grid grid-cols-1 lg:grid-cols-2 gap-x-4 gap-y-0.5"
    >
      <li
        v-for="(s, i) in sorted"
        :key="s.id"
        class="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-panel-hover/60 transition-colors"
      >
        <span
          class="text-xs text-muted/70 font-mono w-7 text-right tabular-nums shrink-0"
        >
          {{ i + 1 }}
        </span>
        <div class="flex-1 min-w-0">
          <div class="truncate text-sm">{{ s.title }}</div>
          <div
            v-if="s.lang || s.genre || (sortMode === 'year' && yearOf(s))"
            class="text-[11px] text-muted truncate"
          >
            <span v-if="sortMode === 'year' && yearOf(s)">{{ yearOf(s) }}</span>
            <span
              v-if="sortMode === 'year' && yearOf(s) && (s.lang || s.genre)"
            > · </span>
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
