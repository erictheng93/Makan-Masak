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
});
