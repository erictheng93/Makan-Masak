import { describe, expect, it } from "vitest";
import {
  isModuleNotEnabled,
  moduleUnavailableI18nKey,
} from "@/utils/module-unavailable";

describe("module unavailable mapping", () => {
  it("recognises the code on the API client's exception and on a raw axios error", () => {
    expect(
      isModuleNotEnabled({ code: "MODULE_NOT_ENABLED", status: 403 }),
    ).toBe(true);
    expect(
      isModuleNotEnabled({
        response: {
          status: 403,
          data: { error: { code: "MODULE_NOT_ENABLED" } },
        },
      }),
    ).toBe(true);
    expect(isModuleNotEnabled({ code: "FORBIDDEN", status: 403 })).toBe(false);
    expect(isModuleNotEnabled(new Error("x"))).toBe(false);
  });

  it("gives each feature its own message key", () => {
    expect(moduleUnavailableI18nKey("reservation")).toBe(
      "toast.orderSubmitModuleReservation",
    );
    expect(moduleUnavailableI18nKey("serviceBooking")).toBe(
      "toast.orderSubmitModuleServiceBooking",
    );
    expect(moduleUnavailableI18nKey("waitingList")).toBe(
      "toast.orderSubmitModuleWaitingList",
    );
    expect(moduleUnavailableI18nKey("coupon")).toBe(
      "toast.couponModuleDisabled",
    );
  });
});
