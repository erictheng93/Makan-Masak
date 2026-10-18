<template>
  <div class="seat-management">
    <!-- 座位管理標題 -->
    <div
      class="flex flex-col gap-4 mb-6 sm:flex-row sm:items-center sm:justify-between"
    >
      <div>
        <h2 class="text-xl font-bold text-gray-900">
          {{ t("seatManagement.title") }}
        </h2>
        <p class="text-sm text-gray-600">
          {{ t("seatManagement.tableInfo", { tableNumber }) }}
        </p>
      </div>
      <div class="flex flex-wrap gap-3">
        <button
          class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center"
          @click="showBatchCreateModal = true"
        >
          <PlusIcon class="h-4 w-4 mr-2" />
          {{ t("seatManagement.batchCreate") }}
        </button>
        <button
          class="px-4 py-2 bg-sky-600 text-white rounded-lg hover:bg-sky-700 transition-colors flex items-center"
          @click="prepareAllSeatQR"
        >
          <QRCodeIcon class="h-4 w-4 mr-2" />
          {{ t("qrRotation.prepareAll") }}
        </button>
        <button
          v-if="pendingSeatCount > 0"
          class="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors flex items-center"
          @click="discardAllSeatQR"
        >
          <XMarkIcon class="h-4 w-4 mr-2" />
          {{ t("qrRotation.discardAll") }}
        </button>
        <button
          class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center"
          @click="regenerateAllQR"
        >
          <QRCodeIcon class="h-4 w-4 mr-2" />
          {{ t("seatManagement.regenerateQR") }}
        </button>
        <button
          class="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition-colors flex items-center disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="printableSeats.length === 0"
          @click="printAllSeatQRCodes"
        >
          <PrinterIcon class="h-4 w-4 mr-2" />
          {{ t("seatManagement.printAllQR") }}
        </button>
      </div>
    </div>

    <!-- 座位網格 -->
    <SeatGrid
      :seats="seats"
      :columns="gridColumns"
      :show-details="true"
      @seat-click="handleSeatClick"
    />

    <!-- 座位詳情 Modal -->
    <div v-if="showSeatModal" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div
          class="fixed inset-0 bg-black opacity-30"
          @click="closeSeatModal"
        />
        <div class="relative bg-white rounded-lg shadow-xl max-w-2xl w-full">
          <div class="p-6">
            <div class="flex justify-between items-center mb-4">
              <h3 class="text-lg font-semibold">
                {{ t("seatManagement.seatDetail") }}:
                {{ selectedSeat?.seatNumber }}
              </h3>
              <button
                class="text-gray-400 hover:text-gray-600"
                @click="closeSeatModal"
              >
                <XMarkIcon class="h-6 w-6" />
              </button>
            </div>

            <!-- 座位資訊 -->
            <div class="space-y-4 mb-6">
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">
                    {{ t("seatManagement.seatNumber") }}
                  </label>
                  <input
                    v-model="seatForm.seatNumber"
                    type="text"
                    class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">
                    {{ t("seatManagement.seatName") }}
                  </label>
                  <input
                    v-model="seatForm.seatName"
                    type="text"
                    class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">
                  {{ t("seatManagement.positionDesc") }}
                </label>
                <input
                  v-model="seatForm.position"
                  type="text"
                  :placeholder="t('seatManagement.positionPlaceholder')"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div class="flex items-center">
                <input
                  id="isActive"
                  v-model="seatForm.isActive"
                  type="checkbox"
                  class="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label for="isActive" class="ml-2 text-sm text-gray-700">
                  {{ t("seatManagement.enableSeat") }}
                </label>
              </div>

              <!-- 座位狀態資訊 -->
              <div class="bg-gray-50 rounded-lg p-4">
                <h4 class="text-sm font-medium text-gray-900 mb-2">
                  {{ t("seatManagement.seatStatus") }}
                </h4>
                <div class="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span class="text-gray-600"
                      >{{ t("seatManagement.statusLabel") }}:</span
                    >
                    <span
                      :class="
                        selectedSeat?.isOccupied
                          ? 'text-red-600'
                          : 'text-green-600'
                      "
                      class="ml-2 font-medium"
                    >
                      {{
                        selectedSeat?.isOccupied
                          ? t("seatManagement.occupied")
                          : t("seatManagement.available")
                      }}
                    </span>
                  </div>
                  <div>
                    <span class="text-gray-600"
                      >{{ t("seatManagement.usageCount") }}:</span
                    >
                    <span class="ml-2 font-medium">{{
                      selectedSeat?.totalUsage
                    }}</span>
                  </div>
                  <div v-if="selectedSeat?.currentOrderId" class="col-span-2">
                    <span class="text-gray-600"
                      >{{ t("seatManagement.currentOrder") }}:</span
                    >
                    <span class="ml-2 font-medium"
                      >#{{ selectedSeat.currentOrderId }}</span
                    >
                  </div>
                  <div v-if="selectedSeat?.occupiedBy" class="col-span-2">
                    <span class="text-gray-600"
                      >{{ t("seatManagement.occupiedBy") }}:</span
                    >
                    <span class="ml-2 font-medium">{{
                      selectedSeat.occupiedBy
                    }}</span>
                  </div>
                </div>
              </div>

              <!-- QR Code -->
              <div class="text-center bg-gray-50 rounded-lg p-4">
                <h4 class="text-sm font-medium text-gray-900 mb-2">QR Code</h4>
                <div class="inline-block p-3 bg-white rounded-lg border">
                  <QRCodeRenderer
                    v-if="selectedSeat && seatQrIsReady(selectedSeat)"
                    ref="seatQrRef"
                    :content="
                      selectedSeat ? printableSeatQrCode(selectedSeat) : ''
                    "
                    :label="selectedSeat?.seatNumber"
                    :size="160"
                    :padding="8"
                  />
                  <div
                    v-else
                    class="w-40 h-40 flex flex-col items-center justify-center gap-2 text-gray-400"
                  >
                    <QRCodeIcon class="h-16 w-16" />
                    <span class="text-sm font-medium text-red-600">
                      {{ t("qrReadiness.notReady") }}
                    </span>
                  </div>
                </div>
                <div
                  v-if="selectedSeat && seatHasPendingQr(selectedSeat)"
                  class="mt-2 text-xs font-medium text-orange-600"
                >
                  {{ t("qrRotation.pending") }}
                </div>
                <div
                  v-if="selectedSeat && seatQrIsReady(selectedSeat)"
                  class="mt-2 text-xs text-gray-500 break-all"
                >
                  {{ selectedSeat ? printableSeatQrCode(selectedSeat) : "" }}
                </div>
                <div v-else class="mt-2 text-xs text-red-600">
                  {{ t("qrReadiness.notReadyDescription") }}
                </div>
                <div class="flex justify-center gap-2 mt-3">
                  <button
                    class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="!selectedSeat || !seatQrIsReady(selectedSeat)"
                    @click="downloadSeatQRCode"
                  >
                    {{ t("tables.qrModal.download") }}
                  </button>
                  <button
                    class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="!selectedSeat || !seatQrIsReady(selectedSeat)"
                    @click="printSeatQRCode"
                  >
                    {{ t("tables.qrModal.print") }}
                  </button>
                </div>
              </div>
            </div>

            <!-- 操作按鈕 -->
            <div class="flex justify-between">
              <div class="space-x-2">
                <button
                  v-if="selectedSeat?.isOccupied"
                  class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                  @click="releaseSeat"
                >
                  {{ t("seatManagement.releaseSeat") }}
                </button>
                <button
                  class="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors"
                  @click="regenerateSeatQR"
                >
                  {{ t("seatManagement.regenerateQR") }}
                </button>
                <button
                  v-if="selectedSeat && !seatHasPendingQr(selectedSeat)"
                  class="px-4 py-2 bg-sky-600 text-white rounded-lg hover:bg-sky-700 transition-colors"
                  @click="prepareSeatQR"
                >
                  {{ t("qrRotation.prepare") }}
                </button>
                <button
                  v-if="selectedSeat && seatHasPendingQr(selectedSeat)"
                  class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                  @click="activateSeatQR"
                >
                  {{ t("qrRotation.activate") }}
                </button>
                <button
                  v-if="selectedSeat && seatHasPendingQr(selectedSeat)"
                  class="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
                  @click="discardSeatQR"
                >
                  {{ t("qrRotation.discard") }}
                </button>
              </div>
              <div class="space-x-2">
                <button
                  class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                  @click="deleteSeat"
                >
                  {{ t("seatManagement.deleteSeat") }}
                </button>
                <button
                  class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  @click="updateSeat"
                >
                  {{ t("seatManagement.updateSeat") }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 批量創建座位 Modal -->
    <div v-if="showBatchCreateModal" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div
          class="fixed inset-0 bg-black opacity-30"
          @click="showBatchCreateModal = false"
        />
        <div class="relative bg-white rounded-lg shadow-xl max-w-md w-full">
          <div class="p-6">
            <h3 class="text-lg font-semibold mb-4">
              {{ t("seatManagement.batchCreate") }}
            </h3>

            <form @submit.prevent="batchCreateSeats">
              <div class="space-y-4">
                <p
                  v-if="atSeatCapacity"
                  class="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2"
                >
                  {{
                    t("seatManagement.atCapacity", {
                      capacity: tableCapacityLimit,
                    })
                  }}
                </p>

                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">
                    {{ t("seatManagement.seatCount") }}
                    <span class="text-red-500">*</span>
                  </label>
                  <input
                    v-model.number="batchForm.count"
                    type="number"
                    min="1"
                    :max="batchSeatLimit"
                    :disabled="atSeatCapacity"
                    required
                    class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
                  />
                </div>

                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">
                    {{ t("seatManagement.numberingStyle") }}
                    <span class="text-red-500">*</span>
                  </label>
                  <select
                    v-model="batchForm.numberingStyle"
                    class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="numeric">
                      {{ t("seatManagement.numeric") }}
                    </option>
                    <option value="alphabetic">
                      {{ t("seatManagement.alphabetic") }}
                    </option>
                  </select>
                </div>

                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">
                    {{ t("seatManagement.prefix") }}
                  </label>
                  <input
                    v-model="batchForm.prefix"
                    type="text"
                    :placeholder="t('seatManagement.prefixPlaceholder')"
                    maxlength="10"
                    class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                  <p class="text-xs text-gray-500 mt-1">
                    {{ t("seatManagement.preview") }}: {{ batchForm.prefix }}01,
                    {{ batchForm.prefix }}02...
                  </p>
                </div>
              </div>

              <div class="flex justify-end space-x-3 mt-6">
                <button
                  type="button"
                  class="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                  @click="showBatchCreateModal = false"
                >
                  {{ t("common.cancel") }}
                </button>
                <button
                  type="submit"
                  :disabled="atSeatCapacity"
                  class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  {{ t("seatManagement.create") }}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "@/i18n";
import { useToast } from "vue-toastification";
import { useConfirmModal } from "@/composables/useConfirmModal";
import { api } from "@/services/api";
import type { Table } from "@/types";
import { PlusIcon, PrinterIcon, XMarkIcon } from "@heroicons/vue/24/outline";

const { t } = useI18n();
const toast = useToast();
const { confirm: confirmModal } = useConfirmModal();
import QRCodeIcon from "@heroicons/vue/24/outline/QrCodeIcon";
import {
  printQRCodeSheet,
  printQRCodeSheetInWindow,
  toPrintableDataUrl,
} from "@/utils/qrPrintSheet";
import { getPrintableQrCode, isQrReady } from "@/utils/qrReadiness";
import QRCodeRenderer from "./QRCodeRenderer.vue";
import SeatGrid from "./SeatGrid.vue";

interface Seat {
  id: number;
  tableId: number;
  seatNumber: string;
  seatName?: string;
  position?: string;
  qrCode: string;
  pendingQrCode?: string | null;
  pendingQrCodeVersion?: number | null;
  pendingQrPreparedAt?: string | Date | null;
  isOccupied: boolean;
  isActive: boolean;
  currentOrderId?: number;
  occupiedBy?: string;
  totalUsage: number;
}

interface Props {
  tableId: number;
  tableNumber: string;
  tableCapacity?: number;
  seats: Seat[];
  gridColumns?: number;
}

interface Emits {
  (e: "update"): void;
  (e: "seatUpdated", seat: Seat): void;
  (e: "seatDeleted", seatId: number): void;
  (e: "seatsCreated", seats: Seat[]): void;
}

const props = withDefaults(defineProps<Props>(), {
  gridColumns: 4,
});

const emit = defineEmits<Emits>();

// 響應式數據
const showSeatModal = ref(false);
const showBatchCreateModal = ref(false);
const selectedSeat = ref<Seat | null>(null);
const seatQrRef = ref<InstanceType<typeof QRCodeRenderer> | null>(null);
const printableSeatQrCode = (seat: Seat) =>
  getPrintableQrCode(seat.pendingQrCode, seat.qrCode);
const seatQrIsReady = (seat: Seat) => isQrReady(printableSeatQrCode(seat));
const seatHasPendingQr = (seat: Seat) => Boolean(seat.pendingQrCode);
const printableSeats = computed(() =>
  props.seats.filter((seat) => seat.isActive && seatQrIsReady(seat)),
);
const pendingSeatCount = computed(
  () => props.seats.filter(seatHasPendingQr).length,
);

const seatForm = ref({
  seatNumber: "",
  seatName: "",
  position: "",
  isActive: true,
});

const batchForm = ref({
  count: 10,
  numberingStyle: "numeric" as "numeric" | "alphabetic",
  prefix: "",
});
const resolvedTableCapacity = ref<number | undefined>(props.tableCapacity);

const activeSeatCount = computed(
  () => props.seats.filter((seat) => seat.isActive).length,
);
const tableCapacityLimit = computed(() =>
  Math.max(resolvedTableCapacity.value ?? 100, 1),
);
const remainingSeatCapacity = computed(() =>
  Math.max(tableCapacityLimit.value - activeSeatCount.value, 0),
);
// A full table has room for nothing, and the input has to say so. Clamping the
// ceiling up to 1 made the field offer a seat the server then refused with a
// 400, and typing anything above it tripped silent HTML5 validation -- the
// submit handler never ran and the dialog just sat there.
const atSeatCapacity = computed(() => remainingSeatCapacity.value === 0);
const batchSeatLimit = computed(() => remainingSeatCapacity.value);
const batchSeatDefault = computed(() =>
  Math.min(remainingSeatCapacity.value, tableCapacityLimit.value),
);

watch(
  () => props.tableCapacity,
  (capacity) => {
    resolvedTableCapacity.value = capacity;
  },
);

const loadTableCapacity = async () => {
  if (props.tableCapacity !== undefined) return;

  try {
    const response = await api.get<Table>(`/tables/${props.tableId}`);
    const capacity = response.data?.data?.capacity;
    if (typeof capacity === "number") {
      resolvedTableCapacity.value = capacity;
    }
  } catch (error) {
    console.error("Failed to load table capacity:", error);
  }
};

watch(showBatchCreateModal, async (isOpen) => {
  if (isOpen) {
    await loadTableCapacity();
    batchForm.value.count = batchSeatDefault.value;
  }
});

const extractApiErrorMessage = (error: unknown): string | undefined => {
  if (typeof error === "object" && error !== null) {
    const candidate = error as {
      message?: unknown;
      response?: { data?: { error?: unknown; message?: unknown } };
    };
    const apiError = candidate.response?.data?.error;

    if (typeof apiError === "string" && apiError.trim()) {
      return apiError;
    }
    if (
      typeof apiError === "object" &&
      apiError !== null &&
      "message" in apiError &&
      typeof (apiError as { message?: unknown }).message === "string"
    ) {
      return (apiError as { message: string }).message;
    }
    if (typeof candidate.response?.data?.message === "string") {
      return candidate.response.data.message;
    }
    if (typeof candidate.message === "string") {
      return candidate.message;
    }
  }

  return undefined;
};

// 處理座位點擊
const handleSeatClick = (seat: Seat) => {
  selectedSeat.value = seat;
  seatForm.value = {
    seatNumber: seat.seatNumber,
    seatName: seat.seatName || "",
    position: seat.position || "",
    isActive: seat.isActive,
  };
  showSeatModal.value = true;
};

// 關閉座位詳情 Modal
const closeSeatModal = () => {
  showSeatModal.value = false;
  selectedSeat.value = null;
  seatForm.value = {
    seatNumber: "",
    seatName: "",
    position: "",
    isActive: true,
  };
};

// 更新座位
const updateSeat = async () => {
  if (!selectedSeat.value) return;

  // The seat number is the seat's identity in its QR; the server reissues the
  // code on a renumber, so the printed one stops working.
  if (seatForm.value.seatNumber !== selectedSeat.value.seatNumber) {
    const confirmed = await confirmModal({
      type: "warning",
      title: t("seatManagement.seatDetail"),
      message: t("seatManagement.alerts.renumberConfirm", {
        seat: seatForm.value.seatNumber,
      }),
      confirmLabel: t("common.save"),
    });
    if (!confirmed) return;
  }

  try {
    const response = await api.put(`/seats/${selectedSeat.value.id}`, {
      seatNumber: seatForm.value.seatNumber,
      seatName: seatForm.value.seatName || undefined,
      position: seatForm.value.position || undefined,
      isActive: seatForm.value.isActive,
    });

    emit("seatUpdated", {
      ...selectedSeat.value,
      ...(response.data?.data || seatForm.value),
    });

    closeSeatModal();
    emit("update");
  } catch (error) {
    console.error("Failed to update seat:", error);
    toast.error(t("seatManagement.alerts.updateFailed"));
  }
};

// 刪除座位
const deleteSeat = async () => {
  if (!selectedSeat.value) return;

  if (selectedSeat.value.isOccupied) {
    toast.warning(t("seatManagement.alerts.cannotDeleteOccupied"));
    return;
  }

  const confirmed = await confirmModal({
    type: "danger",
    title: t("seatManagement.deleteSeat"),
    message: t("seatManagement.alerts.deleteConfirm", {
      seat: selectedSeat.value.seatNumber,
    }),
    confirmLabel: t("common.delete"),
  });
  if (!confirmed) return;

  try {
    await api.delete(`/seats/${selectedSeat.value.id}`);

    emit("seatDeleted", selectedSeat.value.id);
    closeSeatModal();
    emit("update");
  } catch (error) {
    console.error("Failed to delete seat:", error);
    toast.error(t("seatManagement.alerts.deleteFailed"));
  }
};

// 釋放座位
const releaseSeat = async () => {
  if (!selectedSeat.value) return;

  const confirmed = await confirmModal({
    type: "warning",
    title: t("seatManagement.releaseSeat"),
    message: t("seatManagement.alerts.releaseConfirm", {
      seat: selectedSeat.value.seatNumber,
    }),
    confirmLabel: t("seatManagement.releaseSeat"),
  });
  if (!confirmed) return;

  try {
    await api.post(`/seats/${selectedSeat.value.id}/release`);

    emit("update");
    closeSeatModal();
  } catch (error) {
    console.error("Failed to release seat:", error);
    toast.error(t("seatManagement.alerts.releaseFailed"));
  }
};

// 重新生成座位 QR
const regenerateSeatQR = async () => {
  if (!selectedSeat.value) return;

  const confirmed = await confirmModal({
    type: "warning",
    title: t("seatManagement.regenerateQR"),
    message: t("seatManagement.alerts.regenerateConfirm", {
      seat: selectedSeat.value.seatNumber,
    }),
    confirmLabel: t("seatManagement.regenerateQR"),
  });
  if (!confirmed) return;

  try {
    await api.post(`/seats/${selectedSeat.value.id}/regenerate-qr`);

    emit("update");
    toast.success(t("seatManagement.alerts.regenerateSuccess"));
  } catch (error) {
    console.error("Failed to regenerate QR:", error);
    toast.error(t("seatManagement.alerts.regenerateFailed"));
  }
};

const prepareSeatQR = async () => {
  if (!selectedSeat.value) return;

  try {
    await api.post(`/seats/${selectedSeat.value.id}/qr/prepare`);
    emit("update");
    closeSeatModal();
    toast.success(t("qrRotation.alerts.prepared"));
  } catch (error) {
    console.error("Failed to prepare seat QR rotation:", error);
    toast.error(t("qrRotation.alerts.prepareFailed"));
  }
};

const activateSeatQR = async () => {
  if (!selectedSeat.value) return;

  const confirmed = await confirmModal({
    type: "warning",
    title: t("qrRotation.activate"),
    message: t("qrRotation.confirmActivate"),
    confirmLabel: t("qrRotation.activate"),
  });
  if (!confirmed) return;

  try {
    await api.post(`/seats/${selectedSeat.value.id}/qr/activate`);
    emit("update");
    closeSeatModal();
    toast.success(t("qrRotation.alerts.activated"));
  } catch (error) {
    console.error("Failed to activate seat QR rotation:", error);
    toast.error(t("qrRotation.alerts.activateFailed"));
  }
};

const discardSeatQR = async () => {
  if (!selectedSeat.value) return;

  const confirmed = await confirmModal({
    type: "warning",
    title: t("qrRotation.discard"),
    message: t("qrRotation.confirmDiscard"),
    confirmLabel: t("qrRotation.discard"),
  });
  if (!confirmed) return;

  try {
    await api.post(`/seats/${selectedSeat.value.id}/qr/discard`);
    emit("update");
    closeSeatModal();
    toast.success(t("qrRotation.alerts.discarded"));
  } catch (error) {
    console.error("Failed to discard seat QR rotation:", error);
    toast.error(t("qrRotation.alerts.discardFailed"));
  }
};

const downloadSeatQRCode = () => {
  if (!selectedSeat.value || !seatQrIsReady(selectedSeat.value)) {
    toast.warning(t("qrReadiness.notReadyDescription"));
    return;
  }

  const dataUrl = seatQrRef.value?.getDataUrl();
  if (!dataUrl) return;
  const link = document.createElement("a");
  link.download = `QR-${props.tableNumber}-${selectedSeat.value.seatNumber}.png`;
  link.href = dataUrl;
  link.click();
};

const printSeatQRCode = () => {
  if (!selectedSeat.value || !seatQrIsReady(selectedSeat.value)) {
    toast.warning(t("qrReadiness.notReadyDescription"));
    return;
  }

  const dataUrl = seatQrRef.value?.getDataUrl();
  if (!dataUrl) return;
  const label = t("seatManagement.printLabel", {
    table: props.tableNumber,
    seat: selectedSeat.value.seatNumber,
  });
  if (!printQRCodeSheet(label, [{ label, dataUrl }])) {
    toast.error(t("seatManagement.alerts.printFailed"));
  }
};

const printAllSeatQRCodes = async () => {
  const skippedCount =
    props.seats.filter((seat) => seat.isActive).length -
    printableSeats.value.length;
  if (skippedCount > 0) {
    toast.warning(t("qrReadiness.skippedNotReady", { count: skippedCount }));
  }
  if (printableSeats.value.length === 0) return;

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    toast.error(t("seatManagement.alerts.printFailed"));
    return;
  }

  try {
    const qrCodes = await Promise.all(
      printableSeats.value.map(async (seat) => ({
        label: t("seatManagement.printLabel", {
          table: props.tableNumber,
          seat: seat.seatNumber,
        }),
        dataUrl: await toPrintableDataUrl(printableSeatQrCode(seat)),
      })),
    );
    const title = t("seatManagement.printAllTitle", {
      table: props.tableNumber,
    });
    if (!printQRCodeSheetInWindow(printWindow, title, qrCodes)) {
      toast.error(t("seatManagement.alerts.printFailed"));
    }
  } catch (error) {
    console.error("Failed to prepare seat QR codes for printing:", error);
    toast.error(t("seatManagement.alerts.printFailed"));
  }
};

