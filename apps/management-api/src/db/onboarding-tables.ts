/**
 * Drizzle definitions for the control-plane (MANAGEMENT_DB) tables this app
 * writes. They live here rather than in @makanmasak/database because that
 * package describes the platform database; these tables only exist in the
 * management D1 and are migrated by apps/management-api/migrations.
 *
 * Queries go through these definitions so a column rename is a compile error
 * instead of a runtime 500 — the same reason the platform side bans raw SQL
 * strings in new code (CLAUDE.md, "Database Query Strategy").
 */

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const onboardingApplications = sqliteTable("onboarding_applications", {
  id: text("id").primaryKey(),
  businessName: text("business_name").notNull(),
  contactName: text("contact_name").notNull(),
  contactEmail: text("contact_email").notNull(),
  contactPhone: text("contact_phone").notNull(),
  address: text("address"),
  district: text("district"),
  city: text("city"),
  countryCode: text("country_code").notNull(),
  marketId: text("market_id"),
  stallNumber: text("stall_number"),
  planId: text("plan_id"),
  latitude: integer("latitude"),
  longitude: integer("longitude"),
  requestedSubdomain: text("requested_subdomain"),
  assignedSubdomain: text("assigned_subdomain"),
  status: text("status").notNull(),
  rejectionReason: text("rejection_reason"),
  rejectedAtMs: integer("rejected_at_ms"),
  tenantId: text("tenant_id"),
  applicationSecretHash: text("application_secret_hash"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: text("created_at").notNull(),
  submittedAt: text("submitted_at"),
  completedAt: text("completed_at"),
  updatedAt: text("updated_at").notNull(),
});

/**
 * No setup link is stored: it carries a live password-reset token, and the
 * token already lives (once) in the platform database. This table records who
 * was told what, and how it went.
 */
export const onboardingCredentialDeliveries = sqliteTable(
  "onboarding_credential_deliveries",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id").notNull(),
    tenantId: text("tenant_id").notNull(),
    restaurantId: text("restaurant_id").notNull(),
    userId: text("user_id").notNull(),
    recipientEmail: text("recipient_email").notNull(),
    recipientName: text("recipient_name").notNull(),
    username: text("username").notNull(),
    setupPasswordExpiresAtMs: integer("setup_password_expires_at_ms").notNull(),
    deliveryChannel: text("delivery_channel").notNull(),
    status: text("status").notNull(),
    errorMessage: text("error_message"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
);

export const onboardingApplicationRateLimits = sqliteTable(
  "onboarding_application_rate_limits",
  {
    clientIp: text("client_ip").notNull(),
    windowStartedAtMs: integer("window_started_at_ms").notNull(),
    requestCount: integer("request_count").notNull(),
  },
);

export const onboardingApplicationAuditEvents = sqliteTable(
  "onboarding_application_audit_events",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id").notNull(),
    eventType: text("event_type").notNull(),
    actorId: text("actor_id"),
    actorEmail: text("actor_email"),
    metadata: text("metadata"),
    createdAtMs: integer("created_at_ms").notNull(),
  },
);

/** Only the columns this service reads; TenantService owns the rest. */
export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey(),
  platformRestaurantId: text("platform_restaurant_id"),
  ownerUserId: text("owner_user_id"),
  ownerUsername: text("owner_username"),
});
