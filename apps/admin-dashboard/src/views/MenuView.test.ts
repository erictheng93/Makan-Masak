// @vitest-environment jsdom

import { mount, type VueWrapper } from "@vue/test-utils";
import { computed, nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MenuView from "./MenuView.vue";
import ImageAssistedMenuImport from "@/components/menu/ImageAssistedMenuImport.vue";
import type { ImageVariants } from "@/composables/useImageUpload";
import type { MenuItemData } from "@/composables/useMenuManagement";
import {
  clearRestaurantCurrency,
  setRestaurantCurrency,
} from "@/composables/useCurrency";

// MenuView is a `<script setup>` component, so none of the bindings this file
// drives are on the public instance type. The repo idiom is to name them once
// and cast the wrapper once (see `components/tables/SeatManagement.test.ts`);
// `mountMenuView` below is the single cast site.
//
// The form shapes mirror the types declared inside MenuView.vue's `<script
// setup>` block, which cannot be imported from a `.vue` file.
type NumericFormValue = number | "" | null | undefined;

interface SizeOptionForm {
  id: string;
  name: string;
  priceAdjustment: NumericFormValue;
  isDefault: boolean;
}

interface AddOnOptionForm {
  id: string;
  name: string;
  price: NumericFormValue;
  maxQuantity: NumericFormValue;
  available: boolean;
}

interface CustomizationChoiceForm {
  id: string;
  name: string;
  priceAdjustment: NumericFormValue;
  isDefault: boolean;
}

interface CustomizationGroupForm {
  id: string;
  name: string;
  type: "single" | "multiple";
  required: boolean;
  maxSelections: NumericFormValue;
  choices: CustomizationChoiceForm[];
}

interface MenuItemFormState {
  name: string;
  nameEn: string;
  description: string;
  price: number;
  originalPrice: number | undefined;
  ingredients: string;
  spiceLevel: number;
  // MenuView.vue declares this as `number` because the initial value is 15,
  // but `v-model.number` writes "" back when the field is cleared and the save
  // builder branches on that empty value. NumericFormValue is what it holds.
  preparationTime: NumericFormValue;
  calories: number | undefined;
  tagsText: string;
  keywords: string;
  allergensText: string;
  dietaryInfo: Record<string, boolean>;
  sizes: SizeOptionForm[];
  addOns: AddOnOptionForm[];
  customizations: CustomizationGroupForm[];
  categoryId: string | number;
  catalogType: "menu_item" | "product";
  imageUrl: string;
  imageId: string;
  imageVariants: ImageVariants | null;
  isFeatured: boolean;
  isAvailable: boolean;
  sortOrder: number;
  inventoryCount: NumericFormValue;
  minInventoryAlert: NumericFormValue;
  updatedAt: number | undefined;
}

interface MenuViewInternals {
  menuItemForm: MenuItemFormState;
  usesSharedOptionGroups: boolean;
  editMenuItem: (item: MenuItemData) => void;
  handleImageFileSelected: (event: Event) => Promise<void>;
}

const importMenuItems = vi.fn();
const createImageAssistedCategories = vi.fn();
const saveMenuItem = vi.fn();
const fetchMenu = vi.fn();
const push = vi.fn();
const imageUploadMocks = vi.hoisted(() => ({
  upload: vi.fn(),
  reset: vi.fn(),
}));
const routeQuery = {} as Record<string, unknown>;
const MANAGED_RESTAURANT_ID = "019f9373-397c-7202-99d6-24c61976f3ff";
const categories = ref([
  { id: 1, name: "主食", sortOrder: 0 },
  { id: 2, name: "飲料", sortOrder: 1 },
]);
const menuItems = ref<MenuItemData[]>([]);
const selectedCategoryId = ref<number | null>(null);

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params?.count ? `${key} ${params.count}` : key,
    locale: ref("zh-TW"),
  }),
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({ query: routeQuery }),
  useRouter: () => ({ push }),
}));

vi.mock("@/composables/useCurrency", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/composables/useCurrency")>();
  return {
    ...actual,
    useCurrency: () => ({
      ...actual.useCurrency(),
      formatPrice: (value: number) => `$${value}`,
    }),
  };
});

vi.mock("@/composables/useImageUpload", () => ({
  useImageUpload: () => ({
    upload: imageUploadMocks.upload,
    reset: imageUploadMocks.reset,
    state: ref("idle"),
    errorMessage: ref(""),
    result: ref(null),
  }),
}));

vi.mock("@/composables/useMenuManagement", () => ({
  useMenuManagement: () => ({
    categories,
    menuItems,
    isLoading: ref(false),
    selectedCategoryId,
    filteredItemsByCategory: computed(() => menuItems.value),
    getCategoryName: (id: number) =>
      categories.value.find((category) => category.id === id)?.name ?? "",
    fetchMenu,
    saveCategory: vi.fn(),
    deleteCategory: vi.fn(),
    reorderCategories: vi.fn(),
    saveMenuItem,
    importMenuItems,
    createImageAssistedCategories,
    deleteMenuItem: vi.fn(),
    toggleMenuItemStatus: vi.fn(),
    restaurantId: computed(() => MANAGED_RESTAURANT_ID),
  }),
}));

const fetchItemGroups = vi.fn();
const saveItemGroups = vi.fn();
const fetchOptionGroupLibrary = vi.fn();

vi.mock("@/composables/useOptionGroups", () => ({
  useOptionGroups: () => ({
    groups: ref([]),
    isLoading: ref(false),
    fetchGroups: fetchOptionGroupLibrary,
    fetchItemGroups,
    saveItemGroups,
    createGroup: vi.fn(),
    updateGroup: vi.fn(),
    deleteGroup: vi.fn(),
    createChoice: vi.fn(),
    updateChoice: vi.fn(),
    deleteChoice: vi.fn(),
    setChoiceAvailability: vi.fn(),
  }),
}));

vi.mock("@/utils/authTokenProvider", () => ({
  setAuthTokenProvider: vi.fn(),
  getAuthToken: () => "test-token",
}));

