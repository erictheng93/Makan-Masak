import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { ApiError } from "../../../shared/utils/api-error";
import { D1EphemeralStore } from "../../../shared/utils/ephemeral-store";
import { OAUTH_PROVIDERS } from "../../../shared/oauth/providers";
import type { Env } from "../../../shared/types";
import type { Db } from "../services/staff-oauth";
import { createStaffOAuthRoutes } from "./oauth";

const ADMIN = "https://admin.example.test";
const migrationsDir = "../../../../../../packages/database/migrations_fresh/";

function applyMigration(sqlite: Database.Database, name: string) {
  const file = fileURLToPath(
    new URL(migrationsDir + name, import.meta.url).href,
  );
  for (const statement of readFileSync(file, "utf8").split(
    "--> statement-breakpoint",
  )) {
    sqlite.exec(statement);
  }
}

function insertUser(
  sqlite: Database.Database,
  overrides: {
    id: string;
    role?: number;
    email?: string;
    passwordSetAt?: number;
  },
) {
  sqlite
    .prepare(
      `INSERT INTO users (id, username, email, full_name, password_hash, role,
        password_set_at_ms, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, 'Name', 'hash', ?, ?, 1, 1)`,
    )
    .run(
      overrides.id,
      overrides.id,
      overrides.email ?? null,
      overrides.role ?? 1,
      overrides.passwordSetAt ?? null,
    );
}

function encode(value: string | Uint8Array): string {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

let keyPair: CryptoKeyPair;
let jwk: JsonWebKey & { kid?: string; alg?: string };

beforeAll(async () => {
  keyPair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  jwk = (await crypto.subtle.exportKey("jwk", keyPair.publicKey)) as typeof jwk;
  jwk.kid = "staff-key";
  jwk.alg = "RS256";
}, 30_000);

async function signIdToken(payload: Record<string, unknown>) {
  const header = encode(JSON.stringify({ alg: "RS256", kid: "staff-key" }));
  const body = encode(JSON.stringify(payload));
  const sig = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    keyPair.privateKey,
    new TextEncoder().encode(`${header}.${body}`),
  );
  return `${header}.${body}.${encode(new Uint8Array(sig))}`;
}

