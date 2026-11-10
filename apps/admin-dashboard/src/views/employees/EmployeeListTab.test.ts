// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import EmployeeListTab from "./EmployeeListTab.vue";
import type { EmployeeWithStatus } from "@/types/employee";

vi.mock("@/i18n", () => ({
  t: (key: string) => key,
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({ user: { adminTier: "administrator" } }),
}));
vi.mock("@/composables/useDateFormatter", () => ({
  useDateFormatter: () => ({ formatDateTime: (v: string) => v }),
}));
vi.mock("@/composables/useConfirmModal", () => ({
  useConfirmModal: () => ({ confirm: vi.fn().mockResolvedValue(true) }),
}));

function buildUser(overrides: Partial<EmployeeWithStatus> = {}) {
  return {
    id: 7,
    username: "amy",
    fullName: "Amy Chen",
    email: "amy@example.com",
    role: 2,
    status: "active",
    ...overrides,
  } as unknown as EmployeeWithStatus;
}

function mountList() {
  return mount(EmployeeListTab, {
    props: { usersWithStatus: [buildUser()] },
  });
}

function stubCompact() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("EmployeeListTab at a compact viewport", () => {
  it("renders a card with the key fields and every action by name", () => {
    stubCompact();
    const wrapper = mountList();

    expect(wrapper.find("table").exists()).toBe(false);
    const card = wrapper.get('[data-testid="employee-card"]');
    expect(card.text()).toContain("Amy Chen");
    expect(card.text()).toContain("amy@example.com");
    expect(card.text()).toContain("employees.clockIn.off");
    for (const label of [
      "users.actions.edit",
      "users.actions.resetPassword",
      "users.actions.disable",
      "users.actions.archive",
    ]) {
      expect(card.find(`button[aria-label="${label}"]`).exists()).toBe(true);
    }
  });

  it("emits the row event from a card action", async () => {
    stubCompact();
    const wrapper = mountList();
    await wrapper
      .get(
        '[data-testid="employee-card"] button[aria-label="users.actions.edit"]',
      )
      .trigger("click");
    expect(wrapper.emitted("editUser")).toHaveLength(1);
  });

  it("keeps the table at a wide viewport", () => {
    expect(mountList().find("table").exists()).toBe(true);
  });
});
