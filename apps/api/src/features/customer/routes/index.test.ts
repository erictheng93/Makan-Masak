import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, Next } from "hono";
import type { NotificationPayload } from "@makanmasak/database";

const auth = vi.hoisted(() => ({
  customer: {
    id: "customer-1",
    displayName: "Customer One",
    primaryPhone: "+886912345678",
    primaryEmail: undefined,
    status: "active",
  },
}));

const jwt = vi.hoisted(() => ({
  decoded: undefined as unknown,
  sign: vi.fn(
    async (payload: { type: string; sub: string; jti?: string }) =>
      `signed:${payload.type}:${payload.sub}:${payload.jti ?? "access"}`,
  ),
  verify: vi.fn(() => jwt.decoded),
}));

// Spread the real module rather than replacing it. A whole-module stand-in
// silently drops every middleware it forgets to list, so a route's guard
// disappears without any test noticing — and the missing export only surfaces
// when some other route happens to import it.
vi.mock("../../../middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../middleware/auth")>()),
  canonicalCustomerAuthMiddleware: vi.fn(async (c: Context, next: Next) => {
    c.set("customer", auth.customer);
    await next();
  }),
  verifyJwtToken: jwt.verify,
}));

vi.mock("hono/jwt", () => ({
  sign: jwt.sign,
  verify: jwt.verify,
}));

const bcryptMocks = vi.hoisted(() => ({
  hash: vi.fn(async (value: string) => `hash:${value}`),
  compare: vi.fn(async () => true),
}));

vi.mock("bcryptjs", () => ({
  default: bcryptMocks,
}));

const utilMocks = vi.hoisted(() => ({
  ApiError: class ApiError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly status: number = 500,
      public readonly details?: unknown,
    ) {
      super(message);
      this.name = "ApiError";
    }
  },
  generateUUID: vi.fn(() => "uuid-1"),
  normalizeE164Phone: vi.fn((phone: string) =>
    phone.startsWith("+") ? phone : `+${phone}`,
  ),
}));

vi.mock("@makanmasak/utils", () => ({
  ...utilMocks,
  badRequest: vi.fn(
    (message = "Invalid request", code = "BAD_REQUEST", details?: unknown) =>
      new utilMocks.ApiError(code, message, 400, details),
  ),
  unauthorized: vi.fn(
    (message = "Unauthorized", code = "UNAUTHORIZED") =>
      new utilMocks.ApiError(code, message, 401),
  ),
  forbidden: vi.fn(
    (message = "Access denied", code = "FORBIDDEN") =>
      new utilMocks.ApiError(code, message, 403),
  ),
  conflict: vi.fn(
    (message = "Resource conflict", code = "CONFLICT") =>
      new utilMocks.ApiError(code, message, 409),
  ),
  notFound: vi.fn(
    (message = "Resource not found", code = "NOT_FOUND") =>
      new utilMocks.ApiError(code, message, 404),
  ),
}));

// Only NotificationService is stubbed. createSmsProvider stays real so the OTP
// tests keep exercising the actual vendor wire format through env.SMS_FETCH.
const notificationMocks = vi.hoisted(() => ({
  sendNotification: vi.fn(async (_payload: NotificationPayload) => ({
    success: true,
    errors: [] as string[],
  })),
}));

vi.mock("@makanmasak/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@makanmasak/database")>();
  return {
    ...actual,
    NotificationService: class {
      sendNotification = notificationMocks.sendNotification;
    },
  };
});

import routes, {
  generateOtp,
  pruneStaleCustomerPushSubscriptions,
} from "./index";
import { ApiError } from "../../../shared/utils/api-error";

routes.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      { success: false, error: { code: err.code, message: err.message } },
      err.status as 400 | 401 | 403 | 404 | 409 | 500,
    );
  }
  return c.json({ success: false, error: { message: String(err) } }, 500);
});

type DbQueues = {
  first: unknown[];
  all: unknown[];
  run: unknown[];
  statements: Array<{ sql: string; args: unknown[] }>;
};

function createDb(queues: Partial<DbQueues> = {}) {
  const state: DbQueues = {
    first: queues.first ?? [],
    all: queues.all ?? [],
    run: queues.run ?? [],
    statements: queues.statements ?? [],
  };
  const db = {
    state,
    prepare: vi.fn((sql: string) => {
      const statement = {
        bind: vi.fn((...args: unknown[]) => {
          state.statements.push({ sql, args });
          return statement;
        }),
        first: vi.fn(async () => state.first.shift() ?? null),
        all: vi.fn(async () => state.all.shift() ?? { results: [] }),
        run: vi.fn(async () => {
          const result = state.run.shift();
          if (result instanceof Error) {
            throw result;
          }
          return result ?? { meta: { changes: 1 } };
        }),
      };
      return statement;
    }),
  };
  return db;
}

function createKv(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      values.delete(key);
    }),
    list: vi.fn(async ({ prefix }: { prefix?: string } = {}) => ({
      keys: [...values.keys()]
        .filter((key) => !prefix || key.startsWith(prefix))
        .map((name) => ({ name })),
      list_complete: true,
      cursor: undefined,
    })),
  };
}

function customerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "customer-1",
    display_name: "Customer One",
    primary_phone: "+886912345678",
    primary_email: null,
    avatar_url: null,
    locale: "zh-TW",
    status: "active",
    last_seen_at_ms: 1_780_000_000_000,
    created_at_ms: 1_770_000_000_000,
    updated_at_ms: 1_780_000_000_000,
    ...overrides,
  };
}

