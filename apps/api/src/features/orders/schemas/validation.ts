/**
 * Orders Validation Schemas
 * Zod validation schemas for all order endpoints and operations
 */

import {
  ORDER_PAYMENT_STATUSES,
  ORDER_STATUSES,
} from "@makanmasak/shared-types";
import { z } from "zod";
import {
  boundedLimitQuery,
  boundedPageQuery,
} from "../../../middleware/validation";
import { ORDER_STATUS_TRANSITIONS } from "../types";

// Common validation patterns
const idSchema = z.number().int().positive();
const optionalIdSchema = z.number().int().positive().optional();
const phoneSchema = z.string().max(20).optional();
const emailSchema = z.email().optional();
const idStringSchema = z.preprocess((value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return value;
}, z.string().trim().min(1));
// Sanitize free-text user input by removing HTML metacharacters instead of
// trying to strip whole tags/attributes, which can be bypassed by overlap.
const sanitizeFreeText = (input: string): string => {
  return input.replace(/[<>"`=]/g, "");
};

const notesSchema = (maxLength: number) =>
  z.string().max(maxLength).transform(sanitizeFreeText);
// const urlSchema = z.url().optional() // Available for future use
const positiveNumberSchema = z.number().positive();
// const nonNegativeNumberSchema = z.number().min(0) // Available for future use
const dateStringSchema = z.iso.datetime().optional();
const paginationSchema = z.object({
  page: boundedPageQuery(),
  limit: boundedLimitQuery(),
});

// Order status enum matching the shared-types canonical runtime tuple.
const orderStatusSchema = z.enum(ORDER_STATUSES);

// "paid" remains an accepted legacy query value and is normalized to
// "completed" by the route before it reaches the database service.
const orderPaymentStatusSchema = z.enum([...ORDER_PAYMENT_STATUSES, "paid"]);

const orderPaymentMethodSchema = z.enum(["cash", "card", "online", "ewallet"]);

const orderItemStatusSchema = z.enum([
  "pending",
  "preparing",
  "ready",
  "delivered",
]);

const orderTypeSchema = z.enum(["shop", "table", "seat"]);

const fulfillmentTypeSchema = z.enum(["dine_in", "takeaway", "delivery"]);

const deliveryInfoSchema = z
  .object({
    type: fulfillmentTypeSchema,
    address: z.string().max(200).optional(),
    phone: z.string().max(20).optional(),
    instructions: z.string().max(500).optional(),
    deliveryFee: z.number().min(0).optional(),
    estimatedDeliveryTime: z.number().int().min(0).optional(),
  })
  .refine(
    (data) => {
      if (data.type === "delivery") {
        return !!data.address && !!data.phone;
      }
      return true;
    },
    {
      message: "Address and phone are required for delivery orders",
    },
  );

// Customer information schema
const customerInfoSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    phone: phoneSchema,
    email: emailSchema,
    address: z.string().max(200).optional(),
  })
  .optional();

// Customization schemas
const customizationOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  priceAdjustment: z.number().optional(),
});

const customizationGroupSchema = z.object({
  id: z.string(),
  optionName: z.string(),
  choiceId: z.string(),
  choiceName: z.string(),
  priceAdjustment: z.number().optional(),
});

const addOnSchema = z.object({
  id: z.string(),
  name: z.string(),
  unitPrice: positiveNumberSchema,
  quantity: z.number().int().positive(),
  totalPrice: positiveNumberSchema,
});

const selectedCustomizationsSchema = z
  .object({
    size: customizationOptionSchema.optional(),
    options: z.array(customizationGroupSchema).optional(),
    addOns: z.array(addOnSchema).optional(),
    specialInstructions: notesSchema(200).optional(),
  })
  .optional();

// Order item schemas
const createOrderItemSchema = z.object({
  menuItemId: idSchema,
  quantity: z.number().int().positive().max(99),
  price: positiveNumberSchema.optional(),
  customizations: selectedCustomizationsSchema,
  notes: notesSchema(200).optional(),
});

