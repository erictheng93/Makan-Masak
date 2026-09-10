import {
  RESTAURANT_ALERT_SEVERITY,
  RestaurantAlertService,
} from "@makanmasak/database";
import type { Env } from "../../types/env";

/**
 * Alert producers for issue #285.
 *
 * Wording, severity and dedupe keys live here rather than at the call sites so
 * two producers cannot drift into describing the same condition differently.
 *
 * The stored `title`/`description` are an English fallback, not what the owner
 * reads. `details` carries the facts, and the dashboard renders them through
 * `owner.alerts.<alertType>` in the viewer's locale — the panel ships in six.
 * A producer added without locale keys still renders, in English, rather than
 * showing a key.
 *
 * Every producer swallows its own failure: raising an alert is a side effect of
 * a business operation, and a failed insert must not roll back the stock
 * movement or the sweep that triggered it. This is the one place where losing
 * the error is the correct trade — the operation the owner actually asked for
 * has already succeeded, and the alternative is failing it to report a warning.
 */
async function raise(
  env: Env,
  input: Parameters<RestaurantAlertService["raise"]>[0],
): Promise<void> {
  try {
    await new RestaurantAlertService(env.DB, env).raise(input);
  } catch (error) {
    console.error("alerts.producer.failed", {
      alertType: input.alertType,
      restaurantId: input.restaurantId,
      error,
    });
  }
}

export interface LowStockAlertInput {
  restaurantId: string;
  ingredientId: number;
  name: string;
  currentStock: number;
  minStockLevel: number;
  unit: string;
}

/**
 * Raised when a stock movement leaves an ingredient at or below its minimum.
 * Keyed per ingredient, so repeated movements below the line collapse onto the
 * one open alert until the owner resolves it.
 */
export function raiseLowStockAlert(
  env: Env,
  input: LowStockAlertInput,
): Promise<void> {
  const depleted = input.currentStock <= 0;
  return raise(env, {
    restaurantId: input.restaurantId,
    alertType: depleted ? "inventory_depleted" : "inventory_low",
    severity: depleted
      ? RESTAURANT_ALERT_SEVERITY.CRITICAL
      : RESTAURANT_ALERT_SEVERITY.HIGH,
    title: depleted
      ? `${input.name} is out of stock`
      : `${input.name} is below its minimum stock level`,
    description: depleted
      ? `${input.name} is at 0 ${input.unit} and needs restocking.`
      : `${input.name} is at ${input.currentStock} ${input.unit}, below the ${input.minStockLevel} ${input.unit} minimum.`,
    details: {
      ingredientId: input.ingredientId,
      name: input.name,
      currentStock: input.currentStock,
      minStockLevel: input.minStockLevel,
      unit: input.unit,
    },
    dedupeKey: `inventory:${input.ingredientId}`,
  });
}

/** Structural subset of an ingredient; avoids importing another feature's type. */
export interface StockLevelSnapshot {
  id: number;
  name: string;
  unit: string;
  currentStock: number | null;
  minStockLevel: number | null;
}

/**
 * Raise a low-stock alert only when the movement actually crossed the line.
 *
 * A null on either figure means the ingredient never opted into stock tracking,
 * so there is no line to be under — alerting on those would fire for every
 * ingredient a restaurant has ever created.
 */
export async function alertIfBelowMinimum(
  env: Env,
  restaurantId: string,
  ingredient: StockLevelSnapshot | null,
): Promise<void> {
  if (!ingredient) return;
  const { currentStock, minStockLevel } = ingredient;
  if (currentStock === null || minStockLevel === null) return;
  if (currentStock > minStockLevel) return;

  await raiseLowStockAlert(env, {
    restaurantId,
    ingredientId: ingredient.id,
    name: ingredient.name,
    currentStock,
    minStockLevel,
    unit: ingredient.unit,
  });
}

export interface OverdueOrderAlertInput {
  restaurantId: string;
  orderId: string;
  orderNumber: string;
  minutesLate: number;
  status: string;
}

/**
 * Raised by the five-minute sweep for an order still unserved past the
 * threshold. Keyed per order: the sweep re-runs every five minutes and must
 * not stack a new alert onto the same late order each time.
 */
