/**
 * Restaurants Validation Schemas
 * Zod schemas for validating restaurants API requests
 */

import { z } from "zod";
import {
  RESTAURANT_SERVICE_TYPES,
  SUPPORTED_BUSINESS_TIMEZONES,
} from "@makanmasak/database";
import { VALIDATION_LIMITS } from "../../../shared/constants";
import { httpUrlSchema } from "../../../shared/utils/url";

const decodeHtmlEntities = (value: string): string =>
  value
    // Decode &amp; LAST so a literal `&amp;lt;` round-trips to `&lt;`, not `<`
    // (decoding it first would re-expose escaped markup — a sanitizer bypass).
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#x60;/g, "`")
    .replace(/&#x3D;/g, "=")
    .replace(/&amp;/g, "&");

const sanitizeFreeText = (value: string): string =>
  decodeHtmlEntities(value).replace(/[<>"`=]/g, "");

const contactUrlSchema = z.lazy(() =>
  z.string().transform(decodeHtmlEntities).pipe(httpUrlSchema),
);

// Business hours validation schema
const businessHoursSchema = z.lazy(() =>
  z
    .record(
      z.string(),
      z.object({
        open: z
          .string()
          .regex(
            /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/,
            "Invalid time format (HH:MM)",
          ),
        close: z
          .string()
          .regex(
            /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/,
            "Invalid time format (HH:MM)",
          ),
        isOpen: z.boolean(),
      }),
    )
    .optional(),
);

// Restaurant settings validation schema
const restaurantSettingsSchema = z.lazy(() =>
  z
    .object({
      allowOnlineOrdering: z.boolean().optional(),
      allowGuestOrders: z.boolean().optional(),
      requireAdvanceBooking: z.boolean().optional(),
      deliveryAvailable: z.boolean().optional(),
      pickupAvailable: z.boolean().optional(),
      minOrderAmount: z.number().min(0).optional(),
      maxOrdersPerHour: z.number().int().min(1).optional(),
      autoAcceptOrders: z.boolean().optional(),
      currency: z.string().length(3).optional(), // ISO currency codes are 3 characters
      // Fulfillment settings
      enableDineIn: z.boolean().optional(),
      enableTakeaway: z.boolean().optional(),
      enableDelivery: z.boolean().optional(),
      deliveryFee: z.number().min(0).optional(),
      estimatedPrepTimeMin: z.number().int().min(1).optional(),
      estimatedPrepTimeMax: z.number().int().min(1).optional(),
    })
    .loose(),
); // Allow additional properties

const messagingChannelsSchema = z.lazy(() =>
  z
    .object({
      line: contactUrlSchema.optional(),
      whatsapp: contactUrlSchema.optional(),
      instagram: contactUrlSchema.optional(),
      telegram: contactUrlSchema.optional(),
    })
    .strict(),
);

const restaurantFaqInputSchema = z.lazy(() =>
  z.object({
    question: z
      .string()
      .min(1, "Question is required")
      .max(200)
      .transform(sanitizeFreeText),
    answer: z
      .string()
      .min(1, "Answer is required")
      .max(1000)
      .transform(sanitizeFreeText),
    keywords: z
      .array(z.string().min(1).max(50).transform(sanitizeFreeText))
      .max(20)
      .optional(),
    displayOrder: z.number().int().min(0).max(1000).optional(),
    isActive: z.boolean().optional(),
  }),
);

const updateContactProfileSchema = z.lazy(() =>
  z.object({
    messagingChannels: messagingChannelsSchema.optional().default({}),
    faqs: z.array(restaurantFaqInputSchema).max(50).optional().default([]),
  }),
);

/**
 * Field shape without creation defaults.
 *
 * The update schema partial()s this rather than the create schema. Zod 4's
 * .partial() does NOT strip .default(), so partialling a schema carrying
 * defaults makes those fields materialise on an absent key. updateServiceItem
 * writes every present key, so that silently overwrote serviceType and
 * requiresBooking on partial updates, and it also defeated the
 * "at least one field" refine below (an empty body was never empty).
 */
const restaurantServiceItemShapeSchema = z.object({
  name: z
    .string()
    .min(1, "Service name is required")
    .max(100)
    .transform(sanitizeFreeText),
  description: z
    .string()
    .max(1000)
    .transform(sanitizeFreeText)
    .nullable()
    .optional(),
  serviceType: z.enum(RESTAURANT_SERVICE_TYPES).optional(),
  priceCents: z.number().int().min(0).nullable().optional(),
  priceLabel: z
    .string()
    .max(80)
    .transform(sanitizeFreeText)
    .nullable()
    .optional(),
  durationMinutes: z.number().int().min(1).max(1440).nullable().optional(),
  requiresBooking: z.boolean().optional(),
  bookingUrl: httpUrlSchema.nullable().optional(),
  availableHours: z
    .object({
      start: z.string().optional(),
      end: z.string().optional(),
      days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    })
    .nullable()
    .optional(),
  tags: z
    .array(z.string().min(1).max(50).transform(sanitizeFreeText))
    .max(20)
    .optional(),
  keywords: z
    .string()
    .max(500)
    .transform(sanitizeFreeText)
    .nullable()
    .optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  isActive: z.boolean().optional(),
  isPublic: z.boolean().optional(),
});

const restaurantServiceItemInputSchema = z.lazy(() =>
  restaurantServiceItemShapeSchema.extend({
    serviceType: z.enum(RESTAURANT_SERVICE_TYPES).optional().default("general"),
    requiresBooking: z.boolean().optional().default(false),
  }),
);

const updateRestaurantServiceItemSchema = z.lazy(() =>
  restaurantServiceItemShapeSchema
    .partial()
    .refine((value) => Object.keys(value).length > 0, {
      message: "At least one field is required",
    }),
);

// Common parameter schemas
const idParam = z.object({
  id: z.string().min(1, "ID is required"),
});

const serviceItemParam = z.lazy(() =>
  idParam.extend({
    serviceItemId: z.coerce.number().int().min(1),
  }),
);

const tableValidationParam = z.lazy(() =>
  idParam.extend({
    tableId: z.coerce.number().int().min(1),
  }),
);

const districtParam = z.lazy(() =>
  z.object({
    district: z.string().min(1, "District is required"),
  }),
);

// Restaurant creation schema
const createRestaurantSchema = z.object({
  name: z
    .string()
    .min(1, "Restaurant name is required")
    .max(
      VALIDATION_LIMITS.NAME_MAX_LENGTH,
      `Name must be less than ${VALIDATION_LIMITS.NAME_MAX_LENGTH} characters`,
    ),
  type: z
    .string()
    .min(1, "Restaurant type is required")
    .max(50, "Type must be less than 50 characters"),
  category: z
    .string()
    .min(1, "Category is required")
    .max(50, "Category must be less than 50 characters"),
  description: z
    .string()
    .max(
      VALIDATION_LIMITS.DESCRIPTION_MAX_LENGTH,
      `Description must be less than ${VALIDATION_LIMITS.DESCRIPTION_MAX_LENGTH} characters`,
    )
    .optional(),
  address: z
    .string()
    .min(1, "Address is required")
    .max(200, "Address must be less than 200 characters"),
  district: z
    .string()
    .min(1, "District is required")
    .max(50, "District must be less than 50 characters"),
  city: z.string().max(50, "City must be less than 50 characters").optional(),
  phone: z
    .string()
    .min(8, "Phone number must be at least 8 characters")
    .max(
      VALIDATION_LIMITS.PHONE_MAX_LENGTH,
      `Phone number must be less than ${VALIDATION_LIMITS.PHONE_MAX_LENGTH} characters`,
    )
    .regex(/^[\d\s\-+()]+$/, "Invalid phone number format"),
  email: z
    .email("Invalid email format")
    .max(
      VALIDATION_LIMITS.EMAIL_MAX_LENGTH,
      `Email must be less than ${VALIDATION_LIMITS.EMAIL_MAX_LENGTH} characters`,
    )
    .optional(),
  website: z.string().url("Invalid website URL").optional(),
  businessHours: businessHoursSchema,
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  logoUrl: z.string().url("Invalid logo URL").optional(),
  bannerUrl: z.string().url("Invalid banner URL").optional(),
});

// Restaurant update schema (all fields optional except validation rules still apply)
const updateRestaurantSchema = z.lazy(() =>
  createRestaurantSchema.partial().extend({
    isAvailable: z.boolean().optional(),
    isActive: z.boolean().optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    supportsTakeaway: z.boolean().optional(),
    supportsDelivery: z.boolean().optional(),
    settings: restaurantSettingsSchema.optional(),

    // A column of its own, not a `settings` key (#329): every business-day
    // bucket derives its SQL offset from it. An enum rather than a free string
    // because only fixed-offset zones can be expressed as a SQLite modifier --
    // accepting `America/New_York` here would store a boundary the report layer
    // then silently ignores, which is the shape of the bug this replaces.
    timezone: z.enum(SUPPORTED_BUSINESS_TIMEZONES).optional(),
  }),
);

// Restaurant list query parameters
const restaurantFilterSchema = z.lazy(() =>
  z.object({
    page: z
      .string()
      .transform(Number)
      .refine((val) => Number.isInteger(val) && val > 0, {
        message: "Page must be a positive integer",
      })
      .optional(),
    limit: z
      .string()
      .transform(Number)
      .refine((val) => Number.isInteger(val) && val > 0 && val <= 100, {
        message: "Limit must be a positive integer up to 100",
      })
      .optional(),
    type: z
      .string()
      .max(50, "Type filter must be less than 50 characters")
      .optional(),
    district: z
      .string()
      .max(50, "District filter must be less than 50 characters")
      .optional(),
    isAvailable: z
      .string()
      .transform((val) => val === "true")
      .optional(),
  }),
);

// Nearby restaurants query parameters
const nearbyQuerySchema = z.lazy(() =>
  z.object({
    limit: z
      .string()
      .regex(/^\d+$/, "Limit must be a number")
      .transform(Number)
      .refine((val) => val > 0 && val <= 50, {
        message: "Limit must be between 1 and 50",
      })
      .prefault("10"),
  }),
);

// Popular restaurants query parameters
const popularQuerySchema = z.lazy(() =>
  z.object({
    limit: z
      .string()
      .regex(/^\d+$/, "Limit must be a number")
      .transform(Number)
      .refine((val) => val > 0 && val <= 50, {
        message: "Limit must be between 1 and 50",
      })
      .prefault("10"),
  }),
);

// Shop QR Code validation schemas
const shopQrSettingsSchema = z.lazy(() =>
  z.object({
    displayName: z
      .string()
      .min(1, "Display name is required")
      .max(100, "Display name must be less than 100 characters")
      .optional(),
    instructions: z
      .string()
      .max(500, "Instructions must be less than 500 characters")
      .optional(),
  }),
);

const updateShopModeSchema = z.lazy(() =>
  z.object({
    enabled: z.boolean(),
    settings: shopQrSettingsSchema.optional(),
  }),
);

const uploadQrImageSchema = z.lazy(() =>
  z.object({
    imageUrl: z
      .string()
      .url("Invalid image URL")
      .min(1, "Image URL is required"),
  }),
);

const qrCodeParam = z.lazy(() =>
  z.object({
    qrCode: z
      .string()
      .min(1, "QR code is required")
      .regex(/^SHOP-[A-Za-z0-9-]+$/, "Invalid shop QR code format"),
  }),
);

export const restaurantSchemas = {
  // Parameters
  params: idParam,
  serviceItemParams: serviceItemParam,
  tableValidationParams: tableValidationParam,
  districtParams: districtParam,
  qrCodeParams: qrCodeParam,

  // Restaurant operations
  create: createRestaurantSchema,
  update: updateRestaurantSchema,

  // Query parameters
  list: restaurantFilterSchema,
  nearby: nearbyQuerySchema,
  popular: popularQuerySchema,

  // Shop QR Code operations
  updateShopMode: updateShopModeSchema,
  uploadQrImage: uploadQrImageSchema,
  shopQrSettings: shopQrSettingsSchema,
  updateContactProfile: updateContactProfileSchema,
  createServiceItem: restaurantServiceItemInputSchema,
  updateServiceItem: updateRestaurantServiceItemSchema,

  // Component schemas (for reuse)
  businessHours: businessHoursSchema,
  settings: restaurantSettingsSchema,
  messagingChannels: messagingChannelsSchema,
} as const;
