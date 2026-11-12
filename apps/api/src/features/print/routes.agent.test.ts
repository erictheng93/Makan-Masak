import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { D1DatabaseAdapter } from "../../../../../tests/helpers/d1-adapter";
import routes from "./routes";
import { hashPrintAgentKey } from "../../shared/utils/print-agent-key";

const KEY = "agent-key-shop-1";

interface ReceiptSeed {
  id: string;
  orderId?: string;
  registerId?: string | null;
  type?: string;
  status?: string;
  attempts?: number;
  claimedAt?: number | null;
  createdAt?: number;
  content?: string;
}

const dbs: Database.Database[] = [];
afterEach(() => {
  while (dbs.length) dbs.pop()?.close();
});

async function setup(agent: { registerId?: string | null } = {}) {
  const db = new Database(":memory:");
  dbs.push(db);
  db.exec(`
    CREATE TABLE print_agents (
      id TEXT, restaurant_id TEXT, register_id TEXT, key_hash TEXT,
      revoked_at_ms INTEGER, last_seen_at_ms INTEGER, updated_at_ms INTEGER,
      printers_total INTEGER, printers_online INTEGER
    );
    CREATE TABLE orders (id TEXT, restaurant_id TEXT, status TEXT);
    CREATE TABLE restaurants (id TEXT, name TEXT, address TEXT, phone TEXT);
    CREATE TABLE receipts (
      id TEXT, order_id TEXT, register_id TEXT, receipt_type TEXT,
      print_status TEXT, print_attempts INTEGER, claimed_at_ms INTEGER,
      printer_name TEXT, printer_response TEXT, printed_at_ms INTEGER,
      created_at_ms INTEGER, content TEXT
    );
  `);
  db.prepare(
    "INSERT INTO print_agents (id, restaurant_id, register_id, key_hash) VALUES (?, ?, ?, ?)",
  ).run(
    "agent-1",
    "shop-1",
    agent.registerId ?? null,
    await hashPrintAgentKey(KEY),
  );
  db.prepare("INSERT INTO restaurants VALUES (?, ?, ?, ?)").run(
    "shop-1",
    "Noodle House",
    "1 Main St",
    "555-0100",
  );
  db.prepare("INSERT INTO orders VALUES (?, ?, ?)").run(
    "order-1",
    "shop-1",
    "paid",
  );
  db.prepare("INSERT INTO orders VALUES (?, ?, ?)").run(
    "order-2",
    "shop-2",
    "paid",
  );

  const seed = (r: ReceiptSeed) =>
    db
      .prepare(
        `INSERT INTO receipts (id, order_id, register_id, receipt_type, print_status,
           print_attempts, claimed_at_ms, created_at_ms, content)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.id,
        r.orderId ?? "order-1",
        r.registerId ?? null,
        r.type ?? "receipt",
        r.status ?? "pending",
        r.attempts ?? 0,
        r.claimedAt ?? null,
        r.createdAt ?? 1_000,
        r.content ?? "{}",
      );
  const row = (id: string) =>
    db.prepare("SELECT * FROM receipts WHERE id = ?").get(id) as Record<
      string,
      unknown
    >;
  const env = { DB: new D1DatabaseAdapter(db) } as never;
  const get = (
    path: string,
    headers: Record<string, string> = { "X-Print-Agent-Key": KEY },
  ) => routes.request(path, { headers }, env);
  const ack = (
    id: string,
    body: unknown,
    headers: Record<string, string> = { "X-Print-Agent-Key": KEY },
  ) =>
    routes.request(
      `/jobs/${id}/ack`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      },
      env,
    );
  return { db, seed, row, get, ack };
}

describe("print agent authentication", () => {
  it("rejects a poll with no key", async () => {
    const { get } = await setup();
    const res = await get("/jobs", {});
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: "UNAUTHORIZED" },
    });
  });

  it("rejects an unknown key and a revoked key", async () => {
    const { get, db } = await setup();
    expect((await get("/jobs", { "X-Print-Agent-Key": "nope" })).status).toBe(
      401,
    );

    db.prepare("UPDATE print_agents SET revoked_at_ms = ?").run(Date.now());
    expect((await get("/jobs")).status).toBe(401);
  });

  it("rejects an ack with no key before reading the body", async () => {
    const { ack, seed, row } = await setup();
    seed({ id: "r1", status: "printing" });
    expect((await ack("r1", { status: "printed" }, {})).status).toBe(401);
    expect(row("r1").print_status).toBe("printing");
  });
});

describe("GET /jobs heartbeat and claiming", () => {
  it("records printer counts and returns null when no printer is online, without claiming", async () => {
    const { get, seed, row, db } = await setup();
    seed({ id: "r1" });

    const res = await get("/jobs?printersTotal=2&printersOnline=0");

    expect(await res.json()).toEqual({ success: true, data: null });
    expect(row("r1").print_status).toBe("pending");
    expect(
      db
        .prepare(
          "SELECT printers_total, printers_online, last_seen_at_ms FROM print_agents",
        )
        .get(),
    ).toEqual({
      printers_total: 2,
      printers_online: 0,
      last_seen_at_ms: expect.any(Number),
    });
  });

  it("ignores malformed or out-of-range printer counts instead of overwriting readings", async () => {
    const { get, db } = await setup();
    db.prepare(
      "UPDATE print_agents SET printers_total = 4, printers_online = 3",
    ).run();

    await get("/jobs?printersTotal=abc&printersOnline=-1");
    await get("/jobs?printersTotal=1001&printersOnline=1.5");

    expect(
      db
        .prepare("SELECT printers_total, printers_online FROM print_agents")
        .get(),
    ).toEqual({ printers_total: 4, printers_online: 3 });
  });

  it("returns null when the queue is empty", async () => {
    const { get } = await setup();
    expect(await (await get("/jobs")).json()).toEqual({
      success: true,
      data: null,
    });
  });

  it("claims the oldest pending receipt and returns a print request with shop details", async () => {
    const { get, seed, row } = await setup();
    seed({ id: "newer", createdAt: 2_000 });
    seed({
      id: "older",
      createdAt: 1_000,
      content: JSON.stringify({
        orderNumber: "A-7",
        cashier: "Ann",
        tableNumber: "T3",
        customerName: "Bob",
        paymentMethod: "cash",
        subtotal: 100,
        taxAmount: 5,
        totalAmount: 105,
        items: [
          {
            name: "Laksa",
            quantity: 2,
            price: 50,
            notes: "no egg",
            modifiers: [{ name: "extra", price: 5 }, { price: 1 }, null],
          },
          {},
        ],
      }),
    });

    const body = (await (await get("/jobs")).json()) as {
      data: { receiptId: string; request: Record<string, any> };
    };

    expect(body.data.receiptId).toBe("older");
    expect(body.data.request).toMatchObject({
      type: "receipt",
      restaurantId: "shop-1",
      data: {
        restaurant: {
          name: "Noodle House",
          address: "1 Main St",
          phone: "555-0100",
        },
        cashier: "Ann",
        order: {
          id: "order-1",
          orderNumber: "A-7",
          tableNumber: "T3",
          subtotal: 100,
          tax: 5,
          total: 105,
          items: [
            {
              name: "Laksa",
              quantity: 2,
              price: 50,
              notes: "no egg",
              modifiers: [{ name: "extra", price: 5 }],
            },
            { name: "Item", quantity: 1, price: 0 },
          ],
        },
        customer: { name: "Bob" },
        payment: { method: "cash", amount: 105, transactionId: "older" },
      },
    });
    expect(row("older")).toMatchObject({
      print_status: "printing",
      print_attempts: 1,
    });
    expect(row("older").claimed_at_ms).toEqual(expect.any(Number));
    expect(row("newer").print_status).toBe("pending");
  });

  it("types kitchen tickets as kitchen and survives a malformed payload", async () => {
    const { get, seed } = await setup();
    seed({ id: "k1", type: "kitchen", content: "{not json" });

    const body = (await (await get("/jobs")).json()) as {
      data: { request: Record<string, any> };
    };

    expect(body.data.request.type).toBe("kitchen");
    expect(body.data.request.data.order).toMatchObject({
      id: "order-1",
      items: [],
      total: 0,
    });
    expect(body.data.request.data.customer).toBeUndefined();
    expect(body.data.request.data.payment).toBeUndefined();
  });

  it("never hands out another shop's receipts", async () => {
    const { get, seed, row } = await setup();
    seed({ id: "foreign", orderId: "order-2" });

    expect(await (await get("/jobs")).json()).toEqual({
      success: true,
      data: null,
    });
    expect(row("foreign").print_status).toBe("pending");
  });

  it("keeps register agents and shop agents on separate queues", async () => {
    const tillAgent = await setup({ registerId: "till-1" });
    tillAgent.seed({ id: "shop-ticket", registerId: null });
    tillAgent.seed({ id: "other-till", registerId: "till-2" });
    tillAgent.seed({ id: "mine", registerId: "till-1", createdAt: 5_000 });

    const body = (await (await tillAgent.get("/jobs")).json()) as {
      data: { receiptId: string };
    };
    expect(body.data.receiptId).toBe("mine");

    const shopAgent = await setup({ registerId: null });
    shopAgent.seed({ id: "till-receipt", registerId: "till-1" });
    expect(await (await shopAgent.get("/jobs")).json()).toEqual({
      success: true,
      data: null,
    });
  });

  it("reclaims an abandoned claim that still has attempts left", async () => {
    const { get, seed, row } = await setup();
    seed({
      id: "stale",
      status: "printing",
      attempts: 2,
      claimedAt: Date.now() - 6 * 60_000,
    });

    const body = (await (await get("/jobs")).json()) as {
      data: { receiptId: string };
    };

    expect(body.data.receiptId).toBe("stale");
    expect(row("stale").print_attempts).toBe(3);
  });

  it("does not reclaim a recent claim", async () => {
    const { get, seed, row } = await setup();
    seed({
      id: "fresh",
      status: "printing",
      attempts: 1,
      claimedAt: Date.now() - 1_000,
    });

    expect(await (await get("/jobs")).json()).toEqual({
      success: true,
      data: null,
    });
    expect(row("fresh").print_attempts).toBe(1);
  });

  it("reclaims a claim that has no timestamp at all", async () => {
    const { get, seed } = await setup();
    seed({ id: "untracked", status: "printing", attempts: 1, claimedAt: null });

    const body = (await (await get("/jobs")).json()) as {
      data: { receiptId: string };
    };
    expect(body.data.receiptId).toBe("untracked");
  });

  it("gives up on an abandoned claim once the attempt budget is spent", async () => {
    const { get, seed, row } = await setup();
    seed({
      id: "poison",
      status: "printing",
      attempts: 5,
      claimedAt: Date.now() - 6 * 60_000,
    });

    expect(await (await get("/jobs")).json()).toEqual({
      success: true,
      data: null,
    });
    expect(row("poison")).toMatchObject({
      print_status: "failed",
      printer_response: "Abandoned after 5 delivery attempts",
      claimed_at_ms: null,
    });
  });

  it("does not cancel a cancelled order's ticket that belongs to another shop's agent", async () => {
    const { get, seed, row, db } = await setup();
    db.prepare(
      "UPDATE orders SET status = 'cancelled' WHERE id = 'order-2'",
    ).run();
    seed({ id: "foreign-kitchen", orderId: "order-2", type: "kitchen" });

    await get("/jobs");

    expect(row("foreign-kitchen").print_status).toBe("pending");
  });
});

describe("POST /jobs/:id/ack", () => {
  it("rejects a malformed body", async () => {
    const { ack, seed, row } = await setup();
    seed({ id: "r1", status: "printing" });

    for (const body of [
      "not json",
      { status: "done" },
      { status: "printed", response: "x".repeat(2001) },
    ]) {
      const res = await ack("r1", body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "VALIDATION_ERROR" },
      });
    }
    expect(row("r1").print_status).toBe("printing");
  });

  it("marks a printed job and records printer name and time", async () => {
    const { ack, seed, row } = await setup();
    seed({ id: "r1", status: "printing", attempts: 1, claimedAt: Date.now() });

    const res = await ack("r1", { status: "printed", printerName: " Epson " });

    expect(res.status).toBe(200);
    expect(row("r1")).toMatchObject({
      print_status: "printed",
      printer_name: "Epson",
      claimed_at_ms: null,
      printed_at_ms: expect.any(Number),
    });
  });

  it("re-queues a failed job while attempts remain and keeps the last error", async () => {
    const { ack, seed, row } = await setup();
    seed({ id: "r1", status: "printing", attempts: 2 });

    await ack("r1", { status: "failed", response: "paper jam" });

    expect(row("r1")).toMatchObject({
      print_status: "pending",
      printer_response: "paper jam",
      printed_at_ms: null,
    });
  });

  it("settles a failed job as failed once the attempt budget is spent", async () => {
    const { ack, seed, row } = await setup();
    seed({ id: "r1", status: "printing", attempts: 5 });

    await ack("r1", { status: "failed" });

    expect(row("r1").print_status).toBe("failed");
  });

  it("never re-queues an indeterminate job, however many attempts remain", async () => {
    const { ack, seed, row } = await setup();
    seed({ id: "r1", status: "printing", attempts: 1 });

    expect((await ack("r1", { status: "indeterminate" })).status).toBe(200);

    expect(row("r1").print_status).toBe("failed");
  });

  it("404s for an unknown id and for a job that is not currently claimed", async () => {
    const { ack, seed, row } = await setup();
    seed({ id: "pending-one", status: "pending" });

    for (const id of ["ghost", "pending-one"]) {
      const res = await ack(id, { status: "printed" });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({
        error: { code: "JOB_NOT_FOUND" },
      });
    }
    expect(row("pending-one").print_status).toBe("pending");
  });

  it("cannot settle another shop's or another till's job", async () => {
    const { ack, seed, row } = await setup({ registerId: "till-1" });
    seed({
      id: "foreign",
      orderId: "order-2",
      status: "printing",
      registerId: "till-1",
    });
    seed({ id: "other-till", status: "printing", registerId: "till-2" });

    expect((await ack("foreign", { status: "printed" })).status).toBe(404);
    expect((await ack("other-till", { status: "printed" })).status).toBe(404);
    expect(row("foreign").print_status).toBe("printing");
    expect(row("other-till").print_status).toBe("printing");
  });
});
