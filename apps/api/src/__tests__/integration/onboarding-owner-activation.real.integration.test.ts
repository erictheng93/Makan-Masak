import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { passwordResetTokens } from "@makanmasak/database";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers } from "./helpers/seed-helper";
import { readEnvelope } from "../helpers/read-json";

const NEW_PASSWORD = "Owner@2026Setup";
const CSRF_TOKEN = "c".repeat(64);

describe("management onboarding owner activation — real API contract", () => {
  let testApp: RealIntegrationTestApp;
  let seed: ReturnType<typeof buildSeedHelpers>;

  beforeAll(async () => {
    testApp = await createRealIntegrationTestApp({
      env: { DEV_CORS_ORIGINS: "https://test" },
    });
    seed = buildSeedHelpers(testApp.testDb);
  });

  afterAll(async () => {
    if (testApp) await testApp.dispose();
  });

  beforeEach(async () => {
    await testApp.testDb.truncateAll();
  });

  async function createOwnerAndToken(expiresAt: Date) {
    const restaurant = await seed.restaurant({
      isAvailable: false,
      address: "Onboarding GPS 24.147736, 120.673648",
    });
    const username = `onboarding-owner-${crypto.randomUUID().slice(0, 8)}`;
    const owner = await seed.user({
      username,
      role: 1,
      restaurantId: restaurant.id,
      isVerified: false,
      passwordHash: await bcrypt.hash(crypto.randomUUID(), 10),
    });
    const token = crypto.randomUUID();
    await testApp.testDb.drizzle.insert(passwordResetTokens).values({
      userId: owner.id,
      token,
      tokenType: "email",
      userAgent: "management-onboarding",
      expiresAt,
      usedAt: null,
      createdAt: new Date(),
    });
    return { restaurant, owner, token };
  }

  async function resetPassword(token: string) {
    return testApp.app.fetch(
      new Request("https://test/api/v1/auth/reset-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "test",
          origin: "https://test",
          "x-csrf-token": CSRF_TOKEN,
          cookie: `csrf_token=${CSRF_TOKEN}`,
        },
        body: JSON.stringify({
          token,
          newPassword: NEW_PASSWORD,
          confirmPassword: NEW_PASSWORD,
        }),
      }),
    );
  }

  it("accepts a management-issued setup token, consumes it, and logs the owner in", async () => {
    const { restaurant, owner, token } = await createOwnerAndToken(
      new Date(Date.now() + 24 * 60 * 60 * 1000),
    );

    const reset = await resetPassword(token);
    expect(reset.status).toBe(200);
    expect((await readEnvelope(reset)).success).toBe(true);

    const tokenRow = await testApp.env.DB.prepare(
      "SELECT used_at_ms FROM password_reset_tokens WHERE token = ?",
    )
      .bind(token)
      .first<{ used_at_ms: number | null }>();
    expect(tokenRow?.used_at_ms).toBeGreaterThan(0);
    const userRow = await testApp.env.DB.prepare(
      "SELECT token_version FROM users WHERE id = ?",
    )
      .bind(owner.id)
      .first<{ token_version: number }>();
    expect(userRow?.token_version).toBe(2);

    const login = await testApp.app.fetch(
      new Request("https://test/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: owner.username,
          password: NEW_PASSWORD,
        }),
      }),
    );
    expect(login.status).toBe(200);
    const loginBody = await readEnvelope<{
      token: string;
      user: { role: number; restaurantId: string };
    }>(login);
    expect(loginBody.data?.token).toBeTruthy();
    expect(loginBody.data?.user).toMatchObject({
      role: 1,
      restaurantId: restaurant.id,
    });
    expect((await resetPassword(token)).status).toBe(400);
  });

  it("rejects an expired management-issued setup token", async () => {
    const { token } = await createOwnerAndToken(new Date(Date.now() - 1_000));
    expect((await resetPassword(token)).status).toBe(400);
  });
});
