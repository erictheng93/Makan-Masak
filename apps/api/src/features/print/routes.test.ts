import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { D1DatabaseAdapter } from "../../../../../tests/helpers/d1-adapter";
import routes from "./routes";
import { hashPrintAgentKey } from "../../shared/utils/print-agent-key";

describe("print agent job claims", () => {
  it("cancels an abandoned kitchen claim when its order was cancelled", async () => {
    const db = new Database(":memory:");
    try {
      db.exec(`
        CREATE TABLE print_agents (
          id TEXT, restaurant_id TEXT, register_id TEXT, key_hash TEXT,
          revoked_at_ms INTEGER, last_seen_at_ms INTEGER, updated_at_ms INTEGER,
          printers_total INTEGER, printers_online INTEGER
        );
        CREATE TABLE orders (id TEXT, restaurant_id TEXT, status TEXT);
        CREATE TABLE receipts (
          id TEXT, order_id TEXT, register_id TEXT, receipt_type TEXT,
          print_status TEXT, print_attempts INTEGER, claimed_at_ms INTEGER,
          printer_response TEXT, created_at_ms INTEGER, content TEXT
        );
      `);
      const key = "test-kitchen-agent-key";
      db.prepare(
        "INSERT INTO print_agents (id, restaurant_id, key_hash) VALUES (?, ?, ?)",
      ).run("agent-1", "shop-1", await hashPrintAgentKey(key));
      db.prepare("INSERT INTO orders VALUES (?, ?, ?)").run(
        "order-1",
        "shop-1",
        "cancelled",
      );
      db.prepare(
        "INSERT INTO receipts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        "ticket-1",
        "order-1",
        null,
        "kitchen",
        "printing",
        1,
        Date.now() - 6 * 60 * 1000,
        null,
        Date.now(),
        "{}",
      );

      const d1 = new D1DatabaseAdapter(db);
      const response = await routes.request(
        "/jobs",
        { headers: { "X-Print-Agent-Key": key } },
        { DB: d1 } as never,
      );

      expect(response.status).toBe(200);
      expect((await response.json()) as unknown).toMatchObject({ data: null });
      expect(
        db
          .prepare(
            "SELECT print_status, print_attempts, claimed_at_ms FROM receipts WHERE id = ?",
          )
          .get("ticket-1"),
      ).toEqual({
        print_status: "cancelled",
        print_attempts: 1,
        claimed_at_ms: null,
      });
    } finally {
      db.close();
    }
  });
});
