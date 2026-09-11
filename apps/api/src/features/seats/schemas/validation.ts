/**
 * Seats Validation Schemas
 * Zod schemas for request validation
 */

import { z } from "zod";
import {
  boundedLimitQuery,
  boundedPageQuery,
} from "../../../middleware/validation";

// Batch create seats schema
export const batchCreateSeatsSchema = z.lazy(() =>
  z
    .object({
      tableId: z.number().int().positive(),
      seatCount: z.number().int().positive().min(1).max(100),
      numberingStyle: z
        .enum(["numeric", "alphabetic", "custom"])
        .optional()
        .default("numeric"),
      customNumbers: z.array(z.string().trim().min(1).max(50)).optional(),
      prefix: z.string().max(10).optional(),
    })
    .superRefine((data, ctx) => {
      if (data.numberingStyle !== "custom") return;

      if (data.customNumbers?.length !== data.seatCount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["customNumbers"],
          message: "Provide one custom number per seat",
        });
        return;
      }

      if (new Set(data.customNumbers).size !== data.customNumbers.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["customNumbers"],
          message: "Custom seat numbers must be unique",
        });
      }
    }),
);

// Update seat schema
export const updateSeatSchema = z.lazy(() =>
  z.object({
    seatNumber: z.string().min(1).max(50).optional(),
    seatName: z.string().min(1).max(100).optional(),
    position: z.string().max(200).optional(),
    isActive: z.boolean().optional(),
  }),
);

// Occupy seat schema
export const occupySeatSchema = z.lazy(() =>
  z.object({
    orderId: z.string().trim().min(1),
    occupiedBy: z.string().max(100).optional(),
  }),
);

// Seat filter schema (query params)
export const seatFilterSchema = z.lazy(() =>
  z.object({
    tableId: z.string().regex(/^\d+$/).transform(Number),
    isOccupied: z
      .string()
      .transform((val) => val === "true")
      .optional(),
    isActive: z
      .string()
      .transform((val) => val === "true")
      .optional(),
    seatNumbers: z
      .string()
      .transform((val) => val.split(",").filter(Boolean))
      .optional(),
    page: boundedPageQuery(),
    limit: boundedLimitQuery("50"),
  }),
);

// ID param schema
export const idParamSchema = z.object({
  id: z.string().regex(/^\d+$/),
});

// Table ID param schema
export const tableIdParamSchema = z.lazy(() =>
  z.object({
    tableId: z.string().regex(/^\d+$/).transform(Number),
  }),
);

// QR code param schema
export const qrCodeParamSchema = z.lazy(() =>
  z.object({
    qrCode: z.string(),
  }),
);

// Table ID query schema
export const tableIdQuerySchema = z.lazy(() =>
  z.object({
    tableId: z.string().regex(/^\d+$/).transform(Number),
  }),
);

// Batch regenerate QR schema
export const batchRegenerateQRSchema = z.lazy(() =>
  z.object({
    tableId: z.number().int().positive(),
  }),
);

// Export schema types
export type BatchCreateSeatsInput = z.infer<typeof batchCreateSeatsSchema>;
export type UpdateSeatInput = z.infer<typeof updateSeatSchema>;
export type OccupySeatInput = z.infer<typeof occupySeatSchema>;
export type SeatFilterInput = z.infer<typeof seatFilterSchema>;
export type TableIdParamInput = z.infer<typeof tableIdParamSchema>;
export type QrCodeParamInput = z.infer<typeof qrCodeParamSchema>;
export type TableIdQueryInput = z.infer<typeof tableIdQuerySchema>;
export type BatchRegenerateQRInput = z.infer<typeof batchRegenerateQRSchema>;
