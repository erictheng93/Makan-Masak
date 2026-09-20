import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  CouponService,
  couponUsage,
  coupons,
  eq,
  menuItems,
  orders,
} from "@makanmasak/database";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers } from "./helpers/seed-helper";
import { readData, readError } from "../helpers/read-json";

const ENDPOINT = "https://test/api/v1/guest-orders";
const DEVICE_A = "11111111-1111-4111-8111-111111111111";
const DEVICE_B = "22222222-2222-4222-8222-222222222222";

interface Shop {
  restaurantId: string;
  menuItemId: number;
}
interface CreatedOrder {
  order: { id: string; discountAmount: number; totalAmount: number };
  guestToken: string;
}

describe("Guest coupon checkout — real D1 (#382)", () => {
  let testApp: RealIntegrationTestApp;
  let seed: ReturnType<typeof buildSeedHelpers>;

  beforeAll(async () => {
    testApp = await createRealIntegrationTestApp();
    seed = buildSeedHelpers(testApp.testDb);
  });
  beforeEach(async () => {
    await testApp.testDb.truncateAll();
  });
  afterAll(async () => {
    await testApp?.dispose();
  });

  it.each([
    { discountType: "fixed", discountValueCents: 2000, discount: 20 },
    { discountType: "percentage", discountPercentageBps: 1000, discount: 12 },
  ])("persists and returns a $discountType guest discount", async (config) => {
    const shop = await seedShop();
    const { discount, ...couponFields } = config;
    const coupon = await seed.coupon(shop.restaurantId, couponFields);
    const response = await postOrder(
      shop,
      coupon.code,
      config.discountType === "fixed" ? null : DEVICE_A,
    );
    expect(response.status).toBe(201);
    const created = await readData<CreatedOrder>(response);
    const readBack = await testApp.app.fetch(
      new Request(`${ENDPOINT}/${created.order.id}`, {
        headers: { authorization: `Bearer ${created.guestToken}` },
      }),
    );
    expect(readBack.status).toBe(200);
    const fetched = await readData<CreatedOrder>(readBack);
    expect(fetched.order.discountAmount).toBe(discount);
    expect(fetched.order.totalAmount).toBe(120 - discount);

    const row = await testApp.testDb.drizzle
      .select()
      .from(orders)
      .where(eq(orders.id, created.order.id))
      .get();
    expect(row?.discountAmountCents).toBe(discount * 100);
    expect(row?.totalAmountCents).toBe((120 - discount) * 100);
    const usages = await usageRows(coupon.id);
    expect(usages).toHaveLength(1);
    expect(usages[0]).toMatchObject({
      orderId: created.order.id,
      userId: null,
      discountAmountCents: discount * 100,
      status: "active",
    });
    expect(await usedCount(coupon.id)).toBe(1);
  });

  it("enforces a per-device limit after a completed order, independently for another device", async () => {
    const shop = await seedShop();
    const coupon = await seed.coupon(shop.restaurantId, {
      discountPercentageBps: 1000,
      usageLimitPerUser: 1,
    });
    const first = await postOrder(shop, coupon.code, DEVICE_A);
    expect(first.status).toBe(201);
    const created = await readData<CreatedOrder>(first);
    await finishOrder(created.order.id);

    const repeated = await postOrder(shop, coupon.code, DEVICE_A);
    expect(repeated.status).toBe(400);
    expect(await testApp.testDb.drizzle.select().from(orders)).toHaveLength(1);
    const otherDevice = await postOrder(shop, coupon.code, DEVICE_B);
    expect(otherDevice.status).toBe(201);
    expect(await usageRows(coupon.id)).toHaveLength(2);
    expect(await usedCount(coupon.id)).toBe(2);
  });

  it("releases coupon usage on guest cancellation so the same device can reuse it", async () => {
    const shop = await seedShop();
    const coupon = await seed.coupon(shop.restaurantId, {
      discountPercentageBps: 1000,
      usageLimit: 1,
      usageLimitPerUser: 1,
    });
    const first = await postOrder(shop, coupon.code, DEVICE_A);
    expect(first.status).toBe(201);
    const created = await readData<CreatedOrder>(first);
    const cancelled = await testApp.app.fetch(
      new Request(`${ENDPOINT}/${created.order.id}/cancel`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${created.guestToken}`,
          "X-Guest-Device-Id": DEVICE_A,
        },
        body: JSON.stringify({ reason: "Changed my mind" }),
      }),
    );
    expect(cancelled.status).toBe(200);
    expect(await usedCount(coupon.id)).toBe(0);
    expect(await usageRows(coupon.id)).toEqual([
      expect.objectContaining({
        orderId: created.order.id,
        status: "cancelled",
      }),
    ]);
    expect((await postOrder(shop, coupon.code, DEVICE_A)).status).toBe(201);
    expect(await usedCount(coupon.id)).toBe(1);
  });

  it.each([null, 10])(
    "rejects a per-person coupon without guest identity even when global limit is %s",
    async (usageLimit) => {
      const shop = await seedShop();
      const coupon = await seed.coupon(shop.restaurantId, {
        discountPercentageBps: 1000,
        usageLimitPerUser: 1,
        usageLimit,
      });
      expect((await postOrder(shop, coupon.code, null)).status).toBe(400);
      expect(await testApp.testDb.drizzle.select().from(orders)).toHaveLength(
        0,
      );
      expect(await usedCount(coupon.id)).toBe(0);
    },
  );

  it("does not treat a rotating guest order token as a per-person coupon identity", async () => {
    const shop = await seedShop();
    const first = await postOrder(shop, undefined, null);
    expect(first.status).toBe(201);
    const created = await readData<CreatedOrder>(first);
    await finishOrder(created.order.id);
    const coupon = await seed.coupon(shop.restaurantId, {
      discountPercentageBps: 1000,
      usageLimitPerUser: 1,
    });
    const response = await postOrder(shop, coupon.code, null, {
      authorization: `Bearer ${created.guestToken}`,
    });
    expect(response.status).toBe(400);
    expect(await testApp.testDb.drizzle.select().from(orders)).toHaveLength(1);
    expect(await usedCount(coupon.id)).toBe(0);
  });

  it("rejects an invalid coupon instead of silently creating a full-price order", async () => {
    const shop = await seedShop();
    expect((await postOrder(shop, "MISSING-COUPON")).status).toBe(400);
    expect(await testApp.testDb.drizzle.select().from(orders)).toHaveLength(0);
  });

  it("preview uses the same device quota as checkout", async () => {
    const shop = await seedShop();
    const coupon = await seed.coupon(shop.restaurantId, {
      discountPercentageBps: 1000,
      usageLimitPerUser: 1,
    });
    const preview = async (device: string) => {
      const response = await testApp.app.fetch(
        new Request("https://test/api/v1/coupons/validate", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Guest-Device-Id": device,
          },
          body: JSON.stringify({
            code: coupon.code,
            restaurantId: shop.restaurantId,
            orderAmount: 120,
            menuItems: [{ menuItemId: shop.menuItemId, quantity: 1 }],
          }),
        }),
      );
      expect(response.status).toBe(200);
      return readData<{ valid: boolean; discountAmount?: number }>(response);
    };
    expect(await preview(DEVICE_A)).toMatchObject({
      valid: true,
      discountAmount: 12,
    });
    expect((await postOrder(shop, coupon.code, DEVICE_A)).status).toBe(201);
    expect(await preview(DEVICE_A)).toMatchObject({ valid: false });
    expect(await preview(DEVICE_B)).toMatchObject({
      valid: true,
      discountAmount: 12,
    });
  });

  it("atomically enforces a device quota after two real validations race, rolling back the losing order and inventory", async () => {
    const shop = await seedShop();
    await testApp.testDb.drizzle
      .update(menuItems)
      .set({ inventoryCount: 5 })
      .where(eq(menuItems.id, shop.menuItemId));
    const coupon = await seed.coupon(shop.restaurantId, {
      discountPercentageBps: 1000,
      usageLimit: 10,
      usageLimitPerUser: 1,
    });

    // Hold both real validation results until both requests have cleared the
    // active-order check and read the unused quota. D1 remains entirely real.
    const validate = CouponService.prototype.validateCoupon;
    const validations: boolean[] = [];
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi
      .spyOn(CouponService.prototype, "validateCoupon")
      .mockImplementation(async function (this: CouponService, ...args) {
        const result = await validate.apply(this, args);
        validations.push(result.valid);
        if (validations.length === 2) release();
        await barrier;
        return result;
      });
    let responses: Response[];
    try {
      responses = await Promise.all([
        postOrder(shop, coupon.code, DEVICE_A),
        postOrder(shop, coupon.code, DEVICE_A),
      ]);
    } finally {
      release();
      spy.mockRestore();
    }
    expect(validations).toEqual([true, true]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 400,
    ]);
    const failed = responses.find((response) => response.status === 400)!;
    expect(await readError(failed)).toMatchObject({ code: "COUPON_INVALID" });
    const created = await readData<CreatedOrder>(
      responses.find((response) => response.status === 201)!,
    );
    expect(await testApp.testDb.drizzle.select().from(orders)).toHaveLength(1);
    expect(await usageRows(coupon.id)).toHaveLength(1);
    expect(await usedCount(coupon.id)).toBe(1);
    const inventory = async () =>
      (
        await testApp.testDb.drizzle
          .select()
          .from(menuItems)
          .where(eq(menuItems.id, shop.menuItemId))
          .get()
      )?.inventoryCount;
    expect(await inventory()).toBe(4);

    const cancelled = await testApp.app.fetch(
      new Request(`${ENDPOINT}/${created.order.id}/cancel`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${created.guestToken}`,
          "X-Guest-Device-Id": DEVICE_A,
        },
      }),
    );
    expect(cancelled.status).toBe(200);
    expect(await inventory()).toBe(5);
    expect(await usedCount(coupon.id)).toBe(0);
    expect((await postOrder(shop, coupon.code, DEVICE_A)).status).toBe(201);
    expect(await inventory()).toBe(4);
    expect(await usedCount(coupon.id)).toBe(1);
  });

  async function seedShop(): Promise<Shop> {
    const restaurant = await seed.restaurant({ enableShopMode: true });
    const item = await seed.menuItem(restaurant.id);
    return { restaurantId: restaurant.id, menuItemId: item.id };
  }

  function postOrder(
    shop: Shop,
    couponCode: string | undefined,
    device: string | null = DEVICE_A,
    headers: Record<string, string> = {},
  ) {
    return testApp.app.fetch(
      new Request(ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(device ? { "X-Guest-Device-Id": device } : {}),
          ...headers,
        },
        body: JSON.stringify({
          restaurantId: shop.restaurantId,
          guestName: "Coupon Guest",
          orderType: "shop",
          items: [{ menuItemId: shop.menuItemId, quantity: 1 }],
          deliveryInfo: { type: "takeaway" },
          couponCode,
        }),
      }),
    );
  }

  function usageRows(couponId: number) {
    return testApp.testDb.drizzle
      .select()
      .from(couponUsage)
      .where(eq(couponUsage.couponId, couponId));
  }

  async function usedCount(couponId: number) {
    const row = await testApp.testDb.drizzle
      .select()
      .from(coupons)
      .where(eq(coupons.id, couponId))
      .get();
    return row?.usedCount;
  }

  async function finishOrder(orderId: string) {
    await testApp.testDb.drizzle
      .update(orders)
      .set({ status: "delivered" })
      .where(eq(orders.id, orderId));
    const key = await testApp.env.CACHE_KV.get(
      `guest_active_lookup:${orderId}`,
    );
    expect(key).toBeTruthy();
    await testApp.env.CACHE_KV.delete(key!);
    await testApp.env.CACHE_KV.delete(`guest_active_lookup:${orderId}`);
  }
});
