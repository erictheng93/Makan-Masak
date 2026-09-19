/**
 * Customers API Response Contracts
 */

import { z } from "zod";
import { successEnvelope, PaginationSchema, TimestampFields } from "../helpers";
import { OrderSchema } from "./orders";

// ---------------------------------------------------------------------------
// Entity Schemas
// ---------------------------------------------------------------------------

export const CustomerSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    username: z.string().optional(),
    fullName: z.string().optional(),
    name: z.string().optional(),
    email: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    role: z.number().optional(),
    preferences: z.unknown().optional().nullable(),
    loyaltyPoints: z.number().optional(),
    totalOrders: z.number().optional(),
    totalSpent: z.number().optional(),
    ...TimestampFields,
  })
  .loose();

// ---------------------------------------------------------------------------
// Response Contracts
// ---------------------------------------------------------------------------

export const GetMeResponse = successEnvelope(CustomerSchema);

export const GetMyOrdersResponse = z.object({
  success: z.literal(true),
  // A bare array under `data`, with `pagination` beside it — not nested.
  data: z.array(OrderSchema),
  pagination: PaginationSchema.optional(),
});

export const RegisterCustomerResponse = z.object({
  success: z.literal(true),
  data: CustomerSchema,
  token: z.string().optional(),
});

export const ListCustomersResponse = z.object({
  success: z.literal(true),
  data: z.array(CustomerSchema),
  meta: z
    .object({
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      totalPages: z.number(),
    })
    .optional(),
});

export const LoyaltyTransactionResponse = successEnvelope(z.unknown());
