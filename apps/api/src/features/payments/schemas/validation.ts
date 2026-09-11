import { z } from "zod";

const moneySchema = z.lazy(() => z.number().finite().nonnegative());

const partialPaymentSchema = z.lazy(() =>
  z.object({
    method: z.string().min(1).max(50),
    amount: moneySchema,
  }),
);

export const paymentRequestSchema = z.lazy(() =>
  z
    .object({
      orderId: z.string().min(1),
      paymentMode: z.enum(["full", "partial"]).optional().default("full"),
      // Optional client-side sanity check. Server recomputes the authoritative
      // total regardless; when provided, mismatch is rejected with
      // PAYMENT_TOTAL_MISMATCH. When omitted (e.g. E1 gateway-timeout path),
      // the server total is still the source of truth.
      expectedTotal: moneySchema.optional(),
      payments: z.array(partialPaymentSchema).min(1).max(20).optional(),
      closeOrder: z.boolean().optional(),
      method: z.string().min(1).max(50).optional(),
      amount: moneySchema.optional(),
      gateway: z.string().min(1).max(50).optional(),
    })
    .superRefine((value, ctx) => {
      if (value.paymentMode === "partial" && !value.payments?.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["payments"],
          message: "payments are required for partial payment mode",
        });
      }

      if (value.paymentMode === "full" && value.amount === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["amount"],
          message: "amount is required for full payment mode",
        });
      }
    }),
);

export const paymentSchemas = {
  processPayment: paymentRequestSchema,
};

export type PaymentRequestInput = z.infer<typeof paymentRequestSchema>;
