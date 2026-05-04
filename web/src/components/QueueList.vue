<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { api, type QueueItem, type DownloadTask } from "../lib/api";
import { onWs } from "../lib/ws";

withDefaults(
  defineProps<{
    /** "compact" hides 删除/置顶 buttons (TV display); "full" shows them (phone) */
    variant?: "compact" | "full";
    /** Limit number of items rendered */
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
  if (t.status === "pending") return "排队";
  if (t.status === "downloading") return `${pct(t)}%`;
  if (t.status === "failed") return "失败";
  return "";
}
function dlClass(t: DownloadTask | null): string {
  if (!t) return "text-muted";
  if (t.status === "done") return "text-emerald-400";
  if (t.status === "failed") return "text-rose-400";
  if (t.status === "downloading") return "text-accent";
  return "text-muted";
}
</script>

<template>
  <div>
    <div
      v-if="!items.length"
      class="text-center text-muted text-xs py-6"
    >
      队列空空如也
    </div>

    <div v-if="error" class="text-rose-400 text-sm">{{ error }}</div>

    <ul class="space-y-2">
      <li
        v-for="it in (limit ? items.slice(0, limit) : items)"
        :key="it.queue_id"
        class="bg-panel rounded-xl px-3 py-2.5 border border-transparent transition-colors"
        :class="
          it.is_current
            ? 'ring-1 ring-accent/60 border-accent/30 bg-accent/5'
            : ''
        "
      >
        <div class="flex items-center gap-3">
          <div
            class="w-8 h-8 rounded-lg shrink-0 grid place-items-center text-xs font-bold"
            :class="
              it.is_current
                ? 'bg-accent text-white'
                : 'bg-elevated text-muted'
            "
          >
            <span v-if="it.is_current">▶</span>
            <span v-else>{{ it.position }}</span>
          </div>
          <div class="flex-1 min-w-0">
            <div class="truncate text-sm font-medium">{{ it.song.title }}</div>
            <div class="text-[11px] text-muted truncate">
              {{ it.song.artist
              }}<span v-if="it.song.lang"> · {{ it.song.lang }}</span>
            </div>
          </div>
          <div
            v-if="variant === 'full'"
            class="flex items-center gap-1.5 shrink-0"
          >
            <button
              v-if="!it.is_current && it.position !== 1"
              class="text-[11px] text-muted hover:text-white px-2 py-1 rounded transition-colors"
              @click="toTop(it)"
            >
              ↑ 置顶
            </button>
            <button
              class="text-[11px] text-muted hover:text-rose-400 px-2 py-1 rounded transition-colors"
              @click="remove(it)"
            >
              删除
            </button>
          </div>
          <div
            v-else-if="it.download"
            class="text-[11px] shrink-0"
            :class="dlClass(it.download)"
          >
            {{ dlLabel(it.download) }}
          </div>
        </div>

        <div
          v-if="
            variant === 'full' &&
            it.download &&
            it.download.status !== 'done'
          "
          class="flex items-center gap-2 mt-2"
        >
          <div class="flex-1 h-1 bg-black/30 rounded overflow-hidden">
            <div
              class="h-full transition-all"
              :class="
                it.download.status === 'failed'
                  ? 'bg-rose-500'
                  : 'bg-accent'
              "
              :style="{ width: pct(it.download) + '%' }"
            ></div>
          </div>
          <div class="text-[11px] w-16 text-right" :class="dlClass(it.download)">
            {{ dlLabel(it.download) }}
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
