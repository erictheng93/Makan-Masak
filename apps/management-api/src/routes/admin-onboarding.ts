import { Hono } from "hono";
import { z } from "zod";
import { badRequest, notFound } from "@makanmasak/utils";
import type { ManagementEnv, OnboardingStatus } from "../types";
import type { ManagementUser } from "../middleware/auth";
import { OnboardingService } from "../services/OnboardingService";

const router = new Hono<{
  Bindings: ManagementEnv;
  Variables: { managementUser: ManagementUser };
}>();

const onboardingStatusSchema = z.enum([
  "submitted",
  "provisioning",
  "completed",
  "rejected",
]);

const listApplicationsQuerySchema = z.object({
  status: onboardingStatusSchema.optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

function publicApplication(application: {
  id: string;
  businessName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  address?: string;
  district?: string;
  city?: string;
  countryCode?: string;
  marketId?: string;
  marketName?: string;
  stallNumber?: string;
  planId: string | null;
  latitude?: number;
  longitude?: number;
  requestedSubdomain?: string;
  assignedSubdomain?: string;
  status: OnboardingStatus;
  rejectionReason?: string;
  rejectedAtMs?: number;
  tenantId?: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
  submittedAt?: string;
  completedAt?: string;
  updatedAt: string;
}) {
  return {
    id: application.id,
    businessName: application.businessName,
    contactName: application.contactName,
    contactEmail: application.contactEmail,
    contactPhone: application.contactPhone,
    address: application.address,
    district: application.district,
    city: application.city,
    countryCode: application.countryCode,
    marketId: application.marketId,
    marketName: application.marketName,
    stallNumber: application.stallNumber,
    planId: application.planId,
    latitude: application.latitude,
    longitude: application.longitude,
    requestedSubdomain: application.requestedSubdomain,
    assignedSubdomain: application.assignedSubdomain,
    status: application.status,
    rejectionReason: application.rejectionReason,
    rejectedAtMs: application.rejectedAtMs,
    tenantId: application.tenantId,
    ipAddress: application.ipAddress,
    userAgent: application.userAgent,
    createdAt: application.createdAt,
    submittedAt: application.submittedAt,
    completedAt: application.completedAt,
    updatedAt: application.updatedAt,
  };
}

/**
 * The one-time link already carries the setup token, and no client needs the
 * bare token, so it never leaves the service.
 */
function publicOwnerAccount(
  ownerAccount:
    | {
        restaurantId: string;
        userId: string;
        username: string;
        setupPasswordToken: string;
        setupPasswordLink: string;
        setupPasswordExpiresAt: string;
      }
    | undefined,
) {
  if (!ownerAccount) return undefined;
  return {
    restaurantId: ownerAccount.restaurantId,
    userId: ownerAccount.userId,
    username: ownerAccount.username,
    setupPasswordLink: ownerAccount.setupPasswordLink,
    setupPasswordExpiresAt: ownerAccount.setupPasswordExpiresAt,
  };
}

router.get("/applications", async (c) => {
  const parsed = listApplicationsQuerySchema.safeParse({
    status: c.req.query("status"),
    page: c.req.query("page"),
    limit: c.req.query("limit"),
  });
  if (!parsed.success) {
    throw badRequest(
      "Validation failed",
      "VALIDATION_ERROR",
      parsed.error.issues,
    );
  }

  const service = new OnboardingService(c.env);
  const result = await service.listApplications(parsed.data);

  return c.json({
    success: true,
    data: {
      applications: result.applications.map(publicApplication),
      total: result.total,
      page: result.page,
      limit: result.limit,
    },
  });
});

router.get("/applications/:id/audit-events", async (c) => {
  const service = new OnboardingService(c.env);
  const result = await service.listApplicationAuditEvents(c.req.param("id"));
  if (!result.found) throw notFound("Application not found", "NOT_FOUND");

  return c.json({
    success: true,
    data: { events: result.events },
  });
});

router.post("/applications/:id/approve", async (c) => {
  const service = new OnboardingService(c.env);
  const result = await service.approveApplication(c.req.param("id"));

  if (!result.success) {
    if (result.error === "Application not found") {
      throw notFound(result.error, "NOT_FOUND");
    }
    throw badRequest(
      result.error ?? "Failed to approve application",
      "INVALID_STATUS",
    );
  }

  return c.json({
    success: true,
    data: {
      tenantId: result.tenantId,
      restaurantId: result.restaurantId,
      marketId: result.marketId,
      stallNumber: result.stallNumber,
      subdomain: result.subdomain,
      ownerAccount: publicOwnerAccount(result.ownerAccount),
      credentialDelivery: result.credentialDelivery,
      status: result.status ?? "completed",
    },
  });
});

router.post("/applications/:id/setup-link", async (c) => {
  const service = new OnboardingService(c.env);
  const result = await service.regenerateSetupPasswordLink(
    c.req.param("id"),
    c.get("managementUser"),
  );
  if (!result.success) {
    if (result.error === "Application not found") {
      throw notFound(result.error, "NOT_FOUND");
    }
    throw badRequest(
      result.error ?? "Failed to regenerate setup link",
      "INVALID_STATUS",
    );
  }
  return c.json({
    success: true,
    data: {
      ownerAccount: publicOwnerAccount(result.ownerAccount),
      credentialDelivery: result.credentialDelivery,
    },
  });
});

const rejectApplicationSchema = z.object({
  reason: z.string().trim().min(2).max(500),
});

router.post("/applications/:id/reject", async (c) => {
  const parsed = rejectApplicationSchema.safeParse(
    await c.req.json().catch(() => ({})),
  );
  if (!parsed.success) {
    throw badRequest(
      "Validation failed",
      "VALIDATION_ERROR",
      parsed.error.issues,
    );
  }

  const service = new OnboardingService(c.env);
  const result = await service.rejectApplication(
    c.req.param("id"),
    parsed.data.reason,
    c.get("managementUser"),
  );

  if (!result.success) {
    if (result.error === "Application not found") {
      throw notFound(result.error, "NOT_FOUND");
    }
    throw badRequest(
      result.error ?? "Failed to reject application",
      "INVALID_STATUS",
    );
  }

  return c.json({
    success: true,
    data: {
      status: result.status ?? "rejected",
      rejectionReason: result.rejectionReason,
      rejectedAtMs: result.rejectedAtMs,
    },
  });
});

export default router;
