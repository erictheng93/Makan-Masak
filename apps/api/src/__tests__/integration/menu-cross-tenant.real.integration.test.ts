import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers } from "./helpers/seed-helper";
import { readData, readEnvelope, type ServiceData } from "../helpers/read-json";
import type { MenuService } from "../../features/menu/services/MenuService";

type Menu = ServiceData<MenuService["getMenu"]>;

/**
 * Cross-tenant isolation on the menu batch endpoints (#77).
 *
 * Both endpoints validated only the restaurantId in the path — which an owner
 * sets to their own restaurant — and never the item ids in the body. The
 * underlying updateMenuItem() matched on `id` alone, so any owner could rewrite
 * another restaurant's prices, and move another restaurant's items into their
 * own categories.
 *
 * The move was the worse half: getMenu() resolves items through
 * restaurant -> categories -> menuItems and never reads menuItems.restaurantId,
 * so a moved item appeared on the attacker's public menu and vanished from the
 * victim's, with the victim unable to see it or undo it.
 *
 * Each test asserts both halves: the attack is refused, AND the victim's data
 * is byte-for-byte unchanged. A 403 that still wrote would pass the first
 * assertion alone.
 */
describe("Menu batch endpoints — cross-tenant isolation", () => {
  let testApp: RealIntegrationTestApp;
  let seed: ReturnType<typeof buildSeedHelpers>;

  beforeAll(async () => {
    testApp = await createRealIntegrationTestApp();
    seed = buildSeedHelpers(testApp.testDb);
    // No per-hook timeout override here: on a cold cache this hook replays the
    // whole migrations_fresh track to build the shared D1 baseline, which now
    // exceeds 60s. vitest.real-integration.config.ts sets hookTimeout to the
    // intended 5-minute bound for exactly this.
  });

  afterAll(async () => {
    await testApp?.dispose();
  });

  beforeEach(async () => {
    await testApp.testDb.truncateAll();
  });

  /**
   * These endpoints sit behind moduleGate("menu_management"), which 403s with
   * SUBSCRIPTION_NOT_FOUND when a restaurant has no subscription row. Without
   * this the negative tests still went red-to-green, but on the wrong 403 —
   * they never reached the ownership check they exist to cover.
   */
  async function grantMenuModule(restaurantId: string) {
    // plan_tier must be one of PLAN_TIERS ('pro', not 'professional'), and
    // module_overrides must be an object — resolveModule indexes into it
    // without a null guard.
    await testApp.testDb.bindings.DB.prepare(
      `INSERT INTO shop_subscriptions
         (id, restaurant_id, plan_tier, is_active, module_overrides)
       VALUES (?, ?, 'pro', 1, '{"menu_management":true}')`,
    )
      .bind(crypto.randomUUID(), restaurantId)
      .run();
  }

  /** Attacker restaurant + owner token, and a victim restaurant with one item. */
  async function twoRestaurants() {
    const attacker = await seed.restaurant();
    const victim = await seed.restaurant();
    await grantMenuModule(String(attacker.id));

    const victimItem = await seed.menuItem(victim.id, {
      name: "B店招牌生魚片",
      priceCents: 88000,
      isAvailable: true,
    });
    const attackerItem = await seed.menuItem(attacker.id, {
      name: "A店牛肉麵",
      priceCents: 20000,
      isAvailable: true,
    });

    const token = await testApp.authHelper.ownerToken(1, attacker.id);

    return { attacker, victim, victimItem, attackerItem, token };
  }

  // Double-submit CSRF: the same 64-hex token has to appear in the header and
  // the cookie. Any fixed valid-format value satisfies it.
  const CSRF = "a".repeat(64);

  function patch(path: string, token: string, body: unknown) {
    return testApp.app.fetch(
      new Request(`https://test/api/v1${path}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          "x-csrf-token": CSRF,
          cookie: `__Host-mm_csrf=${CSRF}`,
          // Required: the CSRF middleware rejects a state-changing request
          // whose Origin neither matches the Host header nor appears in the
          // allowed list. Without it every request here 403s before reaching
          // the handler, which would have made the negative tests pass for the
          // wrong reason. The test env runs as development, where
          // buildAllowedOrigins permits localhost on the common dev ports.
          origin: "http://localhost:3001",
        },
        body: JSON.stringify(body),
      }),
    );
  }

  async function readItem(id: number) {
    const rows = await testApp.testDb.bindings.DB.prepare(
      "SELECT id, restaurant_id, category_id, price_cents FROM menu_items WHERE id = ?",
    )
      .bind(id)
      .all<{
        id: number;
        restaurant_id: string;
        category_id: number;
        price_cents: number;
      }>();
    return rows.results[0];
  }

  it("refuses a price update naming another restaurant's item", async () => {
    const { attacker, victim, victimItem, token } = await twoRestaurants();
    const before = await readItem(victimItem.id);

    const res = await patch(`/menu/${attacker.id}/items/prices`, token, {
      updates: [{ id: victimItem.id, price: 1 }],
    });

    expect(res.status).toBe(403);
    const body = await readEnvelope(res);
    expect(body.error?.code).toBe("MENU_ITEM_RESTAURANT_MISMATCH");

    // The victim's 880 became 1 before this fix.
    const after = await readItem(victimItem.id);
    expect(after.price_cents).toBe(before.price_cents);
    expect(after.restaurant_id).toBe(victim.id);
  });

  it("refuses a category move naming another restaurant's item", async () => {
    const { attacker, victim, victimItem, attackerItem, token } =
      await twoRestaurants();
    const before = await readItem(victimItem.id);
    const attackerCategoryId = (await readItem(attackerItem.id)).category_id;

    const res = await patch(`/menu/${attacker.id}/items/categories`, token, {
      updates: [{ id: victimItem.id, categoryId: attackerCategoryId }],
    });

    expect(res.status).toBe(403);

    // category_id moving was what made the item change menus.
    const after = await readItem(victimItem.id);
    expect(after.category_id).toBe(before.category_id);
    expect(after.restaurant_id).toBe(victim.id);
  });

  it("keeps both public menus intact after a rejected move", async () => {
    const { attacker, victim, victimItem, attackerItem, token } =
      await twoRestaurants();
    const attackerCategoryId = (await readItem(attackerItem.id)).category_id;

    await patch(`/menu/${attacker.id}/items/categories`, token, {
      updates: [{ id: victimItem.id, categoryId: attackerCategoryId }],
    });

    // The visible symptom: the victim's item appeared on the attacker's menu
    // and disappeared from the victim's own.
    const attackerMenu = await readData<Menu>(
      await testApp.app.fetch(
        new Request(`https://test/api/v1/menu/${attacker.id}`),
      ),
    );
    const victimMenu = await readData<Menu>(
      await testApp.app.fetch(
        new Request(`https://test/api/v1/menu/${victim.id}`),
      ),
    );

    const attackerIds = attackerMenu.menuItems.map((i) => i.id);
    const victimIds = victimMenu.menuItems.map((i) => i.id);

    expect(attackerIds).not.toContain(victimItem.id);
    expect(victimIds).toContain(victimItem.id);
  });

  it("rejects the whole batch when one id is foreign", async () => {
    const { attacker, victim, victimItem, attackerItem, token } =
      await twoRestaurants();
    const ownBefore = await readItem(attackerItem.id);

    const res = await patch(`/menu/${attacker.id}/items/prices`, token, {
      updates: [
        { id: attackerItem.id, price: 5 },
        { id: victimItem.id, price: 5 },
      ],
    });

    expect(res.status).toBe(403);

    // All-or-nothing: the attacker's own legitimate update must not land
    // either, or a caller gets a failure response over a half-applied batch.
    const ownAfter = await readItem(attackerItem.id);
    expect(ownAfter.price_cents).toBe(ownBefore.price_cents);
    void victim;
  });

  it("refuses an availability update naming another restaurant's item", async () => {
    const { attacker, victimItem, token } = await twoRestaurants();
    const before = await readItem(victimItem.id);

    const res = await patch(`/menu/${attacker.id}/items/availability`, token, {
      updates: [{ id: victimItem.id, isAvailable: false }],
    });

    // This one was already safe — its WHERE carried restaurantId — but it
    // answered 200 for an item it never touched. All three siblings now agree.
    expect(res.status).toBe(403);
    const after = await readItem(victimItem.id);
    expect(after.restaurant_id).toBe(before.restaurant_id);
  });

  it("still applies a batch that only names the caller's own items", async () => {
    const { attacker, attackerItem, token } = await twoRestaurants();

    const res = await patch(`/menu/${attacker.id}/items/prices`, token, {
      // Whole dollars: these fixtures are TWD, which has no fractional unit,
      // so 12.5 is now rejected as CURRENCY_PRECISION. This case is about
      // tenant isolation, not precision.
      updates: [{ id: attackerItem.id, price: 13 }],
    });

    expect(res.status).toBe(200);
    expect((await readItem(attackerItem.id)).price_cents).toBe(1300);
  });

  it("still moves the caller's own item between their own categories", async () => {
    const { attacker, attackerItem, token } = await twoRestaurants();
    const second = await seed.menuItem(attacker.id, { name: "A店第二品項" });
    const targetCategoryId = (await readItem(second.id)).category_id;

    const res = await patch(`/menu/${attacker.id}/items/categories`, token, {
      updates: [{ id: attackerItem.id, categoryId: targetCategoryId }],
    });

    expect(res.status).toBe(200);
    expect((await readItem(attackerItem.id)).category_id).toBe(
      targetCategoryId,
    );
  });
});
