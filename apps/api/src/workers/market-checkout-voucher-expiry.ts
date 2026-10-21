/**
 * Market Checkout Voucher Reservation Sweep
 *
 * A voucher is reserved (coupons.used_count slot, plus the per-user claim row
 * for per-user-limited coupons) when it is applied or when payment starts. A
 * failed payment or a removed voucher releases it, but a checkout the customer
 * simply walks away from never does — so this sweep releases reservations on
 * checkouts that stayed unpaid and untouched for STALE_AFTER_MS.
 *
 * A checkout that is paid after its reservation was released still redeems:
 * `redeem()` re-claims the slot when the voucher is no longer "reserved".
 */

import { drizzle } from "drizzle-orm/d1";
import { and, asc, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { marketCheckoutSessions } from "@makanmasak/database";
import {
  MarketCheckoutVoucherService,
  combineAppliedMarketCheckoutVouchers,
  listAppliedMarketCheckoutVouchers,
  readAppliedMarketCheckoutVoucher,
} from "../features/market-checkouts/services/MarketCheckoutVoucherService";
import type { Env } from "../types/env";

// Well past the 4h KV session TTL, so no cached copy still says "reserved".
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BATCH_LIMIT = 50;
const UNPAID_STATUSES = ["pending", "failed"];

export type VoucherExpirySweepDb = ReturnType<typeof drizzle>;

export interface VoucherExpirySweepOptions {
  nowMs?: number;
  limit?: number;
  /** Injectable for tests; defaults to a Drizzle instance over `env.DB`. */
  db?: VoucherExpirySweepDb;
  voucherService?: Pick<MarketCheckoutVoucherService, "releaseReservation">;
}

export interface VoucherExpirySweepResult {
  scanned: number;
  released: number;
  errors: string[];
}

export async function releaseStaleMarketCheckoutVoucherReservations(
  env: Env,
  options: VoucherExpirySweepOptions = {},
): Promise<VoucherExpirySweepResult> {
  const db = options.db ?? drizzle(env.DB);
  const voucherService =
    options.voucherService ?? new MarketCheckoutVoucherService(env);
  const nowMs = options.nowMs ?? Date.now();

  const rows = await db
    .select({
      id: marketCheckoutSessions.id,
      appliedVoucher: marketCheckoutSessions.appliedVoucher,
      updatedAt: marketCheckoutSessions.updatedAt,
    })
    .from(marketCheckoutSessions)
    .where(
      and(
        isNotNull(marketCheckoutSessions.appliedVoucher),
        inArray(marketCheckoutSessions.paymentStatus, UNPAID_STATUSES),
        lt(marketCheckoutSessions.updatedAt, new Date(nowMs - STALE_AFTER_MS)),
      ),
    )
    .orderBy(asc(marketCheckoutSessions.updatedAt))
    .limit(options.limit ?? DEFAULT_BATCH_LIMIT)
    .all();

  let released = 0;
  const errors: string[] = [];
  for (const row of rows) {
    const vouchers = listAppliedMarketCheckoutVouchers(
      readAppliedMarketCheckoutVoucher({ appliedVoucher: row.appliedVoucher }),
    );
    const reserved = vouchers.filter((v) => v.reservationStatus === "reserved");
    if (reserved.length === 0) continue;

    try {
      const releasedAt = new Date(nowMs).toISOString();
      const next = combineAppliedMarketCheckoutVouchers(
        vouchers.map((v) =>
          v.reservationStatus === "reserved"
            ? { ...v, reservationStatus: "released" as const, releasedAt }
            : v,
        ),
      );
      // Compare-and-set on updatedAt: a payment that started since the read
      // bumps it, and that checkout keeps its reservation.
      const claim = await db
        .update(marketCheckoutSessions)
        .set({
          appliedVoucher: JSON.parse(JSON.stringify(next)) as Record<
            string,
            unknown
          >,
          updatedAt: new Date(nowMs),
        })
        .where(
          and(
            eq(marketCheckoutSessions.id, row.id),
            eq(marketCheckoutSessions.updatedAt, row.updatedAt),
          ),
        )
        .returning({ id: marketCheckoutSessions.id })
        .all();
      if (claim.length === 0) continue;

      for (const voucher of reserved) {
        await voucherService.releaseReservation(voucher);
      }
      released += reserved.length;
    } catch (error) {
      errors.push(
        `${row.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { scanned: rows.length, released, errors };
}
