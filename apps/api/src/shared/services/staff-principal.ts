import { ApiError } from "../utils/api-error";

export type StaffPrincipalIdentifier = string | number;

export interface StaffPrincipalRow {
  id: string;
  username: string;
  role: number;
  restaurant_id: string | null;
  is_active: number | boolean;
  token_version: number | null;
  admin_tier?: string | null;
}

export interface StaffPrincipal {
  id: string;
  publicUserId: string;
  username: string;
  role: number;
  restaurantId?: string;
  isActive: boolean;
  tokenVersion: number;
  /** Role 0 only: administrator | operator | support. */
  adminTier?: string;
}

export interface StaffPrincipalResolveOptions {
  requireActive?: boolean;
}

export type StaffPrincipalLookupInput = { userId: string };

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function toStaffPrincipalLookupInput(
  identifier: StaffPrincipalIdentifier,
): StaffPrincipalLookupInput {
  const lookupKey = String(identifier).trim();
  if (!lookupKey) {
    throw invalidPrincipal();
  }

  if (!UUID_V7_PATTERN.test(lookupKey)) {
    throw invalidPrincipal();
  }

  return { userId: lookupKey };
}

export async function resolveStaffPrincipal(
  db: D1Database,
  identifier: StaffPrincipalIdentifier,
  options: StaffPrincipalResolveOptions = {},
): Promise<StaffPrincipal> {
  const requireActive = options.requireActive ?? true;
  const lookup = toStaffPrincipalLookupInput(identifier);
  const row = await db
    .prepare(
      "SELECT `id`, `username`, `role`, `restaurant_id`, `is_active`, `token_version`, `admin_tier` FROM `users` WHERE `id` = ? LIMIT 1",
    )
    .bind(lookup.userId)
    .first<StaffPrincipalRow>();

  if (!row) {
    throw new ApiError(
      "STAFF_PRINCIPAL_NOT_FOUND",
      "Staff principal not found",
      404,
    );
  }

  const principal = toStaffPrincipal(row);
  if (requireActive && !principal.isActive) {
    throw new ApiError(
      "STAFF_PRINCIPAL_INACTIVE",
      "Staff principal is inactive",
      403,
    );
  }

  return principal;
}

function toStaffPrincipal(row: StaffPrincipalRow): StaffPrincipal {
  return {
    id: row.id,
    publicUserId: row.id,
    username: String(row.username),
    role: Number(row.role),
    restaurantId: row.restaurant_id ?? undefined,
    isActive: row.is_active === true || Number(row.is_active) === 1,
    tokenVersion: Number(row.token_version ?? 1),
    adminTier:
      Number(row.role) === 0 ? (row.admin_tier ?? "operator") : undefined,
  };
}

function invalidPrincipal(): ApiError {
  return new ApiError(
    "STAFF_PRINCIPAL_INVALID",
    "Staff principal must be a UUID-v7 user id",
    400,
  );
}
