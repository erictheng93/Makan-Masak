import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  IngredientConsumptionService,
  platformMenuMappings,
  platformOrders,
  restaurants,
} from "@makanmasak/database";
import {
  createSelectFixtureDb,
  type SelectFixtures,
} from "@makanmasak/database/testing";
import { PlatformOrderService } from "./PlatformOrderService";
import type { Env } from "../../../types/env";

const mocks = vi.hoisted(() => ({
  db: {
    batch: vi.fn(),
    insert: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
  },
  adapter: {
    acceptOrder: vi.fn(),
    cancelOrder: vi.fn(),
    denyOrder: vi.fn(),
    parseCancellation: vi.fn(),
    parseOrder: vi.fn(),
  },
  integrationService: {
    getDecryptedCredentials: vi.fn(),
    getIntegration: vi.fn(),
  },
  receiptService: {
    createKitchenTicket: vi.fn(),
  },
  ordersService: {
    cancelOrder: vi.fn(),
    getOrder: vi.fn(),
  },
  ingredientConsumption: {
    buildConsumptionWrites: vi.fn(),
  },
}));

vi.mock("@makanmasak/database", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  createDatabase: vi.fn(() => mocks.db),
  IngredientConsumptionService: vi.fn(function IngredientConsumptionService() {
    return mocks.ingredientConsumption;
  }),
}));

vi.mock("@makanmasak/utils", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  generateUUID: vi.fn(() => "order-101"),
}));

vi.mock("../adapters/PlatformAdapter", () => ({
  getAdapter: vi.fn(() => mocks.adapter),
}));

vi.mock("./PlatformIntegrationService", () => ({
  PlatformIntegrationService: vi.fn(function PlatformIntegrationService() {
    return mocks.integrationService;
  }),
}));

vi.mock("../../pos/services/ReceiptService", () => ({
  ReceiptService: vi.fn(function ReceiptService() {
    return mocks.receiptService;
  }),
}));

vi.mock("../../orders/services/OrdersService", () => ({
  OrdersService: vi.fn(function OrdersService() {
    return mocks.ordersService;
  }),
}));

