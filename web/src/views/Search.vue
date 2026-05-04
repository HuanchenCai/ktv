<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api, type Song } from "../lib/api";

const q = ref("");
const loading = ref(false);
const songs = ref<Song[]>([]);
const error = ref("");
const queuedIds = ref<Set<number>>(new Set());
const heading = ref("热门");

// Batch-download mode
const batchMode = ref(false);
const selectedIds = ref<Set<number>>(new Set());
const submitting = ref(false);
const flash = ref("");

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
    selectedIds.value = new Set();
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

const uncached = computed(() => songs.value.filter((s) => !s.cached));

function toggleBatch() {
  batchMode.value = !batchMode.value;
  if (!batchMode.value) selectedIds.value.clear();
}
function toggleSelect(id: number) {
  if (selectedIds.value.has(id)) selectedIds.value.delete(id);
  else selectedIds.value.add(id);
}
function selectAllUncached() {
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
    const all = await api.searchAll(q.value.trim(), 2000);
    const ids = all.songs.filter((s) => !s.cached).map((s) => s.id);
    if (ids.length === 0) {
      flash.value = "没有需要下载的歌(全部已在 NAS)";
      return;
    }
    if (
      !confirm(
        `搜索 "${q.value}" 共 ${all.count} 首,其中 ${ids.length} 首未下载。确认全部下载?`,
      )
    ) {
      return;
    }
    const r = await api.downloadBatch(ids);
    flash.value = `已加入下载队列:${r.enqueued} 首,总计 ${r.total_in_session} 在管理`;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="p-4 space-y-3">
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
        <button class="btn-ghost px-3 py-1" @click="selectAllUncached">
          全选未下载 ({{ uncached.length }})
        </button>
        <button
          v-if="selectedIds.size"
          class="btn-ghost px-3 py-1"
          @click="clearSelection"
        >
          清空选择
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
        :title="'搜索 “' + q + '” 全部未下载下载'"
      >
        全部下载 →
      </button>
      <span v-if="flash" class="text-green-400">{{ flash }}</span>
    </div>

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
        class="card flex items-center gap-3"
      >
        <input
          v-if="batchMode"
          type="checkbox"
          :disabled="!!song.cached"
          :checked="selectedIds.has(song.id)"
          @change="toggleSelect(song.id)"
          class="shrink-0"
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
      v-else-if="!loading && q"
      class="text-center text-muted text-sm mt-8"
    >
      没找到,换个首字母试试
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
