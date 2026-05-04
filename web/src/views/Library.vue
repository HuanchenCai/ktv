<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch } from "vue";
import { onWs } from "../lib/ws";

type Stats = {
  total: number;
  cached: number;
  bytes: number;
  artist_count: number;
  by_lang: Array<{ lang: string; count: number }>;
  top_artists: Array<{ artist: string; count: number }>;
};
type Song = {
  id: number;
  title: string;
  artist: string;
  lang: string | null;
  pinyin: string;
  cached: 0 | 1;
  size_bytes: number | null;
  last_played_at: number | null;
  play_count: number;
};
type ScanProgress = {
  phase: "listing" | "indexing" | "done";
  current_dir?: string;
  files_seen: number;
  inserted: number;
  updated: number;
  skipped: number;
};
type ImportProgress = {
  phase: "listing" | "indexing" | "done";
  current_dir?: string;
  scanned: number;
  added: number;
  skipped: number;
};

const stats = ref<Stats | null>(null);
const songs = ref<Song[]>([]);
const totalRows = ref(0);
const page = ref(1);
const limit = ref(50);
const sort = ref<"id" | "title" | "artist" | "last_played_at" | "play_count" | "size_bytes">("id");
const order = ref<"asc" | "desc">("desc");
const filter = ref("");
const cachedOnly = ref(false);
const loading = ref(false);
const error = ref("");

const scanProgress = ref<ScanProgress | null>(null);
const importProgress = ref<ImportProgress | null>(null);
const scanning = ref(false);
const importing = ref(false);

