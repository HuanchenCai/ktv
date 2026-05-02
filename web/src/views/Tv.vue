<script setup lang="ts">
import { ref, onMounted } from "vue";
import QueueList from "../components/QueueList.vue";
import NowPlayingCard from "../components/NowPlayingCard.vue";
import Controls from "../components/Controls.vue";
import QrPanel from "../components/QrPanel.vue";
import PopularArtistsRail from "../components/PopularArtistsRail.vue";
import SongRail from "../components/SongRail.vue";

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

// Each rail's query — last_played requires it to be non-null, so use
// cached_only to filter to songs that exist on disk.
const rails = [
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
        <PopularArtistsRail size="hero" />
        <SongRail
          v-for="r in rails"
          :key="r.title"
          :title="r.title"
          :query-string="r.qs"
          :portraits="portraits"
        />
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
