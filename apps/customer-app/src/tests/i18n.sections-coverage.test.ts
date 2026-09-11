/**
 * Module integration test: exercises interaction between i18n module and locale
 * consistency checker across all supported languages. This is NOT an end-to-end
 * API integration test — it does not hit routes or D1.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  i18n,
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  switchLanguage,
} from "@/i18n";
import type { SupportedLanguage } from "@/i18n";

// Helper to avoid TS2589

type I18nGlobal = {
  t: (key: string, params?: Record<string, unknown>) => string;
  getLocaleMessage: (locale: SupportedLanguage) => Record<string, unknown>;
};

const testI18n = i18n.global as unknown as I18nGlobal;

const tGlobal = (key: string, params?: Record<string, unknown>): string =>
  params ? testI18n.t(key, params) : testI18n.t(key);

const ALL_LOCALES: SupportedLanguage[] = [
  "zh-TW",
  "zh-CN",
  "en-US",
  "vi-VN",
  "ms-MY",
  "id-ID",
];

/**
 * Helper: assert a list of keys exist and are non-empty in all 6 locales.
 */
function assertKeysInAllLocales(keys: string[]) {
  ALL_LOCALES.forEach((locale) => {
    const localeMessages = testI18n.getLocaleMessage(locale);

    keys.forEach((key) => {
      const val = getNestedMessage(localeMessages, key);
      expect(val, `${key} missing in ${locale}`).not.toBe(key);
      expect(val, `${key} empty in ${locale}`).toBeTruthy();
    });
  });
}

function getNestedMessage(
  messages: Record<string, unknown>,
  key: string,
): unknown {
  return key.split(".").reduce<unknown>((current, segment) => {
    if (current && typeof current === "object" && segment in current) {
      return (current as Record<string, unknown>)[segment];
    }

    return undefined;
  }, messages);
}

