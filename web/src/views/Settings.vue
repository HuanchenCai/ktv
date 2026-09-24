<script setup lang="ts">
import { computed } from "vue";
import { useRoute, RouterLink } from "vue-router";
import Admin from "./Admin.vue";
import Library from "./Library.vue";

const route = useRoute();
const section = computed(() => route.query.tab === "room" ? "room" : "library");
</script>

<template>
  <div class="mx-auto w-full max-w-6xl px-4 pb-8 pt-5">
    <div class="mb-5">
      <p class="text-xs uppercase tracking-[0.2em] text-muted">HOST SETTINGS</p>
      <h1 class="mt-1 text-2xl font-semibold">房主设置</h1>
      <p class="mt-1 text-sm text-muted">在手机或平板管理曲库；播放电脑可专门连接电视。</p>
    </div>
    <nav aria-label="设置分类" class="mb-5 flex gap-2 overflow-x-auto border-b border-border pb-3">
      <RouterLink to="/settings?tab=library" class="chip chip-default" :class="{ '!border-accent !text-white': section === 'library' }">曲库与歌源</RouterLink>
      <RouterLink to="/settings?tab=room" class="chip chip-default" :class="{ '!border-accent !text-white': section === 'room' }">房间与设备</RouterLink>
    </nav>
    <Library v-if="section === 'library'" />
    <Admin v-else />
  </div>
</template>
