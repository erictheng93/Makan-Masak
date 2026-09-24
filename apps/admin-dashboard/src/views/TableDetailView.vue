<template>
  <div class="table-detail-view">
    <!-- 返回按鈕 -->
    <div class="mb-6">
      <button
        class="flex items-center text-gray-600 hover:text-gray-900"
        @click="goBack"
      >
        <ArrowLeftIcon class="h-5 w-5 mr-2" />
        {{ t("tableDetail.backToList") }}
      </button>
    </div>

    <!-- 桌台資訊卡片 -->
    <div class="bg-white rounded-lg shadow p-6 mb-6">
      <div class="flex justify-between items-start">
        <div>
          <h1 class="text-2xl font-bold text-gray-900 mb-2">
            {{ t("tableDetail.tableNumber", { number: table.tableNumber }) }}
          </h1>
          <div class="flex items-center space-x-4">
            <span
              :class="getStatusBadgeClass(table.status)"
              class="px-3 py-1 text-sm font-medium rounded-full"
            >
              {{ getStatusText(table.status) }}
            </span>
            <span
              class="px-3 py-1 bg-blue-100 text-blue-700 text-sm font-medium rounded-full"
            >
              {{
                table.qrMode === "table"
                  ? t("tableDetail.tableMode")
                  : t("tableDetail.seatMode")
              }}
            </span>
          </div>
        </div>

        <div class="flex space-x-2">
          <button
            class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            @click="editTable"
          >
            {{ t("tableDetail.editTable") }}
          </button>
          <button
            class="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors"
            data-testid="table-detail-switch-mode"
            @click="showModeSwitchModal = true"
          >
            {{ t("tableDetail.switchMode") }}
          </button>
        </div>
      </div>

      <!-- 桌台詳細資訊 -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
        <div>
          <div class="text-sm text-gray-600">
            {{ t("tableDetail.capacity") }}
          </div>
          <div class="text-lg font-semibold">
            {{ t("tableDetail.capacityValue", { count: table.capacity }) }}
          </div>
        </div>
        <div>
          <div class="text-sm text-gray-600">
            {{ t("tableDetail.location") }}
          </div>
          <div class="text-lg font-semibold">
            {{ table.location || t("tableDetail.locationNotSet") }}
          </div>
        </div>
        <div v-if="table.qrMode === 'seat'">
          <div class="text-sm text-gray-600">
            {{ t("tableDetail.seatCount") }}
          </div>
          <div class="text-lg font-semibold">
            {{ t("tableDetail.seatCountValue", { count: seats.length }) }}
          </div>
        </div>
        <div>
          <div class="text-sm text-gray-600">
            {{ t("tableDetail.usageCount") }}
          </div>
          <div class="text-lg font-semibold">
            {{
              t("tableDetail.usageCountValue", { count: table.totalUsage || 0 })
            }}
          </div>
        </div>
      </div>
    </div>

    <!-- 座位管理（座位模式） -->
    <div v-if="table.qrMode === 'seat'">
      <SeatManagement
        :table-id="table.id"
        :table-number="table.tableNumber"
        :table-capacity="table.capacity"
        :seats="seats"
        :grid-columns="4"
        @update="loadSeats"
      />
    </div>

    <!-- 桌子 QR 碼（桌子模式） -->
    <div v-else class="bg-white rounded-lg shadow p-6">
      <h2 class="text-xl font-bold text-gray-900 mb-4">
        {{ t("tableDetail.qrCode.title") }}
      </h2>

      <div class="flex flex-col items-center">
        <div class="p-6 bg-gray-50 rounded-lg">
          <div
            class="w-64 h-64 bg-white rounded-lg flex items-center justify-center"
          >
            <div v-if="isTableQrReady" class="text-center">
              <QRCodeRenderer
                :content="printableTableQrCode"
                :size="240"
                :padding="8"
              />
              <p class="text-sm text-gray-500">
                {{ t("tableDetail.qrCode.preview") }}
              </p>
              <p class="text-xs text-gray-400 mt-2 break-all px-4">
                {{ printableTableQrCode }}
              </p>
              <p
                v-if="table.pendingQrCode"
                class="text-xs font-medium text-orange-600 mt-2"
              >
                {{ t("qrRotation.pending") }}
              </p>
            </div>
            <div v-else class="text-center text-red-600">
              {{ t("qrReadiness.notReadyDescription") }}
            </div>
          </div>
        </div>

        <div class="mt-6 flex space-x-3">
          <button
            class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="!isTableQrReady"
            @click="downloadQRCode"
          >
            {{ t("tableDetail.qrCode.download") }}
          </button>
          <button
            class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="!isTableQrReady"
            @click="printQRCode"
          >
            {{ t("tableDetail.qrCode.print") }}
          </button>
          <button
            class="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors"
            @click="regenerateQRCode"
          >
            {{ t("tableDetail.qrCode.regenerate") }}
          </button>
        </div>
      </div>
    </div>

    <!-- 模式切換 Modal -->
    <div v-if="showModeSwitchModal" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div
          class="fixed inset-0 bg-black opacity-30"
          @click="showModeSwitchModal = false"
        />
        <div
          class="relative bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
        >
          <div class="p-6">
            <div class="flex justify-between items-center mb-4">
              <h3 class="text-lg font-semibold">
                {{ t("tableDetail.modeSwitch.title") }}
              </h3>
              <button
                class="text-gray-400 hover:text-gray-600"
                @click="showModeSwitchModal = false"
              >
                <XMarkIcon class="h-6 w-6" />
              </button>
            </div>

            <div class="mb-6">
              <p class="text-sm text-gray-600">
                {{ t("tableDetail.modeSwitch.currentMode") }}
                <span class="font-semibold">{{
                  table.qrMode === "table"
                    ? t("tableDetail.tableMode")
                    : t("tableDetail.seatMode")
                }}</span>
              </p>
            </div>

            <QRModeSelector
              v-model="newQRMode"
              v-model:seat-config="newSeatConfig"
              :max-seat-count="table.capacity"
            />

            <div class="flex justify-end space-x-3 mt-6">
              <button
                type="button"
                class="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                @click="showModeSwitchModal = false"
              >
                {{ t("tableDetail.modeSwitch.cancel") }}
              </button>
              <button
                type="button"
                class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                @click="switchQRMode"
              >
                {{ t("tableDetail.modeSwitch.confirm") }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onBeforeUnmount, onMounted } from "vue";
