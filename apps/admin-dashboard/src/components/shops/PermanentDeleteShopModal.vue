<template>
  <Teleport to="body">
    <div
      v-if="shop"
      v-dialog-focus
      data-testid="permanent-delete-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="permanent-delete-title"
      aria-describedby="permanent-delete-warning"
      tabindex="-1"
      class="fixed inset-0 z-50 overflow-y-auto"
      @keydown.esc.stop.prevent="close"
    >
      <div class="flex items-center justify-center min-h-screen px-4">
        <div
          class="fixed inset-0 bg-black/30 backdrop-blur-sm"
          @click="close"
        />
        <form
          class="relative bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6"
          @submit.prevent="submit"
        >
          <h3
            id="permanent-delete-title"
            class="text-[17px] font-bold text-ios-text mb-2"
          >
            {{ t("shopManagement.delete.title", { name: shop.name }) }}
          </h3>
          <p
            id="permanent-delete-warning"
            role="alert"
            class="text-[14px] text-ios-red-deep bg-ios-red-soft rounded-xl px-3.5 py-2.5 mb-4"
          >
            {{ t("shopManagement.delete.warning") }}
          </p>

          <p
            v-if="loading"
            data-testid="permanent-delete-loading"
            class="text-sm text-ios-secondary"
          >
            {{ t("shopManagement.delete.loading") }}
          </p>

          <template v-else-if="preview">
            <p
              v-if="blockerMessage"
              data-testid="permanent-delete-blocker"
              class="text-sm text-ios-red-deep mb-3"
            >
              {{ blockerMessage }}
            </p>

            <p
              class="text-sm font-semibold text-ios-text mb-1"
              data-testid="permanent-delete-total"
            >
              {{
                t("shopManagement.delete.totalRows", {
                  count: preview.totalRows,
                })
              }}
            </p>
            <ul
              tabindex="0"
              :aria-label="t('shopManagement.delete.tableList')"
              class="max-h-40 overflow-y-auto rounded-xl bg-ios-bg px-3.5 py-2 mb-4 text-xs text-ios-text"
            >
              <li
                v-for="entry in preview.tables"
                :key="entry.table"
                class="flex justify-between gap-3 py-0.5"
              >
                <span class="font-mono">{{ entry.table }}</span>
                <span>{{ entry.rows }}</span>
              </li>
            </ul>

            <label
              v-if="preview.hasFinancialRecords"
              class="flex items-start gap-2 mb-4 text-sm text-ios-text"
            >
              <input
                v-model="acknowledged"
                data-testid="permanent-delete-ack"
                type="checkbox"
                class="mt-0.5"
              />
              <span>{{ t("shopManagement.delete.acknowledge") }}</span>
            </label>

            <label
              for="permanent-delete-name"
              class="block text-sm font-medium text-ios-text mb-1"
            >
              {{ t("shopManagement.delete.typeName", { name: shop.name }) }}
            </label>
            <input
              id="permanent-delete-name"
              v-model="typedName"
              data-testid="permanent-delete-name"
              type="text"
              autocomplete="off"
              class="w-full px-3.5 py-2.5 bg-ios-bg border-none rounded-xl text-ios-text focus:shadow-[0_0_0_2px_rgba(0,122,255,0.25)] focus:bg-white transition-all"
            />
          </template>

          <p
            v-if="error"
            role="alert"
            data-testid="permanent-delete-error"
            class="mt-3 text-sm text-ios-red-deep"
          >
            {{ error }}
          </p>

          <div class="flex justify-end gap-2.5 mt-6">
            <button
              type="button"
              data-testid="permanent-delete-cancel"
              class="px-5 py-2.5 text-[14px] font-semibold text-ios-text bg-ios-bg rounded-full hover:bg-ios-separator transition-colors"
              @click="close"
            >
              {{ t("common.cancel") }}
            </button>
            <button
              type="submit"
              data-testid="permanent-delete-confirm"
              :disabled="!canConfirm"
              class="px-5 py-2.5 text-[14px] font-semibold text-white bg-ios-red rounded-full hover:bg-ios-red/90 transition-colors disabled:opacity-40"
            >
              {{
                deleting
                  ? t("shopManagement.delete.deleting")
                  : t("shopManagement.delete.confirm")
              }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "@/i18n";
import { useToast } from "vue-toastification";
import { api } from "@/services/api";
import { vDialogFocus } from "@/utils/dialog-focus";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";

interface DeletionPreview {
  restaurant: { id: string; name: string };
  tables: Array<{ table: string; rows: number }>;
  totalRows: number;
  hasFinancialRecords: boolean;
  blockers: string[];
}

const props = defineProps<{ shop: { id: string; name: string } | null }>();
const emit = defineEmits<{ close: []; deleted: [id: string] }>();

const { t } = useI18n();
const toast = useToast();

const preview = ref<DeletionPreview | null>(null);
const loading = ref(false);
const deleting = ref(false);
const typedName = ref("");
const acknowledged = ref(false);
const error = ref("");

const ERROR_KEYS: Record<string, string> = {
  RESTAURANT_STILL_ACTIVE: "shopManagement.delete.errors.stillActive",
  DEMO_RESTAURANT: "shopManagement.delete.errors.demo",
  CONFIRMATION_MISMATCH: "shopManagement.delete.errors.mismatch",
  FINANCIAL_RECORDS_NOT_ACKNOWLEDGED:
    "shopManagement.delete.errors.financialNotAcknowledged",
  ADMINISTRATOR_REQUIRED: "shopManagement.delete.errors.administratorRequired",
};

const blockerMessage = computed(() => {
  const code = preview.value?.blockers[0];
  return code && ERROR_KEYS[code] ? t(ERROR_KEYS[code]) : "";
});

// Exact match on purpose: the API compares the same string.
const canConfirm = computed(
  () =>
    !!props.shop &&
    !!preview.value &&
    !loading.value &&
    !deleting.value &&
    preview.value.blockers.length === 0 &&
    typedName.value === props.shop.name &&
    (!preview.value.hasFinancialRecords || acknowledged.value),
);

function fail(e: unknown, fallbackKey: string) {
  return resolveUserFacingError(e, t, { codeKeys: ERROR_KEYS, fallbackKey })
    .message;
}

watch(
  () => props.shop,
  async (shop) => {
    preview.value = null;
    typedName.value = "";
    acknowledged.value = false;
    error.value = "";
    if (!shop) return;
    loading.value = true;
    try {
      const res = await api.get(`/restaurants/${shop.id}/deletion-preview`);
      if (props.shop?.id !== shop.id) return;
      preview.value = res.data.data as DeletionPreview;
    } catch (e) {
      error.value = fail(e, "shopManagement.delete.errors.previewFailed");
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);

function close() {
  if (!deleting.value) emit("close");
}

async function submit() {
  if (!props.shop || !preview.value || !canConfirm.value) return;
  const shop = props.shop;
  deleting.value = true;
  error.value = "";
  try {
    const res = await api.delete<{ totalRows: number }>(
      `/restaurants/${shop.id}/permanent`,
      {
        confirmName: typedName.value,
        acknowledgeFinancialRecords: acknowledged.value,
      },
    );
    toast.success(
      t("shopManagement.delete.success", {
        count: res.data.data?.totalRows ?? 0,
      }),
    );
    emit("deleted", shop.id);
  } catch (e) {
    error.value = fail(e, "shopManagement.delete.errors.failed");
  } finally {
    deleting.value = false;
  }
}
</script>
