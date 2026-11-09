import { flushPromises, mount } from "@vue/test-utils";
import { ref, unref, type MaybeRef } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MenuView from "@/views/MenuView.vue";

const routerReplace = vi.hoisted(() => vi.fn());
const routerPush = vi.hoisted(() => vi.fn());
const initializeCart = vi.hoisted(() => vi.fn());
const addCartItem = vi.hoisted(() => vi.fn());
const cartState = vi.hoisted(() => ({
  itemCount: 0,
  items: [] as unknown[],
  subtotal: 0,
}));
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
const readActiveGroupOrder = vi.hoisted(() => vi.fn());
/** jsdom has no IntersectionObserver; the test decides what is on screen. */
const inviteOnScreen = vi.hoisted(() => ({
  current: null as null | { value: boolean },
}));
const clearActiveGroupOrder = vi.hoisted(() => vi.fn());
const groupOrderMock = vi.hoisted(() => ({
  groupOrder: { value: null as null | Record<string, unknown> },
  currentMemberId: { value: "" },
  isHost: { value: false },
  error: { value: null as string | null },
  createGroupOrder: vi.fn(),
  loadGroupOrder: vi.fn(),
  connectToGroupOrder: vi.fn(),
  disconnectRealtime: vi.fn(),
  addToCart: vi.fn(),
  getShareLink: vi.fn(() => "https://example.test/group/SHARE123"),
}));
const routeQuery = vi.hoisted(() => ({}));
const tableValidationResult = vi.hoisted(
  (): {
    __v_isRef: true;
    value: { isValid: boolean; table?: { number: string } } | null;
  } => ({
    __v_isRef: true,
    value: null,
  }),
);
const restaurantResult = vi.hoisted(
  (): { __v_isRef: true; value: { name: string } | null } => ({
    __v_isRef: true,
    value: null,
  }),
);
const menuResult = vi.hoisted(
  (): {
    __v_isRef: true;
    value: {
      categories: Array<{ id: number; name: string; sortOrder: number }>;
      menuItems: Array<{
        id: number;
        categoryId: number;
        name: string;
        description: string;
        price: number;
        isFeatured: boolean;
        isAvailable: boolean;
        sortOrder: number;
      }>;
    } | null;
  } => ({ __v_isRef: true, value: null }),
);

const realtimeRefresh = vi.hoisted(() => ({
  callback: null as null | (() => Promise<unknown>),
}));
const pendingQuery = vi.hoisted(() => ({
  table: null as null | { value: unknown },
  menu: null as null | {
    queryFn: (context: { queryKey: unknown[] }) => unknown;
    enabled?: unknown;
  },
}));
vi.mock("@vueuse/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vueuse/core")>();
  const { ref: vueRef } = await import("vue");
  const visible = vueRef(false);
  inviteOnScreen.current = visible;
  return { ...actual, useElementVisibility: () => visible };
});

vi.mock("@/composables/useMenuRealtime", () => ({
  useMenuRealtime: (_id: unknown, refresh: () => Promise<unknown>) => {
    realtimeRefresh.callback = refresh;
  },
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({
    query: routeQuery,
  }),
  useRouter: () => ({
    push: routerPush,
    replace: routerReplace,
  }),
}));

vi.mock("vue-toastification", () => ({
  useToast: () => ({ success: toastSuccess, error: toastError }),
}));

vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tWithParams: (key: string) => key,
    currentLanguage: ref("zh-TW"),
  }),
}));

vi.mock("@/composables/useBreakpoint", () => ({
  useIsDesktop: () => ref(false),
}));

vi.mock("@/composables/useCurrency", () => ({
  useCurrency: () => ({ formatPrice: (value: number) => `$${value}` }),
}));

vi.mock("@/stores/app", () => ({
  useAppStore: () => ({ setRestaurantContext: vi.fn() }),
}));

