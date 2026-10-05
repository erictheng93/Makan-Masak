/**
 * Real integration — POST /api/v1/guest-orders must be backed by a signed
 * table/seat QR, and the seat the order was placed from must be persisted.
 * Runs the real Hono app over a real migrated D1; the database is the source
 * of truth for `orders.seat_id`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildSignedQRUrl } from "@makanmasak/utils";
import { eq, orders, seats, tables } from "@makanmasak/database";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers } from "./helpers/seed-helper";
import { readData } from "../helpers/read-json";

const ENDPOINT = "https://test/api/v1/guest-orders";

describe("Guest dine-in orders — signed QR proof (real D1)", () => {
  let testApp: RealIntegrationTestApp;
  let seed: ReturnType<typeof buildSeedHelpers>;
  let ipCounter = 0;

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

  const key = () => testApp.env.QR_SIGNING_KEY as string;

  async function seedDineIn() {
    const restaurant = await seed.restaurant({});
    const restaurantId = String(restaurant.id);
    const item = await seed.menuItem(restaurant.id);
    const db = testApp.testDb.drizzle;
    const [table] = await db
      .insert(tables)
      .values({ restaurantId, number: "A1", qrCode: `tbl-${restaurantId}` })
      .returning();
    const [otherTable] = await db
      .insert(tables)
      .values({ restaurantId, number: "A2", qrCode: `tbl2-${restaurantId}` })
      .returning();
    const [seat] = await db
      .insert(seats)
      .values({
        tableId: table!.id,
        seatNumber: "01",
        qrCode: `seat-${restaurantId}`,
      })
      .returning();
    const tableQr = await buildSignedQRUrl(
      "https://example.test",
      {
        type: "table",
        restaurantId,
        tableId: table!.id,
        identifier: "A1",
        version: 1,
      },
      key(),
    );
    const seatQr = await buildSignedQRUrl(
      "https://example.test",
      {
        type: "seat",
        restaurantId,
        tableId: table!.id,
        identifier: "01",
        version: 1,
      },
      key(),
    );
    return {
      restaurantId,
      menuItemId: item.id,
      table: table!,
      otherTable: otherTable!,
      seat: seat!,
      tableQr,
      seatQr,
    };
  }

  function post(body: Record<string, unknown>) {
    return testApp.app.fetch(
      new Request(ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "CF-Connecting-IP": `198.51.100.${(ipCounter += 1)}`,
        },
        body: JSON.stringify({ guestName: "Guest", ...body }),
      }),
    );
  }

  const items = (id: number) => [{ menuItemId: id, quantity: 1 }];

  it("stores seat_id for a seat order carrying the valid seat QR", async () => {
    const s = await seedDineIn();
    const res = await post({
      restaurantId: s.restaurantId,
      orderType: "seat",
      tableId: s.table.id,
      seatId: s.seat.id,
      qrCode: s.seatQr,
      items: items(s.menuItemId),
    });
    expect(res.status).toBe(201);
    const created = await readData<{ order: { id: string } }>(res);
    const [row] = await testApp.testDb.drizzle
      .select({ tableId: orders.tableId, seatId: orders.seatId })
      .from(orders)
      .where(eq(orders.id, created.order.id));
    expect(row).toEqual({ tableId: s.table.id, seatId: s.seat.id });
  });

  it("accepts a valid table QR for a table order with seat_id NULL", async () => {
    const s = await seedDineIn();
    const res = await post({
      restaurantId: s.restaurantId,
      orderType: "table",
      tableId: s.table.id,
      qrCode: s.tableQr,
      items: items(s.menuItemId),
    });
    expect(res.status).toBe(201);
    const created = await readData<{ order: { id: string } }>(res);
    const [row] = await testApp.testDb.drizzle
      .select({ seatId: orders.seatId })
      .from(orders)
      .where(eq(orders.id, created.order.id));
    expect(row!.seatId).toBeNull();
  });

  it("rejects a bare tableId with no QR (403 QR_VERIFICATION_FAILED)", async () => {
    const s = await seedDineIn();
    const res = await post({
      restaurantId: s.restaurantId,
      orderType: "table",
      tableId: s.table.id,
      items: items(s.menuItemId),
    });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      error: { code: "QR_VERIFICATION_FAILED" },
    });
  });

  it("rejects a public SHOP- code presented as proof", async () => {
    const s = await seedDineIn();
    const res = await post({
      restaurantId: s.restaurantId,
      orderType: "table",
      tableId: s.table.id,
      qrCode: `SHOP-${s.restaurantId}-1700000000000`,
      items: items(s.menuItemId),
    });
    expect(res.status).toBe(403);
  });

  it("rejects a forged signature", async () => {
    const s = await seedDineIn();
    const forged = s.tableQr.replace(
      /sig=[0-9a-f]{16}/,
      "sig=0000000000000000",
    );
    const res = await post({
      restaurantId: s.restaurantId,
      orderType: "table",
      tableId: s.table.id,
      qrCode: forged,
      items: items(s.menuItemId),
    });
    expect(res.status).toBe(403);
  });

  it("rejects a stale QR after the table's code was regenerated", async () => {
    const s = await seedDineIn();
    await testApp.testDb.drizzle
      .update(tables)
      .set({ qrCodeVersion: 2 })
      .where(eq(tables.id, s.table.id));
    const res = await post({
      restaurantId: s.restaurantId,
      orderType: "table",
      tableId: s.table.id,
      qrCode: s.tableQr,
      items: items(s.menuItemId),
    });
    expect(res.status).toBe(403);
  });

  it("rejects a valid QR for a different table", async () => {
    const s = await seedDineIn();
    const res = await post({
      restaurantId: s.restaurantId,
      orderType: "table",
      tableId: s.otherTable.id,
      qrCode: s.tableQr,
      items: items(s.menuItemId),
    });
    expect(res.status).toBe(403);
  });

  it("rejects a seat order whose seat QR belongs to another seat id", async () => {
    const s = await seedDineIn();
    const res = await post({
      restaurantId: s.restaurantId,
      orderType: "seat",
      tableId: s.table.id,
      seatId: s.seat.id + 1000,
      qrCode: s.seatQr,
      items: items(s.menuItemId),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("rejects an inactive table even with a correctly signed QR", async () => {
    const s = await seedDineIn();
    await testApp.testDb.drizzle
      .update(tables)
      .set({ isActive: false })
      .where(eq(tables.id, s.table.id));
    const res = await post({
      restaurantId: s.restaurantId,
      orderType: "table",
      tableId: s.table.id,
      qrCode: s.tableQr,
      items: items(s.menuItemId),
    });
    expect(res.status).toBe(403);
  });
});