function buildHarness(envOverrides: Record<string, unknown> = {}) {
  const sqlite = new Database(":memory:");
  applyMigration(sqlite, "0000_baseline_strict.sql");
  applyMigration(sqlite, "0043_ephemeral_kv.sql");
  applyMigration(sqlite, "0044_user_auth_identities.sql");
  const db = drizzle(sqlite);
  const clock = { now: 1_000_000 };
  const store = new D1EphemeralStore(db as never, () => clock.now);

  const auth = {
    loginWithOAuth: vi.fn(async (userId: string) => ({
      success: true,
      user: { id: userId },
      tokens: { accessToken: "access", refreshToken: "refresh", expiresAt: 1 },
    })),
    logSecurityEvent: vi.fn(async () => undefined),
  };
  const setRefreshCookie = vi.fn();

  const routes = createStaffOAuthRoutes({
    authMiddleware: async (c, next) => {
      const id = c.req.header("x-test-user");
      if (!id) throw new ApiError("MISSING_AUTH_HEADER", "no auth", 401);
      c.set("user", { id } as never);
      await next();
    },
    AuthService: () => auth as never,
    setRefreshCookie,
    extractRequestInfo: () => ({ deviceInfo: {}, location: {} }),
    getWaitUntil: () => undefined,
    getDb: () => db as unknown as Db,
    getStore: () => store,
  });
  const app = new Hono<{ Bindings: Env }>();
  app.route("/api/v1/auth", routes);
  app.onError((err, c) =>
    err instanceof ApiError
      ? c.json(
          { success: false, error: { code: err.code, message: err.message } },
          err.status as 400,
        )
      : c.json({ success: false, error: { message: String(err) } }, 500),
  );

  const jwks = new Map<string, string>();
  const env = {
    ADMIN_APP_URL: ADMIN,
    API_BASE_URL: "https://api.example.test",
    GOOGLE_OAUTH_CLIENT_ID: "google-client",
    GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
    LINE_LOGIN_CHANNEL_ID: "line-client",
    LINE_LOGIN_CHANNEL_SECRET: "line-secret",
    CACHE_KV: {
      get: vi.fn(async (k: string) => {
        const v = jwks.get(k);
        return v ? JSON.parse(v) : null;
      }),
      put: vi.fn(async (k: string, v: string) => void jwks.set(k, v)),
    },
    DB: {},
    ...envOverrides,
  } as unknown as Env;

  const request = (path: string, init?: RequestInit) =>
    app.request(`https://api.example.test/api/v1/auth${path}`, init, env);

  /** Begin a flow and read back what the provider would receive. */
  async function start(opts: { linkAs?: string; query?: string } = {}) {
    const res = opts.linkAs
      ? await request(`/oauth/google/link/start${opts.query ?? ""}`, {
          method: "POST",
          headers: { "x-test-user": opts.linkAs },
        })
      : await request(`/oauth/google/start${opts.query ?? ""}`);
    if (res.status >= 400) return { res };
    const location = opts.linkAs
      ? ((await res.json()) as { data: { authorizeUrl: string } }).data
          .authorizeUrl
      : (res.headers.get("location") as string);
    const url = new URL(location);
    const setCookie = res.headers.get("set-cookie") as string;
    return {
      res,
      url,
      state: url.searchParams.get("state") as string,
      nonce: url.searchParams.get("nonce") as string,
      cookie: setCookie.split(";")[0],
    };
  }

  /** Hit the callback for a started flow (provider calls go to the stubbed fetch). */
  async function callback(
    flow: { state: string; cookie: string },
    over: { cookie?: string | null } = {},
  ) {
    const cookie = over.cookie === undefined ? flow.cookie : over.cookie;
    return request(`/oauth/google/callback?code=abc&state=${flow.state}`, {
      headers: cookie ? { cookie } : {},
    });
  }

  /** Stub the provider: token endpoint returns `idToken`, JWKS returns the key. */
  function stubProvider(idToken: () => Promise<string>) {
    const fetchImpl = vi.fn(async (url: string) =>
      url === OAUTH_PROVIDERS.google.tokenUrl
        ? new Response(
            JSON.stringify({ id_token: await idToken(), expires_in: 60 }),
            { status: 200 },
          )
        : new Response(JSON.stringify({ keys: [jwk] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchImpl);
    return fetchImpl;
  }

  /** start + callback with a signed token for `sub`. */
  async function signInAs(
    sub: string,
    over: { email?: string; linkAs?: string; cookie?: string | null } = {},
  ) {
    const flow = (await start({ linkAs: over.linkAs })) as Awaited<
      ReturnType<typeof start>
    > & { state: string; nonce: string; cookie: string };
    const fetchImpl = stubProvider(() =>
      signIdToken({
        iss: OAUTH_PROVIDERS.google.issuers[0],
        aud: "google-client",
        sub,
        exp: Math.floor(Date.now() / 1000) + 600,
        nonce: flow.nonce,
        email: over.email ?? "boss@example.test",
        email_verified: true,
      }),
    );
    const res = await callback(flow, { cookie: over.cookie });
    return { flow, res, fetchImpl };
  }

  const count = (table: string) =>
    (
      sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
        n: number;
      }
    ).n;
  const outcome = (res: Response) => {
    const url = new URL(res.headers.get("location") as string);
    return { url, params: Object.fromEntries(url.searchParams) };
  };

  return {
    sqlite,
    clock,
    auth,
    setRefreshCookie,
    request,
    start,
    signInAs,
    count,
    outcome,
    callback,
    stubProvider,
  };
}

afterEach(() => vi.unstubAllGlobals());

/** The cookie the callback sets for POST /oauth/complete, as a request header. */
function completeCookie(res: Response): string {
  const header = res.headers
    .getSetCookie()
    .find((value) => value.startsWith("staff_oauth_complete_"));
  return header ? header.split(";")[0] : "";
}

describe("start", () => {
  it("redirects to the provider with PKCE, nonce and the staff callback URI", async () => {
    const h = buildHarness();
    const { res, url, cookie } = await h.start({
      query: "?redirectTo=/s/shop1",
    });

    expect(res.status).toBe(302);
    expect(url!.origin + url!.pathname).toBe(
      OAUTH_PROVIDERS.google.authorizeUrl,
    );
    expect(Object.fromEntries(url!.searchParams)).toEqual(
      expect.objectContaining({
        client_id: "google-client",
        code_challenge_method: "S256",
        redirect_uri:
          "https://api.example.test/api/v1/auth/oauth/google/callback",
        state: expect.any(String),
        nonce: expect.any(String),
      }),
    );
    const setCookie = res.headers.get("set-cookie") as string;
    expect(setCookie).toContain(cookie);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toContain("Path=/api/v1/auth/oauth/google/callback");
  });

  it.each([
    "https://evil.example.test/steal",
    "//evil.example.test",
    "/\\evil.example.test",
    // The URL parser drops tabs, so this is //evil.example.test to a browser.
    "/\t/evil.example.test",
    "/.//evil.example.test",
    "javascript:alert(1)",
  ])("rejects redirectTo %s", async (target) => {
    const h = buildHarness();
    const { res } = await h.start({
      query: `?redirectTo=${encodeURIComponent(target)}`,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: "REDIRECT_INVALID" }),
      }),
    );
    expect(h.count("ephemeral_kv")).toBe(0);
  });

  it("accepts an absolute redirectTo on the admin origin", async () => {
    const h = buildHarness();
    const { res } = await h.start({
      query: `?redirectTo=${encodeURIComponent(`${ADMIN}/s/shop1`)}`,
    });
    expect(res.status).toBe(302);
  });

  it("fails closed when no admin origin is configured", async () => {
    const h = buildHarness({ ADMIN_APP_URL: undefined });
    const res = await h.request("/oauth/google/start");
    expect(res.status).toBe(503);
    expect(h.count("ephemeral_kv")).toBe(0);
    expect(await (await h.request("/oauth/providers")).json()).toEqual({
      success: true,
      data: { providers: [] },
    });
  });

  it("lists only configured providers", async () => {
    const h = buildHarness();
    const res = await h.request("/oauth/providers");
    expect(await res.json()).toEqual({
      success: true,
      data: { providers: ["google", "line"] },
    });
  });

  it("link/start requires a staff session", async () => {
    const h = buildHarness();
    const res = await h.request("/oauth/google/link/start", { method: "POST" });
    expect(res.status).toBe(401);
    expect(h.count("ephemeral_kv")).toBe(0);
  });
});

