<script setup lang="ts">
import SongList from "../components/SongList.vue";
import QueueList from "../components/QueueList.vue";
import NowPlayingCard from "../components/NowPlayingCard.vue";
import Controls from "../components/Controls.vue";
import QrPanel from "../components/QrPanel.vue";
</script>

<template>
  <div class="flex h-full gap-6 p-6 overflow-hidden">
    <!-- LEFT: hero + library catalog -->
    <section class="flex-1 flex flex-col min-w-0">
      <NowPlayingCard size="hero" />
      <div class="mt-6 flex-1 overflow-y-auto pr-3 -mr-3 min-h-0">
        <h2 class="h-section mb-4">曲库</h2>
        <SongList
          variant="card"
          grid-class="grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
          :limit="200"
        />
      </div>
    </section>

    <!-- RIGHT: sticky control column -->
    <aside class="w-[400px] flex flex-col gap-5 min-h-0 shrink-0">
      <QrPanel size="hero" />
      <Controls />
      <div class="flex-1 overflow-y-auto min-h-0">
        <h2 class="h-section mb-3">接下来</h2>
        <QueueList variant="compact" :limit="8" />
      </div>
    </aside>
  </div>
</template>
