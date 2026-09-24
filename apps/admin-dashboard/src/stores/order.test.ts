import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOrderStore } from "./order";
import { api } from "@/services/api";
import { AxiosHeaders, type AxiosResponse } from "axios";
import type { ApiResponse, Order } from "@/types";

vi.mock("@/services/api", () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
  unwrapApiList: vi.fn((payload: unknown) => payload),
}));

vi.mock("@/i18n", () => ({
  t: (key: string) => key,
}));

// api.* return a full AxiosResponse, so a mock has to supply the whole envelope
// rather than just `data`.
function axiosResponse<T>(response: {
  data: ApiResponse<T>;
  status?: number;
}): AxiosResponse<ApiResponse<T>> {
  return {
    data: response.data,
    status: response.status ?? 200,
    statusText: "OK",
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  };
}

function buildOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "order-1",
    restaurantId: "restaurant-1",
    orderNumber: "A001",
    status: "pending",
    totalAmount: 120,
    items: [],
    // The API sends both of these as Unix milliseconds -- see the response
    // assembly in packages/database/src/services/order.ts, which runs every
    // timestamp through toMillis().
    createdAt: 1786000000000,
    updatedAt: 1786000000000,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

describe("admin order store — concurrent refreshes preserve the newest response", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("does not let an older request remove an order returned by a newer request", async () => {
    const olderRequest = deferred<AxiosResponse<ApiResponse<Order[]>>>();
    const newerRequest = deferred<AxiosResponse<ApiResponse<Order[]>>>();
    vi.mocked(api.get)
      .mockReturnValueOnce(olderRequest.promise)
      .mockReturnValueOnce(newerRequest.promise);
    const store = useOrderStore();

    const olderRefresh = store.fetchOrders();
    const newerRefresh = store.fetchOrders();

    newerRequest.resolve(
      axiosResponse({
        data: {
          success: true,
          data: [buildOrder(), buildOrder({ id: "order-2" })],
        },
      }),
    );
    await newerRefresh;
    olderRequest.resolve(
      axiosResponse({
        data: { success: true, data: [buildOrder()] },
      }),
    );
    await olderRefresh;

    expect(store.orders.map((order) => order.id)).toEqual([
      "order-1",
      "order-2",
    ]);
  });

  it("stays loading until the newest request finishes", async () => {
    const olderRequest = deferred<AxiosResponse<ApiResponse<Order[]>>>();
    const newerRequest = deferred<AxiosResponse<ApiResponse<Order[]>>>();
    vi.mocked(api.get)
      .mockReturnValueOnce(olderRequest.promise)
      .mockReturnValueOnce(newerRequest.promise);
    const store = useOrderStore();

    const olderRefresh = store.fetchOrders();
    const newerRefresh = store.fetchOrders();

    olderRequest.resolve(
      axiosResponse({ data: { success: true, data: [buildOrder()] } }),
    );
    await olderRefresh;
    expect(store.isLoading).toBe(true);

    newerRequest.resolve(
      axiosResponse({ data: { success: true, data: [buildOrder()] } }),
    );
    await newerRefresh;
    expect(store.isLoading).toBe(false);
  });

  it("does not surface an older request failure after a newer success", async () => {
    const olderRequest = deferred<AxiosResponse<ApiResponse<Order[]>>>();
    const newerRequest = deferred<AxiosResponse<ApiResponse<Order[]>>>();
    vi.mocked(api.get)
      .mockReturnValueOnce(olderRequest.promise)
      .mockReturnValueOnce(newerRequest.promise);
    const store = useOrderStore();

    const olderRefresh = store.fetchOrders();
    const newerRefresh = store.fetchOrders();

    newerRequest.resolve(
      axiosResponse({
        data: { success: true, data: [buildOrder({ id: "order-2" })] },
      }),
    );
    await newerRefresh;
    olderRequest.reject(new Error("stale network failure"));
    await olderRefresh;

    expect(store.orders.map((order) => order.id)).toEqual(["order-2"]);
    expect(store.error).toBeNull();
  });
});

