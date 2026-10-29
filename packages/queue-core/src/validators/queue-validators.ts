/**
 * Queue Validation Schemas
 *
 * This module contains all Zod validation schemas for queue operations.
 */

import { z } from "zod";
import { QueueType, NotificationType, QueueStatus } from "../types/queue";

// Re-export types for convenience
export { QueueType, NotificationType, QueueStatus };

// Enum Validators
export const queueTypeSchema = z.nativeEnum(QueueType);
export const notificationTypeSchema = z.nativeEnum(NotificationType);
export const queueStatusSchema = z.nativeEnum(QueueStatus);

// Basic Field Validators
export const restaurantIdSchema = z.number().int().positive();
export const userIdSchema = z.number().int().positive();
export const queueIdSchema = z.uuid();
export const partySizeSchema = z.number().int().min(1).max(20);
export const queueNumberSchema = z.number().int().min(1);
export const customerNameSchema = z.string().min(1).max(100).trim();
export const customerPhoneSchema = z.string().max(20).optional();
export const customerEmailSchema = z.email().optional();
export const specialRequestsSchema = z.string().max(500).optional();
export const checkInCodeSchema = z.string().length(6).optional();

// Request Validators
export const joinQueueSchema = z.object({
  restaurantId: restaurantIdSchema,
  customerName: customerNameSchema,
  customerPhone: customerPhoneSchema,
  customerEmail: customerEmailSchema,
  partySize: partySizeSchema,
  specialRequests: specialRequestsSchema,
  queueType: queueTypeSchema.optional().default(QueueType.ONLINE),
  tablePreferences: z.array(z.number().int().positive()).optional().default([]),
  notificationMethods: z
    .array(notificationTypeSchema)
    .optional()
    .default([NotificationType.SMS]),
});

export const callNextSchema = z.object({
  restaurantId: restaurantIdSchema,
  tableId: z.number().int().positive().optional(),
  specificQueueId: queueIdSchema.optional(),
});

export const seatCustomerSchema = z.object({
  queueId: queueIdSchema,
  tableId: z.number().int().positive(),
  operatorId: userIdSchema,
});

export const cancelQueueSchema = z.object({
  queueId: queueIdSchema,
  reason: z.string().max(200).optional(),
  checkInCode: checkInCodeSchema,
  cancelledBy: userIdSchema.optional(),
});

export const updateQueueSettingsSchema = z.object({
  isEnabled: z.boolean().optional(),
  maxQueueSize: z.number().int().min(1).max(200).optional(),
  avgServiceTime: z.number().int().min(15).max(480).optional(),
  maxWaitTime: z.number().int().min(30).max(600).optional(),
  minAdvanceNotice: z.number().int().min(1).max(60).optional(),
  notificationMethods: z.array(notificationTypeSchema).optional(),
  autoCallEnabled: z.boolean().optional(),
  autoCallInterval: z.number().int().min(1).max(60).optional(),
  noShowTimeout: z.number().int().min(5).max(60).optional(),
  queueNumberReset: z.enum(["daily", "weekly", "monthly", "never"]).optional(),
});

export const getQueueHistorySchema = z.object({
  restaurantId: restaurantIdSchema,
  status: queueStatusSchema.optional(),
  dateFrom: z.iso.datetime().optional(),
  dateTo: z.iso.datetime().optional(),
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(100).optional().default(20),
});

export const getCurrentQueueSchema = z.object({
  restaurantId: restaurantIdSchema,
  status: z.enum(["waiting", "called", "notified"]).optional(),
  limit: z.number().int().min(1).max(100).optional().default(50),
});

export const getQueueStatisticsSchema = z.object({
  restaurantId: restaurantIdSchema,
  dateFrom: z.iso.datetime().optional(),
  dateTo: z.iso.datetime().optional(),
});

// Query Parameter Validators
export const restaurantIdParamSchema = z.object({
  restaurantId: z.string().regex(/^\d+$/).transform(Number),
});

export const queueIdParamSchema = z.object({
  queueId: queueIdSchema,
});

export const paginationQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).prefault("1"),
  limit: z.string().regex(/^\d+$/).transform(Number).prefault("20"),
});

export const dateRangeQuerySchema = z.object({
  dateFrom: z.iso.datetime().optional(),
  dateTo: z.iso.datetime().optional(),
});

// Response Validators (for testing/validation)
export const queuePositionResponseSchema = z.object({
  queueId: queueIdSchema,
  queueNumber: queueNumberSchema,
  currentPosition: z.number().int().min(0),
  estimatedWaitMinutes: z.number().int().min(0),
  status: queueStatusSchema,
  canCancel: z.boolean(),
});

export const joinQueueResponseSchema = z.object({
  queueId: queueIdSchema,
  queueNumber: queueNumberSchema,
  estimatedWaitMinutes: z.number().int().min(0),
  currentPosition: z.number().int().min(1),
  checkInCode: z.string().length(6),
});

// API Response Wrapper Validator
export const apiResponseSchema = <T>(dataSchema: z.ZodSchema<T>) =>
  z.object({
    success: z.boolean(),
    data: dataSchema.optional(),
    error: z.string().optional(),
  });

// Bulk Operation Validator
export const bulkOperationResponseSchema = <T>(itemSchema: z.ZodSchema<T>) =>
  z.object({
    success: z.number().int().min(0),
    failed: z.number().int().min(0),
    results: z.array(itemSchema),
    errors: z
      .array(
        z.object({
          id: z.string(),
          error: z.string(),
        }),
      )
      .optional(),
  });

// Export validation helper functions
export const validateJoinQueue = (data: unknown) => joinQueueSchema.parse(data);
export const validateCallNext = (data: unknown) => callNextSchema.parse(data);
export const validateSeatCustomer = (data: unknown) =>
  seatCustomerSchema.parse(data);
export const validateCancelQueue = (data: unknown) =>
  cancelQueueSchema.parse(data);
export const validateUpdateQueueSettings = (data: unknown) =>
  updateQueueSettingsSchema.parse(data);

// Type inference helpers
export type JoinQueueData = z.infer<typeof joinQueueSchema>;
export type CallNextData = z.infer<typeof callNextSchema>;
export type SeatCustomerData = z.infer<typeof seatCustomerSchema>;
export type CancelQueueData = z.infer<typeof cancelQueueSchema>;
export type UpdateQueueSettingsData = z.infer<typeof updateQueueSettingsSchema>;
export type GetQueueHistoryData = z.infer<typeof getQueueHistorySchema>;
export type GetCurrentQueueData = z.infer<typeof getCurrentQueueSchema>;
export type GetQueueStatisticsData = z.infer<typeof getQueueStatisticsSchema>;

// Backward compatibility aliases
export type JoinQueueRequest = JoinQueueData;
export type CallNextRequest = CallNextData;
