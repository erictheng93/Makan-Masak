import { createApp } from "vue";
import { createPinia } from "pinia";
import { router } from "./router";
import App from "./App.vue";
import Toast from "vue-toastification";
import "vue-toastification/dist/index.css";
import "./assets/css/main.css";
import { initI18n } from "./i18n";
import { syncDocumentMeta } from "./i18n/document-meta";

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);
app.use(Toast, {
  position: "top-right",
  timeout: 5000,
});

// Await i18n initialization BEFORE mounting so the first paint uses the correct locale.
initI18n()
  .catch((err) => {
    console.error("[onboarding] i18n initialize failed:", err);
  })
  .finally(() => {
    syncDocumentMeta(router);
    app.mount("#app");
  });