// Main order creation schema
export const createOrderSchema = z
  .object({
    restaurantId: z.string().min(1),
    tableId: optionalIdSchema,
    waitingListId: z.string().min(1).max(100).optional(),
    customerName: z.string().min(1).max(100).optional(),
    customerPhone: phoneSchema,
    customerEmail: emailSchema,
    customerInfo: customerInfoSchema,
    items: z.array(createOrderItemSchema).min(1).max(50),
    notes: notesSchema(500).optional(),
    orderType: orderTypeSchema.default("shop"),
    // What the customer scanned, when they scanned something. Optional on
    // purpose: clients that predate the field, and entry points with no sticker
    // to present, must keep working. See assertShopQrCurrent.
    shopQrCode: z.string().max(100).optional(),
    deliveryInfo: deliveryInfoSchema.optional(),
    scheduledTime: dateStringSchema,
    couponCode: z.string().max(50).optional(),
    // Idempotency key for this submission. `orders` carries a unique index on
    // (restaurant_id, client_mutation_id), and the database service maps the
    // violation to CLIENT_MUTATION_DUPLICATE — but zod strips whatever it does
    // not declare, so without this line the whole mechanism stayed unreachable
    // from the authenticated path. Unlike guest orders, this path has no KV
    // active-order lock behind it, so this key is its only defence against a
    // retry after a dropped connection creating a second order.
    clientMutationId: z.string().max(100).optional(),
  })
  .refine((data) => !data.waitingListId || !!data.customerPhone, {
    message: "customerPhone is required for waiting-list pre-orders",
    path: ["customerPhone"],
  });

// Order update schemas
export const updateOrderStatusSchema = z.object({
  status: orderStatusSchema,
  notes: notesSchema(500).optional(),
  estimatedReadyTime: dateStringSchema,
  actualPrepTime: z.number().int().min(0).max(999).optional(), // in minutes
});

export const updateOrderSchema = z.object({
  status: orderStatusSchema.optional(),
  paymentStatus: orderPaymentStatusSchema.optional(),
  paymentMethod: orderPaymentMethodSchema.optional(),
  notes: notesSchema(500).optional(),
  internalNotes: z.string().max(500).optional(),
  estimatedPrepTime: z.number().int().min(0).max(999).optional(), // in minutes
  actualPrepTime: z.number().int().min(0).max(999).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  reviewComment: z.string().max(500).optional(),
});

// Order filtering and query schemas
export const orderFilterSchema = z.object({
  restaurantId: z.string().optional(),
  status: z
    .union([
      orderStatusSchema,
      z
        .string()
        .transform((s) => s.split(","))
        .pipe(z.array(orderStatusSchema)),
    ])
    .optional(),
  paymentStatus: z
    .union([
      orderPaymentStatusSchema,
      z
        .string()
        .transform((s) => s.split(","))
        .pipe(z.array(orderPaymentStatusSchema)),
    ])
    .optional(),
  orderType: orderTypeSchema.optional(),
  orderSource: z
    .enum(["direct", "market_checkout", "uber_eats", "foodpanda", "grabfood"])
    .optional(),
  search: z.string().trim().min(1).max(100).optional(),
  fulfillmentType: fulfillmentTypeSchema.optional(),
  tableId: z.string().regex(/^\d+$/).transform(Number).optional(),
  customerId: z.string().min(1).optional(),
  customerName: z.string().max(100).optional(),
  customerPhone: z.string().max(20).optional(),
  dateFrom: dateStringSchema,
  dateTo: dateStringSchema,
  scheduledTimeFrom: dateStringSchema,
  scheduledTimeTo: dateStringSchema,
  minAmount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .transform(Number)
    .optional(),
  maxAmount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .transform(Number)
    .optional(),
  paymentMethod: z
    .union([
      orderPaymentMethodSchema,
      z
        .string()
        .transform((s) => s.split(","))
        .pipe(z.array(orderPaymentMethodSchema)),
    ])
    .optional(),
  hasNotes: z
    .string()
    .transform((s) => s === "true")
    .optional(),
  rating: z
    .string()
    .regex(/^[1-5](,[1-5])*$/)
    .transform((s) => s.split(",").map(Number))
    .optional(),
  createdBy: z.string().regex(/^\d+$/).transform(Number).optional(),
  sortBy: z
    .enum(["createdAt", "totalAmount", "status", "updatedAt"])
    .optional()
    .default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
  ...paginationSchema.shape,
});

// Order search schema
export const orderSearchSchema = z.object({
  query: z.string().min(1).max(100).optional(),
  searchFields: z
    .array(z.enum(["orderNumber", "customerName", "customerPhone", "notes"]))
    .optional(),
  fuzzy: z
    .string()
    .transform((s) => s === "true")
    .optional()
    .prefault("false"),
  ...orderFilterSchema.shape,
});