describe("callback: sign-in", () => {
  it("does not sign in or create anything for an unlinked identity", async () => {
    const h = buildHarness();
    const usersBefore = h.count("users");
    const { res } = await h.signInAs("unlinked-sub");

    expect(res.status).toBe(302);
    const { url, params } = h.outcome(res);
    expect(url.origin).toBe(ADMIN);
    expect(params).toEqual({ oauth_error: "OAUTH_IDENTITY_NOT_LINKED" });
    expect(h.count("users")).toBe(usersBefore);
    expect(h.count("user_auth_identities")).toBe(0);
    expect(
      h.sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM ephemeral_kv WHERE key LIKE 'staff_oauth_result:%'",
        )
        .get(),
    ).toEqual({ n: 0 });
  });

  it("never matches an account by email", async () => {
    const h = buildHarness();
    insertUser(h.sqlite, { id: "owner", email: "boss@example.test" });
    const { res } = await h.signInAs("new-sub", { email: "boss@example.test" });

    expect(h.outcome(res).params).toEqual({
      oauth_error: "OAUTH_IDENTITY_NOT_LINKED",
    });
    expect(h.count("user_auth_identities")).toBe(0);
  });

  it("treats an identity linked to a non-owner as not linked", async () => {
    const h = buildHarness();
    insertUser(h.sqlite, { id: "chef", role: 2 });
    h.sqlite
      .prepare(
        `INSERT INTO user_auth_identities (id, user_id, provider, provider_uid, created_at_ms)
         VALUES ('i1', 'chef', 'google', 'chef-sub', 1)`,
      )
      .run();
    const { res } = await h.signInAs("chef-sub");
    expect(h.outcome(res).params).toEqual({
      oauth_error: "OAUTH_IDENTITY_NOT_LINKED",
    });
  });

  it("issues a single-use, 60s code for a linked owner and completes like login", async () => {
    const h = buildHarness();
    insertUser(h.sqlite, { id: "owner" });
    h.sqlite
      .prepare(
        `INSERT INTO user_auth_identities (id, user_id, provider, provider_uid, created_at_ms)
         VALUES ('i1', 'owner', 'google', 'owner-sub', 1)`,
      )
      .run();
    const { res } = await h.signInAs("owner-sub");
    const { url, params } = h.outcome(res);
    expect(url.origin).toBe(ADMIN);
    expect(params).toEqual({ oauth_code: expect.any(String) });

    const complete = (code: string, cookie = completeCookie(res)) =>
      h.request("/oauth/complete", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ code }),
      });

    const ok = await complete(params.oauth_code);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      success: true,
      data: expect.objectContaining({ token: "access" }),
    });
    expect(h.auth.loginWithOAuth).toHaveBeenCalledOnce();
    expect(h.auth.loginWithOAuth).toHaveBeenCalledWith(
      "owner",
      "google",
      expect.objectContaining({ deviceInfo: expect.any(Object) }),
    );
    expect(h.setRefreshCookie).toHaveBeenCalledWith(
      expect.anything(),
      "refresh",
    );

    const reused = await complete(params.oauth_code);
    expect(reused.status).toBe(400);
    expect(await reused.json()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: "OAUTH_RESULT_INVALID" }),
      }),
    );
    expect(h.auth.loginWithOAuth).toHaveBeenCalledOnce();
  });

  it("expires the code after 60 seconds", async () => {
    const h = buildHarness();
    insertUser(h.sqlite, { id: "owner" });
    h.sqlite
      .prepare(
        `INSERT INTO user_auth_identities (id, user_id, provider, provider_uid, created_at_ms)
         VALUES ('i1', 'owner', 'google', 'owner-sub', 1)`,
      )
      .run();
    const { res } = await h.signInAs("owner-sub");
    const code = h.outcome(res).params.oauth_code;

    h.clock.now += 61_000;
    const late = await h.request("/oauth/complete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: completeCookie(res),
      },
      body: JSON.stringify({ code }),
    });
    expect(late.status).toBe(400);
    expect(h.auth.loginWithOAuth).not.toHaveBeenCalled();
  });

  it("refuses an inactive or unavailable account exactly as a failed login", async () => {
    const h = buildHarness();
    insertUser(h.sqlite, { id: "owner" });
    h.sqlite
      .prepare(
        `INSERT INTO user_auth_identities (id, user_id, provider, provider_uid, created_at_ms)
         VALUES ('i1', 'owner', 'google', 'owner-sub', 1)`,
      )
      .run();
    h.auth.loginWithOAuth.mockResolvedValueOnce({
      success: false,
      error: "Account is not available",
    } as never);
    const { res } = await h.signInAs("owner-sub");
    const code = h.outcome(res).params.oauth_code;

    const complete = await h.request("/oauth/complete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: completeCookie(res),
      },
      body: JSON.stringify({ code }),
    });
    expect(complete.status).toBe(401);
    expect(h.setRefreshCookie).not.toHaveBeenCalled();
  });
});

