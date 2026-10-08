import { RealtimeBroadcastService } from "@makanmasak/database";
import { isValidRealtimeEvent } from "@makanmasak/shared-types";
import type { GroupOrderEvent } from "@makanmasak/shared-types";
import type { Env } from "../../../types/env";

type GroupOrderRealtimePayload = Record<string, unknown> & {
  groupOrderId?: string;
  restaurantId?: string;
};

export async function broadcastGroupOrderEvent(
  env: Env,
  eventType: GroupOrderEvent["type"],
  payload: GroupOrderRealtimePayload,
): Promise<void> {
  const groupOrderId = requireNonEmptyString(
    payload.groupOrderId,
    "groupOrderId",
  );
  const restaurantId = requireNonEmptyString(
    payload.restaurantId,
    "restaurantId",
  );

  const broadcaster = new RealtimeBroadcastService(env);
  const event: GroupOrderEvent = {
    type: eventType,
    eventId: broadcaster.generateEventId(),
    timestamp: Date.now(),
    restaurantId,
    data: { ...payload, groupOrderId, restaurantId },
  };

  if (!isValidRealtimeEvent(event)) {
    throw new Error(`Invalid realtime event produced for ${eventType}`);
  }

  // Clients join a group order through the `customer:{groupOrderId}` room
  // (see apps/customer-app useGroupOrder). Broadcasting to a `group_order`
  // room nobody connects to dropped every event (bug-inventory #2).
  try {
    await broadcaster.broadcastEvent("customer", groupOrderId, event);
  } catch (broadcastError) {
    console.warn(`Failed to broadcast ${eventType}:`, broadcastError);
  }
}

export function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Cannot broadcast group order event without ${field}`);
  }
  return value;
}
