import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../../../middleware/auth";
import { Hono } from "hono";
import feedbackRoutes from "./index";
import { handleAppError } from "../../../utils/app-error-handler";
import { createFeedbackSchema } from "../schemas/validation";

// A bare router turns every throw into 500; mount under the real handler.
const routes = new Hono();
routes.onError(handleAppError);
routes.route("/", feedbackRoutes);

const mocks = vi.hoisted(() => ({
  currentUser: {
    id: "user-10",
    username: "owner",
    role: 1,
    restaurantId: "restaurant-1",
  } as AuthUser,
  kvPut: vi.fn(),
  createFeedback: vi.fn(),
  getFeedbackStats: vi.fn(),
  listFeedback: vi.fn(),
  getFeedbackById: vi.fn(),
  updateFeedbackStatus: vi.fn(),
  updateFeedback: vi.fn(),
  deleteFeedback: vi.fn(),
  addResponse: vi.fn(),
  updateResponse: vi.fn(),
  deleteResponse: vi.fn(),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: vi.fn(async (c, next) => {
    c.set("user", mocks.currentUser);
    await next();
  }),
  requireRole: vi.fn(() => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  }),
}));

vi.mock("@makanmasak/database", () => ({
  FEEDBACK_CATEGORIES: [
    "bug_report",
    "feature_request",
    "usability",
    "performance",
    "billing",
    "other",
  ],
  FEEDBACK_PRIORITIES: ["low", "medium", "high", "urgent"],
  FEEDBACK_STATUSES: ["open", "in_progress", "resolved", "closed"],
  FEEDBACK_MODULES: [
    "menu",
    "orders",
    "pos",
    "tables",
    "reservations",
    "scheduling",
    "analytics",
    "settings",
    "integrations",
    "other",
  ],
  FeedbackService: vi.fn(function FeedbackService() {
    return {
      createFeedback: mocks.createFeedback,
      getFeedbackStats: mocks.getFeedbackStats,
      listFeedback: mocks.listFeedback,
      getFeedbackById: mocks.getFeedbackById,
      updateFeedbackStatus: mocks.updateFeedbackStatus,
      updateFeedback: mocks.updateFeedback,
      deleteFeedback: mocks.deleteFeedback,
      addResponse: mocks.addResponse,
      updateResponse: mocks.updateResponse,
      deleteResponse: mocks.deleteResponse,
    };
  }),
}));

function createEnv() {
  return {
    DB: {},
    CACHE_KV: {
      put: mocks.kvPut,
    },
  };
}

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function feedback(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    restaurantId: "restaurant-1",
    userId: "user-10",
    category: "bug_report",
    priority: "high",
    status: "open",
    relatedModule: "orders",
    subject: "Order screen freezes",
    description: "The order screen freezes during checkout.",
    responses: [
      { id: 1, message: "Public reply", isInternal: false },
      { id: 2, message: "Internal note", isInternal: true },
    ],
    ...overrides,
  };
}

type FeedbackDetailBody = {
  success: boolean;
  data: {
    responses: Array<{ id: number; message: string; isInternal: boolean }>;
  };
};

function createFeedbackBody(overrides: Record<string, unknown> = {}) {
  return {
    subject: "Order screen freezes",
    description: "The order screen freezes during checkout.",
    category: "bug_report",
    priority: "high",
    relatedModule: "orders",
    attachmentUrls: ["https://cdn.example.test/feedback.png"],
    ...overrides,
  };
}

async function withSilencedRouteError<T>(
  action: () => T | Promise<T>,
): Promise<Awaited<T>> {
  const consoleError = vi
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  try {
    return await action();
  } finally {
    consoleError.mockRestore();
  }
}

