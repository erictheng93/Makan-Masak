/**
 * Onboarding Routes
 *
 * Self-service onboarding API endpoints
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { markets } from "@makanmasak/database";
import {
  ONBOARDING_LOCALES,
  citiesForCountry,
  normalizeCountryCode,
  type SupportedCountryCode,
} from "@makanmasak/shared-types";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  ApiError,
  badRequest,
  notFound,
  unauthorized,
} from "@makanmasak/utils";
import type { ManagementEnv, OnboardingApplication } from "../types";
import { OnboardingService } from "../services/OnboardingService";

const router = new Hono<{ Bindings: ManagementEnv }>();

// ============================================================
// Validation Schemas
// ============================================================

export const applicationSchema = z
  .object({
    businessName: z.string().min(2).max(100),
    contactName: z.string().min(2).max(100),
    contactEmail: z.email(),
    contactPhone: z.string().min(8).max(20),
    address: z.string().trim().min(3).max(200).optional(),
    district: z.string().trim().min(1).max(100).optional(),
    city: z.string().trim().min(1).max(100),
    countryCode: z
      .string()
      .trim()
      .transform((value) => normalizeCountryCode(value))
      .refine((value): value is SupportedCountryCode => value !== null, {
        message: "countryCode must be one of TW, MY",
      }),
    marketId: z.string().trim().min(1).max(64).optional(),
    stallNumber: z.string().trim().min(1).max(32).optional(),
    planId: z
      .enum(["standard", "professional", "enterprise", "trial"])
      .nullable()
      .optional(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    // The language applicant emails are written in; unset means zh-TW.
    locale: z.enum(ONBOARDING_LOCALES).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.countryCode &&
      !citiesForCountry(value.countryCode).includes(value.city)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["city"],
        message: `city ${value.city} is not in ${value.countryCode}`,
      });
    }
  });

/**
 * Shared by the public submit route and the operator route in
 * admin-onboarding.ts, so both report the same validation error codes.
 */
export function parseApplicationBody(body: unknown) {
  const parsed = applicationSchema.safeParse(body);
  if (!parsed.success) {
    const cityMismatch = parsed.error.issues.some(
      (issue) => issue.path[0] === "city" && issue.code === "custom",
    );
    throw badRequest(
      cityMismatch
        ? "City is not in the selected country"
        : "Validation failed",
      cityMismatch ? "CITY_NOT_IN_COUNTRY" : "VALIDATION_ERROR",
      parsed.error.issues,
    );
  }
  return parsed.data;
}

/** A selected market must be active and in the application's city. */
export async function assertMarketInCity(
  env: ManagementEnv,
  marketId: string | undefined,
  city: string,
): Promise<void> {
  if (!marketId) return;
  if (!env.PLATFORM_DB) {
    throw new ApiError(
      "PLATFORM_DB_UNAVAILABLE",
      "Platform database is unavailable",
      500,
    );
  }
  const [market] = await drizzle(env.PLATFORM_DB)
    .select({ city: markets.city })
    .from(markets)
    .where(
      and(
        eq(markets.id, marketId),
        eq(markets.isActive, true),
        isNull(markets.deletedAt),
      ),
    )
    .limit(1);
  if (!market) {
    throw badRequest("Market not found", "MARKET_NOT_FOUND");
  }
  if (market.city !== city) {
    throw badRequest(
      "Market is not in the selected city",
      "MARKET_NOT_IN_CITY",
    );
  }
}

async function requireApplicationSecret(
  c: Context<{ Bindings: ManagementEnv }>,
  onboardingService: OnboardingService,
  applicationId: string,
): Promise<void> {
  const applicationSecret = c.req.header("X-Onboarding-Secret");
  const isValid =
    typeof applicationSecret === "string" &&
    (await onboardingService.verifyApplicationSecret(
      applicationId,
      applicationSecret,
    ));

  if (!isValid) {
    throw unauthorized(
      "Application secret is required",
      "APPLICATION_SECRET_REQUIRED",
    );
  }
}

// ============================================================
// Routes
// ============================================================

/**
 * Email and notification work never holds up the response: a slow send would
 * otherwise make one outcome measurably slower than another.
 */
async function runAfterResponse(
  c: Context<{ Bindings: ManagementEnv }>,
  work: Promise<unknown>,
): Promise<void> {
  const guarded = work.catch((error) => {
    // Providers normally absorb their own failures, but a defensive final
    // boundary keeps an unexpected notifier regression out of the public
    // response in Worker and non-Worker test hosts alike.
    console.error("[Onboarding] Post-response work failed:", error);
  });
  try {
    c.executionCtx.waitUntil(guarded);
  } catch {
    // Hono app.fetch tests and non-Worker hosts have no ExecutionContext.
    await guarded;
  }
}

async function requireRateLimit(
  onboardingService: OnboardingService,
  bucket: string,
): Promise<void> {
  if (!(await onboardingService.consumeApplicationRateLimit(bucket))) {
    throw new ApiError(
      "RATE_LIMITED",
      "Too many application requests. Please try again later.",
      429,
    );
  }
}

