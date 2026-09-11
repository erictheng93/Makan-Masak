/**
 * Authentication Validation Schemas
 * Zod schemas for validating authentication API requests
 */

import { z } from "zod";
import { VALIDATION_LIMITS } from "../../../shared/constants";

// Common validation patterns
const USERNAME_REGEX = /^[a-zA-Z0-9_-]+$/;
const PASSWORD_STRENGTH_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/;
const ipAddressSchema = z.lazy(() => z.union([z.ipv4(), z.ipv6()]));

// Device and Location schemas
const deviceInfoSchema = z.lazy(() =>
  z
    .object({
      userAgent: z.string().max(500).optional(),
      ipAddress: ipAddressSchema.optional(),
      platform: z.enum(["mobile", "desktop", "tablet"]).optional(),
      deviceType: z.string().max(100).optional(),
      browser: z.string().max(100).optional(),
      version: z.string().max(50).optional(),
    })
    .optional(),
);

const locationInfoSchema = z.lazy(() =>
  z
    .object({
      country: z.string().max(100).optional(),
      city: z.string().max(100).optional(),
      coordinates: z
        .object({
          lat: z.number().min(-90).max(90),
          lng: z.number().min(-180).max(180),
        })
        .optional(),
    })
    .optional(),
);

// Password validation schema
const passwordSchema = z
  .string()
  .min(
    VALIDATION_LIMITS.MIN_PASSWORD_LENGTH,
    `Password must be at least ${VALIDATION_LIMITS.MIN_PASSWORD_LENGTH} characters`,
  )
  .max(100, "Password must be less than 100 characters")
  .refine(
    (password) =>
      password.length >= 8 ? PASSWORD_STRENGTH_REGEX.test(password) : true,
    {
      message:
        "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character when 8+ characters",
    },
  );

// Username validation schema
const usernameSchema = z
  .string()
  .min(3, "Username must be at least 3 characters")
  .max(50, "Username must be less than 50 characters")
  .regex(
    USERNAME_REGEX,
    "Username can only contain letters, numbers, hyphens, and underscores",
  );

// Email validation schema
const emailSchema = z
  .email("Invalid email format")
  .max(
    VALIDATION_LIMITS.EMAIL_MAX_LENGTH,
    `Email must be less than ${VALIDATION_LIMITS.EMAIL_MAX_LENGTH} characters`,
  );

// Phone validation schema (support both international and local formats)
const phoneSchema = z
  .string()
  .regex(/^[\d\s\-+()]+$/, "Invalid phone number format")
  .min(8, "Phone number must be at least 8 digits")
  .max(
    VALIDATION_LIMITS.PHONE_MAX_LENGTH,
    `Phone must be less than ${VALIDATION_LIMITS.PHONE_MAX_LENGTH} characters`,
  );

// Staff user role validation. Customer identity now lives in `customers`, so
// new `users.role = 5` rows are not accepted by staff/user creation flows.
const roleSchema = z.lazy(() =>
  z
    .number()
    .int("Role must be an integer")
    .min(0, "Role must be 0 or greater")
    .max(4, "Role must be 4 or less")
    .refine((role) => [0, 1, 2, 3, 4].includes(role), {
      message: "Invalid role value",
    }),
);

// Authentication request schemas
const loginSchema = z.object({
  username: usernameSchema,
  password: z
    .string()
    .min(1, "Password is required")
    .max(100, "Password is too long"),
  rememberMe: z.boolean().optional(),
});

const registerSchema = z
  .object({
    username: usernameSchema,
    fullName: z
      .string()
      .min(1, "Full name is required")
      .max(
        VALIDATION_LIMITS.NAME_MAX_LENGTH,
        `Full name must be less than ${VALIDATION_LIMITS.NAME_MAX_LENGTH} characters`,
      )
      .trim(),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Password confirmation is required"),
    role: roleSchema,
    restaurantId: z.uuid("Restaurant ID must be a valid UUID").optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })
  .refine((data) => data.email || data.phone, {
    message: "Either email or phone number is required",
    path: ["email"],
  });

// Customer registration schema (public, no confirmPassword needed)
const customerRegisterSchema = z.lazy(() =>
  z.object({
    username: usernameSchema,
    fullName: z
      .string()
      .min(1, "Full name is required")
      .max(
        VALIDATION_LIMITS.NAME_MAX_LENGTH,
        `Full name must be less than ${VALIDATION_LIMITS.NAME_MAX_LENGTH} characters`,
      )
      .trim(),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    password: z
      .string()
      .min(
        VALIDATION_LIMITS.MIN_PASSWORD_LENGTH,
        `Password must be at least ${VALIDATION_LIMITS.MIN_PASSWORD_LENGTH} characters`,
      )
      .max(100, "Password must be less than 100 characters"),
    role: z.literal(5).optional(), // Retired endpoint only accepts legacy shape.
  }),
);

