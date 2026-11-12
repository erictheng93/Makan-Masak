/**
 * Staff (shop owner) Google / LINE sign-in. Phase 1, API only.
 *
 * Same shape as the customer flow (features/customer/routes/oauth.ts):
 * Authorization Code + PKCE + state + nonce, the callback bound to the starting
 * browser by an HttpOnly cookie, and a one-time code handed to the SPA, which
 * trades it for a session over a POST so tokens never travel in a URL.
 *
 * Differences that matter:
 *  - Link-only. A provider account that is not already linked to an owner never
 *    signs in and never creates a user; email is never used to match.
 *  - Request state and the one-time code live in the D1 ephemeral store.
 *  - Browser redirects only ever go to the admin dashboard origin.
 *  - Linking starts from `POST /oauth/:provider/link/start` (bearer auth),
 *    because a top-level navigation cannot carry an Authorization header.
 */

import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import { z } from "zod";
import { createDatabase } from "@makanmasak/database";
import type { Env } from "../../../shared/types";
import { USER_ROLES } from "../../../shared/constants";
import { validateBody } from "../../../middleware/validation";
import {
  ApiError,
  badRequest,
  notFound,
  unauthorized,
} from "../../../shared/utils/api-error";
import {
  ephemeralStore,
  type D1EphemeralStore,
} from "../../../shared/utils/ephemeral-store";
import {
  buildRedirectUri,
  getClientId,
  isProviderConfigured,
  OAUTH_PROVIDERS,
  type OAuthEnv,
} from "../../../shared/oauth/providers";
import {
  consumeRequestState,
  deriveCodeChallenge,
  generateCodeVerifier,
  generateNonce,
  generateState,
  OAUTH_STATE_TTL_SECONDS,
  saveRequestState,
} from "../../../shared/oauth/state";
import { exchangeCodeForIdToken } from "../../../shared/oauth/tokenExchange";
import { verifyIdToken } from "../../../shared/oauth/idToken";
import {
  findLiveIdentity,
  isStaffOAuthProvider,
  linkIdentity,
  listIdentities,
  revokeIdentity,
  STAFF_OAUTH_PROVIDERS,
  touchLastUsed,
  type Db,
  type StaffOAuthProvider,
} from "../services/staff-oauth";
import type { DeviceInfo, LocationInfo } from "../types";
import type { AuthMiddleware, AuthServiceFactory } from "./index";

/** One-time code lifetime. Short: it only has to survive one redirect. */
const OAUTH_CODE_TTL_SECONDS = 60;
const BINDING_COOKIE_PREFIX = "staff_oauth_binding_";
const COMPLETE_COOKIE = "staff_oauth_complete";

interface PendingSignIn {
  userId: string;
  provider: StaffOAuthProvider;
  /**
   * SHA-256 of the value in COMPLETE_COOKIE, set on the browser the callback
   * redirected. Without it a one-time code is a bearer value: an attacker could
   * hand their own code to a victim's browser and sign the victim in to the
   * attacker's shop (login CSRF).
   */
  bindingHash: string;
}

type StaffOAuthStore = Pick<
  D1EphemeralStore,
  "get" | "put" | "delete" | "take"
>;

export interface StaffOAuthRouteDeps {
  authMiddleware: AuthMiddleware;
  AuthService: AuthServiceFactory;
  /** Same cookie/context helpers POST /login uses, so both set sessions alike. */
  setRefreshCookie: <E extends { Bindings: Env }>(
    c: Context<E>,
    token: string,
  ) => void;
  extractRequestInfo: <E extends { Bindings: Env }>(
    c: Context<E>,
  ) => { deviceInfo: DeviceInfo; location: LocationInfo };
  getWaitUntil: <E extends { Bindings: Env }>(
    c: Context<E>,
  ) => ((work: Promise<unknown>) => void) | undefined;
  /** Test seams; default to the real D1-backed implementations. */
  getDb?: (env: Env) => Db;
  getStore?: (env: Env) => StaffOAuthStore;
}

type Ctx = Context<{ Bindings: Env }>;

