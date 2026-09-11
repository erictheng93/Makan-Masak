/**
 * Customer OAuth sign-in (LINE / Google / Apple).
 *
 * Shape of the flow, and why it is not the more obvious one:
 *
 *   start    → 302 to the provider
 *   callback → provider returns here; we resolve the identity, park the result
 *              in KV under a one-time code, and 302 the browser back to the app
 *   complete → the app POSTs that code and receives the session
 *
 * The callback could redirect with the access token in the URL, but a token in
 * a redirect lands in browser history, the Referer header and any intermediary
 * log. Parking the result and handing it over on a POST also means the refresh
 * cookie is set by the same kind of request the password and OTP logins already
 * use, instead of a third mechanism that has to be kept in step with them.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import {
  isCustomerOAuthProvider,
  type CustomerOAuthProvider,
} from "@makanmasak/shared-types";
import type { Env } from "../../../types/env";
import {
  canonicalCustomerAuthMiddleware,
  optionalCanonicalCustomerAuthMiddleware,
  verifyJwtToken,
} from "../../../middleware/auth";
import { validateBody } from "../../../middleware/validation";
import {
  ApiError,
  badRequest,
  conflict,
  notFound,
  unauthorized,
} from "../../../shared/utils/api-error";
import {
  issueBindingToken,
  issueCustomerSession,
} from "../services/CustomerSessionService";
import {
  buildRedirectUri,
  configuredProviders,
  getClientId,
  isProviderConfigured,
  OAUTH_PROVIDERS,
  type OAuthEnv,
} from "../services/oauth/providers";
import {
  consumeRequestState,
  deriveCodeChallenge,
  generateCodeVerifier,
  generateNonce,
  generateState,
  sanitizeRedirectTo,
  saveRequestState,
} from "../services/oauth/state";
import { exchangeCodeForIdToken } from "../services/oauth/tokenExchange";
import { verifyIdToken } from "../services/oauth/idToken";
import {
  createCustomerForIdentity,
  findActiveCustomerIdByEmail,
  findLiveIdentity,
  hasAnotherAuthMethod,
  insertIdentity,
  isUsableProviderEmail,
  listLiveIdentities,
  maskEmail,
  revokeIdentity,
  touchIdentityUse,
  type OAuthProfile,
} from "../services/oauth/identity";

const routes = new Hono<{ Bindings: Env }>();

/** Long enough for a redirect to land, short enough that a leak is worthless. */
const OAUTH_RESULT_TTL_SECONDS = 120;

type PendingResult =
  | { kind: "session"; customerId: string; redirectTo?: string }
  | {
      kind: "needs_linking";
      provider: CustomerOAuthProvider;
      providerUid: string;
      maskedEmail: string;
      redirectTo?: string;
    };

function resultKey(code: string): string {
  return `oauth_result:${code}`;
}

function oauthEnv(c: Context<{ Bindings: Env }>): OAuthEnv {
  return c.env as OAuthEnv;
}

function requireProvider(value: string | undefined): CustomerOAuthProvider {
  if (!value || !isCustomerOAuthProvider(value)) {
    throw notFound("Unknown sign-in provider", "OAUTH_PROVIDER_UNKNOWN");
  }
  return value;
}

/**
 * Refuse an unconfigured provider before redirecting anywhere.
 *
 * Sending the customer to a provider that will reject the request produces an
 * error page carrying our client id and no explanation. The SMS channel makes
 * the same call for the same reason: fail here, visibly, rather than in a place
 * the customer cannot act on.
 */
function assertConfigured(
  env: OAuthEnv,
  provider: CustomerOAuthProvider,
): void {
  if (!isProviderConfigured(env, provider)) {
    throw new ApiError(
      "OAUTH_PROVIDER_UNAVAILABLE",
      `${provider} sign-in is not configured`,
      503,
    );
  }
}

function appBaseUrl(env: Env): string {
  return (env.CLIENT_BASE_URL?.trim() || "http://localhost:3000").replace(
    /\/+$/,
    "",
  );
}

