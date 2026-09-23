import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ensureManagementAuthToken, managementApi } from "@/services/api";
import { onboardingApplicationsService } from "./onboardingApplicationsService";

vi.mock("@/services/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
  managementApi: {
    get: vi.fn(),
    post: vi.fn(),
  },
  ensureManagementAuthToken: vi.fn(),
  unwrapApiPayload: (payload: { data?: unknown }) => payload.data ?? payload,
}));

describe("onboardingApplicationsService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ensureManagementAuthToken).mockResolvedValue("management-token");
  });

  it("lists onboarding applications with filters", async () => {
    vi.mocked(managementApi.get).mockResolvedValueOnce({
      data: {
        data: {
          applications: [
            {
              id: "APP-1",
              businessName: "Laksa Shop",
              contactName: "Tan Mei",
              contactEmail: "tan@example.test",
              contactPhone: "0912345678",
              planId: "trial",
              assignedSubdomain: "laksa",
              status: "submitted",
              createdAt: "2026-06-01T00:00:00.000Z",
              updatedAt: "2026-06-01T00:00:00.000Z",
            },
          ],
          total: 1,
          page: 1,
          limit: 25,
        },
      },
    } as never);

    const result = await onboardingApplicationsService.list({
      status: "submitted",
      page: 1,
      limit: 25,
    });

    expect(managementApi.get).toHaveBeenCalledWith(
      "/admin/onboarding/applications",
      {
        status: "submitted",
        page: 1,
        limit: 25,
      },
    );
    expect(
      vi.mocked(ensureManagementAuthToken).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(managementApi.get).mock.invocationCallOrder[0]);
    expect(result.applications[0]).toMatchObject({
      id: "APP-1",
      businessName: "Laksa Shop",
    });
  });

  it("loads audit events for one application through the management API", async () => {
    vi.mocked(managementApi.get).mockResolvedValueOnce({
      data: {
        data: {
          events: [
            {
              id: "evt-1",
              eventType: "rejected",
              actorId: "admin-1",
              actorEmail: "admin@example.test",
              metadata: { reason: "Duplicate application" },
              createdAtMs: 1_790_000_000_000,
            },
          ],
        },
      },
    } as never);

    const events = await onboardingApplicationsService.auditEvents("APP/1");

    expect(managementApi.get).toHaveBeenCalledWith(
      "/admin/onboarding/applications/APP%2F1/audit-events",
    );
    expect(events).toMatchObject([
      {
        id: "evt-1",
        eventType: "rejected",
        metadata: { reason: "Duplicate application" },
      },
    ]);
    expect(ensureManagementAuthToken).toHaveBeenCalledOnce();
  });

  it("approves, regenerates setup links, and rejects applications with a reason", async () => {
    vi.mocked(managementApi.post)
      .mockResolvedValueOnce({
        data: {
          data: {
            tenantId: "T-1",
            subdomain: "laksa",
            ownerAccount: {
              restaurantId: "restaurant-1",
              userId: "owner-1",
              username: "tan",
              setupPasswordToken: "setup-token",
              setupPasswordLink:
                "https://admin.example.test/reset-password?token=setup-token",
              setupPasswordExpiresAt: "2026-06-30T00:00:00.000Z",
            },
            status: "completed",
          },
        },
      } as never)
      .mockResolvedValueOnce({
        data: {
          data: {
            ownerAccount: {
              restaurantId: "restaurant-1",
              userId: "owner-1",
              username: "tan",
              setupPasswordLink:
                "https://admin.example.test/reset-password?token=fresh-token",
              setupPasswordExpiresAt: "2026-07-01T00:00:00.000Z",
            },
            credentialDelivery: {
              id: "delivery-2",
              channel: "manual",
              status: "pending",
              recipientEmail: "tan@example.test",
              recipientName: "Tan Mei",
              setupPasswordExpiresAt: "2026-07-01T00:00:00.000Z",
            },
          },
        },
      } as never)
      .mockResolvedValueOnce({
        data: { data: { status: "rejected" } },
      } as never);

    const approveResult = await onboardingApplicationsService.approve("APP-1");
    const setupLink =
      await onboardingApplicationsService.regenerateSetupLink("APP-1");
    await onboardingApplicationsService.reject("APP-2", "Missing documents");

    expect(approveResult.ownerAccount).toMatchObject({
      username: "tan",
      setupPasswordLink:
        "https://admin.example.test/reset-password?token=setup-token",
    });
    expect(managementApi.post).toHaveBeenNthCalledWith(
      1,
      "/admin/onboarding/applications/APP-1/approve",
      {},
    );
    expect(managementApi.post).toHaveBeenNthCalledWith(
      2,
      "/admin/onboarding/applications/APP-1/setup-link",
      {},
    );
    expect(setupLink).toMatchObject({
      ownerAccount: {
        setupPasswordLink:
          "https://admin.example.test/reset-password?token=fresh-token",
      },
      credentialDelivery: { id: "delivery-2", status: "pending" },
    });
    expect(managementApi.post).toHaveBeenNthCalledWith(
      3,
      "/admin/onboarding/applications/APP-2/reject",
      { reason: "Missing documents" },
    );
    expect(ensureManagementAuthToken).toHaveBeenCalledTimes(3);
  });
});

