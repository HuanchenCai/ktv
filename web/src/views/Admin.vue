<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../lib/api";

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
const error = ref("");

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

onMounted(() => refresh());

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
        首次点一下把曲库目录扫描入索引。支持增量，可以反复点。
      </div>
      <button class="btn-primary" :disabled="scanning" @click="runScan">
        {{ scanning ? "扫描中..." : "开始扫描" }}
      </button>
      <div v-if="scanResult" class="text-sm text-green-400">{{ scanResult }}</div>
    </div>

    <div v-if="error" class="text-red-400 text-sm">{{ error }}</div>

    <div class="card text-xs text-muted space-y-1">
      <div>配置：编辑 config.json 后重启 backend</div>
      <div>OpenList 管理界面：见上方状态卡片的 url</div>
    </div>
  </div>
</template>
