<script setup lang="ts">
import { onMounted, computed } from "vue";
import { useRoute, RouterView, RouterLink } from "vue-router";
import { startWs, wsStatus } from "./lib/ws";
import MiniPlayer from "./components/MiniPlayer.vue";

onMounted(() => startWs());

const route = useRoute();
const tab = computed(() => route.path.split("/")[1] ?? "search");
const isTv = computed(() => route.meta?.layout === "tv");
const isAdmin = computed(() => route.path.startsWith("/admin"));

const wsDotClass = computed(() => ({
  "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]":
    wsStatus.value === "open",
  "bg-yellow-400": wsStatus.value === "connecting",
  "bg-rose-500": wsStatus.value === "closed",
}));
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- TV header: slim, branding-forward -->
    <header
      v-if="isTv"
      class="flex items-center justify-between px-8 py-4 border-b border-border/60 backdrop-blur-md bg-bg/40"
    >
      <div class="flex items-center gap-3">
        <div
          class="w-9 h-9 rounded-xl bg-accent shadow-glow grid place-items-center text-lg"
        >
          🎤
        </div>
        <div>
          <div class="text-xl font-bold tracking-wide leading-none">KTV</div>
          <div class="text-[11px] text-muted mt-0.5 flex items-center gap-1.5">
            <span class="inline-block w-1.5 h-1.5 rounded-full" :class="wsDotClass"></span>
            <span>{{ wsStatus === "open" ? "在线" : wsStatus === "connecting" ? "连接中" : "已断开" }}</span>
          </div>
        </div>
      </div>
      <div class="flex items-center gap-3 text-xs text-muted">
        <RouterLink to="/library" class="hover:text-white transition-colors">曲库</RouterLink>
        <span class="text-border">|</span>
        <RouterLink to="/admin" class="hover:text-white transition-colors">管理</RouterLink>
        <span class="text-border">|</span>
        <RouterLink to="/search" class="hover:text-white transition-colors">手机版预览</RouterLink>
      </div>
    </header>

    <!-- Phone header: minimal -->
    <header
      v-else
      class="flex items-center justify-between px-4 py-3 border-b border-border/60 sticky top-0 bg-bg/80 backdrop-blur-md z-30"
    >
      <div class="flex items-center gap-2.5">
        <div
          class="w-8 h-8 rounded-lg bg-accent grid place-items-center text-sm shadow-glow"
        >
          🎤
        </div>
        <div>
          <div class="font-bold tracking-wide leading-none">KTV</div>
          <div class="text-[10px] text-muted mt-0.5 flex items-center gap-1">
            <span class="inline-block w-1 h-1 rounded-full" :class="wsDotClass"></span>
            <span>{{ wsStatus === "open" ? "在线" : "连接中" }}</span>
          </div>
        </div>
      </div>
      <RouterLink
        to="/admin"
        class="text-xs text-muted hover:text-white transition-colors"
      >
        管理
      </RouterLink>
    </header>

    <main
      class="flex-1 overflow-y-auto"
      :class="isTv ? '' : isAdmin ? 'pb-16' : 'pb-32'"
    >
      <RouterView v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </RouterView>
    </main>

    <!-- Phone-only: mini player above tab bar when something is queued -->
    <MiniPlayer v-if="!isTv && !isAdmin" />

    <!-- Phone tab bar -->
    <nav
      v-if="!isTv"
      class="fixed bottom-0 left-0 right-0 flex bg-elevated/95 backdrop-blur-md border-t border-border/60 pb-[env(safe-area-inset-bottom)]"
    >
      <RouterLink to="/search" class="tab" :class="{ active: tab === 'search' }">
        <span class="tab-icon">🔍</span><span>搜歌</span>
      </RouterLink>
      <RouterLink to="/queue" class="tab" :class="{ active: tab === 'queue' }">
        <span class="tab-icon">📋</span><span>已点</span>
      </RouterLink>
      <RouterLink to="/now" class="tab" :class="{ active: tab === 'now' }">
        <span class="tab-icon">🎤</span><span>播放</span>
      </RouterLink>
    </nav>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease-out;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
