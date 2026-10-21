/**
 * Coupons API Response Contracts
 */

import { z } from "zod";
import {
  successEnvelope,
  successWithMessage,
  messageOnlyResponse,
  TimestampFields,
} from "../helpers";

// ---------------------------------------------------------------------------
// Entity Schemas
// ---------------------------------------------------------------------------

export const CouponSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    restaurantId: z.string().optional(),
    code: z.string(),
    description: z.string().optional().nullable(),
    discountType: z.string().optional(),
    discountValue: z.number().optional(),
    minOrderAmount: z.number().optional().nullable(),
    maxDiscount: z.number().optional().nullable(),
    usageLimit: z.number().optional().nullable(),
    usedCount: z.number().optional(),
    // Slots in usedCount held by unpaid checkouts; paid uses = the difference.
    reservedCount: z.number().optional(),
    isActive: z.union([z.boolean(), z.number()]).optional(),
    validFrom: z
      .union([z.string(), z.number(), z.date()])
      .optional()
      .nullable(),
    validUntil: z
      .union([z.string(), z.number(), z.date()])
      .optional()
      .nullable(),
    ...TimestampFields,
  })
  .loose();

// ---------------------------------------------------------------------------
// Response Contracts
// ---------------------------------------------------------------------------

export const ValidateCouponResponse = successEnvelope(z.unknown());

export const ListCouponsResponse = z.object({
  success: z.literal(true),
  data: z.array(CouponSchema),
  pagination: z
    .object({
      total: z.number(),
      page: z.number(),
      limit: z.number(),
      pages: z.number().optional(),
    })
    .optional(),
});

export const GetCouponResponse = successEnvelope(CouponSchema);
export const CreateCouponResponse = successEnvelope(CouponSchema);
export const UpdateCouponResponse = successEnvelope(CouponSchema);
export const DeactivateCouponResponse = successWithMessage(CouponSchema);
export const DeleteCouponResponse = messageOnlyResponse;

export const CouponStatsResponse = successEnvelope(z.unknown());
export const CouponTrendsResponse = successEnvelope(z.unknown());
export const UseCouponResponse = successEnvelope(z.unknown());

export const BulkCouponResponse = z.object({
  success: z.literal(true),
  data: z
    .object({
      success: z.unknown().optional(),
      failed: z.unknown().optional(),
    })
    .loose(),
  message: z.string().optional(),
});
