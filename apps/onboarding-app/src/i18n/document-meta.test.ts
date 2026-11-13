import { beforeAll, describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { nextTick } from "vue";

beforeAll(async () => {
  await import("./index");
}, 30_000);

describe("syncDocumentMeta", () => {
  it("follows the active locale and route for <html lang> and the title", async () => {
    const { syncDocumentMeta } = await import("./document-meta");
    const { initI18n, useI18n } = await import("./index");
    await initI18n();
    await useI18n().switchLocale("zh-TW");

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: {}, meta: { titleKey: "pageTitle.home" } },
        {
          path: "/apply",
          component: {},
          meta: { titleKey: "pageTitle.apply" },
        },
      ],
    });
    await router.push("/apply");
    syncDocumentMeta(router);

    expect(document.title).toBe("填寫申請 - MakanMasak");
    expect(document.documentElement.lang).toBe("zh-Hant-TW");

    await useI18n().switchLocale("en-US");
    await nextTick();
    expect(document.title).toBe("Application form - MakanMasak");
    expect(document.documentElement.lang).toBe("en-US");

    await router.push("/");
    await nextTick();
    expect(document.title).toBe("Open a shop - MakanMasak");

    await useI18n().switchLocale("zh-CN");
    await nextTick();
    expect(document.documentElement.lang).toBe("zh-Hans-CN");
  });
});