function requireProvider(value: string | undefined): StaffOAuthProvider {
  if (!isStaffOAuthProvider(value)) {
    throw notFound("Unknown sign-in provider", "OAUTH_PROVIDER_UNKNOWN");
  }
  return value;
}

function unavailable(message: string): ApiError {
  return new ApiError("OAUTH_PROVIDER_UNAVAILABLE", message, 503);
}

/**
 * The single origin browsers are sent back to. Unset or malformed fails
 * closed: with no configured admin origin there is nowhere safe to redirect.
 */
function adminOrigin(env: Env): string {
  try {
    const origin = new URL(env.ADMIN_APP_URL?.trim() ?? "").origin;
    if (origin !== "null") return origin;
  } catch {
    // fall through
  }
  throw unavailable("Staff sign-in is not configured");
}

/**
 * Reduce `redirectTo` to a path on the admin origin. A same-origin absolute URL
 * is accepted for convenience; any other origin, a protocol-relative `//host`
 * or a backslash trick is rejected rather than quietly dropped, so a bad link
 * is noticed instead of landing somewhere unexpected.
 */
function resolveRedirectPath(env: Env, raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) return "/";
  const bad = () =>
    badRequest(
      "redirectTo must stay on the admin dashboard",
      "REDIRECT_INVALID",
    );
  if (value.startsWith("/")) {
    if (value.startsWith("//") || value.includes("\\")) throw bad();
    return value;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw bad();
  }
  if (url.origin !== adminOrigin(env)) throw bad();
  return `${url.pathname}${url.search}`;
}

function assertConfigured(env: OAuthEnv, provider: StaffOAuthProvider) {
  if (!isProviderConfigured(env, provider)) {
    throw unavailable(`${provider} sign-in is not configured`);
  }
}

/**
 * One cookie per pending state, named from a digest of the state so a second
 * tab does not clobber the first flow. Path-scoped to the callback, GET-only
 * providers, so SameSite=Lax is enough and Secure/HttpOnly stay on.
 */
async function bindingCookieName(state: string) {
  const digest = await deriveCodeChallenge(state);
  return `${BINDING_COOKIE_PREFIX}${digest.slice(0, 16)}`;
}

function bindingCookieOptions(env: OAuthEnv, provider: StaffOAuthProvider) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "Lax" as const,
    path: new URL(buildRedirectUri(env, provider, "staff")).pathname,
  };
}

/** Sent only to POST /oauth/complete, and only for as long as the code lives. */
function completeCookieOptions(env: OAuthEnv, provider: StaffOAuthProvider) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "Lax" as const,
    path: new URL(buildRedirectUri(env, provider, "staff")).pathname.replace(
      `/${provider}/callback`,
      "/complete",
    ),
  };
}

const resultKey = (code: string) => `staff_oauth_result:${code}`;

const completeSchema = z.lazy(() =>
  z.object({ code: z.string().min(1).max(200) }),
);

