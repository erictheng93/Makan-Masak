import { describe, expect, it } from "vitest";
import { getOpeningHoursStatus, isOpenNow } from "./isOpenNow";

describe("isOpenNow", () => {
  it("keeps missing hours distinct from an explicitly closed day", () => {
    expect(getOpeningHoursStatus(null)).toBe("unavailable");
    expect(getOpeningHoursStatus({})).toBe("unavailable");
    expect(
      getOpeningHoursStatus(
        { monday: { open: "09:00", close: "21:00", isOpen: false } },
        "Asia/Taipei",
        new Date("2026-08-10T04:00:00.000Z"),
      ),
    ).toBe("closed");
  });

  it("returns false during configured hours when the current day is closed", () => {
    const businessHours = {
      monday: { open: "09:00", close: "21:00", isOpen: false },
    };

    expect(
      isOpenNow(
        businessHours,
        "Asia/Taipei",
        new Date("2026-08-10T04:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("continues to support legacy market hours that use closed", () => {
    const businessHours = {
      monday: { open: "09:00", close: "21:00", closed: false },
    };

    expect(
      isOpenNow(
        businessHours,
        "Asia/Taipei",
        new Date("2026-08-10T04:00:00.000Z"),
      ),
    ).toBe(true);
  });

  // The timezone argument existed before #329 and no caller ever passed one,
  // so every shop's opening hours were read off Taipei's clock. A Jakarta
  // stall is an hour behind: at this instant it is 21:30 there and still
  // trading, while Taipei has already turned 22:30.
  it("reads the hours off the shop's own clock, not Taipei's", () => {
    const businessHours = {
      monday: { open: "09:00", close: "22:00", isOpen: true },
    };
    const instant = new Date("2026-08-10T14:30:00.000Z");

    expect(isOpenNow(businessHours, "Asia/Jakarta", instant)).toBe(true);
    expect(isOpenNow(businessHours, "Asia/Taipei", instant)).toBe(false);
    expect(isOpenNow(businessHours, "Asia/Tokyo", instant)).toBe(false);
  });

  // Intl throws a RangeError on a name it does not know, and one hand-edited
  // row must not take a whole discovery listing down with it.
  it("falls back to the default zone instead of throwing on an unknown one", () => {
    const businessHours = {
      monday: { open: "09:00", close: "21:00", isOpen: true },
    };
    const instant = new Date("2026-08-10T04:00:00.000Z");

    expect(isOpenNow(businessHours, "Not/AZone", instant)).toBe(true);
    expect(isOpenNow(businessHours, null, instant)).toBe(true);
    expect(isOpenNow(businessHours, undefined, instant)).toBe(true);
  });
});
