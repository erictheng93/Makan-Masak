<template>
  <div
    class="ui-panel bg-white rounded-2xl shadow-[0_1px_8px_rgba(0,0,0,0.06)]"
    data-testid="shop-management-panel"
  >
    <div class="px-6 py-4">
      <h2 class="text-lg font-semibold text-ios-text">
        {{ t("shopManagement.title") }}
      </h2>
      <p class="text-sm text-ios-secondary">
        {{ t("shopManagement.description") }}
      </p>
    </div>
    <div class="ui-table-scroll overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-ios-bg">
          <tr>
            <th
              class="px-6 py-3 text-left text-xs font-medium text-ios-secondary"
            >
              {{ t("shopManagement.name") }}
            </th>
            <th
              class="px-6 py-3 text-left text-xs font-medium text-ios-secondary"
            >
              {{ t("shopManagement.slug") }}
            </th>
            <th
              class="px-6 py-3 text-left text-xs font-medium text-ios-secondary"
            >
              {{ t("shopManagement.status") }}
            </th>
            <th
              v-if="canManage"
              class="px-6 py-3 text-right text-xs font-medium text-ios-secondary"
            >
              {{ t("accountManagement.actionsCol") }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="shop in shops"
            :key="shop.id"
            :data-testid="`shop-row-${shop.id}`"
            :data-status="shop.isActive === false ? 'inactive' : 'active'"
          >
            <td class="px-6 py-3 text-ios-text">
              {{ shop.name }}
              <span
                v-if="shop.isDemo"
                class="ml-2 px-2 py-0.5 rounded-full text-xs bg-ios-orange-soft text-ios-orange-deep"
              >
                {{ t("shopManagement.demo") }}
              </span>
            </td>
            <td class="px-6 py-3 text-ios-secondary font-mono">
              {{ shop.loginSlug || "-" }}
            </td>
            <td class="px-6 py-3">
              <span
                class="px-2.5 py-0.5 rounded-full text-xs"
                :class="
                  shop.isActive === false
                    ? 'bg-ios-bg text-ios-secondary'
                    : 'bg-ios-green-soft text-ios-green-deep'
                "
              >
                {{
                  shop.isActive === false
                    ? t("shopManagement.deactivated")
                    : t("shopManagement.active")
                }}
              </span>
            </td>
            <td v-if="canManage" class="px-6 py-3 text-right">
              <template v-if="!shop.isDemo">
                <button
                  v-if="shop.isActive !== false"
                  type="button"
                  :data-testid="`shop-deactivate-${shop.id}`"
                  class="px-4 py-1.5 rounded-full text-[13px] font-semibold text-ios-orange-deep bg-ios-orange-soft hover:opacity-80 transition-opacity"
                  @click="deactivate(shop)"
                >
                  {{ t("shopManagement.deactivate") }}
                </button>
                <button
                  v-else
                  type="button"
                  :data-testid="`shop-delete-${shop.id}`"
                  class="px-4 py-1.5 rounded-full text-[13px] font-semibold text-ios-red-deep bg-ios-red-soft hover:opacity-80 transition-opacity"
                  @click="deleteTarget = shop"
                >
                  {{ t("shopManagement.deletePermanently") }}
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <PermanentDeleteShopModal
      v-if="canManage"
      :shop="deleteTarget"
      @close="deleteTarget = null"
      @deleted="onDeleted"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "@/i18n";
import { useToast } from "vue-toastification";
import { api, unwrapApiList } from "@/services/api";
import { useConfirmModal } from "@/composables/useConfirmModal";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";
import PermanentDeleteShopModal from "./PermanentDeleteShopModal.vue";

interface Shop {
  id: string;
  name: string;
  loginSlug?: string | null;
  isActive?: boolean;
  isDemo?: boolean;
}

// canManage mirrors the API's administrator-tier check; the API still enforces it.
defineProps<{ canManage: boolean }>();

const { t } = useI18n();
const toast = useToast();
const { confirm } = useConfirmModal();

const shops = ref<Shop[]>([]);
const deleteTarget = ref<Shop | null>(null);

onMounted(async () => {
  try {
    const res = await api.get<Shop[]>("/restaurants", {
      params: { includeInactive: true, limit: 100 },
    });
    shops.value = unwrapApiList<Shop>(res.data?.data);
  } catch (e) {
    toast.error(
      resolveUserFacingError(e, t, { fallbackKey: "shopManagement.loadFailed" })
        .message,
    );
  }
});

async function deactivate(shop: Shop) {
  const ok = await confirm({
    type: "danger",
    title: t("shopManagement.deactivateConfirmTitle", { name: shop.name }),
    message: t("shopManagement.deactivateConfirmMessage"),
    confirmLabel: t("shopManagement.deactivate"),
  });
  if (!ok) return;
  try {
    await api.delete(`/restaurants/${shop.id}`);
    shop.isActive = false;
    toast.success(t("shopManagement.deactivated"));
  } catch (e) {
    toast.error(
      resolveUserFacingError(e, t, {
        fallbackKey: "shopManagement.deactivateFailed",
      }).message,
    );
  }
}

function onDeleted(id: string) {
  shops.value = shops.value.filter((s) => s.id !== id);
  deleteTarget.value = null;
}
</script>
