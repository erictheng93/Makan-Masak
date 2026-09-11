/**
 * API Response Contract Schemas — Central Barrel Export
 *
 * These schemas define the STABLE response shapes for all API endpoints.
 * Frontend clients depend on these shapes. Any change here is a potential
 * breaking change and should be reviewed carefully.
 *
 * Usage in contract tests:
 *   import { AuthContracts } from "../../contracts";
 *   assertMatchesSchema(AuthContracts.LoginResponse, actualResponse);
 *
 * Usage in breaking change detection:
 *   The scripts/check-api-contracts.cjs script imports these schemas
 *   and generates JSON snapshots for CI diffing.
 */

export * as ContractHelpers from "./helpers";
export * as AuthContracts from "./schemas/authentication";
export * as OrderContracts from "./schemas/orders";
export * as MenuContracts from "./schemas/menu";
export * as RestaurantContracts from "./schemas/restaurants";
export * as GuestOrderContracts from "./schemas/guest-orders";
export * as DiscoveryContracts from "./schemas/discovery";
export * as UserContracts from "./schemas/users";
export * as CouponContracts from "./schemas/coupons";
export * as WaitingListContracts from "./schemas/waiting-list";
export * as ReservationContracts from "./schemas/reservations";
export * as SeatContracts from "./schemas/seats";
export * as KitchenContracts from "./schemas/kitchen";
export * as POSContracts from "./schemas/pos";
export * as PartnershipContracts from "./schemas/partnerships";
export * as SchedulingContracts from "./schemas/scheduling";
export * as LeaveContracts from "./schemas/leaves";
export * as AnalyticsContracts from "./schemas/analytics";
export * as AIAnalyticsContracts from "./schemas/ai-analytics";
export * as GroupOrderContracts from "./schemas/group-orders";
export * as IntegrationContracts from "./schemas/integrations";
export * as CustomerContracts from "./schemas/customers";
export * as QRCodeContracts from "./schemas/qr-codes";
export * as ReviewContracts from "./schemas/reviews";
export * as BroadcastContracts from "./schemas/broadcasts";
