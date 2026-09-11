// @vitest-environment jsdom

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Component } from "vue";
import type {
  OwnerReview,
  ReviewListResult,
  ReviewSummary,
} from "@/services/reviewsService";

const getSummary = vi.hoisted(() => vi.fn());
const list = vi.hoisted(() => vi.fn());
const reply = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
const authState = vi.hoisted(() => ({
  restaurantId: "shop-1" as string | null,
}));

// `@/i18n` is deliberately NOT mocked, for the reason MembersView.test.ts and
// PlatformCustomersView.test.ts give: a `t: (key) => key` stub makes a missing
// translation key indistinguishable from a present one (#113). The literals
// below are the zh-TW source strings, spelled out rather than read back out of
// the catalog.
vi.mock("vue-toastification", () => ({ useToast: () => toast }));
vi.mock("@/stores/auth", () => ({
  useAuthStore: () => authState,
}));
vi.mock("@/services/reviewsService", () => ({
  reviewsService: { getSummary, list, reply },
}));

const TEXT = {
  emptyTitle: "尚無顧客評價",
  filteredEmptyTitle: "沒有符合條件的評價",
  guest: "訪客",
  replyHeading: "店家回覆",
  forbidden: "沒有權限查看這家店的顧客評價。",
  replySent: "已送出回覆。",
} as const;

let ReviewsView: Component;

function review(overrides: Partial<OwnerReview> = {}): OwnerReview {
  return {
    id: "rev-1",
    orderId: "ord-1",
    orderNumber: "A-0007",
    restaurantId: "shop-1",
    customerId: "cust-1",
    customerName: "阿明",
    rating: 4,
    content: "湯頭很好，麵條偏軟。",
    createdAt: 1_757_000_000_000,
    updatedAt: 1_757_000_000_000,
    reply: null,
    items: [{ menuItemId: 12, menuItemName: "牛肉麵", rating: 5 }],
    ...overrides,
  };
}

function summary(overrides: Partial<ReviewSummary> = {}): ReviewSummary {
  return {
    average: 4.25,
    count: 8,
    distribution: { "1": 0, "2": 1, "3": 1, "4": 2, "5": 4 },
    unrepliedCount: 3,
    ...overrides,
  };
}

function listResult(
  rows: OwnerReview[] = [review()],
  overrides: Partial<ReviewListResult["pagination"]> = {},
): ReviewListResult {
  return {
    reviews: rows,
    pagination: {
      page: 1,
      limit: 20,
      total: rows.length,
      totalPages: rows.length === 0 ? 0 : 1,
      ...overrides,
    },
  };
}

/** An axios-shaped rejection carrying the unified error envelope. */
function apiError(code: string) {
  return { response: { data: { success: false, error: { code } } } };
}

async function mountView(): Promise<VueWrapper> {
  const wrapper = mount(ReviewsView);
  await flushPromises();
  return wrapper;
}

