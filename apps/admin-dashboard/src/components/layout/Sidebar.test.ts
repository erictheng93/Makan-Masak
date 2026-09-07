// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { reactive, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Sidebar from "./Sidebar.vue";

const routeState = reactive({
  path: "/dashboard/platform",
});

const authState = reactive({
  user: { username: "admin", role: 0 },
  isAdminRole: true,
  hasRestaurantContext: false,
  canAccessOwnerDashboard: true,
  canManageOrders: true,
  canManageMenu: true,
  canAccessAdminFeatures: true,
});

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({
    get user() {
      return authState.user;
    },
    get isAdminRole() {
      return authState.isAdminRole;
    },
    get hasRestaurantContext() {
      return authState.hasRestaurantContext;
    },
    get canAccessOwnerDashboard() {
      return authState.canAccessOwnerDashboard;
    },
    get canManageOrders() {
      return authState.canManageOrders;
    },
    get canManageMenu() {
      return authState.canManageMenu;
    },
    get canAccessAdminFeatures() {
      return authState.canAccessAdminFeatures;
    },
    hasPermission: vi.fn(() => true),
  }),
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: ref("zh-TW"),
  }),
}));

const disabledFeatures = reactive({ value: new Set<string>() });

vi.mock("@/composables/useFeatureAvailability", () => ({
  useFeatureAvailability: () => ({
    isDisabled: (feature: string) => disabledFeatures.value.has(feature),
  }),
}));

vi.mock("vue-router", () => ({
  useRoute: () => routeState,
  RouterLink: {
    props: ["to"],
    template: "<a><slot /></a>",
  },
}));

describe("Sidebar", () => {
  beforeEach(() => {
    routeState.path = "/dashboard/platform";
    authState.user = { username: "admin", role: 0 };
    authState.isAdminRole = true;
    authState.hasRestaurantContext = false;
    authState.canAccessOwnerDashboard = true;
    authState.canManageOrders = true;
    authState.canManageMenu = true;
    authState.canAccessAdminFeatures = true;
    disabledFeatures.value = new Set();
  });

  function mountSidebar() {
    return mount(Sidebar, {
      props: {
        isCollapsed: false,
      },
      global: {
        stubs: {
          ModuleGate: {
            template: "<div><slot /></div>",
          },
          "router-link": {
            props: ["to"],
            template: "<a><slot /></a>",
          },
        },
      },
    });
  }

  it("hides restaurant navigation for admins without restaurant context", () => {
    const wrapper = mountSidebar();

    expect(wrapper.find('[data-testid="nav-item-platform"]').exists()).toBe(
      true,
    );
    expect(
      wrapper.find('[data-testid="restaurant-context-hint"]').exists(),
    ).toBe(true);
    expect(wrapper.find('[data-testid="nav-item-dashboard"]').exists()).toBe(
      false,
    );
    expect(
      wrapper.find('[data-testid="nav-item-owner-overview"]').exists(),
    ).toBe(false);
    expect(wrapper.find('[data-testid="nav-item-pos"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="nav-item-orders"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-testid="nav-item-menu"]').exists()).toBe(false);
  });

  it("shows restaurant navigation under a shop section after selection", () => {
    authState.hasRestaurantContext = true;

    const wrapper = mountSidebar();
    const sectionLabel = wrapper.find(
      '[data-testid="restaurant-section-label"]',
    );
    const dashboardItem = wrapper.find('[data-testid="nav-item-dashboard"]');

    expect(sectionLabel.exists()).toBe(true);
    expect(dashboardItem.exists()).toBe(true);
    expect(
      sectionLabel.element.compareDocumentPosition(dashboardItem.element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      wrapper.find('[data-testid="nav-item-owner-overview"]').exists(),
    ).toBe(true);
    expect(wrapper.find('[data-testid="nav-item-pos"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="nav-item-print-agents"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="nav-item-orders"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="nav-item-menu"]').exists()).toBe(true);
    expect(
      wrapper.find('[data-testid="restaurant-context-hint"]').exists(),
    ).toBe(false);
  });

  it("does not show an orphan shop section for non-admin users", () => {
    authState.user = { username: "owner", role: 1 };
    authState.isAdminRole = false;
    authState.hasRestaurantContext = true;

    const wrapper = mountSidebar();

    expect(wrapper.find('[data-testid="nav-item-platform"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-testid="nav-item-dashboard"]').exists()).toBe(
      true,
    );
    expect(
      wrapper.find('[data-testid="restaurant-section-label"]').exists(),
    ).toBe(false);
    expect(
      wrapper.find('[data-testid="restaurant-context-hint"]').exists(),
    ).toBe(false);
  });

  // Hiding an unlaunched feature makes the product look smaller than it is;
  // linking to it leads to a screen the API refuses. Greyed and inert is the
  // honest middle.
  it("renders an unlaunched feature as inert rather than hiding or linking it", () => {
    disabledFeatures.value = new Set(["marketCheckouts"]);

    const wrapper = mountSidebar();
    const entry = wrapper.find(
      '[data-testid="nav-item-platform-market-checkouts"]',
    );

    expect(entry.exists()).toBe(true);
    expect(entry.attributes("data-disabled")).toBe("true");
    expect(entry.attributes("aria-disabled")).toBe("true");
    // A span, not a router-link -- there is nothing to navigate to.
    expect(entry.element.tagName).toBe("SPAN");
    expect(entry.text()).toContain("nav.featureUnavailable");
  });

  it("links the same entry normally once the feature is on", () => {
    const wrapper = mountSidebar();
    const entry = wrapper.find(
      '[data-testid="nav-item-platform-market-checkouts"]',
    );

    expect(entry.exists()).toBe(true);
    expect(entry.attributes("data-disabled")).toBeUndefined();
    expect(entry.element.tagName).not.toBe("SPAN");
  });

  // #320: the swap entry is the one restaurant item a cashier or service crew
  // must see. Every other one here is gated on canAccessAdminFeatures, so a
  // future "tidy up the sidebar" pass would fold this in by reflex.
  it("shows my-shifts to staff who cannot access admin features", () => {
    authState.user = { username: "cashier", role: 4 };
    authState.isAdminRole = false;
    authState.hasRestaurantContext = true;
    authState.canAccessAdminFeatures = false;
    authState.canManageMenu = false;

    const wrapper = mountSidebar();

    expect(wrapper.find('[data-testid="nav-item-my-shifts"]').exists()).toBe(
      true,
    );
    // #344: same reasoning, and the reason leave self-service was invisible
    // for so long -- /employees/leaves is the only other leave entry and it is
    // behind canAccessAdminFeatures.
    expect(wrapper.find('[data-testid="nav-item-my-leaves"]').exists()).toBe(
      true,
    );
    // #308: the clock panel's only other mount point is
    // /employees/attendance, which is behind canAccessAdminFeatures -- so
    // without this entry the people who actually work the shifts cannot
    // clock in.
    expect(
      wrapper.find('[data-testid="nav-item-my-attendance"]').exists(),
    ).toBe(true);
    expect(wrapper.find('[data-testid="nav-item-employees"]').exists()).toBe(
      false,
    );
  });

  it("leaves other entries untouched when one feature is off", () => {
    disabledFeatures.value = new Set(["marketCheckouts"]);

    const wrapper = mountSidebar();

    expect(
      wrapper
        .find('[data-testid="nav-item-platform-markets"]')
        .attributes("data-disabled"),
    ).toBeUndefined();
  });
});
