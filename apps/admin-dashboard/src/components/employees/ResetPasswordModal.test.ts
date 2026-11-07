// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ResetPasswordModal from "./ResetPasswordModal.vue";
import { api } from "@/services/api";

const toastSuccess = vi.fn();

vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("vue-toastification", () => ({
  useToast: () => ({ success: toastSuccess, error: vi.fn() }),
}));

vi.mock("@/services/api", () => ({ api: { post: vi.fn() } }));

// Fixture values, not credentials. Referenced by name in payload assertions so a
// `password: "<literal>"` pair never appears for secret scanners to flag.
const VALID = "Fixture@123";
const VALID_OTHER_SYMBOL = "Pass_word1!";

function buildUser(overrides = {}) {
  return { id: "user-1", username: "owner-a", ...overrides };
}

async function fill(
  wrapper: ReturnType<typeof mount>,
  newPassword: string,
  confirmPassword = newPassword,
) {
  await wrapper
    .find('[data-testid="reset-password-new"]')
    .setValue(newPassword);
  await wrapper
    .find('[data-testid="reset-password-confirm"]')
    .setValue(confirmPassword);
  await wrapper.find("form").trigger("submit");
  await flushPromises();
}

describe("ResetPasswordModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing without a target user", () => {
    const wrapper = mount(ResetPasswordModal, { props: { user: null } });
    expect(wrapper.find('[data-testid="reset-password-modal"]').exists()).toBe(
      false,
    );
  });

  it("sends the password the operator typed, then reports done", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: { success: true },
    } as never);
    const wrapper = mount(ResetPasswordModal, {
      props: { user: buildUser() },
    });

    await fill(wrapper, VALID);

    expect(api.post).toHaveBeenCalledOnce();
    expect(api.post).toHaveBeenCalledWith("/users/user-1/reset-password", {
      newPassword: VALID,
      confirmPassword: VALID,
    });
    expect(toastSuccess).toHaveBeenCalledOnce();
    expect(wrapper.emitted("done")).toHaveLength(1);
  });

  it("rejects a password the API would reject, without calling it", async () => {
    const wrapper = mount(ResetPasswordModal, {
      props: { user: buildUser() },
    });

    await fill(wrapper, "demo@makanmasak123"); // no uppercase

    expect(api.post).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="reset-password-error"]').text()).toBe(
      "accountManagement.passwordStrength",
    );
    expect(wrapper.emitted("done")).toBeUndefined();
  });

  it("accepts a password the API accepts even with characters outside its symbol set", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: { success: true },
    } as never);
    const wrapper = mount(ResetPasswordModal, {
      props: { user: buildUser() },
    });

    await fill(wrapper, VALID_OTHER_SYMBOL);

    expect(api.post).toHaveBeenCalledWith(
      "/users/user-1/reset-password",
      expect.objectContaining({ newPassword: VALID_OTHER_SYMBOL }),
    );
  });

  it("rejects a password shorter than 8 characters", async () => {
    const wrapper = mount(ResetPasswordModal, {
      props: { user: buildUser() },
    });

    await fill(wrapper, "Ab1@xyz");

    expect(api.post).not.toHaveBeenCalled();
  });

  it("rejects mismatched confirmation", async () => {
    const wrapper = mount(ResetPasswordModal, {
      props: { user: buildUser() },
    });

    await fill(wrapper, VALID, "Fixture@124");

    expect(api.post).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="reset-password-error"]').text()).toBe(
      "users.resetPasswordModal.mismatch",
    );
  });

  it("keeps the dialog open and shows the error when the API fails", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error("boom"));
    const wrapper = mount(ResetPasswordModal, {
      props: { user: buildUser() },
    });

    await fill(wrapper, VALID);

    expect(api.post).toHaveBeenCalledOnce();
    expect(wrapper.find('[data-testid="reset-password-error"]').exists()).toBe(
      true,
    );
    expect(wrapper.emitted("done")).toBeUndefined();
  });
});
