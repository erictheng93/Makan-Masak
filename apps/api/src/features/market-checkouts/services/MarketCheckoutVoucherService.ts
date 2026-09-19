/**
 * Market Checkout Voucher (卷) Service — MVP anonymous code redemption.
 *
 * Applies a platform-wide coupon code to a multi-vendor market checkout, splits
 * the discount proportionally across child orders, and records redemption in the
 * existing `coupon_usage` table only on verified payment success.
 *
 * Locked decisions (docs/superpowers/specs/2026-06-03-market-checkout-voucher-redemption.md):
 * - platform coupons apply to every child order; a shop's own coupon applies
 *   only to that shop's child orders and takes precedence over a platform
 *   coupon sharing the code (codes are unique per tenant since 0013),
 * - anonymous (no `user_coupons`, no owner),
 * - `used_count` increments once per checkout, idempotent on replay.
 */

import { drizzle } from "drizzle-orm/d1";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  BusinessTimezoneResolver,
  PLATFORM_BUSINESS_TIMEZONE_OFFSET_MINUTES,
  coupons,
  couponUsage,
  getBusinessDate,
  marketCheckoutChildOrders,
  marketCheckoutSessions,
} from "@makanmasak/database";
import {
  allocateCents,
  currencyStepCents,
  roundToCurrencyCents,
  type CurrencyCode,
} from "@makanmasak/utils";
import type { Env } from "../../../types/env";
import { badRequest, notFound } from "../../../shared/utils/api-error";
import { fromCents, percentageFromBps } from "../../../shared/utils/money";

export interface VoucherChildOrder {
  orderId: string;
  restaurantId?: string;
  amountCents: number;
}

export interface VoucherAllocation {
  orderId: string;
  /** Child order total before the voucher (for the coupon_usage audit row). */
  amountCents: number;
  /** This child's share of the voucher discount. */
  discountCents: number;
}

export interface AppliedVoucher {
  couponId: number;
  code: string;
  name: string;
  restaurantId?: string | null;
  fundedBy: "platform" | "vendor";
  /** Total discount, clamped to the subtotal. */
  discountCents: number;
  allocations: VoucherAllocation[];
  reservationStatus?: "reserved" | "released" | "redeemed";
  reservedAt?: string;
  releasedAt?: string;
}

export interface AppliedVoucherBundle {
  vouchers: AppliedVoucher[];
  /** Total discount across all stacked vouchers, clamped by child allocation. */
  discountCents: number;
  allocations: VoucherAllocation[];
}

export type AppliedMarketCheckoutVoucher =
  | AppliedVoucher
  | AppliedVoucherBundle;

interface NormalizedCoupon {
  discountType: "percentage" | "fixed";
  discountPercentageBps?: number | null;
  discountValueCents: number | null;
  maxDiscountAmountCents: number | null;
}

export class MarketCheckoutVoucherService {
  private readonly db: ReturnType<typeof drizzle>;
  // Type inferred from the constructor: annotating it would pin the schema
  // type parameter to the resolver's default, which this schema-less drizzle
  // instance does not match.
  private readonly businessTimezone;

  constructor(env: Env) {
    this.db = drizzle(env.DB);
    this.businessTimezone = new BusinessTimezoneResolver(this.db);
  }

  /**
   * Discount in cents for a coupon against a subtotal. Pure — unit tested.
   * Percentage discounts round on the currency's step (NT$ and ₫ are whole
   * units) and honor `maxDiscountAmountCents`; a fixed or capped value is
   * rounded *down* to the step so a voucher never gives more than it says;
   * everything clamps to the subtotal and floors at zero.
   */
  static computeDiscountCents(
    coupon: NormalizedCoupon,
    subtotalCents: number,
    currency: CurrencyCode,
  ): number {
    if (subtotalCents <= 0) return 0;
    const step = currencyStepCents(currency);
    const floorToStep = (cents: number) => Math.floor(cents / step) * step;

    let discountCents: number;
    if (coupon.discountType === "percentage") {
      const discountPercentage =
        percentageFromBps(coupon.discountPercentageBps) ?? 0;
      discountCents = roundToCurrencyCents(
        subtotalCents * (discountPercentage / 100),
        currency,
      );
      if (
        coupon.maxDiscountAmountCents != null &&
        discountCents > coupon.maxDiscountAmountCents
      ) {
        discountCents = floorToStep(coupon.maxDiscountAmountCents);
      }
    } else {
      discountCents = floorToStep(coupon.discountValueCents ?? 0);
    }

    return Math.max(0, Math.min(discountCents, floorToStep(subtotalCents)));
  }

