import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PoliciesView from "./PoliciesView.vue";
import { marketsApi, policiesApi } from "@/services/api";

vi.mock("vue-toastification", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/services/api", () => ({
  policiesApi: {
    registry: vi.fn(),
    list: vi.fn(),
    set: vi.fn(),
    clear: vi.fn(),
  },
  marketsApi: { list: vi.fn() },
}));

describe("PoliciesView", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(policiesApi.registry).mockResolvedValue([
      {
        key: "modules.disabled",
        merge: "ceiling_deny",
        scopes: ["country"],
        ui: { kind: "list", options: ["pos", "loyalty"] },
      },
      {
        key: "payments.allowed_providers",
        merge: "ceiling_allow",
        scopes: ["country", "market"],
        ui: { kind: "list", options: ["tng", "grabpay"] },
      },
      {
        key: "pricing.default_tax_rate_bps",
        merge: "default",
        scopes: ["country"],
        ui: { kind: "bps" },
      },
    ]);
    vi.mocked(policiesApi.list).mockResolvedValue({
      scopeType: "country",
      scopeId: "TW",
      policies: {
        "pricing.default_tax_rate_bps": {
          value: 500,
          updatedBy: "a@b.c",
          updatedAt: 0,
        },
      },
      restaurantsWithoutCountry: 3,
    });
    vi.mocked(policiesApi.set).mockResolvedValue(undefined);
    vi.mocked(policiesApi.clear).mockResolvedValue(undefined);
    vi.mocked(marketsApi.list).mockResolvedValue({
      markets: [
        {
          id: "m-1",
          slug: "fengjia",
          name: "逢甲夜市",
          type: "night_market",
          city: "台中市",
          district: "西屯區",
        } as never,
      ],
      total: 1,
      page: 1,
      limit: 100,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the TW country scope and shows bps as a percentage", async () => {
    const wrapper = mount(PoliciesView);
    await flushPromises();

    expect(policiesApi.list).toHaveBeenCalledWith("country", "TW");
    const input = wrapper.get(
      '[data-testid="policy-input-pricing.default_tax_rate_bps"]',
    );
    expect((input.element as HTMLInputElement).value).toBe("5");
    expect(
      wrapper.get('[data-testid="policies-unknown-country"]').text(),
    ).toContain("3");
  });

  it("marks unset keys as inherited", async () => {
    const wrapper = mount(PoliciesView);
    await flushPromises();
    expect(
      wrapper
        .get('[data-testid="policy-row-modules.disabled"]')
        .attributes("data-state"),
    ).toBe("unset");
  });

  it("saves a percentage back as bps", async () => {
    const wrapper = mount(PoliciesView);
    await flushPromises();
    await wrapper
      .get('[data-testid="policy-input-pricing.default_tax_rate_bps"]')
      .setValue("6.5");
    await wrapper
      .get('[data-testid="policy-save-pricing.default_tax_rate_bps"]')
      .trigger("click");
    await flushPromises();

    expect(policiesApi.set).toHaveBeenCalledWith(
      "country",
      "TW",
      "pricing.default_tax_rate_bps",
      650,
    );
  });

  it("asks before writing past shops with no country, then resends the count", async () => {
    vi.mocked(policiesApi.set).mockRejectedValueOnce({
      response: {
        data: {
          error: {
            code: "POLICY_BLOCKED_BY_UNKNOWN_COUNTRY",
            details: { count: 3 },
          },
        },
      },
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const wrapper = mount(PoliciesView);
    await flushPromises();
    await wrapper
      .get('[data-testid="policy-option-modules.disabled-pos"]')
      .setValue(true);
    await wrapper
      .get('[data-testid="policy-save-modules.disabled"]')
      .trigger("click");
    await flushPromises();

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("3"));
    expect(policiesApi.set).toHaveBeenNthCalledWith(
      1,
      "country",
      "TW",
      "modules.disabled",
      ["pos"],
    );
    expect(policiesApi.set).toHaveBeenNthCalledWith(
      2,
      "country",
      "TW",
      "modules.disabled",
      ["pos"],
      3,
    );
  });

  it("does not resend when the admin declines", async () => {
    vi.mocked(policiesApi.set).mockRejectedValueOnce({
      response: {
        data: {
          error: {
            code: "POLICY_BLOCKED_BY_UNKNOWN_COUNTRY",
            details: { count: 3 },
          },
        },
      },
    });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const wrapper = mount(PoliciesView);
    await flushPromises();
    await wrapper
      .get('[data-testid="policy-save-modules.disabled"]')
      .trigger("click");
    await flushPromises();

    expect(policiesApi.set).toHaveBeenCalledTimes(1);
  });

  it.each(["", "abc", "-1", "100.01"])(
    "will not save the percentage %j",
    async (input) => {
      const wrapper = mount(PoliciesView);
      await flushPromises();
      await wrapper
        .get('[data-testid="policy-input-pricing.default_tax_rate_bps"]')
        .setValue(input);
      const save = wrapper.get(
        '[data-testid="policy-save-pricing.default_tax_rate_bps"]',
      );
      expect(save.attributes("disabled")).toBeDefined();
      await save.trigger("click");
      await flushPromises();
      expect(policiesApi.set).not.toHaveBeenCalled();
    },
  );

  it("offers markets beyond the first page", async () => {
    const market = (id: string) =>
      ({
        id,
        slug: id,
        name: id,
        type: "night_market",
        city: "台中市",
        district: "西屯區",
      }) as never;
    vi.mocked(marketsApi.list)
      .mockResolvedValueOnce({
        markets: [market("m-1")],
        total: 2,
        page: 1,
        limit: 100,
      })
      .mockResolvedValueOnce({
        markets: [market("m-101")],
        total: 2,
        page: 2,
        limit: 100,
      });
    const wrapper = mount(PoliciesView);
    await flushPromises();

    expect(marketsApi.list).toHaveBeenLastCalledWith({ limit: 100, page: 2 });
    expect(
      wrapper
        .findAll('[data-testid="policies-market-select"] option')
        .map((o) => o.attributes("value")),
    ).toEqual(["", "m-1", "m-101"]);
  });

  it("clears a key", async () => {
    const wrapper = mount(PoliciesView);
    await flushPromises();
    await wrapper
      .get('[data-testid="policy-clear-pricing.default_tax_rate_bps"]')
      .trigger("click");
    await flushPromises();

    expect(policiesApi.clear).toHaveBeenCalledWith(
      "country",
      "TW",
      "pricing.default_tax_rate_bps",
    );
  });

  it("shows only market-scope keys for a market", async () => {
    const wrapper = mount(PoliciesView);
    await flushPromises();
    await wrapper.get('[data-testid="policies-market-select"]').setValue("m-1");
    await flushPromises();

    expect(policiesApi.list).toHaveBeenLastCalledWith("market", "m-1");
    expect(
      wrapper
        .find('[data-testid="policy-row-payments.allowed_providers"]')
        .exists(),
    ).toBe(true);
    expect(
      wrapper.find('[data-testid="policy-row-modules.disabled"]').exists(),
    ).toBe(false);
    expect(
      wrapper
        .find('[data-testid="policy-row-pricing.default_tax_rate_bps"]')
        .exists(),
    ).toBe(false);
  });
});
