<script setup lang="ts">
import SongList from "../components/SongList.vue";
</script>

<template>
  <div class="p-4">
    <SongList variant="row" :limit="50" />
  </div>
</template>