const refreshTokenSchema = z.object({
  refreshToken: z
    .string()
    .min(1, "Refresh token is required")
    .max(1000, "Refresh token is too long"),
});

const changePasswordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, "Current password is required")
      .max(100, "Current password is too long"),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, "Password confirmation is required"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "New passwords do not match",
    path: ["confirmPassword"],
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "New password must be different from current password",
    path: ["newPassword"],
  });

const forgotPasswordSchema = z.lazy(() =>
  z
    .object({
      email: emailSchema.optional(),
      username: usernameSchema.optional(),
    })
    .refine((data) => data.email || data.username, {
      message: "Either email or username is required",
      path: ["email"],
    }),
);

const resetPasswordSchema = z.lazy(() =>
  z
    .object({
      token: z
        .string()
        .min(1, "Reset token is required")
        .max(500, "Reset token is too long"),
      newPassword: passwordSchema,
      confirmPassword: z.string().min(1, "Password confirmation is required"),
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
      message: "Passwords do not match",
      path: ["confirmPassword"],
    }),
);

const verifyEmailSchema = z.lazy(() =>
  z.object({
    token: z
      .string()
      .min(1, "Verification token is required")
      .max(500, "Verification token is too long"),
  }),
);

// Two-factor authentication schemas
const twoFactorSetupSchema = z.lazy(() =>
  z.object({
    password: z
      .string()
      .min(1, "Password is required")
      .max(100, "Password is too long"),
  }),
);

const twoFactorVerifySchema = z.lazy(() =>
  z
    .object({
      token: z
        .string()
        .regex(/^\d{6}$/, "Two-factor token must be 6 digits")
        .optional(),
      backupCode: z
        .string()
        .regex(/^[A-Z0-9]{8}$/, "Backup code must be 8 characters")
        .optional(),
    })
    .refine((data) => data.token || data.backupCode, {
      message: "Either 2FA token or backup code is required",
      path: ["token"],
    }),
);

// User profile update schema
const updateProfileSchema = z.lazy(() =>
  z
    .object({
      fullName: z
        .string()
        .min(1, "Full name is required")
        .max(
          VALIDATION_LIMITS.NAME_MAX_LENGTH,
          `Full name must be less than ${VALIDATION_LIMITS.NAME_MAX_LENGTH} characters`,
        )
        .trim()
        .optional(),
      email: emailSchema.optional(),
      phone: phoneSchema.optional(),
    })
    .refine(
      (data) => {
        // At least one field must be provided
        return Object.keys(data).some(
          (key) => data[key as keyof typeof data] !== undefined,
        );
      },
      {
        message: "At least one field must be updated",
      },
    ),
);

// Session management schemas
const terminateSessionSchema = z.object({
  sessionId: z
    .string()
    .min(1, "Session ID is required")
    .max(100, "Session ID is too long"),
});

const terminateAllSessionsSchema = z.object({
  except: z.string().max(100, "Session ID is too long").optional(),
});

// Query parameter schemas
const authStatsQuerySchema = z.lazy(() =>
  z.object({
    timeRange: z.enum(["24h", "7d", "30d", "90d", "1y"]).default("30d"),
    restaurantId: z
      .string()
      .transform(Number)
      .refine((val) => Number.isInteger(val) && val > 0, {
        message: "Restaurant ID must be a positive integer",
      })
      .optional(),
  }),
);

const securityEventsQuerySchema = z.lazy(() =>
  z.object({
    page: z
      .string()
      .transform(Number)
      .refine((val) => Number.isInteger(val) && val > 0, {
        message: "Page must be a positive integer",
      })
      .optional(),
    limit: z
      .string()
      .transform(Number)
      .refine((val) => Number.isInteger(val) && val > 0 && val <= 100, {
        message: "Limit must be a positive integer up to 100",
      })
      .optional(),
    severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
    type: z
      .enum([
        "LOGIN",
        "LOGIN_FAILED",
        "LOGOUT",
        "PASSWORD_CHANGED",
        "TWO_FACTOR_ENABLED",
        "TWO_FACTOR_DISABLED",
        "ACCOUNT_LOCKED",
        "PASSWORD_RESET_REQUESTED",
        "PASSWORD_RESET_COMPLETED",
        "EMAIL_VERIFIED",
      ])
      .optional(),
    startDate: z.iso.datetime().optional(),
    endDate: z.iso.datetime().optional(),
  }),
);

// Parameter validation schemas
const userIdParamSchema = z.lazy(() =>
  z.object({
    id: z.string().trim().min(1, "User ID is required"),
  }),
);

