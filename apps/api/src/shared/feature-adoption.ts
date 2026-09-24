/**
 * Which features are built but not launched, declared in code.
 *
 * Several capabilities are fully implemented, mounted and reachable in
 * production while nobody uses them. Until this registry existed the only way
 * to find that out was to query the production database and count rows, so the
 * answer to "is this live?" lived nowhere a reader could see it. That is what
 * this fixes: the state is declared here, served from /info, and covered by
 * tests that stop it drifting away from the routes it describes.
 *
 * `enabledByDefault` is the deliberate part. A feature is only defaulted off
 * when affected UI reads the same availability signal and hides its control
 * before the request. Where a working UI calls the endpoints and has not been
 * connected to that signal, the default stays on: silently 404ing a screen
 * someone is looking at is worse than the screen being pointless.
 */

export interface UnlaunchedFeature {
  /** Env var that turns it on or off. "true"/"false", matching the codebase. */
  flag: string;
  /** Route prefix under /api/v1 that the gate protects. */
  prefix: string;
  /** Why this is listed: what production showed, and when. */
  adoption: string;
  /**
   * Whether the feature answers requests when the flag is unset. False only
   * where gating it off is invisible to users.
   */
  enabledByDefault: boolean;
}

export const UNLAUNCHED_FEATURES = {
  storedValueCredits: {
    flag: "STORED_VALUE_CREDITS_ENABLED",
    prefix: "/credits",
    adoption:
      "0 credit_accounts, 0 credit_ledger_entries, and 0 credit_topup_intents as of 2026-07-30. ServiceBookingView has a credit-payment control, but it reads /info and hides whenever this flag is off; both its spending route and /credits are then refused. Money code that has never settled a real transaction should not be reachable.",
    enabledByDefault: false,
  },
  tenantBackups: {
    flag: "TENANT_BACKUPS_ENABLED",
    prefix: "/backup",
    adoption:
      "0 backup_configurations and an empty makanmasak-backups-prod bucket as of 2026-07-30, and the scheduler's cron triggers are stopped, so a tenant configuring a schedule here would get a silent no-op. It has no admin UI: the backup views were never routed and were deleted on 2026-09-25. Nothing a user can reach calls this.",
    enabledByDefault: false,
  },
  marketCheckouts: {
    flag: "MARKET_CHECKOUTS_ENABLED",
    prefix: "/market-checkouts",
    adoption:
      "0 market_checkout_sessions and 0 market_checkout_payments as of 2026-07-30. customer-app/src/services/orderApi.ts calls the create, pay and voucher endpoints, so the default stays on.",
    enabledByDefault: true,
  },
  webPush: {
    flag: "WEB_PUSH_ENABLED",
    prefix: "/push",
    adoption:
      "0 customer_push_subscriptions as of 2026-07-30. admin-dashboard/src/utils/push-notifications.ts posts to /push/subscribe, so the default stays on.",
    enabledByDefault: true,
  },
  customerWebPush: {
    flag: "CUSTOMER_WEB_PUSH_ENABLED",
    prefix: "/customer/push-subscriptions",
    adoption:
      "0 customer_push_subscriptions as of 2026-07-30, no production VAPID keys, and customer-app has no production VITE_VAPID_PUBLIC_KEY. Customer subscriptions cannot be delivered, so the customer opt-in stays off until delivery is configured.",
    enabledByDefault: false,
  },
} as const satisfies Record<string, UnlaunchedFeature>;

export type UnlaunchedFeatureKey = keyof typeof UNLAUNCHED_FEATURES;

/**
 * Whether a feature answers requests.
 *
 * An explicit "false" always wins, so a default-on feature can be switched off
 * without a code change. Anything other than "true"/"false" falls back to the
 * declared default rather than guessing.
 */
export function isFeatureEnabled(
  env: Record<string, unknown> | undefined,
  key: UnlaunchedFeatureKey,
): boolean {
  const feature = UNLAUNCHED_FEATURES[key];
  const value = env?.[feature.flag];

  if (value === "true") return true;
  if (value === "false") return false;
  return feature.enabledByDefault;
}

/** The features currently switched off, for /info. */
export function disabledFeatures(
  env: Record<string, unknown> | undefined,
): Array<{ feature: UnlaunchedFeatureKey; flag: string; prefix: string }> {
  return (Object.keys(UNLAUNCHED_FEATURES) as UnlaunchedFeatureKey[])
    .filter((key) => !isFeatureEnabled(env, key))
    .map((key) => ({
      feature: key,
      flag: UNLAUNCHED_FEATURES[key].flag,
      prefix: UNLAUNCHED_FEATURES[key].prefix,
    }));
}
