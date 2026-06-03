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
        'flex items-center justify-between glass-bar border-b',
        isTv ? 'px-8 py-4' : 'px-4 py-3 sticky top-0 z-30',
      ]"
    >
      <RouterLink
        to="/"
        class="flex items-center gap-3 group"
        title="回主页"
      >
        <!-- A spinning vinyl + glowing tonearm. Pure CSS so it's crisp at
             any size and free from external assets. The needle picks up
             the accent ring on hover. -->
        <div
          :class="[
            'relative shrink-0 grid place-items-center',
            isTv ? 'w-10 h-10' : 'w-9 h-9',
          ]"
        >
          <div
            class="absolute inset-0 rounded-full bg-gradient-to-br from-accent/80 to-fuchsia-500 shadow-glow group-hover:shadow-[0_0_22px_rgba(236,72,153,0.55)] transition-shadow"
          ></div>
          <div
            class="absolute inset-[14%] rounded-full bg-bg/80 ring-1 ring-white/10 ktv-spin"
            style="
              background-image:
                repeating-radial-gradient(
                  rgba(255,255,255,0.05) 0,
                  rgba(255,255,255,0.05) 1px,
                  transparent 1px,
                  transparent 3px
                );
            "
          ></div>
          <div
            class="absolute inset-[44%] rounded-full bg-amber-300 shadow-[0_0_6px_rgba(251,191,36,0.7)]"
          ></div>
        </div>
        <div>
          <div
            :class="[
              'font-bold tracking-wider leading-none bg-clip-text text-transparent bg-gradient-to-r from-fuchsia-300 via-accent to-amber-300',
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
      </RouterLink>
      <!-- Phone uses the bottom tab bar (搜歌/已点/播放), and the desktop-
           oriented routes (曲库/歌手/管理) don't fit the phone layout, so
           the top nav is desktop-only. -->
      <nav
        v-if="!isPhoneTabRoute"
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

    <!-- Phone tab bar: only on the three phone-driven routes. Glass
         surface lifted slightly off the bottom so it floats. -->
    <nav
      v-if="isPhoneTabRoute"
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
