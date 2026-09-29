// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

// errorHandler.ts calls useToast() at module scope, so the spies must exist
// before the mocked module is first imported.
const { toastError, toastWarning, toastSuccess, toastInfo } = vi.hoisted(
  () => ({
    toastError: vi.fn(),
    toastWarning: vi.fn(),
    toastSuccess: vi.fn(),
    toastInfo: vi.fn(),
  }),
);

vi.mock("vue-toastification", () => ({
  useToast: () => ({
    error: toastError,
    warning: toastWarning,
    success: toastSuccess,
    info: toastInfo,
  }),
}));

vi.mock("@/utils/authTokenProvider", () => ({
  getAuthToken: vi.fn(() => "admin-token"),
  setAuthTokenProvider: vi.fn(),
}));

import { t } from "@/i18n";
import {
  DEDICATED_UI_ERROR_CODES,
  ErrorHandler,
  ErrorSeverity,
  ErrorType,
  KitchenErrorHandler,
  SUBSCRIPTION_ERROR_CODES,
  isDedicatedUiErrorCode,
  extractApiErrorCode,
  isSubscriptionErrorCode,
  setAuthRefreshHandler,
  type SubscriptionErrorCode,
} from "./errorHandler";

// Local builder: mirrors the unified error envelope the API returns —
// { success: false, error: { code, message } } — wrapped in an axios error.
function buildApiError({
  status = 403,
  code,
  message = "Forbidden",
}: {
  status?: number;
  code?: string;
  message?: string;
} = {}) {
  return {
    isAxiosError: true,
    response: {
      status,
      data: {
        success: false,
        error: code === undefined ? message : { code, message },
      },
    },
  };
}

const GENERIC_PERMISSION_MESSAGE = "權限不足或登入已過期";

// Server-side copy from apps/api/src/middleware/moduleGate.ts, so the tests
// prove we do not simply echo the (English-only) server message back.
const SERVER_MESSAGES: Record<SubscriptionErrorCode, string> = {
  SUBSCRIPTION_NOT_FOUND: "Subscription not found. Please contact support.",
  MODULE_NOT_ENABLED: "This feature is not included in your current plan.",
  NO_RESTAURANT: "No restaurant associated with this account",
};

const EXPECTED_I18N_KEYS: Record<SubscriptionErrorCode, string> = {
  SUBSCRIPTION_NOT_FOUND: "errors.subscription.subscriptionNotFound",
  MODULE_NOT_ENABLED: "errors.subscription.moduleNotEnabled",
  NO_RESTAURANT: "errors.subscription.noRestaurant",
};

