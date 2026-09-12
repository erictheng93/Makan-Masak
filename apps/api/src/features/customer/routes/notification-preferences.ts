import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { customerNotificationPreferences } from "@makanmasak/database";
import {
  QUIET_HOURS_MAX_MINUTE,
  QUIET_HOURS_MIN_MINUTE,
} from "@makanmasak/shared-types";
import { canonicalCustomerAuthMiddleware } from "../../../middleware/auth";
import { validateBody } from "../../../middleware/validation";
import { badRequest } from "../../../shared/utils/api-error";
import type { Env } from "../../../types/env";

/**
 * Marketing notification preferences (#335), mounted inside `/api/v1/customer`.
 *
 * A separate router from the 2,000-line legacy customer file on purpose: that
 * file predates the two-layer query rule and reaches for `env.DB.prepare`
 * throughout, and its test harness mocks D1 as a queue of canned results.
 * These two endpoints use Drizzle and are tested against a real D1, which is
 * the only way the defaults-when-absent behaviour below can be proven rather
 * than asserted against a mock that was told what to return.
 *
 * Not to be confused with `customer_preferences` (GET/PATCH
 * `/customer/preferences`). That table is pre-STRICT, stores quiet hours as
 * TEXT "HH:MM", and its `marketing_opt_in` / `promo_from_favorites_opt_in`
 * flags have never had a reader. This table is the one the broadcast fan-out
 * consults. The older flags are left untouched rather than dual-written:
 * writing both would make it ambiguous which one decided a send.
 */
const routes = new Hono<{ Bindings: Env }>();

/** What a customer who has never touched this screen is treated as. */
export const DEFAULT_NOTIFICATION_PREFERENCES = {
  marketingEnabled: true,
  followedOnly: true,
  quietHoursStartMin: null as number | null,
  quietHoursEndMin: null as number | null,
  updatedAt: null as number | null,
};

// Wrapped in `z.lazy` per the convention at the top of
// `middleware/validation.ts` (#362) — see there for why.
const quietHourSchema = z.lazy(() =>
  z
    .number()
    .int()
    .min(QUIET_HOURS_MIN_MINUTE)
    .max(QUIET_HOURS_MAX_MINUTE)
    .nullable(),
);

/**
 * Every field optional: a PUT carries the fields the screen changed and
 * anything omitted keeps its stored value. Sending `{}` is therefore a no-op
 * that still creates the row, which is what makes GET-then-PUT idempotent.
 */
const notificationPreferencesSchema = z.lazy(() =>
  z.object({
    marketingEnabled: z.boolean().optional(),
    followedOnly: z.boolean().optional(),
    quietHoursStartMin: quietHourSchema.optional(),
    quietHoursEndMin: quietHourSchema.optional(),
  }),
);

export type NotificationPreferencesInput = z.infer<
  typeof notificationPreferencesSchema
>;

export interface NotificationPreferencesView {
  marketingEnabled: boolean;
  followedOnly: boolean;
  quietHoursStartMin: number | null;
  quietHoursEndMin: number | null;
  updatedAt: number | null;
}

async function loadPreferences(
  env: Env,
  customerId: string,
): Promise<NotificationPreferencesView> {
  const db = drizzle(env.DB);
  const [row] = await db
    .select()
    .from(customerNotificationPreferences)
    .where(eq(customerNotificationPreferences.customerId, customerId))
    .limit(1);

  if (!row) return { ...DEFAULT_NOTIFICATION_PREFERENCES };

  return {
    marketingEnabled: row.marketingEnabled === 1,
    followedOnly: row.followedOnly === 1,
    quietHoursStartMin: row.quietHoursStartMin,
    quietHoursEndMin: row.quietHoursEndMin,
    updatedAt:
      row.updatedAt instanceof Date
        ? row.updatedAt.getTime()
        : (row.updatedAt ?? null),
  };
}

/**
 * GET /api/v1/customer/notification-preferences
 */
routes.get(
  "/notification-preferences",
  canonicalCustomerAuthMiddleware,
  async (c) => {
    return c.json({
      success: true,
      data: await loadPreferences(c.env, c.get("customer").id),
    });
  },
);

/**
 * PUT /api/v1/customer/notification-preferences
 */
routes.put(
  "/notification-preferences",
  canonicalCustomerAuthMiddleware,
  validateBody(notificationPreferencesSchema),
  async (c) => {
    const customerId = c.get("customer").id;
    const body = c.get("validatedBody") as NotificationPreferencesInput;
    const current = await loadPreferences(c.env, customerId);

    const merged: NotificationPreferencesView = {
      marketingEnabled: body.marketingEnabled ?? current.marketingEnabled,
      followedOnly: body.followedOnly ?? current.followedOnly,
      quietHoursStartMin:
        body.quietHoursStartMin === undefined
          ? current.quietHoursStartMin
          : body.quietHoursStartMin,
      quietHoursEndMin:
        body.quietHoursEndMin === undefined
          ? current.quietHoursEndMin
          : body.quietHoursEndMin,
      updatedAt: null,
    };

    // Half a window is not a window: a start with no end would silently mean
    // "no quiet hours", which is the opposite of what the person just asked
    // for. Clearing both is how you turn it off.
    if (
      (merged.quietHoursStartMin === null) !==
      (merged.quietHoursEndMin === null)
    ) {
      throw badRequest(
        "quietHoursStartMin and quietHoursEndMin must be set or cleared together",
        "QUIET_HOURS_INCOMPLETE",
      );
    }

    const now = new Date();
    const values = {
      customerId,
      marketingEnabled: merged.marketingEnabled ? 1 : 0,
      followedOnly: merged.followedOnly ? 1 : 0,
      quietHoursStartMin: merged.quietHoursStartMin,
      quietHoursEndMin: merged.quietHoursEndMin,
      updatedAt: now,
    };

    const db = drizzle(c.env.DB);
    await db
      .insert(customerNotificationPreferences)
      .values(values)
      .onConflictDoUpdate({
        target: customerNotificationPreferences.customerId,
        set: {
          marketingEnabled: values.marketingEnabled,
          followedOnly: values.followedOnly,
          quietHoursStartMin: values.quietHoursStartMin,
          quietHoursEndMin: values.quietHoursEndMin,
          updatedAt: values.updatedAt,
        },
      });

    return c.json({
      success: true,
      data: await loadPreferences(c.env, customerId),
    });
  },
);

export default routes;
