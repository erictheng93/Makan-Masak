import { ref, computed } from "vue";
import { apiClient } from "./authApi";
import type { KitchenOrder } from "@/types";
import { describeErrorForLog, isRecord } from "@/utils/unknown";
import { sameOrderId } from "@/utils/orderId";

interface OfflineActionPayload {
  status?: KitchenOrder["status"];
  priority?: KitchenOrder["priority"];
  operation?: "start_all" | "complete_all";
  restaurantId?: string | number;
  [key: string]: unknown;
}

interface OfflineSyncResponse {
  success: boolean;
  error?: string;
  conflict?: {
    type?: unknown;
    serverData?: unknown;
  };
}

// Offline storage types
export interface OfflineAction {
  id: string;
  type:
    | "start_cooking"
    | "mark_ready"
    | "update_status"
    | "priority_change"
    | "batch_operation";
  orderId: string | number;
  itemId?: number;
  payload: OfflineActionPayload;
  timestamp: number;
  synced: boolean;
  retryCount: number;
  error?: string;
}

export interface OfflineData {
  // Cached orders are NOT stored here — they live in a per-restaurant bucket
  // (see cacheKeyFor) so a shared device cannot mix tenants.
  actions: OfflineAction[];
  lastSync: number;
  syncInProgress: boolean;
  restaurantId?: string | null;
}

export interface SyncConflict {
  id: string;
  type: "order_updated" | "order_deleted" | "status_conflict";
  localData: unknown;
  serverData: unknown;
  resolution?: "local" | "server" | "merge";
}

class OfflineService {
  private readonly STORAGE_KEY = "kitchen-offline-data";
  // Cached orders live at `<prefix>:<restaurantId>`. The bare prefix was the
  // pre-tenant-scoping key, so it doubles as the legacy key the constructor
  // purges on startup.
  private readonly CACHED_ORDERS_PREFIX = "kitchen-cached-orders";
  private readonly MAX_RETRY_ATTEMPTS = 5;
  private readonly SYNC_INTERVAL = 30000; // 30 seconds

  // Restaurant the cache is currently bound to. Kitchen displays are shared and
  // re-assigned devices, so every cache read/write must be tenant-scoped.
  private activeRestaurantId: string | null = null;

  // Reactive state
  public isOnline = ref(navigator.onLine);
  public isOfflineMode = ref(false);
  public pendingActions = ref<OfflineAction[]>([]);
  public syncConflicts = ref<SyncConflict[]>([]);
  public lastSyncTime = ref<number>(0);
  public syncInProgress = ref(false);