function expiryTimestampMs(
  now: number,
  expiresInSeconds: number,
): number | undefined {
  const expiresAtMs = now + expiresInSeconds * 1000;
  return Number.isSafeInteger(expiresAtMs) ? expiresAtMs : undefined;
}

/**
 * Which providers this deployment can actually offer. The customer app asks
 * before rendering buttons, so an unconfigured provider is simply absent rather
 * than a button that fails.
 */
routes.get("/auth/oauth/providers", (c) => {
  return c.json({
    success: true,
    data: { providers: configuredProviders(oauthEnv(c)) },
  });
});

routes.get(
  "/auth/oauth/:provider/start",
  optionalCanonicalCustomerAuthMiddleware,
  async (c) => {
    const env = oauthEnv(c);
    const provider = requireProvider(c.req.param("provider"));
    assertConfigured(env, provider);

    const config = OAUTH_PROVIDERS[provider];
    const state = generateState();
    const nonce = generateNonce();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await deriveCodeChallenge(codeVerifier);

    // Captured now, from the token on this request, so the callback cannot be
    // steered into linking the provider to somebody else's account.
    const linkCustomerId = c.get("customer")?.id;

    await saveRequestState(c.env.CACHE_KV, provider, state, {
      codeVerifier,
      nonce,
      redirectTo: sanitizeRedirectTo(c.req.query("redirectTo")),
      linkCustomerId,
    });

    const params = new URLSearchParams({
      response_type: "code",
      client_id: getClientId(env, provider) as string,
      redirect_uri: buildRedirectUri(env, provider),
      scope: config.scope,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      ...(config.extraAuthorizeParams ?? {}),
    });

    return c.redirect(`${config.authorizeUrl}?${params.toString()}`, 302);
  },
);

/**
 * Apple form-posts its callback while LINE and Google use a redirect GET, so
 * both verbs land here and the parameters are read from whichever side carries
 * them.
 */
async function readCallbackParams(
  c: Context<{ Bindings: Env }>,
): Promise<{ code?: string; state?: string; error?: string }> {
  if (c.req.method === "POST") {
    const form = await c.req.parseBody();
    return {
      code: typeof form.code === "string" ? form.code : undefined,
      state: typeof form.state === "string" ? form.state : undefined,
      error: typeof form.error === "string" ? form.error : undefined,
    };
  }
  return {
    code: c.req.query("code"),
    state: c.req.query("state"),
    error: c.req.query("error"),
  };
}

async function handleCallback(c: Context<{ Bindings: Env }>) {
  const env = oauthEnv(c);
  const provider = requireProvider(c.req.param("provider"));
  assertConfigured(env, provider);

  const { code, state, error } = await readCallbackParams(c);

  if (error) {
    // The customer declined at the provider. That is a normal outcome, not a
    // failure to report — send them back with a flag the app can act on.
    return c.redirect(`${appBaseUrl(c.env)}/login?oauth_error=declined`, 302);
  }
  if (!code || !state) {
    throw badRequest(
      "Missing authorization code or state",
      "OAUTH_CALLBACK_INVALID",
    );
  }

  const requestState = await consumeRequestState(
    c.env.CACHE_KV,
    provider,
    state,
  );
  if (!requestState) {
    // Either a replay, or the customer took longer than the TTL. Both are dead
    // ends; neither should be retried against the same state.
    throw badRequest(
      "Sign-in request expired or already used",
      "OAUTH_STATE_INVALID",
    );
  }

  const exchanged = await exchangeCodeForIdToken({
    env,
    provider,
    code,
    codeVerifier: requestState.codeVerifier,
    cache: c.env.CACHE_KV,
  });

  const verified = await verifyIdToken({
    idToken: exchanged.idToken,
    config: OAUTH_PROVIDERS[provider],
    audience: getClientId(env, provider) as string,
    expectedNonce: requestState.nonce,
    cache: c.env.CACHE_KV,
  });

  const now = Date.now();
  const profile: OAuthProfile = {
    email: verified.email,
    emailVerified: verified.emailVerified,
    displayName: verified.name,
    avatarUrl: verified.picture,
    scopes: exchanged.scope,
    tokenExpiresAtMs:
      exchanged.expiresIn === undefined
        ? undefined
        : expiryTimestampMs(now, exchanged.expiresIn),
  };

  const pending = await resolveIdentity({
    c,
    provider,
    providerUid: verified.sub,
    profile,
    requestState,
    now,
  });

  const resultCode = generateState();
  await c.env.CACHE_KV.put(resultKey(resultCode), JSON.stringify(pending), {
    expirationTtl: OAUTH_RESULT_TTL_SECONDS,
  });

  const destination = new URL(
    `${appBaseUrl(c.env)}${requestState.redirectTo ?? "/login"}`,
  );
  destination.searchParams.set("oauth_code", resultCode);
  return c.redirect(destination.toString(), 302);
}

