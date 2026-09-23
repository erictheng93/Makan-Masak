import { beforeAll, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => {
  const state: {
    user: { id: string } | null;
    token: string | null;
    isAuthenticated: boolean;
    checkAuth: ReturnType<typeof vi.fn>;
  } = {
    user: { id: "customer-1" },
    token: null,
    isAuthenticated: false,
    checkAuth: vi.fn(),
  };
  state.checkAuth.mockImplementation(async () => {
    state.token = "restored-access-token";
    state.isAuthenticated = true;
    return true;
  });
  return state;
});

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => authState,
}));
vi.mock("@/views/HomeView.vue", () => ({ default: { template: "<div />" } }));
vi.mock("@/views/QRScanView.vue", () => ({ default: { template: "<div />" } }));
vi.mock("@/views/LoginView.vue", () => ({ default: { template: "<div />" } }));
vi.mock("@/views/OrderHistoryView.vue", () => ({
  default: { template: "<div />" },
}));

describe("member session restoration on customer routes", () => {
  beforeAll(async () => {
    await import("@/router");
  }, 30_000);

  it("restores a hydrated member once when loading public menu routes", async () => {
    const { default: router } = await import("@/router");

    await router.push("/menu");
    await router.push("/scan");

    expect(authState.checkAuth).toHaveBeenCalledOnce();
    expect(authState.token).toBe("restored-access-token");
  });

  it("does not reuse that restore after the member logs out", async () => {
    const { default: router } = await import("@/router");

    // authStore.logout() clears both, and revokes the refresh cookie, so a
    // fresh check fails. The restore remembered from before the logout must
    // not send the member back into their account.
    authState.user = null;
    authState.token = null;
    authState.isAuthenticated = false;
    authState.checkAuth.mockResolvedValue(false);

    await router.push("/login");
    expect(router.currentRoute.value.path).toBe("/login");

    await router.push("/orders");
    expect(router.currentRoute.value.path).toBe("/login");
  });
});
