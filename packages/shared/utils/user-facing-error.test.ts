import { describe, expect, it } from "vitest";
import {
  ERROR_PRESENTATION_KEYS,
  resolveUserFacingError,
} from "./user-facing-error";
import enUS from "../src/i18n/src/locales/en-US/common.json";
import idID from "../src/i18n/src/locales/id-ID/common.json";
import msMY from "../src/i18n/src/locales/ms-MY/common.json";
import viVN from "../src/i18n/src/locales/vi-VN/common.json";
import zhCN from "../src/i18n/src/locales/zh-CN/common.json";
import zhTW from "../src/i18n/src/locales/zh-TW/common.json";

const translations: Record<string, string> = {
  "errorPresentation.invalidRequest": "請檢查輸入內容後再試一次",
  "errorPresentation.sessionExpired": "登入狀態已失效，請重新登入",
  "errorPresentation.permissionDenied": "你沒有執行此操作的權限",
  "errorPresentation.notFound": "找不到要求的資源",
  "errorPresentation.conflict": "目前狀態不允許此操作，請重新整理後再試",
  "errorPresentation.tooManyRequests": "操作過於頻繁，請稍後再試",
  "errorPresentation.serviceUnavailable": "系統暫時無法處理，請稍後再試",
  "errorPresentation.network": "網路連線發生問題，請檢查後再試",
  "errorPresentation.timeout": "連線逾時，請再試一次",
  "errorPresentation.unknown": "發生未知錯誤，請稍後再試",
  "errors.menuItemUnavailable": "餐點目前無法供應",
  "feedback.submitError": "提交意見回饋失敗",
  "login.invalidCredentials": "用戶名稱或密碼不正確",
};

const translate = (key: string) => translations[key] ?? key;

