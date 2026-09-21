// @vitest-environment jsdom

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Component } from "vue";
import type {
  PlatformCustomerListItem,
  PlatformCustomerRestaurantSlice,
} from "@/services/platformCustomersService";

const list = vi.hoisted(() => vi.fn());
const listRestaurants = vi.hoisted(() => vi.fn());
const revealContact = vi.hoisted(() => vi.fn());
const confirmModal = vi.hoisted(() => vi.fn());

// `@/i18n` is deliberately NOT mocked, for the reason MembersView.test.ts
// gives: a `t: (key) => key` stub makes a missing translation key
// indistinguishable from a present one (#113).
vi.mock("@/composables/useConfirmModal", () => ({
  useConfirmModal: () => ({ confirm: confirmModal }),
}));
vi.mock("@/services/platformCustomersService", () => ({
  platformCustomersService: { list, listRestaurants, revealContact },
}));

// zh-TW literals, spelled out rather than read back from the catalog.
const TEXT = {
  deletedCustomer: "已刪除的顧客",
  emptyTitle: "尚無顧客資料",
  perRestaurant: "各店消費",
  perRestaurantHint: "只顯示消費金額，不包含各店自己的標籤與備註。",
  revealAction: "顯示完整聯絡方式",
  revealRateLimited: "本小時的查看次數已達上限（每小時 30 次），請稍後再試。",
  revealForbidden: "此顧客已刪除，無法查看完整聯絡方式。",
} as const;

let PlatformCustomersView: Component;

