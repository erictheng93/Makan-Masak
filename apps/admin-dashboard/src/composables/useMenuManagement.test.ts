// @vitest-environment jsdom

import { ref, defineComponent } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMenuManagement } from "./useMenuManagement";

// The failure paths below are driven on purpose and the code logs each one.
const silencedConsole: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  for (const method of ["error"] as const) {
    silencedConsole.push(
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
  }
});
afterEach(() => {
  silencedConsole.splice(0).forEach((spy) => spy.mockRestore());
});

const realtime = vi.hoisted(() => ({
  status: null as null | { value: string },
  callback: null as null | ((event: { restaurantId: string }) => void),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}));
vi.mock("@/services/realtimeService", async () => {
  const { ref } = await import("vue");
  realtime.status = ref("connected");
  realtime.subscribe.mockImplementation(
    (_types: unknown, callback: typeof realtime.callback) => {
      realtime.callback = callback;
      return "menu-sub";
    },
  );
  return {
    useRealtime: () => ({
      connectionStatus: realtime.status,
      subscribe: realtime.subscribe,
      unsubscribe: realtime.unsubscribe,
    }),
  };
});

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/services/api", () => ({ api: apiMocks }));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({ restaurantId: "rest-1" }),
}));

vi.mock("vue-toastification", () => ({
  useToast: () => toastMocks,
}));

