<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api, type Song } from "../lib/api";

const props = withDefaults(
  defineProps<{
    title: string;
    /** Query string appended to /api/library/songs. */
    queryString: string;
    /** Optional artist→portrait map to render artwork. */
    portraits?: Map<string, string>;
    /** "title" routes to /search?artist= when clicking the title link. */
    seeAllPath?: string;
  }>(),
  { portraits: () => new Map() },
);

const songs = ref<Song[]>([]);
const loading = ref(true);
const queuedIds = ref<Set<number>>(new Set());
const router = useRouter();

async function load() {
  try {
    const res = await fetch(`/api/library/songs?${props.queryString}`).then(
      (r) => r.json(),
    );
    songs.value = (res.songs ?? []) as Song[];
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function enqueue(s: Song) {
  if (queuedIds.value.has(s.id)) return;
  queuedIds.value.add(s.id);
  try {
    await api.enqueue(s.id);
  } catch {
    queuedIds.value.delete(s.id);
  }
}
async function enqueueTop(s: Song) {
  if (queuedIds.value.has(s.id)) return;
  queuedIds.value.add(s.id);
  try {
    await api.enqueue(s.id, { top: true });
  } catch {
    queuedIds.value.delete(s.id);
  }
}

function colorFor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  const hues = [340, 200, 160, 280, 30, 0, 220, 50, 100, 320];
  return `hsl(${hues[Math.abs(h) % hues.length]}, 60%, 22%)`;
}

function goSeeAll() {
  if (props.seeAllPath) router.push(props.seeAllPath);
}
</script>

<template>
  <section v-if="songs.length || loading" class="space-y-2">
    <div class="flex items-baseline justify-between">
      <h3 class="h-section">{{ title }}</h3>
      <button
        v-if="seeAllPath"
        class="text-xs text-muted hover:text-white transition-colors"
        @click="goSeeAll"
      >
        全部 →
      </button>
    </div>

    <div
      v-if="songs.length"
      class="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scroll-smooth"
    >
      <div
        v-for="s in songs"
        :key="s.id"
        class="shrink-0 w-44 group"
      >
        <div class="card-hoverable p-3 space-y-2">
          <div
            class="aspect-square rounded-lg overflow-hidden grid place-items-center text-3xl font-bold relative"
            :style="
              !portraits.get(s.artist)
                ? { background: colorFor(s.artist) }
                : undefined
            "
          >
            <img
              v-if="portraits.get(s.artist)"
              :src="portraits.get(s.artist)!"
              :alt="s.artist"
              class="absolute inset-0 w-full h-full object-cover"
              loading="lazy"
            />
            <div
              v-if="portraits.get(s.artist)"
              class="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent"
            ></div>
            <span v-if="!portraits.get(s.artist)" class="opacity-90">
              {{ s.title[0] }}
            </span>
          </div>
          <div class="min-w-0">
            <div class="truncate text-sm font-medium">{{ s.title }}</div>
            <div class="text-xs text-muted truncate">{{ s.artist }}</div>
          </div>
          <div class="flex gap-1.5">
            <button
              class="btn-primary text-xs flex-1 py-1 px-2"
              :disabled="queuedIds.has(s.id)"
              @click="enqueue(s)"
            >
              {{ queuedIds.has(s.id) ? "已点" : "点歌" }}
            </button>
            <button
              class="btn-ghost text-xs px-2 py-1"
              :disabled="queuedIds.has(s.id)"
              @click="enqueueTop(s)"
              title="插到下一首"
            >
              ↑
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="!loading" class="text-xs text-muted px-1">— 暂无 —</div>
  </section>
</template>
