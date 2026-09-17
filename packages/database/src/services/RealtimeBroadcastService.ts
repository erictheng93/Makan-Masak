/**
 * Realtime Broadcast Service
 * Bridges API/service-layer code to the realtime worker's Durable Object,
 * which holds WebSocket connections per `${roomType}:${roomId}` instance.
 *
 * Lives in packages/database (not apps/api/src/services) so both
 * WaitingListService and the future QueueService can import directly
 * without crossing the apps→packages dependency boundary.
 */

import type {
  RealtimeEvent,
  NewOrderEvent,
  OrderStatusUpdateEvent,
  OrderItemStatusUpdateEvent,
  OrderCancelledEvent,
  KitchenItemStatusEvent,
  MenuAvailabilityUpdateEvent,
} from "@makanmasak/shared-types";
import type { DurableObjectNamespace } from "@cloudflare/workers-types";

/** Minimal env shape — avoids depending on apps/api's full Env type. */
interface BroadcastEnv {
  REALTIME_SESSION?: DurableObjectNamespace;
}

export interface BroadcastResult {
  success: boolean;
  eventId?: string;
  recipientCount?: number;
  error?: string;
}

export class RealtimeBroadcastService {
  private env: BroadcastEnv;

  constructor(env: BroadcastEnv) {
    this.env = env;
  }

  async broadcastEvent(
    roomType: string,
    roomId: string,
    event: RealtimeEvent,
  ): Promise<BroadcastResult> {
    try {
      // REALTIME_SESSION may be undefined in tests / unconfigured envs.
      // Returning success=true here is intentional: we treat broadcast
      // as best-effort and never fail the originating mutation. The
      // production binding is verified at deploy time (see INC-001).
      if (!this.env.REALTIME_SESSION) {
        console.warn(
          "[RealtimeBroadcastService] REALTIME_SESSION not configured, skipping broadcast",
        );
        return {
          success: true,
          eventId: event.eventId,
          recipientCount: 0,
        };
      }

      const durableObjectId = this.env.REALTIME_SESSION.idFromName(
        `${roomType}:${roomId}`,
      );
      const durableObjectHandle =
        this.env.REALTIME_SESSION.get(durableObjectId);

      const response = await durableObjectHandle.fetch(
        `https://realtime-internal/broadcast`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(event),
        },
      );

      const result = (await response.json()) as {
        success: boolean;
        error?: string;
        eventId?: string;
        recipientCount?: number;
      };

      if (!result.success) {
        console.error("[RealtimeBroadcastService] broadcast failed", {
          roomType,
          roomId,
          eventType: event.type,
          error: result.error,
        });
        return {
          success: false,
          error: result.error,
        };
      }

      return {
        success: true,
        eventId: result.eventId,
        recipientCount: result.recipientCount,
      };
    } catch (error) {
      console.error("[RealtimeBroadcastService] broadcast error", {
        roomType,
        roomId,
        eventType: event.type,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "unknown",
      };
    }
  }

  async broadcastNewOrder(event: NewOrderEvent): Promise<BroadcastResult> {
    return this.broadcastRestaurantAndKitchen(event);
  }

  /**
   * An existing order whose lines or total changed (items added, a quantity
   * changed, a discount applied). Staff rooms get the same NEW_ORDER payload
   * they upsert on; the diner's tracking page gets it too, because it is
   * connected to the order's customer room only and otherwise keeps showing
   * the old lines until reloaded.
   */
  async broadcastOrderModified(event: NewOrderEvent): Promise<BroadcastResult> {
    return this.broadcastStaffAndCustomer(event, event.data.orderId);
  }

  async broadcastOrderStatusUpdate(
    event: OrderStatusUpdateEvent,
  ): Promise<BroadcastResult> {
    return this.broadcastStaffAndCustomer(event, event.data.orderId);
  }

  async broadcastOrderItemStatusUpdate(
    event: OrderItemStatusUpdateEvent,
  ): Promise<BroadcastResult> {
    return this.broadcastRestaurantAndKitchen(event);
  }

  async broadcastOrderCancelled(
    event: OrderCancelledEvent,
  ): Promise<BroadcastResult> {
    // The diner's page listens on the order's customer room. Without it a
    // staff cancellation never reached an open tracking page.
    return this.broadcastStaffAndCustomer(event, event.data.orderId);
  }

  async broadcastKitchenItemStatus(
    event: KitchenItemStatusEvent,
  ): Promise<BroadcastResult> {
    return this.broadcastRestaurantAndKitchen(event);
  }

  async broadcastMenuAvailabilityUpdate(
    event: MenuAvailabilityUpdateEvent,
  ): Promise<BroadcastResult> {
    // Admin dashboards connect to the `admin:{restaurantId}` room; `restaurant:*`
    // has no connection route today but is kept for forward-compat.
    return this.broadcastToRooms(event, ["restaurant", "admin"]);
  }

  generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async broadcastRestaurantAndKitchen(
    event:
      | NewOrderEvent
      | OrderStatusUpdateEvent
      | OrderItemStatusUpdateEvent
      | OrderCancelledEvent
      | KitchenItemStatusEvent,
  ): Promise<BroadcastResult> {
    // The admin dashboard connects to the `admin:{restaurantId}` room (see the
    // apps/realtime routes), so order/kitchen events MUST fan out there or the
    // dashboard never receives them. `kitchen:*` serves the kitchen display.
    // `restaurant:*` has no connection route today but is retained for
    // forward-compat rather than removed.
    return this.broadcastToRooms(event, ["restaurant", "kitchen", "admin"]);
  }

  private async broadcastStaffAndCustomer(
    event: NewOrderEvent | OrderStatusUpdateEvent | OrderCancelledEvent,
    orderId: string | number,
  ): Promise<BroadcastResult> {
    const results = await Promise.all([
      this.broadcastRestaurantAndKitchen(event),
      this.broadcastEvent("customer", `order:${orderId}`, event),
    ]);

    const failed = results.find((result) => !result.success);
    if (failed) {
      return failed;
    }

    return {
      success: true,
      eventId: results[0]?.eventId ?? event.eventId,
      recipientCount: results.reduce(
        (sum, result) => sum + (result.recipientCount ?? 0),
        0,
      ),
    };
  }

  private async broadcastToRooms(
    event: RealtimeEvent,
    roomTypes: string[],
  ): Promise<BroadcastResult> {
    const results = await Promise.all(
      roomTypes.map((roomType) =>
        this.broadcastEvent(roomType, event.restaurantId, event),
      ),
    );

    const failed = results.find((result) => !result.success);
    if (failed) {
      return failed;
    }

    return {
      success: true,
      eventId: results[0]?.eventId ?? event.eventId,
      recipientCount: results.reduce(
        (sum, result) => sum + (result.recipientCount ?? 0),
        0,
      ),
    };
  }
}
