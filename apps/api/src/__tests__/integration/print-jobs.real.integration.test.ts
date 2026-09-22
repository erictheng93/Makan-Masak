/**
 * Real-D1 coverage for the cloud print dispatch path.
 *
 * Two things here are only meaningful against a real database. The tenant
 * boundary is a join from the presented credential to cash_registers, so a
 * mocked D1 would assert the shape of a query rather than the isolation it is
 * supposed to produce. And the reclaim of abandoned jobs lives entirely in the
 * claim statement's WHERE clause — whether a dead agent's receipt comes back
 * is a question about SQL semantics, not about application branching.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  type TestDatabase,
} from "@makanmasak/database/testing";
import { eq } from "drizzle-orm";
import {
  cashRegisters,
  orders,
  printAgents,
  receipts,
  restaurants,
  tables,
  categories,
  menuItems,
  orderItems,
} from "@makanmasak/database";
import { ReceiptService } from "../../features/pos/services/ReceiptService";
import type { PrintRequest } from "@makanmasak/shared-types";
import {
  ReceiptFormattingService,
  CommandBuilder,
} from "@makanmasak/queue-core/print";
import routes from "../../features/print/routes";
import { hashPrintAgentKey } from "../../shared/utils/print-agent-key";

const SHOP_A = "print-shop-a";
const SHOP_B = "print-shop-b";
const REGISTER_A = "11111111-1111-7111-8111-111111111111";
const REGISTER_B = "22222222-2222-7222-8222-222222222222";
const KEY_A = "mmpa_key_for_shop_a";
const KEY_B = "mmpa_key_for_shop_b";
const KITCHEN_KEY_A = "mmpa_kitchen_key_for_shop_a";
const ORDER_A = "order-shop-a";
const ORDER_B = "order-shop-b";

const CLAIM_TIMEOUT_MS = 5 * 60 * 1000;
const RECEIPT_CREATED_AT = new Date("2025-08-12T12:00:00.000Z");

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.dispose();
});

async function seedShop(
  restaurantId: string,
  registerId: string,
  orderId: string,
  key: string,
  options: { revoked?: boolean } = {},
): Promise<void> {
  const now = new Date();
  await testDb.drizzle.insert(restaurants).values({
    id: restaurantId,
    name: `Shop ${restaurantId}`,
    type: "street_food",
    category: "snack",
    address: "1 Test Rd",
    district: "West",
    phone: "0900000000",
  });
  await testDb.drizzle.insert(cashRegisters).values({
    id: registerId,
    name: "Front POS",
    restaurantId,
    hardwareConfig: "{}",
    peripherals: "{}",
    settings: "{}",
    createdAt: now,
    updatedAt: now,
  });
  await testDb.drizzle.insert(orders).values({
    id: orderId,
    restaurantId,
    orderNumber: `ORDER-${orderId}`,
    subtotalCents: 1200,
    totalAmountCents: 1200,
    status: "pending",
  });
  await testDb.drizzle.insert(printAgents).values({
    id: `agent-${restaurantId}`,
    restaurantId,
    registerId,
    label: "Counter printer",
    keyHash: await hashPrintAgentKey(key),
    revokedAt: options.revoked ? now : null,
    createdAt: now,
    updatedAt: now,
  });
}

/** 全店代理：不綁收銀機，因此只拿沒有收銀機的收據（廚房票）。 */
async function seedShopAgent(restaurantId: string, key: string): Promise<void> {
  const now = new Date();
  await testDb.drizzle.insert(printAgents).values({
    id: `shop-agent-${restaurantId}`,
    restaurantId,
    registerId: null,
    label: "Kitchen printer",
    keyHash: await hashPrintAgentKey(key),
    createdAt: now,
    updatedAt: now,
  });
}

async function seedReceipt(
  id: string,
  registerId: string | null,
  orderId: string,
  overrides: Partial<typeof receipts.$inferInsert> = {},
): Promise<void> {
  await testDb.drizzle.insert(receipts).values({
    id,
    orderId,
    registerId,
    receiptNumber: `RCPT-${id}`,
    receiptType: "customer",
    content: JSON.stringify({
      items: [{ name: "Nasi Lemak", quantity: 2, price: 6 }],
      subtotal: 12,
      taxAmount: 0,
      totalAmount: 12,
      paymentMethod: "cash",
      customerName: "Ada",
    }),
    printStatus: "pending",
    createdAt: RECEIPT_CREATED_AT,
    ...overrides,
  });
}

