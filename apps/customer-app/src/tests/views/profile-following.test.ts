/**
 * The 追蹤中 section on the profile page. Exercised against the real
 * `useFollowing` composable with only the service layer mocked, because the
 * thing worth proving is the join: favorites rows carry ids, and this list has
 * to turn them into names, links and a working unfollow.
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

vi.mock("@/services/marketsApi", () => ({
  marketsApi: { listMarkets: vi.fn() },
}));

vi.mock("@/services/menuApi", () => ({
  menuApi: { getRestaurant: vi.fn() },
}));

vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tWithParams: (key: string, params: Record<string, unknown>) =>
      `${key}:${Object.values(params).join(",")}`,
  }),
}));

import { customerIdentityApi } from "@/services/customerIdentityApi";
import type { CustomerFavorite } from "@/services/customerIdentityApi";
import { marketsApi } from "@/services/marketsApi";
import { menuApi } from "@/services/menuApi";
import { resetFollowing } from "@/composables/useFollowing";
import FollowingList from "@/components/follow/FollowingList.vue";

function buildFavorite(
  overrides: Partial<CustomerFavorite> = {},
): CustomerFavorite {
  return {
    id: 41,
    targetType: "market",
    targetId: "market-1",
    createdAtMs: 1_764_000_000_000,
    ...overrides,
  };
}

function buildMarketRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "market-1",
    slug: "fengjia",
    name: "逢甲夜市",
    ...overrides,
  };
}

async function mountList() {
  const wrapper = mount(FollowingList, {
    global: {
      stubs: {
        // Binds `to` onto href so the test can assert where the row points.
        RouterLink: { props: ["to"], template: '<a :href="to"><slot /></a>' },
      },
    },
  });
  await vi.waitFor(() => {
    expect(customerIdentityApi.listFavorites).toHaveBeenCalled();
  });
  await vi.waitFor(() => {
    expect(wrapper.find('[data-testid="following-loading"]').exists()).toBe(
      false,
    );
  });
  return wrapper;
}

describe("ProfileView 追蹤中 section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFollowing();
    vi.mocked(customerIdentityApi.listFavorites).mockResolvedValue([]);
    vi.mocked(customerIdentityApi.removeFavorite).mockResolvedValue(
      undefined as never,
    );
    vi.mocked(marketsApi.listMarkets).mockResolvedValue({
      markets: [],
      total: 0,
      page: 1,
      limit: 100,
    } as never);
    vi.mocked(menuApi.getRestaurant).mockResolvedValue({
      id: "rest-9",
      name: "阿明雞排",
    } as never);
  });

  it("lists followed markets and restaurants with links to their pages", async () => {
    vi.mocked(customerIdentityApi.listFavorites).mockResolvedValue([
      buildFavorite({ id: 41, targetType: "market", targetId: "market-1" }),
      buildFavorite({ id: 42, targetType: "restaurant", targetId: "rest-9" }),
    ]);
    vi.mocked(marketsApi.listMarkets).mockResolvedValue({
      markets: [buildMarketRow()],
      total: 1,
      page: 1,
      limit: 100,
    } as never);

    const wrapper = await mountList();

    const market = wrapper.get('[data-testid="following-market-market-1"]');
    expect(market.text()).toContain("逢甲夜市");
    expect(market.find("a").attributes("href")).toBe("/markets/fengjia");

    await vi.waitFor(() => {
      expect(
        wrapper.get('[data-testid="following-restaurant-rest-9"]').text(),
      ).toContain("阿明雞排");
    });
    expect(menuApi.getRestaurant).toHaveBeenCalledWith("rest-9");

    // One request for every market on the page, not one per row.
    expect(marketsApi.listMarkets).toHaveBeenCalledOnce();
  });

  it("removes the row when the diner unfollows", async () => {
    vi.mocked(customerIdentityApi.listFavorites).mockResolvedValue([
      buildFavorite({ id: 41, targetType: "market", targetId: "market-1" }),
    ]);
    vi.mocked(marketsApi.listMarkets).mockResolvedValue({
      markets: [buildMarketRow()],
      total: 1,
      page: 1,
      limit: 100,
    } as never);

    const wrapper = await mountList();
    await wrapper
      .get('[data-testid="following-unfollow-market-market-1"]')
      .trigger("click");

    await vi.waitFor(() => {
      expect(customerIdentityApi.removeFavorite).toHaveBeenCalledWith(41);
    });
    await vi.waitFor(() => {
      expect(
        wrapper.find('[data-testid="following-market-market-1"]').exists(),
      ).toBe(false);
    });
    expect(wrapper.find('[data-testid="following-empty"]').exists()).toBe(true);
  });

  it("still lists a market whose name could not be resolved", async () => {
    vi.mocked(customerIdentityApi.listFavorites).mockResolvedValue([
      buildFavorite({ id: 41, targetType: "market", targetId: "market-404" }),
    ]);

    const wrapper = await mountList();
    const row = wrapper.get('[data-testid="following-market-market-404"]');

    // No by-id market lookup exists, so an unlisted market keeps its row and
    // says the name is unavailable rather than vanishing from the list.
    expect(row.text()).toContain("follow.unknownTarget");
    expect(row.find("a").exists()).toBe(false);
    expect(
      wrapper
        .find('[data-testid="following-unfollow-market-market-404"]')
        .exists(),
    ).toBe(true);
  });

  it("shows an empty state when nothing is followed", async () => {
    const wrapper = await mountList();

    expect(wrapper.get('[data-testid="following-empty"]').text()).toContain(
      "follow.empty",
    );
    expect(marketsApi.listMarkets).not.toHaveBeenCalled();
    expect(menuApi.getRestaurant).not.toHaveBeenCalled();
  });
});
