<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../lib/api";

withDefaults(
  defineProps<{
    /** "card" inline; "hero" centered larger */
    size?: "card" | "hero";
  }>(),
  { size: "card" },
);

const qr = ref<{
  url: string;
  qr_data_url: string;
  lan_ips: string[];
} | null>(null);
const wifi = ref<{
  configured: boolean;
  qr_data_url: string | null;
  ssid?: string;
  security?: string;
} | null>(null);
const error = ref("");

async function refresh() {
  try {
    [qr.value, wifi.value] = await Promise.all([api.qr(), api.qrWifi()]);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

onMounted(() => refresh());
</script>

<template>
  <!-- HERO: dual QR with "step 1 / step 2" framing -->
  <div
    v-if="size === 'hero'"
    class="card p-5 space-y-4"
  >
    <div class="text-center space-y-0.5">
      <div class="text-base font-semibold">扫码点歌</div>
      <div class="text-[11px] text-white/45 tracking-[0.25em]">SCAN TO SING</div>
    </div>

    <div
      v-if="wifi?.configured"
      class="grid grid-cols-2 gap-3"
    >
      <!-- Step 1: WiFi -->
      <div class="text-center space-y-2">
        <div
          class="text-[10px] uppercase tracking-[0.2em] font-bold inline-block px-2 py-0.5 rounded-full"
          style="background: rgba(34,211,238,0.15); color: #67e8f9; border: 1px solid rgba(34,211,238,0.35)"
        >
          ① 连 WiFi
        </div>
        <div class="bg-white p-2 rounded-xl shadow-deep mx-auto w-fit">
          <img
            v-if="wifi.qr_data_url"
            :src="wifi.qr_data_url"
            class="block w-[160px] h-[160px]"
          />
        </div>
        <div class="text-[11px] text-white/55 font-mono truncate">
          {{ wifi.ssid }}
        </div>
      </div>
      <!-- Step 2: KTV URL -->
      <div class="text-center space-y-2">
        <div
          class="text-[10px] uppercase tracking-[0.2em] font-bold inline-block px-2 py-0.5 rounded-full"
          style="background: rgba(255,46,107,0.15); color: #ff7aa1; border: 1px solid rgba(255,46,107,0.35)"
        >
          ② 点歌
        </div>
        <div class="bg-white p-2 rounded-xl shadow-deep mx-auto w-fit">
          <img
            v-if="qr"
            :src="qr.qr_data_url"
            class="block w-[160px] h-[160px]"
          />
        </div>
        <div v-if="qr" class="text-[11px] text-white/55 font-mono truncate">
          {{ qr.url.replace(/^https?:\/\//, "") }}
        </div>
      </div>
    </div>

    <!-- Single QR (no WiFi configured) -->
    <div v-else class="text-center space-y-2">
      <div
        class="bg-white p-3 rounded-xl shadow-deep mx-auto w-fit"
      >
        <img
          v-if="qr"
          :src="qr.qr_data_url"
          class="block"
          style="width: 220px; height: 220px"
        />
      </div>
      <div v-if="qr" class="text-xs text-white/55 font-mono">{{ qr.url }}</div>
    </div>
  </div>

  <!-- CARD: phone size (compact, dual or single) -->
  <div v-else class="card text-center space-y-2 p-4">
    <div class="font-semibold text-sm">扫码点歌</div>
    <div v-if="wifi?.configured" class="grid grid-cols-2 gap-2">
      <div class="space-y-1">
        <div class="text-[9px] font-bold" style="color: #67e8f9">① WiFi</div>
        <img
          v-if="wifi.qr_data_url"
          :src="wifi.qr_data_url"
          class="mx-auto rounded bg-white p-1.5"
          style="width: 100%; max-width: 110px; aspect-ratio: 1/1"
        />
      </div>
      <div class="space-y-1">
        <div class="text-[9px] font-bold" style="color: #ff7aa1">② 点歌</div>
        <img
          v-if="qr"
          :src="qr.qr_data_url"
          class="mx-auto rounded bg-white p-1.5"
          style="width: 100%; max-width: 110px; aspect-ratio: 1/1"
        />
      </div>
    </div>
    <div v-else>
      <img
        v-if="qr"
        :src="qr.qr_data_url"
        class="mx-auto w-40 h-40 rounded bg-white p-2"
      />
      <div v-if="qr" class="text-xs text-white/55 font-mono mt-2">
        {{ qr.url }}
      </div>
    </div>
    <div v-if="error" class="text-red-400 text-xs">{{ error }}</div>
  </div>
</template>
