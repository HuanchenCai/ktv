<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { api } from "../lib/api";
import { onWs, startWs, type ManagerTask } from "../lib/ws";

const tasks = ref<Map<number, ManagerTask>>(new Map());
const aborting = ref(false);
const error = ref("");
let unsub: (() => void) | null = null;

async function loadDownloadState() {
  try {
    const r = await api.downloadState();
    const m = new Map<number, ManagerTask>();
    for (const t of r.tasks) m.set(t.id, t as ManagerTask);
    tasks.value = m;
  } catch {
    /* ws will fill it in */
  }
}

onMounted(() => {
  loadDownloadState();
  startWs();
  unsub = onWs((msg) => {
    if (msg.type === "downloads.snapshot") {
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

onUnmounted(() => {
  if (unsub) unsub();
});

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

const counts = computed(() => {
  const c = { queued: 0, downloading: 0, done: 0, failed: 0, skipped: 0 };
  for (const t of tasks.value.values()) c[t.state]++;
  return c;
});

const totalBytes = computed(() => {
  let written = 0;
  let total = 0;
  for (const t of tasks.value.values()) {
    written += t.bytesWritten;
    total += t.bytesTotal ?? t.size_bytes ?? 0;
  }
  return { written, total };
});

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
  <div class="p-4 space-y-4">
    <div class="card space-y-3">
      <div class="flex items-baseline justify-between">
        <div class="font-semibold text-lg">下载队列</div>
        <button
          v-if="counts.downloading + counts.queued > 0"
          class="btn-ghost text-xs px-3 py-1"
          :disabled="aborting"
          @click="abortDownloads"
        >
          {{ aborting ? "..." : "取消所有" }}
        </button>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div class="bg-white/5 rounded p-2">
          <div class="text-xs text-muted">排队</div>
          <div class="text-2xl font-mono">{{ counts.queued }}</div>
        </div>
        <div class="bg-white/5 rounded p-2">
          <div class="text-xs text-muted">下载中</div>
          <div class="text-2xl font-mono text-blue-400">
            {{ counts.downloading }}
          </div>
        </div>
        <div class="bg-white/5 rounded p-2">
          <div class="text-xs text-muted">完成</div>
          <div class="text-2xl font-mono text-green-400">
            {{ counts.done + counts.skipped }}
          </div>
        </div>
        <div class="bg-white/5 rounded p-2">
          <div class="text-xs text-muted">失败</div>
          <div class="text-2xl font-mono text-red-400">{{ counts.failed }}</div>
        </div>
      </div>
      <div v-if="totalBytes.total > 0" class="text-xs text-muted">
        总进度 {{ fmtBytes(totalBytes.written) }} / {{ fmtBytes(totalBytes.total) }}
        ({{
          totalBytes.total
            ? ((totalBytes.written / totalBytes.total) * 100).toFixed(1)
            : "0"
        }}%)
      </div>
    </div>

    <div class="card">
      <ul v-if="taskList.length" class="space-y-2 max-h-[70vh] overflow-y-auto">
        <li
          v-for="t in taskList"
          :key="t.id"
          class="text-sm border-b border-white/5 pb-2 last:border-0"
        >
          <div class="flex items-center gap-2">
            <span class="shrink-0 w-4 text-center">
              {{ statusIcon(t.state) }}
            </span>
            <span class="flex-1 truncate font-medium">
              {{ t.artist }} — {{ t.title }}
            </span>
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
            class="h-1 bg-white/5 rounded mt-1 overflow-hidden"
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
          <div v-if="t.error" class="text-xs text-red-400 mt-1 truncate">
            {{ t.error }}
          </div>
        </li>
      </ul>
      <div v-else class="text-sm text-muted text-center py-8">
        暂无下载任务。在
        <RouterLink to="/search" class="text-accent">搜索页</RouterLink>
        点歌或批量下载会出现在这里。
      </div>
    </div>

    <div v-if="error" class="text-red-400 text-sm">{{ error }}</div>
  </div>
</template>
