import { sign } from "hono/jwt";

const TEST_SECRET = "test-jwt-secret-do-not-use-in-prod";

export type UserRole = 0 | 1 | 2 | 3 | 4 | 5;
type TestUserId = string | number;

export interface IssueTestJwtClaims {
  userId?: TestUserId;
  username?: string;
  restaurantId?: string;
  tokenVersion?: number;
  expiresInSeconds?: number;
}

export async function issueTestJwt(
  role: UserRole,
  claims?: IssueTestJwtClaims,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const userId = normalizeTestUserId(claims?.userId ?? 1);
  const username = claims?.username ?? `test-user-${userId}`;
  return sign(
    {
      sub: userId,
      id: userId,
      username,
      role,
      restaurantId: claims?.restaurantId ?? null,
      tv: claims?.tokenVersion ?? 1,
      iat: now,
      exp: now + (claims?.expiresInSeconds ?? 3600),
    },
    TEST_SECRET,
  );
}

export interface AuthHelper {
  adminToken(restaurantId?: string, userId?: TestUserId): Promise<string>;
  ownerToken(userId: TestUserId, restaurantId: string): Promise<string>;
  staffToken(
    userId: TestUserId,
    role: UserRole,
    restaurantId: string,
  ): Promise<string>;
  customerToken(userId: TestUserId): Promise<string>;
}

interface TokenUserRow {
  username: string;
  role: number;
  restaurant_id: string | null;
  token_version: number | null;
}

async function loadTokenUser(
  db: D1Database | undefined,
  userId: TestUserId,
): Promise<TokenUserRow | null> {
  if (!db) return null;

  return (
    (await db
      .prepare(
        `SELECT username, role, restaurant_id, token_version
           FROM users
          WHERE id = ?
          LIMIT 1`,
      )
      .bind(normalizeTestUserId(userId))
      .first<TokenUserRow>()) ?? null
  );
}

function normalizeTestUserId(userId: TestUserId): string {
  if (typeof userId === "number") {
    return `01900000-0000-7000-8000-${String(userId).padStart(12, "0")}`;
  }
  return userId;
}

async function ensureTokenUser(
  db: D1Database | undefined,
  role: UserRole,
  claims: IssueTestJwtClaims,
): Promise<TokenUserRow | null> {
  if (!db) return null;

  const userId = normalizeTestUserId(claims.userId ?? 1);
  const existing = await loadTokenUser(db, userId);
  if (existing) return existing;

  const now = Date.now();
  const username = claims.username ?? `test-user-${userId}`;
  const restaurantId = claims.restaurantId ?? null;
  const tokenVersion = claims.tokenVersion ?? 1;

  await db
    .prepare(
      `INSERT OR IGNORE INTO users (
         id,
         username,
         email,
         phone,
         full_name,
         password_hash,
         role,
         restaurant_id,
         is_active,
         is_verified,
         preferences,
         token_version,
         created_at_ms,
         updated_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)`,
    )
    .bind(
      userId,
      username,
      `${userId}@example.test`,
      "0912345678",
      "Integration Test User",
      "$2a$10$wLQYkZtHPzOVvvEVdW/PGe0IzS5gYejVGKj.mJ/.SmdO1sAgG4Y/S",
      role,
      restaurantId,
      JSON.stringify({}),
      tokenVersion,
      now,
      now,
    )
    .run();

  return loadTokenUser(db, userId);
}

async function issueDbBackedJwt(
  db: D1Database | undefined,
  role: UserRole,
  claims: IssueTestJwtClaims,
): Promise<string> {
  const userId = claims.userId ?? 1;
  const row = await ensureTokenUser(db, role, claims);

  const token = await issueTestJwt(role, {
    ...claims,
    userId,
    username: claims.username ?? row?.username,
    restaurantId:
      claims.restaurantId ?? row?.restaurant_id ?? claims.restaurantId,
    tokenVersion: Number(row?.token_version ?? claims.tokenVersion ?? 1),
  });
  await recordTestSession(db, userId, token, claims.expiresInSeconds ?? 3600);
  return token;
}

/** Staff auth requires an active sessions row matching the access token. */
async function recordTestSession(
  db: D1Database | undefined,
  userId: TestUserId,
  token: string,
  expiresInSeconds: number,
): Promise<void> {
  if (!db) return;
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO sessions (
         id, user_id, token, is_active,
         last_accessed_at_ms, expires_at_ms, created_at_ms, updated_at_ms
       ) VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      normalizeTestUserId(userId),
      token,
      now,
      now + expiresInSeconds * 1000,
      now,
      now,
    )
    .run();
}

export function buildAuthHelper(db?: D1Database): AuthHelper {
  return {
    adminToken: (restaurantId, userId = 1) =>
      issueDbBackedJwt(db, 0, {
        userId,
        ...(restaurantId === undefined ? {} : { restaurantId }),
      }),
    ownerToken: (userId, restaurantId) =>
      issueDbBackedJwt(db, 1, { userId, restaurantId }),
    staffToken: (userId, role, restaurantId) =>
      issueDbBackedJwt(db, role, { userId, restaurantId }),
    customerToken: (userId) => issueDbBackedJwt(db, 5, { userId }),
  };
}