const sessionIdParamSchema = z.lazy(() =>
  z.object({
    sessionId: z
      .string()
      .min(1, "Session ID is required")
      .max(100, "Session ID is too long"),
  }),
);

// Header validation schemas
const authHeaderSchema = z.object({
  authorization: z
    .string()
    .min(1, "Authorization header is required")
    .startsWith("Bearer ", 'Authorization header must start with "Bearer "'),
});

const refreshTokenHeaderSchema = z.lazy(() =>
  z.object({
    "x-refresh-token": z
      .string()
      .min(1, "Refresh token header is required")
      .max(1000, "Refresh token is too long"),
  }),
);

// Rate limiting validation
const rateLimitSchema = z.lazy(() =>
  z.object({
    ip: ipAddressSchema,
    userAgent: z.string().max(500),
    endpoint: z.string().max(100),
    method: z.string().max(10),
  }),
);

// Advanced validation schemas for security features
const securityEventSchema = z.lazy(() =>
  z.object({
    type: z.enum([
      "LOGIN",
      "LOGIN_FAILED",
      "LOGOUT",
      "PASSWORD_CHANGED",
      "TWO_FACTOR_ENABLED",
      "TWO_FACTOR_DISABLED",
      "ACCOUNT_LOCKED",
      "PASSWORD_RESET_REQUESTED",
      "PASSWORD_RESET_COMPLETED",
      "EMAIL_VERIFIED",
    ]),
    userId: z.number().int().positive().optional(),
    username: z.string().max(50).optional(),
    ipAddress: ipAddressSchema.optional(),
    userAgent: z.string().max(500).optional(),
    location: locationInfoSchema,
    metadata: z.record(z.string(), z.any()).optional(),
    severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  }),
);

// Batch operation schemas
const bulkUserActionSchema = z.lazy(() =>
  z.object({
    userIds: z
      .array(z.number().int().positive())
      .min(1, "At least one user ID is required")
      .max(100, "Maximum 100 users allowed"),
    action: z.enum(["activate", "deactivate", "lock", "unlock"]),
    reason: z
      .string()
      .min(1, "Reason is required")
      .max(500, "Reason must be less than 500 characters"),
  }),
);

// Export all schemas
export const authSchemas = {
  // Authentication
  login: loginSchema,
  register: registerSchema,
  customerRegister: customerRegisterSchema,
  refreshToken: refreshTokenSchema,
  changePassword: changePasswordSchema,
  forgotPassword: forgotPasswordSchema,
  resetPassword: resetPasswordSchema,
  verifyEmail: verifyEmailSchema,

  // Two-factor authentication
  twoFactorSetup: twoFactorSetupSchema,
  twoFactorVerify: twoFactorVerifySchema,

  // Profile management
  updateProfile: updateProfileSchema,

  // Session management
  terminateSession: terminateSessionSchema,
  terminateAllSessions: terminateAllSessionsSchema,

  // Query parameters
  authStatsQuery: authStatsQuerySchema,
  securityEventsQuery: securityEventsQuerySchema,

  // Parameters
  userIdParam: userIdParamSchema,
  sessionIdParam: sessionIdParamSchema,

  // Headers
  authHeader: authHeaderSchema,
  refreshTokenHeader: refreshTokenHeaderSchema,

  // Security
  securityEvent: securityEventSchema,
  rateLimit: rateLimitSchema,

  // Batch operations
  bulkUserAction: bulkUserActionSchema,

  // Reusable component schemas
  deviceInfo: deviceInfoSchema,
  locationInfo: locationInfoSchema,
  password: passwordSchema,
  username: usernameSchema,
  email: emailSchema,
  phone: phoneSchema,
  role: roleSchema,
} as const;

// Type exports for TypeScript inference
export type LoginSchema = z.infer<typeof loginSchema>;
export type RegisterSchema = z.infer<typeof registerSchema>;
export type RefreshTokenSchema = z.infer<typeof refreshTokenSchema>;
export type ChangePasswordSchema = z.infer<typeof changePasswordSchema>;
export type ForgotPasswordSchema = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordSchema = z.infer<typeof resetPasswordSchema>;
export type VerifyEmailSchema = z.infer<typeof verifyEmailSchema>;
export type TwoFactorSetupSchema = z.infer<typeof twoFactorSetupSchema>;
export type TwoFactorVerifySchema = z.infer<typeof twoFactorVerifySchema>;
export type UpdateProfileSchema = z.infer<typeof updateProfileSchema>;
export type TerminateSessionSchema = z.infer<typeof terminateSessionSchema>;
export type SecurityEventSchema = z.infer<typeof securityEventSchema>;
export type AuthStatsQuerySchema = z.infer<typeof authStatsQuerySchema>;
export type SecurityEventsQuerySchema = z.infer<
  typeof securityEventsQuerySchema
>;
