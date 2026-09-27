import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SendEmail } from "@cloudflare/workers-types";
import type { Env } from "../../../types/env";
import {
  BILLING_NOTIFICATION_KINDS,
  BillingNotificationService,
  NOTIFICATION_CHANNELS,
} from "./BillingNotificationService";
import { NOTIFICATION_DISPATCH_STATUSES } from "@makanmasak/database";

vi.mock("@makanmasak/utils", () => ({
  generateUUID: vi.fn(() => "notification-id"),
}));

interface PreparedStatement {
  sql: string;
  values: unknown[];
  bind: ReturnType<typeof vi.fn>;
  first: ReturnType<typeof vi.fn>;
  run: ReturnType<typeof vi.fn>;
}

function createDb(options: { duplicate?: boolean } = {}) {
  const statements: PreparedStatement[] = [];
  const db = {
    prepare: vi.fn((sql: string) => {
      const statement: PreparedStatement = {
        sql,
        values: [],
        bind: vi.fn((...values: unknown[]) => {
          statement.values = values;
          return statement;
        }),
        first: vi.fn(async () =>
          sql.includes("SELECT id") && options.duplicate
            ? { id: "existing-dispatch" }
            : null,
        ),
        run: vi.fn(async () => ({ success: true })),
      };
      statements.push(statement);
      return statement;
    }),
  };
  return { db, statements };
}

function env(overrides: Partial<Env> = {}) {
  return {
    DB: createDb().db,
    CACHE_KV: {},
    ...overrides,
  } as Env;
}

function input(
  overrides: Partial<Parameters<BillingNotificationService["send"]>[0]> = {},
): Parameters<BillingNotificationService["send"]>[0] {
  return {
    restaurantId: "restaurant-1",
    kind: BILLING_NOTIFICATION_KINDS.TRIAL_1D,
    dedupKey: "trial_1d:restaurant-1:1780848000000",
    channel: NOTIFICATION_CHANNELS.EMAIL,
    recipient: "owner@example.test",
    subject: "Trial ending",
    text: "Your trial ends soon.",
    payload: { trialEndsAt: 1780848000000 },
    ...overrides,
  };
}

function insertValues(statements: PreparedStatement[]) {
  return statements.find((statement) =>
    statement.sql.includes("INSERT OR IGNORE INTO notification_dispatch_log"),
  )?.values;
}

