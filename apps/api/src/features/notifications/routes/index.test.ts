import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../../../middleware/auth";
import { ApiError } from "../../../shared/utils/api-error";

const authState = vi.hoisted(() => ({
  user: {
    id: "user-7",
    username: "owner",
    role: 1,
    restaurantId: "restaurant-1" as string | number | null,
  } as AuthUser,
}));

const notificationFns = vi.hoisted(() => ({
  sendTestNotification: vi.fn(),
  sendNotification: vi.fn(),
}));

vi.mock("../../../shared/middleware", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../shared/middleware")>();

  return {
    ...actual,
    authMiddleware: vi.fn(async (c, next) => {
      c.set("user", authState.user);
      await next();
    }),
    requireRole: vi.fn(
      () => async (_c: unknown, next: () => Promise<void>) => next(),
    ),
  };
});

vi.mock("@makanmasak/database", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();

  return {
    ...actual,
    NotificationService: class {
      sendTestNotification = notificationFns.sendTestNotification;
      sendNotification = notificationFns.sendNotification;
    },
  };
});

import routes from "./index";

routes.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      { success: false, error: { code: err.code, message: err.message } },
      err.status as 400 | 401 | 403 | 404 | 409 | 500,
    );
  }
  return c.json({ success: false, error: { message: String(err) } }, 500);
});

function createDb(recipient?: {
  restaurant_id?: string | number | null;
  email?: string | null;
}) {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => recipient ?? null),
      })),
    })),
  };
}

function createEnv(
  overrides: Partial<{
    DB: ReturnType<typeof createDb>;
    RESEND_API_KEY: string;
    NOTIFICATION_EMAIL: { send: ReturnType<typeof vi.fn> };
    TWILIO_ACCOUNT_SID: string;
    TWILIO_AUTH_TOKEN: string;
  }> = {},
) {
  return {
    DB: createDb({ restaurant_id: "restaurant-1", email: "staff@test.dev" }),
    CACHE_KV: {},
    ...overrides,
  };
}

function request(
  path: string,
  method = "GET",
  body?: unknown,
  env = createEnv(),
) {
  return routes.request(
    path,
    {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
    },
    env as never,
  );
}

const notificationBody = {
  recipientId: "12",
  recipientEmail: "staff@test.dev",
  category: "schedule_created",
  type: "email",
  data: {
    employeeName: "Lin",
    shiftName: "Lunch",
    scheduleDate: "2026-06-08",
    startTime: "10:00",
    endTime: "14:00",
  },
  priority: "high",
};

