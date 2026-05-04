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
const error = ref("");

async function refresh() {
  try {
    qr.value = await api.qr();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

onMounted(() => refresh());
</script>

<template>
  <div
    v-if="size === 'hero'"
    class="card text-center space-y-3 p-5 ring-1 ring-border bg-gradient-to-br from-panel to-elevated"
  >
    <div class="space-y-0.5">
      <div class="text-base font-semibold">扫码加入</div>
      <div class="text-[11px] text-muted tracking-wider">SCAN TO JOIN</div>
    </div>
    <div
      class="bg-white p-3 rounded-xl mx-auto w-fit shadow-deep"
    >
      <img
        v-if="qr"
        :src="qr.qr_data_url"
        class="block"
        style="width: 220px; height: 220px"
      />
    </div>
    <div v-if="qr" class="text-xs text-muted font-mono">{{ qr.url }}</div>
  </div>

  <div v-else class="card text-center space-y-2">
    <div class="font-semibold text-sm">扫码点歌</div>
    <img
      v-if="qr"
      :src="qr.qr_data_url"
      class="mx-auto w-40 h-40 rounded bg-white p-2"
    />
    <div v-if="qr" class="text-xs text-muted font-mono">
      {{ qr.url }}<br />
      <span class="text-muted">LAN: {{ qr.lan_ips.join(", ") }}</span>
    </div>
    <div v-if="error" class="text-red-400 text-xs">{{ error }}</div>
  </div>
</template>
