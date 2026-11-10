// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const confirm = vi.hoisted(() => vi.fn());
vi.mock("@/composables/useConfirmModal", () => ({
  useConfirmModal: () => ({ confirm }),
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

afterEach(() => {
  vi.unstubAllGlobals();
  confirm.mockReset();
});
beforeEach(() => confirm.mockResolvedValue(true));

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

// Disabling signs the employee out of every device mid-shift and re-enabling
// does not restore those sessions, so it must be confirmed (enabling need not).
describe("EmployeeListTab disable confirmation", () => {
  // Count only what the click does, not anything earlier tests left behind.
  const clickStatus = (wrapper: ReturnType<typeof mountList>) => {
    confirm.mockClear();
    return wrapper
      .findAll(
        'button[aria-label="users.actions.disable"], button[aria-label="users.actions.enable"]',
      )[0]
      .trigger("click");
  };

  it("asks before disabling and warns about the sign-out", async () => {
    stubCompact();
    const wrapper = mountList();
    await clickStatus(wrapper);
    await Promise.resolve();

    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "danger",
        message: "users.confirm.disable",
      }),
    );
    expect(wrapper.emitted("toggleStatus")).toHaveLength(1);
  });

  it("does nothing when the owner cancels", async () => {
    confirm.mockResolvedValue(false);
    stubCompact();
    const wrapper = mountList();
    await clickStatus(wrapper);
    await Promise.resolve();

    expect(wrapper.emitted("toggleStatus")).toBeUndefined();
  });

  it("enables a disabled employee without a dialog", async () => {
    stubCompact();
    const wrapper = mount(EmployeeListTab, {
      props: { usersWithStatus: [buildUser({ status: "inactive" })] },
    });
    await clickStatus(wrapper);
    await Promise.resolve();

    expect(confirm).not.toHaveBeenCalled();
    expect(wrapper.emitted("toggleStatus")).toHaveLength(1);
  });
});
