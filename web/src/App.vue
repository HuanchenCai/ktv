<script setup lang="ts">
import { onMounted, computed } from "vue";
import { useRoute, RouterView, RouterLink } from "vue-router";
import { startWs, wsStatus } from "./lib/ws";
import MiniPlayer from "./components/MiniPlayer.vue";

onMounted(() => startWs());

const route = useRoute();
const tab = computed(() => route.path.split("/")[1] ?? "search");
const isTv = computed(() => route.meta?.layout === "tv");
const isPhoneTabRoute = computed(() =>
  ["/search", "/queue", "/now"].some((p) => route.path.startsWith(p)),
);

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
        'flex items-center justify-between border-b border-border/60 backdrop-blur-md',
        isTv ? 'px-8 py-4 bg-bg/40' : 'px-4 py-3 sticky top-0 bg-bg/80 z-30',
      ]"
    >
      <div class="flex items-center gap-3">
        <div
          :class="[
            'rounded-xl bg-accent shadow-glow grid place-items-center',
            isTv ? 'w-9 h-9 text-lg' : 'w-8 h-8 text-sm rounded-lg',
          ]"
        >
          🎤
        </div>
        <div>
          <div
            :class="[
              'font-bold tracking-wide leading-none',
              isTv ? 'text-xl' : '',
            ]"
          >
            KTV
          </div>
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
                  ? "在线"
                  : wsStatus === "connecting"
                    ? "连接中"
                    : "已断开"
              }}
            </span>
          </div>
        </div>
      </div>
      <nav
        class="flex items-center gap-2.5 text-xs text-muted"
        :class="isTv ? '' : 'gap-1.5'"
      >
        <RouterLink
          to="/tv"
          class="hover:text-white transition-colors px-1.5 py-1 rounded"
          active-class="text-white bg-panel"
        >
          📺 TV
        </RouterLink>
        <RouterLink
          to="/library"
          class="hover:text-white transition-colors px-1.5 py-1 rounded"
          active-class="text-white bg-panel"
        >
          📚 曲库
        </RouterLink>
        <RouterLink
          to="/artists"
          class="hover:text-white transition-colors px-1.5 py-1 rounded"
          active-class="text-white bg-panel"
        >
          👤 歌手
        </RouterLink>
        <RouterLink
          to="/admin"
          class="hover:text-white transition-colors px-1.5 py-1 rounded"
          active-class="text-white bg-panel"
        >
          ⚙ 管理
        </RouterLink>
      </nav>
    </header>

    <main
      class="flex-1 overflow-y-auto"
      :class="isTv ? '' : isPhoneTabRoute ? 'pb-32' : 'pb-4'"
    >
      <RouterView v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </RouterView>
    </main>

    <!-- Phone-only: mini player above tab bar when on a phone-tab route -->
    <MiniPlayer v-if="isPhoneTabRoute" />

    <!-- Phone tab bar: only on the three phone-driven routes -->
    <nav
      v-if="isPhoneTabRoute"
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
