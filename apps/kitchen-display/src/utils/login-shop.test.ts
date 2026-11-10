import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearRememberedShop,
  getRememberedShop,
  isLoginPath,
  loginPath,
  rememberShop,
} from "./login-shop";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("remembered login shop", () => {
  it("falls back to /login until a shop is remembered", () => {
    expect(loginPath()).toBe("/login");
    rememberShop("my-shop");
    expect(loginPath()).toBe("/s/my-shop");
  });

  it("can be cleared", () => {
    rememberShop("my-shop");
    clearRememberedShop();
    expect(getRememberedShop()).toBeNull();
    expect(loginPath()).toBe("/login");
  });

  it("ignores a stored value that is not a valid slug", () => {
    localStorage.setItem("mm_kitchen_login_shop", "../evil");
    expect(getRememberedShop()).toBeNull();
  });

  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(getRememberedShop()).toBeNull();
    expect(() => rememberShop("my-shop")).not.toThrow();
    expect(loginPath()).toBe("/login");
  });

  it("treats /login and /s/* as login pages", () => {
    expect(isLoginPath("/login")).toBe(true);
    expect(isLoginPath("/s/my-shop")).toBe(true);
    expect(isLoginPath("/kitchen/1")).toBe(false);
  });
});
