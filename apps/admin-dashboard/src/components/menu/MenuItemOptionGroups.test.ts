// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import MenuItemOptionGroups from "./MenuItemOptionGroups.vue";
import type {
  MenuItemOptionGroupLink,
  OptionGroupData,
} from "@/composables/useOptionGroups";
import {
  clearRestaurantCurrency,
  setRestaurantCurrency,
} from "@/composables/useCurrency";

vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: ref("zh-TW") }),
}));

function libraryGroup(
  overrides: Partial<OptionGroupData> = {},
): OptionGroupData {
  return {
    id: "group-sweet",
    restaurantId: "r1",
    publicId: "sweetness",
    kind: "choice",
    name: "甜度",
    type: "multiple",
    required: true,
    maxSelections: 3,
    sortOrder: 0,
    usageCount: 2,
    choices: [
      {
        id: "choice-half",
        groupId: "group-sweet",
        publicId: "half",
        name: "半糖",
        priceAdjustment: 5,
        isDefault: false,
        isAvailable: true,
        maxQuantity: null,
        sortOrder: 0,
      },
    ],
    ...overrides,
  };
}

function link(
  overrides: Partial<MenuItemOptionGroupLink> = {},
): MenuItemOptionGroupLink {
  return {
    groupId: "group-sweet",
    sortOrder: 0,
    requiredOverride: null,
    maxSelectionsOverride: null,
    choiceOverrides: [],
    ...overrides,
  };
}

function mountPicker(
  modelValue: MenuItemOptionGroupLink[],
  library: OptionGroupData[] = [libraryGroup()],
) {
  return mount(MenuItemOptionGroups, {
    props: { modelValue, library },
    global: { stubs: { RouterLink: true } },
  });
}

const lastEmit = (wrapper: ReturnType<typeof mountPicker>) =>
  (
    wrapper.emitted("update:modelValue")!.at(-1) as [MenuItemOptionGroupLink[]]
  )[0];

