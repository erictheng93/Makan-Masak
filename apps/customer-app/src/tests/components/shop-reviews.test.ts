import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ShopReviewsSection from "@/components/reviews/ShopReviewsSection.vue";
import { orderApi } from "@/services/orderApi";
import type { PublicReview, PublicReviewList } from "@/services/orderApi";

vi.mock("@/services/orderApi", () => ({
  orderApi: { getRestaurantReviews: vi.fn() },
}));

vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tWithParams: (key: string, params: Record<string, unknown>) =>
      `${key}:${Object.values(params).join(",")}`,
  }),
}));

function buildPublicReview(
  overrides: Partial<PublicReview> = {},
): PublicReview {
  return {
    id: "review-1",
    rating: 5,
    content: "很好吃",
    createdAt: 1_757_000_000_000,
    authorName: "王**",
    reply: null,
    ...overrides,
  };
}

function buildPage(
  reviews: PublicReview[],
  pagination: Partial<PublicReviewList["pagination"]> = {},
): PublicReviewList {
  return {
    reviews,
    pagination: {
      page: 1,
      limit: 10,
      total: reviews.length,
      totalPages: 1,
      ...pagination,
    },
  };
}

function mountSection(props: Record<string, unknown> = {}) {
  return mount(ShopReviewsSection, {
    props: {
      restaurantId: "restaurant-1",
      rating: 4.6,
      reviewCount: 12,
      ...props,
    },
  });
}

describe("ShopReviewsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the aggregate without fetching anything", () => {
    const wrapper = mountSection();

    const summary = wrapper.find('[data-testid="shop-reviews-summary"]');
    expect(summary.exists()).toBe(true);
    expect(summary.text()).toContain("4.6");
    expect(summary.text()).toContain("review.shopReviewCount:12");
    // The list is a second request; a shopper who only wants the menu should
    // not pay for it.
    expect(orderApi.getRestaurantReviews).not.toHaveBeenCalled();
  });

  it("renders nothing at all for a shop with no reviews", () => {
    const wrapper = mountSection({ rating: 0, reviewCount: 0 });

    expect(wrapper.find('[data-testid="shop-reviews"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="shop-reviews-toggle"]').exists()).toBe(
      false,
    );
  });

  it("loads the first page when the shopper asks to see reviews", async () => {
    vi.mocked(orderApi.getRestaurantReviews).mockResolvedValueOnce(
      buildPage(
        [
          buildPublicReview(),
          buildPublicReview({
            id: "review-2",
            rating: 4,
            content: "環境乾淨",
            authorName: null,
            reply: { content: "謝謝光臨", repliedAt: 1_757_000_100_000 },
          }),
        ],
        { total: 12, totalPages: 2 },
      ),
    );

    const wrapper = mountSection();
    await wrapper.find('[data-testid="shop-reviews-toggle"]').trigger("click");
    await flushPromises();

    expect(orderApi.getRestaurantReviews).toHaveBeenCalledOnce();
    expect(orderApi.getRestaurantReviews).toHaveBeenCalledWith(
      "restaurant-1",
      expect.objectContaining({ page: 1 }),
    );
    expect(
      wrapper.find('[data-testid="shop-review-review-1"]').text(),
    ).toContain("很好吃");
    const second = wrapper.find('[data-testid="shop-review-review-2"]');
    expect(second.text()).toContain("環境乾淨");
    // A null author is the masked-name field coming back empty, not a bug.
    expect(second.text()).toContain("review.anonymous");
    expect(second.text()).toContain("謝謝光臨");
  });

  it("appends the next page rather than replacing the first", async () => {
    vi.mocked(orderApi.getRestaurantReviews)
      .mockResolvedValueOnce(
        buildPage([buildPublicReview()], { total: 2, totalPages: 2 }),
      )
      .mockResolvedValueOnce(
        buildPage([buildPublicReview({ id: "review-2", content: "第二頁" })], {
          page: 2,
          total: 2,
          totalPages: 2,
        }),
      );

    const wrapper = mountSection();
    await wrapper.find('[data-testid="shop-reviews-toggle"]').trigger("click");
    await flushPromises();

    await wrapper
      .find('[data-testid="shop-reviews-load-more"]')
      .trigger("click");
    await flushPromises();

    expect(orderApi.getRestaurantReviews).toHaveBeenLastCalledWith(
      "restaurant-1",
      expect.objectContaining({ page: 2 }),
    );
    expect(wrapper.find('[data-testid="shop-review-review-1"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="shop-review-review-2"]').exists()).toBe(
      true,
    );
    // Last page reached: nothing more to ask for.
    expect(
      wrapper.find('[data-testid="shop-reviews-load-more"]').exists(),
    ).toBe(false);
  });

  it("says so when the list cannot be loaded", async () => {
    vi.mocked(orderApi.getRestaurantReviews).mockRejectedValueOnce(
      new Error("boom"),
    );

    const wrapper = mountSection();
    await wrapper.find('[data-testid="shop-reviews-toggle"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="shop-reviews-error"]').exists()).toBe(
      true,
    );
  });
});
