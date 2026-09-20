// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

// A plain box rather than a `ref`: `vi.hoisted` runs before this file's own
// imports are initialised, so anything it touches from `vue` is still in TDZ.
const currency = vi.hoisted(() => ({ value: "MYR" }));
const authState = vi.hoisted(() => ({
  restaurantId: "rest-1" as string | null,
}));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const serviceMock = vi.hoisted(() => ({
  list: vi.fn(),
  connect: vi.fn(),
  update: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("vue-toastification", () => ({ useToast: () => toastMock }));

vi.mock("@/composables/useCurrency", async () => {
  const { computed } = await import("vue");
  return {
    useCurrency: () => ({
      currencyCode: computed(() => currency.value),
      formatCents: (cents: number) => `RM ${(cents / 100).toFixed(2)}`,
    }),
  };
});

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({
    get restaurantId() {
      return authState.restaurantId;
    },
  }),
}));

// Mirrors the real return shape (`{ message, code?, ... }`). A mock that
// returned the bare string would let `resolveUserFacingError(...)` be used
// where a string is wanted and only typecheck would notice.
vi.mock("@makanmasak/shared/utils/user-facing-error", () => ({
  resolveUserFacingError: (
    _error: unknown,
    _t: unknown,
    opts: { fallbackKey: string },
  ) => ({ message: opts.fallbackKey, presentation: "toast" }),
}));

vi.mock("@/services/shopPaymentsService", () => ({
  shopPaymentsService: serviceMock,
}));

const ShopWalletSettings = (await import("./ShopWalletSettings.vue")).default;

function buildCredential(overrides: Record<string, unknown> = {}) {
  return {
    id: "cred-1",
    restaurantId: "rest-1",
    provider: "tng",
    status: "connected",
    merchantIdMasked: "••••7788",
    displayName: "Jalan Alor stall",
    environment: "sandbox",
    config: {},
    secretConfigured: true,
    secretUpdatedAtMs: 1_700_000_000_000,
    connectedAtMs: 1_700_000_000_000,
    disabledAtMs: null,
    createdAtMs: 1_700_000_000_000,
    updatedAtMs: 1_700_000_000_000,
    ...overrides,
  };
}

async function mountComponent() {
  const wrapper = mount(ShopWalletSettings);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  currency.value = "MYR";
  authState.restaurantId = "rest-1";
  serviceMock.list.mockResolvedValue({
    credentials: [],
    supportedProviders: ["tng", "grabpay"],
  });
  serviceMock.connect.mockResolvedValue(buildCredential());
  serviceMock.update.mockResolvedValue(buildCredential());
  serviceMock.disconnect.mockResolvedValue(undefined);
});

describe("currency gating", () => {
  it("shows the section for an MYR shop", async () => {
    const wrapper = await mountComponent();

    expect(
      wrapper.find('[data-testid="shop-wallet-unavailable"]').exists(),
    ).toBe(false);
    expect(wrapper.find('[data-testid="shop-wallet-card-tng"]').exists()).toBe(
      true,
    );
    expect(
      wrapper.find('[data-testid="shop-wallet-card-grabpay"]').exists(),
    ).toBe(true);
    expect(serviceMock.list).toHaveBeenCalledWith("rest-1");
  });

  it.each(["TWD", "VND"])(
    "explains rather than offering the form to a %s shop",
    async (code) => {
      currency.value = code;
      const wrapper = await mountComponent();

      expect(
        wrapper.find('[data-testid="shop-wallet-unavailable"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-testid="shop-wallet-card-tng"]').exists(),
      ).toBe(false);
      // Nothing is fetched for a shop that cannot connect either wallet.
      expect(serviceMock.list).not.toHaveBeenCalled();
    },
  );

  it("asks for a restaurant before anything else when none is selected", async () => {
    authState.restaurantId = null;
    const wrapper = await mountComponent();

    expect(
      wrapper.find('[data-testid="shop-wallet-no-restaurant"]').exists(),
    ).toBe(true);
    expect(serviceMock.list).not.toHaveBeenCalled();
  });
});

describe("connection state", () => {
  it("shows the masked merchant id for a connected wallet, never a full one", async () => {
    serviceMock.list.mockResolvedValue({
      credentials: [buildCredential()],
      supportedProviders: ["tng", "grabpay"],
    });
    const wrapper = await mountComponent();

    expect(
      wrapper
        .find('[data-testid="shop-wallet-card-tng"]')
        .attributes("data-status"),
    ).toBe("connected");
    expect(
      wrapper.find('[data-testid="shop-wallet-merchant-tng"]').text(),
    ).toBe("••••7788");
    expect(wrapper.html()).not.toContain("TNG-MERCHANT");
    // The wallet with no row reads as not connected rather than as an error.
    expect(
      wrapper
        .find('[data-testid="shop-wallet-card-grabpay"]')
        .attributes("data-status"),
    ).toBe("notConnected");
  });

  it("says payouts go to the shop's own account, in the shop's currency", async () => {
    const wrapper = await mountComponent();
    expect(
      wrapper.find('[data-testid="shop-wallet-payout-note"]').exists(),
    ).toBe(true);
  });

  it("surfaces a load failure instead of showing an empty, connectable state", async () => {
    serviceMock.list.mockRejectedValue(new Error("boom"));
    const wrapper = await mountComponent();

    expect(wrapper.find('[data-testid="shop-wallet-error"]').text()).toBe(
      "shopWallet.alerts.loadFailed",
    );
  });
});