describe("MenuItemOptionGroups", () => {
  it("only offers groups the item does not already have", async () => {
    const wrapper = mountPicker(
      [link()],
      [
        libraryGroup(),
        libraryGroup({ id: "group-ice", name: "冰塊", publicId: "ice" }),
      ],
    );

    const options = wrapper
      .get('[data-testid="add-group-select"]')
      .findAll("option");
    // The placeholder plus the one group not yet attached.
    expect(options).toHaveLength(2);
    expect(options[1].text()).toBe("冰塊");
  });

  it("attaches a group with everything inherited", async () => {
    const wrapper = mountPicker([]);

    await wrapper
      .get('[data-testid="add-group-select"]')
      .setValue("group-sweet");
    await wrapper.get('[data-testid="attach-group"]').trigger("click");

    expect(lastEmit(wrapper)).toEqual([
      {
        groupId: "group-sweet",
        sortOrder: 0,
        requiredOverride: null,
        maxSelectionsOverride: null,
        choiceOverrides: [],
      },
    ]);
  });

  it("shows the inherited value rather than leaving the owner guessing", () => {
    const wrapper = mountPicker([link()]);

    // Required is a tri-state; the inherit option spells out what it inherits.
    expect(
      wrapper.get('[data-testid="required-override-group-sweet"]').text(),
    ).toContain("menu.form.inherit");
    // The cap field is blank but placeholds the group's own cap.
    expect(
      wrapper
        .get('[data-testid="max-selections-override-group-sweet"]')
        .attributes("placeholder"),
    ).toBe("3");
    // Same for the choice price.
    expect(
      wrapper
        .get('[data-testid="price-override-choice-half"]')
        .attributes("placeholder"),
    ).toBe("5");
  });

  it("sends null when an override is cleared back to inherit", async () => {
    const wrapper = mountPicker([
      link({ requiredOverride: true, maxSelectionsOverride: 2 }),
    ]);

    await wrapper
      .get('[data-testid="required-override-group-sweet"]')
      .setValue("inherit");
    expect(lastEmit(wrapper)[0].requiredOverride).toBeNull();

    await wrapper
      .get('[data-testid="max-selections-override-group-sweet"]')
      .setValue("");
    expect(lastEmit(wrapper)[0].maxSelectionsOverride).toBeNull();
  });

  it("keeps a false required override distinct from inheriting", async () => {
    const wrapper = mountPicker([link()]);

    await wrapper
      .get('[data-testid="required-override-group-sweet"]')
      .setValue("false");

    // The group is required; this item says otherwise, which is not the same
    // as having no opinion.
    expect(lastEmit(wrapper)[0].requiredOverride).toBe(false);
  });

  it("drops an override row once it no longer says anything", async () => {
    const wrapper = mountPicker([link()]);

    await wrapper.get('[data-testid="hide-choice-choice-half"]').setValue(true);
    expect(lastEmit(wrapper)[0].choiceOverrides).toEqual([
      { choiceId: "choice-half", isHidden: true, priceAdjustment: null },
    ]);

    const hidden = mountPicker([
      link({
        choiceOverrides: [
          { choiceId: "choice-half", isHidden: true, priceAdjustment: null },
        ],
      }),
    ]);
    await hidden.get('[data-testid="hide-choice-choice-half"]').setValue(false);

    // Neither hidden nor repriced is the same as no override at all.
    expect(lastEmit(hidden)[0].choiceOverrides).toEqual([]);
  });

  it("carries a price override through", async () => {
    const wrapper = mountPicker([link()]);

    await wrapper
      .get('[data-testid="price-override-choice-half"]')
      .setValue("7.5");

    expect(lastEmit(wrapper)[0].choiceOverrides).toEqual([
      { choiceId: "choice-half", isHidden: false, priceAdjustment: 7.5 },
    ]);
  });

  it("steps a price override by the shop currency's unit", async () => {
    clearRestaurantCurrency();
    const twd = mountPicker([link()]);
    expect(
      twd.get('[data-testid="price-override-choice-half"]').attributes("step"),
    ).toBe("1");
    twd.unmount();

    setRestaurantCurrency("MYR");
    const myr = mountPicker([link()]);
    expect(
      myr.get('[data-testid="price-override-choice-half"]').attributes("step"),
    ).toBe("0.01");
    myr.unmount();
    clearRestaurantCurrency();
  });

  it("renumbers sortOrder when groups are reordered", async () => {
    const wrapper = mountPicker(
      [link(), link({ groupId: "group-ice", sortOrder: 1 })],
      [
        libraryGroup(),
        libraryGroup({ id: "group-ice", name: "冰塊", publicId: "ice" }),
      ],
    );

    await wrapper
      .get('[data-testid="move-linked-down-group-sweet"]')
      .trigger("click");

    expect(
      lastEmit(wrapper).map((row) => [row.groupId, row.sortOrder]),
    ).toEqual([
      ["group-ice", 0],
      ["group-sweet", 1],
    ]);
  });

  it("detaches a group", async () => {
    const wrapper = mountPicker([link()]);

    await wrapper
      .get('[data-testid="detach-group-group-sweet"]')
      .trigger("click");

    expect(lastEmit(wrapper)).toEqual([]);
  });

  // Real clicking found this and the per-edit unit tests did not: props only
  // update after the parent re-renders, so two edits in the same tick both read
  // the pre-edit value and the second overwrote the first.
  it("keeps every edit when several land before a re-render", async () => {
    const wrapper = mountPicker([link()]);

    const required = wrapper.get<HTMLSelectElement>(
      '[data-testid="required-override-group-sweet"]',
    );
    const hide = wrapper.get<HTMLInputElement>(
      '[data-testid="hide-choice-choice-half"]',
    );
    const price = wrapper.get<HTMLInputElement>(
      '[data-testid="price-override-choice-half"]',
    );

    required.element.value = "false";
    required.trigger("change");
    hide.element.checked = true;
    hide.trigger("change");
    price.element.value = "9";
    price.trigger("input");
    await wrapper.vm.$nextTick();

    const state = lastEmit(wrapper)[0];
    expect(state.requiredOverride).toBe(false);
    expect(state.choiceOverrides).toEqual([
      { choiceId: "choice-half", isHidden: true, priceAdjustment: 9 },
    ]);
  });

  it("hides the cap field for a single-choice group", () => {
    const wrapper = mountPicker([link()], [libraryGroup({ type: "single" })]);

    expect(
      wrapper
        .find('[data-testid="max-selections-override-group-sweet"]')
        .exists(),
    ).toBe(false);
  });
});
