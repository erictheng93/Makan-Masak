export type CouponStatus =
  | "inactive"
  | "expired"
  | "exhausted"
  | "scheduled"
  | "active";

export const getCouponStatus = (coupon: {
  isActive: boolean;
  validFrom: string;
  validTo: string;
  usageLimit?: number;
  usedCount: number;
}): CouponStatus => {
  if (!coupon.isActive) return "inactive";
  if (new Date() > new Date(coupon.validTo)) return "expired";
  if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit)
    return "exhausted";
  if (new Date() < new Date(coupon.validFrom)) return "scheduled";
  return "active";
};

/**
 * Paid uses. usedCount also includes slots held by unpaid checkouts
 * (reservedCount) — right for "is it exhausted", wrong for "how many used".
 */
export const paidUseCount = (coupon: {
  usedCount?: number | null;
  reservedCount?: number | null;
}): number =>
  Math.max(0, (coupon.usedCount ?? 0) - (coupon.reservedCount ?? 0));
