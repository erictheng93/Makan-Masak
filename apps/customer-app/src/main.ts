import { createApp } from "vue";
import { createPinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import Toast from "vue-toastification";
import { registerSW } from "virtual:pwa-register";
import "vue-toastification/dist/index.css";

import App from "./App.vue";
import router from "./router";
import { setupI18n } from "./i18n";
import "./assets/css/main.css";
import { cleanupLegacyPWAStorage } from "./utils/legacy-pwa-storage-cleanup";

// A fresh worker claims this tab under `autoUpdate`; reload its document so
// returning diners do not complete a meal on the prior deployment.
registerSW({ immediate: true });

const app = createApp(App);

// Pinia store
app.use(createPinia());

// Vue Router
app.use(router);

// Vue I18n for internationalization
setupI18n(app);

// Vue Query for API state management
app.use(VueQueryPlugin, {
  queryClientConfig: {
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 5 * 60 * 1000, // 5 minutes
      },
    },
  },
});

// Toast notifications
app.use(Toast, {
  position: "top-center",
  timeout: 3000,
  closeOnClick: true,
  pauseOnFocusLoss: true,
  pauseOnHover: true,
  draggable: true,
  draggablePercent: 0.6,
  showCloseButtonOnHover: false,
  hideProgressBar: false,
  closeButton: "button",
  icon: true,
  rtl: false,
});

app.mount("#app");

void cleanupLegacyPWAStorage();
