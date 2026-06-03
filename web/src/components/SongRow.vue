<script setup lang="ts">
import type { Song } from "../lib/api";
import { artistColor } from "../lib/artist-color";

defineProps<{
  song: Song;
  /** Whether the user has already clicked one of the queue buttons. */
  queued?: boolean;
  /** Visual variant: "row" (compact, phone) or "card" (grid cell, TV). */
  variant?: "row" | "card";
  /** Optional portrait URL for the artist; falls back to color tile. */
  artistPortrait?: string | null;
}>();

const emit = defineEmits<{
  (e: "queue", song: Song): void;
  (e: "top", song: Song): void;
}>();

function onQueue(song: Song) {
  emit("queue", song);
}
function onTop(song: Song) {
  emit("top", song);
}

function initialFor(s: string): string {
  return s ? s[0].toUpperCase() : "?";
}
</script>

<template>
  <!-- PHONE ROW: portrait as cover thumbnail, big title, accent CTA, "more" disclosure for 置顶 -->
  <li
    v-if="variant !== 'card'"
    class="relative group rounded-2xl overflow-hidden backdrop-blur-md transition-all active:scale-[0.99]"
    :style="{
      background: 'linear-gradient(145deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
      border: '1px solid rgba(255,255,255,0.06)',
    }"
  >
    <!-- subtle accent bar on the left when cached -->
    <div
      v-if="song.cached"
      class="absolute left-0 top-3 bottom-3 w-0.5 rounded-r"
      style="background: linear-gradient(to bottom, #10b981, transparent)"
    ></div>

    <div class="flex items-center gap-3 p-3">
      <!-- Cover thumb -->
      <div
        class="relative w-14 h-14 rounded-xl shrink-0 overflow-hidden ring-1 ring-white/10"
        :style="!artistPortrait ? { background: artistColor(song.artist) } : undefined"
      >
        <img
          v-if="artistPortrait"
          :src="artistPortrait"
          :alt="song.artist"
          class="w-full h-full object-cover"
          loading="lazy"
        />
        <span
          v-else
          class="absolute inset-0 grid place-items-center text-xl font-bold text-white/85"
        >
          {{ initialFor(song.artist) }}
        </span>
      </div>

      <!-- Title + meta -->
      <div class="flex-1 min-w-0">
        <div class="truncate font-semibold text-[15px] leading-tight tracking-tight">
          {{ song.title }}
        </div>
        <div class="text-xs text-white/55 truncate mt-0.5 flex items-center gap-1.5">
          <span>{{ song.artist }}</span>
          <span v-if="song.lang" class="text-white/30">·</span>
          <span v-if="song.lang">{{ song.lang }}</span>
          <span
            v-if="song.cached"
            class="ml-1 px-1.5 py-px rounded-full text-[10px] font-medium text-emerald-300"
            style="background: rgba(16,185,129,0.12); border: 1px solid rgba(16,185,129,0.25)"
          >
            ●
          </span>
        </div>
      </div>

      <!-- Single round CTA, secondary "top" tucked into an icon button -->
      <div class="flex items-center gap-1.5 shrink-0">
        <button
          v-if="!queued"
          aria-label="置顶"
          class="w-9 h-9 rounded-full grid place-items-center text-white/70 hover:text-white transition-colors"
          style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08)"
          @click="onTop(song)"
        >
          ↑
        </button>
        <button
          class="rounded-full px-4 h-9 font-medium text-sm transition-all active:scale-[0.95]"
          :class="queued ? 'text-white/50' : 'text-white'"
          :style="queued
            ? { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.10)' }
            : {
                background: 'linear-gradient(135deg, #ff2e6b, #d946ef)',
                boxShadow: '0 0 18px rgba(255,46,107,0.45), inset 0 1px 0 rgba(255,255,255,0.2)',
              }"
          :disabled="queued"
          @click="onQueue(song)"
        >
          {{ queued ? "已点" : "点歌" }}
        </button>
      </div>
    </div>
  </li>

  <!-- DESKTOP CARD: portrait covers the whole tile, title overlays the gradient bottom -->
  <li
    v-else
    class="card-hoverable flex flex-col gap-3 p-0 overflow-hidden"
  >
    <div
      class="aspect-square relative grid place-items-center text-5xl font-bold"
      :style="!artistPortrait ? { background: artistColor(song.artist) } : undefined"
    >
      <img
        v-if="artistPortrait"
        :src="artistPortrait"
        :alt="song.artist"
        class="absolute inset-0 w-full h-full object-cover"
        loading="lazy"
      />
      <div
        class="absolute inset-0"
        style="background: linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.2) 50%, transparent 100%)"
      ></div>
      <span v-if="!artistPortrait" class="opacity-90 relative">
        {{ initialFor(song.title) }}
      </span>
      <div class="absolute bottom-3 left-3 right-3">
        <div class="truncate text-base font-semibold leading-tight">
          {{ song.title }}
        </div>
        <div class="text-xs text-white/70 truncate mt-0.5 flex items-center gap-1.5">
          <span>{{ song.artist }}</span>
          <span v-if="song.lang" class="text-white/40">·</span>
          <span v-if="song.lang">{{ song.lang }}</span>
          <span v-if="song.cached" class="text-emerald-300">●</span>
        </div>
      </div>
    </div>
    <div class="flex gap-2 p-3 pt-0">
      <button
        class="btn-primary text-sm flex-1 py-2"
        :disabled="queued"
        @click="onQueue(song)"
      >
        {{ queued ? "已点" : "点歌" }}
      </button>
      <button
        class="btn-ghost text-sm flex-1 py-2"
        :disabled="queued"
        @click="onTop(song)"
      >
        置顶
      </button>
    </div>
  </li>
</template>