function passwordIdentityRow(overrides: Record<string, unknown> = {}) {
  return {
    ...customerRow(),
    identity_id: "identity-1",
    customer_id: "customer-1",
    provider_uid: "ada@example.com",
    secret_hash: "hash:password",
    verified_at_ms: 1_780_000_000_000,
    ...overrides,
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function request(
  path: string,
  method = "GET",
  body?: unknown,
  envOverrides: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  const db = (envOverrides.DB as ReturnType<typeof createDb>) ?? createDb();
  const rateLimitKv =
    (envOverrides.RATE_LIMIT_KV as ReturnType<typeof createKv>) ?? createKv();
  const tokenKv =
    (envOverrides.TOKEN_BLACKLIST as ReturnType<typeof createKv>) ?? createKv();
  const env = {
    DB: db,
    RATE_LIMIT_KV: rateLimitKv,
    TOKEN_BLACKLIST: tokenKv,
    JWT_SECRET: "x".repeat(32),
    NODE_ENV: "test",
    ...envOverrides,
  };

  const response = routes.request(
    path,
    {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        Authorization: "Bearer access-token",
        "User-Agent": "vitest",
        "CF-Connecting-IP": "203.0.113.10",
        ...headers,
      },
    },
    env as never,
  );

  return { response, db, rateLimitKv, tokenKv };
}

type OtpRequestBody = {
  success: boolean;
  data: { phone: string; expiresInSeconds: number; devOtp?: string };
};

type VerifyOtpBody = {
  success: boolean;
  data: { accessToken: string; customer: { id: string } };
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.customer = {
    id: "customer-1",
    displayName: "Customer One",
    primaryPhone: "+886912345678",
    primaryEmail: undefined,
    status: "active",
  };
  jwt.decoded = {
    sub: "customer-1",
    type: "customer_refresh",
    jti: "refresh-1",
  };
  bcryptMocks.compare.mockResolvedValue(true);
  utilMocks.generateUUID.mockReturnValue("uuid-1");
  notificationMocks.sendNotification.mockResolvedValue({
    success: true,
    errors: [],
  });
});

describe("generateOtp", () => {
  it("rejects random values outside the unbiased modulo range", () => {
    const randomValues = [4_294_000_000, 123_456];
    const getRandomValues = vi.fn((array: Uint32Array) => {
      array[0] = randomValues.shift() ?? 0;
      return array;
    });

    expect(generateOtp(getRandomValues)).toBe("123456");
    expect(getRandomValues).toHaveBeenCalledTimes(2);
  });

  it("returns zero-padded six digit codes", () => {
    const getRandomValues = vi.fn((array: Uint32Array) => {
      array[0] = 42;
      return array;
    });

    expect(generateOtp(getRandomValues)).toBe("000042");
  });
});

