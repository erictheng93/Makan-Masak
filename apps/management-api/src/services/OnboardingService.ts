/**
 * Onboarding Service
 *
 * Handles self-service onboarding application management
 */

import type {
  ManagementEnv,
  OnboardingApplication,
  OnboardingStatus,
  OnboardingPlanId,
  CreateApplicationRequest,
} from "../types";
import { TenantService } from "./TenantService";
import { randomBase36, randomBase36Upper } from "../utils/random";
import { createSubdomainBase } from "../utils/subdomain";
import {
  DEFAULT_BILLING_CYCLE_MS,
  PLAN_TIERS,
  passwordResetTokens,
  planIdToTier,
  restaurants,
  shopSubscriptions,
  TRIAL_DURATION_MS,
  users,
  ResendEmailProvider,
} from "@makanmasak/database";
import { generateUUID } from "@makanmasak/utils";
import {
  COUNTRY_PROFILES,
  normalizeCountryCode,
} from "@makanmasak/shared-types";
import bcrypt from "bcryptjs";
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  onboardingApplicationAuditEvents,
  onboardingApplicationRateLimits,
  onboardingApplications,
  onboardingCredentialDeliveries,
  tenants,
} from "../db/onboarding-tables";

/** Applications accepted per client IP per window. */
const APPLICATION_RATE_LIMIT = 5;
const APPLICATION_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const APPLICATION_RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;

type CredentialDeliveryChannel = "email" | "manual";
type CredentialDeliveryStatus = "sent" | "pending" | "failed";

/**
 * A record of what was handed over, not the credential itself: the setup link
 * embeds a live reset token, so it is built on demand from the platform token
 * instead of being stored here.
 */
interface CredentialDelivery {
  id: string;
  channel: CredentialDeliveryChannel;
  status: CredentialDeliveryStatus;
  recipientEmail: string;
  recipientName: string;
  setupPasswordExpiresAt: string;
  errorMessage?: string;
}

interface ProvisionedOwnerAccount {
  restaurantId: string;
  userId: string;
  username: string;
  setupPasswordToken: string;
  setupPasswordLink: string;
  setupPasswordExpiresAt: string;
}

interface ProvisionedRestaurantInput {
  id: string;
  businessName: string;
  contactEmail: string;
  phone: string;
  address: string;
  district: string;
  countryCode: unknown;
  city: string | null | undefined;
}

export function buildProvisionedRestaurantValues(
  application: ProvisionedRestaurantInput,
) {
  const countryCode = normalizeCountryCode(application.countryCode);
  if (!countryCode) {
    throw new Error("Unsupported onboarding country");
  }
  const profile = COUNTRY_PROFILES[countryCode];

  return {
    id: application.id,
    name: application.businessName,
    type: "onboarding" as const,
    category: "restaurant" as const,
    description: null,
    address: application.address,
    district: application.district,
    city: application.city ?? profile.cities[0],
    countryCode: profile.countryCode,
    timezone: profile.timezone,
    settings: { currency: profile.currency },
    phone: application.phone,
    email: application.contactEmail,
    isAvailable: false,
    isActive: true,
  };
}

export class OnboardingService {
  private env: ManagementEnv;
  private tenantService: TenantService;

  constructor(env: ManagementEnv) {
    this.env = env;
    this.tenantService = new TenantService(env);
  }

  /**
   * Check if a subdomain is available
   * Checks both tenants and pending applications
   */
  async checkSubdomainAvailability(
    subdomain: string,
  ): Promise<{ available: boolean; suggestions?: string[] }> {
    const normalizedSubdomain = subdomain.toLowerCase().trim();

    // Check tenants table
    const existingTenant =
      await this.tenantService.getTenantBySubdomain(normalizedSubdomain);
    if (existingTenant) {
      return {
        available: false,
        suggestions: this.generateSubdomainSuggestions(normalizedSubdomain),
      };
    }

    // Check pending applications
    const existingApplication = await this.env.MANAGEMENT_DB.prepare(
      `SELECT id FROM onboarding_applications
       WHERE assigned_subdomain = ? AND status NOT IN ('rejected', 'completed')`,
    )
      .bind(normalizedSubdomain)
      .first();

    if (existingApplication) {
      return {
        available: false,
        suggestions: this.generateSubdomainSuggestions(normalizedSubdomain),
      };
    }

    return { available: true };
  }

  /**
   * Create a new onboarding application
   */
  async createApplication(
    data: CreateApplicationRequest,
    metadata?: { ipAddress?: string; userAgent?: string },
  ): Promise<OnboardingApplication> {
    const id = this.generateApplicationId();
    const now = new Date().toISOString();
    const applicationSecret = this.generateApplicationSecret();
    const applicationSecretHash =
      await this.hashApplicationSecret(applicationSecret);

    let assignedSubdomain = this.generateSubdomain(data.businessName);

    // Ensure generated subdomain is also available
    let attempts = 0;
    while (attempts < 5) {
      const check = await this.checkSubdomainAvailability(assignedSubdomain);
      if (check.available) break;
      assignedSubdomain = this.generateSubdomain(data.businessName);
      attempts++;
    }

    const finalAvailability =
      await this.checkSubdomainAvailability(assignedSubdomain);
    if (!finalAvailability.available) {
      throw new Error("Unable to generate an available subdomain");
    }

    const managementDb = drizzle(this.env.MANAGEMENT_DB);
    await managementDb.insert(onboardingApplications).values({
      id,
      businessName: data.businessName,
      contactName: data.contactName,
      contactEmail: data.contactEmail,
      contactPhone: data.contactPhone,
      address: data.address ?? null,
      district: data.district ?? null,
      city: data.city,
      countryCode: data.countryCode,
      marketId: data.marketId ?? null,
      stallNumber: data.stallNumber ?? null,
      planId: data.planId ?? "trial",
      latitude: data.latitude,
      longitude: data.longitude,
      requestedSubdomain: null,
      assignedSubdomain,
      status: "submitted",
      applicationSecretHash,
      ipAddress: metadata?.ipAddress || null,
      userAgent: metadata?.userAgent || null,
      createdAt: now,
      submittedAt: now,
      updatedAt: now,
    });

    return {
      ...(await this.getApplication(id))!,
      applicationSecret,
    };
  }

