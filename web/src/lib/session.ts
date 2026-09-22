import { ref } from "vue";
export const roomRole = ref<"admin" | "guest" | null>(null);
export const roomEnabled = ref(false);

export async function leaveRoom() {
  await fetch("/api/session/leave", { method: "POST" });
  location.reload();
}
