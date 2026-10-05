import { afterAll, beforeAll, expect, it } from "vitest";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers } from "./helpers/seed-helper";

let testApp: RealIntegrationTestApp;

beforeAll(async () => {
  testApp = await createRealIntegrationTestApp();
});

afterAll(async () => {
  await testApp?.dispose();
});

it("registers fixture JWT sessions and respects their revocation", async () => {
  const seed = buildSeedHelpers(testApp.testDb);
  const restaurant = await seed.restaurant();
  const owner = await seed.user({ role: 1, restaurantId: restaurant.id });
  const token = await testApp.authHelper.ownerToken(owner.id, restaurant.id);
  const readProfile = () =>
    testApp.app.fetch(
      new Request("https://test/api/v1/auth/me", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );

  expect((await readProfile()).status).toBe(200);
  await testApp.env.DB.prepare(
    "UPDATE sessions SET is_active = 0 WHERE token = ?",
  )
    .bind(token)
    .run();
  expect((await readProfile()).status).toBe(401);
});