const RECEIVED = { status: "received" } as const;

/**
 * Create new application
 * POST /api/v1/onboarding/applications
 *
 * A fresh application and a duplicate for an email already in review get the
 * same 202, so the endpoint cannot be used to learn whether an email applied.
 * The status link goes out only by email; a duplicate gets a fresh link to the
 * application on file instead of a new row.
 */
router.post("/applications", async (c) => {
  const onboardingService = new OnboardingService(c.env);

  try {
    const ipAddress = c.req.header("cf-connecting-ip") || "unknown";
    await requireRateLimit(onboardingService, ipAddress);

    // An unparseable body is the client's fault; without this the SyntaxError
    // falls through to the generic 500 below and reads as a server outage.
    const body = await c.req.json().catch(() => {
      throw badRequest("Invalid JSON body", "INVALID_JSON");
    });
    const validated = parseApplicationBody(body);
    await assertMarketInCity(c.env, validated.marketId, validated.city);

    // Get request metadata
    const userAgent = c.req.header("user-agent") || "unknown";

    let application: OnboardingApplication | null = null;
    try {
      application = await onboardingService.createApplication(validated, {
        ipAddress,
        userAgent,
      });
    } catch (error) {
      if (
        !(error instanceof ApiError) ||
        error.code !== "APPLICATION_ALREADY_PENDING"
      ) {
        throw error;
      }
    }

    await runAfterResponse(
      c,
      application
        ? Promise.all([
            onboardingService.notifyPlatformOfNewApplication(application),
            onboardingService.sendApplicationReceivedEmail(
              application,
              application.applicationSecret!,
            ),
          ])
        : onboardingService.sendStatusLinkEmail(
            validated.contactEmail,
            "alreadyPending",
          ),
    );

    // Dev/CI exception: without email the response is the only way to get the
    // status link, at the cost of telling fresh and duplicate apart there.
    const devLink =
      application && c.env.ONBOARDING_EMAIL_ENABLED !== "true"
        ? {
            applicationId: application.id,
            applicationSecret: application.applicationSecret,
            assignedSubdomain: application.assignedSubdomain,
          }
        : {};
    return c.json({ success: true, data: { ...RECEIVED, ...devLink } }, 202);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw badRequest("Validation failed", "VALIDATION_ERROR", error.issues);
    }
    if (error instanceof ApiError) throw error;

    console.error("[Onboarding] Create application error:", error);
    throw new ApiError("CREATE_FAILED", "Failed to create application", 500);
  }
});

const statusLinkRequestSchema = z.object({ email: z.email() });

/**
 * Resend the status link
 * POST /api/v1/onboarding/applications/status-link
 *
 * Always the same 202, whether or not the email has an application.
 */
router.post("/applications/status-link", async (c) => {
  const onboardingService = new OnboardingService(c.env);
  const ipAddress = c.req.header("cf-connecting-ip") || "unknown";
  // A sibling bucket, so asking for a link does not use up submissions.
  await requireRateLimit(onboardingService, `status-link:${ipAddress}`);

  const body = await c.req.json().catch(() => {
    throw badRequest("Invalid JSON body", "INVALID_JSON");
  });
  const parsed = statusLinkRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw badRequest(
      "Validation failed",
      "VALIDATION_ERROR",
      parsed.error.issues,
    );
  }

  await runAfterResponse(
    c,
    onboardingService.sendStatusLinkEmail(parsed.data.email, "statusLink"),
  );
  return c.json({ success: true, data: RECEIVED }, 202);
});

/**
 * Get application by ID
 * GET /api/v1/onboarding/applications/:id
 */
router.get("/applications/:id", async (c) => {
  const onboardingService = new OnboardingService(c.env);
  const applicationId = c.req.param("id");

  try {
    await requireApplicationSecret(c, onboardingService, applicationId);

    const application = await onboardingService.getApplication(applicationId);

    if (!application) {
      throw notFound("Application not found", "NOT_FOUND");
    }

    // Don't expose sensitive fields
    return c.json({
      success: true,
      data: {
        id: application.id,
        businessName: application.businessName,
        contactName: application.contactName,
        contactEmail: application.contactEmail,
        address: application.address,
        district: application.district,
        city: application.city,
        countryCode: application.countryCode,
        marketId: application.marketId,
        stallNumber: application.stallNumber,
        latitude: application.latitude,
        longitude: application.longitude,
        planId: application.planId,
        assignedSubdomain: application.assignedSubdomain,
        status: application.status,
        rejectionReason: application.rejectionReason,
        rejectedAtMs: application.rejectedAtMs,
        tenantId: application.tenantId,
        createdAt: application.createdAt,
        completedAt: application.completedAt,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;

    console.error("[Onboarding] Get application error:", error);
    throw new ApiError("GET_FAILED", "Failed to get application", 500);
  }
});

export default router;
