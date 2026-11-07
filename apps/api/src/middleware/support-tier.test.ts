import { describe, expect, it } from "vitest";
import { isSupportTierAllowed } from "./auth";

describe("isSupportTierAllowed", () => {
  it("allows reads", () => {
    expect(isSupportTierAllowed("GET", "/api/v1/restaurants")).toBe(true);
    expect(isSupportTierAllowed("head", "/api/v1/users")).toBe(true);
  });

  it("allows only own-session writes and shop password resets", () => {
    expect(isSupportTierAllowed("POST", "/api/v1/auth/logout")).toBe(true);
    expect(isSupportTierAllowed("POST", "/api/v1/auth/refresh")).toBe(true);
    expect(
      isSupportTierAllowed("POST", "/api/v1/users/abc/reset-password"),
    ).toBe(true);
  });

  it("refuses every other write", () => {
    expect(isSupportTierAllowed("POST", "/api/v1/auth/register-staff")).toBe(
      false,
    );
    expect(isSupportTierAllowed("POST", "/api/v1/users")).toBe(false);
    expect(isSupportTierAllowed("PATCH", "/api/v1/users/abc/role")).toBe(false);
    expect(isSupportTierAllowed("DELETE", "/api/v1/menu/r1/items/1")).toBe(
      false,
    );
    expect(
      isSupportTierAllowed("POST", "/api/v1/users/abc/reset-password/x"),
    ).toBe(false);
  });
});
