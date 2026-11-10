/**
 * Real integration — per-shop staff usernames and shop login slugs.
 *
 * Usernames are unique per restaurant; a bare username that exists at several
 * shops must be disambiguated with the shop's login_slug (`shop` in the login
 * body). Runs against the migrated baseline, i.e. the 0042 index set.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  vi,
} from "vitest";
import bcrypt from "bcryptjs";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers } from "./helpers/seed-helper";
import { readData, readEnvelope } from "../helpers/read-json";

const PASSWORD = "Test@12345";
const CSRF = "a".repeat(64);

interface LoginData {
  token?: string;
  user?: {
    username: string;
    restaurantId: string | null;
    loginSlug?: string | null;
  };
}

describe("Shop login — real integration", () => {
  let testApp: RealIntegrationTestApp;
  let seed: ReturnType<typeof buildSeedHelpers>;
  let hash: string;
  let shopA: string;
  let shopB: string;

  const post = (path: string, body: unknown, method = "POST", token?: string) =>
    testApp.app.fetch(
      new Request(`https://test/api/v1${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          host: "test",
          origin: "https://test",
          cookie: `csrf_token=${CSRF}`,
          "x-csrf-token": CSRF,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  const login = (body: Record<string, unknown>) =>
    post("/auth/login", { password: PASSWORD, ...body });

  beforeAll(async () => {
    testApp = await createRealIntegrationTestApp();
    seed = buildSeedHelpers(testApp.testDb);
    hash = await bcrypt.hash(PASSWORD, 4);
  });

  afterAll(async () => {
    if (testApp) await testApp.dispose();
  });

  beforeEach(async () => {
    await testApp.testDb.truncateAll();
    shopA = (await seed.restaurant({ loginSlug: "shop-a", name: "Shop A" })).id;
    shopB = (await seed.restaurant({ loginSlug: "shop-b", name: "Shop B" })).id;
    await seed.user({
      username: "chef",
      role: 2,
      restaurantId: shopA,
      passwordHash: hash,
    });
    await seed.user({
      username: "chef",
      role: 2,
      restaurantId: shopB,
      passwordHash: hash,
    });
  });

  describe("POST /auth/login", () => {
    it("logs each shop's own 'chef' in and reports the shop's loginSlug", async () => {
      for (const [shop, id] of [
        ["shop-a", shopA],
        ["shop-b", shopB],
      ] as const) {
        const res = await login({ username: "chef", shop });
        expect(res.status).toBe(200);
        const data = await readData<LoginData>(res);
        expect(data.user?.restaurantId).toBe(id);
        expect(data.user?.loginSlug).toBe(shop);
      }
    });

    it("answers 400 SHOP_REQUIRED without a shop, before any bcrypt work", async () => {
      const compare = vi.spyOn(bcrypt, "compare");
      try {
        const res = await login({ username: "chef" });
        expect(res.status).toBe(400);
        const body = await readEnvelope(res);
        expect(body.error?.code).toBe("SHOP_REQUIRED");
        expect(compare).not.toHaveBeenCalled();
      } finally {
        compare.mockRestore();
      }
    });

    it("lets a platform admin sign in without a shop", async () => {
      await seed.user({
        username: "root",
        role: 0,
        restaurantId: null,
        passwordHash: hash,
      });
      const res = await login({ username: "root" });
      expect(res.status).toBe(200);
      const data = await readData<LoginData>(res);
      expect(data.user?.loginSlug ?? null).toBeNull();
    });

    it("signs in a unique username without a shop", async () => {
      await seed.user({
        username: "solo",
        role: 2,
        restaurantId: shopA,
        passwordHash: hash,
      });
      expect((await login({ username: "solo" })).status).toBe(200);
    });

    it("treats an unknown shop, or a user from another shop, as invalid credentials", async () => {
      await seed.user({
        username: "solo",
        role: 2,
        restaurantId: shopA,
        passwordHash: hash,
      });
      for (const body of [
        { username: "chef", shop: "no-such-shop" },
        { username: "solo", shop: "shop-b" },
      ]) {
        const res = await login(body);
        expect(res.status).toBe(401);
        expect((await readEnvelope(res)).error?.code).toBe(
          "INVALID_CREDENTIALS",
        );
      }
    });
  });

  describe("users in one restaurant", () => {
    it("rejects a second 'chef' in the same restaurant with 409 USERNAME_TAKEN", async () => {
      const owner = await testApp.authHelper.ownerToken(900, shopA);
      const res = await post(
        "/users",
        {
          username: "chef",
          password: "Secure@123",
          fullName: "Second Chef",
          role: 2,
        },
        "POST",
        owner,
      );
      expect(res.status).toBe(409);
      const body = await readEnvelope(res);
      expect(body.error?.code).toBe("USERNAME_TAKEN");
      expect(JSON.stringify(body.error?.details)).toContain("username");
    });

    it("allows the same username in a different restaurant", async () => {
      const shopC = (await seed.restaurant({ loginSlug: "shop-c" })).id;
      const owner = await testApp.authHelper.ownerToken(901, shopC);
      const res = await post(
        "/users",
        {
          username: "chef",
          password: "Secure@123",
          fullName: "Chef C",
          role: 2,
        },
        "POST",
        owner,
      );
      expect(res.status).toBe(201);
    });
  });

  describe("GET /restaurants/login-context/:slug", () => {
    const get = (slug: string) =>
      testApp.app.fetch(
        new Request(`https://test/api/v1/restaurants/login-context/${slug}`),
      );

    it("returns name and logo for an active shop, uncached", async () => {
      const res = await get("shop-a");
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await readData(res)).toEqual({
        slug: "shop-a",
        name: "Shop A",
        logoUrl: null,
      });
    });

    it("404s SHOP_NOT_FOUND for unknown, malformed and inactive shops", async () => {
      await seed.restaurant({ loginSlug: "closed-shop", isActive: false });
      for (const slug of ["nope-nope", "A", "closed-shop"]) {
        const res = await get(slug);
        expect(res.status).toBe(404);
        expect((await readEnvelope(res)).error?.code).toBe("SHOP_NOT_FOUND");
      }
    });
  });

  describe("PUT /restaurants/:id/login-slug", () => {
    const put = (id: string, loginSlug: string, token: string) =>
      post(`/restaurants/${id}/login-slug`, { loginSlug }, "PUT", token);

    it("lets the owner rename (normalising case) and GET /:id reflects it", async () => {
      const owner = await testApp.authHelper.ownerToken(910, shopA);
      const res = await put(shopA, "  New-Name  ", owner);
      expect(res.status).toBe(200);
      expect(await readData(res)).toEqual({ loginSlug: "new-name" });

      const detail = await readData<{ loginSlug?: string }>(
        await testApp.app.fetch(
          new Request(`https://test/api/v1/restaurants/${shopA}`),
        ),
      );
      expect(detail.loginSlug).toBe("new-name");
      expect((await login({ username: "chef", shop: "new-name" })).status).toBe(
        200,
      );
      expect((await login({ username: "chef", shop: "shop-a" })).status).toBe(
        401,
      );
    });

    it("lets a platform admin set it", async () => {
      const admin = await testApp.authHelper.adminToken();
      expect((await put(shopB, "shop-b-2", admin)).status).toBe(200);
    });

    it("400s SLUG_INVALID and SLUG_RESERVED with a loginSlug detail", async () => {
      const owner = await testApp.authHelper.ownerToken(911, shopA);
      for (const [slug, code] of [
        ["ab", "SLUG_INVALID"],
        ["has space", "SLUG_INVALID"],
        ["double--dash", "SLUG_INVALID"],
        ["-lead", "SLUG_INVALID"],
        ["admin", "SLUG_RESERVED"],
      ]) {
        const res = await put(shopA, slug, owner);
        expect(res.status).toBe(400);
        const body = await readEnvelope(res);
        expect(body.error?.code).toBe(code);
        expect(JSON.stringify(body.error?.details)).toContain("loginSlug");
      }
    });

    it("409s SLUG_TAKEN for another shop's slug, and accepts re-saving its own", async () => {
      const owner = await testApp.authHelper.ownerToken(912, shopA);
      const taken = await put(shopA, "shop-b", owner);
      expect(taken.status).toBe(409);
      const body = await readEnvelope(taken);
      expect(body.error?.code).toBe("SLUG_TAKEN");
      expect(JSON.stringify(body.error?.details)).toContain("loginSlug");

      expect((await put(shopA, "shop-a", owner)).status).toBe(200);
    });

    it("403s another shop's owner", async () => {
      const otherOwner = await testApp.authHelper.ownerToken(913, shopB);
      const res = await put(shopA, "stolen-slug", otherOwner);
      expect(res.status).toBe(403);
    });
  });

  describe("POST /auth/forgot-password", () => {
    it("answers the same generic success whether or not the username is ambiguous", async () => {
      for (const body of [
        { username: "chef" },
        { username: "chef", shop: "shop-a" },
      ]) {
        const res = await post("/auth/forgot-password", body);
        expect(res.status).toBe(200);
      }
    });
  });
});