vi.mock("@/stores/cart", () => ({
  useCartStore: () => ({
    itemCount: cartState.itemCount,
    items: cartState.items,
    subtotal: cartState.subtotal,
    initializeCart,
    addItem: addCartItem,
    removeItem: vi.fn(),
    updateQuantity: vi.fn(),
  }),
}));

vi.mock("@/composables/useGroupOrder", () => ({
  useGroupOrder: () => groupOrderMock,
}));

vi.mock("@/utils/groupOrderSession", () => ({
  readActiveGroupOrder,
  clearActiveGroupOrder,
}));

vi.mock("@/utils/localized-menu-content", () => ({
  getLocalizedMenuName: (item: { name?: string }) => item.name ?? "",
  menuItemMatchesQuery: (
    item: { name?: string; description?: string },
    query: string,
  ) =>
    [item.name, item.description]
      .filter(Boolean)
      .some((value) => value?.toLowerCase().includes(query)),
}));

vi.mock("@/services/menuApi", () => ({
  menuApi: {
    validateTable: vi.fn(),
    getRestaurant: vi.fn(),
    getMenu: vi.fn(),
  },
}));

vi.mock("@/components/MenuItemCard.vue", () => ({
  default: {
    props: ["item"],
    emits: ["view-details", "add-to-cart"],
    template:
      '<div><button type="button" data-testid="menu-item-card" @click="$emit(\'view-details\', item)">{{ item.name }}</button><button type="button" data-testid="menu-item-add" @click="$emit(\'add-to-cart\', { item, quantity: 2, customizations: { spicy: true }, notes: \'less salt\' })">add</button></div>',
  },
}));
vi.mock("@/components/MenuItemModal.vue", () => ({
  default: {
    props: ["item", "show"],
    template:
      '<div v-if="show" role="dialog" data-testid="menu-item-modal"><h2>{{ item.name }}</h2><p>{{ item.description }}</p></div>',
  },
}));
vi.mock("@/components/CustomizationModal.vue", () => ({
  default: { template: "<div />" },
}));
vi.mock("@/components/DesktopCartPanel.vue", () => ({
  default: { template: "<div />" },
}));
vi.mock("@/components/LanguageSwitcher.vue", () => ({
  default: {
    props: { compact: Boolean },
    template:
      "<div data-testid=\"menu-language-switcher\" :data-compact=\"compact ? 'true' : 'false'\" />",
  },
}));

vi.mock("@tanstack/vue-query", () => ({
  useQuery: (options: {
    queryKey: MaybeRef<unknown[]>;
    queryFn: (context: { queryKey: unknown[] }) => unknown;
    enabled?: unknown;
  }) => {
    if (unref(options.queryKey)[0] === "table-validation") {
      return {
        data: pendingQuery.table ?? tableValidationResult,
        isLoading: ref(false),
        error: ref(null),
        refetch: vi.fn(),
      };
    }

    if (unref(options.queryKey)[0] === "restaurant") {
      return {
        data: restaurantResult,
        isLoading: ref(false),
        error: ref(null),
        refetch: vi.fn(),
      };
    }

    pendingQuery.menu = options;
    return {
      data: menuResult,
      isLoading: ref(false),
      error: ref(null),
      refetch: vi.fn(),
    };
  },
}));

