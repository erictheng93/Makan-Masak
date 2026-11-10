// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StaffLoginLinkCard from "./StaffLoginLinkCard.vue";
import { api } from "@/services/api";

vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("vue-toastification", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/services/api", () => ({ api: { put: vi.fn() } }));

function mountCard(loginSlug: string | null = "noodle-bar") {
  return mount(StaffLoginLinkCard, {
    props: { restaurantId: "r-1", loginSlug },
  });
}

describe("StaffLoginLinkCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the admin and kitchen links for the current code", () => {
    const wrapper = mountCard();

    expect(
      wrapper.get<HTMLInputElement>('[data-testid="staff-login-admin-url"]')
        .element.value,
    ).toBe(`${window.location.origin}/s/noodle-bar`);
    expect(
      wrapper
        .get<HTMLInputElement>('[data-testid="staff-login-kitchen-url"]')
        .element.value.endsWith("/s/noodle-bar"),
    ).toBe(true);
  });

  it("rejects reserved and malformed codes without calling the API", async () => {
    const wrapper = mountCard();
    const input = wrapper.get('[data-testid="staff-login-slug-input"]');

    await input.setValue("admin");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.get('[data-testid="staff-login-slug-error"]').text()).toBe(
      "settings.staffLogin.reserved",
    );

    await input.setValue("-bad-");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.get('[data-testid="staff-login-slug-error"]').text()).toBe(
      "settings.staffLogin.invalid",
    );
    expect(api.put).not.toHaveBeenCalled();
  });

  it("saves a valid code and emits it", async () => {
    vi.mocked(api.put).mockResolvedValue({
      data: { success: true, data: { loginSlug: "new-code" } },
    } as never);
    const wrapper = mountCard();

    await wrapper
      .get('[data-testid="staff-login-slug-input"]')
      .setValue("new-code");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(api.put).toHaveBeenCalledOnce();
    expect(api.put).toHaveBeenCalledWith("/restaurants/r-1/login-slug", {
      loginSlug: "new-code",
    });
    expect(wrapper.emitted("saved")).toEqual([["new-code"]]);
  });

  it("maps a 409 SLUG_TAKEN onto the field", async () => {
    vi.mocked(api.put).mockRejectedValue({
      response: {
        status: 409,
        data: {
          success: false,
          error: {
            code: "SLUG_TAKEN",
            message: "taken",
            details: [{ field: "loginSlug" }],
          },
        },
      },
    });
    const wrapper = mountCard();

    await wrapper
      .get('[data-testid="staff-login-slug-input"]')
      .setValue("taken-code");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(wrapper.get('[data-testid="staff-login-slug-error"]').text()).toBe(
      "settings.staffLogin.taken",
    );
    expect(wrapper.emitted("saved")).toBeUndefined();
  });
});