routes.get("/auth/oauth/:provider/callback", handleCallback);
routes.post("/auth/oauth/:provider/callback", handleCallback);

async function resolveIdentity({
  c,
  provider,
  providerUid,
  profile,
  requestState,
  now,
}: {
  c: Context<{ Bindings: Env }>;
  provider: CustomerOAuthProvider;
  providerUid: string;
  profile: OAuthProfile;
  requestState: { linkCustomerId?: string; redirectTo?: string };
  now: number;
}): Promise<PendingResult> {
  const existing = await findLiveIdentity(c.env, provider, providerUid);

  if (existing) {
    if (
      requestState.linkCustomerId &&
      requestState.linkCustomerId !== existing.customer_id
    ) {
      throw conflict(
        "This provider account is already linked to another customer",
        "OAUTH_IDENTITY_TAKEN",
      );
    }
    await touchIdentityUse(c.env, existing.id, now);
    return {
      kind: "session",
      customerId: existing.customer_id,
      redirectTo: requestState.redirectTo,
    };
  }

  // An already-signed-in customer asked to attach this provider.
  if (requestState.linkCustomerId) {
    await insertIdentity(c.env, {
      customerId: requestState.linkCustomerId,
      provider,
      providerUid,
      profile,
      now,
    });
    return {
      kind: "session",
      customerId: requestState.linkCustomerId,
      redirectTo: requestState.redirectTo,
    };
  }

  // A matching email is a hint, never a merge. See services/oauth/identity.ts.
  if (isUsableProviderEmail(profile.email)) {
    const matchId = await findActiveCustomerIdByEmail(
      c.env,
      profile.email as string,
    );
    if (matchId) {
      return {
        kind: "needs_linking",
        provider,
        providerUid,
        maskedEmail: maskEmail(profile.email as string),
        redirectTo: requestState.redirectTo,
      };
    }
  }

  const customerId = await createCustomerForIdentity(c.env, {
    provider,
    providerUid,
    profile,
    now,
  });
  return { kind: "session", customerId, redirectTo: requestState.redirectTo };
}

const completeSchema = z.lazy(() =>
  z.object({
    code: z.string().min(1).max(200),
  }),
);

/**
 * Exchange the one-time code from the redirect for a session.
 *
 * When the provider identity matched an existing local account by email, this
 * returns a binding token instead of a session: the customer still has to prove
 * they control that account before the provider is attached to it.
 */
