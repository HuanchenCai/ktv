<script setup lang="ts">
import { onMounted, computed } from "vue";
import { useRoute, RouterView, RouterLink } from "vue-router";
import { startWs, wsStatus } from "./lib/ws";

onMounted(() => startWs());

const route = useRoute();
const tab = computed(() => route.path.split("/")[1] ?? "search");

const wsDotClass = computed(() => ({
  "bg-green-400": wsStatus.value === "open",
  "bg-yellow-400": wsStatus.value === "connecting",
  "bg-red-400": wsStatus.value === "closed",
}));
</script>

<template>
  <div class="flex flex-col h-full">
    <header
      class="flex items-center justify-between px-4 py-2 border-b border-white/5"
    >
      <div class="flex items-center gap-2">
        <div class="w-2 h-2 rounded-full" :class="wsDotClass"></div>
        <span class="font-semibold tracking-wide">KTV</span>
      </div>
      <RouterLink to="/admin" class="text-xs text-muted">admin</RouterLink>
    </header>

    <main class="flex-1 overflow-y-auto pb-16">
      <RouterView />
    </main>

    <nav
      class="fixed bottom-0 left-0 right-0 flex bg-panel border-t border-white/5"
    >
      <RouterLink to="/search" class="tab" :class="{ active: tab === 'search' }">
        <span>🔍</span><span>搜歌</span>
      </RouterLink>
      <RouterLink to="/queue" class="tab" :class="{ active: tab === 'queue' }">
        <span>📋</span><span>已点</span>
      </RouterLink>
      <RouterLink to="/now" class="tab" :class="{ active: tab === 'now' }">
        <span>🎤</span><span>播放</span>
      </RouterLink>
    </nav>
  </div>
</template>