  /**
   * Split a total discount across child orders in proportion to their
   * amounts, every share on the currency's step and the shares summing
   * exactly to the discount (largest remainder, ties to the earlier child).
   * Pure — unit tested.
   */
  static splitDiscount(
    discountCents: number,
    childOrders: VoucherChildOrder[],
    currency: CurrencyCode,
  ): VoucherAllocation[] {
    const subtotalCents = childOrders.reduce(
      (sum, child) => sum + child.amountCents,
      0,
    );
    const shares =
      subtotalCents <= 0
        ? childOrders.map(() => 0)
        : allocateCents(
            discountCents,
            childOrders.map((child) => child.amountCents),
            currency,
          );

    return childOrders.map((child, index) => ({
      orderId: child.orderId,
      amountCents: child.amountCents,
      discountCents: shares[index],
    }));
  }

  /**
   * Validate a platform-wide coupon code against a market checkout and price the
   * discount. Throws `ApiError` with a voucher-specific code on any failure.
   */
  async validateAndPrice(input: {
    code: string;
    subtotalCents: number;
    /** The checkout's currency; discounts round on its step. */
    currency: CurrencyCode;
    childOrders: VoucherChildOrder[];
  }): Promise<AppliedVoucher> {
    const code = input.code.trim().toUpperCase();
    if (!code) {
      throw badRequest("Voucher code is required", "VOUCHER_CODE_REQUIRED");
    }

    // Codes are unique per tenant since 0013, so one code can match several
    // rows at once: the platform's, plus one for each shop that owns it.
    // Soft-deleted rows are filtered in the query rather than after it --
    // picking one and then rejecting it would 404 a live voucher that a
    // deleted row happened to shadow.
    //
    // The scope is deliberately NOT narrowed to this checkout's shops. A
    // shop-scoped voucher that does not apply here still has to be found, or
    // the diner is told the code does not exist when the truth is that it
    // belongs to another shop -- that distinction is what VOUCHER_NOT_APPLICABLE
    // below exists to say.
    const childRestaurantIds = new Set(
      input.childOrders
        .map((child) => child.restaurantId)
        .filter((id): id is string => typeof id === "string" && id !== ""),
    );

    const candidates = await this.db
      .select()
      .from(coupons)
      .where(and(eq(coupons.code, code), isNull(coupons.deletedAt)))
      .all();

    // Prefer whichever candidate actually applies here: a shop's own voucher
    // for a shop in this checkout, then the platform's, then anything else
    // (which falls through to the not-applicable error with an accurate
    // message). Ordering by id within a rank keeps the choice deterministic
    // when two shops in one checkout each own the code.
    const rank = (row: (typeof candidates)[number]) => {
      if (row.restaurantId == null) return 1;
      return childRestaurantIds.has(row.restaurantId) ? 0 : 2;
    };
    const [coupon] = candidates.sort(
      (a, b) => rank(a) - rank(b) || a.id - b.id,
    );

    if (!coupon) {
      throw notFound("Voucher not found", "VOUCHER_NOT_FOUND");
    }

    const applicableChildOrders =
      coupon.restaurantId == null
        ? input.childOrders
        : input.childOrders.filter(
            (child) => child.restaurantId === coupon.restaurantId,
          );
    if (applicableChildOrders.length === 0) {
      throw badRequest(
        "This voucher can only be used at its own shop",
        "VOUCHER_NOT_APPLICABLE",
      );
    }
    const applicableSubtotalCents = applicableChildOrders.reduce(
      (sum, child) => sum + child.amountCents,
      0,
    );

    if (!coupon.isActive || !coupon.isVisible) {
      throw badRequest(
        "This voucher is not available",
        "VOUCHER_NOT_APPLICABLE",
      );
    }

    // A shop's voucher expires at that shop's midnight; a platform voucher
    // has no single shop to belong to, so it uses the platform offset (#329).
    //
    // valid_from_ms / valid_to_ms are instants (#271), so both ends are mapped
    // onto the shop's calendar with the same offset before comparing. The old
    // code compared the stored ISO string against `today` directly, which only
    // worked because a `YYYY-MM-DD...` prefix happens to sort like a date.
    const offsetMinutes =
      coupon.restaurantId == null
        ? PLATFORM_BUSINESS_TIMEZONE_OFFSET_MINUTES
        : await this.businessTimezone.offsetMinutes(coupon.restaurantId);
    const today = getBusinessDate(offsetMinutes);
    if (
      getBusinessDate(offsetMinutes, coupon.validFrom) > today ||
      getBusinessDate(offsetMinutes, coupon.validTo) < today
    ) {
      throw badRequest("This voucher has expired", "VOUCHER_EXPIRED");
    }

    if (
      coupon.usageLimit != null &&
      (coupon.usedCount ?? 0) >= coupon.usageLimit
    ) {
      throw badRequest(
        "This voucher has been fully redeemed",
        "VOUCHER_EXHAUSTED",
      );
    }

    const minOrderCents = coupon.minOrderAmountCents ?? 0;
    if (applicableSubtotalCents < minOrderCents) {
      throw badRequest(
        `This voucher requires a minimum order of ${fromCents(minOrderCents)}`,
        "VOUCHER_MIN_ORDER_NOT_MET",
      );
    }

    const discountCents = MarketCheckoutVoucherService.computeDiscountCents(
      {
        discountType: coupon.discountType,
        discountPercentageBps: coupon.discountPercentageBps,
        discountValueCents: coupon.discountValueCents,
        maxDiscountAmountCents: coupon.maxDiscountAmountCents,
      },
      applicableSubtotalCents,
      input.currency,
    );

    if (discountCents <= 0) {
      throw badRequest(
        "This voucher does not apply to your order",
        "VOUCHER_NOT_APPLICABLE",
      );
    }

    return {
      couponId: coupon.id,
      code: coupon.code,
      name: coupon.name,
      restaurantId: coupon.restaurantId,
      fundedBy: coupon.restaurantId == null ? "platform" : "vendor",
      discountCents,
      allocations: MarketCheckoutVoucherService.splitDiscount(
        discountCents,
        applicableChildOrders,
        input.currency,
      ),
    };
  }