describe("feedback routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
    mocks.currentUser = {
      id: "user-10",
      username: "owner",
      role: 1,
      restaurantId: "restaurant-1",
    };
    mocks.kvPut.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("validates feedback attachment URLs as http or https only", () => {
    expect(
      createFeedbackSchema.safeParse(
        createFeedbackBody({
          attachmentUrls: [
            "https://cdn.example.test/feedback.png",
            "http://cdn.example.test/log.txt",
          ],
        }),
      ).success,
    ).toBe(true);

    expect(
      createFeedbackSchema.safeParse(
        createFeedbackBody({
          attachmentUrls: [
            "javascript:alert(document.domain)",
            "data:text/html,<script>alert(1)</script>",
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it("creates feedback for the authenticated owner restaurant", async () => {
    mocks.createFeedback.mockResolvedValue(feedback());

    const response = await routes.fetch(
      jsonRequest("https://test/", "POST", createFeedbackBody()),
      createEnv() as never,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { id: 5, category: "bug_report" },
    });
    expect(mocks.createFeedback).toHaveBeenCalledWith({
      restaurantId: "restaurant-1",
      userId: "user-10",
      category: "bug_report",
      priority: "high",
      relatedModule: "orders",
      subject: "Order screen freezes",
      description: "The order screen freezes during checkout.",
      attachmentUrls: ["https://cdn.example.test/feedback.png"],
    });
  });

  it("rejects feedback creation when the owner has no restaurant", async () => {
    mocks.currentUser.restaurantId = undefined;

    const response = await routes.fetch(
      jsonRequest("https://test/", "POST", createFeedbackBody()),
      createEnv() as never,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "NO_RESTAURANT" },
    });
    expect(mocks.createFeedback).not.toHaveBeenCalled();
  });

  it("rejects non-http attachment URLs during feedback creation", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await routes.fetch(
      jsonRequest(
        "https://test/",
        "POST",
        createFeedbackBody({
          attachmentUrls: [
            "javascript:alert(document.domain)",
            "data:text/html,<script>alert(1)</script>",
          ],
        }),
      ),
      createEnv() as never,
    );

    expect(response.status).toBe(400);
    expect(mocks.createFeedback).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("persists batch sync payloads with encoded scope and sync id", async () => {
    const response = await routes.fetch(
      jsonRequest("https://test/batch-sync", "POST", {
        sync_id: "sync 1",
        feedback: [{ id: "local-1" }, { id: "local-2" }],
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        syncId: "sync%201",
        synced: true,
        itemCount: 2,
        restaurantId: "restaurant-1",
        syncedAt: "2026-06-07T00:00:00.000Z",
      },
    });
    expect(mocks.kvPut).toHaveBeenCalledWith(
      "feedback:batch-sync:restaurant-1:user-10:sync%201",
      expect.stringContaining('"userId":"user-10"'),
      { expirationTtl: 60 * 60 * 24 * 30 },
    );
    expect(mocks.kvPut).toHaveBeenCalledWith(
      "feedback:batch-sync:restaurant-1:user-10:latest",
      expect.stringContaining('"restaurantId":"restaurant-1"'),
      { expirationTtl: 60 * 60 * 24 * 30 },
    );
  });

  it("uses global batch sync scope and timestamp fallback when needed", async () => {
    mocks.currentUser = {
      id: "user-10",
      username: "admin",
      role: 0,
      restaurantId: undefined,
    };

    const response = await routes.fetch(
      jsonRequest("https://test/batch-sync", "POST", { feedback: "not-list" }),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        syncId: "1780790400000",
        itemCount: 0,
        restaurantId: null,
      },
    });
    expect(mocks.kvPut).toHaveBeenCalledWith(
      "feedback:batch-sync:global:user-10:1780790400000",
      expect.stringContaining('"restaurantId":null'),
      expect.anything(),
    );
  });

  it("returns global stats for admins and submitter-scoped stats for owners", async () => {
    mocks.currentUser.role = 0;
    mocks.getFeedbackStats.mockResolvedValue({ total: 7, open: 3 });
    mocks.listFeedback.mockResolvedValue({
      data: [feedback()],
      pagination: { page: 2, limit: 5, total: 1 },
    });
    const env = createEnv();

    const statsResponse = await routes.fetch(
      new Request("https://test/stats"),
      env as never,
    );
    expect(statsResponse.status).toBe(200);
    await expect(statsResponse.json()).resolves.toMatchObject({
      data: { total: 7, open: 3 },
    });
    expect(mocks.getFeedbackStats).toHaveBeenCalledWith({});

    const adminListResponse = await routes.fetch(
      new Request(
        "https://test/?restaurantId=restaurant-2&category=bug_report&page=2&limit=5",
      ),
      env as never,
    );
    expect(adminListResponse.status).toBe(200);
    expect(mocks.listFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "bug_report",
        restaurantId: "restaurant-2",
      }),
      2,
      5,
      true,
    );

    mocks.currentUser.role = 1;
    mocks.getFeedbackStats.mockResolvedValue({ total: 1, open: 1 });
    const ownerStatsResponse = await routes.fetch(
      new Request("https://test/stats"),
      env as never,
    );
    expect(ownerStatsResponse.status).toBe(200);
    expect(mocks.getFeedbackStats).toHaveBeenLastCalledWith({
      userId: "user-10",
    });

    const ownerListResponse = await routes.fetch(
      new Request(
        "https://test/?restaurantId=restaurant-2&status=open&search=freeze",
      ),
      env as never,
    );
    expect(ownerListResponse.status).toBe(200);
    expect(mocks.listFeedback).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "open",
        search: "freeze",
        userId: "user-10",
      }),
      1,
      20,
      false,
    );
  });

  it("returns feedback detail and hides internal responses from owners", async () => {
    mocks.getFeedbackById.mockResolvedValue(feedback());

    const ownerResponse = await routes.fetch(
      new Request("https://test/5"),
      createEnv() as never,
    );

    expect(ownerResponse.status).toBe(200);
    const ownerBody = await ownerResponse.json<FeedbackDetailBody>();
    expect(ownerBody.data.responses).toEqual([
      { id: 1, message: "Public reply", isInternal: false },
    ]);

    mocks.currentUser.role = 0;
    mocks.getFeedbackById.mockResolvedValue(feedback());
    const adminResponse = await routes.fetch(
      new Request("https://test/5"),
      createEnv() as never,
    );

    expect(adminResponse.status).toBe(200);
    const adminBody = await adminResponse.json<FeedbackDetailBody>();
    expect(adminBody.data.responses).toHaveLength(2);
  });

  it("returns route errors for missing or unauthorized feedback detail", async () => {
    mocks.getFeedbackById.mockResolvedValueOnce(null);
    const missingResponse = await withSilencedRouteError(() =>
      routes.fetch(new Request("https://test/99"), createEnv() as never),
    );
    expect(missingResponse.status).toBe(404);

    mocks.getFeedbackById.mockResolvedValueOnce(
      feedback({ userId: "user-99" }),
    );
    const forbiddenResponse = await withSilencedRouteError(() =>
      routes.fetch(new Request("https://test/5"), createEnv() as never),
    );
    expect(forbiddenResponse.status).toBe(403);
  });

  it("updates feedback status with resolver attribution", async () => {
    mocks.currentUser.role = 0;
    mocks.updateFeedbackStatus
      .mockResolvedValueOnce(feedback({ status: "resolved" }))
      .mockResolvedValueOnce(feedback({ status: "in_progress" }));
    const env = createEnv();

    const resolvedResponse = await routes.fetch(
      jsonRequest("https://test/5/status", "PUT", { status: "resolved" }),
      env as never,
    );
    expect(resolvedResponse.status).toBe(200);
    expect(mocks.updateFeedbackStatus).toHaveBeenCalledWith(
      5,
      "resolved",
      "user-10",
    );

    const progressResponse = await routes.fetch(
      jsonRequest("https://test/5/status", "PUT", { status: "in_progress" }),
      env as never,
    );
    expect(progressResponse.status).toBe(200);
    expect(mocks.updateFeedbackStatus).toHaveBeenLastCalledWith(
      5,
      "in_progress",
      undefined,
    );
  });

  it("patches and deletes feedback with owner access checks", async () => {
    mocks.getFeedbackById.mockResolvedValue(feedback());
    mocks.updateFeedback.mockResolvedValue(feedback({ subject: "Updated" }));
    mocks.deleteFeedback.mockResolvedValue(true);
    const env = createEnv();

    const patchResponse = await routes.fetch(
      jsonRequest("https://test/5", "PATCH", { subject: "Updated" }),
      env as never,
    );
    expect(patchResponse.status).toBe(200);
    expect(mocks.updateFeedback).toHaveBeenCalledWith(
      5,
      { subject: "Updated" },
      "user-10",
      false,
    );

    const deleteResponse = await routes.fetch(
      new Request("https://test/5", { method: "DELETE" }),
      env as never,
    );
    expect(deleteResponse.status).toBe(200);
    expect(mocks.deleteFeedback).toHaveBeenCalledWith(5, "user-10", false);
  });

  it("lets admins patch and delete without owner preloads", async () => {
    mocks.currentUser.role = 0;
    mocks.updateFeedback.mockResolvedValue(feedback({ subject: "Admin" }));
    mocks.deleteFeedback.mockResolvedValue(true);
    const env = createEnv();

    const patchResponse = await routes.fetch(
      jsonRequest("https://test/5", "PATCH", { subject: "Admin" }),
      env as never,
    );
    expect(patchResponse.status).toBe(200);
    expect(mocks.getFeedbackById).not.toHaveBeenCalled();
    expect(mocks.updateFeedback).toHaveBeenCalledWith(
      5,
      { subject: "Admin" },
      "user-10",
      true,
    );

    const deleteResponse = await routes.fetch(
      new Request("https://test/5", { method: "DELETE" }),
      env as never,
    );
    expect(deleteResponse.status).toBe(200);
    expect(mocks.deleteFeedback).toHaveBeenCalledWith(5, "user-10", true);
  });

  it("returns route errors when patch or delete cannot modify feedback", async () => {
    mocks.currentUser.role = 0;
    mocks.updateFeedback.mockResolvedValue(null);
    const patchResponse = await withSilencedRouteError(() =>
      routes.fetch(
        jsonRequest("https://test/5", "PATCH", { subject: "Updated" }),
        createEnv() as never,
      ),
    );
    expect(patchResponse.status).toBe(404);

    mocks.deleteFeedback.mockResolvedValue(false);
    const deleteResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/5", { method: "DELETE" }),
        createEnv() as never,
      ),
    );
    expect(deleteResponse.status).toBe(404);
  });

  it("adds responses and restricts internal notes to admins", async () => {
    mocks.getFeedbackById.mockResolvedValue(feedback());
    mocks.addResponse.mockResolvedValue({ id: 11, message: "Reply" });
    const env = createEnv();

    const ownerResponse = await routes.fetch(
      jsonRequest("https://test/5/responses", "POST", {
        message: "Reply",
        isInternal: true,
      }),
      env as never,
    );
    expect(ownerResponse.status).toBe(201);
    expect(mocks.addResponse).toHaveBeenCalledWith(
      5,
      "user-10",
      "Reply",
      false,
    );

    mocks.currentUser.role = 0;
    mocks.getFeedbackById.mockResolvedValue(feedback());
    const adminResponse = await routes.fetch(
      jsonRequest("https://test/5/responses", "POST", {
        message: "Internal",
        isInternal: true,
      }),
      env as never,
    );
    expect(adminResponse.status).toBe(201);
    expect(mocks.addResponse).toHaveBeenLastCalledWith(
      5,
      "user-10",
      "Internal",
      true,
    );
  });

  it("updates and deletes responses with access rules", async () => {
    mocks.getFeedbackById.mockResolvedValue(feedback());
    mocks.updateResponse.mockResolvedValue({ id: 11, message: "Updated" });
    mocks.deleteResponse.mockResolvedValue(true);
    const env = createEnv();

    const updateResponse = await routes.fetch(
      jsonRequest("https://test/5/responses/11", "PUT", {
        message: "Updated",
      }),
      env as never,
    );
    expect(updateResponse.status).toBe(200);
    expect(mocks.updateResponse).toHaveBeenCalledWith(
      11,
      "user-10",
      "Updated",
      false,
    );

    const deleteResponse = await routes.fetch(
      new Request("https://test/5/responses/11", { method: "DELETE" }),
      env as never,
    );
    expect(deleteResponse.status).toBe(200);
    expect(mocks.deleteResponse).toHaveBeenCalledWith(11, "user-10", false);
  });

  it("returns route errors when response mutations miss", async () => {
    mocks.currentUser.role = 0;
    mocks.updateResponse.mockResolvedValue(null);
    const updateResponse = await withSilencedRouteError(() =>
      routes.fetch(
        jsonRequest("https://test/5/responses/11", "PUT", {
          message: "Updated",
        }),
        createEnv() as never,
      ),
    );
    expect(updateResponse.status).toBe(404);

    mocks.deleteResponse.mockResolvedValue(false);
    const deleteResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/5/responses/11", { method: "DELETE" }),
        createEnv() as never,
      ),
    );
    expect(deleteResponse.status).toBe(404);
  });
});
