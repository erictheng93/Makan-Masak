import { describe, expect, it } from "vitest";
import {
  DEFAULT_MARKET_BUSINESS_DAY_CUTOFF_MINUTES,
  getMarketBusinessDate,
  isMarketVendorOpenToday,
  marketBusinessDateCacheKey,
  marketBusinessDayEndMs,
  marketBusinessDayStartMs,
} from "./market-business-day";

const TAIPEI = 8 * 60;
const HO_CHI_MINH = 7 * 60;
const CUTOFF = DEFAULT_MARKET_BUSINESS_DAY_CUTOFF_MINUTES;

function local(isoLocal: string, offsetMinutes: number) {
  return new Date(Date.parse(`${isoLocal}Z`) - offsetMinutes * 60_000);
}

describe("getMarketBusinessDate", () => {
  it("keeps the small hours on the previous business day until the cutoff", () => {
    expect(
      getMarketBusinessDate(TAIPEI, CUTOFF, local("2026-09-29T04:59", TAIPEI)),
    ).toBe("2026-09-28");
    expect(
      getMarketBusinessDate(TAIPEI, CUTOFF, local("2026-09-29T05:00", TAIPEI)),
    ).toBe("2026-09-29");
  });

  it("rolls over at midnight when the cutoff is 0", () => {
    expect(
      getMarketBusinessDate(TAIPEI, 0, local("2026-09-28T23:59", TAIPEI)),
    ).toBe("2026-09-28");
    expect(
      getMarketBusinessDate(TAIPEI, 0, local("2026-09-29T00:00", TAIPEI)),
    ).toBe("2026-09-29");
  });

  it("uses the stall's own offset", () => {
    const at = new Date("2026-09-28T21:30:00Z");
    expect(getMarketBusinessDate(HO_CHI_MINH, CUTOFF, at)).toBe("2026-09-28");
    expect(getMarketBusinessDate(TAIPEI, CUTOFF, at)).toBe("2026-09-29");
  });
});

describe("isMarketVendorOpenToday", () => {
  it("is closed when the stall never opened", () => {
    expect(isMarketVendorOpenToday(null, TAIPEI, CUTOFF)).toBe(false);
    expect(isMarketVendorOpenToday(undefined, TAIPEI, CUTOFF)).toBe(false);
  });

  it("stays open across midnight for a night market", () => {
    const openedAt = local("2026-09-28T23:00", TAIPEI);
    expect(
      isMarketVendorOpenToday(
        openedAt,
        TAIPEI,
        CUTOFF,
        local("2026-09-29T01:00", TAIPEI),
      ),
    ).toBe(true);
  });

  it("closes by itself at the cutoff", () => {
    const openedAt = local("2026-09-28T17:00", TAIPEI);
    expect(
      isMarketVendorOpenToday(
        openedAt,
        TAIPEI,
        CUTOFF,
        local("2026-09-29T05:00", TAIPEI),
      ),
    ).toBe(false);
  });
});

describe("business day bounds", () => {
  it("starts at the cutoff and lasts 24 hours", () => {
    const start = marketBusinessDayStartMs("2026-09-28", TAIPEI, CUTOFF);
    expect(new Date(start).toISOString()).toBe("2026-09-27T21:00:00.000Z");
    expect(marketBusinessDayEndMs("2026-09-28", TAIPEI, CUTOFF)).toBe(
      start + 86_400_000,
    );
  });
});

describe("marketBusinessDateCacheKey", () => {
  it("changes when any supported zone crosses the cutoff", () => {
    expect(
      marketBusinessDateCacheKey(CUTOFF, new Date("2026-09-28T20:59:00Z")),
    ).not.toBe(
      marketBusinessDateCacheKey(CUTOFF, new Date("2026-09-28T21:59:00Z")),
    );
  });

  it("is stable within the same business day everywhere", () => {
    expect(
      marketBusinessDateCacheKey(CUTOFF, new Date("2026-09-28T09:00:00Z")),
    ).toBe(
      marketBusinessDateCacheKey(CUTOFF, new Date("2026-09-28T10:00:00Z")),
    );
  });
});
