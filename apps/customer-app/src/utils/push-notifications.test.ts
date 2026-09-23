// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/customerIdentityApi", () => ({
  customerIdentityApi: { addPushSubscription: vi.fn() },
}));

const originalServiceWorker = Object.getOwnPropertyDescriptor(
  navigator,
  "serviceWorker",
);

describe("customer push notification service", () => {
  afterEach(() => {
    if (originalServiceWorker) {
      Object.defineProperty(navigator, "serviceWorker", originalServiceWorker);
    } else {
      Reflect.deleteProperty(navigator, "serviceWorker");
    }
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("does not ask permission when the VAPID public key is unset", async () => {
    const requestPermission = vi.fn(async () => "granted" as const);
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "");
    vi.stubGlobal("Notification", {
      permission: "default",
      requestPermission,
    });
    vi.stubGlobal("PushManager", class PushManager {});
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { ready: Promise.resolve({}) },
    });

    const { default: customerPushService } =
      await import("./push-notifications");

    await expect(customerPushService.requestPermission()).resolves.toBe(
      "denied",
    );
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