import { useI18n } from "@/i18n";
import { useToast } from "vue-toastification";
import { useConfirmModal } from "@/composables/useConfirmModal";
import { useRouter, useRoute } from "vue-router";
import { api, unwrapApiList, unwrapApiPayload } from "@/services/api";
import { createVisibilityAwarePoller } from "@/services/visibilityAwarePoller";
import type { Seat } from "@makanmasak/shared-types";
import { ArrowLeftIcon, XMarkIcon } from "@heroicons/vue/24/outline";
import SeatManagement from "../components/tables/SeatManagement.vue";
import QRModeSelector from "../components/tables/QRModeSelector.vue";
import QRCodeRenderer from "../components/tables/QRCodeRenderer.vue";
import { getPrintableQrCode, isQrReady } from "@/utils/qrReadiness";
import {
  printQRCodeSheetInWindow,
  toPrintableDataUrl,
} from "@/utils/qrPrintSheet";

const { t } = useI18n();
const toast = useToast();
const { confirm: confirmModal } = useConfirmModal();
const router = useRouter();
const route = useRoute();

// 響應式數據
const isLoading = ref(false);

const table = ref({
  id: 0,
  tableNumber: "",
  tableName: "",
  capacity: 0,
  location: "",
  status: "available",
  qrMode: "table" as "table" | "seat",
  qrCode: "",
  pendingQrCode: "",
  pendingQrCodeVersion: null as number | null,
  pendingQrPreparedAt: null as string | null,
  totalUsage: 0,
});