export function raiseOverdueOrderAlert(
  env: Env,
  input: OverdueOrderAlertInput,
): Promise<void> {
  return raise(env, {
    restaurantId: input.restaurantId,
    alertType: "order_overdue",
    severity: RESTAURANT_ALERT_SEVERITY.HIGH,
    title: `Order ${input.orderNumber} is overdue`,
    description: `Order ${input.orderNumber} has been unfinished for ${input.minutesLate} minutes and is still ${input.status}.`,
    details: {
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      minutesLate: input.minutesLate,
      status: input.status,
    },
    dedupeKey: `order-overdue:${input.orderId}`,
  });
}

/**
 * Rejections worth an owner alert: the amounts disagree, or the ledger may
 * have drifted. Kept as one named set so the policy can be tuned in a single
 * line once production has failure rows to tune against (#350).
 *
 * Deliberately absent, and why:
 * - `ORDER_NOT_PAYABLE` — a double-tap on an already-finalised order. The
 *   money is where it should be; nothing for the owner to do.
 * - `IDEMPOTENCY_ORDER_MISMATCH` — a client reusing a key across orders. A
 *   caller bug, not a till discrepancy.
 * - `FORBIDDEN` / `INSUFFICIENT_ROLE` — access control. Already recorded on
 *   the targeted tenant's audit trail, and an alert per probe would let an
 *   outsider fill the owner's panel.
 * - `ORDER_NOT_FOUND` — never reaches the failure path at all; there is no
 *   restaurant to scope it to.
 */
export const OWNER_ALERTED_PAYMENT_FAILURE_CODES: ReadonlySet<string> = new Set(
  [
    "PAYMENT_AMOUNT_MISMATCH",
    "PAYMENT_TOTAL_MISMATCH",
    "PARTIAL_PAYMENT_TOTAL_MISMATCH",
    "UNEXPECTED_ERROR",
  ],
);

export interface PaymentFailedAlertInput {
  restaurantId: string;
  orderId: string;
  orderNumber: string;
  errorCode: string;
  paymentMode: string;
  /** Major units, omitted when the request named no amount. */
  submittedAmount?: number;
  /** Major units, omitted when the order carries no total. */
  serverTotal?: number;
  currency?: string;
}

/**
 * Raised when a payment attempt was refused in a way that touches the
 * restaurant's money (#350).
 *
 * `UNEXPECTED_ERROR` is the critical one: it covers a D1 failure inside the
 * closing batch, after `UPDATE orders` has already flipped the order to paid.
 * The order can read as paid with no ledger row behind it, and only the owner
 * can reconcile that. The three mismatches are `high` — the payment was
 * refused cleanly, but the amount someone tried to take differs from the
 * order's total, which is worth a look before the till is counted.
 *
 * Keyed per order, so a customer retrying the same wrong amount collapses onto
 * the one open alert instead of stacking a row per tap.
 *
 * The translated messages interpolate only `orderNumber` and `errorCode`:
 * amounts ride along in `details` for anyone inspecting the alert, but a
 * failure inside the batch need not have submitted an amount at all, and a
 * message with a hole in it reads worse than one without the figure.
 */
export function raisePaymentFailedAlert(
  env: Env,
  input: PaymentFailedAlertInput,
): Promise<void> {
  const details: Record<string, unknown> = {
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    errorCode: input.errorCode,
    paymentMode: input.paymentMode,
  };
  // Undefined entries are dropped rather than sent as null: the dashboard
  // presenter discards non-scalars, so a null would only travel to be ignored.
  if (input.submittedAmount !== undefined) {
    details.submittedAmount = input.submittedAmount;
  }
  if (input.serverTotal !== undefined) details.serverTotal = input.serverTotal;
  if (input.currency !== undefined) details.currency = input.currency;

  return raise(env, {
    restaurantId: input.restaurantId,
    alertType: "payment_failed",
    severity:
      input.errorCode === "UNEXPECTED_ERROR"
        ? RESTAURANT_ALERT_SEVERITY.CRITICAL
        : RESTAURANT_ALERT_SEVERITY.HIGH,
    title: `Payment failed for order ${input.orderNumber}`,
    description: `Payment for order ${input.orderNumber} was refused (${input.errorCode}). Check the order's payment state before reconciling.`,
    details,
    dedupeKey: `payment-failed:${input.orderId}`,
  });
}
