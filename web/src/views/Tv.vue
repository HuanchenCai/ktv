<script setup lang="ts">
import SongList from "../components/SongList.vue";
import QueueList from "../components/QueueList.vue";
import NowPlayingCard from "../components/NowPlayingCard.vue";
import Controls from "../components/Controls.vue";
import QrPanel from "../components/QrPanel.vue";
</script>

<template>
  <div class="h-full grid grid-cols-[1fr_360px] grid-rows-[1fr_auto] gap-4 p-6">
    <!-- main: song library -->
    <div class="overflow-y-auto pr-2">
      <h2 class="text-lg font-semibold mb-3">曲库</h2>
      <SongList
        variant="card"
        grid-class="grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
        :limit="200"
      />
    </div>

    <!-- right column: now playing + controls + QR -->
    <aside class="flex flex-col gap-4 overflow-y-auto">
      <NowPlayingCard size="hero" />
      <Controls />
      <QrPanel size="hero" />
    </aside>

    <!-- bottom: upcoming queue strip -->
    <section class="col-span-2 border-t border-white/5 pt-4">
      <div class="flex items-baseline justify-between mb-2">
        <h2 class="text-sm font-semibold text-muted">接下来</h2>
      </div>
      <QueueList variant="compact" :limit="6" />
    </section>
  </div>
</template>
