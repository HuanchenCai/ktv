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

createApp(App).use(router).mount("#app");
