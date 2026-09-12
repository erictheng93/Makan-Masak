// @vitest-environment jsdom

/**
 * Web push is built but unlaunched, and the API declares that on /info. These
 * cases pin the two customer-app places that let someone opt in: the profile
 * button, and the implicit enrollment that used to run on a waiting-list join.
 *
 * Both halves matter. The visual state alone would still fire the request from
 * a stale render or a bypassed attribute, and the guard alone would leave a
 * live-looking button that quietly does nothing.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { reactive } from "vue";
import ProfileView from "@/views/ProfileView.vue";
import JoinWaitingListView from "@/views/waiting-list/JoinWaitingListView.vue";
import { waitingListApi } from "@/services/waitingListApi";
import { customerIdentityApi } from "@/services/customerIdentityApi";
import { resetFollowing } from "@/composables/useFollowing";
import { customerOrderApi } from "@/services/customerOrderApi";
import customerPushService from "@/utils/push-notifications";
import { WaitingStatus } from "@makanmasak/shared-types";

const disabledFeatures = reactive({ value: new Set<string>() });

vi.mock("@/composables/useFeatureAvailability", () => ({
  useFeatureAvailability: () => ({
    isDisabled: (feature: string) => disabledFeatures.value.has(feature),
  }),
}));

vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tWithParams: (key: string, params: Record<string, unknown>) =>
      `${key}:${JSON.stringify(params)}`,
  }),
}));

vi.mock("@/composables/useConfirmModal", () => ({
  useConfirmModal: () => ({ confirm: vi.fn(async () => false) }),
}));

vi.mock("@/utils/push-notifications", () => ({
  default: {
    requestPermission: vi.fn(),
    subscribe: vi.fn(),
  },
}));

vi.mock("@/services/waitingListApi", () => ({
  waitingListApi: {
    join: vi.fn(),
    lookup: vi.fn(),
    history: vi.fn(),
    getById: vi.fn(),
    getQueueStatus: vi.fn(),
    estimateWait: vi.fn(),
    cancel: vi.fn(),
    confirmArrival: vi.fn(),
  },
}));

vi.mock("@/services/customerOrderApi", () => ({
  customerOrderApi: { getMyProfile: vi.fn() },
}));

vi.mock("@/services/customerIdentityApi", () => ({
  customerIdentityApi: {
    getMe: vi.fn(),
    updatePreferences: vi.fn(),
    grantConsent: vi.fn(),
    addPushSubscription: vi.fn(),
    listPushSubscriptions: vi.fn(),
    removePushSubscription: vi.fn(),
    // #335 moved the enable-push button into NotificationSettingsCard and added
    // the 追蹤中 list, both of which load on mount. They are mocked rather than
    // stubbed out because the button under test now renders inside one of them.
    listConsents: vi.fn(),
    getNotificationPreferences: vi.fn(),
    updateNotificationPreferences: vi.fn(),
    listFavorites: vi.fn(),
    addFavorite: vi.fn(),
    removeFavorite: vi.fn(),
  },
}));

vi.mock("@/services/marketsApi", () => ({
  marketsApi: { listMarkets: vi.fn() },
}));

vi.mock("@/services/menuApi", () => ({
  menuApi: { getRestaurant: vi.fn() },
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({
    isAuthenticated: true,
    checkAuth: vi.fn(async () => true),
    logout: vi.fn(),
  }),
}));

const routerMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: routerMocks.push,
    replace: routerMocks.replace,
  }),
  RouterLink: { template: "<a><slot /></a>" },
}));

function buildProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: "customer-1",
    username: "diner",
    fullName: "Diner",
    email: "diner@example.test",
    phone: "0912345678",
    role: 5,
    ...overrides,
  };
}

function buildPreferences(overrides: Record<string, unknown> = {}) {
  return {
    dietaryTags: [],
    allergens: [],
    defaultPartySize: null,
    marketingOptIn: false,
    waitingListOptIn: true,
    promoFromFavoritesOptIn: false,
    quietHoursStart: null,
    quietHoursEnd: null,
    updatedAtMs: null,
    ...overrides,
  };
}

function buildTicket(overrides: Record<string, unknown> = {}) {
  return {
    id: "ticket-1",
    restaurantId: "restaurant-1",
    customerName: "Diner",
    customerPhone: "0912345678",
    partySize: 2,
    queueNumber: 1,
    queueLetter: "A",
    queueDisplay: "A001",
    priority: 0,
    status: WaitingStatus.WAITING,
    createdAt: 1,
    updatedAt: 1,
    partiesAhead: 0,
    ...overrides,
  };
}

async function mountProfile() {
  const wrapper = mount(ProfileView, {
    global: { stubs: { "router-link": { template: "<a><slot /></a>" } } },
  });
  await vi.waitFor(() => {
    expect(customerOrderApi.getMyProfile).toHaveBeenCalled();
  });
  await wrapper.vm.$nextTick();
  return wrapper;
}

async function mountJoin() {
  const wrapper = mount(JoinWaitingListView, {
    props: { restaurantId: "restaurant-1" },
    global: { stubs: { QueueListIcon: true } },
  });
  await vi.waitFor(() => {
    expect(waitingListApi.getQueueStatus).toHaveBeenCalled();
  });
  await wrapper.vm.$nextTick();
  return wrapper;
}

async function submitJoinForm(wrapper: Awaited<ReturnType<typeof mountJoin>>) {
  await wrapper.find('[data-testid="customer-name-input"]').setValue("Diner");
  await wrapper
    .find('[data-testid="customer-phone-input"]')
    .setValue("0912345678");
  await wrapper.find("form").trigger("submit.prevent");
  await vi.waitFor(() => {
    expect(waitingListApi.join).toHaveBeenCalled();
  });
}

describe("web push shown as unavailable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    disabledFeatures.value = new Set();
    localStorage.clear();

    vi.mocked(customerOrderApi.getMyProfile).mockResolvedValue(
      buildProfile() as never,
    );
    resetFollowing();
    vi.mocked(customerIdentityApi.getMe).mockResolvedValue({
      preferences: buildPreferences(),
    } as never);
    vi.mocked(customerIdentityApi.listFavorites).mockResolvedValue([]);
    vi.mocked(customerIdentityApi.listConsents).mockResolvedValue([]);
    vi.mocked(customerIdentityApi.getNotificationPreferences).mockResolvedValue(
      {
        marketingEnabled: true,
        followedOnly: true,
        quietHoursStartMin: null,
        quietHoursEndMin: null,
        updatedAt: null,
      } as never,
    );
    vi.mocked(customerIdentityApi.listPushSubscriptions).mockResolvedValue([]);
    vi.mocked(waitingListApi.getQueueStatus).mockResolvedValue({
      restaurantId: "restaurant-1",
      totalWaiting: 0,
      averageWaitMinutes: 5,
      availableTables: 1,
      byTableType: [],
    });
    vi.mocked(waitingListApi.estimateWait).mockResolvedValue({
      estimatedWaitMinutes: 5,
      partiesAhead: 0,
      availableTables: 1,
      confidence: 1,
    });
    vi.mocked(waitingListApi.join).mockResolvedValue(buildTicket() as never);
    vi.mocked(customerPushService.requestPermission).mockResolvedValue(
      "granted",
    );
    vi.mocked(customerPushService.subscribe).mockResolvedValue({
      endpoint: "https://push.example.test/sub",
      keys: { p256dh: "p256dh", auth: "auth" },
    });
  });

  describe("ProfileView enable-push button", () => {
    it("renders the button inert and labelled when web push is disabled", async () => {
      disabledFeatures.value = new Set(["webPush"]);

      const wrapper = await mountProfile();
      const button = wrapper.find('[data-testid="enable-push-button"]');

      // Visible, not hidden: the feature exists, it is just not open yet.
      expect(button.exists()).toBe(true);
      expect(button.attributes("data-disabled")).toBe("true");
      expect(button.attributes("aria-disabled")).toBe("true");
      expect(button.attributes("disabled")).toBeDefined();
      expect(button.text()).toContain("尚未開放");
    });

    it("sends no subscribe request when the disabled button is clicked", async () => {
      disabledFeatures.value = new Set(["webPush"]);

      const wrapper = await mountProfile();
      // dispatchEvent rather than trigger(): it reaches the handler even on a
      // disabled element, which is the point -- the guard, not the attribute,
      // is what has to stop the request.
      wrapper
        .find('[data-testid="enable-push-button"]')
        .element.dispatchEvent(new MouseEvent("click"));
      await wrapper.vm.$nextTick();

      expect(customerPushService.requestPermission).not.toHaveBeenCalled();
      expect(customerPushService.subscribe).not.toHaveBeenCalled();
      expect(customerIdentityApi.addPushSubscription).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain("尚未開放");
    });

    it("subscribes normally when web push is enabled", async () => {
      const wrapper = await mountProfile();
      const button = wrapper.find('[data-testid="enable-push-button"]');

      expect(button.attributes("data-disabled")).toBeUndefined();
      expect(button.attributes("aria-disabled")).toBeUndefined();
      expect(button.attributes("disabled")).toBeUndefined();

      await button.trigger("click");
      await vi.waitFor(() => {
        expect(customerPushService.requestPermission).toHaveBeenCalledOnce();
        expect(customerPushService.subscribe).toHaveBeenCalledOnce();
      });
    });
  });

  describe("JoinWaitingListView push enrollment", () => {
    it("skips enrollment and explains why when web push is disabled", async () => {
      disabledFeatures.value = new Set(["webPush"]);

      const wrapper = await mountJoin();
      const note = wrapper.find(
        '[data-testid="waiting-list-push-unavailable"]',
      );

      expect(note.exists()).toBe(true);
      expect(note.attributes("data-disabled")).toBe("true");
      expect(note.text()).toContain("尚未開放");

      await submitJoinForm(wrapper);

      // The permission prompt is itself an opt-in: never raise it for something
      // that cannot be delivered.
      expect(customerPushService.requestPermission).not.toHaveBeenCalled();
      expect(customerPushService.subscribe).not.toHaveBeenCalled();
      // Joining still works -- only the push enrollment is gated.
      expect(routerMocks.push).toHaveBeenCalledWith(
        "/r/restaurant-1/wait-list/ticket-1",
      );
    });

    it("enrolls on join when web push is enabled", async () => {
      const wrapper = await mountJoin();

      expect(
        wrapper.find('[data-testid="waiting-list-push-unavailable"]').exists(),
      ).toBe(false);

      await submitJoinForm(wrapper);

      await vi.waitFor(() => {
        expect(customerPushService.requestPermission).toHaveBeenCalledOnce();
        expect(customerPushService.subscribe).toHaveBeenCalledOnce();
      });
    });
  });
});
