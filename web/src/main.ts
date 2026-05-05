import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import "./styles.css";
import App from "./App.vue";
import Search from "./views/Search.vue";
import Queue from "./views/Queue.vue";
import NowPlaying from "./views/NowPlaying.vue";
import Admin from "./views/Admin.vue";
import Tv from "./views/Tv.vue";
import Artists from "./views/Artists.vue";
import Library from "./views/Library.vue";

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
    { path: "/admin", component: Admin },
    { path: "/tv", component: Tv, meta: { layout: "tv" } },
    { path: "/artists", component: Artists },
    { path: "/library", component: Library },
  ],
});

// The phone is the customer's remote — it should NOT see admin features.
// Block /tv (desktop layout doesn't fit a phone), /admin / /library /
// /artists (all desktop-oriented) on small viewports. Hiding the nav
// items isn't enough: a stale bookmark, a typed URL, or a /tv-style
// deep-link could still drop a phone into one of these pages.
const DESKTOP_ONLY = new Set(["/tv", "/admin", "/library", "/artists"]);
router.beforeEach((to) => {
  if (DESKTOP_ONLY.has(to.path) && !isWideScreen()) {
    return { path: "/search", query: to.query };
  }
});

createApp(App).use(router).mount("#app");
