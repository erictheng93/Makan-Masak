<template>
  <div class="min-h-screen bg-ios-bg p-4 md:p-6">
    <div class="mx-auto max-w-4xl">
      <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-[22px] font-bold text-ios-text">
            {{ t("optionGroups.title") }}
          </h1>
          <p class="mt-1 text-[13px] text-ios-secondary">
            {{ t("optionGroups.description") }}
          </p>
        </div>
        <button
          type="button"
          data-testid="add-group"
          class="rounded-full bg-ios-primary px-4 py-2 text-[14px] font-semibold text-white active:scale-95 transition-transform duration-150"
          @click="openCreateGroup"
        >
          {{ t("optionGroups.addGroup") }}
        </button>
      </div>

      <div
        v-if="isLoading"
        class="rounded-2xl bg-white p-8 text-center text-[14px] text-ios-secondary shadow-sm"
      >
        {{ t("common.loading") }}
      </div>

      <div
        v-else-if="groups.length === 0"
        data-testid="option-groups-empty"
        class="rounded-3xl bg-white p-10 text-center shadow-sm"
      >
        <p class="text-[15px] font-semibold text-ios-text">
          {{ t("optionGroups.emptyTitle") }}
        </p>
        <p class="mt-2 text-[13px] text-ios-secondary">
          {{ t("optionGroups.emptyHint") }}
        </p>
      </div>

      <div v-else class="space-y-4">
        <section
          v-for="group in groups"
          :key="group.id"
          :data-testid="`option-group-${group.id}`"
          class="rounded-3xl bg-white p-5 shadow-sm"
        >
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div class="flex items-center gap-2">
                <h2 class="text-[16px] font-bold text-ios-text">
                  {{ group.name }}
                </h2>
                <span
                  class="rounded-full bg-ios-bg px-2.5 py-1 text-[11px] font-semibold text-ios-text"
                >
                  {{ t(`optionGroups.kind.${group.kind}`) }}
                </span>
              </div>
              <p class="mt-1 text-[12px] text-ios-secondary">
                {{ t(`menu.form.${group.type}Choice`) }}
                <span v-if="group.required">
                  · {{ t("menu.form.requiredOption") }}</span
                >
                <span v-if="group.maxSelections != null">
                  · {{ t("menu.form.optionMaxSelections") }}
                  {{ group.maxSelections }}</span
                >
                · <code class="text-[11px]">{{ group.publicId }}</code>
                ·
                <span :data-testid="`usage-${group.id}`">{{
                  t("optionGroups.usedByItems", {
                    count: group.usageCount,
                  })
                }}</span>
              </p>
            </div>
            <div class="flex items-center gap-2">
              <button
                type="button"
                :data-testid="`edit-group-${group.id}`"
                class="rounded-full bg-ios-bg px-3 py-1.5 text-[12px] font-semibold text-ios-text"
                @click="openEditGroup(group)"
              >
                {{ t("common.edit") }}
              </button>
              <button
                type="button"
                :data-testid="`delete-group-${group.id}`"
                :title="
                  t('optionGroups.deleteAffects', {
                    count: group.usageCount,
                  })
                "
                class="rounded-full bg-ios-red-soft px-3 py-1.5 text-[12px] font-semibold text-ios-error"
                @click="confirmDeleteGroup(group)"
              >
                {{ t("common.delete") }}
              </button>
            </div>
          </div>

          <div class="mt-4 space-y-2">
            <div
              v-for="choice in group.choices"
              :key="choice.id"
              :data-testid="`choice-${choice.id}`"
              class="grid grid-cols-1 gap-2 rounded-2xl bg-ios-bg p-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center"
            >
              <div>
                <span
                  class="text-[14px] font-medium"
                  :class="
                    choice.isAvailable ? 'text-ios-text' : 'text-ios-secondary'
                  "
                  >{{ choice.name }}</span
                >
                <span
                  v-if="choice.isDefault"
                  class="ml-2 text-[11px] text-ios-secondary"
                  >{{ t("menu.form.defaultOption") }}</span
                >
                <span
                  v-if="!choice.isAvailable"
                  :data-testid="`choice-soldout-${choice.id}`"
                  class="ml-2 rounded-full bg-ios-red-soft px-2 py-0.5 text-[11px] font-semibold text-ios-error"
                  >{{ t("optionGroups.soldOut") }}</span
                >
              </div>
              <span class="text-[13px] text-ios-text">{{
                formatPrice(choice.priceAdjustment)
              }}</span>
              <button
                type="button"
                :data-testid="`toggle-choice-${choice.id}`"
                class="rounded-full px-3 py-1.5 text-[12px] font-semibold"
                :class="
                  choice.isAvailable
                    ? 'bg-ios-orange-soft text-ios-warning'
                    : 'bg-ios-green-soft text-ios-success'
                "
                @click="setChoiceAvailability(choice.id, !choice.isAvailable)"
              >
                {{
                  choice.isAvailable
                    ? t("optionGroups.markSoldOut")
                    : t("optionGroups.markInStock")
                }}
              </button>
              <button
                type="button"
                :data-testid="`edit-choice-${choice.id}`"
                class="rounded-full bg-ios-bg px-3 py-1.5 text-[12px] font-semibold text-ios-text"
                @click="openEditChoice(group, choice)"
              >
                {{ t("common.edit") }}
              </button>
              <button
                type="button"
                :data-testid="`delete-choice-${choice.id}`"
                class="rounded-full bg-ios-red-soft px-3 py-1.5 text-[12px] font-semibold text-ios-error"
                @click="confirmDeleteChoice(choice.id)"
              >
                {{ t("common.delete") }}
              </button>
            </div>

            <button
              type="button"
              :data-testid="`add-choice-${group.id}`"
              class="rounded-full bg-ios-bg px-3 py-1.5 text-[12px] font-semibold text-ios-text"
              @click="openCreateChoice(group)"
            >
              {{ t("menu.form.addChoice") }}
            </button>
          </div>
        </section>
      </div>
    </div>

    <!-- Group create / edit -->
    <div
      v-if="showGroupModal"
      data-testid="group-modal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
    >
      <form
        class="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl"
        @submit.prevent="saveGroup"
      >
        <h3 class="mb-4 text-[17px] font-bold text-ios-text">
          {{
            editingGroup
              ? t("optionGroups.editGroup")
              : t("optionGroups.addGroup")
          }}
        </h3>
        <div class="space-y-3">
          <label class="block text-[13px] font-semibold text-ios-text">
            {{ t("menu.form.optionGroupName") }}
            <input
              v-model="groupForm.name"
              data-testid="group-name-input"
              type="text"
              required
              class="mt-1.5 w-full rounded-xl bg-ios-bg px-4 py-2.5 text-[14px] font-normal outline-none focus:ring-2 focus:ring-ios-primary/30"
            />
          </label>

          <!-- publicId and kind are fixed once the group exists: the cart
               refers to publicId, and kind decides the container. -->
          <label
            v-if="!editingGroup"
            class="block text-[13px] font-semibold text-ios-text"
          >
            {{ t("optionGroups.publicId") }}
            <input
              v-model="groupForm.publicId"
              data-testid="group-public-id-input"
              type="text"
              required
              pattern="[A-Za-z0-9_\-]{1,50}"
              class="mt-1.5 w-full rounded-xl bg-ios-bg px-4 py-2.5 font-mono text-[13px] font-normal outline-none focus:ring-2 focus:ring-ios-primary/30"
            />
            <span
              class="mt-1 block text-[11px] font-normal text-ios-secondary"
              >{{ t("optionGroups.publicIdHint") }}</span
            >
          </label>

          <label
            v-if="!editingGroup"
            class="block text-[13px] font-semibold text-ios-text"
          >
            {{ t("optionGroups.kindLabel") }}
            <select
              v-model="groupForm.kind"
              data-testid="group-kind-select"
              class="mt-1.5 w-full rounded-xl bg-ios-bg px-4 py-2.5 text-[14px] font-normal outline-none focus:ring-2 focus:ring-ios-primary/30"
            >
              <option value="choice">
                {{ t("optionGroups.kind.choice") }}
              </option>
              <option value="size">{{ t("optionGroups.kind.size") }}</option>
              <option value="addon">{{ t("optionGroups.kind.addon") }}</option>
            </select>
          </label>

          <label class="block text-[13px] font-semibold text-ios-text">
            {{ t("optionGroups.typeLabel") }}
            <select
              v-model="groupForm.type"
              data-testid="group-type-select"
              class="mt-1.5 w-full rounded-xl bg-ios-bg px-4 py-2.5 text-[14px] font-normal outline-none focus:ring-2 focus:ring-ios-primary/30"
            >
              <option value="single">{{ t("menu.form.singleChoice") }}</option>
              <option value="multiple">
                {{ t("menu.form.multipleChoice") }}
              </option>
            </select>
          </label>

          <label class="flex items-center gap-2 text-[13px] text-ios-text">
            <input
              v-model="groupForm.required"
              data-testid="group-required-input"
              type="checkbox"
              class="h-4 w-4 rounded border-ios-tertiary text-ios-primary"
            />
            {{ t("menu.form.requiredOption") }}
          </label>

          <label
            v-if="groupForm.type === 'multiple'"
            class="block text-[13px] font-semibold text-ios-text"
          >
            {{ t("menu.form.optionMaxSelections") }}
            <input
              v-model="groupForm.maxSelections"
              data-testid="group-max-selections-input"
              type="number"
              min="1"
              step="1"
              class="mt-1.5 w-full rounded-xl bg-ios-bg px-4 py-2.5 text-[14px] font-normal outline-none focus:ring-2 focus:ring-ios-primary/30"
            />
            <span
              class="mt-1 block text-[11px] font-normal text-ios-secondary"
              >{{ t("optionGroups.blankMeansNoCap") }}</span
            >
          </label>
        </div>

        <div class="mt-6 flex justify-end gap-2">
          <button
            type="button"
            class="rounded-full bg-ios-bg px-4 py-2 text-[14px] font-semibold text-ios-text"
            @click="showGroupModal = false"
          >
            {{ t("common.cancel") }}
          </button>
          <button
            type="submit"
            data-testid="save-group"
            class="rounded-full bg-ios-primary px-4 py-2 text-[14px] font-semibold text-white"
          >
            {{ t("common.save") }}
          </button>
        </div>
      </form>
    </div>

    <!-- Choice create / edit -->
    <div
      v-if="showChoiceModal"
      data-testid="choice-modal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
    >
      <form
        class="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl"
        @submit.prevent="saveChoice"
      >
        <h3 class="mb-4 text-[17px] font-bold text-ios-text">
          {{ editingChoice ? t("common.edit") : t("menu.form.addChoice") }}
        </h3>
        <div class="space-y-3">
          <label class="block text-[13px] font-semibold text-ios-text">
            {{ t("menu.form.optionChoiceName") }}
            <input
              v-model="choiceForm.name"
              data-testid="choice-name-input"
              type="text"
              required
              class="mt-1.5 w-full rounded-xl bg-ios-bg px-4 py-2.5 text-[14px] font-normal outline-none focus:ring-2 focus:ring-ios-primary/30"
            />
          </label>
          <label
            v-if="!editingChoice"
            class="block text-[13px] font-semibold text-ios-text"
          >
            {{ t("optionGroups.publicId") }}
            <input
              v-model="choiceForm.publicId"
              data-testid="choice-public-id-input"
              type="text"
              required
              pattern="[A-Za-z0-9_\-]{1,50}"
              class="mt-1.5 w-full rounded-xl bg-ios-bg px-4 py-2.5 font-mono text-[13px] font-normal outline-none focus:ring-2 focus:ring-ios-primary/30"
            />
          </label>
          <label class="block text-[13px] font-semibold text-ios-text">
            {{ t("optionGroups.priceAdjustment") }}
            <input
              v-model="choiceForm.priceAdjustment"
              data-testid="choice-price-input"
              type="number"
              :step="inputStep"
              class="mt-1.5 w-full rounded-xl bg-ios-bg px-4 py-2.5 text-[14px] font-normal outline-none focus:ring-2 focus:ring-ios-primary/30"
            />
          </label>
          <label
            v-if="choiceGroupKind === 'addon'"
            class="block text-[13px] font-semibold text-ios-text"
          >
            {{ t("menu.form.optionMaxQuantity") }}
            <input
              v-model="choiceForm.maxQuantity"
              data-testid="choice-max-quantity-input"
              type="number"
              min="1"
              step="1"
              class="mt-1.5 w-full rounded-xl bg-ios-bg px-4 py-2.5 text-[14px] font-normal outline-none focus:ring-2 focus:ring-ios-primary/30"
            />
          </label>
          <label class="flex items-center gap-2 text-[13px] text-ios-text">
            <input
              v-model="choiceForm.isDefault"
              data-testid="choice-default-input"
              type="checkbox"
              class="h-4 w-4 rounded border-ios-tertiary text-ios-primary"
            />
            {{ t("menu.form.defaultOption") }}
          </label>
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <button
            type="button"
            class="rounded-full bg-ios-bg px-4 py-2 text-[14px] font-semibold text-ios-text"
            @click="showChoiceModal = false"
          >
            {{ t("common.cancel") }}
          </button>
          <button
            type="submit"
            data-testid="save-choice"
            class="rounded-full bg-ios-primary px-4 py-2 text-[14px] font-semibold text-white"
          >
            {{ t("common.save") }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "@/i18n";
import { useCurrency } from "@/composables/useCurrency";
import { useConfirmModal } from "@/composables/useConfirmModal";
import {
  useOptionGroups,
  type OptionGroupData,
} from "@/composables/useOptionGroups";

const { t } = useI18n();
const { formatPrice, inputStep } = useCurrency();
const {
  groups,
  isLoading,
  fetchGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  createChoice,
  updateChoice,
  deleteChoice,
  setChoiceAvailability,
} = useOptionGroups();
const { confirm: confirmModal } = useConfirmModal();

type NumericFormValue = number | "" | null;

const showGroupModal = ref(false);
const editingGroup = ref<OptionGroupData | null>(null);
const groupForm = ref({
  name: "",
  publicId: "",
  kind: "choice" as OptionGroupData["kind"],
  type: "single" as OptionGroupData["type"],
  required: false,
  maxSelections: "" as NumericFormValue,
});

const showChoiceModal = ref(false);
const choiceGroupId = ref<string>("");
const choiceGroupKind = ref<OptionGroupData["kind"]>("choice");
const editingChoice = ref<string | null>(null);
const choiceForm = ref({
  name: "",
  publicId: "",
  priceAdjustment: 0 as NumericFormValue,
  maxQuantity: "" as NumericFormValue,
  isDefault: false,
});

/** Blank is "no cap" and must reach the API as null, not as 0 or omitted. */
const nullableCount = (value: NumericFormValue): number | null => {
  if (value === "" || value === null) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const numberOrZero = (value: NumericFormValue): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const openCreateGroup = () => {
  editingGroup.value = null;
  groupForm.value = {
    name: "",
    publicId: "",
    kind: "choice",
    type: "single",
    required: false,
    maxSelections: "",
  };
  showGroupModal.value = true;
};

const openEditGroup = (group: OptionGroupData) => {
  editingGroup.value = group;
  groupForm.value = {
    name: group.name,
    publicId: group.publicId,
    kind: group.kind,
    type: group.type,
    required: group.required,
    maxSelections: group.maxSelections ?? "",
  };
  showGroupModal.value = true;
};

const saveGroup = async () => {
  const form = groupForm.value;
  // A single-choice group cannot hold a cap; sending a leftover value would
  // put a self-contradicting field into the menu.
  const maxSelections =
    form.type === "multiple" ? nullableCount(form.maxSelections) : null;

  const ok = editingGroup.value
    ? await updateGroup(editingGroup.value.id, {
        name: form.name,
        type: form.type,
        required: form.required,
        maxSelections,
      })
    : await createGroup({
        publicId: form.publicId,
        kind: form.kind,
        name: form.name,
        type: form.type,
        required: form.required,
        maxSelections,
      });

  if (ok) showGroupModal.value = false;
};

const confirmDeleteGroup = async (group: OptionGroupData) => {
  if (
    await confirmModal({
      type: "danger",
      title: t("common.delete"),
      message: t("optionGroups.deleteAffects", { count: group.usageCount }),
      confirmLabel: t("common.delete"),
    })
  ) {
    await deleteGroup(group.id);
  }
};

const openCreateChoice = (group: OptionGroupData) => {
  editingChoice.value = null;
  choiceGroupId.value = group.id;
  choiceGroupKind.value = group.kind;
  choiceForm.value = {
    name: "",
    publicId: "",
    priceAdjustment: 0,
    maxQuantity: "",
    isDefault: false,
  };
  showChoiceModal.value = true;
};

const openEditChoice = (
  group: OptionGroupData,
  choice: OptionGroupData["choices"][number],
) => {
  editingChoice.value = choice.id;
  choiceGroupId.value = group.id;
  choiceGroupKind.value = group.kind;
  choiceForm.value = {
    name: choice.name,
    publicId: choice.publicId,
    priceAdjustment: choice.priceAdjustment,
    maxQuantity: choice.maxQuantity,
    isDefault: choice.isDefault,
  };
  showChoiceModal.value = true;
};

const saveChoice = async () => {
  const form = choiceForm.value;
  const input = {
    name: form.name,
    priceAdjustment: numberOrZero(form.priceAdjustment),
    isDefault: form.isDefault,
    maxQuantity:
      choiceGroupKind.value === "addon"
        ? nullableCount(form.maxQuantity)
        : null,
  };
  // Availability belongs to the 標記售完 toggle on the row, not to this form.
  // Sending `isAvailable: true` on the update path silently put a sold-out
  // choice back on sale whenever the owner edited its name or price.
  const ok = editingChoice.value
    ? await updateChoice(editingChoice.value, input)
    : await createChoice(choiceGroupId.value, {
        publicId: form.publicId,
        isAvailable: true,
        ...input,
      });
  if (ok) showChoiceModal.value = false;
};

const confirmDeleteChoice = async (choiceId: string) => {
  if (
    await confirmModal({
      type: "danger",
      title: t("common.delete"),
      message: t("optionGroups.deleteChoiceConfirm"),
      confirmLabel: t("common.delete"),
    })
  ) {
    await deleteChoice(choiceId);
  }
};

onMounted(fetchGroups);

defineExpose({ groupForm, choiceForm, showGroupModal, showChoiceModal });
</script>
