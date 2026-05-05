<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch } from "vue";
import { onWs } from "../lib/ws";
import { api } from "../lib/api";

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
type BaiduScanProgress = {
  phase: "listing" | "indexing" | "done" | "failed";
  current_dir: string | null;
  dirs: number;
  inserted: number;
  updated: number;
  skipped: number;
  error?: string | null;
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

// Baidu scan
const baiduProgress = ref<BaiduScanProgress | null>(null);
const baiduScanning = ref(false);
const baiduRoot = ref("/KTV");

// Selection / batch download
const selected = ref<Set<number>>(new Set());
const downloading = ref(false);

// Dedupe
type DedupeResult = {
  dry_run: boolean;
  groups_with_dupes: number | string;
  candidates_to_delete: number;
  deleted: number;
  sample: Array<{
    kept: { id: number; title: string; artist: string };
    removed: Array<{ id: number; title: string; artist: string }>;
  }>;
};
const dedupePreview = ref<DedupeResult | null>(null);
const dedupeBusy = ref(false);

// Re-parse filenames (after parser bugfix)
type ReparseResult = {
  dry_run: boolean;
  scanned: number;
  changed: number;
  sample: Array<{
    id: number;
    before: { title: string; artist: string };
    after: { title: string; artist: string };
  }>;
};
const reparsePreview = ref<ReparseResult | null>(null);
const reparseBusy = ref(false);

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
    } else if (m.type === "baidu-scan.progress") {
      baiduProgress.value = m.payload as BaiduScanProgress;
      baiduScanning.value =
        baiduProgress.value.phase !== "done" &&
        baiduProgress.value.phase !== "failed";
      if (baiduProgress.value.phase === "done") refreshAll();
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

async function startBaiduScan() {
  baiduScanning.value = true;
  baiduProgress.value = null;
  error.value = "";
  try {
    await api.baiduScan({ root: baiduRoot.value });
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    baiduScanning.value = false;
  }
}

async function abortBaiduScan() {
  try {
    await api.baiduScanAbort();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

function toggleSelected(id: number) {
  const s = new Set(selected.value);
  if (s.has(id)) s.delete(id);
  else s.add(id);
  selected.value = s;
}

function toggleSelectAllVisible() {
  const allVisible = songs.value.every((s) => selected.value.has(s.id));
  const next = new Set(selected.value);
  if (allVisible) {
    for (const s of songs.value) next.delete(s.id);
  } else {
    for (const s of songs.value) if (!s.cached) next.add(s.id);
  }
  selected.value = next;
}

function clearSelection() {
  selected.value = new Set();
}

const selectedNotCachedCount = computed(() => {
  let n = 0;
  for (const s of songs.value) {
    if (s.cached) continue;
    if (selected.value.has(s.id)) n++;
  }
  return n;
});

async function reparsePreviewRun() {
  reparseBusy.value = true;
  error.value = "";
  try {
    reparsePreview.value = await api.reparseFilenames(false);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    reparseBusy.value = false;
  }
}
async function reparseApply() {
  if (!reparsePreview.value) return;
  if (
    !confirm(
      `确认按新解析规则重写 ${reparsePreview.value.changed} 行？此操作覆盖 title/artist/拼音。`,
    )
  )
    return;
  reparseBusy.value = true;
  try {
    reparsePreview.value = await api.reparseFilenames(true);
    await refreshAll();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    reparseBusy.value = false;
  }
}

async function dedupePreviewRun() {
  dedupeBusy.value = true;
  error.value = "";
  try {
    dedupePreview.value = await api.dedupe(false);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    dedupeBusy.value = false;
  }
}
async function dedupeApply() {
  if (!dedupePreview.value) return;
  if (
    !confirm(
      `确认删除 ${dedupePreview.value.candidates_to_delete} 个重复条目? 仅删除数据库行，不动磁盘文件。`,
    )
  )
    return;
  dedupeBusy.value = true;
  try {
    dedupePreview.value = await api.dedupe(true);
    await refreshAll();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    dedupeBusy.value = false;
  }
}

async function downloadSelected() {
  // Only send the songs that are not yet cached.
  const ids = songs.value
    .filter((s) => !s.cached && selected.value.has(s.id))
    .map((s) => s.id);
  if (ids.length === 0) return;
  downloading.value = true;
  error.value = "";
  try {
    await api.downloadBatch(ids);
    // Don't clear selection — user might want to add more
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    downloading.value = false;
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

    <!-- ACTIONS — local scan only. Baidu scan is in its own card below
         (the BDUSS-direct path). The old OpenList-based Baidu scan
         button was removed: it duplicates the same feature with a
         flakier code path and confused the UI. -->
    <div class="card space-y-3">
      <h3 class="h-section">扫描入库</h3>
      <div class="flex flex-wrap gap-2">
        <button
          class="btn-primary text-sm"
          :disabled="scanning || importing || baiduScanning"
          @click="startImport"
        >
          {{ importing ? "导入中..." : "📁 扫本地目录" }}
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
    </div>

    <!-- RE-PARSE FILENAMES -->
    <div class="card space-y-3">
      <div class="flex items-baseline justify-between">
        <h3 class="h-section">重跑文件名解析</h3>
        <span class="text-xs text-muted">
          parser 修过 bug 后用这个重写已入库行的 title/artist，不用重扫硬盘
        </span>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          class="btn-ghost text-sm"
          :disabled="reparseBusy"
          @click="reparsePreviewRun"
        >
          {{ reparseBusy ? "扫描中..." : "🔍 预览改动" }}
        </button>
        <button
          v-if="reparsePreview && reparsePreview.changed > 0 && reparsePreview.dry_run"
          class="btn-primary text-sm"
          :disabled="reparseBusy"
          @click="reparseApply"
        >
          ✏ 应用 {{ reparsePreview.changed }} 行改动
        </button>
      </div>
      <div v-if="reparsePreview" class="text-xs text-muted space-y-2">
        <div>
          扫描: {{ reparsePreview.scanned }} · 待改动:
          {{ reparsePreview.changed }}
          <span v-if="!reparsePreview.dry_run" class="text-emerald-400">
            · 已应用
          </span>
          <span v-else class="text-amber-400">· 仅预览</span>
        </div>
        <div
          v-if="reparsePreview.sample.length"
          class="space-y-1 max-h-60 overflow-y-auto"
        >
          <div
            v-for="r in reparsePreview.sample"
            :key="r.id"
            class="border-l-2 border-amber-500/40 pl-2"
          >
            <div class="text-rose-300/70 truncate">
              旧: {{ r.before.artist }} - {{ r.before.title }}
            </div>
            <div class="text-emerald-300 truncate">
              新: {{ r.after.artist }} - {{ r.after.title }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- DEDUPE -->
    <div class="card space-y-3">
      <div class="flex items-baseline justify-between">
        <h3 class="h-section">查重 / 去重</h3>
        <span class="text-xs text-muted">
          按 (歌手 + 规整后的歌名) 合并；MV/演唱会版/Live 视为不同变体保留
        </span>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          class="btn-ghost text-sm"
          :disabled="dedupeBusy"
          @click="dedupePreviewRun"
        >
          {{ dedupeBusy ? "扫描中..." : "🔍 预览重复" }}
        </button>
        <button
          v-if="dedupePreview && dedupePreview.candidates_to_delete > 0"
          class="btn-primary text-sm"
          :disabled="dedupeBusy"
          @click="dedupeApply"
        >
          ✂ 删除 {{ dedupePreview.candidates_to_delete }} 个重复
        </button>
      </div>
      <div v-if="dedupePreview" class="text-xs text-muted space-y-2">
        <div>
          重复组: {{ dedupePreview.groups_with_dupes }} · 待删除:
          {{ dedupePreview.candidates_to_delete }}
          <span v-if="dedupePreview.deleted > 0" class="text-emerald-400">
            · 已删除 {{ dedupePreview.deleted }}
          </span>
          <span v-if="dedupePreview.dry_run" class="text-amber-400">
            · 仅预览
          </span>
        </div>
        <div
          v-if="dedupePreview.sample.length"
          class="space-y-1 max-h-60 overflow-y-auto"
        >
          <div
            v-for="(g, i) in dedupePreview.sample"
            :key="i"
            class="border-l-2 border-emerald-500/50 pl-2"
          >
            <div class="text-emerald-300 truncate">
              保留 #{{ g.kept.id }} {{ g.kept.artist }} - {{ g.kept.title }}
            </div>
            <div
              v-for="r in g.removed"
              :key="r.id"
              class="text-rose-300/70 truncate pl-3"
            >
              ✗ #{{ r.id }} {{ r.artist }} - {{ r.title }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- BAIDU DIRECT SCAN -->
    <div class="card space-y-3">
      <div class="flex items-baseline justify-between">
        <h3 class="h-section">百度盘扫描（直连 / BDUSS）</h3>
        <span class="text-xs text-muted">
          扫完会在曲库里多出 cached=0 的占位条目，点歌时会自动下载
        </span>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <label class="text-xs text-muted shrink-0">起始路径:</label>
        <input
          v-model="baiduRoot"
          class="input !py-1.5 !px-3 text-sm w-48"
          placeholder="/KTV"
          spellcheck="false"
        />
        <button
          class="btn-primary text-sm"
          :disabled="baiduScanning || scanning || importing"
          @click="startBaiduScan"
        >
          {{ baiduScanning ? "扫描中..." : "☁ 开始扫描百度盘" }}
        </button>
        <button
          v-if="baiduScanning"
          class="btn-ghost text-xs"
          @click="abortBaiduScan"
        >
          中止
        </button>
      </div>
      <div
        v-if="baiduProgress"
        class="text-xs space-y-1.5"
        :class="baiduProgress.phase === 'failed' ? 'text-rose-400' : 'text-muted'"
      >
        <div>
          阶段:
          {{
            baiduProgress.phase === "listing"
              ? "列目录"
              : baiduProgress.phase === "indexing"
                ? "入库"
                : baiduProgress.phase === "failed"
                  ? "失败"
                  : "完成"
          }}
          · 目录 {{ baiduProgress.dirs }} · 新增 {{ baiduProgress.inserted }}
          · 更新 {{ baiduProgress.updated }} · 跳过
          {{ baiduProgress.skipped }}
        </div>
        <div v-if="baiduProgress.current_dir" class="truncate">
          {{ baiduProgress.current_dir }}
        </div>
        <div v-if="baiduProgress.error" class="text-rose-400 break-all">
          错误: {{ baiduProgress.error }}
        </div>
      </div>
    </div>

    <!-- SELECTION TOOLBAR -->
    <div
      v-if="selected.size > 0"
      class="card flex items-center justify-between gap-3 ring-1 ring-accent/40 bg-accent/5"
    >
      <div class="text-sm">
        已选 <span class="font-bold text-accent">{{ selected.size }}</span>
        首
        <span class="text-xs text-muted">
          （其中 {{ selectedNotCachedCount }} 首未缓存可下载）
        </span>
      </div>
      <div class="flex gap-2">
        <button
          class="btn-primary text-sm"
          :disabled="downloading || selectedNotCachedCount === 0"
          @click="downloadSelected"
        >
          {{ downloading ? "提交中..." : `下载选中 (${selectedNotCachedCount})` }}
        </button>
        <button class="btn-ghost text-sm" @click="clearSelection">
          清除选择
        </button>
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
              <th class="px-3 py-2 w-10 text-center">
                <input
                  type="checkbox"
                  :checked="
                    songs.length > 0 &&
                    songs.every((s) => selected.has(s.id))
                  "
                  :indeterminate.prop="
                    songs.some((s) => selected.has(s.id)) &&
                    !songs.every((s) => selected.has(s.id))
                  "
                  title="全选/全不选（仅未缓存会进入下载）"
                  @change="toggleSelectAllVisible"
                />
              </th>
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
              :class="selected.has(s.id) ? 'bg-accent/5' : ''"
            >
              <td class="px-3 py-2 text-center">
                <input
                  type="checkbox"
                  :checked="selected.has(s.id)"
                  :title="s.cached ? '已缓存（无需下载，但可选）' : '选中以批量下载'"
                  @change="toggleSelected(s.id)"
                />
              </td>
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
              <td colspan="8" class="text-center text-muted py-8 text-sm">
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
