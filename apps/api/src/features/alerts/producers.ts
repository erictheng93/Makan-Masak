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
