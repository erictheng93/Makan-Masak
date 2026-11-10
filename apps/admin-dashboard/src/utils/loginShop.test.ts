// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRememberedShop,
  currentLoginPath,
  getRememberedShop,
  rememberShop,
} from "./loginShop";
import { loginRouteFor, loginUrlFor } from "./loginRedirect";

describe("loginShop", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("falls back to /login when no shop is remembered", () => {
    expect(currentLoginPath()).toBe("/login");
    expect(loginRouteFor("/dashboard/menu")).toEqual({
      path: "/login",
      query: { redirect: "/dashboard/menu" },
    });
  });

  it("sends logout and session expiry to /s/{slug} once remembered", () => {
    rememberShop("noodle-bar");

    expect(getRememberedShop()).toBe("noodle-bar");
    expect(currentLoginPath()).toBe("/s/noodle-bar");
    expect(loginRouteFor("/dashboard/menu")).toEqual({
      path: "/s/noodle-bar",
      query: { redirect: "/dashboard/menu" },
    });
    expect(loginUrlFor("/dashboard/menu")).toBe(
      "/s/noodle-bar?redirect=%2Fdashboard%2Fmenu",
    );
  });

  it("can be cleared", () => {
    rememberShop("noodle-bar");
    clearRememberedShop();

    expect(getRememberedShop()).toBeNull();
  });

  it("ignores malformed slugs instead of storing them", () => {
    rememberShop("../evil");
    rememberShop(undefined);

    expect(getRememberedShop()).toBeNull();
  });

  it("never throws when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => rememberShop("noodle-bar")).not.toThrow();
    expect(getRememberedShop()).toBeNull();
    expect(currentLoginPath()).toBe("/login");
  });
});