describe("i18n Integration Tests", () => {
  beforeEach(() => {
    i18n.global.locale.value = DEFAULT_LANGUAGE;
  });

  // ---------------------------------------------------------------
  // 1. Auth Section
  // ---------------------------------------------------------------
  describe("Auth Section", () => {
    const authKeys = [
      "auth.login",
      "auth.register",
      "auth.memberLogin",
      "auth.memberRegister",
      "auth.username",
      "auth.password",
      "auth.displayName",
      "auth.email",
      "auth.phone",
      "auth.usernamePlaceholder",
      "auth.passwordPlaceholder",
      "auth.passwordPlaceholderWithMin",
      "auth.displayNamePlaceholder",
      "auth.emailPlaceholder",
      "auth.phonePlaceholder",
      "auth.confirmPassword",
      "auth.confirmPasswordPlaceholder",
      "auth.noAccount",
      "auth.hasAccount",
      "auth.registerNow",
      "auth.loginNow",
      "auth.guestBrowse",
      "auth.loggingIn",
      "auth.registering",
      "auth.loginFailed",
      "auth.loginError",
      "auth.registerFailed",
      "auth.registerError",
      "auth.usernameRequired",
      "auth.usernameMinLength",
      "auth.passwordRequired",
      "auth.passwordMinLength",
      "auth.displayNameRequired",
      "auth.confirmPasswordRequired",
      "auth.passwordMismatch",
      "auth.invalidEmail",
      "auth.invalidPhone",
      // Password sign-in, registration and the three mail-driven screens.
      "auth.tabOtp",
      "auth.tabPassword",
      "auth.otp",
      "auth.otpPlaceholder",
      "auth.requestOtp",
      "auth.phoneRequired",
      "auth.otpRequired",
      "auth.identifier",
      "auth.identifierPlaceholder",
      "auth.identifierRequired",
      "auth.forgotPassword",
      "auth.backToLogin",
      "auth.goToLogin",
      "auth.verificationEmailSentTitle",
      "auth.verificationEmailSentDesc",
      "auth.verificationEmailFailedTitle",
      "auth.verificationEmailFailedDesc",
      "auth.resendVerification",
      "auth.resendVerificationSending",
      "auth.resendVerificationSent",
      "auth.resendVerificationFailed",
      "auth.forgotPasswordTitle",
      "auth.forgotPasswordHint",
      "auth.forgotPasswordSubmit",
      "auth.forgotPasswordSent",
      // Phone resets answer with an SMS code, not a mail link (#353).
      "auth.forgotPasswordOtpSent",
      "auth.forgotPasswordOtpHint",
      "auth.forgotPasswordOtpInvalid",
      "auth.forgotPasswordVerifyOtp",
      "auth.resetPasswordTitle",
      "auth.resetPasswordHint",
      "auth.newPassword",
      "auth.enterNewPassword",
      "auth.confirmNewPassword",
      "auth.resetPasswordSubmit",
      "auth.resetPasswordSuccess",
      "auth.verifyEmailTitle",
      "auth.verifyEmailPending",
      "auth.verifyEmailSuccess",
      "auth.linkTokenMissing",
      "auth.otpSentForRegistration",
    ];

    it("should have all auth keys in all 6 locales", () => {
      assertKeysInAllLocales(authKeys);
    });

    it("should translate auth.login correctly", () => {
      switchLanguage("zh-TW");
      expect(tGlobal("auth.login")).toBe("登入");
      switchLanguage("en-US");
      expect(tGlobal("auth.login")).toBe("Login");
    });

    it("should translate auth.memberLogin correctly", () => {
      switchLanguage("zh-TW");
      expect(tGlobal("auth.memberLogin")).toBe("會員登入");
      switchLanguage("en-US");
      expect(tGlobal("auth.memberLogin")).toBe("Member Login");
    });
  });

  // ---------------------------------------------------------------
  // 2. Toast Section
  // ---------------------------------------------------------------
  describe("Toast Section", () => {
    const toastKeys = [
      "toast.orderSubmitSuccess",
      "toast.orderSubmitFailed",
      // Reached only through the order-submit code registry, so a locale that
      // forgot it would surface as a raw key in a toast rather than a build
      // failure (#352).
      "toast.orderSubmitBelowMinimum",
      "toast.cartCannotBeEmpty",
      "toast.scanSuccess",
      "toast.cameraInitFailed",
      "toast.flashToggleFailed",
      "toast.couponFailed",
      "toast.couponValidationError",
      "toast.couponCodeRequired",
      "toast.couponCodeTooLong",
      "toast.couponCodeInvalidChars",
      "toast.deliveryAddressRequired",
      "toast.invalidPhoneNumber",
      "toast.orderCancelFailed",
      "toast.appLoadFailed",
      "toast.unexpectedError",
      "toast.cameraNotSupported",
      "toast.orderSent",
      "toast.orderSendFailed",
      "toast.orderCancelled",
      "toast.cancelOrderFailed",
      "toast.scanFailed",
      "toast.invalidQRFormat",
      "toast.qrValidationFailed",
      "toast.qrSignatureInvalid",
      "toast.unsupportedQRType",
      "toast.qrProcessError",
      "toast.cameraAccessFailed",
      "toast.cameraPermissionRequired",
      "toast.noCameraFound",
      "toast.browserNoCamera",
      "toast.errorReportCopied",
      "toast.preparingMenu",
      "toast.restaurantLoadFailed",
      "toast.invalidQRCode",
      "toast.orderConfirmed",
      "toast.orderPreparing",
      "toast.orderReady",
      "toast.orderDelivered",
    ];

    it("should have all toast keys in all 6 locales", () => {
      assertKeysInAllLocales(toastKeys);
    });

    it("should handle toast.itemRemoved with name param", () => {
      ALL_LOCALES.forEach((locale) => {
        switchLanguage(locale);
        const result = tGlobal("toast.itemRemoved", { name: "Pizza" });
        expect(result).toContain("Pizza");
        expect(result).not.toBe("toast.itemRemoved");
      });
    });

    it("should handle toast.itemAdded with name and quantity params", () => {
      ALL_LOCALES.forEach((locale) => {
        switchLanguage(locale);
        const result = tGlobal("toast.itemAdded", {
          name: "Burger",
          quantity: 2,
        });
        expect(result).toContain("Burger");
        expect(result).toContain("2");
        expect(result).not.toBe("toast.itemAdded");
      });
    });

    it("should handle toast.scanTypeDetected with type param", () => {
      ALL_LOCALES.forEach((locale) => {
        switchLanguage(locale);
        const result = tGlobal("toast.scanTypeDetected", { type: "QR" });
        expect(result).toContain("QR");
        expect(result).not.toBe("toast.scanTypeDetected");
      });
    });

    it("should handle toast.orderStatusUpdated with status param", () => {
      ALL_LOCALES.forEach((locale) => {
        switchLanguage(locale);
        const result = tGlobal("toast.orderStatusUpdated", {
          status: "Ready",
        });
        expect(result).toContain("Ready");
        expect(result).not.toBe("toast.orderStatusUpdated");
      });
    });
  });

  // ---------------------------------------------------------------
  // 3. OrderTracking Section
  // ---------------------------------------------------------------
  describe("OrderTracking Section", () => {
    const orderTrackingKeys = [
      "orderTracking.title",
      "orderTracking.orderNumber",
      "orderTracking.loadingOrder",
      "orderTracking.loadFailed",
      "orderTracking.reload",
      "orderTracking.orderProgress",
      "orderTracking.orderTimeline",
      "orderTracking.orderDetails",
      "orderTracking.orderTime",
      "orderTracking.customerName",
      "orderTracking.tableNumber",
      "orderTracking.orderedItems",
      "orderTracking.orderNotes",
      "orderTracking.cancelOrder",
      "orderTracking.continueOrdering",
      "orderTracking.confirmCancel",
      "orderTracking.confirmCancelMessage",
      "orderTracking.confirmCancelBtn",
      "orderTracking.keepOrder",
      "orderTracking.reconnecting",
      // Nested timeline
      "orderTracking.timeline.created",
      "orderTracking.timeline.createdDesc",
      "orderTracking.timeline.confirmed",
      "orderTracking.timeline.confirmedDesc",
      "orderTracking.timeline.preparing",
      "orderTracking.timeline.preparingDesc",
      "orderTracking.timeline.ready",
      "orderTracking.timeline.readyDesc",
      "orderTracking.timeline.served",
      "orderTracking.timeline.servedDesc",
      "orderTracking.timeline.cancelled",
      "orderTracking.timeline.cancelledDesc",
      // Nested status
      "orderTracking.status.pending",
      "orderTracking.status.confirmed",
      "orderTracking.status.preparing",
      "orderTracking.status.ready",
      "orderTracking.status.served",
      "orderTracking.status.cancelled",
      "orderTracking.status.paid",
    ];

    it("should have all orderTracking keys in all 6 locales", () => {
      assertKeysInAllLocales(orderTrackingKeys);
    });

    it("should handle orderTracking.estimatedMinutes with minutes param", () => {
      ALL_LOCALES.forEach((locale) => {
        switchLanguage(locale);
        const result = tGlobal("orderTracking.estimatedMinutes", {
          minutes: 15,
        });
        expect(result).toContain("15");
        expect(result).not.toBe("orderTracking.estimatedMinutes");
      });
    });
  });

  // ---------------------------------------------------------------
  // 4. OrderHistory Section
  // ---------------------------------------------------------------
  describe("OrderHistory Section", () => {
    const orderHistoryKeys = [
      "orderHistory.title",
      "orderHistory.personalCenter",
      "orderHistory.logout",
      "orderHistory.statusFilter",
      "orderHistory.allStatus",
      "orderHistory.statusPending",
      "orderHistory.statusConfirmed",
      "orderHistory.statusPreparing",
      "orderHistory.statusCompleted",
      "orderHistory.statusServed",
      "orderHistory.statusPaid",
      "orderHistory.statusCancelled",
      "orderHistory.startDate",
      "orderHistory.endDate",
      "orderHistory.resetFilter",
      "orderHistory.noOrders",
      "orderHistory.noOrdersDesc",
      "orderHistory.startOrdering",
      "orderHistory.restaurant",
      "orderHistory.table",
      "orderHistory.paid",
      "orderHistory.unpaid",
      "orderHistory.viewDetails",
      "orderHistory.cancelOrder",
      "orderHistory.prevPage",
      "orderHistory.nextPage",
      "orderHistory.confirmCancelOrder",
      "orderHistory.confirmLogout",
      "orderHistory.customerCancelled",
    ];

    it("should have all orderHistory keys in all 6 locales", () => {
      assertKeysInAllLocales(orderHistoryKeys);
    });

    it("should handle orderHistory.itemCount with count param", () => {
      ALL_LOCALES.forEach((locale) => {
        switchLanguage(locale);
        const result = tGlobal("orderHistory.itemCount", { count: 5 });
        expect(result).toContain("5");
        expect(result).not.toBe("orderHistory.itemCount");
      });
    });

    it("should handle orderHistory.pageInfo with params", () => {
      ALL_LOCALES.forEach((locale) => {
        switchLanguage(locale);
        const result = tGlobal("orderHistory.pageInfo", {
          current: 1,
          total: 3,
          count: 25,
        });
        expect(result).toContain("1");
        expect(result).toContain("3");
        expect(result).toContain("25");
      });
    });
  });

  // ---------------------------------------------------------------
  // 5. ShopCart Section
  // ---------------------------------------------------------------
  describe("ShopCart Section", () => {
    const shopCartKeys = [
      "shopCart.title",
      "shopCart.empty",
      "shopCart.pickupMethod",
      "shopCart.takeaway",
      "shopCart.delivery",
      "shopCart.deliveryAddress",
      "shopCart.deliveryAddressPlaceholder",
      "shopCart.contactPhone",
      "shopCart.contactPhonePlaceholder",
      "shopCart.deliveryNotes",
      "shopCart.deliveryNotesPlaceholder",
      "shopCart.estimatedPickup",
      "shopCart.estimatedTime",
      "shopCart.notes",
      "shopCart.subtotal",
      "shopCart.deliveryFee",
      "shopCart.total",
      "shopCart.confirmOrder",
      "shopCart.processing",
      "shopCart.orderingUnavailable",
    ];

    it("should have all shopCart keys in all 6 locales", () => {
      assertKeysInAllLocales(shopCartKeys);
    });
  });

  // ---------------------------------------------------------------
  // 6. ErrorBoundary Section
  // ---------------------------------------------------------------
  describe("ErrorBoundary Section", () => {
    const errorBoundaryKeys = [
      "errorBoundary.reload",
      "errorBoundary.goHome",
      "errorBoundary.showDetails",
      "errorBoundary.persistentIssue",
      "errorBoundary.reportIssue",
      "errorBoundary.networkErrorTitle",
      "errorBoundary.networkErrorMessage",
      "errorBoundary.notFoundTitle",
      "errorBoundary.notFoundMessage",
      "errorBoundary.permissionTitle",
      "errorBoundary.permissionMessage",
      "errorBoundary.defaultTitle",
      "errorBoundary.defaultMessage",
      "errorBoundary.copyErrorReport",
    ];

    it("should have all errorBoundary keys in all 6 locales", () => {
      assertKeysInAllLocales(errorBoundaryKeys);
    });
  });

  // ---------------------------------------------------------------
  // 7. ManualInput Section
  // ---------------------------------------------------------------
  describe("ManualInput Section", () => {
    const manualInputKeys = [
      "manualInput.title",
      "manualInput.restaurantName",
      "manualInput.restaurantNamePlaceholder",
      "manualInput.helpTitle",
      "manualInput.helpDesc",
      "manualInput.verifying",
      "manualInput.searching",
      "manualInput.noResults",
      "manualInput.restaurantRequired",
    ];

    it("should have all manualInput keys in all 6 locales", () => {
      assertKeysInAllLocales(manualInputKeys);
    });
  });

  // ---------------------------------------------------------------
  // 8. QRScanView Section
  // ---------------------------------------------------------------
  describe("QRScanView Section", () => {
    const qrScanViewKeys = [
      "qrScanView.title",
      "qrScanView.instruction",
      "qrScanView.manualInputLink",
      "qrScanView.scanFailed",
      "qrScanView.processing",
      "qrScanView.startingCamera",
      "qrScanView.aimAtQR",
    ];

    it("should have all qrScanView keys in all 6 locales", () => {
      assertKeysInAllLocales(qrScanViewKeys);
    });
  });

  // ---------------------------------------------------------------
  // 9. ShopMenu Section
  // ---------------------------------------------------------------
  describe("ShopMenu Section", () => {
    const shopMenuKeys = [
      "shopMenu.loadingMenu",
      "shopMenu.loadFailed",
      "shopMenu.reload",
      "shopMenu.searchPlaceholder",
      "shopMenu.recommended",
      "shopMenu.noItemsInCategory",
      "shopMenu.noResults",
      "shopMenu.tryOtherKeywords",
      "shopMenu.viewCart",
      "shopMenu.shopOrdering",
      "shopMenu.qrRevokedTitle",
      "shopMenu.qrRevokedDescription",
      "shopMenu.shopDisabledTitle",
      "shopMenu.shopDisabledDescription",
    ];

    it("should have all shopMenu keys in all 6 locales", () => {
      assertKeysInAllLocales(shopMenuKeys);
    });
  });

  // ---------------------------------------------------------------
  // 11. MenuItemCard and MenuItemModal Sections
  // ---------------------------------------------------------------
  describe("MenuItemCard Section", () => {
    const menuItemCardKeys = [
      "menuItemCard.featured",
      "menuItemCard.unavailable",
      "menuItemCard.soldOut",
      "menuItemCard.addToCart",
      "menuItemCard.selectSpec",
    ];

    it("should have all menuItemCard keys in all 6 locales", () => {
      assertKeysInAllLocales(menuItemCardKeys);
    });

    it("should handle menuItemCard.orderedCount with count param", () => {
      ALL_LOCALES.forEach((locale) => {
        switchLanguage(locale);
        const result = tGlobal("menuItemCard.orderedCount", { count: 42 });
        expect(result).toContain("42");
        expect(result).not.toBe("menuItemCard.orderedCount");
      });
    });
  });

  describe("MenuItemModal Section", () => {
    const menuItemModalKeys = [
      "menuItemModal.featured",
      "menuItemModal.quantity",
      "menuItemModal.notesLabel",
      "menuItemModal.notesPlaceholder",
      "menuItemModal.unavailable",
      "menuItemModal.soldOut",
    ];

    it("should have all menuItemModal keys in all 6 locales", () => {
      assertKeysInAllLocales(menuItemModalKeys);
    });
  });

  // ---------------------------------------------------------------
  // 12. OrderItem Section
  // ---------------------------------------------------------------
  describe("OrderItem Section", () => {
    const orderItemKeys = [
      "orderItem.unknownItem",
      "orderItem.notes",
      "orderItem.statusPending",
      "orderItem.statusPreparing",
      "orderItem.statusReady",
      "orderItem.statusServed",
    ];

    it("should have all orderItem keys in all 6 locales", () => {
      assertKeysInAllLocales(orderItemKeys);
    });
  });

  // ---------------------------------------------------------------
  // 13. Group Section
  // ---------------------------------------------------------------
  describe("Group Section", () => {
    const groupKeys = [
      "group.sharedCart",
      "group.members",
      "group.unknownMember",
      "group.me",
      "group.online",
      "group.emptyCart",
      "group.startAdding",
      "group.splitMethod",
      "group.total",
      "group.myShare",
      "group.perPerson",
      "group.split.equal",
      "group.split.equalDesc",
      "group.split.by_item",
      "group.split.byItem",
      "group.split.byItemDesc",
      "group.split.proportional",
      "group.split.proportionalDesc",
      "group.feeMethod",
      "group.mySubtotal",
      "group.myServiceCharge",
      "group.myTax",
      "group.fee.proportional",
      "group.fee.equal",
      "group.fee.host",
    ];

    it("should have all group keys in all 6 locales", () => {
      assertKeysInAllLocales(groupKeys);
    });
  });

  // ---------------------------------------------------------------
  // 14. Navigation Section (route titles)
  // ---------------------------------------------------------------
  describe("Navigation Section", () => {
    const navigationKeys = [
      "navigation.home",
      "navigation.menu",
      "navigation.cart",
      "navigation.orders",
      "navigation.profile",
      "navigation.about",
      "navigation.privacy",
      "navigation.terms",
      "navigation.contact",
      "navigation.help",
      "navigation.appTitle",
      "navigation.login",
      "navigation.register",
      "navigation.myOrders",
      "navigation.orderDetail",
      "navigation.profileCenter",
      "navigation.browseMenu",
      "navigation.scanQR",
      "navigation.orderTypeSelect",
      "navigation.shopMenu",
      "navigation.serviceBooking",
      "navigation.shoppingCart",
      "navigation.orderTracking",
      "navigation.error",
      "navigation.pageNotFound",
      "navigation.discover",
      "navigation.markets",
      "navigation.forgotPassword",
      "navigation.resetPassword",
      "navigation.verifyEmail",
    ];

    it("should have all navigation keys in all 6 locales", () => {
      assertKeysInAllLocales(navigationKeys);
    });

    it("should translate navigation.home correctly", () => {
      switchLanguage("zh-TW");
      expect(tGlobal("navigation.home")).toBe("首頁");
      switchLanguage("en-US");
      expect(tGlobal("navigation.home")).toBe("Home");
    });
  });

  // ---------------------------------------------------------------
  // 15. Format Section (day names, status text)
  // ---------------------------------------------------------------
  describe("Format Section", () => {
    const formatKeys = [
      "format.businessHoursNotSet",
      "format.monday",
      "format.tuesday",
      "format.wednesday",
      "format.thursday",
      "format.friday",
      "format.saturday",
      "format.sunday",
      "format.closed",
      "format.unknown",
      "format.notSet",
      "format.spiceNone",
      "format.spiceMild",
      "format.spiceLight",
      "format.spiceMedium",
      "format.spiceHot",
      "format.orderPending",
      "format.orderConfirmed",
      "format.orderPreparing",
      "format.orderReady",
      "format.orderDelivered",
      "format.orderPaid",
      "format.orderCancelled",
      "format.unknownStatus",
    ];

    it("should have all format keys in all 6 locales", () => {
      assertKeysInAllLocales(formatKeys);
    });

    it("should handle format.noItems with item param", () => {
      ALL_LOCALES.forEach((locale) => {
        switchLanguage(locale);
        const result = tGlobal("format.noItems", { item: "test" });
        expect(result).not.toBe("format.noItems");
      });
    });

    it("should translate day names correctly in en-US", () => {
      switchLanguage("en-US");
      expect(tGlobal("format.monday")).toBe("Mon");
      expect(tGlobal("format.sunday")).toBe("Sun");
    });

    it("should translate day names correctly in zh-TW", () => {
      switchLanguage("zh-TW");
      expect(tGlobal("format.monday")).toBe("週一");
      expect(tGlobal("format.sunday")).toBe("週日");
    });
  });

  // ---------------------------------------------------------------
  // 16. Errors Section (API error messages)
  // ---------------------------------------------------------------
  describe("Errors Section", () => {
    const errorsKeys = [
      "errors.general",
      "errors.generalDesc",
      "errors.network",
      "errors.networkDesc",
      "errors.notFound",
      "errors.notFoundDesc",
      "errors.unauthorized",
      "errors.unauthorizedDesc",
      "errors.serverError",
      "errors.serverErrorDesc",
      "errors.timeout",
      "errors.timeoutDesc",
      "errors.validation",
      "errors.validationDesc",
      "errors.restaurantNotFound",
      "errors.tableNotFound",
      "errors.menuNotAvailable",
      "errors.orderFailed",
      "errors.paymentFailed",
      "errors.invalidRestaurantOrTable",
      "errors.routeLoadFailed",
      "errors.unknown",
      "errors.requestFailed",
      "errors.badRequest",
      "errors.forbidden",
      "errors.notFoundResource",
      "errors.conflict",
      "errors.tooManyRequests",
      "errors.internalServerError",
      "errors.badGateway",
      "errors.serviceUnavailable",
      "errors.gatewayTimeout",
    ];

    it("should have all errors keys in all 6 locales", () => {
      assertKeysInAllLocales(errorsKeys);
    });

    it("should translate errors.general correctly", () => {
      switchLanguage("zh-TW");
      expect(tGlobal("errors.general")).toBe("發生錯誤");
      switchLanguage("en-US");
      expect(tGlobal("errors.general")).toBe("An Error Occurred");
    });
  });

  // ---------------------------------------------------------------
  // 17. Privacy Section
  // ---------------------------------------------------------------
  describe("Privacy Section", () => {
    const privacyKeys = [
      "privacy.title",
      "privacy.dataCollection.title",
      "privacy.dataCollection.description",
      "privacy.dataUsage.title",
      "privacy.dataUsage.description",
      "privacy.dataProtection.title",
      "privacy.dataProtection.description",
      "privacy.contact.title",
      "privacy.contact.description",
    ];

    it("should have all privacy keys in all 6 locales", () => {
      assertKeysInAllLocales(privacyKeys);
    });
  });

  // ---------------------------------------------------------------
  // 18. Terms Section
  // ---------------------------------------------------------------
  describe("Terms Section", () => {
    const termsKeys = [
      "terms.title",
      "terms.usage.title",
      "terms.usage.description",
      "terms.responsibility.title",
      "terms.responsibility.description",
      "terms.disclaimer.title",
      "terms.disclaimer.description",
      "terms.changes.title",
      "terms.changes.description",
    ];

    it("should have all terms keys in all 6 locales", () => {
      assertKeysInAllLocales(termsKeys);
    });
  });

  // ---------------------------------------------------------------
  // 19. About Section
  // ---------------------------------------------------------------
  describe("About Section", () => {
    const aboutKeys = [
      "about.title",
      "about.description",
      "about.features.title",
      "about.features.qrOrder",
      "about.features.tracking",
      "about.features.payment",
      "about.features.customization",
      "about.features.management",
      "about.contact.title",
      "about.contact.description",
    ];

    it("should have all about keys in all 6 locales", () => {
      assertKeysInAllLocales(aboutKeys);
    });
  });

  // ---------------------------------------------------------------
  // 20. Profile Section
  // ---------------------------------------------------------------
  describe("Profile Section", () => {
    const profileKeys = [
      "profile.title",
      "profile.pageTitle",
      "profile.name",
      "profile.email",
      "profile.phone",
      "profile.preferences",
      "profile.language",
      "profile.notifications",
      "profile.orderHistory",
      "profile.favorites",
      "profile.logout",
      "profile.notSet",
      "profile.quickActions",
      "profile.viewOrderHistory",
      "profile.browseMenu",
      "profile.viewRestaurantMenu",
      "profile.accountSettings",
      "profile.logoutAccount",
    ];

    it("should have all profile keys in all 6 locales", () => {
      assertKeysInAllLocales(profileKeys);
    });

    it("should translate profile.title correctly", () => {
      switchLanguage("zh-TW");
      expect(tGlobal("profile.title")).toBe("個人資料");
      switchLanguage("en-US");
      expect(tGlobal("profile.title")).toBe("Profile");
    });
  });

  // ---------------------------------------------------------------
  // 21. Review Section (#286)
  // ---------------------------------------------------------------
  describe("Review Section", () => {
    const reviewKeys = [
      "review.cta",
      "review.ctaHint",
      "review.formTitle",
      "review.ratingLabel",
      "review.ratingHint",
      "review.starLabel",
      "review.contentLabel",
      "review.contentPlaceholder",
      "review.contentCounter",
      "review.itemsHeading",
      "review.submit",
      "review.submitting",
      "review.cancel",
      "review.success",
      "review.myReviewTitle",
      "review.ratingValue",
      "review.replyLabel",
      "review.alreadyReviewed",
      "review.notReviewable",
      "review.itemNotInOrder",
      "review.itemDuplicate",
      "review.submitFailed",
      "review.shopReviewCount",
      "review.viewAll",
      "review.hide",
      "review.loadMore",
      "review.loading",
      "review.loadFailed",
      "review.empty",
      "review.anonymous",
    ];

    it("should have all review keys in all 6 locales", () => {
      assertKeysInAllLocales(reviewKeys);
    });

    it("should interpolate review.shopReviewCount in all 6 locales", () => {
      // The shop header renders this next to the average, so a locale that
      // dropped the placeholder would read as "reviews" with no number.
      ALL_LOCALES.forEach((locale) => {
        switchLanguage(locale);
        expect(
          tGlobal("review.shopReviewCount", { count: 12 }),
          `review.shopReviewCount in ${locale}`,
        ).toContain("12");
      });
    });

    it("should interpolate review.contentCounter in all 6 locales", () => {
      ALL_LOCALES.forEach((locale) => {
        switchLanguage(locale);
        const result = tGlobal("review.contentCounter", {
          current: 20,
          max: 1000,
        });
        expect(result, `review.contentCounter in ${locale}`).toContain("20");
        expect(result, `review.contentCounter in ${locale}`).toContain("1000");
      });
    });
  });

  // ---------------------------------------------------------------
  // 22. Parameterized Translations Across All 6 Locales
  // ---------------------------------------------------------------
  describe("Parameterized Translations", () => {
    it("should handle cart.itemCount with count param in all locales", () => {
      ALL_LOCALES.forEach((locale) => {
        switchLanguage(locale);
        const result = tGlobal("cart.itemCount", { count: 7 });
        expect(result, `cart.itemCount in ${locale}`).toContain("7");
        expect(result).not.toBe("cart.itemCount");
      });
    });

    it("should handle validation.minLength with min param in all locales", () => {
      ALL_LOCALES.forEach((locale) => {
        switchLanguage(locale);
        const result = tGlobal("validation.minLength", { min: 10 });
        expect(result, `validation.minLength in ${locale}`).toContain("10");
        expect(result).not.toBe("validation.minLength");
      });
    });

    it("should render specific parameterized values correctly", () => {
      switchLanguage("zh-TW");
      expect(tGlobal("validation.minLength", { min: 6 })).toBe(
        "至少需要 6 個字元",
      );

      switchLanguage("zh-CN");
      expect(tGlobal("validation.minLength", { min: 6 })).toBe(
        "至少需要 6 个字符",
      );

      switchLanguage("en-US");
      expect(tGlobal("validation.minLength", { min: 6 })).toBe(
        "Minimum 6 characters required",
      );

      switchLanguage("vi-VN");
      expect(tGlobal("validation.minLength", { min: 6 })).toBe(
        "Ít nhất 6 ký tự là bắt buộc",
      );

      switchLanguage("ms-MY");
      expect(tGlobal("validation.minLength", { min: 6 })).toBe(
        "Minimum 6 aksara diperlukan",
      );

      switchLanguage("id-ID");
      expect(tGlobal("validation.minLength", { min: 6 })).toBe(
        "Minimal 6 karakter diperlukan",
      );
    });
  });

  // ---------------------------------------------------------------
  // 22. ms-MY and id-ID Specific Validation
  // ---------------------------------------------------------------
  describe("ms-MY and id-ID Specific Validation", () => {
    it("should have non-empty translations for ms-MY core keys", () => {
      switchLanguage("ms-MY");
      expect(tGlobal("common.confirm")).toBeTruthy();
      expect(tGlobal("common.cancel")).toBeTruthy();
      expect(tGlobal("common.loading")).toBeTruthy();
      expect(tGlobal("home.title")).toBeTruthy();
      expect(tGlobal("menu.title")).toBeTruthy();
      expect(tGlobal("cart.title")).toBeTruthy();
      expect(tGlobal("order.title")).toBeTruthy();
      expect(tGlobal("auth.login")).toBeTruthy();
      expect(tGlobal("auth.register")).toBeTruthy();
      expect(tGlobal("errors.general")).toBeTruthy();
    });

    it("should have non-empty translations for id-ID core keys", () => {
      switchLanguage("id-ID");
      expect(tGlobal("common.confirm")).toBeTruthy();
      expect(tGlobal("common.cancel")).toBeTruthy();
      expect(tGlobal("common.loading")).toBeTruthy();
      expect(tGlobal("home.title")).toBeTruthy();
      expect(tGlobal("menu.title")).toBeTruthy();
      expect(tGlobal("cart.title")).toBeTruthy();
      expect(tGlobal("order.title")).toBeTruthy();
      expect(tGlobal("auth.login")).toBeTruthy();
      expect(tGlobal("auth.register")).toBeTruthy();
      expect(tGlobal("errors.general")).toBeTruthy();
    });

    it("should have ms-MY translations that are different from en-US", () => {
      switchLanguage("en-US");
      const enConfirm = tGlobal("common.confirm");
      const enLoading = tGlobal("common.loading");

      switchLanguage("ms-MY");
      const msConfirm = tGlobal("common.confirm");
      const msLoading = tGlobal("common.loading");

      // ms-MY should have its own translations, not just copies of en-US
      expect(msConfirm).toBeTruthy();
      expect(msLoading).toBeTruthy();
      // At least one should differ from English
      const hasDifference = msConfirm !== enConfirm || msLoading !== enLoading;
      expect(hasDifference).toBe(true);
    });

    it("should have id-ID translations that are different from en-US", () => {
      switchLanguage("en-US");
      const enConfirm = tGlobal("common.confirm");
      const enLoading = tGlobal("common.loading");

      switchLanguage("id-ID");
      const idConfirm = tGlobal("common.confirm");
      const idLoading = tGlobal("common.loading");

      expect(idConfirm).toBeTruthy();
      expect(idLoading).toBeTruthy();
      const hasDifference = idConfirm !== enConfirm || idLoading !== enLoading;
      expect(hasDifference).toBe(true);
    });

    it("should have ms-MY and id-ID with all new sections", () => {
      const sectionPrefixes = [
        "auth.login",
        "toast.orderSubmitSuccess",
        "orderTracking.title",
        "orderHistory.title",
        "shopCart.title",
        "errorBoundary.reload",
        "manualInput.title",
        "qrScanView.title",
        "shopMenu.loadingMenu",
        "menuItemCard.featured",
        "menuItemModal.featured",
        "orderItem.unknownItem",
        "group.sharedCart",
        "format.monday",
        "privacy.title",
        "terms.title",
        "about.title",
        "profile.title",
      ];

      (["ms-MY", "id-ID"] as SupportedLanguage[]).forEach((locale) => {
        switchLanguage(locale);
        sectionPrefixes.forEach((key) => {
          const val = tGlobal(key);
          expect(val, `${key} missing in ${locale}`).not.toBe(key);
          expect(val, `${key} empty in ${locale}`).toBeTruthy();
        });
      });
    });
  });

  // ---------------------------------------------------------------
  // 23. Additional Sections: Messages, OrderTypeLanding, ErrorView
  // ---------------------------------------------------------------
  describe("Messages Section", () => {
    const messagesKeys = ["messages.networkError", "messages.sessionExpired"];

    it("should have all messages keys in all 6 locales", () => {
      assertKeysInAllLocales(messagesKeys);
    });
  });

  describe("OrderTypeLanding Section", () => {
    const keys = [
      "orderTypeLanding.selectMethod",
      "orderTypeLanding.takeaway",
      "orderTypeLanding.takeawayDesc",
      "orderTypeLanding.delivery",
      "orderTypeLanding.deliveryDesc",
      "orderTypeLanding.noMethodsTitle",
      "orderTypeLanding.noMethodsDescription",
      "orderTypeLanding.continue",
      "orderTypeLanding.qrRevokedTitle",
      "orderTypeLanding.qrRevokedDescription",
      "orderTypeLanding.shopDisabledTitle",
      "orderTypeLanding.shopDisabledDescription",
    ];

    it("should have all orderTypeLanding keys in all 6 locales", () => {
      assertKeysInAllLocales(keys);
    });
  });

  describe("ErrorView Section", () => {
    const keys = ["errorView.retry", "errorView.goHome"];

    it("should have all errorView keys in all 6 locales", () => {
      assertKeysInAllLocales(keys);
    });
  });

  // ---------------------------------------------------------------
  // 24. Sections added by the hard-coded-English sweep
  // ---------------------------------------------------------------
  describe("GroupJoin Section", () => {
    const keys = [
      "groupJoin.loading",
      "groupJoin.notFoundTitle",
      "groupJoin.notFoundDesc",
      "groupJoin.loadFailedTitle",
      "groupJoin.loadFailed",
      "groupJoin.retry",
      "groupJoin.label",
      "groupJoin.hostOrdering",
      "groupJoin.members",
      "groupJoin.fulfillment",
      "groupJoin.expires",
      "groupJoin.join",
      "groupJoin.yourName",
      "groupJoin.namePlaceholder",
      "groupJoin.joining",
      "groupJoin.joinNow",
      "groupJoin.nameRequired",
      "groupJoin.joinFailed",
      "groupJoin.fulfillmentDineIn",
      "groupJoin.fulfillmentDelivery",
      "groupJoin.fulfillmentPickup",
    ];

    it("should have all groupJoin keys in all 6 locales", () => {
      assertKeysInAllLocales(keys);
    });

    it("names the host in the heading in every locale", () => {
      ALL_LOCALES.forEach((locale) => {
        switchLanguage(locale);
        const rendered = tGlobal("groupJoin.hostOrdering", {
          hostName: "Alex",
        });
        expect(rendered, `groupJoin.hostOrdering in ${locale}`).toContain(
          "Alex",
        );
        expect(rendered).not.toContain("{hostName}");
      });
    });
  });

  describe("Footer Section", () => {
    it("should have the copyright line in all 6 locales", () => {
      assertKeysInAllLocales(["footer.copyright"]);
    });

    it("stamps the current year rather than a baked-in one", () => {
      ALL_LOCALES.forEach((locale) => {
        switchLanguage(locale);
        const rendered = tGlobal("footer.copyright", { year: 2031 });
        expect(rendered, `footer.copyright in ${locale}`).toContain("2031");
      });
    });
  });

  describe("Group ordering failure keys", () => {
    // Every code in group-order-error.ts resolves to one of these. A diner sees
    // whichever one their failure maps to, so none may go missing.
    const keys = [
      "group.loading",
      "group.sessionExpiredNotice",
      "group.lockedTitle",
      "group.lockedDesc",
      "group.hostCredentialRequired",
      "group.notAMember",
      "group.connectionError",
      "group.recoveryCodeRequired",
      "group.unknownError",
    ];

    it("should have all group failure keys in all 6 locales", () => {
      assertKeysInAllLocales(keys);
    });
  });

  describe("Discovery Section", () => {
    const keys = [
      "discovery.searchFailed",
      "discovery.browseFailed",
      "discovery.popularFailed",
      "discovery.takeawayUnavailable",
    ];

    it("should have all discovery failure keys in all 6 locales", () => {
      assertKeysInAllLocales(keys);
    });
  });

  // ---------------------------------------------------------------
  // 25. Service booking
  // ---------------------------------------------------------------
  describe("ServiceBooking Section", () => {
    const keys = [
      "serviceBooking.back",
      "serviceBooking.title",
      "serviceBooking.loadingService",
      "serviceBooking.durationMinutes",
      "serviceBooking.bookingDate",
      "serviceBooking.checkSlots",
      "serviceBooking.slotAvailable",
      "serviceBooking.slotRemaining",
      "serviceBooking.noSlots",
      "serviceBooking.name",
      "serviceBooking.phone",
      "serviceBooking.email",
      "serviceBooking.partySize",
      "serviceBooking.voucherCode",
      "serviceBooking.notes",
      "serviceBooking.create",
      "serviceBooking.created",
      "serviceBooking.confirmationCode",
      "serviceBooking.amountDue",
      "serviceBooking.status",
      "serviceBooking.creditCardPlaceholder",
      "serviceBooking.creditPinPlaceholder",
      "serviceBooking.payWithCredits",
      "serviceBooking.lookupTitle",
      "serviceBooking.confirmationCodePlaceholder",
      "serviceBooking.contactPlaceholder",
      "serviceBooking.lookup",
      "serviceBooking.cancel",
      "serviceBooking.quoteOnSite",
      "serviceBooking.notFound",
      "serviceBooking.bookingUnavailable",
      "serviceBooking.loadFailed",
      "serviceBooking.slotsFailed",
      "serviceBooking.createSuccess",
      "serviceBooking.createFailed",
      "serviceBooking.paySuccess",
      "serviceBooking.payFailed",
      "serviceBooking.lookupFailed",
      "serviceBooking.cancelSuccess",
      "serviceBooking.cancelFailed",
    ];

    it("should have all serviceBooking keys in all 6 locales", () => {
      assertKeysInAllLocales(keys);
    });

    // The view indexes these by the raw status and type off the API, so a gap
    // renders the key itself on a confirmation screen.
    it("covers every booking status and service type it can be handed", () => {
      assertKeysInAllLocales([
        ...["pending", "confirmed", "completed", "cancelled", "no_show"].map(
          (status) => `serviceBooking.bookingStatus.${status}`,
        ),
        ...[
          "general",
          "booking",
          "pickup",
          "delivery",
          "consultation",
          "rental",
          "activity",
        ].map((type) => `serviceBooking.serviceType.${type}`),
      ]);
    });
  });

  // ---------------------------------------------------------------
  // 26. Market surfaces
  // ---------------------------------------------------------------
  describe("Markets Section", () => {
    const keys = [
      "markets.loadListFailed",
      "markets.loadNearbyFailed",
      "markets.loadDetailFailed",
      "markets.loadVendorsFailed",
      "markets.loadContactFailed",
    ];

    it("should have all markets keys in all 6 locales", () => {
      assertKeysInAllLocales(keys);
    });
  });

  describe("Markets Section — shared vocabulary", () => {
    const keys = [
      "markets.common.open",
      "markets.common.closed",
      "markets.common.closedToday",
      "markets.common.openShort",
      "markets.common.closedShort",
      "markets.common.stallCount",
      "markets.common.stallWithNumber",
      "markets.common.unzoned",
      "markets.common.loading",
      "markets.common.loadMore",
      "markets.common.nearest",
      "markets.common.locating",
      "markets.common.takeaway",
      "markets.common.delivery",
      "markets.common.takeawayAvailable",
      "markets.common.deliveryAvailable",
      "markets.common.menuItemCount",
      "markets.common.noMenuItems",
      "markets.common.serviceCount",
      "markets.common.noServices",
      "markets.common.viewMenu",
      "markets.common.viewServices",
      "markets.common.dataPending",
      "markets.common.search",
      "markets.common.clearFilters",
      "markets.common.back",
      "markets.common.checkoutUnavailable",
      "format.listSeparator",
    ];

    it("should have the shared market vocabulary in all 6 locales", () => {
      assertKeysInAllLocales(keys);
    });

    // marketTypes.ts hands these keys straight to `t`, and every weekday key is
    // indexed off an opening-hours object, so both sets must be complete.
    it("covers every venue type and weekday", () => {
      assertKeysInAllLocales([
        ...[
          "night_market",
          "commercial_district",
          "food_court",
          "event_venue",
          "other",
        ].map((type) => `markets.type.${type}`),
        ...[
          "monday",
          "tuesday",
          "wednesday",
          "thursday",
          "friday",
          "saturday",
          "sunday",
        ].flatMap((day) => [
          `markets.weekday.long.${day}`,
          `markets.weekday.short.${day}`,
        ]),
      ]);
    });
  });

  describe("Markets Section — screens", () => {
    it("covers the market directory", () => {
      assertKeysInAllLocales([
        "markets.directory.title",
        "markets.directory.searchPlaceholder",
        "markets.directory.allCities",
        "markets.directory.allDistricts",
        "markets.directory.allTypes",
        "markets.directory.findNearby",
        "markets.directory.favorites",
        "markets.directory.recentVisits",
        "markets.directory.recentOrders",
        "markets.directory.nearby",
        "markets.directory.allMarkets",
        "markets.directory.emptyFiltered",
        "markets.directory.emptyNoData",
        "markets.directory.emptyFilteredDesc",
        "markets.directory.emptyNoDataDesc",
        "markets.directory.loadMoreMarkets",
        "markets.directory.checkoutStallCount",
      ]);
    });

    it("covers the market card, hero, map, stall map and vendor list", () => {
      assertKeysInAllLocales([
        "markets.card.productCount",
        "markets.card.serviceCount",
        "markets.card.catalogPending",
        "markets.card.viewMarket",
        "markets.card.distance",
        "markets.card.readiness",
        "markets.card.enterSearch",
        "markets.card.until",
        "markets.hero.gallery",
        "markets.hero.galleryAlt",
        "markets.hero.openingHours",
        "markets.map.title",
        "markets.map.navigate",
        "markets.map.canvasLabel",
        "markets.map.loadError",
        "markets.map.vendorCoords",
        "markets.map.boundaryMarked",
        "markets.map.vendorPopup",
        "markets.stallMap.defaultTitle",
        "markets.stallMap.defaultDescription",
        "markets.stallMap.openCount",
        "markets.stallMap.entrance",
        "markets.stallMap.aisle",
        "markets.stallMap.exit",
        "markets.stallMap.positionMapLabel",
        "markets.stallMap.laneLabel",
        "markets.stallMap.menuCount",
        "markets.stallMap.serviceCount",
        "markets.vendors.searchPlaceholder",
        "markets.vendors.loading",
        "markets.vendors.empty",
        "markets.vendors.noStallNumber",
        "markets.vendors.marketHours",
        "markets.vendors.primaryVendor",
        "markets.vendors.contactVendor",
        "markets.vendors.loadMoreVendors",
      ]);
    });

    it("covers in-market product search, including its sorts and result kinds", () => {
      assertKeysInAllLocales([
        "markets.search.title",
        "markets.search.subtitle",
        "markets.search.placeholder",
        "markets.search.takeawayOnly",
        "markets.search.deliveryOnly",
        "markets.search.allCategories",
        "markets.search.allServices",
        "markets.search.activeFilters",
        "markets.search.browseAll",
        "markets.search.searching",
        "markets.search.viewVendorList",
        "markets.search.viewAvailableServices",
        "markets.search.resultCount",
        "markets.search.vendorTag",
        "markets.search.serviceTag",
        "markets.search.openNow",
        "markets.search.closedNow",
        "markets.search.bookDirect",
        "markets.search.openBooking",
        "markets.search.searchFailed",
        "markets.search.filterKind",
        "markets.search.filterKeyword",
        "markets.search.filterCategory",
        "markets.search.filterService",
        "markets.search.filterSort",
        "markets.search.emptyFiltered",
        "markets.search.emptySyncing",
        "markets.search.emptyNoCatalog",
        "markets.search.emptyFilteredDesc",
        "markets.search.emptySyncingDesc",
        "markets.search.emptyNoCatalogDesc",
        ...["all", "menu_item", "product", "service", "vendor"].map(
          (kind) => `markets.search.resultKind.${kind}`,
        ),
        ...[
          "relevance",
          "price_asc",
          "price_desc",
          "popular",
          "open_now",
          "distance",
        ].map((sort) => `markets.search.sort.${sort}`),
        ...[
          "general",
          "booking",
          "pickup",
          "delivery",
          "consultation",
          "rental",
          "activity",
        ].map((type) => `markets.serviceType.${type}`),
      ]);
    });

    it("covers the market detail page", () => {
      assertKeysInAllLocales([
        "markets.detail.fallbackTitle",
        "markets.detail.following",
        "markets.detail.follow",
        "markets.detail.readinessTitle",
        "markets.detail.readinessDesc",
        "markets.detail.syncingTitle",
        "markets.detail.syncingDesc",
        "markets.detail.coverageProducts",
        "markets.detail.coverageServices",
        "markets.detail.exploreTitle",
        "markets.detail.popularDishes",
        "markets.detail.popularProducts",
        "markets.detail.stallServices",
        "markets.detail.cartTitle",
        "markets.detail.cartSummary",
        "markets.detail.vendorItemCount",
        "markets.detail.phoneLastDigits",
        "markets.detail.submitting",
        "markets.detail.submit",
        "markets.detail.checkoutDisabledHint",
        "markets.detail.checkoutMinVendors",
        "markets.detail.checkoutSubmitted",
        "markets.detail.contactTitle",
        "markets.detail.close",
        "markets.detail.contactLoading",
        "markets.detail.faqPlaceholder",
        "markets.detail.faqEmpty",
        "markets.detail.faqNone",
        "markets.detail.contactNone",
        "markets.detail.previousPage",
        "markets.detail.favoriteSyncFailed",
        "markets.detail.checkoutSuccess",
        "markets.detail.checkoutFailed",
      ]);
    });

    it("covers market checkout tracking, including every status it maps", () => {
      assertKeysInAllLocales([
        "markets.checkout.back",
        "markets.checkout.title",
        "markets.checkout.loadingOrder",
        "markets.checkout.loadFailedTitle",
        "markets.checkout.reload",
        "markets.checkout.submittedAt",
        "markets.checkout.subtotal",
        "markets.checkout.voucherDiscount",
        "markets.checkout.amountDue",
        "markets.checkout.voucherApplied",
        "markets.checkout.removeVoucher",
        "markets.checkout.voucherPlaceholder",
        "markets.checkout.applyVoucher",
        "markets.checkout.paymentRetryHint",
        "markets.checkout.childPaymentFailure",
        "markets.checkout.paymentFailed",
        "markets.checkout.unavailableHint",
        "markets.checkout.stallOrders",
        "markets.checkout.orderNumber",
        "markets.checkout.childOrderNote",
        "markets.checkout.viewStallOrder",
        "markets.checkout.statusSubmitted",
        "markets.checkout.statusProcessing",
        "markets.checkout.paymentProgress",
        "markets.checkout.payProcessing",
        "markets.checkout.payRetryUnpaid",
        "markets.checkout.payAgain",
        "markets.checkout.payCombined",
        "markets.checkout.loadFailed",
        "markets.checkout.payFailed",
        "markets.checkout.voucherApplySuccess",
        "markets.checkout.voucherRemoveSuccess",
        "markets.checkout.voucherRemoveFailed",
        "markets.checkout.payLinkInvalid",
        "markets.checkout.payRedirecting",
        "markets.checkout.payAwaitingElement",
        "markets.checkout.payAwaitingSdk",
        "markets.checkout.childOrderAccessFailed",
        ...[
          "pending",
          "confirmed",
          "preparing",
          "ready",
          "delivered",
          "paid",
          "cancelled",
          "refunded",
        ].map((status) => `markets.checkout.orderStatus.${status}`),
        ...[
          "pending",
          "processing",
          "paid",
          "failed",
          "refunded",
          "partial_refund",
        ].map((status) => `markets.checkout.paymentStatus.${status}`),
        ...[
          "pending",
          "partial_paid",
          "paid",
          "failed",
          "refunded",
          "partial_refunded",
        ].map((status) => `markets.checkout.marketPaymentStatus.${status}`),
        ...[
          "VOUCHER_NOT_FOUND",
          "VOUCHER_NOT_APPLICABLE",
          "VOUCHER_EXPIRED",
          "VOUCHER_EXHAUSTED",
          "VOUCHER_MIN_ORDER_NOT_MET",
          "MARKET_CHECKOUT_ALREADY_PAID",
          "default",
        ].map((code) => `markets.checkout.voucherError.${code}`),
        ...[
          "pending",
          "partial_paid",
          "paid",
          "failed",
          "refunded",
          "partial_refunded",
        ].map((status) => `markets.checkoutStatus.${status}`),
      ]);
    });
  });
});
