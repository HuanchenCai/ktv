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

import { artistColor as colorFor } from "../lib/artist-color";

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
  <div class="space-y-3">
    <div class="flex items-baseline justify-between">
      <h3 class="h-section">流行歌手</h3>
      <button
        class="text-xs text-white/50 hover:text-white transition-colors flex items-center gap-1"
        @click="openAll"
      >
        全部 <span aria-hidden="true">→</span>
      </button>
    </div>
    <div v-if="!items.length" class="text-xs text-white/40">尚未抓取头像</div>
    <div
      v-else
      class="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1 scroll-smooth"
    >
      <button
        v-for="r in items"
        :key="r.artist"
        class="shrink-0 flex flex-col items-center gap-2 group"
        @click="pick(r.artist)"
      >
        <!-- Halo wrap so a glow can sit OUTSIDE the circle clip -->
        <div
          class="relative rounded-full transition-all duration-300"
          :class="[
            size === 'hero' ? 'w-24 h-24' : 'w-[72px] h-[72px]',
            selected === r.artist ? 'scale-105' : 'group-hover:scale-105',
          ]"
        >
          <!-- Glow ring -->
          <div
            v-if="selected === r.artist"
            class="absolute inset-0 rounded-full"
            style="
              background: conic-gradient(from 0deg, #ff2e6b, #d946ef, #8b5cf6, #22d3ee, #ff2e6b);
              filter: blur(8px);
              opacity: 0.7;
            "
          ></div>
          <!-- Solid ring -->
          <div
            class="absolute inset-0 rounded-full transition-all"
            :class="selected === r.artist ? '' : 'ring-1 ring-white/10 group-hover:ring-white/25'"
            :style="
              selected === r.artist
                ? 'background: linear-gradient(135deg, #ff2e6b, #d946ef); padding: 2.5px;'
                : ''
            "
          ></div>
          <!-- Image clipped inside -->
          <div
            class="absolute inset-0 rounded-full overflow-hidden"
            :class="selected === r.artist ? 'm-[2.5px]' : ''"
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
        </div>
        <div
          class="font-medium text-center leading-tight truncate"
          :class="[
            size === 'hero' ? 'text-sm w-24' : 'text-xs w-[72px]',
            selected === r.artist ? 'text-gradient-brand font-semibold' : 'text-white/90',
          ]"
        >
          {{ r.artist }}
        </div>
        <div
          class="text-[10px] text-white/40 tabular-nums -mt-1"
          :class="size === 'hero' ? 'text-[11px]' : ''"
        >
          {{ r.count }}
        </div>
      </button>
    </div>
  </div>
</template>
