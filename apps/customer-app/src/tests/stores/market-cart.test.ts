import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useMarketCartStore } from "@/stores/marketCart";
import type { MenuItem } from "@makanmasak/shared-types";

function menuItem(overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    id: 42,
    restaurantId: "restaurant-1",
    categoryId: 10,
    catalogType: "menu_item",
    name: "章魚燒",
    price: 80,
    spiceLevel: 0,
    sortOrder: 1,
    isAvailable: true,
    isFeatured: false,
    inventoryCount: null,
    orderCount: 0,
    createdAt: 1786_000_000_000,
    updatedAt: 1786_000_000_000,
    ...overrides,
  };
}

describe("useMarketCartStore", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it("removes only the closed vendor and persists the remaining basket", () => {
    const store = useMarketCartStore();
    for (const [restaurantId, id] of [
      ["vendor-a", 42],
      ["vendor-b", 43],
    ] as const) {
      store.addItem({
        marketSlug: "fengjia",
        marketName: "逢甲夜市",
        restaurantId,
        restaurantName: restaurantId,
        item: menuItem({ id, restaurantId }),
        quantity: 1,
      });
    }

    store.removeVendor("fengjia", "vendor-a");

    expect(
      store.cartForMarket("fengjia")?.vendors.map((v) => v.restaurantId),
    ).toEqual(["vendor-b"]);
    expect(
      JSON.parse(localStorage.getItem("makanmakan_market_carts_v1")!).fengjia
        .vendors,
    ).toHaveLength(1);
  });

  it("groups market cart items by vendor and merges matching items", () => {
    const store = useMarketCartStore();

    store.addItem({
      marketSlug: "fengjia",
      marketName: "逢甲夜市",
      restaurantId: "restaurant-1",
      restaurantName: "雞排攤",
      item: menuItem(),
      quantity: 1,
    });
    store.addItem({
      marketSlug: "fengjia",
      marketName: "逢甲夜市",
      restaurantId: "restaurant-1",
      restaurantName: "雞排攤",
      item: menuItem(),
      quantity: 2,
    });
    store.addItem({
      marketSlug: "fengjia",
      marketName: "逢甲夜市",
      restaurantId: "restaurant-2",
      restaurantName: "甜點攤",
      item: menuItem({ id: 43, restaurantId: "restaurant-2", name: "豆花" }),
      quantity: 1,
    });

    const cart = store.cartForMarket("fengjia");
    expect(cart?.vendors).toHaveLength(2);
    expect(cart?.vendors[0].items[0].quantity).toBe(3);
    expect(store.itemCountForCart(cart!)).toBe(4);
    expect(store.subtotalForCart(cart!)).toBe(320);
  });

  it("restores valid market baskets from localStorage", () => {
    localStorage.setItem(
      "makanmakan_market_carts_v1",
      JSON.stringify({
        fengjia: {
          marketSlug: "fengjia",
          marketName: "逢甲夜市",
          updatedAt: Date.now(),
          vendors: [
            {
              restaurantId: "restaurant-1",
              name: "雞排攤",
              items: [
                {
                  id: "42",
                  menuItem: menuItem(),
                  quantity: 2,
                  price: 80,
                  totalPrice: 160,
                },
              ],
            },
          ],
        },
      }),
    );

    setActivePinia(createPinia());
    const store = useMarketCartStore();

    expect(store.cartForMarket("fengjia")?.vendors[0].items[0].quantity).toBe(
      2,
    );
  });

  it("discards invalid and expired market baskets", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    localStorage.setItem(
      "makanmakan_market_carts_v1",
      JSON.stringify({
        stale: {
          marketSlug: "stale",
          marketName: "過期夜市",
          updatedAt: Date.now() - 3 * 60 * 60 * 1000,
          vendors: [],
        },
      }),
    );

    const store = useMarketCartStore();

    expect(store.cartForMarket("stale")).toBeNull();
    warn.mockRestore();
  });
});
