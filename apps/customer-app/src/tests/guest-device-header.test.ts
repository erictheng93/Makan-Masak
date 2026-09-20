import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const requestInterceptors = vi.hoisted(
  () =>
    [] as Array<(config: Record<string, unknown>) => Record<string, unknown>>,
);

vi.mock("axios", () => {
  const instance = {
    interceptors: {
      request: {
        use: vi.fn((onFulfilled: (config: never) => never) => {
          requestInterceptors.push(
            onFulfilled as unknown as (typeof requestInterceptors)[number],
          );
          return requestInterceptors.length;
        }),
        eject: vi.fn(),
      },
      response: { use: vi.fn(() => 1), eject: vi.fn() },
    },
    request: vi.fn(),
  };
  return { default: { create: vi.fn(() => instance) } };
});

vi.mock("@/services/customerAccessToken", () => ({
  getCustomerAccessToken: vi.fn(() => null),
  clearCustomerAccessToken: vi.fn(),
  hasCustomerAccessToken: vi.fn(() => false),
}));

import { getCustomerAccessToken } from "@/services/customerAccessToken";

/** Run the request interceptor the way axios would, and hand back the headers. */
function headersFor(url: string) {
  const config = { url, method: "post", headers: {} as Record<string, string> };
  for (const interceptor of requestInterceptors) interceptor(config);
  return config.headers;
}

describe("guest device identity header", () => {
  beforeAll(async () => {
    // The api client registers its interceptors at module load; pay that
    // import once here rather than inside a timed test body.
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8787/api/v1");
    await import("@/services/api");
  }, 30_000);

  beforeEach(() => {
    localStorage.clear();
    vi.mocked(getCustomerAccessToken).mockReturnValue(null);
  });

  it("sends a device id on the guest ordering endpoints", () => {
    const deviceId = headersFor("/guest-orders")["X-Guest-Device-Id"];
    expect(deviceId).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(headersFor("/market-checkouts")["X-Guest-Device-Id"]).toBe(deviceId);
    expect(headersFor("/coupons/validate")["X-Guest-Device-Id"]).toBe(deviceId);
    expect(localStorage.getItem("guest_device_id")).toBe(deviceId);
  });

  it("keeps sending it once the shopper signs in", () => {
    // Market checkout runs through the guest route even for a signed-in
    // shopper, whose customer JWT takes over the Authorization header. The
    // device id is the only identity left for the server's active-order lock.
    const anonymousDeviceId =
      headersFor("/market-checkouts")["X-Guest-Device-Id"];
    vi.mocked(getCustomerAccessToken).mockReturnValue("customer-jwt");

    const headers = headersFor("/market-checkouts");
    expect(headers.Authorization).toBe("Bearer customer-jwt");
    expect(headers["X-Guest-Device-Id"]).toBe(anonymousDeviceId);
  });

  it("does not change the identity of a signed-in coupon preview", () => {
    vi.mocked(getCustomerAccessToken).mockReturnValue("customer-jwt");
    const headers = headersFor("/coupons/validate");
    expect(headers.Authorization).toBe("Bearer customer-jwt");
    expect(headers).not.toHaveProperty("X-Guest-Device-Id");
  });

  it("does not attach it to unrelated requests", () => {
    expect(headersFor("/menu/restaurant-1")).not.toHaveProperty(
      "X-Guest-Device-Id",
    );
    expect(headersFor("/markets")).not.toHaveProperty("X-Guest-Device-Id");
    // Nothing was created for a visitor who only browses.
    expect(localStorage.getItem("guest_device_id")).toBeNull();
  });

  it("reuses a stored device id and replaces a corrupted one", () => {
    localStorage.setItem("guest_device_id", "stored-device-id-0123456789");
    expect(headersFor("/guest-orders")["X-Guest-Device-Id"]).toBe(
      "stored-device-id-0123456789",
    );

    localStorage.setItem("guest_device_id", "too-short");
    const replacement = headersFor("/guest-orders")["X-Guest-Device-Id"];
    expect(replacement).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(replacement).not.toBe("too-short");
  });
});
