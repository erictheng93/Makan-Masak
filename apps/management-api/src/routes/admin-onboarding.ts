import { Hono } from "hono";
import { z } from "zod";
import { ApiError, badRequest, conflict, notFound } from "@makanmasak/utils";
import type { ManagementEnv, OnboardingStatus } from "../types";
import type { ManagementUser } from "../middleware/auth";
import { OnboardingService } from "../services/OnboardingService";
import { assertMarketInCity, parseApplicationBody } from "./onboarding";

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

type ApproveResult = Awaited<
  ReturnType<OnboardingService["approveApplication"]>
>;

function approvalData(result: ApproveResult) {
  return {
    tenantId: result.tenantId,
    restaurantId: result.restaurantId,
    marketId: result.marketId,
    stallNumber: result.stallNumber,
    subdomain: result.subdomain,
    ownerAccount: publicOwnerAccount(result.ownerAccount),
    credentialDelivery: result.credentialDelivery,
    status: result.status ?? "completed",
  };
}

const operatorApplicationSchema = z.object({
  approveImmediately: z.boolean().default(true),
});

/**
 * An operator registers a shop on an owner's behalf. It is the same
 * application -> approval pipeline as self-service, minus the IP rate limit
 * and the "new application" notifications (the operator is the reviewer).
 * Approval failure leaves the application submitted and is reported, not
 * thrown, so the UI can say "created, approve it from the list".
 */
router.post("/applications", async (c) => {
  const body = await c.req.json().catch(() => {
    throw badRequest("Invalid JSON body", "INVALID_JSON");
  });
  const validated = parseApplicationBody(body);
  const options = operatorApplicationSchema.safeParse(body);
  if (!options.success) {
    throw badRequest(
      "Validation failed",
      "VALIDATION_ERROR",
      options.error.issues,
    );
  }
  await assertMarketInCity(c.env, validated.marketId, validated.city);

  const actor = c.get("managementUser");
  const service = new OnboardingService(c.env);
  const created = await service.createApplication(
    validated,
    { userAgent: c.req.header("user-agent") },
    actor,
  );

  let approval: ReturnType<typeof approvalData> | null = null;
  let approvalError: { code: string; message: string } | undefined;
  if (options.data.approveImmediately) {
    try {
      const result = await service.approveApplication(created.id, actor);
      if (result.success) {
        approval = approvalData(result);
      } else {
        approvalError = {
          code: "APPROVAL_FAILED",
          message: result.error ?? "Failed to approve application",
        };
      }
    } catch (error) {
      if (!(error instanceof ApiError)) {
        console.error("[AdminOnboarding] Operator approval error:", error);
      }
      approvalError =
        error instanceof ApiError
          ? { code: error.code, message: error.message }
          : {
              code: "APPROVAL_FAILED",
              message: "Failed to approve application",
            };
    }
  }

  // Re-read so the returned status reflects the approval outcome.
  const application = (await service.getApplication(created.id)) ?? created;
  return c.json(
    {
      success: true,
      data: {
        application: publicApplication(application),
        approval,
        ...(approvalError ? { approvalError } : {}),
      },
    },
    201,
  );
});

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
  const result = await service.approveApplication(
    c.req.param("id"),
    c.get("managementUser"),
  );

  if (!result.success) {
    if (result.error === "Application not found") {
      throw notFound(result.error, "NOT_FOUND");
    }
    throw badRequest(
      result.error ?? "Failed to approve application",
      "INVALID_STATUS",
    );
  }

  return c.json({ success: true, data: approvalData(result) });
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

router.delete("/applications/:id", async (c) => {
  const service = new OnboardingService(c.env);
  const result = await service.purgeApplication(
    c.req.param("id"),
    c.get("managementUser"),
  );
  if (!result.success) {
    if (result.error === "Application not found") {
      throw notFound(result.error, "NOT_FOUND");
    }
    throw conflict(
      result.error ?? "Failed to purge application",
      result.code ?? "PURGE_FAILED",
    );
  }
  return c.json({ success: true, data: { purged: true } });
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
