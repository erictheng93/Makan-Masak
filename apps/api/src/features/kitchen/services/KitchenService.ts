/**
 * Kitchen Service
 * Business logic for kitchen operations.
 *
 * NOTE: This service previously tracked SSE connections and broadcast events
 * via request-local state. That code was dead: each request handler created a
 * fresh KitchenService instance, so the Map was never shared across requests
 * and cross-request broadcasts could never reach any listener. Real-time
 * kitchen updates flow through RealtimeBroadcastService → REALTIME_SESSION
 * Durable Object → WebSocket clients (apps/kitchen-display uses
 * useRealtimeKitchen.ts for this). The /kitchen/:id/events SSE endpoint now
 * just provides a "connected" status indicator and periodic heartbeats.
 */

import type { Env } from "../../../types/env";
import { ConsoleLogger } from "../../../core/monitoring";
import type {
  IKitchenService,
  KitchenOrder,
  KitchenOrdersResponse,
  OrderItemStatusUpdate,
} from "../types";
import { OrdersService } from "../../orders/services/OrdersService";
import { forbidden } from "../../../shared/utils/api-error";
import { RealtimeBroadcastService } from "@makanmasak/database";
import {
  RealtimeEventType,
  type KitchenItemStatusEvent,
  type OrderItemStatusUpdateEvent,
} from "@makanmasak/shared-types";

type KitchenOrderItemStatus = OrderItemStatusUpdate["status"];

type KitchenScopedItemRow = {
  order_id: string;
  order_number: string | null;
  order_created_at: string | number | null;
  table_id: number | null;
  table_number: string | null;
  item_id: number;
  menu_item_id: number;
  menu_item_name: string | null;
  previous_status: KitchenOrderItemStatus;
};

// Staff read the number on the table, not its row id (A1 is id 2 in prod).
function tableLabel(
  number: string | null | undefined,
  tableId: number | null | undefined,
): string {
  if (number) return `Table ${number}`;
  return tableId ? `Table ${tableId}` : "No Table";
}

export class KitchenService implements IKitchenService {
  private logger: ConsoleLogger;
  private env: Env;
  private ordersService: OrdersService;
  private realtimeBroadcastService: RealtimeBroadcastService;

  constructor(env: Env) {
    this.env = env;
    this.logger = new ConsoleLogger("KitchenService");
    this.ordersService = new OrdersService(env);
    this.realtimeBroadcastService = new RealtimeBroadcastService(env);
  }

