import { describe, expect, it, vi } from "vitest";
import {
  loginRouteFor,
  loginUrlFor,
  readLoginRedirect,
  redirectToKitchenDisplay,
  sanitizeLoginRedirect,
} from "./loginRedirect";

it("replaces the admin page with the kitchen display URL", () => {
  const location = { replace: vi.fn() };
  redirectToKitchenDisplay("https://kitchen.example.test", location);
  expect(location.replace).toHaveBeenCalledExactlyOnceWith(
    "https://kitchen.example.test",
  );
});

describe("sanitizeLoginRedirect", () => {
  it("keeps an in-app absolute path with its query string", () => {
    expect(sanitizeLoginRedirect("/dashboard/monitoring?tab=alerts")).toBe(
      "/dashboard/monitoring?tab=alerts",
    );
  });

  it.each([
    ["a full URL", "https://evil.example/steal"],
    ["a protocol-relative URL", "//evil.example/steal"],
    ["a backslash-normalised URL", "/\\evil.example/steal"],
    ["a relative path", "dashboard/monitoring"],
    ["an empty string", ""],
  ])("drops %s", (_label, target) => {
    expect(sanitizeLoginRedirect(target)).toBeNull();
  });

  it("drops the login page itself so re-authentication cannot loop", () => {
    expect(sanitizeLoginRedirect("/login")).toBeNull();
    expect(sanitizeLoginRedirect("/login?redirect=/dashboard")).toBeNull();
  });

  it("drops non-string input", () => {
    expect(sanitizeLoginRedirect(undefined)).toBeNull();
    expect(sanitizeLoginRedirect(42)).toBeNull();
  });
});

describe("readLoginRedirect", () => {
  it("unwraps a repeated query parameter", () => {
    expect(readLoginRedirect(["/dashboard/monitoring", "/other"])).toBe(
      "/dashboard/monitoring",
    );
  });

  it("returns null when the query parameter is absent", () => {
    expect(readLoginRedirect(undefined)).toBeNull();
  });
});

describe("loginRouteFor", () => {
  it("carries the interrupted destination", () => {
    expect(loginRouteFor("/dashboard/monitoring")).toEqual({
      path: "/login",
      query: { redirect: "/dashboard/monitoring" },
    });
  });

  it("omits the query when the destination is not safe to keep", () => {
    expect(loginRouteFor("https://evil.example")).toEqual({ path: "/login" });
  });
});

describe("loginUrlFor", () => {
  it("percent-encodes the destination", () => {
    expect(loginUrlFor("/dashboard/monitoring?tab=alerts")).toBe(
      "/login?redirect=%2Fdashboard%2Fmonitoring%3Ftab%3Dalerts",
    );
  });

  it("falls back to a bare login URL", () => {
    expect(loginUrlFor("//evil.example")).toBe("/login");
  });
});