  /**
   * Record redemption after verified payment success. Writes one
   * `coupon_usage` row per child order and increments `coupons.used_count`
   * exactly once per checkout. Idempotent: a replay (success path + webhook)
   * does not double-count, guarded by the `(coupon_id, order_id)` unique index.
   */
  async redeem(applied: AppliedVoucher): Promise<void> {
    const orderIds = applied.allocations.map((alloc) => alloc.orderId);
    if (orderIds.length === 0) return;

    const existing = await this.db
      .select({ orderId: couponUsage.orderId })
      .from(couponUsage)
      .where(
        and(
          eq(couponUsage.couponId, applied.couponId),
          inArray(couponUsage.orderId, orderIds),
          sql`(${couponUsage.status} IS NULL OR ${couponUsage.status} != 'cancelled')`,
        ),
      )
      .all();
    const existingOrderIds = new Set(existing.map((row) => row.orderId));

    if (existingOrderIds.size === orderIds.length) {
      // Already fully recorded — idempotent no-op.
      return;
    }

    const claimedDuringRedeem =
      existingOrderIds.size === 0 && applied.reservationStatus !== "reserved";
    if (claimedDuringRedeem) {
      await this.claimUsageSlot(applied.couponId);
    }

    const claimOrderId = [...orderIds].sort()[0];
    let insertedClaimUsage = false;
    for (const alloc of applied.allocations) {
      if (existingOrderIds.has(alloc.orderId)) continue;
      const finalCents = Math.max(0, alloc.amountCents - alloc.discountCents);
      try {
        await this.db
          .insert(couponUsage)
          .values({
            couponId: applied.couponId,
            orderId: alloc.orderId,
            discountAmountCents: alloc.discountCents,
            originalAmountCents: alloc.amountCents,
            finalAmountCents: finalCents,
            status: "active",
          })
          .run();
        if (alloc.orderId === claimOrderId) {
          insertedClaimUsage = true;
        }
      } catch (error) {
        // Unique-index race (concurrent webhook + success path) — the row is
        // already there, so the redemption stays idempotent.
        console.warn(
          `coupon_usage insert skipped for order ${alloc.orderId}:`,
          error,
        );
      }
    }

    if (claimedDuringRedeem && !insertedClaimUsage) {
      await this.releaseUsageSlot(applied.couponId);
    }
  }

