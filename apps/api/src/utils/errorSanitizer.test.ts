import { describe, expect, it } from "vitest";
import { ErrorSanitizer } from "./errorSanitizer";

describe("ErrorSanitizer.sanitizeMessage", () => {
  it("never passes a failed SQL statement or its bound values to the client", () => {
    const message =
      'Failed query: delete from "cash_registers" where "cash_registers"."id" = ?\nparams: 01a0f3e8-1e3f-72f7-91d0-f32e1a7623dd';

    const sanitized = ErrorSanitizer.sanitizeMessage(message);

    expect(sanitized).toBe("Database operation failed");
    expect(sanitized).not.toContain("cash_registers");
    expect(sanitized).not.toContain("01a0f3e8");
  });

  it("keeps an ordinary message intact", () => {
    expect(ErrorSanitizer.sanitizeMessage("Coupon not found")).toBe(
      "Coupon not found",
    );
  });
});
