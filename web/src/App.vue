<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref } from "vue";
import { useRoute, RouterView, RouterLink } from "vue-router";
import { startWs, wsStatus, onWs } from "./lib/ws";
import MiniPlayer from "./components/MiniPlayer.vue";
import { roomRole, roomEnabled, leaveRoom } from "./lib/session";

const narrow = ref(typeof window !== "undefined" && window.innerWidth < 1024);
const headerCollapsed = ref(false);
const updateWidth = () => { narrow.value = window.innerWidth < 1024; };
onMounted(() => {
  startWs();
  window.addEventListener("resize", updateWidth);
});
const playbackError = ref("");
const removeErrorListener = onWs((msg) => {
  if (msg.type === "player.error") playbackError.value = msg.payload.message;
});
onUnmounted(() => {
  removeErrorListener();
  window.removeEventListener("resize", updateWidth);
});

const route = useRoute();
const tab = computed(() => route.path.split("/")[1] ?? "search");
const isTv = computed(() => route.meta?.layout === "tv");
const showBottomNav = computed(() => narrow.value && !isTv.value);
const mobileTitle = computed(() => ({ search: "搜歌", queue: "已点", now: "播放", settings: "设置" })[tab.value] ?? "KTV");
function onMainScroll(event: Event) {
  headerCollapsed.value = showBottomNav.value && (event.target as HTMLElement).scrollTop > 80;
}

const wsDotClass = computed(() => ({
  "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]":
    wsStatus.value === "open",
  "bg-yellow-400": wsStatus.value === "connecting",
  "bg-rose-500": wsStatus.value === "closed",
}));
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Unified header: same nav links everywhere so /admin / /library /
         /artists can always jump back to /tv. Just the size differs. -->
    <header
      :class="[
        'flex items-center justify-between glass-bar border-b',
        isTv ? 'px-8 py-4' : headerCollapsed ? 'px-4 py-2 sticky top-0 z-30' : 'px-4 py-3 sticky top-0 z-30',
      ]"
    >
      <RouterLink
        v-if="!headerCollapsed"
        to="/"
        class="flex items-center gap-2 group"
        title="回主页"
      >
        <span class="grid h-7 w-7 place-items-center rounded-md border border-accent/40 text-accent text-sm">◈</span>
        <div>
          <div class="text-sm font-semibold tracking-wide leading-none">寰宇 <span class="text-accent">KTV</span></div>
          <div
            class="text-muted mt-0.5 flex items-center gap-1.5"
            :class="isTv ? 'text-[11px]' : 'text-[10px]'"
          >
            <span
              class="inline-block w-1.5 h-1.5 rounded-full"
              :class="wsDotClass"
            ></span>
            <span>
              {{
                wsStatus === "open"
                  ? "已连接"
                  : wsStatus === "connecting"
                    ? "连接中"
                    : "已断开"
              }}
            </span>
          </div>
        </div>
      </RouterLink>
      <span v-else class="text-sm font-semibold">{{ mobileTitle }}</span>
      <!-- Phone uses the bottom tab bar (搜歌/已点/播放), and the desktop-
           oriented routes (曲库/歌手/管理) don't fit the phone layout, so
           the top nav is desktop-only. -->
      <nav
        v-if="!showBottomNav"
        class="flex items-center gap-2.5 text-xs text-muted"
        :class="isTv ? '' : 'gap-1.5'"
      >
        <!-- "/" so the redirect rule decides per device width: phones go to
             /search, big screens (host browser → AirPlay) go to /tv. -->
        <RouterLink
          to="/"
          class="hover:text-white transition-colors px-1.5 py-1 rounded"
          :class="route.path === '/tv' || route.path === '/search' ? 'text-white bg-panel' : ''"
        >
          📺 主页
        </RouterLink>
        <RouterLink
          to="/artists"
          class="hover:text-white transition-colors px-1.5 py-1 rounded"
          active-class="text-white bg-panel"
        >
          👤 歌手
        </RouterLink>
        <RouterLink
          v-if="roomRole === 'admin'"
          to="/settings"
          class="hover:text-white transition-colors px-1.5 py-1 rounded"
          active-class="text-white bg-panel"
        >
          ⚙ 设置
        </RouterLink>
      </nav>
      <button v-if="roomEnabled" class="text-xs text-muted px-2 py-2" @click="leaveRoom">退出房间</button>
    </header>

    <div v-if="playbackError" role="alert" class="bg-rose-950 text-rose-100 px-4 py-3 text-sm flex justify-between gap-3">
      <span>{{ playbackError }}</span>
      <button aria-label="关闭播放提示" @click="playbackError = ''">关闭</button>
    </div>

    <main
      class="flex-1 overflow-y-auto"
      :class="isTv ? '' : showBottomNav ? 'pb-32' : 'pb-4'"
      @scroll="onMainScroll"
    >
      <RouterView v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </RouterView>
    </main>

    <!-- Phone-only: mini player above tab bar when on a phone-tab route -->
    <MiniPlayer v-if="showBottomNav" />

    <!-- Phone tab bar: only on the three phone-driven routes. Glass
         surface lifted slightly off the bottom so it floats. -->
    <nav
      v-if="showBottomNav"
      class="fixed bottom-0 left-0 right-0 z-40 px-3 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2"
    >
      <div
        class="glass-bar border rounded-2xl flex items-stretch shadow-deep"
      >
        <RouterLink to="/search" class="tab" :class="{ active: tab === 'search' }">
          <span class="tab-icon">🔍</span><span>搜歌</span>
          <span
            v-if="tab === 'search'"
            class="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full"
            style="background: linear-gradient(90deg, #ff2e6b, #d946ef)"
          ></span>
        </RouterLink>
        <RouterLink to="/queue" class="tab" :class="{ active: tab === 'queue' }">
          <span class="tab-icon">📋</span><span>已点</span>
          <span
            v-if="tab === 'queue'"
            class="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full"
            style="background: linear-gradient(90deg, #ff2e6b, #d946ef)"
          ></span>
        </RouterLink>
        <RouterLink to="/now" class="tab" :class="{ active: tab === 'now' }">
          <span class="tab-icon">🎤</span><span>播放</span>
          <span
            v-if="tab === 'now'"
            class="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full"
            style="background: linear-gradient(90deg, #ff2e6b, #d946ef)"
          ></span>
        </RouterLink>
        <RouterLink v-if="roomRole === 'admin'" to="/settings" class="tab" :class="{ active: tab === 'settings' }">
          <span class="tab-icon">⚙</span><span>设置</span>
          <span v-if="tab === 'settings'" class="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-accent"></span>
        </RouterLink>
      </div>
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
@keyframes ktv-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.ktv-spin {
  animation: ktv-spin 6s linear infinite;
}
</style>
