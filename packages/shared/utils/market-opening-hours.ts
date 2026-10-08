export const MARKET_WEEKDAYS = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type MarketWeekday = (typeof MARKET_WEEKDAYS)[number];

export type MarketOpeningHours = Partial<
  Record<MarketWeekday, { open: string; close: string; closed?: boolean }>
>;

export type MarketOpeningHoursIssue =
  | { kind: "not_object" }
  | { kind: "invalid_day_hours"; day: string }
  | { kind: "unknown_day"; day: string }
  | {
      kind: "invalid_time";
      day: string;
      field: "open" | "close";
      value: unknown;
    }
  | { kind: "missing_time"; day: string; field: "open" | "close" }
  | { kind: "invalid_closed"; day: string; value: unknown }
  | { kind: "unknown_field"; day: string; field: string };

const weekdaySet: ReadonlySet<string> = new Set(MARKET_WEEKDAYS);
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const dayFields = new Set(["open", "close", "closed"]);

/**
 * Validates a market opening-hours value without a runtime dependency.
 * Empty values are allowed as drafts; publishing readiness is checked apart.
 */
export function validateMarketOpeningHours(
  value: unknown,
): MarketOpeningHoursIssue[] {
  if (value == null) return [];
  if (typeof value !== "object" || Array.isArray(value)) {
    return [{ kind: "not_object" }];
  }

  const issues: MarketOpeningHoursIssue[] = [];
  for (const [day, rawHours] of Object.entries(value)) {
    if (!weekdaySet.has(day)) {
      issues.push({ kind: "unknown_day", day });
      continue;
    }
    if (!rawHours || typeof rawHours !== "object" || Array.isArray(rawHours)) {
      issues.push({ kind: "invalid_day_hours", day });
      continue;
    }

    const hours = rawHours as Record<string, unknown>;
    for (const field of Object.keys(hours)) {
      if (!dayFields.has(field)) {
        issues.push({ kind: "unknown_field", day, field });
      }
    }

    if (Object.hasOwn(hours, "closed") && typeof hours.closed !== "boolean") {
      issues.push({ kind: "invalid_closed", day, value: hours.closed });
    }

    for (const field of ["open", "close"] as const) {
      if (!Object.hasOwn(hours, field)) {
        if (hours.closed !== true)
          issues.push({ kind: "missing_time", day, field });
        continue;
      }
      if (typeof hours[field] !== "string" || !timePattern.test(hours[field])) {
        issues.push({ kind: "invalid_time", day, field, value: hours[field] });
      }
    }
  }

  return issues;
}
