<script setup lang="ts">
import { onMounted, ref, computed } from "vue";
import { useRouter } from "vue-router";

type Row = { artist: string; count: number; portrait: string | null };

const all = ref<Row[]>([]);
const error = ref("");
const q = ref("");

const router = useRouter();

async function load() {
  try {
    const res = await fetch("/api/artists").then((r) => r.json());
    all.value = res.artists ?? [];
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

onMounted(load);

const filtered = computed(() => {
  const term = q.value.trim().toLowerCase();
  if (!term) return all.value;
  return all.value.filter((r) => r.artist.toLowerCase().includes(term));
});

// Stable per-artist accent color tile for the fallback avatar.
function colorFor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  const hues = [340, 200, 160, 280, 30, 0, 220, 50, 100, 320];
  return `hsl(${hues[Math.abs(h) % hues.length]}, 60%, 22%)`;
}

function pickArtist(a: string) {
  // /tv on desktop, /search on phone — use viewport width as the heuristic
  // for which home to deep-link back to.
  const isWide = window.innerWidth >= 1024;
  router.push({ path: isWide ? "/tv" : "/search", query: { artist: a } });
}

const haveAny = computed(() => filtered.value.some((r) => !!r.portrait));
const haveCounts = computed(() => ({
  withPortrait: all.value.filter((r) => r.portrait).length,
  total: all.value.length,
}));
</script>

<template>
  <div class="p-4 lg:p-6 space-y-4">
    <div class="flex items-baseline justify-between">
      <h1 class="text-2xl font-bold">全部歌手</h1>
      <span class="text-xs text-muted">
        {{ filtered.length }} / {{ haveCounts.total }} 位
        <span v-if="haveCounts.total" class="text-muted/70">
          · {{ haveCounts.withPortrait }} 张头像
        </span>
      </span>
    </div>

    <input
      v-model="q"
      class="input"
      placeholder="搜歌手名"
      autocomplete="off"
      spellcheck="false"
    />

    <div v-if="error" class="text-rose-400 text-sm">{{ error }}</div>

    <div
      v-if="filtered.length"
      class="grid gap-3 grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8"
    >
      <button
        v-for="row in filtered"
        :key="row.artist"
        class="group flex flex-col items-center text-center gap-2 p-2 rounded-xl hover:bg-panel-hover transition-colors"
        @click="pickArtist(row.artist)"
      >
        <div
          class="relative w-20 h-20 lg:w-24 lg:h-24 rounded-full overflow-hidden ring-1 ring-border group-hover:ring-accent transition-all"
          :style="!row.portrait ? { background: colorFor(row.artist) } : undefined"
        >
          <img
            v-if="row.portrait"
            :src="row.portrait"
            :alt="row.artist"
            class="w-full h-full object-cover"
            loading="lazy"
          />
          <div
            v-else
            class="w-full h-full grid place-items-center text-2xl font-bold text-white/90"
          >
            {{ row.artist[0] }}
          </div>
        </div>
        <div class="font-medium text-sm leading-tight truncate w-full">
          {{ row.artist }}
        </div>
        <div class="text-[11px] text-muted">{{ row.count }} 首</div>
      </button>
    </div>

    <div
      v-else-if="!error"
      class="text-center text-muted py-8 text-sm"
    >
      没找到
    </div>

    <div
      v-if="all.length && !haveAny"
      class="text-xs text-muted text-center pt-4 border-t border-border/50"
    >
      头像还没抓取。去
      <RouterLink to="/admin" class="text-accent">管理页</RouterLink>
      点"抓取歌手头像"。
    </div>
  </div>
</template>
