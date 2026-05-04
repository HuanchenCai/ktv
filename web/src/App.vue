<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRoute, RouterView, RouterLink } from "vue-router";
import { startWs, wsStatus } from "./lib/ws";

onMounted(() => startWs());

const route = useRoute();
const tab = computed(() => {
  const seg = route.path.split("/")[1] ?? "";
  return seg || "home";
});

const wsDotClass = computed(() => ({
  "bg-green-400": wsStatus.value === "open",
  "bg-yellow-400": wsStatus.value === "connecting",
  "bg-red-400": wsStatus.value === "closed",
}));

// Desktop nav: search + queue + controls (search lives in Home).
const desktopNav = [
  { to: "/", key: "home", label: "首页", icon: "🏠" },
  { to: "/queue", key: "queue", label: "已点", icon: "📋" },
  { to: "/now", key: "now", label: "控制", icon: "🎤" },
];

// Mobile nav splits home into Home / Search to match small screens.
const mobileNav = [
  { to: "/", key: "home", label: "首页", icon: "🏠" },
  { to: "/search", key: "search", label: "搜歌", icon: "🔍" },
  { to: "/queue", key: "queue", label: "已点", icon: "📋" },
  { to: "/now", key: "now", label: "控制", icon: "🎤" },
];
</script>

<template>
  <div class="flex flex-col h-full">
    <header
      class="flex items-center justify-between px-4 py-2 border-b border-white/5 shrink-0"
    >
      <div class="flex items-center gap-2">
        <div class="w-2 h-2 rounded-full" :class="wsDotClass"></div>
        <span class="font-semibold tracking-wide">KTV</span>
      </div>

      <!-- Desktop top nav -->
      <nav class="hidden md:flex gap-1 items-center">
        <RouterLink
          v-for="item in desktopNav"
          :key="item.to"
          :to="item.to"
          class="desktop-tab"
          :class="{ active: tab === item.key }"
        >
          <span>{{ item.icon }}</span><span>{{ item.label }}</span>
        </RouterLink>
        <RouterLink
          to="/admin"
          class="desktop-tab"
          :class="{ active: tab === 'admin' }"
        >
          <span>⚙</span><span>admin</span>
        </RouterLink>
      </nav>

      <!-- Mobile: only admin link in header -->
      <RouterLink to="/admin" class="text-xs text-muted md:hidden">admin</RouterLink>
    </header>

    <main class="flex-1 overflow-y-auto pb-16 md:pb-0">
      <div class="max-w-6xl mx-auto">
        <RouterView />
      </div>
    </main>

    <!-- Mobile bottom nav -->
    <nav
      class="md:hidden fixed bottom-0 left-0 right-0 flex bg-panel border-t border-white/5"
    >
      <RouterLink
        v-for="item in mobileNav"
        :key="item.to"
        :to="item.to"
        class="tab"
        :class="{ active: tab === item.key }"
      >
        <span>{{ item.icon }}</span><span>{{ item.label }}</span>
      </RouterLink>
    </nav>
  </div>
</template>

<style scoped>
.desktop-tab {
  @apply flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-muted hover:text-white transition-colors;
}
.desktop-tab.active {
  @apply text-accent bg-white/5;
}
</style>
