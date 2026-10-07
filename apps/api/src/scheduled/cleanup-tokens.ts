/**
 * Scheduled Token Cleanup
 * Runs daily to clean up expired verification tokens
 * Cloudflare Workers Cron Trigger
 */

import { drizzle } from "drizzle-orm/d1";
import { and, inArray, lt } from "drizzle-orm";
import {
  VerificationService,
  idempotencyKeys,
  IDEMPOTENCY_SCOPES,
} from "@makanmasak/database";
import type { Env } from "../types/env";
import { AlertService } from "../services/AlertService";

export interface CleanupResult {
  success: boolean;
  deletedTokens?: {
    passwordReset: number;
    emailVerification: number;
    phoneVerification: number;
  };
  error?: string;
  timestamp: Date;
}

/**
 * Clean up expired tokens
 * This function is called by Cloudflare Workers cron trigger
 */
export async function cleanupExpiredTokens(env: Env): Promise<CleanupResult> {
  const startTime = Date.now();

  try {
    console.log("[Cron] Starting token cleanup...");

    const verificationService = new VerificationService(env.DB, env);

    const result = await verificationService.cleanupExpiredTokens();
    const stats = {
      passwordReset: result.deletedPasswordResetTokens,
      emailVerification: result.deletedEmailVerificationTokens,
      phoneVerification: result.deletedPhoneVerificationTokens,
    };

    const duration = Date.now() - startTime;

    console.log(`[Cron] Token cleanup completed in ${duration}ms`, stats);

    return {
      success: true,
      deletedTokens: stats,
      timestamp: new Date(),
    };
  } catch (error) {
    console.error("[Cron] Token cleanup error:", error);

    const cleanupError =
      error instanceof Error ? error : new Error(String(error));
    const alertService = new AlertService(env);
    await alertService.systemError(cleanupError, "Token Cleanup Cron Job");

    return {
      success: false,
      error: cleanupError.message,
      timestamp: new Date(),
    };
  }
}

/**
 * Drop idempotency reservations whose TTL has run out.
 *
 * `idempotencyMiddleware` writes a row before the handler runs, and the
 * platform webhook route is its one unauthenticated caller — so any stranger
 * sending a fresh event id reserves a row that lives 24 hours, before anything
 * has checked a signature. Nothing ever swept them: an expired row was only
 * reclaimed when the *same* key came back (`isReclaimable` in
 * `middleware/idempotency.ts`), which a caller rotating keys never does. So the
 * table only grew (#338).
 *
 * Scoped rather than a bare `expiresAt <` so the composite
 * `(scope, expires_at)` index can serve this. `expires_at` is that index's
 * second column, and what happens without a predicate on the first one depends
 * on whether the database has ANALYZE statistics — measured on the baseline
 * DDL with 5,000 rows:
 *
 *   with stats:     SEARCH ... USING INDEX (ANY(scope) AND expires_at<?)
 *   without stats:  SCAN idempotency_keys
 *
 * SQLite can skip-scan the leading column, but only when statistics tell it
 * that column has few distinct values. D1 does not run ANALYZE, so the
 * realistic plan for the bare predicate is the full scan — of exactly the
 * table this job exists to keep small. Naming both scopes keeps it an index
 * seek either way.
 *
 * `expires_at` is in **milliseconds**, despite the plain `integer` column and
 * the missing `_ms` suffix: `idempotency.ts` stores `Date.now() + ttlSeconds *
 * 1000`. Worth stating, because `cleanupOldLogs` below works in *seconds* on a
 * column named the same way.
 */
export async function cleanupExpiredIdempotencyKeys(
  env: Env,
): Promise<{ deleted: number | null }> {
  try {
    const db = drizzle(env.DB);
    const result = await db
      .delete(idempotencyKeys)
      .where(
        and(
          inArray(idempotencyKeys.scope, Object.values(IDEMPOTENCY_SCOPES)),
          lt(idempotencyKeys.expiresAt, Date.now()),
        ),
      );

    // D1 reports the row count in `meta.changes`; treat its absence as unknown
    // rather than as zero, so a driver change does not read as "nothing to do".
    const deleted =
      (result as { meta?: { changes?: number } })?.meta?.changes ?? null;

    console.log(
      `[Cron] Expired idempotency keys cleaned up (${deleted ?? "count unavailable"})`,
    );
    return { deleted };
  } catch (error) {
    console.error("[Cron] Error cleaning up idempotency keys:", error);
    return { deleted: null };
  }
}

/**
 * Clean up old password change logs (keep last 90 days)
 */
export async function cleanupOldLogs(env: Env): Promise<void> {
  try {
    const ninetyDaysAgo = Math.floor(Date.now() / 1000) - 90 * 24 * 60 * 60;

    await env.DB.prepare(
      "DELETE FROM password_change_logs WHERE created_at < ?",
    )
      .bind(ninetyDaysAgo)
      .run();

    console.log("[Cron] Old password change logs cleaned up (90+ days)");
  } catch (error) {
    console.error("[Cron] Error cleaning up old logs:", error);
  }
}