  async reserveUsage(applied: AppliedVoucher): Promise<AppliedVoucher> {
    if (applied.reservationStatus === "reserved") {
      return applied;
    }

    await this.claimUsageSlot(applied.couponId);
    return {
      ...applied,
      reservationStatus: "reserved",
      reservedAt: new Date().toISOString(),
      releasedAt: undefined,
    };
  }

  async releaseReservation(applied: AppliedVoucher): Promise<AppliedVoucher> {
    if (applied.reservationStatus !== "reserved") {
      return applied;
    }

    await this.releaseUsageSlot(applied.couponId);
    return {
      ...applied,
      reservationStatus: "released",
      releasedAt: new Date().toISOString(),
    };
  }

  /**
   * Mark a checkout's voucher redemption refunded (mirrors credit refund). Used
   * when a paid market checkout is refunded.
   */
  async markRefunded(input: {
    couponId: number;
    orderIds: string[];
  }): Promise<void> {
    const orderIds = Array.from(new Set(input.orderIds));
    if (orderIds.length === 0) return;

    await this.db
      .update(couponUsage)
      .set({ status: "refunded", updatedAt: new Date() })
      .where(
        and(
          eq(couponUsage.couponId, input.couponId),
          inArray(couponUsage.orderId, orderIds),
          sql`(${couponUsage.status} IS NULL OR ${couponUsage.status} = 'active')`,
        ),
      )
      .run();

    const orderGroups = await this.resolveRefundOrderGroups(orderIds);
    for (const groupOrderIds of orderGroups) {
      const claimOrderId = await this.getFullyRefundedVoucherClaimOrderId(
        input.couponId,
        groupOrderIds,
      );
      if (
        claimOrderId == null ||
        !(await this.claimRefundCountRelease(input.couponId, claimOrderId))
      ) {
        continue;
      }
      await this.db
        .update(coupons)
        .set({
          usedCount: sql`CASE
            WHEN coalesce(${coupons.usedCount}, 0) > 0
            THEN coalesce(${coupons.usedCount}, 0) - 1 ELSE 0 END`,
          updatedAt: new Date(),
        })
        .where(eq(coupons.id, input.couponId))
        .run();
    }
  }

  private async resolveRefundOrderGroups(
    orderIds: string[],
  ): Promise<string[][]> {
    const checkoutRows = await this.db
      .select({
        checkoutId: marketCheckoutChildOrders.checkoutId,
        orderId: marketCheckoutChildOrders.orderId,
      })
      .from(marketCheckoutChildOrders)
      .where(inArray(marketCheckoutChildOrders.orderId, orderIds))
      .all();

    const checkoutIds = Array.from(
      new Set(checkoutRows.map((row) => row.checkoutId)),
    );
    const mappedOrderIds = new Set(checkoutRows.map((row) => row.orderId));
    const groups: string[][] = [];

    if (checkoutIds.length > 0) {
      const childRows = await this.db
        .select({
          checkoutId: marketCheckoutChildOrders.checkoutId,
          orderId: marketCheckoutChildOrders.orderId,
        })
        .from(marketCheckoutChildOrders)
        .where(inArray(marketCheckoutChildOrders.checkoutId, checkoutIds))
        .all();
      const orderIdsByCheckout = new Map<string, Set<string>>();
      for (const row of childRows) {
        const checkoutOrderIds =
          orderIdsByCheckout.get(row.checkoutId) ?? new Set<string>();
        checkoutOrderIds.add(row.orderId);
        orderIdsByCheckout.set(row.checkoutId, checkoutOrderIds);
      }
      for (const checkoutOrderIds of orderIdsByCheckout.values()) {
        groups.push(Array.from(checkoutOrderIds));
      }
    }

    const unmappedOrderIds = orderIds.filter(
      (orderId) => !mappedOrderIds.has(orderId),
    );
    if (unmappedOrderIds.length > 0) {
      groups.push(unmappedOrderIds);
    }

    return groups;
  }