  // Kitchen Operations
  async getKitchenOrders(
    restaurantId: string,
    userId?: string,
    limit = 100,
  ): Promise<KitchenOrdersResponse> {
    try {
      this.logger.info("Fetching kitchen orders", { restaurantId, userId });

      // Query actual orders from database
      const ordersService = this.ordersService;

      // Get orders that are relevant to kitchen (confirmed, preparing, ready).
      // OrderQueryFilters.status uses the DB string-union OrderStatus
      // (see apps/api/src/features/orders/types/index.ts), so we pass string
      // literals matching the orders.status text column. `as const` is needed
      // so TypeScript narrows the literal types instead of widening to string[].
      const result = await ordersService.getOrders({
        restaurantId,
        status: ["confirmed", "preparing", "ready"] as const,
        limit,
      });

      // Transform orders to KitchenOrder format
      const kitchenOrders: KitchenOrder[] = result.orders.map((order) => {
        const elapsedMinutes = Math.floor(
          (Date.now() - new Date(order.createdAt).getTime()) / 60000,
        );

        return {
          id: order.id,
          orderNumber: order.orderNumber,
          tableId: order.tableId || 0, // Default to 0 if no table
          tableName: tableLabel(order.table?.number, order.tableId),
          status: order.status,
          orderSource: order.orderSource,
          items: (order.items || []).map((item) => {
            // item.status is already a string — pass through directly.
            const itemStatus =
              (item.status as unknown as
                | "pending"
                | "preparing"
                | "ready"
                | "completed") || "pending";

            return {
              id: item.id,
              name: item.menuItem?.name || "Unknown Item",
              quantity: item.quantity,
              status: itemStatus,
              notes: item.notes || "",
              priority: "normal" as const,
              estimatedTime: 15,
            };
          }),
          customerName: order.customerInfo?.name || "Guest",
          notes: order.notes,
          createdAt: order.createdAt,
          totalItems:
            order.items?.reduce((sum, item) => sum + item.quantity, 0) || 0,
          priority: "normal",
          elapsedTime: elapsedMinutes,
        };
      });

      const pending = kitchenOrders.filter((o) => o.status === "confirmed");
      const preparing = kitchenOrders.filter((o) => o.status === "preparing");
      const ready = kitchenOrders.filter((o) => o.status === "ready");

      // Get daily stats for completedToday count
      const dailyStats = await ordersService.getDailyStats(restaurantId);

      // Calculate average waiting time from current pending orders
      let totalWaitingTime = 0;
      const pendingOrdersCount = pending.length + preparing.length;
      if (pendingOrdersCount > 0) {
        pending.forEach((o) => {
          totalWaitingTime += o.elapsedTime || 0;
        });
        preparing.forEach((o) => {
          totalWaitingTime += o.elapsedTime || 0;
        });
      }
      const averageWaitingTime =
        pendingOrdersCount > 0
          ? Math.round(totalWaitingTime / pendingOrdersCount)
          : 0;

      // Count urgent orders (orders waiting more than 30 minutes)
      const urgentThreshold = 30; // minutes
      const urgentOrders = kitchenOrders.filter(
        (o) => (o.elapsedTime || 0) > urgentThreshold,
      ).length;

      // Calculate efficiency: completedToday / (completedToday + pending + preparing)
      const totalOrders = dailyStats.totalOrders || 0;
      const completed = dailyStats.completedOrders || 0;
      const efficiency =
        totalOrders > 0 ? Math.round((completed / totalOrders) * 100) : 0;

      const stats = {
        pendingCount: pending.length,
        preparingCount: preparing.length,
        readyCount: ready.length,
        completedToday: completed,
        averageCookingTime: dailyStats.averagePreparationTime || 0, // From order stats
        averageWaitingTime,
        efficiency,
        urgentOrders,
      };

      return {
        pending,
        preparing,
        ready,
        stats,
      };
    } catch (error) {
      this.logger.error(
        "Failed to fetch kitchen orders",
        error instanceof Error ? error : undefined,
        { restaurantId },
      );
      throw error;
    }
  }

  async updateOrderItemStatus(
    restaurantId: string,
    orderId: string,
    itemId: number,
    statusUpdate: OrderItemStatusUpdate,
    userId: string,
  ): Promise<{
    orderId: string;
    itemId: number;
    status: string;
    updatedAt: string;
  }> {
    try {
      this.logger.info("Updating order item status", {
        restaurantId,
        orderId,
        itemId,
        status: statusUpdate.status,
        userId,
      });

      const scopedItem = await this.getScopedKitchenItem(
        restaurantId,
        orderId,
        itemId,
      );
      if (!scopedItem) {
        throw forbidden(
          "Order item is outside the kitchen scope",
          "KITCHEN_ITEM_SCOPE_DENIED",
        );
      }

      await this.ordersService.updateItemStatus(
        itemId,
        statusUpdate.status,
        statusUpdate.notes,
      );

      await this.broadcastItemStatusUpdate(
        restaurantId,
        scopedItem,
        statusUpdate.status,
      );

      return {
        orderId,
        itemId,
        status: statusUpdate.status,
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        "Failed to update order item status",
        error instanceof Error ? error : undefined,
        {
          restaurantId,
          orderId,
          itemId,
        },
      );
      throw error;
    }
  }

  validateChefAccess(
    userId: string,
    userRole: number,
    restaurantId: string,
  ): boolean {
    // Kitchen access: Admin (0), Owner (1), Chef (2), Service Crew (3)
    const allowedRoles = [0, 1, 2, 3];
    if (!allowedRoles.includes(userRole)) {
      this.logger.warn("Access denied - insufficient kitchen permissions", {
        userId,
        userRole,
        restaurantId,
        allowedRoles,
      });
      return false;
    }

    return true;
  }

