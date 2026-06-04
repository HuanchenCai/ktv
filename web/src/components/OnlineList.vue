<script setup lang="ts">
import { onMounted, ref, watch, computed } from "vue";
import { api, type OnlineResult } from "../lib/api";

const source = ref<"yt" | "dy">("yt");
const q = ref("");
const results = ref<OnlineResult[]>([]);
const loading = ref(false);
const error = ref("");
const queuedIds = ref<Set<string>>(new Set());
const status = ref<{
  yt_dlp_installed: boolean;
  youtube_enabled: boolean;
  douyin_enabled: boolean;
} | null>(null);
const mode = ref<"hot" | "search">("hot");

async function loadStatus() {
  try {
    status.value = await api.onlineStatus();
  } catch {
    /* not fatal */
  }
}

async function loadHot() {
  loading.value = true;
  error.value = "";
  try {
    const r = await api.onlineHot(source.value, 50);
    results.value = r.results;
    mode.value = "hot";
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    results.value = [];
  } finally {
    loading.value = false;
  }
}

async function runSearch() {
  const query = q.value.trim();
  if (!query) {
    await loadHot();
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const r = await api.onlineSearch(source.value, query, 20);
    results.value = r.results;
    mode.value = "search";
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    results.value = [];
  } finally {
    loading.value = false;
  }
}

async function pickResult(r: OnlineResult, top = false) {
  const key = `${r.source}/${r.video_id}`;
  queuedIds.value.add(key);
  try {
    await api.onlineEnqueue({
      source: r.source,
      video_id: r.video_id,
      title: r.title,
      channel: r.channel,
      duration_seconds: r.duration_seconds,
      thumbnail: r.thumbnail,
      top,
    });
  } catch (err) {
    queuedIds.value.delete(key);
    error.value = err instanceof Error ? err.message : String(err);
  }
}

onMounted(async () => {
  await loadStatus();
  await loadHot();
});

watch(source, () => {
  q.value = "";
  loadHot();
});

let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(q, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 350);
});

function fmtDuration(s: number | null): string {
  if (!s || s < 0) return "";
  const mm = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

const showInstallHint = computed(
  () => status.value && !status.value.yt_dlp_installed,
);
</script>

<template>
  <div class="space-y-4">
    <!-- Source toggle (YouTube / Douyin) — sliding pill -->
    <div
      class="relative grid grid-cols-2 p-1 rounded-full backdrop-blur-md"
      style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06)"
    >
      <span
        class="absolute top-1 bottom-1 left-1 w-[calc(50%-0.25rem)] rounded-full transition-transform duration-300 ease-out"
        :style="{
          transform: source === 'dy' ? 'translateX(100%)' : 'translateX(0)',
          background: 'linear-gradient(135deg, #ef4444, #f97316)',
          boxShadow: '0 0 18px rgba(239,68,68,0.45), inset 0 1px 0 rgba(255,255,255,0.2)'
        }"
      ></span>
      <button
        class="relative z-10 py-2 text-sm font-medium transition-colors"
        :class="source === 'yt' ? 'text-white' : 'text-white/55'"
        @click="source = 'yt'"
      >
        ▶ YouTube
      </button>
      <button
        class="relative z-10 py-2 text-sm font-medium transition-colors"
        :class="source === 'dy' ? 'text-white' : 'text-white/55'"
        @click="source = 'dy'"
      >
        🎵 抖音
      </button>
    </div>

    <input
      v-model="q"
      class="input"
      placeholder="搜在线视频，留空看热榜"
      autocomplete="off"
      spellcheck="false"
      inputmode="search"
    />

    <div v-if="showInstallHint" class="card text-xs text-amber-300 space-y-2">
      <div class="font-semibold">线上模式需要 yt-dlp</div>
      <div class="text-white/60">
        Win: <code>winget install yt-dlp.yt-dlp</code><br />
        mac: <code>brew install yt-dlp</code>
      </div>
    </div>

    <div v-if="error" class="card text-rose-300 text-sm break-all">
      {{ error }}
    </div>

    <div class="flex items-center justify-between gap-2 pt-1">
      <h2 class="text-lg font-bold tracking-tight">
        {{ mode === "hot" ? (source === "yt" ? "YouTube 热榜" : "抖音热榜") : "搜索结果" }}
      </h2>
      <span v-if="results.length" class="text-white/40 text-xs tabular-nums">
        {{ results.length }}
      </span>
    </div>

    <div v-if="loading" class="text-white/55 text-sm">加载中...</div>

    <ul v-if="results.length" class="space-y-2">
      <li
        v-for="r in results"
        :key="`${r.source}/${r.video_id}`"
        class="relative rounded-2xl overflow-hidden backdrop-blur-md transition-all active:scale-[0.99]"
        :style="{
          background: 'linear-gradient(145deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
          border: '1px solid rgba(255,255,255,0.06)',
        }"
      >
        <div class="flex items-center gap-3 p-3">
          <div
            class="relative w-20 h-14 shrink-0 rounded-lg overflow-hidden ring-1 ring-white/10 bg-black/50"
          >
            <img
              v-if="r.thumbnail"
              :src="r.thumbnail"
              class="absolute inset-0 w-full h-full object-cover"
              loading="lazy"
              referrerpolicy="no-referrer"
            />
            <div
              v-else
              class="absolute inset-0 grid place-items-center text-white/60"
            >
              {{ r.source === "yt" ? "▶" : "🎵" }}
            </div>
            <span
              v-if="r.duration_seconds"
              class="absolute right-1 bottom-1 px-1 py-px text-[9px] rounded font-mono tabular-nums"
              style="background: rgba(0,0,0,0.7)"
            >
              {{ fmtDuration(r.duration_seconds) }}
            </span>
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-[14px] font-semibold leading-snug line-clamp-2 tracking-tight">
              {{ r.title }}
            </div>
            <div class="text-xs text-white/50 truncate mt-0.5">
              {{ r.channel || (r.source === "yt" ? "YouTube" : "抖音") }}
            </div>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <button
              v-if="!queuedIds.has(`${r.source}/${r.video_id}`)"
              aria-label="置顶"
              class="w-9 h-9 rounded-full grid place-items-center text-white/70 hover:text-white transition-colors"
              style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08)"
              @click="pickResult(r, true)"
            >
              ↑
            </button>
            <button
              class="rounded-full px-4 h-9 font-medium text-sm transition-all active:scale-[0.95]"
              :class="
                queuedIds.has(`${r.source}/${r.video_id}`)
                  ? 'text-white/50'
                  : 'text-white'
              "
              :style="
                queuedIds.has(`${r.source}/${r.video_id}`)
                  ? {
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.10)',
                    }
                  : {
                      background:
                        'linear-gradient(135deg, #ff2e6b, #d946ef)',
                      boxShadow:
                        '0 0 18px rgba(255,46,107,0.45), inset 0 1px 0 rgba(255,255,255,0.2)',
                    }
              "
              :disabled="queuedIds.has(`${r.source}/${r.video_id}`)"
              @click="pickResult(r, false)"
            >
              {{
                queuedIds.has(`${r.source}/${r.video_id}`) ? "已点" : "点歌"
              }}
            </button>
          </div>
        </div>
      </li>
    </ul>

    <div
      v-else-if="!loading && !error"
      class="text-center text-white/45 text-sm py-12 space-y-2"
    >
      <div class="text-3xl">🌐</div>
      <div>没找到</div>
    </div>
  </div>
</template>
