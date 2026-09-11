/**
 * Tables Feature Validation Schemas
 *
 * Zod validation schemas for table management operations
 */

import { z } from "zod";
import { commonSchemas } from "../../../middleware/validation";

// Table features schema
export const tableFeaturesSchema = z.lazy(() =>
  z
    .object({
      hasChargingPort: z.boolean().optional(),
      hasWifi: z.boolean().optional(),
      isAccessible: z.boolean().optional(),
      hasView: z.boolean().optional(),
      isQuietZone: z.boolean().optional(),
      smokingAllowed: z.boolean().optional(),
    })
    .optional(),
);

// Create table schema
export const createTableSchema = z.lazy(() =>
  z
    .object({
      restaurantId: z.string(),
      number: z.string().min(1).max(50),
      name: z.string().min(1).max(50).optional(),
      capacity: z.number().int().positive(),
      location: z.string().max(100).optional(),
      floor: z.number().int().positive().optional().default(1),
      section: z.string().max(50).optional(),
      features: tableFeaturesSchema,
      isReservable: z.boolean().optional().default(true),
      qrMode: z.enum(["table", "seat"]).optional(),
      seatCount: z.number().int().nonnegative().max(100).optional(),
      seatNumberingStyle: z.enum(["numeric", "alphabetic"]).optional(),
    })
    .superRefine((data, ctx) => {
      if (data.qrMode !== "seat") return;

      if (data.seatCount === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["seatCount"],
          message: "Seat count is required in seat mode",
        });
        return;
      }

      if (data.seatCount === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["seatCount"],
          message: "Seat count must be greater than 0 in seat mode",
        });
        return;
      }

      if (data.seatCount > data.capacity) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["seatCount"],
          message: "Seat count cannot exceed table capacity",
        });
      }
    }),
);

// Update table schema
export const updateTableSchema = z.lazy(() =>
  z
    .object({
      number: z.string().min(1).max(50).optional(),
      name: z.string().min(1).max(50).optional(),
      capacity: z.number().int().positive().optional(),
      location: z.string().max(100).optional(),
      floor: z.number().int().positive().optional(),
      section: z.string().max(50).optional(),
      features: tableFeaturesSchema,
      isActive: z.boolean().optional(),
      isReservable: z.boolean().optional(),
      maintenanceNotes: z.string().max(500).optional(),
      qrMode: z.enum(["table", "seat"]).optional(),
      seatCount: z.number().int().nonnegative().max(100).optional(),
      seatNumberingStyle: z.enum(["numeric", "alphabetic"]).optional(),
    })
    .superRefine((data, ctx) => {
      if (
        data.qrMode === "seat" &&
        data.seatCount !== undefined &&
        data.capacity !== undefined &&
        data.seatCount > data.capacity
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["seatCount"],
          message: "Seat count cannot exceed table capacity",
        });
      }
    }),
);

// Table filters schema
export const tableFilterSchema = commonSchemas.paginationQuery.extend({
  restaurantId: z.string().optional(),
  floor: z.string().regex(/^\d+$/).transform(Number).optional(),
  section: z.string().optional(),
  isOccupied: z
    .string()
    .transform((val) => val === "true")
    .optional(),
  isActive: z
    .string()
    .transform((val) => val === "true")
    .optional(),
  isReservable: z
    .string()
    .transform((val) => val === "true")
    .optional(),
  minCapacity: z.string().regex(/^\d+$/).transform(Number).optional(),
  maxCapacity: z.string().regex(/^\d+$/).transform(Number).optional(),
});

// Table occupation schema
//
// `orderId` is optional: staff can mark a table occupied from the floor plan
// before any order exists (walk-in seated, table held). When it is absent the
// route skips order resolution and stores a null currentOrderId. A present
// orderId still has to identify a real order — 0 and "" are rejected rather
// than silently treated as "no order".
export const occupyTableSchema = z.lazy(() =>
  z.object({
    orderId: z
      .union([z.number().int().positive(), z.string().min(1)])
      .optional(),
    occupiedBy: z.string().max(100).optional(),
    estimatedMinutes: z.number().int().positive().optional(),
  }),
);

// Table cleaning schema
export const cleanTableSchema = z.lazy(() =>
  z.object({
    notes: z.string().max(200).optional(),
  }),
);

// QR code regeneration schema
export const regenerateQRSchema = z.lazy(() =>
  z.object({
    customData: z.any().optional(),
  }),
);

// QR code options schema
export const qrCodeOptionsSchema = z.lazy(() =>
  z
    .object({
      size: z.enum(["small", "medium", "large"]).default("medium"),
      format: z.enum(["png", "svg", "pdf"]).default("png"),
      includeTableInfo: z.boolean().default(true),
      customData: z.any().optional(),
    })
    .optional(),
);

// Bulk QR generation schema
export const generateQRBulkSchema = z.lazy(() =>
  z.object({
    restaurantId: z.string(),
    tableIds: z.array(z.number().int().positive()).min(1).max(50),
    options: qrCodeOptionsSchema,
  }),
);

// Available tables query schema
export const availableTablesQuerySchema = z.object({
  restaurantId: z.string(),
  capacity: z.string().regex(/^\d+$/).transform(Number).optional(),
});

// Table stats query schema
export const tableStatsQuerySchema = z.object({
  restaurantId: z.string(),
});

// QR code lookup schema
export const qrCodeParamSchema = z.lazy(() =>
  z.object({
    qrCode: z.string(),
  }),
);

// Common parameter schemas
export const idParamSchema = z.object({
  id: z.string().regex(/^\d+$/).transform(Number),
});

// Export all schemas as a grouped object for easier imports
export const tableSchemas = {
  // Creation and updates
  create: createTableSchema,
  update: updateTableSchema,

  // Filters and queries
  filters: tableFilterSchema,
  availableTables: availableTablesQuerySchema,
  stats: tableStatsQuerySchema,

  // Operations
  occupy: occupyTableSchema,
  clean: cleanTableSchema,
  regenerateQR: regenerateQRSchema,
  bulkQR: generateQRBulkSchema,

  // Parameters
  idParam: idParamSchema,
  qrCodeParam: qrCodeParamSchema,

  // Options
  qrOptions: qrCodeOptionsSchema,
  features: tableFeaturesSchema,
};

// Type exports for TypeScript inference
export type CreateTableInput = z.infer<typeof createTableSchema>;
export type UpdateTableInput = z.infer<typeof updateTableSchema>;
export type TableFilterInput = z.infer<typeof tableFilterSchema>;
export type OccupyTableInput = z.infer<typeof occupyTableSchema>;
export type CleanTableInput = z.infer<typeof cleanTableSchema>;
export type RegenerateQRInput = z.infer<typeof regenerateQRSchema>;
export type BulkQRInput = z.infer<typeof generateQRBulkSchema>;
export type AvailableTablesInput = z.infer<typeof availableTablesQuerySchema>;
export type TableStatsInput = z.infer<typeof tableStatsQuerySchema>;
export type QRCodeParamInput = z.infer<typeof qrCodeParamSchema>;
export type IdParamInput = z.infer<typeof idParamSchema>;
