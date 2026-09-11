import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/services/api";
import { reviewsService } from "./reviewsService";

vi.mock("@/services/api", () => ({
  api: { get: vi.fn(), post: vi.fn() },
  unwrapApiPayload: vi.fn((payload) => payload.data ?? payload),
}));

function ownerReview(overrides: Record<string, unknown> = {}) {
  return {
    id: "rev-1",
    orderId: "ord-1",
    orderNumber: "A-0007",
    restaurantId: "shop-1",
    customerId: "cust-1",
    customerName: "阿明",
    rating: 4,
    content: "湯頭很好",
    createdAt: 1_757_000_000_000,
    updatedAt: 1_757_000_000_000,
    reply: null,
    items: [{ menuItemId: 12, menuItemName: "牛肉麵", rating: 5 }],
    ...overrides,
  };
}

describe("reviewsService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the summary from the restaurant-scoped summary path", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: {
        data: {
          average: 4.25,
          count: 8,
          distribution: { "1": 0, "2": 1, "3": 1, "4": 2, "5": 4 },
          unrepliedCount: 3,
        },
      },
    } as never);

    await expect(reviewsService.getSummary("shop-1")).resolves.toEqual(
      expect.objectContaining({ average: 4.25, count: 8, unrepliedCount: 3 }),
    );
    expect(api.get).toHaveBeenCalledOnce();
    expect(api.get).toHaveBeenCalledWith("/reviews/shop-1/summary");
  });

  it("lists reviews with only the filters that are set", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        data: {
          reviews: [ownerReview()],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        },
      },
    } as never);

    await expect(
      reviewsService.list("shop-1", { page: 2, limit: 20 }),
    ).resolves.toEqual(
      expect.objectContaining({
        reviews: [expect.objectContaining({ id: "rev-1" })],
        pagination: expect.objectContaining({ total: 1 }),
      }),
    );
    // An unset rating/replied/from/to must not reach the wire as `undefined`:
    // the server's query schema rejects an empty `rating`, so sending the key
    // at all would turn "no filter" into a 400.
    expect(api.get).toHaveBeenLastCalledWith("/reviews/shop-1", {
      page: 2,
      limit: 20,
    });
  });

  it("sends rating, the replied tri-state and the date range as query params", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        data: {
          reviews: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        },
      },
    } as never);

    await reviewsService.list("shop-1", {
      page: 1,
      limit: 50,
      rating: 4,
      replied: false,
      from: 1_756_000_000_000,
      to: 1_757_000_000_000,
    });

    // `replied` is serialised as the literal "false", which is the only value
    // the server's enum reads as "unreplied" — a bare `?replied` means true.
    expect(api.get).toHaveBeenLastCalledWith(
      "/reviews/shop-1",
      expect.objectContaining({
        page: 1,
        limit: 50,
        rating: 4,
        replied: "false",
        from: 1_756_000_000_000,
        to: 1_757_000_000_000,
      }),
    );

    await reviewsService.list("shop-1", { replied: true });
    expect(api.get).toHaveBeenLastCalledWith(
      "/reviews/shop-1",
      expect.objectContaining({ replied: "true" }),
    );
  });

  it("posts a reply to the review's own reply path and returns the updated row", async () => {
    const replied = ownerReview({
      reply: {
        content: "謝謝您的鼓勵！",
        repliedBy: "user-1",
        repliedAt: 1_757_100_000_000,
      },
    });
    vi.mocked(api.post).mockResolvedValueOnce({
      data: { data: replied },
    } as never);

    await expect(
      reviewsService.reply("shop-1", "rev-1", "謝謝您的鼓勵！"),
    ).resolves.toEqual(
      expect.objectContaining({
        id: "rev-1",
        reply: expect.objectContaining({ content: "謝謝您的鼓勵！" }),
      }),
    );
    expect(api.post).toHaveBeenCalledOnce();
    expect(api.post).toHaveBeenCalledWith(
      "/reviews/shop-1/rev-1/reply",
      expect.objectContaining({ content: "謝謝您的鼓勵！" }),
    );
  });

  it("escapes ids so a restaurant or review id never forges a path segment", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { data: { reviews: [], pagination: {} } },
    } as never);
    vi.mocked(api.post).mockResolvedValue({ data: { data: {} } } as never);

    await reviewsService.list("shop/1", {});
    expect(api.get).toHaveBeenLastCalledWith("/reviews/shop%2F1", {});

    await reviewsService.reply("shop-1", "rev/1", "hi");
    expect(api.post).toHaveBeenLastCalledWith(
      "/reviews/shop-1/rev%2F1/reply",
      expect.objectContaining({ content: "hi" }),
    );
  });
});
