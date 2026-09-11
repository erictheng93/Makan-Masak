import { z } from "zod";
import {
  boundedLimitQuery,
  commonSchemas,
} from "../../../middleware/validation";

// SECURITY: Strong password validation regex
const PASSWORD_STRENGTH_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/;

const restaurantIdQuerySchema = z.string().trim().min(1).optional();
const restaurantIdInputSchema = z
  .union([z.string().trim().min(1), z.number().int().positive()])
  .optional();

// Strong password schema - requires 8+ characters with uppercase, lowercase, number, and special character
const strongPasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(100, "Password must be less than 100 characters")
  .refine((password) => PASSWORD_STRENGTH_REGEX.test(password), {
    message:
      "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&)",
  });

/**
 * User creation validation schema
 */
export const createUserSchema = z.lazy(() =>
  z.object({
    username: z.string().min(3).max(50),
    fullName: z.string().min(1).max(100),
    email: z.email().optional(),
    phone: z.string().max(20).optional(),
    password: strongPasswordSchema,
    role: z.number().int().min(0).max(4),
    restaurantId: restaurantIdInputSchema,
    address: z.string().max(200).optional(),
    dateOfBirth: z.string().optional(),
    profileImageUrl: z.url().optional(),
    preferences: z.any().optional(),
  }),
);

/**
 * User update validation schema
 */
export const updateUserSchema = z.lazy(() =>
  z.object({
    email: z.email().optional(),
    phone: z.string().max(20).optional(),
    fullName: z.string().min(1).max(100).optional(),
    address: z.string().max(200).optional(),
    dateOfBirth: z.string().optional(),
    profileImageUrl: z.url().optional(),
    preferences: z.any().optional(),
    isActive: z.boolean().optional(),
    isVerified: z.boolean().optional(),
  }),
);

/**
 * Password update validation schema
 */
export const updatePasswordSchema = z.lazy(() =>
  z
    .object({
      currentPassword: z
        .string()
        .min(1, "Current password is required")
        .max(100),
      newPassword: strongPasswordSchema,
      confirmPassword: z.string().min(1, "Password confirmation is required"),
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
      message: "Passwords don't match",
      path: ["confirmPassword"],
    })
    .refine((data) => data.currentPassword !== data.newPassword, {
      message: "New password must be different from current password",
      path: ["newPassword"],
    }),
);

/**
 * User filter validation schema
 */
export const userFilterSchema = z.lazy(() =>
  commonSchemas.paginationQuery.extend({
    restaurantId: restaurantIdQuerySchema,
    role: z.string().regex(/^\d+$/).transform(Number).optional(),
    isActive: z
      .string()
      .transform((val) => val === "true")
      .optional(),
    isVerified: z
      .string()
      .transform((val) => val === "true")
      .optional(),
    // Omitted means current staff, so an existing caller keeps departed
    // employees out of its list without being changed (#337).
    archived: z.enum(["exclude", "only", "include"]).optional(),
  }),
);

/**
 * User status update validation schema
 */
export const userStatusSchema = z.lazy(() =>
  z.object({
    isActive: z.boolean(),
    reason: z.string().max(200).optional(),
  }),
);

/**
 * Reset password validation schema
 */
export const resetPasswordSchema = z.lazy(() =>
  z
    .object({
      newPassword: strongPasswordSchema,
      confirmPassword: z.string().min(1, "Password confirmation is required"),
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
      message: "Passwords don't match",
      path: ["confirmPassword"],
    }),
);

/**
 * User statistics query validation schema
 */
export const userStatsSchema = z.lazy(() =>
  z.object({
    restaurantId: restaurantIdQuerySchema,
  }),
);

/**
 * User search validation schema
 */
export const userSearchSchema = z.lazy(() =>
  z.object({
    query: z.string().min(1),
    restaurantId: restaurantIdQuerySchema,
    limit: boundedLimitQuery("10"),
  }),
);

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>;
export type UserFilterInput = z.infer<typeof userFilterSchema>;
export type UserStatusInput = z.infer<typeof userStatusSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type UserStatsInput = z.infer<typeof userStatsSchema>;
export type UserSearchInput = z.infer<typeof userSearchSchema>;
