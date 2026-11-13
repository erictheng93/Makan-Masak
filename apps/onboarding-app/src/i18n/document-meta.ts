import { watch } from "vue";
import type { Router } from "vue-router";
import { useI18n, type Locale } from "./index";

// zh needs its script subtag so screen readers and search pick Traditional vs
// Simplified; the other locale codes are already valid BCP-47 tags.
export const HTML_LANG: Record<Locale, string> = {
  "zh-TW": "zh-Hant-TW",
  "zh-CN": "zh-Hans-CN",
  "en-US": "en-US",
  "vi-VN": "vi-VN",
  "ms-MY": "ms-MY",
  "id-ID": "id-ID",
};

/** Keep <html lang> and document.title in step with the locale and the route. */
export function syncDocumentMeta(router: Router): void {
  const { t, locale } = useI18n();

  const apply = () => {
    document.documentElement.lang = HTML_LANG[locale.value] ?? locale.value;
    const key = router.currentRoute.value.meta.titleKey as string | undefined;
    document.title = key ? `${t(key)} - MakanMasak` : t("pageTitle.default");
  };

  watch([locale, () => router.currentRoute.value], apply, { immediate: true });
}
