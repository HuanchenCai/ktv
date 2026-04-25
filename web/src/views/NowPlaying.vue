<script setup lang="ts">
import NowPlayingCard from "../components/NowPlayingCard.vue";
import Controls from "../components/Controls.vue";
</script>

<template>
  <div class="p-4 space-y-4">
    <NowPlayingCard size="card" />
    <Controls />
  </div>
</template>