// 批量創建座位
const batchCreateSeats = async () => {
  try {
    const response = await api.post("/seats/batch-create", {
      tableId: props.tableId,
      seatCount: batchForm.value.count,
      numberingStyle: batchForm.value.numberingStyle,
      prefix: batchForm.value.prefix || undefined,
    });

    const createdSeats = (response.data?.data || []) as Seat[];
    emit("seatsCreated", createdSeats);
    showBatchCreateModal.value = false;
    emit("update");
    toast.success(
      t("seatManagement.alerts.batchCreateSuccess", {
        count: batchForm.value.count,
      }),
    );
  } catch (error) {
    console.error("Failed to batch create seats:", error);
    toast.error(
      extractApiErrorMessage(error) ||
        t("seatManagement.alerts.batchCreateFailed"),
    );
  }
};

// 重新生成所有 QR
const regenerateAllQR = async () => {
  const confirmed = await confirmModal({
    type: "warning",
    title: t("seatManagement.regenerateQR"),
    message: t("seatManagement.alerts.regenerateAllConfirm"),
    confirmLabel: t("seatManagement.regenerateQR"),
  });
  if (!confirmed) return;

  try {
    await api.post("/seats/batch-regenerate-qr", {
      tableId: props.tableId,
    });

    emit("update");
    toast.success(t("seatManagement.alerts.regenerateAllSuccess"));
  } catch (error) {
    console.error("Failed to regenerate all QR codes:", error);
    toast.error(t("seatManagement.alerts.regenerateFailed"));
  }
};

const prepareAllSeatQR = async () => {
  try {
    await api.post("/seats/batch-prepare-qr", {
      tableId: props.tableId,
    });

    emit("update");
    toast.success(t("qrRotation.alerts.prepared"));
  } catch (error) {
    console.error("Failed to prepare all seat QR rotations:", error);
    toast.error(t("qrRotation.alerts.prepareFailed"));
  }
};

const discardAllSeatQR = async () => {
  const confirmed = await confirmModal({
    type: "warning",
    title: t("qrRotation.discardAll"),
    message: t("qrRotation.confirmDiscardAll"),
    confirmLabel: t("qrRotation.discardAll"),
  });
  if (!confirmed) return;

  try {
    await Promise.all(
      props.seats
        .filter(seatHasPendingQr)
        .map((seat) => api.post(`/seats/${seat.id}/qr/discard`)),
    );

    emit("update");
    toast.success(t("qrRotation.alerts.discarded"));
  } catch (error) {
    console.error("Failed to discard all seat QR rotations:", error);
    toast.error(t("qrRotation.alerts.discardFailed"));
  }
};
</script>

<style scoped>
.seat-management {
  /* 樣式 */
}
</style>
