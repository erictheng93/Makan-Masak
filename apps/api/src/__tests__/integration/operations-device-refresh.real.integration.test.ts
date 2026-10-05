import { afterAll, beforeAll, expect, it } from "vitest";
import bcrypt from "bcryptjs";
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

it("keeps both floor devices refreshable and rejects a rotated cookie replay", async () => {
  const seed = buildSeedHelpers(testApp.testDb);
  const restaurant = await seed.restaurant();
  const password = crypto.randomUUID();
  await seed.user({
    username: "operations-two-devices",
    role: 3,
    restaurantId: String(restaurant.id),
    passwordHash: await bcrypt.hash(password, 4),
    isActive: true,
  });

  const login = () =>
    testApp.app.fetch(
      new Request("https://test/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "operations-two-devices", password }),
      }),
    );
  const cookieFrom = (response: Response) => {
    const cookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith("__Host-mm_staff_refresh="));
    expect(cookie).toBeDefined();
    return cookie!.split(";")[0];
  };
  const refresh = (cookie: string) =>
    testApp.app.fetch(
      new Request("https://test/api/v1/auth/refresh", {
        method: "POST",
        headers: {
          origin: "https://test",
          host: "test",
          "X-CSRF-Token": "a".repeat(64),
          cookie: `${cookie}; __Host-mm_csrf=${"a".repeat(64)}`,
        },
      }),
    );

  const firstLogin = await login();
  expect(firstLogin.status).toBe(200);
  const firstCookie = cookieFrom(firstLogin);
  const secondLogin = await login();
  expect(secondLogin.status).toBe(200);
  const secondCookie = cookieFrom(secondLogin);
  expect(secondCookie).not.toBe(firstCookie);

  const firstRefresh = await refresh(firstCookie);
  expect(firstRefresh.status).toBe(200);
  const nextFirstCookie = cookieFrom(firstRefresh);
  expect(nextFirstCookie).not.toBe(firstCookie);
  const secondRefresh = await refresh(secondCookie);
  expect(secondRefresh.status).toBe(200);
  expect((await refresh(firstCookie)).status).toBe(401);
  expect((await refresh(nextFirstCookie)).status).toBe(200);
  expect((await refresh(cookieFrom(secondRefresh))).status).toBe(200);
});
