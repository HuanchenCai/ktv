<script setup lang="ts">
import { onMounted, ref, computed } from "vue";
import { useRouter } from "vue-router";

type Row = { artist: string; count: number };

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

// Stable per-artist accent color tile.
function colorFor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  const hues = [340, 200, 160, 280, 30, 0, 220, 50, 100, 320];
  return `hsl(${hues[Math.abs(h) % hues.length]}, 60%, 22%)`;
}

function pickArtist(a: string) {
  // Send the user back to the appropriate home with this artist filter.
  // /tv on desktop, /search on phone — we look at the previous route's
  // path if any, else fall back to width-based.
  const isWide = window.innerWidth >= 1024;
  router.push({ path: isWide ? "/tv" : "/search", query: { artist: a } });
}
</script>

<template>
  <div class="p-4 lg:p-6 space-y-4">
    <div class="flex items-baseline justify-between">
      <h1 class="text-2xl font-bold">全部歌手</h1>
      <span class="text-xs text-muted">{{ filtered.length }} 位</span>
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
      class="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
    >
      <button
        v-for="row in filtered"
        :key="row.artist"
        class="card-hoverable flex flex-col items-center text-center gap-2 p-3"
        @click="pickArtist(row.artist)"
      >
        <div
          class="w-14 h-14 rounded-full grid place-items-center text-xl font-bold"
          :style="{ background: colorFor(row.artist) }"
        >
          {{ row.artist[0] }}
        </div>
        <div class="font-medium text-sm leading-tight truncate w-full">
          {{ row.artist }}
        </div>
        <div class="text-[11px] text-muted">{{ row.count }} 首</div>
      </button>
    </div>

    <div v-else-if="!error" class="text-center text-muted py-8 text-sm">
      没找到
    </div>
  </div>
</template>
