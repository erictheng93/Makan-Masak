<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h4 class="text-[14px] font-bold text-ios-text">
        {{ t("menu.form.sharedOptionGroups") }}
      </h4>
      <div class="flex items-center gap-2">
        <select
          v-model="groupToAdd"
          data-testid="add-group-select"
          class="rounded-full bg-white px-3 py-1.5 text-[12px] text-ios-text outline-none focus:ring-2 focus:ring-ios-primary/30"
        >
          <option value="">{{ t("menu.form.pickOptionGroup") }}</option>
          <option
            v-for="group in availableGroups"
            :key="group.id"
            :value="group.id"
          >
            {{ group.name }}
          </option>
        </select>
        <button
          type="button"
          data-testid="attach-group"
          :disabled="groupToAdd === ''"
          class="rounded-full bg-ios-primary/10 px-3 py-1.5 text-[12px] font-semibold text-ios-primary disabled:opacity-40"
          @click="attachGroup"
        >
          {{ t("common.add") }}
        </button>
      </div>
    </div>

    <div
      v-if="links.length === 0"
      data-testid="no-groups-hint"
      class="rounded-xl bg-white p-4 text-[12px] text-ios-secondary"
    >
      {{ t("menu.form.noSharedGroupsHint") }}
      <RouterLink
        to="/dashboard/menu/option-groups"
        data-testid="create-option-group-link"
        class="ml-1 font-semibold text-ios-primary underline"
      >
        {{ t("menu.form.createSharedOptionGroup") }}
      </RouterLink>
    </div>

    <section
      v-for="(link, index) in links"
      :key="link.groupId"
      :data-testid="`linked-group-${link.groupId}`"
      class="rounded-xl bg-white p-3"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span class="text-[13px] font-semibold text-ios-text">{{
            groupById(link.groupId)?.name ?? link.groupId
          }}</span>
          <span class="ml-2 text-[11px] text-ios-secondary">{{
            t(`optionGroups.kind.${groupById(link.groupId)?.kind ?? "choice"}`)
          }}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <button
            type="button"
            :data-testid="`move-linked-up-${link.groupId}`"
            :aria-label="t('menu.form.moveUp')"
            :disabled="index === 0"
            class="rounded-full bg-ios-bg px-2.5 py-1.5 text-[12px] font-semibold text-ios-text disabled:opacity-30"
            @click="move(index, -1)"
          >
            ↑
          </button>
          <button
            type="button"
            :data-testid="`move-linked-down-${link.groupId}`"
            :aria-label="t('menu.form.moveDown')"
            :disabled="index === links.length - 1"
            class="rounded-full bg-ios-bg px-2.5 py-1.5 text-[12px] font-semibold text-ios-text disabled:opacity-30"
            @click="move(index, 1)"
          >
            ↓
          </button>
          <button
            type="button"
            :data-testid="`detach-group-${link.groupId}`"
            class="rounded-full bg-ios-red-soft px-3 py-1.5 text-[12px] font-semibold text-ios-error"
            @click="detach(index)"
          >
            {{ t("menu.form.detachGroup") }}
          </button>
        </div>
      </div>

      <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label class="text-[12px] text-ios-text">
          {{ t("menu.form.requiredOption") }}
          <select
            :value="requiredSelect(link)"
            :data-testid="`required-override-${link.groupId}`"
            class="mt-1 w-full rounded-xl bg-ios-bg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-ios-primary/30"
            @change="setRequired(index, $event)"
          >
            <option value="inherit">
              {{ inheritedRequiredLabel(link) }}
            </option>
            <option value="true">{{ t("common.yes") }}</option>
            <option value="false">{{ t("common.no") }}</option>
          </select>
        </label>

        <label
          v-if="groupById(link.groupId)?.type === 'multiple'"
          class="text-[12px] text-ios-text"
        >
          {{ t("menu.form.optionMaxSelections") }}
          <input
            :value="link.maxSelectionsOverride ?? ''"
            :data-testid="`max-selections-override-${link.groupId}`"
            :placeholder="inheritedCapPlaceholder(link)"
            type="number"
            min="1"
            step="1"
            class="mt-1 w-full rounded-xl bg-ios-bg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-ios-primary/30"
            @input="setMaxSelections(index, $event)"
          />
        </label>
      </div>

      <div class="mt-3 space-y-1.5">
        <div
          v-for="choice in groupById(link.groupId)?.choices ?? []"
          :key="choice.id"
          :data-testid="`linked-choice-${choice.id}`"
          class="grid grid-cols-1 gap-2 rounded-lg bg-ios-bg p-2 sm:grid-cols-[1fr_auto_120px] sm:items-center"
        >
          <span
            class="text-[13px]"
            :class="
              isHidden(link, choice.id) ? 'text-ios-tertiary' : 'text-ios-text'
            "
            >{{ choice.name }}</span
          >
          <label class="flex items-center gap-1.5 text-[12px] text-ios-text">
            <input
              :checked="isHidden(link, choice.id)"
              :data-testid="`hide-choice-${choice.id}`"
              type="checkbox"
              class="h-4 w-4 rounded border-ios-tertiary text-ios-primary"
              @change="setHidden(index, choice.id, $event)"
            />
            {{ t("menu.form.hideForThisItem") }}
          </label>
          <input
            :value="priceOverride(link, choice.id) ?? ''"
            :data-testid="`price-override-${choice.id}`"
            :placeholder="String(choice.priceAdjustment)"
            type="number"
            :step="inputStep"
            class="rounded-lg bg-white px-2 py-1.5 text-[13px] outline-none focus:ring-2 focus:ring-ios-primary/30"
            @input="setPrice(index, choice.id, $event)"
          />
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { useI18n } from "@/i18n";
import { useCurrency } from "@/composables/useCurrency";
import type {
  MenuItemOptionGroupLink,
  OptionGroupData,
} from "@/composables/useOptionGroups";

