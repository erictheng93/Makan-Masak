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

  async approve(
    applicationId: string,
  ): Promise<ApproveOnboardingApplicationResult> {
    await ensureManagementAuthToken();
    const response =
      await managementApi.post<ApproveOnboardingApplicationResult>(
        `/admin/onboarding/applications/${applicationId}/approve`,
        {},
      );
    return unwrapApiPayload<ApproveOnboardingApplicationResult>(response.data);
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
