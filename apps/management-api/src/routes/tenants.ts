/**
 * Tenant Management Routes
 *
 * CRUD operations for tenant management
 */

import { Hono } from "hono";
import { z } from "zod";
import { ApiError, badRequest, notFound } from "@makanmasak/utils";
import type { ManagementEnv, Tenant, UpdateTenantRequest } from "../types";
import { TenantService } from "../services/TenantService";

const router = new Hono<{ Bindings: ManagementEnv }>();

// ============================================================
// Validation Schemas
// ============================================================

const updateTenantSchema = z.object({
  businessName: z.string().min(2).max(100).optional(),
  contactEmail: z.email().optional(),
  contactPhone: z.string().optional(),
  customDomain: z.string().optional(),
  licenseTier: z.enum(["standard", "professional", "enterprise"]).optional(),
  status: z
    .enum(["pending", "provisioning", "active", "suspended", "terminated"])
    .optional(),
});

// ============================================================
// Routes
// ============================================================

/**
 * List all tenants
 * GET /api/v1/tenants
 */
router.get("/", async (c) => {
  const tenantService = new TenantService(c.env);

  // Parse query parameters
  const page = parseInt(c.req.query("page") || "1");
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 100);
  const status = c.req.query("status");
  const search = c.req.query("search");

  try {
    const result = await tenantService.listTenants({
      page,
      limit,
      status: status as Tenant["status"] | undefined,
      search,
    });

    return c.json({
      success: true,
      data: result.tenants,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;

    console.error("[Tenants] List error:", error);
    throw new ApiError("LIST_FAILED", "Failed to list tenants", 500);
  }
});

/**
 * Get tenant by ID
 * GET /api/v1/tenants/:id
 */
router.get("/:id", async (c) => {
  const tenantService = new TenantService(c.env);
  const tenantId = c.req.param("id");

  try {
    const tenant = await tenantService.getTenantById(tenantId);

    if (!tenant) {
      throw notFound("Tenant not found", "NOT_FOUND");
    }

    return c.json({
      success: true,
      data: tenant,
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;

    console.error("[Tenants] Get error:", error);
    throw new ApiError("GET_FAILED", "Failed to get tenant", 500);
  }
});

/**
 * Update tenant
 * PATCH /api/v1/tenants/:id
 */
router.patch("/:id", async (c) => {
  const tenantService = new TenantService(c.env);
  const tenantId = c.req.param("id");

  try {
    const body = await c.req.json();
    const validated = updateTenantSchema.parse(body);

    const tenant = await tenantService.updateTenant(
      tenantId,
      validated as UpdateTenantRequest,
    );

    if (!tenant) {
      throw notFound("Tenant not found", "NOT_FOUND");
    }

    return c.json({
      success: true,
      data: tenant,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw badRequest("Validation failed", "VALIDATION_ERROR", error.issues);
    }
    if (error instanceof ApiError) throw error;

    console.error("[Tenants] Update error:", error);
    throw new ApiError("UPDATE_FAILED", "Failed to update tenant", 500);
  }
});

/**
 * Delete tenant (soft delete)
 * DELETE /api/v1/tenants/:id
 */
router.delete("/:id", async (c) => {
  const tenantService = new TenantService(c.env);
  const tenantId = c.req.param("id");

  try {
    const success = await tenantService.deleteTenant(tenantId);

    if (!success) {
      throw notFound("Tenant not found", "NOT_FOUND");
    }

    return c.json({
      success: true,
      data: { deleted: true },
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;

    console.error("[Tenants] Delete error:", error);
    throw new ApiError("DELETE_FAILED", "Failed to delete tenant", 500);
  }
});

/**
 * Get tenant resources
 * GET /api/v1/tenants/:id/resources
 */
router.get("/:id/resources", async (c) => {
  const tenantService = new TenantService(c.env);
  const tenantId = c.req.param("id");

  try {
    const resources = await tenantService.getTenantResources(tenantId);

    return c.json({
      success: true,
      data: resources,
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;

    console.error("[Tenants] Get resources error:", error);
    throw new ApiError(
      "GET_RESOURCES_FAILED",
      "Failed to get tenant resources",
      500,
    );
  }
});

export default router;