async function loadStats() {
  try {
    stats.value = await fetch("/api/library/stats").then((r) => r.json());
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function loadSongs() {
  loading.value = true;
  error.value = "";
  const u = new URLSearchParams({
    page: String(page.value),
    limit: String(limit.value),
    sort: sort.value,
    order: order.value,
  });
  if (filter.value.trim()) u.set("filter", filter.value.trim());
  if (cachedOnly.value) u.set("cached_only", "1");
  try {
    const res = (await fetch(`/api/library/songs?${u}`).then((r) =>
      r.json(),
    )) as { songs: Song[]; total: number };
    songs.value = res.songs;
    totalRows.value = res.total;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function refreshAll() {
  await Promise.all([loadStats(), loadSongs()]);
}

let unsub: (() => void) | null = null;
onMounted(() => {
  refreshAll();
  unsub = onWs((m) => {
    if (m.type === "scan.progress") {
      scanProgress.value = m.payload as ScanProgress;
      scanning.value = scanProgress.value.phase !== "done";
      if (scanProgress.value.phase === "done") refreshAll();
    } else if (m.type === "import.progress") {
      importProgress.value = m.payload as ImportProgress;
      importing.value = importProgress.value.phase !== "done";
      if (importProgress.value.phase === "done") refreshAll();
    }
  });
});
onUnmounted(() => unsub?.());

let filterTimer: ReturnType<typeof setTimeout> | null = null;
watch(filter, () => {
  if (filterTimer) clearTimeout(filterTimer);
  filterTimer = setTimeout(() => {
    page.value = 1;
    loadSongs();
  }, 200);
});
watch([sort, order, page, cachedOnly, limit], () => loadSongs());

const totalPages = computed(() =>
  Math.max(1, Math.ceil(totalRows.value / limit.value)),
);

function setSort(s: typeof sort.value) {
  if (sort.value === s) {
    order.value = order.value === "asc" ? "desc" : "asc";
  } else {
    sort.value = s;
    order.value = "desc";
  }
}
function caret(s: typeof sort.value) {
  if (sort.value !== s) return "";
  return order.value === "asc" ? " ↑" : " ↓";
}
function fmtBytes(n: number | null): string {
  if (!n) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0,
    v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}
function fmtDate(ts: number | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString())
    return d.toTimeString().slice(0, 5);
  return d.toISOString().slice(0, 10);
}

async function startScan() {
  scanning.value = true;
  scanProgress.value = null;
  try {
    const res = await fetch("/api/admin/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }).then((r) => r.json());
    if (res.error) error.value = res.error;
  } finally {
    // WS will mark scanning false when phase=done
  }
}
async function startImport() {
  importing.value = true;
  importProgress.value = null;
  try {
    await fetch("/api/admin/import-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}
</script>

<template>
  <div class="p-4 lg:p-6 space-y-6">
    <h1 class="text-2xl font-bold">曲库</h1>

    <!-- STATS -->
    <div v-if="stats" class="grid gap-3 grid-cols-2 lg:grid-cols-4">
      <div class="card">
        <div class="text-xs text-muted">总歌数</div>
        <div class="text-3xl font-bold mt-1">{{ stats.total }}</div>
      </div>
      <div class="card">
        <div class="text-xs text-muted">已缓存</div>
        <div class="text-3xl font-bold mt-1">
          {{ stats.cached }}
          <span class="text-sm text-muted">/ {{ stats.total }}</span>
        </div>
      </div>
      <div class="card">
        <div class="text-xs text-muted">磁盘占用</div>
        <div class="text-3xl font-bold mt-1">{{ fmtBytes(stats.bytes) }}</div>
      </div>
      <div class="card">
        <div class="text-xs text-muted">歌手数</div>
        <div class="text-3xl font-bold mt-1">{{ stats.artist_count }}</div>
      </div>
    </div>

    <!-- TOP-N + LANG breakdown -->
    <div v-if="stats" class="grid gap-4 lg:grid-cols-2">
      <div class="card space-y-2">
        <h3 class="h-section">歌最多的歌手 Top 10</h3>
        <ul class="space-y-1.5">
          <li
            v-for="r in stats.top_artists"
            :key="r.artist"
            class="flex items-center justify-between text-sm"
          >
            <span class="truncate">{{ r.artist }}</span>
            <span class="text-muted text-xs ml-2 tabular-nums">{{ r.count }}</span>
          </li>
        </ul>
      </div>
      <div class="card space-y-2">
        <h3 class="h-section">语种分布</h3>
        <ul class="space-y-1.5">
          <li
            v-for="r in stats.by_lang"
            :key="r.lang"
            class="flex items-center justify-between text-sm"
          >
            <span>{{ r.lang }}</span>
            <span class="text-muted text-xs tabular-nums">{{ r.count }}</span>
          </li>
        </ul>
      </div>
    </div>

    <!-- ACTIONS -->
    <div class="card space-y-3">
      <h3 class="h-section">扫描入库</h3>
      <div class="flex flex-wrap gap-2">
        <button
          class="btn-primary text-sm"
          :disabled="scanning || importing"
          @click="startImport"
        >
          {{ importing ? "导入中..." : "📁 扫本地目录" }}
        </button>
        <button
          class="btn-ghost text-sm"
          :disabled="scanning || importing"
          @click="startScan"
        >
          {{ scanning ? "扫描中..." : "☁ 扫百度盘" }}
        </button>
      </div>
      <div
        v-if="importProgress && importing"
        class="text-xs text-muted space-y-1.5"
      >
        <div>{{ importProgress.phase === "listing" ? "枚举目录" : "入库" }}：扫 {{ importProgress.scanned }}，新增 {{ importProgress.added }}，跳过 {{ importProgress.skipped }}</div>
        <div v-if="importProgress.current_dir" class="truncate">
          {{ importProgress.current_dir }}
        </div>
      </div>
      <div
        v-if="scanProgress && scanning"
        class="text-xs text-muted space-y-1.5"
      >
        <div>{{ scanProgress.phase === "listing" ? "枚举目录" : "入库" }}：见 {{ scanProgress.files_seen }} 文件，新增 {{ scanProgress.inserted }}，更新 {{ scanProgress.updated }}</div>
        <div v-if="scanProgress.current_dir" class="truncate">
          {{ scanProgress.current_dir }}
        </div>
      </div>
    </div>

    <!-- TABLE -->
    <div class="card space-y-3 p-0 overflow-hidden">
      <div class="p-3 flex flex-wrap items-center gap-3 border-b border-border/60">
        <input
          v-model="filter"
          class="input flex-1 min-w-[200px]"
          placeholder="按 标题/歌手/拼音 过滤"
        />
        <label class="text-xs text-muted flex items-center gap-1.5">
          <input v-model="cachedOnly" type="checkbox" />
          只看已缓存
        </label>
        <select v-model="limit" class="bg-elevated rounded px-2 py-1.5 text-xs">
          <option :value="25">25/页</option>
          <option :value="50">50/页</option>
          <option :value="100">100/页</option>
          <option :value="200">200/页</option>
        </select>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-elevated/60 text-muted text-xs uppercase tracking-wider">
            <tr>
              <th class="px-3 py-2 text-left cursor-pointer" @click="setSort('title')">
                标题{{ caret('title') }}
              </th>
              <th class="px-3 py-2 text-left cursor-pointer" @click="setSort('artist')">
                歌手{{ caret('artist') }}
              </th>
              <th class="px-3 py-2 text-left">语种</th>
              <th
                class="px-3 py-2 text-right cursor-pointer"
                @click="setSort('size_bytes')"
              >
                大小{{ caret('size_bytes') }}
              </th>
              <th
                class="px-3 py-2 text-right cursor-pointer"
                @click="setSort('play_count')"
              >
                次数{{ caret('play_count') }}
              </th>
              <th
                class="px-3 py-2 text-right cursor-pointer"
                @click="setSort('last_played_at')"
              >
                最近{{ caret('last_played_at') }}
              </th>
              <th class="px-3 py-2 text-center">缓存</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="s in songs"
              :key="s.id"
              class="border-t border-border/40 hover:bg-panel-hover/40 transition-colors"
            >
              <td class="px-3 py-2 truncate max-w-[260px]">{{ s.title }}</td>
              <td class="px-3 py-2 truncate max-w-[160px]">{{ s.artist }}</td>
              <td class="px-3 py-2 text-muted">{{ s.lang ?? "—" }}</td>
              <td class="px-3 py-2 text-right text-muted tabular-nums">
                {{ fmtBytes(s.size_bytes) }}
              </td>
              <td class="px-3 py-2 text-right tabular-nums">{{ s.play_count }}</td>
              <td class="px-3 py-2 text-right text-muted text-xs tabular-nums">
                {{ fmtDate(s.last_played_at) }}
              </td>
              <td class="px-3 py-2 text-center">
                <span
                  v-if="s.cached"
                  class="text-emerald-400"
                  title="已缓存"
                >
                  ●
                </span>
                <span v-else class="text-muted/50" title="未缓存">○</span>
              </td>
            </tr>
            <tr v-if="!songs.length && !loading">
              <td colspan="7" class="text-center text-muted py-8 text-sm">
                没有匹配的歌
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- PAGER -->
      <div
        v-if="totalRows"
        class="p-3 flex items-center justify-between border-t border-border/60 text-xs text-muted"
      >
        <div class="tabular-nums">
          {{ (page - 1) * limit + 1 }}–{{ Math.min(page * limit, totalRows) }}
          / {{ totalRows }}
        </div>
        <div class="flex gap-1">
          <button
            class="btn-ghost px-2 py-1"
            :disabled="page <= 1"
            @click="page--"
          >
            上一页
          </button>
          <span class="self-center px-2 tabular-nums">
            {{ page }} / {{ totalPages }}
          </span>
          <button
            class="btn-ghost px-2 py-1"
            :disabled="page >= totalPages"
            @click="page++"
          >
            下一页
          </button>
        </div>
      </div>
    </div>

    <div v-if="error" class="text-rose-400 text-sm">{{ error }}</div>
  </div>
</template>
