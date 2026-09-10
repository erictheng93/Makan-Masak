import { describe, expect, it } from "vitest";
import { getOrderSubmitErrorI18nKey } from "@/utils/order-submit-error";

describe("getOrderSubmitErrorI18nKey", () => {
  it("localizes active guest order conflicts from API error codes", () => {
    expect(
      getOrderSubmitErrorI18nKey({
        code: "ACTIVE_GUEST_ORDER_EXISTS",
        message:
          "You already have an active order at this restaurant. Please wait for it to complete.",
        status: 429,
      }),
    ).toBe("toast.orderSubmitActiveGuestOrder");
  });

  it("reads nested API response error codes", () => {
    expect(
      getOrderSubmitErrorI18nKey({
        response: {
          status: 409,
          data: {
            error: {
              code: "CLIENT_MUTATION_DUPLICATE",
              message: "Client mutation has already been processed",
            },
          },
        },
      }),
    ).toBe("toast.orderSubmitDuplicate");
  });

  it("maps table QR error families without exposing server text", () => {
    expect(
      getOrderSubmitErrorI18nKey({
        code: "TABLE_QR_SIGNATURE_INVALID",
        message: "Signature verification failed",
      }),
    ).toBe("toast.orderSubmitQrInvalid");
  });

  it("maps menu unavailable codes from shared API and order services", () => {
    expect(
      getOrderSubmitErrorI18nKey({
        response: {
          status: 409,
          data: {
            success: false,
            error: {
              code: "MENU_ITEM_NOT_AVAILABLE",
              message: "Menu item is not available",
            },
          },
        },
      }),
    ).toBe("toast.orderSubmitMenuItemUnavailable");

    expect(
      getOrderSubmitErrorI18nKey({
        response: {
          status: 409,
          data: {
            error: {
              code: "MENU_ITEM_UNAVAILABLE",
              message: "Menu item 101 is not available",
            },
          },
        },
      }),
    ).toBe("toast.orderSubmitMenuItemUnavailable");
  });

  it("does not classify menu availability from English server prose", () => {
    expect(
      getOrderSubmitErrorI18nKey(new Error("Menu item 101 is not available")),
    ).toBe("errorPresentation.unknown");

    expect(
      getOrderSubmitErrorI18nKey(
        new Error("Insufficient inventory for Nasi Lemak"),
      ),
    ).toBe("errorPresentation.unknown");
  });

  it("falls back to a status key instead of matching English server prose", () => {
    expect(
      getOrderSubmitErrorI18nKey({
        response: {
          status: 503,
          data: { error: "Restaurant is currently unavailable" },
        },
      }),
    ).toBe("errorPresentation.serviceUnavailable");
  });

  it("maps order service availability codes", () => {
    expect(
      getOrderSubmitErrorI18nKey({
        response: {
          status: 400,
          data: {
            error: {
              code: "RESTAURANT_CLOSED",
              message: "Restaurant is not accepting orders",
            },
          },
        },
      }),
    ).toBe("toast.orderSubmitRestaurantUnavailable");

    expect(
      getOrderSubmitErrorI18nKey({
        response: {
          status: 400,
          data: {
            error: {
              code: "TABLE_NOT_AVAILABLE",
              message: "Table is not available",
            },
          },
        },
      }),
    ).toBe("toast.orderSubmitTableUnavailable");
  });

  // #352 changed these three from a 500 GENERIC_ERROR into real codes. Without
  // registry entries the customer would keep seeing "unknown error" for a
  // rejection the server can now name precisely.
  it.each([
    ["RESTAURANT_UNAVAILABLE", 409, "toast.orderSubmitRestaurantUnavailable"],
    ["TABLE_UNAVAILABLE", 409, "toast.orderSubmitTableUnavailable"],
    ["COUPON_INVALID", 400, "toast.couponFailed"],
  ])(
    "maps the createOrder rejection %s to its own toast",
    (code, status, key) => {
      expect(
        getOrderSubmitErrorI18nKey({
          response: {
            status,
            data: { error: { code, message: "server text, never displayed" } },
          },
        }),
      ).toBe(key);
    },
  );

  it("falls back to the shared unknown key instead of server messages", () => {
    expect(
      getOrderSubmitErrorI18nKey(
        new Error("Unexpected backend implementation detail"),
      ),
    ).toBe("errorPresentation.unknown");
  });
});
