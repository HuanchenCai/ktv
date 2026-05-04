<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { api, type QueueItem, type DownloadTask } from "../lib/api";
import { onWs, type ManagerTask } from "../lib/ws";

type Tab = "queue" | "downloads";
const tab = ref<Tab>("queue");

// --- Play queue ---------------------------------------------------------
const items = ref<QueueItem[]>([]);
const error = ref("");

async function refresh() {
  try {
    const res = await api.listQueue();
    items.value = res.items;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

// --- Download manager state --------------------------------------------
const tasks = ref<Map<number, ManagerTask>>(new Map());
const aborting = ref(false);

async function loadDownloadState() {
  try {
    const r = await api.downloadState();
    const m = new Map<number, ManagerTask>();
    for (const t of r.tasks) m.set(t.id, t as ManagerTask);
    tasks.value = m;
  } catch {
    /* ws will fill in */
  }
}

const counts = computed(() => {
  const c = { queued: 0, downloading: 0, done: 0, failed: 0, skipped: 0 };
  for (const t of tasks.value.values()) c[t.state]++;
  return c;
});

const taskList = computed(() => {
  const order: Record<ManagerTask["state"], number> = {
    downloading: 0,
    queued: 1,
    skipped: 2,
    done: 2,
    failed: 3,
  };
  return [...tasks.value.values()].sort(
    (a, b) => order[a.state] - order[b.state],
  );
});

// --- WS subscriptions ---------------------------------------------------
let unsub: (() => void) | null = null;
onMounted(() => {
  refresh();
  loadDownloadState();
  unsub = onWs((msg) => {
    if (msg.type === "queue.updated") {
      refresh();
    } else if (msg.type === "download.progress") {
      const task = msg.payload as DownloadTask;
      const item = items.value.find((i) => i.song.id === task.song_id);
      if (item) item.download = task;
    } else if (msg.type === "downloads.snapshot") {
      const m = new Map<number, ManagerTask>();
      for (const t of msg.payload.tasks) m.set(t.id, t);
      tasks.value = m;
    } else if (msg.type === "downloads.task") {
      const m = new Map(tasks.value);
      m.set(msg.payload.id, msg.payload);
      tasks.value = m;
    }
  });
});
onUnmounted(() => unsub?.());

// --- Actions ------------------------------------------------------------
async function remove(it: QueueItem) {
  await api.removeQueue(it.queue_id);
  await refresh();
}
async function toTop(it: QueueItem) {
  await api.moveToFront(it.queue_id);
  await refresh();
}
async function abortDownloads() {
  if (!confirm("取消所有正在下载的任务?")) return;
  aborting.value = true;
  try {
    await api.abortDownloads();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    aborting.value = false;
  }
}

// --- Helpers ------------------------------------------------------------
function pct(t: DownloadTask | null): number {
  if (!t) return 0;
  return Math.round((t.progress ?? 0) * 100);
}
function dlLabel(t: DownloadTask | null): string {
  if (!t) return "";
  if (t.status === "done") return "已缓存";
  if (t.status === "pending") return "排队中";
  if (t.status === "downloading") return `下载 ${pct(t)}%`;
  if (t.status === "failed") return "下载失败";
  return "";
}
function fmtBytes(b: number | null): string {
  if (!b || b <= 0) return "0 B";
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
function progressPct(t: ManagerTask): number {
  if (t.state === "done" || t.state === "skipped" || t.state === "failed")
    return 100;
  if (!t.bytesTotal) return 0;
  return Math.min(100, Math.floor((t.bytesWritten / t.bytesTotal) * 100));
}
function statusIcon(state: ManagerTask["state"]): string {
  return { queued: "⏸", downloading: "⟳", done: "✓", skipped: "⊘", failed: "✗" }[state];
}
</script>

<template>
  <div class="p-4 space-y-3">
    <!-- Tab switcher -->
    <div class="flex gap-1 text-sm border-b border-white/5">
      <button
        class="px-4 py-2 -mb-px border-b-2"
        :class="
          tab === 'queue'
            ? 'border-accent text-accent'
            : 'border-transparent text-muted'
        "
        @click="tab = 'queue'"
      >
        播放队列 ({{ items.length }})
      </button>
      <button
        class="px-4 py-2 -mb-px border-b-2"
        :class="
          tab === 'downloads'
            ? 'border-accent text-accent'
            : 'border-transparent text-muted'
        "
        @click="tab = 'downloads'"
      >
        正在下载
        <span v-if="counts.downloading + counts.queued > 0" class="text-blue-400">
          ({{ counts.downloading + counts.queued }})
        </span>
      </button>
    </div>

    <div v-if="error" class="text-red-400 text-sm">{{ error }}</div>

    <!-- ===== Play queue tab ===== -->
    <div v-if="tab === 'queue'">
      <div v-if="!items.length" class="text-center text-muted text-sm mt-8">
        队列是空的,去搜歌点一首
      </div>
      <ul class="space-y-2">
        <li
          v-for="it in items"
          :key="it.queue_id"
          class="card space-y-1"
          :class="{ 'ring-1 ring-accent': it.is_current }"
        >
          <div class="flex items-center justify-between gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 text-xs text-muted">
                <span class="font-mono">#{{ it.position }}</span>
                <span v-if="it.is_current" class="text-accent">播放中</span>
              </div>
              <div class="truncate">{{ it.song.title }}</div>
              <div class="text-xs text-muted truncate">
                {{ it.song.artist }}
              </div>
            </div>
            <div class="flex items-center gap-2">
              <button
                v-if="!it.is_current && it.position !== 1"
                class="btn-ghost text-xs"
                @click="toTop(it)"
              >
                插到下一首
              </button>
              <button class="btn-ghost text-xs" @click="remove(it)">
                删除
              </button>
            </div>
          </div>
          <div v-if="it.download" class="flex items-center gap-2">
            <div class="flex-1 h-1 bg-black/40 rounded overflow-hidden">
              <div
                class="h-full bg-accent transition-all"
                :style="{ width: pct(it.download) + '%' }"
              ></div>
            </div>
            <div class="text-xs text-muted w-20 text-right">
              {{ dlLabel(it.download) }}
            </div>
          </div>
        </li>
      </ul>
    </div>

    <!-- ===== Downloads tab ===== -->
    <div v-else-if="tab === 'downloads'">
      <div class="grid grid-cols-4 gap-2 text-sm mb-3">
        <div class="bg-white/5 rounded p-2 text-center">
          <div class="text-xs text-muted">排队</div>
          <div class="text-lg font-mono">{{ counts.queued }}</div>
        </div>
        <div class="bg-white/5 rounded p-2 text-center">
          <div class="text-xs text-muted">下载中</div>
          <div class="text-lg font-mono text-blue-400">
            {{ counts.downloading }}
          </div>
        </div>
        <div class="bg-white/5 rounded p-2 text-center">
          <div class="text-xs text-muted">完成</div>
          <div class="text-lg font-mono text-green-400">
            {{ counts.done + counts.skipped }}
          </div>
        </div>
        <div class="bg-white/5 rounded p-2 text-center">
          <div class="text-xs text-muted">失败</div>
          <div class="text-lg font-mono text-red-400">{{ counts.failed }}</div>
        </div>
      </div>

      <button
        v-if="counts.downloading + counts.queued > 0"
        class="btn-ghost text-xs px-3 py-1 mb-2"
        :disabled="aborting"
        @click="abortDownloads"
      >
        {{ aborting ? "..." : "取消所有" }}
      </button>

      <div v-if="!taskList.length" class="text-center text-muted text-sm mt-8">
        暂无下载任务。
      </div>
      <ul v-else class="space-y-2">
        <li
          v-for="t in taskList"
          :key="t.id"
          class="card space-y-1"
        >
          <div class="flex items-center gap-2">
            <span class="shrink-0 w-4 text-center">
              {{ statusIcon(t.state) }}
            </span>
            <div class="flex-1 min-w-0">
              <div class="truncate">{{ t.title }}</div>
              <div class="text-xs text-muted truncate">{{ t.artist }}</div>
            </div>
            <span class="text-xs text-muted shrink-0 font-mono">
              <template v-if="t.state === 'downloading'">
                {{ fmtBytes(t.bytesWritten) }} /
                {{ fmtBytes(t.bytesTotal || t.size_bytes) }} ·
                {{ progressPct(t) }}%
              </template>
              <template v-else-if="t.state === 'done'">
                {{ fmtBytes(t.bytesWritten) }}
              </template>
              <template v-else-if="t.state === 'skipped'">已存在</template>
              <template v-else-if="t.state === 'failed'">失败</template>
              <template v-else>{{ fmtBytes(t.size_bytes) }}</template>
            </span>
          </div>
          <div
            v-if="t.state !== 'queued'"
            class="h-1 bg-black/40 rounded overflow-hidden"
          >
            <div
              class="h-full transition-all"
              :class="{
                'bg-blue-500': t.state === 'downloading',
                'bg-green-500': t.state === 'done' || t.state === 'skipped',
                'bg-red-500': t.state === 'failed',
              }"
              :style="{ width: progressPct(t) + '%' }"
            />
          </div>
          <div v-if="t.error" class="text-xs text-red-400 truncate">
            {{ t.error }}
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>
