import { and, inArray, notInArray, type SQL } from "drizzle-orm";
import { orders } from "../schema";

/** Order workflow states that prove the kitchen/service fulfilled the order. */
export const FULFILLED_ORDER_STATUSES: readonly string[] = [
  "paid",
  "delivered",
];

/** Canonical payment states that prove the restaurant collected the order. */
export const REVENUE_RECOGNISED_PAYMENT_STATUSES: readonly string[] = [
  "completed",
];

/**
 * An order whose money the restaurant has collected: settled through the
 * payment path and not cancelled or refunded since (#354). Revenue figures
 * filter on this rather than on `status` — an order reaches `delivered` when
 * the food is served, whether or not anyone has paid for it.
 */
export function revenueRecognisedOrder(): SQL {
  return and(
    inArray(orders.paymentStatus, REVENUE_RECOGNISED_PAYMENT_STATUSES),
    notInArray(orders.status, ["cancelled", "refunded"]),
  )!;
}
