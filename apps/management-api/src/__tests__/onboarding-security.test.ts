import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "../index";
import type { ManagementEnv } from "../types";

const onboardingMocks = vi.hoisted(() => ({
  createApplication: vi.fn(),
  getApplication: vi.fn(),
  // The route admits a request only when this resolves true, so a mock that
  // omits it fails as "is not a function" and every create-application case
  // reads as a 500 -- which is what the suite did once the route started
  // calling it. Default to admitting; the rate-limited case overrides it.
  consumeApplicationRateLimit: vi.fn(async () => true),
  // Both fire inside the create-application path (via waitUntil), so they are
  // part of that route's contract with the service even though the response
  // does not wait for them.
  notifyPlatformOfNewApplication: vi.fn(async () => undefined),
  sendApplicationReceivedEmail: vi.fn(async () => undefined),
  verifyApplicationSecret: vi.fn(),
}));

vi.mock("../services/OnboardingService", () => ({
  OnboardingService: vi.fn(function OnboardingService() {
    return onboardingMocks;
  }),
}));

function createEnv(): ManagementEnv {
  return {
    NODE_ENV: "test",
    API_VERSION: "v1",
    API_BASE_URL: "http://localhost",
    CORS_ORIGIN: "http://localhost:5173",
    LOG_LEVEL: "error",
    JWT_SECRET: "test-secret",
    CF_API_TOKEN: "test-token",
    CF_ACCOUNT_ID: "test-account",
    MANAGEMENT_DB: {} as D1Database,
    CACHE_KV: {} as KVNamespace,
    DEPLOYMENT_STATUS_KV: {} as KVNamespace,
    BUNDLE_STORAGE: {} as R2Bucket,
  };
}

const application = {
  id: "app-123",
  businessName: "Demo Noodles",
  contactName: "Lin Mei",
  contactEmail: "mei@example.test",
  contactPhone: "0912345678",
  latitude: 24.147736,
  longitude: 120.673648,
  planId: "trial",
  assignedSubdomain: "demo-noodles",
  status: "submitted",
  createdAt: "2026-06-12T00:00:00.000Z",
  updatedAt: "2026-06-12T00:00:00.000Z",
};

const createApplicationBody = {
  businessName: "Demo Noodles",
  contactName: "Lin Mei",
  contactEmail: "mei@example.test",
  contactPhone: "0912345678",
  latitude: 24.147736,
  longitude: 120.673648,
  planId: "trial",
};

beforeEach(() => {
  vi.clearAllMocks();
  onboardingMocks.createApplication.mockResolvedValue({
    ...application,
    applicationSecret: "onb_secret_123",
  });
  onboardingMocks.getApplication.mockResolvedValue(application);
  onboardingMocks.verifyApplicationSecret.mockResolvedValue(true);
});

function jsonRequest(path: string, body: unknown, headers = {}) {
  return new Request(`https://management.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("onboarding route authorization", () => {
  it("returns a one-time application secret when creating an application", async () => {
    const response = await app.fetch(
      jsonRequest("/api/v1/onboarding/applications", createApplicationBody),
      createEnv(),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        applicationId: "app-123",
        applicationSecret: "onb_secret_123",
      },
    });
  });

  it("requires the application secret before reading applications", async () => {
    const readResponse = await app.fetch(
      new Request(
        "https://management.test/api/v1/onboarding/applications/app-123",
      ),
      createEnv(),
    );
    expect(readResponse.status).toBe(401);
  });

  it("does not expose public application completion", async () => {
    const response = await app.fetch(
      jsonRequest(
        "/api/v1/onboarding/applications/app-123/complete",
        {},
        { "X-Onboarding-Secret": "onb_secret_123" },
      ),
      createEnv(),
    );

    // No public completion route exists — the path 404s (it used to 401 via
    // the catch-all auth middleware before auth was scoped to known prefixes).
    expect(response.status).toBe(404);
    expect(onboardingMocks.verifyApplicationSecret).not.toHaveBeenCalled();
  });
});
