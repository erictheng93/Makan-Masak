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
    title: depleted ? `${input.name} 已用盡` : `${input.name} 低於安全庫存`,
    description: depleted
      ? `${input.name} 目前庫存為 0 ${input.unit}，需要立即補貨。`
      : `${input.name} 目前庫存 ${input.currentStock} ${input.unit}，低於安全庫存 ${input.minStockLevel} ${input.unit}。`,
    details: {
      ingredientId: input.ingredientId,
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
    title: `訂單 ${input.orderNumber} 已逾時`,
    description: `訂單 ${input.orderNumber} 已經 ${input.minutesLate} 分鐘未完成，目前狀態為 ${input.status}。`,
    details: {
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      minutesLate: input.minutesLate,
      status: input.status,
    },
    dedupeKey: `order-overdue:${input.orderId}`,
  });
}
