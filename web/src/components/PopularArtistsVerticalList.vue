<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../lib/api";

type Row = { artist: string; count: number; portrait: string | null };

const route = useRoute();
const router = useRouter();
const items = ref<Row[]>([]);
const selected = ref<string | null>(
  (route.query.artist as string | undefined) ?? null,
);

async function load() {
  try {
    const r = await api.popularArtists();
    items.value = r.artists;
  } catch {
    /* not fatal */
  }
}

onMounted(load);

function colorFor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  const hues = [340, 200, 160, 280, 30, 0, 220, 50, 100, 320];
  return `hsl(${hues[Math.abs(h) % hues.length]}, 60%, 22%)`;
}

function pick(a: string) {
  const next = selected.value === a ? null : a;
  selected.value = next;
  const query = { ...route.query };
  if (next) query.artist = next;
  else delete query.artist;
  router.replace({ path: route.path, query });
}

function openAll() {
  router.push("/artists");
}
</script>

<template>
  <div class="flex flex-col h-full min-h-0">
    <div class="flex items-baseline justify-between mb-2 shrink-0 px-1">
      <h3 class="h-section">流行歌手</h3>
      <button
        class="text-xs text-muted hover:text-white transition-colors"
        @click="openAll"
      >
        全部 →
      </button>
    </div>
    <ul
      v-if="items.length"
      class="flex-1 overflow-y-auto pr-1 space-y-0.5 min-h-0"
    >
      <li v-for="r in items" :key="r.artist">
        <button
          class="w-full flex items-center gap-3 px-2 py-1.5 rounded-lg transition-colors text-left"
          :class="
            selected === r.artist
              ? 'bg-accent/15 ring-1 ring-accent/40'
              : 'hover:bg-panel-hover/60'
          "
          @click="pick(r.artist)"
        >
          <div
            class="w-9 h-9 rounded-full overflow-hidden shrink-0"
            :style="!r.portrait ? { background: colorFor(r.artist) } : undefined"
          >
            <img
              v-if="r.portrait"
              :src="r.portrait"
              :alt="r.artist"
              class="w-full h-full object-cover"
              loading="lazy"
            />
            <div
              v-else
              class="w-full h-full grid place-items-center font-bold text-white/90 text-sm"
            >
              {{ r.artist[0] }}
            </div>
          </div>
          <div class="flex-1 min-w-0">
            <div
              class="text-sm font-medium truncate"
              :class="selected === r.artist ? 'text-accent' : ''"
            >
              {{ r.artist }}
            </div>
          </div>
          <span class="text-[11px] text-muted tabular-nums">
            {{ r.count }}
          </span>
        </button>
      </li>
    </ul>
    <div v-else class="text-xs text-muted px-2 py-2">尚无</div>
  </div>
</template>
