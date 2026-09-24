import { beforeEach, describe, expect, it, vi } from "vitest";
import { UberEatsAdapter } from "./UberEatsAdapter";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

function textResponse(body: string, init: ResponseInit = {}) {
  const status = init.status ?? 200;
  const responseBody = [204, 205, 304].includes(status) ? null : body;
  return new Response(responseBody, { status, headers: init.headers });
}

async function hmacSha256Hex(secret: string, body: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function createAdapter() {
  return new UberEatsAdapter();
}

describe("UberEatsAdapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("verifies Uber webhook HMAC signatures", async () => {
    const body = JSON.stringify({ id: "order-1" });
    const signature = await hmacSha256Hex("secret", body);
    const validRequest = new Request("https://example.test/webhook", {
      method: "POST",
      headers: { "X-Uber-Signature": signature },
      body,
    });
    const invalidRequest = new Request("https://example.test/webhook", {
      method: "POST",
      headers: { "X-Uber-Signature": "bad" },
      body,
    });
    const missingRequest = new Request("https://example.test/webhook", {
      method: "POST",
      body,
    });

    await expect(
      createAdapter().verifyWebhook(validRequest, "secret"),
    ).resolves.toBe(true);
    await expect(
      createAdapter().verifyWebhook(invalidRequest, "secret"),
    ).resolves.toBe(false);
    await expect(
      createAdapter().verifyWebhook(missingRequest, "secret"),
    ).resolves.toBe(false);
  });

  it("converts MYR minor units once and reads selected modifier items", async () => {
    const payload = {
      id: "uber-order-1",
      store: { id: "store-1" },
      eater: { first_name: "Mina", phone: "0912345678" },
      delivery_info: { location: { address: "1 Main Street" } },
      cart: {
        special_instructions: "Separate the hot sauce",
        items: [
          {
            id: "item-1",
            title: "Laksa",
            special_instructions: "No peanuts",
            quantity: 2,
            price: { unit_price: { amount: 1250, currency_code: "MYR" } },
            selected_modifier_groups: [
              {
                id: "extra",
                title: "Extras",
                selected_items: [
                  {
                    id: "egg",
                    title: "Extra egg",
                    price: {
                      unit_price: { amount: 150, currency_code: "MYR" },
                    },
                  },
                ],
              },
            ],
          },
          {
            title: undefined,
            price: { unit_price: { amount: 0, currency_code: "MYR" } },
          },
        ],
      },
      payment: {
        charges: {
          total: { amount: 3000, currency_code: "MYR" },
          sub_total: { amount: 2500, currency_code: "MYR" },
          tax: { amount: 500, currency_code: "MYR" },
        },
      },
    };

    await expect(createAdapter().parseOrder(payload)).resolves.toEqual({
      platformOrderId: "uber-order-1",
      platformStoreId: "store-1",
      currencyCode: "MYR",
      customerName: "Mina",
      customerPhone: "0912345678",
      deliveryAddress: "1 Main Street",
      totalAmountCents: 3000,
      subtotalCents: 2500,
      taxAmountCents: 500,
      platformStatus: "received",
      notes: "Separate the hot sauce",
      rawPayload: payload,
      items: [
        {
          platformItemId: "item-1",
          name: "Laksa",
          quantity: 2,
          unitPriceCents: 1250,
          totalPriceCents: 2500,
          notes: "No peanuts",
          customizations: [
            {
              name: "Extras",
              value: "Extra egg",
              priceAdjustmentCents: 150,
            },
          ],
        },
        {
          platformItemId: "",
          name: "",
          quantity: 1,
          unitPriceCents: 0,
          totalPriceCents: 0,
          customizations: [],
        },
      ],
    });
  });

  it("rejects TWD until its Uber sandbox amount unit is verified", async () => {
    const payload = {
      id: "twd-order",
      cart: {
        items: [
          {
            id: "tea",
            price: { unit_price: { amount: 18000, currency_code: "TWD" } },
          },
        ],
      },
      payment: {
        charges: {
          total: { amount: 18000, currency_code: "TWD" },
          sub_total: { amount: 18000, currency_code: "TWD" },
        },
      },
    };
    await expect(createAdapter().parseOrder(payload)).rejects.toThrow(
      "TWD amount unit is unverified",
    );
    payload.cart.items[0].price.unit_price.amount = 100;
    payload.payment.charges.total.amount = 100;
    payload.payment.charges.sub_total.amount = 100;
    await expect(createAdapter().parseOrder(payload)).rejects.toThrow(
      "TWD amount unit is unverified",
    );
  });

  it("rejects mixed MYR currencies within one Uber order", async () => {
    await expect(
      createAdapter().parseOrder({
        id: "mixed-order",
        cart: {
          items: [
            {
              id: "tea",
              price: { unit_price: { amount: 100, currency_code: "TWD" } },
            },
          ],
        },
        payment: { charges: { total: { amount: 100, currency_code: "MYR" } } },
      }),
    ).rejects.toThrow("currency mismatch");
  });

  it("rejects missing or fractional Uber amounts before creating an order", async () => {
    const payload = {
      id: "bad-order",
      cart: { items: [] },
      payment: { charges: { total: { amount: 1399 } } },
    };
    await expect(createAdapter().parseOrder(payload)).rejects.toThrow(
      "currency",
    );
    payload.payment.charges.total = {
      amount: 13.99,
      currency_code: "MYR",
    } as never;
    await expect(createAdapter().parseOrder(payload)).rejects.toThrow(
      "integer",
    );
  });

  it("rejects an incomplete order instead of persisting zero totals", async () => {
    const total = { amount: 1399, currency_code: "MYR" };
    await expect(
      createAdapter().parseOrder({
        id: "order-1",
        payment: { charges: { total } },
      }),
    ).rejects.toThrow("missing id, items, or total");
    await expect(
      createAdapter().parseOrder({ id: "order-1", cart: { items: [] } }),
    ).rejects.toThrow("missing id, items, or total");
  });

  it("rejects an unsafe Uber item quantity before writing cents", async () => {
    await expect(
      createAdapter().parseOrder({
        id: "order-1",
        cart: {
          items: [
            {
              id: "item-1",
              quantity: 1.5,
              price: { unit_price: { amount: 500, currency_code: "MYR" } },
            },
          ],
        },
        payment: { charges: { total: { amount: 500, currency_code: "MYR" } } },
      }),
    ).rejects.toThrow("quantity");
    await expect(
      createAdapter().parseOrder({
        id: "order-1",
        cart: { items: [{ id: "item-1", quantity: 1 }] },
        payment: { charges: { total: { amount: 500, currency_code: "MYR" } } },
      }),
    ).rejects.toThrow("unit price is missing");
  });

  it("parses cancellation notifications without treating them as carts", async () => {
    await expect(
      createAdapter().parseCancellation({
        order: { id: "uber-order-cancelled" },
        reason: "customer_cancelled",
      }),
    ).resolves.toEqual({
      platformOrderId: "uber-order-cancelled",
      reason: "customer_cancelled",
    });
  });

  it("rejects cancellation notifications without a string order id", async () => {
    await expect(
      createAdapter().parseCancellation({ order_id: 42 }),
    ).rejects.toThrow("missing an order id");
  });

  it("refreshes access tokens and reports token refresh failures", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "token-1", expires_in: 600 }),
      )
      .mockResolvedValueOnce(textResponse("bad credentials", { status: 401 }));
    vi.spyOn(Date, "now").mockReturnValue(1710000000000);

    await expect(
      createAdapter().refreshToken({
        clientId: "client-1",
        clientSecret: "secret-1",
      }),
    ).resolves.toMatchObject({
      clientId: "client-1",
      clientSecret: "secret-1",
      accessToken: "token-1",
      tokenExpiresAt: 1710000600000,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://login.uber.com/oauth/v2/token",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: expect.any(URLSearchParams),
      }),
    );

    await expect(
      createAdapter().refreshToken({
        clientId: "client-1",
        clientSecret: "bad",
      }),
    ).rejects.toThrow("Uber Eats token refresh failed (401): bad credentials");
  });

  it("sends order action requests with existing valid tokens and surfaces API errors", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(textResponse("", { status: 204 }))
      .mockResolvedValueOnce(textResponse("", { status: 204 }))
      .mockResolvedValueOnce(textResponse("", { status: 204 }))
      .mockResolvedValueOnce(textResponse("denied", { status: 409 }));
    vi.spyOn(Date, "now").mockReturnValue(1710000000000);
    const creds = {
      accessToken: "token-1",
      tokenExpiresAt: 1710001000000,
    };

    await createAdapter().acceptOrder("order-1", creds);
    await createAdapter().denyOrder("order-2", "out of stock", creds);
    await createAdapter().cancelOrder("order-3", "closed", creds);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.uber.com/v2/eats/orders/order-1/accept_pos_order",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer token-1",
        }),
        body: JSON.stringify({ reason: "accepted" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.uber.com/v2/eats/orders/order-2/deny_pos_order",
      expect.objectContaining({
        body: JSON.stringify({ reason: { explanation: "out of stock" } }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://api.uber.com/v2/eats/orders/order-3/cancel",
      expect.objectContaining({
        body: JSON.stringify({
          reason: "closed",
          cancelling_party: "MERCHANT",
        }),
      }),
    );
    await expect(
      createAdapter().denyOrder("order-4", "duplicate", creds),
    ).rejects.toThrow("Failed to deny Uber Eats order order-4 (409): denied");
  });

  it("refreshes expired tokens before order actions", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "fresh", expires_in: 600 }),
      )
      .mockResolvedValueOnce(textResponse("", { status: 204 }));
    vi.spyOn(Date, "now").mockReturnValue(1710000000000);

    await createAdapter().acceptOrder("order-1", {
      clientId: "client-1",
      clientSecret: "secret-1",
      accessToken: "old",
      tokenExpiresAt: 1710000000000,
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.uber.com/v2/eats/orders/order-1/accept_pos_order",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer fresh" }),
      }),
    );
  });

  it("fetches Uber order details by validated ID with a bearer token", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({ id: "order-1", store: { id: "store-1" } }),
      );
    vi.spyOn(Date, "now").mockReturnValue(1710000000000);
    const creds = { accessToken: "token-1", tokenExpiresAt: 1710001000000 };
    await expect(
      createAdapter().fetchOrder("order-1", creds),
    ).resolves.toMatchObject({
      id: "order-1",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.uber.com/v2/eats/order/order-1",
      expect.objectContaining({ headers: { Authorization: "Bearer token-1" } }),
    );
    await expect(createAdapter().fetchOrder("../other", creds)).rejects.toThrow(
      "Invalid Uber Eats order id",
    );
  });

  it("uploads Uber menu schema with minor-unit prices and accepts 204", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(textResponse("", { status: 204 }));
    vi.spyOn(Date, "now").mockReturnValue(1710000000000);

    await expect(
      createAdapter().syncMenu(
        {
          restaurantId: "restaurant-1",
          currencyCode: "MYR",
          serviceAvailability: [
            {
              day_of_week: "monday",
              time_periods: [{ start_time: "09:00", end_time: "17:00" }],
            },
          ],
          categories: [
            {
              id: 1,
              name: "Noodles",
              items: [
                {
                  id: 101,
                  name: "Laksa",
                  priceCents: 1399,
                  available: true,
                  modifierGroups: [
                    {
                      id: "spice",
                      name: "Spice",
                      required: false,
                      minSelections: 0,
                      maxSelections: 1,
                      modifiers: [{ id: "hot", name: "Hot", priceCents: 150 }],
                    },
                  ],
                },
              ],
            },
          ],
        } as never,
        {
          storeId: "store-1",
          accessToken: "token-1",
          tokenExpiresAt: 1710001000000,
        },
      ),
    ).resolves.toEqual({
      success: true,
      syncedItems: 1,
      platformItemIds: { 101: "101" },
    });

    const requestBody = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(requestBody).toMatchObject({
      menus: [
        {
          category_ids: ["1"],
          service_availability: [{ day_of_week: "monday" }],
        },
      ],
      categories: [{ id: "1", entities: [{ id: "101", type: "ITEM" }] }],
      items: [
        {
          id: "101",
          price_info: { price: 1399 },
          modifier_group_ids: { ids: ["101-spice"] },
        },
        { id: "101-spice-hot", price_info: { price: 150 } },
      ],
      modifier_groups: [
        {
          id: "101-spice",
          modifier_options: [{ id: "101-spice-hot", type: "ITEM" }],
        },
      ],
    });

    await expect(
      createAdapter().syncMenu(
        {
          restaurantId: "restaurant-1",
          currencyCode: "MYR",
          serviceAvailability: [
            {
              day_of_week: "monday",
              time_periods: [{ start_time: "09:00", end_time: "17:00" }],
            },
          ],
          categories: [],
        },
        {
          accessToken: "token-1",
          tokenExpiresAt: 1710001000000,
        },
      ),
    ).rejects.toThrow("storeId is required for menu sync");
  });

  it("reports menu sync API failures", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      textResponse("invalid menu", { status: 400 }),
    );
    vi.spyOn(Date, "now").mockReturnValue(1710000000000);

    await expect(
      createAdapter().syncMenu(
        {
          restaurantId: "restaurant-1",
          currencyCode: "MYR",
          serviceAvailability: [
            {
              day_of_week: "monday",
              time_periods: [{ start_time: "09:00", end_time: "17:00" }],
            },
          ],
          categories: [],
        },
        {
          storeId: "store-1",
          accessToken: "token-1",
          tokenExpiresAt: 1710001000000,
        },
      ),
    ).rejects.toThrow("Menu sync to Uber Eats failed (400): invalid menu");
  });

  it("rejects modifier IDs that are unsafe for Uber item paths", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(
      createAdapter().syncMenu(
        {
          restaurantId: "restaurant-1",
          currencyCode: "MYR",
          serviceAvailability: [
            {
              day_of_week: "monday",
              time_periods: [{ start_time: "09:00", end_time: "17:00" }],
            },
          ],
          categories: [
            {
              id: 1,
              name: "Noodles",
              items: [
                {
                  id: 101,
                  name: "Laksa",
                  priceCents: 1399,
                  available: true,
                  modifierGroups: [
                    {
                      id: "bad/id",
                      name: "Spice",
                      required: false,
                      minSelections: 0,
                      maxSelections: 1,
                      modifiers: [{ id: "hot", name: "Hot", priceCents: 150 }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        { storeId: "store-1" },
      ),
    ).rejects.toThrow("unsafe modifier id");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not upload TWD menus before Uber unit verification", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(
      createAdapter().syncMenu(
        {
          restaurantId: "restaurant-1",
          currencyCode: "TWD",
          serviceAvailability: [
            {
              day_of_week: "monday",
              time_periods: [{ start_time: "09:00", end_time: "17:00" }],
            },
          ],
          categories: [
            {
              id: 1,
              name: "Tea",
              items: [
                { id: 101, name: "Tea", priceCents: 10000, available: true },
              ],
            },
          ],
        },
        { storeId: "store-1" },
      ),
    ).rejects.toThrow("TWD amount unit is unverified");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