  private async getScopedKitchenItem(
    restaurantId: string,
    orderId: string,
    itemId: number,
  ): Promise<KitchenScopedItemRow | null> {
    const row = await this.env.DB.prepare(
      `
        SELECT
          o.id AS order_id,
          o.order_number,
          o.created_at_ms AS order_created_at,
          o.table_id,
          t.number AS table_number,
          oi.id AS item_id,
          oi.menu_item_id,
          oi.status AS previous_status,
          COALESCE(mi.name, json_extract(oi.item_snapshot, '$.name')) AS menu_item_name
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
        LEFT JOIN tables t ON t.id = o.table_id
        WHERE oi.id = ?
          AND o.id = ?
          AND o.restaurant_id = ?
          AND o.status IN ('confirmed', 'preparing', 'ready')
        LIMIT 1
      `,
    )
      .bind(itemId, orderId, restaurantId)
      .first<KitchenScopedItemRow>();

    return row ?? null;
  }

  private async broadcastItemStatusUpdate(
    restaurantId: string,
    item: KitchenScopedItemRow,
    status: KitchenOrderItemStatus,
  ): Promise<void> {
    try {
      const updatedAt = Date.now();
      const menuItemName = item.menu_item_name || "Unknown Item";

      const orderItemEvent: OrderItemStatusUpdateEvent = {
        type: RealtimeEventType.ORDER_ITEM_STATUS_UPDATE,
        eventId: this.realtimeBroadcastService.generateEventId(),
        timestamp: updatedAt,
        restaurantId,
        data: {
          orderId: item.order_id,
          orderItemId: item.item_id,
          menuItemId: item.menu_item_id,
          menuItemName,
          status:
            status as unknown as OrderItemStatusUpdateEvent["data"]["status"],
          previousStatus:
            item.previous_status as unknown as OrderItemStatusUpdateEvent["data"]["previousStatus"],
          updatedAt,
        },
      };

      const kitchenEvent: KitchenItemStatusEvent = {
        type: RealtimeEventType.KITCHEN_ITEM_STATUS,
        eventId: this.realtimeBroadcastService.generateEventId(),
        timestamp: updatedAt,
        restaurantId,
        data: {
          orderId: item.order_id,
          orderItemId: item.item_id,
          menuItemName,
          status: this.toKitchenItemStatus(status),
          tableName: tableLabel(item.table_number, item.table_id),
          priority: this.getKitchenPriority(item.order_created_at),
          waitingTime: this.getWaitingMinutes(item.order_created_at),
        },
      };

      await Promise.all([
        this.realtimeBroadcastService.broadcastOrderItemStatusUpdate(
          orderItemEvent,
        ),
        this.realtimeBroadcastService.broadcastKitchenItemStatus(kitchenEvent),
      ]);
    } catch (error) {
      this.logger.error(
        "Failed to broadcast order item status update",
        error instanceof Error ? error : undefined,
        {
          restaurantId,
          orderId: item.order_id,
          itemId: item.item_id,
          status,
        },
      );
    }
  }

  private toKitchenItemStatus(
    status: KitchenOrderItemStatus,
  ): KitchenItemStatusEvent["data"]["status"] {
    if (status === "preparing") return "cooking";
    if (status === "completed") return "served";
    if (status === "ready") return "ready";
    return "pending";
  }

  private getWaitingMinutes(createdAt: string | number | null): number {
    if (createdAt == null) return 0;
    const createdAtMs =
      typeof createdAt === "number" ? createdAt : new Date(createdAt).getTime();
    if (!Number.isFinite(createdAtMs)) return 0;
    return Math.max(0, Math.floor((Date.now() - createdAtMs) / 60000));
  }

  private getKitchenPriority(
    createdAt: string | number | null,
  ): KitchenItemStatusEvent["data"]["priority"] {
    const waitingTime = this.getWaitingMinutes(createdAt);
    if (waitingTime >= 30) return "urgent";
    if (waitingTime >= 15) return "high";
    return "normal";
  }
}
