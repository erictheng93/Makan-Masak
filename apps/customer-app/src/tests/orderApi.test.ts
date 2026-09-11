import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "@/services/api";
import { orderApi } from "@/services/orderApi";

vi.mock("@/services/api", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

const getMarketCheckoutGuestToken = vi.hoisted(() => vi.fn());

vi.mock("@/utils/marketCheckouts", () => ({
  getMarketCheckoutGuestToken,
  recordMarketCheckoutGuestTokens: vi.fn(),
  recordRecentMarketCheckout: vi.fn(),
  recordRecoveredMarketCheckoutGuestToken: vi.fn(),
}));

describe("orderApi market checkout vouchers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMarketCheckoutGuestToken.mockReturnValue(undefined);
  });

  it("applies a market checkout voucher", async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({
      checkout: { id: "checkout-1" },
      voucher: { code: "MARKET10", discountCents: 2400 },
      subtotalCents: 24000,
      discountCents: 2400,
      payableCents: 21600,
    });

    await expect(
      orderApi.applyMarketCheckoutVoucher("checkout-1", "MARKET10"),
    ).resolves.toMatchObject({
      voucher: { code: "MARKET10" },
      payableCents: 21600,
    });
    expect(apiClient.post).toHaveBeenCalledWith(
      "/market-checkouts/checkout-1/voucher",
      { code: "MARKET10" },
      undefined,
    );
  });

  it("removes a market checkout voucher", async () => {
    vi.mocked(apiClient.delete).mockResolvedValueOnce({
      checkout: { id: "checkout-1" },
    });

    await expect(
      orderApi.removeMarketCheckoutVoucher("checkout-1"),
    ).resolves.toMatchObject({
      checkout: { id: "checkout-1" },
    });
    expect(apiClient.delete).toHaveBeenCalledWith(
      "/market-checkouts/checkout-1/voucher",
      undefined,
      undefined,
    );
  });
  it("proves checkout ownership with a header the JWT cannot displace", () => {
    // The API client puts either the customer JWT or a guest token in
    // `Authorization`, never both, so a signed-in shopper paying a checkout
    // they placed while signed out has to send the guest token elsewhere.
    getMarketCheckoutGuestToken.mockReturnValue("gt_holder");
    vi.mocked(apiClient.post).mockResolvedValueOnce({});

    void orderApi.payMarketCheckout("checkout-1", { method: "market_online" });

    expect(apiClient.post).toHaveBeenCalledWith(
      "/market-checkouts/checkout-1/pay",
      expect.objectContaining({ method: "market_online" }),
      { headers: { "X-Guest-Token": "gt_holder" } },
    );
  });

  it("sends the checkout-scoped guest token when loading a checkout", async () => {
    getMarketCheckoutGuestToken.mockReturnValue("gt_holder");
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      checkout: { id: "checkout-1" },
    });

    await expect(orderApi.getMarketCheckout("checkout-1")).resolves.toEqual({
      id: "checkout-1",
    });
    expect(apiClient.get).toHaveBeenCalledWith("/market-checkouts/checkout-1", {
      headers: { "X-Guest-Token": "gt_holder" },
    });
  });

  it("returns the market checkout history as the client unwrapped it", async () => {
    // apiClient already strips the `{ success, data }` envelope; reading a
    // further `.data` off the result yields undefined and silently empties the
    // account history.
    vi.mocked(apiClient.get).mockResolvedValueOnce([
      {
        id: "checkout-1",
        market: { slug: "fengjia", name: "\u9022\u7532\u591c\u5e02" },
        paymentStatus: "paid",
        childOrderCount: 2,
        subtotal: 24000,
        createdAt: "2026-06-01T10:00:00.000Z",
      },
    ]);

    await expect(orderApi.listMyMarketCheckouts()).resolves.toMatchObject([
      { id: "checkout-1", childOrderCount: 2 },
    ]);
    expect(apiClient.get).toHaveBeenCalledWith(
      "/customers/me/market-checkouts",
    );
  });
});

