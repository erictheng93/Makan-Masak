/**
 * Query Performance Benchmark Tests
 *
 * Comprehensive performance tests for critical database queries
 * Tests cover:
 * - Menu item queries (most frequent)
 * - Order queries (business critical)
 * - Table management queries
 * - User/authentication queries
 * - Analytics queries
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DatabasePerformanceTester } from "./db-performance-tester";
import { createTestDB, cleanupTestDB } from "../../helpers/test-db";

describe("Database Query Performance Benchmarks", () => {
  let db: any;
  let tester: DatabasePerformanceTester;
  let testRestaurantId: string;
  const PERFORMANCE_THRESHOLD_MS = 100; // Queries should complete within 100ms

  beforeAll(async () => {
    // Setup test database
    db = await createTestDB();
    tester = new DatabasePerformanceTester(db);

    // Create test data
    testRestaurantId = await setupTestData(db);
  });

  afterAll(async () => {
    await cleanupTestDB(db);
  });

  describe("Menu Item Queries", () => {
    it("should fetch menu items by restaurant efficiently", async () => {
      const query = `
        SELECT * FROM menu_items
        WHERE restaurant_id = ? AND is_available = true
        ORDER BY sort_order
        LIMIT 50
      `;

      const result = await tester.benchmarkQuery(query, [testRestaurantId], 10);

      console.log(`📊 Menu Items Query Performance:`);
      console.log(`   Average: ${result.avgTime.toFixed(2)}ms`);
      console.log(`   P95: ${result.p95Time.toFixed(2)}ms`);
      console.log(`   P99: ${result.p99Time.toFixed(2)}ms`);

      // Performance assertions
      expect(result.avgTime).toBeLessThan(PERFORMANCE_THRESHOLD_MS);
      expect(result.p95Time).toBeLessThan(PERFORMANCE_THRESHOLD_MS * 1.5);
      expect(result.stdDev).toBeLessThan(20); // Low variance
    });

    it("should validate index usage for menu items query", async () => {
      const query = `
        SELECT * FROM menu_items
        WHERE restaurant_id = ? AND is_available = true
        ORDER BY sort_order
      `;

      const result = await tester.validateIndexUsage(query, [testRestaurantId]);

      console.log(`🔍 Menu Items Index Validation:`);
      console.log(`   Index Used: ${result.indexUsed ? "✅" : "❌"}`);
      console.log(`   Execution Time: ${result.executionTime.toFixed(2)}ms`);
      console.log(`   ${result.recommendation}`);

      // Should use index for better performance
      expect(result.indexUsed).toBe(true);
      expect(result.executionTime).toBeLessThan(50);
    });

    it("should handle menu item search efficiently", async () => {
      // Note: real schema does not have a `name_en` column on menu_items;
      // search now only matches the single `name` field.
      const query = `
        SELECT * FROM menu_items
        WHERE restaurant_id = ?
          AND is_available = true
          AND name LIKE ?
        LIMIT 20
      `;

      const searchTerm = "%beef%";
      const result = await tester.benchmarkQuery(
        query,
        [testRestaurantId, searchTerm],
        10,
      );

      console.log(`📊 Menu Search Performance:`);
      console.log(`   Average: ${result.avgTime.toFixed(2)}ms`);
      console.log(`   P95: ${result.p95Time.toFixed(2)}ms`);

      expect(result.avgTime).toBeLessThan(PERFORMANCE_THRESHOLD_MS);
    });

    it("should fetch menu items with category JOIN efficiently", async () => {
      // categories.display_order does not exist in the real schema; the
      // equivalent column is `sort_order`.
      const query = `
        SELECT mi.*, c.name as category_name
        FROM menu_items mi
        LEFT JOIN categories c ON mi.category_id = c.id
        WHERE mi.restaurant_id = ? AND mi.is_available = true
        ORDER BY c.sort_order, mi.sort_order
        LIMIT 50
      `;

      const result = await tester.benchmarkQuery(query, [testRestaurantId], 10);

      console.log(`📊 Menu with Category JOIN Performance:`);
      console.log(`   Average: ${result.avgTime.toFixed(2)}ms`);
      console.log(`   P95: ${result.p95Time.toFixed(2)}ms`);

      expect(result.avgTime).toBeLessThan(PERFORMANCE_THRESHOLD_MS * 1.5); // JOINs can be slower
    });
  });

  describe("Order Queries", () => {
    it("should fetch orders list efficiently", async () => {
      // Real schema uses `created_at_ms` (integer Unix ms), not `created_at`.
      const query = `
        SELECT * FROM orders
        WHERE restaurant_id = ?
        ORDER BY created_at_ms DESC
        LIMIT 20
      `;

      const result = await tester.benchmarkQuery(query, [testRestaurantId], 10);

      console.log(`📊 Orders List Performance:`);
      console.log(`   Average: ${result.avgTime.toFixed(2)}ms`);
      console.log(`   P95: ${result.p95Time.toFixed(2)}ms`);

      expect(result.avgTime).toBeLessThan(PERFORMANCE_THRESHOLD_MS);
      expect(result.p95Time).toBeLessThan(PERFORMANCE_THRESHOLD_MS * 1.5);
    });

    it("should validate index usage for orders query", async () => {
      // Index `orders_restaurant_status_idx` covers (restaurant_id, status,
      // created_at_ms) and is the canonical filter+sort path for the
      // "list orders by status, newest first" use case.
      const query = `
        SELECT * FROM orders
        WHERE restaurant_id = ? AND status = ?
        ORDER BY created_at_ms DESC
      `;

      const result = await tester.validateIndexUsage(query, [
        testRestaurantId,
        "pending",
      ]);

      console.log(`🔍 Orders Index Validation:`);
      console.log(`   Index Used: ${result.indexUsed ? "✅" : "❌"}`);
      console.log(`   ${result.recommendation}`);

      expect(result.indexUsed).toBe(true);
    });

    it("should fetch order with items efficiently (avoid N+1)", async () => {
      // This should be done in a single query with JOIN
      const query = `
        SELECT
          o.*,
          json_group_array(
            json_object(
              'id', oi.id,
              'menu_item_id', oi.menu_item_id,
              'quantity', oi.quantity,
              'unit_price_cents', oi.unit_price_cents,
              'item_name', mi.name
            )
          ) as items
        FROM orders o
        LEFT JOIN order_items oi ON o.id = oi.order_id
        LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
        WHERE o.id = ?
        GROUP BY o.id
      `;

      const result = await tester.benchmarkQuery(query, [1], 10);

      console.log(`📊 Order with Items (JOIN) Performance:`);
      console.log(`   Average: ${result.avgTime.toFixed(2)}ms`);
      console.log(`   P95: ${result.p95Time.toFixed(2)}ms`);

      expect(result.avgTime).toBeLessThan(PERFORMANCE_THRESHOLD_MS * 2); // More complex query
    });

    it("should handle order status updates efficiently", async () => {
      const query = `
        UPDATE orders
        SET status = ?, updated_at_ms = ?
        WHERE id = ?
      `;

      const result = await tester.benchmarkQuery(
        query,
        ["confirmed", Date.now(), 1],
        10,
      );

      console.log(`📊 Order Status Update Performance:`);
      console.log(`   Average: ${result.avgTime.toFixed(2)}ms`);

      expect(result.avgTime).toBeLessThan(50); // Updates should be very fast
    });
  });

  describe("Table Management Queries", () => {
    it("should fetch tables list efficiently", async () => {
      const query = `
        SELECT * FROM tables
        WHERE restaurant_id = ? AND is_active = true
        ORDER BY number
      `;

      const result = await tester.benchmarkQuery(query, [testRestaurantId], 10);

      console.log(`📊 Tables List Performance:`);
      console.log(`   Average: ${result.avgTime.toFixed(2)}ms`);

      expect(result.avgTime).toBeLessThan(50); // Should be very fast
    });

    it("should validate table availability check performance", async () => {
      const query = `
        SELECT t.*,
          CASE WHEN EXISTS (
            SELECT 1 FROM orders o
            WHERE o.table_id = t.id
              AND o.status IN ('pending', 'confirmed', 'preparing')
          ) THEN 1 ELSE 0 END as is_occupied
        FROM tables t
        WHERE t.restaurant_id = ? AND t.is_active = true
      `;

      const result = await tester.benchmarkQuery(query, [testRestaurantId], 10);

      console.log(`📊 Table Availability Check Performance:`);
      console.log(`   Average: ${result.avgTime.toFixed(2)}ms`);
      console.log(`   P95: ${result.p95Time.toFixed(2)}ms`);

      expect(result.avgTime).toBeLessThan(PERFORMANCE_THRESHOLD_MS);
    });
  });

  describe("User/Authentication Queries", () => {
    it("should fetch user by username efficiently", async () => {
      const query = `
        SELECT * FROM users
        WHERE username = ? AND is_active = true
        LIMIT 1
      `;

      const result = await tester.benchmarkQuery(query, ["testuser"], 10);

      console.log(`📊 User Lookup Performance:`);
      console.log(`   Average: ${result.avgTime.toFixed(2)}ms`);

      expect(result.avgTime).toBeLessThan(30); // Should be very fast
    });

    it("should validate index on username", async () => {
      const query = `SELECT * FROM users WHERE username = ?`;

      const result = await tester.validateIndexUsage(query, ["testuser"]);

      console.log(`🔍 Username Index Validation:`);
      console.log(`   Index Used: ${result.indexUsed ? "✅" : "❌"}`);

      expect(result.indexUsed).toBe(true);
    });
  });

  describe("Analytics Queries", () => {
    it("should calculate daily revenue efficiently", async () => {
      // `created_at_ms` is integer Unix milliseconds; convert to a date
      // string via `unixepoch` for grouping. Status is `delivered` per the
      // canonical state machine in packages/database/src/schema/orders.ts
      // (the legacy `completed` value never existed at the SQL level).
      const query = `
        SELECT
          DATE(created_at_ms / 1000, 'unixepoch') as date,
          COUNT(*) as order_count,
          SUM(total_amount_cents) as revenue_cents
        FROM orders
        WHERE restaurant_id = ?
          AND created_at_ms >= (unixepoch('now', '-30 days') * 1000)
          AND status = 'delivered'
        GROUP BY DATE(created_at_ms / 1000, 'unixepoch')
        ORDER BY date DESC
      `;

      const result = await tester.benchmarkQuery(query, [testRestaurantId], 10);

      console.log(`📊 Daily Revenue Analytics Performance:`);
      console.log(`   Average: ${result.avgTime.toFixed(2)}ms`);
      console.log(`   P95: ${result.p95Time.toFixed(2)}ms`);

      expect(result.avgTime).toBeLessThan(PERFORMANCE_THRESHOLD_MS * 2); // Analytics can be slower
    });

    it("should calculate popular menu items efficiently", async () => {
      const query = `
        SELECT
          mi.id,
          mi.name,
          COUNT(oi.id) as order_count,
          SUM(oi.quantity) as total_quantity
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        JOIN menu_items mi ON mi.id = oi.menu_item_id
        WHERE o.restaurant_id = ?
          AND o.created_at_ms >= (unixepoch('now', '-7 days') * 1000)
        GROUP BY mi.id, mi.name
        ORDER BY total_quantity DESC
        LIMIT 10
      `;

      const result = await tester.benchmarkQuery(query, [testRestaurantId], 10);

      console.log(`📊 Popular Items Analytics Performance:`);
      console.log(`   Average: ${result.avgTime.toFixed(2)}ms`);

      expect(result.avgTime).toBeLessThan(PERFORMANCE_THRESHOLD_MS * 2);
    });
  });

  describe("Concurrent Load Testing", () => {
    it("should handle 10 concurrent menu queries", async () => {
      const query = `
        SELECT * FROM menu_items
        WHERE restaurant_id = ? AND is_available = true
        LIMIT 50
      `;

      const result = await tester.benchmarkConcurrent(
        query,
        [testRestaurantId],
        10,
      );

      console.log(`📊 Concurrent Load Test (10 queries):`);
      console.log(`   Total Time: ${result.totalTime.toFixed(2)}ms`);
      console.log(`   Avg Query Time: ${result.avgQueryTime.toFixed(2)}ms`);
      console.log(
        `   Success Rate: ${((result.successCount / result.concurrency) * 100).toFixed(1)}%`,
      );

      expect(result.successCount).toBe(10);
      expect(result.errorCount).toBe(0);
      expect(result.avgQueryTime).toBeLessThan(PERFORMANCE_THRESHOLD_MS * 2);
    });

    it("should handle 50 concurrent order queries", async () => {
      const query = `SELECT * FROM orders WHERE restaurant_id = ? LIMIT 20`;

      const result = await tester.benchmarkConcurrent(
        query,
        [testRestaurantId],
        50,
      );

      console.log(`📊 High Concurrent Load Test (50 queries):`);
      console.log(`   Total Time: ${result.totalTime.toFixed(2)}ms`);
      console.log(
        `   Success Rate: ${((result.successCount / result.concurrency) * 100).toFixed(1)}%`,
      );

      expect(result.successCount).toBeGreaterThan(45); // Allow some failures under high load
      expect(result.avgQueryTime).toBeLessThan(PERFORMANCE_THRESHOLD_MS * 3);
    });
  });

  describe("Stress Testing", () => {
    it("should maintain performance under sustained load", async () => {
      const query = `
        SELECT * FROM menu_items
        WHERE restaurant_id = ? AND is_available = true
        LIMIT 20
      `;

      const result = await tester.stressTest(query, [testRestaurantId], 2000);

      console.log(`📊 Stress Test (2 seconds):`);
      console.log(`   Total Queries: ${result.totalQueries}`);
      console.log(`   QPS: ${result.queriesPerSecond.toFixed(2)}`);
      console.log(`   Avg Time: ${result.avgTime.toFixed(2)}ms`);
      console.log(`   Max Time: ${result.maxTime.toFixed(2)}ms`);
      console.log(
        `   Success Rate: ${((result.successfulQueries / result.totalQueries) * 100).toFixed(1)}%`,
      );

      expect(result.queriesPerSecond).toBeGreaterThan(10); // At least 10 QPS
      expect(result.successfulQueries / result.totalQueries).toBeGreaterThan(
        0.95,
      ); // 95% success
      expect(result.avgTime).toBeLessThan(PERFORMANCE_THRESHOLD_MS);
      // The load window alone must not consume the default 5s test timeout.
    }, 10_000);
  });
});

/**
 * Helper: Seed deterministic test data
 *
 * Returns the restaurant_id (text public_id) used by the seeded rows so the
 * benchmark queries can bind it. The restaurant_id is text because the real
 * schema declares `restaurants.id text PRIMARY KEY` and every other table's
 * `restaurant_id` column is `text NOT NULL`.
 *
 * Notes on the rewrite vs. the original mock-era version:
 * - Timestamps are integer Unix milliseconds in `*_ms` columns (current
 *   Drizzle schema), not ISO strings in `created_at` columns.
 * - Restaurants now require `address`, `district`, `phone` (NOT NULL).
 * - Tables require a unique `qr_code` text column.
 * - Orders require `order_number` (unique) and `subtotal_cents`.
 * - Order items require `total_price_cents`.
 * - `categories.display_order` and `name_en` columns do not exist; use
 *   `sort_order` and skip the English name column.
 * - `menu_items.name_en` does not exist either.
 * - Status uses canonical string values matching the DB schema (no numeric).
 */
