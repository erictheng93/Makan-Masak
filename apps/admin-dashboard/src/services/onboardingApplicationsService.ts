import { marketsService } from "@/services/marketsService";
import {
  ensureManagementAuthToken,
  managementApi,
  unwrapApiPayload,
} from "@/services/api";

export type OnboardingApplicationStatus =
  | "submitted"
  | "provisioning"
  | "completed"
  | "rejected";

export interface OnboardingApplication {
  id: string;
  countryCode?: string | null;
  city?: string | null;
  marketId?: string | null;
  marketName?: string | null;
  stallNumber?: string | null;
  businessName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  planId: "standard" | "professional" | "enterprise" | "trial" | null;
  latitude?: number | null;
  longitude?: number | null;
  requestedSubdomain?: string | null;
  assignedSubdomain?: string | null;
  status: OnboardingApplicationStatus;
  tenantId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
  submittedAt?: string | null;
  completedAt?: string | null;
  rejectionReason?: string | null;
  updatedAt: string;
}

export interface OnboardingApplicationsResult {
  applications: OnboardingApplication[];
  total: number;
  page: number;
  limit: number;
}

export interface OnboardingApplicationAuditEvent {
  id: string;
  eventType: string;
  actorId: string | null;
  actorEmail: string | null;
  metadata: Record<string, string> | null;
  createdAtMs: number;
}

/**
 * The raw setup token is deliberately absent: the one-time link already carries
 * it, and the server stops handing the bare token to clients that never use it.
 */
export interface ProvisionedOwnerAccount {
  restaurantId: string;
  userId: string;
  username: string;
  setupPasswordLink: string;
  setupPasswordExpiresAt: string;
}

export interface CredentialDelivery {
  id: string;
  channel: "email" | "manual";
  status: "sent" | "pending" | "failed";
  recipientEmail: string;
  recipientName: string;
  setupPasswordExpiresAt: string;
  errorMessage?: string;
}

export interface ApproveOnboardingApplicationResult {
  restaurantId?: string;
  marketId?: string;
  stallNumber?: string;
  marketApproval?:
    | { status: "approved" }
    | { status: "pending"; errorCode: string };
  tenantId?: string;
  subdomain?: string;
  ownerAccount?: ProvisionedOwnerAccount;
  credentialDelivery?: CredentialDelivery;
  status: "completed";
}

export interface SetupPasswordLinkResult {
  ownerAccount: ProvisionedOwnerAccount;
  credentialDelivery?: CredentialDelivery;
}

/** Fired after an approve/reject so the sidebar badge recounts right away. */
export const ONBOARDING_APPLICATIONS_CHANGED =
  "onboarding-applications:changed";

/** Background refresh for the list and the sidebar badge. */
export const ONBOARDING_POLL_INTERVAL_MS = 60_000;

export const onboardingApplicationsService = {
  async list(
    input: {
      status?: OnboardingApplicationStatus;
      page?: number;
      limit?: number;
    } = {},
  ): Promise<OnboardingApplicationsResult> {
    await ensureManagementAuthToken();
    const response = await managementApi.get<OnboardingApplicationsResult>(
      "/admin/onboarding/applications",
      input,
    );
    return unwrapApiPayload<OnboardingApplicationsResult>(response.data);
  },

  async auditEvents(
    applicationId: string,
  ): Promise<OnboardingApplicationAuditEvent[]> {
    await ensureManagementAuthToken();
    const response = await managementApi.get<{
      events: OnboardingApplicationAuditEvent[];
    }>(
      `/admin/onboarding/applications/${encodeURIComponent(applicationId)}/audit-events`,
    );
    return unwrapApiPayload<{ events: OnboardingApplicationAuditEvent[] }>(
      response.data,
    ).events;
  },

  async approve(
    applicationId: string,
    options: { approveMarketMembership?: boolean } = {},
  ): Promise<ApproveOnboardingApplicationResult> {
    await ensureManagementAuthToken();
    const response =
      await managementApi.post<ApproveOnboardingApplicationResult>(
        `/admin/onboarding/applications/${applicationId}/approve`,
        {},
      );
    const result = unwrapApiPayload<ApproveOnboardingApplicationResult>(
      response.data,
    );
    if (!options.approveMarketMembership || !result.marketId) return result;

    // Both identifiers come from the authenticated management response. Currency
    // remains exclusively the platform approval route's stored-data decision.
    try {
      if (!result.restaurantId)
        throw new Error("Missing provisioned restaurant");
      const requests = await marketsService.listJoinRequests(
        result.restaurantId,
      );
      const request = requests.find(
        (candidate) =>
          candidate.restaurantId === result.restaurantId &&
          candidate.marketId === result.marketId &&
          candidate.status !== "rejected",
      );
      if (!request) throw new Error("Selected market request is unavailable");
      if (request.status !== "approved") {
        await marketsService.approveJoinRequest(request.id, {
          stallNumber: result.stallNumber,
        });
      }
      return { ...result, marketApproval: { status: "approved" } };
    } catch (error) {
      const apiError = error as {
        response?: { data?: { error?: { code?: string } } };
        code?: string;
      };
      return {
        ...result,
        marketApproval: {
          status: "pending",
          errorCode:
            apiError?.response?.data?.error?.code ??
            apiError?.code ??
            "MARKET_APPROVAL_FAILED",
        },
      };
    }
  },

  async regenerateSetupLink(
    applicationId: string,
  ): Promise<SetupPasswordLinkResult> {
    await ensureManagementAuthToken();
    const response = await managementApi.post<{
      ownerAccount?: ProvisionedOwnerAccount;
      credentialDelivery?: CredentialDelivery;
    }>(`/admin/onboarding/applications/${applicationId}/setup-link`, {});
    const result = unwrapApiPayload<{
      ownerAccount?: ProvisionedOwnerAccount;
      credentialDelivery?: CredentialDelivery;
    }>(response.data);
    if (!result.ownerAccount)
      throw new Error("Regenerated owner account is missing");
    return {
      ownerAccount: result.ownerAccount,
      credentialDelivery: result.credentialDelivery,
    };
  },

  async reject(
    applicationId: string,
    reason: string,
  ): Promise<{ status: "rejected" }> {
    await ensureManagementAuthToken();
    const response = await managementApi.post<{ status: "rejected" }>(
      `/admin/onboarding/applications/${applicationId}/reject`,
      { reason },
    );
    return unwrapApiPayload<{ status: "rejected" }>(response.data);
  },
};
