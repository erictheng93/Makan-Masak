import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import { createPinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import Toast from "vue-toastification";
import App from "./App.vue";
import routes from "./router";
import { performanceOptimizationService } from "./services/performanceOptimizationService";
import { useAuthStore } from "./stores/auth";
import { initI18n } from "./i18n";
import { installKitchenRouterGuards } from "./router/guards";
import { installKitchenChunkRecovery } from "./router/chunk-recovery";

// CSS imports
import "./assets/css/main.css";
import "vue-toastification/dist/index.css";

const app = createApp(App);

// Router setup
const router = createRouter({
  history: createWebHistory(),
  routes,
});

// Pinia state management
const pinia = createPinia();

// Vue Query setup for server state management
app.use(VueQueryPlugin, {
  queryClientConfig: {
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000, // 30 seconds
        gcTime: 5 * 60 * 1000, // 5 minutes (renamed from cacheTime)
        retry: 2,
        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      },
    },
  },
});

// Toast notifications
app.use(Toast, {
  position: "top-right",
  timeout: 3000,
  closeOnClick: true,
  pauseOnFocusLoss: true,
  pauseOnHover: true,
  draggable: true,
  draggablePercent: 0.6,
  showCloseButtonOnHover: false,
  hideProgressBar: false,
  closeButton: false,
  icon: true,
  rtl: false,
});

// Install lazy component plugin if available
if (window.__lazyComponentPlugin) {
  app.use(window.__lazyComponentPlugin);
}

app.use(pinia);

// Rehydrate auth state from localStorage BEFORE mount.
// Without this, refreshing any protected view (dashboard, settings, history)
// kicks the user back to /login because views check `authStore.isAuthenticated`
// in onMounted and the store state is never restored from localStorage
// automatically — `initialize()` has to be called explicitly. This was also
// why the visual regression tests for authenticated kitchen pages always
// captured the login page as their baseline.
const authStore = useAuthStore();
const authReady = authStore.initialize().catch((err) => {
  console.error("[kitchen] auth initialize failed:", err);
});
installKitchenRouterGuards(router, authStore, authReady);
installKitchenChunkRecovery(router);
app.use(router);

// Initialize performance optimization services
performanceOptimizationService.setupImageOptimization();
performanceOptimizationService.registerServiceWorker();

// Await both auth rehydration AND i18n initialization BEFORE mounting. Mount
// must be gated on auth so protected-route guards see the restored session
// (see comment above), and on i18n so the first paint uses the correct locale.
Promise.all([
  authReady,
  initI18n().catch((err) => {
    console.error("[kitchen] i18n initialize failed:", err);
  }),
]).finally(() => {
  app.mount("#app");
});
