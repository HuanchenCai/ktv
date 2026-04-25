<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { api, type QueueItem, type DownloadTask } from "../lib/api";
import { onWs } from "../lib/ws";

withDefaults(
  defineProps<{
    /** "compact" hides 删除/置顶 buttons (TV display); "full" shows them (phone) */
    variant?: "compact" | "full";
    /** Limit number of items rendered (TV bottom strip) */
    limit?: number;
  }>(),
  { variant: "full", limit: 0 },
);

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

let unsub: (() => void) | null = null;
onMounted(() => {
  refresh();
  unsub = onWs((msg) => {
    if (msg.type === "queue.updated") {
      refresh();
    } else if (msg.type === "download.progress") {
      const task = msg.payload as DownloadTask;
      const item = items.value.find((i) => i.song.id === task.song_id);
      if (item) item.download = task;
    }
  });
});
onUnmounted(() => unsub?.());

async function remove(it: QueueItem) {
  await api.removeQueue(it.queue_id);
  await refresh();
}
async function toTop(it: QueueItem) {
  await api.moveToFront(it.queue_id);
  await refresh();
}

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

function visibleItems() {
  return [];
}
void visibleItems;
</script>

<template>
  <div class="space-y-3">
    <div v-if="!items.length" class="text-center text-muted text-sm py-4">
      队列是空的
    </div>

    <div v-if="error" class="text-red-400 text-sm">{{ error }}</div>

    <ul class="space-y-2">
      <li
        v-for="it in (limit ? items.slice(0, limit) : items)"
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
            <div class="text-xs text-muted truncate">{{ it.song.artist }}</div>
          </div>
          <div v-if="variant === 'full'" class="flex items-center gap-2">
            <button
              v-if="!it.is_current && it.position !== 1"
              class="btn-ghost text-xs"
              @click="toTop(it)"
            >
              插到下一首
            </button>
            <button class="btn-ghost text-xs" @click="remove(it)">删除</button>
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
</template>
