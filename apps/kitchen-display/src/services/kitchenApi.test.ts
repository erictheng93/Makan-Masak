import { beforeEach, describe, expect, it, vi } from "vitest";
import { kitchenApi } from "./kitchenApi";

const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
}));

vi.mock("./authApi", () => ({
  default: mockApi,
}));

describe("kitchen API service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches kitchen orders for the restaurant and unwraps API data", async () => {
    const ordersData = {
      orders: [
        {
          id: 101,
          orderNumber: "K-101",
          status: "confirmed",
          items: [],
        },
      ],
      stats: {
        pending: 1,
        preparing: 0,
        ready: 0,
        completed: 0,
      },
    };
    mockApi.get.mockResolvedValueOnce({
      data: {
        data: ordersData,
        timestamp: "2026-06-08T10:00:00.000Z",
      },
    });

    const result = await kitchenApi.getOrders(7);

    expect(mockApi.get).toHaveBeenCalledWith("/kitchen/7/orders");
    expect(result).toEqual({
      success: true,
      data: ordersData,
      timestamp: "2026-06-08T10:00:00.000Z",
    });
  });

  it("returns API error details when fetching kitchen orders fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockApi.get.mockRejectedValueOnce({
      response: { data: { message: "Restaurant access denied" } },
    });

    const result = await kitchenApi.getOrders("rest-7");

    expect(mockApi.get).toHaveBeenCalledWith("/kitchen/rest-7/orders");
    expect(result).toMatchObject({
      success: false,
      error: "Restaurant access denied",
    });
    expect(result.timestamp).toEqual(expect.any(String));
  });

  it("updates one kitchen item with the restaurant, order, and item scope", async () => {
    const updateData = {
      orderId: 101,
      itemId: 44,
      status: "preparing",
      orderStatus: "preparing",
      updatedAt: "2026-06-08T10:01:00.000Z",
    };
    mockApi.put.mockResolvedValueOnce({
      data: {
        data: updateData,
        timestamp: "2026-06-08T10:01:00.000Z",
      },
    });

    const result = await kitchenApi.updateItemStatus(7, 101, 44, {
      status: "preparing",
      notes: "Started on grill",
    });

    expect(mockApi.put).toHaveBeenCalledWith("/kitchen/7/orders/101/items/44", {
      status: "preparing",
      notes: "Started on grill",
    });
    expect(result).toEqual({
      success: true,
      data: updateData,
      timestamp: "2026-06-08T10:01:00.000Z",
    });
  });

  it("returns a fallback message when updating an item fails without API details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockApi.put.mockRejectedValueOnce(new Error("network down"));

    const result = await kitchenApi.updateItemStatus(7, 101, 44, {
      status: "ready",
    });

    expect(result).toMatchObject({
      success: false,
      error: "network down",
    });
  });

  it("batch updates all item statuses and reports the updated count", async () => {
    mockApi.put
      .mockResolvedValueOnce({
        data: {
          data: { itemId: 44, status: "preparing" },
          timestamp: "2026-06-08T10:02:00.000Z",
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: { itemId: 45, status: "ready" },
          timestamp: "2026-06-08T10:02:01.000Z",
        },
      });

    const result = await kitchenApi.batchUpdateItemStatus(7, [
      { orderId: 101, itemId: 44, status: "preparing" },
      { orderId: 101, itemId: 45, status: "ready", notes: "Plated" },
    ]);

    expect(mockApi.put).toHaveBeenNthCalledWith(
      1,
      "/kitchen/7/orders/101/items/44",
      {
        status: "preparing",
        notes: undefined,
      },
    );
    expect(mockApi.put).toHaveBeenNthCalledWith(
      2,
      "/kitchen/7/orders/101/items/45",
      {
        status: "ready",
        notes: "Plated",
      },
    );
    expect(result).toMatchObject({
      success: true,
      data: { updatedCount: 2 },
    });
  });

  it("reports a failed batch when any item update fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockApi.put
      .mockResolvedValueOnce({
        data: {
          data: { itemId: 44, status: "ready" },
          timestamp: "2026-06-08T10:03:00.000Z",
        },
      })
      .mockRejectedValueOnce({
        response: { data: { message: "Item is already served" } },
      });

    const result = await kitchenApi.batchUpdateItemStatus(7, [
      { orderId: 101, itemId: 44, status: "ready" },
      { orderId: 101, itemId: 45, status: "ready" },
    ]);

    expect(result).toMatchObject({
      success: false,
      error: "1 個更新失敗",
    });
  });

  it("returns a batch failure when update mapping throws unexpectedly", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const updateItemStatus = vi
      .spyOn(kitchenApi, "updateItemStatus")
      .mockImplementationOnce(() => {
        throw new Error("bad update input");
      });

    const result = await kitchenApi.batchUpdateItemStatus(7, [
      { orderId: 101, itemId: 44, status: "ready" },
    ]);

    expect(updateItemStatus).toHaveBeenCalledWith(7, 101, 44, {
      status: "ready",
      notes: undefined,
    });
    expect(result).toMatchObject({
      success: false,
      error: "批量更新失敗",
    });
  });

  it("maps convenience item actions to the expected statuses", async () => {
    mockApi.put
      .mockResolvedValueOnce({
        data: {
          data: { itemId: 44, status: "preparing" },
          timestamp: "2026-06-08T10:04:00.000Z",
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: { itemId: 45, status: "ready" },
          timestamp: "2026-06-08T10:04:01.000Z",
        },
      });

    await kitchenApi.startCooking(7, 101, 44);
    await kitchenApi.markItemReady(7, 101, 45);

    expect(mockApi.put).toHaveBeenNthCalledWith(
      1,
      "/kitchen/7/orders/101/items/44",
      { status: "preparing" },
    );
    expect(mockApi.put).toHaveBeenNthCalledWith(
      2,
      "/kitchen/7/orders/101/items/45",
      { status: "ready" },
    );
  });

  it("starts all requested items by batching preparing updates", async () => {
    mockApi.put
      .mockResolvedValueOnce({
        data: {
          data: { itemId: 44, status: "preparing" },
          timestamp: "2026-06-08T10:05:00.000Z",
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: { itemId: 45, status: "preparing" },
          timestamp: "2026-06-08T10:05:01.000Z",
        },
      });

    const result = await kitchenApi.startAllItems(7, 101, [44, 45]);

    expect(mockApi.put).toHaveBeenNthCalledWith(
      1,
      "/kitchen/7/orders/101/items/44",
      { status: "preparing", notes: undefined },
    );
    expect(mockApi.put).toHaveBeenNthCalledWith(
      2,
      "/kitchen/7/orders/101/items/45",
      { status: "preparing", notes: undefined },
    );
    expect(result).toMatchObject({
      success: true,
      data: { updatedCount: 2 },
    });
  });

  it("marks all requested items ready through batch updates", async () => {
    mockApi.put
      .mockResolvedValueOnce({
        data: {
          data: { itemId: 44, status: "ready" },
          timestamp: "2026-06-08T10:06:00.000Z",
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: { itemId: 45, status: "ready" },
          timestamp: "2026-06-08T10:06:01.000Z",
        },
      });

    const result = await kitchenApi.markAllItemsReady(7, 101, [44, 45]);

    expect(mockApi.put).toHaveBeenNthCalledWith(
      1,
      "/kitchen/7/orders/101/items/44",
      { status: "ready", notes: undefined },
    );
    expect(mockApi.put).toHaveBeenNthCalledWith(
      2,
      "/kitchen/7/orders/101/items/45",
      { status: "ready", notes: undefined },
    );
    expect(result).toMatchObject({
      success: true,
      data: { updatedCount: 2 },
    });
  });
});
