// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import EmployeeFormModal from "./EmployeeFormModal.vue";

vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

function mountModal(props: Record<string, unknown> = {}) {
  return mount(EmployeeFormModal, { props: { isOpen: true, ...props } });
}

async function fillCreate(
  wrapper: ReturnType<typeof mountModal>,
  password: string,
) {
  const [username, pw] = wrapper.findAll("input");
  await username.setValue("newbie");
  await pw.setValue(password);
  await wrapper.find("select").setValue("3");
}

describe("EmployeeFormModal", () => {
  it("shows the password rule and blocks a weak password before emitting", async () => {
    const wrapper = mountModal();
    expect(wrapper.find('[data-testid="password-hint"]').text()).toBe(
      "users.modal.passwordHint",
    );

    await fillCreate(wrapper, "alllowercase1");
    await wrapper.find("form").trigger("submit");
    expect(wrapper.emitted("save")).toBeUndefined();
  });

  it("emits save for a password that satisfies the server rule", async () => {
    const wrapper = mountModal();
    await fillCreate(wrapper, "QaTemp@2026xyz");
    await wrapper.find("form").trigger("submit");
    expect(wrapper.emitted("save")).toHaveLength(1);
    expect(wrapper.emitted("save")![0][1]).toBe(false);
  });

  it("renders server field errors under the matching fields", () => {
    const wrapper = mountModal({
      fieldErrors: { email: "Invalid email address", password: "Too weak" },
    });
    expect(wrapper.find('[data-testid="error-email"]').text()).toBe(
      "Invalid email address",
    );
    expect(wrapper.find('[data-testid="error-password"]').text()).toBe(
      "Too weak",
    );
  });

  it("disables submit, shows saving text, and ignores submits while saving", async () => {
    const wrapper = mountModal({ saving: true });
    const submit = wrapper.find('button[type="submit"]');
    expect(submit.attributes("disabled")).toBeDefined();
    expect(submit.text()).toBe("common.saving");

    await fillCreate(wrapper, "Valid@2026pw");
    await wrapper.find("form").trigger("submit");
    expect(wrapper.emitted("save")).toBeUndefined();
  });
});
