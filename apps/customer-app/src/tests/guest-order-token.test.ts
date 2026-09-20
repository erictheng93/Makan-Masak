import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import {
  clearCustomerAccessToken,
  getCustomerAccessToken,
  setCustomerAccessToken,
} from "@/services/customerAccessToken";

// Keep orderApi, apiClient and axios' interceptor pipeline real. Replacing only
// the transport catches credentials overwritten after the service builds them.
const requests: InternalAxiosRequestConfig[] = [];
const replies: unknown[] = [];
let rejectNextRequest = false;
const originalAdapter = axios.defaults.adapter;
let orderApi: (typeof import("@/services/orderApi"))["orderApi"];

beforeAll(async () => {
  vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test/api/v1");
  axios.defaults.adapter = async (config) => {
    requests.push(config);
    if (rejectNextRequest) {
      rejectNextRequest = false;
      throw new AxiosError(
        "Expired token",
        "ERR_BAD_REQUEST",
        config,
        undefined,
        {
          data: { success: false, error: { code: "TOKEN_INVALID" } },
          status: 401,
          statusText: "Unauthorized",
          headers: {},
          config,
        },
      );
    }
    return {
      data: { success: true, data: replies.shift() },
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    };
  };
  ({ orderApi } = await import("@/services/orderApi"));
});

afterAll(() => {
  axios.defaults.adapter = originalAdapter;
  clearCustomerAccessToken();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  requests.length = 0;
  replies.length = 0;
  rejectNextRequest = false;
  localStorage.clear();
  clearCustomerAccessToken();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

async function placeGuestOrder(id: number, token: string) {
  replies.push({
    order: { id },
    guestToken: token,
    tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
  return orderApi.createGuestOrder({
    restaurantId: `restaurant-${id}`,
    guestName: "Diner",
    orderType: "shop",
    items: [{ menuItemId: id, quantity: 1 }],
  });
}

function lastAuthorization() {
  return requests.at(-1)?.headers.get("Authorization");
}

describe("guest order credentials through the real API client", () => {
  it("reads order A with its own token after placing order B", async () => {
    await placeGuestOrder(101, "gt_order_a");
    await placeGuestOrder(202, "gt_order_b");
    replies.push({ order: { id: 101 } });

    await expect(orderApi.getGuestOrder("101")).resolves.toEqual({ id: 101 });

    expect(lastAuthorization()).toBe("Bearer gt_order_a");
  });

  it("cancels order A with its own token after placing order B", async () => {
    await placeGuestOrder(101, "gt_order_a");
    await placeGuestOrder(202, "gt_order_b");
    replies.push({ order: { id: 101, status: "cancelled" } });

    await orderApi.cancelGuestOrder("101");

    expect(lastAuthorization()).toBe("Bearer gt_order_a");
  });

  it("keeps the guest order credential when the diner signs in", async () => {
    await placeGuestOrder(101, "gt_order_a");
    setCustomerAccessToken("customer-jwt");
    replies.push({ order: { id: 101 } });

    await orderApi.getGuestOrder("101");

    expect(lastAuthorization()).toBe("Bearer gt_order_a");
  });

  it("does not end the customer's session when an older guest credential expires", async () => {
    await placeGuestOrder(101, "gt_order_a");
    setCustomerAccessToken("customer-jwt");
    rejectNextRequest = true;
    await expect(orderApi.getGuestOrder("101")).rejects.toMatchObject({
      status: 401,
    });
    expect(lastAuthorization()).toBe("Bearer gt_order_a");
    expect(getCustomerAccessToken()).toBe("customer-jwt");
  });

  it("still clears an expired customer JWT on customer requests", async () => {
    setCustomerAccessToken("expired-customer-jwt");
    rejectNextRequest = true;
    await expect(orderApi.listMyMarketCheckouts()).rejects.toMatchObject({
      status: 401,
    });
    expect(getCustomerAccessToken()).toBeNull();
  });

  it("keeps the customer JWT on ordinary customer requests", async () => {
    await placeGuestOrder(101, "gt_order_a");
    setCustomerAccessToken("customer-jwt");
    replies.push([]);

    await orderApi.listMyMarketCheckouts();

    expect(lastAuthorization()).toBe("Bearer customer-jwt");
  });

  it("can still read orders saved with only the legacy guest credential", async () => {
    localStorage.setItem("guest_auth_token", "gt_legacy");
    replies.push({ order: { id: 101 } });

    await orderApi.getGuestOrder("101");

    expect(lastAuthorization()).toBe("Bearer gt_legacy");
  });

  it("preserves a proven legacy credential after a newer order is placed", async () => {
    localStorage.setItem("guest_auth_token", "gt_legacy_a");
    replies.push({ order: { id: 101 } });
    await orderApi.getGuestOrder("101");
    await placeGuestOrder(202, "gt_order_b");
    replies.push({ order: { id: 101 } });

    await orderApi.getGuestOrder("101");

    expect(lastAuthorization()).toBe("Bearer gt_legacy_a");
    expect(localStorage.getItem("guest_auth_token")).toBe("gt_order_b");
  });

  it("preserves a recovered market child credential after another order is placed", async () => {
    replies.push({
      orderId: 101,
      restaurantId: "restaurant-101",
      guestToken: "gt_recovered_a",
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    await orderApi.recoverMarketCheckoutGuestToken("checkout-1", {
      orderId: 101,
      phoneLastDigits: "1234",
    });
    await placeGuestOrder(202, "gt_order_b");
    replies.push({ order: { id: 101 } });

    await orderApi.getGuestOrder("101");

    expect(lastAuthorization()).toBe("Bearer gt_recovered_a");
  });

  it("uses the requested market child order token without activating another order", async () => {
    const tokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    replies.push({
      checkout: {
        id: "checkout-1",
        market: { id: "market-1", slug: "market", name: "Market" },
        status: "submitted",
        childOrders: [{ orderId: 101 }, { orderId: 202 }],
        subtotal: 200,
        createdAt: new Date().toISOString(),
      },
      childOrders: [101, 202].map((id) => ({
        restaurantId: `restaurant-${id}`,
        restaurantName: `Restaurant ${id}`,
        order: { id },
        guestToken: `gt_child_${id}`,
        tokenExpiresAt,
      })),
    });
    await orderApi.createMarketCheckout({
      marketSlug: "market",
      guestName: "Diner",
      phoneLastDigits: "1234",
      vendors: [101, 202].map((id) => ({
        restaurantId: `restaurant-${id}`,
        items: [{ menuItemId: id, quantity: 1 }],
      })),
    });
    replies.push({ order: { id: 202 } });

    await orderApi.getGuestOrder("202");

    expect(lastAuthorization()).toBe("Bearer gt_child_202");
  });
});
