/**
 * Leaves API Response Contracts
 */

import { z } from "zod";
import {
  successWithMessage,
  messageOnlyResponse,
  PaginationSchema,
  TimestampFields,
} from "../helpers";

// ---------------------------------------------------------------------------
// Entity Schemas
// ---------------------------------------------------------------------------

// The three schemas below name the columns the endpoints actually return.
// They used to name `maxDays`, `userId`, `balance` and `used`, none of
// which is a column on leave_types, employee_leave_balances or leave_requests
// — the same drift #330 fixed in shared-types, on the contract surface. It was
// a documentation fix, not a behaviour change: these are `.loose()` and nothing
// validates a live response against them. The second half of that sentence —
// that check-api-contracts.cjs only snapshotted the envelope's top-level keys —
// stopped being true on 2026-09-06 (#336). Every field below is now pinned with
// its type, so renaming one here fails `pnpm contract:check`.
// The pinned definitions live in packages/shared-types/src/leaves.ts.

export const LeaveTypeSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    restaurantId: z.string().nullable(), // null for system-wide types
    code: z.string(),
    name: z.string(),
    accrualType: z.string(),
    accrualAmount: z.number(),
    isPaid: z.union([z.boolean(), z.number()]).optional(),
    isActive: z.union([z.boolean(), z.number()]).optional(),
    ...TimestampFields,
  })
  .loose();

export const LeaveBalanceSchema = z
  .object({
    id: z.union([z.number(), z.string()]).optional(),
    employeeId: z.string(),
    leaveTypeId: z.union([z.number(), z.string()]),
    year: z.number(),
    totalDays: z.number(),
    usedDays: z.number(),
    pendingDays: z.number(),
    remainingDays: z.number(), // computed by the service, not a column
    ...TimestampFields,
  })
  .loose();

export const LeaveRequestSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    employeeId: z.string(),
    leaveTypeId: z.union([z.number(), z.string()]),
    startDate: z.union([z.string(), z.number(), z.date()]),
    endDate: z.union([z.string(), z.number(), z.date()]),
    totalDays: z.number(),
    status: z.string(),
    reason: z.string(),
    rejectionReason: z.string().optional().nullable(),
    ...TimestampFields,
  })
  .loose();

// ---------------------------------------------------------------------------
// Response Contracts
// ---------------------------------------------------------------------------

export const ListLeaveTypesResponse = z.object({
  success: z.literal(true),
  data: z.array(LeaveTypeSchema),
});

export const GetLeaveTypeResponse = z.object({
  success: z.literal(true),
  data: LeaveTypeSchema,
});

export const CreateLeaveTypeResponse = successWithMessage(LeaveTypeSchema);
export const UpdateLeaveTypeResponse = successWithMessage(LeaveTypeSchema);
export const DeleteLeaveTypeResponse = messageOnlyResponse;

export const GetBalancesResponse = z.object({
  success: z.literal(true),
  data: z.array(LeaveBalanceSchema),
});

export const AdjustBalanceResponse = successWithMessage(LeaveBalanceSchema);

export const ListLeaveRequestsResponse = z.object({
  success: z.literal(true),
  data: z.array(LeaveRequestSchema),
  pagination: PaginationSchema.optional(),
});

export const GetLeaveRequestResponse = z.object({
  success: z.literal(true),
  data: LeaveRequestSchema,
});

export const CreateLeaveRequestResponse =
  successWithMessage(LeaveRequestSchema);
export const ApproveLeaveResponse = successWithMessage(LeaveRequestSchema);
export const RejectLeaveResponse = successWithMessage(LeaveRequestSchema);
export const CancelLeaveResponse = successWithMessage(LeaveRequestSchema);
