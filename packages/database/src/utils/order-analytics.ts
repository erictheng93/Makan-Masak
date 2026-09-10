/** Order workflow states that prove the kitchen/service fulfilled the order. */
export const FULFILLED_ORDER_STATUSES: readonly string[] = [
  "paid",
  "delivered",
];

/** Canonical payment states that prove the restaurant collected the order. */
export const REVENUE_RECOGNISED_PAYMENT_STATUSES: readonly string[] = [
  "completed",
];
