import { ref, computed, onMounted, onUnmounted } from "vue";
import { audioService } from "@/services/audioService";
import type { KitchenOrder, KitchenSSEEvent } from "@/types";
import { isRecord } from "@/utils/unknown";

export interface AudioNotificationConfig {
  newOrderSound: boolean;
  urgentOrderSound: boolean;
  orderReadySound: boolean;
  orderCompleteSound: boolean;
  warningSound: boolean;
  successSound: boolean;
  errorSound: boolean;
  volume: number;
  enabled: boolean;
}

export function useAudioNotifications() {
  // State
  const isEnabled = ref(true);
  const config = ref<AudioNotificationConfig>({
    newOrderSound: true,
    urgentOrderSound: true,
    orderReadySound: true,
    orderCompleteSound: true,
    warningSound: true,
    successSound: true,
    errorSound: true,
    volume: 0.7,
    enabled: true,
  });

  // Load saved config from localStorage (must be defined before being called)
  const loadConfig = () => {
    const saved = localStorage.getItem("kitchen-audio-notifications");
    if (saved) {
      try {
        config.value = { ...config.value, ...JSON.parse(saved) };
      } catch (error) {
        console.error("Failed to parse audio notification config:", error);
        // Keep default config if parsing fails
      }
    }
  };

  // Initialize: load saved config immediately
  loadConfig();

  // Methods
  const playNewOrderSound = async (isUrgent = false) => {
    if (!isEnabled.value || !config.value.enabled) return;

    try {
      if (isUrgent && config.value.urgentOrderSound) {
        await audioService.playNewOrder(true);
      } else if (config.value.newOrderSound) {
        await audioService.playNewOrder(false);
      }
    } catch (error) {
      console.error("Failed to play new order sound:", error);
    }
  };

  const playOrderReadySound = async () => {
    if (
      !isEnabled.value ||
      !config.value.enabled ||
      !config.value.orderReadySound
    )
      return;

    try {
      await audioService.playOrderReady();
    } catch (error) {
      console.error("Failed to play order ready sound:", error);
    }
  };

  const playOrderCompleteSound = async () => {
    if (
      !isEnabled.value ||
      !config.value.enabled ||
      !config.value.orderCompleteSound
    )
      return;

    try {
      await audioService.playOrderComplete();
    } catch (error) {
      console.error("Failed to play order complete sound:", error);
    }
  };

  const playWarningSound = async () => {
    if (!isEnabled.value || !config.value.enabled || !config.value.warningSound)
      return;

    try {
      await audioService.playWarning();
    } catch (error) {
      console.error("Failed to play warning sound:", error);
    }
  };

  const playSuccessSound = async () => {
    if (!isEnabled.value || !config.value.enabled || !config.value.successSound)
      return;

    try {
      await audioService.playSuccess();
    } catch (error) {
      console.error("Failed to play success sound:", error);
    }
  };

  const playErrorSound = async () => {
    if (!isEnabled.value || !config.value.enabled || !config.value.errorSound)
      return;

    try {
      await audioService.playError();
    } catch (error) {
      console.error("Failed to play error sound:", error);
    }
  };

  // Auto-accept confirms through the status path before the order is
  // announced, so the server sends ORDER_STATUS_UPDATE(confirmed) and then a
  // NEW_ORDER(confirmed) for the same order. A confirmed NEW_ORDER is not a
  // duplicate in general -- item edits re-send it and that chime is wanted --
  // so only the one that closely follows a confirmation chime is skipped.
  const CONFIRM_ANNOUNCE_WINDOW_MS = 10_000;
  const recentlyConfirmed = new Map<string, number>();

  const consumeRecentConfirmation = (orderId: unknown): boolean => {
    if (orderId === undefined || orderId === null) return false;
    const key = String(orderId);
    const at = recentlyConfirmed.get(key);
    if (at === undefined) return false;
    recentlyConfirmed.delete(key);
    return Date.now() - at <= CONFIRM_ANNOUNCE_WINDOW_MS;
  };

  const rememberConfirmation = (orderId: unknown) => {
    if (orderId === undefined || orderId === null) return;
    const now = Date.now();
    for (const [key, at] of recentlyConfirmed) {
      if (now - at > CONFIRM_ANNOUNCE_WINDOW_MS) recentlyConfirmed.delete(key);
    }
    recentlyConfirmed.set(String(orderId), now);
  };

  // SSE Event Handlers
  const handleSSEEvent = async (event: KitchenSSEEvent) => {
    const rawEventData = event.payload ?? event.data;
    const eventData = isRecord(rawEventData) ? rawEventData : {};

    switch (event.type) {
      case "NEW_ORDER":
      case "new_order":
        // A pending order is not on the board yet; it chimes when confirmed.
        if (eventData.status === "pending") break;
        // Missing status (older servers, seated waiting-list pre-orders) has
        // no preceding confirmation event, so it still chimes.
        if (
          eventData.status === "confirmed" &&
          consumeRecentConfirmation(eventData.orderId ?? event.orderId)
        ) {
          break;
        }
        await playNewOrderSound(eventData.priority === "urgent");
        break;
      case "ORDER_STATUS_UPDATE":
      case "order_status_update":
        if (eventData.status === "confirmed") {
          rememberConfirmation(eventData.orderId ?? event.orderId);
          await playNewOrderSound();
        } else if (eventData.status === "ready") {
          await playOrderReadySound();
        } else if (eventData.status === "completed") {
          await playOrderCompleteSound();
        }
        break;
      case "ORDER_CANCELLED":
      case "order_cancelled":
        await playWarningSound();
        break;
      case "PRIORITY_UPDATE":
        if (eventData.priority === "urgent") {
          await playNewOrderSound(true);
        }
        break;
    }
  };

  // Order Event Handlers
  const handleOrderStartCooking = async () => {
    await playSuccessSound();
  };

  const handleOrderMarkReady = async () => {
    await playOrderReadySound();
  };

  const handleOrderComplete = async () => {
    await playOrderCompleteSound();
  };

  const handleBatchOperation = async (count: number) => {
    // Play different sounds based on batch size
    if (count > 10) {
      await audioService.play("chime", { repeat: 3, priority: "high" });
    } else if (count > 5) {
      await audioService.play("chime", { repeat: 2, priority: "medium" });
    } else {
      await playSuccessSound();
    }
  };

  // Time-based notifications
  const checkOrderTimes = async (orders: KitchenOrder[]) => {
    if (!isEnabled.value) return;

    const now = Date.now();
    const overdueOrders = orders.filter((order) => {
      const elapsedMinutes = Math.floor(
        (now - new Date(order.createdAt).getTime()) / (1000 * 60),
      );
      return elapsedMinutes >= 30 && order.status !== "ready"; // Not ready yet
    });

    if (overdueOrders.length > 0) {
      await playWarningSound();
    }

    // Check for orders approaching estimated completion time
    const nearCompletionOrders = orders.filter((order) => {
      const elapsedMinutes = Math.floor(
        (now - new Date(order.createdAt).getTime()) / (1000 * 60),
      );
      const estimatedTime = order.estimatedTime || 15;
      return (
        elapsedMinutes >= estimatedTime * 0.8 && order.status === "preparing"
      ); // Still preparing
    });

    if (nearCompletionOrders.length > 0) {
      await audioService.play("notification", { priority: "low" });
    }
  };

  // Configuration management
  const updateConfig = (newConfig: Partial<AudioNotificationConfig>) => {
    config.value = { ...config.value, ...newConfig };
    localStorage.setItem(
      "kitchen-audio-notifications",
      JSON.stringify(config.value),
    );

    // Update audio service settings
    audioService.updateSettings({
      enabled: config.value.enabled,
      masterVolume: config.value.volume,
    });
  };

  const resetConfig = () => {
    config.value = {
      newOrderSound: true,
      urgentOrderSound: true,
      orderReadySound: true,
      orderCompleteSound: true,
      warningSound: true,
      successSound: true,
      errorSound: true,
      volume: 0.7,
      enabled: true,
    };
    updateConfig(config.value);
  };

  // Enable/disable methods
  const enable = () => {
    isEnabled.value = true;
    audioService.enable();
  };

  const disable = () => {
    isEnabled.value = false;
    audioService.disable();
  };

  const toggle = () => {
    if (isEnabled.value) {
      disable();
    } else {
      enable();
    }
  };

  // Volume control
  const setVolume = (volume: number) => {
    config.value.volume = Math.max(0, Math.min(1, volume));
    audioService.setMasterVolume(config.value.volume);
    updateConfig({ volume: config.value.volume });
  };

  // Testing methods
  const testNotifications = async () => {
    if (!isEnabled.value) return;

    const tests = [
      { name: "新訂單", fn: () => playNewOrderSound() },
      { name: "緊急訂單", fn: () => playNewOrderSound(true) },
      { name: "訂單準備完成", fn: () => playOrderReadySound() },
      { name: "訂單完成", fn: () => playOrderCompleteSound() },
      { name: "成功操作", fn: () => playSuccessSound() },
    ];

    for (const test of tests) {
      console.log(`Testing: ${test.name}`);
      await test.fn();
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait between tests
    }
  };

  // Time-based monitoring
  let timeCheckInterval: NodeJS.Timeout | null = null;

  const startTimeMonitoring = (orders: KitchenOrder[]) => {
    if (timeCheckInterval) return;

    timeCheckInterval = setInterval(() => {
      checkOrderTimes(orders);
    }, 60000); // Check every minute
  };

  const stopTimeMonitoring = () => {
    if (timeCheckInterval) {
      clearInterval(timeCheckInterval);
      timeCheckInterval = null;
    }
  };

  // Computed
  const isAudioEnabled = computed(
    () => isEnabled.value && config.value.enabled,
  );
  const currentVolume = computed(() => config.value.volume);

  // Lifecycle
  onMounted(() => {
    loadConfig();
  });

  onUnmounted(() => {
    stopTimeMonitoring();
  });

  return {
    // State
    isEnabled: isAudioEnabled,
    config,
    currentVolume,

    // Methods
    playNewOrderSound,
    playOrderReadySound,
    playOrderCompleteSound,
    playWarningSound,
    playSuccessSound,
    playErrorSound,

    // Event Handlers
    handleSSEEvent,
    handleOrderStartCooking,
    handleOrderMarkReady,
    handleOrderComplete,
    handleBatchOperation,

    // Configuration
    updateConfig,
    resetConfig,

    // Control
    enable,
    disable,
    toggle,
    setVolume,

    // Testing
    testNotifications,

    // Monitoring
    startTimeMonitoring,
    stopTimeMonitoring,
    checkOrderTimes,
  };
}
