/**
 * Public onboarding routes must not reveal whether an email has applied, the
 * database must hold one application in review per email, and applicant mail
 * goes out in the applicant's language. Runs the real routes and migrations
 * against SQLite; only the email binding is faked, to capture what was sent.
 */
import {
  MANAGEMENT_ADMIN_ID,
  MANAGEMENT_SESSION_ID,
  seedManagementAdmin,
} from "../management-auth-fixture";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { sign } from "hono/jwt";
import { afterEach, describe, expect, it, vi } from "vitest";
import { D1DatabaseAdapter } from "../../../../../tests/helpers/d1-adapter";
import app from "../../index";
import type { ManagementEnv } from "../../types";
import { readData, readError } from "../helpers/read-json";

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../migrations",
);

function createManagementDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = OFF");
  for (const file of fs.readdirSync(migrationsDir).sort()) {
    if (file.endsWith(".sql")) {
      sqlite.exec(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
    }
  }
  return new D1DatabaseAdapter(sqlite);
}

/** Only the operator's session lives here; no test provisions a shop. */
function createPlatformDb() {
  const sqlite = new Database(":memory:");
  seedManagementAdmin(sqlite);
  return new D1DatabaseAdapter(sqlite);
}

interface SentEmail {
  to: string;
  subject: string;
  text: string;
}

function createEnv(
  db: D1DatabaseAdapter,
  options: { emailEnabled?: boolean; send?: (m: SentEmail) => unknown } = {},
) {
  const sent: SentEmail[] = [];
  const send = vi.fn(async (message: SentEmail) => {
    sent.push(message);
    return options.send?.(message);
  });
  const env: ManagementEnv = {
    NODE_ENV: "test",
    API_VERSION: "v1",
    API_BASE_URL: "http://localhost",
    CORS_ORIGIN: "http://localhost:3011",
    ONBOARDING_APP_URL: "http://localhost:3011",
    LOG_LEVEL: "error",
    JWT_SECRET: "test-secret",
    CF_API_TOKEN: "test-token",
    CF_ACCOUNT_ID: "test-account",
    MANAGEMENT_DB: db as unknown as D1Database,
    PLATFORM_DB: createPlatformDb() as unknown as D1Database,
    CACHE_KV: {} as KVNamespace,
    DEPLOYMENT_STATUS_KV: {} as KVNamespace,
    BUNDLE_STORAGE: {} as R2Bucket,
    ONBOARDING_EMAIL_FROM: "onboarding@makanmasak.test",
    ONBOARDING_NOTIFICATION_EMAIL: { send } as unknown as SendEmail,
    ...(options.emailEnabled === false
      ? {}
      : { ONBOARDING_EMAIL_ENABLED: "true" }),
  };
  return { env, sent, send };
}

function applicationBody(overrides: Record<string, unknown> = {}) {
  return {
    businessName: "Privacy Laksa",
    contactName: "Tan Mei",
    contactEmail: "tan.mei@example.com",
    contactPhone: "0123456789",
    address: "12 Jalan Tun Sambanthan",
    district: "Brickfields",
    city: "Kuala Lumpur",
    countryCode: "MY",
    planId: "standard",
    latitude: 3.134,
    longitude: 101.686,
    ...overrides,
  };
}

