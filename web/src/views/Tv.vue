<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import QueueList from "../components/QueueList.vue";
import NowPlayingCard from "../components/NowPlayingCard.vue";
import Controls from "../components/Controls.vue";
import QrPanel from "../components/QrPanel.vue";
import ArtistSongs from "../components/ArtistSongs.vue";
import PopularArtistsVerticalList from "../components/PopularArtistsVerticalList.vue";

const route = useRoute();
const router = useRouter();

const focusedArtist = computed(
  () => (route.query.artist as string | undefined) ?? null,
);

function clearArtistFilter() {
  const query = { ...route.query };
  delete query.artist;
  router.replace({ path: route.path, query });
}
</script>

<template>
  <!-- 3-column layout, full viewport. No vertical scroll on the page itself —
       individual columns scroll when their content overflows. -->
  <div
    class="grid h-full gap-4 p-4"
    style="grid-template-columns: 280px 1fr 360px"
  >
    <!-- LEFT: artist directory -->
    <aside class="card p-3 flex flex-col min-h-0 overflow-hidden">
      <PopularArtistsVerticalList />
    </aside>

    <!-- MIDDLE: songs of focused artist (or hint when none) -->
    <section class="flex flex-col min-h-0 overflow-hidden">
      <div
        v-if="focusedArtist"
        class="flex-1 overflow-y-auto pr-2 -mr-2 min-h-0"
      >
        <div class="flex justify-end mb-1">
          <button
            class="text-xs text-muted hover:text-white transition-colors"
            @click="clearArtistFilter"
          >
            × 清除筛选
          </button>
        </div>
        <ArtistSongs :key="focusedArtist" :artist="focusedArtist" />
      </div>
      <div
        v-else
        class="flex-1 grid place-items-center text-muted"
      >
        <div class="text-center space-y-3">
          <div class="text-6xl">👈</div>
          <div class="text-lg">点左边歌手看歌单</div>
          <div class="text-xs">
            手机扫右边二维码也能搜歌点歌
          </div>
        </div>
      </div>
    </section>

    <!-- RIGHT: now-playing + QR + controls + queue, all stacked compactly -->
    <aside class="flex flex-col gap-3 min-h-0 overflow-hidden">
      <NowPlayingCard size="card" />
      <QrPanel size="hero" />
      <Controls />
      <div class="flex-1 overflow-y-auto min-h-0">
        <h3 class="h-section mb-2">接下来</h3>
        <QueueList variant="compact" :limit="6" />
      </div>
    </aside>
  </div>
</template>
