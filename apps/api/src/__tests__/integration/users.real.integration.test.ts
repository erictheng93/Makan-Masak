import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers } from "./helpers/seed-helper";
import { readEnvelope } from "../helpers/read-json";

const USERS_ENDPOINT = "https://test/api/v1/users";
const CSRF_TOKEN = "a".repeat(64);
const CSRF_HEADERS = {
  host: "test",
  origin: "https://test",
  cookie: `csrf_token=${CSRF_TOKEN}`,
  "x-csrf-token": CSRF_TOKEN,
};

describe("Users API — real integration", () => {
  let testApp: RealIntegrationTestApp;
  let seed: ReturnType<typeof buildSeedHelpers>;

  beforeAll(async () => {
    testApp = await createRealIntegrationTestApp();
    seed = buildSeedHelpers(testApp.testDb);
  });

  afterAll(async () => {
    if (testApp) await testApp.dispose();
  });

  beforeEach(async () => {
    await testApp.testDb.truncateAll();
  });

  it("rejects an owner creating staff for another restaurant", async () => {
    const ownerRestaurant = await seed.restaurant();
    const otherRestaurant = await seed.restaurant({
      name: "Other Restaurant",
      slug: "other-restaurant",
    });
    const owner = await seed.user({
      username: "owner-cross-restaurant-deny",
      role: 1,
      restaurantId: String(ownerRestaurant.id),
    });
    const ownerToken = await testApp.authHelper.ownerToken(
      owner.id,
      String(ownerRestaurant.id),
    );

    const response = await testApp.app.fetch(
      new Request(USERS_ENDPOINT, {
        method: "POST",
        headers: {
          ...CSRF_HEADERS,
          authorization: `Bearer ${ownerToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          username: "cross-restaurant-chef",
          fullName: "Cross Restaurant Chef",
          email: "cross-restaurant-chef@example.test",
          password: "Secure@123",
          role: 2,
          restaurantId: String(otherRestaurant.id),
        }),
      }),
    );

    expect(response.status).toBe(403);
    const body = await readEnvelope(response);
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe("FORBIDDEN");

    const created = await testApp.env.DB.prepare(
      `SELECT id, restaurant_id
         FROM users
        WHERE username = ?`,
    )
      .bind("cross-restaurant-chef")
      .first();
    expect(created).toBeNull();
  });

  it("changes a managed employee role, revokes their old token, and audits it", async () => {
    const restaurant = await seed.restaurant();
    const otherRestaurant = await seed.restaurant({
      name: "Other Restaurant",
      slug: "other-restaurant",
    });
    const owner = await seed.user({
      username: "owner-role-change",
      role: 1,
      restaurantId: String(restaurant.id),
    });
    const chef = await seed.user({
      username: "chef-role-change",
      role: 2,
      restaurantId: String(restaurant.id),
    });
    const otherChef = await seed.user({
      username: "other-chef-role-change",
      role: 2,
      restaurantId: String(otherRestaurant.id),
    });
    const ownerToken = await testApp.authHelper.ownerToken(
      owner.id,
      String(restaurant.id),
    );
    const oldChefToken = await testApp.authHelper.staffToken(
      chef.id,
      2,
      String(restaurant.id),
    );

    const roleResponse = await testApp.app.fetch(
      new Request(`${USERS_ENDPOINT}/${chef.id}/role`, {
        method: "PATCH",
        headers: {
          ...CSRF_HEADERS,
          authorization: `Bearer ${ownerToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ role: 4 }),
      }),
    );

    expect(roleResponse.status).toBe(200);
    await expect(roleResponse.json()).resolves.toMatchObject({
      success: true,
      data: { id: chef.id, role: 4, role_name: "Cashier" },
    });
    const changed = await testApp.env.DB.prepare(
      "SELECT role, token_version FROM users WHERE id = ?",
    )
      .bind(chef.id)
      .first<{ role: number; token_version: number }>();
    expect(changed).toEqual({ role: 4, token_version: 2 });

    const audit = await testApp.env.DB.prepare(
      `SELECT user_id, restaurant_id, action, resource, resource_id, changes
         FROM audit_logs
        WHERE resource_id = ?
        ORDER BY id DESC
        LIMIT 1`,
    )
      .bind(chef.id)
      .first<{
        user_id: string;
        restaurant_id: string;
        action: string;
        resource: string;
        resource_id: string;
        changes: string;
      }>();
    expect(audit).toMatchObject({
      user_id: owner.id,
      restaurant_id: String(restaurant.id),
      action: "user_role_change",
      resource: "users",
      resource_id: chef.id,
    });
    expect(JSON.parse(audit!.changes)).toEqual({
      before: { role: 2 },
      after: { role: 4 },
    });

    const oldTokenResponse = await testApp.app.fetch(
      new Request("https://test/api/v1/auth/me", {
        headers: { authorization: `Bearer ${oldChefToken}` },
      }),
    );
    expect(oldTokenResponse.status).toBe(401);

    const otherRestaurantResponse = await testApp.app.fetch(
      new Request(`${USERS_ENDPOINT}/${otherChef.id}/role`, {
        method: "PATCH",
        headers: {
          ...CSRF_HEADERS,
          authorization: `Bearer ${ownerToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ role: 4 }),
      }),
    );
    expect(otherRestaurantResponse.status).toBe(403);

    const selfResponse = await testApp.app.fetch(
      new Request(`${USERS_ENDPOINT}/${owner.id}/role`, {
        method: "PATCH",
        headers: {
          ...CSRF_HEADERS,
          authorization: `Bearer ${ownerToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ role: 4 }),
      }),
    );
    expect(selfResponse.status).toBe(400);

    const platformRoleResponse = await testApp.app.fetch(
      new Request(`${USERS_ENDPOINT}/${chef.id}/role`, {
        method: "PATCH",
        headers: {
          ...CSRF_HEADERS,
          authorization: `Bearer ${ownerToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ role: 0 }),
      }),
    );
    expect(platformRoleResponse.status).toBe(403);
  });
});
