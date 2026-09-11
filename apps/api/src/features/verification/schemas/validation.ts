/**
 * Verification Validation Schemas
 * Zod schemas for request validation
 */

import { z } from "zod";

// Forgot password schema
export const forgotPasswordSchema = z.lazy(() =>
  z.object({
    identifier: z.string().min(1, "請輸入 Email 或手機號碼"),
    method: z.enum(["email", "sms"], {
      error: "請選擇 Email 或 SMS 方式",
    }),
  }),
);

// Verify reset token schema
export const verifyResetTokenSchema = z.lazy(() =>
  z.object({
    token: z.uuid("無效的 Token 格式"),
  }),
);

// Reset password schema
export const resetPasswordSchema = z.lazy(() =>
  z
    .object({
      token: z.uuid("無效的 Token 格式"),
      newPassword: z
        .string()
        .min(6, "密碼至少需要 6 個字符")
        .max(100, "密碼最多 100 個字符"),
      confirmPassword: z.string(),
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
      message: "兩次輸入的密碼不一致",
      path: ["confirmPassword"],
    }),
);

// Send email verification schema
export const sendEmailVerificationSchema = z.lazy(() =>
  z.object({
    email: z.email("無效的 Email 格式"),
  }),
);

// Verify email schema
export const verifyEmailSchema = z.lazy(() =>
  z.object({
    token: z.uuid("無效的 Token 格式"),
  }),
);

// Send phone verification schema
export const sendPhoneVerificationSchema = z.lazy(() =>
  z.object({
    phone: z
      .string()
      .regex(
        /^\+?[1-9]\d{1,14}$/,
        "請輸入有效的國際手機號碼（例如：+60123456789）",
      ),
  }),
);

// Verify phone schema
export const verifyPhoneSchema = z.lazy(() =>
  z.object({
    phone: z.string(),
    otpCode: z
      .string()
      .length(6, "驗證碼必須是 6 位數字")
      .regex(/^\d{6}$/, "驗證碼只能包含數字"),
  }),
);

// Export schema types
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type VerifyResetTokenInput = z.infer<typeof verifyResetTokenSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type SendEmailVerificationInput = z.infer<
  typeof sendEmailVerificationSchema
>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type SendPhoneVerificationInput = z.infer<
  typeof sendPhoneVerificationSchema
>;
export type VerifyPhoneInput = z.infer<typeof verifyPhoneSchema>;
