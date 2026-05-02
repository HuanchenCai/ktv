<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { api } from "../lib/api";
import { onWs } from "../lib/ws";

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
const picking = ref(false);
const error = ref("");

const portraitProgress = ref<{
  total: number;
  done: number;
  ok: number;
  missed: number;
  current: string | null;
} | null>(null);
const portraitRunning = ref(false);
const portraitMinSongs = ref(2);

async function refresh() {
  try {
    health.value = await api.health();
    qr.value = await api.qr();
    const status = await fetch("/api/admin/openlist-status").then((r) => r.json());
    initialPassword.value = status.initial_password ?? null;
    const pp = await api.portraitProgress();
    portraitRunning.value = pp.running;
    portraitProgress.value = pp.progress;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

let unsub: (() => void) | null = null;
onMounted(() => {
  refresh();
  unsub = onWs((msg) => {
    if (msg.type === "portrait.progress") {
      portraitProgress.value = msg.payload as typeof portraitProgress.value;
      portraitRunning.value =
        portraitProgress.value !== null &&
        portraitProgress.value.done < portraitProgress.value.total;
    }
  });
});
onUnmounted(() => unsub?.());

async function runPortraits() {
  portraitRunning.value = true;
  try {
    await api.fetchPortraits({ min_song_count: portraitMinSongs.value });
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    portraitRunning.value = false;
  }
}

async function runScan() {
  scanning.value = true;
  error.value = "";
  try {
    const r = await api.scan(3);
    scanResult.value = `新增 ${r.inserted}，更新 ${r.updated}，跳过 ${r.skipped}`;
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
    importResult.value = `扫 ${r.scanned} 个文件（${r.scanned_path}），入库 ${r.added}，跳过 ${r.skipped}`;
    await refresh();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    importing.value = false;
  }
}

async function pickFolder() {
  picking.value = true;
  error.value = "";
  try {
    const r = await api.pickFolder();
    if (r.path) {
      importPath.value = r.path;
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    picking.value = false;
  }
}
</script>

<template>
  <div class="p-4 space-y-4">
    <div class="card space-y-2">
      <div class="font-semibold">状态</div>
      <div v-if="health" class="text-sm space-y-1">
        <div>
          曲库：{{ health.db_songs }} 首（已缓存 {{ health.db_cached }}）
        </div>
        <div>
          OpenList：
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
        <div class="text-xs text-muted">存储路径：{{ health.library_path }}</div>
      </div>
    </div>

    <div v-if="initialPassword" class="card space-y-1 border border-accent/30">
      <div class="font-semibold text-accent">OpenList 初始管理员密码</div>
      <div class="text-xs text-muted">
        只在本次启动展示。用户名 admin，登录后请修改密码。
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
        首次点一下把百度盘曲库目录扫描入索引。需先在 OpenList 里配好
        Baidu 存储和 api_token（config.json）。支持增量，可以反复点。
      </div>
      <button class="btn-primary" :disabled="scanning" @click="runScan">
        {{ scanning ? "扫描中..." : "开始扫描" }}
      </button>
      <div v-if="scanResult" class="text-sm text-green-400">{{ scanResult }}</div>
    </div>

    <div class="card space-y-2">
      <div class="font-semibold">抓取歌手头像</div>
      <div class="text-xs text-muted">
        从 Wikipedia / Wikidata 抓歌手照片（CC-BY / CC-BY-SA）。
        节流 1 req/s，可能需要几分钟到几十分钟。已抓的会跳过。
      </div>
      <div class="flex items-center gap-2">
        <label class="text-xs text-muted">最少歌数门槛:</label>
        <input
          v-model.number="portraitMinSongs"
          type="number"
          min="1"
          max="20"
          class="bg-elevated rounded px-2 py-1 text-sm w-20"
        />
        <button
          class="btn-primary text-sm"
          :disabled="portraitRunning"
          @click="runPortraits"
        >
          {{ portraitRunning ? "抓取中..." : "开始抓取" }}
        </button>
      </div>
      <div
        v-if="portraitProgress"
        class="space-y-1.5 text-xs pt-1"
      >
        <div class="flex items-center gap-2">
          <div class="flex-1 h-1.5 bg-black/40 rounded overflow-hidden">
            <div
              class="h-full bg-accent transition-all"
              :style="{
                width:
                  portraitProgress.total > 0
                    ? (portraitProgress.done / portraitProgress.total) * 100 +
                      '%'
                    : '0%',
              }"
            ></div>
          </div>
          <span class="font-mono tabular-nums w-20 text-right text-muted">
            {{ portraitProgress.done }} / {{ portraitProgress.total }}
          </span>
        </div>
        <div class="flex justify-between text-muted">
          <span>
            ✓ {{ portraitProgress.ok }} · ✗ {{ portraitProgress.missed }}
          </span>
          <span v-if="portraitProgress.current" class="truncate">
            正在: {{ portraitProgress.current }}
          </span>
        </div>
      </div>
    </div>

    <div class="card space-y-2">
      <div class="font-semibold">导入本地已有 MKV</div>
      <div class="text-xs text-muted">
        扫描所选目录下的 .mkv/.mp4 文件，标记为"已缓存"入库。支持网络
        共享（UNC 路径）。
      </div>
      <div class="flex items-center gap-2">
        <input
          v-model="importPath"
          class="input text-sm flex-1"
          placeholder="留空 = 用 config.library_path"
        />
        <button
          class="btn-ghost text-sm whitespace-nowrap"
          :disabled="picking"
          @click="pickFolder"
        >
          {{ picking ? "选择中..." : "📁 浏览..." }}
        </button>
      </div>
      <button
        class="btn-primary text-sm"
        :disabled="importing"
        @click="runImportLocal"
      >
        {{ importing ? "导入中..." : "开始导入" }}
      </button>
      <div v-if="importResult" class="text-sm text-green-400">
        {{ importResult }}
      </div>
    </div>

    <div v-if="error" class="text-red-400 text-sm">{{ error }}</div>

    <div class="card text-xs text-muted space-y-1">
      <div>配置：编辑 config.json 后重启 backend</div>
      <div>OpenList 管理界面：见上方状态卡片的 url</div>
    </div>
  </div>
</template>
