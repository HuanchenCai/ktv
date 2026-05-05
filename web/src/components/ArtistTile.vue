<script setup lang="ts">
import { artistColor } from "../lib/artist-color";

withDefaults(
  defineProps<{
    name: string;
    portrait: string | null;
    /** Tailwind w/h class pair for the circular tile (e.g. 'w-20 h-20'). */
    sizeClass?: string;
    /** Tailwind size for the fallback initial inside the circle. */
    initialClass?: string;
  }>(),
  { sizeClass: "w-20 h-20", initialClass: "text-2xl" },
);
</script>

<template>
  <div
    class="rounded-full overflow-hidden ring-1 ring-border group-hover:ring-accent transition-all"
    :class="sizeClass"
    :style="!portrait ? { background: artistColor(name) } : undefined"
  >
    <img
      v-if="portrait"
      :src="portrait"
      :alt="name"
      class="w-full h-full object-cover"
      loading="lazy"
    />
    <div
      v-else
      class="w-full h-full grid place-items-center font-bold text-white/90"
      :class="initialClass"
    >
      {{ name[0] }}
    </div>
  </div>
</template>
