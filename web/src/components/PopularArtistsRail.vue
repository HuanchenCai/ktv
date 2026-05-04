<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../lib/api";

withDefaults(
  defineProps<{
    /** "compact" (phone, ~64px circles) | "hero" (TV, ~120px circles) */
    size?: "compact" | "hero";
  }>(),
  { size: "compact" },
);

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
  <div class="space-y-2">
    <div class="flex items-baseline justify-between">
      <h3 class="h-section">流行歌手</h3>
      <button
        class="text-xs text-muted hover:text-white transition-colors"
        @click="openAll"
      >
        全部 →
      </button>
    </div>
    <div v-if="!items.length" class="text-xs text-muted">尚未抓取头像</div>
    <div
      v-else
      class="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scroll-smooth"
    >
      <button
        v-for="r in items"
        :key="r.artist"
        class="shrink-0 flex flex-col items-center gap-1.5 group"
        @click="pick(r.artist)"
      >
        <div
          class="rounded-full overflow-hidden ring-2 transition-all"
          :class="[
            size === 'hero' ? 'w-24 h-24' : 'w-16 h-16',
            selected === r.artist
              ? 'ring-accent shadow-glow'
              : 'ring-border group-hover:ring-accent/60',
          ]"
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
            class="w-full h-full grid place-items-center font-bold text-white/90"
            :class="size === 'hero' ? 'text-3xl' : 'text-xl'"
          >
            {{ r.artist[0] }}
          </div>
        </div>
        <div
          class="font-medium text-center leading-tight truncate"
          :class="[
            size === 'hero' ? 'text-sm w-24' : 'text-xs w-16',
            selected === r.artist ? 'text-accent' : 'text-white/90',
          ]"
        >
          {{ r.artist }}
        </div>
        <div
          class="text-[10px] text-muted"
          :class="size === 'hero' ? 'text-[11px]' : ''"
        >
          {{ r.count }} 首
        </div>
      </button>
    </div>
  </div>
</template>
