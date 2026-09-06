import { and, asc, inArray, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { ORDER_STATUS, orders } from "@makanmasak/database";
import { raiseOverdueOrderAlert } from "../features/alerts/producers";
import type { Env } from "../types/env";

const DEFAULT_OVERDUE_MINUTES = 20;
const DEFAULT_BATCH_LIMIT = 200;

/**
 * Statuses where the kitchen still owes the customer something. `ready` counts:
 * an order sitting plated and undelivered is the case an owner most wants
 * interrupted. The terminal four (delivered, paid, cancelled, refunded) never
 * go overdue.
 */
const UNSERVED_STATUSES = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.PREPARING,
  ORDER_STATUS.READY,
];

export type OverdueOrderSweepDb = ReturnType<typeof drizzle>;

export interface OverdueOrderAlertsOptions {
  nowMs?: number;
  overdueMinutes?: number;
  limit?: number;
  /** Injectable for tests; defaults to a Drizzle instance over `env.DB`. */
  db?: OverdueOrderSweepDb;
  /** Injectable for tests; defaults to the real alert producer. */
  raise?: typeof raiseOverdueOrderAlert;
}

export interface OverdueOrderAlertsResult {
  scanned: number;
  raised: number;
  overdueMinutes: number;
  durationMs: number;
}

/**
 * Raise an owner alert for every order still unserved past the threshold (#285).
 *
 * Runs on the shared five-minute tick. Re-raising is safe: each alert is keyed
 * on the order id, so an order that stays late for an hour collapses onto the
 * single alert raised the first time the sweep saw it, and only produces a new
 * one after the owner resolves it.
 */
export async function raiseOverdueOrderAlerts(
  env: Env,
  options: OverdueOrderAlertsOptions = {},
): Promise<OverdueOrderAlertsResult> {
  const startedAt = Date.now();
  const nowMs = options.nowMs ?? startedAt;
  const overdueMinutes = options.overdueMinutes ?? DEFAULT_OVERDUE_MINUTES;
  const cutoff = new Date(nowMs - overdueMinutes * 60_000);

  const db = options.db ?? drizzle(env.DB);
  const raise = options.raise ?? raiseOverdueOrderAlert;
  const late = await db
    .select({
      id: orders.id,
      restaurantId: orders.restaurantId,
      orderNumber: orders.orderNumber,
      status: orders.status,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(
      and(
        inArray(orders.status, UNSERVED_STATUSES),
        lt(orders.createdAt, cutoff),
      ),
    )
    .orderBy(asc(orders.createdAt))
    .limit(options.limit ?? DEFAULT_BATCH_LIMIT)
    .all();

  let raised = 0;
  for (const order of late) {
    const createdAtMs = order.createdAt?.getTime() ?? nowMs;
    await raise(env, {
      restaurantId: order.restaurantId,
      orderId: order.id,
      orderNumber: order.orderNumber,
      minutesLate: Math.floor((nowMs - createdAtMs) / 60_000),
      status: order.status,
    });
    raised += 1;
  }

  return {
    scanned: late.length,
    raised,
    overdueMinutes,
    durationMs: Date.now() - startedAt,
  };
}
