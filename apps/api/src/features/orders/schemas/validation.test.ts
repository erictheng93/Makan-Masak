import { describe, expect, it } from "vitest";
import {
  advancedOrderQuerySchema,
  bulkOrderOperationSchema,
  createOrderSchema,
  exportOrdersSchema,
  generateReceiptSchema,
  kitchenOrderFilterSchema,
  notificationPreferencesSchema,
  orderBatchIdParamSchema,
  orderFilterSchema,
  orderIdParamSchema,
  orderItemIdParamSchema,
  orderSearchSchema,
  orderStatsQuerySchema,
  orderSubscriptionSchema,
  popularItemsQuerySchema,
  previewCouponSchema,
  updateOrderItemSchema,
  updatePaymentStatusSchema,
  validateBulkOrderIds,
  validateOrderAmount,
  validateOrderStatusTransition,
  validateOrderTiming,
  validateUserPermission,
} from "./validation";

const baseOrder = {
  restaurantId: "rest_123",
  items: [{ menuItemId: 1, quantity: 1 }],
};

describe("order validation", () => {
  it("requires customerPhone when creating a waiting-list pre-order", () => {
    const result = createOrderSchema.safeParse({
      ...baseOrder,
      waitingListId: "wait_123",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["customerPhone"]);
  });

  it("accepts waiting-list pre-orders with ticket phone verification", () => {
    const result = createOrderSchema.safeParse({
      ...baseOrder,
      waitingListId: "wait_123",
      customerPhone: "0912345678",
    });

    expect(result.success).toBe(true);
  });

  it("keeps the idempotency key, and caps it at the column's width", () => {
    // zod drops whatever it does not declare, which is how the key went
    // missing on this path for as long as it did: everything behind the schema
    // -- the service, the column, the unique index, the 409 -- was already in
    // place and simply never saw one.
    const parsed = createOrderSchema.parse({
      ...baseOrder,
      clientMutationId: "cart-9f2c-1",
    });
    expect(parsed.clientMutationId).toBe("cart-9f2c-1");

    expect(
      createOrderSchema.safeParse({
        ...baseOrder,
        clientMutationId: "x".repeat(101),
      }).success,
    ).toBe(false);
  });

  it("sanitizes free-text order notes and customization instructions", () => {
    const result = createOrderSchema.parse({
      ...baseOrder,
      notes: '<script>alert("x")</script>`=',
      items: [
        {
          menuItemId: 1,
          quantity: 1,
          notes: "<b>no onions</b>",
          customizations: {
            specialInstructions: '"extra" <spicy>=true',
          },
        },
      ],
    });

    expect(result.notes).toBe("scriptalert(x)/script");
    expect(result.items[0].notes).toBe("bno onions/b");
    expect(result.items[0].customizations?.specialInstructions).toBe(
      "extra spicytrue",
    );
  });

  it("requires delivery contact details only for delivery orders", () => {
    expect(
      createOrderSchema.safeParse({
        ...baseOrder,
        deliveryInfo: { type: "takeaway" },
      }).success,
    ).toBe(true);

    const missingContact = createOrderSchema.safeParse({
      ...baseOrder,
      deliveryInfo: { type: "delivery", address: "1 Main St" },
    });
    expect(missingContact.success).toBe(false);

    expect(
      createOrderSchema.safeParse({
        ...baseOrder,
        deliveryInfo: {
          type: "delivery",
          address: "1 Main St",
          phone: "0912345678",
        },
      }).success,
    ).toBe(true);
  });

  it("normalizes order list and search query filters", () => {
    const filters = orderFilterSchema.parse({
      status: "pending,confirmed",
      paymentStatus: "paid,failed",
      paymentMethod: "cash,card",
      tableId: "12",
      minAmount: "10.50",
      maxAmount: "99",
      hasNotes: "true",
      rating: "5,4",
      createdBy: "7",
      page: "2",
      limit: "25",
    });

    expect(filters).toMatchObject({
      status: ["pending", "confirmed"],
      paymentStatus: ["paid", "failed"],
      paymentMethod: ["cash", "card"],
      tableId: 12,
      minAmount: 10.5,
      maxAmount: 99,
      hasNotes: true,
      rating: [5, 4],
      createdBy: 7,
      sortBy: "createdAt",
      sortOrder: "desc",
      page: 2,
      limit: 25,
    });

    const search = orderSearchSchema.parse({
      query: "A100",
      searchFields: ["orderNumber", "notes"],
      fuzzy: "true",
    });
    expect(search.fuzzy).toBe(true);
    expect(search.status).toBeUndefined();
  });

  it("accepts every canonical order payment status in list filters", () => {
    expect(
      orderFilterSchema.parse({ paymentStatus: "completed,refunded" }),
    ).toMatchObject({ paymentStatus: ["completed", "refunded"] });
  });

  it("parses analytics, export, receipt, and kitchen defaults", () => {
    expect(orderStatsQuerySchema.parse({})).toMatchObject({
      timeRange: "today",
      groupBy: "day",
      includeItems: false,
      includeCustomers: false,
    });

    expect(
      popularItemsQuerySchema.parse({ restaurantId: 1, limit: "3" }),
    ).toMatchObject({
      restaurantId: 1,
      timeRange: "month",
      limit: 3,
      minQuantity: 1,
    });

    expect(
      exportOrdersSchema.parse({
        format: "csv",
        includeItems: "true",
        includeCustomerInfo: "false",
      }),
    ).toMatchObject({
      format: "csv",
      includeItems: true,
      includeCustomerInfo: false,
    });

    expect(generateReceiptSchema.parse({})).toEqual({
      format: "pdf",
      includeQR: true,
      language: "en",
      template: "default",
    });

    expect(kitchenOrderFilterSchema.parse({ restaurantId: 9 })).toMatchObject({
      restaurantId: 9,
      status: ["confirmed", "preparing"],
      limit: 50,
    });
  });

  it("validates payment, item, subscription, and parameter schemas", () => {
    expect(
      updatePaymentStatusSchema.parse({
        paymentStatus: "paid",
        paymentMethod: "card",
        metadata: { terminal: "front" },
      }),
    ).toMatchObject({ paymentStatus: "paid", paymentMethod: "card" });

    expect(
      updateOrderItemSchema.parse({
        status: "ready",
        quantity: 2,
        notes: "<b>ready</b>",
      }),
    ).toMatchObject({ status: "ready", quantity: 2, notes: "bready/b" });

    expect(
      orderSubscriptionSchema.parse({
        restaurantId: 1,
        roles: [1, 2],
        events: ["ORDER_CREATED"],
        tableIds: [3],
      }),
    ).toMatchObject({ restaurantId: 1, roles: [1, 2], tableIds: [3] });

    expect(orderIdParamSchema.parse({ id: "55" })).toEqual({ id: "55" });
    expect(
      orderBatchIdParamSchema.safeParse({ batchId: "not-a-uuid" }).success,
    ).toBe(false);
    expect(orderItemIdParamSchema.parse({ orderId: "5", itemId: "6" })).toEqual(
      {
        orderId: "5",
        itemId: 6,
      },
    );
  });

  it("validates bulk operation uniqueness and coupon preview input", () => {
    expect(
      bulkOrderOperationSchema.parse({
        action: "cancel",
        orderIds: [1, 2],
        data: { format: "pdf", notes: "<b>queued</b>" },
      }),
    ).toMatchObject({
      action: "cancel",
      data: { format: "pdf", notes: "bqueued/b" },
    });

    // `export` and `archive` are not implemented — the schema rejects them so
    // the caller gets one 400 instead of 200 OK with an error per order.
    expect(
      bulkOrderOperationSchema.safeParse({
        action: "export",
        orderIds: [1, 2],
      }).success,
    ).toBe(false);

    // update_status without a status matched no branch in the service loop and
    // came back 200 with every order silently untouched.
    expect(
      bulkOrderOperationSchema.safeParse({
        action: "update_status",
        orderIds: [1, 2],
      }).success,
    ).toBe(false);
    expect(
      bulkOrderOperationSchema.safeParse({
        action: "update_status",
        orderIds: [1, 2],
        data: { status: "preparing" },
      }).success,
    ).toBe(true);

    expect(validateBulkOrderIds.safeParse([1, 2, 1]).success).toBe(false);
    expect(
      previewCouponSchema.parse({
        restaurantId: "rest-1",
        couponCode: "SAVE10",
        orderAmount: 100,
        userId: "42",
        menuItems: [{ menuItemId: 1, quantity: 2 }],
      }),
    ).toMatchObject({ couponCode: "SAVE10", userId: "42" });
  });

  it("parses advanced query and notification defaults", () => {
    expect(
      advancedOrderQuerySchema.parse({
        includeItems: "true",
        includeCustomer: "true",
        includeRestaurant: "false",
        includeTable: "true",
        includeAnalytics: "false",
        fields: "id,status,totalAmount",
        excludeFields: "internalNotes",
      }),
    ).toMatchObject({
      includeItems: true,
      includeCustomer: true,
      includeRestaurant: false,
      includeTable: true,
      includeAnalytics: false,
      fields: ["id", "status", "totalAmount"],
      excludeFields: ["internalNotes"],
    });

    expect(notificationPreferencesSchema.parse({})).toEqual({
      enablePush: true,
      enableEmail: false,
      enableSMS: false,
    });
  });

  it("checks order helper functions", () => {
    expect(validateOrderStatusTransition("pending", "confirmed")).toBe(true);
    expect(validateOrderStatusTransition("paid", "confirmed")).toBe(false);
    expect(validateOrderStatusTransition("missing", "confirmed")).toBe(false);

    expect(validateUserPermission(0, [1])).toBe(true);
    expect(validateUserPermission(2, [1, 2])).toBe(true);
    expect(validateUserPermission(3, [1, 2])).toBe(false);

    const now = new Date("2026-06-08T10:00:00.000Z");
    expect(validateOrderTiming(undefined, now)).toBe(true);
    expect(validateOrderTiming("2026-06-08T10:20:00.000Z", now)).toBe(true);
    expect(validateOrderTiming("2026-06-08T10:05:00.000Z", now)).toBe(false);

    expect(
      validateOrderAmount(
        [
          { price: 10, quantity: 2 },
          { price: 5, quantity: 1 },
        ],
        25,
      ),
    ).toBe(true);
    expect(validateOrderAmount([{ price: 10, quantity: 1 }], 20)).toBe(false);
  });
});