const seats = ref<Seat[]>([]);
const showModeSwitchModal = ref(false);

const newQRMode = ref<"table" | "seat">("table");
const newSeatConfig = ref({
  count: 10,
  numberingStyle: "numeric" as "numeric" | "alphabetic",
});

// 方法
const goBack = () => {
  router.push({ name: "SeatingTableSetup" });
};

const editTable = () => {
  router.push({
    name: "SeatingTableSetup",
    query: { editTable: String(table.value.id) },
  });
};

const getStatusBadgeClass = (status: string) => {
  const classes: Record<string, string> = {
    available: "bg-green-100 text-green-800",
    occupied: "bg-red-100 text-red-800",
    reserved: "bg-yellow-100 text-yellow-800",
    maintenance: "bg-gray-100 text-gray-800",
  };
  return classes[status] || "bg-gray-100 text-gray-800";
};

const getStatusText = (status: string) => {
  const keys: Record<string, string> = {
    available: "tableDetail.status.available",
    occupied: "tableDetail.status.occupied",
    reserved: "tableDetail.status.reserved",
    maintenance: "tableDetail.status.maintenance",
  };
  return keys[status] ? t(keys[status]) : status;
};

const printableTableQrCode = computed(() =>
  getPrintableQrCode(table.value.pendingQrCode, table.value.qrCode),
);
const isTableQrReady = computed(() => isQrReady(printableTableQrCode.value));

const loadSeats = async () => {
  if (table.value.qrMode !== "seat" || !table.value.id) return;

  try {
    const response = await api.get("/seats", {
      tableId: table.value.id,
    });
    if (response.data.success && response.data.data) {
      seats.value = unwrapApiList<Seat>(response.data.data);
    }
  } catch (error) {
    console.error("Failed to load seats:", error);
  }
};

const switchQRMode = async () => {
  if (table.value.status === "occupied") {
    toast.error(t("tableDetail.confirm.occupiedError"));
    return;
  }

  const modeName =
    newQRMode.value === "table"
      ? t("tableDetail.tableMode")
      : t("tableDetail.seatMode");
  const confirmed = await confirmModal({
    type: "warning",
    title: t("tableDetail.confirm.switchModeTitle"),
    message: t("tableDetail.confirm.switchMode", { mode: modeName }),
    confirmLabel: t("tableDetail.confirm.switchModeAction"),
  });
  if (!confirmed) return;

  try {
    await api.put(`/tables/${table.value.id}`, {
      qrMode: newQRMode.value,
      seatCount: newQRMode.value === "seat" ? newSeatConfig.value.count : 0,
      seatNumberingStyle: newSeatConfig.value.numberingStyle,
    });
    showModeSwitchModal.value = false;
    await loadTableData();
  } catch (error) {
    console.error("Failed to switch QR mode:", error);
    toast.error(t("tableDetail.confirm.switchFailed"));
  }
};

const downloadQRCode = async () => {
  if (!isTableQrReady.value) {
    toast.warning(t("qrReadiness.notReadyDescription"));
    return;
  }
  const link = document.createElement("a");
  link.download = `QR-${table.value.tableNumber || "table"}.png`;
  link.href = await toPrintableDataUrl(printableTableQrCode.value);
  link.click();
};

const printQRCode = async () => {
  if (!isTableQrReady.value) {
    toast.warning(t("qrReadiness.notReadyDescription"));
    return;
  }

  const printWindow = window.open("", "_blank");
  if (!printWindow) return;
  const label = `${t("tableDetail.qrCode.title")} - ${table.value.tableNumber}`;
  const dataUrl = await toPrintableDataUrl(printableTableQrCode.value);
  if (!printQRCodeSheetInWindow(printWindow, label, [{ label, dataUrl }])) {
    toast.error(t("tables.alert.printFailed"));
  }
};

