import { parseUserFacingError } from "@makanmasak/shared/utils/user-facing-error";

/**
 * A diner entry point (reservation, booking, waiting list, coupon) the shop's
 * plan no longer includes answers 403 MODULE_NOT_ENABLED. The API client
 * rewrites every 403 to generic copy but keeps `code`, so this is the one place
 * that recognises it. Never say "plan" or "module" to a diner, and never invite
 * a retry: nothing they do will make it work.
 */
export type UnavailableFeature =
  | "reservation"
  | "serviceBooking"
  | "waitingList"
  | "coupon";

const MESSAGE_KEYS: Record<UnavailableFeature, string> = {
  reservation: "toast.orderSubmitModuleReservation",
  serviceBooking: "toast.orderSubmitModuleServiceBooking",
  waitingList: "toast.orderSubmitModuleWaitingList",
  coupon: "toast.couponModuleDisabled",
};

export const isModuleNotEnabled = (error: unknown): boolean =>
  parseUserFacingError(error).code === "MODULE_NOT_ENABLED";

export const moduleUnavailableI18nKey = (feature: UnavailableFeature) =>
  MESSAGE_KEYS[feature];
