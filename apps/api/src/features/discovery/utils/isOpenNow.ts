import { resolveBusinessTimezone } from "@makanmasak/database";
import type { BusinessHours } from "../types";

/**
 * The public status deliberately distinguishes a shop that is configured as
 * closed from one that has not published its hours yet.  `isOpenNow` remains
 * fail-closed for operational decisions (for example, takeaway eligibility),
 * while discovery can be honest with diners instead of labelling new shops as
 * closed.
 */
export type OpeningHoursStatus = "open" | "closed" | "unavailable";

export function getOpeningHoursStatus(
  businessHours: BusinessHours | null | undefined,
  timezone?: string | null,
  now?: Date,
): OpeningHoursStatus {
  if (!businessHours || Object.keys(businessHours).length === 0) {
    return "unavailable";
  }

  return isOpenNow(businessHours, timezone, now) ? "open" : "closed";
}

/**
 * Check if a restaurant is currently open.
 * Workers run in UTC, so we must convert to the restaurant's timezone.
 *
 * `timezone` is the shop's own `restaurants.timezone`. It used to default to
 * Asia/Taipei and no caller ever passed anything, so a Jakarta stall trading
 * until 22:00 read as closed from 21:00 local onwards (#329). It is resolved
 * rather than used raw because an unrecognised name makes Intl throw a
 * RangeError, and a discovery listing must not 500 over one bad row.
 */
export function isOpenNow(
  businessHours: BusinessHours | null | undefined,
  timezone?: string | null,
  now?: Date,
): boolean {
  if (!businessHours) return false;

  const currentTime = now || new Date();

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: resolveBusinessTimezone(timezone),
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(currentTime);
  const weekdayPart =
    parts.find((p) => p.type === "weekday")?.value?.toLowerCase() || "";
  const hourPart = parts.find((p) => p.type === "hour")?.value || "00";
  const minutePart = parts.find((p) => p.type === "minute")?.value || "00";

  const dayKey = weekdayPart;
  const todayHours = businessHours[dayKey];

  if (
    !todayHours ||
    ("isOpen" in todayHours && !todayHours.isOpen) ||
    ("closed" in todayHours && todayHours.closed)
  ) {
    return false;
  }

  const currentHHmm = `${hourPart}:${minutePart}`;
  return currentHHmm >= todayHours.open && currentHHmm < todayHours.close;
}