describe("ReviewsView", () => {
  // Pays the first mount — the real i18n runtime, lucide icons and the whole
  // component transform — once, under this hook's own budget rather than
  // against a 5s test body (#211/#351/#360).
  beforeAll(async () => {
    getSummary.mockResolvedValue(summary());
    list.mockResolvedValue(listResult());
    ReviewsView = (await import("./ReviewsView.vue")).default;
    const warmup = mount(ReviewsView);
    await flushPromises();
    warmup.unmount();
  }, 30_000);

  beforeEach(() => {
    vi.clearAllMocks();
    authState.restaurantId = "shop-1";
    getSummary.mockResolvedValue(summary());
    list.mockResolvedValue(listResult());
    reply.mockResolvedValue(
      review({
        reply: {
          content: "謝謝您的鼓勵，麵條時間我們會再調整！",
          repliedBy: "user-1",
          repliedAt: 1_757_100_000_000,
        },
      }),
    );
  });

  it("renders the average, the count, the unreplied badge and the distribution", async () => {
    const wrapper = await mountView();

    expect(getSummary).toHaveBeenCalledWith("shop-1");
    const summaryPanel = wrapper.get('[data-testid="reviews-summary"]');
    expect(wrapper.get('[data-testid="reviews-average"]').text()).toBe("4.25");
    expect(summaryPanel.text()).toContain("8");
    // The backlog is the number this page exists to drive to zero, so it is
    // asserted on its own element rather than anywhere in the panel text.
    expect(wrapper.get('[data-testid="reviews-unreplied"]').text()).toContain(
      "3",
    );

    // Five rows, highest rating first, each carrying its own count.
    expect(
      wrapper.get('[data-testid="reviews-distribution-5"]').text(),
    ).toContain("4");
    expect(
      wrapper.get('[data-testid="reviews-distribution-1"]').text(),
    ).toContain("0");
  });

  it("falls back to a guest label when the review has no customer name", async () => {
    list.mockResolvedValue(listResult([review({ customerName: null })]));

    const wrapper = await mountView();

    const card = wrapper.get('[data-testid="review-card"]');
    expect(card.text()).toContain(TEXT.guest);
    expect(card.text()).toContain("A-0007");
    expect(card.text()).toContain("牛肉麵");
  });

  it("requests one rating when a rating chip is picked", async () => {
    const wrapper = await mountView();
    list.mockClear();

    await wrapper
      .get('[data-testid="reviews-filter-rating-4"]')
      .trigger("click");
    await flushPromises();

    expect(list).toHaveBeenCalledOnce();
    expect(list).toHaveBeenLastCalledWith(
      "shop-1",
      expect.objectContaining({ rating: 4, page: 1 }),
    );
  });

  it("requests only unreplied rows when the replied filter is set to 未回覆", async () => {
    const wrapper = await mountView();
    list.mockClear();

    await wrapper
      .get('[data-testid="reviews-filter-replied-no"]')
      .trigger("click");
    await flushPromises();

    expect(list).toHaveBeenLastCalledWith(
      "shop-1",
      expect.objectContaining({ replied: false, page: 1 }),
    );

    await wrapper
      .get('[data-testid="reviews-filter-replied-yes"]')
      .trigger("click");
    await flushPromises();
    expect(list).toHaveBeenLastCalledWith(
      "shop-1",
      expect.objectContaining({ replied: true }),
    );

    // "全部" has to clear the filter rather than send `replied: undefined`:
    // the service drops unset keys, and this is the call site that relies on it.
    await wrapper
      .get('[data-testid="reviews-filter-replied-all"]')
      .trigger("click");
    await flushPromises();
    expect(list).toHaveBeenLastCalledWith(
      "shop-1",
      expect.not.objectContaining({ replied: expect.anything() }),
    );
  });

  it("swaps one card's reply in without re-reading the list", async () => {
    const wrapper = await mountView();
    const listCallsAfterLoad = list.mock.calls.length;

    await wrapper
      .get('[data-testid="review-reply-input"]')
      .setValue("謝謝您的鼓勵，麵條時間我們會再調整！");
    await wrapper.get('[data-testid="review-reply-submit"]').trigger("click");
    await flushPromises();

    expect(reply).toHaveBeenCalledOnce();
    expect(reply).toHaveBeenCalledWith(
      "shop-1",
      "rev-1",
      "謝謝您的鼓勵，麵條時間我們會再調整！",
    );
    expect(wrapper.get('[data-testid="review-reply"]').text()).toContain(
      "謝謝您的鼓勵，麵條時間我們會再調整！",
    );
    expect(wrapper.find('[data-testid="review-reply-input"]').exists()).toBe(
      false,
    );
    expect(toast.success).toHaveBeenCalledWith(TEXT.replySent);
    // A reply replaces one row; re-reading the whole page would scroll the
    // owner away from the card they just answered.
    expect(list.mock.calls.length).toBe(listCallsAfterLoad);
    // The backlog the header shows drops with it, without a second round trip.
    expect(wrapper.get('[data-testid="reviews-unreplied"]').text()).toContain(
      "2",
    );
  });

  it("shows an existing reply instead of an input", async () => {
    list.mockResolvedValue(
      listResult([
        review({
          reply: {
            content: "感謝光臨！",
            repliedBy: "user-1",
            repliedAt: 1_757_100_000_000,
          },
        }),
      ]),
    );

    const wrapper = await mountView();

    const replyBlock = wrapper.get('[data-testid="review-reply"]');
    expect(replyBlock.text()).toContain("感謝光臨！");
    expect(replyBlock.text()).toContain(TEXT.replyHeading);
    expect(wrapper.find('[data-testid="review-reply-input"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-testid="review-reply-submit"]').exists()).toBe(
      false,
    );
  });

  it("renders the localized empty state when the restaurant has no reviews", async () => {
    getSummary.mockResolvedValue(
      summary({ count: 0, average: 0, unrepliedCount: 0 }),
    );
    list.mockResolvedValue(listResult([]));

    const wrapper = await mountView();

    expect(wrapper.get('[data-testid="reviews-empty"]').text()).toContain(
      TEXT.emptyTitle,
    );
    expect(wrapper.findAll('[data-testid="review-card"]')).toHaveLength(0);
  });

  it("distinguishes an over-filtered page from a restaurant with no reviews", async () => {
    list.mockResolvedValue(listResult([]));

    const wrapper = await mountView();

    // count is 8, so the restaurant does have reviews — the filters are what
    // emptied the page, and the copy has to say so or the owner reads it as
    // "nobody has reviewed us".
    expect(wrapper.text()).toContain(TEXT.filteredEmptyTitle);
    expect(wrapper.find('[data-testid="reviews-empty"]').exists()).toBe(false);
  });

  it("surfaces one localized toast when the API refuses the restaurant", async () => {
    getSummary.mockRejectedValue(apiError("FORBIDDEN"));
    list.mockRejectedValue(apiError("FORBIDDEN"));

    const wrapper = await mountView();

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(TEXT.forbidden);
    expect(wrapper.findAll('[data-testid="review-card"]')).toHaveLength(0);
  });

  it("asks for a restaurant instead of calling the API without one", async () => {
    authState.restaurantId = null;

    const wrapper = await mountView();

    expect(getSummary).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="reviews-no-restaurant"]').exists()).toBe(
      true,
    );
  });
});