describe("MenuView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(routeQuery).forEach((key) => delete routeQuery[key]);
    selectedCategoryId.value = null;
    menuItems.value = [];
    // saveMenuItem reports "saved" | "failed" | "conflict" — a plain boolean
    // could not distinguish a lost-update refusal from any other failure (#85).
    saveMenuItem.mockResolvedValue("saved");
    // An item with no link rows is still on its JSON options, which is what
    // every existing case in this file exercises.
    fetchItemGroups.mockResolvedValue([]);
    fetchOptionGroupLibrary.mockResolvedValue(undefined);
    saveItemGroups.mockResolvedValue(true);
    imageUploadMocks.upload.mockResolvedValue(null);
    vi.stubEnv("VITE_IMAGE_API_URL", "https://images.example.test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null)));
  });

  it("shows market search context when opened from a product gap", () => {
    routeQuery.source = "market-gap";
    routeQuery.gap = "products";
    routeQuery.marketName = "逢甲夜市";

    const wrapper = mount(MenuView, {
      global: {
        stubs: {
          CategoryPanel: true,
          CategoryEditForm: true,
          MenuItemCard: true,
          VirtualMenuGrid: true,
        },
      },
    });

    expect(
      wrapper.get('[data-testid="market-product-gap-context"]').text(),
    ).toContain("市場搜尋缺商品");
    expect(
      wrapper.get('[data-testid="market-product-gap-context"]').text(),
    ).toContain("逢甲夜市");
  });

  it("includes market context in the product gap import example", async () => {
    routeQuery.source = "market-gap";
    routeQuery.gap = "products";
    routeQuery.marketName = "逢甲夜市";
    const wrapper = mount(MenuView, {
      global: {
        stubs: {
          CategoryPanel: true,
          CategoryEditForm: true,
          MenuItemCard: true,
          VirtualMenuGrid: true,
        },
      },
    });

    await wrapper
      .findAll("button")
      .find((button) => button.text() === "menu.import.loadExample")!
      .trigger("click");

    expect(
      wrapper.get<HTMLTextAreaElement>('[data-testid="menu-item-import-csv"]')
        .element.value,
    ).toContain("逢甲夜市");
  });

  it("imports menu items from CSV with a preview", async () => {
    const wrapper = mount(MenuView, {
      global: {
        stubs: {
          CategoryPanel: true,
          CategoryEditForm: true,
          MenuItemCard: true,
          VirtualMenuGrid: true,
        },
      },
    });

    await wrapper
      .get('[data-testid="menu-item-import-csv"]')
      .setValue(
        [
          "name,category,price,description,isFeatured,isAvailable,sortOrder,tags",
          '"蚵仔煎","主食",7000,"招牌小吃",true,true,1,"小吃;招牌"',
        ].join("\n"),
      );

    expect(wrapper.text()).toContain("menu.import.previewReady 1");

    await wrapper
      .get('[data-testid="menu-item-import-submit"]')
      .trigger("click");
    await flushPromises();

    expect(importMenuItems).toHaveBeenCalledWith([
      expect.objectContaining({
        name: "蚵仔煎",
        categoryId: 1,
        catalogType: "menu_item",
        price: 7000,
        description: "招牌小吃",
        isFeatured: true,
        isAvailable: true,
        sortOrder: 1,
        tags: ["小吃", "招牌"],
        keywords: "小吃 招牌",
      }),
    ]);
    // The outcome is reported through t() now, not a hardcoded literal (#85);
    // the t() stub here renders "<key> <count>".
    expect(wrapper.get('[data-testid="menu-item-import-success"]').text()).toBe(
      "menu.import.successBanner 1",
    );
  });

  it("creates image-import categories before one atomic item bulk request", async () => {
    createImageAssistedCategories.mockResolvedValue(new Map([["new-1", 9]]));
    const wrapper = mountMenuView();

    wrapper.findComponent(ImageAssistedMenuImport).vm.$emit("publish", {
      categories: [{ key: "new-1", name: "主食", sortOrder: 0 }],
      items: [
        {
          id: "item-1",
          name: "牛肉麵",
          price: "18000",
          categoryKey: "new-1",
          description: "",
          isAvailable: true,
          sortOrder: "0",
        },
      ],
    });
    await flushPromises();

    expect(createImageAssistedCategories).toHaveBeenCalledWith(
      [{ key: "new-1", name: "主食", sortOrder: 0 }],
      expect.any(Map),
    );
    expect(importMenuItems).toHaveBeenCalledWith([
      expect.objectContaining({
        name: "牛肉麵",
        categoryId: 9,
        catalogType: "menu_item",
        isFeatured: false,
      }),
    ]);
  });

  it("reuses created categories when a failed bulk import is retried", async () => {
    createImageAssistedCategories.mockImplementation(
      async (_drafts: unknown, ids: Map<string, number>) => {
        ids.set("new-1", 9);
        return ids;
      },
    );
    importMenuItems.mockRejectedValueOnce(new Error("第 1 列價格無效"));
    const wrapper = mountMenuView();
    const payload = {
      categories: [{ key: "new-1", name: "主食", sortOrder: 0 }],
      items: [
        {
          id: "item-1",
          name: "牛肉麵",
          price: "18000",
          categoryKey: "new-1",
          description: "",
          isAvailable: true,
          sortOrder: "0",
        },
      ],
    };

    wrapper.findComponent(ImageAssistedMenuImport).vm.$emit("publish", payload);
    await flushPromises();
    wrapper.findComponent(ImageAssistedMenuImport).vm.$emit("publish", payload);
    await flushPromises();

    expect(createImageAssistedCategories).toHaveBeenCalledTimes(1);
    expect(importMenuItems).toHaveBeenCalledTimes(2);
    expect(importMenuItems).toHaveBeenNthCalledWith(
      1,
      expect.arrayContaining([expect.objectContaining({ categoryId: 9 })]),
    );
    expect(importMenuItems).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining([expect.objectContaining({ categoryId: 9 })]),
    );
  });

  it("renders the batch import panel labels through i18n", async () => {
    const wrapper = mountMenuView();
    let finishImport!: () => void;
    importMenuItems.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishImport = resolve;
      }),
    );

    expect(wrapper.text()).toContain("menu.import.title");
    expect(wrapper.text()).toContain("menu.import.description");
    expect(wrapper.text()).toContain("menu.import.loadExample");
    expect(wrapper.get('[data-testid="menu-item-import-submit"]').text()).toBe(
      "menu.import.submit",
    );

    await wrapper
      .get('[data-testid="menu-item-import-csv"]')
      .setValue(["name,category,price", '"蚵仔煎","主食",7000'].join("\n"));
    await wrapper
      .get('[data-testid="menu-item-import-submit"]')
      .trigger("click");

    expect(wrapper.get('[data-testid="menu-item-import-submit"]').text()).toBe(
      "menu.import.submitting",
    );
    finishImport();
    await flushPromises();
  });

  it("shows a market search reindex next step after importing product gap items", async () => {
    routeQuery.source = "market-gap";
    routeQuery.gap = "products";
    routeQuery.marketName = "逢甲夜市";
    const wrapper = mount(MenuView, {
      global: {
        stubs: {
          CategoryPanel: true,
          CategoryEditForm: true,
          MenuItemCard: true,
          VirtualMenuGrid: true,
        },
      },
    });

    await wrapper
      .get('[data-testid="menu-item-import-csv"]')
      .setValue(
        [
          "name,category,price,description,isAvailable,keywords",
          '"蚵仔煎","主食",7000,"招牌小吃",true,"蚵仔煎 夜市 逢甲夜市"',
        ].join("\n"),
      );

    await wrapper
      .get('[data-testid="menu-item-import-submit"]')
      .trigger("click");
    await flushPromises();

    expect(
      wrapper.get('[data-testid="market-product-gap-next-step"]').text(),
    ).toContain("重建搜尋索引");
    expect(
      wrapper.get('[data-testid="market-product-gap-next-step"]').text(),
    ).toContain("逢甲夜市");
  });

  it("shows a market search reindex next step after manually adding a product gap item", async () => {
    routeQuery.source = "market-gap";
    routeQuery.gap = "products";
    routeQuery.marketName = "逢甲夜市";
    const wrapper = mount(MenuView, {
      global: {
        stubs: {
          CategoryPanel: true,
          CategoryEditForm: true,
          MenuItemCard: true,
          VirtualMenuGrid: true,
        },
      },
    });

    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("menu.addItem"))!
      .trigger("click");
    await wrapper
      .get('[data-testid="menu-item-name-input"]')
      .setValue("蚵仔煎");
    await wrapper.get('[data-testid="menu-item-price-input"]').setValue(7000);
    await wrapper.get('[data-testid="menu-item-category-select"]').setValue(1);
    await wrapper.get('[data-testid="item-modal"] form').trigger("submit");
    await flushPromises();

    expect(saveMenuItem).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "蚵仔煎",
        categoryId: 1,
        isAvailable: true,
      }),
      undefined,
    );
    expect(
      wrapper.get('[data-testid="market-product-gap-next-step"]').text(),
    ).toContain("重建搜尋索引");
  });

  it.each([
    ["TWD", "1"],
    ["VND", "1"],
    ["MYR", "0.01"],
  ] as const)(
    "steps the item price input by the %s unit (%s)",
    async (code, step) => {
      setRestaurantCurrency(code);
      const wrapper = mountMenuView();
      await wrapper
        .findAll("button")
        .find((button) => button.text().includes("menu.addItem"))!
        .trigger("click");

      expect(
        wrapper.get('[data-testid="menu-item-price-input"]').attributes("step"),
      ).toBe(step);
      wrapper.unmount();
      clearRestaurantCurrency();
    },
  );

  it("writes uploaded image fields to the form and save payload", async () => {
    const wrapper = mountMenuView();
    const file = new File(["jpeg bytes"], "menu.jpg", {
      type: "image/jpeg",
    });
    const imageVariants = {
      thumbnail: "https://cdn.example.test/thumb.webp",
      small: "https://cdn.example.test/small.webp",
      medium: "https://cdn.example.test/medium.webp",
      large: "https://cdn.example.test/large.webp",
    };
    imageUploadMocks.upload.mockResolvedValue({
      imageId: "uploaded-image-id",
      imageUrl: imageVariants.medium,
      imageVariants,
    });

    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("menu.addItem"))!
      .trigger("click");
    await wrapper
      .get('[data-testid="menu-item-name-input"]')
      .setValue("蚵仔煎");
    await wrapper.get('[data-testid="menu-item-price-input"]').setValue(7000);
    await wrapper.get('[data-testid="menu-item-category-select"]').setValue(1);
    await wrapper.vm.handleImageFileSelected({
      target: { files: [file], value: "" },
    } as unknown as Event);

    // The managed restaurant must ride along: a platform admin's token has
    // restaurantId: null, so image-processor 403s without this.
    expect(imageUploadMocks.upload).toHaveBeenCalledWith(file, {
      restaurantId: MANAGED_RESTAURANT_ID,
    });
    expect(wrapper.vm.menuItemForm.imageUrl).toBe(imageVariants.medium);
    expect(wrapper.vm.menuItemForm.imageId).toBe("uploaded-image-id");
    expect(wrapper.vm.menuItemForm.imageVariants).toEqual(imageVariants);

    await wrapper.get('[data-testid="item-modal"] form').trigger("submit");
    await flushPromises();

    expect(saveMenuItem).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrl: imageVariants.medium,
        imageId: "uploaded-image-id",
        imageVariants,
      }),
      undefined,
    );
  });

  it("returns to the filtered market workbench after fixing product gaps", async () => {
    routeQuery.source = "market-gap";
    routeQuery.gap = "products";
    routeQuery.marketName = "逢甲夜市";
    routeQuery.marketSlug = "fengjia";
    routeQuery.areaCity = "台中市";
    routeQuery.areaDistrict = "西屯區";
    const wrapper = mount(MenuView, {
      global: {
        stubs: {
          CategoryPanel: true,
          CategoryEditForm: true,
          MenuItemCard: true,
          VirtualMenuGrid: true,
        },
      },
    });

    await wrapper
      .get('[data-testid="menu-item-import-csv"]')
      .setValue(
        [
          "name,category,price,description,isAvailable,keywords",
          '"蚵仔煎","主食",7000,"招牌小吃",true,"蚵仔煎 夜市 逢甲夜市"',
        ].join("\n"),
      );
    await wrapper
      .get('[data-testid="menu-item-import-submit"]')
      .trigger("click");
    await flushPromises();
    await wrapper
      .get('[data-testid="market-product-gap-return"]')
      .trigger("click");

    expect(push).toHaveBeenCalledWith({
      name: "PlatformMarkets",
      query: {
        marketSlug: "fengjia",
        areaCity: "台中市",
        areaDistrict: "西屯區",
      },
    });
  });

  it("deletes the previous image once after changing imageId and saving successfully", async () => {
    const wrapper = mountMenuView();
    const item = menuItem({
      imageId: "previous-image-id",
      imageUrl: "https://cdn.example.test/previous.jpg",
    });

    await editItem(wrapper, item);
    wrapper.vm.menuItemForm.imageId = "next-image-id";
    await wrapper.get('[data-testid="item-modal"] form').trigger("submit");
    await flushPromises();

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      "https://images.example.test/images/previous-image-id",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    );
  });

  it("does not delete the previous image when saving fails", async () => {
    saveMenuItem.mockResolvedValue("failed");
    const wrapper = mountMenuView();
    const item = menuItem({ imageId: "previous-image-id" });

    await editItem(wrapper, item);
    wrapper.vm.menuItemForm.imageId = "next-image-id";
    await wrapper.get('[data-testid="item-modal"] form').trigger("submit");
    await flushPromises();

    expect(fetch).not.toHaveBeenCalled();
  });

  // Issue #85: the API refuses a save whose version is stale (409
  // MENU_ITEM_MODIFIED). A generic error toast would leave the owner with no
  // idea what happened or what to do about it.
  describe("concurrent edit prompt (#85)", () => {
    it("offers to reload the item instead of reporting a generic failure", async () => {
      saveMenuItem.mockResolvedValue("conflict");
      const wrapper = mountMenuView();

      await editItem(wrapper, menuItem({ name: "牛肉麵" }));
      await wrapper.get('[data-testid="item-modal"] form').trigger("submit");
      await flushPromises();

      const prompt = wrapper.get('[data-testid="menu-item-conflict"]');
      expect(prompt.text()).toContain("menu.conflict.title");
      expect(prompt.attributes("role")).toBe("alert");
      expect(
        wrapper.find('[data-testid="menu-item-conflict-reload"]').exists(),
      ).toBe(true);
      // The modal stays open so the owner still has their edits in front of them.
      expect(wrapper.find('[data-testid="item-modal"]').exists()).toBe(true);
      // Nothing was written, so the old image must not be deleted either.
      expect(fetch).not.toHaveBeenCalled();
    });

    it("reloads the menu and repopulates the form from the fresh item", async () => {
      saveMenuItem.mockResolvedValue("conflict");
      const wrapper = mountMenuView();
      const stale = menuItem({ name: "牛肉麵", price: 7000 });
      menuItems.value = [stale];

      await editItem(wrapper, stale);
      await wrapper.get('[data-testid="item-modal"] form').trigger("submit");
      await flushPromises();

      // Someone else's version is what fetchMenu brings back.
      fetchMenu.mockImplementation(async () => {
        menuItems.value = [
          menuItem({ name: "牛肉麵", price: 9000, isAvailable: false }),
        ];
      });
      // onMounted already fetched once; the reload has to fetch again.
      const fetchesBeforeReload = fetchMenu.mock.calls.length;
      await wrapper
        .get('[data-testid="menu-item-conflict-reload"]')
        .trigger("click");
      await flushPromises();

      expect(fetchMenu.mock.calls.length).toBe(fetchesBeforeReload + 1);
      expect(wrapper.vm.menuItemForm.price).toBe(9000);
      expect(wrapper.vm.menuItemForm.isAvailable).toBe(false);
      expect(wrapper.find('[data-testid="menu-item-conflict"]').exists()).toBe(
        false,
      );
    });

    it("clears the prompt when the owner chooses to keep editing", async () => {
      saveMenuItem.mockResolvedValue("conflict");
      const wrapper = mountMenuView();

      await editItem(wrapper, menuItem());
      await wrapper.get('[data-testid="item-modal"] form').trigger("submit");
      await flushPromises();
      // onMounted already fetched once; dismissing must not fetch again.
      const fetchesBeforeDismiss = fetchMenu.mock.calls.length;
      await wrapper
        .get('[data-testid="menu-item-conflict-dismiss"]')
        .trigger("click");

      expect(wrapper.find('[data-testid="menu-item-conflict"]').exists()).toBe(
        false,
      );
      expect(fetchMenu.mock.calls.length).toBe(fetchesBeforeDismiss);
    });

    // A blanket "take theirs" on reload throws away work the owner may have
    // spent minutes on; a blanket "keep mine" is the overwrite the 409 exists
    // to prevent. Only the baseline the form was opened with can tell the two
    // apart.
    it("keeps the fields the owner edited and adopts the rest from the fresh row", async () => {
      saveMenuItem.mockResolvedValue("conflict");
      const wrapper = mountMenuView();
      const stale = menuItem({ name: "牛肉麵", price: 7000 });
      menuItems.value = [stale];

      await editItem(wrapper, stale);
      // The owner renamed it and never touched the price.
      wrapper.vm.menuItemForm.name = "紅燒牛肉麵";
      await wrapper.get('[data-testid="item-modal"] form').trigger("submit");
      await flushPromises();

      // Someone else repriced it in the meantime.
      fetchMenu.mockImplementation(async () => {
        menuItems.value = [menuItem({ name: "牛肉麵", price: 9000 })];
      });
      await wrapper
        .get('[data-testid="menu-item-conflict-reload"]')
        .trigger("click");
      await flushPromises();

      expect(wrapper.vm.menuItemForm.name).toBe("紅燒牛肉麵");
      expect(wrapper.vm.menuItemForm.price).toBe(9000);

      const summary = wrapper.get('[data-testid="menu-item-merge-summary"]');
      expect(
        summary.find('[data-testid="menu-item-merge-kept"]').exists(),
      ).toBe(true);
      expect(
        summary.find('[data-testid="menu-item-merge-applied"]').exists(),
      ).toBe(true);
      expect(
        summary.find('[data-testid="menu-item-merge-overridden"]').exists(),
      ).toBe(false);
    });

    it("flags a field both sides changed and shows the owner's value", async () => {
      saveMenuItem.mockResolvedValue("conflict");
      const wrapper = mountMenuView();
      const stale = menuItem({ price: 7000 });
      menuItems.value = [stale];

      await editItem(wrapper, stale);
      wrapper.vm.menuItemForm.price = 7500;
      await wrapper.get('[data-testid="item-modal"] form').trigger("submit");
      await flushPromises();

      fetchMenu.mockImplementation(async () => {
        menuItems.value = [menuItem({ price: 9000 })];
      });
      await wrapper
        .get('[data-testid="menu-item-conflict-reload"]')
        .trigger("click");
      await flushPromises();

      // The owner is looking at their own number, so it stays — but they are
      // told the other value existed rather than losing it silently.
      expect(wrapper.vm.menuItemForm.price).toBe(7500);
      expect(
        wrapper.find('[data-testid="menu-item-merge-overridden"]').exists(),
      ).toBe(true);
    });

    it("says the item was deleted rather than closing the modal from under the owner", async () => {
      saveMenuItem.mockResolvedValue("conflict");
      const wrapper = mountMenuView();
      const stale = menuItem();
      menuItems.value = [stale];

      await editItem(wrapper, stale);
      await wrapper.get('[data-testid="item-modal"] form').trigger("submit");
      await flushPromises();

      fetchMenu.mockImplementation(async () => {
        menuItems.value = [];
      });
      await wrapper
        .get('[data-testid="menu-item-conflict-reload"]')
        .trigger("click");
      await flushPromises();

      const prompt = wrapper.get('[data-testid="menu-item-conflict"]');
      expect(prompt.text()).toContain("menu.conflict.removed");
      // Nothing left to merge into, so the reload affordance goes away.
      expect(
        wrapper.find('[data-testid="menu-item-conflict-reload"]').exists(),
      ).toBe(false);
      expect(wrapper.find('[data-testid="item-modal"]').exists()).toBe(true);
    });

    it("sends the version the form was loaded with", async () => {
      const wrapper = mountMenuView();

      await editItem(wrapper, menuItem({ updatedAt: 1785399330250 }));
      await wrapper.get('[data-testid="item-modal"] form').trigger("submit");
      await flushPromises();

      expect(saveMenuItem).toHaveBeenCalledWith(
        expect.objectContaining({ updatedAt: 1785399330250 }),
        1,
      );
    });
  });

  it("does not delete an image when imageId is unchanged", async () => {
    const wrapper = mountMenuView();
    const item = menuItem({ imageId: "same-image-id" });

    await editItem(wrapper, item);
    wrapper.vm.menuItemForm.imageId = "same-image-id";
    await wrapper.get('[data-testid="item-modal"] form').trigger("submit");
    await flushPromises();

    expect(fetch).not.toHaveBeenCalled();
  });

  it("persists advanced product fields when adding an item", async () => {
    const wrapper = mountMenuView();
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("menu.addItem"))!
      .trigger("click");

    await wrapper.get('[data-testid="menu-item-name-input"]').setValue("Curry");
    await wrapper.get('[data-testid="menu-item-price-input"]').setValue(1200);
    await wrapper.get('[data-testid="menu-item-category-select"]').setValue(1);
    wrapper.vm.menuItemForm.originalPrice = 1500;
    wrapper.vm.menuItemForm.spiceLevel = 3;
    wrapper.vm.menuItemForm.preparationTime = 20;
    wrapper.vm.menuItemForm.calories = 650;
    wrapper.vm.menuItemForm.ingredients = "chicken, coconut milk";
    wrapper.vm.menuItemForm.tagsText = "spicy, curry";
    wrapper.vm.menuItemForm.allergensText = "peanuts, dairy";
    wrapper.vm.menuItemForm.dietaryInfo.glutenFree = true;
    wrapper.vm.menuItemForm.sizes = [
      {
        id: "regular",
        name: "Regular",
        priceAdjustment: 0,
        isDefault: false,
      },
    ];

    await wrapper.get('[data-testid="item-modal"] form').trigger("submit");
    await flushPromises();

    expect(saveMenuItem).toHaveBeenCalledWith(
      expect.objectContaining({
        originalPrice: 1500,
        spiceLevel: 3,
        preparationTime: 20,
        calories: 650,
        ingredients: "chicken, coconut milk",
        tags: ["spicy", "curry"],
        allergens: ["peanuts", "dairy"],
        dietaryInfo: { glutenFree: true },
        options: {
          sizes: [
            {
              id: "regular",
              name: "Regular",
              priceAdjustment: 0,
              isDefault: false,
            },
          ],
        },
      }),
      undefined,
    );
  });

  it("builds customization options from form fields instead of requiring JSON", async () => {
    const wrapper = mountMenuView();
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("menu.addItem"))!
      .trigger("click");

    await wrapper.get('[data-testid="menu-item-name-input"]').setValue("Curry");
    await wrapper.get('[data-testid="menu-item-price-input"]').setValue(1200);
    await wrapper.get('[data-testid="menu-item-category-select"]').setValue(1);
    await wrapper.get('[data-testid="add-size-option"]').trigger("click");
    await wrapper.get('[data-testid="add-addon-option"]').trigger("click");
    await wrapper
      .get('[data-testid="add-customization-group"]')
      .trigger("click");

    wrapper.vm.menuItemForm.sizes[0].name = "Small";
    wrapper.vm.menuItemForm.sizes[0].priceAdjustment = 0;
    wrapper.vm.menuItemForm.sizes[0].isDefault = true;
    wrapper.vm.menuItemForm.addOns[0].name = "Egg";
    wrapper.vm.menuItemForm.addOns[0].price = 15;
    wrapper.vm.menuItemForm.customizations[0].name = "Spice";
    wrapper.vm.menuItemForm.customizations[0].type = "single";
    wrapper.vm.menuItemForm.customizations[0].required = true;
    wrapper.vm.menuItemForm.customizations[0].choices[0].name = "Mild";
    wrapper.vm.menuItemForm.customizations[0].choices[0].isDefault = true;

    await wrapper.get('[data-testid="item-modal"] form').trigger("submit");
    await flushPromises();

    expect(saveMenuItem).toHaveBeenCalledWith(
      expect.objectContaining({
        options: {
          sizes: [
            {
              id: expect.any(String),
              name: "Small",
              priceAdjustment: 0,
              isDefault: true,
            },
          ],
          customizations: [
            {
              id: expect.any(String),
              name: "Spice",
              type: "single",
              required: true,
              choices: [
                {
                  id: expect.any(String),
                  name: "Mild",
                  priceAdjustment: 0,
                  isDefault: true,
                },
              ],
            },
          ],
          addOns: [
            {
              id: expect.any(String),
              name: "Egg",
              price: 15,
              available: true,
            },
          ],
        },
      }),
      undefined,
    );
  });

  it("copies the option rows of another item into the form", async () => {
    const wrapper = mountMenuView();
    // Every drink shares one 甜度 group; rebuilding it by hand per item is what
    // owners stop doing halfway through the menu.
    menuItems.value = [
      menuItem({
        id: 42,
        name: "珍珠奶茶",
        options: {
          sizes: [{ id: "l", name: "大杯", priceAdjustment: 10 }],
          customizations: [
            {
              id: "sweet",
              name: "甜度",
              type: "single",
              required: true,
              choices: [{ id: "half", name: "半糖", priceAdjustment: 0 }],
            },
          ],
        },
      }),
    ];

    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("menu.addItem"))!
      .trigger("click");
    await wrapper.get('[data-testid="option-source-select"]').setValue(42);
    await wrapper.get('[data-testid="copy-options"]').trigger("click");

    expect(wrapper.vm.menuItemForm.sizes[0].name).toBe("大杯");
    expect(wrapper.vm.menuItemForm.customizations[0].name).toBe("甜度");
    expect(wrapper.vm.menuItemForm.customizations[0].choices[0].name).toBe(
      "半糖",
    );
  });

  it("never sends a leftover cap on a single-choice group", async () => {
    const wrapper = mountMenuView();
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("menu.addItem"))!
      .trigger("click");

    await wrapper.get('[data-testid="menu-item-name-input"]').setValue("Tea");
    await wrapper.get('[data-testid="menu-item-price-input"]').setValue(1200);
    await wrapper.get('[data-testid="menu-item-category-select"]').setValue(1);
    await wrapper
      .get('[data-testid="add-customization-group"]')
      .trigger("click");

    wrapper.vm.menuItemForm.customizations[0].name = "Toppings";
    wrapper.vm.menuItemForm.customizations[0].type = "single";
    // Left over from a switch to single: it must not reach the strict schema.
    wrapper.vm.menuItemForm.customizations[0].maxSelections = 2;
    wrapper.vm.menuItemForm.customizations[0].choices[0].name = "Jelly";

    await wrapper.get('[data-testid="item-modal"] form').trigger("submit");
    await flushPromises();

    const payload = saveMenuItem.mock.calls.at(-1)![0] as {
      options: { customizations: Array<Record<string, unknown>> };
    };
    expect(payload.options.customizations[0]).not.toHaveProperty(
      "maxSelections",
    );
  });

  it("sends an add-on quantity cap, and omits it when left blank", async () => {
    const wrapper = mountMenuView();
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("menu.addItem"))!
      .trigger("click");

    await wrapper.get('[data-testid="menu-item-name-input"]').setValue("Rice");
    await wrapper.get('[data-testid="menu-item-price-input"]').setValue(1200);
    await wrapper.get('[data-testid="menu-item-category-select"]').setValue(1);
    await wrapper.get('[data-testid="add-addon-option"]').trigger("click");
    await wrapper.get('[data-testid="add-addon-option"]').trigger("click");

    wrapper.vm.menuItemForm.addOns[0].name = "加蛋";
    wrapper.vm.menuItemForm.addOns[0].maxQuantity = 2;
    wrapper.vm.menuItemForm.addOns[1].name = "加飯";

    await wrapper.get('[data-testid="item-modal"] form').trigger("submit");
    await flushPromises();

    const payload = saveMenuItem.mock.calls.at(-1)![0] as {
      options: { addOns: Array<Record<string, unknown>> };
    };
    expect(payload.options.addOns[0].maxQuantity).toBe(2);
    // Blank means no cap, and the strict schema rejects a null or a 0.
    expect(payload.options.addOns[1]).not.toHaveProperty("maxQuantity");
  });

  // Which editor an item gets follows the same rule the assembler uses: link
  // rows mean shared groups, no link rows mean it is still on its JSON options.
  describe("shared option groups", () => {
    const linked = () => [
      {
        groupId: "group-sweet",
        sortOrder: 0,
        requiredOverride: null,
        maxSelectionsOverride: null,
        choiceOverrides: [],
      },
    ];

    it("opens an item with links in shared mode", async () => {
      const wrapper = mountMenuView();
      const existing = menuItem();
      menuItems.value = [existing];
      fetchItemGroups.mockResolvedValue(linked());

      await editItem(wrapper, existing);
      await flushPromises();

      expect(fetchItemGroups).toHaveBeenCalledWith(existing.id);
      expect(wrapper.vm.usesSharedOptionGroups).toBe(true);
      // The inline editor is gone; there is nothing to half-edit.
      expect(wrapper.find('[data-testid="add-size-option"]').exists()).toBe(
        false,
      );
    });

    it("leaves an item without links on the inline editor", async () => {
      const wrapper = mountMenuView();
      const existing = menuItem();
      menuItems.value = [existing];
      fetchItemGroups.mockResolvedValue([]);

      await editItem(wrapper, existing);
      await flushPromises();

      expect(wrapper.vm.usesSharedOptionGroups).toBe(false);
      expect(wrapper.find('[data-testid="add-size-option"]').exists()).toBe(
        true,
      );
      expect(
        wrapper.find('[data-testid="switch-to-shared-groups"]').exists(),
      ).toBe(true);
    });

    it("saves links separately and leaves the JSON column alone", async () => {
      const wrapper = mountMenuView();
      const existing = menuItem();
      menuItems.value = [existing];
      fetchItemGroups.mockResolvedValue(linked());

      await editItem(wrapper, existing);
      await flushPromises();
      await wrapper.get('[data-testid="item-modal"] form').trigger("submit");
      await flushPromises();

      // Not `options: null` — the stored JSON stays recoverable if the owner
      // switches back.
      const payload = saveMenuItem.mock.calls.at(-1)![0] as Record<
        string,
        unknown
      >;
      expect(payload.options).toBeUndefined();
      expect(saveItemGroups).toHaveBeenCalledWith(existing.id, linked());
    });

    it("keeps the modal open when the links fail to save", async () => {
      const wrapper = mountMenuView();
      const existing = menuItem();
      menuItems.value = [existing];
      fetchItemGroups.mockResolvedValue(linked());
      saveItemGroups.mockResolvedValue(false);

      await editItem(wrapper, existing);
      await flushPromises();
      await wrapper.get('[data-testid="item-modal"] form').trigger("submit");
      await flushPromises();

      expect(wrapper.find('[data-testid="item-modal"]').exists()).toBe(true);
    });
  });

  it("reorders option rows", async () => {
    const wrapper = mountMenuView();
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("menu.addItem"))!
      .trigger("click");

    await wrapper.get('[data-testid="add-size-option"]').trigger("click");
    await wrapper.get('[data-testid="add-size-option"]').trigger("click");
    wrapper.vm.menuItemForm.sizes[0].name = "小碗";
    wrapper.vm.menuItemForm.sizes[1].name = "大碗";
    await nextTick();

    await wrapper.get('[data-testid="move-size-down-0"]').trigger("click");

    expect(wrapper.vm.menuItemForm.sizes.map((size) => size.name)).toEqual([
      "大碗",
      "小碗",
    ]);
    // The top row cannot move up, so the control is not offered.
    expect(
      wrapper.get('[data-testid="move-size-up-0"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("sends inventory fields and keeps unlimited inventory as null", async () => {
    const wrapper = mountMenuView();
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("menu.addItem"))!
      .trigger("click");

    await wrapper.get('[data-testid="menu-item-name-input"]').setValue("Tea");
    await wrapper.get('[data-testid="menu-item-price-input"]').setValue(1200);
    await wrapper.get('[data-testid="menu-item-category-select"]').setValue(1);
    await wrapper.get('[data-testid="inventory-count-input"]').setValue("");
    await wrapper.get('[data-testid="min-inventory-alert-input"]').setValue(3);
    await wrapper.get('[data-testid="item-modal"] form').trigger("submit");
    await flushPromises();

    expect(saveMenuItem).toHaveBeenCalledWith(
      expect.objectContaining({
        inventoryCount: null,
        minInventoryAlert: 3,
      }),
      undefined,
    );
  });

  it("sends null for cleared optional fields and omits an empty preparation time", async () => {
    const wrapper = mountMenuView();
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("menu.addItem"))!
      .trigger("click");

    await wrapper.get('[data-testid="menu-item-name-input"]').setValue("Curry");
    await wrapper.get('[data-testid="menu-item-price-input"]').setValue(1200);
    await wrapper.get('[data-testid="menu-item-category-select"]').setValue(1);
    wrapper.vm.menuItemForm.preparationTime = "";

    await wrapper.get('[data-testid="item-modal"] form').trigger("submit");
    await flushPromises();

    expect(saveMenuItem).toHaveBeenCalledWith(
      expect.objectContaining({
        // Empty text fields send null, not undefined: a partial update only
        // writes the keys it carries, so an omitted key leaves the stored
        // value in place and the field can never be emptied again.
        nameEn: null,
        description: null,
        originalPrice: null,
        calories: null,
        ingredients: null,
        keywords: null,
        options: null,
        preparationTime: undefined,
      }),
      undefined,
    );
  });

  // The path #113 actually broke. Every other advanced-field test opens the
  // "add" form, which starts empty — so none of them could notice that editing
  // an existing item loaded blank tags and wrote the blank straight back.
  describe("editing an existing item (#113)", () => {
    const stored = () =>
      menuItem({
        nameEn: "Oyster Omelette",
        description: "台南口味",
        originalPrice: 9000,
        ingredients: "蚵仔, 蛋",
        spiceLevel: 2,
        preparationTime: 20,
        calories: 650,
        tags: ["signature", "spicy"],
        keywords: "oyster,omelette",
        allergens: ["seafood", "egg"],
        dietaryInfo: { glutenFree: true },
        updatedAt: 1785399330250,
      });

    it("loads the stored advanced fields into the form", async () => {
      const wrapper = mountMenuView();
      const existing = menuItem({
        ...stored(),
        inventoryCount: 8,
        minInventoryAlert: 2,
        options: {
          sizes: [
            {
              id: "large",
              name: "Large",
              priceAdjustment: 30,
              isDefault: true,
            },
          ],
          addOns: [{ id: "egg", name: "Egg", price: 15 }],
          customizations: [
            {
              id: "spice",
              name: "Spice",
              type: "single",
              required: true,
              choices: [
                {
                  id: "mild",
                  name: "Mild",
                  priceAdjustment: 0,
                  isDefault: true,
                },
              ],
            },
          ],
        },
      });
      menuItems.value = [existing];

      await editItem(wrapper, existing);

      expect(wrapper.vm.menuItemForm.tagsText).toBe("signature, spicy");
      expect(wrapper.vm.menuItemForm.keywords).toBe("oyster,omelette");
      expect(wrapper.vm.menuItemForm.allergensText).toBe("seafood, egg");
      expect(wrapper.vm.menuItemForm.originalPrice).toBe(9000);
      expect(wrapper.vm.menuItemForm.dietaryInfo.glutenFree).toBe(true);
      expect(wrapper.vm.menuItemForm.inventoryCount).toBe(8);
      expect(wrapper.vm.menuItemForm.minInventoryAlert).toBe(2);
      expect(wrapper.vm.menuItemForm.sizes[0].name).toBe("Large");
      expect(wrapper.vm.menuItemForm.addOns[0].name).toBe("Egg");
      expect(wrapper.vm.menuItemForm.customizations[0].choices[0].name).toBe(
        "Mild",
      );
    });

    // The form is the only editor now, so anything it cannot represent is lost
    // on the next save. Caps must survive a load-and-save round trip.
    it("keeps stored option caps through an edit", async () => {
      const wrapper = mountMenuView();
      const existing = menuItem({
        ...stored(),
        options: {
          addOns: [{ id: "egg", name: "Egg", price: 15, maxQuantity: 2 }],
          customizations: [
            {
              id: "toppings",
              name: "Toppings",
              type: "multiple",
              required: false,
              maxSelections: 3,
              choices: [{ id: "corn", name: "Corn", priceAdjustment: 5 }],
            },
          ],
        },
      });
      menuItems.value = [existing];

      await editItem(wrapper, existing);

      expect(wrapper.vm.menuItemForm.customizations[0].maxSelections).toBe(3);
      expect(wrapper.vm.menuItemForm.addOns[0].maxQuantity).toBe(2);

      await wrapper.get('[data-testid="item-modal"] form').trigger("submit");
      await flushPromises();

      const payload = saveMenuItem.mock.calls.at(-1)![0] as {
        options: {
          addOns: Array<Record<string, unknown>>;
          customizations: Array<Record<string, unknown>>;
        };
      };
      expect(payload.options.customizations[0].maxSelections).toBe(3);
      expect(payload.options.addOns[0].maxQuantity).toBe(2);
    });

    it("writes them back untouched when nothing was edited", async () => {
      const wrapper = mountMenuView();
      const existing = stored();
      menuItems.value = [existing];

      await editItem(wrapper, existing);
      await wrapper.get('[data-testid="item-modal"] form').trigger("submit");
      await flushPromises();

      // tags/keywords in particular: the mapper used to omit them, so the form
      // loaded empty and this save silently replaced the stored values.
      expect(saveMenuItem).toHaveBeenCalledWith(
        expect.objectContaining({
          nameEn: "Oyster Omelette",
          description: "台南口味",
          tags: ["signature", "spicy"],
          keywords: "oyster,omelette",
          allergens: ["seafood", "egg"],
          dietaryInfo: { glutenFree: true },
          originalPrice: 9000,
          ingredients: "蚵仔, 蛋",
          calories: 650,
          spiceLevel: 2,
          preparationTime: 20,
        }),
        existing.id,
      );
    });

    it("clears a stored field instead of leaving the old value behind", async () => {
      const wrapper = mountMenuView();
      const existing = stored();
      menuItems.value = [existing];

      await editItem(wrapper, existing);
      wrapper.vm.menuItemForm.nameEn = "";
      wrapper.vm.menuItemForm.description = "";
      wrapper.vm.menuItemForm.keywords = "";
      wrapper.vm.menuItemForm.tagsText = "";
      wrapper.vm.menuItemForm.originalPrice = undefined;
      await nextTick();

      await wrapper.get('[data-testid="item-modal"] form').trigger("submit");
      await flushPromises();

      expect(saveMenuItem).toHaveBeenCalledWith(
        expect.objectContaining({
          nameEn: null,
          description: null,
          keywords: null,
          tags: [],
          originalPrice: null,
        }),
        existing.id,
      );
    });

    it("keeps a null low-inventory alert blank when editing", async () => {
      const wrapper = mountMenuView();
      const existing = menuItem({
        ...stored(),
        inventoryCount: null,
        minInventoryAlert: null,
      });
      menuItems.value = [existing];

      await editItem(wrapper, existing);
      await wrapper.get('[data-testid="item-modal"] form').trigger("submit");
      await flushPromises();

      expect(saveMenuItem).toHaveBeenCalledWith(
        expect.objectContaining({
          inventoryCount: null,
          minInventoryAlert: null,
        }),
        existing.id,
      );
    });

    it("refuses to submit an option row that would be silently dropped", async () => {
      const wrapper = mountMenuView();
      const existing = stored();
      menuItems.value = [existing];

      await editItem(wrapper, existing);
      // A group the owner named but never gave a choice: buildStructuredOptions
      // drops it, so saving would report success and store nothing.
      await wrapper
        .get('[data-testid="add-customization-group"]')
        .trigger("click");
      wrapper.vm.menuItemForm.customizations[0].name = "Spice";
      await nextTick();

      await wrapper.get('[data-testid="item-modal"] form').trigger("submit");
      await flushPromises();

      expect(saveMenuItem).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain("menu.form.optionsIncomplete");
    });
  });
});

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

function mountMenuView(): VueWrapper<MenuViewInternals> {
  return mount(MenuView, {
    global: {
      stubs: {
        CategoryPanel: true,
        CategoryEditForm: true,
        MenuItemCard: true,
        VirtualMenuGrid: true,
      },
    },
  }) as unknown as VueWrapper<MenuViewInternals>;
}

function menuItem(overrides: Partial<MenuItemData> = {}): MenuItemData {
  return {
    id: 1,
    categoryId: 1,
    catalogType: "menu_item",
    name: "蚵仔煎",
    price: 7000,
    imageUrl: null,
    imageId: null,
    isFeatured: false,
    isAvailable: true,
    sortOrder: 0,
    inventoryCount: null,
    minInventoryAlert: 5,
    ...overrides,
  };
}

async function editItem(
  wrapper: ReturnType<typeof mountMenuView>,
  item: ReturnType<typeof menuItem>,
) {
  wrapper.vm.editMenuItem(item);
  await nextTick();
}