  /**
   * Atomically consume one application submission slot for a Cloudflare IP.
   * D1's conditional UPSERT is used instead of KV so parallel Worker requests
   * cannot all observe the same stale count and exceed the limit.
   */
  async consumeApplicationRateLimit(clientIp: string): Promise<boolean> {
    const nowMs = Date.now();
    const windowStartedAtMs =
      nowMs - (nowMs % APPLICATION_RATE_LIMIT_WINDOW_MS);
    const managementDb = drizzle(this.env.MANAGEMENT_DB);

    // The conditional upsert both admits and counts in one statement, so
    // parallel Workers cannot all read the same stale count and overshoot.
    const admitted = await managementDb
      .insert(onboardingApplicationRateLimits)
      .values({ clientIp, windowStartedAtMs, requestCount: 1 })
      .onConflictDoUpdate({
        target: [
          onboardingApplicationRateLimits.clientIp,
          onboardingApplicationRateLimits.windowStartedAtMs,
        ],
        set: {
          requestCount: sql`${onboardingApplicationRateLimits.requestCount} + 1`,
        },
        setWhere: sql`${onboardingApplicationRateLimits.requestCount} < ${APPLICATION_RATE_LIMIT}`,
      })
      .returning({
        requestCount: onboardingApplicationRateLimits.requestCount,
      });

    // Best-effort retention; admission is still decided solely by the atomic
    // statement above if this cleanup is delayed or fails.
    try {
      await managementDb
        .delete(onboardingApplicationRateLimits)
        .where(
          lt(
            onboardingApplicationRateLimits.windowStartedAtMs,
            windowStartedAtMs - APPLICATION_RATE_LIMIT_RETENTION_MS,
          ),
        );
    } catch (error) {
      console.error("[OnboardingService] Rate-limit cleanup failed:", error);
    }

    return admitted.length > 0;
  }

