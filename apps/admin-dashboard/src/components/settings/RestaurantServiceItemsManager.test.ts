// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RestaurantServiceItemsManager from "./RestaurantServiceItemsManager.vue";
import { restaurantServiceItemsService } from "@/services/restaurantServiceItemsService";
import {
  clearRestaurantCurrency,
  setRestaurantCurrency,
} from "@/composables/useCurrency";

// BaseEntity declares createdAt/updatedAt as Unix milliseconds, not ISO strings.
const FIXTURE_TIMESTAMP_MS = 1_780_000_000_000;

const push = vi.fn();

vi.mock("@/services/restaurantServiceItemsService", () => ({
  restaurantServiceItemsService: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ push }),
}));

describe("RestaurantServiceItemsManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(restaurantServiceItemsService.list).mockResolvedValue([]);
  });

  it("loads and creates restaurant service items", async () => {
    vi.mocked(restaurantServiceItemsService.list)
      .mockResolvedValueOnce([
        {
          id: 1,
          restaurantId: "restaurant-1",
          name: "預約外送",
          serviceType: "delivery",
          priceLabel: "依距離報價",
          requiresBooking: true,
          sortOrder: 1,
          isActive: true,
          isPublic: true,
          createdAt: FIXTURE_TIMESTAMP_MS,
          updatedAt: FIXTURE_TIMESTAMP_MS,
        },
      ])
      .mockResolvedValueOnce([]);
    vi.mocked(restaurantServiceItemsService.create).mockResolvedValueOnce({
      id: 2,
      restaurantId: "restaurant-1",
      name: "代客切水果",
      serviceType: "general",
      requiresBooking: false,
      sortOrder: 0,
      isActive: true,
      isPublic: true,
      createdAt: FIXTURE_TIMESTAMP_MS,
      updatedAt: FIXTURE_TIMESTAMP_MS,
    });

    const wrapper = mount(RestaurantServiceItemsManager, {
      props: { restaurantId: "restaurant-1" },
    });

    await flushPromises();

    expect(restaurantServiceItemsService.list).toHaveBeenCalledWith(
      "restaurant-1",
    );
    expect(wrapper.text()).toContain("預約外送");

    await wrapper
      .get('[data-testid="service-name-input"]')
      .setValue("代客切水果");
    await wrapper.get("form").trigger("submit.prevent");

    expect(restaurantServiceItemsService.create).toHaveBeenCalledWith(
      "restaurant-1",
      expect.objectContaining({
        name: "代客切水果",
        serviceType: "general",
        isPublic: true,
        isActive: true,
      }),
    );
  });

  describe("price in the restaurant's currency", () => {
    const pricedItem = {
      id: 7,
      restaurantId: "restaurant-1",
      name: "彩繪體驗",
      serviceType: "activity" as const,
      priceCents: 35000,
      requiresBooking: true,
      sortOrder: 0,
      isActive: true,
      isPublic: true,
      createdAt: FIXTURE_TIMESTAMP_MS,
      updatedAt: FIXTURE_TIMESTAMP_MS,
    };

    afterEach(clearRestaurantCurrency);

    it("takes whole NT$ in a TWD shop and sends cents", async () => {
      clearRestaurantCurrency();
      vi.mocked(restaurantServiceItemsService.list).mockResolvedValue([
        pricedItem,
      ]);
      vi.mocked(restaurantServiceItemsService.create).mockResolvedValueOnce(
        pricedItem,
      );
      const wrapper = mount(RestaurantServiceItemsManager, {
        props: { restaurantId: "restaurant-1" },
      });
      await flushPromises();

      expect(wrapper.text()).toContain("NT$350");
      const price = wrapper.get('[data-testid="service-price-input"]');
      expect(price.attributes("step")).toBe("1");
      expect(price.attributes("placeholder")).toBe("0");
      expect(wrapper.get('label[for="service-price-input"]').text()).toContain(
        "NT$",
      );

      await wrapper.get('[data-testid="service-name-input"]').setValue("導覽");
      await price.setValue("350");
      await wrapper.get("form").trigger("submit.prevent");

      expect(restaurantServiceItemsService.create).toHaveBeenCalledWith(
        "restaurant-1",
        expect.objectContaining({ name: "導覽", priceCents: 35000 }),
      );
    });

    it("takes RM with sen in an MYR shop and edits in major units", async () => {
      setRestaurantCurrency("MYR");
      vi.mocked(restaurantServiceItemsService.list).mockResolvedValue([
        { ...pricedItem, priceCents: 1250 },
      ]);
      vi.mocked(restaurantServiceItemsService.update).mockResolvedValueOnce(
        pricedItem,
      );
      const wrapper = mount(RestaurantServiceItemsManager, {
        props: { restaurantId: "restaurant-1" },
      });
      await flushPromises();

      expect(wrapper.text()).toContain("RM 12.50");
      await wrapper.get('[data-testid="edit-service-7"]').trigger("click");
      const price = wrapper.get('[data-testid="service-price-input"]');
      expect(price.attributes("step")).toBe("0.01");
      expect((price.element as HTMLInputElement).value).toBe("12.5");

      await price.setValue("13.9");
      await wrapper.get("form").trigger("submit.prevent");

      expect(restaurantServiceItemsService.update).toHaveBeenCalledWith(
        "restaurant-1",
        7,
        expect.objectContaining({ priceCents: 1390 }),
      );
    });
  });

  it("updates and removes existing service items", async () => {
    const serviceItem = {
      id: 1,
      restaurantId: "restaurant-1",
      name: "代客切水果",
      description: "現場代切並分裝",
      serviceType: "general" as const,
      priceLabel: "依份量報價",
      requiresBooking: false,
      sortOrder: 0,
      isActive: true,
      isPublic: true,
      createdAt: FIXTURE_TIMESTAMP_MS,
      updatedAt: FIXTURE_TIMESTAMP_MS,
    };
    vi.mocked(restaurantServiceItemsService.list)
      .mockResolvedValueOnce([serviceItem])
      .mockResolvedValueOnce([serviceItem]);
    vi.mocked(restaurantServiceItemsService.update).mockResolvedValueOnce({
      id: 1,
      restaurantId: "restaurant-1",
      name: "預約切水果",
      serviceType: "general",
      requiresBooking: false,
      sortOrder: 0,
      isActive: true,
      isPublic: true,
      createdAt: FIXTURE_TIMESTAMP_MS,
      updatedAt: FIXTURE_TIMESTAMP_MS,
    });
    vi.mocked(restaurantServiceItemsService.remove).mockResolvedValueOnce();

    const wrapper = mount(RestaurantServiceItemsManager, {
      props: { restaurantId: "restaurant-1" },
    });

    await flushPromises();
    await wrapper.get('[data-testid="edit-service-1"]').trigger("click");
    await wrapper
      .get('[data-testid="service-name-input"]')
      .setValue("預約切水果");
    await wrapper.get('[data-testid="service-description-input"]').setValue("");
    await wrapper.get('[data-testid="service-price-label-input"]').setValue("");
    await wrapper.get("form").trigger("submit.prevent");

    expect(restaurantServiceItemsService.update).toHaveBeenCalledWith(
      "restaurant-1",
      1,
      expect.objectContaining({
        name: "預約切水果",
        description: null,
        priceLabel: null,
      }),
    );

    await wrapper.get('[data-testid="delete-service-1"]').trigger("click");

    expect(restaurantServiceItemsService.remove).toHaveBeenCalledWith(
      "restaurant-1",
      1,
    );
  });

  it("imports service items from CSV", async () => {
    vi.mocked(restaurantServiceItemsService.create).mockResolvedValue({
      id: 2,
      restaurantId: "restaurant-1",
      name: "代客切水果",
      serviceType: "general",
      requiresBooking: false,
      sortOrder: 1,
      isActive: true,
      isPublic: true,
      createdAt: FIXTURE_TIMESTAMP_MS,
      updatedAt: FIXTURE_TIMESTAMP_MS,
    });
    const wrapper = mount(RestaurantServiceItemsManager, {
      props: { restaurantId: "restaurant-1" },
    });

    await flushPromises();
    await wrapper
      .get('[data-testid="service-import-csv"]')
      .setValue(
        [
          "name,serviceType,description,priceCents,durationMinutes,requiresBooking,tags,sortOrder,isActive,isPublic",
          '"代客切水果",general,"現場代切並分裝",5000,15,false,"水果;分裝",1,true,true',
        ].join("\n"),
      );
    expect(wrapper.text()).toContain("已解析 1 筆服務");

    await wrapper.get('[data-testid="service-import-submit"]').trigger("click");
    await flushPromises();

    expect(restaurantServiceItemsService.create).toHaveBeenCalledWith(
      "restaurant-1",
      expect.objectContaining({
        name: "代客切水果",
        serviceType: "general",
        priceCents: 5000,
        durationMinutes: 15,
        requiresBooking: false,
        tags: ["水果", "分裝"],
        keywords: "水果 分裝",
        sortOrder: 1,
        isActive: true,
        isPublic: true,
      }),
    );
    expect(restaurantServiceItemsService.list).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain("已成功匯入 1 筆服務");
  });

  it("shows market gap context and reindex next step after service import", async () => {
    vi.mocked(restaurantServiceItemsService.create).mockResolvedValue({
      id: 2,
      restaurantId: "restaurant-1",
      name: "代客切水果",
      serviceType: "general",
      requiresBooking: false,
      sortOrder: 1,
      isActive: true,
      isPublic: true,
      createdAt: FIXTURE_TIMESTAMP_MS,
      updatedAt: FIXTURE_TIMESTAMP_MS,
    });
    const wrapper = mount(RestaurantServiceItemsManager, {
      props: {
        restaurantId: "restaurant-1",
        isMarketServiceGapContext: true,
        marketGapName: "逢甲夜市",
      },
    });

    await flushPromises();

    expect(
      wrapper.get('[data-testid="market-service-gap-context"]').text(),
    ).toContain("逢甲夜市");

    await wrapper
      .get('[data-testid="service-import-csv"]')
      .setValue(
        [
          "name,serviceType,description,requiresBooking,sortOrder,isActive,isPublic",
          '"代客切水果",general,"現場代切並分裝",false,1,true,true',
        ].join("\n"),
      );
    await wrapper.get('[data-testid="service-import-submit"]').trigger("click");
    await flushPromises();

    expect(
      wrapper.get('[data-testid="market-service-gap-next-step"]').text(),
    ).toContain("重建搜尋索引");
    expect(
      wrapper.get('[data-testid="market-service-gap-next-step"]').text(),
    ).toContain("逢甲夜市");
  });

  it("shows market gap reindex next step after manually adding a service", async () => {
    vi.mocked(restaurantServiceItemsService.create).mockResolvedValue({
      id: 2,
      restaurantId: "restaurant-1",
      name: "代客切水果",
      serviceType: "general",
      requiresBooking: false,
      sortOrder: 0,
      isActive: true,
      isPublic: true,
      createdAt: FIXTURE_TIMESTAMP_MS,
      updatedAt: FIXTURE_TIMESTAMP_MS,
    });
    const wrapper = mount(RestaurantServiceItemsManager, {
      props: {
        restaurantId: "restaurant-1",
        isMarketServiceGapContext: true,
        marketGapName: "逢甲夜市",
      },
    });

    await flushPromises();
    await wrapper
      .get('[data-testid="service-name-input"]')
      .setValue("代客切水果");
    await wrapper.get("form").trigger("submit.prevent");
    await flushPromises();

    expect(restaurantServiceItemsService.create).toHaveBeenCalledWith(
      "restaurant-1",
      expect.objectContaining({
        name: "代客切水果",
        isPublic: true,
        isActive: true,
      }),
    );
    expect(
      wrapper.get('[data-testid="market-service-gap-next-step"]').text(),
    ).toContain("重建搜尋索引");
  });

  it("returns to the filtered market workbench after fixing service gaps", async () => {
    vi.mocked(restaurantServiceItemsService.create).mockResolvedValue({
      id: 2,
      restaurantId: "restaurant-1",
      name: "代客切水果",
      serviceType: "general",
      requiresBooking: false,
      sortOrder: 1,
      isActive: true,
      isPublic: true,
      createdAt: FIXTURE_TIMESTAMP_MS,
      updatedAt: FIXTURE_TIMESTAMP_MS,
    });
    const wrapper = mount(RestaurantServiceItemsManager, {
      props: {
        restaurantId: "restaurant-1",
        isMarketServiceGapContext: true,
        marketGapName: "逢甲夜市",
        marketGapSlug: "fengjia",
        marketGapAreaCity: "台中市",
        marketGapAreaDistrict: "西屯區",
      },
    });

    await flushPromises();
    await wrapper
      .get('[data-testid="service-import-csv"]')
      .setValue(
        [
          "name,serviceType,description,requiresBooking,sortOrder,isActive,isPublic",
          '"代客切水果",general,"現場代切並分裝",false,1,true,true',
        ].join("\n"),
      );
    await wrapper.get('[data-testid="service-import-submit"]').trigger("click");
    await flushPromises();
    await wrapper
      .get('[data-testid="market-service-gap-return"]')
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
});

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}
