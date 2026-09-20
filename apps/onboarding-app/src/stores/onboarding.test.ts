import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useOnboardingStore, type ApplicationData } from "./onboarding";
import { onboardingApi, ApiError } from "@/services/api";

vi.mock("@/services/api", () => {
  class MockApiError extends Error {
    code: string;

    constructor(message: string, code: string) {
      super(message);
      this.name = "ApiError";
      this.code = code;
    }
  }

  return {
    ApiError: MockApiError,
    onboardingApi: {
      createApplication: vi.fn(),
    },
  };
});

const applicationData = (): ApplicationData => ({
  businessName: "Demo Noodles",
  contactName: "Lin Mei",
  contactEmail: "mei@example.com",
  contactPhone: "0912345678",
  address: "1 Fengjia Road",
  district: "Xitun District",
  city: "Taichung City",
  countryCode: "TW",
  marketId: "market-1",
  stallNumber: "A-12",
  latitude: 24.147736,
  longitude: 120.673648,
  planId: "professional",
  status: "pending",
});

beforeEach(() => {
  vi.clearAllMocks();
  setActivePinia(createPinia());
  sessionStorage.clear();
});

describe("useOnboardingStore", () => {
  it("submits applications without self-activating the tenant", async () => {
    vi.mocked(onboardingApi.createApplication).mockResolvedValue({
      applicationId: "app-123",
      applicationSecret: "secret-123",
      assignedSubdomain: "demo-noodles",
      status: "submitted",
    });
    const store = useOnboardingStore();
    const data = applicationData();

    await expect(store.submitApplication(data)).resolves.toBe(true);

    expect(store.applicationId).toBe("app-123");
    expect(store.assignedSubdomain).toBe("demo-noodles");
    expect(store.application).toEqual({ ...data, status: "submitted" });
    expect(store.completionResult).toBeNull();
    expect(store.isCompleted).toBe(true);
    expect(
      JSON.parse(sessionStorage.getItem("onboarding_application")!),
    ).toMatchObject({
      applicationId: "app-123",
      assignedSubdomain: "demo-noodles",
      application: { businessName: "Demo Noodles", status: "submitted" },
      completionResult: null,
    });
    expect(sessionStorage.getItem("onboarding_application")).not.toContain(
      "secret-123",
    );
  });

  it("captures API errors from failed application submission", async () => {
    vi.mocked(onboardingApi.createApplication).mockRejectedValue(
      new ApiError("Validation failed", "VALIDATION_ERROR"),
    );
    const store = useOnboardingStore();

    await expect(store.submitApplication(applicationData())).resolves.toBe(
      false,
    );

    expect(store.apiError).toBe("Validation failed");
    expect(store.isLoading).toBe(false);
  });

  it("resets persisted state", () => {
    const store = useOnboardingStore();
    store.setApplication(applicationData());

    store.reset();

    expect(store.application).toBeNull();
    expect(store.completionResult).toBeNull();
    expect(sessionStorage.getItem("onboarding_application")).toBeNull();
  });

  it("loads non-sensitive session state when the store initializes", () => {
    sessionStorage.setItem(
      "onboarding_application",
      JSON.stringify({
        application: { ...applicationData(), status: "submitted" },
        applicationId: "app-123",
        applicationSecret: "secret-123",
        assignedSubdomain: "demo-noodles",
        completionResult: null,
      }),
    );

    const store = useOnboardingStore();

    expect(store.applicationId).toBe("app-123");
    expect(store.applicationSecret).toBeNull();
    expect(store.application?.businessName).toBe("Demo Noodles");
    expect(store.assignedSubdomain).toBe("demo-noodles");
  });
});
