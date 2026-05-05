<script setup lang="ts">
import { ref } from "vue";
import { api } from "../lib/api";

const volume = ref(80);
const lastAction = ref("");

// 3-band EQ: -12..+12 dB. Default flat (0/0/0). Pushed to mpv lazily —
// nothing happens until the user moves a slider.
const eqOpen = ref(false);
const eqLow = ref(0);
const eqMid = ref(0);
const eqHigh = ref(0);

async function flash(label: string, fn: () => Promise<unknown>) {
  lastAction.value = label;
  setTimeout(() => {
    if (lastAction.value === label) lastAction.value = "";
  }, 1200);
  try {
    await fn();
  } catch {
    /* ignore */
  }
}

const doSkip = () => flash("切歌", () => api.skip());
const doReplay = () => flash("重唱", () => api.replay());
const doToggle = () => flash("切声道", () => api.toggleVocal());
const doReopen = () => flash("重开视频", () => api.reopen());
const setChan = (c: "L" | "R" | "both") =>
  flash(`声道 ${c}`, () => api.setChannel(c));
// Throttle so a drag doesn't spam the backend with one IPC per pixel.
let volTimer: ReturnType<typeof setTimeout> | null = null;
function onVolume() {
  if (volTimer) return;
  volTimer = setTimeout(async () => {
    volTimer = null;
    try {
      await api.setVolume(volume.value);
    } catch {
      /* ignore */
    }
  }, 80);
}

let eqTimer: ReturnType<typeof setTimeout> | null = null;
function pushEq() {
  if (eqTimer) clearTimeout(eqTimer);
  eqTimer = setTimeout(async () => {
    try {
      await api.setEq({
        low: eqLow.value,
        mid: eqMid.value,
        high: eqHigh.value,
      });
    } catch {
      /* ignore */
    }
  }, 120);
}

async function resetEq() {
  eqLow.value = 0;
  eqMid.value = 0;
  eqHigh.value = 0;
  try {
    await api.setEq({ off: true });
  } catch {
    /* ignore */
  }
}
</script>

<template>
  <div class="card space-y-3 p-4">
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-semibold">控制</h3>
      <span
        v-if="lastAction"
        class="text-xs text-accent animate-fade-in"
      >
        {{ lastAction }}
      </span>
    </div>

    <button class="btn-primary w-full py-2.5 text-sm" @click="doToggle">
      🎙 切原唱 / 伴唱
    </button>

    <div class="grid grid-cols-3 gap-2">
      <button
        class="btn-ghost text-xs py-1.5"
        @click="setChan('L')"
        title="只播左声道"
      >
        只 L
      </button>
      <button
        class="btn-ghost text-xs py-1.5"
        @click="setChan('both')"
        title="双声道一起播"
      >
        双声道
      </button>
      <button
        class="btn-ghost text-xs py-1.5"
        @click="setChan('R')"
        title="只播右声道"
      >
        只 R
      </button>
    </div>

    <div class="grid grid-cols-3 gap-2">
      <button class="btn-ghost text-xs py-1.5" @click="doReplay">↻ 重唱</button>
      <button
        class="btn-ghost text-xs py-1.5"
        @click="doReopen"
        title="窗口被关掉了？再开"
      >
        🔁 重开视频
      </button>
      <button class="btn-ghost text-xs py-1.5" @click="doSkip">⏭ 切歌</button>
    </div>

    <div class="space-y-1.5 pt-1">
      <div class="flex justify-between text-[11px] text-muted">
        <span>音量</span>
        <span class="font-mono tabular-nums">{{ volume }}</span>
      </div>
      <input
        v-model.number="volume"
        type="range"
        min="0"
        max="130"
        class="w-full"
        @input="onVolume"
      />
    </div>

    <!-- 3-band EQ. Collapsed by default to keep the panel compact. -->
    <div class="pt-1 border-t border-border/40 space-y-2">
      <button
        class="w-full flex items-center justify-between text-[11px] text-muted hover:text-white transition-colors"
        @click="eqOpen = !eqOpen"
      >
        <span>🎚 音效 (低/中/高频)</span>
        <span class="tabular-nums">
          {{ eqLow }} / {{ eqMid }} / {{ eqHigh }} dB
          <span class="ml-1">{{ eqOpen ? "▾" : "▸" }}</span>
        </span>
      </button>
      <div v-if="eqOpen" class="space-y-1.5">
        <div class="grid grid-cols-[1.5rem_1fr_2.25rem] items-center gap-2">
          <span class="text-[11px] text-muted">低</span>
          <input
            v-model.number="eqLow"
            type="range" min="-12" max="12" step="1"
            class="w-full" @input="pushEq"
          />
          <span class="text-[11px] tabular-nums text-right">{{ eqLow }}</span>
        </div>
        <div class="grid grid-cols-[1.5rem_1fr_2.25rem] items-center gap-2">
          <span class="text-[11px] text-muted">中</span>
          <input
            v-model.number="eqMid"
            type="range" min="-12" max="12" step="1"
            class="w-full" @input="pushEq"
          />
          <span class="text-[11px] tabular-nums text-right">{{ eqMid }}</span>
        </div>
        <div class="grid grid-cols-[1.5rem_1fr_2.25rem] items-center gap-2">
          <span class="text-[11px] text-muted">高</span>
          <input
            v-model.number="eqHigh"
            type="range" min="-12" max="12" step="1"
            class="w-full" @input="pushEq"
          />
          <span class="text-[11px] tabular-nums text-right">{{ eqHigh }}</span>
        </div>
        <button
          class="btn-ghost text-[11px] py-1 w-full"
          @click="resetEq"
        >
          归零 / 关闭 EQ
        </button>
      </div>
    </div>
  </div>
</template>
