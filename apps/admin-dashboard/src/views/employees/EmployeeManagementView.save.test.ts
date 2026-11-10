// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EmployeeManagementView from "./EmployeeManagementView.vue";

const { createUser, toastError, toastSuccess } = vi.hoisted(() => ({
  createUser: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({ path: "/dashboard/employees" }),
}));
vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key} ${Object.values(params).join(" ")}` : key,
    locale: ref("zh-TW"),
  }),
}));
vi.mock("vue-toastification", () => ({
  useToast: () => ({ success: toastSuccess, error: toastError }),
}));
vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({
    restaurantId: "restaurant-1",
    user: { loginSlug: "noodle-bar" },
  }),
}));
vi.mock("@/services/api", () => ({ api: { get: vi.fn() } }));
vi.mock("@/services/leavesService", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/leavesService")>();
  return {
    ...actual,
    leavesService: { getRequests: vi.fn().mockResolvedValue([]) },
  };
});
vi.mock("@/composables/useEmployeeList", () => ({
  useEmployeeList: () => ({
    fetchAll: vi.fn(),
    fetchArchivedUsers: vi.fn(),
    createUser: (...args: unknown[]) => createUser(...args),
    usersWithStatus: ref([]),
    archivedUsers: ref([]),
    isLoading: ref(false),
    archivedLoading: ref(false),
    stats: ref({
      owner: 0,
      chef: 0,
      service: 0,
      cashier: 0,
      total: 0,
      currentlyWorking: 0,
      onLeaveToday: 0,
    }),
  }),
}));

async function openAndSubmit() {
  const wrapper = mount(EmployeeManagementView, {
    attachTo: document.body,
    global: {
      stubs: { RouterLink: { template: "<a><slot /></a>" }, RouterView: true },
    },
  });
  await wrapper.find("button").trigger("click"); // header "add employee"
  const [username, pw] = wrapper.findAll("form input");
  await username.setValue("newbie");
  await pw.setValue("QaTemp@2026xyz");
  await wrapper.find("form select").setValue("3");
  await wrapper.find("form").trigger("submit");
  return wrapper;
}

describe("EmployeeManagementView save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("tells the owner which link the new employee signs in at", async () => {
    createUser.mockResolvedValue(undefined);
    const wrapper = await openAndSubmit();
    await flushPromises();

    expect(toastSuccess).toHaveBeenCalledOnce();
    expect(toastSuccess).toHaveBeenCalledWith(
      expect.stringContaining(`${window.location.origin}/s/noodle-bar`),
    );
    wrapper.unmount();
  });

  it("sends one request when the form is submitted twice", async () => {
    createUser.mockReturnValue(new Promise(() => {}));
    const wrapper = await openAndSubmit();
    await wrapper.find("form").trigger("submit");
    expect(createUser).toHaveBeenCalledTimes(1);
    expect(wrapper.find('button[type="submit"]').text()).toBe("common.saving");
  });

  it("renders server validation details on the matching fields", async () => {
    createUser.mockRejectedValue({
      response: {
        data: {
          error: {
            code: "VALIDATION_ERROR",
            message: "Validation failed",
            details: [
              { field: "email", message: "Invalid email address" },
              { field: "password", message: "Password too weak" },
            ],
          },
        },
      },
    });
    const wrapper = await openAndSubmit();
    await flushPromises();
    expect(wrapper.find('[data-testid="error-email"]').text()).toBe(
      "Invalid email address",
    );
    expect(wrapper.find('[data-testid="error-password"]').text()).toBe(
      "Password too weak",
    );
    expect(toastError).not.toHaveBeenCalled();
    expect(
      wrapper.find('button[type="submit"]').attributes("disabled"),
    ).toBeUndefined();
  });

  it("falls back to a toast when the error is not field-scoped", async () => {
    createUser.mockRejectedValue({
      response: {
        data: { error: { code: "CONFLICT", message: "Username taken" } },
      },
    });
    await openAndSubmit();
    await flushPromises();
    expect(toastError).toHaveBeenCalledOnce();
    expect(toastError).toHaveBeenCalledWith(expect.any(String));
  });
});
