<script setup lang="ts">
import { onMounted, ref } from "vue";

const ready = ref(false);
const loading = ref(true);
const busy = ref(false);
const code = ref("");
const error = ref("");

onMounted(async () => {
  try {
    const response = await fetch("/api/session");
    if (!response.ok) throw new Error("无法连接聚会主机，请确认主机和公网入口已启动");
    const session = await response.json();
    ready.value = !!session.role;
  } catch (e) { error.value = String(e); }
  finally { loading.value = false; }
});

async function join() {
  busy.value = true;
  error.value = "";
  try {
    const response = await fetch("/api/session/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code.value }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "加入失败");
    code.value = "";
    ready.value = true;
  } catch (e) { error.value = e instanceof Error ? e.message : String(e); }
  finally { busy.value = false; }
}
</script>

<template>
  <slot v-if="ready" />
  <main v-else class="min-h-screen grid place-items-center p-6">
    <form class="card w-full max-w-sm space-y-5" @submit.prevent="join">
      <div>
        <h1 class="text-2xl font-bold">加入 KTV 聚会</h1>
        <p class="text-sm text-muted mt-2">输入主持人提供的房间口令，即可点歌和控制播放。手机流量也能加入。</p>
      </div>
      <p v-if="loading" role="status">正在连接聚会主机…</p>
      <template v-else>
        <label for="room-code" class="block text-sm">房间口令</label>
        <input id="room-code" v-model="code" type="password" autocomplete="current-password"
          required maxlength="256" class="w-full rounded-lg bg-black/30 border border-white/20 p-3" />
        <button class="btn-primary w-full" :disabled="busy">{{ busy ? "加入中…" : "加入聚会" }}</button>
        <p class="text-xs text-muted">主持人可输入自己的管理口令进入管理页面。</p>
      </template>
      <p v-if="error" role="alert" class="text-red-400 text-sm">{{ error }}</p>
    </form>
  </main>
</template>