// Coupon validation schema
export const previewCouponSchema = z.object({
  restaurantId: z.string().min(1),
  couponCode: z.string().min(1).max(50),
  orderAmount: positiveNumberSchema,
  userId: idStringSchema.optional(),
  menuItems: z
    .array(
      z.object({
        menuItemId: idSchema,
        quantity: z.number().int().positive(),
      }),
    )
    .optional(),
});

// Bulk operations schema
// `export` and `archive` were advertised here but never implemented — the
// service rejects them per order, so a batch of 100 came back 200 OK with 100
// identical errors. Rejecting them at the boundary gives one 400 instead. The
// service keeps its own guard for callers that bypass this schema.
export const bulkOrderOperationSchema = z
  .object({
    action: z.enum(["update_status", "cancel"]),
    orderIds: z.array(idStringSchema).min(1).max(100),
    data: z
      .object({
        status: orderStatusSchema.optional(),
        reason: z.string().max(200).optional(),
        format: z.enum(["csv", "excel", "pdf"]).optional(),
        notes: notesSchema(500).optional(),
      })
      .optional(),
    batchId: z.uuid().optional(),
  })
  .superRefine((value, ctx) => {
    // Without this, `update_status` with no status parsed fine, matched no
    // branch in the service loop and returned 200 with every order silently
    // untouched.
    if (value.action === "update_status" && !value.data?.status) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["data", "status"],
        message: "data.status is required for the update_status action",
      });
    }
  });

// Analytics and statistics schemas
export const orderStatsQuerySchema = z.object({
  restaurantId: z.string().optional(),
  dateFrom: dateStringSchema,
  dateTo: dateStringSchema,
  timeRange: z
    .enum(["today", "yesterday", "week", "month", "quarter", "year", "custom"])
    .optional()
    .default("today"),
  groupBy: z.enum(["hour", "day", "week", "month"]).optional().default("day"),
  includeItems: z
    .string()
    .transform((s) => s === "true")
    .optional()
    .prefault("false"),
  includeCustomers: z
    .string()
    .transform((s) => s === "true")
    .optional()
    .prefault("false"),
});

export const popularItemsQuerySchema = z.object({
  restaurantId: idSchema,
  timeRange: z
    .enum(["today", "yesterday", "week", "month", "quarter", "year"])
    .optional()
    .default("month"),
  limit: boundedLimitQuery("10"),
  minQuantity: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .optional()
    .prefault("1"),
});

// Export schema
export const exportOrdersSchema = z.object({
  format: z.enum(["csv", "excel", "pdf"]),
  includeItems: z
    .string()
    .transform((s) => s === "true")
    .optional()
    .prefault("false"),
  includeCustomerInfo: z
    .string()
    .transform((s) => s === "true")
    .optional()
    .prefault("true"),
  columns: z.array(z.string()).optional(),
  ...orderFilterSchema.omit({ page: true, limit: true }).shape,
});

// Order receipt generation schema
export const generateReceiptSchema = z.object({
  format: z.enum(["pdf", "html", "json"]).optional().default("pdf"),
  includeQR: z
    .string()
    .transform((s) => s === "true")
    .optional()
    .prefault("true"),
  language: z.enum(["en", "zh", "ms"]).optional().default("en"),
  template: z.enum(["default", "thermal", "a4"]).optional().default("default"),
});

// Order item update schema
export const updateOrderItemSchema = z.object({
  status: orderItemStatusSchema.optional(),
  quantity: z.number().int().positive().max(99).optional(),
  customizations: selectedCustomizationsSchema,
  notes: notesSchema(200).optional(),
  price: positiveNumberSchema.optional(),
});

// Real-time subscription schema
export const orderSubscriptionSchema = z.object({
  restaurantId: idSchema,
  roles: z.array(z.number().int().min(0).max(4)).min(1).max(5),
  events: z
    .array(
      z.enum([
        "ORDER_CREATED",
        "ORDER_UPDATED",
        "ORDER_STATUS_CHANGED",
        "ORDER_CANCELLED",
        "PAYMENT_STATUS_CHANGED",
        "ORDER_ITEM_UPDATED",
      ]),
    )
    .optional(),
  tableIds: z.array(idSchema).optional(),
});

// Parameter validation schemas
export const orderIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export const orderBatchIdParamSchema = z.object({
  batchId: z.uuid(),
});

