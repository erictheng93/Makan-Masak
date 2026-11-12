// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/services/api";

const { confirm, replace, route, toast } = vi.hoisted(() => ({
  confirm: vi.fn(),
  replace: vi.fn(),
  route: { path: "/dashboard/settings", query: {} as Record<string, string> },
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("vue-router", () => ({
  useRoute: () => route,
  useRouter: () => ({ replace }),
}));
vi.mock("vue-toastification", () => ({ useToast: () => toast }));
vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: { value: "zh-TW" },
  }),
}));
vi.mock("@/composables/useConfirmModal", () => ({
  useConfirmModal: () => ({ confirm }),
}));
vi.mock("@/composables/useDateFormatter", () => ({
  useDateFormatter: () => ({ formatDate: () => "2026-11-01" }),
}));
vi.mock("@/services/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  resolveApiBase: () => "/api/v1",
  unwrapApiData: (r: { data: { data: unknown } }) => r.data.data,
}));

const assign = vi.fn();
let Card: typeof import("./SignInMethodsCard.vue").default;

beforeAll(async () => {
  Card = (await import("./SignInMethodsCard.vue")).default;
}, 30_000);

const googleIdentity = {
  id: "i1",
  provider: "google",
  email: "o@example.com",
  displayName: "Olive",
  avatarUrl: null,
  linkedAt: "2026-11-01T02:00:00.000Z",
  lastUsedAt: null,
};

function stubGets(providers: string[], identities: unknown[]) {
  vi.mocked(api.get).mockImplementation((async (url: string) => ({
    data: {
      success: true,
      data: url === "/auth/identities" ? identities : { providers },
    },
  })) as never);
}

async function mountCard() {
  const wrapper = mount(Card);
  await flushPromises();
  return wrapper;
}

describe("SignInMethodsCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    route.query = {};
    vi.stubGlobal("location", { ...window.location, assign });
    stubGets(["google", "line"], [googleIdentity]);
  });

  it("renders nothing when no provider is configured", async () => {
    stubGets([], []);
    const wrapper = await mountCard();
    expect(wrapper.find('[data-testid="signin-methods-card"]').exists()).toBe(
      false,
    );
  });

  it("lists identities and offers only unlinked providers", async () => {
    const wrapper = await mountCard();
    expect(wrapper.get('[data-testid="identity-i1"]').text()).toContain(
      "Olive",
    );
    expect(wrapper.find('[data-testid="link-google"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="link-line"]').exists()).toBe(true);
  });

  it("calls link/start then navigates to the authorize URL", async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: { success: true, data: { authorizeUrl: "https://idp.test/auth" } },
    } as never);
    const wrapper = await mountCard();

    await wrapper.get('[data-testid="link-line"]').trigger("click");
    await flushPromises();

    expect(api.post).toHaveBeenCalledOnce();
    expect(api.post).toHaveBeenCalledWith(
      expect.stringContaining("/auth/oauth/line/link/start?redirectTo="),
    );
    expect(assign).toHaveBeenCalledWith("https://idp.test/auth");
  });

  it("unlinks after confirmation and refreshes the list", async () => {
    confirm.mockResolvedValue(true);
    vi.mocked(api.delete).mockResolvedValue({
      data: { success: true },
    } as never);
    const wrapper = await mountCard();
    const listCalls = () =>
      vi.mocked(api.get).mock.calls.filter((c) => c[0] === "/auth/identities")
        .length;
    const before = listCalls();

    await wrapper.get('[data-testid="unlink-i1"]').trigger("click");
    await flushPromises();

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ type: "danger" }),
    );
    expect(api.delete).toHaveBeenCalledWith("/auth/identities/i1");
    expect(listCalls()).toBe(before + 1);
    expect(toast.success).toHaveBeenCalledOnce();
  });

  it("shows guidance on 409 LAST_AUTH_METHOD", async () => {
    confirm.mockResolvedValue(true);
    vi.mocked(api.delete).mockRejectedValue({
      response: {
        status: 409,
        data: { success: false, error: { code: "LAST_AUTH_METHOD" } },
      },
    });
    const wrapper = await mountCard();

    await wrapper.get('[data-testid="unlink-i1"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[data-testid="signin-methods-error"]').text()).toBe(
      "settings.security.signInMethods.lastMethod",
    );
  });

  it("strips oauth_linked and toasts success", async () => {
    route.query = { tab: "security", oauth_linked: "line" };
    await mountCard();
    expect(replace).toHaveBeenCalledWith(
      expect.objectContaining({ query: { tab: "security" } }),
    );
    expect(toast.success).toHaveBeenCalledOnce();
  });

  it("strips oauth_error and toasts the mapped message", async () => {
    route.query = { oauth_error: "OAUTH_IDENTITY_ALREADY_LINKED" };
    await mountCard();
    expect(replace).toHaveBeenCalledOnce();
    expect(toast.error).toHaveBeenCalledWith(
      "auth.oauth.errors.OAUTH_IDENTITY_ALREADY_LINKED",
    );
  });
});
