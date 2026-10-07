import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import {
  emailVerificationTokens,
  passwordResetTokens,
  phoneVerificationTokens,
  sessions,
  users,
} from "../schema";
import {
  createTestDatabase,
  REAL_D1_SETUP_TIMEOUT_MS,
  type TestDatabase,
} from "../testing/create-test-database";
import {
  resolveVerificationAppBaseUrl,
  VerificationService,
} from "./VerificationService";

describe("resolveVerificationAppBaseUrl", () => {
  it("uses the configured client base URL for production links", () => {
    expect(
      resolveVerificationAppBaseUrl({
        NODE_ENV: "production",
        CLIENT_BASE_URL: "https://makanmasak.com/",
        API_BASE_URL: "https://api.makanmasak.com",
      }),
    ).toBe("https://makanmasak.com");
  });

  it("falls back to production CORS_ORIGIN before API_BASE_URL", () => {
    expect(
      resolveVerificationAppBaseUrl({
        NODE_ENV: "production",
        API_BASE_URL: "https://api.makanmasak.com",
        CORS_ORIGIN: "https://makanmasak.com",
      }),
    ).toBe("https://makanmasak.com");
  });

  it("blocks production verification links when no public app URL is set", () => {
    expect(() =>
      resolveVerificationAppBaseUrl({
        NODE_ENV: "production",
        API_BASE_URL: undefined,
        CORS_ORIGIN: undefined,
      }),
    ).toThrow(/CLIENT_BASE_URL or CORS_ORIGIN/);
  });

  it("keeps the local fallback for development", () => {
    expect(resolveVerificationAppBaseUrl({ NODE_ENV: "development" })).toBe(
      "http://localhost:5173",
    );
  });
});

/**
 * A password reset used to bump `token_version` and stop there. The `sessions`
 * rows stayed active, and refreshToken() finds a session by refresh token +
 * isActive — so whoever had stolen a refresh token could trade it for a fresh
 * access token stamped with the *new* version, indefinitely. changePassword()
 * had always deactivated the rows; the reset paths had not.
 */
describe("VerificationService", () => {
  let testDb: TestDatabase;

  const userId = "018f0000-0000-7000-8000-0000000002a1";

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, REAL_D1_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.dispose();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
  });

  function service() {
    return new VerificationService(testDb.bindings.DB, {
      NODE_ENV: "test",
      CLIENT_BASE_URL: "http://localhost:5173",
    });
  }

  async function seed(resetToken: string) {
    await testDb.drizzle.insert(users).values({
      id: userId,
      username: "reset-victim",
      fullName: "Reset Victim",
      // No email: the success notification is skipped, keeping this test on the
      // reset path rather than on NotificationService.
      passwordHash: "old-hash",
      role: 1,
      isActive: true,
      tokenVersion: 3,
    });
    await testDb.drizzle.insert(passwordResetTokens).values({
      userId,
      token: resetToken,
      tokenType: resetToken.includes("-") ? "email" : "sms",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    await testDb.drizzle.insert(sessions).values([
      {
        id: `session-live-${resetToken}`,
        userId,
        token: `access-${resetToken}`,
        refreshToken: `refresh-${resetToken}`,
        isActive: true,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
      {
        id: `session-second-${resetToken}`,
        userId,
        token: `access-2-${resetToken}`,
        refreshToken: `refresh-2-${resetToken}`,
        isActive: true,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    ]);
  }

  // Both reset flavours run through the same batch — only the logged
  // changeMethod differs (it branches on the token shape) — so both are pinned
  // here rather than trusting that one implies the other.
  it.each([
    ["email", "018f0000-0000-7000-8000-0000000002ff"],
    ["sms", "482913"],
  ])("deactivates every session on a %s reset", async (_method, token) => {
    await seed(token);

    const result = await service().resetPassword({
      token,
      newPassword: "BrandNewPass123!",
      ipAddress: "203.0.113.10",
    });

    expect(result).toMatchObject({ success: true });

    const rows = await testDb.drizzle
      .select({ id: sessions.id, isActive: sessions.isActive })
      .from(sessions)
      .where(eq(sessions.userId, userId));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.isActive === false)).toBe(true);

    const [user] = await testDb.drizzle
      .select({
        tokenVersion: users.tokenVersion,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(eq(users.id, userId));
    expect(user.tokenVersion).toBe(4);
    expect(user.passwordHash).not.toBe("old-hash");
  });

  it("leaves sessions alone when the reset token is rejected", async () => {
    await seed("018f0000-0000-7000-8000-0000000002fe");

    const result = await service().resetPassword({
      token: "not-a-known-token",
      newPassword: "BrandNewPass123!",
      ipAddress: "203.0.113.10",
    });

    expect(result).toMatchObject({
      success: false,
      reason: "reset_token_invalid",
    });

    const rows = await testDb.drizzle
      .select({ isActive: sessions.isActive })
      .from(sessions)
      .where(eq(sessions.userId, userId));
    expect(rows.every((row) => row.isActive === true)).toBe(true);
  });

  it("counts deleted tokens in all three tables and preserves unexpired tokens", async () => {
    await seed("cleanup-live");
    const expired = new Date(Date.now() - 60_000);
    const live = new Date(Date.now() + 60_000);
    await testDb.drizzle.insert(passwordResetTokens).values({
      userId,
      token: "cleanup-expired",
      expiresAt: expired,
    });
    await testDb.drizzle.insert(emailVerificationTokens).values(
      ["expired-1", "expired-2", "live"].map((token) => ({
        userId,
        token,
        email: "cleanup@example.com",
        expiresAt: token === "live" ? live : expired,
      })),
    );
    await testDb.drizzle.insert(phoneVerificationTokens).values(
      ["111111", "222222", "333333", "444444"].map((otpCode) => ({
        userId,
        phone: "+60123456789",
        otpCode,
        expiresAt: otpCode === "444444" ? live : expired,
      })),
    );

    await expect(service().cleanupExpiredTokens()).resolves.toEqual({
      deletedPasswordResetTokens: 1,
      deletedEmailVerificationTokens: 2,
      deletedPhoneVerificationTokens: 3,
    });
    expect(
      await testDb.drizzle
        .select({ token: passwordResetTokens.token })
        .from(passwordResetTokens),
    ).toEqual([{ token: "cleanup-live" }]);
    expect(
      await testDb.drizzle
        .select({ token: emailVerificationTokens.token })
        .from(emailVerificationTokens),
    ).toEqual([{ token: "live" }]);
    expect(
      await testDb.drizzle
        .select({ otpCode: phoneVerificationTokens.otpCode })
        .from(phoneVerificationTokens),
    ).toEqual([{ otpCode: "444444" }]);
    await expect(service().cleanupExpiredTokens()).resolves.toEqual({
      deletedPasswordResetTokens: 0,
      deletedEmailVerificationTokens: 0,
      deletedPhoneVerificationTokens: 0,
    });
  });

  it("propagates a D1 batch failure instead of reporting zero deletions", async () => {
    const error = new Error("D1 unavailable");
    const batch = vi.fn().mockRejectedValueOnce(error);
    const db = {
      prepare: testDb.bindings.DB.prepare.bind(testDb.bindings.DB),
      batch,
    } as unknown as typeof testDb.bindings.DB;
    const verification = new VerificationService(db, { NODE_ENV: "test" });

    await expect(verification.cleanupExpiredTokens()).rejects.toBe(error);
    expect(batch).toHaveBeenCalledOnce();
  });
});