  private async getFullyRefundedVoucherClaimOrderId(
    couponId: number,
    orderIds: string[],
  ): Promise<string | null> {
    if (orderIds.length === 0) return null;

    const usageRows = await this.db
      .select({ orderId: couponUsage.orderId, status: couponUsage.status })
      .from(couponUsage)
      .where(
        and(
          eq(couponUsage.couponId, couponId),
          inArray(couponUsage.orderId, orderIds),
          sql`(${couponUsage.status} IS NULL OR ${couponUsage.status} != 'cancelled')`,
        ),
      )
      .all();

    if (
      usageRows.length === 0 ||
      !usageRows.every((row) => row.status === "refunded")
    ) {
      return null;
    }

    return usageRows.map((row) => row.orderId).sort()[0] ?? null;
  }

  private async claimRefundCountRelease(
    couponId: number,
    claimOrderId: string,
  ): Promise<boolean> {
    const releasedRows = await this.db
      .update(couponUsage)
      .set({ refundCountReleasedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(couponUsage.couponId, couponId),
          eq(couponUsage.orderId, claimOrderId),
          eq(couponUsage.status, "refunded"),
          sql`${couponUsage.refundCountReleasedAt} IS NULL`,
        ),
      )
      .returning({ id: couponUsage.id });

    return releasedRows.length > 0;
  }