describe("market placement approval", () => {
  const provisioned = {
    status: "completed",
    restaurantId: "restaurant-1",
    marketId: "market-selected",
    stallNumber: "A12",
    ownerAccount: { username: "existing-owner" },
  };
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(managementApi.post).mockResolvedValue({
      data: { data: provisioned },
    } as never);
    vi.mocked(api.get).mockResolvedValue({
      data: {
        data: {
          requests: [
            {
              id: 1,
              restaurantId: "restaurant-1",
              marketId: "other-market",
              status: "pending",
            },
            {
              id: 2,
              restaurantId: "other-restaurant",
              marketId: "market-selected",
              status: "pending",
            },
            {
              id: 3,
              restaurantId: "restaurant-1",
              marketId: "market-selected",
              status: "pending",
            },
          ],
        },
      },
    } as never);
    vi.mocked(api.post).mockResolvedValue({ data: {} } as never);
  });
  it("approves only the server-selected placement through the guarded API", async () => {
    const result = await onboardingApplicationsService.approve("APP-1", {
      approveMarketMembership: true,
    });
    expect(api.get).toHaveBeenCalledWith(
      "/restaurants/restaurant-1/market-join-requests",
    );
    expect(api.post).toHaveBeenCalledExactlyOnceWith(
      "/admin/markets/join-requests/3/approve",
      { stallNumber: "A12" },
    );
    expect(result.marketApproval).toEqual({ status: "approved" });
  });
  it("preserves provisioning success and the currency refusal for a safe retry", async () => {
    vi.mocked(api.post).mockRejectedValueOnce({
      response: {
        data: { error: { code: "MARKET_VENDOR_CURRENCY_MISMATCH" } },
      },
    });
    const result = await onboardingApplicationsService.approve("APP-1", {
      approveMarketMembership: true,
    });
    expect(result).toMatchObject({
      ...provisioned,
      marketApproval: {
        status: "pending",
        errorCode: "MARKET_VENDOR_CURRENCY_MISMATCH",
      },
    });
    const retried = await onboardingApplicationsService.approve("APP-1", {
      approveMarketMembership: true,
    });
    expect(retried.marketApproval).toEqual({ status: "approved" });
    expect(
      vi
        .mocked(managementApi.post)
        .mock.calls.every(
          ([url]) => url === "/admin/onboarding/applications/APP-1/approve",
        ),
    ).toBe(true);
  });
  it("skips membership approval when unchecked", async () => {
    await onboardingApplicationsService.approve("APP-1", {
      approveMarketMembership: false,
    });
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });
  it("does not approve unrelated requests if the selected placement is missing", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { data: { requests: [] } },
    } as never);
    const result = await onboardingApplicationsService.approve("APP-1", {
      approveMarketMembership: true,
    });
    expect(result.marketApproval).toMatchObject({ status: "pending" });
    expect(api.post).not.toHaveBeenCalled();
  });
  it("accepts an already approved placement without a second approval write", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        data: {
          requests: [
            {
              id: 3,
              restaurantId: "restaurant-1",
              marketId: "market-selected",
              status: "approved",
            },
          ],
        },
      },
    } as never);
    const result = await onboardingApplicationsService.approve("APP-1", {
      approveMarketMembership: true,
    });
    expect(result.marketApproval).toEqual({ status: "approved" });
    expect(api.post).not.toHaveBeenCalled();
  });
});
