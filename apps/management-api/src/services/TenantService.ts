/**
 * Tenant Service
 *
 * Handles tenant CRUD operations for the managed platform.
 */

import type {
  ManagementEnv,
  Tenant,
  TenantResource,
  UpdateTenantRequest,
  TenantStatus,
  OnboardingPlanId,
} from "../types";
import { generateUUID } from "@makanmasak/utils";
import { generateLicenseKey, randomBase36Upper } from "../utils/random";
import { createSubdomainBase } from "../utils/subdomain";
import {
  DEFAULT_BILLING_CYCLE_MS,
  planIdToTier,
  TRIAL_DURATION_MS,
} from "@makanmasak/database";

export class TenantService {
  private env: ManagementEnv;

  constructor(env: ManagementEnv) {
    this.env = env;
  }

  /**
   * List tenants with filtering and pagination
   */
  async listTenants(options: {
    page: number;
    limit: number;
    status?: TenantStatus;
    search?: string;
  }): Promise<{ tenants: Tenant[]; total: number }> {
    const { page, limit, status, search } = options;
    const offset = (page - 1) * limit;

    let query = `
      SELECT * FROM tenants
      WHERE 1=1
    `;
    const params: (string | number)[] = [];

    if (status) {
      query += " AND status = ?";
      params.push(status);
    }

    if (search) {
      query +=
        " AND (business_name LIKE ? OR contact_email LIKE ? OR subdomain LIKE ?)";
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    // Get total count
    const countQuery = query.replace("SELECT *", "SELECT COUNT(*) as count");
    const countResult = await this.env.MANAGEMENT_DB.prepare(countQuery)
      .bind(...params)
      .first<{ count: number }>();

    // Get paginated results
    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const result = await this.env.MANAGEMENT_DB.prepare(query)
      .bind(...params)
      .all<{
        id: string;
        business_name: string;
        contact_email: string;
        contact_phone: string;
        latitude: number | null;
        longitude: number | null;
        subdomain: string;
        custom_domain: string;
        deployed_version: string;
        license_tier: string;
        license_key: string;
        license_expires_at: string;
        status: TenantStatus;
        created_at: string;
        activated_at: string;
        updated_at: string;
      }>();

    const tenants: Tenant[] = result.results.map((row) =>
      this.mapRowToTenant(row),
    );

    return {
      tenants,
      total: countResult?.count || 0,
    };
  }

  /**
   * Get tenant by ID
   */
  async getTenantById(id: string): Promise<Tenant | null> {
    const result = await this.env.MANAGEMENT_DB.prepare(
      "SELECT * FROM tenants WHERE id = ?",
    )
      .bind(id)
      .first();

    if (!result) return null;

    return this.mapRowToTenant(result as Record<string, unknown>);
  }

  /**
   * Get tenant by subdomain
   */
  async getTenantBySubdomain(subdomain: string): Promise<Tenant | null> {
    const result = await this.env.MANAGEMENT_DB.prepare(
      "SELECT * FROM tenants WHERE subdomain = ?",
    )
      .bind(subdomain)
      .first();

    if (!result) return null;

    return this.mapRowToTenant(result as Record<string, unknown>);
  }

  async getTenantByPlatformRestaurantId(
    platformRestaurantId: string,
  ): Promise<Tenant | null> {
    const result = await this.env.MANAGEMENT_DB.prepare(
      "SELECT * FROM tenants WHERE platform_restaurant_id = ?",
    )
      .bind(platformRestaurantId)
      .first();

    if (!result) return null;

    return this.mapRowToTenant(result as Record<string, unknown>);
  }

  async generateAvailableSubdomain(businessName: string): Promise<string> {
    const base = createSubdomainBase(businessName);

    for (let attempt = 0; attempt < 10; attempt++) {
      const suffix = randomBase36Upper(6).toLowerCase();
      const subdomain = base ? `${base}-${suffix}` : `tenant-${suffix}`;
      const existing = await this.getTenantBySubdomain(subdomain);
      if (!existing) return subdomain;
    }

    throw new Error("Unable to generate an available subdomain");
  }

  async provisionPlatformRestaurantTenant(data: {
    platformRestaurantId: string;
    businessName: string;
    contactEmail: string;
    contactPhone?: string;
    planId?: OnboardingPlanId | null;
    subdomain?: string | null;
  }): Promise<Tenant> {
    const existing = await this.getTenantByPlatformRestaurantId(
      data.platformRestaurantId,
    );
    if (existing) {
      await this.ensureShopSubscription(existing.id, data.planId);
      return existing;
    }

    return this.provisionTenantWithSubscription(data);
  }

  async provisionTenantWithSubscription(data: {
    businessName: string;
    contactEmail: string;
    contactPhone?: string;
    latitude?: number | null;
    longitude?: number | null;
    planId?: OnboardingPlanId | null;
    subdomain?: string | null;
    platformRestaurantId?: string | null;
  }): Promise<Tenant> {
    const id = this.generateTenantId();
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const licenseTier = this.toLicenseTier(data.planId);
    const licenseKey = generateLicenseKey(licenseTier);
    const subdomain =
      data.subdomain ??
      (await this.generateAvailableSubdomain(data.businessName));
    const planTier = planIdToTier(data.planId);
    const isTrial = planTier === "trial";
    const trialEndsAt = isTrial ? nowMs + TRIAL_DURATION_MS : null;
    const billingCycleStartAt = isTrial ? null : nowMs;
    const billingCycleEndAt = isTrial ? null : nowMs + DEFAULT_BILLING_CYCLE_MS;

    await this.env.MANAGEMENT_DB.batch([
      this.env.MANAGEMENT_DB.prepare(
        `INSERT INTO tenants (
          id, business_name, contact_email, contact_phone, latitude, longitude,
          subdomain, custom_domain, license_tier, license_key,
          status, activated_at, created_at, updated_at, platform_restaurant_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        data.businessName,
        data.contactEmail,
        data.contactPhone || null,
        data.latitude ?? null,
        data.longitude ?? null,
        subdomain,
        null,
        licenseTier,
        licenseKey,
        "active",
        nowIso,
        nowIso,
        nowIso,
        data.platformRestaurantId || null,
      ),
      this.env.MANAGEMENT_DB.prepare(
        `INSERT INTO shop_subscriptions (
          id, restaurant_id, plan_tier, module_overrides,
          is_active, trial_ends_at_ms, billing_cycle_start_at_ms,
          billing_cycle_end_at_ms, notes, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        this.generateSubscriptionId(),
        id,
        planTier,
        "{}",
        1,
        trialEndsAt,
        billingCycleStartAt,
        billingCycleEndAt,
        "auto-provisioned for platform restaurant",
        nowMs,
        nowMs,
      ),
    ]);

    return (await this.getTenantById(id))!;
  }

  async linkPlatformRestaurantOwner(data: {
    platformRestaurantId: string;
    ownerUserId: string;
    ownerUsername: string;
  }): Promise<Tenant | null> {
    const tenant = await this.getTenantByPlatformRestaurantId(
      data.platformRestaurantId,
    );
    if (!tenant) return null;

    if (
      tenant.ownerUserId &&
      (tenant.ownerUserId !== data.ownerUserId ||
        tenant.ownerUsername !== data.ownerUsername)
    ) {
      throw new Error("Tenant is already linked to a different owner");
    }

    await this.env.MANAGEMENT_DB.prepare(
      `UPDATE tenants
       SET owner_user_id = ?, owner_username = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(
        data.ownerUserId,
        data.ownerUsername,
        new Date().toISOString(),
        tenant.id,
      )
      .run();

    return this.getTenantById(tenant.id);
  }

  /**
   * Update tenant
   */
  async updateTenant(
    id: string,
    data: UpdateTenantRequest,
  ): Promise<Tenant | null> {
    const existing = await this.getTenantById(id);
    if (!existing) return null;

    const updates: string[] = [];
    const params: (string | null)[] = [];

    if (data.businessName !== undefined) {
      updates.push("business_name = ?");
      params.push(data.businessName);
    }
    if (data.contactEmail !== undefined) {
      updates.push("contact_email = ?");
      params.push(data.contactEmail);
    }
    if (data.contactPhone !== undefined) {
      updates.push("contact_phone = ?");
      params.push(data.contactPhone || null);
    }
    if (data.customDomain !== undefined) {
      updates.push("custom_domain = ?");
      params.push(data.customDomain || null);
    }
    if (data.licenseTier !== undefined) {
      updates.push("license_tier = ?");
      params.push(data.licenseTier);
    }
    if (data.status !== undefined) {
      updates.push("status = ?");
      params.push(data.status);

      // Set activated_at when status changes to active
      if (data.status === "active" && existing.status !== "active") {
        updates.push("activated_at = ?");
        params.push(new Date().toISOString());
      }
    }

    if (updates.length === 0) {
      return existing;
    }

    updates.push("updated_at = ?");
    params.push(new Date().toISOString());

    params.push(id);

    await this.env.MANAGEMENT_DB.prepare(
      `
      UPDATE tenants SET ${updates.join(", ")} WHERE id = ?
    `,
    )
      .bind(...params)
      .run();

    return this.getTenantById(id);
  }

  /**
   * Delete tenant (soft delete - sets status to terminated)
   */
  async deleteTenant(id: string): Promise<boolean> {
    const existing = await this.getTenantById(id);
    if (!existing) return false;

    await this.env.MANAGEMENT_DB.prepare(
      `
      UPDATE tenants SET status = 'terminated', updated_at = ? WHERE id = ?
    `,
    )
      .bind(new Date().toISOString(), id)
      .run();

    return true;
  }

  /**
   * Get tenant resources
   */
  async getTenantResources(tenantId: string): Promise<TenantResource[]> {
    const result = await this.env.MANAGEMENT_DB.prepare(
      `
      SELECT * FROM tenant_resources WHERE tenant_id = ? ORDER BY created_at
    `,
    )
      .bind(tenantId)
      .all<{
        id: string;
        tenant_id: string;
        resource_type: string;
        resource_name: string;
        resource_id: string;
        status: string;
        error_message: string;
        created_at: string;
        updated_at: string;
      }>();

    return result.results.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      resourceType: row.resource_type as TenantResource["resourceType"],
      resourceName: row.resource_name,
      resourceId: row.resource_id,
      status: row.status as TenantResource["status"],
      errorMessage: row.error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  // ============================================================
  // Helper Methods
  // ============================================================

  private generateTenantId(): string {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
    const random = randomBase36Upper(8);
    return `T-${dateStr}-${random}`;
  }

  private generateSubscriptionId(): string {
    return `sub_${generateUUID()}`;
  }

  private toLicenseTier(planId: OnboardingPlanId | null | undefined) {
    if (planId === "professional" || planId === "enterprise") return planId;
    return "standard";
  }

  private async ensureShopSubscription(
    tenantId: string,
    planId: OnboardingPlanId | null | undefined,
  ) {
    const existing = await this.env.MANAGEMENT_DB.prepare(
      "SELECT id FROM shop_subscriptions WHERE restaurant_id = ?",
    )
      .bind(tenantId)
      .first();
    if (existing) return;

    const nowMs = Date.now();
    const planTier = planIdToTier(planId);
    const isTrial = planTier === "trial";
    await this.env.MANAGEMENT_DB.prepare(
      `INSERT INTO shop_subscriptions (
        id, restaurant_id, plan_tier, module_overrides,
        is_active, trial_ends_at_ms, billing_cycle_start_at_ms,
        billing_cycle_end_at_ms, notes, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        this.generateSubscriptionId(),
        tenantId,
        planTier,
        "{}",
        1,
        isTrial ? nowMs + TRIAL_DURATION_MS : null,
        isTrial ? null : nowMs,
        isTrial ? null : nowMs + DEFAULT_BILLING_CYCLE_MS,
        "backfilled during platform restaurant provisioning retry",
        nowMs,
        nowMs,
      )
      .run();
  }

  private mapRowToTenant(row: Record<string, unknown>): Tenant {
    return {
      id: row.id as string,
      businessName: row.business_name as string,
      contactEmail: row.contact_email as string,
      contactPhone: row.contact_phone as string | undefined,
      latitude: row.latitude as number | undefined,
      longitude: row.longitude as number | undefined,
      subdomain: row.subdomain as string,
      customDomain: row.custom_domain as string | undefined,
      deployedVersion: row.deployed_version as string | undefined,
      licenseTier: row.license_tier as Tenant["licenseTier"],
      licenseKey: row.license_key as string,
      licenseExpiresAt: row.license_expires_at as string | undefined,
      status: row.status as TenantStatus,
      platformRestaurantId: row.platform_restaurant_id as string | undefined,
      ownerUserId: row.owner_user_id as string | undefined,
      ownerUsername: row.owner_username as string | undefined,
      createdAt: row.created_at as string,
      activatedAt: row.activated_at as string | undefined,
      updatedAt: row.updated_at as string,
    };
  }
}