function post(path: string, body: unknown, env: ManagementEnv, ip = "") {
  return app.fetch(
    new Request(`https://management.test/api/v1${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Each test gets its own limiter bucket unless it asks for one.
        "cf-connecting-ip":
          ip || `198.51.100.${Math.floor(Math.random() * 250)}`,
      },
      body: JSON.stringify(body),
    }),
    env,
  );
}

const submit = (env: ManagementEnv, overrides = {}, ip?: string) =>
  post("/onboarding/applications", applicationBody(overrides), env, ip);

const requestLink = (env: ManagementEnv, email: string, ip?: string) =>
  post("/onboarding/applications/status-link", { email }, env, ip);

async function operatorRequest(
  env: ManagementEnv,
  pathname: string,
  body: unknown,
) {
  const token = await sign(
    {
      id: MANAGEMENT_ADMIN_ID,
      email: "privacy-admin@example.test",
      role: "admin",
      tv: 1,
      sid: MANAGEMENT_SESSION_ID,
      aud: "management",
      iss: "makanmakan-management",
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    "test-secret",
    "HS256",
  );
  return app.fetch(
    new Request(`https://management.test/api/v1/admin/onboarding${pathname}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    }),
    env,
  );
}

function rows(db: D1DatabaseAdapter) {
  return db
    .raw()
    .prepare(
      `SELECT id, status, locale, application_secret_hash, updated_at,
              status_link_sent_at_ms
       FROM onboarding_applications ORDER BY created_at`,
    )
    .all() as Array<{
    id: string;
    status: string;
    locale: string | null;
    application_secret_hash: string;
    updated_at: string;
    status_link_sent_at_ms: number | null;
  }>;
}

/** Moves every application past the status-link cooldown. */
function expireCooldown(db: D1DatabaseAdapter) {
  db.raw()
    .prepare("UPDATE onboarding_applications SET status_link_sent_at_ms = ?")
    .run(Date.now() - 16 * 60 * 1000);
}

function linkIn(email: SentEmail) {
  const match = /http:\/\/localhost:3011\/status\/([^#\s]+)#(\S+)/.exec(
    email.text,
  );
  if (!match) throw new Error(`no status link in: ${email.text}`);
  return {
    applicationId: decodeURIComponent(match[1]!),
    secret: decodeURIComponent(match[2]!),
  };
}

function readStatus(env: ManagementEnv, applicationId: string, secret: string) {
  return app.fetch(
    new Request(
      `https://management.test/api/v1/onboarding/applications/${applicationId}`,
      { headers: { "X-Onboarding-Secret": secret } },
    ),
    env,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("one application in review per email — real integration", () => {
  it("keeps one row when the same email submits twice at once, in any case", async () => {
    const db = createManagementDb();
    const { env } = createEnv(db, { emailEnabled: false });

    const responses = await Promise.all([
      submit(env),
      submit(env, { contactEmail: "TAN.MEI@example.com" }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([202, 202]);
    expect(rows(db)).toHaveLength(1);
  });

  it("refuses the operator route with 409 once the database holds a pending one", async () => {
    const db = createManagementDb();
    const { env } = createEnv(db, { emailEnabled: false });
    await submit(env);

    const response = await operatorRequest(env, "/applications", {
      ...applicationBody({ contactEmail: "Tan.Mei@Example.com" }),
      approveImmediately: false,
    });

    expect(response.status).toBe(409);
    await expect(readError(response)).resolves.toMatchObject({
      code: "APPLICATION_ALREADY_PENDING",
    });
    expect(rows(db)).toHaveLength(1);
  });

  it("lets the email apply again once the earlier application is rejected", async () => {
    const db = createManagementDb();
    const { env } = createEnv(db, { emailEnabled: false });
    const first = await readData<{ applicationId: string }>(await submit(env));
    const rejected = await operatorRequest(
      env,
      `/applications/${first.applicationId}/reject`,
      { reason: "Incomplete address" },
    );
    expect(rejected.status).toBe(200);

    const second = await submit(env);

    expect(second.status).toBe(202);
    expect(rows(db).map((row) => row.status)).toEqual([
      "rejected",
      "submitted",
    ]);
  });
});

describe("public application privacy — real integration", () => {
  it("answers fresh and duplicate submissions identically and mails the link instead", async () => {
    const db = createManagementDb();
    const { env, sent } = createEnv(db);

    const fresh = await submit(env, { locale: "vi-VN" });
    const [received] = sent.splice(0);
    const before = rows(db)[0]!;
    expireCooldown(db);
    const duplicate = await submit(env, {
      businessName: "Someone Else",
      contactEmail: "TAN.MEI@example.com",
    });

    expect(fresh.status).toBe(202);
    expect(duplicate.status).toBe(202);
    const body = { success: true, data: { status: "received" } };
    await expect(fresh.json()).resolves.toEqual(body);
    await expect(duplicate.json()).resolves.toEqual(body);

    // No new row, and the application on file is untouched but for its secret.
    const after = rows(db);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      id: before.id,
      status: "submitted",
      locale: "vi-VN",
      updated_at: before.updated_at,
    });
    expect(after[0]!.application_secret_hash).not.toBe(
      before.application_secret_hash,
    );

    // Both emails are in the applicant's language and carry a working link;
    // the duplicate's rotation retired the first one.
    expect(received!.subject).toContain("đã nhận đơn đăng ký");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("tan.mei@example.com");
    expect(sent[0]!.subject).toContain("Privacy Laksa");
    expect(sent[0]!.subject).toContain("vẫn đang được xem xét");
    const oldLink = linkIn(received!);
    const newLink = linkIn(sent[0]!);
    expect(newLink.applicationId).toBe(before.id);
    expect(
      (await readStatus(env, oldLink.applicationId, oldLink.secret)).status,
    ).toBe(401);
    expect(
      (await readStatus(env, newLink.applicationId, newLink.secret)).status,
    ).toBe(200);
  });

  it("mails a status link at most once per cooldown and still answers 202", async () => {
    const db = createManagementDb();
    const { env, sent } = createEnv(db);
    await submit(env);
    sent.splice(0);

    // Inside the cooldown the received email already started.
    expect((await submit(env)).status).toBe(202);
    expect((await requestLink(env, "tan.mei@example.com")).status).toBe(202);
    expect(sent).toHaveLength(0);

    expireCooldown(db);
    await Promise.all([
      requestLink(env, "tan.mei@example.com"),
      requestLink(env, "tan.mei@example.com"),
    ]);
    expect(sent).toHaveLength(1);
  });

  it("recovers the newest non-rejected application, completed included", async () => {
    const db = createManagementDb();
    const { env, sent } = createEnv(db);
    await submit(env, { locale: "en-US" });
    const [pending] = rows(db);
    db.raw()
      .prepare(
        "UPDATE onboarding_applications SET status = 'completed' WHERE id = ?",
      )
      .run(pending!.id);
    expireCooldown(db);
    sent.splice(0);

    const response = await requestLink(env, "Tan.Mei@example.com");

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { status: "received" },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe(
      "Your MakanMasak status link for Privacy Laksa",
    );
    const link = linkIn(sent[0]!);
    expect(link.applicationId).toBe(pending!.id);
    expect(
      (await readStatus(env, link.applicationId, link.secret)).status,
    ).toBe(200);
  });

  it("sends nothing for an unknown or only-rejected email, with the same 202", async () => {
    const db = createManagementDb();
    const { env, sent } = createEnv(db);
    await submit(env);
    db.raw()
      .prepare("UPDATE onboarding_applications SET status = 'rejected'")
      .run();
    expireCooldown(db);
    sent.splice(0);

    const unknown = await requestLink(env, "nobody@example.com");
    const rejected = await requestLink(env, "tan.mei@example.com");

    for (const response of [unknown, rejected]) {
      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toEqual({
        success: true,
        data: { status: "received" },
      });
    }
    expect(sent).toHaveLength(0);
  });

  it("rate limits status-link requests per IP in their own bucket", async () => {
    const db = createManagementDb();
    const { env } = createEnv(db);

    const statuses: number[] = [];
    for (let index = 0; index < 6; index++) {
      statuses.push(
        (await requestLink(env, `nobody-${index}@example.com`, "203.0.113.5"))
          .status,
      );
    }
    const submission = await submit(env, {}, "203.0.113.5");

    expect(statuses).toEqual([202, 202, 202, 202, 202, 429]);
    expect(submission.status).toBe(202);
  });

  it("keeps applicant addresses out of the logs, even from a failing provider", async () => {
    const db = createManagementDb();
    const { env } = createEnv(db, {
      send: (message) => {
        throw new Error(`mailbox unavailable: ${message.to}`);
      },
    });
    const logged: unknown[] = [];
    for (const level of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, level).mockImplementation((...args) => {
        logged.push(...args);
      });
    }

    await submit(env);
    expireCooldown(db);
    await submit(env);
    expireCooldown(db);
    await requestLink(env, "tan.mei@example.com");

    expect(logged.length).toBeGreaterThan(0);
    expect(JSON.stringify(logged.map(String))).not.toContain(
      "tan.mei@example.com",
    );
  });

  it("returns the status link in the response only while email is off", async () => {
    const db = createManagementDb();
    const { env, sent } = createEnv(db, { emailEnabled: false });

    const response = await submit(env);
    const data = await readData<{
      status: string;
      applicationId: string;
      applicationSecret: string;
      assignedSubdomain: string;
    }>(response);

    expect(response.status).toBe(202);
    expect(data).toMatchObject({
      status: "received",
      applicationId: rows(db)[0]!.id,
      assignedSubdomain: expect.stringMatching(/^privacy-laksa-/),
    });
    expect(
      (await readStatus(env, data.applicationId, data.applicationSecret))
        .status,
    ).toBe(200);
    expect(sent).toHaveLength(0);
  });
});

describe("applicant email language — real integration", () => {
  it("writes to an operator-created applicant in the chosen language", async () => {
    const db = createManagementDb();
    const { env, sent } = createEnv(db);
    const created = await operatorRequest(env, "/applications", {
      ...applicationBody({ locale: "ms-MY" }),
      approveImmediately: false,
    });
    const { application } = await readData<{ application: { id: string } }>(
      created,
    );

    await operatorRequest(env, `/applications/${application.id}/reject`, {
      reason: "Alamat tidak lengkap",
    });

    expect(rows(db)[0]!.locale).toBe("ms-MY");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe(
      "Keputusan permohonan MakanMasak untuk Privacy Laksa",
    );
    expect(sent[0]!.text).toContain("Sebab: Alamat tidak lengkap");
  });

  it("falls back to zh-TW for an application without a locale", async () => {
    const db = createManagementDb();
    const { env, sent } = createEnv(db);
    await submit(env);
    sent.splice(0);
    const [legacy] = rows(db);
    expect(legacy!.locale).toBeNull();

    await operatorRequest(env, `/applications/${legacy!.id}/reject`, {
      reason: "地址不完整",
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe("MakanMasak「Privacy Laksa」申請結果");
  });
});
