import {
  parseUserFacingError,
  resolveUserFacingError,
} from "@makanmasak/shared/utils/user-facing-error";

const ORDER_SUBMIT_ERROR_KEYS: Record<string, string> = {
  ACTIVE_GUEST_ORDER_EXISTS: "toast.orderSubmitActiveGuestOrder",
  CLIENT_MUTATION_DUPLICATE: "toast.orderSubmitDuplicate",
  MENU_ITEM_NOT_AVAILABLE: "toast.orderSubmitMenuItemUnavailable",
  MENU_ITEM_UNAVAILABLE: "toast.orderSubmitMenuItemUnavailable",
  INSUFFICIENT_INVENTORY: "toast.orderSubmitInsufficientInventory",
  INVALID_RESTAURANT_ID: "toast.orderSubmitRestaurantUnavailable",
  RESTAURANT_NOT_FOUND: "toast.orderSubmitRestaurantUnavailable",
  RESTAURANT_CLOSED: "toast.orderSubmitRestaurantUnavailable",
  // #352: createOrder's own gates. Until that fix they arrived as 500
  // GENERIC_ERROR, so this registry never had a chance to match them — a
  // closed restaurant and a retired table both surfaced as "unknown error".
  RESTAURANT_UNAVAILABLE: "toast.orderSubmitRestaurantUnavailable",
  // The API sends the exact figures in `error.details`
  // ({ minOrderAmount, currentAmount, shortfall, currency }), but this registry
  // resolves a key and nothing else — `parseUserFacingError` reads transport
  // facts only and never touches `details`. So the toast is deliberately
  // static; rendering "you need NT$280 more" needs the resolver to carry
  // params, which is a change to the shared contract, not to this table.
  MINIMUM_ORDER_NOT_MET: "toast.orderSubmitBelowMinimum",
  TABLE_OCCUPIED: "toast.orderSubmitTableUnavailable",
  TABLE_NOT_AVAILABLE: "toast.orderSubmitTableUnavailable",
  TABLE_UNAVAILABLE: "toast.orderSubmitTableUnavailable",
  EMPTY_ORDER_ITEMS: "toast.cartCannotBeEmpty",
  TOO_MANY_ORDER_ITEMS: "toast.orderSubmitFailed",
  INVALID_MENU_ITEM_ID: "toast.orderSubmitMenuItemUnavailable",
  INVALID_CUSTOMIZATION: "toast.orderSubmitMenuItemUnavailable",
  INVALID_ITEM_QUANTITY: "toast.orderSubmitFailed",
  ITEM_QUANTITY_EXCEEDED: "toast.orderSubmitFailed",
  INVALID_PHONE_FORMAT: "toast.invalidPhoneNumber",
  INVALID_EMAIL_FORMAT: "toast.orderSubmitInvalidContact",
  NOTES_TOO_LONG: "toast.orderSubmitNotesTooLong",
  INVALID_COUPON_CODE_FORMAT: "toast.couponFailed",
  COUPON_INVALID: "toast.couponFailed",
  WAITING_LIST_PREORDER_EXISTS: "toast.orderSubmitDuplicate",
  WAITING_LIST_TICKET_NOT_FOUND: "toast.orderSubmitFailed",
  WAITING_LIST_TICKET_NOT_ACTIVE: "toast.orderSubmitFailed",
  WAITING_LIST_PHONE_MISMATCH: "toast.invalidPhoneNumber",
  RATE_LIMIT_EXCEEDED: "errors.tooManyRequests",
  QUOTA_EXCEEDED: "errors.tooManyRequests",
};

const QR_ERROR_PREFIXES = ["TABLE_QR_", "SEAT_QR_"];
const identity = (key: string) => key;

/**
 * Keeps the order-submit UI's dedicated code registry while delegating all
 * envelope parsing and generic fallbacks to the shared resolver. In
 * particular, server messages are no longer regex-matched or displayed.
 */
const resolveOrderSubmitError = (error: unknown) => {
  const { code } = parseUserFacingError(error);
  const codeKeys = { ...ORDER_SUBMIT_ERROR_KEYS };

  if (code && QR_ERROR_PREFIXES.some((prefix) => code.startsWith(prefix))) {
    codeKeys[code] = "toast.orderSubmitQrInvalid";
  }

  return resolveUserFacingError(error, identity, { codeKeys });
};

export const getOrderSubmitErrorI18nKey = (error: unknown): string =>
  resolveOrderSubmitError(error).message;

/**
 * The registry's own answer, and nothing else — `undefined` when the failure
 * carried no code this table knows. Screens that submit an order without being
 * the checkout screen have their own copy for everything else, so they need to
 * ask whether these codes matched rather than taking the resolver's generic
 * fallback. Group ordering finalizes through the same `createOrder`, so the
 * host of a group hits exactly the same rules as a solo diner (#359).
 */
export const getOrderSubmitErrorCodeI18nKey = (
  error: unknown,
): string | undefined => {
  const resolved = resolveOrderSubmitError(error);
  return resolved.presentation === "code" ? resolved.message : undefined;
};