describe("BillingNotificationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T12:00:00.000Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id: "provider-1" }))),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("skips duplicate dispatches before calling providers", async () => {
    const { db, statements } = createDb({ duplicate: true });

    await expect(
      new BillingNotificationService(env({ DB: db as never })).send(input()),
    ).resolves.toEqual({
      status: NOTIFICATION_DISPATCH_STATUSES.SKIPPED_DUPLICATE,
      duplicate: true,
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(statements).toHaveLength(1);
    expect(statements[0].values).toEqual([
      "restaurant-1",
      "trial_1d",
      "trial_1d:restaurant-1:1780848000000",
      "email",
    ]);
  });

  it("sends escaped billing email through Cloudflare and records its message id", async () => {
    const { db, statements } = createDb();
    const send = vi.fn().mockResolvedValue({ messageId: "cf-billing-1" });

    await expect(
      new BillingNotificationService(
        env({
          DB: db as never,
          NOTIFICATION_EMAIL: { send } as unknown as SendEmail,
          BILLING_EMAIL_FROM: "billing@makanmasak.com",
        }),
      ).send(input({ text: "Trial <ends> & renews" })),
    ).resolves.toEqual({
      status: NOTIFICATION_DISPATCH_STATUSES.SENT,
      duplicate: false,
    });

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "owner@example.test",
        from: "billing@makanmasak.com",
        subject: "Trial ending",
        text: "Trial <ends> & renews",
        html: "<pre>Trial &lt;ends&gt; &amp; renews</pre>",
      }),
    );
    expect(insertValues(statements)?.[5]).toBe("sent");
    expect(insertValues(statements)?.[7]).toBe("cf-billing-1");
  });

  it("records Cloudflare send errors as failed", async () => {
    const { db, statements } = createDb();
    const send = vi.fn().mockRejectedValue(new Error("binding unavailable"));

    await expect(
      new BillingNotificationService(
        env({
          DB: db as never,
          NOTIFICATION_EMAIL: { send } as unknown as SendEmail,
          BILLING_EMAIL_FROM: "billing@makanmasak.com",
        }),
      ).send(input()),
    ).resolves.toEqual({
      status: NOTIFICATION_DISPATCH_STATUSES.FAILED,
      duplicate: false,
    });

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "owner@example.test",
        from: "billing@makanmasak.com",
        subject: "Trial ending",
      }),
    );
    expect(insertValues(statements)?.[5]).toBe("failed");
    expect(insertValues(statements)?.[8]).toBe("binding unavailable");
  });

  it("falls back to NOTIFICATION_FROM_EMAIL and default email subject", async () => {
    const { db, statements } = createDb();
    const send = vi.fn().mockResolvedValue({ messageId: "cf-billing-2" });

    await new BillingNotificationService(
      env({
        DB: db as never,
        NOTIFICATION_EMAIL: { send } as unknown as SendEmail,
        NOTIFICATION_FROM_EMAIL: "notify@example.test",
      }),
    ).send(input({ subject: undefined }));

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "notify@example.test",
        to: "owner@example.test",
        subject: "MakanMasak billing notification",
        text: "Your trial ends soon.",
      }),
    );
    expect(insertValues(statements)?.[5]).toBe("sent");
  });

  it("records unconfigured email providers without calling fetch", async () => {
    const { db, statements } = createDb();

    await expect(
      new BillingNotificationService(env({ DB: db as never })).send(input()),
    ).resolves.toEqual({
      status: NOTIFICATION_DISPATCH_STATUSES.SKIPPED_PROVIDER_UNCONFIGURED,
      duplicate: false,
    });

    expect(fetch).not.toHaveBeenCalled();
    const values = insertValues(statements);
    expect(values?.slice(0, 6)).toEqual([
      "notification-id",
      "restaurant-1",
      "trial_1d",
      "trial_1d:restaurant-1:1780848000000",
      "email",
      "skipped_provider_unconfigured",
    ]);
    expect(values?.[9]).toBe(JSON.stringify({ trialEndsAt: 1780848000000 }));
  });

  it("sends Slack notifications and records failures or missing webhooks", async () => {
    const sent = createDb();
    await expect(
      new BillingNotificationService(
        env({
          DB: sent.db as never,
          SLACK_WEBHOOK_URL: "https://hooks.slack.test/billing",
        }),
      ).send(
        input({
          channel: NOTIFICATION_CHANNELS.SLACK,
          recipient: undefined,
          text: "Quota exceeded",
        }),
      ),
    ).resolves.toEqual({
      status: NOTIFICATION_DISPATCH_STATUSES.SENT,
      duplicate: false,
    });
    expect(fetch).toHaveBeenCalledWith("https://hooks.slack.test/billing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Quota exceeded" }),
    });
    expect(insertValues(sent.statements)?.[5]).toBe("sent");

    const unconfigured = createDb();
    await expect(
      new BillingNotificationService(
        env({ DB: unconfigured.db as never }),
      ).send(input({ channel: NOTIFICATION_CHANNELS.SLACK })),
    ).resolves.toEqual({
      status: NOTIFICATION_DISPATCH_STATUSES.SKIPPED_PROVIDER_UNCONFIGURED,
      duplicate: false,
    });
    expect(insertValues(unconfigured.statements)?.[5]).toBe(
      "skipped_provider_unconfigured",
    );

    vi.mocked(fetch).mockResolvedValueOnce(new Response("no", { status: 500 }));
    const failed = createDb();
    await expect(
      new BillingNotificationService(
        env({
          DB: failed.db as never,
          SLACK_WEBHOOK_URL: "https://hooks.slack.test/billing",
        }),
      ).send(input({ channel: NOTIFICATION_CHANNELS.SLACK })),
    ).resolves.toEqual({
      status: NOTIFICATION_DISPATCH_STATUSES.FAILED,
      duplicate: false,
    });
    const values = insertValues(failed.statements);
    expect(values?.slice(0, 9)).toEqual([
      "notification-id",
      "restaurant-1",
      "trial_1d",
      "trial_1d:restaurant-1:1780848000000",
      "slack",
      "failed",
      "owner@example.test",
      null,
      "Slack webhook failed: 500",
    ]);
    expect(values?.[9]).toBe(JSON.stringify({ trialEndsAt: 1780848000000 }));
  });
});
