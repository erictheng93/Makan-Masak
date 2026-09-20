import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  getMarkets: vi.fn(),
  submitApplication: vi.fn(),
  store: {
    application: null as Record<string, unknown> | null,
    applicationSecret: "tracking-secret" as string | null,
    apiError: null as string | null,
    isLoading: false,
    clearError: vi.fn(),
  },
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("vue-toastification", () => ({
  useToast: () => ({
    error: mocks.toastError,
    success: mocks.toastSuccess,
  }),
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (key: string) =>
      key === "apply.form.market.independent"
        ? "我是獨立店面，不屬於任何商圈"
        : key,
  }),
}));

vi.mock("@/services/api", () => ({
  onboardingApi: {
    getMarkets: mocks.getMarkets,
  },
}));

vi.mock("@/stores/onboarding", () => ({
  useOnboardingStore: () => ({
    ...mocks.store,
    submitApplication: mocks.submitApplication,
  }),
}));

import ApplyView from "./ApplyView.vue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function chooseTaiwanCity(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('[data-testid="onboarding-country"]').setValue("TW");
  await wrapper.get('[data-testid="onboarding-city"]').setValue("台中市");
  await flushPromises();
}

async function fillRequiredFields(wrapper: ReturnType<typeof mount>) {
  await wrapper
    .get('[data-testid="onboarding-business-name"]')
    .setValue("Demo Noodles");
  await wrapper
    .get('[data-testid="onboarding-contact-name"]')
    .setValue("Lin Mei");
  await wrapper
    .get('[data-testid="onboarding-contact-email"]')
    .setValue("mei@example.test");
  await wrapper
    .get('[data-testid="onboarding-contact-phone"]')
    .setValue("0912345678");
  await wrapper
    .get('[data-testid="onboarding-latitude"]')
    .setValue("24.147736");
  await wrapper
    .get('[data-testid="onboarding-longitude"]')
    .setValue("120.673648");
  await wrapper
    .get('[data-testid="onboarding-address"]')
    .setValue("1 Fengjia Road");
  await wrapper
    .get('[data-testid="onboarding-district"]')
    .setValue("Xitun District");
  await chooseTaiwanCity(wrapper);
}

