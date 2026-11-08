// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ChangePasswordCard from "./ChangePasswordCard.vue";
import { api } from "@/services/api";

const toastSuccess = vi.fn();
const logout = vi.fn();
const push = vi.fn();

vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("vue-toastification", () => ({
  useToast: () => ({ success: toastSuccess, error: vi.fn() }),
}));
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/stores/auth", () => ({ useAuthStore: () => ({ logout }) }));
vi.mock("@/services/api", () => ({ api: { post: vi.fn() } }));

// Fixture values, not credentials.
const CURRENT = "Fixture@123";
const NEXT = "Fixture@456";

async function fill(
  wrapper: ReturnType<typeof mount>,
  current: string,
  next: string,
  confirm = next,
) {
  await wrapper
    .find('[data-testid="change-password-current"]')
    .setValue(current);
  await wrapper.find('[data-testid="change-password-new"]').setValue(next);
  await wrapper
    .find('[data-testid="change-password-confirm"]')
    .setValue(confirm);
  await wrapper.find("form").trigger("submit");
  await flushPromises();
}

const errorText = (wrapper: ReturnType<typeof mount>) =>
  wrapper.find('[data-testid="change-password-error"]').text();

describe("ChangePasswordCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("changes the password, then signs out and goes to login", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: { success: true },
    } as never);
    const wrapper = mount(ChangePasswordCard);

    await fill(wrapper, CURRENT, NEXT);

    expect(api.post).toHaveBeenCalledOnce();
    expect(api.post).toHaveBeenCalledWith(
      "/auth/change-password",
      expect.objectContaining({
        currentPassword: CURRENT,
        newPassword: NEXT,
        confirmPassword: NEXT,
      }),
    );
    expect(toastSuccess).toHaveBeenCalledOnce();
    expect(logout).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith("/login");
  });

  it.each([
    [
      "weak password",
      CURRENT,
      "weakpass",
      "weakpass",
      "accountManagement.passwordStrength",
    ],
    [
      "mismatch",
      CURRENT,
      NEXT,
      "Fixture@789",
      "users.resetPasswordModal.mismatch",
    ],
    [
      "same as current",
      CURRENT,
      CURRENT,
      CURRENT,
      "settings.security.changePassword.sameAsCurrent",
    ],
  ])(
    "rejects %s without calling the API",
    async (_, current, next, confirm, key) => {
      const wrapper = mount(ChangePasswordCard);
      await fill(wrapper, current, next, confirm);
      expect(api.post).not.toHaveBeenCalled();
      expect(errorText(wrapper)).toBe(key);
    },
  );

  it("shows the wrong-current-password message and stays signed in", async () => {
    vi.mocked(api.post).mockRejectedValueOnce({
      response: {
        status: 400,
        data: {
          success: false,
          error: { code: "PASSWORD_CHANGE_FAILED", message: "x" },
        },
      },
    });
    const wrapper = mount(ChangePasswordCard);

    await fill(wrapper, CURRENT, NEXT);

    expect(errorText(wrapper)).toBe("settings.security.changePassword.failed");
    expect(logout).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
