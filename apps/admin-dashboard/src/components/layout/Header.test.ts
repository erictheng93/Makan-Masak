// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { computed, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Header from "./Header.vue";

const realtimeStatus = ref("disconnected");
const restaurantId = ref<string | null>("restaurant-1");

vi.mock("@/composables/useRealtimeConnection", () => ({
  useRealtimeConnection: () => ({
    status: computed(() => realtimeStatus.value),
    isConnected: computed(() => realtimeStatus.value === "connected"),
  }),
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({
    user: { username: "owner", role: 1 },
    restaurantId,
  }),
}));

vi.mock("@/stores/notification", () => ({
  useNotificationStore: () => ({
    unreadCount: 0,
  }),
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: ref("zh-TW"),
  }),
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({
    meta: {},
    matched: [],
  }),
  useRouter: () => ({
    push: vi.fn(),
  }),
  RouterLink: {
    template: "<a><slot /></a>",
  },
}));

describe("Header", () => {
  beforeEach(() => {
    realtimeStatus.value = "disconnected";
    restaurantId.value = "restaurant-1";
  });

  function mountHeader() {
    return mount(Header, {
      global: {
        stubs: {
          RestaurantSelector: true,
          LanguageSwitcher: true,
          "router-link": {
            template: "<a><slot /></a>",
          },
        },
      },
    });
  }

  it("names the notification action independently of its unread badge", () => {
    const wrapper = mountHeader();
    expect(
      wrapper.find('button[aria-label="a11y.notifications"]').exists(),
    ).toBe(true);
  });

  it.each([
    ["connected", "header.realtime.connected"],
    ["connecting", "header.realtime.connecting"],
    ["reconnecting", "header.realtime.reconnecting"],
    ["error", "header.realtime.error"],
    ["disconnected", "header.realtime.disconnected"],
  ])("shows %s realtime status", (status, expectedText) => {
    realtimeStatus.value = status;

    const wrapper = mountHeader();

    expect(wrapper.text()).toContain(expectedText);
  });

  it("shows missing restaurant context before disconnected state", () => {
    restaurantId.value = null;
    realtimeStatus.value = "disconnected";

    const wrapper = mountHeader();

    expect(wrapper.text()).toContain("header.realtime.noRestaurant");
  });
});