function customer(
  overrides: Partial<PlatformCustomerListItem> = {},
): PlatformCustomerListItem {
  return {
    customerId: "cust-a",
    displayName: "Wanderer",
    maskedPhone: "0912***678",
    maskedEmail: "w***@example.com",
    locale: "zh-TW",
    status: "active",
    restaurantCount: 2,
    orderCount: 5,
    totalSpentByCurrency: [
      { currency: "TWD", amountCents: 3000 },
      { currency: "MYR", amountCents: 1500 },
    ],
    lastOrderAt: "2026-08-30T00:00:00.000Z",
    createdAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function slice(
  overrides: Partial<PlatformCustomerRestaurantSlice> = {},
): PlatformCustomerRestaurantSlice {
  return {
    restaurantId: "shop-a",
    restaurantName: "阿婆小吃",
    orderCount: 3,
    cancelledOrderCount: 1,
    totalSpentCents: 3000,
    currency: "TWD",
    firstOrderAt: "2026-07-01T00:00:00.000Z",
    lastOrderAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function listResponse(rows: PlatformCustomerListItem[]) {
  return {
    data: rows,
    pagination: { total: rows.length, page: 1, limit: 20, pages: 1 },
  };
}

async function mountView() {
  const wrapper = mount(PlatformCustomersView, {
    global: { stubs: { teleport: true } },
  });
  await flushPromises();
  return wrapper;
}

async function openFirst(wrapper: VueWrapper) {
  await wrapper
    .get('[data-testid="platform-customer-row-cust-a"]')
    .trigger("click");
  await flushPromises();
}

describe("PlatformCustomersView", () => {
  // Pays the real i18n runtime and heroicons once, outside any test's 5s
  // budget (#211).
  beforeAll(async () => {
    PlatformCustomersView = (await import("./PlatformCustomersView.vue"))
      .default;
  }, 30_000);

  beforeEach(() => {
    vi.clearAllMocks();
    list.mockResolvedValue(listResponse([customer()]));
    listRestaurants.mockResolvedValue([slice()]);
    revealContact.mockResolvedValue({
      customerId: "cust-a",
      phone: "+886912345678",
      email: "wanderer@example.com",
    });
    confirmModal.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the cross-shop count no tenant page can produce, contact masked", async () => {
    const wrapper = await mountView();

    const row = wrapper.get('[data-testid="platform-customer-row-cust-a"]');
    expect(row.text()).toContain("Wanderer");
    expect(row.text()).toContain("0912***678");
    expect(row.text()).toContain("w***@example.com");
    expect(row.attributes("data-status")).toBe("active");
    expect(
      wrapper.get('[data-testid="platform-customer-restaurant-count"]').text(),
    ).toBe("2");
    expect(row.text()).toContain("NT$30");
    expect(row.text()).toContain("RM 15.00");
  });

  it("renders the localized placeholder for a deleted customer", async () => {
    list.mockResolvedValue(
      listResponse([
        customer({
          status: "deleted",
          displayName: null,
          maskedPhone: null,
          maskedEmail: null,
        }),
      ]),
    );

    const wrapper = await mountView();

    // The API sends null rather than a hardcoded label, because it serves six
    // locales; the copy is the client's.
    expect(wrapper.text()).toContain(TEXT.deletedCustomer);
  });

  it("renders the localized empty state", async () => {
    list.mockResolvedValue(listResponse([]));

    const wrapper = await mountView();

    expect(wrapper.text()).toContain(TEXT.emptyTitle);
  });

  it("sends the search, status and sort filters to the service", async () => {
    const wrapper = await mountView();
    list.mockClear();

    await wrapper.get("#platform-customer-status").setValue("deleted");
    await flushPromises();
    await wrapper.get("#platform-customer-sort").setValue("restaurants");
    await flushPromises();

    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "deleted",
        sort: "restaurants",
        page: 1,
        limit: 20,
      }),
    );
  });

  it("breaks the drawer down by shop and says spend is all it shows", async () => {
    const wrapper = await mountView();
    await openFirst(wrapper);

    expect(listRestaurants).toHaveBeenCalledWith("cust-a");
    const panel = wrapper.get('[data-testid="platform-customer-detail-panel"]');
    expect(panel.text()).toContain(TEXT.perRestaurant);
    // The hint is load-bearing copy, not decoration: it is what tells a
    // platform admin that a shop's own notes are not on this screen.
    expect(panel.text()).toContain(TEXT.perRestaurantHint);
    expect(
      wrapper.get('[data-testid="platform-customer-slice-shop-a"]').text(),
    ).toContain("阿婆小吃");
  });

  it("never reveals contact details without a confirmed, deliberate action", async () => {
    const wrapper = await mountView();
    await openFirst(wrapper);

    // Opening the drawer is not consent: the reveal writes an audit row and
    // spends a per-account rate-limit budget.
    expect(revealContact).not.toHaveBeenCalled();

    confirmModal.mockResolvedValue(false);
    await wrapper
      .get('[data-testid="platform-customer-reveal"]')
      .trigger("click");
    await flushPromises();

    expect(confirmModal).toHaveBeenCalledOnce();
    expect(revealContact).not.toHaveBeenCalled();
    expect(wrapper.get('[data-testid="platform-customer-phone"]').text()).toBe(
      "0912***678",
    );
  });

  it("shows the full value after confirmation and re-masks it on the timer", async () => {
    vi.useFakeTimers();
    const wrapper = await mountView();
    await openFirst(wrapper);

    await wrapper
      .get('[data-testid="platform-customer-reveal"]')
      .trigger("click");
    await flushPromises();

    expect(revealContact).toHaveBeenCalledWith("cust-a");
    expect(wrapper.get('[data-testid="platform-customer-phone"]').text()).toBe(
      "+886912345678",
    );

    // §9.2: a panel left open on a screen must stop being a standing
    // disclosure without anyone having to close it.
    vi.advanceTimersByTime(5 * 60 * 1000);
    await flushPromises();
    expect(wrapper.get('[data-testid="platform-customer-phone"]').text()).toBe(
      "0912***678",
    );
  });

  it("offers no reveal affordance at all for a deleted customer", async () => {
    list.mockResolvedValue(
      listResponse([
        customer({
          status: "deleted",
          displayName: null,
          maskedPhone: null,
          maskedEmail: null,
        }),
      ]),
    );
    const wrapper = await mountView();
    await openFirst(wrapper);

    expect(
      wrapper.find('[data-testid="platform-customer-reveal"]').exists(),
    ).toBe(false);
  });

  it.each([
    [429, TEXT.revealRateLimited],
    [403, TEXT.revealForbidden],
  ])("maps a %i from the reveal onto its own message", async (status, text) => {
    revealContact.mockRejectedValue({ response: { status } });
    const wrapper = await mountView();
    await openFirst(wrapper);

    await wrapper
      .get('[data-testid="platform-customer-reveal"]')
      .trigger("click");
    await flushPromises();

    expect(
      wrapper.get('[data-testid="platform-customer-reveal-error"]').text(),
    ).toBe(text);
  });
});
