// 統一導出所有型別
export * from "./database";
export * from "./api";
export * from "./user";
export * from "./restaurant";
export * from "./menu";
export * from "./service";
export * from "./order";
export * from "./table";
export * from "./seat";
export * from "./websocket";
export * from "./common";
export * from "./payment";
export * from "./stripe";
export * from "./printer";
export * from "./backup";
export * from "./pagination";
export * from "./scheduling";
export * from "./leaves";
export * from "./group-orders";
export * from "./realtime-events";
export * from "./reservation";
export * from "./schema-json-types";
export * from "./platform";
export * from "./forecast";
export * from "./ingredient";
export * from "./coupon";
export * from "./consents";
export * from "./auth-providers";
export * from "./broadcasts";

// Onboarding locale: the country a shop trades in decides its currency,
// timezone and phone format. See locale.ts for why it is the single source.
export {
  COUNTRY_PROFILES,
  SUPPORTED_COUNTRIES,
  citiesForCountry,
  normalizeCountryCode,
  type CountryProfile,
  type SupportedCountryCode,
} from "./locale";
