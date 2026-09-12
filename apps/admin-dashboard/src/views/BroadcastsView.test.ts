// @vitest-environment jsdom

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Component } from "vue";
import type {
  BroadcastHistoryItem,
  BroadcastListResult,
  SendBroadcastResult,
} from "@/services/broadcastsService";

const send = vi.hoisted(() => vi.fn());
const list = vi.hoisted(() => vi.fn());
const sendToMarket = vi.hoisted(() => vi.fn());
const listForMarket = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
const authState = vi.hoisted(() => ({
  restaurantId: "shop-1" as string | null,
}));

// `@/i18n` is deliberately NOT mocked, for the reason ReviewsView.test.ts
// gives: a `t: (key) => key` stub makes a missing translation key
// indistinguishable from a present one (#113). The literals below are the
// zh-TW source strings, spelled out rather than read back out of the catalog.
vi.mock("vue-toastification", () => ({ useToast: () => toast }));
vi.mock("@/stores/auth", () => ({ useAuthStore: () => authState }));
vi.mock("@/services/broadcastsService", () => ({
  broadcastsService: { send, list, sendToMarket, listForMarket },
}));

const TEXT = {
  noRestaurant: "請先選擇要推播的店家。",
  confirmAudience: "將推播給追蹤本店且同意行銷的顧客",
  irreversible: "推播送出後無法收回，也無法修改。",
  resultHeading: "已送出",
  peopleNotDevices: "觸及人數算人",
  historyEmpty: "還沒有發送過推播。",
  forbidden: "沒有權限為這個對象發送推播。",
  loadFailed: "無法載入發送紀錄，請稍後再試。",
  rateLimited: "1 小時 0 分後可再發送",
  quotaTwoOfThree: "今日剩餘 2 / 3 則",
  quotaThreeOfThree: "今日剩餘 3 / 3 則",
  quotaExhausted: "今日額度已用完，明天才能再發送。",
} as const;

const HOUR_MS = 60 * 60 * 1000;

let BroadcastsView: Component;

function historyItem(
  overrides: Partial<BroadcastHistoryItem> = {},
): BroadcastHistoryItem {
  return {
    id: "bc-1",
    scopeType: "restaurant",
    scopeId: "shop-1",
    title: "今晚半價",
    body: "全品項半價至 22:00",
    url: "/r/shop-1",
    sentBy: "user-1",
    audienceCount: 12,
    deliveredCount: 9,
    failedCount: 1,
    skippedCount: 2,
    createdAt: Date.now() - 2 * HOUR_MS,
    completedAt: Date.now() - 2 * HOUR_MS + 3000,
    ...overrides,
  };
}

function listResult(
  rows: BroadcastHistoryItem[] = [historyItem()],
  overrides: Partial<BroadcastListResult["pagination"]> = {},
): BroadcastListResult {
  return {
    broadcasts: rows,
    pagination: {
      page: 1,
      limit: 20,
      total: rows.length,
      totalPages: rows.length === 0 ? 0 : 1,
      ...overrides,
    },
  };
}

function sendResult(
  overrides: Partial<SendBroadcastResult> = {},
): SendBroadcastResult {
  return {
    id: "bc-new",
    audienceCount: 41,
    deliveredCount: 37,
    failedCount: 2,
    skippedCount: 5,
    ...overrides,
  };
}

/** An axios-shaped rejection carrying the unified error envelope. */
function apiError(code: string, details?: unknown) {
  return { response: { data: { success: false, error: { code, details } } } };
}

async function mountView(): Promise<VueWrapper> {
  const wrapper = mount(BroadcastsView);
  await flushPromises();
  return wrapper;
}

async function compose(
  wrapper: VueWrapper,
  fields: { title?: string; body?: string; url?: string } = {},
): Promise<void> {
  await wrapper
    .get('[data-testid="broadcast-title"]')
    .setValue(fields.title ?? "今晚半價");
  await wrapper
    .get('[data-testid="broadcast-body"]')
    .setValue(fields.body ?? "全品項半價至 22:00");
  if (fields.url !== undefined) {
    await wrapper.get('[data-testid="broadcast-url"]').setValue(fields.url);
  }
}

