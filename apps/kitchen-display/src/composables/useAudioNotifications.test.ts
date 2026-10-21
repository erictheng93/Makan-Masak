/* eslint-disable vue/one-component-per-file -- Inline harness components keep
 * composable lifecycle tests colocated with each scenario. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { useAudioNotifications } from "./useAudioNotifications";
import { audioService } from "@/services/audioService";
import type { KitchenOrder, KitchenSSEEvent } from "@/types";

vi.mock("@/services/audioService", () => ({
  audioService: {
    playNewOrder: vi.fn(async () => undefined),
    playOrderReady: vi.fn(async () => undefined),
    playOrderComplete: vi.fn(async () => undefined),
    playWarning: vi.fn(async () => undefined),
    playSuccess: vi.fn(async () => undefined),
    playError: vi.fn(async () => undefined),
    play: vi.fn(async () => undefined),
    updateSettings: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    setMasterVolume: vi.fn(),
  },
}));

const kitchenEvent = (
  type: KitchenSSEEvent["type"],
  payload?: KitchenSSEEvent["payload"],
  data?: KitchenSSEEvent["data"],
): KitchenSSEEvent => ({
  type,
  ...(payload !== undefined ? { payload } : {}),
  data,
  timestamp: "2026-06-08T01:00:00.000Z",
  restaurantId: "restaurant-1",
});

describe("useAudioNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("plays new order audio for legacy and shared realtime event names", async () => {
    let notifications: ReturnType<typeof useAudioNotifications> | undefined;
    const wrapper = mount(
      defineComponent({
        setup() {
          notifications = useAudioNotifications();
          return () => null;
        },
      }),
    );

    await notifications!.handleSSEEvent(kitchenEvent("NEW_ORDER"));
    await notifications!.handleSSEEvent(kitchenEvent("new_order"));
    await notifications!.handleSSEEvent(
      kitchenEvent("new_order", { priority: "urgent" }),
    );

    expect(audioService.playNewOrder).toHaveBeenNthCalledWith(1, false);
    expect(audioService.playNewOrder).toHaveBeenNthCalledWith(2, false);
    expect(audioService.playNewOrder).toHaveBeenNthCalledWith(3, true);
    wrapper.unmount();
  });

  it("chimes once for an auto-accepted order but still for later edits and status-less events", async () => {
    let notifications: ReturnType<typeof useAudioNotifications> | undefined;
    const wrapper = mount(
      defineComponent({
        setup() {
          notifications = useAudioNotifications();
          return () => null;
        },
      }),
    );
    const orderId = "01928f6e-7c1a-7b2e-9a3d-4f5e6a7b8c9d";

    // Auto-accept: the confirmation is broadcast before the NEW_ORDER.
    await notifications!.handleSSEEvent(
      kitchenEvent("ORDER_STATUS_UPDATE", undefined, {
        orderId,
        status: "confirmed",
        previousStatus: "pending",
      }),
    );
    await notifications!.handleSSEEvent(
      kitchenEvent("NEW_ORDER", undefined, { orderId, status: "confirmed" }),
    );
    expect(audioService.playNewOrder).toHaveBeenCalledTimes(1);

    // An item edit re-sends NEW_ORDER(confirmed) with no confirmation first.
    await notifications!.handleSSEEvent(
      kitchenEvent("NEW_ORDER", undefined, { orderId, status: "confirmed" }),
    );
    // Seated waiting-list pre-orders and older servers carry no status.
    await notifications!.handleSSEEvent(
      kitchenEvent("NEW_ORDER", undefined, { orderId: "other-order" }),
    );
    // A pending order stays silent until it is confirmed.
    await notifications!.handleSSEEvent(
      kitchenEvent("NEW_ORDER", undefined, {
        orderId: "pending-order",
        status: "pending",
      }),
    );

    expect(audioService.playNewOrder).toHaveBeenCalledTimes(3);
    wrapper.unmount();
  });

  it("plays status audio from shared realtime data payloads", async () => {
    let notifications: ReturnType<typeof useAudioNotifications> | undefined;
    const wrapper = mount(
      defineComponent({
        setup() {
          notifications = useAudioNotifications();
          return () => null;
        },
      }),
    );

    await notifications!.handleSSEEvent(
      kitchenEvent("order_status_update", undefined, { status: "ready" }),
    );
    await notifications!.handleSSEEvent(
      kitchenEvent("order_status_update", undefined, { status: "completed" }),
    );

    expect(audioService.playOrderReady).toHaveBeenCalledTimes(1);
    expect(audioService.playOrderComplete).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("plays warning and urgent sounds from cancellation and priority events", async () => {
    let notifications: ReturnType<typeof useAudioNotifications> | undefined;
    const wrapper = mount(
      defineComponent({
        setup() {
          notifications = useAudioNotifications();
          return () => null;
        },
      }),
    );

    await notifications!.handleSSEEvent(kitchenEvent("order_cancelled"));
    await notifications!.handleSSEEvent(
      kitchenEvent("PRIORITY_UPDATE", { priority: "urgent" }),
    );

    expect(audioService.playWarning).toHaveBeenCalledTimes(1);
    expect(audioService.playNewOrder).toHaveBeenCalledWith(true);
    wrapper.unmount();
  });

  it("persists config, clamps volume, and toggles audio service state", () => {
    let notifications: ReturnType<typeof useAudioNotifications> | undefined;
    const wrapper = mount(
      defineComponent({
        setup() {
          notifications = useAudioNotifications();
          return () => null;
        },
      }),
    );

    notifications!.updateConfig({ enabled: false, volume: 0.25 });
    expect(audioService.updateSettings).toHaveBeenCalledWith({
      enabled: false,
      masterVolume: 0.25,
    });
    expect(
      JSON.parse(localStorage.getItem("kitchen-audio-notifications")!),
    ).toMatchObject({ enabled: false, volume: 0.25 });

    notifications!.setVolume(2);
    expect(audioService.setMasterVolume).toHaveBeenCalledWith(1);
    notifications!.disable();
    expect(audioService.disable).toHaveBeenCalledTimes(1);
    notifications!.toggle();
    expect(audioService.enable).toHaveBeenCalledTimes(1);
    notifications!.resetConfig();
    expect(notifications!.config.value).toMatchObject({
      enabled: true,
      volume: 0.7,
    });

    wrapper.unmount();
  });

  it("uses batch-size specific notification patterns", async () => {
    let notifications: ReturnType<typeof useAudioNotifications> | undefined;
    const wrapper = mount(
      defineComponent({
        setup() {
          notifications = useAudioNotifications();
          return () => null;
        },
      }),
    );

    await notifications!.handleBatchOperation(3);
    await notifications!.handleBatchOperation(6);
    await notifications!.handleBatchOperation(11);

    expect(audioService.playSuccess).toHaveBeenCalledTimes(1);
    expect(audioService.play).toHaveBeenCalledWith("chime", {
      repeat: 2,
      priority: "medium",
    });
    expect(audioService.play).toHaveBeenCalledWith("chime", {
      repeat: 3,
      priority: "high",
    });
    wrapper.unmount();
  });

  it("checks order timing thresholds for warning and near-complete sounds", async () => {
    vi.setSystemTime(new Date("2026-06-08T02:00:00.000Z"));
    let notifications: ReturnType<typeof useAudioNotifications> | undefined;
    const wrapper = mount(
      defineComponent({
        setup() {
          notifications = useAudioNotifications();
          return () => null;
        },
      }),
    );
    const orders = [
      {
        id: 1001,
        orderNumber: "A001",
        status: "confirmed",
        deliveryInfo: { type: "dine_in" },
        items: [],
        createdAt: "2026-06-08T01:20:00.000Z",
        totalItems: 0,
        priority: "normal",
        elapsedTime: 40,
      },
      {
        id: 1002,
        orderNumber: "A002",
        status: "preparing",
        deliveryInfo: { type: "dine_in" },
        items: [],
        createdAt: "2026-06-08T01:50:00.000Z",
        estimatedTime: 10,
        totalItems: 0,
        priority: "normal",
        elapsedTime: 10,
      },
    ] satisfies KitchenOrder[];

    await notifications!.checkOrderTimes(orders);

    expect(audioService.playWarning).toHaveBeenCalledTimes(1);
    expect(audioService.play).toHaveBeenCalledWith("notification", {
      priority: "low",
    });
    wrapper.unmount();
  });

  it("runs notification sound checks and monitoring timers", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    let notifications: ReturnType<typeof useAudioNotifications> | undefined;
    const wrapper = mount(
      defineComponent({
        setup() {
          notifications = useAudioNotifications();
          return () => null;
        },
      }),
    );
    const orders = [
      {
        id: 1001,
        orderNumber: "A001",
        status: "confirmed",
        deliveryInfo: { type: "dine_in" },
        items: [],
        createdAt: new Date(Date.now() - 31 * 60_000).toISOString(),
        totalItems: 0,
        priority: "normal",
        elapsedTime: 31,
      },
    ] satisfies KitchenOrder[];

    const testPromise = notifications!.testNotifications();
    await vi.advanceTimersByTimeAsync(5000);
    await testPromise;
    notifications!.startTimeMonitoring(orders);
    notifications!.startTimeMonitoring(orders);
    await vi.advanceTimersByTimeAsync(60_000);
    notifications!.stopTimeMonitoring();

    expect(console.log).toHaveBeenCalledWith("Testing: 新訂單");
    expect(audioService.playNewOrder).toHaveBeenCalledWith(false);
    expect(audioService.playNewOrder).toHaveBeenCalledWith(true);
    expect(audioService.playWarning).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("does not play disabled notification checks", async () => {
    let notifications: ReturnType<typeof useAudioNotifications> | undefined;
    const wrapper = mount(
      defineComponent({
        setup() {
          notifications = useAudioNotifications();
          return () => null;
        },
      }),
    );

    notifications!.disable();
    await notifications!.playErrorSound();
    await notifications!.testNotifications();
    await notifications!.checkOrderTimes([
      {
        id: 1001,
        orderNumber: "A001",
        status: "confirmed",
        deliveryInfo: { type: "dine_in" },
        items: [],
        createdAt: new Date(Date.now() - 31 * 60_000).toISOString(),
        totalItems: 0,
        priority: "normal",
        elapsedTime: 31,
      },
    ]);

    expect(audioService.playError).not.toHaveBeenCalled();
    expect(audioService.playWarning).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
