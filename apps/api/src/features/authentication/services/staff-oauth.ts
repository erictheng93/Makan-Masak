/**
 * Google / LINE identities for shop owners (`user_auth_identities`).
 *
 * Link-only by design: nothing here creates a user, and nothing matches on the
 * provider's email. An identity exists because a signed-in owner attached it.
 */

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  createDatabase,
  restaurants,
  userAuthIdentities,
  users,
} from "@makanmasak/database";
import { USER_ROLES } from "../../../shared/constants";
import { conflict, forbidden, notFound } from "../../../shared/utils/api-error";

/** The drizzle handle (`createDatabase(env.DB)`), not the raw D1 binding. */
export type Db = ReturnType<typeof createDatabase>;

export const STAFF_OAUTH_PROVIDERS = ["google", "line"] as const;
export type StaffOAuthProvider = (typeof STAFF_OAUTH_PROVIDERS)[number];

export function isStaffOAuthProvider(
  value: string | undefined,
): value is StaffOAuthProvider {
  return (STAFF_OAUTH_PROVIDERS as readonly string[]).includes(value ?? "");
}

export interface StaffOAuthProfile {
  email?: string;
  emailVerified?: boolean;
  displayName?: string;
  avatarUrl?: string;
}

const live = isNull(userAuthIdentities.revokedAt);

/**
 * Every live link of a provider account, one per shop-owner account the same
 * person linked it to, with each user's role and shop for the shop picker.
 */
export async function findLiveIdentities(
  db: Db,
  provider: StaffOAuthProvider,
  providerUid: string,
) {
  return db
    .select({
      id: userAuthIdentities.id,
      userId: userAuthIdentities.userId,
      role: users.role,
      restaurantId: users.restaurantId,
      restaurantName: restaurants.name,
    })
    .from(userAuthIdentities)
    .innerJoin(users, eq(users.id, userAuthIdentities.userId))
    .leftJoin(restaurants, eq(restaurants.id, users.restaurantId))
    .where(
      and(
        eq(userAuthIdentities.provider, provider),
        eq(userAuthIdentities.providerUid, providerUid),
        live,
      ),
    )
    .orderBy(asc(restaurants.name), asc(userAuthIdentities.createdAt));
}

/** Whether `identityId` is still a live link to `userId`, and that user is an owner. */
export async function isLiveOwnerIdentity(
  db: Db,
  identityId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ role: users.role })
    .from(userAuthIdentities)
    .innerJoin(users, eq(users.id, userAuthIdentities.userId))
    .where(
      and(
        eq(userAuthIdentities.id, identityId),
        eq(userAuthIdentities.userId, userId),
        live,
      ),
    )
    .limit(1);
  return row?.role === USER_ROLES.OWNER;
}

export async function touchLastUsed(db: Db, id: string, now: number) {
  await db
    .update(userAuthIdentities)
    .set({ lastUsedAt: new Date(now) })
    .where(eq(userAuthIdentities.id, id));
}

/**
 * Attach a verified provider account to `userId`. Idempotent when it is
 * already linked to that same user. The same account may also be linked to
 * other owners' rows (one person, several shops); sign-in then asks which.
 */
export async function linkIdentity(
  db: Db,
  input: {
    userId: string;
    provider: StaffOAuthProvider;
    providerUid: string;
    profile: StaffOAuthProfile;
    now: number;
  },
): Promise<{ id: string }> {
  const { userId, provider, providerUid, profile, now } = input;

  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user || user.role !== USER_ROLES.OWNER) {
    throw forbidden(
      "Only shop owners can link a sign-in provider",
      "OAUTH_LINK_NOT_ALLOWED",
    );
  }

  const existing = (await findLiveIdentities(db, provider, providerUid)).find(
    (row) => row.userId === userId,
  );
  if (existing) {
    await touchLastUsed(db, existing.id, now);
    return { id: existing.id };
  }

  const [sameProvider] = await db
    .select({ id: userAuthIdentities.id })
    .from(userAuthIdentities)
    .where(
      and(
        eq(userAuthIdentities.userId, userId),
        eq(userAuthIdentities.provider, provider),
        live,
      ),
    )
    .limit(1);
  if (sameProvider) {
    throw conflict(
      `A different ${provider} account is already linked; unlink it first`,
      "OAUTH_PROVIDER_ALREADY_LINKED",
    );
  }

  try {
    const [row] = await db
      .insert(userAuthIdentities)
      .values({
        userId,
        provider,
        providerUid,
        providerEmail: profile.email,
        providerEmailVerified: profile.emailVerified,
        providerDisplayName: profile.displayName,
        providerAvatarUrl: profile.avatarUrl,
        verifiedAt: new Date(now),
        lastUsedAt: new Date(now),
        createdAt: new Date(now),
      })
      .returning({ id: userAuthIdentities.id });
    return row;
  } catch (error) {
    // Two concurrent links to one user lose to the partial unique index, not
    // to the pre-checks above.
    if (error instanceof Error && /UNIQUE/i.test(error.message)) {
      throw conflict(
        `A ${provider} account is already linked; unlink it first`,
        "OAUTH_PROVIDER_ALREADY_LINKED",
      );
    }
    throw error;
  }
}

/** A user's live identities. `provider_uid` is deliberately not returned. */
export async function listIdentities(db: Db, userId: string) {
  return db
    .select({
      id: userAuthIdentities.id,
      provider: userAuthIdentities.provider,
      email: userAuthIdentities.providerEmail,
      displayName: userAuthIdentities.providerDisplayName,
      avatarUrl: userAuthIdentities.providerAvatarUrl,
      linkedAt: userAuthIdentities.createdAt,
      lastUsedAt: userAuthIdentities.lastUsedAt,
    })
    .from(userAuthIdentities)
    .where(and(eq(userAuthIdentities.userId, userId), live));
}

/**
 * Unlink one of the user's own identities. Refused unless the user keeps
 * another way in: a second live identity, or a password somebody actually set
 * (`password_set_at_ms`; the hash alone may be the onboarding placeholder).
 */
export async function revokeIdentity(
  db: Db,
  userId: string,
  identityId: string,
  now: number,
): Promise<{ provider: StaffOAuthProvider }> {
  const [target] = await db
    .select({ provider: userAuthIdentities.provider })
    .from(userAuthIdentities)
    .where(
      and(
        eq(userAuthIdentities.id, identityId),
        eq(userAuthIdentities.userId, userId),
        live,
      ),
    )
    .limit(1);
  if (!target) throw notFound("Sign-in method not found", "IDENTITY_NOT_FOUND");

  // One statement decides and writes. Checking first and revoking second let
  // two concurrent unlinks each see the other identity as still live and both
  // succeed, leaving the owner with no way in.
  const revoked = await db
    .update(userAuthIdentities)
    .set({ revokedAt: new Date(now) })
    .where(
      and(
        eq(userAuthIdentities.id, identityId),
        eq(userAuthIdentities.userId, userId),
        live,
        sql`(
          EXISTS (
            SELECT 1 FROM ${userAuthIdentities} AS other
             WHERE other.user_id = ${userId}
               AND other.revoked_at_ms IS NULL
               AND other.id <> ${identityId}
          )
          OR EXISTS (
            SELECT 1 FROM ${users}
             WHERE ${users.id} = ${userId}
               AND ${users.passwordSetAt} IS NOT NULL
          )
        )`,
      ),
    )
    .returning({ id: userAuthIdentities.id });
  if (revoked.length === 0) {
    throw conflict(
      "Cannot remove the only remaining sign-in method",
      "LAST_AUTH_METHOD",
    );
  }
  return { provider: target.provider };
}