describe("KitchenErrorHandler.handleAPIError — subscription vs permission 403s", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(SUBSCRIPTION_ERROR_CODES)(
    "reports %s as a subscription problem, not a permissions/session problem",
    (code) => {
      const expectedMessage = t(EXPECTED_I18N_KEYS[code]);

      const details = KitchenErrorHandler.handleAPIError(
        buildApiError({ code, message: SERVER_MESSAGES[code] }),
        { url: "/tables" },
      );

      expect(details).toEqual(
        expect.objectContaining({
          type: ErrorType.SUBSCRIPTION,
          severity: ErrorSeverity.MEDIUM,
          code: 403,
          message: expectedMessage,
        }),
      );

      // The i18n key must actually resolve — t() echoes the key when missing.
      expect(expectedMessage).not.toBe(EXPECTED_I18N_KEYS[code]);
      expect(details.message).not.toBe(GENERIC_PERMISSION_MESSAGE);
      expect(details.message).not.toBe(SERVER_MESSAGES[code]);

      expect(toastError).toHaveBeenCalledOnce();
      expect(toastError).toHaveBeenCalledWith(
        expectedMessage,
        expect.objectContaining({ timeout: expect.any(Number) }),
      );
    },
  );

  it("gives each subscription code its own distinct message", () => {
    const messages = SUBSCRIPTION_ERROR_CODES.map(
      (code) =>
        KitchenErrorHandler.handleAPIError(
          buildApiError({ code, message: SERVER_MESSAGES[code] }),
          { url: "/tables" },
        ).message,
    );

    expect(new Set(messages).size).toBe(SUBSCRIPTION_ERROR_CODES.length);
    expect(messages.every((message) => message.length > 0)).toBe(true);
  });

  it("keeps a plain FORBIDDEN 403 on the existing permission message", () => {
    const details = KitchenErrorHandler.handleAPIError(
      buildApiError({ code: "FORBIDDEN", message: "Access denied" }),
      { url: "/users" },
    );

    expect(details).toEqual(
      expect.objectContaining({
        type: ErrorType.PERMISSION,
        severity: ErrorSeverity.MEDIUM,
        code: 403,
        message: GENERIC_PERMISSION_MESSAGE,
      }),
    );
    expect(toastError).toHaveBeenCalledWith(
      GENERIC_PERMISSION_MESSAGE,
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it("keeps a 401 on the existing permission message", () => {
    const details = KitchenErrorHandler.handleAPIError(
      buildApiError({ status: 401, code: "UNAUTHORIZED", message: "No token" }),
      { url: "/users" },
    );

    expect(details).toEqual(
      expect.objectContaining({
        type: ErrorType.PERMISSION,
        code: 401,
        message: GENERIC_PERMISSION_MESSAGE,
      }),
    );
  });

  it("keeps a codeless 403 on the existing permission message", () => {
    const details = KitchenErrorHandler.handleAPIError(
      buildApiError({ message: "Access denied" }),
      { url: "/users" },
    );

    expect(details).toEqual(
      expect.objectContaining({
        type: ErrorType.PERMISSION,
        message: GENERIC_PERMISSION_MESSAGE,
      }),
    );
  });

  it.each(DEDICATED_UI_ERROR_CODES)(
    "suppresses the global toast for %s because the view owns the recovery UI",
    (code) => {
      const details = KitchenErrorHandler.handleAPIError(
        buildApiError({
          status: 409,
          code,
          message: "Menu item was modified by another user",
        }),
        { url: "/menu/items/11" },
      );

      expect(details).toEqual(
        expect.objectContaining({
          type: ErrorType.API,
          severity: ErrorSeverity.MEDIUM,
          code: 409,
          message: "Menu item was modified by another user",
        }),
      );
      expect(toastError).not.toHaveBeenCalled();
      expect(toastWarning).not.toHaveBeenCalled();
    },
  );

  it("never routes a subscription 403 into the token-refresh / logout path", async () => {
    const refreshHandler = vi.fn(async () => false);
    setAuthRefreshHandler(refreshHandler);
    const handler = new KitchenErrorHandler();

    await expect(
      handler.handleAPIRequest(buildApiError({ code: "MODULE_NOT_ENABLED" }), {
        url: "/tables",
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        type: ErrorType.SUBSCRIPTION,
        message: t("errors.subscription.moduleNotEnabled"),
      }),
    );

    expect(refreshHandler).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/");
  });
});

describe("subscription error code helpers", () => {
  it("recognises only the moduleGate subscription codes", () => {
    for (const code of SUBSCRIPTION_ERROR_CODES) {
      expect(isSubscriptionErrorCode(code)).toBe(true);
    }

    expect(isSubscriptionErrorCode("FORBIDDEN")).toBe(false);
    expect(isSubscriptionErrorCode("UNAUTHORIZED")).toBe(false);
    expect(isSubscriptionErrorCode(undefined)).toBe(false);
    expect(isSubscriptionErrorCode(403)).toBe(false);
  });

  it("reads the code from raw axios errors and from wrapped ErrorDetails", () => {
    const axiosError = buildApiError({ code: "SUBSCRIPTION_NOT_FOUND" });

    expect(extractApiErrorCode(axiosError)).toBe("SUBSCRIPTION_NOT_FOUND");
    expect(extractApiErrorCode({ originalError: axiosError })).toBe(
      "SUBSCRIPTION_NOT_FOUND",
    );
    expect(extractApiErrorCode(buildApiError())).toBeUndefined();
    expect(extractApiErrorCode(undefined)).toBeUndefined();
  });
});

describe("dedicated UI error code helpers", () => {
  it("recognises only error codes with their own visible recovery panel", () => {
    expect(isDedicatedUiErrorCode("MENU_ITEM_MODIFIED")).toBe(true);
    expect(isDedicatedUiErrorCode("FORBIDDEN")).toBe(false);
    expect(isDedicatedUiErrorCode(undefined)).toBe(false);
    expect(isDedicatedUiErrorCode(409)).toBe(false);
  });
});

describe("ErrorHandler — unexpected runtime exceptions", () => {
  it.each([
    new TypeError("Cannot read properties of undefined"),
    new ReferenceError("missingValue is not defined"),
  ])(
    "classifies %s as a critical unknown error with a generic message",
    (error) => {
      const handler = new ErrorHandler();
      handler.setUserNotificationEnabled(false);
      vi.spyOn(handler.reportingService, "reportError").mockResolvedValue();

      expect(handler.handleError(error)).toEqual(
        expect.objectContaining({
          type: ErrorType.UNKNOWN,
          severity: ErrorSeverity.CRITICAL,
          message: "發生了未知錯誤",
        }),
      );
    },
  );
});