  private async claimUsageSlot(couponId: number): Promise<void> {
    const claim = await this.db
      .update(coupons)
      .set({
        usedCount: sql`coalesce(${coupons.usedCount}, 0) + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(coupons.id, couponId),
          sql`(${coupons.usageLimit} IS NULL OR coalesce(${coupons.usedCount}, 0) < ${coupons.usageLimit})`,
        ),
      )
      .run();

    if ((claim.meta?.changes ?? 0) === 0) {
      throw badRequest(
        "This voucher has been fully redeemed",
        "VOUCHER_EXHAUSTED",
      );
    }
  }

  private async releaseUsageSlot(couponId: number): Promise<void> {
    await this.db
      .update(coupons)
      .set({
        usedCount: sql`CASE
          WHEN coalesce(${coupons.usedCount}, 0) > 0
          THEN coalesce(${coupons.usedCount}, 0) - 1 ELSE 0 END`,
        updatedAt: new Date(),
      })
      .where(eq(coupons.id, couponId))
      .run();
  }
}

export function listAppliedMarketCheckoutVouchers(
  applied: AppliedMarketCheckoutVoucher | null | undefined,
): AppliedVoucher[] {
  if (!applied) return [];
  if (isAppliedVoucherBundle(applied)) {
    return applied.vouchers.map(normalizeAppliedVoucherFunding);
  }
  return [normalizeAppliedVoucherFunding(applied)];
}

export function combineAppliedMarketCheckoutVouchers(
  vouchers: AppliedVoucher[],
): AppliedMarketCheckoutVoucher | undefined {
  if (vouchers.length === 0) return undefined;
  if (vouchers.length === 1) return vouchers[0];

  const allocationByOrderId = new Map<string, VoucherAllocation>();
  for (const voucher of vouchers) {
    for (const alloc of voucher.allocations) {
      const existing = allocationByOrderId.get(alloc.orderId);
      if (!existing) {
        allocationByOrderId.set(alloc.orderId, { ...alloc });
        continue;
      }
      existing.amountCents = Math.max(existing.amountCents, alloc.amountCents);
      existing.discountCents += alloc.discountCents;
    }
  }

  return {
    vouchers,
    discountCents: vouchers.reduce(
      (sum, voucher) => sum + voucher.discountCents,
      0,
    ),
    allocations: Array.from(allocationByOrderId.values()).sort((a, b) =>
      String(a.orderId).localeCompare(String(b.orderId)),
    ),
  };
}

export function totalAppliedVoucherDiscountCents(
  applied: AppliedMarketCheckoutVoucher | null | undefined,
): number {
  return listAppliedMarketCheckoutVouchers(applied).reduce(
    (sum, voucher) => sum + voucher.discountCents,
    0,
  );
}

function isAppliedVoucherBundle(
  applied: AppliedMarketCheckoutVoucher,
): applied is AppliedVoucherBundle {
  return Array.isArray((applied as AppliedVoucherBundle).vouchers);
}

function normalizeAppliedVoucherFunding(
  voucher: AppliedVoucher,
): AppliedVoucher {
  if (voucher.fundedBy === "platform" || voucher.fundedBy === "vendor") {
    return voucher;
  }
  return {
    ...voucher,
    fundedBy: voucher.restaurantId == null ? "platform" : "vendor",
  };
}

export async function redeemCachedMarketCheckoutVoucher(
  env: Env,
  checkoutId: string,
): Promise<void> {
  const appliedVoucher =
    (await readCachedAppliedMarketCheckoutVoucher(env, checkoutId)) ??
    (await readPersistedAppliedMarketCheckoutVoucher(env, checkoutId));
  if (!appliedVoucher) return;

  try {
    const service = new MarketCheckoutVoucherService(env);
    for (const voucher of listAppliedMarketCheckoutVouchers(appliedVoucher)) {
      await service.redeem(voucher);
    }
  } catch (error) {
    console.error(
      `Voucher redemption failed for async market checkout ${checkoutId}:`,
      error,
    );
  }
}

async function readCachedAppliedMarketCheckoutVoucher(
  env: Env,
  checkoutId: string,
): Promise<AppliedMarketCheckoutVoucher | null> {
  const stored = await env.CACHE_KV.get(`market_checkout:${checkoutId}`);
  if (!stored) return null;

  try {
    return readAppliedMarketCheckoutVoucher(JSON.parse(stored) as unknown);
  } catch {
    return null;
  }
}

async function readPersistedAppliedMarketCheckoutVoucher(
  env: Env,
  checkoutId: string,
): Promise<AppliedMarketCheckoutVoucher | null> {
  const db = drizzle(env.DB);
  const row = await db
    .select({
      applied_voucher: sql<
        string | null
      >`${marketCheckoutSessions.appliedVoucher}`,
    })
    .from(marketCheckoutSessions)
    .where(eq(marketCheckoutSessions.id, checkoutId))
    .limit(1)
    .get();
  if (!row?.applied_voucher) return null;

  const rawAppliedVoucher = row.applied_voucher;
  const appliedVoucher =
    typeof rawAppliedVoucher === "string"
      ? safeJsonParse(rawAppliedVoucher)
      : rawAppliedVoucher;
  return readAppliedMarketCheckoutVoucher({ appliedVoucher });
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function readAppliedMarketCheckoutVoucher(
  value: unknown,
): AppliedMarketCheckoutVoucher | null {
  if (!value || typeof value !== "object") return null;
  const appliedVoucher = (value as { appliedVoucher?: unknown }).appliedVoucher;
  if (!appliedVoucher || typeof appliedVoucher !== "object") return null;

  const bundleCandidate = appliedVoucher as Partial<AppliedVoucherBundle>;
  if (Array.isArray(bundleCandidate.vouchers)) {
    const vouchers = bundleCandidate.vouchers
      .map(readAppliedVoucherObject)
      .filter((voucher): voucher is AppliedVoucher => voucher != null);
    if (vouchers.length !== bundleCandidate.vouchers.length) return null;
    return combineAppliedMarketCheckoutVouchers(vouchers) ?? null;
  }

  return readAppliedVoucherObject(appliedVoucher);
}

function readAppliedVoucherObject(value: unknown): AppliedVoucher | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AppliedVoucher>;
  if (
    typeof candidate.couponId !== "number" ||
    typeof candidate.code !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.discountCents !== "number" ||
    !Array.isArray(candidate.allocations)
  ) {
    return null;
  }

  const allocations = candidate.allocations.filter(
    (alloc): alloc is VoucherAllocation =>
      alloc != null &&
      typeof alloc === "object" &&
      typeof (alloc as VoucherAllocation).orderId === "number" &&
      typeof (alloc as VoucherAllocation).amountCents === "number" &&
      typeof (alloc as VoucherAllocation).discountCents === "number",
  );
  if (allocations.length !== candidate.allocations.length) return null;

  return {
    couponId: candidate.couponId,
    code: candidate.code,
    name: candidate.name,
    restaurantId: candidate.restaurantId,
    fundedBy:
      candidate.fundedBy === "platform" || candidate.fundedBy === "vendor"
        ? candidate.fundedBy
        : candidate.restaurantId == null
          ? "platform"
          : "vendor",
    discountCents: candidate.discountCents,
    allocations,
    reservationStatus:
      candidate.reservationStatus === "reserved" ||
      candidate.reservationStatus === "released" ||
      candidate.reservationStatus === "redeemed"
        ? candidate.reservationStatus
        : undefined,
    reservedAt:
      typeof candidate.reservedAt === "string"
        ? candidate.reservedAt
        : undefined,
    releasedAt:
      typeof candidate.releasedAt === "string"
        ? candidate.releasedAt
        : undefined,
  };
}
