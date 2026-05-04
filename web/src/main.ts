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

// Belt-and-suspenders: if a phone-sized viewport lands on /tv (e.g. via a
// stale bookmark or hardcoded link), bounce it back to /search instead of
// rendering the 1004px-wide 3-column layout into a 400px-wide phone.
router.beforeEach((to) => {
  if (to.path === "/tv" && !isWideScreen()) {
    return { path: "/search", query: to.query };
  }
});

createApp(App).use(router).mount("#app");
