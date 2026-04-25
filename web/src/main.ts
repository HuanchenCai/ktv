import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import "./styles.css";
import App from "./App.vue";
import Search from "./views/Search.vue";
import Queue from "./views/Queue.vue";
import NowPlaying from "./views/NowPlaying.vue";
import Admin from "./views/Admin.vue";
import Tv from "./views/Tv.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/search" },
    { path: "/search", component: Search },
    { path: "/queue", component: Queue },
    { path: "/now", component: NowPlaying },
    { path: "/admin", component: Admin },
    { path: "/tv", component: Tv, meta: { layout: "tv" } },
  ],
});

createApp(App).use(router).mount("#app");