async function setupTestData(db: {
  prepare(sql: string): {
    bind(...args: unknown[]): { run(): Promise<unknown> };
  };
}): Promise<string> {
  const restaurantId = "perf_test_r1";
  const now = Date.now();

  // Create restaurant — text PK, all required NOT NULL fields populated.
  await db
    .prepare(
      `INSERT OR IGNORE INTO restaurants (
        id, name, type, category, address, district, phone,
        created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      restaurantId,
      "Performance Test Restaurant",
      "Casual Dining",
      "Restaurant",
      "123 Test Road",
      "西區",
      "04-1234-5678",
      now,
      now,
    )
    .run();

  // Create categories (10) — name only (no name_en column), sort_order
  // (no display_order column).
  for (let i = 1; i <= 10; i++) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO categories (
          id, restaurant_id, name, sort_order, is_active,
          created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(i, restaurantId, `分類 ${i}`, i, 1, now, now)
      .run();
  }

  // Create menu items (100) — distribute across categories.
  for (let i = 1; i <= 100; i++) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO menu_items (
          id, restaurant_id, category_id, name, price_cents, is_available, sort_order,
          created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        i,
        restaurantId,
        (i % 10) + 1,
        `菜品 ${i}`,
        (Math.floor(Math.random() * 200) + 50) * 100,
        1,
        i,
        now,
        now,
      )
      .run();
  }

  // Create tables (20) — qr_code is NOT NULL UNIQUE, generate per row.
  for (let i = 1; i <= 20; i++) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO tables (
          id, restaurant_id, number, capacity, qr_code, is_active,
          created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        i,
        restaurantId,
        `T${i}`,
        Math.floor(Math.random() * 6) + 2,
        `qr_${restaurantId}_t${i}`,
        1,
        now,
        now,
      )
      .run();
  }

  // Create users (5).
  for (let i = 1; i <= 5; i++) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO users (
          id, restaurant_id, username, email, full_name, password_hash,
          role, is_active, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        i,
        restaurantId,
        `testuser${i}`,
        `test${i}@example.com`,
        `Test User ${i}`,
        "hashedpassword",
        i % 5,
        1,
        now,
        now,
      )
      .run();
  }

  // Create orders (50) — order_number unique per row, subtotal_cents/total_amount_cents
  // both NOT NULL. Status uses canonical string values (no numeric).
  const statuses = ["pending", "confirmed", "preparing", "delivered"] as const;
  for (let i = 1; i <= 50; i++) {
    const subtotalCents = (Math.floor(Math.random() * 500) + 100) * 100;
    const createdMs =
      now - Math.floor(Math.random() * 30 * 24 * 60 * 60 * 1000);
    await db
      .prepare(
        `INSERT OR IGNORE INTO orders (
          id, restaurant_id, table_id, order_number, status, subtotal_cents, total_amount_cents,
          created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        i,
        restaurantId,
        (i % 20) + 1,
        `PERF-${i.toString().padStart(6, "0")}`,
        statuses[i % statuses.length],
        subtotalCents,
        subtotalCents,
        createdMs,
        createdMs,
      )
      .run();

    // Create order items (2-5 per order) — total_price_cents is NOT NULL.
    const itemCount = Math.floor(Math.random() * 4) + 2;
    for (let j = 1; j <= itemCount; j++) {
      const quantity = Math.floor(Math.random() * 3) + 1;
      const unitPriceCents = (Math.floor(Math.random() * 200) + 50) * 100;
      await db
        .prepare(
          `INSERT OR IGNORE INTO order_items (
            order_id, menu_item_id, quantity, unit_price_cents, total_price_cents,
            created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          i,
          Math.floor(Math.random() * 100) + 1,
          quantity,
          unitPriceCents,
          quantity * unitPriceCents,
          now,
          now,
        )
        .run();
    }
  }

  // Decoy data: seed 5 unrelated restaurants each with their own
  // categories + menu_items + orders so that the test restaurant only
  // accounts for ~15% of every table. Without this, ANALYZE concludes
  // that `WHERE restaurant_id = ?` matches 100% of rows and the planner
  // chooses a full SCAN over any index — which makes the index-usage
  // assertions fail not because the index is wrong but because the
  // workload doesn't justify it. Decoy data makes the test reflect a
  // real multi-tenant deployment.
  for (let r = 1; r <= 5; r++) {
    const decoyId = `decoy_r${r}`;
    await db
      .prepare(
        `INSERT OR IGNORE INTO restaurants (
          id, name, type, category, address, district, phone,
          created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        decoyId,
        `Decoy ${r}`,
        "Casual Dining",
        "Restaurant",
        "456 Other Road",
        "東區",
        "04-9999-0000",
        now,
        now,
      )
      .run();
    // 5 decoy categories per decoy restaurant — IDs offset to avoid clash
    // with the test restaurant's categories.
    for (let c = 1; c <= 5; c++) {
      const catId = 100 + r * 10 + c;
      await db
        .prepare(
          `INSERT OR IGNORE INTO categories (
            id, restaurant_id, name, sort_order, is_active,
            created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(catId, decoyId, `Decoy Cat ${r}-${c}`, c, 1, now, now)
        .run();
    }
    // 50 decoy menu items per decoy restaurant (250 total decoy items).
    for (let i = 1; i <= 50; i++) {
      const itemId = 1000 + r * 100 + i;
      await db
        .prepare(
          `INSERT OR IGNORE INTO menu_items (
            id, restaurant_id, category_id, name, price_cents, is_available, sort_order,
            created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          itemId,
          decoyId,
          100 + r * 10 + ((i % 5) + 1),
          `Decoy Item ${r}-${i}`,
          15000,
          1,
          i,
          now,
          now,
        )
        .run();
    }
    // 20 decoy orders per decoy restaurant (100 total).
    for (let o = 1; o <= 20; o++) {
      const orderId = 1000 + r * 100 + o;
      await db
        .prepare(
          `INSERT OR IGNORE INTO orders (
            id, restaurant_id, table_id, order_number, status, subtotal_cents, total_amount_cents,
            created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          orderId,
          decoyId,
          null,
          `DECOY-${r}-${o.toString().padStart(4, "0")}`,
          statuses[o % statuses.length],
          15000,
          15000,
          now,
          now,
        )
        .run();
    }
  }

  // Re-run ANALYZE so the planner sees the freshly inserted rows (test
  // data + decoys) when EXPLAIN QUERY PLAN runs in the index-validation
  // tests.
  await db.prepare("ANALYZE").bind().run();

  return restaurantId;
}
