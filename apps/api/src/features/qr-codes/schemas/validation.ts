/**
 * QR Codes Validation Schemas
 * Zod schemas for validating QR codes API requests
 */

import { z } from "zod";
import { VALIDATION_LIMITS } from "../../../shared/constants";

// QR Style validation schema
const qrStyleSchema = z.lazy(() =>
  z.object({
    backgroundColor: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .optional(),
    foregroundColor: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .optional(),
    size: z.number().int().min(100).max(1000).optional(),
    errorCorrection: z.enum(["L", "M", "Q", "H"]).optional(),
    cornerStyle: z.enum(["square", "rounded", "circle"]).optional(),
    dotStyle: z.enum(["square", "rounded", "circle"]).optional(),
    gradientType: z.enum(["none", "linear", "radial"]).optional(),
    gradientColors: z
      .object({
        start: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
        end: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
        direction: z.number().min(0).max(360).optional(),
      })
      .optional(),
    logo: z
      .object({
        url: z.string().url(),
        size: z.number().min(0).max(30),
        borderRadius: z.number().min(0).max(50),
        margin: z.number().min(0).max(20),
      })
      .optional(),
    border: z
      .object({
        width: z.number().min(0).max(20),
        color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
        style: z.enum(["solid", "dashed", "dotted"]),
      })
      .optional(),
    shadow: z
      .object({
        enabled: z.boolean(),
        color: z.string().regex(/^#[0-9A-Fa-f]{8}$/),
        blur: z.number().min(0).max(50),
        offsetX: z.number().min(-50).max(50),
        offsetY: z.number().min(-50).max(50),
      })
      .optional(),
  }),
);

// Common parameter schema
const idParam = z.object({
  id: z
    .string()
    .transform(Number)
    .refine((val) => Number.isInteger(val) && val > 0, {
      message: "ID must be a positive integer",
    }),
});

const qrCodeIdParam = z.lazy(() =>
  z.object({
    id: z.string().min(1, "QR code ID is required"),
  }),
);

const batchIdParam = z.lazy(() =>
  z.object({
    batchId: z.string().min(1, "Batch ID is required"),
  }),
);

const shopQrCodeParam = z.lazy(() =>
  z.object({
    qrCode: z
      .string()
      .min(1, "QR code is required")
      // Two formats coexist:
      //   - Seeded short codes:    SHOP-GRANDMA-001
      //   - Generated UUID codes:  SHOP-019469a0-0001-7000-8000-000000000001-1775000000
      // Allow alphanumerics + dashes throughout, with a SHOP- prefix.
      .regex(/^SHOP-[A-Za-z0-9-]+$/, "Invalid shop QR code format"),
  }),
);

const signedQrEntityParam = z.lazy(() =>
  z.object({
    entityId: z.coerce.number().int().positive(),
  }),
);

const signedQrQuery = z.lazy(() =>
  z.object({
    qrCode: z.string().url().max(4096),
  }),
);

// QR Generation schemas
const generateQRSchema = z.object({
  content: z
    .string()
    .min(1, "Content is required")
    .max(2000, "Content must be less than 2000 characters"),
  format: z.enum(["png", "svg", "pdf", "jpeg"]).default("png"),
  style: qrStyleSchema.optional(),
  metadata: z
    .object({
      title: z.string().max(VALIDATION_LIMITS.NAME_MAX_LENGTH).optional(),
      description: z
        .string()
        .max(VALIDATION_LIMITS.DESCRIPTION_MAX_LENGTH)
        .optional(),
      createdBy: z.string().max(VALIDATION_LIMITS.NAME_MAX_LENGTH).optional(),
      version: z.string().max(50).optional(),
    })
    .optional(),
});

// Bulk QR Generation schema
const bulkQRSchema = z.lazy(() =>
  z.object({
    tables: z
      .array(
        z.object({
          id: z.number().int().positive(),
          name: z.string().min(1).max(VALIDATION_LIMITS.NAME_MAX_LENGTH),
          content: z.string().min(1).max(2000),
          customStyle: qrStyleSchema.optional(),
        }),
      )
      .min(1, "At least one table is required")
      .max(100, "Maximum 100 tables allowed"),
    defaultStyle: qrStyleSchema.optional(),
    format: z.enum(["png", "svg", "pdf", "zip"]).default("zip"),
    includeMetadata: z.boolean().default(true),
    pdfSettings: z
      .object({
        layout: z.enum(["grid", "list"]).default("grid"),
        itemsPerPage: z.number().int().min(1).max(50).default(12),
        pageSize: z.enum(["A4", "A3", "Letter"]).default("A4"),
        includeTableInfo: z.boolean().default(true),
      })
      .optional(),
  }),
);

// Template schemas
const createTemplateSchema = z.object({
  name: z
    .string()
    .min(1, "Template name is required")
    .max(
      VALIDATION_LIMITS.NAME_MAX_LENGTH,
      `Name must be less than ${VALIDATION_LIMITS.NAME_MAX_LENGTH} characters`,
    ),
  description: z
    .string()
    .min(1, "Description is required")
    .max(
      VALIDATION_LIMITS.DESCRIPTION_MAX_LENGTH,
      `Description must be less than ${VALIDATION_LIMITS.DESCRIPTION_MAX_LENGTH} characters`,
    ),
  category: z.enum(["modern", "classic", "colorful", "minimalist", "branded"], {
    error: "Category is required",
  }),
  style: qrStyleSchema.refine((style) => style !== undefined, {
    message: "Style configuration is required",
  }),
});

const updateTemplateSchema = createTemplateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

// List query parameters
const listTemplatesQuery = z.object({
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
  category: z
    .enum(["modern", "classic", "colorful", "minimalist", "branded"])
    .optional(),
  search: z.string().max(VALIDATION_LIMITS.NAME_MAX_LENGTH).optional(),
  isActive: z
    .string()
    .transform((val) => val === "true")
    .optional(),
});

// Statistics query parameters
const statsQuery = z.object({
  restaurantId: z
    .string()
    .transform(Number)
    .refine((val) => Number.isInteger(val) && val > 0, {
      message: "Restaurant ID must be a positive integer",
    })
    .optional(),
  period: z.enum(["day", "week", "month", "year"]).default("month"),
  startDate: z.iso.datetime().optional(),
  endDate: z.iso.datetime().optional(),
});

export const qrCodeSchemas = {
  // Parameters
  params: idParam,
  qrCodeParams: qrCodeIdParam,
  batchParams: batchIdParam,
  shopQrCode: shopQrCodeParam,
  signedQrEntity: signedQrEntityParam,
  signedQrQuery,

  // QR Generation
  generate: generateQRSchema,
  bulk: bulkQRSchema,

  // Templates
  createTemplate: createTemplateSchema,
  updateTemplate: updateTemplateSchema,
  listTemplates: listTemplatesQuery,

  // Statistics
  stats: statsQuery,

  // Style schema (for reuse)
  style: qrStyleSchema,
} as const;

export type QRCodeIdParamInput = z.infer<typeof qrCodeIdParam>;
export type QRTemplateIdParamInput = z.infer<typeof idParam>;
export type QRCodeBatchParamInput = z.infer<typeof batchIdParam>;
export type ShopQrCodeParamInput = z.infer<typeof shopQrCodeParam>;
export type SignedQrEntityParamInput = z.infer<typeof signedQrEntityParam>;
export type SignedQrQueryInput = z.infer<typeof signedQrQuery>;
export type GenerateQRInput = z.infer<typeof generateQRSchema>;
export type BulkQRInput = z.infer<typeof bulkQRSchema>;
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
export type ListTemplatesInput = z.infer<typeof listTemplatesQuery>;
export type QRStatsInput = z.infer<typeof statsQuery>;
