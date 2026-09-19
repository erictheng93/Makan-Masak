// @vitest-environment jsdom

import { mount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OptionGroupsView from "./OptionGroupsView.vue";

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const patch = vi.fn();
const del = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

const RESTAURANT_ID = "019f9373-397c-7202-99d6-24c61976f3ff";

vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: ref("zh-TW") }),
}));

import {
  clearRestaurantCurrency,
  setRestaurantCurrency,
} from "@/composables/useCurrency";

vi.mock("@/composables/useCurrency", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/composables/useCurrency")>();
  return {
    ...actual,
    useCurrency: () => ({
      ...actual.useCurrency(),
      formatPrice: (value: number) => `$${value}`,
    }),
  };
});

vi.mock("@/services/api", () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    put: (...args: unknown[]) => put(...args),
    patch: (...args: unknown[]) => patch(...args),
    delete: (...args: unknown[]) => del(...args),
  },
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({ restaurantId: RESTAURANT_ID }),
}));

vi.mock("vue-toastification", () => ({
  useToast: () => ({ success: toastSuccess, error: toastError }),
}));

function group(overrides: Record<string, unknown> = {}) {
  return {
    id: "group-sweet",
    restaurantId: RESTAURANT_ID,
    publicId: "sweetness",
    kind: "choice",
    name: "甜度",
    type: "multiple",
    required: true,
    maxSelections: 2,
    sortOrder: 0,
    choices: [
      {
        id: "choice-half",
        groupId: "group-sweet",
        publicId: "half",
        name: "半糖",
        priceAdjustment: 0,
        isDefault: true,
        isAvailable: true,
        maxQuantity: null,
        sortOrder: 0,
      },
    ],
    ...overrides,
  };
}

function respondWith(groups: unknown[]) {
  get.mockResolvedValue({ data: { success: true, data: groups } });
}

async function mountView() {
  const wrapper = mount(OptionGroupsView);
  await flushPromises();
  return wrapper;
}

describe("OptionGroupsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    respondWith([]);
    post.mockResolvedValue({ data: { success: true } });
    put.mockResolvedValue({ data: { success: true } });
    patch.mockResolvedValue({ data: { success: true } });
    del.mockResolvedValue({ data: { success: true } });
  });

  it("loads the restaurant's groups on open", async () => {
    respondWith([group()]);
    const wrapper = await mountView();

    expect(get).toHaveBeenCalledWith(`/menu/${RESTAURANT_ID}/option-groups`);
    expect(
      wrapper.get('[data-testid="option-group-group-sweet"]').text(),
    ).toContain("甜度");
  });

  it("shows an empty state rather than a bare list", async () => {
    const wrapper = await mountView();

    expect(wrapper.find('[data-testid="option-groups-empty"]').exists()).toBe(
      true,
    );
  });

  // Blank has to travel as null. Omitting it leaves the stored cap untouched,
  // which is how "back to unlimited" silently fails.
  it("sends null to clear a cap", async () => {
    respondWith([group()]);
    const wrapper = await mountView();

    await wrapper
      .get('[data-testid="edit-group-group-sweet"]')
      .trigger("click");
    expect(wrapper.vm.groupForm.maxSelections).toBe(2);

    wrapper.vm.groupForm.maxSelections = "";
    await wrapper.get('[data-testid="group-modal"] form').trigger("submit");
    await flushPromises();

    expect(put).toHaveBeenCalledWith(
      "/menu/option-groups/group-sweet",
      expect.objectContaining({ maxSelections: null }),
    );
  });

  // publicId is the cart contract and kind decides the container: neither may
  // be edited, so the form must not even offer them.
  it("does not offer publicId or kind when editing", async () => {
    respondWith([group()]);
    const wrapper = await mountView();

    await wrapper
      .get('[data-testid="edit-group-group-sweet"]')
      .trigger("click");

    expect(wrapper.find('[data-testid="group-public-id-input"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-testid="group-kind-select"]').exists()).toBe(
      false,
    );

    await wrapper.get('[data-testid="group-modal"] form').trigger("submit");
    await flushPromises();

    const payload = put.mock.calls.at(-1)![1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("publicId");
    expect(payload).not.toHaveProperty("kind");
  });

  it("never sends a cap for a single-choice group", async () => {
    respondWith([group()]);
    const wrapper = await mountView();

    await wrapper
      .get('[data-testid="edit-group-group-sweet"]')
      .trigger("click");
    wrapper.vm.groupForm.type = "single";
    await wrapper.get('[data-testid="group-modal"] form').trigger("submit");
    await flushPromises();

    expect(put).toHaveBeenCalledWith(
      "/menu/option-groups/group-sweet",
      expect.objectContaining({ type: "single", maxSelections: null }),
    );
  });

  it("toggles a choice sold out and back", async () => {
    respondWith([group()]);
    const wrapper = await mountView();

    await wrapper
      .get('[data-testid="toggle-choice-choice-half"]')
      .trigger("click");
    await flushPromises();

    expect(patch).toHaveBeenCalledWith("/menu/option-choices/choice-half", {
      isAvailable: false,
    });

    respondWith([
      group({
        choices: [
          {
            id: "choice-half",
            groupId: "group-sweet",
            publicId: "half",
            name: "半糖",
            priceAdjustment: 0,
            isDefault: false,
            isAvailable: false,
            maxQuantity: null,
            sortOrder: 0,
          },
        ],
      }),
    ]);
    const soldOut = await mountView();

    expect(
      soldOut.find('[data-testid="choice-soldout-choice-half"]').exists(),
    ).toBe(true);
  });

  it("reports a public id collision in the owner's language", async () => {
    respondWith([group()]);
    const wrapper = await mountView();
    post.mockRejectedValueOnce({
      response: {
        data: { error: { code: "OPTION_GROUP_PUBLIC_ID_CONFLICT" } },
      },
    });

    await wrapper.get('[data-testid="add-group"]').trigger("click");
    wrapper.vm.groupForm.name = "甜度";
    wrapper.vm.groupForm.publicId = "sweetness";
    await wrapper.get('[data-testid="group-modal"] form').trigger("submit");
    await flushPromises();

    expect(toastError).toHaveBeenCalledWith(
      "optionGroups.errors.publicIdConflict",
    );
    // The modal stays open so the owner can correct the identifier.
    expect(wrapper.vm.showGroupModal).toBe(true);
  });

  it("only offers a quantity cap on add-on groups", async () => {
    respondWith([group({ kind: "addon", id: "group-addons" })]);
    const wrapper = await mountView();

    await wrapper
      .get('[data-testid="add-choice-group-addons"]')
      .trigger("click");

    expect(
      wrapper.find('[data-testid="choice-max-quantity-input"]').exists(),
    ).toBe(true);
  });

  it.each([
    ["TWD", "1"],
    ["MYR", "0.01"],
  ] as const)(
    "steps a choice's price adjustment by the %s unit",
    async (code, step) => {
      setRestaurantCurrency(code);
      respondWith([group({ kind: "addon", id: "group-addons" })]);
      const wrapper = await mountView();

      await wrapper
        .get('[data-testid="add-choice-group-addons"]')
        .trigger("click");

      expect(
        wrapper.get('[data-testid="choice-price-input"]').attributes("step"),
      ).toBe(step);
      clearRestaurantCurrency();
    },
  );
});
