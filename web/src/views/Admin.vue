<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { api } from "../lib/api";
import { onWs, startWs, type ManagerTask } from "../lib/ws";

const health = ref<{
  ok: boolean;
  openlist_up: boolean;
  openlist_admin_url: string;
  mpv_ready: boolean;
  library_path: string;
  db_songs: number;
  db_cached: number;
} | null>(null);
const qr = ref<{ url: string; qr_data_url: string; lan_ips: string[] } | null>(null);
const initialPassword = ref<string | null>(null);
const scanResult = ref<string>("");
const scanning = ref(false);
const importResult = ref<string>("");
const importing = ref(false);
const importPath = ref<string>("");
const error = ref("");

// Download manager state (live via /ws)
const tasks = ref<Map<number, ManagerTask>>(new Map());
const aborting = ref(false);
let unsub: (() => void) | null = null;

async function refresh() {
  try {
    health.value = await api.health();
    qr.value = await api.qr();
    const status = await fetch("/api/admin/openlist-status").then((r) => r.json());
    initialPassword.value = status.initial_password ?? null;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

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
  refresh();
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

async function runScan() {
  scanning.value = true;
  error.value = "";
  try {
    const r = await api.scan(3);
    scanResult.value = `新增 ${r.inserted},更新 ${r.updated},跳过 ${r.skipped}`;
    await refresh();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    scanning.value = false;
  }
}

async function runImportLocal() {
  importing.value = true;
  error.value = "";
  try {
    const r = await api.importLocal(importPath.value || undefined);
    importResult.value = `扫 ${r.scanned} 个文件(${r.scanned_path}),入库 ${r.added},跳过 ${r.skipped}`;
    await refresh();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    importing.value = false;
  }
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
    <div class="card space-y-2">
      <div class="font-semibold">状态</div>
      <div v-if="health" class="text-sm space-y-1">
        <div>
          曲库:{{ health.db_songs }} 首(已缓存 {{ health.db_cached }})
        </div>
        <div>
          OpenList:
          <span :class="health.openlist_up ? 'text-green-400' : 'text-red-400'">
            {{ health.openlist_up ? "在线" : "未连接" }}
          </span>
          <a
            v-if="health.openlist_up"
            :href="health.openlist_admin_url"
            target="_blank"
            class="text-xs text-accent ml-2"
          >
            打开管理界面 ↗
          </a>
        </div>
        <div class="text-xs text-muted">存储路径:{{ health.library_path }}</div>
      </div>
    </div>

    <div class="card space-y-2">
      <div class="flex items-baseline justify-between">
        <div class="font-semibold">下载队列</div>
        <button
          v-if="counts.downloading + counts.queued > 0"
          class="btn-ghost text-xs px-3 py-1"
          :disabled="aborting"
          @click="abortDownloads"
        >
          {{ aborting ? "..." : "取消所有" }}
        </button>
      </div>
      <div class="text-xs text-muted flex gap-3 flex-wrap">
        <span>排队 {{ counts.queued }}</span>
        <span class="text-blue-400">下载中 {{ counts.downloading }}</span>
        <span class="text-green-400">完成 {{ counts.done + counts.skipped }}</span>
        <span class="text-red-400">失败 {{ counts.failed }}</span>
      </div>
      <ul
        v-if="taskList.length"
        class="space-y-1 max-h-96 overflow-y-auto"
      >
        <li
          v-for="t in taskList"
          :key="t.id"
          class="text-sm border-b border-white/5 pb-1"
        >
          <div class="flex items-center gap-2">
            <span class="shrink-0 w-4 text-center">{{ statusIcon(t.state) }}</span>
            <span class="flex-1 truncate">
              {{ t.artist }} — {{ t.title }}
            </span>
            <span class="text-xs text-muted shrink-0">
              <template v-if="t.state === 'downloading'">
                {{ fmtBytes(t.bytesWritten) }} / {{ fmtBytes(t.bytesTotal || t.size_bytes) }} · {{ progressPct(t) }}%
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
      <div v-else class="text-xs text-muted">暂无任务。在搜索页用"批量模式"或"全部下载"加入歌曲。</div>
    </div>

    <div v-if="initialPassword" class="card space-y-1 border border-accent/30">
      <div class="font-semibold text-accent">OpenList 初始管理员密码</div>
      <div class="text-xs text-muted">
        只在本次启动展示。用户名 admin,登录后请修改密码。
      </div>
      <div class="font-mono bg-black/40 rounded px-3 py-2 select-all">
        {{ initialPassword }}
      </div>
    </div>

    <div class="card space-y-3 text-center">
      <div class="font-semibold">扫我加入 KTV</div>
      <img
        v-if="qr"
        :src="qr.qr_data_url"
        class="mx-auto w-48 h-48 rounded bg-white p-2"
      />
      <div v-if="qr" class="text-xs text-muted">
        {{ qr.url }}<br />
        <span>LAN: {{ qr.lan_ips.join(", ") }}</span>
      </div>
    </div>

    <div class="card space-y-2">
      <div class="font-semibold">扫百度盘入库</div>
      <div class="text-xs text-muted">
        通过 OpenList 扫描云盘入索引。需先在 OpenList 里配好 Baidu 存储 + api_token。
        BDUSS 直扫请用 npm run scan(命令行)。
      </div>
      <button class="btn-primary" :disabled="scanning" @click="runScan">
        {{ scanning ? "扫描中..." : "开始扫描" }}
      </button>
      <div v-if="scanResult" class="text-sm text-green-400">{{ scanResult }}</div>
    </div>

    <div class="card space-y-2">
      <div class="font-semibold">导入本地已有 MKV(调试用)</div>
      <div class="text-xs text-muted">
        扫描指定目录下的 .mkv/.mp4 文件,直接标记为"已缓存"入库。
      </div>
      <input
        v-model="importPath"
        class="input text-sm"
        placeholder="留空 = 用 config.library_path"
      />
      <button
        class="btn-ghost"
        :disabled="importing"
        @click="runImportLocal"
      >
        {{ importing ? "导入中..." : "导入本地文件" }}
      </button>
      <div v-if="importResult" class="text-sm text-green-400">
        {{ importResult }}
      </div>
    </div>

    <div v-if="error" class="text-red-400 text-sm">{{ error }}</div>

    <div class="card text-xs text-muted space-y-1">
      <div>配置:编辑 config.json 后重启 backend</div>
    </div>
  </div>
</template>
