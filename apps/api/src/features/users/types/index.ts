import { USER_ROLES, type AdminTier } from "@makanmasak/database";
import type { UserPreferences } from "@makanmasak/shared-types";

/**
 * User role names mapping for display purposes
 */
export const USER_ROLE_NAMES: Record<number, string> = {
  [USER_ROLES.ADMIN]: "Admin",
  [USER_ROLES.OWNER]: "Shop Owner",
  [USER_ROLES.CHEF]: "Chef",
  [USER_ROLES.SERVICE]: "Service Crew",
  [USER_ROLES.CASHIER]: "Cashier",
  [USER_ROLES.CUSTOMER]: "Customer",
} as const;

/**
 * User creation data interface
 */
export interface CreateUserData {
  username: string;
  fullName: string;
  email?: string;
  phone?: string;
  password: string;
  role: number;
  restaurantId?: string;
  adminTier?: AdminTier;
  address?: string;
  dateOfBirth?: string;
  profileImageUrl?: string;
  preferences?: UserPreferences;
}

/**
 * User update data interface
 */
export interface UpdateUserData {
  email?: string;
  phone?: string;
  fullName?: string;
  address?: string;
  dateOfBirth?: string;
  profileImageUrl?: string;
  preferences?: UserPreferences;
  isActive?: boolean;
  isVerified?: boolean;
}

/**
 * Password update data interface
 */
export interface UpdatePasswordData {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

/**
 * User filter interface for search and listing
 */
export interface UserFilters {
  restaurantId?: string;
  role?: number;
  isActive?: boolean;
  isVerified?: boolean;
  search?: string;
  page?: number;
  limit?: number;
  /** Omitted lists current staff; "only" is the departed tab. */
  archived?: "exclude" | "only" | "include";
}

/**
 * User status update interface
 */
export interface UserStatusUpdate {
  isActive: boolean;
  reason?: string;
}

/**
 * Reset password data interface
 */
export interface ResetPasswordData {
  newPassword: string;
}

/**
 * User search query interface
 */
export interface UserSearchQuery {
  query: string;
  restaurantId?: string;
  limit?: number;
}

/**
 * Formatted user response interface.
 *
 * `formatUser` copies its fields straight across from the query row, so what is
 * optional here follows the columns: nullable ones arrive as `null`, which this
 * used to declare as optional-undefined.
 *
 * The projections behind it used to select different subsets — `searchUsers`
 * returned six columns, so `isActive`, `isVerified` and the timestamps were
 * absent from every search response. They now all select what this reads.
 */
export interface FormattedUser {
  id: string;
  username: string;
  role: number;
  role_name: string;
  restaurantId?: string | null;
  /** Role 0 only. */
  adminTier?: string | null;
  email?: string | null;
  fullName?: string | null;
  phone?: string | null;
  address?: string | null;
  dateOfBirth?: string | null;
  profileImageUrl?: string | null;
  isActive: boolean;
  /** Departed staff: hidden from the roster, still named on old records. */
  isArchived: boolean;
  archivedAt?: string | null;
  isVerified: boolean;
  preferences?: UserPreferences | string | null;
  totalOrders?: number | null;
  totalSpent?: number | null;
  lastLoginAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | Date | null;
}

/**
 * User statistics interface
 */
export interface UserStats {
  summary: {
    total_users: number;
    active_users: number;
    inactive_users: number;
    new_users_month: number;
  };
  by_role: Record<
    number,
    {
      count: number;
      role_name: string;
    }
  >;
}
