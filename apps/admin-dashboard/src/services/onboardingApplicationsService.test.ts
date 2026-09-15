import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureManagementAuthToken, managementApi } from "@/services/api";
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
