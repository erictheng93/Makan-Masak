// @vitest-environment jsdom

import { mount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PrintAgentsView from "./PrintAgentsView.vue";

const getPrintAgents = vi.fn();
const issuePrintAgent = vi.fn();
const revokePrintAgent = vi.fn();
const getRegisters = vi.fn();
const authState = {
  restaurantId: "restaurant-1" as string | null,
  canManagePrintAgents: true,
};

vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: ref("zh-TW") }),
}));

vi.mock("@/services/posService", () => ({
  posService: {
    getPrintAgents: (...args: unknown[]) => getPrintAgents(...args),
    issuePrintAgent: (...args: unknown[]) => issuePrintAgent(...args),
    revokePrintAgent: (...args: unknown[]) => revokePrintAgent(...args),
    getRegisters: (...args: unknown[]) => getRegisters(...args),
  },
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({
    get restaurantId() {
      return authState.restaurantId;
    },
    hasPermission: () => authState.canManagePrintAgents,
  }),
}));

function agent(overrides: Record<string, unknown> = {}) {
  return {
    id: "agent-1",
    restaurantId: "restaurant-1",
    registerId: null,
    registerName: null,
    label: "廚房出單機",
    status: "online",
    printersTotal: 1,
    printersOnline: 1,
    lastSeenAt: "2026-08-21T00:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("PrintAgentsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPrintAgents.mockResolvedValue([]);
    getRegisters.mockResolvedValue([]);
    authState.restaurantId = "restaurant-1";
    authState.canManagePrintAgents = true;
  });

  it("shows an empty state when no agent has been issued", async () => {
    const wrapper = mount(PrintAgentsView);
    await flushPromises();

    expect(getPrintAgents).toHaveBeenCalledWith("restaurant-1");
    expect(wrapper.find('[data-testid="print-agents-empty"]').exists()).toBe(
      true,
    );
  });

  it("surfaces each agent's status", async () => {
    getPrintAgents.mockResolvedValue([
      agent({ id: "a", status: "no_printer" }),
      agent({ id: "b", status: "offline" }),
    ]);

    const wrapper = mount(PrintAgentsView);
    await flushPromises();

    const rows = wrapper.findAll('[data-testid="print-agent-row"]');
    expect(rows).toHaveLength(2);
    // The distinction this whole feature exists for: an agent that is alive
    // but has no working printer must not read the same as a healthy one.
    expect(rows[0].attributes("data-status")).toBe("no_printer");
    expect(rows[1].attributes("data-status")).toBe("offline");
  });

  it("follows agent heartbeats in the background, keeping rows on a failed tick", async () => {
    vi.useFakeTimers();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      getPrintAgents.mockResolvedValue([agent({ id: "a", status: "online" })]);
      const wrapper = mount(PrintAgentsView);
      await flushPromises();
      const status = () =>
        wrapper
          .get('[data-testid="print-agent-row"]')
          .attributes("data-status");
      expect(status()).toBe("online");

      getPrintAgents.mockResolvedValue([agent({ id: "a", status: "offline" })]);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(status()).toBe("offline");

      getPrintAgents.mockRejectedValueOnce(new Error("network"));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(wrapper.find('[data-testid="print-agents-error"]').exists()).toBe(
        false,
      );
      expect(status()).toBe("offline");

      wrapper.unmount();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(getPrintAgents).toHaveBeenCalledTimes(3);
    } finally {
      consoleError.mockRestore();
      vi.useRealTimers();
    }
  });

  it("issues a shop-wide agent when no till is chosen", async () => {
    issuePrintAgent.mockResolvedValue({ ...agent(), key: "mmpa_secret" });

    const wrapper = mount(PrintAgentsView);
    await flushPromises();
    await wrapper.find('[data-testid="issue-agent"]').trigger("click");
    await wrapper.find('[data-testid="agent-label"]').setValue("廚房出單機");
    await wrapper.find('[data-testid="issue-form"]').trigger("submit");
    await flushPromises();

    expect(issuePrintAgent).toHaveBeenCalledWith(
      {
        label: "廚房出單機",
        registerId: undefined,
      },
      "restaurant-1",
    );
  });

  it("shows the plaintext key once after issuing", async () => {
    issuePrintAgent.mockResolvedValue({ ...agent(), key: "mmpa_secret" });

    const wrapper = mount(PrintAgentsView);
    await flushPromises();
    await wrapper.find('[data-testid="issue-agent"]').trigger("click");
    await wrapper.find('[data-testid="agent-label"]').setValue("x");
    await wrapper.find('[data-testid="issue-form"]').trigger("submit");
    await flushPromises();

    expect(wrapper.find('[data-testid="issued-key"]').text()).toContain(
      "mmpa_secret",
    );
  });

  it("still renders the agents when the register list cannot be loaded", async () => {
    // The register list only fills a dropdown. Losing it must not hide the
    // health of the agents, which is the reason to open this page.
    getPrintAgents.mockResolvedValue([agent()]);
    getRegisters.mockRejectedValue(new Error("registers unavailable"));

    const wrapper = mount(PrintAgentsView);
    await flushPromises();

    expect(wrapper.findAll('[data-testid="print-agent-row"]')).toHaveLength(1);
    expect(wrapper.find('[data-testid="print-agents-error"]').exists()).toBe(
      false,
    );
  });

  it("forwards the selected restaurant when revoking an agent", async () => {
    getPrintAgents.mockResolvedValue([agent()]);
    revokePrintAgent.mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const wrapper = mount(PrintAgentsView);
    await flushPromises();
    await wrapper.find('[data-testid="revoke-agent"]').trigger("click");
    await flushPromises();

    expect(revokePrintAgent).toHaveBeenCalledWith("agent-1", "restaurant-1");
  });

  it("hides credential actions from cashiers while retaining agent status", async () => {
    authState.canManagePrintAgents = false;
    getPrintAgents.mockResolvedValue([agent()]);

    const wrapper = mount(PrintAgentsView);
    await flushPromises();

    expect(wrapper.find('[data-testid="issue-agent"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="revoke-agent"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-testid="print-agent-row"]')).toHaveLength(1);
  });
});
