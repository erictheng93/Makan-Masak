/**
 * Diner-facing endpoints after a shop loses a module (real D1 + real gate).
 *
 * The rule under test: once a shop's plan drops `reservations` or `coupons`,
 * a diner can no longer START something in that module (reserve, book a
 * service, join the queue, validate or browse coupons), because the shop has
 * lost the screen to serve it. What the diner already has — a reservation, a
 * booking, a queue ticket — can still be looked up and cancelled.
 *
 * Each case creates the existing record through the public API while the shop
 * is on `pro`, then downgrades the shop the way production does (rewrite
 * shop_subscriptions, invalidate the cached subscription) and only then
 * probes the endpoints.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  eq,
  reservationSlots,
  reservations,
  restaurantServiceItems,
  serviceBookingSlots,
  shopSubscriptions,
} from "@makanmasak/database";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers } from "./helpers/seed-helper";
import { readData, readError } from "../helpers/read-json";
import { invalidateSubscriptionCacheForEnv } from "../../middleware/moduleGate";

const API = "https://test/api/v1";
const DATE = "2027-06-07";

describe("diner endpoints after a module downgrade", () => {
  let testApp: RealIntegrationTestApp;
  let seed: ReturnType<typeof buildSeedHelpers>;
  let restaurantId: string;

  beforeAll(async () => {
    testApp = await createRealIntegrationTestApp();
    seed = buildSeedHelpers(testApp.testDb);
  });

  afterAll(async () => {
    if (testApp) await testApp.dispose();
  });

  beforeEach(async () => {
    await testApp.testDb.truncateAll();
    restaurantId = String((await seed.restaurant()).id);
    await testApp.testDb.drizzle
      .insert(shopSubscriptions)
      .values({ restaurantId, planTier: "pro" });
  });

  async function downgradeToBasic(): Promise<void> {
    await testApp.testDb.drizzle
      .update(shopSubscriptions)
      .set({ planTier: "basic" })
      .where(eq(shopSubscriptions.restaurantId, restaurantId));
    await invalidateSubscriptionCacheForEnv(testApp.env, restaurantId);
  }

  async function send(
    path: string,
    init: { method?: string; body?: unknown; headers?: HeadersInit } = {},
  ): Promise<Response> {
    return testApp.app.fetch(
      new Request(`${API}${path}`, {
        method: init.method ?? "GET",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
          ...init.headers,
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      }),
    );
  }

  async function expectModuleRefusal(response: Response): Promise<void> {
    expect(response.status).toBe(403);
    expect(await readError(response)).toMatchObject({
      code: "MODULE_NOT_ENABLED",
    });
  }

  it("reservations: no new booking or slots, but the existing one can be read and cancelled", async () => {
    const booking = (rid: string, phone: string) => ({
      restaurantId: rid,
      customerName: "Diner",
      customerPhone: phone,
      partySize: 2,
      reservationDate: DATE,
      reservationTime: "18:30",
    });

    await testApp.testDb.drizzle.insert(reservationSlots).values({
      id: crypto.randomUUID(),
      restaurantId,
      date: DATE,
      timeSlot: "18:30",
      maxCapacity: 20,
      maxTables: 5,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await testApp.env.DB.prepare(
      `INSERT INTO tables
        (restaurant_id, number, capacity, qr_code, is_occupied, is_active,
         is_reservable, total_usage, created_at_ms, updated_at_ms)
       VALUES (?, 'A1', 4, ?, 0, 1, 1, 0, ?, ?)`,
    )
      .bind(restaurantId, `qr-${restaurantId}`, Date.now(), Date.now())
      .run();

    const created = await send("/reservations", {
      method: "POST",
      body: booking(restaurantId, "0911222333"),
    });
    expect(created.status).toBe(201);
    const existing = await readData<{ id: string; confirmationCode: string }>(
      created,
    );

    await downgradeToBasic();

    await expectModuleRefusal(
      await send("/reservations", {
        method: "POST",
        body: booking(restaurantId, "0911222444"),
      }),
    );
    await expectModuleRefusal(
      await send(
        `/reservations/availability?restaurantId=${restaurantId}&date=${DATE}&partySize=2`,
      ),
    );
    const rows = await testApp.testDb.drizzle
      .select({ id: reservations.id })
      .from(reservations)
      .where(eq(reservations.restaurantId, restaurantId));
    expect(rows).toHaveLength(1);

    const lookup = await send(
      `/reservations/verify/${existing.confirmationCode}`,
    );
    expect(lookup.status).toBe(200);
    const cancelled = await send(`/reservations/${existing.id}/cancel`, {
      method: "DELETE",
      body: { confirmationCode: existing.confirmationCode },
    });
    expect(cancelled.status).toBe(200);
    expect(await readData<{ status: string }>(cancelled)).toMatchObject({
      status: "cancelled",
    });
  });

  it("service bookings: no new booking or availability, but the existing one can be read and cancelled", async () => {
    const [item] = await testApp.testDb.drizzle
      .insert(restaurantServiceItems)
      .values({
        restaurantId,
        name: "Lantern Painting",
        serviceType: "activity",
        requiresBooking: true,
        priceCents: 15000,
        paymentRequirement: "pay_at_venue",
        durationMinutes: 60,
      })
      .returning({ id: restaurantServiceItems.id });
    await testApp.testDb.drizzle.insert(serviceBookingSlots).values({
      restaurantId,
      serviceItemId: item.id,
      date: DATE,
      timeSlot: "14:00",
      maxCapacity: 5,
    });
    const body = (phone: string) => ({
      restaurantId,
      serviceItemId: item.id,
      customerName: "Diner",
      customerPhone: phone,
      bookingDate: DATE,
      bookingTime: "14:00",
    });

    const created = await send("/service-bookings", {
      method: "POST",
      body: body("0911222333"),
    });
    expect(created.status).toBe(201);
    const { booking } = await readData<{
      booking: { confirmationCode: string };
    }>(created);

    await downgradeToBasic();

    await expectModuleRefusal(
      await send("/service-bookings", {
        method: "POST",
        body: body("0911222444"),
      }),
    );
    await expectModuleRefusal(
      await send(
        `/service-bookings/availability?serviceItemId=${item.id}&date=${DATE}`,
      ),
    );

    const lookup = await send(
      `/service-bookings/verify/${booking.confirmationCode}?customerPhone=0911222333`,
    );
    expect(lookup.status).toBe(200);
    const cancelled = await send(
      `/service-bookings/verify/${booking.confirmationCode}/cancel`,
      { method: "POST", body: { customerPhone: "0911222333" } },
    );
    expect(cancelled.status).toBe(200);
  });

  it("waiting list: no joining or queue snapshot, but the existing ticket can be read and cancelled", async () => {
    const joined = await send("/waiting-list", {
      method: "POST",
      body: {
        restaurantId,
        customerName: "Diner",
        customerPhone: "0911222333",
        partySize: 2,
      },
    });
    expect(joined.status).toBe(201);
    const ticket = await readData<{ id: string; waitingToken: string }>(joined);

    await downgradeToBasic();

    await expectModuleRefusal(
      await send("/waiting-list", {
        method: "POST",
        body: {
          restaurantId,
          customerName: "Second",
          customerPhone: "0911222444",
          partySize: 2,
        },
      }),
    );
    await expectModuleRefusal(
      await send(`/waiting-list/queue-status/${restaurantId}`),
    );
    await expectModuleRefusal(
      await send(`/waiting-list/estimate-wait/${restaurantId}?partySize=2`),
    );

    const ticketHeaders = { "X-Waiting-Ticket-Token": ticket.waitingToken };
    const read = await send(`/waiting-list/${ticket.id}`, {
      headers: ticketHeaders,
    });
    expect(read.status).toBe(200);
    const cancelled = await send(`/waiting-list/${ticket.id}`, {
      method: "DELETE",
      headers: ticketHeaders,
      body: { customerPhone: "0911222333" },
    });
    expect(cancelled.status).toBe(200);
  });

  it("coupons: the shop's own stop after a downgrade, platform promotions keep working", async () => {
    const shopCoupon = await seed.coupon(restaurantId);
    const platformCoupon = await seed.coupon(restaurantId, {
      restaurantId: null,
    });
    const validate = (code: string) =>
      send("/coupons/validate", {
        method: "POST",
        body: { code, restaurantId, orderAmount: 500 },
      });
    const availableIds = async () =>
      (
        await readData<Array<{ id: number }>>(
          await send(`/coupons/available/${restaurantId}`),
        )
      ).map((coupon) => coupon.id);

    expect((await validate(shopCoupon.code)).status).toBe(200);
    expect((await availableIds()).sort()).toEqual(
      [shopCoupon.id, platformCoupon.id].sort(),
    );

    await downgradeToBasic();

    await expectModuleRefusal(await validate(shopCoupon.code));
    const platform = await validate(platformCoupon.code);
    expect(platform.status).toBe(200);
    expect(await readData<{ valid: boolean }>(platform)).toMatchObject({
      valid: true,
    });
    expect(await availableIds()).toEqual([platformCoupon.id]);
  });

  it("service booking: a shop voucher needs coupons, a platform voucher does not", async () => {
    await testApp.testDb.drizzle
      .update(shopSubscriptions)
      .set({ planTier: "basic", moduleOverrides: { reservations: true } })
      .where(eq(shopSubscriptions.restaurantId, restaurantId));
    await invalidateSubscriptionCacheForEnv(testApp.env, restaurantId);
    const [item] = await testApp.testDb.drizzle
      .insert(restaurantServiceItems)
      .values({
        restaurantId,
        name: "Lantern Painting",
        serviceType: "activity",
        requiresBooking: true,
        priceCents: 15000,
        paymentRequirement: "pay_at_venue",
        durationMinutes: 60,
      })
      .returning({ id: restaurantServiceItems.id });
    await testApp.testDb.drizzle.insert(serviceBookingSlots).values({
      restaurantId,
      serviceItemId: item.id,
      date: DATE,
      timeSlot: "14:00",
      maxCapacity: 5,
    });
    const shopVoucher = await seed.coupon(restaurantId);
    const platformVoucher = await seed.coupon(restaurantId, {
      restaurantId: null,
      discountType: "fixed",
      discountValueCents: 2000,
    });
    const book = (voucherCode: string, phone: string) =>
      send("/service-bookings", {
        method: "POST",
        body: {
          restaurantId,
          serviceItemId: item.id,
          customerName: "Diner",
          customerPhone: phone,
          bookingDate: DATE,
          bookingTime: "14:00",
          voucherCode,
        },
      });

    const refused = await book(shopVoucher.code, "0911222333");
    expect(refused.status).toBe(400);
    expect(await readError(refused)).toMatchObject({
      code: "VOUCHER_NOT_APPLICABLE",
    });
    expect((await book(platformVoucher.code, "0911222444")).status).toBe(201);
  });

  it("never answers an unknown restaurant with a 500", async () => {
    const unknown = "no-such-restaurant";
    const responses = await Promise.all([
      send("/reservations", {
        method: "POST",
        body: {
          restaurantId: unknown,
          customerName: "Diner",
          customerPhone: "0911222333",
          partySize: 2,
          reservationDate: DATE,
          reservationTime: "18:30",
        },
      }),
      send(
        `/reservations/availability?restaurantId=${unknown}&date=${DATE}&partySize=2`,
      ),
      send("/service-bookings/availability?serviceItemId=999999&date=" + DATE),
      send("/waiting-list", {
        method: "POST",
        body: {
          restaurantId: unknown,
          customerName: "Diner",
          customerPhone: "0911222333",
          partySize: 2,
        },
      }),
      send(`/waiting-list/queue-status/${unknown}`),
      send(`/coupons/available/${unknown}`),
      send("/coupons/validate", {
        method: "POST",
        body: { code: "NOPE10", restaurantId: unknown, orderAmount: 500 },
      }),
    ]);

    // Coupon reads may answer 200 (platform promotions only); the rest 4xx.
    for (const response of responses) {
      expect(response.status).toBeLessThan(500);
    }
  });
});