export const orderItemIdParamSchema = z.object({
  orderId: z.string().trim().min(1),
  itemId: z.string().regex(/^\d+$/).transform(Number),
});

// The staff item-edit routes are mounted under `/:id/items/:itemId`, matching
// every other order route's `:id`. orderItemIdParamSchema above names it
// `orderId` and belongs to a different path shape.
export const orderItemPathParamSchema = z.object({
  id: z.string().trim().min(1),
  itemId: z.string().regex(/^\d+$/).transform(Number),
});

// `expectedVersion` carries the `orders.version` the client last saw. Optional
// so a client that does not track it still works, but supplying it is what
// turns two staff editing one order into a 409 instead of a silent overwrite.
const expectedVersionSchema = z.number().int().nonnegative().optional();

export const addOrderItemsSchema = z.object({
  items: z.array(createOrderItemSchema).min(1).max(50),
  expectedVersion: expectedVersionSchema,
});

// Quantity 0 is not accepted here; removal is DELETE on the item.
export const changeOrderItemQuantitySchema = z.object({
  quantity: z.number().int().min(1).max(99),
  expectedVersion: expectedVersionSchema,
});

// A counter discount is expressed as a percentage, never as an amount: the
// server derives the money from the order's own stored cents, so a client
// cannot name a price (#327). `reason` is required and lands in the audit log
// -- an amount-affecting operation has to leave behind who did it and why.
export const applyOrderDiscountSchema = z.object({
  discountPercent: z.number().min(0).max(100),
  reason: z.string().trim().min(1).max(200),
  expectedVersion: expectedVersionSchema,
});

// DELETE carries no body, so the version travels as a query parameter.
export const removeOrderItemQuerySchema = z.object({
  expectedVersion: z.string().regex(/^\d+$/).transform(Number).optional(),
});

// Review and rating schema
export const addOrderReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
  itemRatings: z
    .array(
      z.object({
        itemId: idSchema,
        rating: z.number().int().min(1).max(5),
        comment: z.string().max(200).optional(),
      }),
    )
    .optional(),
});

// Order modification schema (for special cases)
export const modifyOrderSchema = z.object({
  addItems: z.array(createOrderItemSchema).optional(),
  removeItems: z.array(idSchema).optional(),
  updateItems: z
    .array(
      z.object({
        itemId: idSchema,
        quantity: z.number().int().positive().max(99).optional(),
        customizations: selectedCustomizationsSchema,
        notes: notesSchema(200).optional(),
      }),
    )
    .optional(),
  notes: notesSchema(500).optional(),
  reason: z.string().max(200),
});

// Notification preferences schema
export const notificationPreferencesSchema = z.object({
  enablePush: z.boolean().optional().default(true),
  enableEmail: z.boolean().optional().default(false),
  enableSMS: z.boolean().optional().default(false),
  statusUpdates: z.array(orderStatusSchema).optional(),
  roles: z.array(z.number().int().min(0).max(4)).optional(),
});

// Kitchen display specific schemas
export const kitchenOrderFilterSchema = z.object({
  restaurantId: idSchema,
  status: z
    .array(z.enum(["confirmed", "preparing", "ready"]))
    .optional()
    .default(["confirmed", "preparing"]),
  priority: z.enum(["normal", "high", "urgent"]).optional(),
  preparationTime: z.enum(["overdue", "soon", "normal"]).optional(),
  assignedTo: optionalIdSchema,
  orderType: orderTypeSchema.optional(),
  fulfillmentType: fulfillmentTypeSchema.optional(),
  limit: boundedLimitQuery("50"),
});

// Advanced query validation
export const advancedOrderQuerySchema = orderFilterSchema.extend({
  includeItems: z
    .string()
    .transform((s) => s === "true")
    .optional()
    .prefault("false"),
  includeCustomer: z
    .string()
    .transform((s) => s === "true")
    .optional()
    .prefault("false"),
  includeRestaurant: z
    .string()
    .transform((s) => s === "true")
    .optional()
    .prefault("false"),
  includeTable: z
    .string()
    .transform((s) => s === "true")
    .optional()
    .prefault("false"),
  includeAnalytics: z
    .string()
    .transform((s) => s === "true")
    .optional()
    .prefault("false"),
  fields: z
    .string()
    .transform((s) => s.split(","))
    .optional(), // Select specific fields
  excludeFields: z
    .string()
    .transform((s) => s.split(","))
    .optional(), // Exclude specific fields
});

