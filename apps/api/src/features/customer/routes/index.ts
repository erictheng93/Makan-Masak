import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { generateUUID, normalizeE164Phone } from "@makanmasak/utils";
import {
  createSmsProvider,
  NotificationService,
  resolveEmailProviderName,
} from "@makanmasak/database";
import {
  CUSTOMER_CONSENT_TYPES,
  CUSTOMER_PASSWORD_PROVIDER,
  isCustomerConsentVersion,
} from "@makanmasak/shared-types";
import type { Env } from "../../../types/env";
import {
  canonicalCustomerAuthMiddleware,
  verifyJwtToken,
} from "../../../middleware/auth";
import { validateBody, validateQuery } from "../../../middleware/validation";
import {
  ApiError,
  badRequest,
  conflict,
  unauthorized,
} from "../../../shared/utils/api-error";
import oauthRoutes from "./oauth";
import {
  CUSTOMER_ACCESS_TOKEN_SECONDS,
  CUSTOMER_REFRESH_COOKIE,
  customerRefreshRecordKey,
  issueCustomerSession,
  revokeCustomerSession,
  revokeRefreshRecord,
} from "../services/CustomerSessionService";

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const OTP_CODE_SPACE = 1_000_000;
const OTP_RANDOM_BOUNDARY = 4_294_000_000;
const PASSWORD_MIN_LENGTH = 10;
const PASSWORD_RESET_TTL_MS = 15 * 60 * 1000;
const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RATE_LIMIT_TTL_SECONDS = 60 * 60;
const PASSWORD_RATE_LIMIT_IDENTIFIER_MAX = 5;
const PASSWORD_RATE_LIMIT_IP_MAX = 20;
const DUMMY_PASSWORD_HASH =
  "$2a$10$UGDZBxi4dnR2z5YoJLJ/V.ny1wknPCO8ncfLy1PgTOknCb8DJDmQm";
const PASSWORD_LOGIN_ERROR_MESSAGE = "Invalid identifier or password";
const PASSWORD_LOGIN_ERROR_CODE = "INVALID_CREDENTIALS";
// Errors account-recovery routes must swallow on the phone branch. Each is
// raised only from inside issuePhoneOtp, which an unknown identifier never
// reaches, so letting one out is itself the answer to "does this number have an
// account?".
const PHONE_OTP_SILENT_ERROR_CODES = new Set([
  "SMS_SEND_FAILED",
  "OTP_RATE_LIMITED",
]);
const COMMON_PASSWORDS = new Set([
  "1234567890",
  "password",
  "password1",
  "password123",
  "qwerty12345",
  "1111111111",
  "iloveyou",
  "adminadmin",
  "makanmakan",
]);
type Uint32RandomValues = (values: Uint32Array) => Uint32Array;

const phoneSchema = z
  .string()
  .trim()
  .min(7)
  .max(20)
  .transform(normalizeE164Phone)
  .pipe(z.string().regex(/^\+[1-9]\d{6,14}$/));

const requestOtpSchema = z.lazy(() =>
  z.object({
    phone: phoneSchema,
  }),
);

const verifyOtpSchema = z.lazy(() =>
  z.object({
    phone: phoneSchema,
    otp: z.string().regex(/^\d{6}$/),
    purpose: z.enum(["password_reset"]).optional(),
  }),
);

const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(256);

const registerSchema = z.object({
  identifier: z.string().trim().min(3).max(320),
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(100),
});

const loginSchema = z.object({
  identifier: z.string().trim().min(3).max(320),
  password: z.string().min(1).max(256),
});

const forgotPasswordSchema = z.lazy(() =>
  z.object({
    identifier: z.string().trim().min(3).max(320),
  }),
);

const resetPasswordSchema = z.lazy(() =>
  z.object({
    token: z.string().trim().min(20).max(256),
    newPassword: passwordSchema,
  }),
);

const tokenOnlySchema = z.lazy(() =>
  z.object({
    token: z.string().trim().min(20).max(256),
  }),
);

const resendVerificationSchema = z.lazy(() =>
  z.object({
    identifier: z.string().trim().min(3).max(320),
  }),
);

const profilePatchSchema = z.lazy(() =>
  z.object({
    displayName: z.string().trim().min(1).max(100).optional(),
    avatarUrl: z.url().max(2048).nullable().optional(),
    locale: z
      .string()
      .regex(/^[a-z]{2,3}(-[A-Z]{2})?$/)
      .max(16)
      .nullable()
      .optional(),
  }),
);

const preferencesPatchSchema = z.lazy(() =>
  z.object({
    dietaryTags: z.array(z.string().min(1).max(50)).max(50).optional(),
    allergens: z.array(z.string().min(1).max(50)).max(50).optional(),
    defaultPartySize: z.number().int().min(1).max(20).nullable().optional(),
    marketingOptIn: z.boolean().optional(),
    waitingListOptIn: z.boolean().optional(),
    promoFromFavoritesOptIn: z.boolean().optional(),
    quietHoursStart: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .nullable()
      .optional(),
    quietHoursEnd: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .nullable()
      .optional(),
  }),
);

const pushSubscriptionSchema = z.lazy(() =>
  z.object({
    endpoint: z.string().transform(decodeHtmlEntities).pipe(z.url().max(4096)),
    p256dh: z.string().min(1).max(2048),
    auth: z.string().min(1).max(2048),
    userAgent: z.string().max(1024).optional(),
    deviceLabel: z.string().max(100).optional(),
  }),
);

const favoriteTargetTypeSchema = z.lazy(() =>
  z.enum(["market", "restaurant", "dish"]),
);

const favoriteQuerySchema = z.lazy(() =>
  z.object({
    targetType: favoriteTargetTypeSchema.optional(),
  }),
);

const favoriteSchema = z.lazy(() =>
  z.object({
    targetType: favoriteTargetTypeSchema,
    targetId: z.string().trim().min(1).max(128),
  }),
);

const recentMarketsQuerySchema = z.lazy(() =>
  z.object({
    limit: z.coerce.number().int().min(1).max(20).default(8),
  }),
);

const recentMarketSchema = z.lazy(() =>
  z.object({
    marketId: z.string().trim().min(1).max(128),
    visitedAtMs: z.number().int().positive().optional(),
  }),
);

const consentSchema = z.lazy(() =>
  z
    .object({
      consentType: z.enum(CUSTOMER_CONSENT_TYPES),
      version: z.string().trim().min(1).max(100),
      granted: z.boolean(),
      source: z
        .enum(["onboarding", "settings", "inline_prompt"])
        .default("settings"),
    })
    .superRefine((value, ctx) => {
      if (!isCustomerConsentVersion(value.consentType, value.version)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["version"],
          message: "Unsupported customer consent version",
        });
      }
    }),
);

type CustomerRow = {
  id: string;
  display_name: string;
  primary_phone: string | null;
  primary_email: string | null;
  avatar_url: string | null;
  locale: string | null;
  status: string;
  last_seen_at_ms: number | null;
  created_at_ms: number;
  updated_at_ms: number;
};

type AuthIdentifier = {
  kind: "email" | "phone";
  value: string;
};

type PasswordIdentityRow = CustomerRow & {
  identity_id: string;
  customer_id: string;
  provider_uid: string;
  secret_hash: string | null;
  verified_at_ms: number | null;
};