describe("orderApi reviews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMarketCheckoutGuestToken.mockReturnValue(undefined);
  });

  function buildReview(overrides: Record<string, unknown> = {}) {
    return {
      id: "review-1",
      orderId: "order-1",
      restaurantId: "restaurant-1",
      rating: 4,
      content: "很好吃",
      createdAt: 1_757_000_000_000,
      updatedAt: 1_757_000_000_000,
      reply: null,
      items: [{ menuItemId: 42, menuItemName: "章魚燒", rating: 5 }],
      ...overrides,
    };
  }

  it("posts the contract's `content` and `items`, not the legacy aliases", async () => {
    // `comment` / `itemRatings` are still accepted by the server for the shape
    // this method used to send. New calls must not rely on that.
    const review = buildReview();
    vi.mocked(apiClient.post).mockResolvedValueOnce(review);

    await expect(
      orderApi.submitOrderReview("order-1", {
        rating: 4,
        content: "很好吃",
        items: [{ menuItemId: 42, rating: 5 }],
      }),
    ).resolves.toMatchObject({ id: "review-1", rating: 4 });

    expect(apiClient.post).toHaveBeenCalledOnce();
    expect(apiClient.post).toHaveBeenCalledWith(
      "/orders/order-1/review",
      expect.objectContaining({
        rating: 4,
        content: "很好吃",
        items: [expect.objectContaining({ menuItemId: 42, rating: 5 })],
      }),
    );
    const [, body] = vi.mocked(apiClient.post).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(body).not.toHaveProperty("comment");
    expect(body).not.toHaveProperty("itemRatings");
  });

  it("omits `content` and `items` entirely when the diner left neither", async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce(
      buildReview({ content: null, items: [] }),
    );

    await orderApi.submitOrderReview("order-1", { rating: 5 });

    const [, body] = vi.mocked(apiClient.post).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(body).toEqual({ rating: 5 });
  });

  it("reads an existing review back", async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce(buildReview());

    await expect(orderApi.getOrderReview("order-1")).resolves.toMatchObject({
      id: "review-1",
      items: [expect.objectContaining({ menuItemName: "章魚燒" })],
    });
    expect(apiClient.get).toHaveBeenCalledWith("/orders/order-1/review");
  });

  it("treats REVIEW_NOT_FOUND as 'not reviewed yet', not as a failure", async () => {
    // An unreviewed order is the ordinary case on every completed order
    // screen. Surfacing the 404 as an error would put a red banner on it.
    vi.mocked(apiClient.get).mockRejectedValueOnce(
      Object.assign(new Error("not found"), {
        status: 404,
        code: "REVIEW_NOT_FOUND",
      }),
    );

    await expect(orderApi.getOrderReview("order-1")).resolves.toBeNull();
  });

  it("still rejects when reading the review fails for another reason", async () => {
    vi.mocked(apiClient.get).mockRejectedValueOnce(
      Object.assign(new Error("denied"), {
        status: 403,
        code: "ORDER_ACCESS_DENIED",
      }),
    );

    await expect(orderApi.getOrderReview("order-1")).rejects.toMatchObject({
      code: "ORDER_ACCESS_DENIED",
    });
  });

  it("passes page and limit through to the public review list", async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      reviews: [
        {
          id: "review-1",
          rating: 5,
          content: "好吃",
          createdAt: 1_757_000_000_000,
          authorName: "王**",
          reply: null,
        },
      ],
      pagination: { page: 2, limit: 5, total: 8, totalPages: 2 },
    });

    await expect(
      orderApi.getRestaurantReviews("restaurant-1", { page: 2, limit: 5 }),
    ).resolves.toMatchObject({
      pagination: expect.objectContaining({ page: 2, totalPages: 2 }),
    });
    expect(apiClient.get).toHaveBeenCalledWith(
      "/restaurants/restaurant-1/reviews",
      { page: 2, limit: 5 },
    );
  });

  it("defaults the public review list to the first page", async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      reviews: [],
      pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });

    await orderApi.getRestaurantReviews("restaurant-1");

    expect(apiClient.get).toHaveBeenCalledWith(
      "/restaurants/restaurant-1/reviews",
      { page: 1, limit: 10 },
    );
  });
});
