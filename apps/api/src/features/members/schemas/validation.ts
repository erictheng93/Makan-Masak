import { z } from "zod";
import {
  boundedLimitQuery,
  boundedPageQuery,
} from "../../../middleware/validation";

export const restaurantIdParamSchema = z.object({
  restaurantId: z.string().min(1),
});

export const memberParamSchema = z.lazy(() =>
  restaurantIdParamSchema.extend({
    memberId: z.string().min(1),
  }),
);

/**
 * Size caps for the operator-supplied member fields below (spec §7.1 PATCH).
 * These strings land straight in restaurant_customers — a couple land in a
 * JSON column — so the caps exist to bound what one PATCH can write, not to
 * express a product opinion about how long a note "should" be.
 */
// A handful of genuinely distinct labels; past this it's not tagging anymore,
// it's a text field.
const MEMBER_MAX_TAGS = 20;
const MEMBER_TAG_MAX_LENGTH = 40; // a label like "vip-lapsed", not a sentence
const MEMBER_NOTE_MAX_LENGTH = 2000; // a few paragraphs of operator context, not a transcript
const MEMBER_BLOCKED_REASON_MAX_LENGTH = 500; // a justification, not a case file

export const memberListQuerySchema = z.object({
  page: boundedPageQuery(),
  limit: boundedLimitQuery("100"),
  search: z.string().trim().max(200).optional(),
  // Exact-match only (see TenantMemberDirectoryService.list): a JSON array
  // column compared with LIKE would let "vip" match "vip-lapsed".
  tag: z.string().trim().min(1).max(MEMBER_TAG_MAX_LENGTH).optional(),
  minOrders: z.coerce.number().int().min(0).optional(),
  // Upper bound, inclusive. The "first-time customer" pill needs `maxOrders: 1`
  // and there is no way to express that with a lower bound.
  maxOrders: z.coerce.number().int().min(0).optional(),
  minSpentCents: z.coerce.number().int().min(0).optional(),
  lastOrderFrom: z.coerce.date().optional(),
  lastOrderTo: z.coerce.date().optional(),
  blocked: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value == null ? undefined : value === "true")),
  sort: z.enum(["recent", "spent", "orders", "name"]).optional(),
});

export const memberOrdersQuerySchema = z.lazy(() =>
  z.object({
    page: boundedPageQuery(),
    limit: boundedLimitQuery("100"),
  }),
);

/**
 * The reveal flow gates on a confirmation modal, not on typed justification,
 * so `reason` is optional and a bodyless POST is valid. When a client does send
 * one it is recorded in the audit metadata, which is why it is length-bounded
 * rather than free-form.
 */
export const memberRevealContactBodySchema = z.lazy(() =>
  z.object({
    reason: z.string().trim().min(4).max(200).optional(),
  }),
);

/**
 * Tenant-local marker fields only (spec §7.1). `.strict()` is load-bearing:
 * any `customers` table column showing up in this body — `primaryPhone`,
 * `displayName`, anything — must 400 rather than be silently stripped, so a
 * client bug that means to edit a customer's own profile cannot end up
 * quietly writing nothing instead. `.refine` below rejects an empty body:
 * a PATCH with nothing to change is a caller bug, not a no-op 200.
 */
export const memberPatchBodySchema = z.lazy(() =>
  z
    .object({
      // Replaces the whole list; there is no add/remove-one endpoint.
      tags: z
        .array(z.string().trim().min(1).max(MEMBER_TAG_MAX_LENGTH))
        .max(MEMBER_MAX_TAGS)
        .nullable()
        .optional(),
      note: z.string().trim().max(MEMBER_NOTE_MAX_LENGTH).nullable().optional(),
      isBlocked: z.boolean().optional(),
      blockedReason: z
        .string()
        .trim()
        .max(MEMBER_BLOCKED_REASON_MAX_LENGTH)
        .nullable()
        .optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: "At least one field must be provided",
    }),
);

/**
 * The export body is the list filter set minus paging: one export is one file,
 * and `MEMBER_EXPORT_MAX_ROWS` in the service is what bounds it. Deliberately
 * the *same* field names and the same `"true" | "false"` shape as the list
 * query, so a client can post back the object it already built for the list
 * rather than translating it -- and so a filter added to one is a type error
 * in the other rather than a silently wider export.
 *
 * A bodyless POST is valid and exports the whole (masked) directory.
 */
export const memberExportBodySchema = z.lazy(() =>
  memberListQuerySchema.omit({ page: true, limit: true }).strict(),
);

/**
 * Platform side (spec §7.2, stage A4). Keyed on the platform `customers.id`,
 * which is legitimate here and only here: every route using these schemas is
 * `requireRole([0])`. See `PlatformCustomerDirectoryService` for why the
 * tenant-side schemas above must never gain a `customerId` field.
 */
export const platformCustomerParamSchema = z.lazy(() =>
  z.object({
    customerId: z.string().min(1),
  }),
);

export const platformCustomerListQuerySchema = z.lazy(() =>
  z.object({
    page: boundedPageQuery(),
    limit: boundedLimitQuery("100"),
    // Same rule as the tenant list: full-value equality for phone and email,
    // substring only for the display name.
    search: z.string().trim().max(200).optional(),
    status: z.enum(["active", "deleted"]).optional(),
    sort: z
      .enum(["recent", "spent", "orders", "restaurants", "name"])
      .optional(),
  }),
);
