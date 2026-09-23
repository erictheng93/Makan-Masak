import { z } from "zod";
import {
  validateMarketOpeningHours,
  type MarketOpeningHours,
} from "@makanmasak/shared/utils/market-opening-hours";

// Both spellings are already used by market clients. Keep the API's Zod
// boundary while sharing the actual contract with browser-side validation.
export const marketOpeningHoursSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    // Nullish values are accepted by the optional/nullable wrapper at the
    // write sites, but the shared contract itself requires an object.
    if (value == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: "not_object",
      });
      return;
    }
    for (const issue of validateMarketOpeningHours(value)) {
      const path =
        issue.kind === "unknown_day"
          ? [issue.day]
          : issue.kind === "not_object"
            ? []
            : issue.kind === "invalid_day_hours"
              ? [issue.day]
              : issue.kind === "invalid_time" || issue.kind === "missing_time"
                ? [issue.day, issue.field]
                : issue.kind === "invalid_closed"
                  ? [issue.day, "closed"]
                  : [issue.day, issue.field];
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path,
        message: issue.kind,
      });
    }
  })
  .transform((value) => normalizeClosedDays(value as MarketOpeningHours));

function normalizeClosedDays(value: MarketOpeningHours): MarketOpeningHours {
  return Object.fromEntries(
    Object.entries(value).map(([day, hours]) => [
      day,
      hours?.closed === true
        ? {
            ...hours,
            open: hours.open ?? "00:00",
            close: hours.close ?? "00:00",
          }
        : hours,
    ]),
  ) as MarketOpeningHours;
}