describe("resolveUserFacingError", () => {
  it("requires every shared fallback key in every supported common catalog", () => {
    const catalogs = [enUS, zhTW, zhCN, msMY, idID, viVN];

    for (const catalog of catalogs) {
      for (const key of ERROR_PRESENTATION_KEYS) {
        const value = key.split(".").reduce<unknown>((current, segment) => {
          if (!current || typeof current !== "object") return undefined;
          return (current as Record<string, unknown>)[segment];
        }, catalog);
        expect(value, key).toEqual(expect.any(String));
      }
    }
  });

  it("uses a translated actionable code and never returns the server message", () => {
    const result = resolveUserFacingError(
      {
        response: {
          status: 409,
          data: {
            success: false,
            error: {
              code: "MENU_ITEM_UNAVAILABLE",
              message: "Menu item 101 is not available",
              requestId: "req-123",
            },
          },
        },
      },
      translate,
      { codeKeys: { MENU_ITEM_UNAVAILABLE: "errors.menuItemUnavailable" } },
    );

    expect(result).toEqual({
      code: "MENU_ITEM_UNAVAILABLE",
      requestId: "req-123",
      message: "餐點目前無法供應",
      presentation: "code",
    });
    expect(result.message).not.toContain("Menu item");
  });

  it("uses a localized HTTP-status fallback for an unknown English server message", () => {
    const result = resolveUserFacingError(
      {
        response: {
          status: 401,
          data: { error: "Invalid username or password" },
        },
      },
      translate,
    );

    expect(result.message).toBe("登入狀態已失效，請重新登入");
    expect(result.presentation).toBe("status");
    expect(result.message).not.toContain("Invalid username");
  });

  /**
   * The invariant the whole design rests on, asserted structurally rather than
   * per-case: every message the resolver returns has to be something the
   * translator produced. A per-case `not.toContain("…")` only guards the paths
   * someone remembered to write a case for -- adding a server-message fallback
   * to the terminal `unknown` branch passed all of those, because none of them
   * reached it with a message present.
   */
  it("only ever returns a string the translator produced", () => {
    const produced = new Set<string>();
    const spy = (key: string) => {
      const value = translations[key] ?? key;
      produced.add(value);
      return value;
    };

    const leakyMessage = "Internal detail: table_foo is missing";
    const cases: unknown[] = [
      // Status not in the map and not 5xx -- the terminal unknown branch.
      { response: { status: 418, data: { error: { message: leakyMessage } } } },
      // No status at all.
      { response: { data: { error: { message: leakyMessage } } } },
      // Legacy bare-string body, still unmigrated on some routes.
      { response: { status: 499, data: { error: leakyMessage } } },
      // A code with no mapping supplied by the caller.
      {
        response: {
          status: 400,
          data: {
            error: { code: "SOME_UNMAPPED_CODE", message: leakyMessage },
          },
        },
      },
      // Nothing recognisable whatsoever.
      { message: leakyMessage },
      new Error(leakyMessage),
      "a thrown string",
      undefined,
      // Reaches the branch that appends a reference, so this test covers the
      // one place the returned string is not verbatim translator output.
      {
        response: {
          status: 503,
          data: {
            error: {
              code: "SOME_UNMAPPED_CODE",
              requestId: "req_1",
              message: leakyMessage,
            },
          },
        },
      },
    ];

    // The only addition the resolver is allowed to make: a bracketed request id
    // or error code. Stripped here so the check below still means "everything
    // else came from the translator".
    const stripReference = (message: string) =>
      message.replace(/ \[[A-Za-z0-9_-]+\]$/, "");

    for (const error of cases) {
      const result = resolveUserFacingError(error, spy, {
        codeKeys: { MENU_ITEM_UNAVAILABLE: "errors.menuItemUnavailable" },
      });
      expect(
        produced.has(stripReference(result.message)),
        JSON.stringify(error),
      ).toBe(true);
      expect(result.message).not.toContain("table_foo");
      expect(result.message).not.toContain("thrown string");
    }
  });

  it("falls back to the localized unknown copy for an unmapped 4xx", () => {
    const result = resolveUserFacingError(
      {
        response: {
          status: 418,
          data: { error: { message: "Internal detail: table_foo is missing" } },
        },
      },
      translate,
    );

    expect(result.message).toBe("發生未知錯誤，請稍後再試");
    expect(result.presentation).toBe("unknown");
  });

  it("names the failed action instead of the generic unknown copy", () => {
    const result = resolveUserFacingError(
      {
        response: {
          status: 418,
          data: { error: { message: "Internal detail: table_foo is missing" } },
        },
      },
      translate,
      { fallbackKey: "feedback.submitError" },
    );

    expect(result.message).toBe("提交意見回饋失敗");
    expect(result.presentation).toBe("unknown");
  });

  /**
   * The action name is the weakest thing the resolver can say -- it reports
   * what the reader already knows they were doing. Anything classified says
   * more, so `fallbackKey` must not outrank it.
   */
  it("leaves a classified error alone even when an action name is supplied", () => {
    const result = resolveUserFacingError(
      { response: { status: 403, data: { error: { code: "FORBIDDEN" } } } },
      translate,
      { fallbackKey: "feedback.submitError" },
    );

    expect(result.message).toBe("你沒有執行此操作的權限");
    expect(result.presentation).toBe("status");
  });

  /**
   * The shared 401 copy tells the reader to sign in again. On the sign-in form
   * that is the one thing they are already doing.
   */
  it("tells the user to sign in again on a CSRF 403, not that they lack permission", () => {
    const result = resolveUserFacingError(
      {
        response: {
          status: 403,
          data: { success: false, error: { code: "CSRF_TOKEN_INVALID" } },
        },
      },
      translate,
    );

    expect(result.message).toBe("登入狀態已失效，請重新登入");
  });

  it("lets a screen override the copy for a status", () => {
    const result = resolveUserFacingError(
      { response: { status: 401, data: {} } },
      translate,
      { statusKeys: { 401: "login.invalidCredentials" } },
    );

    expect(result.message).toBe("用戶名稱或密碼不正確");
    expect(result.presentation).toBe("status");
  });

  it("still uses the shared copy for statuses the screen did not override", () => {
    const result = resolveUserFacingError(
      { response: { status: 429, data: {} } },
      translate,
      { statusKeys: { 401: "login.invalidCredentials" } },
    );

    expect(result.message).toBe("操作過於頻繁，請稍後再試");
  });

  it("appends something reportable when the copy describes nothing", () => {
    const result = resolveUserFacingError(
      {
        response: {
          status: 500,
          data: { error: { code: "D1_ERROR", requestId: "req_7f3a" } },
        },
      },
      translate,
    );

    expect(result.message).toBe("系統暫時無法處理，請稍後再試 [req_7f3a]");
  });

  it("falls back to the code when there is no request id", () => {
    const result = resolveUserFacingError(
      { response: { status: 418, data: { error: { code: "TEAPOT" } } } },
      translate,
      { fallbackKey: "feedback.submitError" },
    );

    expect(result.message).toBe("提交意見回饋失敗 [TEAPOT]");
  });

  /**
   * A 403 already names its own cause, so the identifier would be noise on
   * every permission check. It is only worth showing where the copy is silent.
   */
  it("leaves copy that already explains itself alone", () => {
    const result = resolveUserFacingError(
      {
        response: {
          status: 403,
          data: { error: { code: "FORBIDDEN", requestId: "req_7f3a" } },
        },
      },
      translate,
    );

    expect(result.message).toBe("你沒有執行此操作的權限");
  });

  it("classifies transport failures without using the thrown English message", () => {
    const result = resolveUserFacingError(
      { code: "ECONNABORTED", message: "timeout of 10000ms exceeded" },
      translate,
    );

    expect(result).toMatchObject({
      code: "ECONNABORTED",
      message: "連線逾時，請再試一次",
      presentation: "network",
    });
  });
});
