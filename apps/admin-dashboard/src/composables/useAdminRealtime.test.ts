// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { RealtimeEventType } from "@makanmasak/shared-types";
import { useAdminRealtime } from "./useAdminRealtime";

// The failure paths below are driven on purpose and the code logs each one.
const silencedConsole: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  for (const method of ["log"] as const) {
    silencedConsole.push(
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
  }
});
afterEach(() => {
  silencedConsole.splice(0).forEach((spy) => spy.mockRestore());
});

const mocks = vi.hoisted(() => ({
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  listEmergencyAlerts: vi.fn(),
}));

vi.mock("@/services/websocketService", async () => {
  const { ref } = await import("vue");
  return {
    useWebSocketService: () => ({
      isConnected: ref(true),
      status: ref("connected"),
      subscribe: mocks.subscribe,
      unsubscribe: mocks.unsubscribe,
      connect: mocks.connect,
      disconnect: mocks.disconnect,
    }),
  };
});

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({
    isAuthenticated: true,
    restaurantId: ref("restaurant-1").value,
  }),
}));

vi.mock("@/services/ownerService", () => ({
  ownerService: { listEmergencyAlerts: mocks.listEmergencyAlerts },
}));

type Handler = (event: unknown) => void;

function systemEvent(notificationId: string, level = "warning") {
  return {
    type: RealtimeEventType.SYSTEM_NOTIFICATION,
    eventId: `evt-${notificationId}`,
    timestamp: 1_700_000_000_000,
    restaurantId: "restaurant-1",
    data: {
      notificationId,
      level,
      title: "Rice is below its minimum stock level",
      message: "Rice is at 2 kg.",
      alert: {
        alertType: "inventory_low",
        severity: "high",
        details: { name: "Rice" },
      },
    },
  };
}

async function setup() {
  let api!: ReturnType<typeof useAdminRealtime>;
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useAdminRealtime();
        return () => h("div");
      },
    }),
  );
  await flushPromises();
  const systemCall = mocks.subscribe.mock.calls.find((call) =>
    (call[0] as string[]).includes(RealtimeEventType.SYSTEM_NOTIFICATION),
  );
  return { api, wrapper, push: systemCall?.[1] as Handler };
}

describe("useAdminRealtime system alerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom does not implement media playback; the browser returns a promise.
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    mocks.subscribe.mockReturnValue("sub-1");
    mocks.connect.mockResolvedValue(undefined);
    mocks.listEmergencyAlerts.mockResolvedValue([]);
  });

  it("subscribes to system notifications and records a pushed alert", async () => {
    const { api, push } = await setup();

    expect(push).toBeTypeOf("function");
    push(systemEvent("alert-1"));

    expect(api.systemAlerts.value).toHaveLength(1);
    expect(api.systemAlerts.value[0]).toMatchObject({
      notificationId: "alert-1",
      level: "warning",
      read: false,
      alert: expect.objectContaining({
        alertType: "inventory_low",
        severity: "high",
        details: { name: "Rice" },
      }),
    });
    expect(api.unreadAlertCount.value).toBe(1);
  });

  it("does not list the same alert twice", async () => {
    mocks.listEmergencyAlerts.mockResolvedValue([
      {
        id: "alert-1",
        alertType: "inventory_low",
        severity: "high",
        title: "Rice is low",
        description: "Rice is at 2 kg.",
        details: null,
        createdAt: 1,
      },
    ]);
    const { api, push } = await setup();

    expect(api.systemAlerts.value).toHaveLength(1);
    push(systemEvent("alert-1"));

    expect(api.systemAlerts.value).toHaveLength(1);
  });

  it("keeps working when the open alerts cannot be loaded", async () => {
    mocks.listEmergencyAlerts.mockRejectedValue(new Error("403"));
    const { api, push } = await setup();

    push(systemEvent("alert-2", "error"));

    expect(api.systemAlerts.value.map((a) => a.notificationId)).toEqual([
      "alert-2",
    ]);
  });

  it("marks alerts read one at a time and all at once", async () => {
    const { api, push } = await setup();
    push(systemEvent("alert-1"));
    push(systemEvent("alert-2"));

    api.markAlertAsRead("alert-1");
    expect(api.unreadAlertCount.value).toBe(1);

    api.markAllAlertsAsRead();
    expect(api.unreadAlertCount.value).toBe(0);
  });
});
