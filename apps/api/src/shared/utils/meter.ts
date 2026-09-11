import type { Context } from "hono";
import type { MeterKey } from "@makanmasak/database";
import type { Env } from "../../types/env";
import { recordUsageBucketDelta } from "./usage-buckets";

type MeterContext<E extends { Bindings: Env } = { Bindings: Env }> = Context<E>;

interface MeterUser {
  role?: number | null;
  restaurantId?: string | number | null;
}

interface MeterTenant {
  tenantId?: string | null;
}

export interface MeterEmitOptions {
  restaurantId?: string;
  quantity?: number;
}

/**
 * Record one unit of metered usage for the restaurant this request belongs to.
 *
 * Writes into `usage_meter_buckets` — one row per (restaurant, meter, hour) —
 * rather than one `usage_events` row per call (#333). Everything downstream
 * reads a SUM, so the per-call row carried no information the hourly counter
 * does not, while costing a row-write (plus index writes, plus the
 * aggregator's UPDATE, plus the TTL DELETE) on every single API request.
 *
 * There is deliberately no `metadata` any more. The only caller that populated
 * it usefully was `usageTracker`, with method/path/status — and those already
 * reach Analytics Engine on every request via `advancedAnalyticsMiddleware`
 * (middleware/analytics.ts, `event: "api_request"`, blobs carry endpoint,
 * method and status_code, indexed by restaurant), which is the right store for
 * high-cardinality per-request dimensions. The rest recorded an `orderId` or
 * `receiptId` that is already a row in `orders` / `receipts`. Billing never
 * read any of it.
 */
export async function meterEmit<E extends { Bindings: Env }>(
  c: MeterContext<E>,
  meterKey: MeterKey,
  options: MeterEmitOptions = {},
): Promise<void> {
  const user = c.get("user" as never) as MeterUser | undefined;
  const tenant = c.get("tenant" as never) as MeterTenant | undefined;
  const restaurantId =
    options.restaurantId ??
    (tenant?.tenantId == null ? undefined : String(tenant.tenantId)) ??
    (user?.role === 0 || user?.restaurantId == null
      ? undefined
      : String(user.restaurantId));

  if (!restaurantId) return;

  const recordOp = recordUsageBucketDelta(c.env.DB, {
    restaurantId,
    meterKey,
    quantity: options.quantity ?? 1,
  }).catch((error) => {
    console.error("meterEmit.failed", { meterKey, restaurantId, error });
  });

  let waitUntil: ((promise: Promise<unknown>) => void) | undefined;
  try {
    waitUntil = c.executionCtx?.waitUntil?.bind(c.executionCtx);
  } catch {
    waitUntil = undefined;
  }

  if (waitUntil) {
    waitUntil(recordOp);
  } else {
    await recordOp;
  }
}
