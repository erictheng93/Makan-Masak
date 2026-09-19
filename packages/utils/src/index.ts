/**
 * @makanmasak/utils
 *
 * Shared utilities for MakanMasak platform
 */

// Request deduplication
export {
  RequestDeduplicator,
  getDeduplicator,
  resetDeduplicator,
  deduplicate,
  withDeduplication,
  batchDedupe,
  type RequestCacheEntry,
  type RequestDeduplicationOptions,
} from "./request-deduplication";

// Axios deduplication interceptor
export {
  installAxiosDeduplication,
  skipDedup,
  withDedupTTL,
  combineConfigs,
} from "./axios-deduplication-interceptor";

// Error tracking
export {
  ErrorTracker,
  getErrorTracker,
  resetErrorTracker,
  type ErrorSeverity,
  type ErrorCategory,
  type ErrorContext,
  type ErrorBreadcrumb,
  type TrackedError,
  type ErrorTrackingOptions,
} from "./error-tracking";

// Performance monitoring
export {
  PerformanceMonitor,
  getPerformanceMonitor,
  resetPerformanceMonitor,
  type PerformanceMetric,
  type WebVitals,
  type ResourceTiming,
  type PerformanceReport,
  type PerformanceMonitorOptions,
} from "./performance-monitor";

// UUID utilities
export { generateUUID, isValidUUID, extractUUIDTimestamp } from "./uuid";

// Phone utilities
export { normalizeE164Phone } from "./phone";

// Validation schemas
export {
  uuidSchema,
  restaurantIdSchema,
  numericIdSchema,
  numericIdParamSchema,
  restaurantIdParamSchema,
  optionalRestaurantIdSchema,
  optionalNumericIdSchema,
  type UUID,
  type RestaurantId,
  type NumericId,
} from "./validation";

// Timestamp utilities
export {
  ensureMilliseconds,
  ensureSeconds,
  nowMs,
  nowSeconds,
  toMs,
  toSeconds,
  fromMs,
  fromSeconds,
  isMilliseconds,
  isSeconds,
} from "./timestamp";

// Encryption utilities
export {
  encrypt,
  decrypt,
  assertStrongEncryptionKey,
  resetEncryptionKeyCache,
  MIN_ENCRYPTION_KEY_LENGTH,
  type EncryptionOptions,
} from "./encryption";

// QR code signing utilities
export {
  signQRPayload,
  verifyQRSignature,
  buildSignedQRUrl,
  parseSignedQRUrl,
  type QRSigningParams,
  type SignedQRUrlParams,
} from "./qr-signing";

// API Error utilities
export {
  ApiError,
  notFound,
  badRequest,
  unauthorized,
  forbidden,
  conflict,
  sanitizeApiErrorDetails,
} from "./api-error";

// Currency utilities
export {
  formatCurrency,
  getCurrencySymbol,
  getCurrencyConfig,
  CURRENCY_CONFIGS,
  DEFAULT_CURRENCY,
  normalizeCurrencyCode,
  currencyStepCents,
  roundToCurrencyCents,
  isCurrencyAlignedCents,
  allocateCents,
  type CurrencyFormatConfig,
  type CurrencyCode,
} from "./currency";

// Currency-precision discount arithmetic and input validation
export {
  floorToCurrencyCents,
  percentOfCents,
  computeDiscountCents,
  assertCurrencyAlignedCents,
  isAlignedInEveryCurrency,
  type DiscountRule,
  type CurrencyPrecisionField,
} from "./money-rounding";

// Token utilities
export {
  decodeJwtPayload,
  isTokenExpired,
  getRefreshDelay,
  getTimeUntilExpiry,
} from "./token";