describe("BroadcastsView", () => {
  // Pays the first mount — the real i18n runtime, lucide icons and the whole
  // component transform — once, under this hook's own budget rather than
  // against a 5s test body (#211/#351/#360).
  beforeAll(async () => {
    list.mockResolvedValue(listResult([]));
    BroadcastsView = (await import("./BroadcastsView.vue")).default;
    const warmup = mount(BroadcastsView);
    await flushPromises();
    warmup.unmount();
  }, 30_000);

  beforeEach(() => {
    vi.clearAllMocks();
    authState.restaurantId = "shop-1";
    list.mockResolvedValue(listResult([]));
    send.mockResolvedValue(sendResult());
  });

  it("keeps send disabled until both the title and the body are filled in", async () => {
    const wrapper = await mountView();
    const submit = wrapper.get('[data-testid="broadcast-submit"]');

    expect(submit.attributes("disabled")).toBeDefined();

    await wrapper.get('[data-testid="broadcast-title"]').setValue("今晚半價");
    expect(submit.attributes("disabled")).toBeDefined();

    await wrapper
      .get('[data-testid="broadcast-body"]')
      .setValue("全品項半價至 22:00");
    expect(submit.attributes("disabled")).toBeUndefined();

    // Whitespace is not content: the server trims before its min(1) check, so
    // a spaces-only title has to read as empty here too rather than as a 400.
    await wrapper.get('[data-testid="broadcast-title"]').setValue("   ");
    expect(submit.attributes("disabled")).toBeDefined();
  });

  it("counts the characters left in the title and the body against the server's caps", async () => {
    const wrapper = await mountView();

    expect(wrapper.get('[data-testid="broadcast-title-counter"]').text()).toBe(
      "0 / 80",
    );
    expect(wrapper.get('[data-testid="broadcast-body-counter"]').text()).toBe(
      "0 / 300",
    );

    await compose(wrapper);

    expect(wrapper.get('[data-testid="broadcast-title-counter"]').text()).toBe(
      "4 / 80",
    );
    expect(wrapper.get('[data-testid="broadcast-body-counter"]').text()).toBe(
      "12 / 300",
    );
    expect(
      wrapper.get('[data-testid="broadcast-title"]').attributes("maxlength"),
    ).toBe("80");
    expect(
      wrapper.get('[data-testid="broadcast-body"]').attributes("maxlength"),
    ).toBe("300");
  });

  it("asks for confirmation before it sends anything", async () => {
    const wrapper = await mountView();
    await compose(wrapper);

    expect(wrapper.find('[data-testid="broadcast-confirm"]').exists()).toBe(
      false,
    );

    await wrapper.get('[data-testid="broadcast-submit"]').trigger("click");

    // The confirm step exists because there is no audience-preview endpoint:
    // it names who will be reached without promising a number.
    expect(wrapper.text()).toContain(TEXT.confirmAudience);
    expect(wrapper.text()).toContain(TEXT.irreversible);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends once on confirm and reports audience, delivered, failed and skipped", async () => {
    const wrapper = await mountView();
    await compose(wrapper, { url: "/r/shop-1" });
    await wrapper
      .get('[data-testid="broadcast-include-market"]')
      .setValue(true);

    await wrapper.get('[data-testid="broadcast-submit"]').trigger("click");
    await wrapper.get('[data-testid="broadcast-confirm"]').trigger("click");
    await flushPromises();

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(
      "shop-1",
      expect.objectContaining({
        title: "今晚半價",
        body: "全品項半價至 22:00",
        url: "/r/shop-1",
        includeMarketFollowers: true,
      }),
    );

    const result = wrapper.get('[data-testid="broadcast-result"]');
    expect(result.text()).toContain(TEXT.resultHeading);
    expect(result.get('[data-testid="broadcast-result-audience"]').text()).toBe(
      "41",
    );
    expect(
      result.get('[data-testid="broadcast-result-delivered"]').text(),
    ).toBe("37");
    expect(result.get('[data-testid="broadcast-result-failed"]').text()).toBe(
      "2",
    );
    expect(result.get('[data-testid="broadcast-result-skipped"]').text()).toBe(
      "5",
    );
    // 41 people and 44 deliveries is not an arithmetic error, and the card has
    // to say so or the first reading of it is "three pushes went missing".
    expect(result.text()).toContain(TEXT.peopleNotDevices);

    // The history is re-read from page 1 so the row just written shows up.
    expect(list).toHaveBeenLastCalledWith(
      "shop-1",
      expect.objectContaining({ page: 1 }),
    );
  });

  it("renders the history rows with their counts, link and sent time", async () => {
    list.mockResolvedValue(
      listResult([
        historyItem(),
        historyItem({ id: "bc-2", title: "公休通知", url: null }),
      ]),
    );

    const wrapper = await mountView();

    const rows = wrapper.findAll('[data-testid="broadcast-history-item"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain("今晚半價");
    expect(rows[0].text()).toContain("全品項半價至 22:00");
    expect(rows[0].text()).toContain("/r/shop-1");
    expect(rows[0].text()).toContain("12");
    expect(rows[0].text()).toContain("9");
    expect(rows[1].text()).toContain("公休通知");
    expect(rows[1].text()).not.toContain("/r/shop-1");
  });

  it("pages through the history without re-deriving today's quota from page 2", async () => {
    list.mockResolvedValue(
      listResult([historyItem()], { total: 30, totalPages: 2 }),
    );

    const wrapper = await mountView();
    expect(wrapper.get('[data-testid="broadcast-quota"]').text()).toContain(
      TEXT.quotaTwoOfThree,
    );

    // Page 2 is older than the window by construction. Counting the quota from
    // whatever page happens to be on screen would read as a refilled budget.
    list.mockResolvedValue(
      listResult(
        [historyItem({ id: "bc-old", createdAt: Date.now() - 40 * HOUR_MS })],
        {
          page: 2,
          total: 30,
          totalPages: 2,
        },
      ),
    );
    await wrapper
      .get('[data-testid="broadcast-history-next"]')
      .trigger("click");
    await flushPromises();

    expect(list).toHaveBeenLastCalledWith(
      "shop-1",
      expect.objectContaining({ page: 2 }),
    );
    expect(wrapper.get('[data-testid="broadcast-quota"]').text()).toContain(
      TEXT.quotaTwoOfThree,
    );
  });

  it("counts only the last 24 hours against today's quota", async () => {
    list.mockResolvedValue(
      listResult([
        historyItem({ id: "bc-a", createdAt: Date.now() - 1000 }),
        historyItem({ id: "bc-b", createdAt: Date.now() - 25 * HOUR_MS }),
        historyItem({ id: "bc-c", createdAt: Date.now() - 40 * HOUR_MS }),
      ]),
    );

    const wrapper = await mountView();

    expect(wrapper.get('[data-testid="broadcast-quota"]').text()).toContain(
      TEXT.quotaTwoOfThree,
    );
  });

  it("blocks the send when all three of today's sends are spent", async () => {
    list.mockResolvedValue(
      listResult([
        historyItem({ id: "bc-a", createdAt: Date.now() - 1000 }),
        historyItem({ id: "bc-b", createdAt: Date.now() - 2000 }),
        historyItem({ id: "bc-c", createdAt: Date.now() - 3000 }),
      ]),
    );

    const wrapper = await mountView();
    await compose(wrapper);

    expect(wrapper.get('[data-testid="broadcast-quota"]').text()).toContain(
      TEXT.quotaExhausted,
    );
    expect(
      wrapper.get('[data-testid="broadcast-submit"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("turns a 429 into the wait it has to be and disables the send", async () => {
    send.mockRejectedValue(
      apiError("BROADCAST_RATE_LIMITED", {
        limit: 3,
        windowMs: 86_400_000,
        retryAfterMs: HOUR_MS,
      }),
    );

    const wrapper = await mountView();
    await compose(wrapper);
    await wrapper.get('[data-testid="broadcast-submit"]').trigger("click");
    await wrapper.get('[data-testid="broadcast-confirm"]').trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain(TEXT.rateLimited);
    expect(
      wrapper.get('[data-testid="broadcast-submit"]').attributes("disabled"),
    ).toBeDefined();
    expect(wrapper.find('[data-testid="broadcast-result"]').exists()).toBe(
      false,
    );
  });

  it("surfaces one localized toast when the API refuses the restaurant", async () => {
    list.mockRejectedValue(apiError("FORBIDDEN"));

    const wrapper = await mountView();

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(TEXT.forbidden);
    expect(
      wrapper.findAll('[data-testid="broadcast-history-item"]'),
    ).toHaveLength(0);
  });

  it("falls back to the generic load message when the failure carries no code", async () => {
    list.mockRejectedValue(new Error("network down"));

    await mountView();

    expect(toast.error).toHaveBeenCalledWith(TEXT.loadFailed);
  });

  it("says so and calls nothing when no restaurant is selected", async () => {
    authState.restaurantId = null;

    const wrapper = await mountView();

    expect(list).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain(TEXT.noRestaurant);
    expect(wrapper.find('[data-testid="broadcast-submit"]').exists()).toBe(
      false,
    );
  });

  it("shows an empty history without pretending the shop is rate limited", async () => {
    const wrapper = await mountView();

    expect(wrapper.text()).toContain(TEXT.historyEmpty);
    expect(wrapper.get('[data-testid="broadcast-quota"]').text()).toContain(
      TEXT.quotaThreeOfThree,
    );
  });
});
