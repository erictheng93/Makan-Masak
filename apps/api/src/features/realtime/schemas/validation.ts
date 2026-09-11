/**
 * Realtime Validation Schemas
 * Zod schemas for validating realtime API requests
 */

import { z } from "zod";

/**
 * WebSocket 授權 Token 請求 Schema
 *
 * Staff rooms only. `customer` is deliberately absent: this endpoint is public,
 * so it cannot verify a customer. Customer realtime tokens come from
 * /realtime/auth/guest-token, which requires a signed QR or a guest token.
 */
export const webSocketTokenRequestSchema = z.lazy(() =>
  z.object({
    roomType: z.enum(["kitchen", "admin", "restaurant"], {
      error: "Invalid room type",
    }),
    roomId: z.string().min(1, "Room ID is required"),
    restaurantId: z.string().min(1, "Restaurant ID is required"),
    sessionId: z.string().optional(),
  }),
);

export const guestRealtimeTokenRequestSchema = z.lazy(() =>
  z
    .object({
      restaurantId: z.string().min(1, "Restaurant ID is required"),
      guestToken: z
        .string()
        .regex(/^gt_[0-9a-f]{64}$/i)
        .optional(),
      tableId: z.coerce.string().min(1, "Table ID is required").optional(),
      seatId: z.coerce.string().min(1, "Seat ID is required").optional(),
      orderId: z.coerce.string().min(1, "Order ID is required").optional(),
      qrCode: z.url("A signed QR URL is required").optional(),
    })
    .superRefine((data, ctx) => {
      if (data.guestToken && !data.orderId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["orderId"],
          message: "Order ID is required for guest token exchange",
        });
      }

      if (
        !data.guestToken &&
        ((!data.tableId && !data.seatId) || !data.qrCode)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Either guestToken or signed table/seat QR details are required",
        });
      }
    }),
);

/**
 * 群組訂單成員憑證兌換即時 token。
 *
 * memberToken 是 group_members.session_id（UUID v4），只在建立/加入群組時回傳給
 * 該成員一次；持有它就是授權，等同桌邊訪客持有簽章 QR。
 */
export const groupOrderRealtimeTokenRequestSchema = z.lazy(() =>
  z.object({
    groupOrderId: z.uuid("A group order ID is required"),
    memberToken: z.uuid("A member token is required"),
  }),
);

/**
 * 導出 schemas 集合
 */
export const realtimeSchemas = {
  webSocketTokenRequest: webSocketTokenRequestSchema,
  guestRealtimeTokenRequest: guestRealtimeTokenRequestSchema,
  groupOrderRealtimeTokenRequest: groupOrderRealtimeTokenRequestSchema,
};
