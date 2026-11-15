/**
 * `users.id` is a TEXT UUID v7 in D1, and every column that references it
 * (`employee_schedules.employee_id`, `created_by`, `leave_requests.employee_id`,
 * …) is TEXT too. Never do arithmetic, sorting or `Number()`/`parseInt()` on
 * one — `parseInt` in particular returns a truncated number rather than NaN.
 *
 * Sibling PKs such as `employee_schedules.id` are still
 * `integer autoincrement`, so those stay `number`. Only user references are
 * `UserId`. (#331)
 */
export type UserId = string;

export interface ApiUser {
  id: UserId;
  username: string;
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  role: number;
  isActive?: boolean;
  isArchived?: boolean;
  archivedAt?: string | null;
  lastLoginAt?: string | null;
  createdAt: string;
  profileImageUrl?: string | null;
  hourlyRateCents?: number | null;
}

export function mapApiUser(user: ApiUser) {
  const isActive = user.isActive !== false;

  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName ?? "",
    email: user.email ?? "",
    phone: user.phone ?? "",
    role: user.role,
    status: isActive ? ("active" as const) : ("inactive" as const),
    isActive,
    isArchived: user.isArchived === true,
    archivedAt: user.archivedAt ?? null,
    lastLoginAt: user.lastLoginAt ?? null,
    createdAt: user.createdAt,
    profileImageUrl: user.profileImageUrl ?? undefined,
    ...(user.hourlyRateCents !== undefined
      ? { hourlyRateCents: user.hourlyRateCents }
      : {}),
  };
}
