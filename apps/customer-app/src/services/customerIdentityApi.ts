import { apiClient } from "./api";

export interface CustomerSummary {
  id: string;
  displayName: string;
  primaryPhone?: string | null;
  primaryEmail?: string | null;
  avatarUrl?: string | null;
  locale?: string | null;
  status: string;
  lastSeenAtMs?: number | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface CustomerPreferences {
  dietaryTags: string[];
  allergens: string[];
  defaultPartySize: number | null;
  marketingOptIn: boolean;
  waitingListOptIn: boolean;
  promoFromFavoritesOptIn: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  updatedAtMs: number | null;
}

export interface CustomerSession {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  customer: CustomerSummary;
}

/**
 * `POST /customer/auth/register` answers 201 with the freshly created customer
 * plus the channel the diner must verify through. It never returns a session —
 * login stays blocked until the identity is verified.
 */
export interface CustomerRegistration {
  customer: {
    id: string;
    displayName: string;
    primaryPhone: string | null;
    primaryEmail: string | null;
    status: string;
  };
  verificationRequired: boolean;
  verificationMethod: "email" | "phone";
}

export interface CustomerFavorite {
  id: number;
  targetType: "market" | "restaurant" | "dish";
  targetId: string;
  createdAtMs: number;
}

export interface CustomerRecentMarket {
  marketId: string;
  visitedAtMs: number;
}

/**
 * `GET /customer/consents` answers with raw D1 rows rather than a camelCased
 * view, and only with live grants (`granted = 1`, not revoked). So an absent
 * `marketing` row means "no consent on file", which is what the UI has to read;
 * a withdrawal is not represented as a `granted: 0` row in this response.
 */
export interface CustomerConsentRecord {
  id: string;
  consent_type: string;
  version: string;
  granted: number;
  granted_at_ms: number;
  source: string | null;
}

/**
 * The preferences the marketing broadcast fan-out actually consults (#335).
 * Distinct from `CustomerPreferences` above, which is the older
 * `customer_preferences` row; its `marketingOptIn` /
 * `promoFromFavoritesOptIn` flags have no reader.
 *
 * Quiet hours are minutes from midnight (0-1439) in the sender's timezone, and
 * the two bounds are set or cleared together.
 */
export interface CustomerNotificationPreferences {
  marketingEnabled: boolean;
  followedOnly: boolean;
  quietHoursStartMin: number | null;
  quietHoursEndMin: number | null;
  updatedAt: number | null;
}

export interface CustomerPushSubscription {
  id: string;
  endpoint: string;
  device_label?: string | null;
  created_at_ms?: number;
}

export const customerIdentityApi = {
  requestOtp(phone: string) {
    return apiClient.post<{
      phone: string;
      expiresInSeconds: number;
      devOtp?: string;
    }>("/customer/auth/request-otp", { phone });
  },

  verifyOtp(phone: string, otp: string) {
    return apiClient.post<CustomerSession>(
      "/customer/auth/verify-otp",
      { phone, otp },
      // A rejected code is this endpoint's answer, not an expired session.
      { credentialCheck: true },
    );
  },

  /**
   * Same endpoint as `verifyOtp`, but `purpose: "password_reset"` makes it
   * answer with a short-lived reset token instead of a session — the phone
   * counterpart of the link mailed to an email account (#353). The two cannot
   * share one signature: the response type differs, and a phone reset must not
   * sign the diner in on the strength of a code they were sent because they had
   * *lost* their password.
   */
  verifyPasswordResetOtp(phone: string, otp: string) {
    return apiClient.post<{ resetToken: string; expiresInSeconds: number }>(
      "/customer/auth/verify-otp",
      { phone, otp, purpose: "password_reset" },
      // A rejected code is this endpoint's answer, not an expired session.
      { credentialCheck: true },
    );
  },

  register(input: {
    identifier: string;
    password: string;
    displayName: string;
  }) {
    return apiClient.post<CustomerRegistration>(
      "/customer/auth/register",
      input,
    );
  },

  loginWithPassword(identifier: string, password: string) {
    return apiClient.post<CustomerSession>(
      "/customer/auth/login",
      { identifier, password },
      // The 401 here means "wrong credentials" and carries the one message the
      // backend deliberately returns for both unknown accounts and bad
      // passwords. Letting the client rewrite it to "session expired" would
      // both mislead the diner and throw away that message.
      { credentialCheck: true },
    );
  },

  /**
   * `devOtp` is echoed only by a non-production API (`NODE_ENV` development or
   * test) and only on the phone branch — the local SMS provider is a no-op, so
   * without it the phone reset flow cannot be exercised on a dev machine at
   * all. Never present in production.
   */
  forgotPassword(identifier: string) {
    return apiClient.post<{ sent: boolean; devOtp?: string }>(
      "/customer/auth/forgot-password",
      { identifier },
    );
  },

  resetPassword(token: string, newPassword: string) {
    return apiClient.post<{ reset: boolean }>(
      "/customer/auth/reset-password",
      { token, newPassword },
      // An expired reset link answers 401; it is not the diner's session.
      { credentialCheck: true },
    );
  },

  verifyEmail(token: string) {
    return apiClient.post<{ verified: boolean }>(
      "/customer/auth/verify-email",
      { token },
      { credentialCheck: true },
    );
  },

  resendVerification(identifier: string) {
    return apiClient.post<{ sent: boolean }>(
      "/customer/auth/resend-verification",
      { identifier },
    );
  },

  refresh() {
    return apiClient.post<Omit<CustomerSession, "customer">>(
      "/customer/auth/refresh",
      {},
      { withCredentials: true },
    );
  },

  logout() {
    return apiClient.post(
      "/customer/auth/logout",
      {},
      { withCredentials: true },
    );
  },

  getMe() {
    return apiClient.get<{
      customer: CustomerSummary;
      preferences: CustomerPreferences;
    }>("/customer/me");
  },

  updateMe(input: {
    displayName?: string;
    avatarUrl?: string | null;
    locale?: string | null;
  }) {
    return apiClient.patch<{ customer: CustomerSummary }>(
      "/customer/me",
      input,
    );
  },

  updatePreferences(input: Partial<CustomerPreferences>) {
    return apiClient.patch<CustomerPreferences>("/customer/preferences", input);
  },

  listFavorites(targetType?: CustomerFavorite["targetType"]) {
    return apiClient.get<CustomerFavorite[]>("/customer/favorites", {
      ...(targetType ? { targetType } : {}),
    });
  },

  addFavorite(input: {
    targetType: CustomerFavorite["targetType"];
    targetId: string;
  }) {
    return apiClient.post<CustomerFavorite>("/customer/favorites", input);
  },

  removeFavorite(id: number | string) {
    return apiClient.delete(`/customer/favorites/${id}`);
  },

  listRecentMarkets(limit = 8) {
    return apiClient.get<CustomerRecentMarket[]>("/customer/recent-markets", {
      limit,
    });
  },

  recordRecentMarket(input: { marketId: string; visitedAtMs?: number }) {
    return apiClient.post<CustomerRecentMarket>(
      "/customer/recent-markets",
      input,
    );
  },

  addPushSubscription(input: {
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent?: string;
    deviceLabel?: string;
  }) {
    return apiClient.post<CustomerPushSubscription>(
      "/customer/push-subscriptions",
      input,
    );
  },

  listPushSubscriptions() {
    return apiClient.get<
      Array<{
        id: string;
        endpoint: string;
        device_label?: string | null;
      }>
    >("/customer/push-subscriptions");
  },

  removePushSubscription(id: string) {
    return apiClient.delete(`/customer/push-subscriptions/${id}`);
  },

  listConsents() {
    return apiClient.get<CustomerConsentRecord[]>("/customer/consents");
  },

  getNotificationPreferences() {
    return apiClient.get<CustomerNotificationPreferences>(
      "/customer/notification-preferences",
    );
  },

  /**
   * A merge, not a replace: every field is optional and anything omitted keeps
   * its stored value. Send only what the screen changed.
   */
  updateNotificationPreferences(input: {
    marketingEnabled?: boolean;
    followedOnly?: boolean;
    quietHoursStartMin?: number | null;
    quietHoursEndMin?: number | null;
  }) {
    return apiClient.put<CustomerNotificationPreferences>(
      "/customer/notification-preferences",
      input,
    );
  },

  grantConsent(input: {
    consentType:
      | "marketing"
      | "analytics"
      | "location"
      | "data_share"
      | "terms_of_service"
      | "privacy_policy";
    version: string;
    granted: boolean;
    source?: "onboarding" | "settings" | "inline_prompt";
  }) {
    return apiClient.post("/customer/consents", input);
  },
};

export default customerIdentityApi;