describe("customer identity routes", () => {
  it("requests OTPs with rate limits and development OTP echo", async () => {
    const db = createDb();
    const rateLimitKv = createKv();

    const { response } = request(
      "/auth/request-otp",
      "POST",
      {
        phone: "+886912345678",
      },
      { DB: db, RATE_LIMIT_KV: rateLimitKv },
    );
    const body = await (await response).json<OtpRequestBody>();

    expect(body).toMatchObject({
      success: true,
      data: {
        phone: "+886912345678",
        expiresInSeconds: 300,
      },
    });
    expect(body.data.devOtp).toMatch(/^\d{6}$/);
    expect(bcryptMocks.hash).toHaveBeenCalledWith(body.data.devOtp, 10);
    expect(rateLimitKv.put).toHaveBeenCalledWith(
      "customer_otp_phone:+886912345678",
      "1",
      { expirationTtl: 60 * 60 },
    );
    expect(db.state.statements.at(-1)?.sql).toContain(
      "INSERT INTO customer_phone_verification_tokens",
    );
  });

  it("skips SMS delivery outside production when no vendor is configured", async () => {
    const smsFetch = vi.fn();

    const { response } = request(
      "/auth/request-otp",
      "POST",
      { phone: "+886912345678" },
      { SMS_FETCH: smsFetch },
    );
    const body = await (await response).json<OtpRequestBody>();

    expect(body.success).toBe(true);
    expect(body.data.devOtp).toMatch(/^\d{6}$/);
    expect(smsFetch).not.toHaveBeenCalled();
  });

  it("does not echo OTPs outside explicit development and test environments", async () => {
    const { response } = request(
      "/auth/request-otp",
      "POST",
      { phone: "+886912345678" },
      { NODE_ENV: "staging" },
    );
    const body = await (await response).json<OtpRequestBody>();

    expect(body).toMatchObject({
      success: true,
      data: {
        phone: "+886912345678",
        expiresInSeconds: 300,
      },
    });
    expect(body.data).not.toHaveProperty("devOtp");
  });

  it("delivers the OTP through the configured SMS vendor", async () => {
    const smsFetch = vi
      .fn()
      .mockResolvedValue(
        new Response("[1]\r\nmsgid=990001\r\nstatuscode=1\r\nAccountPoint=50"),
      );

    const { response } = request(
      "/auth/request-otp",
      "POST",
      { phone: "+886912345678" },
      {
        SMS_PROVIDER: "mitake",
        MITAKE_USERNAME: "acct",
        MITAKE_PASSWORD: "secret",
        OTP_SMS_BRAND: "麻煩麻煩",
        SMS_FETCH: smsFetch,
      },
    );
    const body = await (await response).json<OtpRequestBody>();

    expect(body.success).toBe(true);
    expect(smsFetch).toHaveBeenCalledOnce();

    const form = new URLSearchParams(
      String((smsFetch.mock.calls[0][1] as RequestInit).body),
    );
    expect(form.get("dstaddr")).toBe("0912345678");
    expect(form.get("smbody")).toContain(body.data.devOtp);
    expect(form.get("smbody")).toContain("【麻煩麻煩】");
  });

  it("fails with 502 when the SMS vendor rejects the send", async () => {
    const smsFetch = vi
      .fn()
      .mockResolvedValue(new Response("[1]\r\nstatuscode=v"));

    const { response } = request(
      "/auth/request-otp",
      "POST",
      { phone: "+886900000000" },
      {
        SMS_PROVIDER: "mitake",
        MITAKE_USERNAME: "acct",
        MITAKE_PASSWORD: "secret",
        SMS_FETCH: smsFetch,
      },
    );
    const rawResponse = await response;
    const body = await rawResponse.json();

    expect(rawResponse.status).toBe(502);
    expect(body).toMatchObject({
      success: false,
      error: { code: "SMS_SEND_FAILED" },
    });
    // The vendor's own wording must not reach the client.
    expect(JSON.stringify(body)).not.toContain("無效的手機號碼");
  });

  it("refuses OTP requests in production when no SMS vendor is configured", async () => {
    const db = createDb();

    const { response } = request(
      "/auth/request-otp",
      "POST",
      { phone: "+886912345678" },
      { DB: db, NODE_ENV: "production" },
    );
    const rawResponse = await response;
    const body = await rawResponse.json();

    expect(rawResponse.status).toBe(503);
    expect(body).toMatchObject({
      success: false,
      error: { code: "SMS_CHANNEL_UNAVAILABLE" },
    });
    // No token row is written for a code that can never be delivered.
    expect(db.state.statements).toHaveLength(0);
  });

  it("verifies OTPs, creates new customers, and issues tokens", async () => {
    utilMocks.generateUUID.mockReturnValueOnce("customer-new");
    const db = createDb({
      first: [
        { id: 10, otp_code: "hash:123456", attempts: 0 },
        null,
        customerRow({ id: "customer-new", display_name: "+886912345678" }),
      ],
    });
    const tokenKv = createKv();

    const { response } = request(
      "/auth/verify-otp",
      "POST",
      { phone: "+886912345678", otp: "123456" },
      { DB: db, TOKEN_BLACKLIST: tokenKv },
    );
    const rawResponse = await response;
    const body = await rawResponse.json<VerifyOtpBody>();

    expect(body).toMatchObject({
      success: true,
      data: {
        accessToken: "signed:customer:customer-new:access",
        customer: { id: "customer-new" },
      },
    });
    expect(body.data).not.toHaveProperty("refreshToken");
    expect(
      decodeURIComponent(rawResponse.headers.get("set-cookie") ?? ""),
    ).toContain(
      "__Host-mm_customer_refresh=signed:customer_refresh:customer-new:",
    );
    expect(rawResponse.headers.get("set-cookie")).toContain("HttpOnly");
    expect(bcryptMocks.compare).toHaveBeenCalledWith("123456", "hash:123456");
    expect(tokenKv.put).toHaveBeenCalledWith(
      expect.stringMatching(/^customer_refresh:customer-new:/),
      "1",
      { expirationTtl: 30 * 24 * 60 * 60 },
    );
  });

  it("increments OTP attempts and rejects invalid verification codes", async () => {
    bcryptMocks.compare.mockResolvedValueOnce(false);
    const db = createDb({
      first: [{ id: 10, otp_code: "hash:123456", attempts: 0 }],
    });

    const response = await request(
      "/auth/verify-otp",
      "POST",
      { phone: "+886912345678", otp: "000000" },
      { DB: db },
    ).response;

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_OTP" },
    });
    expect(db.state.statements.at(-1)).toMatchObject({
      args: [10],
    });
  });

  it("returns identical login errors for unknown identifiers and wrong passwords while hashing both paths", async () => {
    bcryptMocks.compare.mockResolvedValue(false);

    const unknown = await request(
      "/auth/login",
      "POST",
      { identifier: "missing@example.com", password: "wrong-password" },
      { DB: createDb({ first: [null] }) },
    ).response;
    const wrongPassword = await request(
      "/auth/login",
      "POST",
      { identifier: "ada@example.com", password: "wrong-password" },
      { DB: createDb({ first: [passwordIdentityRow()] }) },
    ).response;

    expect(unknown.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(await unknown.text()).toBe(await wrongPassword.text());
    expect(bcryptMocks.compare).toHaveBeenCalledTimes(2);
  });

  it("rejects unverified password identities even when the password is correct", async () => {
    const response = await request(
      "/auth/login",
      "POST",
      { identifier: "ada@example.com", password: "long-password" },
      {
        DB: createDb({
          first: [passwordIdentityRow({ verified_at_ms: null })],
        }),
      },
    ).response;

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_CREDENTIALS" },
    });
    expect(bcryptMocks.compare).toHaveBeenCalledWith(
      "long-password",
      "hash:password",
    );
  });

  it("normalizes email identifiers for password register and login", async () => {
    const registerDb = createDb({ first: [null] });

    let response = await request(
      "/auth/register",
      "POST",
      {
        identifier: " A@X.com ",
        password: "long-password",
        displayName: "Ada",
      },
      { DB: registerDb, USE_MAILCHANNELS: "false" },
    ).response;
    expect(response.status).toBe(201);
    expect(
      registerDb.state.statements.find((statement) =>
        statement.sql.includes("INSERT INTO customer_auth_identities"),
      )?.args,
    ).toEqual(expect.arrayContaining(["a@x.com"]));

    response = await request(
      "/auth/login",
      "POST",
      { identifier: "a@x.com", password: "long-password" },
      {
        DB: createDb({
          first: [passwordIdentityRow({ provider_uid: "a@x.com" })],
        }),
      },
    ).response;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { accessToken: "signed:customer:customer-1:access" },
    });

    response = await request(
      "/auth/register",
      "POST",
      {
        identifier: "A@x.com",
        password: "another-password",
        displayName: "Ada Again",
      },
      {
        DB: createDb({
          first: [passwordIdentityRow({ provider_uid: "a@x.com" })],
        }),
        USE_MAILCHANNELS: "false",
      },
    ).response;
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "IDENTITY_EXISTS" },
    });
  });

  it("dispatches a verification email carrying the token link on email register", async () => {
    const { response } = request(
      "/auth/register",
      "POST",
      {
        identifier: "ada@example.com",
        password: "long-password",
        displayName: "Ada",
      },
      { DB: createDb({ first: [null] }), CUSTOMER_APP_URL: "https://app.test" },
    );
    expect((await response).status).toBe(201);

    expect(notificationMocks.sendNotification).toHaveBeenCalledOnce();
    expect(notificationMocks.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientEmail: "ada@example.com",
        category: "email_verification",
        type: "email",
        data: expect.objectContaining({
          userName: "Ada",
          verificationLink: expect.stringContaining(
            "https://app.test/verify-email?token=",
          ),
        }),
      }),
    );
  });

  it("sends the raw token by email while storing only its hash", async () => {
    const db = createDb({ first: [null] });
    await request(
      "/auth/register",
      "POST",
      {
        identifier: "ada@example.com",
        password: "long-password",
        displayName: "Ada",
      },
      { DB: db, CUSTOMER_APP_URL: "https://app.test" },
    ).response;

    const sent = notificationMocks.sendNotification.mock.calls[0][0];
    const rawToken = decodeURIComponent(
      new URL(String(sent.data.verificationLink)).searchParams.get("token") ??
        "",
    );
    expect(rawToken.length).toBeGreaterThan(20);

    const insert = db.state.statements.find((statement) =>
      statement.sql.includes("INSERT INTO customer_verification_tokens"),
    );
    // The raw token must never reach the database.
    expect(insert?.args).not.toContain(rawToken);
    expect(insert?.args).toEqual(
      expect.arrayContaining([await sha256Hex(rawToken)]),
    );
  });

  it("fails registration with 502 when the verification email cannot be sent", async () => {
    notificationMocks.sendNotification.mockResolvedValue({
      success: false,
      errors: ["Email provider not configured"],
    });

    const { response } = request(
      "/auth/register",
      "POST",
      {
        identifier: "ada@example.com",
        password: "long-password",
        displayName: "Ada",
      },
      { DB: createDb({ first: [null] }) },
    );
    const raw = await response;

    expect(raw.status).toBe(502);
    await expect(raw.json()).resolves.toMatchObject({
      success: false,
      error: { code: "VERIFICATION_EMAIL_FAILED" },
    });
  });

  it("keeps forgot-password uniform when the reset email cannot be sent", async () => {
    notificationMocks.sendNotification.mockResolvedValue({
      success: false,
      errors: ["Email provider not configured"],
    });

    const { response } = request(
      "/auth/forgot-password",
      "POST",
      { identifier: "ada@example.com" },
      { DB: createDb({ first: [passwordIdentityRow()] }) },
    );
    const raw = await response;

    // Surfacing the failure here would reveal that the account exists.
    expect(raw.status).toBe(200);
    await expect(raw.json()).resolves.toMatchObject({
      success: true,
      data: { sent: true },
    });
    expect(notificationMocks.sendNotification).toHaveBeenCalledOnce();
  });

  it("issues an account-bound OTP for phone password resets", async () => {
    const phone = "+886912345678";
    const db = createDb({
      first: [
        passwordIdentityRow({
          customer_id: "customer-phone",
          provider_uid: phone,
        }),
      ],
    });

    const response = await request(
      "/auth/forgot-password",
      "POST",
      { identifier: phone },
      { DB: db },
    ).response;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { sent: true },
    });
    expect(
      db.state.statements.find((statement) =>
        statement.sql.includes(
          "INSERT INTO customer_phone_verification_tokens",
        ),
      )?.args,
    ).toEqual([
      "customer-phone",
      phone,
      expect.stringMatching(/^hash:\d{6}$/),
      expect.any(Number),
      expect.anything(),
      expect.any(Number),
    ]);
    expect(
      db.state.statements.some((statement) =>
        statement.sql.includes("INSERT INTO customer_verification_tokens"),
      ),
    ).toBe(false);
  });

  it("keeps phone forgot-password responses uniform once the OTP quota is spent", async () => {
    const phone = "+886912345678";
    const spentQuota = { [`customer_otp_phone:${phone}`]: "3" };
    const known = await request(
      "/auth/forgot-password",
      "POST",
      { identifier: phone },
      {
        DB: createDb({
          first: [passwordIdentityRow({ provider_uid: phone })],
        }),
        RATE_LIMIT_KV: createKv({ ...spentQuota }),
      },
    ).response;
    const unknown = await request(
      "/auth/forgot-password",
      "POST",
      { identifier: phone },
      {
        DB: createDb({ first: [null] }),
        RATE_LIMIT_KV: createKv({ ...spentQuota }),
      },
    ).response;

    expect([known.status, unknown.status]).toEqual([200, 200]);
    await expect(known.json()).resolves.toEqual(await unknown.json());
  });

  it("keeps phone forgot-password responses uniform when SMS delivery fails", async () => {
    const phone = "+886912345678";
    const env = {
      NODE_ENV: "production",
      SMS_PROVIDER: "mitake",
      MITAKE_USERNAME: "acct",
      MITAKE_PASSWORD: "secret",
      SMS_FETCH: vi.fn().mockResolvedValue(new Response("[1]\r\nstatuscode=v")),
    };
    const known = await request(
      "/auth/forgot-password",
      "POST",
      { identifier: phone },
      {
        DB: createDb({
          first: [passwordIdentityRow({ provider_uid: phone })],
        }),
        ...env,
      },
    ).response;
    const unknown = await request(
      "/auth/forgot-password",
      "POST",
      { identifier: phone },
      { DB: createDb({ first: [null] }), ...env },
    ).response;

    expect([known.status, unknown.status]).toEqual([200, 200]);
    await expect(known.json()).resolves.toEqual(await unknown.json());
  });

  // #298: production shipped for months with no working email provider and
  // every deploy green, because the routes answered 201/200 for mail that was
  // never sent. The SMS side already refuses up front; these pin the same
  // contract for email. The table walks the three env shapes that matter.
  describe.each([
    {
      description: "production with no usable email provider",
      env: { NODE_ENV: "production" },
      refuses: true,
    },
    {
      description: "production with Resend configured",
      env: { NODE_ENV: "production", RESEND_API_KEY: "resend-key" },
      refuses: false,
    },
    {
      description: "development with no usable email provider",
      env: { NODE_ENV: "development" },
      refuses: false,
    },
  ])("email channel guard: $description", ({ env, refuses }) => {
    it.each([
      {
        path: "/auth/register",
        body: {
          identifier: "ada@example.com",
          password: "long-password",
          displayName: "Ada",
        },
        okStatus: 201,
      },
      {
        path: "/auth/forgot-password",
        body: { identifier: "ada@example.com" },
        okStatus: 200,
      },
      {
        path: "/auth/resend-verification",
        body: { identifier: "ada@example.com" },
        okStatus: 200,
      },
    ])(
      refuses ? "refuses $path with 503" : "allows $path",
      async ({ path, body, okStatus }) => {
        const db = createDb({ first: [null] });

        const { response } = request(path, "POST", body, { DB: db, ...env });
        const raw = await response;

        if (refuses) {
          expect(raw.status).toBe(503);
          await expect(raw.json()).resolves.toMatchObject({
            success: false,
            error: { code: "EMAIL_CHANNEL_UNAVAILABLE" },
          });
          // The refusal precedes every write, so no half-created account and —
          // for the two silent endpoints — no lookup that could leak whether
          // the identifier exists.
          expect(db.state.statements).toHaveLength(0);
        } else {
          expect(raw.status).toBe(okStatus);
        }
      },
    );
  });

  it("keeps the production email guard independent of whether the account exists", async () => {
    // Both calls must answer identically: a guard placed after the identity
    // lookup would make /forgot-password an account-existence oracle.
    const known = await request(
      "/auth/forgot-password",
      "POST",
      { identifier: "ada@example.com" },
      {
        DB: createDb({ first: [passwordIdentityRow()] }),
        NODE_ENV: "production",
      },
    ).response;
    const unknown = await request(
      "/auth/forgot-password",
      "POST",
      { identifier: "nobody@example.com" },
      { DB: createDb({ first: [null] }), NODE_ENV: "production" },
    ).response;

    expect([known.status, unknown.status]).toEqual([503, 503]);
    await expect(known.json()).resolves.toEqual(await unknown.json());
  });

  it("still issues phone registration in production without an email provider", async () => {
    // The guard is email-only: an SMS-capable deploy must keep working.
    const response = await request(
      "/auth/register",
      "POST",
      {
        identifier: "+886912345678",
        password: "long-password",
        displayName: "Phone User",
      },
      {
        DB: createDb({ first: [null] }),
        NODE_ENV: "production",
        SMS_PROVIDER: "mitake",
        MITAKE_USERNAME: "acct",
        MITAKE_PASSWORD: "secret",
        SMS_FETCH: vi
          .fn()
          .mockResolvedValue(
            new Response("[1]\r\nmsgid=990001\r\nstatuscode=1"),
          ),
      },
    ).response;

    expect(response.status).toBe(201);
    expect(notificationMocks.sendNotification).not.toHaveBeenCalled();
  });

  it("refuses phone registration before database access when production SMS is unavailable", async () => {
    const db = createDb({ first: [null] });

    const response = await request(
      "/auth/register",
      "POST",
      {
        identifier: "+886912345678",
        password: "long-password",
        displayName: "Phone User",
      },
      { DB: db, NODE_ENV: "production" },
    ).response;

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "SMS_CHANNEL_UNAVAILABLE" },
    });
    expect(db.state.statements).toHaveLength(0);
  });

  it("skips email dispatch entirely for phone registration", async () => {
    // E.164 already: normalizeE164Phone is stubbed in this file and only
    // prefixes "+", so a local 09xxxxxxxx form would not normalize here.
    const { response } = request(
      "/auth/register",
      "POST",
      {
        identifier: "+886912345678",
        password: "long-password",
        displayName: "Ada",
      },
      { DB: createDb({ first: [null] }) },
    );

    expect((await response).status).toBe(201);
    expect(notificationMocks.sendNotification).not.toHaveBeenCalled();
  });

  it("deletes the newly created customer when identity registration hits a unique constraint", async () => {
    const db = createDb({
      first: [null],
      run: [
        { meta: { changes: 1 } },
        new Error("D1_ERROR: UNIQUE constraint failed"),
        { meta: { changes: 1 } },
      ],
    });

    const response = await request(
      "/auth/register",
      "POST",
      {
        identifier: "ada@example.com",
        password: "long-password",
        displayName: "Ada",
      },
      { DB: db, USE_MAILCHANNELS: "false" },
    ).response;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "IDENTITY_EXISTS" },
    });
    expect(
      db.state.statements.find((statement) =>
        statement.sql.includes("DELETE FROM customers"),
      )?.args,
    ).toEqual(["uuid-1"]);
  });

  it("updates password identity last-used using the identity id on login", async () => {
    const db = createDb({
      first: [
        passwordIdentityRow({ id: "customer-1", identity_id: "ident-9" }),
      ],
    });

    const response = await request(
      "/auth/login",
      "POST",
      { identifier: "ada@example.com", password: "long-password" },
      { DB: db },
    ).response;

    expect(response.status).toBe(200);
    expect(
      db.state.statements.find((statement) =>
        statement.sql.includes("SET last_used_at_ms"),
      )?.args,
    ).toEqual([expect.any(Number), expect.any(Number), "ident-9"]);
  });

  it("starts the OTP flow for phone password registration", async () => {
    utilMocks.generateUUID
      .mockReturnValueOnce("customer-phone")
      .mockReturnValueOnce("identity-phone");
    const db = createDb({ first: [null] });
    const rateLimitKv = createKv();

    const response = await request(
      "/auth/register",
      "POST",
      {
        identifier: "+886912345678",
        password: "long-password",
        displayName: "Phone User",
      },
      { DB: db, RATE_LIMIT_KV: rateLimitKv },
    ).response;
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      success: true,
      data: {
        verificationRequired: true,
        verificationMethod: "phone",
      },
    });
    expect(
      db.state.statements.find((statement) =>
        statement.sql.includes(
          "INSERT INTO customer_phone_verification_tokens",
        ),
      )?.args,
    ).toEqual([
      "customer-phone",
      "+886912345678",
      expect.stringMatching(/^hash:/),
      expect.any(Number),
      "203.0.113.10",
      expect.any(Number),
    ]);
  });

  it("issues a new OTP when resending verification for a pending phone identity", async () => {
    const db = createDb({
      first: [
        passwordIdentityRow({
          provider_uid: "+886912345678",
          verified_at_ms: null,
        }),
      ],
    });

    const response = await request(
      "/auth/resend-verification",
      "POST",
      { identifier: "+886912345678" },
      { DB: db },
    ).response;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { sent: true },
    });
    expect(
      db.state.statements.find((statement) =>
        statement.sql.includes(
          "INSERT INTO customer_phone_verification_tokens",
        ),
      )?.args,
    ).toEqual([
      "customer-1",
      "+886912345678",
      expect.stringMatching(/^hash:/),
      expect.any(Number),
      "203.0.113.10",
      expect.any(Number),
    ]);
  });

  it("refuses phone resend before identity lookup when production SMS is unavailable", async () => {
    const db = createDb({ first: [null] });

    const response = await request(
      "/auth/resend-verification",
      "POST",
      { identifier: "+886912345678" },
      { DB: db, NODE_ENV: "production" },
    ).response;

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "SMS_CHANNEL_UNAVAILABLE" },
    });
    expect(db.state.statements).toHaveLength(0);
  });

  it("keeps phone resend responses uniform when SMS delivery fails", async () => {
    const smsFetch = vi
      .fn()
      .mockResolvedValue(new Response("[1]\r\nstatuscode=v"));
    const env = {
      NODE_ENV: "production",
      SMS_PROVIDER: "mitake",
      MITAKE_USERNAME: "acct",
      MITAKE_PASSWORD: "secret",
      SMS_FETCH: smsFetch,
    };
    const knownDb = createDb({
      first: [
        passwordIdentityRow({
          provider_uid: "+886912345678",
          verified_at_ms: null,
        }),
      ],
    });

    const known = await request(
      "/auth/resend-verification",
      "POST",
      { identifier: "+886912345678" },
      { DB: knownDb, ...env },
    ).response;
    const unknown = await request(
      "/auth/resend-verification",
      "POST",
      { identifier: "+886900000000" },
      { DB: createDb({ first: [null] }), ...env },
    ).response;

    expect([known.status, unknown.status]).toEqual([200, 200]);
    await expect(known.json()).resolves.toEqual(await unknown.json());
    expect(
      knownDb.state.statements.some((statement) =>
        statement.sql.includes(
          "INSERT INTO customer_phone_verification_tokens",
        ),
      ),
    ).toBe(true);
  });

  it("keeps phone resend responses uniform once the OTP quota is spent", async () => {
    const phone = "+886912345678";
    // enforceOtpRateLimit allows 3 per phone per hour while this endpoint's own
    // identifier quota is 5, so requests 4 and 5 are the window where a pending
    // identity would answer differently from a number nobody has registered.
    const spentQuota = { [`customer_otp_phone:${phone}`]: "3" };
    const knownDb = createDb({
      first: [
        passwordIdentityRow({ provider_uid: phone, verified_at_ms: null }),
      ],
    });

    const known = await request(
      "/auth/resend-verification",
      "POST",
      { identifier: phone },
      { DB: knownDb, RATE_LIMIT_KV: createKv({ ...spentQuota }) },
    ).response;
    const unknown = await request(
      "/auth/resend-verification",
      "POST",
      { identifier: phone },
      {
        DB: createDb({ first: [null] }),
        RATE_LIMIT_KV: createKv({ ...spentQuota }),
      },
    ).response;

    expect([known.status, unknown.status]).toEqual([200, 200]);
    await expect(known.json()).resolves.toEqual(await unknown.json());
    // The quota is checked before the insert, so nothing is written -- the
    // point is that the refusal stays invisible, not that it stops applying.
    expect(
      knownDb.state.statements.some((statement) =>
        statement.sql.includes(
          "INSERT INTO customer_phone_verification_tokens",
        ),
      ),
    ).toBe(false);
  });

  it("marks pending phone password identities verified after OTP verification", async () => {
    const db = createDb({
      first: [
        { id: 10, otp_code: "hash:123456", attempts: 0 },
        passwordIdentityRow({
          identity_id: "identity-phone",
          customer_id: "customer-phone",
          provider_uid: "+886912345678",
          verified_at_ms: null,
          primary_phone: null,
        }),
      ],
    });

    const response = await request(
      "/auth/verify-otp",
      "POST",
      { phone: "+886912345678", otp: "123456" },
      { DB: db },
    ).response;

    expect(response.status).toBe(200);
    expect(
      db.state.statements.find((statement) =>
        statement.sql.includes("SET verified_at_ms"),
      )?.args,
    ).toEqual([expect.any(Number), expect.any(Number), "identity-phone"]);
    expect(
      db.state.statements.find((statement) =>
        statement.sql.includes("SET primary_phone"),
      )?.args,
    ).toEqual(["+886912345678", expect.any(Number), "customer-phone"]);
  });

  it("exchanges an account-bound phone OTP for a one-time reset token", async () => {
    const phone = "+886912345678";
    const db = createDb({
      first: [
        {
          id: 10,
          customer_id: "customer-phone",
          otp_code: "hash:123456",
          attempts: 0,
        },
        passwordIdentityRow({
          customer_id: "customer-phone",
          provider_uid: phone,
        }),
      ],
    });

    const response = await request(
      "/auth/verify-otp",
      "POST",
      { phone, otp: "123456", purpose: "password_reset" },
      { DB: db },
    ).response;
    const body = (await response.json()) as {
      success: boolean;
      data: { resetToken: string };
    };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.resetToken.length).toBeGreaterThan(20);
    const insert = db.state.statements.find((statement) =>
      statement.sql.includes("INSERT INTO customer_verification_tokens"),
    );
    expect(insert?.args).toEqual(
      expect.arrayContaining([
        "customer-phone",
        "password_reset",
        phone,
        await sha256Hex(body.data.resetToken),
      ]),
    );
    expect(insert?.args).not.toContain(body.data.resetToken);
  });

  it("returns success for forgot-password when the identifier does not exist", async () => {
    const response = await request(
      "/auth/forgot-password",
      "POST",
      { identifier: "missing@example.com" },
      { DB: createDb({ first: [null] }), USE_MAILCHANNELS: "false" },
    ).response;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { sent: true },
    });
  });

  it("uses customer reset tokens once, rejects expired tokens, and revokes existing refresh records", async () => {
    const tokenHash = await sha256Hex("reset-token-value-0001");
    const tokenKv = createKv({
      "customer_refresh:customer-1:old-1": "1",
      "customer_refresh:customer-2:other": "1",
    });
    const db = createDb({
      first: [
        {
          id: "token-1",
          customer_id: "customer-1",
          purpose: "password_reset",
          identifier: "ada@example.com",
          expires_at_ms: Date.now() + 60_000,
          used_at_ms: null,
        },
      ],
    });

    let response = await request(
      "/auth/reset-password",
      "POST",
      { token: "reset-token-value-0001", newPassword: "new-long-password" },
      { DB: db, TOKEN_BLACKLIST: tokenKv },
    ).response;
    expect(response.status).toBe(200);
    expect(
      db.state.statements.find((statement) =>
        statement.sql.includes("FROM customer_verification_tokens"),
      )?.args,
    ).toEqual([tokenHash, "password_reset"]);
    expect(tokenKv.list).toHaveBeenCalledWith({
      prefix: "customer_refresh:customer-1:",
      cursor: undefined,
    });
    expect(tokenKv.get).not.toHaveBeenCalled();
    expect(tokenKv.delete).toHaveBeenCalledWith(
      "customer_refresh:customer-1:old-1",
    );
    expect(tokenKv.delete).not.toHaveBeenCalledWith(
      "customer_refresh:customer-2:other",
    );

    response = await request(
      "/auth/reset-password",
      "POST",
      { token: "reset-token-value-0001", newPassword: "new-long-password" },
      {
        DB: createDb({
          first: [
            {
              id: "token-1",
              customer_id: "customer-1",
              purpose: "password_reset",
              identifier: "ada@example.com",
              expires_at_ms: Date.now() + 60_000,
              used_at_ms: Date.now(),
            },
          ],
        }),
      },
    ).response;
    expect(response.status).toBe(401);

    response = await request(
      "/auth/reset-password",
      "POST",
      { token: "reset-token-value-0002", newPassword: "new-long-password" },
      {
        DB: createDb({
          first: [
            {
              id: "token-2",
              customer_id: "customer-1",
              purpose: "password_reset",
              identifier: "ada@example.com",
              expires_at_ms: Date.now() - 1,
              used_at_ms: null,
            },
          ],
        }),
      },
    ).response;
    expect(response.status).toBe(401);
  });

  it("verifies email tokens once and promotes primary_email after verification", async () => {
    const tokenHash = await sha256Hex("verify-token-value-0001");
    const db = createDb({
      first: [
        {
          id: "token-1",
          customer_id: "customer-1",
          purpose: "email_verify",
          identifier: "ada@example.com",
          expires_at_ms: Date.now() + 60_000,
          used_at_ms: null,
        },
      ],
    });

    const response = await request(
      "/auth/verify-email",
      "POST",
      { token: "verify-token-value-0001" },
      { DB: db },
    ).response;

    expect(response.status).toBe(200);
    expect(
      db.state.statements.find((statement) =>
        statement.sql.includes("FROM customer_verification_tokens"),
      )?.args,
    ).toEqual([tokenHash, "email_verify"]);
    expect(
      db.state.statements.find((statement) =>
        statement.sql.includes("SET primary_email"),
      )?.args,
    ).toEqual(["ada@example.com", expect.any(Number), "customer-1"]);
  });

  it("returns 409 when email verification would claim an email already used by another customer", async () => {
    const db = createDb({
      first: [
        {
          id: "token-1",
          customer_id: "customer-1",
          purpose: "email_verify",
          identifier: "ada@example.com",
          expires_at_ms: Date.now() + 60_000,
          used_at_ms: null,
        },
      ],
      run: [
        new Error(
          "D1_ERROR: UNIQUE constraint failed: customers.primary_email",
        ),
      ],
    });

    const response = await request(
      "/auth/verify-email",
      "POST",
      { token: "verify-token-value-0001" },
      { DB: db },
    ).response;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "IDENTITY_EXISTS" },
    });
    expect(
      db.state.statements.filter((statement) =>
        statement.sql.includes("SET verified_at_ms"),
      ),
    ).toHaveLength(0);
  });

  it("refreshes and logs out customer sessions", async () => {
    const tokenKv = createKv({
      "customer_refresh:customer-1:refresh-1": "1",
    });
    const db = createDb({ first: [customerRow()] });

    let response = await request(
      "/auth/refresh",
      "POST",
      undefined,
      { DB: db, TOKEN_BLACKLIST: tokenKv },
      { Cookie: "__Host-mm_customer_refresh=refresh-token-value-12345" },
    ).response;
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toHaveLength(1);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { accessToken: "signed:customer:customer-1:access" },
    });
    expect(tokenKv.delete).toHaveBeenCalledWith(
      "customer_refresh:customer-1:refresh-1",
    );

    response = await request(
      "/auth/logout",
      "POST",
      undefined,
      { TOKEN_BLACKLIST: tokenKv },
      { Cookie: "__Host-mm_customer_refresh=refresh-token-value-12345" },
    ).response;
    expect(response.status).toBe(200);
    expect(tokenKv.put).toHaveBeenCalledWith(
      "token:access-token",
      "blacklisted",
      {
        expirationTtl: 15 * 60,
      },
    );
  });

  it("clears the refresh cookie when a rotated refresh token belongs to an inactive customer", async () => {
    const tokenKv = createKv({
      "customer_refresh:customer-1:refresh-1": "1",
    });
    const db = createDb({ first: [null] });

    const response = await request(
      "/auth/refresh",
      "POST",
      undefined,
      { DB: db, TOKEN_BLACKLIST: tokenKv },
      { Cookie: "__Host-mm_customer_refresh=refresh-token-value-12345" },
    ).response;

    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie()).toHaveLength(1);
    expect(response.headers.getSetCookie()[0]).toContain(
      "__Host-mm_customer_refresh=;",
    );
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "CUSTOMER_INACTIVE" },
    });
    expect(tokenKv.delete).toHaveBeenCalledWith(
      "customer_refresh:customer-1:refresh-1",
    );
  });

  it("reads and updates customer profile and preferences", async () => {
    const db = createDb({
      first: [
        customerRow(),
        {
          dietary_tags: '["vegetarian"]',
          allergens: "not-json",
          default_party_size: 4,
          marketing_opt_in: 1,
          waiting_list_opt_in: 0,
          promo_from_favorites_opt_in: 1,
          quiet_hours_start: "22:00",
          quiet_hours_end: "08:00",
          updated_at_ms: 1,
        },
        customerRow({ display_name: "Updated" }),
        null,
        {
          dietary_tags: '["vegetarian"]',
          allergens: "[]",
          waiting_list_opt_in: 1,
        },
      ],
    });

    let response = await request("/me", "GET", undefined, { DB: db }).response;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        customer: { displayName: "Customer One" },
        preferences: {
          dietaryTags: ["vegetarian"],
          allergens: [],
          defaultPartySize: 4,
          marketingOptIn: true,
          waitingListOptIn: false,
        },
      },
    });

    response = await request(
      "/me",
      "PATCH",
      {
        displayName: "Updated",
        avatarUrl: null,
        locale: "en-US",
      },
      { DB: db },
    ).response;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { customer: { displayName: "Updated" } },
    });

    response = await request(
      "/preferences",
      "PATCH",
      { dietaryTags: ["halal"], defaultPartySize: 2, waitingListOptIn: false },
      { DB: db },
    ).response;
    expect(response.status).toBe(200);
    expect(
      db.state.statements.find((statement) =>
        statement.sql.includes("INSERT INTO customer_preferences"),
      )?.args,
    ).toEqual([
      "customer-1",
      '["halal"]',
      "[]",
      2,
      0,
      0,
      0,
      null,
      null,
      expect.any(Number),
    ]);
  });

  // #297: production is not uniformly STRICT, so a TEXT value already sitting
  // in the INTEGER `default_party_size` column reads back as a string. This
  // PATCH is a read-modify-write, so without a coercion at the bind site the
  // string is written straight back — and the D1 bind signature takes
  // `unknown[]`, so neither TypeScript nor the database objects.
  it("re-binds default_party_size as an integer when the stored row holds a string", async () => {
    const storedRow = {
      dietary_tags: "[]",
      allergens: "[]",
      // What a non-STRICT production row hands back.
      default_party_size: "8",
      marketing_opt_in: 0,
      waiting_list_opt_in: 1,
      promo_from_favorites_opt_in: 0,
      quiet_hours_start: null,
      quiet_hours_end: null,
      updated_at_ms: 1,
    };
    const db = createDb({ first: [storedRow, storedRow] });

    const response = await request(
      "/preferences",
      "PATCH",
      { dietaryTags: ["halal"] },
      { DB: db },
    ).response;

    expect(response.status).toBe(200);
    const args = db.state.statements.find((statement) =>
      statement.sql.includes("INSERT INTO customer_preferences"),
    )?.args;
    expect(args?.[3]).toBe(8);
    expect(typeof args?.[3]).toBe("number");
  });

  it("drops an unparsable stored default_party_size instead of writing it back", async () => {
    const storedRow = {
      dietary_tags: "[]",
      allergens: "[]",
      default_party_size: "not-a-number",
      marketing_opt_in: 0,
      waiting_list_opt_in: 1,
      promo_from_favorites_opt_in: 0,
      quiet_hours_start: null,
      quiet_hours_end: null,
      updated_at_ms: 1,
    };
    const db = createDb({ first: [storedRow, storedRow] });

    await request("/preferences", "PATCH", { dietaryTags: [] }, { DB: db })
      .response;

    expect(
      db.state.statements.find((statement) =>
        statement.sql.includes("INSERT INTO customer_preferences"),
      )?.args?.[3],
    ).toBeNull();
  });

  it("manages favorites with target validation and duplicate reuse", async () => {
    const db = createDb({
      first: [
        { id: "restaurant-1" },
        null,
        { id: 7, target_type: "restaurant", target_id: "restaurant-1" },
        { id: 7, target_type: "restaurant", target_id: "restaurant-1" },
      ],
      all: [
        {
          results: [
            {
              id: 7,
              target_type: "restaurant",
              target_id: "restaurant-1",
              created_at_ms: 1,
            },
          ],
        },
      ],
    });

    let response = await request(
      "/favorites?targetType=restaurant",
      "GET",
      undefined,
      { DB: db },
    ).response;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 7, targetType: "restaurant" }],
    });

    response = await request(
      "/favorites",
      "POST",
      { targetType: "restaurant", targetId: "restaurant-1" },
      { DB: db },
    ).response;
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: 7, targetType: "restaurant" },
    });

    response = await request("/favorites/7", "DELETE", undefined, { DB: db })
      .response;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { deleted: true },
    });
  });

  it("tracks recent markets and rejects missing market support", async () => {
    const db = createDb({
      first: [
        { name: "markets" },
        { id: "market-1" },
        { market_id: "market-1", visited_at_ms: 123 },
      ],
      all: [{ results: [{ market_id: "market-1", visited_at_ms: 123 }] }],
    });

    let response = await request("/recent-markets?limit=3", "GET", undefined, {
      DB: db,
    }).response;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ marketId: "market-1", visitedAtMs: 123 }],
    });

    response = await request(
      "/recent-markets",
      "POST",
      { marketId: "market-1", visitedAtMs: 123 },
      { DB: db },
    ).response;
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: { marketId: "market-1", visitedAtMs: 123 },
    });

    const missingMarketDb = createDb({ first: [null] });
    response = await request(
      "/recent-markets",
      "POST",
      { marketId: "market-2" },
      { DB: missingMarketDb },
    ).response;
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "TARGET_NOT_FOUND" },
    });
  });

  it("manages push subscriptions and prunes stale subscriptions", async () => {
    const db = createDb({
      all: [
        {
          results: [
            {
              id: "sub-1",
              endpoint: "https://push.example.test/1",
              device_label: "Phone",
            },
          ],
        },
      ],
      first: [
        {
          id: "uuid-1",
          endpoint: "https://push.example.test/1?x=1&amp;y=2",
          device_label: "Phone",
          created_at_ms: 1,
        },
      ],
      run: [
        { meta: { changes: 1 } },
        { meta: { changes: 1 } },
        { meta: { changes: 4 } },
      ],
    });

    let response = await request("/push-subscriptions", "GET", undefined, {
      DB: db,
    }).response;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: "sub-1" }],
    });

    response = await request(
      "/push-subscriptions",
      "POST",
      {
        endpoint: "https://push.example.test/1?x=1&amp;y=2",
        p256dh: "key",
        auth: "auth",
        deviceLabel: "Phone",
      },
      { DB: db },
    ).response;
    expect(response.status).toBe(201);
    expect(db.state.statements.at(-1)?.args).toContain(
      "https://push.example.test/1?x=1&y=2",
    );

    response = await request("/push-subscriptions/sub-1", "DELETE", undefined, {
      DB: db,
    }).response;
    expect(response.status).toBe(200);

    await expect(
      pruneStaleCustomerPushSubscriptions({ DB: db } as never, 1_800_000),
    ).resolves.toEqual({ deleted: 4 });
  });

  it("lists, creates, reuses, and revokes customer consents", async () => {
    const db = createDb({
      all: [
        {
          results: [
            {
              id: "consent-1",
              consent_type: "marketing",
              version: "2026-05-25-v1",
              granted: 1,
            },
          ],
        },
      ],
      first: [null, { id: "consent-2" }],
    });

    let response = await request("/consents", "GET", undefined, { DB: db })
      .response;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: "consent-1", consent_type: "marketing" }],
    });

    response = await request(
      "/consents",
      "POST",
      {
        consentType: "marketing",
        version: "2026-05-25-v1",
        granted: true,
        source: "onboarding",
      },
      { DB: db },
    ).response;
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: "uuid-1" },
    });

    response = await request(
      "/consents",
      "POST",
      {
        consentType: "marketing",
        version: "2026-05-25-v1",
        granted: false,
      },
      { DB: db },
    ).response;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: "consent-2" },
    });
  });
});
