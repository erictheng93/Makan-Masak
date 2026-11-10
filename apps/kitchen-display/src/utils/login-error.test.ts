import { describe, expect, it } from "vitest";
import { resolveKitchenLoginError } from "./login-error";

const translate = (key: string) => key;

/**
 * `authApi.login` rethrows the axios error untouched, so what arrives here is
 * the response itself. These are the shapes it actually takes.
 */
describe("kitchen login error copy", () => {
  const rejected = (status: number, code?: string) => ({
    response: {
      status,
      data: {
        success: false,
        error: {
          message: "Invalid username or password",
          ...(code && { code }),
        },
      },
    },
  });

  it("points SHOP_REQUIRED at the shop's login link", () => {
    expect(
      resolveKitchenLoginError(rejected(400, "SHOP_REQUIRED"), translate),
    ).toBe("login.shopRequired");
  });

  it("separates a locked account from a wrong password", () => {
    expect(
      resolveKitchenLoginError(rejected(401, "ACCOUNT_LOCKED"), translate),
    ).toBe("login.accountLocked");
    expect(
      resolveKitchenLoginError(rejected(401, "INVALID_CREDENTIALS"), translate),
    ).toBe("login.invalidCredentials");
  });

  /**
   * The shared 401 copy asks the reader to sign in again, which is what they
   * are doing. A login form has to override it.
   */
  it("does not tell someone at the login form that their session expired", () => {
    expect(resolveKitchenLoginError(rejected(401), translate)).toBe(
      "login.invalidCredentials",
    );
  });

  /**
   * Without this the form would answer "that password is not correct" while the
   * request never left the browser.
   */
  it("says the network failed when the request never reached the server", () => {
    expect(
      resolveKitchenLoginError(
        { code: "ERR_NETWORK", message: "Network Error", request: {} },
        translate,
      ),
    ).toBe("errorPresentation.network");
  });

  it("names the action rather than answering 'unknown' when nothing classifies", () => {
    expect(resolveKitchenLoginError(new Error("boom"), translate)).toBe(
      "login.loginError",
    );
  });

  it("never returns the server's sentence", () => {
    for (const error of [
      rejected(401),
      rejected(500, "D1_ERROR"),
      new Error("x"),
    ]) {
      expect(resolveKitchenLoginError(error, translate)).not.toContain(
        "Invalid username or password",
      );
    }
  });
});