export const validateOrderStatusTransition = (
  currentStatus: string,
  newStatus: string,
): boolean => {
  return ORDER_STATUS_TRANSITIONS[currentStatus]?.includes(newStatus) ?? false;
};

export const validateUserPermission = (
  userRole: number,
  requiredRoles: number[],
): boolean => {
  return userRole === 0 || requiredRoles.includes(userRole); // Admin can do everything
};

// Error handling schemas
export const orderErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  field: z.string().optional(),
  value: z.any().optional(),
  details: z.record(z.string(), z.any()).optional(),
});

// Batch validation for bulk operations
export const validateBulkOrderIds = z
  .array(idSchema)
  .min(1)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Order IDs must be unique",
  });

// Custom validation functions
export const validateOrderTiming = (
  scheduledTime?: string,
  currentTime: Date = new Date(),
) => {
  if (!scheduledTime) return true;
  const scheduled = new Date(scheduledTime);
  const minTime = new Date(currentTime.getTime() + 15 * 60 * 1000); // 15 minutes from now
  return scheduled >= minTime;
};

type PricedOrderItem = {
  price: number;
  quantity: number;
};

export const validateOrderAmount = (
  items: PricedOrderItem[],
  minAmount: number = 0,
) => {
  const total = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  return total >= minAmount;
};

// Schema combinations for different endpoints
export const createOrderValidation = {
  body: createOrderSchema,
  params: z.object({}),
  query: z.object({}),
};

export const updateOrderValidation = {
  body: updateOrderSchema,
  params: orderIdParamSchema,
  query: z.object({}),
};

export const getOrdersValidation = {
  body: z.object({}),
  params: z.object({}),
  query: orderFilterSchema,
};

export const searchOrdersValidation = {
  body: z.object({}),
  params: z.object({}),
  query: orderSearchSchema,
};

export const getOrderValidation = {
  body: z.object({}),
  params: orderIdParamSchema,
  query: z.object({
    includeItems: z
      .string()
      .transform((s) => s === "true")
      .optional()
      .prefault("true"),
    includeCustomer: z
      .string()
      .transform((s) => s === "true")
      .optional()
      .prefault("false"),
    includeRestaurant: z
      .string()
      .transform((s) => s === "true")
      .optional()
      .prefault("false"),
  }),
};

// Export the schemas object and input types
export const orderSchemas = {
  createOrder: createOrderSchema,
  updateOrder: updateOrderSchema,
  updateOrderStatus: updateOrderStatusSchema,
  orderFilter: orderFilterSchema,
  orderFilters: orderFilterSchema, // Alias for compatibility
  couponPreview: previewCouponSchema,
  previewCoupon: previewCouponSchema, // Alias for compatibility
  bulkOrderOperation: bulkOrderOperationSchema,
  bulkOperation: bulkOrderOperationSchema, // Alias for compatibility
  orderStatsQuery: orderStatsQuerySchema,
  stats: orderStatsQuerySchema, // Alias for compatibility
  analytics: orderStatsQuerySchema, // Alias for compatibility
  popularItemsQuery: popularItemsQuerySchema,
  params: orderIdParamSchema, // For parameter validation
  export: exportOrdersSchema, // For export validation
  itemParams: orderItemPathParamSchema,
  addItems: addOrderItemsSchema,
  changeItemQuantity: changeOrderItemQuantitySchema,
  removeItemQuery: removeOrderItemQuerySchema,
  applyDiscount: applyOrderDiscountSchema,
};

// Export delivery-related schemas
export { deliveryInfoSchema, fulfillmentTypeSchema };

// Export input types for TypeScript
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
export type OrderFiltersInput = z.infer<typeof orderFilterSchema>;
export type CouponPreviewInput = z.infer<typeof previewCouponSchema>;
export type BulkOrderOperationInput = z.infer<typeof bulkOrderOperationSchema>;
export type AnalyticsQueryInput = z.infer<typeof orderStatsQuerySchema>;
export type StatsQueryInput = z.infer<typeof orderStatsQuerySchema>;
export type DeliveryInfoInput = z.infer<typeof deliveryInfoSchema>;
export type AddOrderItemsInput = z.infer<typeof addOrderItemsSchema>;
export type ChangeOrderItemQuantityInput = z.infer<
  typeof changeOrderItemQuantitySchema
>;
