// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createForOwner: vi.fn() }));

vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@/services/onboardingApplicationsService", () => ({
  onboardingApplicationsService: { createForOwner: mocks.createForOwner },
}));
vi.mock("@/services/marketsService", () => ({
  marketsService: { listMarkets: vi.fn(async () => []) },
}));

import OperatorOnboardingDialog from "./OperatorOnboardingDialog.vue";

async function fill(wrapper: ReturnType<typeof mount>) {
  const set = (id: string, value: string) =>
    wrapper.get(`[data-testid="${id}"]`).setValue(value);
  await set("operator-business-name", "Laksa Bar");
  await set("operator-contact-name", "Tan Mei");
  await set("operator-contact-email", "mei@example.test");
  await set("operator-contact-phone", "0123456789");
  await set("operator-latitude", "3.13");
  await set("operator-longitude", "101.68");
}

const languageOf = (wrapper: ReturnType<typeof mount>) =>
  (
    wrapper.get('[data-testid="operator-email-language"]')
      .element as HTMLSelectElement
  ).value;

describe("OperatorOnboardingDialog email language", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createForOwner.mockResolvedValue({ application: {}, approval: null });
  });

  it("defaults to the country's language and sends the operator's choice", async () => {
    const wrapper = mount(OperatorOnboardingDialog);
    await flushPromises();
    expect(languageOf(wrapper)).toBe("zh-TW");

    await wrapper.get('[data-testid="operator-country"]').setValue("MY");
    expect(languageOf(wrapper)).toBe("ms-MY");

    await wrapper
      .get('[data-testid="operator-email-language"]')
      .setValue("en-US");
    await fill(wrapper);
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(mocks.createForOwner).toHaveBeenCalledOnce();
    expect(mocks.createForOwner).toHaveBeenCalledWith(
      expect.objectContaining({ countryCode: "MY", locale: "en-US" }),
    );
  });
});