type VerificationTokenRow = {
  id: string;
  customer_id: string;
  purpose: "password_reset" | "email_verify";
  identifier: string;
  expires_at_ms: number;
  used_at_ms: number | null;
};

type IssuedPhoneOtp = {
  phone: string;
  expiresInSeconds: number;
  devOtp?: string;
};

const routes = new Hono<{ Bindings: Env }>();

routes.post("/auth/request-otp", validateBody(requestOtpSchema), async (c) => {
  const { phone } = c.get("validatedBody");
  const data = await issuePhoneOtp(c, phone);

  return c.json({
    success: true,
    data,
  });
});

routes.post("/auth/register", validateBody(registerSchema), async (c) => {
  const body = c.get("validatedBody");
  rejectWeakPassword(body.password);
  const identifier = parseAuthIdentifier(body.identifier);
  // Before any row is written: a registration that cannot be delivered leaves
  // an account nobody can ever verify.
  if (identifier.kind === "email") {
    assertEmailChannelAvailable(c.env);
  } else {
    assertSmsChannelAvailable(c.env);
  }
  await enforcePasswordRateLimit(c, "register", identifier.value);

  const existing = await loadPasswordIdentity(c.env, identifier.value);
  if (existing) {
    throw conflict("Customer identity already exists", "IDENTITY_EXISTS");
  }

  const now = Date.now();
  const customerId = generateUUID();
  const identityId = generateUUID();
  const passwordHash = await bcrypt.hash(body.password, 10);

  await c.env.DB.prepare(
    `INSERT INTO customers
      (id, display_name, status, created_at_ms, updated_at_ms)
     VALUES (?, ?, 'active', ?, ?)`,
  )
    .bind(customerId, body.displayName, now, now)
    .run();

  try {
    await c.env.DB.prepare(
      `INSERT INTO customer_auth_identities
        (id, customer_id, provider, provider_uid, secret_hash,
         verified_at_ms, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
      .bind(
        identityId,
        customerId,
        CUSTOMER_PASSWORD_PROVIDER,
        identifier.value,
        passwordHash,
        now,
        now,
      )
      .run();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      await c.env.DB.prepare(`DELETE FROM customers WHERE id = ?`)
        .bind(customerId)
        .run();
      throw conflict("Customer identity already exists", "IDENTITY_EXISTS");
    }
    throw error;
  }

  if (identifier.kind === "email") {
    const { delivered } = await createAndSendVerificationToken(
      c,
      "email_verify",
      identifier.value,
      customerId,
      EMAIL_VERIFY_TTL_MS,
      body.displayName,
    );

    // Login is blocked until the identity is verified, so an undelivered link
    // leaves an account nobody can ever use. Say so instead of returning a
    // 201 that implies an email is on its way. The account itself is kept —
    // it is in a valid unverified state, and /auth/resend-verification is the
    // recovery path (re-registering would only hit IDENTITY_EXISTS).
    if (!delivered) {
      throw new ApiError(
        "VERIFICATION_EMAIL_FAILED",
        "Account created, but the verification email could not be sent. Request a new one.",
        502,
      );
    }
  } else {
    await issuePhoneOtp(c, identifier.value, customerId);
  }

  return c.json(
    {
      success: true,
      data: {
        customer: {
          id: customerId,
          displayName: body.displayName,
          primaryPhone: null,
          primaryEmail: null,
          status: "active",
        },
        verificationRequired: true,
        verificationMethod: identifier.kind === "email" ? "email" : "phone",
      },
    },
    201,
  );
});

routes.post("/auth/login", validateBody(loginSchema), async (c) => {
  const body = c.get("validatedBody");
  const identifier = parseAuthIdentifier(body.identifier);
  await enforcePasswordRateLimit(c, "login", identifier.value);

  const identity = await loadPasswordIdentity(c.env, identifier.value);
  const passwordHash = identity?.secret_hash ?? DUMMY_PASSWORD_HASH;
  const passwordValid = await bcrypt.compare(body.password, passwordHash);

  if (!identity || !passwordValid || identity.verified_at_ms === null) {
    throw unauthorized(PASSWORD_LOGIN_ERROR_MESSAGE, PASSWORD_LOGIN_ERROR_CODE);
  }

  await c.env.DB.prepare(
    `UPDATE customer_auth_identities
        SET last_used_at_ms = ?, updated_at_ms = ?
      WHERE id = ?`,
  )
    .bind(Date.now(), Date.now(), identity.identity_id)
    .run();

  const session = await issueCustomerSession(
    c as unknown as Context<{ Bindings: Env }>,
    identity.customer_id,
  );

  return c.json({
    success: true,
    data: {
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
      customer: toCustomerSummary(identity),
    },
  });
});

routes.post(
  "/auth/forgot-password",
  validateBody(forgotPasswordSchema),
  async (c) => {
    const { identifier: rawIdentifier } = c.get("validatedBody");
    const identifier = parseAuthIdentifier(rawIdentifier);
    // Before the identity lookup, so the refusal cannot depend on whether the
    // account exists. See assertEmailChannelAvailable.
    if (identifier.kind === "email") {
      assertEmailChannelAvailable(c.env);
    } else {
      assertSmsChannelAvailable(c.env);
    }
    await enforcePasswordRateLimit(c, "forgot", identifier.value);

    const identity = await loadPasswordIdentity(c.env, identifier.value);
    let issued: IssuedPhoneOtp | undefined;
    if (identity) {
      // `delivered` is deliberately ignored: this endpoint answers identically
      // whether or not the account exists, so it cannot report send failures
      // either. The helper logs them.
      if (identifier.kind === "email") {
        await createAndSendVerificationToken(
          c,
          "password_reset",
          identifier.value,
          identity.customer_id,
          PASSWORD_RESET_TTL_MS,
          identity.display_name,
        );
      } else {
        try {
          issued = await issuePhoneOtp(
            c,
            identifier.value,
            identity.customer_id,
          );
        } catch (error) {
          if (
            error instanceof ApiError &&
            PHONE_OTP_SILENT_ERROR_CODES.has(error.code)
          ) {
            // Delivery and quota failures occur only after the account lookup.
            // Exposing either would reveal that this phone has an account.
          } else {
            throw error;
          }
        }
      }
    }

    return c.json({
      success: true,
      // The dev echo rides the same NODE_ENV gate as /auth/request-otp, which
      // already hands back the code itself outside production. Local dev runs
      // the "noop" SMS provider and stores the OTP bcrypt-hashed, so without
      // this the phone reset screen cannot be exercised on a dev machine at
      // all. It does make dev an account-existence oracle — the field appears
      // only when the lookup found an identity — which is accepted knowingly:
      // an environment that already publishes the code to anyone who asks has
      // nothing smaller left to protect, and the gate is env-only, so the
      // production response stays byte-identical (`{ sent: true }`) for known
      // and unknown numbers alike.
      data: {
        sent: true,
        ...(issued?.devOtp ? { devOtp: issued.devOtp } : {}),
      },
    });
  },
);

routes.post(
  "/auth/reset-password",
  validateBody(resetPasswordSchema),
  async (c) => {
    const body = c.get("validatedBody");
    rejectWeakPassword(body.newPassword);
    const tokenHash = await sha256Hex(body.token);
    const now = Date.now();
    const token = await loadVerificationToken(
      c.env,
      tokenHash,
      "password_reset",
    );

    if (!token || token.expires_at_ms <= now || token.used_at_ms !== null) {
      throw unauthorized("Invalid or expired token", "TOKEN_INVALID");
    }

    const passwordHash = await bcrypt.hash(body.newPassword, 10);
    await c.env.DB.prepare(
      `UPDATE customer_auth_identities
          SET secret_hash = ?, updated_at_ms = ?
        WHERE customer_id = ? AND provider = ?`,
    )
      .bind(passwordHash, now, token.customer_id, CUSTOMER_PASSWORD_PROVIDER)
      .run();

    await c.env.DB.prepare(
      `UPDATE customer_verification_tokens
          SET used_at_ms = ?
        WHERE purpose = 'password_reset'
          AND customer_id = ?
          AND used_at_ms IS NULL`,
    )
      .bind(now, token.customer_id)
      .run();

    await revokeAllCustomerRefreshRecords(c.env, token.customer_id);

    return c.json({
      success: true,
      data: { reset: true },
    });
  },
);

routes.post("/auth/verify-email", validateBody(tokenOnlySchema), async (c) => {
  const { token: rawToken } = c.get("validatedBody");
  const tokenHash = await sha256Hex(rawToken);
  const now = Date.now();
  const token = await loadVerificationToken(c.env, tokenHash, "email_verify");

  if (!token || token.expires_at_ms <= now || token.used_at_ms !== null) {
    throw unauthorized("Invalid or expired token", "TOKEN_INVALID");
  }

  try {
    await c.env.DB.prepare(
      `UPDATE customers
          SET primary_email = ?, updated_at_ms = ?
        WHERE id = ?`,
    )
      .bind(token.identifier, now, token.customer_id)
      .run();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw conflict("Customer identity already exists", "IDENTITY_EXISTS");
    }
    throw error;
  }

  await c.env.DB.prepare(
    `UPDATE customer_auth_identities
        SET verified_at_ms = ?, updated_at_ms = ?
      WHERE customer_id = ? AND provider = ? AND provider_uid = ?`,
  )
    .bind(
      now,
      now,
      token.customer_id,
      CUSTOMER_PASSWORD_PROVIDER,
      token.identifier,
    )
    .run();

  await c.env.DB.prepare(
    `UPDATE customer_verification_tokens
        SET used_at_ms = ?
      WHERE token_hash = ?`,
  )
    .bind(now, tokenHash)
    .run();

  return c.json({
    success: true,
    data: { verified: true },
  });
});

routes.post(
  "/auth/resend-verification",
  validateBody(resendVerificationSchema),
  async (c) => {
    const { identifier: rawIdentifier } = c.get("validatedBody");
    const identifier = parseAuthIdentifier(rawIdentifier);
    // Before the identity lookup, for the same enumeration reason as
    // /forgot-password. See the channel availability guards.
    if (identifier.kind === "email") {
      assertEmailChannelAvailable(c.env);
    } else {
      assertSmsChannelAvailable(c.env);
    }
    await enforcePasswordRateLimit(c, "resend_verification", identifier.value);

    const identity = await loadPasswordIdentity(c.env, identifier.value);
    if (identity && identity.verified_at_ms === null) {
      if (identifier.kind === "email") {
        // `delivered` ignored on purpose — same enumeration constraint as
        // /forgot-password. See createAndSendVerificationToken.
        await createAndSendVerificationToken(
          c,
          "email_verify",
          identifier.value,
          identity.customer_id,
          EMAIL_VERIFY_TTL_MS,
          identity.display_name,
        );
      } else {
        try {
          await issuePhoneOtp(c, identifier.value, identity.customer_id);
        } catch (error) {
          // Neither a vendor rejection nor a spent OTP quota may reveal that
          // this phone has an account. The per-phone OTP quota (3/hour) is
          // lower than this endpoint's own identifier quota
          // (PASSWORD_RATE_LIMIT_IDENTIFIER_MAX), so the 4th resend within the
          // hour used to answer 400 OTP_RATE_LIMITED for a pending identity
          // and 200 for an unknown number -- a working enumeration oracle.
          // Mirror the email path instead: do the work, report nothing about
          // how it went. An unsent token expires on its own.
          if (
            !(
              error instanceof ApiError &&
              PHONE_OTP_SILENT_ERROR_CODES.has(error.code)
            )
          ) {
            throw error;
          }
        }
      }
    }

    return c.json({
      success: true,
      data: { sent: true },
    });
  },
);

routes.post("/auth/verify-otp", validateBody(verifyOtpSchema), async (c) => {
  const { phone, otp, purpose } = c.get("validatedBody");
  const now = Date.now();
  const token = await c.env.DB.prepare(
    `SELECT id, customer_id, otp_code, attempts
       FROM customer_phone_verification_tokens
      WHERE phone = ?
        AND used_at_ms IS NULL
        AND expires_at_ms > ?
      ORDER BY created_at_ms DESC
      LIMIT 1`,
  )
    .bind(phone, now)
    .first<{
      id: number;
      customer_id: string | null;
      otp_code: string;
      attempts: number;
    }>();

  if (!token || token.attempts >= MAX_OTP_ATTEMPTS) {
    throw unauthorized("Invalid or expired OTP", "INVALID_OTP");
  }

  const valid = await bcrypt.compare(otp, token.otp_code);
  if (!valid) {
    await c.env.DB.prepare(
      `UPDATE customer_phone_verification_tokens
          SET attempts = attempts + 1
        WHERE id = ?`,
    )
      .bind(token.id)
      .run();
    throw unauthorized("Invalid or expired OTP", "INVALID_OTP");
  }

  const pendingPasswordIdentity = await loadPasswordIdentity(c.env, phone);

  if (purpose === "password_reset") {
    if (
      !token.customer_id ||
      !pendingPasswordIdentity ||
      token.customer_id !== pendingPasswordIdentity.customer_id
    ) {
      throw unauthorized("Invalid or expired OTP", "INVALID_OTP");
    }

    await c.env.DB.prepare(
      `UPDATE customer_phone_verification_tokens
          SET used_at_ms = ?
        WHERE id = ?`,
    )
      .bind(now, token.id)
      .run();

    const resetToken = await createVerificationToken(
      c,
      "password_reset",
      phone,
      pendingPasswordIdentity.customer_id,
      PASSWORD_RESET_TTL_MS,
    );

    return c.json({
      success: true,
      data: {
        resetToken,
        expiresInSeconds: PASSWORD_RESET_TTL_MS / 1000,
      },
    });
  }

  const customer =
    pendingPasswordIdentity && pendingPasswordIdentity.verified_at_ms === null
      ? await verifyPendingPhonePasswordIdentity(
          c.env,
          pendingPasswordIdentity,
          phone,
          now,
        )
      : await findOrCreateCustomerByPhone(c.env, phone, now);

  await c.env.DB.prepare(
    `UPDATE customer_phone_verification_tokens
        SET used_at_ms = ?, customer_id = ?
      WHERE id = ?`,
  )
    .bind(now, customer.id, token.id)
    .run();

  const session = await issueCustomerSession(
    c as unknown as Context<{ Bindings: Env }>,
    customer.id,
  );

  return c.json({
    success: true,
    data: {
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
      customer: toCustomerSummary(customer),
    },
  });
});

routes.post("/auth/refresh", async (c) => {
  const body = await readOptionalJson(c);
  const refreshToken =
    typeof body?.refreshToken === "string"
      ? body.refreshToken
      : getCookie(c, CUSTOMER_REFRESH_COOKIE);

  if (!refreshToken) {
    throw unauthorized("Refresh token is required", "TOKEN_INVALID");
  }

  const decoded = verifyJwtToken(refreshToken, c.env.JWT_SECRET);
  if (!isRefreshPayload(decoded)) {
    throw unauthorized("Invalid refresh token", "TOKEN_INVALID");
  }

  const refreshRecord = await c.env.TOKEN_BLACKLIST.get(
    customerRefreshRecordKey(decoded.sub, decoded.jti),
  );
  if (refreshRecord === null) {
    throw unauthorized("Refresh token has been revoked", "TOKEN_INVALID");
  }

  await revokeRefreshRecord(c.env, decoded.sub, decoded.jti);
  const customer = await loadCustomer(c.env, decoded.sub);
  if (!customer) {
    await revokeCustomerSession(c, null);
    throw unauthorized("Customer not found or inactive", "CUSTOMER_INACTIVE");
  }

  const session = await issueCustomerSession(c, customer.id);

  return c.json({
    success: true,
    data: {
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
    },
  });
});

routes.post("/auth/logout", canonicalCustomerAuthMiddleware, async (c) => {
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.substring(7)
    : undefined;
  const body = await readOptionalJson(c);
  const refreshToken =
    typeof body?.refreshToken === "string"
      ? body.refreshToken
      : getCookie(c, CUSTOMER_REFRESH_COOKIE);

  if (token) {
    await c.env.TOKEN_BLACKLIST.put(`token:${token}`, "blacklisted", {
      expirationTtl: CUSTOMER_ACCESS_TOKEN_SECONDS,
    });
  }

  if (refreshToken) {
    await revokeRefreshTokenFromSession(c, refreshToken);
  } else {
    await revokeCustomerSession(c, null);
  }

  return c.json({ success: true, data: { loggedOut: true } });
});

routes.get("/me", canonicalCustomerAuthMiddleware, async (c) => {
  const customer = await loadCustomer(c.env, c.get("customer").id);
  const preferences = await loadPreferences(c.env, c.get("customer").id);
  return c.json({
    success: true,
    data: {
      customer: customer ? toCustomerSummary(customer) : c.get("customer"),
      preferences,
    },
  });
});

routes.patch(
  "/me",
  canonicalCustomerAuthMiddleware,
  validateBody(profilePatchSchema),
  async (c) => {
    const customer = c.get("customer");
    const body = c.get("validatedBody");
    const now = Date.now();

    await c.env.DB.prepare(
      `UPDATE customers
          SET display_name = COALESCE(?, display_name),
              avatar_url = CASE WHEN ? THEN ? ELSE avatar_url END,
              locale = CASE WHEN ? THEN ? ELSE locale END,
              updated_at_ms = ?
        WHERE id = ?`,
    )
      .bind(
        body.displayName ?? null,
        Object.prototype.hasOwnProperty.call(body, "avatarUrl") ? 1 : 0,
        body.avatarUrl ?? null,
        Object.prototype.hasOwnProperty.call(body, "locale") ? 1 : 0,
        body.locale ?? null,
        now,
        customer.id,
      )
      .run();

    return c.json({
      success: true,
      data: {
        customer: toCustomerSummary(await requireCustomer(c.env, customer.id)),
      },
    });
  },
);

routes.delete("/me", canonicalCustomerAuthMiddleware, async (c) => {
  const now = Date.now();
  await c.env.DB.prepare(
    `UPDATE customers
        SET status = 'deleted', deleted_at_ms = ?, updated_at_ms = ?
      WHERE id = ?`,
  )
    .bind(now, now, c.get("customer").id)
    .run();
  return c.json({ success: true, data: { deleted: true } });
});

routes.get("/preferences", canonicalCustomerAuthMiddleware, async (c) => {
  return c.json({
    success: true,
    data: await loadPreferences(c.env, c.get("customer").id),
  });
});

routes.patch(
  "/preferences",
  canonicalCustomerAuthMiddleware,
  validateBody(preferencesPatchSchema),
  async (c) => {
    const customerId = c.get("customer").id;
    const body = c.get("validatedBody");
    const existing = await loadPreferences(c.env, customerId);
    const merged = { ...existing, ...body };
    const now = Date.now();

    await c.env.DB.prepare(
      `INSERT INTO customer_preferences
        (customer_id, dietary_tags, allergens, default_party_size,
         marketing_opt_in, waiting_list_opt_in, promo_from_favorites_opt_in,
         quiet_hours_start, quiet_hours_end, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(customer_id) DO UPDATE SET
         dietary_tags = excluded.dietary_tags,
         allergens = excluded.allergens,
         default_party_size = excluded.default_party_size,
         marketing_opt_in = excluded.marketing_opt_in,
         waiting_list_opt_in = excluded.waiting_list_opt_in,
         promo_from_favorites_opt_in = excluded.promo_from_favorites_opt_in,
         quiet_hours_start = excluded.quiet_hours_start,
         quiet_hours_end = excluded.quiet_hours_end,
         updated_at_ms = excluded.updated_at_ms`,
    )
      .bind(
        customerId,
        JSON.stringify(merged.dietaryTags ?? []),
        JSON.stringify(merged.allergens ?? []),
        // INTEGER column, re-bound from an untyped read — see toIntegerOrNull.
        toIntegerOrNull(merged.defaultPartySize),
        merged.marketingOptIn ? 1 : 0,
        merged.waitingListOptIn === false ? 0 : 1,
        merged.promoFromFavoritesOptIn ? 1 : 0,
        merged.quietHoursStart ?? null,
        merged.quietHoursEnd ?? null,
        now,
      )
      .run();

    return c.json({
      success: true,
      data: await loadPreferences(c.env, customerId),
    });
  },
);

routes.get(
  "/favorites",
  canonicalCustomerAuthMiddleware,
  validateQuery(favoriteQuerySchema),
  async (c) => {
    const customerId = c.get("customer").id;
    const { targetType } = c.get("validatedQuery");
    const result = targetType
      ? await c.env.DB.prepare(
          `SELECT id, target_type, target_id, created_at_ms
             FROM customer_favorites
            WHERE customer_id = ? AND target_type = ?
            ORDER BY created_at_ms DESC`,
        )
          .bind(customerId, targetType)
          .all()
      : await c.env.DB.prepare(
          `SELECT id, target_type, target_id, created_at_ms
             FROM customer_favorites
            WHERE customer_id = ?
            ORDER BY created_at_ms DESC`,
        )
          .bind(customerId)
          .all();

    return c.json({
      success: true,
      data: (result.results ?? []).map(toFavoriteSummary),
    });
  },
);

routes.post(
  "/favorites",
  canonicalCustomerAuthMiddleware,
  validateBody(favoriteSchema),
  async (c) => {
    const customerId = c.get("customer").id;
    const body = c.get("validatedBody");
    const now = Date.now();

    await validateFavoriteTarget(c.env, body.targetType, body.targetId);

    const existing = await c.env.DB.prepare(
      `SELECT id, target_type, target_id, created_at_ms
         FROM customer_favorites
        WHERE customer_id = ? AND target_type = ? AND target_id = ?
        LIMIT 1`,
    )
      .bind(customerId, body.targetType, body.targetId)
      .first();

    if (existing) {
      return c.json({ success: true, data: toFavoriteSummary(existing) });
    }

    await c.env.DB.prepare(
      `INSERT INTO customer_favorites
        (customer_id, target_type, target_id, created_at_ms)
       VALUES (?, ?, ?, ?)`,
    )
      .bind(customerId, body.targetType, body.targetId, now)
      .run();

    const row = await c.env.DB.prepare(
      `SELECT id, target_type, target_id, created_at_ms
         FROM customer_favorites
        WHERE customer_id = ? AND target_type = ? AND target_id = ?
        LIMIT 1`,
    )
      .bind(customerId, body.targetType, body.targetId)
      .first();

    return c.json({ success: true, data: toFavoriteSummary(row) }, 201);
  },
);

routes.delete("/favorites/:id", canonicalCustomerAuthMiddleware, async (c) => {
  await c.env.DB.prepare(
    `DELETE FROM customer_favorites
        WHERE id = ? AND customer_id = ?`,
  )
    .bind(c.req.param("id"), c.get("customer").id)
    .run();
  return c.json({ success: true, data: { deleted: true } });
});

routes.get(
  "/recent-markets",
  canonicalCustomerAuthMiddleware,
  validateQuery(recentMarketsQuerySchema),
  async (c) => {
    const customerId = c.get("customer").id;
    const { limit } = c.get("validatedQuery");
    const result = await c.env.DB.prepare(
      `SELECT market_id, visited_at_ms
         FROM customer_recent_markets
        WHERE customer_id = ?
        ORDER BY visited_at_ms DESC
        LIMIT ?`,
    )
      .bind(customerId, limit)
      .all();

    return c.json({
      success: true,
      data: (result.results ?? []).map(toRecentMarketSummary),
    });
  },
);

routes.post(
  "/recent-markets",
  canonicalCustomerAuthMiddleware,
  validateBody(recentMarketSchema),
  async (c) => {
    const customerId = c.get("customer").id;
    const body = c.get("validatedBody");
    const visitedAtMs = body.visitedAtMs ?? Date.now();

    await validateMarketTarget(c.env, body.marketId);

    await c.env.DB.prepare(
      `INSERT INTO customer_recent_markets
        (customer_id, market_id, visited_at_ms)
       VALUES (?, ?, ?)
       ON CONFLICT(customer_id, market_id) DO UPDATE SET
         visited_at_ms = excluded.visited_at_ms`,
    )
      .bind(customerId, body.marketId, visitedAtMs)
      .run();

    const row = await c.env.DB.prepare(
      `SELECT market_id, visited_at_ms
         FROM customer_recent_markets
        WHERE customer_id = ? AND market_id = ?
        LIMIT 1`,
    )
      .bind(customerId, body.marketId)
      .first();

    return c.json({ success: true, data: toRecentMarketSummary(row) }, 201);
  },
);

routes.get(
  "/push-subscriptions",
  canonicalCustomerAuthMiddleware,
  async (c) => {
    const result = await c.env.DB.prepare(
      `SELECT id, endpoint, p256dh_key, auth_key, user_agent, device_label,
            last_used_at_ms, failure_count, created_at_ms
       FROM customer_push_subscriptions
      WHERE customer_id = ?
      ORDER BY created_at_ms DESC`,
    )
      .bind(c.get("customer").id)
      .all();

    return c.json({ success: true, data: result.results ?? [] });
  },
);

routes.post(
  "/push-subscriptions",
  canonicalCustomerAuthMiddleware,
  validateBody(pushSubscriptionSchema),
  async (c) => {
    const customerId = c.get("customer").id;
    const body = c.get("validatedBody");
    const now = Date.now();
    const id = generateUUID();

    await c.env.DB.prepare(
      `INSERT INTO customer_push_subscriptions
        (id, customer_id, endpoint, p256dh_key, auth_key, user_agent,
         device_label, last_used_at_ms, failure_count, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         customer_id = excluded.customer_id,
         p256dh_key = excluded.p256dh_key,
         auth_key = excluded.auth_key,
         user_agent = excluded.user_agent,
         device_label = excluded.device_label,
         last_used_at_ms = excluded.last_used_at_ms`,
    )
      .bind(
        id,
        customerId,
        body.endpoint,
        body.p256dh,
        body.auth,
        body.userAgent ?? c.req.header("User-Agent") ?? null,
        body.deviceLabel ?? null,
        now,
        now,
      )
      .run();

    const row = await c.env.DB.prepare(
      `SELECT id, endpoint, device_label, created_at_ms
         FROM customer_push_subscriptions
        WHERE endpoint = ?
        LIMIT 1`,
    )
      .bind(body.endpoint)
      .first();

    return c.json({ success: true, data: row }, 201);
  },
);

routes.delete(
  "/push-subscriptions/:id",
  canonicalCustomerAuthMiddleware,
  async (c) => {
    await c.env.DB.prepare(
      `DELETE FROM customer_push_subscriptions
        WHERE id = ? AND customer_id = ?`,
    )
      .bind(c.req.param("id"), c.get("customer").id)
      .run();
    return c.json({ success: true, data: { deleted: true } });
  },
);

routes.get("/consents", canonicalCustomerAuthMiddleware, async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT id, consent_type, version, granted, granted_at_ms, source
       FROM customer_consents
      WHERE customer_id = ?
        AND granted = 1
        AND revoked_at_ms IS NULL
      ORDER BY granted_at_ms DESC`,
  )
    .bind(c.get("customer").id)
    .all();
  return c.json({ success: true, data: result.results ?? [] });
});

routes.post(
  "/consents",
  canonicalCustomerAuthMiddleware,
  validateBody(consentSchema),
  async (c) => {
    const customerId = c.get("customer").id;
    const body = c.get("validatedBody");
    const now = Date.now();

    if (!body.granted) {
      await c.env.DB.prepare(
        `UPDATE customer_consents
            SET revoked_at_ms = ?
          WHERE customer_id = ?
            AND consent_type = ?
            AND granted = 1
            AND revoked_at_ms IS NULL`,
      )
        .bind(now, customerId, body.consentType)
        .run();
    }

    const duplicate = await c.env.DB.prepare(
      `SELECT id
         FROM customer_consents
        WHERE customer_id = ?
          AND consent_type = ?
          AND version = ?
          AND granted = ?
        ORDER BY granted_at_ms DESC
        LIMIT 1`,
    )
      .bind(customerId, body.consentType, body.version, body.granted ? 1 : 0)
      .first<{ id: string }>();

    if (duplicate) {
      return c.json({ success: true, data: { id: duplicate.id } });
    }

    const id = generateUUID();
    await c.env.DB.prepare(
      `INSERT INTO customer_consents
        (id, customer_id, consent_type, version, granted, granted_at_ms,
         ip_address, user_agent, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        customerId,
        body.consentType,
        body.version,
        body.granted ? 1 : 0,
        now,
        clientIp(c),
        c.req.header("User-Agent") ?? null,
        body.source,
      )
      .run();

    return c.json({ success: true, data: { id } }, 201);
  },
);

/**
 * OTP message text. Taiwanese carriers require an identifiable sender, hence
 * the 【brand】 prefix; keeping the whole message inside one 70-character
 * UCS-2 segment keeps it billed as a single message.
 */
export function buildOtpSmsBody(
  otp: string,
  env: Pick<Env, "OTP_SMS_BRAND">,
): string {
  const brand = env.OTP_SMS_BRAND?.trim() || "MakanMasak";
  const minutes = Math.round(OTP_TTL_MS / 60_000);
  return `【${brand}】驗證碼 ${otp}，${minutes} 分鐘內有效。請勿將此碼提供給他人。`;
}

async function issuePhoneOtp<E extends { Bindings: Env }>(
  c: Context<E>,
  phone: string,
  customerId?: string,
): Promise<IssuedPhoneOtp> {
  const now = Date.now();
  const nodeEnv = c.env.NODE_ENV;
  const canEchoDevOtp = nodeEnv === "development" || nodeEnv === "test";
  const smsProvider = createSmsProvider(c.env);

  assertSmsChannelAvailable(c.env, smsProvider.name);

  const otp = generateOtp();
  const otpHash = await bcrypt.hash(otp, 10);

  await enforceOtpRateLimit(c.env, phone, c.req.header("CF-Connecting-IP"));

  // Persist before sending: an unsent code is harmless (it expires in
  // OTP_TTL_MS), whereas a sent code with no stored hash is unverifiable.
  await c.env.DB.prepare(
    `INSERT INTO customer_phone_verification_tokens
        (customer_id, phone, otp_code, expires_at_ms, ip_address, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      customerId ?? null,
      phone,
      otpHash,
      now + OTP_TTL_MS,
      clientIp(c),
      now,
    )
    .run();

  if (smsProvider.name !== "noop") {
    const sent = await smsProvider.sendSMS({
      to: phone,
      body: buildOtpSmsBody(otp, c.env),
    });

    if (!sent.success) {
      // Vendor detail stays server-side: it can name the account or the
      // failure reason, neither of which belongs in a public response.
      console.error("[customer-otp] SMS send failed", {
        provider: smsProvider.name,
        providerCode: sent.providerCode,
        error: sent.error,
      });
      throw new ApiError(
        "SMS_SEND_FAILED",
        "Could not deliver the verification code. Please try again.",
        502,
      );
    }
  }

  return {
    phone,
    expiresInSeconds: OTP_TTL_MS / 1000,
    ...(canEchoDevOtp ? { devOtp: otp } : {}),
  };
}

async function enforceOtpRateLimit(
  env: Env,
  phone: string,
  ip: string | undefined,
): Promise<void> {
  const phoneKey = `customer_otp_phone:${phone}`;
  const ipKey = `customer_otp_ip:${ip ?? "unknown"}`;
  const phoneCount = Number((await env.RATE_LIMIT_KV.get(phoneKey)) ?? "0");
  const ipCount = Number((await env.RATE_LIMIT_KV.get(ipKey)) ?? "0");

  if (phoneCount >= 3 || ipCount >= 10) {
    throw badRequest("Too many OTP requests", "OTP_RATE_LIMITED");
  }

  await Promise.all([
    env.RATE_LIMIT_KV.put(phoneKey, String(phoneCount + 1), {
      expirationTtl: 60 * 60,
    }),
    env.RATE_LIMIT_KV.put(ipKey, String(ipCount + 1), {
      expirationTtl: 60 * 60,
    }),
  ]);
}

async function readOptionalJson(
  c: Context,
): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await c.req.json();
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseAuthIdentifier(rawIdentifier: string): AuthIdentifier {
  const trimmed = rawIdentifier.trim();
  if (trimmed.includes("@")) {
    const email = trimmed.toLowerCase();
    const parsed = z.email().safeParse(email);
    if (!parsed.success) {
      throw badRequest("Invalid identifier", "INVALID_IDENTIFIER");
    }
    return { kind: "email", value: email };
  }

  try {
    return { kind: "phone", value: phoneSchema.parse(trimmed) };
  } catch {
    throw badRequest("Invalid identifier", "INVALID_IDENTIFIER");
  }
}

/**
 * A production deploy with no email vendor cannot deliver a verification or
 * reset link to anyone. Refuse up front rather than answering 200/201 for a
 * mail that will never arrive — the silent version of this is what let broken
 * email configuration survive every green deploy. Mirrors the SMS guard in
 * `issuePhoneOtp`, which uses the same NODE_ENV + "noop" provider test.
 *
 * The decision reads env only, never account state, so callers must invoke it
 * *before* looking the identity up: `/forgot-password` and
 * `/resend-verification` answer identically for known and unknown identifiers,
 * and a guard that fired only for existing accounts would turn a misconfigured
 * deploy into an account-existence oracle.
 *
 * Outside production a noop provider stays usable: local dev and tests must be
 * able to register without a mail vendor.
 */
function assertEmailChannelAvailable(env: Env): void {
  if (env.NODE_ENV !== "production") return;
  if (resolveEmailProviderName(env) !== "noop") return;

  throw new ApiError(
    "EMAIL_CHANNEL_UNAVAILABLE",
    "Email delivery is not configured",
    503,
  );
}

function assertSmsChannelAvailable(env: Env, providerName?: string): void {
  if (env.NODE_ENV !== "production") return;
  if ((providerName ?? createSmsProvider(env).name) !== "noop") return;

  throw new ApiError(
    "SMS_CHANNEL_UNAVAILABLE",
    "SMS delivery is not configured",
    503,
  );
}

function rejectWeakPassword(password: string): void {
  if (COMMON_PASSWORDS.has(password.trim().toLowerCase())) {
    throw badRequest("Password is too common", "WEAK_PASSWORD");
  }
}

async function enforcePasswordRateLimit<E extends { Bindings: Env }>(
  c: Context<E>,
  purpose: string,
  identifier: string,
): Promise<void> {
  const identifierKey = `customer_password_${purpose}_identifier:${identifier}`;
  const ipKey = `customer_password_${purpose}_ip:${clientIp(c)}`;
  const identifierCount = Number(
    (await c.env.RATE_LIMIT_KV.get(identifierKey)) ?? "0",
  );
  const ipCount = Number((await c.env.RATE_LIMIT_KV.get(ipKey)) ?? "0");

  if (
    identifierCount >= PASSWORD_RATE_LIMIT_IDENTIFIER_MAX ||
    ipCount >= PASSWORD_RATE_LIMIT_IP_MAX
  ) {
    throw badRequest("Too many requests", "PASSWORD_RATE_LIMITED");
  }

  await Promise.all([
    c.env.RATE_LIMIT_KV.put(identifierKey, String(identifierCount + 1), {
      expirationTtl: PASSWORD_RATE_LIMIT_TTL_SECONDS,
    }),
    c.env.RATE_LIMIT_KV.put(ipKey, String(ipCount + 1), {
      expirationTtl: PASSWORD_RATE_LIMIT_TTL_SECONDS,
    }),
  ]);
}

async function loadPasswordIdentity(
  env: Env,
  providerUid: string,
): Promise<PasswordIdentityRow | null> {
  return env.DB.prepare(
    `SELECT
        cai.id AS identity_id,
        cai.customer_id,
        cai.provider_uid,
        cai.secret_hash,
        cai.verified_at_ms,
        c.id,
        c.display_name,
        c.primary_phone,
        c.primary_email,
        c.avatar_url,
        c.locale,
        c.status,
        c.last_seen_at_ms,
        c.created_at_ms,
        c.updated_at_ms
       FROM customer_auth_identities cai
       JOIN customers c ON c.id = cai.customer_id
      WHERE cai.provider = ?
        AND cai.provider_uid = ?
        AND c.status = 'active'
      LIMIT 1`,
  )
    .bind(CUSTOMER_PASSWORD_PROVIDER, providerUid)
    .first<PasswordIdentityRow>();
}

async function verifyPendingPhonePasswordIdentity(
  env: Env,
  identity: PasswordIdentityRow,
  phone: string,
  now: number,
): Promise<CustomerRow> {
  await env.DB.prepare(
    `UPDATE customer_auth_identities
        SET verified_at_ms = ?, updated_at_ms = ?
      WHERE id = ?`,
  )
    .bind(now, now, identity.identity_id)
    .run();

  await env.DB.prepare(
    `UPDATE customers
        SET primary_phone = ?, updated_at_ms = ?
      WHERE id = ?`,
  )
    .bind(phone, now, identity.customer_id)
    .run();

  return {
    id: identity.customer_id,
    display_name: identity.display_name,
    primary_phone: phone,
    primary_email: identity.primary_email,
    avatar_url: identity.avatar_url,
    locale: identity.locale,
    status: identity.status,
    last_seen_at_ms: identity.last_seen_at_ms,
    created_at_ms: identity.created_at_ms,
    updated_at_ms: now,
  };
}

async function loadVerificationToken(
  env: Env,
  tokenHash: string,
  purpose: "password_reset" | "email_verify",
): Promise<VerificationTokenRow | null> {
  return env.DB.prepare(
    `SELECT id, customer_id, purpose, identifier, expires_at_ms, used_at_ms
       FROM customer_verification_tokens
      WHERE token_hash = ? AND purpose = ?
      LIMIT 1`,
  )
    .bind(tokenHash, purpose)
    .first<VerificationTokenRow>();
}

/**
 * Mint a verification token and, for email identifiers, send the link.
 *
 * Returns whether the message actually reached the provider. Callers decide
 * what to do with a failure, and they do NOT all decide the same thing:
 * `/register` surfaces it, because a customer who never receives the link can
 * never log in; `/forgot-password` and `/resend-verification` must stay silent,
 * because varying their response would turn them into account-existence
 * oracles.
 *
 * Phone identifiers are rejected with `delivered: false`; phone delivery must
 * go through the OTP flow instead of creating an unreachable link token.
 */
async function createAndSendVerificationToken<E extends { Bindings: Env }>(
  c: Context<E>,
  purpose: "password_reset" | "email_verify",
  identifier: string,
  customerId: string,
  ttlMs: number,
  displayName: string,
): Promise<{ delivered: boolean }> {
  if (!identifier.includes("@")) return { delivered: false };

  const token = await createVerificationToken(
    c,
    purpose,
    identifier,
    customerId,
    ttlMs,
  );
  const now = Date.now();

  const appUrl =
    (c.env as Env & { CUSTOMER_APP_URL?: string }).CUSTOMER_APP_URL ??
    "https://makanmasak.com";
  const path =
    purpose === "password_reset" ? "/reset-password" : "/verify-email";
  const link = `${appUrl}${path}?token=${encodeURIComponent(token)}`;
  const service = new NotificationService(c.env.DB, c.env);
  const result = await service.sendNotification({
    recipientId: customerId,
    recipientEmail: identifier,
    category:
      purpose === "password_reset"
        ? "password_reset_request"
        : "email_verification",
    type: "email",
    data:
      purpose === "password_reset"
        ? {
            userName: displayName,
            resetLink: link,
            ipAddress: clientIp(c),
            requestTime: new Date(now).toISOString(),
          }
        : {
            userName: displayName,
            verificationLink: link,
          },
  });

  if (!result.success) {
    console.error("[customer-auth] email notification failed", {
      purpose,
      errors: result.errors,
    });
  }

  return { delivered: result.success };
}

async function createVerificationToken<E extends { Bindings: Env }>(
  c: Context<E>,
  purpose: "password_reset" | "email_verify",
  identifier: string,
  customerId: string,
  ttlMs: number,
): Promise<string> {
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO customer_verification_tokens
      (id, customer_id, purpose, identifier, token_hash, expires_at_ms,
       ip_address, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      generateUUID(),
      customerId,
      purpose,
      identifier,
      tokenHash,
      now + ttlMs,
      clientIp(c),
      now,
    )
    .run();
  return token;
}

async function revokeAllCustomerRefreshRecords(
  env: Pick<Env, "TOKEN_BLACKLIST">,
  customerId: string,
): Promise<void> {
  let cursor: string | undefined;
  do {
    const result = await env.TOKEN_BLACKLIST.list({
      prefix: `customer_refresh:${customerId}:`,
      cursor,
    });
    await Promise.all(
      result.keys.map((key) => env.TOKEN_BLACKLIST.delete(key.name)),
    );
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /unique|constraint/i.test(`${error.name} ${error.message}`)
  );
}

async function revokeRefreshTokenFromSession(
  c: Context<{ Bindings: Env }>,
  refreshToken: string,
): Promise<void> {
  try {
    const decoded = verifyJwtToken(refreshToken, c.env.JWT_SECRET);
    if (isRefreshPayload(decoded)) {
      await revokeCustomerSession(c, decoded.jti, decoded.sub);
      return;
    }
  } catch {
    // Logout is best-effort: an invalid refresh token should not prevent
    // the access token from being invalidated.
  }

  await revokeCustomerSession(c, null);
}

async function validateFavoriteTarget(
  env: Env,
  targetType: z.infer<typeof favoriteTargetTypeSchema>,
  targetId: string,
): Promise<void> {
  if (targetType === "restaurant") {
    const row = await env.DB.prepare(
      `SELECT id
         FROM restaurants
        WHERE id = ? AND deleted_at_ms IS NULL
        LIMIT 1`,
    )
      .bind(targetId)
      .first();
    if (!row) throw badRequest("Favorite target not found", "TARGET_NOT_FOUND");
    return;
  }

  if (targetType === "dish") {
    const numericTargetId = Number(targetId);
    if (!Number.isInteger(numericTargetId) || numericTargetId <= 0) {
      throw badRequest("Favorite target not found", "TARGET_NOT_FOUND");
    }
    const row = await env.DB.prepare(
      `SELECT id
         FROM menu_items
        WHERE id = ? AND deleted_at_ms IS NULL
        LIMIT 1`,
    )
      .bind(numericTargetId)
      .first();
    if (!row) throw badRequest("Favorite target not found", "TARGET_NOT_FOUND");
    return;
  }

  await validateMarketTarget(env, targetId);
}

async function validateMarketTarget(env: Env, marketId: string): Promise<void> {
  const marketsTable = await env.DB.prepare(
    `SELECT name
       FROM sqlite_master
      WHERE type = 'table' AND name = 'markets'
      LIMIT 1`,
  ).first();
  if (!marketsTable) {
    throw badRequest(
      "Market favorites are not available yet",
      "TARGET_NOT_FOUND",
    );
  }

  const row = await env.DB.prepare(
    `SELECT id
       FROM markets
      WHERE id = ? AND deleted_at_ms IS NULL
      LIMIT 1`,
  )
    .bind(marketId)
    .first();
  if (!row) throw badRequest("Market not found", "TARGET_NOT_FOUND");
}

async function findOrCreateCustomerByPhone(
  env: Env,
  phone: string,
  now: number,
): Promise<CustomerRow> {
  const existing = await env.DB.prepare(
    `SELECT * FROM customers
      WHERE primary_phone = ? AND status = 'active'
      LIMIT 1`,
  )
    .bind(phone)
    .first<CustomerRow>();

  if (existing) return existing;

  await env.DB.prepare(
    `UPDATE customers
        SET primary_phone = NULL,
            updated_at_ms = ?
      WHERE primary_phone = ?
        AND status = 'deleted'`,
  )
    .bind(now, phone)
    .run();

  const id = generateUUID();
  await env.DB.prepare(
    `INSERT INTO customers
      (id, display_name, primary_phone, status, created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, 'active', ?, ?)`,
  )
    .bind(id, phone, phone, now, now)
    .run();

  return requireCustomer(env, id);
}

export async function pruneStaleCustomerPushSubscriptions(
  env: Env,
  nowMs = Date.now(),
): Promise<{ deleted: number }> {
  const staleBeforeMs = nowMs - 90 * 24 * 60 * 60 * 1000;
  const result = await env.DB.prepare(
    `DELETE FROM customer_push_subscriptions
      WHERE last_used_at_ms < ?
        AND failure_count >= 3`,
  )
    .bind(staleBeforeMs)
    .run();

  return { deleted: result.meta.changes ?? 0 };
}

async function loadCustomer(
  env: Env,
  customerId: string,
): Promise<CustomerRow | null> {
  return env.DB.prepare(
    `SELECT * FROM customers
      WHERE id = ? AND status = 'active'
      LIMIT 1`,
  )
    .bind(customerId)
    .first<CustomerRow>();
}

async function requireCustomer(env: Env, customerId: string) {
  const customer = await loadCustomer(env, customerId);
  if (!customer) {
    throw unauthorized("Customer not found or inactive", "CUSTOMER_INACTIVE");
  }
  return customer;
}

async function loadPreferences(env: Env, customerId: string) {
  const row = await env.DB.prepare(
    `SELECT dietary_tags, allergens, default_party_size, marketing_opt_in,
            waiting_list_opt_in, promo_from_favorites_opt_in,
            quiet_hours_start, quiet_hours_end, updated_at_ms
       FROM customer_preferences
      WHERE customer_id = ?
      LIMIT 1`,
  )
    .bind(customerId)
    .first<Record<string, unknown>>();

  return {
    dietaryTags: parseJsonArray(row?.dietary_tags),
    allergens: parseJsonArray(row?.allergens),
    defaultPartySize: row?.default_party_size ?? null,
    marketingOptIn: Number(row?.marketing_opt_in ?? 0) === 1,
    waitingListOptIn: Number(row?.waiting_list_opt_in ?? 1) === 1,
    promoFromFavoritesOptIn:
      Number(row?.promo_from_favorites_opt_in ?? 0) === 1,
    quietHoursStart: row?.quiet_hours_start ?? null,
    quietHoursEnd: row?.quiet_hours_end ?? null,
    updatedAtMs: row?.updated_at_ms ?? null,
  };
}

/**
 * Narrow an untyped D1 read back to an integer before it is re-bound.
 *
 * `PATCH /preferences` is a read-modify-write: any field the request omits is
 * re-bound from whatever `loadPreferences` returned, and those values are typed
 * `unknown` because they come off a raw `D1Result` row. `D1PreparedStatement`
 * accepts `unknown[]`, so neither TypeScript nor Drizzle sees the hazard, and
 * `customer_preferences` is STRICT only in the baseline — production was built
 * from the legacy track and is not uniformly STRICT (see CLAUDE.md), so SQLite
 * would silently store TEXT in the INTEGER `default_party_size` column and hand
 * it back as a string forever after. Coerce here; nothing downstream will.
 */
function toIntegerOrNull(value: unknown): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(numeric) ? numeric : null;
}

function isRefreshPayload(
  decoded: unknown,
): decoded is { sub: string; type: "customer_refresh"; jti: string } {
  if (!decoded || typeof decoded !== "object") return false;
  const payload = decoded as Record<string, unknown>;
  return (
    typeof payload.sub === "string" &&
    payload.type === "customer_refresh" &&
    typeof payload.jti === "string"
  );
}

function toCustomerSummary(customer: CustomerRow) {
  return {
    id: customer.id,
    displayName: customer.display_name,
    primaryPhone: customer.primary_phone,
    primaryEmail: customer.primary_email,
    avatarUrl: customer.avatar_url,
    locale: customer.locale,
    status: customer.status,
    lastSeenAtMs: customer.last_seen_at_ms,
    createdAtMs: customer.created_at_ms,
    updatedAtMs: customer.updated_at_ms,
  };
}

function toFavoriteSummary(row: unknown) {
  const favorite = row as {
    id: number;
    target_type: string;
    target_id: string;
    created_at_ms: number;
  } | null;

  if (!favorite) return null;

  return {
    id: favorite.id,
    targetType: favorite.target_type,
    targetId: favorite.target_id,
    createdAtMs: favorite.created_at_ms,
  };
}

function toRecentMarketSummary(row: unknown) {
  const recentMarket = row as {
    market_id: string;
    visited_at_ms: number;
  } | null;

  if (!recentMarket) return null;

  return {
    marketId: recentMarket.market_id,
    visitedAtMs: recentMarket.visited_at_ms,
  };
}

function decodeHtmlEntities(value: string): string {
  // Decode &amp; LAST so a literal `&amp;lt;` round-trips to `&lt;`, not `<`
  // (decoding it first would re-expose escaped markup — a sanitizer bypass).
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#x60;/g, "`")
    .replace(/&#x3D;/g, "=")
    .replace(/&amp;/g, "&");
}

export function generateOtp(
  getRandomValues: Uint32RandomValues = (values) =>
    crypto.getRandomValues(values),
): string {
  const values = new Uint32Array(1);

  while (true) {
    getRandomValues(values);
    const value = values[0];

    if (value >= OTP_RANDOM_BOUNDARY) {
      continue;
    }

    return (value % OTP_CODE_SPACE).toString().padStart(6, "0");
  }
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value))
    return value.filter((item) => typeof item === "string");
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function clientIp(c: Context): string {
  return (
    c.req.header("CF-Connecting-IP") ?? c.req.header("X-Forwarded-For") ?? ""
  );
}

// Federated sign-in lives in its own file; the paths stay under /customer/auth
// so the customer app sees one auth surface rather than two.
routes.route("/", oauthRoutes);

export default routes;
