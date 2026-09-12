import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/services/api";
import { broadcastsService } from "./broadcastsService";

vi.mock("@/services/api", () => ({
  api: { get: vi.fn(), post: vi.fn() },
  unwrapApiPayload: vi.fn((payload) => payload.data ?? payload),
}));

function sendResult(overrides: Record<string, unknown> = {}) {
  return {
    id: "bc-1",
    audienceCount: 12,
    deliveredCount: 9,
    failedCount: 1,
    skippedCount: 2,
    ...overrides,
  };
}

function historyItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "bc-1",
    scopeType: "restaurant",
    scopeId: "shop-1",
    title: "今晚半價",
    body: "全品項半價至 22:00",
    url: "/r/shop-1",
    sentBy: "user-1",
    audienceCount: 12,
    deliveredCount: 9,
    failedCount: 1,
    skippedCount: 2,
    createdAt: 1_757_000_000_000,
    completedAt: 1_757_000_003_000,
    ...overrides,
  };
}

describe("broadcastsService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.post).mockResolvedValue({
      data: { data: sendResult() },
    } as never);
    vi.mocked(api.get).mockResolvedValue({
      data: {
        data: {
          broadcasts: [historyItem()],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        },
      },
    } as never);
  });

  it("posts a restaurant broadcast to the restaurant-scoped path", async () => {
    await expect(
      broadcastsService.send("shop-1", {
        title: "今晚半價",
        body: "全品項半價至 22:00",
        url: "/r/shop-1",
        includeMarketFollowers: true,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: "bc-1",
        audienceCount: 12,
        deliveredCount: 9,
        failedCount: 1,
        skippedCount: 2,
      }),
    );

    expect(api.post).toHaveBeenCalledOnce();
    expect(api.post).toHaveBeenCalledWith(
      "/restaurants/shop-1/broadcasts",
      expect.objectContaining({
        title: "今晚半價",
        body: "全品項半價至 22:00",
        url: "/r/shop-1",
        includeMarketFollowers: true,
      }),
    );
  });

  it("always states includeMarketFollowers, and omits an unset url", async () => {
    await broadcastsService.send("shop-1", { title: "t", body: "b" });

    // The server defaults the flag to false, but sending it explicitly is what
    // makes the checkbox's off state visible in a request log — and an empty
    // `url` is a 400 rather than "no link", so it must not reach the wire.
    expect(api.post).toHaveBeenLastCalledWith(
      "/restaurants/shop-1/broadcasts",
      {
        title: "t",
        body: "b",
        includeMarketFollowers: false,
      },
    );
  });

  it("reads the restaurant history with paging", async () => {
    await expect(
      broadcastsService.list("shop-1", { page: 2, limit: 10 }),
    ).resolves.toEqual(
      expect.objectContaining({
        broadcasts: [expect.objectContaining({ id: "bc-1" })],
        pagination: expect.objectContaining({ total: 1 }),
      }),
    );

    expect(api.get).toHaveBeenCalledOnce();
    expect(api.get).toHaveBeenCalledWith(
      "/restaurants/shop-1/broadcasts",
      expect.objectContaining({ page: 2, limit: 10 }),
    );
  });

  it("sends no paging keys when the caller passes none", async () => {
    await broadcastsService.list("shop-1");
    expect(api.get).toHaveBeenLastCalledWith(
      "/restaurants/shop-1/broadcasts",
      {},
    );
  });

  it("posts a market broadcast without the market-followers flag", async () => {
    await broadcastsService.sendToMarket("market-1", {
      title: "颱風休市",
      body: "本週六暫停營業",
    });

    // The market route never forwards the flag, so offering it here would be a
    // control whose off state is indistinguishable from its on state.
    expect(api.post).toHaveBeenCalledWith(
      "/markets/market-1/broadcasts",
      expect.not.objectContaining({
        includeMarketFollowers: expect.anything(),
      }),
    );
    expect(api.post).toHaveBeenLastCalledWith("/markets/market-1/broadcasts", {
      title: "颱風休市",
      body: "本週六暫停營業",
    });
  });

  it("reads the market history from the market-scoped path", async () => {
    await broadcastsService.listForMarket("market-1", { page: 3, limit: 5 });
    expect(api.get).toHaveBeenLastCalledWith(
      "/markets/market-1/broadcasts",
      expect.objectContaining({ page: 3, limit: 5 }),
    );
  });

  it("escapes ids so a restaurant or market id never forges a path segment", async () => {
    await broadcastsService.list("shop/1");
    expect(api.get).toHaveBeenLastCalledWith(
      "/restaurants/shop%2F1/broadcasts",
      {},
    );

    await broadcastsService.send("shop/1", { title: "t", body: "b" });
    expect(api.post).toHaveBeenLastCalledWith(
      "/restaurants/shop%2F1/broadcasts",
      expect.objectContaining({ title: "t" }),
    );

    await broadcastsService.listForMarket("market/1");
    expect(api.get).toHaveBeenLastCalledWith(
      "/markets/market%2F1/broadcasts",
      {},
    );

    await broadcastsService.sendToMarket("market/1", { title: "t", body: "b" });
    expect(api.post).toHaveBeenLastCalledWith(
      "/markets/market%2F1/broadcasts",
      expect.objectContaining({ title: "t" }),
    );
  });
});
