// @vitest-environment jsdom

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Component } from "vue";
import type {
  BroadcastHistoryItem,
  BroadcastListResult,
} from "@/services/broadcastsService";

const send = vi.hoisted(() => vi.fn());
const list = vi.hoisted(() => vi.fn());
const sendToMarket = vi.hoisted(() => vi.fn());
const listForMarket = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock("vue-toastification", () => ({ useToast: () => toast }));
vi.mock("@/services/broadcastsService", () => ({
  broadcastsService: { send, list, sendToMarket, listForMarket },
}));

const TEXT = {
  confirmAudienceMarket: "將推播給追蹤本市集且同意行銷的顧客",
  includeMarket: "同時通知市集追蹤者",
  quotaOneOfOne: "今日剩餘 1 / 1 則",
  quotaExhausted: "今日額度已用完，明天才能再發送。",
} as const;

const HOUR_MS = 60 * 60 * 1000;

let BroadcastComposer: Component;

function historyItem(
  overrides: Partial<BroadcastHistoryItem> = {},
): BroadcastHistoryItem {
  return {
    id: "bc-m1",
    scopeType: "market",
    scopeId: "market-1",
    title: "颱風休市",
    body: "本週六暫停營業",
    url: null,
    sentBy: "user-admin",
    audienceCount: 80,
    deliveredCount: 74,
    failedCount: 3,
    skippedCount: 5,
    createdAt: Date.now() - 2 * HOUR_MS,
    completedAt: Date.now() - 2 * HOUR_MS + 4000,
    ...overrides,
  };
}

function listResult(rows: BroadcastHistoryItem[] = []): BroadcastListResult {
  return {
    broadcasts: rows,
    pagination: {
      page: 1,
      limit: 20,
      total: rows.length,
      totalPages: rows.length === 0 ? 0 : 1,
    },
  };
}

async function mountMarket(scopeId = "market-1"): Promise<VueWrapper> {
  const wrapper = mount(BroadcastComposer, {
    props: { scopeType: "market", scopeId },
  });
  await flushPromises();
  return wrapper;
}

describe("BroadcastComposer in market mode", () => {
  beforeAll(async () => {
    listForMarket.mockResolvedValue(listResult());
    BroadcastComposer = (await import("./BroadcastComposer.vue")).default;
    const warmup = mount(BroadcastComposer, {
      props: { scopeType: "market", scopeId: "market-1" },
    });
    await flushPromises();
    warmup.unmount();
  }, 30_000);

  beforeEach(() => {
    vi.clearAllMocks();
    listForMarket.mockResolvedValue(listResult());
    sendToMarket.mockResolvedValue({
      id: "bc-m2",
      audienceCount: 80,
      deliveredCount: 74,
      failedCount: 3,
      skippedCount: 5,
    });
  });

  it("reads the market's own history, not a restaurant's", async () => {
    listForMarket.mockResolvedValue(listResult([historyItem()]));

    const wrapper = await mountMarket();

    expect(listForMarket).toHaveBeenCalledWith(
      "market-1",
      expect.objectContaining({ page: 1 }),
    );
    expect(list).not.toHaveBeenCalled();
    expect(
      wrapper.get('[data-testid="broadcast-history-item"]').text(),
    ).toContain("颱風休市");
  });

  it("offers no market-followers control, because the market route drops it", async () => {
    const wrapper = await mountMarket();

    expect(
      wrapper.find('[data-testid="broadcast-include-market"]').exists(),
    ).toBe(false);
    expect(wrapper.text()).not.toContain(TEXT.includeMarket);
  });

  it("sends through the market endpoint and names the market audience", async () => {
    const wrapper = await mountMarket();

    await wrapper.get('[data-testid="broadcast-title"]').setValue("颱風休市");
    await wrapper
      .get('[data-testid="broadcast-body"]')
      .setValue("本週六暫停營業");
    await wrapper.get('[data-testid="broadcast-submit"]').trigger("click");

    expect(wrapper.text()).toContain(TEXT.confirmAudienceMarket);

    await wrapper.get('[data-testid="broadcast-confirm"]').trigger("click");
    await flushPromises();

    expect(sendToMarket).toHaveBeenCalledOnce();
    expect(sendToMarket).toHaveBeenCalledWith(
      "market-1",
      expect.objectContaining({ title: "颱風休市", body: "本週六暫停營業" }),
    );
    expect(sendToMarket).toHaveBeenCalledWith(
      "market-1",
      expect.not.objectContaining({
        includeMarketFollowers: expect.anything(),
      }),
    );
    expect(send).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="broadcast-result"]').exists()).toBe(
      true,
    );
  });

  it("shows the market's tighter 1-per-24h budget", async () => {
    const wrapper = await mountMarket();
    expect(wrapper.get('[data-testid="broadcast-quota"]').text()).toContain(
      TEXT.quotaOneOfOne,
    );

    listForMarket.mockResolvedValue(
      listResult([historyItem({ createdAt: Date.now() - 1000 })]),
    );
    const spent = await mountMarket();
    expect(spent.get('[data-testid="broadcast-quota"]').text()).toContain(
      TEXT.quotaExhausted,
    );
    expect(
      spent.get('[data-testid="broadcast-submit"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("re-reads the history for the market it is switched to", async () => {
    const wrapper = await mountMarket();
    listForMarket.mockClear();

    await wrapper.setProps({ scopeId: "market-2" });
    await flushPromises();

    expect(listForMarket).toHaveBeenLastCalledWith(
      "market-2",
      expect.objectContaining({ page: 1 }),
    );
  });
});
