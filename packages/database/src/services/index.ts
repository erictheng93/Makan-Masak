// 匯出所有服務類別
export { BaseService } from "./base";
export { USER_ROLES } from "../schema";
export { RestaurantService } from "./restaurant";
export { MenuService } from "./menu";
export {
  assembleMenuItemOptions,
  backfillMenuItemOptions,
  loadAssembledMenuItemOptions,
} from "./menu-options";
export { OrderService, INVALID_CUSTOMIZATION_PREFIX } from "./order";
export { IngredientConsumptionService } from "./ingredient-consumption";
export { AuthService } from "./auth";
export { UserService } from "./user";
export { SessionService } from "./session";
export { TableService } from "./table";
export { SeatService } from "./seat";
export { AnalyticsService } from "./analytics";
export { ErrorReportingService } from "./error-reporting";
export { QRCodeService } from "./qrcode";
export { ImageService } from "./image";
export { CouponService } from "./coupon";
export { LeaveService } from "./LeaveService";
export { SchedulingService } from "./SchedulingService";
export type {
  ShiftTemplate,
  EmployeeSchedule,
  SchedulingConflict,
  ScheduleSwapRequest,
  ConflictCheckResult,
  ScheduleFilters,
  BulkScheduleData,
  ClockInData,
  ClockOutData,
} from "./SchedulingService";
export { ReservationService } from "./ReservationService";
export { WaitingListService } from "./WaitingListService";
export {
  CustomerWebPushService,
  type CustomerPushDispatchResult,
} from "./CustomerWebPushService";
export { isWebPushEnabled } from "./base";
export {
  NotificationService,
  // Pure provider-selection function: the API layer uses it to refuse email
  // flows in production when no vendor is configured, without building a
  // service just to ask.
  resolveEmailProviderName,
  type EmailProviderName,
  type EmailProviderEnv,
  type NotificationCategory,
  type NotificationPayload,
} from "./NotificationService";

// SMS vendors: one interface, vendor selected by SMS_PROVIDER config
export {
  createSmsProvider,
  resolveSmsProviderName,
  isSmsConfigured,
  toTaiwanLocalPhone,
  TwilioSmsProvider,
  MitakeSmsProvider,
  Every8dSmsProvider,
  NoopSmsProvider,
  type SmsProvider,
  type SmsProviderName,
  type SmsProviderEnv,
  type SmsSendResult,
} from "./sms";
export { ExportService } from "./ExportService";
export { LeaveAnalyticsService } from "./LeaveAnalyticsService";
export { PartnershipService } from "./PartnershipService";
export { VerificationService } from "./VerificationService";
export { FeedbackService } from "./FeedbackService";
export {
  RestaurantAlertService,
  type RaiseAlertInput,
} from "./RestaurantAlertService";
export {
  TenantMemberDirectoryService,
  type AuditActor,
  type TenantScope,
  type MemberListFilters,
  type TenantMemberListItem,
  type MemberListResult,
  type MemberContactRevealOutcome,
  type TenantMemberContact,
  type MemberPatch,
  type MemberUpdateOutcome,
  type MemberExportResult,
  type MemberRecomputeResult,
  MEMBER_EXPORT_MAX_ROWS,
} from "./TenantMemberDirectoryService";
export {
  PlatformCustomerDirectoryService,
  type PlatformCustomerListFilters,
  type PlatformCustomerListItem,
  type PlatformCustomerListResult,
  type PlatformCustomerRestaurantSlice,
  type PlatformCustomerContact,
  type PlatformContactRevealOutcome,
} from "./PlatformCustomerDirectoryService";
export { maskEmail, maskPhone } from "./pii-masking";
export {
  backfillCandidateOrderCountStatement,
  backfillPendingPairCountStatement,
  buildBackfillCandidateOrderCountQuery,
  buildBackfillPendingPairCountQuery,
  buildRestaurantCustomerBackfillQuery,
  restaurantCustomerBackfillStatement,
} from "./restaurant-customer-backfill";
export { businessNumber, prefixedUuid } from "./id-generation";

// Realtime broadcast: bridge to apps/realtime Durable Object
export {
  RealtimeBroadcastService,
  type BroadcastResult,
} from "./RealtimeBroadcastService";

// Ticket-primitives: shared utilities for waiting-list and queue ticket flows
export {
  WAITING_TRANSITIONS,
  isValidWaitingTransition,
  assertWaitingTransition,
} from "./ticket-primitives";

// 匯出類型定義
export type { CreateRestaurantData, UpdateRestaurantData } from "./restaurant";

export type {
  CreateMenuItemData,
  UpdateMenuItemData,
  MenuFilters,
  MenuItemOptionGroupState,
  OptionChoiceWithRestaurant,
  OptionGroupWithChoices,
  ReplaceMenuItemOptionGroupData,
} from "./menu";

export type {
  CreateOrderData,
  UpdateOrderStatusData,
  OrderFilters,
} from "./order";

export type {
  CreateErrorReportData,
  ErrorReportFilters,
  ErrorStats,
} from "./error-reporting";

export type {
  CreateQRCodeData,
  CreateQRTemplateData,
  QRStyleData,
  QRCodeStats,
} from "./qrcode";

export type {
  ImageAnalyticsOptions,
  StorageAnalytics,
  UsageAnalytics,
  PerformanceAnalytics,
  CreateImageData,
} from "./image";

export type {
  CouponValidationResult,
  CreateCouponData,
  UseCouponData,
  CouponFilters,
} from "./coupon";

export type {
  CreateTableData,
  UpdateTableData,
  TableFilters,
  QRCodeOptions,
  TableStats,
} from "./table";

export type {
  CreateSeatData,
  UpdateSeatData,
  SeatFilters,
  SeatNumberingOptions,
  SeatStats,
} from "./seat";

export type {
  LeaveType,
  LeaveBalance,
  LeaveRequest,
  LeaveRequestWithRelations,
  LeaveBalanceWithType,
  CreateLeaveTypeData,
  UpdateLeaveTypeData,
  CreateLeaveRequestData,
  LeaveRequestFilters,
  LeaveBalanceAdjustment,
} from "./LeaveService";

export type {
  PartnershipFilters,
  PlanFilters,
  MemberFilters,
  PlanValidationResult,
  MemberVerificationRequest,
  UsageStatistics,
} from "./PartnershipService";

export type {
  CreateFeedbackData,
  FeedbackFilters,
  FeedbackStats,
} from "./FeedbackService";
