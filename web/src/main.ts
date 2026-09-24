import { createApp, h } from "vue";
import RoomGate from "./components/RoomGate.vue";
import { roomRole } from "./lib/session";
import { createRouter, createWebHistory } from "vue-router";
import "./styles.css";
import App from "./App.vue";
import Search from "./views/Search.vue";
import Queue from "./views/Queue.vue";
import NowPlaying from "./views/NowPlaying.vue";
import Settings from "./views/Settings.vue";
import Tv from "./views/Tv.vue";
import Artists from "./views/Artists.vue";

function isWideScreen(): boolean {
  return typeof window !== "undefined" && window.innerWidth >= 1024;
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    // Big screens (browser on the host machine, AirPlayed to TV) get the
    // single-page /tv layout. Phones get the tabbed UI starting at /search.
    { path: "/", redirect: () => (isWideScreen() ? "/tv" : "/search") },
    { path: "/search", component: Search },
    { path: "/queue", component: Queue },
    { path: "/now", component: NowPlaying },
    { path: "/settings", component: Settings },
    { path: "/admin", redirect: "/settings?tab=room" },
    { path: "/tv", component: Tv, meta: { layout: "tv" } },
    { path: "/artists", component: Artists },
    { path: "/library", redirect: "/settings?tab=library" },
  ],
});

// A host can manage the room from a phone or tablet while the playback
// computer is occupied by the TV. Only the TV and artist directory layouts
// require a wide viewport; server-side room access still protects settings.
const DESKTOP_ONLY = new Set(["/tv", "/artists"]);
router.beforeEach((to) => {
  if (roomRole.value === "guest" && ["/settings", "/admin", "/library"].includes(to.path)) return "/search";
  if (DESKTOP_ONLY.has(to.path) && !isWideScreen()) {
    return { path: "/search", query: to.query };
  }
});

createApp({ render: () => h(RoomGate, null, { default: () => h(App) }) }).use(router).mount("#app");
