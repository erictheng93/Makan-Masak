/**
 * The follow button is the only write path a diner has into the broadcast
 * audience, so the three cases here are the three ways it can be wrong: showing
 * the opposite state, sending the wrong call, and silently doing nothing when
 * nobody is signed in.
 */

import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const followingMocks = vi.hoisted(() => ({
  followed: new Set<string>(),
  ensureLoaded: vi.fn(async () => {}),
  toggle: vi.fn(async () => true),
  hasSession: vi.fn(() => true),
}));

vi.mock("@/composables/useFollowing", () => ({
  useFollowing: () => ({
    ensureLoaded: followingMocks.ensureLoaded,
    toggle: followingMocks.toggle,
    isFollowing: (targetType: string, targetId: string) =>
      followingMocks.followed.has(`${targetType}:${targetId}`),
  }),
  hasCustomerSession: () => followingMocks.hasSession(),
}));

const routerMocks = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: routerMocks.push }),
  useRoute: () => ({ fullPath: "/markets/fengjia" }),
}));

const toastMocks = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock("vue-toastification", () => ({
  useToast: () => toastMocks,
}));

vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tWithParams: (key: string, params: Record<string, unknown>) =>
      `${key}:${Object.values(params).join(",")}`,
  }),
}));

import FollowButton from "@/components/follow/FollowButton.vue";

function mountButton(props: Record<string, unknown> = {}) {
  return mount(FollowButton, {
    props: { targetType: "market", targetId: "market-1", ...props },
  });
}

describe("FollowButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    followingMocks.followed = new Set();
    followingMocks.hasSession.mockReturnValue(true);
    followingMocks.toggle.mockResolvedValue(true);
  });

  it("renders the follow label and loads the shared list on mount", async () => {
    const wrapper = mountButton();
    const button = wrapper.get('[data-testid="follow-button"]');

    expect(button.text()).toContain("follow.follow");
    expect(button.attributes("data-following")).toBe("false");
    expect(button.attributes("aria-pressed")).toBe("false");
    expect(followingMocks.ensureLoaded).toHaveBeenCalledOnce();
  });

  it("renders the following label when the shared list already has the row", () => {
    followingMocks.followed = new Set(["market:market-1"]);

    const button = mountButton().get('[data-testid="follow-button"]');

    expect(button.text()).toContain("follow.following");
    expect(button.attributes("data-following")).toBe("true");
    expect(button.attributes("aria-pressed")).toBe("true");
  });

  it("toggles the follow for the target it was given", async () => {
    const wrapper = mountButton({
      targetType: "restaurant",
      targetId: "rest-9",
    });

    await wrapper.get('[data-testid="follow-button"]').trigger("click");

    expect(followingMocks.toggle).toHaveBeenCalledOnce();
    expect(followingMocks.toggle).toHaveBeenCalledWith("restaurant", "rest-9");
    expect(routerMocks.push).not.toHaveBeenCalled();
  });

  it("sends a signed-out diner to login with a redirect back, and follows nothing", async () => {
    followingMocks.hasSession.mockReturnValue(false);

    const wrapper = mountButton();
    await wrapper.get('[data-testid="follow-button"]').trigger("click");

    expect(followingMocks.toggle).not.toHaveBeenCalled();
    expect(routerMocks.push).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/login",
        query: expect.objectContaining({ redirect: "/markets/fengjia" }),
      }),
    );
    // Nothing to load either: an anonymous visitor has no favorites list.
    expect(followingMocks.ensureLoaded).not.toHaveBeenCalled();
  });

  it("surfaces a failed toggle as a toast", async () => {
    followingMocks.toggle.mockRejectedValueOnce(new Error("offline"));

    const wrapper = mountButton();
    await wrapper.get('[data-testid="follow-button"]').trigger("click");
    await vi.waitFor(() => {
      expect(toastMocks.error).toHaveBeenCalledOnce();
    });

    expect(toastMocks.error).toHaveBeenCalledWith("follow.followFailed");
  });
});
