import { RealtimeBroadcastService } from "@makanmasak/database";
import type { DurableObjectNamespace } from "@cloudflare/workers-types";
import type {
  OrderStatus,
  OrderStatusUpdateEvent,
} from "@makanmasak/shared-types";
import { RealtimeEventType as EventType } from "@makanmasak/shared-types";
import {
  ephemeralStore,
  type EphemeralStore,
} from "../../../shared/utils/ephemeral-store";

interface FinalizationEnv {
  DB: D1Database;
  REALTIME_SESSION?: DurableObjectNamespace;
}

export interface OrderStatusBroadcastSnapshot {
  id: string;
  restaurantId: string | number;
  orderNumber?: string | null;
}

export interface FinalizeOrderStatusSideEffectsOptions {
  env: FinalizationEnv;
  order: OrderStatusBroadcastSnapshot;
  previousStatus: OrderStatus;
  newStatus: OrderStatus;
  updatedBy?: string;
  updatedByRole?: string;
  notes?: string;
  estimatedReadyTime?: Date;
}

const GUEST_ACTIVE_RELEASE_STATUSES = new Set<OrderStatus>([
  "delivered",
  "paid",
  "cancelled",
  "refunded",
]);

export async function clearGuestActiveOrderLock(
  store: Pick<EphemeralStore, "get" | "delete">,
  orderId: string,
): Promise<void> {
  try {
    const lookupKey = `guest_active_lookup:${orderId}`;
    const activeOrderKey = await store.get(lookupKey);
    if (typeof activeOrderKey !== "string" || !activeOrderKey) {
      return;
    }

    await Promise.allSettled([
      store.delete(activeOrderKey),
      store.delete(lookupKey),
    ]);
  } catch {
    // Guest active locks are a recovery aid; status transitions must not fail
    // after the database update because lock cleanup was unavailable.
  }
}

export async function finalizeOrderStatusSideEffects({
  env,
  order,
  previousStatus,
  newStatus,
  updatedBy,
  updatedByRole = "system",
  notes,
  estimatedReadyTime,
}: FinalizeOrderStatusSideEffectsOptions): Promise<void> {
  const sideEffects: Array<Promise<unknown>> = [
    broadcastOrderStatusUpdate({
      env,
      order,
      previousStatus,
      newStatus,
      updatedBy,
      updatedByRole,
      notes,
      estimatedReadyTime,
    }),
  ];

  if (GUEST_ACTIVE_RELEASE_STATUSES.has(newStatus)) {
    sideEffects.push(clearGuestActiveOrderLock(ephemeralStore(env), order.id));
  }

  await Promise.all(sideEffects);
}

async function broadcastOrderStatusUpdate({
  env,
  order,
  previousStatus,
  newStatus,
  updatedBy,
  updatedByRole,
  notes,
  estimatedReadyTime,
}: FinalizeOrderStatusSideEffectsOptions): Promise<void> {
  const realtimeBroadcastService = new RealtimeBroadcastService(env);
  const realtimeEvent: OrderStatusUpdateEvent = {
    type: EventType.ORDER_STATUS_UPDATE,
    eventId: realtimeBroadcastService.generateEventId(),
    timestamp: Date.now(),
    restaurantId: String(order.restaurantId),
    data: {
      orderId: order.id,
      orderNumber: order.orderNumber || `#${order.id}`,
      status: newStatus,
      previousStatus,
      estimatedTime: estimatedReadyTime
        ? Math.floor(
            (new Date(estimatedReadyTime).getTime() - Date.now()) / 60000,
          )
        : undefined,
      message: notes,
      updatedBy: updatedBy
        ? {
            userId: updatedBy,
            userName: "System",
            role: updatedByRole ?? "system",
          }
        : undefined,
    },
  };

  await realtimeBroadcastService.broadcastOrderStatusUpdate(realtimeEvent);
}