// Params are serialised into the key so a test can assert both that a string
// went through t() and what it was interpolated with — a raw literal would show
// up as itself and fail.
vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}(${JSON.stringify(params)})` : key,
    locale: ref("zh-TW"),
  }),
}));

/** An item as the menu API serialises it, including its version. */
function buildApiMenuItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    categoryId: 3,
    catalogType: "menu_item",
    name: "牛肉麵",
    price: 180,
    isFeatured: false,
    isAvailable: true,
    sortOrder: 0,
    updatedAt: "2026-07-30T08:15:30.250Z",
    ...overrides,
  };
}

function buildMenuResponse(items: Record<string, unknown>[] = []) {
  return {
    data: {
      success: true,
      data: { categories: [{ id: 3, name: "麵食" }], menuItems: items },
    },
  };
}

/** A rejected axios-shaped response with the unified error envelope. */
function buildApiError(
  error: { code: string; message?: string; details?: unknown },
  status = 400,
) {
  return Object.assign(new Error(error.code), {
    response: { status, data: { success: false, error } },
  });
}

function buildItemForm(overrides: Record<string, unknown> = {}) {
  return {
    name: "牛肉麵",
    price: 200,
    categoryId: 3,
    isFeatured: false,
    isAvailable: true,
    sortOrder: 0,
    ...overrides,
  } as Parameters<ReturnType<typeof useMenuManagement>["saveMenuItem"]>[0];
}

describe("useMenuManagement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.get.mockResolvedValue(buildMenuResponse([buildApiMenuItem()]));
    apiMocks.post.mockResolvedValue({
      data: { success: true, data: { created: 0, items: [] } },
    });
    apiMocks.put.mockResolvedValue({ data: { success: true, data: {} } });
  });

  it("refreshes on menu updates and reconnection and unsubscribes on unmount", async () => {
    const wrapper = mount(
      defineComponent({
        setup() {
          useMenuManagement();
          return () => null;
        },
      }),
    );
    realtime.callback?.({ restaurantId: "other" });
    await flushPromises();
    expect(apiMocks.get).not.toHaveBeenCalled();
    realtime.callback?.({ restaurantId: "rest-1" });
    await flushPromises();
    expect(apiMocks.get).toHaveBeenCalledOnce();
    realtime.status!.value = "reconnecting";
    await flushPromises();
    realtime.status!.value = "connected";
    await flushPromises();
    expect(apiMocks.get).toHaveBeenCalledTimes(2);
    wrapper.unmount();
    expect(realtime.unsubscribe).toHaveBeenCalledWith("menu-sub");
  });

  it("merges event bursts and keeps a final refresh after the pending read", async () => {
    let finish!: (value: ReturnType<typeof buildMenuResponse>) => void;
    apiMocks.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const wrapper = mount(
      defineComponent({
        setup() {
          useMenuManagement();
          return () => null;
        },
      }),
    );
    realtime.callback?.({ restaurantId: "rest-1" });
    realtime.callback?.({ restaurantId: "rest-1" });
    realtime.callback?.({ restaurantId: "rest-1" });
    expect(apiMocks.get).toHaveBeenCalledOnce();
    finish(buildMenuResponse());
    await flushPromises();
    expect(apiMocks.get).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
  it("bypasses a repopulated stale menu cache on a supply event", async () => {
    apiMocks.get.mockImplementation(async (_url, config) =>
      buildMenuResponse([
        buildApiMenuItem({
          isAvailable: config?.headers?.["Cache-Control"] !== "no-cache",
        }),
      ]),
    );
    let menu!: ReturnType<typeof useMenuManagement>;
    const wrapper = mount(
      defineComponent({
        setup() {
          menu = useMenuManagement();
          return () => null;
        },
      }),
    );
    realtime.callback?.({ restaurantId: "rest-1" });
    await flushPromises();
    expect(menu.menuItems.value[0].isAvailable).toBe(false);
    expect(apiMocks.get).toHaveBeenCalledWith("/menu/rest-1?includeAll=true", {
      headers: { "Cache-Control": "no-cache" },
    });
    wrapper.unmount();
  });
  it("ignores a late older fetch and a fetch completing after unmount", async () => {
    let old!: (value: ReturnType<typeof buildMenuResponse>) => void;
    apiMocks.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          old = resolve;
        }),
    );
    let menu!: ReturnType<typeof useMenuManagement>;
    const wrapper = mount(
      defineComponent({
        setup() {
          menu = useMenuManagement();
          return () => null;
        },
      }),
    );
    const older = menu.fetchMenu();
    await menu.fetchMenu();
    expect(menu.menuItems.value[0].name).toBe("牛肉麵");
    old(buildMenuResponse([buildApiMenuItem({ name: "Old" })]));
    await older;
    expect(menu.menuItems.value[0].name).toBe("牛肉麵");
    apiMocks.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          old = resolve;
        }),
    );
    const pending = menu.fetchMenu();
    wrapper.unmount();
    old(buildMenuResponse([buildApiMenuItem({ name: "Unmounted" })]));
    await pending;
    expect(menu.menuItems.value[0].name).toBe("牛肉麵");
  });

  // Issue #85: the importer POSTed one item per row, so a batch that failed on
  // row 7 left rows 1-6 committed and a retry duplicated them — and the success
  // toast was a hardcoded Chinese literal in a file that otherwise uses t().
  describe("CSV import (#85)", () => {
    const items = [
      { name: "蚵仔煎", categoryId: 3, price: 70 },
      { name: "紅茶", categoryId: 3, price: 25 },
    ] as never;

    it("sends the whole batch in one request and reports the count through t()", async () => {
      apiMocks.post.mockResolvedValueOnce({
        data: { success: true, data: { created: 2 } },
      });
      const { importMenuItems } = useMenuManagement();

      await importMenuItems(items);

      expect(apiMocks.post).toHaveBeenCalledOnce();
      expect(apiMocks.post).toHaveBeenCalledWith("/menu/rest-1/items/bulk", {
        items,
      });
      expect(toastMocks.success).toHaveBeenCalledWith(
        'menu.toast.itemsImported({"count":2})',
      );
      // The list is reloaded so the new rows appear without a manual refresh.
      expect(apiMocks.get).toHaveBeenCalledOnce();
    });

    it("names the failing CSV row from the API's per-row details", async () => {
      apiMocks.post.mockRejectedValueOnce(
        buildApiError({
          code: "VALIDATION_ERROR",
          message: "Validation failed",
          details: [{ field: "items.6.price", message: "Too small" }],
        }),
      );
      const { importMenuItems } = useMenuManagement();

      // Array index 6 is CSV line 8 — line 1 is the header, matching the
      // wording parseMenuItemImport already uses.
      await expect(importMenuItems(items)).rejects.toThrow(
        'menu.errors.importRowFailed({"row":8,"reason":"Too small"})',
      );
      expect(toastMocks.error).toHaveBeenCalledWith(
        'menu.errors.importRowFailed({"row":8,"reason":"Too small"})',
      );
      expect(toastMocks.success).not.toHaveBeenCalled();
    });

    it("names the failing row when a category belongs to another restaurant", async () => {
      apiMocks.post.mockRejectedValueOnce(
        buildApiError(
          {
            code: "CATEGORY_RESTAURANT_MISMATCH",
            message: "One or more categories do not belong to this restaurant",
            details: [
              { index: 1, field: "categoryId", message: "Category 99 …" },
            ],
          },
          403,
        ),
      );
      const { importMenuItems } = useMenuManagement();

      await expect(importMenuItems(items)).rejects.toThrow(
        'menu.errors.importRowFailed({"row":3,"reason":"Category 99 …"})',
      );
    });

    it("maps the API's compacted index back to the original CSV line", async () => {
      apiMocks.post.mockRejectedValueOnce(
        buildApiError({
          code: "VALIDATION_ERROR",
          message: "Validation failed",
          details: [{ field: "items.1.name", message: "Too long" }],
        }),
      );
      const { importMenuItems } = useMenuManagement();

      // Index 1 of the submitted array came from CSV line 5 (line 3 skipped).
      await expect(importMenuItems(items, [2, 5])).rejects.toThrow(
        'menu.errors.importRowFailed({"row":5,"reason":"Too long"})',
      );
    });

    it("falls back to a translated message when the API gives no details", async () => {
      apiMocks.post.mockRejectedValueOnce(new Error("network down"));
      const { importMenuItems } = useMenuManagement();

      await expect(importMenuItems(items)).rejects.toThrow(
        "menu.errors.importFailed",
      );
      expect(toastMocks.error).toHaveBeenCalledWith("menu.errors.importFailed");
    });

    it("sends nothing at all for an empty parse result", async () => {
      const { importMenuItems } = useMenuManagement();

      await importMenuItems([]);

      expect(apiMocks.post).not.toHaveBeenCalled();
    });
  });

  // Issue #85: PUT /menu/items/:id had no version check and the form saves
  // every field it rendered, so a stale save silently reverted someone else's
  // concurrent change.
  describe("optimistic locking on save (#85)", () => {
    it("carries the version the form was loaded with", async () => {
      const { saveMenuItem } = useMenuManagement();

      await expect(
        saveMenuItem(
          buildItemForm({ updatedAt: "2026-07-30T08:15:30.250Z" }),
          11,
        ),
      ).resolves.toBe("saved");

      expect(apiMocks.put).toHaveBeenCalledOnce();
      expect(apiMocks.put).toHaveBeenCalledWith(
        "/menu/items/11",
        expect.objectContaining({
          price: 200,
          updatedAt: "2026-07-30T08:15:30.250Z",
        }),
      );
    });

    it("reports a 409 as a conflict rather than a generic failure", async () => {
      apiMocks.put.mockRejectedValueOnce(
        buildApiError({ code: "MENU_ITEM_MODIFIED" }, 409),
      );
      const { saveMenuItem } = useMenuManagement();

      await expect(
        saveMenuItem(
          buildItemForm({ updatedAt: "2026-07-30T08:15:30.250Z" }),
          11,
        ),
      ).resolves.toBe("conflict");

      // The view shows a reload prompt for this, so a generic error toast here
      // would just be noise on top of it.
      expect(toastMocks.error).not.toHaveBeenCalled();
    });

    it("still reports other API errors as plain failures", async () => {
      apiMocks.put.mockRejectedValueOnce(
        buildApiError({ code: "VALIDATION_ERROR", message: "nope" }),
      );
      const { saveMenuItem } = useMenuManagement();

      await expect(
        saveMenuItem(
          buildItemForm({ updatedAt: "2026-07-30T08:15:30.250Z" }),
          11,
        ),
      ).resolves.toBe("failed");
      expect(toastMocks.error).toHaveBeenCalledWith("nope");
    });

    it("treats an edit with no version as a conflict instead of sending it", async () => {
      const { saveMenuItem } = useMenuManagement();

      await expect(saveMenuItem(buildItemForm(), 11)).resolves.toBe("conflict");
      expect(apiMocks.put).not.toHaveBeenCalled();
    });

    it("never sends a version when creating a new item", async () => {
      const { saveMenuItem } = useMenuManagement();

      await expect(
        saveMenuItem(buildItemForm({ updatedAt: "2026-07-30T08:15:30.250Z" })),
      ).resolves.toBe("saved");

      expect(apiMocks.post).toHaveBeenCalledWith(
        "/menu/rest-1/items",
        expect.not.objectContaining({ updatedAt: expect.anything() }),
      );
    });

    it("keeps the availability toggle version-free so a sold-out flip cannot 409", async () => {
      const { menuItems, fetchMenu, toggleMenuItemStatus } =
        useMenuManagement();
      await fetchMenu();

      await toggleMenuItemStatus(menuItems.value[0]);

      expect(apiMocks.put).toHaveBeenCalledWith("/menu/items/11", {
        isAvailable: false,
      });
    });

    it("loads the version off the menu response so the form has one to send", async () => {
      const { menuItems, fetchMenu } = useMenuManagement();

      await fetchMenu();

      expect(menuItems.value[0]).toMatchObject({
        id: 11,
        updatedAt: "2026-07-30T08:15:30.250Z",
      });
    });
  });
});