export function createStaffOAuthRoutes(
  deps: StaffOAuthRouteDeps,
): Hono<{ Bindings: Env }> {
  const routes = new Hono<{ Bindings: Env }>();
  const getDb = deps.getDb ?? ((env: Env) => createDatabase(env.DB));
  const getStore = deps.getStore ?? ((env: Env) => ephemeralStore(env));

  /** Persist request state, set the binding cookie, return the provider URL. */
  async function beginFlow(
    c: Ctx,
    provider: StaffOAuthProvider,
    linkUserId?: string,
  ): Promise<string> {
    const env = c.env as OAuthEnv;
    assertConfigured(env, provider);
    adminOrigin(c.env); // fail closed before writing any state
    const redirectTo = resolveRedirectPath(c.env, c.req.query("redirectTo"));

    const config = OAUTH_PROVIDERS[provider];
    const state = generateState();
    const nonce = generateNonce();
    const codeVerifier = generateCodeVerifier();

    const bindingNonce = generateState();
    setCookie(c, await bindingCookieName(state), bindingNonce, {
      ...bindingCookieOptions(env, provider),
      maxAge: OAUTH_STATE_TTL_SECONDS,
    });

    await saveRequestState(getStore(c.env), provider, state, {
      bindingHash: await deriveCodeChallenge(bindingNonce),
      codeVerifier,
      nonce,
      redirectTo,
      // Captured here, from the authenticated request, so the callback cannot
      // be steered into linking the provider to another account.
      linkUserId,
    });

    const params = new URLSearchParams({
      response_type: "code",
      client_id: getClientId(env, provider) as string,
      redirect_uri: buildRedirectUri(env, provider, "staff"),
      scope: config.scope,
      state,
      nonce,
      code_challenge: await deriveCodeChallenge(codeVerifier),
      code_challenge_method: "S256",
    });
    return `${config.authorizeUrl}?${params.toString()}`;
  }

  routes.get("/oauth/providers", (c) => {
    const env = c.env as OAuthEnv;
    let providers: StaffOAuthProvider[] = [];
    try {
      adminOrigin(c.env);
      providers = STAFF_OAUTH_PROVIDERS.filter((p) =>
        isProviderConfigured(env, p),
      );
    } catch {
      // no admin origin configured: nothing is offered
    }
    return c.json({ success: true, data: { providers } });
  });

  // Public: begins SIGN-IN only. Any Authorization header is ignored here.
  routes.get("/oauth/:provider/start", async (c) => {
    const provider = requireProvider(c.req.param("provider"));
    return c.redirect(await beginFlow(c, provider), 302);
  });

  // Authenticated: begins LINK for the caller. Returns the URL for the SPA to
  // navigate to; the binding cookie is set on this response.
  routes.post("/oauth/:provider/link/start", deps.authMiddleware, async (c) => {
    const provider = requireProvider(c.req.param("provider"));
    const user = c.get("user");
    const authorizeUrl = await beginFlow(c, provider, String(user.id));
    return c.json({ success: true, data: { authorizeUrl } });
  });

  routes.get("/oauth/:provider/callback", async (c) => {
    const env = c.env as OAuthEnv;
    const provider = requireProvider(c.req.param("provider"));
    assertConfigured(env, provider);
    const origin = adminOrigin(c.env);

    const back = (params: Record<string, string>, path = "/") => {
      const url = new URL(path, origin);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      return c.redirect(url.toString(), 302);
    };

    if (c.req.query("error")) return back({ oauth_error: "declined" });
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state) return back({ oauth_error: "OAUTH_CALLBACK_INVALID" });

    const cookieName = await bindingCookieName(state);
    const bindingCookie = getCookie(c, cookieName);
    const store = getStore(c.env);
    const requestState = await consumeRequestState(
      store,
      provider,
      state,
      bindingCookie ? await deriveCodeChallenge(bindingCookie) : undefined,
    );
    if (!requestState) return back({ oauth_error: "OAUTH_STATE_INVALID" });
    deleteCookie(c, cookieName, bindingCookieOptions(env, provider));

    // redirectTo was validated at start; re-resolve defensively anyway.
    const path = resolveRedirectPath(c.env, requestState.redirectTo);

    // A redirect endpoint cannot answer with a JSON error: the browser is
    // mid-navigation, so every failure past this point becomes ?oauth_error.
    try {
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

      const db = getDb(c.env);
      const now = Date.now();
      const auth = deps.AuthService(c.env, deps.getWaitUntil(c));
      const { deviceInfo, location } = deps.extractRequestInfo(c);

      if (requestState.linkUserId) {
        const { id } = await linkIdentity(db, {
          userId: requestState.linkUserId,
          provider,
          providerUid: verified.sub,
          profile: {
            email: verified.email,
            emailVerified: verified.emailVerified,
            displayName: verified.name,
            avatarUrl: verified.picture,
          },
          now,
        });
        await auth.logSecurityEvent({
          type: "OAUTH_IDENTITY_LINKED",
          userId: requestState.linkUserId,
          ipAddress: deviceInfo.ipAddress,
          userAgent: deviceInfo.userAgent,
          location,
          metadata: { provider, identityId: id },
          severity: "MEDIUM",
        });
        return back({ oauth_linked: provider }, path);
      }

      // Sign-in. Not linked, or linked to a non-owner: same answer, and
      // nothing is created either way.
      const identity = await findLiveIdentity(db, provider, verified.sub);
      if (!identity || identity.role !== USER_ROLES.OWNER) {
        return back({ oauth_error: "OAUTH_IDENTITY_NOT_LINKED" }, path);
      }
      await touchLastUsed(db, identity.id, now);

      const resultCode = generateState();
      const completeNonce = generateState();
      setCookie(c, COMPLETE_COOKIE, completeNonce, {
        ...completeCookieOptions(env, provider),
        maxAge: OAUTH_CODE_TTL_SECONDS,
      });
      const pending: PendingSignIn = {
        userId: identity.userId,
        provider,
        bindingHash: await deriveCodeChallenge(completeNonce),
      };
      await store.put(resultKey(resultCode), JSON.stringify(pending), {
        expirationTtl: OAUTH_CODE_TTL_SECONDS,
      });
      return back({ oauth_code: resultCode }, path);
    } catch (error) {
      if (error instanceof ApiError) {
        return back({ oauth_error: error.code }, path);
      }
      console.error("[staff-oauth] callback failed", {
        provider,
        name: error instanceof Error ? error.name : "unknown",
      });
      return back({ oauth_error: "OAUTH_VERIFICATION_FAILED" }, path);
    }
  });

  routes.post("/oauth/complete", validateBody(completeSchema), async (c) => {
    const { code } = c.get("validatedBody") as { code: string };
    // take() is one statement, so a code cannot be redeemed twice even by two
    // requests racing each other; a wrong cookie still burns it.
    const raw = await getStore(c.env).take(resultKey(code));
    const pending = raw ? (JSON.parse(raw) as PendingSignIn) : null;
    const completeNonce = getCookie(c, COMPLETE_COOKIE);
    if (pending) {
      deleteCookie(
        c,
        COMPLETE_COOKIE,
        completeCookieOptions(c.env as OAuthEnv, pending.provider),
      );
    }
    if (
      !pending ||
      !completeNonce ||
      (await deriveCodeChallenge(completeNonce)) !== pending.bindingHash
    ) {
      throw badRequest(
        "Sign-in result expired or already used",
        "OAUTH_RESULT_INVALID",
      );
    }

    const { deviceInfo, location } = deps.extractRequestInfo(c);
    const result = await deps
      .AuthService(c.env, deps.getWaitUntil(c))
      .loginWithOAuth(pending.userId, pending.provider, {
        deviceInfo,
        location,
      });
    if (!result.success) {
      throw unauthorized(
        result.error || "Account is not available",
        "OAUTH_ACCOUNT_UNAVAILABLE",
      );
    }
    if (result.tokens?.refreshToken) {
      deps.setRefreshCookie(c, result.tokens.refreshToken);
    }
    return c.json({
      success: true,
      data: {
        token: result.tokens?.accessToken,
        expiresAt: result.tokens?.expiresAt,
        user: result.user,
      },
    });
  });

  routes.get("/identities", deps.authMiddleware, async (c) => {
    const data = await listIdentities(getDb(c.env), String(c.get("user").id));
    return c.json({ success: true, data });
  });

  routes.delete("/identities/:id", deps.authMiddleware, async (c) => {
    const user = c.get("user");
    const { provider } = await revokeIdentity(
      getDb(c.env),
      String(user.id),
      c.req.param("id") ?? "",
      Date.now(),
    );
    const { deviceInfo, location } = deps.extractRequestInfo(c);
    await deps.AuthService(c.env, deps.getWaitUntil(c)).logSecurityEvent({
      type: "OAUTH_IDENTITY_UNLINKED",
      userId: String(user.id),
      ipAddress: deviceInfo.ipAddress,
      userAgent: deviceInfo.userAgent,
      location,
      metadata: { provider },
      severity: "MEDIUM",
    });
    return c.json({ success: true, data: { revoked: true } });
  });

  return routes;
}
