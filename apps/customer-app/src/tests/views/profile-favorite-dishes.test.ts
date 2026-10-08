/**
 * 收藏的菜色 on the profile page, against the real `useFollowing` composable
 * with only the service layer mocked: a saved dish has to come back as a name
 * linking to its shop's menu, and a deleted one has to stay removable.
 */

import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/customerIdentityApi", () => ({
  customerIdentityApi: {
    listFavorites: vi.fn(),
    addFavorite: vi.fn(),
    removeFavorite: vi.fn(),
  },
}));

vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    currentLanguage: "zh-TW",
  }),
}));

import { customerIdentityApi } from "@/services/customerIdentityApi";
import type { CustomerFavorite } from "@/services/customerIdentityApi";
import { resetFollowing } from "@/composables/useFollowing";
import FavoriteDishesList from "@/components/follow/FavoriteDishesList.vue";

function buildFavorite(
  overrides: Partial<CustomerFavorite> = {},
): CustomerFavorite {
  return {
    id: 8,
    targetType: "dish",
    targetId: "42",
    createdAtMs: 1_764_000_000_000,
    dish: { name: "滷肉飯", nameEn: "Braised Pork Rice", restaurantId: "r-1" },
    ...overrides,
  };
}

async function mountList() {
  const wrapper = mount(FavoriteDishesList, {
    global: {
      stubs: {
        RouterLink: {
          props: ["to"],
          template: '<a :data-to="JSON.stringify(to)"><slot /></a>',
        },
      },
    },
  });
  await vi.waitFor(() => {
    expect(customerIdentityApi.listFavorites).toHaveBeenCalled();
  });
  await vi.waitFor(() => {
    expect(
      wrapper.find('[data-testid="favorite-dishes-loading"]').exists(),
    ).toBe(false);
  });
  return wrapper;
}

describe("FavoriteDishesList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFollowing();
    vi.mocked(customerIdentityApi.removeFavorite).mockResolvedValue(
      undefined as never,
    );
  });

  it("lists only dish favorites, linked to the dish on its shop's menu", async () => {
    vi.mocked(customerIdentityApi.listFavorites).mockResolvedValue([
      buildFavorite(),
      buildFavorite({
        id: 7,
        targetType: "restaurant",
        targetId: "r-1",
        dish: undefined,
      }),
    ]);

    const wrapper = await mountList();

    const row = wrapper.get('[data-testid="favorite-dish-42"]');
    expect(row.text()).toContain("滷肉飯");
    expect(JSON.parse(row.get("a").attributes("data-to") ?? "{}")).toEqual({
      path: "/restaurant/r-1/shop/menu",
      query: { itemId: "42" },
    });
    expect(wrapper.find('[data-testid="favorite-dish-r-1"]').exists()).toBe(
      false,
    );
  });

  it("keeps a deleted dish removable and deletes the right row", async () => {
    vi.mocked(customerIdentityApi.listFavorites).mockResolvedValue([
      buildFavorite({ dish: null }),
    ]);

    const wrapper = await mountList();
    expect(wrapper.get('[data-testid="favorite-dish-42"]').text()).toContain(
      "follow.unknownTarget",
    );

    await wrapper
      .get('[data-testid="favorite-dish-remove-42"]')
      .trigger("click");
    await vi.waitFor(() => {
      expect(
        wrapper.find('[data-testid="favorite-dishes-empty"]').exists(),
      ).toBe(true);
    });
    expect(customerIdentityApi.removeFavorite).toHaveBeenCalledWith(8);
  });
});
