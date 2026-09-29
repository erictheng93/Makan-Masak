import { getBusinessDate } from "./business-day";
import {
  SUPPORTED_BUSINESS_TIMEZONES,
  businessTimezoneOffsetMinutes,
} from "./business-timezone";

/** Markets roll over at a local wall-clock time; defaults to 05:00. */
export const DEFAULT_MARKET_BUSINESS_DAY_CUTOFF_MINUTES = 300;

const DAY_MS = 86_400_000;

export function getMarketBusinessDate(
  offsetMinutes: number,
  cutoffMinutes: number,
  at: Date = new Date(),
): string {
  return getBusinessDate(offsetMinutes - cutoffMinutes, at);
}

export function isMarketVendorOpenToday(
  openedAt: Date | null | undefined,
  offsetMinutes: number,
  cutoffMinutes: number,
  now: Date = new Date(),
): boolean {
  return (
    openedAt != null &&
    getMarketBusinessDate(offsetMinutes, cutoffMinutes, openedAt) ===
      getMarketBusinessDate(offsetMinutes, cutoffMinutes, now)
  );
}

export function marketBusinessDayStartMs(
  businessDate: string,
  offsetMinutes: number,
  cutoffMinutes: number,
): number {
  return (
    Date.parse(`${businessDate}T00:00:00Z`) +
    (cutoffMinutes - offsetMinutes) * 60_000
  );
}

export function marketBusinessDayEndMs(
  businessDate: string,
  offsetMinutes: number,
  cutoffMinutes: number,
): number {
  return (
    marketBusinessDayStartMs(businessDate, offsetMinutes, cutoffMinutes) +
    DAY_MS
  );
}

export function marketBusinessDateCacheKey(
  cutoffMinutes: number,
  now: Date = new Date(),
): string {
  return SUPPORTED_BUSINESS_TIMEZONES.map((zone) =>
    getMarketBusinessDate(
      businessTimezoneOffsetMinutes(zone),
      cutoffMinutes,
      now,
    ),
  ).join(",");
}
