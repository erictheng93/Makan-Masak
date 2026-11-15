import { describe, expect, it } from "vitest";
import { resolveAdminUserFacingError } from "./userFacingError";

const t = (key: string) => `translated:${key}`;

describe("resolveAdminUserFacingError", () => {
  it("uses localized status copy instead of an API error message", () => {
    expect(
      resolveAdminUserFacingError(
        {
          response: {
            status: 500,
            data: { error: { message: "English server prose" } },
          },
        },
        t,
        "menu.errors.saveFailed",
      ),
    ).toBe("translated:errorPresentation.serviceUnavailable");
  });

  it("keeps the caller's localized fallback for malformed errors", () => {
    expect(resolveAdminUserFacingError(new Error("server prose"), t, "x")).toBe(
      "translated:x",
    );
  });

  it("names the quota instead of calling a plan limit rate limiting", () => {
    const error = (meterKey: string) => ({
      response: {
        status: 429,
        data: {
          error: { code: "QUOTA_EXCEEDED", details: { meterKey } },
        },
      },
    });

    expect(resolveAdminUserFacingError(error("orders.created"), t, "x")).toBe(
      "translated:errors.quota.orders",
    );
    expect(resolveAdminUserFacingError(error("print.jobs"), t, "x")).toBe(
      "translated:errors.quota.print",
    );
    expect(resolveAdminUserFacingError(error("other"), t, "x")).toBe(
      "translated:errors.quota.generic",
    );
  });
});
