import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  auditLogs,
  countRestaurantData,
  getRestaurantDeletionPlan,
  orderItems,
  restaurants,
  seats,
  tables,
} from "@makanmasak/database";
import { eq } from "drizzle-orm";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers, type SeedHelpers } from "./helpers/seed-helper";

/**
 * Real D1 on purpose. What makes this delete safe is the database refusing to
 * commit while anything still points at the restaurant, and a mocked drizzle
 * would commit whatever it was handed.
 */
describe("permanent restaurant deletion (real D1)", () => {
  let testApp: RealIntegrationTestApp;
  let seed: SeedHelpers;

  beforeAll(async () => {
    testApp = await createRealIntegrationTestApp();
    seed = buildSeedHelpers(testApp.testDb);
  }, 120_000);

  afterAll(async () => {
    if (testApp) await testApp.dispose();
  });

  beforeEach(async () => {
    await testApp.testDb.truncateAll();
  });

  const db = () => testApp.testDb.drizzle;

  function csrf(headers: Record<string, string>): Record<string, string> {
    const token = "b".repeat(64);
    return {
      host: "test",
      origin: "https://test",
      "content-type": "application/json",
      "x-csrf-token": token,
      cookie: `csrf_token=${token}`,
      ...headers,
    };
  }

  async function administrator() {
    const admin = await seed.user({
      username: `root-${crypto.randomUUID().slice(0, 8)}`,
      role: 0,
      adminTier: "administrator",
    });
    return {
      id: admin.id,
      token: await testApp.authHelper.adminToken(undefined, admin.id),
    };
  }

  /** A shop with the kinds of rows a real one accumulates. */
  async function seedShop(name: string) {
    const restaurant = await seed.restaurant({ name });
    const owner = await seed.user({
      username: `owner-${crypto.randomUUID().slice(0, 8)}`,
      role: 1,
      restaurantId: restaurant.id,
    });
    const now = new Date();
    const [table] = await db()
      .insert(tables)
      .values({
        restaurantId: restaurant.id,
        number: "A1",
        capacity: 4,
        qrCode: `qr-${crypto.randomUUID()}`,
        createdAt: now,
        updatedAt: now,
      } as never)
      .returning();
    await db()
      .insert(seats)
      .values({
        tableId: table.id,
        seatNumber: "1",
        qrCode: `seat-${crypto.randomUUID()}`,
        createdAt: now,
        updatedAt: now,
      } as never);
    const item = await seed.menuItem(restaurant.id);
    // orders.table_id and order_items.menu_item_id are both ON DELETE
    // RESTRICT, which is what forces children-first ordering.
    const order = await seed.order(restaurant.id, { tableId: table.id });
    await db()
      .insert(orderItems)
      .values({
        orderId: order.id,
        menuItemId: item.id,
        quantity: 1,
        unitPrice: 100,
        totalPrice: 100,
        createdAt: now,
        updatedAt: now,
      } as never);
    await seed.coupon(restaurant.id);
    return { id: restaurant.id, name, ownerId: owner.id };
  }

  const deactivate = (id: string) =>
    db()
      .update(restaurants)
      .set({ isActive: false })
      .where(eq(restaurants.id, id));

  function permanentDelete(
    id: string,
    token: string,
    body: Record<string, unknown>,
  ) {
    return testApp.app.fetch(
      new Request(`http://test/api/v1/restaurants/${id}/permanent`, {
        method: "DELETE",
        headers: csrf({ authorization: `Bearer ${token}` }),
        body: JSON.stringify(body),
      }),
    );
  }

  const exists = async (id: string) =>
    (await db().select().from(restaurants).where(eq(restaurants.id, id)))
      .length === 1;

  it("plans children before parents, restaurants last, and leaves platform data alone", () => {
    const plan = getRestaurantDeletionPlan();
    const order = plan.deletes.map((entry) => entry.name);
    const position = (name: string) => order.indexOf(name);

    expect(order.at(-1)).toBe("restaurants");
    expect(plan.cyclic).toEqual([]);
    expect(position("order_items")).toBeLessThan(position("orders"));
    expect(position("order_items")).toBeLessThan(position("menu_items"));
    expect(position("orders")).toBeLessThan(position("tables"));
    expect(position("seats")).toBeLessThan(position("tables"));
    expect(position("sessions")).toBeLessThan(position("users"));
    // Customer accounts and stored value belong to the platform, not a shop.
    for (const kept of ["customers", "credit_accounts", "credit_cards"]) {
      expect(order).not.toContain(kept);
    }
    // Pinned so a new table that joins (or leaves) the plan is a reviewed diff.
    expect([...order].sort().join("\n")).toMatchInlineSnapshot(`
      "ai_configurations
      ai_insights_cache
      ai_usage_logs
      audit_logs
      backup_alerts
      backup_audit_logs
      backup_configurations
      backup_records
      backup_schedules
      cash_movements
      cash_registers
      cash_shifts
      categories
      coupon_distributions
      coupon_templates
      coupon_usage
      coupons
      cycle_snapshots
      dish_search_index
      email_verification_tokens
      employee_availability
      employee_leave_balances
      employee_schedules
      error_reports
      forecast_cache
      group_activity_logs
      group_cart_items
      group_members
      group_orders
      images
      ingredient_definitions
      ingredient_stock_movements
      leave_approval_rules
      leave_calendar_events
      leave_requests
      leave_types
      market_checkout_child_orders
      market_join_requests
      market_vendor_open_events
      marketing_broadcast_recipients
      marketing_broadcasts
      menu_item_option_choice_overrides
      menu_item_option_groups
      menu_items
      notification_dispatch_log
      option_choices
      option_groups
      order_items
      orders
      partnership_plans
      partnership_usage_logs
      password_change_logs
      password_reset_tokens
      payment_audit_log
      payment_transactions
      phone_verification_tokens
      platform_integrations
      platform_menu_mappings
      platform_orders
      platform_webhook_logs
      print_agents
      qr_batches
      qr_codes
      receipts
      refund_transactions
      refunds
      reservation_slots
      reservations
      restaurant_alerts
      restaurant_customers
      restaurant_faqs
      restaurant_market_memberships
      restaurant_service_items
      restaurants
      restore_operations
      reviews
      schedule_swap_requests
      scheduling_conflicts
      scheduling_rules
      seats
      service_booking_slots
      service_booking_waitlist
      service_bookings
      sessions
      share_codes
      shift_reports
      shift_templates
      shop_feedback
      shop_payment_credentials
      shop_subscriptions
      split_bills
      storage_counters
      system_alerts
      tables
      usage_events
      usage_meter_buckets
      usage_meters
      user_auth_identities
      user_coupons
      users
      waiting_list"
    `);
  });

  it("removes one shop completely and leaves the other untouched", async () => {
    const admin = await administrator();
    const gone = await seedShop("Leaving Shop");
    const stays = await seedShop("Staying Shop");
    const staysBefore = await countRestaurantData(db(), stays.id);
    await deactivate(gone.id);

    const response = await permanentDelete(gone.id, admin.token, {
      confirmName: "Leaving Shop",
    });
    const body = (await response.json()) as {
      data: {
        totalRows: number;
        tables: Array<{ table: string; rows: number }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.data.tables.map((entry) => entry.table)).toEqual(
      expect.arrayContaining([
        "restaurants",
        "users",
        "tables",
        "seats",
        "orders",
        "order_items",
        "menu_items",
        "categories",
        "coupons",
      ]),
    );
    // Real counts, taken before the delete. D1's own change counts are not
    // usable: production reported 38 rows for a table this shop had none in.
    expect(body.data.tables).toEqual(
      expect.arrayContaining([
        { table: "restaurants", rows: 1 },
        { table: "orders", rows: 1 },
        { table: "order_items", rows: 1 },
        { table: "seats", rows: 1 },
      ]),
    );
    expect(body.data.tables.map((entry) => entry.table)).not.toContain(
      "leave_types",
    );
    expect(body.data.totalRows).toBe(
      body.data.tables.reduce((sum, entry) => sum + entry.rows, 0),
    );
    expect(await exists(gone.id)).toBe(false);
    expect(await countRestaurantData(db(), gone.id)).toEqual([]);
    expect(await countRestaurantData(db(), stays.id)).toEqual(staysBefore);

    const [entry] = await db()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "restaurant_delete"));
    expect(entry).toEqual(
      expect.objectContaining({
        userId: admin.id,
        restaurantId: null,
        resourceId: gone.id,
      }),
    );
  });

  it("clears an optional reference from another shop's row instead of deleting that row", async () => {
    const admin = await administrator();
    const gone = await seedShop("Leaving Shop");
    const stays = await seedShop("Staying Shop");
    const [foreign] = await db()
      .insert(auditLogs)
      .values({
        userId: gone.ownerId,
        restaurantId: stays.id,
        action: "order_create",
        resource: "orders",
        resourceId: "x",
        description: "written by the other shop's owner",
        success: true,
      } as never)
      .returning();
    await deactivate(gone.id);

    const response = await permanentDelete(gone.id, admin.token, {
      confirmName: "Leaving Shop",
    });

    expect(response.status).toBe(200);
    const [kept] = await db()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.id, foreign.id));
    expect(kept).toEqual(
      expect.objectContaining({ restaurantId: stays.id, userId: null }),
    );
  });

  it("deletes nothing when a table the plan does not know still points at the restaurant", async () => {
    const admin = await administrator();
    const shop = await seedShop("Guarded Shop");
    const before = await countRestaurantData(db(), shop.id);
    await deactivate(shop.id);
    const d1 = testApp.env.DB;
    await d1
      .prepare(
        "CREATE TABLE zz_unplanned (id INTEGER PRIMARY KEY, restaurant_id TEXT NOT NULL REFERENCES restaurants(id))",
      )
      .run();
    try {
      await d1
        .prepare("INSERT INTO zz_unplanned (restaurant_id) VALUES (?)")
        .bind(shop.id)
        .run();

      const response = await permanentDelete(shop.id, admin.token, {
        confirmName: "Guarded Shop",
      });

      expect(response.status).toBe(500);
      expect(await exists(shop.id)).toBe(true);
      expect(await countRestaurantData(db(), shop.id)).toEqual(before);
    } finally {
      await d1.prepare("DROP TABLE zz_unplanned").run();
    }
  });

  it("refuses a live shop, a wrong name, and anyone below administrator", async () => {
    const admin = await administrator();
    const shop = await seedShop("Careful Shop");

    const live = await permanentDelete(shop.id, admin.token, {
      confirmName: "Careful Shop",
    });
    expect(live.status).toBe(409);
    expect(
      ((await live.json()) as { error: { code: string } }).error.code,
    ).toBe("RESTAURANT_STILL_ACTIVE");

    await deactivate(shop.id);
    const wrongName = await permanentDelete(shop.id, admin.token, {
      confirmName: "Careless Shop",
    });
    expect(wrongName.status).toBe(400);

    const operator = await seed.user({
      username: "ops",
      role: 0,
      adminTier: "operator",
    });
    const operatorToken = await testApp.authHelper.adminToken(
      undefined,
      operator.id,
    );
    const asOperator = await permanentDelete(shop.id, operatorToken, {
      confirmName: "Careful Shop",
    });
    expect(asOperator.status).toBe(403);

    const ownerToken = await testApp.authHelper.ownerToken(
      shop.ownerId,
      shop.id,
    );
    const asOwner = await permanentDelete(shop.id, ownerToken, {
      confirmName: "Careful Shop",
    });
    expect(asOwner.status).toBe(403);

    expect(await exists(shop.id)).toBe(true);
  });

  it("previews the row counts and says why a delete would be refused", async () => {
    const admin = await administrator();
    const shop = await seedShop("Preview Shop");

    const response = await testApp.app.fetch(
      new Request(
        `http://test/api/v1/restaurants/${shop.id}/deletion-preview`,
        { headers: { authorization: `Bearer ${admin.token}` } },
      ),
    );
    const body = (await response.json()) as {
      data: {
        totalRows: number;
        blockers: string[];
        hasFinancialRecords: boolean;
        tables: Array<{ table: string; rows: number }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.data.blockers).toEqual(["RESTAURANT_STILL_ACTIVE"]);
    expect(body.data.hasFinancialRecords).toBe(false);
    expect(body.data.tables).toEqual(
      expect.arrayContaining([
        { table: "restaurants", rows: 1 },
        { table: "orders", rows: 1 },
        { table: "order_items", rows: 1 },
      ]),
    );
    expect(await exists(shop.id)).toBe(true);
  });
});
