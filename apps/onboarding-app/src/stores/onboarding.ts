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

// In-progress form, kept apart from the submitted application so a reload
// (or a chunk-recovery reload after a deploy) does not wipe the applicant's work.
const DRAFT_KEY = "onboarding_draft";
const DRAFT_STRING_FIELDS = [
  "businessName",
  "contactName",
  "contactEmail",
  "contactPhone",
  "address",
  "district",
  "countryCode",
  "city",
  "marketId",
  "stallNumber",
] as const;

export type ApplicationDraft = Partial<
  Record<(typeof DRAFT_STRING_FIELDS)[number], string>
> & { latitude?: number | null; longitude?: number | null };

function readDraft(): ApplicationDraft | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "null");
    if (!raw || typeof raw !== "object") return null;
    const draft: ApplicationDraft = {};
    for (const key of DRAFT_STRING_FIELDS) {
      if (typeof raw[key] === "string") draft[key] = raw[key];
    }
    for (const key of ["latitude", "longitude"] as const) {
      if (typeof raw[key] === "number" && Number.isFinite(raw[key])) {
        draft[key] = raw[key];
      }
    }
    return draft;
  } catch {
    return null; // corrupt or unreadable: start with an empty form
  }
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
  const draft = ref<ApplicationDraft | null>(readDraft());

  // Loading states
  const isLoading = ref(false);

  // Error state: the server's error code. The page translates it; the
  // server message itself is English and never shown to applicants.
  const apiErrorCode = ref<string | null>(null);

  // ============================================================
  // Computed
  // ============================================================

  const isCompleted = computed(() => {
    return application.value?.status === "submitted";
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
    apiErrorCode.value = null;

    try {
      const result = await onboardingApi.createApplication(data);

      // Present only when the server has email off; otherwise the status
      // link is in the applicant's inbox and nowhere else.
      applicationId.value = result.applicationId ?? null;
      applicationSecret.value = result.applicationSecret ?? null;
      assignedSubdomain.value = result.assignedSubdomain ?? null;
      application.value = {
        ...data,
        status: "submitted",
      };

      clearDraft();
      saveToSession();

      return true;
    } catch (error) {
      apiErrorCode.value =
        error instanceof ApiError ? error.code : "UNKNOWN_ERROR";
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

  function saveDraft(data: ApplicationDraft) {
    draft.value = data;
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(data));
    } catch {
      // Storage full or blocked: the form still works, it just won't survive a reload.
    }
  }

  function clearDraft() {
    draft.value = null;
    sessionStorage.removeItem(DRAFT_KEY);
  }

  /**
   * Reset all state
   */
  function reset() {
    application.value = null;
    applicationId.value = null;
    applicationSecret.value = null;
    assignedSubdomain.value = null;
    apiErrorCode.value = null;
    sessionStorage.removeItem("onboarding_application");
    clearDraft();
  }

  /**
   * Clear error
   */
  function clearError() {
    apiErrorCode.value = null;
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
    draft,
    isLoading,
    apiErrorCode,

    // Computed
    isCompleted,

    // Actions
    submitApplication,
    setApplication,
    saveDraft,
    clearDraft,
    loadFromSession,
    reset,
    clearError,
  };
});
