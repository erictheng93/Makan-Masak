import { api, resolveApiBase, unwrapApiData } from "./api";
import type { User } from "@/types";

export type StaffOAuthProvider = "google" | "line";

export interface StaffOAuthIdentity {
  id: string;
  provider: StaffOAuthProvider;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  /** ISO timestamps: the API serialises its Date columns as strings. */
  linkedAt: string;
  lastUsedAt: string | null;
}

export interface OAuthSession {
  token: string;
  expiresAt?: number;
  user: User;
}

/** A failed lookup means "feature unavailable", never an error to show. */
export async function fetchStaffOAuthProviders(): Promise<
  StaffOAuthProvider[]
> {
  try {
    const response = await api.get<{ providers: StaffOAuthProvider[] }>(
      "/auth/oauth/providers",
    );
    const data = unwrapApiData<{ providers?: StaffOAuthProvider[] }>(response);
    return Array.isArray(data?.providers) ? data.providers : [];
  } catch {
    return [];
  }
}

/** Top-level navigation target: a Location header cannot carry fetch headers. */
export function staffOAuthStartUrl(
  provider: StaffOAuthProvider,
  redirectTo: string,
): string {
  return `${resolveApiBase()}/auth/oauth/${provider}/start?redirectTo=${encodeURIComponent(redirectTo)}`;
}

/** One of the shops a Google / LINE account is linked to. */
export interface StaffOAuthShop {
  userId: string;
  restaurantId: string | null;
  restaurantName: string | null;
}

/**
 * Same envelope as POST /auth/login; the callback cookie rides along. When the
 * account is linked to several shops the first call returns the list instead
 * of a session, and a second call with the chosen `userId` signs in.
 */
export function completeStaffOAuth(code: string, userId?: string) {
  return api.post<
    OAuthSession | { needsShopSelection: true; shops: StaffOAuthShop[] }
  >("/auth/oauth/complete", { code, ...(userId ? { userId } : {}) });
}

export async function startStaffOAuthLink(
  provider: StaffOAuthProvider,
  redirectTo: string,
): Promise<string> {
  const response = await api.post<{ authorizeUrl: string }>(
    `/auth/oauth/${provider}/link/start?redirectTo=${encodeURIComponent(redirectTo)}`,
  );
  return unwrapApiData<{ authorizeUrl: string }>(response).authorizeUrl;
}

export async function listStaffOAuthIdentities(): Promise<
  StaffOAuthIdentity[]
> {
  const response = await api.get<StaffOAuthIdentity[]>("/auth/identities");
  const data = unwrapApiData<StaffOAuthIdentity[]>(response);
  return Array.isArray(data) ? data : [];
}

export async function unlinkStaffOAuthIdentity(id: string): Promise<void> {
  await api.delete(`/auth/identities/${encodeURIComponent(id)}`);
}

const MAPPED_OAUTH_ERRORS = new Set([
  "declined",
  "OAUTH_IDENTITY_NOT_LINKED",
  "OAUTH_STATE_INVALID",
  "OAUTH_CALLBACK_INVALID",
  "OAUTH_VERIFICATION_FAILED",
  "OAUTH_IDENTITY_ALREADY_LINKED",
  "OAUTH_PROVIDER_ALREADY_LINKED",
  "OAUTH_LINK_NOT_ALLOWED",
]);

/** i18n key for an `?oauth_error=` code; unknown codes get the generic copy. */
export function oauthErrorMessageKey(code: string): string {
  return `auth.oauth.errors.${MAPPED_OAUTH_ERRORS.has(code) ? code : "generic"}`;
}