describe("notification routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = {
      id: "user-7",
      username: "owner",
      role: 1,
      restaurantId: "restaurant-1",
    };
  });

  it("sends test notifications and reports provider errors", async () => {
    notificationFns.sendTestNotification
      .mockResolvedValueOnce({ success: true, provider: "resend" })
      .mockResolvedValueOnce({ success: false, error: "provider offline" })
      .mockResolvedValueOnce({ success: false });

    // 收件人必須是同店且 email 相符的帳號 —— createEnv() 的 DB stub 回的是
    // restaurant-1 / staff@test.dev。
    const testBody = {
      recipientId: "12",
      recipientEmail: "staff@test.dev",
      category: "shift_reminder",
    };
    const successResponse = await request("/test", "POST", testBody);
    const failureResponse = await request("/test", "POST", {
      ...testBody,
      type: "sms",
    });
    const fallbackFailureResponse = await request("/test", "POST", testBody);

    expect(successResponse.status).toBe(200);
    await expect(successResponse.json()).resolves.toMatchObject({
      success: true,
      data: {
        message: "Test notification sent successfully",
        details: { success: true, provider: "resend" },
      },
    });
    expect(notificationFns.sendTestNotification).toHaveBeenNthCalledWith(
      1,
      "email",
      "staff@test.dev",
    );
    expect(failureResponse.status).toBe(500);
    await expect(failureResponse.json()).resolves.toEqual({
      success: false,
      error: {
        code: "TEST_NOTIFICATION_FAILED",
        message: "provider offline",
      },
    });
    expect(fallbackFailureResponse.status).toBe(500);
    await expect(fallbackFailureResponse.json()).resolves.toEqual({
      success: false,
      error: {
        code: "TEST_NOTIFICATION_FAILED",
        message: "Failed to send test notification",
      },
    });
    expect(notificationFns.sendTestNotification).toHaveBeenNthCalledWith(
      2,
      "sms",
      "staff@test.dev",
    );
    expect(notificationFns.sendTestNotification).toHaveBeenNthCalledWith(
      3,
      "email",
      "staff@test.dev",
    );
  });

  it("refuses to send a test notification to an arbitrary external address", async () => {
    const response = await request("/test", "POST", {
      recipientId: "12",
      recipientEmail: "victim@example.com",
      category: "shift_reminder",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "RECIPIENT_EMAIL_MISMATCH" },
    });
    expect(notificationFns.sendTestNotification).not.toHaveBeenCalled();
  });

  it("refuses a test notification aimed at another restaurant's user", async () => {
    const response = await request(
      "/test",
      "POST",
      {
        recipientId: "12",
        recipientEmail: "staff@test.dev",
        category: "shift_reminder",
      },
      createEnv({
        DB: createDb({
          restaurant_id: "restaurant-2",
          email: "staff@test.dev",
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "ACCESS_DENIED" },
    });
    expect(notificationFns.sendTestNotification).not.toHaveBeenCalled();
  });

  it("defaults the test recipient to the caller when recipientId is omitted", async () => {
    notificationFns.sendTestNotification.mockResolvedValueOnce({
      success: true,
      provider: "resend",
    });
    const env = createEnv();

    const response = await request(
      "/test",
      "POST",
      { recipientEmail: "staff@test.dev", category: "shift_reminder" },
      env,
    );

    expect(response.status).toBe(200);
    // 查的是呼叫者自己的 id，不是隨便一個 body 帶進來的 id
    expect(env.DB.prepare).toHaveBeenCalledOnce();
    expect(notificationFns.sendTestNotification).toHaveBeenCalledWith(
      "email",
      "staff@test.dev",
    );
  });

  it("lists templates with configured provider flags", async () => {
    const response = await request(
      "/templates",
      "GET",
      undefined,
      createEnv({
        RESEND_API_KEY: "resend-key",
        TWILIO_ACCOUNT_SID: "twilio-sid",
        TWILIO_AUTH_TOKEN: "twilio-token",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        totalCount: 11,
        supportedChannels: ["email", "sms"],
        configuredProviders: { email: true, sms: true },
      },
    });
  });

  it("reports email configured with only the Cloudflare binding", async () => {
    const send = vi.fn();
    const response = await request(
      "/templates",
      "GET",
      undefined,
      createEnv({ NOTIFICATION_EMAIL: { send } }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { configuredProviders: { email: true } },
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends manual notifications for owners in their restaurant", async () => {
    const env = createEnv({
      DB: createDb({ restaurant_id: "restaurant-1", email: "staff@test.dev" }),
    });
    notificationFns.sendNotification.mockResolvedValue({ success: true });

    const response = await request("/send", "POST", notificationBody, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        message: "Notification sent successfully",
        channel: "email",
        category: "schedule_created",
      },
    });
    expect(env.DB.prepare).toHaveBeenCalledWith(
      "SELECT restaurant_id, email FROM users WHERE id = ?",
    );
    expect(notificationFns.sendNotification).toHaveBeenCalledWith(
      notificationBody,
    );
  });

  it("lets admins send manual notifications without recipient scope lookup", async () => {
    authState.user = {
      id: "user-1",
      username: "admin",
      role: 0,
      restaurantId: undefined,
    };
    const env = createEnv();
    notificationFns.sendNotification.mockResolvedValue({ success: true });

    const response = await request("/send", "POST", notificationBody, env);

    expect(response.status).toBe(200);
    expect(env.DB.prepare).not.toHaveBeenCalled();
    expect(notificationFns.sendNotification).toHaveBeenCalledWith(
      notificationBody,
    );
  });

  it("maps manual notification service failures", async () => {
    notificationFns.sendNotification
      .mockResolvedValueOnce({
        success: false,
        errors: ["email failed", "sms failed"],
      })
      .mockResolvedValueOnce({
        success: false,
        errors: [],
      });

    const response = await request("/send", "POST", notificationBody);
    const fallbackResponse = await request("/send", "POST", notificationBody);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: {
        code: "NOTIFICATION_SEND_FAILED",
        message: "email failed, sms failed",
      },
    });
    expect(fallbackResponse.status).toBe(500);
    await expect(fallbackResponse.json()).resolves.toEqual({
      success: false,
      error: {
        code: "NOTIFICATION_SEND_FAILED",
        message: "Failed to send notification",
      },
    });
  });

  it("rejects owners sending to missing or outside-restaurant recipients", async () => {
    const missingResponse = await request(
      "/send",
      "POST",
      notificationBody,
      createEnv({ DB: createDb(null as never) }),
    );
    const forbiddenResponse = await request(
      "/send",
      "POST",
      notificationBody,
      createEnv({
        DB: createDb({
          restaurant_id: "restaurant-2",
          email: "staff@test.dev",
        }),
      }),
    );

    expect(missingResponse.status).toBe(404);
    await expect(missingResponse.json()).resolves.toEqual({
      success: false,
      error: {
        code: "RECIPIENT_NOT_FOUND",
        message: "Notification recipient not found",
      },
    });
    expect(forbiddenResponse.status).toBe(403);
    await expect(forbiddenResponse.json()).resolves.toEqual({
      success: false,
      error: {
        code: "ACCESS_DENIED",
        message: "Cannot send notifications to another restaurant",
      },
    });
    expect(notificationFns.sendNotification).not.toHaveBeenCalled();
  });

  it("rejects owners without a restaurant even when the recipient has one", async () => {
    authState.user = {
      id: "user-8",
      username: "unscoped-owner",
      role: 1,
      restaurantId: undefined as never,
    };

    const response = await request(
      "/send",
      "POST",
      notificationBody,
      createEnv({
        DB: createDb({
          restaurant_id: "restaurant-1",
          email: "staff@test.dev",
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: {
        code: "ACCESS_DENIED",
        message: "Cannot send notifications to another restaurant",
      },
    });
    expect(notificationFns.sendNotification).not.toHaveBeenCalled();
  });

  it("rejects owner recipients without a stored email", async () => {
    const response = await request(
      "/send",
      "POST",
      notificationBody,
      createEnv({
        DB: createDb({ restaurant_id: "restaurant-1", email: null }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: {
        code: "RECIPIENT_EMAIL_MISMATCH",
        message: "Recipient email does not match user",
      },
    });
    expect(notificationFns.sendNotification).not.toHaveBeenCalled();
  });

  it("rejects owner recipients whose email does not match the target user", async () => {
    const response = await request(
      "/send",
      "POST",
      notificationBody,
      createEnv({
        DB: createDb({
          restaurant_id: "restaurant-1",
          email: "other@test.dev",
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: {
        code: "RECIPIENT_EMAIL_MISMATCH",
        message: "Recipient email does not match user",
      },
    });
    expect(notificationFns.sendNotification).not.toHaveBeenCalled();
  });

  it("rejects invalid payloads before sending notifications", async () => {
    const response = await request("/send", "POST", {
      ...notificationBody,
      recipientEmail: "not-an-email",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "VALIDATION_ERROR" },
    });
    expect(notificationFns.sendNotification).not.toHaveBeenCalled();
  });
});