describe("connecting", () => {
  it("sends the merchant id and the secret, and reloads", async () => {
    const wrapper = await mountComponent();
    await wrapper
      .find('[data-testid="shop-wallet-connect-tng"]')
      .trigger("click");

    await wrapper
      .find('[data-testid="shop-wallet-merchant-input-tng"]')
      .setValue("TNG-MERCHANT-7788");
    await wrapper
      .find('[data-testid="shop-wallet-key-input-tng"]')
      .setValue("super-secret-key");
    await wrapper
      .find('[data-testid="shop-wallet-form-tng"]')
      .trigger("submit");
    await flushPromises();

    expect(serviceMock.connect).toHaveBeenCalledOnce();
    expect(serviceMock.connect).toHaveBeenCalledWith(
      "rest-1",
      "tng",
      expect.objectContaining({
        merchantId: "TNG-MERCHANT-7788",
        secret: expect.objectContaining({ merchantKey: "super-secret-key" }),
      }),
    );
    expect(toastMock.success).toHaveBeenCalledWith("shopWallet.alerts.saved");
    expect(serviceMock.list).toHaveBeenCalledTimes(2);
  });

  it("refuses to connect with no secret at all", async () => {
    const wrapper = await mountComponent();
    await wrapper
      .find('[data-testid="shop-wallet-connect-tng"]')
      .trigger("click");
    await wrapper
      .find('[data-testid="shop-wallet-merchant-input-tng"]')
      .setValue("TNG-MERCHANT-7788");
    await wrapper
      .find('[data-testid="shop-wallet-form-tng"]')
      .trigger("submit");
    await flushPromises();

    expect(serviceMock.connect).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith(
      "shopWallet.alerts.secretRequired",
    );
  });

  it("opens the secret fields blank even when a key is already stored", async () => {
    serviceMock.list.mockResolvedValue({
      credentials: [buildCredential()],
      supportedProviders: ["tng", "grabpay"],
    });
    const wrapper = await mountComponent();
    await wrapper
      .find('[data-testid="shop-wallet-connect-tng"]')
      .trigger("click");

    const keyInput = wrapper.find<HTMLInputElement>(
      '[data-testid="shop-wallet-key-input-tng"]',
    );
    expect(keyInput.element.value).toBe("");
    expect(keyInput.attributes("type")).toBe("password");
  });

  it("updates without a secret, keeping the stored one", async () => {
    serviceMock.list.mockResolvedValue({
      credentials: [buildCredential()],
      supportedProviders: ["tng", "grabpay"],
    });
    const wrapper = await mountComponent();
    await wrapper
      .find('[data-testid="shop-wallet-connect-tng"]')
      .trigger("click");
    await wrapper
      .find('[data-testid="shop-wallet-form-tng"]')
      .trigger("submit");
    await flushPromises();

    expect(serviceMock.update).toHaveBeenCalledOnce();
    expect(serviceMock.update.mock.calls[0]?.[2]).not.toHaveProperty("secret");
  });

  it("reports a save failure to the owner", async () => {
    serviceMock.connect.mockRejectedValue(new Error("nope"));
    const wrapper = await mountComponent();
    await wrapper
      .find('[data-testid="shop-wallet-connect-tng"]')
      .trigger("click");
    await wrapper
      .find('[data-testid="shop-wallet-merchant-input-tng"]')
      .setValue("M");
    await wrapper
      .find('[data-testid="shop-wallet-key-input-tng"]')
      .setValue("k");
    await wrapper
      .find('[data-testid="shop-wallet-form-tng"]')
      .trigger("submit");
    await flushPromises();

    expect(toastMock.error).toHaveBeenCalledWith(
      "shopWallet.alerts.saveFailed",
    );
  });
});

describe("disconnecting", () => {
  it("disconnects a connected wallet and reloads", async () => {
    serviceMock.list.mockResolvedValue({
      credentials: [buildCredential()],
      supportedProviders: ["tng", "grabpay"],
    });
    const wrapper = await mountComponent();
    await wrapper
      .find('[data-testid="shop-wallet-disconnect-tng"]')
      .trigger("click");
    await flushPromises();

    expect(serviceMock.disconnect).toHaveBeenCalledWith("rest-1", "tng");
    expect(toastMock.success).toHaveBeenCalledWith(
      "shopWallet.alerts.disconnected",
    );
  });

  it("offers no disconnect for a wallet that was never connected", async () => {
    const wrapper = await mountComponent();
    expect(
      wrapper.find('[data-testid="shop-wallet-disconnect-tng"]').exists(),
    ).toBe(false);
  });
});
