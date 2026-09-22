import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { sign, verify } from "jsonwebtoken";
import * as bcrypt from "bcryptjs";
import { sessions, users } from "../schema";
import {
  createTestDatabase,
  REAL_D1_SETUP_TIMEOUT_MS,
  type TestDatabase,
} from "../testing/create-test-database";
import { AuthService } from "./auth";

const jwtSecret = "0123456789abcdefghijklmnopqrstuvwxyz";
const publicUserId = "018f0000-0000-7000-8000-000000000101";
const loginUserId = "018f0000-0000-7000-8000-000000000102";
const validateUserId = "018f0000-0000-7000-8000-000000000103";

/**
 * Production hashes at cost 10 (CLAUDE.md), which is ~2.5s per operation in
 * bcryptjs on a developer machine. The two tests that seed a real hash then log
 * in pay it twice -- `bcrypt.compare` inherits the cost recorded in the hash --
 * so they sat at ~5s against a 5s testTimeout and went red whenever the suite
 * was under load, passing again in isolation. That is the "just re-run it" red
 * CLAUDE.md warns about, so the fixture drops the cost instead.
 *
 * Safe because nothing here asserts on the work factor: these tests check which
 * credentials the service accepts and what it mints, and bcrypt reads the cost
 * from the hash it is verifying. Never use this for a password that is stored.
 */
const FIXTURE_BCRYPT_COST = 4;