routes.post("/auth/oauth/complete", validateBody(completeSchema), async (c) => {
  const { code } = c.get("validatedBody") as { code: string };
  const key = resultKey(code);
  const raw = await c.env.CACHE_KV.get(key, "json");
  await c.env.CACHE_KV.delete(key);

  if (!raw) {
    throw badRequest(
      "Sign-in result expired or already used",
      "OAUTH_RESULT_INVALID",
    );
  }
  const pending = raw as PendingResult;

  if (pending.kind === "needs_linking") {
    const bindingToken = await issueBindingToken(c.env, {
      provider: pending.provider,
      providerUid: pending.providerUid,
    });
    return c.json({
      success: true,
      data: {
        needsLinking: true,
        provider: pending.provider,
        maskedEmail: pending.maskedEmail,
        bindingToken,
      },
    });
  }

  const session = await issueCustomerSession(
    c as unknown as Context<{ Bindings: Env }>,
    pending.customerId,
  );
  return c.json({
    success: true,
    data: {
      needsLinking: false,
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
    },
  });
});

const linkSchema = z.lazy(() =>
  z.object({
    bindingToken: z.string().min(1),
  }),
);

interface BindingClaims {
  type: string;
  provider?: unknown;
  providerUid?: unknown;
  exp?: unknown;
}

/**
 * Attach a pending provider identity to the customer making this request.
 *
 * Two proofs must meet here: the binding token proves the provider subject was
 * verified by us minutes ago, and the customer access token proves the caller
 * controls the target account. The spec sketched a variant that carried an OTP
 * or password inside this request instead; requiring an ordinary sign-in first
 * gives the identical guarantee while reusing the login paths that already
 * exist and are already tested, rather than growing a second credential check
 * that has to be kept in step with them.
 */
routes.post(
  "/auth/oauth/link",
  canonicalCustomerAuthMiddleware,
  validateBody(linkSchema),
  async (c) => {
    const { bindingToken } = c.get("validatedBody") as { bindingToken: string };
    const customer = c.get("customer");

    const decoded = verifyJwtToken(
      bindingToken,
      c.env.JWT_SECRET,
    ) as BindingClaims | null;
    if (!decoded || decoded.type !== "customer_bind") {
      throw unauthorized("Invalid binding token", "TOKEN_INVALID");
    }

    const provider =
      typeof decoded.provider === "string" ? decoded.provider : "";
    const providerUid =
      typeof decoded.providerUid === "string" ? decoded.providerUid : "";
    if (!isCustomerOAuthProvider(provider) || !providerUid) {
      throw unauthorized("Invalid binding token claims", "TOKEN_INVALID");
    }

    // Re-check at write time: another session may have claimed this subject
    // between the callback and this request.
    const existing = await findLiveIdentity(c.env, provider, providerUid);
    if (existing) {
      if (existing.customer_id === customer.id) {
        return c.json({ success: true, data: { linked: true, provider } });
      }
      throw conflict(
        "This provider account is already linked to another customer",
        "OAUTH_IDENTITY_TAKEN",
      );
    }

    await insertIdentity(c.env, {
      customerId: customer.id,
      provider,
      providerUid,
      profile: {},
      now: Date.now(),
    });

    return c.json({ success: true, data: { linked: true, provider } });
  },
);

routes.get("/auth/identities", canonicalCustomerAuthMiddleware, async (c) => {
  return c.json({
    success: true,
    data: await listLiveIdentities(c.env, c.get("customer").id),
  });
});

routes.delete(
  "/auth/identities/:id",
  canonicalCustomerAuthMiddleware,
  async (c) => {
    const customer = c.get("customer");
    const identityId = c.req.param("id");
    if (!identityId) {
      throw notFound("Sign-in method not found", "IDENTITY_NOT_FOUND");
    }

    // Removing the last way in would strand the account, so this is refused
    // rather than left for the customer to discover at the next sign-in.
    if (!(await hasAnotherAuthMethod(c.env, customer.id, identityId))) {
      throw conflict(
        "Cannot remove the only remaining sign-in method",
        "LAST_AUTH_METHOD",
      );
    }

    const revoked = await revokeIdentity(
      c.env,
      identityId,
      customer.id,
      Date.now(),
    );
    if (!revoked) {
      throw notFound("Sign-in method not found", "IDENTITY_NOT_FOUND");
    }

    return c.json({ success: true, data: { revoked: true } });
  },
);

export default routes;