  /** Notify platform operators without making applicant submission depend on Slack. */
  async notifyPlatformOfNewApplication(
    application: OnboardingApplication,
  ): Promise<void> {
    if (!this.env.SLACK_WEBHOOK_URL) {
      if (this.env.NODE_ENV === "production") {
        console.error(
          "[OnboardingService] SLACK_WEBHOOK_URL is not configured; platform notification skipped",
        );
      }
      return;
    }

    try {
      const response = await fetch(this.env.SLACK_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // The business name is applicant-supplied. Slack parses <!channel>
          // and <http://…|text> out of message text, so an unescaped name
          // could ping everyone or disguise a link.
          text: [
            "New MakanMasak onboarding application",
            `Business: ${this.escapeSlackText(application.businessName)}`,
            `Application ID: ${application.id}`,
            `Review: ${this.buildAdminOnboardingLink()}`,
          ].join("\n"),
        }),
      });
      if (!response.ok) {
        console.error(
          `[OnboardingService] Application notification returned ${response.status}`,
        );
      }
    } catch (error) {
      console.error(
        "[OnboardingService] Application notification failed:",
        error,
      );
    }
  }

  /** Send the applicant a resumable status URL; the secret stays in its fragment. */
  async sendApplicationReceivedEmail(
    application: OnboardingApplication,
    applicationSecret: string,
  ): Promise<void> {
    if (
      this.env.ONBOARDING_EMAIL_ENABLED !== "true" ||
      !this.env.ONBOARDING_EMAIL_FROM ||
      !this.env.RESEND_API_KEY
    ) {
      if (this.env.ONBOARDING_EMAIL_ENABLED === "true") {
        console.error(
          "[OnboardingService] Applicant receipt email is enabled but sender or Resend key is missing",
        );
      }
      return;
    }

    const statusLink = this.buildApplicationStatusLink(
      application.id,
      applicationSecret,
    );
    const text = [
      `${application.contactName} 您好：`,
      "",
      `我們已收到「${application.businessName}」的申請，正在審核中。`,
      `您可隨時在此查看申請狀態：${statusLink}`,
    ].join("\n");

    try {
      const result = await new ResendEmailProvider(
        this.env.RESEND_API_KEY,
        this.env.ONBOARDING_EMAIL_FROM,
      ).sendEmail({
        to: application.contactEmail,
        subject: `MakanMasak 已收到「${application.businessName}」的申請`,
        html: `<pre>${this.escapeHtml(text)}</pre>`,
        text,
      });
      if (!result.success) {
        console.error(
          "[OnboardingService] Application received email failed:",
          result.error,
        );
      }
    } catch (error) {
      console.error(
        "[OnboardingService] Application received email failed:",
        error,
      );
    }
  }

  /**
   * Get an application by ID
   */
  async getApplication(id: string): Promise<OnboardingApplication | null> {
    const result = await this.env.MANAGEMENT_DB.prepare(
      "SELECT * FROM onboarding_applications WHERE id = ?",
    )
      .bind(id)
      .first();

    if (!result) return null;

    return this.mapRowToApplication(result as Record<string, unknown>);
  }

  /**
   * Get an application by email
   */
  async getApplicationByEmail(
    email: string,
  ): Promise<OnboardingApplication | null> {
    const result = await this.env.MANAGEMENT_DB.prepare(
      `SELECT * FROM onboarding_applications
       WHERE contact_email = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(email)
      .first();

    if (!result) return null;

    return this.mapRowToApplication(result as Record<string, unknown>);
  }

  async listApplications(input: {
    status?: OnboardingStatus;
    page?: number;
    limit?: number;
  }): Promise<{
    applications: OnboardingApplication[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = Math.max(input.page ?? 1, 1);
    const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
    const offset = (page - 1) * limit;
    const whereClause = input.status ? "WHERE status = ?" : "";
    const bindings = input.status ? [input.status] : [];

    const countResult = await this.env.MANAGEMENT_DB.prepare(
      `SELECT COUNT(*) AS count FROM onboarding_applications ${whereClause}`,
    )
      .bind(...bindings)
      .first<{ count: number }>();

    const result = await this.env.MANAGEMENT_DB.prepare(
      `SELECT * FROM onboarding_applications
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(...bindings, limit, offset)
      .all<Record<string, unknown>>();

    return {
      applications: (result.results ?? []).map((row) =>
        this.mapRowToApplication(row),
      ),
      total: Number(countResult?.count ?? 0),
      page,
      limit,
    };
  }

  /**
   * Verify the one-time secret returned when an application is created.
   */
  async verifyApplicationSecret(
    applicationId: string,
    applicationSecret: string,
  ): Promise<boolean> {
    if (!applicationId || !applicationSecret) return false;

    const result = await this.env.MANAGEMENT_DB.prepare(
      "SELECT application_secret_hash FROM onboarding_applications WHERE id = ?",
    )
      .bind(applicationId)
      .first<{ application_secret_hash?: string | null }>();

    if (!result?.application_secret_hash) return false;

    const providedHash = await this.hashApplicationSecret(applicationSecret);
    return this.constantTimeEqual(result.application_secret_hash, providedHash);
  }

  /**
   * Activate an approved application and create the tenant.
   */
  private async activateApplication(applicationId: string): Promise<{
    success: boolean;
    tenantId?: string;
    subdomain?: string;
    ownerAccount?: ProvisionedOwnerAccount;
    credentialDelivery?: CredentialDelivery;
    error?: string;
  }> {
    const application = await this.getApplication(applicationId);

    if (!application) {
      return { success: false, error: "Application not found" };
    }

    if (application.status !== "submitted") {
      return {
        success: false,
        error: `Cannot complete application with status: ${application.status}`,
      };
    }

    if (!application.assignedSubdomain) {
      return {
        success: false,
        error: "Assigned subdomain is missing",
      };
    }

    const countryCode = normalizeCountryCode(application.countryCode);
    if (!countryCode) {
      return { success: false, error: "Unsupported onboarding country" };
    }
    application.countryCode = countryCode;

    const now = new Date().toISOString();
    const previousStatus = application.status;
    let tenantId: string | undefined;
    let ownerAccount: ProvisionedOwnerAccount | undefined;
    let credentialDelivery: CredentialDelivery | undefined;

    try {
      // Update status to provisioning
      await this.updateApplicationStatus(applicationId, "provisioning");

      const tenant = await this.createTenantWithSubscription(application);
      tenantId = tenant.id;
      ownerAccount = await this.createPlatformOwnerAccount(
        application,
        tenant.id,
      );
      credentialDelivery = await this.createCredentialDelivery(
        application,
        tenant.id,
        ownerAccount,
      );

      // Mark application as completed
      await this.env.MANAGEMENT_DB.prepare(
        `UPDATE onboarding_applications
         SET status = ?, tenant_id = ?, completed_at = ?, updated_at = ?
         WHERE id = ?`,
      )
        .bind("completed", tenant.id, now, now, applicationId)
        .run();
      try {
        credentialDelivery = await this.dispatchCredentialDelivery(
          application,
          ownerAccount,
          credentialDelivery,
        );
      } catch (error) {
        console.error("[OnboardingService] Credential delivery error:", error);
        credentialDelivery = {
          ...credentialDelivery,
          status: "failed",
          errorMessage:
            error instanceof Error
              ? error.message
              : "Failed to dispatch credential delivery",
        };
      }

      return {
        success: true,
        tenantId: tenant.id,
        subdomain: application.assignedSubdomain,
        ownerAccount,
        credentialDelivery,
      };
    } catch (error) {
      console.error("[OnboardingService] Complete error:", error);

      if (credentialDelivery) {
        const deliveryId = credentialDelivery.id;
        await this.runRollbackStep("credential delivery", () =>
          this.rollbackCredentialDelivery(deliveryId),
        );
      }
      if (ownerAccount) {
        const accountToRollback = ownerAccount;
        await this.runRollbackStep("platform owner account", () =>
          this.rollbackPlatformOwnerAccount(accountToRollback),
        );
      }
      if (tenantId) {
        const tenantIdToRollback = tenantId;
        await this.runRollbackStep("tenant provisioning", () =>
          this.rollbackTenantProvisioning(tenantIdToRollback),
        );
      }

      // Rollback status
      await this.runRollbackStep("application status", () =>
        this.updateApplicationStatus(applicationId, previousStatus),
      );

      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to complete application",
      };
    }
  }

  async approveApplication(applicationId: string): Promise<{
    success: boolean;
    tenantId?: string;
    subdomain?: string;
    ownerAccount?: ProvisionedOwnerAccount;
    credentialDelivery?: CredentialDelivery;
    status?: OnboardingStatus;
    error?: string;
  }> {
    const application = await this.getApplication(applicationId);
    if (!application) return { success: false, error: "Application not found" };
    if (application.status === "completed") {
      return {
        success: true,
        tenantId: application.tenantId,
        subdomain: application.assignedSubdomain,
        ownerAccount: await this.getProvisionedOwnerAccount(application),
        credentialDelivery: await this.getCredentialDelivery(application.id),
        status: "completed",
      };
    }
    if (application.status !== "submitted") {
      return {
        success: false,
        error: `Cannot approve application with status: ${application.status}`,
      };
    }

    const result = await this.activateApplication(applicationId);
    return {
      ...result,
      status: result.success ? "completed" : undefined,
    };
  }

  async rejectApplication(
    applicationId: string,
    reason: string,
    actor?: { id: string; email: string },
  ): Promise<{
    success: boolean;
    status?: OnboardingStatus;
    rejectionReason?: string;
    rejectedAtMs?: number;
    error?: string;
  }> {
    const application = await this.getApplication(applicationId);
    if (!application) return { success: false, error: "Application not found" };
    if (
      ["completed", "provisioning", "rejected"].includes(application.status)
    ) {
      return {
        success: false,
        error: `Cannot reject application with status: ${application.status}`,
      };
    }

    const rejectedAtMs = Date.now();
    const managementDb = drizzle(this.env.MANAGEMENT_DB);
    await managementDb
      .update(onboardingApplications)
      .set({
        status: "rejected",
        rejectionReason: reason,
        rejectedAtMs,
        // updated_at predates the timestamp rule and is still TEXT on this
        // table; rejected_at_ms is the new column and carries the epoch.
        updatedAt: new Date(rejectedAtMs).toISOString(),
      })
      .where(eq(onboardingApplications.id, applicationId));
    await this.writeApplicationAuditEvent(applicationId, "rejected", actor, {
      reason,
    });
    await this.sendApplicationRejectionEmail(application, reason);
    return {
      success: true,
      status: "rejected",
      rejectionReason: reason,
      rejectedAtMs,
    };
  }

  async regenerateSetupPasswordLink(
    applicationId: string,
    actor: { id: string; email: string },
  ): Promise<{
    success: boolean;
    ownerAccount?: ProvisionedOwnerAccount;
    credentialDelivery?: CredentialDelivery;
    error?: string;
  }> {
    const application = await this.getApplication(applicationId);
    if (!application) return { success: false, error: "Application not found" };
    if (application.status !== "completed" || !application.tenantId) {
      return { success: false, error: "Application has not been approved" };
    }
    if (!this.env.PLATFORM_DB) {
      return { success: false, error: "Platform DB binding is not configured" };
    }

    const managementDb = drizzle(this.env.MANAGEMENT_DB);
    const [tenant] = await managementDb
      .select({
        platformRestaurantId: tenants.platformRestaurantId,
        ownerUserId: tenants.ownerUserId,
        ownerUsername: tenants.ownerUsername,
      })
      .from(tenants)
      .where(eq(tenants.id, application.tenantId))
      .limit(1);
    if (
      !tenant?.platformRestaurantId ||
      !tenant.ownerUserId ||
      !tenant.ownerUsername
    ) {
      return { success: false, error: "Owner account is unavailable" };
    }

    const nowMs = Date.now();
    const setupPasswordToken = crypto.randomUUID();
    const setupPasswordExpiresAtMs = nowMs + 24 * 60 * 60 * 1000;
    const ownerAccount: ProvisionedOwnerAccount = {
      restaurantId: tenant.platformRestaurantId,
      userId: tenant.ownerUserId,
      username: tenant.ownerUsername,
      setupPasswordToken,
      setupPasswordLink: this.buildSetupPasswordLink(setupPasswordToken),
      setupPasswordExpiresAt: new Date(setupPasswordExpiresAtMs).toISOString(),
    };

    // One batch: any link already handed out stops working at the same moment
    // the replacement becomes valid.
    const platformDb = drizzle(this.env.PLATFORM_DB);
    await platformDb.batch([
      platformDb
        .update(passwordResetTokens)
        .set({ usedAt: new Date(nowMs) })
        .where(
          and(
            eq(passwordResetTokens.userId, ownerAccount.userId),
            isNull(passwordResetTokens.usedAt),
          ),
        ),
      platformDb.insert(passwordResetTokens).values({
        userId: ownerAccount.userId,
        token: setupPasswordToken,
        tokenType: "email",
        otpCode: null,
        expiresAt: new Date(setupPasswordExpiresAtMs),
        usedAt: null,
        ipAddress: null,
        userAgent: "management-onboarding-regeneration",
        createdAt: new Date(nowMs),
      }),
    ]);

    const pendingDelivery = await this.createCredentialDelivery(
      application,
      application.tenantId,
      ownerAccount,
    );
    const delivery = await this.dispatchCredentialDelivery(
      application,
      ownerAccount,
      pendingDelivery,
    );
    await this.writeApplicationAuditEvent(
      applicationId,
      "setup_link_regenerated",
      actor,
      {
        deliveryId: delivery.id,
      },
    );
    return { success: true, ownerAccount, credentialDelivery: delivery };
  }

  /**
   * Update application status
   */
  async updateApplicationStatus(
    id: string,
    status: OnboardingStatus,
  ): Promise<void> {
    await this.env.MANAGEMENT_DB.prepare(
      `UPDATE onboarding_applications SET status = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(status, new Date().toISOString(), id)
      .run();
  }

  // ============================================================
  // Helper Methods
  // ============================================================

  private generateApplicationId(): string {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
    const random = randomBase36Upper(8);
    return `APP-${dateStr}-${random}`;
  }

  private generateApplicationSecret(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return `onb_${this.base64UrlEncode(bytes)}`;
  }

  private async hashApplicationSecret(secret: string): Promise<string> {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(secret),
    );
    return `sha256:${this.base64UrlEncode(new Uint8Array(digest))}`;
  }

  private base64UrlEncode(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  private constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;

    let result = 0;
    for (let index = 0; index < a.length; index++) {
      result |= a.charCodeAt(index) ^ b.charCodeAt(index);
    }
    return result === 0;
  }

  private generateSubdomain(businessName: string): string {
    const base = createSubdomainBase(businessName);

    // Add random suffix for uniqueness
    const suffix = randomBase36(6);
    return base ? `${base}-${suffix}` : `tenant-${suffix}`;
  }

  private generateSubdomainSuggestions(base: string): string[] {
    const suggestions: string[] = [];
    const suffixes = [randomBase36(6), randomBase36(6), randomBase36(6)];

    for (const suffix of suffixes) {
      suggestions.push(`${base}-${suffix}`);
    }

    return suggestions;
  }

  private async createTenantWithSubscription(
    application: OnboardingApplication,
  ) {
    const tenant = await this.tenantService.provisionTenantWithSubscription({
      businessName: application.businessName,
      contactEmail: application.contactEmail,
      contactPhone: application.contactPhone,
      latitude: application.latitude ?? null,
      longitude: application.longitude ?? null,
      planId: application.planId,
      subdomain: application.assignedSubdomain,
    });
    if (!tenant) {
      throw new Error("Tenant creation failed");
    }

    return tenant;
  }

  private async createPlatformOwnerAccount(
    application: OnboardingApplication,
    tenantId: string,
  ): Promise<ProvisionedOwnerAccount> {
    if (!this.env.PLATFORM_DB) {
      throw new Error("Platform DB binding is not configured");
    }

    const nowMs = Date.now();
    // Platform domain IDs must be UUID v7: apps/image-processor rejects any
    // access token whose `sub` is not v7 (middleware/auth.ts UUID_V7_PATTERN),
    // so a v4 owner id would silently break menu image uploads for this tenant.
    const restaurantId = generateUUID();
    const userId = generateUUID();
    const username = await this.generateAvailableOwnerUsername(application);
    const passwordHash = await bcrypt.hash(this.generateUnusablePassword(), 10);
    // Security token, not a domain id — keep v4. UUID v7 embeds a timestamp and
    // carries 74 random bits instead of v4's 122, which weakens a setup link.
    const setupPasswordToken = crypto.randomUUID();
    const setupPasswordExpiresAtMs = nowMs + 24 * 60 * 60 * 1000;
    // The platform API's moduleGate middleware reads shop_subscriptions from the
    // PLATFORM DB keyed by restaurant_id. TenantService only writes the
    // management-side row (keyed by tenant id), so without this the owner gets
    // SUBSCRIPTION_NOT_FOUND on every module-gated endpoint.
    // Tier mapping is shared with TenantService via planIdToTier so both sides
    // stay consistent.
    const planTier = planIdToTier(application.planId);
    const isTrial = planTier === PLAN_TIERS.TRIAL;
    const ownerAccount: ProvisionedOwnerAccount = {
      restaurantId,
      userId,
      username,
      setupPasswordToken,
      setupPasswordLink: this.buildSetupPasswordLink(setupPasswordToken),
      setupPasswordExpiresAt: new Date(setupPasswordExpiresAtMs).toISOString(),
    };

    const platformDb = drizzle(this.env.PLATFORM_DB);

    try {
      await platformDb.batch([
        platformDb.insert(restaurants).values({
          ...buildProvisionedRestaurantValues({
            id: restaurantId,
            businessName: application.businessName,
            contactEmail: application.contactEmail,
            countryCode: application.countryCode,
            city: application.city,
            phone: this.initialRestaurantPhone(application),
            address:
              application.address?.trim() ||
              this.initialRestaurantAddress(application),
            district:
              application.district ??
              this.initialRestaurantDistrict(application),
          }),
          latitude: application.latitude ?? null,
          longitude: application.longitude ?? null,
          createdAt: new Date(nowMs),
          updatedAt: new Date(nowMs),
        }),
        platformDb.insert(users).values({
          id: userId,
          username,
          email: application.contactEmail,
          phone: application.contactPhone || null,
          fullName: application.contactName,
          passwordHash,
          role: 1,
          restaurantId,
          isActive: true,
          isVerified: false,
          totalOrders: 0,
          totalSpent: 0,
          tokenVersion: 1,
          createdAt: new Date(nowMs),
          updatedAt: new Date(nowMs),
        }),
        // Must come after the restaurants insert: restaurant_id is an FK.
        platformDb.insert(shopSubscriptions).values({
          id: generateUUID(),
          restaurantId,
          planTier,
          moduleOverrides: {},
          isActive: true,
          trialEndsAt: isTrial ? new Date(nowMs + TRIAL_DURATION_MS) : null,
          billingCycleStartAt: isTrial ? null : new Date(nowMs),
          billingCycleEndAt: isTrial
            ? null
            : new Date(nowMs + DEFAULT_BILLING_CYCLE_MS),
          notes: `Provisioned from onboarding application ${application.id}`,
          createdAt: new Date(nowMs),
          updatedAt: new Date(nowMs),
        }),
        platformDb.insert(passwordResetTokens).values({
          userId,
          token: setupPasswordToken,
          tokenType: "email",
          otpCode: null,
          expiresAt: new Date(setupPasswordExpiresAtMs),
          usedAt: null,
          ipAddress: null,
          userAgent: "management-onboarding",
          createdAt: new Date(nowMs),
        }),
      ]);

      await this.invalidateRestaurantListCache();

      await this.env.MANAGEMENT_DB.prepare(
        `UPDATE tenants
         SET platform_restaurant_id = ?, owner_user_id = ?, owner_username = ?,
             updated_at = ?
         WHERE id = ?`,
      )
        .bind(
          restaurantId,
          userId,
          username,
          new Date(nowMs).toISOString(),
          tenantId,
        )
        .run();

      return ownerAccount;
    } catch (error) {
      await this.runRollbackStep("platform owner account", () =>
        this.rollbackPlatformOwnerAccount(ownerAccount),
      );
      throw error;
    }
  }

  private async createCredentialDelivery(
    application: OnboardingApplication,
    tenantId: string,
    ownerAccount: ProvisionedOwnerAccount,
  ): Promise<CredentialDelivery> {
    const nowMs = Date.now();
    const channel =
      this.env.ONBOARDING_EMAIL_ENABLED === "true" ? "email" : "manual";
    const delivery: CredentialDelivery = {
      id: generateUUID(),
      channel,
      status: "pending",
      recipientEmail: application.contactEmail,
      recipientName: application.contactName,
      setupPasswordExpiresAt: ownerAccount.setupPasswordExpiresAt,
    };

    const managementDb = drizzle(this.env.MANAGEMENT_DB);
    await managementDb.insert(onboardingCredentialDeliveries).values({
      id: delivery.id,
      applicationId: application.id,
      tenantId,
      restaurantId: ownerAccount.restaurantId,
      userId: ownerAccount.userId,
      recipientEmail: delivery.recipientEmail,
      recipientName: delivery.recipientName,
      username: ownerAccount.username,
      setupPasswordExpiresAtMs: Date.parse(ownerAccount.setupPasswordExpiresAt),
      deliveryChannel: delivery.channel,
      status: delivery.status,
      errorMessage: delivery.errorMessage ?? null,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    });

    return delivery;
  }

  private async dispatchCredentialDelivery(
    application: OnboardingApplication,
    ownerAccount: ProvisionedOwnerAccount,
    delivery: CredentialDelivery,
  ): Promise<CredentialDelivery> {
    if (delivery.channel === "manual") {
      return delivery;
    }

    const emailResult = await this.sendSetupPasswordEmail(
      application,
      ownerAccount,
    );
    const updatedDelivery: CredentialDelivery = {
      ...delivery,
      status: emailResult.status,
      errorMessage: emailResult.errorMessage,
    };

    const managementDb = drizzle(this.env.MANAGEMENT_DB);
    await managementDb
      .update(onboardingCredentialDeliveries)
      .set({
        status: updatedDelivery.status,
        errorMessage: updatedDelivery.errorMessage ?? null,
        updatedAtMs: Date.now(),
      })
      .where(eq(onboardingCredentialDeliveries.id, delivery.id));

    return updatedDelivery;
  }

  private async rollbackPlatformOwnerAccount(
    ownerAccount: ProvisionedOwnerAccount,
  ): Promise<void> {
    if (!this.env.PLATFORM_DB) return;

    await this.runRollbackStep("platform password reset token", () =>
      this.env
        .PLATFORM_DB!.prepare(
          "DELETE FROM password_reset_tokens WHERE user_id = ?",
        )
        .bind(ownerAccount.userId)
        .run(),
    );
    await this.runRollbackStep("platform user", () =>
      this.env
        .PLATFORM_DB!.prepare("DELETE FROM users WHERE id = ?")
        .bind(ownerAccount.userId)
        .run(),
    );
    // Must be deleted before the restaurant row: shop_subscriptions.restaurant_id
    // is an FK onto restaurants.id.
    await this.runRollbackStep("platform shop subscription", () =>
      this.env
        .PLATFORM_DB!.prepare(
          "DELETE FROM shop_subscriptions WHERE restaurant_id = ?",
        )
        .bind(ownerAccount.restaurantId)
        .run(),
    );
    await this.runRollbackStep("platform restaurant", () =>
      this.env
        .PLATFORM_DB!.prepare("DELETE FROM restaurants WHERE id = ?")
        .bind(ownerAccount.restaurantId)
        .run(),
    );
  }

  private async runRollbackStep(
    step: string,
    operation: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await operation();
    } catch (rollbackError) {
      console.error(
        `[OnboardingService] Rollback failed during ${step}:`,
        rollbackError,
      );
    }
  }

  private async rollbackCredentialDelivery(deliveryId: string): Promise<void> {
    const managementDb = drizzle(this.env.MANAGEMENT_DB);
    await managementDb
      .delete(onboardingCredentialDeliveries)
      .where(eq(onboardingCredentialDeliveries.id, deliveryId))
      .run();
  }

  private async getProvisionedOwnerAccount(
    application: OnboardingApplication,
  ): Promise<ProvisionedOwnerAccount | undefined> {
    if (!this.env.PLATFORM_DB || !application.tenantId) return undefined;

    const tenant = await this.env.MANAGEMENT_DB.prepare(
      `SELECT platform_restaurant_id, owner_user_id, owner_username
       FROM tenants WHERE id = ?`,
    )
      .bind(application.tenantId)
      .first<{
        platform_restaurant_id?: string | null;
        owner_user_id?: string | null;
        owner_username?: string | null;
      }>();

    if (
      !tenant?.platform_restaurant_id ||
      !tenant.owner_user_id ||
      !tenant.owner_username
    ) {
      return undefined;
    }

    const resetToken = await this.env.PLATFORM_DB.prepare(
      `SELECT token, expires_at_ms
       FROM password_reset_tokens
       WHERE user_id = ? AND used_at_ms IS NULL AND expires_at_ms > ?
       ORDER BY expires_at_ms DESC
       LIMIT 1`,
    )
      .bind(tenant.owner_user_id, Date.now())
      .first<{ token: string; expires_at_ms: number }>();

    if (!resetToken) return undefined;

    return {
      restaurantId: tenant.platform_restaurant_id,
      userId: tenant.owner_user_id,
      username: tenant.owner_username,
      setupPasswordToken: resetToken.token,
      setupPasswordLink: this.buildSetupPasswordLink(resetToken.token),
      setupPasswordExpiresAt: new Date(resetToken.expires_at_ms).toISOString(),
    };
  }

  private async getCredentialDelivery(
    applicationId: string,
  ): Promise<CredentialDelivery | undefined> {
    const managementDb = drizzle(this.env.MANAGEMENT_DB);
    const [row] = await managementDb
      .select()
      .from(onboardingCredentialDeliveries)
      .where(eq(onboardingCredentialDeliveries.applicationId, applicationId))
      .orderBy(desc(onboardingCredentialDeliveries.createdAtMs))
      .limit(1);

    if (!row) return undefined;

    return {
      id: row.id,
      channel: row.deliveryChannel as CredentialDeliveryChannel,
      status: row.status as CredentialDeliveryStatus,
      recipientEmail: row.recipientEmail,
      recipientName: row.recipientName,
      setupPasswordExpiresAt: new Date(
        row.setupPasswordExpiresAtMs,
      ).toISOString(),
      errorMessage: row.errorMessage ?? undefined,
    };
  }

  private async rollbackTenantProvisioning(tenantId: string): Promise<void> {
    await this.runRollbackStep("management shop subscription", () =>
      this.env.MANAGEMENT_DB.prepare(
        "DELETE FROM shop_subscriptions WHERE restaurant_id = ?",
      )
        .bind(tenantId)
        .run(),
    );
    await this.runRollbackStep("management tenant", () =>
      this.env.MANAGEMENT_DB.prepare("DELETE FROM tenants WHERE id = ?")
        .bind(tenantId)
        .run(),
    );
  }

  private async invalidateRestaurantListCache(): Promise<void> {
    const prefix = "restaurants:list";
    let cursor: string | undefined;

    do {
      const list = await this.env.CACHE_KV.list({ prefix, cursor });
      const keys = list.keys.filter(
        ({ name }) => name === prefix || name.startsWith(`${prefix}:`),
      );

      await Promise.all(keys.map(({ name }) => this.env.CACHE_KV.delete(name)));
      cursor = list.list_complete ? undefined : list.cursor;
    } while (cursor);
  }

  private async generateAvailableOwnerUsername(
    application: OnboardingApplication,
  ): Promise<string> {
    const base = this.slugifyUsername(
      application.contactEmail.split("@")[0] ||
        application.assignedSubdomain ||
        application.businessName,
    );

    for (let attempt = 0; attempt < 10; attempt++) {
      const username =
        attempt === 0 ? base : `${base}-${randomBase36(4).toLowerCase()}`;
      const existing = await this.env
        .PLATFORM_DB!.prepare("SELECT id FROM users WHERE username = ? LIMIT 1")
        .bind(username)
        .first();
      if (!existing) return username;
    }

    return `${base}-${crypto.randomUUID().slice(0, 8)}`;
  }

  /**
   * The result must pass apps/api's login schema, which only accepts
   * /^[a-zA-Z0-9_-]+$/. Keeping the "." from an email local part such as
   * "tan.mei" produced an owner who could set a password and then never log in:
   * login rejects the username with VALIDATION_ERROR before checking it.
   */
  private slugifyUsername(value: string): string {
    const username = value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);

    return username.length >= 3 ? username : `owner-${randomBase36(6)}`;
  }

  private generateUnusablePassword(): string {
    return `disabled-${crypto.randomUUID()}-${randomBase36Upper(12)}`;
  }

  private initialRestaurantAddress(application: OnboardingApplication): string {
    if (
      typeof application.latitude === "number" &&
      typeof application.longitude === "number"
    ) {
      return `Onboarding GPS ${application.latitude.toFixed(6)}, ${application.longitude.toFixed(6)}`;
    }
    return `Onboarding application ${application.id}`;
  }

  private async writeApplicationAuditEvent(
    applicationId: string,
    eventType: string,
    actor: { id: string; email: string } | undefined,
    metadata: Record<string, string>,
  ): Promise<void> {
    const managementDb = drizzle(this.env.MANAGEMENT_DB);
    await managementDb.insert(onboardingApplicationAuditEvents).values({
      id: generateUUID(),
      applicationId,
      eventType,
      actorId: actor?.id ?? null,
      actorEmail: actor?.email ?? null,
      metadata: JSON.stringify(metadata),
      createdAtMs: Date.now(),
    });
  }

  private initialRestaurantDistrict(
    application: OnboardingApplication,
  ): string {
    return application.assignedSubdomain
      ? `onboarding-${application.assignedSubdomain}`
      : `onboarding-${application.id.toLowerCase()}`;
  }

  private initialRestaurantPhone(application: OnboardingApplication): string {
    const phone = application.contactPhone.trim();
    if (!phone) {
      throw new Error("Application contact phone is required");
    }

    return phone;
  }

  /** Rejection is persisted first; an email failure must never undo it. */
  private async sendApplicationRejectionEmail(
    application: OnboardingApplication,
    reason: string,
  ): Promise<void> {
    if (
      this.env.ONBOARDING_EMAIL_ENABLED !== "true" ||
      !this.env.ONBOARDING_EMAIL_FROM ||
      !this.env.RESEND_API_KEY
    ) {
      return;
    }

    const text = [
      `${application.contactName} 您好：`,
      "",
      `很抱歉，「${application.businessName}」的申請未能通過。`,
      `原因：${reason}`,
    ].join("\n");
    try {
      const result = await new ResendEmailProvider(
        this.env.RESEND_API_KEY,
        this.env.ONBOARDING_EMAIL_FROM,
      ).sendEmail({
        to: application.contactEmail,
        subject: `MakanMasak「${application.businessName}」申請結果`,
        html: `<pre>${this.escapeHtml(text)}</pre>`,
        text,
      });
      if (!result.success) {
        console.error(
          "[OnboardingService] Application rejection email failed:",
          result.error,
        );
      }
    } catch (error) {
      console.error(
        "[OnboardingService] Application rejection email failed:",
        error,
      );
    }
  }

  private async sendSetupPasswordEmail(
    application: OnboardingApplication,
    ownerAccount: ProvisionedOwnerAccount,
  ): Promise<{
    attempted: boolean;
    status: CredentialDeliveryStatus;
    errorMessage?: string;
  }> {
    if (this.env.ONBOARDING_EMAIL_ENABLED !== "true") {
      return { attempted: false, status: "pending" };
    }

    const fromEmail = this.env.ONBOARDING_EMAIL_FROM;
    if (!fromEmail) {
      return {
        attempted: true,
        status: "failed",
        errorMessage: "ONBOARDING_EMAIL_FROM is not configured",
      };
    }

    if (!this.env.RESEND_API_KEY) {
      return {
        attempted: true,
        status: "failed",
        errorMessage: "RESEND_API_KEY is not configured",
      };
    }

    try {
      const text = [
        `${application.contactName} 您好：`,
        "",
        `您的店家「${application.businessName}」已開通。`,
        `店主帳號：${ownerAccount.username}`,
        `請在此設定密碼：${ownerAccount.setupPasswordLink}`,
        `此連結將於 ${ownerAccount.setupPasswordExpiresAt} 到期。`,
      ].join("\n");
      const result = await new ResendEmailProvider(
        this.env.RESEND_API_KEY,
        fromEmail,
      ).sendEmail({
        to: application.contactEmail,
        subject: `MakanMasak「${application.businessName}」店主帳號開通`,
        html: `<pre>${text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</pre>`,
        text,
      });

      if (!result.success) {
        return {
          attempted: true,
          status: "failed",
          errorMessage: result.error ?? "Failed to send onboarding email",
        };
      }

      return { attempted: true, status: "sent" };
    } catch (error) {
      return {
        attempted: true,
        status: "failed",
        errorMessage:
          error instanceof Error
            ? error.message
            : "Failed to send onboarding email",
      };
    }
  }

  /**
   * The owner sets their password on the admin dashboard, so the link must be
   * built on that app. ADMIN_APP_URL says so explicitly; the CORS_ORIGIN
   * fallback only works while the admin origin happens to be listed first, and
   * reordering that allow-list would silently send owners to an app with no
   * /reset-password route.
   */
  private buildSetupPasswordLink(token: string): string {
    const baseUrl =
      this.env.ADMIN_APP_URL?.trim().replace(/\/+$/, "") ||
      this.firstConfiguredOrigin(this.env.CORS_ORIGIN) ||
      this.stripApiPath(this.env.API_BASE_URL) ||
      "http://localhost:3000";

    return `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
  }

  private buildApplicationStatusLink(
    applicationId: string,
    applicationSecret: string,
  ): string {
    const baseUrl =
      this.env.ONBOARDING_APP_URL ||
      this.firstConfiguredOrigin(this.env.CORS_ORIGIN) ||
      this.stripApiPath(this.env.API_BASE_URL) ||
      "http://localhost:3000";
    return `${baseUrl}/status/${encodeURIComponent(applicationId)}#${encodeURIComponent(applicationSecret)}`;
  }

  /**
   * Slack reads `<…>` as control sequences (`<!channel>`, `<url|label>`), so
   * applicant-supplied text must not carry them into a message.
   */
  private escapeSlackText(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  private buildAdminOnboardingLink(): string {
    const baseUrl =
      this.env.ADMIN_APP_URL?.trim().replace(/\/+$/, "") ||
      this.firstConfiguredOrigin(this.env.CORS_ORIGIN) ||
      this.stripApiPath(this.env.API_BASE_URL) ||
      "http://localhost:3001";
    return `${baseUrl}/dashboard/platform/onboarding`;
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  private firstConfiguredOrigin(value: string | undefined): string | undefined {
    if (!value || value.trim() === "*") return undefined;
    return value
      .split(",")
      .map((origin) => origin.trim())
      .find(Boolean);
  }

  private stripApiPath(value: string | undefined): string | undefined {
    if (!value) return undefined;
    return value.replace(/\/api(?:\/v\d+)?$/i, "").replace(/\/+$/, "");
  }

  private mapRowToApplication(
    row: Record<string, unknown>,
  ): OnboardingApplication {
    return {
      id: row.id as string,
      businessName: row.business_name as string,
      contactName: row.contact_name as string,
      contactEmail: row.contact_email as string,
      contactPhone: row.contact_phone as string,
      address: row.address as string | undefined,
      district: row.district as string | undefined,
      city: row.city as string,
      countryCode: row.country_code as OnboardingApplication["countryCode"],
      marketId: row.market_id as string | undefined,
      stallNumber: row.stall_number as string | undefined,
      planId: row.plan_id as OnboardingPlanId | null,
      latitude: row.latitude as number | undefined,
      longitude: row.longitude as number | undefined,
      requestedSubdomain: row.requested_subdomain as string | undefined,
      assignedSubdomain: row.assigned_subdomain as string | undefined,
      status: row.status as OnboardingStatus,
      rejectionReason: row.rejection_reason as string | undefined,
      rejectedAtMs: row.rejected_at_ms as number | undefined,
      tenantId: row.tenant_id as string | undefined,
      ipAddress: row.ip_address as string | undefined,
      userAgent: row.user_agent as string | undefined,
      createdAt: row.created_at as string,
      submittedAt: row.submitted_at as string | undefined,
      completedAt: row.completed_at as string | undefined,
      updatedAt: row.updated_at as string,
    };
  }
}
