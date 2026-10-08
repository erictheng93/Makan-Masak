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
 * Payment states whose order totals contain money that belongs in a revenue
 * report.  A partially refunded order is still collected revenue; report
 * callers must subtract `orders.refund_amount_cents` from its total rather
 * than dropping the whole sale.
 */
export const REVENUE_REPORTABLE_PAYMENT_STATUSES: readonly string[] = [
  "completed",
  "partial_refunded",
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

/**
 * An order that contributes a (possibly reduced) amount to a revenue report.
 *
 * This is deliberately distinct from `revenueRecognisedOrder()`: item-level
 * reports cannot safely infer how a refund should be allocated across order
 * lines, while order-level reports can and must use the stored net amount.
 */
export function revenueReportableOrder(): SQL {
  return and(
    inArray(orders.paymentStatus, REVENUE_REPORTABLE_PAYMENT_STATUSES),
    notInArray(orders.status, ["cancelled", "refunded"]),
  )!;
}
