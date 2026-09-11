import { z } from "zod";

/** Card currencies follow the market currencies (single-currency per card). */
const currencySchema = z.lazy(() => z.enum(["TWD", "MYR", "VND"]));
const pinSchema = z.lazy(() =>
  z.string().regex(/^\d{4,6}$/, "PIN must be 4-6 digits"),
);

export const publicIdParamSchema = z.lazy(() =>
  z.object({
    publicId: z.string().min(1).max(100),
  }),
);
export type PublicIdParam = z.infer<typeof publicIdParamSchema>;

export const issueCardSchema = z.lazy(() =>
  z.object({
    currency: currencySchema,
    ownerCustomerId: z.string().min(1).optional(),
    pin: pinSchema.optional(),
    initialBalanceCents: z
      .number()
      .int()
      .nonnegative()
      .max(100_000_000)
      .optional(),
  }),
);
export type IssueCardBody = z.infer<typeof issueCardSchema>;

export const topupSchema = z.lazy(() =>
  z.object({
    amountCents: z.number().int().positive().max(100_000_000),
    currency: currencySchema,
    // Phase 1 funds out-of-band (cash at the counter / manual adjustment).
    // Online-payment funding is Phase 2.
    fundingSource: z.enum(["cash", "manual"]).default("cash"),
    reference: z.string().max(200).optional(),
  }),
);
export type TopupBody = z.infer<typeof topupSchema>;

export const onlineTopupSchema = z.lazy(() =>
  z.object({
    amountCents: z.number().int().positive().max(100_000_000),
    currency: currencySchema,
  }),
);
export type OnlineTopupBody = z.infer<typeof onlineTopupSchema>;

export const setPinSchema = z.lazy(() => z.object({ newPin: pinSchema }));
export type SetPinBody = z.infer<typeof setPinSchema>;

export const freezeSchema = z.lazy(() =>
  z.object({
    status: z.enum(["frozen", "lost", "active"]).default("frozen"),
  }),
);
export type FreezeBody = z.infer<typeof freezeSchema>;

export const ledgerQuerySchema = z.lazy(() =>
  z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  }),
);
export type LedgerQuery = z.infer<typeof ledgerQuerySchema>;

export const accountingExportQuerySchema = z.lazy(() =>
  z.object({
    from: z.coerce.number().int().nonnegative().optional(),
    to: z.coerce.number().int().nonnegative().optional(),
  }),
);
export type AccountingExportQuery = z.infer<typeof accountingExportQuerySchema>;
