/**
 * POS系統驗證schemas
 */

import { z } from "zod";
import {
  boundedLimitQuery,
  boundedPageQuery,
} from "../../../middleware/validation";
import { isCentAlignedAmount } from "../../../shared/utils/money";

const idString = z.preprocess((value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return value;
}, z.string().trim().min(1));

export const createRegisterSchema = z.object({
  name: z.string().min(1).max(100),
  location: z.string().max(100).optional(),
  restaurantId: z.string().min(1),
  hardwareConfig: z.record(z.string(), z.any()).optional(),
  peripherals: z.record(z.string(), z.any()).optional(),
  settings: z.record(z.string(), z.any()).optional(),
});

export const startShiftSchema = z.lazy(() =>
  z.object({
    registerId: z.uuid(),
    operatorId: idString,
    startAmount: z.number().min(0).refine(isCentAlignedAmount, {
      message: "startAmount must not have more than two decimal places",
    }),
    notes: z.string().max(500).optional(),
  }),
);

export const endShiftSchema = z.lazy(() =>
  z.object({
    actualAmount: z.number().min(0).refine(isCentAlignedAmount, {
      message: "actualAmount must not have more than two decimal places",
    }),
    closingNotes: z.string().max(500).optional(),
  }),
);

export const cashMovementSchema = z.lazy(() =>
  z.object({
    type: z.enum([
      "cash_in",
      "cash_out",
      "count",
      "adjustment",
      "payout",
      "deposit",
    ]),
    amount: z.number().refine(isCentAlignedAmount, {
      message: "amount must not have more than two decimal places",
    }),
    description: z.string().min(1).max(200),
    denominationBreakdown: z.record(z.string(), z.number()).optional(),
    referenceId: z.number().int().positive().optional(),
    referenceType: z.string().optional(),
  }),
);

export const printReceiptSchema = z.object({
  orderId: idString,
  templateName: z.string().optional().default("standard"),
  receiptType: z
    .enum(["customer", "kitchen", "merchant"])
    .optional()
    .default("customer"),
  copies: z.number().int().min(1).max(5).optional().default(1),
});

export const processRefundSchema = z.object({
  originalOrderId: idString,
  refundType: z.enum(["full", "partial", "item", "service"]),
  refundAmount: z.number().positive().refine(isCentAlignedAmount, {
    message: "refundAmount must not have more than two decimal places",
  }),
  refundMethod: z.string().min(1).max(50),
  reasonCode: z.string().min(1).max(50),
  reasonDescription: z.string().max(500).optional(),
  itemsRefunded: z.array(z.any()).optional(),
  customerSignature: z.string().optional(),
});

export const marketCheckoutPosPaymentSchema = z.lazy(() =>
  z.object({
    registerId: z.uuid(),
    shiftId: z.uuid().optional(),
    paymentMethod: z.enum(["cash", "card", "digital_wallet"]).default("cash"),
    country: z.enum(["TW", "MY", "VN"]).optional().default("TW"),
    currency: z.enum(["TWD", "MYR", "VND"]).optional().default("TWD"),
  }),
);

export const registerParamsSchema = z.lazy(() =>
  z.object({
    registerId: z.uuid(),
  }),
);

export const printAgentParamsSchema = z.lazy(() =>
  z.object({
    agentId: z.uuid(),
  }),
);

export const issuePrintAgentSchema = z.lazy(() =>
  z.object({
    label: z.string().trim().min(1).max(100),
    // 省略 = 全店代理（廚房出單機之類），只拿沒有收銀機的收據。
    registerId: z.uuid().optional(),
  }),
);

export const shiftParamsSchema = z.lazy(() =>
  z.object({
    shiftId: z.uuid(),
  }),
);

export const receiptParamsSchema = z.lazy(() =>
  z.object({
    receiptId: z.uuid(),
  }),
);

export const queryPaginationSchema = z.object({
  page: boundedPageQuery(),
  limit: boundedLimitQuery(),
});

export const dateRangeQuerySchema = z.object({
  dateFrom: z.iso.datetime().optional(),
  dateTo: z.iso.datetime().optional(),
});

export const registerQuerySchema = z.lazy(() =>
  z
    .object({
      restaurantId: z.string().optional(),
    })
    .merge(queryPaginationSchema),
);

export const movementsQuerySchema = z.lazy(() =>
  z
    .object({
      type: z
        .enum([
          "sale",
          "refund",
          "cash_in",
          "cash_out",
          "count",
          "opening",
          "closing",
          "adjustment",
          "payout",
          "deposit",
        ])
        .optional(),
    })
    .merge(queryPaginationSchema),
);

export const statsQuerySchema = z
  .object({
    restaurantId: z.string().optional(),
  })
  .merge(dateRangeQuerySchema);
