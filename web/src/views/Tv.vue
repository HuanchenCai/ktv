<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import QueueList from "../components/QueueList.vue";
import NowPlayingCard from "../components/NowPlayingCard.vue";
import Controls from "../components/Controls.vue";
import QrPanel from "../components/QrPanel.vue";
import PopularArtistsRail from "../components/PopularArtistsRail.vue";
import SongRail from "../components/SongRail.vue";
import ArtistSongs from "../components/ArtistSongs.vue";

const route = useRoute();
const router = useRouter();
const portraits = ref<Map<string, string>>(new Map());

async function loadPortraits() {
  try {
    const r = (await fetch("/api/artists").then((rr) => rr.json())) as {
      artists: Array<{ artist: string; portrait: string | null }>;
    };
    const m = new Map<string, string>();
    for (const a of r.artists) {
      if (a.portrait) m.set(a.artist, a.portrait);
    }
    portraits.value = m;
  } catch {
    /* not fatal */
  }
}

onMounted(loadPortraits);

const focusedArtist = computed(
  () => (route.query.artist as string | undefined) ?? null,
);

function clearArtistFilter() {
  const query = { ...route.query };
  delete query.artist;
  router.replace({ path: route.path, query });
}

// Default rails when no artist is focused.
const defaultRails = [
  {
    title: "最近唱过",
    qs: "sort=last_played_at&order=desc&limit=20&cached_only=1",
  },
  { title: "国语流行", qs: "lang=国语&limit=20" },
  { title: "粤语经典", qs: "lang=粤语&limit=20" },
  {
    title: "新进库",
    qs: "sort=id&order=desc&limit=20",
  },
];
</script>

<template>
  <div class="flex h-full gap-6 p-6 overflow-hidden">
    <!-- LEFT: hero + rails -->
    <section class="flex-1 flex flex-col min-w-0 overflow-hidden">
      <NowPlayingCard size="hero" />
      <div class="mt-6 flex-1 overflow-y-auto pr-3 -mr-3 min-h-0 space-y-7">
        <!-- Already-queued strip: always visible at the top -->
        <section>
          <h3 class="h-section mb-3">已点歌单</h3>
          <QueueList variant="compact" :limit="6" />
        </section>

        <PopularArtistsRail size="hero" />

        <!-- When user clicks an artist chip, show their songs as a compact
             two-column text list — many songs visible at once, no per-row
             portrait noise (it'd be the same face repeated). -->
        <template v-if="focusedArtist">
          <div class="flex items-baseline justify-end -mt-1 -mb-2">
            <button
              class="text-xs text-muted hover:text-white transition-colors"
              @click="clearArtistFilter"
            >
              × 清除筛选
            </button>
          </div>
          <ArtistSongs :key="focusedArtist" :artist="focusedArtist" />
        </template>

        <!-- Default discovery rails when no artist focused -->
        <template v-else>
          <SongRail
            v-for="r in defaultRails"
            :key="r.title"
            :title="r.title"
            :query-string="r.qs"
            :portraits="portraits"
          />
        </template>
      </div>
    </section>

    <!-- RIGHT: control sidebar -->
    <aside class="w-[380px] flex flex-col gap-5 min-h-0 shrink-0">
      <QrPanel size="hero" />
      <Controls />
      <div class="flex-1 overflow-y-auto min-h-0">
        <h3 class="h-section mb-3">接下来</h3>
        <QueueList variant="compact" :limit="8" />
      </div>
    </aside>
  </div>
</template>
