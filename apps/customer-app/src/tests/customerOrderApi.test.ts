import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The history page reads `orders` and `pagination` off what
 * `customerOrderApi.getMyOrders` returns, but `apiClient.get` unwraps the
 * envelope to `data` — a bare array for this endpoint — so both came back
 * undefined and the page showed nothing. These tests go through the real api
 * client with axios mocked, because a mocked `apiClient` would hide exactly
 * the unwrapping that caused it.
 */
const axiosGet = vi.hoisted(() => vi.fn());
const axiosRequest = vi.hoisted(() => vi.fn());

vi.mock("axios", () => {
  const instance = {
    interceptors: {
      request: { use: vi.fn(() => 1), eject: vi.fn() },
      response: { use: vi.fn(() => 1), eject: vi.fn() },
    },
    get: axiosGet,
    request: axiosRequest,
  };
  return { default: { create: vi.fn(() => instance) } };
});

let customerOrderApi: typeof import("@/services/customerOrderApi").customerOrderApi;

describe("customerOrderApi.getMyOrders", () => {
  beforeAll(async () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8787/api/v1");
    ({ customerOrderApi } = await import("@/services/customerOrderApi"));
  }, 30_000);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the server's bare-array envelope into orders and pagination", async () => {
    const envelope = {
      data: {
        success: true,
        data: [
          { id: "order-1", totalAmount: 120, currency: "TWD" },
          { id: "order-2", totalAmount: 12.5, currency: "MYR" },
        ],
        pagination: { page: 2, limit: 20, total: 42, totalPages: 3 },
      },
    };
    // Both transports answer the same way, so a failure here is the envelope
    // being read wrongly rather than the wrong axios method being mocked.
    axiosGet.mockResolvedValueOnce(envelope);
    axiosRequest.mockResolvedValueOnce(envelope);

    const result = await customerOrderApi.getMyOrders({ page: 2 });

    expect(axiosGet).toHaveBeenCalledWith(
      "/customers/me/orders?page=2",
      expect.anything(),
    );
    expect(result.orders.map((order) => order.id)).toEqual([
      "order-1",
      "order-2",
    ]);
    // Each order keeps its own currency: a history spans restaurants.
    expect(result.orders.map((order) => order.currency)).toEqual([
      "TWD",
      "MYR",
    ]);
    expect(result.pagination).toEqual({
      page: 2,
      limit: 20,
      total: 42,
      totalPages: 3,
    });
  });

  it("falls back to an empty page when the server sends no pagination", async () => {
    const empty = { data: { success: true, data: [] } };
    axiosGet.mockResolvedValueOnce(empty);
    axiosRequest.mockResolvedValueOnce(empty);

    await expect(customerOrderApi.getMyOrders()).resolves.toEqual({
      orders: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    });
  });
});
