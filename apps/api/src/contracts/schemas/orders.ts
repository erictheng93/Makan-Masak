/**
 * Orders API Response Contracts
 *
 * Defines the STABLE response shapes for order endpoints.
 * Customer app and admin dashboard depend on these shapes.
 */

import { ORDER_STATUSES } from "@makanmasak/shared-types";
import { z } from "zod";
import {
  successEnvelope,
  messageOnlyResponse,
  PaginationSchema,
  TimestampFields,
} from "../helpers";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const OrderStatusEnum = z.enum(ORDER_STATUSES);

export const PaymentStatusEnum = z.enum(["pending", "paid", "failed"]);

export const OrderTypeEnum = z.enum(["shop", "table", "seat"]);

// ---------------------------------------------------------------------------
// Entity Schemas
// ---------------------------------------------------------------------------

export const OrderItemSchema = z.object({
  id: z.union([z.number(), z.string()]),
  orderId: z.union([z.number(), z.string()]),
  menuItemId: z.union([z.number(), z.string()]),
  name: z.string().optional(),
  description: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  quantity: z.number().int().positive(),
  unitPrice: z.number(),
  totalPrice: z.number(),
  customizations: z.unknown().optional().nullable(),
  itemSnapshot: z
    .object({
      name: z.string(),
      description: z.string().optional(),
      imageUrl: z.string().optional(),
      category: z.string().optional(),
      price: z.number().optional(),
      unitPrice: z.number().optional(),
      customizations: z.unknown().optional(),
    })
    .optional()
    .nullable(),
  notes: z.string().optional().nullable(),
  status: z.string().optional(),
  ...TimestampFields,
});

export const OrderSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    restaurantId: z.string(),
    tableId: z.union([z.number(), z.string()]).optional().nullable(),
    seatId: z.union([z.number(), z.string()]).optional().nullable(),
    customerId: z.union([z.number(), z.string()]).optional().nullable(),
    userId: z.union([z.number(), z.string()]).optional().nullable(),
    orderNumber: z.string().optional(),
    status: z.string(),
    paymentStatus: z.string().optional(),
    orderType: z.string().optional(),
    subtotal: z.number().optional(),
    tax: z.number().optional(),
    serviceCharge: z.number().optional(),
    discount: z.number().optional(),
    totalAmount: z.number(),
    // The restaurant's currency, present when the order is read with its
    // restaurant (history, detail). Lists spanning restaurants format by it.
    currency: z.enum(["TWD", "MYR", "VND"]).optional(),
    notes: z.string().optional().nullable(),
    items: z.array(OrderItemSchema).optional(),
    ...TimestampFields,
  })
  .loose();

// ---------------------------------------------------------------------------
// Response Contracts
// ---------------------------------------------------------------------------

export const CreateOrderResponse = z.object({
  success: z.literal(true),
  data: OrderSchema,
});

export const GuestOrderResponse = z.object({
  success: z.literal(true),
  data: OrderSchema,
  guestToken: z.string().optional(),
});

export const GetOrderResponse = successEnvelope(OrderSchema);

export const ListOrdersResponse = z.object({
  success: z.literal(true),
  data: z.array(OrderSchema),
  pagination: PaginationSchema.optional(),
});

export const UpdateOrderStatusResponse = successEnvelope(OrderSchema);

export const CancelOrderResponse = messageOnlyResponse;

export const OrderStatsResponse = successEnvelope(
  z
    .object({
      totalOrders: z.number(),
      totalRevenue: z.number(),
      averageOrderValue: z.number(),
    })
    .loose(),
);

export const OrderReceiptResponse = successEnvelope(
  z
    .object({
      orderId: z.union([z.number(), z.string()]),
      orderNumber: z.string().optional(),
      items: z.array(
        z
          .object({
            name: z.string(),
            quantity: z.number(),
            price: z.number(),
          })
          .loose(),
      ),
      totalAmount: z.number(),
    })
    .loose(),
);

export const CouponPreviewResponse = successEnvelope(
  z
    .object({
      valid: z.boolean().optional(),
      discount: z.number().optional(),
    })
    .loose(),
);
