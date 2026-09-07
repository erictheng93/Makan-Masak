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

  // The four session writes on the login path run as one ordered D1 batch.
  // Order is the load-bearing part: the deactivate and the expired-session
  // sweep have to land before the insert, or they would clobber the session
  // being created.
  it("deactivates old sessions and sweeps expired ones without touching the new session", async () => {
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
    await testDb.drizzle.insert(sessions).values([
      {
        id: "session-still-valid",
        userId: loginUserId,
        token: "old-access",
        refreshToken: "old-refresh",
        expiresAt: new Date(Date.now() + hour),
        isActive: true,
      },
      {
        id: "session-expired",
        userId: loginUserId,
        token: "expired-access",
        refreshToken: "expired-refresh",
        expiresAt: new Date(Date.now() - hour),
        isActive: true,
      },
    ]);

    const service = new AuthService(testDb.bindings.DB, {
      JWT_SECRET: jwtSecret,
      NODE_ENV: "test",
    });

    const result = await service.login({
      username: "owner-login",
      password: "CorrectHorse123!",
    });
    expect(result.success).toBe(true);

    const rows = await testDb.drizzle
      .select()
      .from(sessions)
      .where(eq(sessions.userId, loginUserId));

    // Expired one is gone, the previously valid one survives but deactivated,
    // and the brand new session is the only active one.
    expect(rows.map((row) => row.id)).not.toContain("session-expired");
    expect(rows.find((row) => row.id === "session-still-valid")?.isActive).toBe(
      false,
    );

    const active = rows.filter((row) => row.isActive);
    expect(active).toHaveLength(1);
    expect(active[0].token).toBe(result.tokens!.accessToken);

    const [user] = await testDb.drizzle
      .select({ lastLoginAt: users.lastLoginAt })
      .from(users)
      .where(eq(users.id, loginUserId));
    expect(user.lastLoginAt).toBeInstanceOf(Date);
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
