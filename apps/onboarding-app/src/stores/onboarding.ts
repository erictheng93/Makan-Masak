/**
 * Onboarding Store
 * 客戶申請流程狀態管理
 */

import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { SupportedCountryCode } from "@makanmasak/shared-types";
import {
  onboardingApi,
  ApiError,
  type CreateApplicationData,
} from "@/services/api";

export interface ApplicationData {
  businessName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  district: string;
  city: string;
  countryCode: SupportedCountryCode;
  marketId?: string;
  stallNumber?: string;
  latitude: number;
  longitude: number;
  planId: "trial" | "standard" | "professional" | "enterprise";
  status: "pending" | "submitted" | "approved" | "rejected";
}

export const useOnboardingStore = defineStore("onboarding", () => {
  // ============================================================
  // State
  // ============================================================

  const application = ref<ApplicationData | null>(null);
  const applicationId = ref<string | null>(null);
  const applicationSecret = ref<string | null>(null);
  const assignedSubdomain = ref<string | null>(null);
  const completionResult = ref<null>(null);

  // Loading states
  const isLoading = ref(false);

  // Error state
  const apiError = ref<string | null>(null);

  // ============================================================
  // Computed
  // ============================================================

  const isCompleted = computed(() => {
    return applicationId.value !== null;
  });

  // ============================================================
  // Actions
  // ============================================================

  /**
   * Submit an application. Platform admins review and activate it later.
   */
  async function submitApplication(
    data: CreateApplicationData,
  ): Promise<boolean> {
    isLoading.value = true;
    apiError.value = null;

    try {
      const result = await onboardingApi.createApplication(data);

      applicationId.value = result.applicationId;
      applicationSecret.value = result.applicationSecret;
      assignedSubdomain.value = result.assignedSubdomain;
      application.value = {
        ...data,
        status: "submitted",
      };

      saveToSession();

      return true;
    } catch (error) {
      if (error instanceof ApiError) {
        apiError.value = error.message;
      } else {
        apiError.value = "Failed to submit application";
      }
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Set application data (for form persistence)
   */
  function setApplication(data: ApplicationData) {
    application.value = data;
    saveToSession();
  }

  /**
   * Load from session storage
   */
  function loadFromSession() {
    const stored = sessionStorage.getItem("onboarding_application");
    if (stored) {
      try {
        const data = JSON.parse(stored);
        application.value = data.application || null;
        applicationId.value = data.applicationId || null;
        assignedSubdomain.value = data.assignedSubdomain || null;
      } catch {
        // Ignore parse errors
      }
    }
  }

  /**
   * Save to session storage
   */
  function saveToSession() {
    const data = {
      application: application.value,
      applicationId: applicationId.value,
      assignedSubdomain: assignedSubdomain.value,
      completionResult: null,
    };
    sessionStorage.setItem("onboarding_application", JSON.stringify(data));
  }

  /**
   * Reset all state
   */
  function reset() {
    application.value = null;
    applicationId.value = null;
    applicationSecret.value = null;
    assignedSubdomain.value = null;
    apiError.value = null;
    sessionStorage.removeItem("onboarding_application");
  }

  /**
   * Clear error
   */
  function clearError() {
    apiError.value = null;
  }

  // Initialize from session
  loadFromSession();

  return {
    // State
    application,
    applicationId,
    applicationSecret,
    assignedSubdomain,
    completionResult,
    isLoading,
    apiError,

    // Computed
    isCompleted,

    // Actions
    submitApplication,
    setApplication,
    loadFromSession,
    reset,
    clearError,
  };
});