describe("callback: state and binding", () => {
  it("rejects a missing or mismatched binding cookie without burning the state", async () => {
    const h = buildHarness();
    const flow = (await h.start()) as {
      state: string;
      nonce: string;
      cookie: string;
    };
    const fetchImpl = h.stubProvider(async () => "unused");

    for (const cookie of [null, `${flow.cookie.split("=")[0]}=attacker`]) {
      const res = await h.callback(flow, { cookie });
      expect(h.outcome(res).params).toEqual({
        oauth_error: "OAUTH_STATE_INVALID",
      });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    // the legitimate browser can still finish
    expect(h.count("ephemeral_kv")).toBe(1);
  });

  it("rejects a reused state", async () => {
    const h = buildHarness();
    const { flow, res } = await h.signInAs("unlinked-sub");
    expect(h.outcome(res).params.oauth_error).toBe("OAUTH_IDENTITY_NOT_LINKED");

    const again = await h.callback(flow);
    expect(h.outcome(again).params).toEqual({
      oauth_error: "OAUTH_STATE_INVALID",
    });
  });

  it("rejects an id_token whose nonce does not match", async () => {
    const h = buildHarness();
    const flow = (await h.start()) as {
      state: string;
      nonce: string;
      cookie: string;
    };
    h.stubProvider(() =>
      signIdToken({
        iss: OAUTH_PROVIDERS.google.issuers[0],
        aud: "google-client",
        sub: "s",
        exp: Math.floor(Date.now() / 1000) + 600,
        nonce: "someone-elses-nonce",
      }),
    );
    const res = await h.callback(flow);
    expect(h.outcome(res).params).toEqual({
      oauth_error: "OAUTH_VERIFICATION_FAILED",
    });
    expect(h.count("user_auth_identities")).toBe(0);
  });
});

describe("link mode", () => {
  it("links the user captured at start and audits it", async () => {
    const h = buildHarness();
    insertUser(h.sqlite, { id: "owner" });
    const { res } = await h.signInAs("owner-sub", { linkAs: "owner" });

    expect(h.outcome(res).params).toEqual({ oauth_linked: "google" });
    expect(
      h.sqlite
        .prepare("SELECT user_id, provider_uid FROM user_auth_identities")
        .all(),
    ).toEqual([{ user_id: "owner", provider_uid: "owner-sub" }]);
    expect(h.auth.logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "OAUTH_IDENTITY_LINKED",
        userId: "owner",
      }),
    );
    // link mode never mints a sign-in code
    expect(
      h.sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM ephemeral_kv WHERE key LIKE 'staff_oauth_result:%'",
        )
        .get(),
    ).toEqual({ n: 0 });
  });

  it("refuses a non-owner", async () => {
    const h = buildHarness();
    insertUser(h.sqlite, { id: "chef", role: 2 });
    const { res } = await h.signInAs("chef-sub", { linkAs: "chef" });
    expect(h.outcome(res).params).toEqual({
      oauth_error: "OAUTH_LINK_NOT_ALLOWED",
    });
    expect(h.count("user_auth_identities")).toBe(0);
  });

  it("refuses an identity already linked to another user", async () => {
    const h = buildHarness();
    insertUser(h.sqlite, { id: "a" });
    insertUser(h.sqlite, { id: "b" });
    await h.signInAs("shared-sub", { linkAs: "a" });
    const { res } = await h.signInAs("shared-sub", { linkAs: "b" });

    expect(h.outcome(res).params).toEqual({
      oauth_error: "OAUTH_IDENTITY_ALREADY_LINKED",
    });
    expect(
      h.sqlite.prepare("SELECT user_id FROM user_auth_identities").all(),
    ).toEqual([{ user_id: "a" }]);
  });
});

