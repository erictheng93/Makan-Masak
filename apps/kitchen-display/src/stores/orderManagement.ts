import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useSettingsStore } from "./settings";
import { useOrdersStore } from "./orders";
import { kitchenApi } from "@/services/kitchenApi";
import { sameOrderId } from "@/utils/orderId";
import type {
  KitchenOrder,
  KitchenOrderItem,
  OrderStatus,
  ItemStatus,
} from "@/types";

export interface OrderFilter {
  status?: OrderStatus[];
  priority?: ("normal" | "high" | "urgent")[];
  searchText?: string;
  minElapsedTime?: number;
  maxElapsedTime?: number;
  tableIds?: number[];
  hasNotes?: boolean;
  hasCustomizations?: boolean;
  orderTypes?: string[];
  orderSources?: string[];
}

export interface OrderSort {
  field: "createdAt" | "elapsedTime" | "priority" | "tableId" | "totalItems";
  direction: "asc" | "desc";
}

type OrderFilterValue = OrderFilter[keyof OrderFilter];

export const useOrderManagementStore = defineStore("orderManagement", () => {
  const settingsStore = useSettingsStore();

  // State
  const selectedOrders = ref<Set<string | number>>(new Set());
  const filters = ref<OrderFilter>({});
  const sortBy = ref<OrderSort>({
    field: "createdAt",
    direction: "asc",
  });
  const viewMode = ref<"card" | "list" | "compact">("card");
  const showCompletedOrders = ref(false);
  const autoRefreshEnabled = ref(true);

  // Selection Management
  const selectOrder = (orderId: string | number) => {
    selectedOrders.value.add(orderId);
  };

  const deselectOrder = (orderId: string | number) => {
    selectedOrders.value.delete(orderId);
  };

  const toggleOrderSelection = (orderId: string | number) => {
    if (selectedOrders.value.has(orderId)) {
      deselectOrder(orderId);
    } else {
      selectOrder(orderId);
    }
  };

  const selectAll = (orders: KitchenOrder[]) => {
    orders.forEach((order) => {
      selectedOrders.value.add(order.id);
    });
  };

  const deselectAll = () => {
    selectedOrders.value.clear();
  };

  const isOrderSelected = (orderId: string | number) => {
    return selectedOrders.value.has(orderId);
  };

  // Computed
  const selectedOrdersCount = computed(() => selectedOrders.value.size);
  const hasSelectedOrders = computed(() => selectedOrders.value.size > 0);

  // Filtering Logic
  const filterOrders = (orders: KitchenOrder[]): KitchenOrder[] => {
    let filtered = [...orders];

    // Status filter
    if (filters.value.status && filters.value.status.length > 0) {
      filtered = filtered.filter((order) =>
        filters.value.status!.includes(order.status),
      );
    }

    // Priority filter
    if (filters.value.priority && filters.value.priority.length > 0) {
      filtered = filtered.filter((order) =>
        filters.value.priority!.includes(order.priority),
      );
    }

    // Search text filter
    if (filters.value.searchText && filters.value.searchText.trim() !== "") {
      const searchText = filters.value.searchText.toLowerCase();
      filtered = filtered.filter((order) => {
        const matchesOrderNumber = order.orderNumber
          .toLowerCase()
          .includes(searchText);
        const matchesCustomerName = order.customerName
          ?.toLowerCase()
          .includes(searchText);
        const matchesTableName = order.tableName
          ?.toLowerCase()
          .includes(searchText);
        const matchesNotes = order.notes?.toLowerCase().includes(searchText);
        const matchesItemName = order.items.some((item) =>
          item.name.toLowerCase().includes(searchText),
        );

        return (
          matchesOrderNumber ||
          matchesCustomerName ||
          matchesTableName ||
          matchesNotes ||
          matchesItemName
        );
      });
    }

    // Elapsed time filter
    if (filters.value.minElapsedTime !== undefined) {
      filtered = filtered.filter(
        (order) => order.elapsedTime >= filters.value.minElapsedTime!,
      );
    }

    if (filters.value.maxElapsedTime !== undefined) {
      filtered = filtered.filter(
        (order) => order.elapsedTime <= filters.value.maxElapsedTime!,
      );
    }

    // Table filter
    if (filters.value.tableIds && filters.value.tableIds.length > 0) {
      filtered = filtered.filter(
        (order) =>
          order.tableId !== undefined &&
          filters.value.tableIds!.includes(order.tableId),
      );
    }

    // Has notes filter
    if (filters.value.hasNotes === true) {
      filtered = filtered.filter(
        (order) => order.notes && order.notes.trim() !== "",
      );
    } else if (filters.value.hasNotes === false) {
      filtered = filtered.filter(
        (order) => !order.notes || order.notes.trim() === "",
      );
    }

    // Has customizations filter
    if (filters.value.hasCustomizations === true) {
      filtered = filtered.filter((order) =>
        order.items.some(
          (item) => item.customizations && item.customizations.length > 0,
        ),
      );
    } else if (filters.value.hasCustomizations === false) {
      filtered = filtered.filter(
        (order) =>
          !order.items.some(
            (item) => item.customizations && item.customizations.length > 0,
          ),
      );
    }

    // Order types filter
    if (filters.value.orderTypes && filters.value.orderTypes.length > 0) {
      filtered = filtered.filter((order) => {
        const type = order.deliveryInfo?.type ?? "dine_in";
        return filters.value.orderTypes!.includes(type);
      });
    }

    // Order source filter
    if (filters.value.orderSources && filters.value.orderSources.length > 0) {
      filtered = filtered.filter((order) => {
        const source = order.orderSource ?? "direct";
        return filters.value.orderSources!.includes(source);
      });
    }

    return filtered;
  };

  // Sorting Logic
  const sortOrders = (orders: KitchenOrder[]): KitchenOrder[] => {
    const sorted = [...orders].sort((a, b) => {
      let comparison = 0;

      switch (sortBy.value.field) {
        case "createdAt":
          comparison =
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case "elapsedTime":
          comparison = a.elapsedTime - b.elapsedTime;
          break;
        case "priority": {
          const priorityOrder = { urgent: 3, high: 2, normal: 1 };
          comparison = priorityOrder[a.priority] - priorityOrder[b.priority];
          break;
        }
        case "tableId":
          comparison = (a.tableId ?? 0) - (b.tableId ?? 0);
          break;
        case "totalItems":
          comparison = a.totalItems - b.totalItems;
          break;
      }

      return sortBy.value.direction === "asc" ? comparison : -comparison;
    });

    return sorted;
  };

  // Priority Management
  const calculateOrderPriority = (
    order: KitchenOrder,
  ): "normal" | "high" | "urgent" => {
    const { urgentThreshold, warningThreshold } = settingsStore.settings;

    if (order.elapsedTime >= urgentThreshold) {
      return "urgent";
    } else if (order.elapsedTime >= warningThreshold) {
      return "high";
    } else {
      return "normal";
    }
  };

  const updateOrderPriorities = (orders: KitchenOrder[]): KitchenOrder[] => {
    return orders.map((order) => ({
      ...order,
      priority: calculateOrderPriority(order),
    }));
  };

  // Time Management
  const calculateElapsedTime = (order: KitchenOrder): number => {
    const createdTime = new Date(order.createdAt).getTime();
    const now = Date.now();
    return Math.floor((now - createdTime) / (1000 * 60)); // Minutes
  };

  const updateElapsedTimes = (orders: KitchenOrder[]): KitchenOrder[] => {
    return orders.map((order) => ({
      ...order,
      elapsedTime: calculateElapsedTime(order),
    }));
  };

  // Item Status Management
  const getNextItemStatus = (currentStatus: ItemStatus): ItemStatus => {
    const statusFlow: Record<ItemStatus, ItemStatus> = {
      pending: "preparing",
      preparing: "ready",
      ready: "completed",
      completed: "completed",
    };
    return statusFlow[currentStatus];
  };

  const canAdvanceItemStatus = (status: ItemStatus): boolean => {
    return status !== "ready" && status !== "completed";
  };

  const getItemsByStatus = (
    order: KitchenOrder,
    status: ItemStatus,
  ): KitchenOrderItem[] => {
    return order.items.filter((item) => item.status === status);
  };

  const getOrderProgress = (order: KitchenOrder): number => {
    const totalItems = order.items.length;
    if (totalItems === 0) return 0;

    const completedItems = order.items.filter(
      (item) => item.status === "ready" || item.status === "completed",
    ).length;

    return Math.round((completedItems / totalItems) * 100);
  };

  // Batch Operations
  const getSelectedOrdersData = (allOrders: KitchenOrder[]) => {
    return allOrders.filter((order) => selectedOrders.value.has(order.id));
  };

  const canBatchStartCooking = (orders: KitchenOrder[]): boolean => {
    return orders.some((order) =>
      order.items.some((item) => item.status === "pending"),
    );
  };

  const canBatchMarkReady = (orders: KitchenOrder[]): boolean => {
    return orders.some((order) =>
      order.items.some((item) => item.status === "preparing"),
    );
  };

  const getBatchOperationSummary = (orders: KitchenOrder[]) => {
    const totalOrders = orders.length;
    const totalItems = orders.reduce(
      (sum, order) => sum + order.items.length,
      0,
    );
    const pendingItems = orders.reduce(
      (sum, order) =>
        sum + order.items.filter((item) => item.status === "pending").length,
      0,
    );
    const preparingItems = orders.reduce(
      (sum, order) =>
        sum + order.items.filter((item) => item.status === "preparing").length,
      0,
    );

    return {
      totalOrders,
      totalItems,
      pendingItems,
      preparingItems,
    };
  };

  // Filter Management
  const setFilter = <K extends keyof OrderFilter>(
    key: K,
    value: OrderFilter[K],
  ) => {
    filters.value[key] = value;
  };

  const clearFilters = () => {
    filters.value = {};
  };

  const hasActiveFilters = computed(() => {
    return Object.keys(filters.value).some((key) => {
      const value = filters.value[key as keyof OrderFilter];
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      return value !== undefined && value !== null && value !== "";
    });
  });

  // Sort Management
  const setSorting = (
    field: OrderSort["field"],
    direction?: OrderSort["direction"],
  ) => {
    if (sortBy.value.field === field && !direction) {
      // Toggle direction if same field
      sortBy.value.direction =
        sortBy.value.direction === "asc" ? "desc" : "asc";
    } else {
      sortBy.value.field = field;
      sortBy.value.direction = direction || "asc";
    }
  };

  // View Management
  const setViewMode = (mode: "card" | "list" | "compact") => {
    viewMode.value = mode;
  };

  const toggleCompletedOrders = () => {
    showCompletedOrders.value = !showCompletedOrders.value;
  };

  // Auto-refresh Management
  const toggleAutoRefresh = () => {
    autoRefreshEnabled.value = !autoRefreshEnabled.value;
  };

  // Drag and Drop Status Management
  const moveOrderToStatus = (
    orderId: string | number,
    newStatus: "pending" | "preparing" | "ready",
  ) => {
    // This would trigger API calls to update order status
    // For now, we'll emit an event that the parent component can handle
    return { orderId, newStatus };
  };

  const batchStartAllItems = (orderId: string | number) => {
    // Start all pending items in an order
    return { orderId, action: "start_all" };
  };

  const batchCompleteAllItems = (orderId: string | number) => {
    // Complete all preparing items in an order
    return { orderId, action: "complete_all" };
  };

  // Quick Filters
  const quickFilters = {
    showUrgentOnly: () => {
      setFilter("priority", ["urgent"]);
    },
    showPendingOnly: () => {
      setFilter("status", ["confirmed"]);
    },
    showPreparingOnly: () => {
      setFilter("status", ["preparing"]);
    },
    showWithNotes: () => {
      setFilter("hasNotes", true);
    },
    showOverdue: () => {
      setFilter("minElapsedTime", settingsStore.settings.urgentThreshold);
    },
  };

  // Focus management for keyboard navigation
  const focusedOrderId = ref<string | number | null>(null);
  const focusedOrder = computed(() => {
    if (!focusedOrderId.value) return null;
    // This would need to be connected to the actual orders data
    return { id: focusedOrderId.value };
  });

  // Order operations
  const completeOrder = async (
    orderId: string | number,
    restaurantId?: number,
  ) => {
    const ordersStore = useOrdersStore();
    const restId = restaurantId || ordersStore.orders[0]?.id;

    if (!restId) {
      console.error("No restaurant ID available for completing order");
      return;
    }

    // Find the order to get all preparing items
    const order = ordersStore.orders.find((o) => sameOrderId(o.id, orderId));
    if (!order) {
      console.error(`Order ${orderId} not found`);
      return;
    }

    // Mark all preparing items as ready
    const preparingItems = order.items
      .filter((item) => item.status === "preparing")
      .map((item) => item.id);

    if (preparingItems.length > 0) {
      await ordersStore.markAllReady(restId, orderId);
    }

    console.log(`Order ${orderId} completed`);
  };

  const startCooking = async (
    orderId: string | number,
    restaurantId?: number,
  ) => {
    const ordersStore = useOrdersStore();
    const restId = restaurantId || ordersStore.orders[0]?.id;

    if (!restId) {
      console.error("No restaurant ID available for starting cooking");
      return;
    }

    // Find the order to get all pending items
    const order = ordersStore.orders.find((o) => sameOrderId(o.id, orderId));
    if (!order) {
      console.error(`Order ${orderId} not found`);
      return;
    }

    // Start all pending items
    await ordersStore.startAllItems(restId, orderId);
    console.log(`Started cooking for order ${orderId}`);
  };

  // Navigation methods
  const selectNextOrder = (allOrders: KitchenOrder[] = []) => {
    if (allOrders.length === 0) return;

    const currentIndex = focusedOrderId.value
      ? allOrders.findIndex((order) =>
          sameOrderId(order.id, focusedOrderId.value),
        )
      : -1;

    const nextIndex = (currentIndex + 1) % allOrders.length;
    focusedOrderId.value = allOrders[nextIndex]?.id || null;

    if (focusedOrderId.value) {
      selectOrder(focusedOrderId.value);
    }
  };

  const selectPreviousOrder = (allOrders: KitchenOrder[] = []) => {
    if (allOrders.length === 0) return;

    const currentIndex = focusedOrderId.value
      ? allOrders.findIndex((order) =>
          sameOrderId(order.id, focusedOrderId.value),
        )
      : -1;

    const prevIndex =
      currentIndex <= 0 ? allOrders.length - 1 : currentIndex - 1;
    focusedOrderId.value = allOrders[prevIndex]?.id || null;

    if (focusedOrderId.value) {
      selectOrder(focusedOrderId.value);
    }
  };

  const selectFirstOrder = (allOrders: KitchenOrder[] = []) => {
    if (allOrders.length === 0) return;
    focusedOrderId.value = allOrders[0]?.id || null;
    if (focusedOrderId.value) {
      selectOrder(focusedOrderId.value);
    }
  };

  const selectLastOrder = (allOrders: KitchenOrder[] = []) => {
    if (allOrders.length === 0) return;
    focusedOrderId.value = allOrders[allOrders.length - 1]?.id || null;
    if (focusedOrderId.value) {
      selectOrder(focusedOrderId.value);
    }
  };

  const selectAllVisibleOrders = (visibleOrders: KitchenOrder[] = []) => {
    visibleOrders.forEach((order) => selectOrder(order.id));
  };

  // Filter operations
  const applyFilter = (
    filterType: keyof OrderFilter,
    value: OrderFilterValue,
  ) => {
    setFilter(filterType, value as never);
  };

  // Refresh operations
  const refreshOrders = async (restaurantId?: number) => {
    const ordersStore = useOrdersStore();
    const restId = restaurantId || ordersStore.orders[0]?.id;

    if (!restId) {
      console.warn("No restaurant ID available for refreshing orders");
      return;
    }

    await ordersStore.fetchOrders(restId);
    console.log("Orders refreshed successfully");
  };

  // Batch operations
  const batchOperation = async (
    operation: string,
    orderIds: Array<string | number>,
    restaurantId?: number,
  ) => {
    const ordersStore = useOrdersStore();
    const restId = restaurantId || ordersStore.orders[0]?.id;

    if (!restId) {
      console.error("No restaurant ID available for batch operation");
      return;
    }

    const updates: Array<{
      orderId: string | number;
      itemId: number;
      status: ItemStatus;
    }> = [];

    // Collect all items that need to be updated based on operation type
    for (const orderId of orderIds) {
      const order = ordersStore.orders.find((o) => sameOrderId(o.id, orderId));
      if (!order) continue;

      for (const item of order.items) {
        if (operation === "start_cooking" && item.status === "pending") {
          updates.push({ orderId, itemId: item.id, status: "preparing" });
        } else if (operation === "mark_ready" && item.status === "preparing") {
          updates.push({ orderId, itemId: item.id, status: "ready" });
        } else if (operation === "complete" && item.status === "ready") {
          updates.push({ orderId, itemId: item.id, status: "completed" });
        }
      }
    }

    if (updates.length === 0) {
      console.log(`No items to update for operation: ${operation}`);
      return;
    }

    // Execute batch update via API
    const result = await kitchenApi.batchUpdateItemStatus(restId, updates);

    if (result.success) {
      console.log(
        `Batch operation ${operation} completed for ${updates.length} items`,
      );
      // Refresh orders to get the latest state
      await ordersStore.fetchOrders(restId);
    } else {
      console.error(`Batch operation ${operation} failed:`, result.error);
    }
  };

  // Reset all management state
  const resetManagementState = () => {
    deselectAll();
    clearFilters();
    sortBy.value = { field: "createdAt", direction: "asc" };
    viewMode.value = "card";
    showCompletedOrders.value = false;
    autoRefreshEnabled.value = true;
    focusedOrderId.value = null;
  };

  return {
    // State
    selectedOrders,
    filters,
    sortBy,
    viewMode,
    showCompletedOrders,
    autoRefreshEnabled,

    // Computed
    selectedOrdersCount,
    hasSelectedOrders,
    hasActiveFilters,

    // Selection methods
    selectOrder,
    deselectOrder,
    toggleOrderSelection,
    selectAll,
    deselectAll,
    isOrderSelected,

    // Processing methods
    filterOrders,
    sortOrders,
    calculateOrderPriority,
    updateOrderPriorities,
    calculateElapsedTime,
    updateElapsedTimes,

    // Item management
    getNextItemStatus,
    canAdvanceItemStatus,
    getItemsByStatus,
    getOrderProgress,

    // Batch operations
    getSelectedOrdersData,
    canBatchStartCooking,
    canBatchMarkReady,
    getBatchOperationSummary,

    // Drag and drop operations
    moveOrderToStatus,
    batchStartAllItems,
    batchCompleteAllItems,

    // Filter management
    setFilter,
    clearFilters,

    // Sort management
    setSorting,

    // View management
    setViewMode,
    toggleCompletedOrders,
    toggleAutoRefresh,

    // Quick filters
    quickFilters,

    // Focus management
    focusedOrderId,
    focusedOrder,

    // Order operations
    completeOrder,
    startCooking,

    // Navigation methods
    selectNextOrder,
    selectPreviousOrder,
    selectFirstOrder,
    selectLastOrder,
    selectAllVisibleOrders,

    // Filter operations
    applyFilter,

    // Refresh operations
    refreshOrders,

    // Batch operations
    batchOperation,

    // Reset
    resetManagementState,
  };
});
