/**
 * Restaurants API Response Contracts
 *
 * Defines the STABLE response shapes for restaurant endpoints.
 */

import { z } from "zod";
import {
  successEnvelope,
  messageOnlyResponse,
  PaginationSchema,
  TimestampFields,
} from "../helpers";

// ---------------------------------------------------------------------------
// Entity Schemas
// ---------------------------------------------------------------------------

export const OperatingHoursSchema = z.object({
  day: z.number().int().min(0).max(6),
  open: z.string(),
  close: z.string(),
  closed: z.boolean().optional(),
});

export const RestaurantSettingsSchema = z
  .object({
    enableQROrdering: z.boolean().optional(),
    enableTableService: z.boolean().optional(),
    enableShopQR: z.boolean().optional(),
    autoAcceptOrders: z.boolean().optional(),
    orderTimeout: z.number().optional(),
    enableLoyaltyProgram: z.boolean().optional(),
    taxRate: z.number().optional(),
    serviceCharge: z.number().optional(),
    currency: z.enum(["TWD", "MYR", "VND"]).optional(),
  })
  .loose();

export const RestaurantSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    name: z.string(),
    description: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    email: z.string().optional().nullable(),
    logoUrl: z.string().optional().nullable(),
    coverImageUrl: z.string().optional().nullable(),
    operatingHours: z.unknown().optional().nullable(),
    settings: z.unknown().optional().nullable(),
    // Business-day boundary, moved out of `settings` in #329.
    timezone: z.string().optional(),
    ownerId: z.union([z.number(), z.string()]).optional(),
    isActive: z.union([z.boolean(), z.number()]).optional(),
    ...TimestampFields,
  })
  .loose();

export const RestaurantStatsSchema = z
  .object({
    totalOrders: z.number().optional(),
    totalRevenue: z.number().optional(),
    averageOrderValue: z.number().optional(),
    totalCustomers: z.number().optional(),
  })
  .loose();

export const ShopQRCodeSchema = z
  .object({
    id: z.union([z.number(), z.string()]).optional(),
    restaurantId: z.string().optional(),
    qrCode: z.string().optional(),
    qrCodeUrl: z.string().optional(),
    shortUrl: z.string().optional().nullable(),
    isActive: z.union([z.boolean(), z.number()]).optional(),
    ...TimestampFields,
  })
  .loose();

// ---------------------------------------------------------------------------
// Response Contracts
// ---------------------------------------------------------------------------

export const ListRestaurantsResponse = z.object({
  success: z.literal(true),
  data: z.array(RestaurantSchema),
  pagination: PaginationSchema.optional(),
});

export const GetRestaurantResponse = successEnvelope(RestaurantSchema);

export const CreateRestaurantResponse = successEnvelope(RestaurantSchema);

export const UpdateRestaurantResponse = successEnvelope(RestaurantSchema);

export const DeleteRestaurantResponse = messageOnlyResponse;

export const GetRestaurantStatsResponse = successEnvelope(
  RestaurantStatsSchema,
);

export const GenerateShopQRResponse = successEnvelope(ShopQRCodeSchema);

export const GetShopQRResponse = successEnvelope(ShopQRCodeSchema);

export const UpdateSettingsResponse = successEnvelope(RestaurantSettingsSchema);