const props = defineProps<{
  modelValue: MenuItemOptionGroupLink[];
  library: OptionGroupData[];
}>();

const emit = defineEmits<{
  "update:modelValue": [MenuItemOptionGroupLink[]];
}>();

const { t } = useI18n();
const { inputStep } = useCurrency();
const groupToAdd = ref<string>("");

/**
 * A local copy, updated synchronously on every edit.
 *
 * Deriving each edit from `props.modelValue` looked equivalent, but props only
 * update after the parent re-renders: two edits in the same tick both read the
 * pre-edit value and the second overwrote the first. Ticking "hide" and then
 * typing a price silently kept only the price.
 */
const draft = ref<MenuItemOptionGroupLink[]>(props.modelValue);
watch(
  () => props.modelValue,
  (value) => {
    draft.value = value;
  },
);

const links = computed(() => draft.value);

const groupById = (groupId: string): OptionGroupData | undefined =>
  props.library.find((group) => group.id === groupId);

const availableGroups = computed(() =>
  props.library.filter(
    (group) => !draft.value.some((link) => link.groupId === group.id),
  ),
);

/**
 * Every edit replaces the whole array. The parent posts this straight to
 * PUT /items/:id/option-groups, which is itself a whole-set replace — keeping
 * the local shape identical to the wire shape means there is nothing to
 * translate, and nothing to get wrong in translating it.
 */
const commit = (next: MenuItemOptionGroupLink[]) => {
  const renumbered = next.map((link, index) => ({ ...link, sortOrder: index }));
  draft.value = renumbered;
  emit("update:modelValue", renumbered);
};

const attachGroup = () => {
  const group = groupById(groupToAdd.value);
  if (!group) return;
  commit([
    ...draft.value,
    {
      groupId: group.id,
      sortOrder: draft.value.length,
      requiredOverride: null,
      maxSelectionsOverride: null,
      choiceOverrides: [],
    },
  ]);
  groupToAdd.value = "";
};

const detach = (index: number) => {
  const next = [...draft.value];
  next.splice(index, 1);
  commit(next);
};

const move = (index: number, delta: number) => {
  const target = index + delta;
  if (target < 0 || target >= draft.value.length) return;
  const next = [...draft.value];
  const [row] = next.splice(index, 1);
  next.splice(target, 0, row);
  commit(next);
};

const patchLink = (
  index: number,
  patch: Partial<MenuItemOptionGroupLink>,
): void => {
  const next = [...draft.value];
  next[index] = { ...next[index], ...patch };
  commit(next);
};

const requiredSelect = (link: MenuItemOptionGroupLink) =>
  link.requiredOverride === null ? "inherit" : String(link.requiredOverride);

const inheritedRequiredLabel = (link: MenuItemOptionGroupLink) => {
  const group = groupById(link.groupId);
  return `${t("menu.form.inherit")}（${
    group?.required ? t("common.yes") : t("common.no")
  }）`;
};

const inheritedCapPlaceholder = (link: MenuItemOptionGroupLink) => {
  const cap = groupById(link.groupId)?.maxSelections;
  return cap == null ? t("menu.form.inheritNoCap") : String(cap);
};

const setRequired = (index: number, event: Event) => {
  const value = (event.target as HTMLSelectElement).value;
  patchLink(index, {
    requiredOverride: value === "inherit" ? null : value === "true",
  });
};

/** Blank is "inherit", not "no cap" — the group's own value still applies. */
const setMaxSelections = (index: number, event: Event) => {
  const raw = (event.target as HTMLInputElement).value;
  const parsed = Number(raw);
  patchLink(index, {
    maxSelectionsOverride:
      raw === "" || !Number.isInteger(parsed) || parsed < 1 ? null : parsed,
  });
};

const overrideFor = (link: MenuItemOptionGroupLink, choiceId: string) =>
  link.choiceOverrides.find((override) => override.choiceId === choiceId);

const isHidden = (link: MenuItemOptionGroupLink, choiceId: string) =>
  overrideFor(link, choiceId)?.isHidden ?? false;

const priceOverride = (link: MenuItemOptionGroupLink, choiceId: string) =>
  overrideFor(link, choiceId)?.priceAdjustment ?? null;

/**
 * An override row that neither hides nor reprices is the same as no row at
 * all, so it is dropped — otherwise clearing both fields would leave a row
 * behind that says "override to exactly the inherited value".
 */
const patchOverride = (
  index: number,
  choiceId: string,
  patch: { isHidden?: boolean; priceAdjustment?: number | null },
) => {
  const link = draft.value[index];
  const existing = overrideFor(link, choiceId) ?? {
    choiceId,
    isHidden: false,
    priceAdjustment: null,
  };
  const merged = { ...existing, ...patch };
  const rest = link.choiceOverrides.filter(
    (override) => override.choiceId !== choiceId,
  );
  const keep = merged.isHidden || merged.priceAdjustment !== null;
  patchLink(index, {
    choiceOverrides: keep ? [...rest, merged] : rest,
  });
};

const setHidden = (index: number, choiceId: string, event: Event) => {
  patchOverride(index, choiceId, {
    isHidden: (event.target as HTMLInputElement).checked,
  });
};

const setPrice = (index: number, choiceId: string, event: Event) => {
  const raw = (event.target as HTMLInputElement).value;
  const parsed = Number(raw);
  patchOverride(index, choiceId, {
    priceAdjustment: raw === "" || !Number.isFinite(parsed) ? null : parsed,
  });
};
</script>