  private syncInterval: NodeJS.Timeout | null = null;
  private retryTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.initializeOfflineHandling();
    this.loadOfflineData();
    // Drop any cache written before tenant scoping existed — it has no owner.
    localStorage.removeItem(this.CACHED_ORDERS_PREFIX);
    this.startPeriodicSync();
  }

  // Computed properties
  get hasPendingActions() {
    return computed(() => this.pendingActions.value.length > 0);
  }

  get hasConflicts() {
    return computed(() => this.syncConflicts.value.length > 0);
  }

  get canSync() {
    return computed(() => this.isOnline.value && !this.syncInProgress.value);
  }

  // Initialize offline handling
  private initializeOfflineHandling() {
    // Listen for online/offline events
    window.addEventListener("online", this.handleOnline.bind(this));
    window.addEventListener("offline", this.handleOffline.bind(this));

    // Listen for visibility changes to trigger sync when app becomes visible
    document.addEventListener(
      "visibilitychange",
      this.handleVisibilityChange.bind(this),
    );

    // Set initial online status
    this.isOnline.value = navigator.onLine;
  }

  private handleOnline() {
    console.log("Network connection restored");
    this.isOnline.value = true;
    this.isOfflineMode.value = false;

    // Trigger immediate sync when coming back online
    this.syncPendingActions();
  }

  private handleOffline() {
    console.log("Network connection lost");
    this.isOnline.value = false;
    this.isOfflineMode.value = true;
  }

  private handleVisibilityChange() {
    if (!document.hidden && this.isOnline.value) {
      this.syncPendingActions();
    }
  }

  // Data persistence
  private saveOfflineData() {
    const data: OfflineData = {
      actions: this.pendingActions.value,
      lastSync: this.lastSyncTime.value,
      syncInProgress: this.syncInProgress.value,
      restaurantId: this.activeRestaurantId,
    };

    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error("Failed to save offline data:", error);
    }
  }

  private loadOfflineData() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      if (data) {
        const parsed: OfflineData = JSON.parse(data);
        this.pendingActions.value = parsed.actions || [];
        this.lastSyncTime.value = parsed.lastSync || 0;
        this.activeRestaurantId = parsed.restaurantId ?? null;

        // Filter out old actions (older than 24 hours)
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        this.pendingActions.value = this.pendingActions.value.filter(
          (action) => action.timestamp > oneDayAgo,
        );
      }
    } catch (error) {
      console.error("Failed to load offline data:", error);
    }
  }

  // Order caching (tenant-scoped)
  private cacheKeyFor(restaurantId: string): string {
    return `${this.CACHED_ORDERS_PREFIX}:${restaurantId}`;
  }

  private resolveRestaurantScope(
    restaurantId?: number | string | null,
  ): string | null {
    if (
      restaurantId === undefined ||
      restaurantId === null ||
      restaurantId === ""
    ) {
      return this.activeRestaurantId;
    }
    return String(restaurantId);
  }

  /**
   * 綁定離線快取到目前登入的餐廳。
   * Switching tenants on the same device (shared or re-assigned kitchen display)
   * drops the previous tenant's cached orders and queued actions so they can
   * never be rendered or replayed under the new session's credentials.
   */
  public setActiveRestaurant(restaurantId?: number | string | null) {
    const next =
      restaurantId === undefined || restaurantId === null || restaurantId === ""
        ? null
        : String(restaurantId);

    if (next === this.activeRestaurantId) return;

    const previous = this.activeRestaurantId;
    this.activeRestaurantId = next;

    if (previous !== null) {
      localStorage.removeItem(this.cacheKeyFor(previous));
      this.pendingActions.value = [];
      this.syncConflicts.value = [];
    }

    this.saveOfflineData();
  }

  public get currentRestaurantId(): string | null {
    return this.activeRestaurantId;
  }

  public cacheOrders(orders: KitchenOrder[], restaurantId?: number | string) {
    const scope = this.resolveRestaurantScope(restaurantId);
    if (!scope) {
      // No authenticated tenant — refuse to write an unowned cache.
      return;
    }

    try {
      localStorage.setItem(this.cacheKeyFor(scope), JSON.stringify(orders));
    } catch (error) {
      console.error("Failed to cache orders:", error);
    }
  }

  public getCachedOrders(restaurantId?: number | string): KitchenOrder[] {
    const scope = this.resolveRestaurantScope(restaurantId);
    if (!scope) return [];

    try {
      const cached = localStorage.getItem(this.cacheKeyFor(scope));
      return cached ? JSON.parse(cached) : [];
    } catch (error) {
      console.error("Failed to get cached orders:", error);
      return [];
    }
  }

  // Action queuing
  public queueAction(
    type: OfflineAction["type"],
    orderId: string | number,
    payload: OfflineActionPayload,
    itemId?: number,
  ): string {
    const action: OfflineAction = {
      id: this.generateActionId(),
      type,
      orderId,
      itemId,
      payload,
      timestamp: Date.now(),
      synced: false,
      retryCount: 0,
    };

    this.pendingActions.value.push(action);
    this.saveOfflineData();

    // Try to sync immediately if online
    if (this.isOnline.value) {
      this.syncPendingActions();
    }

    return action.id;
  }

  private generateActionId(): string {
    return `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Action application (optimistic updates)
  public applyActionLocally(action: OfflineAction) {
    const cachedOrders = this.getCachedOrders();
    const orderIndex = cachedOrders.findIndex((o) =>
      sameOrderId(o.id, action.orderId),
    );

    if (orderIndex === -1) return;

    const order = cachedOrders[orderIndex];

    switch (action.type) {
      case "start_cooking":
        if (action.itemId) {
          const item = order.items.find((i) => i.id === action.itemId);
          if (item) {
            item.status = "preparing";
          }
        }
        break;

      case "mark_ready":
        if (action.itemId) {
          const item = order.items.find((i) => i.id === action.itemId);
          if (item) {
            item.status = "ready";
          }
        }
        break;

      case "update_status":
        if (action.payload.status) {
          order.status = action.payload.status;
        }
        break;

      case "priority_change":
        if (action.payload.priority) {
          order.priority = action.payload.priority;
        }
        break;

      case "batch_operation":
        // Handle batch operations
        this.applyBatchOperation(order, action.payload);
        break;
    }

    // Update order's overall status based on items
    this.updateOrderStatus(order);

    // Save updated cached orders
    this.cacheOrders(cachedOrders);
  }

  private applyBatchOperation(
    order: KitchenOrder,
    payload: OfflineActionPayload,
  ) {
    switch (payload.operation) {
      case "start_all":
        order.items.forEach((item) => {
          if (item.status === "pending") {
            item.status = "preparing";
          }
        });
        break;

      case "complete_all":
        order.items.forEach((item) => {
          if (item.status === "preparing") {
            item.status = "ready";
          }
        });
        break;
    }
  }

  private updateOrderStatus(order: KitchenOrder) {
    const allReady = order.items.every((item) => item.status === "ready");
    const anyPreparing = order.items.some(
      (item) => item.status === "preparing",
    );

    if (allReady) {
      order.status = "ready"; // Ready
    } else if (anyPreparing) {
      order.status = "preparing"; // Preparing
    } else {
      order.status = "confirmed"; // Confirmed
    }
  }

  // Synchronization
  public async syncPendingActions(): Promise<void> {
    if (!this.canSync.value || this.pendingActions.value.length === 0) {
      return;
    }

    this.syncInProgress.value = true;
    const actionsToSync = [...this.pendingActions.value].filter(
      (a) => !a.synced,
    );

    try {
      for (const action of actionsToSync) {
        await this.syncSingleAction(action);
      }

      // Remove successfully synced actions
      this.pendingActions.value = this.pendingActions.value.filter(
        (a) => !a.synced,
      );
      this.lastSyncTime.value = Date.now();
    } catch (error) {
      console.error("Sync failed:", error);
    } finally {
      this.syncInProgress.value = false;
      this.saveOfflineData();
    }
  }

  private async syncSingleAction(action: OfflineAction): Promise<void> {
    try {
      const response = await this.sendActionToServer(action);

      if (response.success) {
        action.synced = true;
        action.error = undefined;
      } else if (response.conflict) {
        // Handle conflict
        this.handleSyncConflict(action, response.conflict);
      } else {
        throw new Error(response.error || "Sync failed");
      }
    } catch (error: unknown) {
      action.retryCount++;
      action.error = describeErrorForLog(error, "Sync failed");

      if (action.retryCount >= this.MAX_RETRY_ATTEMPTS) {
        console.error(
          `Action ${action.id} failed after ${this.MAX_RETRY_ATTEMPTS} attempts:`,
          error,
        );
        // Move to failed actions or handle differently
      }

      throw error;
    }
  }

  private async sendActionToServer(
    action: OfflineAction,
  ): Promise<OfflineSyncResponse> {
    const endpoint = this.getActionEndpoint(action);
    const payload = this.formatActionPayload(action);
    const method = this.getActionMethod(action);

    try {
      const response = await apiClient[method](endpoint, payload, {
        validateStatus: () => true,
      });

      return isRecord(response.data)
        ? {
            success: response.data.success !== false,
            error:
              typeof response.data.error === "string"
                ? response.data.error
                : undefined,
            conflict: isRecord(response.data.conflict)
              ? response.data.conflict
              : undefined,
          }
        : { success: true };
    } catch (error: unknown) {
      return {
        success: false,
        error: describeErrorForLog(error, "Offline action replay failed"),
      };
    }
  }

  private getActionEndpoint(action: OfflineAction): string {
    const restaurantId = action.payload?.restaurantId;

    switch (action.type) {
      case "start_cooking":
      case "mark_ready":
        if (!restaurantId) {
          throw new Error("Missing restaurantId for offline kitchen action");
        }
        return `/kitchen/${restaurantId}/orders/${action.orderId}/items/${action.itemId}`;
      case "update_status":
        return `/kitchen/${action.orderId}/status`;
      case "priority_change":
        return `/kitchen/${action.orderId}/priority`;
      case "batch_operation":
        return `/kitchen/${action.orderId}/batch`;
      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  private getActionMethod(action: OfflineAction): "post" | "put" {
    switch (action.type) {
      case "start_cooking":
      case "mark_ready":
        return "put";
      default:
        return "post";
    }
  }

  private formatActionPayload(action: OfflineAction): OfflineActionPayload {
    if (action.type === "start_cooking" || action.type === "mark_ready") {
      return { status: action.payload.status };
    }

    return {
      action: action.type,
      timestamp: action.timestamp,
      data: action.payload,
    };
  }

  // Conflict resolution
  private handleSyncConflict(
    action: OfflineAction,
    conflictData: NonNullable<OfflineSyncResponse["conflict"]>,
  ) {
    const conflict: SyncConflict = {
      id: `conflict_${action.id}`,
      type:
        conflictData.type === "order_updated" ||
        conflictData.type === "order_deleted" ||
        conflictData.type === "status_conflict"
          ? conflictData.type
          : "status_conflict",
      localData: action.payload,
      serverData: conflictData.serverData,
    };

    this.syncConflicts.value.push(conflict);
  }

  public resolveConflict(
    conflictId: string,
    resolution: "local" | "server" | "merge",
  ) {
    const conflictIndex = this.syncConflicts.value.findIndex(
      (c) => c.id === conflictId,
    );
    if (conflictIndex === -1) return;

    const conflict = this.syncConflicts.value[conflictIndex];
    conflict.resolution = resolution;

    // Apply resolution logic here
    switch (resolution) {
      case "local":
        // Keep local changes, retry sync
        break;
      case "server":
        // Accept server version, discard local changes
        this.discardLocalChanges(conflict);
        break;
      case "merge":
        // Attempt to merge changes
        this.mergeChanges(conflict);
        break;
    }

    // Remove resolved conflict
    this.syncConflicts.value.splice(conflictIndex, 1);
  }

  private discardLocalChanges(conflict: SyncConflict) {
    // Implementation would update cached data with server version
    console.log("Discarding local changes for conflict:", conflict.id);
  }

  private mergeChanges(conflict: SyncConflict) {
    // Implementation would merge local and server data intelligently
    console.log("Merging changes for conflict:", conflict.id);
  }

  // Periodic sync
  private startPeriodicSync() {
    this.syncInterval = setInterval(() => {
      if (this.isOnline.value && this.pendingActions.value.length > 0) {
        this.syncPendingActions();
      }
    }, this.SYNC_INTERVAL);
  }

  private stopPeriodicSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  // Manual sync control
  public async forcSync(): Promise<void> {
    await this.syncPendingActions();
  }

  public cancelSync() {
    this.syncInProgress.value = false;
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
  }

  // Data integrity
  public validateCachedData(): boolean {
    try {
      const cachedOrders = this.getCachedOrders();

      // Basic validation - check if orders have required fields
      return cachedOrders.every(
        (order) =>
          order.id &&
          order.orderNumber &&
          Array.isArray(order.items) &&
          typeof order.status === "string",
      );
    } catch (error) {
      console.error("Data validation failed:", error);
      return false;
    }
  }

  public repairData(): boolean {
    try {
      const cachedOrders = this.getCachedOrders();
      let repaired = false;

      // Repair missing or invalid data
      cachedOrders.forEach((order) => {
        if (!order.elapsedTime) {
          const now = Date.now();
          const createdTime = new Date(order.createdAt).getTime();
          order.elapsedTime = Math.floor((now - createdTime) / (1000 * 60));
          repaired = true;
        }

        if (!order.priority) {
          order.priority = "normal";
          repaired = true;
        }
      });

      if (repaired) {
        this.cacheOrders(cachedOrders);
      }

      return repaired;
    } catch (error) {
      console.error("Data repair failed:", error);
      return false;
    }
  }

  // Statistics
  public getOfflineStats() {
    return {
      pendingActions: this.pendingActions.value.length,
      failedActions: this.pendingActions.value.filter((a) => a.error).length,
      lastSyncTime: this.lastSyncTime.value,
      isOnline: this.isOnline.value,
      isOfflineMode: this.isOfflineMode.value,
      conflicts: this.syncConflicts.value.length,
    };
  }

  // Cleanup
  public clearOfflineData() {
    this.pendingActions.value = [];
    this.syncConflicts.value = [];
    this.activeRestaurantId = null;
    localStorage.removeItem(this.STORAGE_KEY);
    this.purgeCachedOrders();
  }

  /** Remove every tenant's cached orders, including the legacy unscoped key. */
  private purgeCachedOrders() {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(this.CACHED_ORDERS_PREFIX)) {
        keys.push(key);
      }
    }
    keys.forEach((key) => localStorage.removeItem(key));
  }

  public destroy() {
    this.stopPeriodicSync();
    this.cancelSync();

    window.removeEventListener("online", this.handleOnline.bind(this));
    window.removeEventListener("offline", this.handleOffline.bind(this));
    document.removeEventListener(
      "visibilitychange",
      this.handleVisibilityChange.bind(this),
    );
  }
}

// Create and export singleton instance
export const offlineService = new OfflineService();
export default offlineService;
