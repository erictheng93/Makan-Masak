import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requestStatusLink: vi.fn() }));

vi.mock("vue-router", () => ({
  RouterLink: { props: ["to"], template: '<a :href="to"><slot /></a>' },
}));
vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@/services/api", () => {
  class MockApiError extends Error {
    constructor(
      message: string,
      public code: string,
    ) {
      super(message);
    }
  }
  return {
    ApiError: MockApiError,
    onboardingApi: { requestStatusLink: mocks.requestStatusLink },
  };
});

import FindApplicationView from "./FindApplicationView.vue";
import { ApiError } from "@/services/api";

async function requestFor(email: string) {
  const wrapper = mount(FindApplicationView);
  await wrapper.get('[data-testid="find-application-email"]').setValue(email);
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  return wrapper;
}

describe("FindApplicationView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requestStatusLink.mockResolvedValue(undefined);
  });

  it("asks the server for the link and shows the same neutral confirmation", async () => {
    const wrapper = await requestFor("  mei@example.test ");

    expect(mocks.requestStatusLink).toHaveBeenCalledOnce();
    expect(mocks.requestStatusLink).toHaveBeenCalledWith("mei@example.test");
    expect(wrapper.get('[data-testid="find-application-sent"]').text()).toBe(
      "findApplication.sent",
    );
    expect(wrapper.find("form").exists()).toBe(false);
  });

  it("checks the email format before calling the server", async () => {
    const wrapper = await requestFor("not-an-email");

    expect(mocks.requestStatusLink).not.toHaveBeenCalled();
    expect(wrapper.get('[role="alert"]').text()).toBe(
      "findApplication.invalidEmail",
    );
  });

  it("explains the rate limit instead of claiming the link was sent", async () => {
    mocks.requestStatusLink.mockRejectedValue(
      new ApiError("Too many", "RATE_LIMITED"),
    );

    const wrapper = await requestFor("mei@example.test");

    expect(wrapper.get('[role="alert"]').text()).toBe(
      "apply.submitErrors.rateLimited",
    );
    expect(wrapper.find('[data-testid="find-application-sent"]').exists()).toBe(
      false,
    );
  });
});