describe("admin order store — local status updates keep the API's time format", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  /**
   * The store patches the row in place rather than refetching, so whatever it
   * writes has to be the same shape the API sent. Writing an ISO string here
   * gave one field two runtime types depending on how it was last touched,
   * which is how `createdAt` ended up crashing the orders table.
   */
  it("stamps updatedAt as Unix milliseconds after a status change", async () => {
    vi.mocked(api.get).mockResolvedValue(
      axiosResponse({
        data: { success: true, data: [buildOrder()] },
      }),
    );
    vi.mocked(api.put).mockResolvedValue(
      axiosResponse({ data: { success: true } }),
    );
    const store = useOrderStore();
    await store.fetchOrders();
    const before = Date.now();

    await expect(store.updateOrderStatus("order-1", "confirmed")).resolves.toBe(
      true,
    );

    const updated = store.orders[0].updatedAt;
    expect(typeof updated).toBe("number");
    expect(updated).toBeGreaterThanOrEqual(before);
  });

  it("stamps updatedAt as Unix milliseconds after a cancellation", async () => {
    vi.mocked(api.get).mockResolvedValue(
      axiosResponse({
        data: { success: true, data: [buildOrder({ status: "confirmed" })] },
      }),
    );
    vi.mocked(api.delete).mockResolvedValue(
      axiosResponse({ data: { success: true } }),
    );
    const store = useOrderStore();
    await store.fetchOrders();
    const before = Date.now();

    await expect(store.cancelOrder("order-1")).resolves.toBe(true);

    const updated = store.orders[0].updatedAt;
    expect(typeof updated).toBe("number");
    expect(updated).toBeGreaterThanOrEqual(before);
  });
});

/**
 * `t` is mocked to echo its key, so a leaked server sentence is unmistakable:
 * anything that is not a dotted key came from the response body.
 */
describe("admin order store — the server's prose never reaches the banner", () => {
  const SERVER_PROSE = "Order 41 is locked by kitchen station 3";

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  function rejectWith(status: number, code?: string) {
    return {
      response: {
        status,
        data: {
          success: false,
          error: { message: SERVER_PROSE, ...(code && { code }) },
        },
      },
    };
  }

  it("shows the localized status copy for a 403, not the server's sentence", async () => {
    vi.mocked(api.get).mockRejectedValue(rejectWith(403, "FORBIDDEN"));
    const store = useOrderStore();

    await store.fetchOrders();

    expect(store.error).toBe("errorPresentation.permissionDenied");
  });

  it("names the failed action when the response cannot be classified", async () => {
    vi.mocked(api.get).mockResolvedValue(
      axiosResponse({
        data: { success: true, data: [buildOrder()] },
      }),
    );
    vi.mocked(api.put).mockRejectedValue(rejectWith(418));
    const store = useOrderStore();
    await store.fetchOrders();

    await expect(store.updateOrderStatus("order-1", "confirmed")).resolves.toBe(
      false,
    );

    expect(store.error).toBe("orderStore.updateStatusFailed");
  });

  it("keeps the server's sentence out of every failure path", async () => {
    vi.mocked(api.get).mockResolvedValue(
      axiosResponse({
        data: { success: true, data: [buildOrder({ status: "confirmed" })] },
      }),
    );
    vi.mocked(api.delete).mockRejectedValue(
      rejectWith(409, "ORDER_ALREADY_SERVED"),
    );
    const store = useOrderStore();
    await store.fetchOrders();

    await expect(store.cancelOrder("order-1")).resolves.toBe(false);

    expect(store.error).not.toContain(SERVER_PROSE);
    expect(store.error).toBe("errorPresentation.conflict");
  });
});

describe("admin order store — background refetch", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue(
      axiosResponse({ data: { success: true, data: [buildOrder()] } }),
    );
  });

  it("reloads with the filters and page the list was last fetched with", async () => {
    const store = useOrderStore();
    await store.fetchOrders({
      status: ["ready"],
      page: 3,
      limit: 20,
      search: "A001",
    });

    await store.refetchOrders();

    expect(api.get).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.get).mock.calls[1][0]).toBe(
      vi.mocked(api.get).mock.calls[0][0],
    );
    expect(vi.mocked(api.get).mock.calls[1][0]).toContain("page=3");
  });
});