describe("MenuView table validation", () => {
  beforeEach(() => {
    if (inviteOnScreen.current) inviteOnScreen.current.value = false;
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    pendingQuery.table = null;
    pendingQuery.menu = null;
    tableValidationResult.value = null;
    restaurantResult.value = null;
    menuResult.value = null;
    // Real refs, as useGroupOrder returns: with plain objects isGroupMode is a
    // computed with nothing to track, so it only re-evaluates when some other
    // reactive write happens to land first.
    groupOrderMock.groupOrder = ref(null);
    groupOrderMock.currentMemberId = ref("");
    groupOrderMock.isHost = ref(false);
    groupOrderMock.error.value = null;
    groupOrderMock.createGroupOrder.mockReset();
    groupOrderMock.loadGroupOrder.mockReset();
    groupOrderMock.connectToGroupOrder.mockReset();
    groupOrderMock.disconnectRealtime.mockReset();
    groupOrderMock.addToCart.mockReset();
    readActiveGroupOrder.mockReset();
    clearActiveGroupOrder.mockReset();
    cartState.itemCount = 0;
    cartState.items = [];
    cartState.subtotal = 0;
  });

  it("issues the menu read without waiting for table validation, and fresh after a realtime event", async () => {
    pendingQuery.table = ref(null);
    const wrapper = mount(MenuView, {
      props: { restaurantId: "restaurant-1", tableId: 99 },
    });
    const { menuApi } = await import("@/services/menuApi");
    // Not gated: the read starts alongside the validation, which still decides
    // whether the page is shown (redirect on an invalid table).
    expect(pendingQuery.menu!.enabled).toBeUndefined();
    await realtimeRefresh.callback?.();
    await pendingQuery.menu!.queryFn({
      queryKey: ["menu", "restaurant-1", 99],
    });
    expect(menuApi.getMenu).toHaveBeenCalledWith("restaurant-1", 99, {
      fresh: true,
    });
    wrapper.unmount();
  });

  it("restores the stored group once, even before validation and across seat changes", async () => {
    pendingQuery.table = ref(null);
    readActiveGroupOrder.mockReturnValue({ groupOrderId: "go-1" });
    groupOrderMock.loadGroupOrder.mockResolvedValue(undefined);
    const wrapper = mount(MenuView, {
      props: { restaurantId: "restaurant-1", tableId: 99 },
    });
    await flushPromises();
    expect(groupOrderMock.loadGroupOrder).toHaveBeenCalledTimes(1);
    expect(groupOrderMock.loadGroupOrder).toHaveBeenCalledWith("go-1");
    (pendingQuery.table as { value: unknown }).value = {
      isValid: true,
      table: { number: "99" },
    };
    await flushPromises();
    expect(groupOrderMock.loadGroupOrder).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("redirects invalid table deep links to the error page", async () => {
    tableValidationResult.value = { isValid: false };

    mount(MenuView, {
      props: {
        restaurantId: "restaurant-1",
        tableId: 9999,
      },
    });
    await flushPromises();

    expect(initializeCart).not.toHaveBeenCalled();
    expect(routerReplace).toHaveBeenCalledWith({
      name: "Error",
      query: {
        code: "INVALID_TABLE",
        message: "此桌號無效或已停用，請重新掃描 QR Code。",
      },
    });
  });

  it("shows the A1 QR menu, filters Part 1 items, and opens item details", async () => {
    tableValidationResult.value = {
      isValid: true,
      table: { number: "A1" },
    };
    restaurantResult.value = { name: "Part 1 Smoke Restaurant" };
    menuResult.value = {
      categories: [{ id: 10, name: "Part 1 Specials", sortOrder: 1 }],
      menuItems: [
        {
          id: 101,
          categoryId: 10,
          name: "Part 1 Test Nasi Lemak",
          description: "Coconut rice with sambal",
          price: 120,
          isFeatured: false,
          isAvailable: true,
          sortOrder: 1,
        },
        {
          id: 102,
          categoryId: 10,
          name: "Part 1 Test Teh Tarik",
          description: "Pulled milk tea",
          price: 55,
          isFeatured: false,
          isAvailable: true,
          sortOrder: 2,
        },
      ],
    };

    const wrapper = mount(MenuView, {
      props: {
        restaurantId: "restaurant-1",
        tableId: 1,
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("Part 1 Smoke Restaurant");
    expect(wrapper.text()).toContain("A1");
    expect(wrapper.text()).toContain("Part 1 Test Nasi Lemak");
    expect(wrapper.text()).toContain("Part 1 Test Teh Tarik");
    expect(initializeCart).toHaveBeenCalledWith("restaurant-1", 1, null);
    expect(
      wrapper
        .get('[data-testid="menu-language-switcher"]')
        .attributes("data-compact"),
    ).toBe("true");

    await wrapper.get('[data-testid="menu-reservation"]').trigger("click");
    expect(routerPush).toHaveBeenCalledWith({
      name: "Reservation",
      params: { restaurantId: "restaurant-1" },
    });

    await wrapper.find("input[type='text']").setValue("teh");

    expect(wrapper.text()).not.toContain("Part 1 Test Nasi Lemak");
    expect(wrapper.text()).toContain("Part 1 Test Teh Tarik");

    await wrapper.get('[data-testid="menu-item-card"]').trigger("click");

    expect(wrapper.get('[data-testid="menu-item-modal"]').text()).toContain(
      "Pulled milk tea",
    );
  });

  it("creates a group order from the menu and stays on the menu to order", async () => {
    tableValidationResult.value = {
      isValid: true,
      table: { number: "A1" },
    };
    restaurantResult.value = { name: "Part 1 Smoke Restaurant" };
    menuResult.value = {
      categories: [],
      menuItems: [],
    };
    groupOrderMock.createGroupOrder.mockResolvedValueOnce("go-1");

    const wrapper = mount(MenuView, {
      props: {
        restaurantId: "restaurant-1",
        tableId: 1,
      },
    });
    await flushPromises();

    await wrapper
      .find('[data-testid="start-group-order-button"]')
      .trigger("click");
    await wrapper.find('[data-testid="group-host-name-input"]').setValue("Sam");
    await wrapper.find('[data-testid="group-create-form"]').trigger("submit");
    await flushPromises();

    expect(groupOrderMock.createGroupOrder).toHaveBeenCalledWith({
      hostName: "Sam",
      tableId: "1",
    });
    expect(routerPush).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: "GroupOrder" }),
    );
  });

  it.each([
    { members: 1, isHost: true, open: true },
    { members: 2, isHost: true, open: false },
    { members: 1, isHost: false, open: false },
  ])(
    "reopens the invite on reload only for a host still alone ($members member(s), host=$isHost)",
    async ({ members, isHost, open }) => {
      tableValidationResult.value = { isValid: true, table: { number: "A1" } };
      restaurantResult.value = { name: "Part 1 Smoke Restaurant" };
      menuResult.value = { categories: [], menuItems: [] };
      readActiveGroupOrder.mockReturnValue({
        groupOrderId: "go-1",
        restaurantId: "restaurant-1",
        tableId: "1",
        savedAt: Date.now(),
      });
      groupOrderMock.loadGroupOrder.mockImplementation(async () => {
        groupOrderMock.currentMemberId.value = "m-1";
        groupOrderMock.isHost.value = isHost;
        groupOrderMock.groupOrder.value = {
          id: "go-1",
          restaurantId: "restaurant-1",
          tableId: "1",
          shareCode: "SHARE123",
          status: "active",
          cartItems: [],
          members: Array.from({ length: members }, (_, i) => ({
            id: `m-${i}`,
          })),
        };
      });

      const wrapper = mount(MenuView, {
        props: { restaurantId: "restaurant-1", tableId: 1 },
      });
      await flushPromises();

      expect(groupOrderMock.loadGroupOrder).toHaveBeenCalledWith("go-1");
      expect(wrapper.find('[data-testid="group-cart-link"]').exists()).toBe(
        true,
      );
      expect(wrapper.find('[data-testid="group-order-invite"]').exists()).toBe(
        open,
      );
    },
  );

  /**
   * The floating group-cart bar is fixed to the bottom of the screen and used
   * to sit on top of the invite's QR code, so a second diner could not scan
   * it without the host scrolling first.
   */
  it("hides the floating group-cart bar while the invite is on screen", async () => {
    tableValidationResult.value = { isValid: true, table: { number: "A1" } };
    restaurantResult.value = { name: "Part 1 Smoke Restaurant" };
    menuResult.value = { categories: [], menuItems: [] };
    readActiveGroupOrder.mockReturnValue({
      groupOrderId: "go-1",
      restaurantId: "restaurant-1",
      tableId: "1",
      savedAt: Date.now(),
    });
    groupOrderMock.loadGroupOrder.mockImplementation(async () => {
      groupOrderMock.currentMemberId.value = "m-1";
      groupOrderMock.isHost.value = true;
      groupOrderMock.groupOrder.value = {
        id: "go-1",
        restaurantId: "restaurant-1",
        tableId: "1",
        shareCode: "SHARE123",
        status: "active",
        cartItems: [],
        members: [{ id: "m-1" }],
      };
    });
    inviteOnScreen.current!.value = true;

    // Attached, so isVisible() reads real display state, not "detached".
    const wrapper = mount(MenuView, {
      props: { restaurantId: "restaurant-1", tableId: 1 },
      attachTo: document.body,
    });
    await flushPromises();

    const bar = wrapper.find('[data-testid="group-cart-bar"]');
    expect(wrapper.find('[data-testid="group-order-invite"]').exists()).toBe(
      true,
    );
    expect(bar.isVisible()).toBe(false);

    // Scrolled past the invite: the bar is the way to the cart again.
    inviteOnScreen.current!.value = false;
    await flushPromises();
    expect(bar.isVisible()).toBe(true);
    wrapper.unmount();
  });

  it("routes menu additions to the active group cart instead of local cart", async () => {
    tableValidationResult.value = {
      isValid: true,
      table: { number: "A1" },
    };
    restaurantResult.value = { name: "Part 1 Smoke Restaurant" };
    menuResult.value = {
      categories: [{ id: 10, name: "Part 1 Specials", sortOrder: 1 }],
      menuItems: [
        {
          id: 101,
          categoryId: 10,
          name: "Part 1 Test Nasi Lemak",
          description: "Coconut rice with sambal",
          price: 120,
          isFeatured: false,
          isAvailable: true,
          sortOrder: 1,
        },
      ],
    };
    readActiveGroupOrder.mockReturnValue({
      groupOrderId: "go-1",
      restaurantId: "restaurant-1",
      tableId: "1",
      savedAt: Date.now(),
    });
    groupOrderMock.loadGroupOrder.mockImplementation(async () => {
      groupOrderMock.currentMemberId.value = "m-1";
      groupOrderMock.groupOrder.value = {
        id: "go-1",
        restaurantId: "restaurant-1",
        tableId: "1",
        status: "active",
        cartItems: [],
      };
    });
    groupOrderMock.addToCart.mockImplementation(async (item) => {
      groupOrderMock.groupOrder.value = {
        ...groupOrderMock.groupOrder.value,
        cartItems: [
          {
            id: "ci-1",
            quantity: item.quantity,
          },
        ],
      };
    });

    const wrapper = mount(MenuView, {
      props: {
        restaurantId: "restaurant-1",
        tableId: 1,
      },
    });
    await flushPromises();

    await wrapper.get('[data-testid="menu-item-add"]').trigger("click");
    await flushPromises();

    expect(groupOrderMock.loadGroupOrder).toHaveBeenCalledWith("go-1");
    expect(groupOrderMock.addToCart).toHaveBeenCalledWith({
      menuItemId: "101",
      menuItemName: "Part 1 Test Nasi Lemak",
      menuItemPrice: 120,
      quantity: 2,
      options: { spicy: true },
      notes: "less salt",
    });
    expect(addCartItem).not.toHaveBeenCalled();
  });

  /**
   * Coming back from the shared cart remounts the menu, and group mode only
   * turns on once loadGroupOrder answers -- 1-4 s in production. A tap on 加入
   * inside that window used to land in the personal cart, which group mode then
   * hides, so the item silently never reached the group order (reproduced in
   * production 2026-09-18: the host's first addition was not in
   * group_cart_items).
   */
  it("holds an addition made while the active group is still loading until it knows where it goes", async () => {
    let finishLoading: (() => void) | undefined;
    tableValidationResult.value = {
      isValid: true,
      table: { number: "A1" },
    };
    restaurantResult.value = { name: "Part 1 Smoke Restaurant" };
    menuResult.value = {
      categories: [{ id: 10, name: "Part 1 Specials", sortOrder: 1 }],
      menuItems: [
        {
          id: 101,
          categoryId: 10,
          name: "Part 1 Test Nasi Lemak",
          description: "Coconut rice with sambal",
          price: 120,
          isFeatured: false,
          isAvailable: true,
          sortOrder: 1,
        },
      ],
    };
    readActiveGroupOrder.mockReturnValue({
      groupOrderId: "go-1",
      restaurantId: "restaurant-1",
      tableId: "1",
      savedAt: Date.now(),
    });
    groupOrderMock.loadGroupOrder.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishLoading = () => {
            groupOrderMock.currentMemberId.value = "m-1";
            groupOrderMock.groupOrder.value = {
              id: "go-1",
              restaurantId: "restaurant-1",
              tableId: "1",
              status: "active",
              cartItems: [],
            };
            resolve();
          };
        }),
    );
    groupOrderMock.addToCart.mockResolvedValue(undefined);

    const wrapper = mount(MenuView, {
      props: {
        restaurantId: "restaurant-1",
        tableId: 1,
      },
    });
    await flushPromises();

    const click = wrapper.get('[data-testid="menu-item-add"]').trigger("click");
    await flushPromises();

    expect(addCartItem).not.toHaveBeenCalled();

    finishLoading?.();
    await click;
    await flushPromises();
    await flushPromises();

    expect(groupOrderMock.addToCart).toHaveBeenCalledOnce();
    expect(groupOrderMock.addToCart).toHaveBeenCalledWith(
      expect.objectContaining({ menuItemId: "101", quantity: 2 }),
    );
    expect(addCartItem).not.toHaveBeenCalled();
  });

  it("puts a held addition in the personal cart when the stored group turns out to be over", async () => {
    let finishLoading: (() => void) | undefined;
    tableValidationResult.value = {
      isValid: true,
      table: { number: "A1" },
    };
    restaurantResult.value = { name: "Part 1 Smoke Restaurant" };
    menuResult.value = {
      categories: [{ id: 10, name: "Part 1 Specials", sortOrder: 1 }],
      menuItems: [
        {
          id: 101,
          categoryId: 10,
          name: "Part 1 Test Nasi Lemak",
          description: "Coconut rice with sambal",
          price: 120,
          isFeatured: false,
          isAvailable: true,
          sortOrder: 1,
        },
      ],
    };
    readActiveGroupOrder.mockReturnValue({
      groupOrderId: "go-1",
      restaurantId: "restaurant-1",
      tableId: "1",
      savedAt: Date.now(),
    });
    groupOrderMock.loadGroupOrder.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishLoading = () => {
            groupOrderMock.currentMemberId.value = "m-1";
            groupOrderMock.groupOrder.value = {
              id: "go-1",
              restaurantId: "restaurant-1",
              tableId: "1",
              status: "completed",
              cartItems: [],
            };
            resolve();
          };
        }),
    );

    const wrapper = mount(MenuView, {
      props: {
        restaurantId: "restaurant-1",
        tableId: 1,
      },
    });
    await flushPromises();

    const click = wrapper.get('[data-testid="menu-item-add"]').trigger("click");
    await flushPromises();
    finishLoading?.();
    await click;
    await flushPromises();

    expect(groupOrderMock.addToCart).not.toHaveBeenCalled();
    expect(addCartItem).toHaveBeenCalledOnce();
    expect(addCartItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 101 }),
      2,
      { spicy: true },
      "less salt",
    );
  });

  it("subscribes to realtime while an active group is open on the menu", async () => {
    vi.stubEnv("VITE_REALTIME_URL", "ws://realtime.example");
    tableValidationResult.value = {
      isValid: true,
      table: { number: "A1" },
    };
    restaurantResult.value = { name: "Part 1 Smoke Restaurant" };
    menuResult.value = {
      categories: [],
      menuItems: [],
    };
    readActiveGroupOrder.mockReturnValue({
      groupOrderId: "go-1",
      restaurantId: "restaurant-1",
      tableId: "1",
      savedAt: Date.now(),
    });
    groupOrderMock.loadGroupOrder.mockImplementation(async () => {
      groupOrderMock.currentMemberId.value = "m-1";
      groupOrderMock.groupOrder.value = {
        id: "go-1",
        restaurantId: "restaurant-1",
        tableId: "1",
        status: "active",
        cartItems: [],
      };
    });

    const wrapper = mount(MenuView, {
      props: {
        restaurantId: "restaurant-1",
        tableId: 1,
      },
    });
    await flushPromises();
    await flushPromises();

    expect(groupOrderMock.connectToGroupOrder).toHaveBeenCalledWith("go-1");

    wrapper.unmount();

    expect(groupOrderMock.disconnectRealtime).toHaveBeenCalled();
  });

  it("lets diners leave group mode and return to their personal cart", async () => {
    tableValidationResult.value = {
      isValid: true,
      table: { number: "A1" },
    };
    restaurantResult.value = { name: "Part 1 Smoke Restaurant" };
    menuResult.value = {
      categories: [],
      menuItems: [],
    };
    cartState.itemCount = 3;
    readActiveGroupOrder.mockReturnValue({
      groupOrderId: "go-1",
      restaurantId: "restaurant-1",
      tableId: "1",
      savedAt: Date.now(),
    });
    groupOrderMock.loadGroupOrder.mockImplementation(async () => {
      groupOrderMock.currentMemberId.value = "m-1";
      groupOrderMock.groupOrder.value = {
        id: "go-1",
        restaurantId: "restaurant-1",
        tableId: "1",
        status: "active",
        cartItems: [],
      };
    });

    const wrapper = mount(MenuView, {
      props: {
        restaurantId: "restaurant-1",
        tableId: 1,
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("group.personalCartHidden");

    await wrapper.get('[data-testid="leave-group-mode"]').trigger("click");
    await flushPromises();

    expect(clearActiveGroupOrder).toHaveBeenCalledWith("restaurant-1", "1");
    expect(groupOrderMock.groupOrder.value).toBeNull();
    expect(groupOrderMock.currentMemberId.value).toBe("");
  });

  it("clears stale active group records when the group is no longer active", async () => {
    tableValidationResult.value = {
      isValid: true,
      table: { number: "A1" },
    };
    restaurantResult.value = { name: "Part 1 Smoke Restaurant" };
    menuResult.value = {
      categories: [],
      menuItems: [],
    };
    readActiveGroupOrder.mockReturnValue({
      groupOrderId: "go-1",
      restaurantId: "restaurant-1",
      tableId: "1",
      savedAt: Date.now(),
    });
    groupOrderMock.loadGroupOrder.mockImplementation(async () => {
      groupOrderMock.currentMemberId.value = "m-1";
      groupOrderMock.groupOrder.value = {
        id: "go-1",
        restaurantId: "restaurant-1",
        tableId: "1",
        status: "cancelled",
        cartItems: [],
      };
    });

    mount(MenuView, {
      props: {
        restaurantId: "restaurant-1",
        tableId: 1,
      },
    });
    await flushPromises();

    expect(clearActiveGroupOrder).toHaveBeenCalledWith("restaurant-1", "1");
    expect(groupOrderMock.groupOrder.value).toBeNull();
  });

  it("queues rapid group cart additions instead of silently dropping one", async () => {
    let resolveFirstAdd: (() => void) | undefined;
    tableValidationResult.value = {
      isValid: true,
      table: { number: "A1" },
    };
    restaurantResult.value = { name: "Part 1 Smoke Restaurant" };
    menuResult.value = {
      categories: [{ id: 10, name: "Part 1 Specials", sortOrder: 1 }],
      menuItems: [
        {
          id: 101,
          categoryId: 10,
          name: "Part 1 Test Nasi Lemak",
          description: "Coconut rice with sambal",
          price: 120,
          isFeatured: false,
          isAvailable: true,
          sortOrder: 1,
        },
      ],
    };
    readActiveGroupOrder.mockReturnValue({
      groupOrderId: "go-1",
      restaurantId: "restaurant-1",
      tableId: "1",
      savedAt: Date.now(),
    });
    groupOrderMock.loadGroupOrder.mockImplementation(async () => {
      groupOrderMock.currentMemberId.value = "m-1";
      groupOrderMock.groupOrder.value = {
        id: "go-1",
        restaurantId: "restaurant-1",
        tableId: "1",
        status: "active",
        cartItems: [],
      };
    });
    groupOrderMock.addToCart
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirstAdd = resolve;
          }),
      )
      .mockResolvedValueOnce(undefined);

    const wrapper = mount(MenuView, {
      props: {
        restaurantId: "restaurant-1",
        tableId: 1,
      },
    });
    await flushPromises();

    const firstClick = wrapper
      .get('[data-testid="menu-item-add"]')
      .trigger("click");
    const secondClick = wrapper
      .get('[data-testid="menu-item-add"]')
      .trigger("click");
    await flushPromises();

    expect(groupOrderMock.addToCart).toHaveBeenCalledTimes(1);

    resolveFirstAdd?.();
    await firstClick;
    await secondClick;
    await flushPromises();
    await flushPromises();

    expect(groupOrderMock.addToCart).toHaveBeenCalledTimes(2);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("does not report success for queued group additions after leaving group mode", async () => {
    let resolveFirstAdd: (() => void) | undefined;
    tableValidationResult.value = {
      isValid: true,
      table: { number: "A1" },
    };
    restaurantResult.value = { name: "Part 1 Smoke Restaurant" };
    menuResult.value = {
      categories: [{ id: 10, name: "Part 1 Specials", sortOrder: 1 }],
      menuItems: [
        {
          id: 101,
          categoryId: 10,
          name: "Part 1 Test Nasi Lemak",
          description: "Coconut rice with sambal",
          price: 120,
          isFeatured: false,
          isAvailable: true,
          sortOrder: 1,
        },
      ],
    };
    readActiveGroupOrder.mockReturnValue({
      groupOrderId: "go-1",
      restaurantId: "restaurant-1",
      tableId: "1",
      savedAt: Date.now(),
    });
    groupOrderMock.loadGroupOrder.mockImplementation(async () => {
      groupOrderMock.currentMemberId.value = "m-1";
      groupOrderMock.groupOrder.value = {
        id: "go-1",
        restaurantId: "restaurant-1",
        tableId: "1",
        status: "active",
        cartItems: [],
      };
    });
    groupOrderMock.addToCart.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirstAdd = resolve;
        }),
    );

    const wrapper = mount(MenuView, {
      props: {
        restaurantId: "restaurant-1",
        tableId: 1,
      },
    });
    await flushPromises();

    const firstClick = wrapper
      .get('[data-testid="menu-item-add"]')
      .trigger("click");
    const secondClick = wrapper
      .get('[data-testid="menu-item-add"]')
      .trigger("click");
    await flushPromises();

    await wrapper.get('[data-testid="leave-group-mode"]').trigger("click");
    resolveFirstAdd?.();
    await firstClick;
    await secondClick;
    await flushPromises();
    await flushPromises();

    expect(groupOrderMock.addToCart).toHaveBeenCalledTimes(1);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(addCartItem).not.toHaveBeenCalled();
  });
});