const regenerateQRCode = async () => {
  const confirmed = await confirmModal({
    type: "warning",
    title: t("tableDetail.confirm.regenerateTitle"),
    message: t("tableDetail.confirm.regenerateConfirm"),
    confirmLabel: t("tableDetail.confirm.regenerateAction"),
  });
  if (!confirmed) return;

  try {
    const response = await api.post(
      `/tables/${table.value.id}/regenerate-qr`,
      {},
    );
    if (response.data.success && response.data.data) {
      const result = response.data.data as { qrCode: string };
      table.value.qrCode = result.qrCode;
      table.value.pendingQrCode = "";
      table.value.pendingQrCodeVersion = null;
      table.value.pendingQrPreparedAt = null;
    }
  } catch (error) {
    console.error("Failed to regenerate QR code:", error);
    toast.error(t("tableDetail.confirm.regenerateFailed"));
  }
};

const loadTableData = async () => {
  const tableId = route.params.id;
  if (!tableId) return;

  isLoading.value = true;
  try {
    const response = await api.get(`/tables/${tableId}`);
    if (response.data.success && response.data.data) {
      const data = unwrapApiPayload<{
        id: number | string;
        number?: string;
        tableNumber?: string;
        name?: string;
        tableName?: string;
        capacity?: number;
        location?: string;
        isActive?: boolean;
        isOccupied?: boolean;
        qrMode?: "table" | "seat";
        seatCount?: number;
        seatNumberingStyle?: "numeric" | "alphabetic";
        qrCode?: string;
        pendingQrCode?: string | null;
        pendingQrCodeVersion?: number | null;
        pendingQrPreparedAt?: string | null;
        status?: string;
        totalUsage?: number;
        createdAt?: string;
        updatedAt?: string;
      }>(response.data.data);
      table.value = {
        id:
          typeof data.id === "number"
            ? data.id
            : Number.parseInt(String(data.id), 10) || 0,
        tableNumber: data.number || data.tableNumber || "",
        tableName: data.name || data.tableName || "",
        capacity: data.capacity ?? 0,
        location: data.location || "",
        status: !data.isActive
          ? "maintenance"
          : data.isOccupied
            ? "occupied"
            : "available",
        qrMode: data.qrMode || "table",
        qrCode: data.qrCode || "",
        pendingQrCode: data.pendingQrCode || "",
        pendingQrCodeVersion: data.pendingQrCodeVersion ?? null,
        pendingQrPreparedAt: data.pendingQrPreparedAt ?? null,
        totalUsage: data.totalUsage || 0,
      };

      // 初始化新模式為當前模式
      newQRMode.value = table.value.qrMode;
      newSeatConfig.value = {
        count: data.seatCount || data.capacity || 1,
        numberingStyle: data.seatNumberingStyle || "numeric",
      };

      // 如果是座位模式，載入座位數據
      if (table.value.qrMode === "seat") {
        await loadSeats();
      }
    }
  } catch (error) {
    console.error("Failed to load table:", error);
  } finally {
    isLoading.value = false;
  }
};

// Occupancy changes with orders. Hold the poll while the mode-switch modal is
// open: a reload resets the QR mode and seat config being edited there.
const tablePoller = createVisibilityAwarePoller({
  intervalMs: 30_000,
  onTick: () => {
    if (isLoading.value || showModeSwitchModal.value) return;
    return loadTableData();
  },
});

onMounted(() => {
  loadTableData();
  tablePoller.start();
});
onBeforeUnmount(() => tablePoller.stop());
</script>

<style scoped>
.table-detail-view {
  padding: 1.5rem;
  max-width: 1400px;
  margin: 0 auto;
}

@media (max-width: 640px) {
  .table-detail-view {
    padding: 1rem;
  }
}
</style>