function createQuery(result: unknown) {
  const builder = {
    from: vi.fn(() => builder),
    where: vi.fn(() => builder),
    orderBy: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    offset: vi.fn(() => builder),
    then: (
      resolve: (value: unknown) => void,
      reject?: (reason: unknown) => void,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

const fixtureTables = { platformMenuMappings, platformOrders, restaurants };
type SelectFixtureName = keyof typeof fixtureTables;

function mockSelectResults(fixtures: SelectFixtures<SelectFixtureName>) {
  Object.assign(
    mocks.db,
    createSelectFixtureDb(fixtureTables, {
      restaurants: [[{ settings: { currency: "TWD" } }]],
      ...fixtures,
    }),
  );
}

function mockMutations() {
  const inserted: unknown[] = [];
  const updated: unknown[] = [];
  const batches: unknown[][] = [];

  // The statements handed to batch() are the same builders insert() returns,
  // so `inserted` already holds their payloads by the time batch() is called.
  mocks.db.batch.mockImplementation((statements: unknown[]) => {
    batches.push(statements);
    return Promise.resolve(statements.map(() => ({})));
  });

  mocks.db.insert.mockImplementation(() => {
    const builder = {
      values: vi.fn((payload: unknown) => {
        inserted.push(payload);
        return builder;
      }),
      returning: vi.fn((projection?: unknown) =>
        createQuery(projection ? [{ id: "order-101" }] : []),
      ),
      then: (
        resolve: (value: unknown) => void,
        reject?: (reason: unknown) => void,
      ) => Promise.resolve(undefined).then(resolve, reject),
    };
    return builder;
  });

  mocks.db.update.mockImplementation(() => {
    const builder = {
      set: vi.fn((payload: unknown) => {
        updated.push(payload);
        return builder;
      }),
      where: vi.fn(() => builder),
      then: (
        resolve: (value: unknown) => void,
        reject?: (reason: unknown) => void,
      ) => Promise.resolve(undefined).then(resolve, reject),
    };
    return builder;
  });

  return { inserted, updated, batches };
}

function createService() {
  return new PlatformOrderService({ DB: { binding: "db" } } as unknown as Env);
}

function parsedOrder() {
  return {
    platformOrderId: "uber-order-1",
    platformStoreId: "store-1",
    currencyCode: "TWD",
    customerName: "Ari",
    customerPhone: "0912345678",
    deliveryAddress: "1 Main Street",
    subtotalCents: 1250,
    taxAmountCents: 75,
    totalAmountCents: 1325,
    platformStatus: "received" as const,
    rawPayload: { id: "uber-order-1" },
    items: [
      {
        platformItemId: "platform-item-1",
        name: "Laksa",
        quantity: 2,
        unitPriceCents: 550,
        totalPriceCents: 1100,
        customizations: [],
      },
      {
        platformItemId: "unmapped-item",
        name: "Unknown",
        quantity: 1,
        unitPriceCents: 200,
        totalPriceCents: 200,
        customizations: [],
      },
    ],
  };
}

describe("PlatformOrderService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(1710000000000);
    mocks.adapter.parseOrder.mockResolvedValue(parsedOrder());
    mocks.adapter.parseCancellation.mockResolvedValue({
      platformOrderId: "uber-order-1",
    });
    mocks.adapter.acceptOrder.mockResolvedValue(undefined);
    mocks.adapter.denyOrder.mockResolvedValue(undefined);
    mocks.adapter.cancelOrder.mockResolvedValue(undefined);
    mocks.integrationService.getIntegration.mockResolvedValue({
      config: { autoAcceptOrders: false },
    });
    mocks.integrationService.getDecryptedCredentials.mockResolvedValue({
      accessToken: "token",
    });
    mocks.receiptService.createKitchenTicket.mockResolvedValue({
      success: true,
    });
    mocks.ordersService.cancelOrder.mockResolvedValue({ id: "order-101" });
    mocks.ingredientConsumption.buildConsumptionWrites.mockResolvedValue([
      { kind: "ingredient-write" },
    ]);
  });

  it("creates internal platform orders and skips unmapped items", async () => {
    const mutations = mockMutations();
    mocks.adapter.parseOrder.mockResolvedValueOnce({
      ...parsedOrder(),
      notes: "Keep sauce separate",
      items: [
        {
          ...parsedOrder().items[0],
          notes: "No peanuts",
          customizations: [
            {
              name: "Extras",
              value: "Egg",
              priceAdjustmentCents: 150,
            },
          ],
        },
        parsedOrder().items[1],
      ],
    });
    mockSelectResults({
      platformOrders: [[]],
      platformMenuMappings: [
        [{ platformItemId: "platform-item-1", menuItemId: 501 }],
      ],
    });

    await expect(
      createService().processWebhook(
        "uber_eats",
        { id: "uber-order-1" },
        "restaurant-1",
      ),
    ).resolves.toBe("order-101");

    expect(mocks.adapter.parseOrder).toHaveBeenCalledWith({
      id: "uber-order-1",
    });
    expect(mutations.inserted).toHaveLength(3);
    expect(mutations.inserted[0]).toMatchObject({
      restaurantId: "restaurant-1",
      orderNumber: "PL-order-101",
      status: "pending",
      orderSource: "uber_eats",
      customerInfo: { name: "Ari", phone: "0912345678" },
      deliveryInfo: { type: "delivery", address: "1 Main Street" },
      subtotalCents: 1250,
      taxAmountCents: 75,
      totalAmountCents: 1325,
      serviceChargeCents: 0,
      discountAmountCents: 0,
      notes: "Keep sauce separate",
    });
    expect(mutations.inserted[1]).toMatchObject({
      orderId: "order-101",
      menuItemId: 501,
      quantity: 2,
      unitPriceCents: 550,
      totalPriceCents: 1100,
      itemSnapshot: { name: "Laksa" },
      notes: "No peanuts",
      customizations: {
        options: [
          {
            id: "0",
            optionName: "Extras",
            choiceId: "0",
            choiceName: "Egg",
            priceAdjustment: 1.5,
          },
        ],
      },
    });
    expect(mutations.inserted[2]).toMatchObject({
      orderId: "order-101",
      restaurantId: "restaurant-1",
      platform: "uber_eats",
      platformOrderId: "uber-order-1",
      platformStoreId: "store-1",
      platformStatus: "received",
      rawPayload: { id: "uber-order-1" },
    });
    // Order, inventory, ledger, counters, and mapping share one transaction,
    // so neither a duplicate nor a failed write can leave inventory drift.
    expect(mocks.db.batch).toHaveBeenCalledOnce();
    expect(mutations.batches[0]).toHaveLength(7);
  });

  it("rejects an Uber order whose currency differs from the restaurant", async () => {
    mockMutations();
    mocks.adapter.parseOrder.mockResolvedValue({
      ...parsedOrder(),
      currencyCode: "MYR",
    });
    mockSelectResults({
      restaurants: [[{ settings: { currency: "TWD" } }]],
      platformOrders: [[]],
      platformMenuMappings: [[]],
    });
    await expect(
      createService().processWebhook("uber_eats", {}, "restaurant-1"),
    ).rejects.toThrow("currency mismatch");
    expect(mocks.db.batch).not.toHaveBeenCalled();
  });

  it("includes mapped items' inventory, ingredient, and counter writes in the order batch", async () => {
    const mutations = mockMutations();
    mockSelectResults({
      platformOrders: [[]],
      platformMenuMappings: [
        [{ platformItemId: "platform-item-1", menuItemId: 501 }],
      ],
    });

    await createService().processWebhook(
      "uber_eats",
      { id: "uber-order-1" },
      "restaurant-1",
    );

    expect(IngredientConsumptionService).toHaveBeenCalledOnce();
    expect(
      mocks.ingredientConsumption.buildConsumptionWrites,
    ).toHaveBeenCalledWith("restaurant-1", [{ menuItemId: 501, quantity: 2 }], {
      orderId: "order-101",
    });
    // The order, mapped item, menu-stock guard, ingredient writes, counters,
    // and mapping must share a single transactional D1 batch.
    expect(mutations.batches[0]).toHaveLength(7);
  });

  it("resumes auto-accept processing for a mapped order that is still received", async () => {
    const mutations = mockMutations();
    mockSelectResults({
      platformOrders: [
        [{ orderId: "order-existing", platformStatus: "received" }],
      ],
    });
    mocks.integrationService.getIntegration.mockResolvedValueOnce({
      config: { autoAcceptOrders: true },
    });

    await expect(
      createService().processWebhook(
        "uber_eats",
        { id: "uber-order-1" },
        "restaurant-1",
      ),
    ).resolves.toBe("order-existing");

    expect(mutations.inserted).toHaveLength(0);
    expect(mocks.db.batch).not.toHaveBeenCalled();
    expect(mocks.adapter.acceptOrder).toHaveBeenCalledWith("uber-order-1", {
      accessToken: "token",
    });
    expect(mutations.updated).toEqual([
      expect.objectContaining({ platformStatus: "accepted" }),
      expect.objectContaining({ status: "confirmed" }),
    ]);
    expect(mocks.receiptService.createKitchenTicket).toHaveBeenCalledWith(
      "order-existing",
    );
  });

  it("returns the winning order when a concurrent delivery takes the mapping", async () => {
    const mutations = mockMutations();
    mockSelectResults({
      // Empty on the way in, then the winner's row once the batch is rejected.
      platformOrders: [[], [{ orderId: "order-winner" }]],
      platformMenuMappings: [
        [{ platformItemId: "platform-item-1", menuItemId: 501 }],
      ],
    });
    mocks.db.batch.mockRejectedValueOnce(
      new Error("UNIQUE constraint failed: platform_orders.platform_order_id"),
    );

    await expect(
      createService().processWebhook(
        "uber_eats",
        { id: "uber-order-1" },
        "restaurant-1",
      ),
    ).resolves.toBe("order-winner");

    // Nothing survives a rejected batch, so there is no orphan to reclaim and
    // no auto-accept for an order this call did not create.
    expect(mutations.updated).toHaveLength(3);
    expect(mocks.receiptService.createKitchenTicket).not.toHaveBeenCalled();
  });

  it("propagates a batch failure that is not a duplicate", async () => {
    mockMutations();
    mockSelectResults({
      platformOrders: [[], []],
      platformMenuMappings: [
        [{ platformItemId: "platform-item-1", menuItemId: 501 }],
      ],
    });
    mocks.db.batch.mockRejectedValueOnce(new Error("D1_ERROR: disk full"));

    await expect(
      createService().processWebhook(
        "uber_eats",
        { id: "uber-order-1" },
        "restaurant-1",
      ),
    ).rejects.toThrow("D1_ERROR: disk full");
  });

  it("auto-accepts configured platform orders and confirms the internal order", async () => {
    const mutations = mockMutations();
    mockSelectResults({
      platformOrders: [[]],
      platformMenuMappings: [
        [{ platformItemId: "platform-item-1", menuItemId: 501 }],
      ],
    });
    mocks.integrationService.getIntegration.mockResolvedValueOnce({
      config: { autoAcceptOrders: true },
    });

    await createService().processWebhook(
      "uber_eats",
      { id: "uber-order-1" },
      "restaurant-1",
    );

    expect(
      mocks.integrationService.getDecryptedCredentials,
    ).toHaveBeenCalledWith("restaurant-1", "uber_eats");
    expect(mocks.adapter.acceptOrder).toHaveBeenCalledWith("uber-order-1", {
      accessToken: "token",
    });
    expect(mutations.updated.slice(-2)).toEqual([
      expect.objectContaining({ platformStatus: "accepted" }),
      expect.objectContaining({ status: "confirmed" }),
    ]);
    expect(mocks.receiptService.createKitchenTicket).toHaveBeenCalledOnce();
    expect(mocks.receiptService.createKitchenTicket).toHaveBeenCalledWith(
      "order-101",
    );
  });

  it("does not queue a kitchen ticket when the order stays pending", async () => {
    mockMutations();
    mockSelectResults({
      platformOrders: [[]],
      platformMenuMappings: [
        [{ platformItemId: "platform-item-1", menuItemId: 501 }],
      ],
    });

    await createService().processWebhook(
      "uber_eats",
      { id: "uber-order-1" },
      "restaurant-1",
    );

    expect(mocks.receiptService.createKitchenTicket).not.toHaveBeenCalled();
  });

  it("keeps the confirmed order when the kitchen ticket cannot be queued", async () => {
    const mutations = mockMutations();
    mockSelectResults({
      platformOrders: [[]],
      platformMenuMappings: [
        [{ platformItemId: "platform-item-1", menuItemId: 501 }],
      ],
    });
    mocks.integrationService.getIntegration.mockResolvedValueOnce({
      config: { autoAcceptOrders: true },
    });
    mocks.receiptService.createKitchenTicket.mockRejectedValueOnce(
      new Error("printer queue down"),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      createService().processWebhook(
        "uber_eats",
        { id: "uber-order-1" },
        "restaurant-1",
      ),
    ).resolves.toBe("order-101");

    expect(mutations.updated.slice(-2)).toEqual([
      expect.objectContaining({ platformStatus: "accepted" }),
      expect.objectContaining({ status: "confirmed" }),
    ]);
    expect(console.error).toHaveBeenCalledWith(
      "Failed to queue kitchen ticket for order order-101:",
      expect.any(Error),
    );
  });

  it("logs a rejected kitchen ticket without failing the webhook", async () => {
    const mutations = mockMutations();
    mockSelectResults({
      platformOrders: [[]],
      platformMenuMappings: [
        [{ platformItemId: "platform-item-1", menuItemId: 501 }],
      ],
    });
    mocks.integrationService.getIntegration.mockResolvedValueOnce({
      config: { autoAcceptOrders: true },
    });
    mocks.receiptService.createKitchenTicket.mockResolvedValueOnce({
      success: false,
      error: "訂單不存在",
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      createService().processWebhook(
        "uber_eats",
        { id: "uber-order-1" },
        "restaurant-1",
      ),
    ).resolves.toBe("order-101");

    expect(mutations.updated).toHaveLength(5);
    expect(console.error).toHaveBeenCalledWith(
      "Failed to queue kitchen ticket for order order-101:",
      "訂單不存在",
    );
  });

  it("does not fail webhook processing when auto-accept fails", async () => {
    const mutations = mockMutations();
    mockSelectResults({
      platformOrders: [[]],
      platformMenuMappings: [
        [{ platformItemId: "platform-item-1", menuItemId: 501 }],
      ],
    });
    mocks.integrationService.getIntegration.mockResolvedValueOnce({
      config: { autoAcceptOrders: true },
    });
    mocks.adapter.acceptOrder.mockRejectedValueOnce(new Error("platform down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      createService().processWebhook(
        "uber_eats",
        { id: "uber-order-1" },
        "restaurant-1",
      ),
    ).resolves.toBe("order-101");

    expect(mutations.updated).toHaveLength(3);
    expect(mocks.receiptService.createKitchenTicket).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "Failed to auto-accept order uber-order-1:",
      expect.any(Error),
    );
  });

  it("cancels a mapped order through OrdersService and never echoes to the adapter", async () => {
    const mutations = mockMutations();
    mockSelectResults({
      platformOrders: [
        [
          {
            id: "platform-row-101",
            orderId: "order-101",
            restaurantId: "restaurant-1",
            platformStatus: "accepted",
          },
        ],
      ],
    });
    mocks.adapter.parseCancellation.mockResolvedValueOnce({
      platformOrderId: "uber-order-1",
      reason: "customer_cancelled",
    });

    await expect(
      createService().processCancellation(
        "uber_eats",
        { order: { id: "uber-order-1" } },
        "restaurant-1",
      ),
    ).resolves.toEqual({ handled: true });

    expect(mocks.ordersService.cancelOrder).toHaveBeenCalledWith(
      "order-101",
      "customer_cancelled",
    );
    expect(mocks.adapter.cancelOrder).not.toHaveBeenCalled();
    expect(mutations.updated).toEqual([
      expect.objectContaining({ platformStatus: "cancelled" }),
    ]);
  });

  it("ignores a cancellation payload it cannot read an order id out of", async () => {
    const mutations = mockMutations();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.adapter.parseCancellation.mockRejectedValueOnce(
      new Error("Uber Eats cancellation payload is missing an order id"),
    );

    // Unreadable is not the same as failed: reporting it as a failure would
    // buy an unbounded redelivery loop for a payload that cannot improve.
    await expect(
      createService().processCancellation(
        "uber_eats",
        { order: {} },
        "restaurant-1",
      ),
    ).resolves.toEqual({ handled: false });

    expect(mocks.ordersService.cancelOrder).not.toHaveBeenCalled();
    expect(mutations.updated).toEqual([]);
    expect(console.error).toHaveBeenCalledWith(
      "Unparseable uber_eats cancellation payload:",
      "Uber Eats cancellation payload is missing an order id",
    );
  });

  it("ignores a cancellation mapping owned by another restaurant", async () => {
    mockMutations();
    mockSelectResults({
      platformOrders: [
        [
          {
            id: "platform-row-other",
            orderId: "order-other",
            restaurantId: "restaurant-other",
            platformStatus: "accepted",
          },
        ],
      ],
    });
    mocks.adapter.parseCancellation.mockResolvedValueOnce({
      platformOrderId: "uber-order-other",
    });

    await expect(
      createService().processCancellation(
        "uber_eats",
        { order: { id: "uber-order-other" } },
        "restaurant-1",
      ),
    ).resolves.toEqual({ handled: false });

    expect(mocks.ordersService.cancelOrder).not.toHaveBeenCalled();
    expect(mocks.adapter.cancelOrder).not.toHaveBeenCalled();
  });

  it("acknowledges an already terminal mapped order without changing platform state", async () => {
    const mutations = mockMutations();
    mockSelectResults({
      platformOrders: [
        [
          {
            id: "platform-row-completed",
            orderId: "order-completed",
            restaurantId: "restaurant-1",
            platformStatus: "accepted",
          },
        ],
      ],
    });
    mocks.adapter.parseCancellation.mockResolvedValueOnce({
      platformOrderId: "uber-order-completed",
    });
    mocks.ordersService.cancelOrder.mockRejectedValueOnce(
      Object.assign(new Error("Order cannot be cancelled"), {
        code: "ORDER_NOT_CANCELLABLE",
      }),
    );
    mocks.ordersService.getOrder.mockResolvedValueOnce({ status: "completed" });

    await expect(
      createService().processCancellation(
        "uber_eats",
        { order: { id: "uber-order-completed" } },
        "restaurant-1",
      ),
    ).resolves.toEqual({ handled: true });

    expect(mutations.updated).toEqual([]);
  });

  it("repairs platform state when a retry finds the local order already cancelled", async () => {
    const mutations = mockMutations();
    mockSelectResults({
      platformOrders: [
        [
          {
            id: "platform-row-retry",
            orderId: "order-cancelled",
            restaurantId: "restaurant-1",
            platformStatus: "accepted",
          },
        ],
      ],
    });
    mocks.ordersService.cancelOrder.mockRejectedValueOnce(
      Object.assign(new Error("Order cannot be cancelled"), {
        code: "ORDER_NOT_CANCELLABLE",
      }),
    );
    mocks.ordersService.getOrder.mockResolvedValueOnce({ status: "cancelled" });

    await expect(
      createService().processCancellation(
        "uber_eats",
        { order: { id: "uber-order-retry" } },
        "restaurant-1",
      ),
    ).resolves.toEqual({ handled: true });

    expect(mutations.updated).toEqual([
      expect.objectContaining({ platformStatus: "cancelled" }),
    ]);
  });

  it("syncs platform status transitions for accepted, denied, cancelled, and ready orders", async () => {
    const mutations = mockMutations();
    mockSelectResults({
      platformOrders: [
        [
          {
            id: "platform-row-1",
            orderId: "order-101",
            restaurantId: "restaurant-1",
            platform: "uber_eats",
            platformOrderId: "uber-order-1",
            platformStatus: "received",
          },
        ],
        [
          {
            id: "platform-row-2",
            orderId: "order-102",
            restaurantId: "restaurant-1",
            platform: "uber_eats",
            platformOrderId: "uber-order-2",
            platformStatus: "received",
          },
        ],
        [
          {
            id: "platform-row-3",
            orderId: "order-103",
            restaurantId: "restaurant-1",
            platform: "uber_eats",
            platformOrderId: "uber-order-3",
            platformStatus: "accepted",
          },
        ],
        [
          {
            id: "platform-row-4",
            orderId: "order-104",
            restaurantId: "restaurant-1",
            platform: "uber_eats",
            platformOrderId: "uber-order-4",
            platformStatus: "accepted",
          },
        ],
      ],
    });
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await createService().syncStatusToPlatform("order-101", "confirmed");
    await createService().syncStatusToPlatform("order-102", "cancelled");
    await createService().syncStatusToPlatform("order-103", "cancelled");
    await createService().syncStatusToPlatform("order-104", "ready");

    expect(mocks.adapter.acceptOrder).toHaveBeenCalledWith("uber-order-1", {
      accessToken: "token",
    });
    expect(mocks.adapter.denyOrder).toHaveBeenCalledWith(
      "uber-order-2",
      "Order denied by restaurant",
      { accessToken: "token" },
    );
    expect(mocks.adapter.cancelOrder).toHaveBeenCalledWith(
      "uber-order-3",
      "Order cancelled by restaurant",
      { accessToken: "token" },
    );
    expect(mutations.updated).toEqual([
      expect.objectContaining({ platformStatus: "accepted" }),
      expect.objectContaining({ platformStatus: "denied" }),
      expect.objectContaining({ platformStatus: "cancelled" }),
      expect.objectContaining({ platformStatus: "ready" }),
    ]);
  });

  it("ignores status sync when no platform order exists and lists filtered platform orders", async () => {
    const mutations = mockMutations();
    mockSelectResults({
      platformOrders: [[], [{ id: "platform-row-1", platform: "uber_eats" }]],
    });

    await createService().syncStatusToPlatform("order-404", "confirmed");
    const results = await createService().getPlatformOrders("restaurant-1", {
      platform: "uber_eats",
      platformStatus: "received",
      page: 2,
      limit: 10,
    });

    expect(mocks.adapter.acceptOrder).not.toHaveBeenCalled();
    expect(mutations.updated).toHaveLength(0);
    expect(results).toEqual([{ id: "platform-row-1", platform: "uber_eats" }]);
  });
});