describe("ApplyView locale and market selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.store.application = null;
    mocks.store.applicationSecret = "tracking-secret";
    mocks.store.apiError = null;
    mocks.store.isLoading = false;
    mocks.getMarkets.mockResolvedValue([]);
    mocks.submitApplication.mockResolvedValue(true);
  });

  it("starts without guessing a country and keeps downstream choices disabled", () => {
    const wrapper = mount(ApplyView);

    expect(
      (
        wrapper.get('[data-testid="onboarding-country"]')
          .element as HTMLSelectElement
      ).value,
    ).toBe("");
    expect(
      wrapper.get('[data-testid="onboarding-city"]').attributes("disabled"),
    ).toBeDefined();
    expect(
      wrapper.get('[data-testid="onboarding-market"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("only offers cities that belong to the chosen country", async () => {
    const wrapper = mount(ApplyView);

    await wrapper.get('[data-testid="onboarding-country"]').setValue("MY");

    const cityOptions = wrapper
      .get('[data-testid="onboarding-city"]')
      .findAll("option")
      .map((option) => option.text());

    expect(cityOptions).toContain("Kuala Lumpur");
    expect(cityOptions).not.toContain("台中市");
  });

  it("clears city, market, and stall when the country changes", async () => {
    mocks.getMarkets.mockResolvedValue([
      { id: "market-1", name: "Fengjia Market" },
    ]);
    const wrapper = mount(ApplyView);

    await wrapper
      .get('[data-testid="onboarding-business-name"]')
      .setValue("Keeps its value");
    await chooseTaiwanCity(wrapper);
    await wrapper.get('[data-testid="onboarding-market"]').setValue("market-1");
    await wrapper
      .get('[data-testid="onboarding-stall-number"]')
      .setValue("A-12");
    await wrapper.get('[data-testid="onboarding-country"]').setValue("MY");

    expect(
      (
        wrapper.get('[data-testid="onboarding-city"]')
          .element as HTMLSelectElement
      ).value,
    ).toBe("");
    expect(
      (
        wrapper.get('[data-testid="onboarding-market"]')
          .element as HTMLSelectElement
      ).value,
    ).toBe("");
    expect(
      wrapper.find('[data-testid="onboarding-stall-number"]').exists(),
    ).toBe(false);
    expect(
      (
        wrapper.get('[data-testid="onboarding-business-name"]')
          .element as HTMLInputElement
      ).value,
    ).toBe("Keeps its value");
  });

  it("offers an explicit independent-shop choice before fetched markets", async () => {
    mocks.getMarkets.mockResolvedValue([
      { id: "market-1", name: "Fengjia Market" },
    ]);
    const wrapper = mount(ApplyView);

    await chooseTaiwanCity(wrapper);

    const marketOptions = wrapper
      .get('[data-testid="onboarding-market"]')
      .findAll("option")
      .map((option) => option.text());

    expect(marketOptions).toEqual([
      "我是獨立店面，不屬於任何商圈",
      "Fengjia Market",
    ]);
    expect(mocks.getMarkets).toHaveBeenCalledWith({
      country: "TW",
      city: "台中市",
    });
  });

  it("clears the market and stall when the city changes", async () => {
    mocks.getMarkets.mockResolvedValue([
      { id: "market-1", name: "Fengjia Market" },
    ]);
    const wrapper = mount(ApplyView);

    await chooseTaiwanCity(wrapper);
    await wrapper.get('[data-testid="onboarding-market"]').setValue("market-1");
    await wrapper
      .get('[data-testid="onboarding-stall-number"]')
      .setValue("A-12");
    await wrapper.get('[data-testid="onboarding-city"]').setValue("臺北市");
    await flushPromises();

    expect(
      (
        wrapper.get('[data-testid="onboarding-market"]')
          .element as HTMLSelectElement
      ).value,
    ).toBe("");
    expect(
      wrapper.find('[data-testid="onboarding-stall-number"]').exists(),
    ).toBe(false);
  });

  it("ignores a stale market response after the selected city changes", async () => {
    const taichung = deferred<Array<{ id: string; name: string }>>();
    mocks.getMarkets
      .mockReturnValueOnce(taichung.promise)
      .mockResolvedValueOnce([{ id: "taipei", name: "Taipei Market" }]);
    const wrapper = mount(ApplyView);

    await wrapper.get('[data-testid="onboarding-country"]').setValue("TW");
    await wrapper.get('[data-testid="onboarding-city"]').setValue("台中市");
    await wrapper.get('[data-testid="onboarding-city"]').setValue("臺北市");
    await flushPromises();

    taichung.resolve([{ id: "taichung", name: "Taichung Market" }]);
    await flushPromises();

    expect(wrapper.text()).toContain("Taipei Market");
    expect(wrapper.text()).not.toContain("Taichung Market");
  });

  it("ignores a stale market error and shows an error for the current city", async () => {
    const staleRequest = deferred<Array<{ id: string; name: string }>>();
    mocks.getMarkets
      .mockReturnValueOnce(staleRequest.promise)
      .mockRejectedValueOnce(new Error("current request failed"));
    const wrapper = mount(ApplyView);

    await wrapper.get('[data-testid="onboarding-country"]').setValue("TW");
    await wrapper.get('[data-testid="onboarding-city"]').setValue("台中市");
    await wrapper.get('[data-testid="onboarding-city"]').setValue("臺北市");
    await flushPromises();

    expect(wrapper.text()).toContain("apply.form.market.fetchError");

    staleRequest.reject(new Error("stale request failed"));
    await flushPromises();

    expect(wrapper.text()).toContain("apply.form.market.fetchError");
  });

  it("normalizes an unsupported persisted country without discarding other draft fields", () => {
    mocks.store.application = {
      businessName: "Legacy Shop",
      contactName: "Owner",
      contactEmail: "owner@example.test",
      contactPhone: "0123456789",
      address: "Legacy address",
      district: "Legacy district",
      city: "Legacy city",
      countryCode: "SG",
      latitude: 1.3,
      longitude: 103.8,
      marketId: "old-market",
      planId: "trial",
      stallNumber: "9",
      status: "pending",
    };

    const wrapper = mount(ApplyView);

    expect(
      (
        wrapper.get('[data-testid="onboarding-country"]')
          .element as HTMLSelectElement
      ).value,
    ).toBe("");
    expect(
      (
        wrapper.get('[data-testid="onboarding-city"]')
          .element as HTMLSelectElement
      ).value,
    ).toBe("");
    expect(
      (
        wrapper.get('[data-testid="onboarding-business-name"]')
          .element as HTMLInputElement
      ).value,
    ).toBe("Legacy Shop");
    expect(
      wrapper.find('[data-testid="onboarding-stall-number"]').exists(),
    ).toBe(false);
  });

  it("omits empty market fields from an independent-shop submission", async () => {
    const wrapper = mount(ApplyView);
    await fillRequiredFields(wrapper);

    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(mocks.submitApplication).toHaveBeenCalledWith({
      businessName: "Demo Noodles",
      contactName: "Lin Mei",
      contactEmail: "mei@example.test",
      contactPhone: "0912345678",
      address: "1 Fengjia Road",
      district: "Xitun District",
      city: "台中市",
      countryCode: "TW",
      latitude: 24.147736,
      longitude: 120.673648,
      planId: "trial",
    });
  });

  it("submits the selected market and stall and never sends a stale independent-shop stall", async () => {
    mocks.getMarkets.mockResolvedValue([
      { id: "market-1", name: "Fengjia Market" },
    ]);
    const wrapper = mount(ApplyView);
    await fillRequiredFields(wrapper);
    await wrapper.get('[data-testid="onboarding-market"]').setValue("market-1");
    await wrapper
      .get('[data-testid="onboarding-stall-number"]')
      .setValue("A-12");

    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(mocks.submitApplication).toHaveBeenCalledWith(
      expect.objectContaining({ marketId: "market-1", stallNumber: "A-12" }),
    );

    mocks.submitApplication.mockClear();

    await wrapper.get('[data-testid="onboarding-market"]').setValue("");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(mocks.submitApplication).toHaveBeenCalledWith(
      expect.not.objectContaining({ marketId: expect.anything() }),
    );
    expect(mocks.submitApplication).toHaveBeenCalledWith(
      expect.not.objectContaining({ stallNumber: expect.anything() }),
    );
  });
});
