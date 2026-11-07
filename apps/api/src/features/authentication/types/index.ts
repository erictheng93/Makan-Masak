/**
 * Authentication Types
 * TypeScript type definitions for the authentication feature
 */

// Import shared types that exist
import type { UserRole } from "@makanmasak/shared-types";

// Device and Location Information
export interface DeviceInfo {
  userAgent?: string;
  ipAddress?: string;
  platform?: "mobile" | "desktop" | "tablet";
  deviceType?: string;
  browser?: string;
  version?: string;
}

export interface LocationInfo {
  country?: string;
  city?: string;
  coordinates?: {
    lat: number;
    lng: number;
  };
}

// Authentication Request Types
export interface LoginRequest {
  username: string;
  password: string;
  rememberMe?: boolean;
}

export interface RegisterRequest {
  username: string;
  fullName: string;
  email?: string;
  phone?: string;
  password: string;
  confirmPassword: string;
  role: UserRole;
  restaurantId?: string;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export interface ForgotPasswordRequest {
  email?: string;
  username?: string;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
  confirmPassword: string;
}

export interface VerifyEmailRequest {
  token: string;
}

// Enhanced Login Data (with tracking info)
export interface LoginData {
  username: string;
  password: string;
  deviceInfo?: DeviceInfo;
  location?: LocationInfo;
}

export interface RegisterData {
  username: string;
  email?: string;
  phone?: string;
  fullName: string;
  password: string;
  role: UserRole;
  restaurantId?: string;
}

// User and Session Types (feature-specific user type)
export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  email?: string;
  phone?: string;
  role: UserRole;
  restaurantId?: string | null;
  isActive: boolean;
  isVerified: boolean;
  lastLoginAt?: Date;
  passwordChangedAt?: Date;
  emailVerifiedAt?: Date;
  twoFactorEnabled: boolean;
  twoFactorSecret?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionEntity {
  id: string;
  sessionId: string;
  userId: string;
  token: string;
  refreshToken?: string;
  deviceInfo?: DeviceInfo;
  location?: LocationInfo;
  userAgent?: string;
  ipAddress?: string;
  expiresAt: Date;
  lastAccessedAt?: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// JWT Token Types
export interface JWTPayload {
  id: string;
  username: string;
  role: UserRole;
  restaurantId?: string | null;
  iat?: number;
  exp?: number;
  nbf?: number;
}

export interface RefreshTokenPayload {
  userId: string;
  type: "refresh";
  iat?: number;
  exp?: number;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  expiresIn: number;
}

// Authentication Response Types
/**
 * Why an auth attempt failed. Mirrors the database layer's reasons and adds the
 * ones this layer originates (currently the login rate limiter).
 *
 * Exists so routes can pick an error code or HTTP status without matching on
 * the English `error` text -- see the comment on AuthFailureReason in
 * packages/database/src/services/auth.ts.
 */
export type AuthFailureReason =
  | "invalid_credentials"
  | "customer_password_login_retired"
  | "customer_password_registration_retired"
  | "username_taken"
  | "weak_password"
  | "rate_limited";

export type PasswordResetFailureReason =
  | "reset_token_expired"
  | "reset_token_invalid"
  | "weak_password"
  | "reset_request_throttled";

export interface AuthResult {
  success: boolean;
  /** Set on every failure path; absent on success. */
  reason?: AuthFailureReason;
  user?: AuthUser;
  tokens?: Tokens;
  error?: string;
  requiresTwoFactor?: boolean;
  twoFactorChallenge?: string;
}

export interface TokenValidation {
  valid: boolean;
  user?: AuthUser;
  error?: string;
  remainingTime?: number;
}

export interface UserProfile {
  id: string;
  username: string;
  fullName: string;
  email?: string;
  phone?: string;
  role: UserRole;
  adminTier?: string;
  restaurantId?: string;
  isActive: boolean;
  isVerified: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  twoFactorEnabled: boolean;
  sessions: SessionSummary[];
}

export interface SessionSummary {
  id: string;
  deviceInfo?: DeviceInfo;
  location?: LocationInfo;
  lastAccessedAt?: Date;
  expiresAt: Date;
  isCurrent: boolean;
  createdAt: Date;
}

// Two-Factor Authentication Types
export interface TwoFactorSetupRequest {
  password: string;
}

export interface TwoFactorVerifyRequest {
  token: string;
  backupCode?: string;
}

export interface TwoFactorBackupCodes {
  codes: string[];
  generatedAt: Date;
}

// Password Reset Types
export interface PasswordResetToken {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  isUsed: boolean;
  ipAddress?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmailVerificationToken {
  id: string;
  userId: string;
  token: string;
  email: string;
  expiresAt: Date;
  isUsed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Security and Audit Types
export interface SecurityEvent {
  type:
    | "LOGIN"
    | "LOGIN_FAILED"
    | "LOGOUT"
    | "PASSWORD_CHANGED"
    | "TWO_FACTOR_ENABLED"
    | "TWO_FACTOR_DISABLED"
    | "ACCOUNT_LOCKED"
    | "PASSWORD_RESET_REQUESTED"
    | "PASSWORD_RESET_COMPLETED"
    | "EMAIL_VERIFIED";
  userId?: string;
  username?: string;
  ipAddress?: string;
  userAgent?: string;
  location?: LocationInfo;
  metadata?: Record<string, unknown>;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  timestamp: Date;
}

export interface AccountSecurity {
  failedLoginAttempts: number;
  lastFailedLoginAt?: Date;
  lockoutUntil?: Date;
  passwordStrength: "WEAK" | "MEDIUM" | "STRONG" | "VERY_STRONG";
  lastPasswordChangeAt?: Date;
  suspiciousActivity: boolean;
}

// Permission and Role Types
export interface Permission {
  id: number;
  name: string;
  description: string;
  resource: string;
  action: string;
}

export interface RolePermissions {
  role: UserRole;
  permissions: Permission[];
  canCreateUsers: boolean;
  canManageRestaurant: boolean;
  canAccessAllRestaurants: boolean;
}

// Statistics and Analytics
export interface AuthStatistics {
  totalUsers: number;
  activeUsers: number;
  dailyLogins: number;
  uniqueDevices: number;
  topCountries: Array<{
    country: string;
    count: number;
  }>;
  platformDistribution: Record<string, number>;
  twoFactorAdoptionRate: number;
  recentSecurityEvents: SecurityEvent[];
}

// Service Interfaces
export interface IAuthService {
  // Core authentication methods
  login(data: LoginData): Promise<AuthResult>;
  register(data: RegisterData, createdBy?: string): Promise<AuthResult>;
  refreshToken(refreshToken: string): Promise<AuthResult>;
  logout(
    userId: string,
    token?: string,
    allSessions?: boolean,
  ): Promise<boolean>;
  validateToken(token: string): Promise<TokenValidation>;

  // User management
  getUserProfile(userId: string): Promise<UserProfile | null>;
  updateUserProfile(
    userId: string,
    data: Partial<AuthUser>,
  ): Promise<AuthUser | null>;
  changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<{ success: boolean; error?: string }>;

  // Session management
  getUserSessions(userId: string): Promise<SessionSummary[]>;
  terminateSession(userId: string, sessionId: string): Promise<boolean>;
  terminateAllSessions(userId: string): Promise<boolean>;

  // Two-factor authentication
  setupTwoFactor(
    userId: string,
    password: string,
  ): Promise<{ secret: string; qrCode: string; backupCodes: string[] }>;
  verifyTwoFactor(
    userId: string,
    token: string,
    backupCode?: string,
  ): Promise<{ success: boolean; error?: string }>;
  disableTwoFactor(
    userId: string,
    password: string,
    token?: string,
  ): Promise<{ success: boolean; error?: string }>;
  generateBackupCodes(userId: string): Promise<TwoFactorBackupCodes>;

  // Password reset
  requestPasswordReset(identifier: string): Promise<{
    success: boolean;
    reason?: PasswordResetFailureReason;
    error?: string;
  }>;
  resetPassword(
    token: string,
    newPassword: string,
  ): Promise<{
    success: boolean;
    reason?: PasswordResetFailureReason;
    error?: string;
  }>;

  // Email verification
  requestEmailVerification(
    userId: string,
  ): Promise<{ success: boolean; error?: string }>;
  verifyEmail(token: string): Promise<{ success: boolean; error?: string }>;

  // Security and monitoring
  logSecurityEvent(event: Omit<SecurityEvent, "timestamp">): Promise<void>;
  getSecurityEvents(userId?: string, limit?: number): Promise<SecurityEvent[]>;
  checkAccountSecurity(userId: string): Promise<AccountSecurity>;

  // Statistics
  getAuthStatistics(timeRange?: string): Promise<AuthStatistics>;
}

// Event Types for Real-time Updates
export type AuthEvent =
  | {
      type: "USER_LOGGED_IN";
      payload: { userId: string; deviceInfo?: DeviceInfo };
    }
  | { type: "USER_LOGGED_OUT"; payload: { userId: string } }
  | { type: "USER_REGISTERED"; payload: AuthUser }
  | { type: "PASSWORD_CHANGED"; payload: { userId: string } }
  | { type: "TWO_FACTOR_ENABLED"; payload: { userId: string } }
  | { type: "TWO_FACTOR_DISABLED"; payload: { userId: string } }
  | { type: "SECURITY_ALERT"; payload: SecurityEvent }
  | { type: "ACCOUNT_LOCKED"; payload: { userId: string; reason: string } }
  | { type: "EMAIL_VERIFIED"; payload: { userId: string; email: string } };

// Configuration Types
export interface AuthConfig {
  jwt: {
    secret: string;
    accessTokenExpiry: string;
    refreshTokenExpiry: string;
    algorithm: "HS256" | "HS384" | "HS512";
  };
  password: {
    minLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireNumbers: boolean;
    requireSymbols: boolean;
    preventReuse: number;
  };
  security: {
    maxFailedAttempts: number;
    lockoutDuration: number;
    sessionTimeout: number;
    requireTwoFactor: boolean;
    allowedOrigins: string[];
  };
  email: {
    verificationRequired: boolean;
    verificationExpiry: number;
    resetTokenExpiry: number;
  };
}

// Error Types
export interface AuthError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export const AUTH_ERROR_CODES = {
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  USER_NOT_FOUND: "USER_NOT_FOUND",
  USER_EXISTS: "USER_EXISTS",
  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  ACCOUNT_INACTIVE: "ACCOUNT_INACTIVE",
  PASSWORD_TOO_WEAK: "PASSWORD_TOO_WEAK",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  TOKEN_INVALID: "TOKEN_INVALID",
  TWO_FACTOR_REQUIRED: "TWO_FACTOR_REQUIRED",
  TWO_FACTOR_INVALID: "TWO_FACTOR_INVALID",
  EMAIL_NOT_VERIFIED: "EMAIL_NOT_VERIFIED",
  INSUFFICIENT_PERMISSIONS: "INSUFFICIENT_PERMISSIONS",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
} as const;

export type AuthErrorCode =
  (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];