describe("AuthService refresh token rotation", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, REAL_D1_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.dispose();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
  });

  it("rotates staff refresh tokens and rejects replay of the previous token", async () => {
    await testDb.drizzle.insert(users).values({
      id: publicUserId,
      username: "owner-refresh",
      fullName: "Owner Refresh",
      passwordHash: "hash",
      role: 1,
      isActive: true,
      tokenVersion: 1,
    });

    const accessToken = sign(
      {
        sub: publicUserId,
        username: "owner-refresh",
        role: 1,
        tv: 1,
      },
      jwtSecret,
      { expiresIn: "72h" },
    );
    const refreshToken = sign(
      { sub: publicUserId, type: "refresh", jti: "refresh-1" },
      jwtSecret,
      { expiresIn: "7d" },
    );

    await testDb.drizzle.insert(sessions).values({
      id: "session-1",
      userId: publicUserId,
      token: accessToken,
      refreshToken,
      isActive: true,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const service = new AuthService(testDb.bindings.DB, {
      JWT_SECRET: jwtSecret,
      NODE_ENV: "test",
    });

    const firstRefresh = await service.refreshToken(refreshToken);

    expect(firstRefresh.success).toBe(true);
    expect(firstRefresh.tokens?.refreshToken).toBeTruthy();
    expect(firstRefresh.tokens?.refreshToken).not.toBe(refreshToken);
    expect(verify(firstRefresh.tokens!.accessToken, jwtSecret)).toMatchObject({
      sub: publicUserId,
      username: "owner-refresh",
      role: 1,
      tv: 1,
    });
    expect(
      verify(firstRefresh.tokens!.accessToken, jwtSecret),
    ).not.toHaveProperty("id");
    expect(verify(firstRefresh.tokens!.refreshToken, jwtSecret)).toMatchObject({
      sub: publicUserId,
      type: "refresh",
      tv: 1,
    });
    expect(
      verify(firstRefresh.tokens!.refreshToken, jwtSecret),
    ).not.toHaveProperty("userId");

    const storedSession = await testDb.drizzle
      .select({ refreshToken: sessions.refreshToken })
      .from(sessions)
      .where(eq(sessions.id, "session-1"))
      .get();
    expect(storedSession?.refreshToken).toBe(firstRefresh.tokens?.refreshToken);

    await expect(service.refreshToken(refreshToken)).resolves.toMatchObject({
      success: false,
      error: "Session not found or expired",
    });
  });

  it("issues UUID-principal tokens on login", async () => {
    await testDb.drizzle.insert(users).values({
      id: loginUserId,
      username: "owner-login",
      fullName: "Owner Login",
      passwordHash: await bcrypt.hash("CorrectHorse123!", FIXTURE_BCRYPT_COST),
      role: 1,
      isActive: true,
      tokenVersion: 3,
    });

    const service = new AuthService(testDb.bindings.DB, {
      JWT_SECRET: jwtSecret,
      NODE_ENV: "test",
    });

    const result = await service.login({
      username: "owner-login",
      password: "CorrectHorse123!",
    });

    expect(result.success).toBe(true);
    expect(result.user).toMatchObject({
      id: loginUserId,
      publicId: loginUserId,
      username: "owner-login",
      tokenVersion: 3,
    });

    const accessPayload = verify(result.tokens!.accessToken, jwtSecret);
    expect(accessPayload).toMatchObject({
      sub: loginUserId,
      username: "owner-login",
      role: 1,
      tv: 3,
    });
    expect(typeof accessPayload).toBe("object");
    expect((accessPayload as { exp?: number; iat?: number }).exp).toBe(
      (accessPayload as { exp?: number; iat?: number }).iat! + 60 * 60,
    );
    expect(typeof (accessPayload as { jti?: unknown }).jti).toBe("string");
    expect(accessPayload).not.toHaveProperty("id");

    const refreshPayload = verify(result.tokens!.refreshToken, jwtSecret);
    expect(refreshPayload).toMatchObject({
      sub: loginUserId,
      type: "refresh",
      tv: 3,
    });
    expect(refreshPayload).not.toHaveProperty("userId");
  });

  // A refresh token lives 7 days against the access token's 1 hour, so it is
  // the credential that actually survives a password reset. Deactivating the
  // session row is the primary control; this version check is the backstop for
  // any revocation path that forgets to.
  it("rejects a refresh token minted at a superseded token version", async () => {
    await testDb.drizzle.insert(users).values({
      id: publicUserId,
      username: "owner-stale",
      fullName: "Owner Stale",
      passwordHash: "hash",
      role: 1,
      isActive: true,
      // The reset already happened: the row moved on, the stolen token did not.
      tokenVersion: 4,
    });

    const staleRefreshToken = sign(
      { sub: publicUserId, type: "refresh", tv: 3, jti: "refresh-stale" },
      jwtSecret,
      { expiresIn: "7d" },
    );

    // The session row is deliberately still active, so the only thing that can
    // reject this is the version claim.
    await testDb.drizzle.insert(sessions).values({
      id: "session-stale",
      userId: publicUserId,
      token: "stale-access",
      refreshToken: staleRefreshToken,
      isActive: true,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const service = new AuthService(testDb.bindings.DB, {
      JWT_SECRET: jwtSecret,
      NODE_ENV: "test",
    });

    await expect(service.refreshToken(staleRefreshToken)).resolves.toEqual({
      success: false,
      error: "Refresh token has been invalidated",
    });
  });

  // An absent `tv` normalizes to 1, which is exactly what a token minted before
  // the claim existed would have carried: token_version defaults to 1 and only
  // increments. So legacy tokens keep working right up until the user has a
  // revocation event, and are rejected from that moment on — no fleet-wide
  // logout on deploy, and no window for the attack the claim exists to stop.
  it("treats a refresh token with no version claim as version 1", async () => {
    await testDb.drizzle.insert(users).values({
      id: publicUserId,
      username: "owner-legacy",
      fullName: "Owner Legacy",
      passwordHash: "hash",
      role: 1,
      isActive: true,
      tokenVersion: 1,
    });

    const legacyRefreshToken = sign(
      { sub: publicUserId, type: "refresh", jti: "refresh-legacy" },
      jwtSecret,
      { expiresIn: "7d" },
    );

    await testDb.drizzle.insert(sessions).values({
      id: "session-legacy",
      userId: publicUserId,
      token: "legacy-access",
      refreshToken: legacyRefreshToken,
      isActive: true,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const service = new AuthService(testDb.bindings.DB, {
      JWT_SECRET: jwtSecret,
      NODE_ENV: "test",
    });

    // Never revoked: still accepted, and the rotation stamps the claim in.
    const accepted = await service.refreshToken(legacyRefreshToken);
    expect(accepted.success).toBe(true);
    expect(verify(accepted.tokens!.refreshToken, jwtSecret)).toMatchObject({
      type: "refresh",
      tv: 1,
    });

    // Now the user resets their password: the same legacy token is dead, even
    // though its session row survived.
    await testDb.drizzle
      .update(users)
      .set({ tokenVersion: 2 })
      .where(eq(users.id, publicUserId));
    await testDb.drizzle
      .update(sessions)
      .set({ refreshToken: legacyRefreshToken, isActive: true })
      .where(eq(sessions.id, "session-legacy"));

    await expect(service.refreshToken(legacyRefreshToken)).resolves.toEqual({
      success: false,
      error: "Refresh token has been invalidated",
    });
  });

  it("keeps an existing device session usable after a second login and sweeps expired sessions", async () => {
    await testDb.drizzle.insert(users).values({
      id: loginUserId,
      username: "owner-login",
      fullName: "Owner Login",
      passwordHash: await bcrypt.hash("CorrectHorse123!", FIXTURE_BCRYPT_COST),
      role: 1,
      isActive: true,
      tokenVersion: 3,
    });

    const hour = 60 * 60 * 1000;
    await testDb.drizzle.insert(sessions).values({
      id: "session-expired",
      userId: loginUserId,
      token: "expired-access",
      refreshToken: "expired-refresh",
      expiresAt: new Date(Date.now() - hour),
      isActive: true,
    });

    const service = new AuthService(testDb.bindings.DB, {
      JWT_SECRET: jwtSecret,
      NODE_ENV: "test",
    });

    const firstLogin = await service.login({
      username: "owner-login",
      password: "CorrectHorse123!",
    });
    expect(firstLogin.success).toBe(true);

    const secondLogin = await service.login({
      username: "owner-login",
      password: "CorrectHorse123!",
    });
    expect(secondLogin.success).toBe(true);

    const rows = await testDb.drizzle
      .select()
      .from(sessions)
      .where(eq(sessions.userId, loginUserId));

    // The expired session is gone, while both device sessions remain active.
    expect(rows.map((row) => row.id)).not.toContain("session-expired");
    const active = rows.filter((row) => row.isActive);
    expect(active).toHaveLength(2);
    expect(active.map((row) => row.token)).toEqual(
      expect.arrayContaining([
        firstLogin.tokens!.accessToken,
        secondLogin.tokens!.accessToken,
      ]),
    );

    // The prior device can still use both kinds of credential after the second
    // login. A regression here would reproduce the mid-shift forced logout.
    await expect(
      service.validateToken(firstLogin.tokens!.accessToken),
    ).resolves.toMatchObject({ valid: true });
    await expect(
      service.refreshToken(firstLogin.tokens!.refreshToken),
    ).resolves.toMatchObject({ success: true });

    const [user] = await testDb.drizzle
      .select({ lastLoginAt: users.lastLoginAt })
      .from(users)
      .where(eq(users.id, loginUserId));
    expect(user.lastLoginAt).toBeInstanceOf(Date);
  });

  it("revokes every session when the password changes", async () => {
    const accessToken = sign(
      {
        sub: loginUserId,
        username: "owner-password-change",
        role: 1,
        tv: 3,
      },
      jwtSecret,
      { expiresIn: "1h" },
    );
    const refreshToken = sign(
      { sub: loginUserId, type: "refresh", tv: 3, jti: "refresh-password" },
      jwtSecret,
      { expiresIn: "7d" },
    );
    await testDb.drizzle.insert(users).values({
      id: loginUserId,
      username: "owner-password-change",
      fullName: "Owner Password Change",
      passwordHash: await bcrypt.hash("CorrectHorse123!", FIXTURE_BCRYPT_COST),
      role: 1,
      isActive: true,
      tokenVersion: 3,
    });
    await testDb.drizzle.insert(sessions).values([
      {
        id: "session-password-primary",
        userId: loginUserId,
        token: accessToken,
        refreshToken,
        isActive: true,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
      {
        id: "session-password-secondary",
        userId: loginUserId,
        token: "other-access",
        refreshToken: "other-refresh",
        isActive: true,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    ]);

    const service = new AuthService(testDb.bindings.DB, {
      JWT_SECRET: jwtSecret,
      NODE_ENV: "test",
    });

    await expect(
      service.changePassword(
        loginUserId,
        "CorrectHorse123!",
        "ReplacementHorse123!",
      ),
    ).resolves.toEqual({ success: true });

    const rows = await testDb.drizzle
      .select({ isActive: sessions.isActive })
      .from(sessions)
      .where(eq(sessions.userId, loginUserId));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.isActive === false)).toBe(true);

    await expect(service.validateToken(accessToken)).resolves.toEqual({
      valid: false,
      error: "Session expired or invalid",
    });
    await expect(service.refreshToken(refreshToken)).resolves.toEqual({
      success: false,
      error: "Refresh token has been invalidated",
    });
  });

  it("keeps credentials unusable when an account is disabled", async () => {
    const accessToken = sign(
      {
        sub: loginUserId,
        username: "owner-disabled",
        role: 1,
        tv: 3,
      },
      jwtSecret,
      { expiresIn: "1h" },
    );
    const refreshToken = sign(
      { sub: loginUserId, type: "refresh", tv: 3, jti: "refresh-disabled" },
      jwtSecret,
      { expiresIn: "7d" },
    );
    await testDb.drizzle.insert(users).values({
      id: loginUserId,
      username: "owner-disabled",
      fullName: "Owner Disabled",
      passwordHash: "hash",
      role: 1,
      isActive: true,
      tokenVersion: 3,
    });
    await testDb.drizzle.insert(sessions).values({
      id: "session-disabled",
      userId: loginUserId,
      token: accessToken,
      refreshToken,
      isActive: true,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const service = new AuthService(testDb.bindings.DB, {
      JWT_SECRET: jwtSecret,
      NODE_ENV: "test",
    });

    // This matches the account-disable transition: isActive prevents any use
    // immediately, and tokenVersion keeps the old credentials dead if a
    // disabled account is later re-enabled.
    await testDb.drizzle
      .update(users)
      .set({ isActive: false, tokenVersion: 4 })
      .where(eq(users.id, loginUserId));

    await expect(service.validateToken(accessToken)).resolves.toEqual({
      valid: false,
      error: "User not found or inactive",
    });
    await expect(service.refreshToken(refreshToken)).resolves.toEqual({
      success: false,
      error: "User not found or inactive",
    });

    await testDb.drizzle
      .update(users)
      .set({ isActive: true })
      .where(eq(users.id, loginUserId));

    await expect(service.validateToken(accessToken)).resolves.toEqual({
      valid: false,
      error: "Token invalidated",
    });
    await expect(service.refreshToken(refreshToken)).resolves.toEqual({
      success: false,
      error: "Refresh token has been invalidated",
    });
  });

  it("validates UUID-principal access tokens through the session user id", async () => {
    await testDb.drizzle.insert(users).values({
      id: validateUserId,
      username: "owner-validate",
      fullName: "Owner Validate",
      passwordHash: "hash",
      role: 1,
      isActive: true,
      tokenVersion: 4,
    });

    const accessToken = sign(
      {
        sub: validateUserId,
        username: "owner-validate",
        role: 1,
        tv: 4,
      },
      jwtSecret,
      { expiresIn: "72h" },
    );

    await testDb.drizzle.insert(sessions).values({
      id: "session-validate",
      userId: validateUserId,
      token: accessToken,
      isActive: true,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const service = new AuthService(testDb.bindings.DB, {
      JWT_SECRET: jwtSecret,
      NODE_ENV: "test",
    });

    await expect(service.validateToken(accessToken)).resolves.toMatchObject({
      valid: true,
      user: {
        id: validateUserId,
        publicId: validateUserId,
        username: "owner-validate",
      },
    });
  });
});