function poll(key: string, query = "") {
  return routes.request(
    `/jobs${query}`,
    { headers: { "X-Print-Agent-Key": key } },
    testDb.bindings as never,
  );
}

function ack(
  key: string,
  receiptId: string,
  body: Record<string, unknown> = { status: "printed", printerName: "USB-1" },
) {
  return routes.request(
    `/jobs/${receiptId}/ack`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Print-Agent-Key": key,
      },
      body: JSON.stringify(body),
    },
    testDb.bindings as never,
  );
}

async function receiptRow(id: string) {
  const [row] = await testDb.drizzle
    .select()
    .from(receipts)
    .where(eq(receipts.id, id));
  return row;
}

async function claimedJob(response: Response) {
  return (await response.json()) as {
    success: boolean;
    data: { receiptId: string; request: PrintRequest } | null;
  };
}

describe("cloud print dispatch — real D1", () => {
  beforeEach(async () => {
    await testDb.truncateAll();
    await seedShop(SHOP_A, REGISTER_A, ORDER_A, KEY_A);
    await seedShop(SHOP_B, REGISTER_B, ORDER_B, KEY_B);
  });

  describe.each(["customer", "kitchen"] as const)(
    "%s location on paper",
    (kind) => {
      it.each([
        { name: "table order", tableId: 11, expected: "A1" },
        { name: "seat order", tableId: 11, expected: "A1" },
        {
          name: "table from another restaurant",
          tableId: 22,
          expected: null,
        },
        { name: "takeaway", tableId: null, expected: null },
        { name: "delivery", tableId: null, expected: null },
      ])(
        "prints the correct location for $name",
        async ({ name, tableId, expected }) => {
          await testDb.drizzle.insert(tables).values([
            { id: 11, restaurantId: SHOP_A, number: "A1", qrCode: "table-a" },
            { id: 22, restaurantId: SHOP_B, number: "B2", qrCode: "table-b" },
          ]);
          await testDb.drizzle
            .insert(categories)
            .values({ id: 1, restaurantId: SHOP_A, name: "Food" });
          await testDb.drizzle.insert(menuItems).values({
            id: 1,
            restaurantId: SHOP_A,
            categoryId: 1,
            name: "Nasi Lemak",
            priceCents: 1200,
          });
          await testDb.drizzle.insert(orderItems).values({
            orderId: ORDER_A,
            menuItemId: 1,
            quantity: 1,
            unitPriceCents: 1200,
            totalPriceCents: 1200,
            itemSnapshot: { name: "Nasi Lemak" },
          });
          await testDb.drizzle
            .update(orders)
            .set({
              tableId,
              orderType:
                name === "seat order"
                  ? "seat"
                  : tableId == null
                    ? "shop"
                    : "table",
              deliveryInfo:
                name === "delivery"
                  ? {
                      type: "delivery",
                      address: "1 Test Rd",
                      phone: "0900000000",
                    }
                  : name === "takeaway"
                    ? { type: "takeaway" }
                    : { type: "dine_in" },
            })
            .where(eq(orders.id, ORDER_A));

          const service = new ReceiptService(testDb.db);
          if (kind === "kitchen") await seedShopAgent(SHOP_A, KITCHEN_KEY_A);
          const result =
            kind === "kitchen"
              ? await service.createKitchenTicket(ORDER_A)
              : await service.printReceipt({ orderId: ORDER_A }, REGISTER_A);
          expect(result.success).toBe(true);
          const stored = await receiptRow(result.data!.id);
          expect(JSON.parse(stored!.content).tableNumber).toBe(expected);

          // A reprint uses the persisted location, even if the table is renamed.
          await testDb.drizzle
            .update(tables)
            .set({ number: "Renamed" })
            .where(eq(tables.id, 11));
          expect(await service.reprintReceipt(result.data!.id)).toEqual({
            success: true,
          });
          const job = await claimedJob(
            await poll(kind === "kitchen" ? KITCHEN_KEY_A : KEY_A),
          );
          expect(job.data?.receiptId).toBe(result.data!.id);
          const request = job.data!.request;
          expect(request.data.order.tableNumber ?? null).toBe(expected);
          const formatted = await new ReceiptFormattingService().formatReceipt(
            request,
          );
          const commands =
            CommandBuilder.fromPrintContent(formatted).buildESCPOS();
          if (expected) {
            expect(commands).toMatch(
              new RegExp("Table:\\s+" + expected + "\\n"),
            );
          } else {
            expect(commands).not.toContain("Table:");
          }
          if (name === "delivery") expect(commands).toContain("1 Test Rd");
        },
      );
    },
  );

  it("hands a pending receipt to the agent holding that register's credential", async () => {
    await seedReceipt("receipt-a", REGISTER_A, ORDER_A);

    const body = await claimedJob(await poll(KEY_A));

    expect(body.data?.receiptId).toBe("receipt-a");
    expect(body.data?.request).toMatchObject({
      restaurantId: SHOP_A,
      type: "receipt",
      data: {
        order: {
          id: ORDER_A,
          total: 12,
          createdAt: RECEIPT_CREATED_AT.toISOString(),
        },
        customer: { name: "Ada" },
      },
    });

    const row = await receiptRow("receipt-a");
    expect(row?.printStatus).toBe("printing");
    expect(row?.printAttempts).toBe(1);
    expect(row?.claimedAt).toBeInstanceOf(Date);
  });

  it("never hands one shop's receipt to another shop's agent", async () => {
    await seedReceipt("receipt-a", REGISTER_A, ORDER_A);

    // Shop B holds a perfectly valid credential. It simply is not this
    // receipt's credential, and there is no header it can send to change that.
    const body = await claimedJob(await poll(KEY_B));

    expect(body.data).toBeNull();
    expect((await receiptRow("receipt-a"))?.printStatus).toBe("pending");
  });

  it.each([
    ["an unknown key", "mmpa_not_a_real_key"],
    ["an empty key", ""],
  ])("refuses %s", async (_label, key) => {
    await seedReceipt("receipt-a", REGISTER_A, ORDER_A);

    expect((await poll(key)).status).toBe(401);
    expect((await receiptRow("receipt-a"))?.printStatus).toBe("pending");
  });

  it("refuses a revoked credential", async () => {
    await testDb.drizzle
      .update(printAgents)
      .set({ revokedAt: new Date() })
      .where(eq(printAgents.registerId, REGISTER_A));
    await seedReceipt("receipt-a", REGISTER_A, ORDER_A);

    expect((await poll(KEY_A)).status).toBe(401);
  });

  it("records when the agent was last seen", async () => {
    await poll(KEY_A);

    const [agent] = await testDb.drizzle
      .select()
      .from(printAgents)
      .where(eq(printAgents.registerId, REGISTER_A));
    expect(agent?.lastSeenAt).toBeInstanceOf(Date);
  });

  it("re-queues a claim whose agent died before acknowledging", async () => {
    await seedReceipt("receipt-a", REGISTER_A, ORDER_A, {
      printStatus: "printing",
      printAttempts: 1,
      claimedAt: new Date(Date.now() - CLAIM_TIMEOUT_MS - 1000),
    });

    const body = await claimedJob(await poll(KEY_A));

    expect(body.data?.receiptId).toBe("receipt-a");
    expect((await receiptRow("receipt-a"))?.printAttempts).toBe(2);
  });

  it("leaves a claim that is still within the timeout alone", async () => {
    await seedReceipt("receipt-a", REGISTER_A, ORDER_A, {
      printStatus: "printing",
      printAttempts: 1,
      claimedAt: new Date(),
    });

    expect((await claimedJob(await poll(KEY_A))).data).toBeNull();
    expect((await receiptRow("receipt-a"))?.printAttempts).toBe(1);
  });

  it("gives up on a receipt that has exhausted its delivery attempts", async () => {
    await seedReceipt("receipt-a", REGISTER_A, ORDER_A, {
      printStatus: "printing",
      printAttempts: 5,
      claimedAt: new Date(Date.now() - CLAIM_TIMEOUT_MS - 1000),
    });

    expect((await claimedJob(await poll(KEY_A))).data).toBeNull();

    const row = await receiptRow("receipt-a");
    expect(row?.printStatus).toBe("failed");
    expect(row?.printerResponse).toContain("Abandoned");
  });

  it("settles a claimed job on acknowledgement", async () => {
    await seedReceipt("receipt-a", REGISTER_A, ORDER_A);
    await poll(KEY_A);

    expect((await ack(KEY_A, "receipt-a")).status).toBe(200);

    const row = await receiptRow("receipt-a");
    expect(row?.printStatus).toBe("printed");
    expect(row?.printerName).toBe("USB-1");
    expect(row?.printedAt).toBeInstanceOf(Date);
    // Cleared so the reclaim sweep has nothing left to consider.
    expect(row?.claimedAt).toBeNull();
  });

  it("refuses an acknowledgement from an agent on another register", async () => {
    await seedReceipt("receipt-a", REGISTER_A, ORDER_A);
    await poll(KEY_A);

    expect((await ack(KEY_B, "receipt-a")).status).toBe(404);
    expect((await receiptRow("receipt-a"))?.printStatus).toBe("printing");
  });

  it("re-queues a failed print that still has attempts left", async () => {
    await seedReceipt("receipt-a", REGISTER_A, ORDER_A);
    await poll(KEY_A);

    await ack(KEY_A, "receipt-a", {
      status: "failed",
      printerName: "USB-1",
      response: "Paper out",
    });

    const row = await receiptRow("receipt-a");
    // A jam is transient. Leaving the row `failed` here is what made a receipt
    // silently never print until someone noticed and reprinted it by hand.
    expect(row?.printStatus).toBe("pending");
    expect(row?.printedAt).toBeNull();
    // The last error stays readable while the retry is queued.
    expect(row?.printerResponse).toBe("Paper out");
    expect(row?.printerName).toBe("USB-1");
    expect(row?.claimedAt).toBeNull();

    // The very next poll picks it up again — the retry is paced by the poll
    // cadence, there is no backoff.
    const body = await claimedJob(await poll(KEY_A));
    expect(body.data?.receiptId).toBe("receipt-a");
    expect((await receiptRow("receipt-a"))?.printAttempts).toBe(2);
  });

  it("never re-queues an indeterminate print, however many attempts are left", async () => {
    await seedReceipt("receipt-a", REGISTER_A, ORDER_A);
    await poll(KEY_A);

    // The agent gave up waiting on the printer without ever learning the
    // outcome — its local queue is still retrying a job it could not cancel.
    // That bill may already be on paper, so a re-queue prints it twice.
    await ack(KEY_A, "receipt-a", {
      status: "indeterminate",
      printerName: "USB-1",
      response: "Timed out waiting for physical printer completion",
    });

    const row = await receiptRow("receipt-a");
    expect(row?.printStatus).toBe("failed");
    expect(row?.printAttempts).toBe(1);
    expect(row?.printedAt).toBeNull();
    // Readable on the row so a human can decide whether to reprint.
    expect(row?.printerResponse).toBe(
      "Timed out waiting for physical printer completion",
    );
    expect(row?.printerName).toBe("USB-1");
    expect(row?.claimedAt).toBeNull();

    // Terminal despite four attempts remaining: no later poll reclaims it.
    expect((await claimedJob(await poll(KEY_A))).data).toBeNull();
    expect((await receiptRow("receipt-a"))?.printAttempts).toBe(1);
  });

  it("keeps a failed print failed once the attempt budget is spent", async () => {
    // One short of the budget, so the poll below lands on exactly the cap.
    await seedReceipt("receipt-a", REGISTER_A, ORDER_A, { printAttempts: 4 });
    await poll(KEY_A);
    expect((await receiptRow("receipt-a"))?.printAttempts).toBe(5);

    await ack(KEY_A, "receipt-a", {
      status: "failed",
      printerName: "USB-1",
      response: "Paper out",
    });

    const row = await receiptRow("receipt-a");
    expect(row?.printStatus).toBe("failed");
    expect(row?.printedAt).toBeNull();
    expect(row?.printerResponse).toBe("Paper out");

    // Terminal: no later poll reclaims it.
    expect((await claimedJob(await poll(KEY_A))).data).toBeNull();
    expect((await receiptRow("receipt-a"))?.printAttempts).toBe(5);
  });

  it("bounds the retry loop by the delivery budget", async () => {
    await seedReceipt("receipt-a", REGISTER_A, ORDER_A);

    // The same claim/fail cycle the agent would drive against a printer that
    // never recovers. It has to stop on its own.
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect((await claimedJob(await poll(KEY_A))).data?.receiptId).toBe(
        "receipt-a",
      );
      await ack(KEY_A, "receipt-a", {
        status: "failed",
        response: `jam ${attempt}`,
      });
    }

    const row = await receiptRow("receipt-a");
    expect(row?.printStatus).toBe("failed");
    expect(row?.printAttempts).toBe(5);
    expect(row?.printerResponse).toBe("jam 5");
    expect((await claimedJob(await poll(KEY_A))).data).toBeNull();
  });

  it("keeps a till agent away from register-less kitchen tickets", async () => {
    // The till agent is bound to REGISTER_A; the ticket belongs to no till.
    // `IS` rather than `=` is what makes NULL match NULL — with `=` this
    // ticket would match nothing at all and never print.
    await seedReceipt("kitchen-1", null, ORDER_A, { receiptType: "kitchen" });

    expect((await claimedJob(await poll(KEY_A))).data).toBeNull();
    expect((await receiptRow("kitchen-1"))?.printStatus).toBe("pending");
  });

  it("hands a kitchen ticket to the shop agent", async () => {
    await seedShopAgent(SHOP_A, KITCHEN_KEY_A);
    await seedReceipt("kitchen-1", null, ORDER_A, { receiptType: "kitchen" });

    const body = await claimedJob(await poll(KITCHEN_KEY_A));

    expect(body.data?.receiptId).toBe("kitchen-1");
    expect((await receiptRow("kitchen-1"))?.printStatus).toBe("printing");
  });

  // A kitchen ticket is raised when the order is confirmed; cancelling the
  // order afterwards left it pending, so the kitchen would be handed a ticket
  // for food nobody wants. Production had one such ticket queued (2026-09-22).
  it("voids a kitchen ticket whose order was cancelled instead of printing it", async () => {
    await seedShopAgent(SHOP_A, KITCHEN_KEY_A);
    await testDb.drizzle
      .update(orders)
      .set({ status: "cancelled" })
      .where(eq(orders.id, ORDER_A));
    await seedReceipt("kitchen-1", null, ORDER_A, { receiptType: "kitchen" });

    expect((await claimedJob(await poll(KITCHEN_KEY_A))).data).toBeNull();
    expect(await receiptRow("kitchen-1")).toMatchObject({
      printStatus: "cancelled",
      printAttempts: 0,
    });
  });

  it("still prints a till receipt for a cancelled order", async () => {
    // Only kitchen tickets are orders to cook. A customer receipt for a
    // cancelled order (e.g. a void slip) is the till's business.
    await testDb.drizzle
      .update(orders)
      .set({ status: "cancelled" })
      .where(eq(orders.id, ORDER_A));
    await seedReceipt("receipt-1", REGISTER_A, ORDER_A);

    expect((await claimedJob(await poll(KEY_A))).data?.receiptId).toBe(
      "receipt-1",
    );
  });

  it("keeps a shop agent away from a till's receipts", async () => {
    await seedShopAgent(SHOP_A, KITCHEN_KEY_A);
    await seedReceipt("receipt-a", REGISTER_A, ORDER_A);

    expect((await claimedJob(await poll(KITCHEN_KEY_A))).data).toBeNull();
    expect((await receiptRow("receipt-a"))?.printStatus).toBe("pending");
  });

  it("never hands another shop's kitchen ticket to this shop's agent", async () => {
    await seedShopAgent(SHOP_A, KITCHEN_KEY_A);
    await seedReceipt("kitchen-b", null, ORDER_B, { receiptType: "kitchen" });

    // Both agents are register-less, so the register predicate matches. Only
    // the restaurant check keeps them apart.
    expect((await claimedJob(await poll(KITCHEN_KEY_A))).data).toBeNull();
    expect((await receiptRow("kitchen-b"))?.printStatus).toBe("pending");
  });

  it("records the printer counts the agent reports", async () => {
    await poll(KEY_A, "?printersTotal=2&printersOnline=1");

    const [agent] = await testDb.drizzle
      .select()
      .from(printAgents)
      .where(eq(printAgents.registerId, REGISTER_A));
    expect(agent).toMatchObject({ printersTotal: 2, printersOnline: 1 });
  });

  it("keeps the last printer counts when the agent reports none", async () => {
    await poll(KEY_A, "?printersTotal=2&printersOnline=2");
    // A probe failure sends no counts at all. Treating that as "zero online"
    // would raise a false alarm about a printer that is very likely fine.
    await poll(KEY_A);

    const [agent] = await testDb.drizzle
      .select()
      .from(printAgents)
      .where(eq(printAgents.registerId, REGISTER_A));
    expect(agent).toMatchObject({ printersTotal: 2, printersOnline: 2 });
  });

  it("hands a receipt to only one of two concurrent polls", async () => {
    await seedReceipt("receipt-a", REGISTER_A, ORDER_A);

    const claims = await Promise.all([poll(KEY_A), poll(KEY_A)]);
    const bodies = await Promise.all(claims.map(claimedJob));

    expect(bodies.filter((body) => body.data !== null)).toHaveLength(1);
    expect((await receiptRow("receipt-a"))?.printAttempts).toBe(1);
  });
});