describe("identities", () => {
  it("lists own identities and refuses to drop the last method", async () => {
    const h = buildHarness();
    insertUser(h.sqlite, { id: "owner" });
    await h.signInAs("owner-sub", { linkAs: "owner" });

    const list = await h.request("/identities", {
      headers: { "x-test-user": "owner" },
    });
    const body = (await list.json()) as { data: Array<{ id: string }> };
    expect(body.data).toEqual([
      expect.objectContaining({ provider: "google" }),
    ]);
    expect(JSON.stringify(body)).not.toContain("owner-sub");

    const del = await h.request(`/identities/${body.data[0].id}`, {
      method: "DELETE",
      headers: { "x-test-user": "owner" },
    });
    expect(del.status).toBe(409);
    expect(await del.json()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: "LAST_AUTH_METHOD" }),
      }),
    );
  });

  it("unlinks when a password was set, and audits it", async () => {
    const h = buildHarness();
    insertUser(h.sqlite, { id: "owner", passwordSetAt: 5 });
    await h.signInAs("owner-sub", { linkAs: "owner" });
    const id = (
      h.sqlite.prepare("SELECT id FROM user_auth_identities").get() as {
        id: string;
      }
    ).id;

    const del = await h.request(`/identities/${id}`, {
      method: "DELETE",
      headers: { "x-test-user": "owner" },
    });
    expect(del.status).toBe(200);
    expect(h.auth.logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "OAUTH_IDENTITY_UNLINKED",
        userId: "owner",
      }),
    );
  });

  it("refuses a code presented by a browser the callback did not redirect", async () => {
    const h = buildHarness();
    insertUser(h.sqlite, { id: "owner" });
    h.sqlite
      .prepare(
        `INSERT INTO user_auth_identities (id, user_id, provider, provider_uid, created_at_ms)
         VALUES ('i1', 'owner', 'google', 'owner-sub', 1)`,
      )
      .run();
    const { res } = await h.signInAs("owner-sub");
    const code = h.outcome(res).params.oauth_code;
    expect(completeCookie(res)).toMatch(/^staff_oauth_complete_[\w-]+=.+/);

    const send = (cookie: string) =>
      h.request("/oauth/complete", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ code }),
      });

    // Login CSRF: the attacker's code arrives without the attacker's cookie.
    const injected = await send(
      `${completeCookie(res).split("=")[0]}=someone-else`,
    );
    expect(injected.status).toBe(400);
    expect(h.auth.loginWithOAuth).not.toHaveBeenCalled();

    // The failed attempt burned the code, so the right cookie is too late.
    const retry = await send(completeCookie(res));
    expect(retry.status).toBe(400);
    expect(h.auth.loginWithOAuth).not.toHaveBeenCalled();
  });

  it("exchanges the code with the staff callback as redirect_uri", async () => {
    const h = buildHarness();
    insertUser(h.sqlite, { id: "owner" });
    const { fetchImpl } = await h.signInAs("any-sub");

    const tokenCall = fetchImpl.mock.calls.find(
      ([url]) => url === OAUTH_PROVIDERS.google.tokenUrl,
    ) as unknown as [string, { body: string }];
    // Providers reject an exchange whose redirect_uri differs from the one the
    // authorize request used; the customer callback path would be refused.
    expect(new URLSearchParams(tokenCall[1].body).get("redirect_uri")).toMatch(
      /\/api\/v1\/auth\/oauth\/google\/callback$/,
    );
  });

  it("refuses a pending sign-in once the provider has been unlinked", async () => {
    const h = buildHarness();
    insertUser(h.sqlite, { id: "owner" });
    h.sqlite
      .prepare(
        `INSERT INTO user_auth_identities (id, user_id, provider, provider_uid, created_at_ms)
         VALUES ('i1', 'owner', 'google', 'owner-sub', 1)`,
      )
      .run();
    const { res } = await h.signInAs("owner-sub");
    const code = h.outcome(res).params.oauth_code;

    h.sqlite
      .prepare(
        "UPDATE user_auth_identities SET revoked_at_ms = 2 WHERE id = 'i1'",
      )
      .run();

    const complete = await h.request("/oauth/complete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: completeCookie(res),
      },
      body: JSON.stringify({ code }),
    });
    expect(complete.status).toBe(401);
    expect(h.auth.loginWithOAuth).not.toHaveBeenCalled();
    expect(h.setRefreshCookie).not.toHaveBeenCalled();
  });

  it("returns a cancelled authorization to the page it started from", async () => {
    const h = buildHarness();
    const flow = (await h.start({ query: "?redirectTo=/s/shop1" })) as {
      state: string;
      cookie: string;
    };

    const res = await h.request(
      `/oauth/google/callback?error=access_denied&state=${flow.state}`,
      { headers: { cookie: flow.cookie } },
    );
    const { url, params } = h.outcome(res);
    expect(url.origin).toBe(ADMIN);
    expect(url.pathname).toBe("/s/shop1");
    expect(params).toEqual({ oauth_error: "declined" });

    // With no state there is nowhere to return to; "/" would lose the message
    // behind the dashboard's auth redirect, so it goes to the login page.
    const stateless = h.outcome(
      await h.request("/oauth/google/callback?error=access_denied"),
    );
    expect(stateless.url.pathname).toBe("/login");
    expect(stateless.params).toEqual({ oauth_error: "declined" });
  });

  it("lets two sign-ins that finish in one browser both complete", async () => {
    const h = buildHarness();
    insertUser(h.sqlite, { id: "owner" });
    h.sqlite
      .prepare(
        `INSERT INTO user_auth_identities (id, user_id, provider, provider_uid, created_at_ms)
         VALUES ('i1', 'owner', 'google', 'owner-sub', 1)`,
      )
      .run();
    const first = await h.signInAs("owner-sub");
    const second = await h.signInAs("owner-sub");
    // One browser: it holds both cookies and sends them together.
    const cookie = [first.res, second.res].map(completeCookie).join("; ");

    for (const { res } of [first, second]) {
      const done = await h.request("/oauth/complete", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ code: h.outcome(res).params.oauth_code }),
      });
      expect(done.status).toBe(200);
    }
    expect(h.auth.loginWithOAuth).toHaveBeenCalledTimes(2);
  });
});
