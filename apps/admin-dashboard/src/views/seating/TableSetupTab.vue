<template>
  <div class="space-y-6">
    <!-- Action Bar -->
    <div class="flex flex-wrap justify-end gap-3 mb-0">
      <button
        class="flex items-center px-5 py-2.5 rounded-full text-[13px] font-semibold bg-ios-green text-white hover:bg-green-600 transition-colors shadow-sm"
        @click="generateAllQRCodes"
      >
        <QrCode class="w-4 h-4 mr-1.5" />
        {{ t("tables.batchGenerateQR") }}
      </button>
      <button
        class="flex items-center px-5 py-2.5 rounded-full text-[13px] font-semibold bg-ios-blue text-white hover:bg-blue-600 transition-colors shadow-sm"
        @click="prepareFilteredTableQRCodes"
      >
        <QrCode class="w-4 h-4 mr-1.5" />
        {{ t("qrRotation.prepareShown") }}
      </button>
      <button
        v-if="pendingTableCount > 0"
        class="flex items-center px-5 py-2.5 rounded-full text-[13px] font-semibold bg-ios-orange text-white hover:bg-orange-600 transition-colors shadow-sm"
        @click="discardAllPreparedTableQRCodes"
      >
        <XCircle class="w-4 h-4 mr-1.5" />
        {{ t("qrRotation.discardAll") }}
      </button>
      <button
        v-if="selectedPrintableCount > 0"
        class="flex items-center px-5 py-2.5 rounded-full text-[13px] font-semibold bg-ios-text text-white hover:bg-ios-text/85 transition-colors shadow-sm"
        @click="printSelectedTableQRCodes"
      >
        <QrCode class="w-4 h-4 mr-1.5" />
        {{
          t("tables.qrModal.printSelected", { count: selectedPrintableCount })
        }}
      </button>
      <button
        class="flex items-center px-5 py-2.5 rounded-full text-[13px] font-semibold bg-ios-text/10 text-ios-text hover:bg-ios-text/20 transition-colors"
        @click="printAllTableQRCodes"
      >
        <QrCode class="w-4 h-4 mr-1.5" />
        {{ t("tables.qrModal.printAll") }}
      </button>
      <button
        class="flex items-center px-5 py-2.5 rounded-full text-[13px] font-semibold bg-ios-blue text-white hover:bg-blue-600 transition-colors shadow-sm"
        data-testid="open-create-table"
        @click="showTableModal = true"
      >
        <Plus class="w-4 h-4 mr-1.5" />
        {{ t("tables.addTable") }}
      </button>
    </div>

    <!-- Filters -->
    <div class="card p-6">
      <div class="flex flex-col sm:flex-row gap-4">
        <div class="relative flex-1">
          <Search class="absolute left-3 top-3 h-4 w-4 text-ios-text/30" />
          <input
            v-model="searchQuery"
            type="text"
            :placeholder="t('tables.searchPlaceholder')"
            class="w-full pl-10 pr-4 py-2 border border-ios-separator rounded-xl focus:ring-2 focus:ring-ios-blue/30 focus:border-ios-blue bg-ios-bg/50 text-sm"
          />
        </div>
        <select
          v-model="statusFilter"
          class="px-3 py-2 border border-ios-separator rounded-xl focus:ring-2 focus:ring-ios-blue/30 focus:border-ios-blue bg-ios-bg/50 text-sm"
        >
          <option value="">{{ t("tables.filter.allStatus") }}</option>
          <option value="available">{{ t("tables.status.available") }}</option>
          <option value="occupied">{{ t("tables.status.occupied") }}</option>
          <option value="maintenance">
            {{ t("tables.status.maintenance") }}
          </option>
        </select>
        <label
          v-if="filteredTables.length > 0"
          class="flex items-center px-3 py-2 text-sm text-ios-text/70 cursor-pointer select-none whitespace-nowrap"
        >
          <input
            type="checkbox"
            class="h-4 w-4 mr-2 rounded border-ios-separator text-ios-blue focus:ring-ios-blue/30"
            :checked="allFilteredSelected"
            @change="toggleSelectAllFiltered"
          />
          {{ t("tables.qrModal.selectAllFiltered") }}
        </label>
        <select
          v-model="capacityFilter"
          class="px-3 py-2 border border-ios-separator rounded-xl focus:ring-2 focus:ring-ios-blue/30 focus:border-ios-blue bg-ios-bg/50 text-sm"
        >
          <option value="">{{ t("tables.filter.allCapacity") }}</option>
          <option value="2">{{ t("tables.filter.seats2") }}</option>
          <option value="4">{{ t("tables.filter.seats4") }}</option>
          <option value="6">{{ t("tables.filter.seats6") }}</option>
          <option value="8">{{ t("tables.filter.seats8plus") }}</option>
        </select>
      </div>
      <p class="mt-3 text-sm text-ios-text/60" role="status">
        {{ t("tables.totalCount", { count: tablePagination.total }) }}
        <span
          v-if="tablePagination.total > TABLE_FETCH_LIMIT"
          class="ml-2 text-ios-red-deep"
        >
          {{ t("tables.listTruncated", { limit: TABLE_FETCH_LIMIT }) }}
        </span>
      </p>
    </div>

    <!-- Tables Grid -->
    <div
      class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
    >
      <div
        v-for="table in filteredTables"
        :key="table.id"
        class="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.1)] transition-all"
      >
        <div class="p-6">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center">
              <input
                type="checkbox"
                class="h-4 w-4 mr-3 rounded border-ios-separator text-ios-blue focus:ring-ios-blue/30 cursor-pointer"
                :checked="isTableSelected(table.id)"
                :aria-label="
                  t('tables.qrModal.selectForPrint', {
                    number: table.tableNumber,
                  })
                "
                :data-testid="`select-table-${table.id}`"
                @change="toggleTableSelection(table.id)"
              />
              <div
                :class="getStatusColor(table.status)"
                class="w-3 h-3 rounded-full mr-3"
              />
              <!-- The badges wrap; the table number must not — it is the card's
                   identity and reads as broken when it breaks across lines. -->
              <h3 class="text-lg font-semibold text-ios-text whitespace-nowrap">
                {{ t("tables.tableNumber") }} {{ table.tableNumber }}
              </h3>
            </div>
            <div class="flex flex-wrap justify-end gap-2">
              <span
                v-if="!tableQrIsReady(table)"
                class="px-2.5 py-1 text-xs font-medium rounded-full bg-ios-red/10 text-ios-red-deep"
              >
                {{ t("qrReadiness.notReady") }}
              </span>
              <span
                :class="getStatusBadgeClass(table.status)"
                class="px-2.5 py-1 text-xs font-medium rounded-full"
              >
                {{ getStatusText(table.status) }}
              </span>
            </div>
          </div>

          <div class="space-y-2 mb-4">
            <div class="flex items-center text-sm text-ios-text/60">
              <Users class="h-4 w-4 mr-2" />
              <span
                >{{ t("tables.capacity") }}: {{ table.capacity }}
                {{ t("tables.people") }}</span
              >
            </div>
            <div class="flex items-center text-sm text-ios-text/60">
              <MapPin class="h-4 w-4 mr-2" />
              <span
                >{{ t("tables.location") }}:
                {{ table.location || t("tables.notSet") }}</span
              >
            </div>
            <div
              v-if="table.currentOrderId"
              class="flex items-center text-sm text-ios-text/60"
            >
              <FileText class="h-4 w-4 mr-2" />
              <span>{{ t("tables.order") }}: #{{ table.currentOrderId }}</span>
            </div>
          </div>

          <!-- QR Code Preview — the code itself is the affordance for enlarging -->
          <div class="mb-4 flex flex-col items-center">
            <button
              type="button"
              class="group relative rounded-2xl bg-ios-bg p-2 transition-all duration-200 hover:bg-ios-separator hover:scale-[1.03] active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue/40"
              :aria-label="
                t('tables.qrPreview.enlarge', { number: table.tableNumber })
              "
              :data-testid="`open-qr-${table.id}`"
              @click="viewQRCode(table)"
            >
              <QRCodeRenderer
                v-if="tableQrIsReady(table)"
                :content="printableTableQrCode(table)"
                :size="72"
                :padding="4"
              />
              <div
                v-else
                class="w-[72px] h-[72px] flex items-center justify-center rounded-lg border border-dashed border-ios-tertiary bg-white"
              >
                <QrCode class="w-8 h-8 text-ios-secondary" />
              </div>
              <span
                class="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-white text-ios-blue shadow-[0_2px_6px_rgba(0,0,0,0.14)] opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
              >
                <Maximize2 class="h-3.5 w-3.5" />
              </span>
            </button>
            <div
              v-if="tableHasPendingQr(table)"
              class="mt-2 text-xs font-medium text-ios-orange"
            >
              {{ t("qrRotation.pending") }}
            </div>
            <div
              v-else-if="!tableQrIsReady(table)"
              class="mt-2 text-xs font-medium text-ios-red-deep"
            >
              {{ t("qrReadiness.notReady") }}
            </div>
            <div v-else class="mt-2 text-[11px] text-ios-text/40">
              {{ t("tables.qrPreview.hint") }}
            </div>
          </div>

          <!-- Actions -->
          <div class="space-y-3">
            <!-- Everyday operations: the status change leads, edit/delete pair -->
            <button
              :class="[ACTION_PILL, getStatusButtonClass(table.status)]"
              class="w-full shadow-sm"
              @click="changeTableStatus(table)"
            >
              <ArrowLeftRight class="h-3.5 w-3.5" />
              {{ getStatusButtonText(table.status) }}
            </button>
            <div class="flex gap-2">
              <button
                :class="[ACTION_PILL, TONAL.neutral]"
                class="flex-1"
                :data-testid="`edit-table-${table.id}`"
                @click="editTable(table)"
              >
                <Pencil class="h-3.5 w-3.5" />
                {{ t("common.edit") }}
              </button>
              <button
                :class="[ACTION_PILL, TONAL.red]"
                class="flex-1"
                :disabled="!canDeleteTable(table)"
                :title="
                  canDeleteTable(table) ? undefined : t('tables.deleteBlocked')
                "
                @click="deleteTable(table)"
              >
                <Trash2 class="h-3.5 w-3.5" />
                {{ t("common.delete") }}
              </button>
            </div>

            <div class="h-px bg-ios-bg" />

            <!-- Setup: seat layout and QR lifecycle. Wrapping is required here —
                 a nowrap pill in a nowrap row overflows the card and clips. -->
            <div class="flex flex-wrap gap-2">
              <button
                v-if="table.qrMode === 'seat'"
                :class="[ACTION_PILL, TONAL.neutral]"
                :data-testid="`manage-seats-${table.id}`"
                @click="manageSeats(table)"
              >
                <Armchair class="h-3.5 w-3.5" />
                {{ t("seatManagement.title") }}
              </button>
              <button
                v-if="!tableHasPendingQr(table)"
                :class="[ACTION_PILL, TONAL.blue]"
                @click="prepareTableQRCode(table)"
              >
                <Sparkles class="h-3.5 w-3.5" />
                {{ t("qrRotation.prepare") }}
              </button>
              <button
                v-if="!tableQrIsReady(table)"
                :class="[ACTION_PILL, TONAL.green]"
                @click="regenerateTableQRCode(table)"
              >
                <RefreshCw class="h-3.5 w-3.5" />
                {{ t("tableDetail.qrCode.regenerate") }}
              </button>
              <button
                v-if="tableHasPendingQr(table)"
                :class="[ACTION_PILL, SOLID_GREEN]"
                @click="activateTableQRCode(table)"
              >
                <CheckCircle2 class="h-3.5 w-3.5" />
                {{ t("qrRotation.activate") }}
              </button>
              <button
                v-if="tableHasPendingQr(table)"
                :class="[ACTION_PILL, TONAL.red]"
                @click="discardTableQRCode(table)"
              >
                <XCircle class="h-3.5 w-3.5" />
                {{ t("qrRotation.discard") }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div
        v-if="filteredTables.length === 0"
        class="col-span-full text-center py-12"
      >
        <TableProperties class="mx-auto h-12 w-12 text-ios-text/30" />
        <h3 class="mt-2 text-sm font-medium text-ios-text">
          {{ t("tables.empty.title") }}
        </h3>
        <p class="mt-1 text-sm text-ios-text/50">
          {{ t("tables.empty.subtitle") }}
        </p>
        <button
          class="mt-4 inline-flex items-center px-5 py-2.5 bg-ios-blue text-white rounded-full hover:bg-blue-600 transition-colors text-sm font-semibold"
          data-testid="open-create-table-empty"
          @click="showTableModal = true"
        >
          <Plus class="h-4 w-4 mr-1.5" />
          {{ t("tables.addTable") }}
        </button>
      </div>
    </div>

    <!-- Table Management Modal -->
    <div v-if="showTableModal" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div class="fixed inset-0 bg-black/30" @click="closeTableModal" />
        <div
          class="relative bg-white rounded-2xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
        >
          <div class="p-6">
            <h3 class="text-lg font-semibold text-ios-text mb-4">
              {{ editingTable ? t("tables.editTable") : t("tables.addTable") }}
            </h3>

            <form @submit.prevent="saveTable">
              <div class="space-y-4">
                <div>
                  <label
                    class="block text-sm font-medium text-ios-text/70 mb-1"
                  >
                    {{ t("tables.form.tableNumber") }}
                    <span class="text-ios-red">*</span>
                  </label>
                  <input
                    v-model="tableForm.tableNumber"
                    data-testid="table-number"
                    type="text"
                    required
                    class="w-full px-3 py-2 border border-ios-separator rounded-xl focus:ring-2 focus:ring-ios-blue/30 focus:border-ios-blue text-sm"
                  />
                </div>

                <div>
                  <label
                    class="block text-sm font-medium text-ios-text/70 mb-1"
                    >{{ t("tables.form.tableName") }}</label
                  >
                  <input
                    v-model="tableForm.tableName"
                    data-testid="table-name"
                    type="text"
                    class="w-full px-3 py-2 border border-ios-separator rounded-xl focus:ring-2 focus:ring-ios-blue/30 focus:border-ios-blue text-sm"
                  />
                </div>

                <div>
                  <label
                    class="block text-sm font-medium text-ios-text/70 mb-1"
                  >
                    {{ t("tables.form.capacity") }}
                    <span class="text-ios-red">*</span>
                  </label>
                  <select
                    v-model.number="tableForm.capacity"
                    data-testid="table-capacity"
                    required
                    class="w-full px-3 py-2 border border-ios-separator rounded-xl focus:ring-2 focus:ring-ios-blue/30 focus:border-ios-blue text-sm"
                  >
                    <option value="2">
                      {{ t("tables.form.persons", { count: 2 }) }}
                    </option>
                    <option value="4">
                      {{ t("tables.form.persons", { count: 4 }) }}
                    </option>
                    <option value="6">
                      {{ t("tables.form.persons", { count: 6 }) }}
                    </option>
                    <option value="8">
                      {{ t("tables.form.persons", { count: 8 }) }}
                    </option>
                    <option value="10">
                      {{ t("tables.form.persons", { count: 10 }) }}
                    </option>
                  </select>
                </div>

                <div>
                  <label
                    class="block text-sm font-medium text-ios-text/70 mb-1"
                    >{{ t("tables.form.location") }}</label
                  >
                  <input
                    v-model="tableForm.location"
                    data-testid="table-location"
                    type="text"
                    :placeholder="t('tables.form.locationPlaceholder')"
                    class="w-full px-3 py-2 border border-ios-separator rounded-xl focus:ring-2 focus:ring-ios-blue/30 focus:border-ios-blue text-sm"
                  />
                </div>

                <div>
                  <label
                    class="block text-sm font-medium text-ios-text/70 mb-1"
                    >{{ t("tables.form.status") }}</label
                  >
                  <select
                    v-model="tableForm.status"
                    class="w-full px-3 py-2 border border-ios-separator rounded-xl focus:ring-2 focus:ring-ios-blue/30 focus:border-ios-blue text-sm"
                  >
                    <option value="available">
                      {{ t("tables.status.available") }}
                    </option>
                    <option value="occupied">
                      {{ t("tables.status.occupied") }}
                    </option>
                    <option value="maintenance">
                      {{ t("tables.status.maintenance") }}
                    </option>
                  </select>
                </div>
              </div>

              <!-- QR Mode Selector -->
              <div class="mt-6">
                <QRModeSelector
                  v-model="tableForm.qrMode"
                  v-model:seat-config="tableForm.seatConfig"
                  :max-seat-count="tableForm.capacity"
                  :seat-count-read-only="
                    Boolean(
                      editingTable &&
                      editingTable.qrMode === 'seat' &&
                      tableForm.qrMode === 'seat',
                    )
                  "
                />
              </div>

              <div class="flex justify-end space-x-3 mt-6">
                <button
                  type="button"
                  class="px-5 py-2.5 text-ios-text bg-ios-bg rounded-full hover:bg-ios-separator transition-colors text-sm font-semibold"
                  @click="closeTableModal"
                >
                  {{ t("common.cancel") }}
                </button>
                <button
                  type="submit"
                  data-testid="table-submit"
                  class="px-5 py-2.5 bg-ios-blue text-white rounded-full hover:bg-blue-600 transition-colors text-sm font-semibold"
                >
                  {{ editingTable ? t("common.update") : t("common.add") }}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>

    <!-- QR Code Preview Modal -->
    <div v-if="showQRModal" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div class="fixed inset-0 bg-black/30" @click="showQRModal = false" />
        <div class="relative bg-white rounded-2xl shadow-xl max-w-md w-full">
          <div class="p-6 text-center">
            <h3 class="text-lg font-semibold text-ios-text mb-4">
              {{
                t("tables.qrModal.title", {
                  number: selectedTable?.tableNumber ?? "",
                })
              }}
            </h3>

            <div class="mb-6">
              <div class="inline-block p-4 bg-ios-bg rounded-2xl">
                <QRCodeRenderer
                  v-if="selectedTable && tableQrIsReady(selectedTable)"
                  ref="qrModalRef"
                  :content="
                    selectedTable ? printableTableQrCode(selectedTable) : ''
                  "
                  :size="200"
                  :padding="12"
                  container-class="shadow-sm"
                />
                <div
                  v-else
                  class="w-[200px] h-[200px] flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-ios-tertiary bg-white text-ios-secondary"
                >
                  <QrCode class="w-16 h-16" />
                  <span class="text-sm font-semibold text-ios-red-deep">
                    {{ t("qrReadiness.notReady") }}
                  </span>
                </div>
              </div>
              <p
                v-if="selectedTable && tableQrIsReady(selectedTable)"
                class="text-xs text-ios-text/30 mt-2 font-mono"
              >
                {{ selectedTable ? printableTableQrCode(selectedTable) : "" }}
              </p>
              <p v-else class="text-xs text-ios-red-deep mt-2">
                {{ t("qrReadiness.notReadyDescription") }}
              </p>
            </div>

            <div class="flex justify-center space-x-3">
              <button
                class="px-5 py-2.5 bg-ios-green text-white rounded-full hover:bg-green-600 transition-colors text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="!selectedTable || !tableQrIsReady(selectedTable)"
                @click="downloadQRCode"
              >
                {{ t("tables.qrModal.download") }}
              </button>
              <button
                class="px-5 py-2.5 bg-ios-blue text-white rounded-full hover:bg-blue-600 transition-colors text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="!selectedTable || !tableQrIsReady(selectedTable)"
                @click="printQRCode"
              >
                {{ t("tables.qrModal.print") }}
              </button>
              <button
                v-if="selectedTable && !tableQrIsReady(selectedTable)"
                class="px-5 py-2.5 bg-ios-green text-white rounded-full hover:bg-green-600 transition-colors text-sm font-semibold"
                @click="regenerateTableQRCode(selectedTable)"
              >
                {{ t("tableDetail.qrCode.regenerate") }}
              </button>
              <button
                class="px-5 py-2.5 text-ios-text bg-ios-bg rounded-full hover:bg-ios-separator transition-colors text-sm font-semibold"
                @click="showQRModal = false"
              >
                {{ t("common.close") }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "@/i18n";
import { useToast } from "vue-toastification";
import { useConfirmModal } from "@/composables/useConfirmModal";
import { api, unwrapApiList } from "@/services/api";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";
import { useAuthStore } from "@/stores/auth";
import {
  Plus,
  Search,
  QrCode,
  Users,
  MapPin,
  FileText,
  TableProperties,
  XCircle,
  Maximize2,
  Pencil,
  Trash2,
  Armchair,
  RefreshCw,
  CheckCircle2,
  ArrowLeftRight,
  Sparkles,
} from "lucide-vue-next";
import QRModeSelector from "@/components/tables/QRModeSelector.vue";
import QRCodeRenderer from "@/components/tables/QRCodeRenderer.vue";
import {
  printQRCodeSheet,
  printQRCodeSheetInWindow,
  toPrintableDataUrl,
} from "@/utils/qrPrintSheet";
import { getPrintableQrCode, isQrReady } from "@/utils/qrReadiness";

const { t } = useI18n();
const toast = useToast();
const { confirm: confirmModal } = useConfirmModal();
const authStore = useAuthStore();
const router = useRouter();
const route = useRoute();
const qrModalRef = ref<InstanceType<typeof QRCodeRenderer> | null>(null);

const searchQuery = ref("");
const statusFilter = ref("");
const capacityFilter = ref("");
const showTableModal = ref(false);
const showQRModal = ref(false);

type TableStatus = "available" | "occupied" | "maintenance";
type QRMode = "table" | "seat";
type SeatNumberingStyle = "numeric" | "alphabetic";

interface ApiTable {
  id: number;
  number?: string;
  tableNumber?: string;
  name?: string | null;
  tableName?: string | null;
  capacity?: number | null;
  location?: string | null;
  isActive?: boolean;
  isOccupied?: boolean;
  qrCode?: string | null;
  pendingQrCode?: string | null;
  pendingQrCodeVersion?: number | null;
  pendingQrPreparedAt?: string | number | null;
  qrMode?: QRMode | null;
  seatCount?: number | null;
  seatNumberingStyle?: SeatNumberingStyle | null;
  currentOrderId?: string | number | null;
  orderId?: string | number | null;
}

interface TableViewModel {
  id: number;
  tableNumber: string;
  tableName: string;
  capacity: number;
  location: string;
  status: TableStatus;
  qrCode: string;
  pendingQrCode: string;
  pendingQrCodeVersion: number | null;
  pendingQrPreparedAt: string | number | null;
  qrMode: QRMode;
  seatCount: number;
  seatNumberingStyle: SeatNumberingStyle;
  currentOrderId: string | number | null;
}

const editingTable = ref<TableViewModel | null>(null);
const selectedTable = ref<TableViewModel | null>(null);

/** Map API table object to the shape used by this view */
const mapTable = (t: ApiTable): TableViewModel => ({
  id: t.id,
  tableNumber: t.number || t.tableNumber || "",
  tableName: t.name || t.tableName || "",
  capacity: t.capacity ?? 0,
  location: t.location || "",
  status: !t.isActive ? "maintenance" : t.isOccupied ? "occupied" : "available",
  qrCode: t.qrCode || "",
  pendingQrCode: t.pendingQrCode || "",
  pendingQrCodeVersion: t.pendingQrCodeVersion ?? null,
  pendingQrPreparedAt: t.pendingQrPreparedAt ?? null,
  qrMode: t.qrMode || "table",
  seatCount: t.seatCount ?? 0,
  seatNumberingStyle: t.seatNumberingStyle || "numeric",
  currentOrderId: t.currentOrderId || t.orderId || null,
});

const tables = ref<TableViewModel[]>([]);
const TABLE_FETCH_LIMIT = 100;
const tablePagination = ref({
  page: 1,
  limit: TABLE_FETCH_LIMIT,
  total: 0,
  totalPages: 0,
});
const handledRouteEditId = ref<number | null>(null);

const defaultTableForm = () => ({
  tableNumber: "",
  tableName: "",
  capacity: 4,
  location: "",
  status: "available",
  qrMode: "table" as "table" | "seat",
  seatConfig: {
    count: 4,
    numberingStyle: "numeric" as "numeric" | "alphabetic",
  },
});

const tableForm = ref(defaultTableForm());

watch(
  () => tableForm.value.capacity,
  (capacity) => {
    if (
      !(
        editingTable.value?.qrMode === "seat" &&
        tableForm.value.qrMode === "seat"
      ) &&
      tableForm.value.seatConfig.count > capacity
    ) {
      tableForm.value.seatConfig.count = capacity;
    }
  },
);

const filteredTables = computed(() => {
  const query = searchQuery.value.toLowerCase();
  const status = statusFilter.value;
  const capVal = capacityFilter.value ? parseInt(capacityFilter.value) : 0;

  return tables.value
    .filter((table) => {
      if (
        query &&
        !(
          table.tableNumber.toLowerCase().includes(query) ||
          table.tableName?.toLowerCase().includes(query) ||
          table.location?.toLowerCase().includes(query)
        )
      )
        return false;
      if (status && table.status !== status) return false;
      if (capVal) {
        if (capVal === 8 ? table.capacity < 8 : table.capacity !== capVal)
          return false;
      }
      return true;
    })
    .sort((a, b) => a.tableNumber.localeCompare(b.tableNumber));
});

/**
 * QR print selection.
 *
 * Kept independent of the active filter on purpose: building a print run
 * section by section (filter to 1F, select, filter to 2F, add more) is the
 * reason to select at all, so changing the filter must not silently discard
 * what is already picked. Select-all, by contrast, acts on what is visible.
 */
const selectedTableIds = ref<number[]>([]);

const isTableSelected = (id: number) => selectedTableIds.value.includes(id);
type QrCodeSource = {
  pendingQrCode?: string;
  qrCode?: string;
};

const printableTableQrCode = (table: QrCodeSource) =>
  getPrintableQrCode(table.pendingQrCode, table.qrCode);
const tableQrIsReady = (table: QrCodeSource) =>
  isQrReady(printableTableQrCode(table));
const tableHasPendingQr = (table: Pick<QrCodeSource, "pendingQrCode">) =>
  Boolean(table.pendingQrCode);

const toggleTableSelection = (id: number) => {
  selectedTableIds.value = isTableSelected(id)
    ? selectedTableIds.value.filter((selected) => selected !== id)
    : [...selectedTableIds.value, id];
};

const allFilteredSelected = computed(
  () =>
    filteredTables.value.length > 0 &&
    filteredTables.value.every((table) => isTableSelected(table.id)),
);

const toggleSelectAllFiltered = () => {
  const visibleIds = filteredTables.value.map((table) => table.id);
  if (allFilteredSelected.value) {
    selectedTableIds.value = selectedTableIds.value.filter(
      (id) => !visibleIds.includes(id),
    );
    return;
  }
  const merged = new Set([...selectedTableIds.value, ...visibleIds]);
  selectedTableIds.value = [...merged];
};

const selectedPrintableTables = computed(() =>
  tables.value.filter(
    (table) => isTableSelected(table.id) && tableQrIsReady(table),
  ),
);

const selectedPrintableCount = computed(
  () => selectedPrintableTables.value.length,
);
const pendingTableCount = computed(
  () => tables.value.filter(tableHasPendingQr).length,
);

const printSelectedTableQRCodes = async () => {
  await printTableQRCodes(
    tables.value.filter((table) => isTableSelected(table.id)),
  );
};

// mapTable derives status from isActive/isOccupied only, so the reachable
// set is exactly available | occupied | maintenance. `tables` has no
// reserved column -- reservations live in their own table -- so offering
// a 已預約 filter here only ever rendered the "no tables" empty state.
const STATUS_COLORS: Record<string, string> = {
  available: "bg-ios-green",
  occupied: "bg-ios-red",
  maintenance: "bg-ios-secondary",
};

const STATUS_BADGE_CLASSES: Record<string, string> = {
  available: "bg-emerald-50 text-emerald-700",
  occupied: "bg-red-50 text-red-700",
  maintenance: "bg-slate-100 text-slate-700",
};

const STATUS_BUTTON_CLASSES: Record<string, string> = {
  available: "bg-ios-red text-white hover:bg-red-600",
  occupied: "bg-ios-green text-white hover:bg-green-600",
  maintenance: "bg-ios-orange text-white hover:bg-orange-600",
};

/**
 * One shared pill geometry for every card action. The fixed height plus
 * `whitespace-nowrap` is the point: a label that wraps inside a `rounded-full`
 * pill turns into a blob that no longer reads as a button. Since the pills never
 * shrink, any row holding several of them has to either wrap or split them into
 * fixed slots, or the last one overflows the card and clips.
 */
const ACTION_PILL =
  "inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-full text-[13px] font-semibold whitespace-nowrap transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue/40 disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Only the status change and QR activation stay solid fills. Everything else is
 * tonal, so a card carrying five actions reads as one hierarchy rather than
 * five competing alarms.
 */
const TONAL = {
  neutral: "bg-ios-text/10 text-ios-text hover:bg-ios-text/20",
  blue: "bg-ios-blue/10 text-blue-600 hover:bg-ios-blue/20",
  green: "bg-ios-green/15 text-ios-green-deep hover:bg-ios-green/25",
  red: "bg-ios-red/10 text-ios-red-deep hover:bg-ios-red/20",
};

const SOLID_GREEN = "bg-ios-green text-white hover:bg-green-600 shadow-sm";

const getStatusColor = (status: string) =>
  STATUS_COLORS[status] || STATUS_COLORS.maintenance;
const getStatusBadgeClass = (status: string) =>
  STATUS_BADGE_CLASSES[status] || STATUS_BADGE_CLASSES.maintenance;
const getStatusText = (status: string) =>
  t(`tables.status.${status}`) || status;
const getStatusButtonClass = (status: string) =>
  STATUS_BUTTON_CLASSES[status] ||
  "bg-ios-secondary text-white hover:bg-ios-text/60";
const getStatusButtonText = (status: string) =>
  t(`tables.statusAction.${status}`) || t("tables.statusAction.change");

const generateAllQRCodes = async () => {
  const confirmed = await confirmModal({
    type: "warning",
    title: t("tables.confirm.regenerateAllQRTitle"),
    message: t("tables.confirm.regenerateAllQR"),
    confirmLabel: t("tables.confirm.regenerateAllQRAction"),
  });
  if (!confirmed) return;

  const restaurantId = authStore.restaurantId;
  if (!restaurantId) return;

  try {
    const tableIds = tables.value.map((t) => t.id);
    await api.post("/tables/bulk-qr", {
      restaurantId,
      tableIds,
    });
    await fetchTables();
    toast.success(t("tables.alert.qrGenerated"));
  } catch (error) {
    console.error("Failed to generate QR codes:", error);
    toast.error(t("tables.alert.qrGenerateFailed"));
  }
};

const regenerateTableQRCode = async (table: TableViewModel) => {
  try {
    await api.post(`/tables/${table.id}/regenerate-qr`, {});
    await fetchTables();
    if (selectedTable.value?.id === table.id) {
      selectedTable.value =
        tables.value.find((candidate) => candidate.id === table.id) || null;
    }
    toast.success(t("tables.alert.qrGenerated"));
  } catch (error) {
    console.error("Failed to regenerate table QR code:", error);
    toast.error(t("tables.alert.qrGenerateFailed"));
  }
};

const prepareTableQRCode = async (table: TableViewModel) => {
  try {
    await api.post(`/tables/${table.id}/qr/prepare`);
    await fetchTables();
    toast.success(t("qrRotation.alerts.prepared"));
  } catch (error) {
    console.error("Failed to prepare QR rotation:", error);
    toast.error(t("qrRotation.alerts.prepareFailed"));
  }
};

const activateTableQRCode = async (table: TableViewModel) => {
  const confirmed = await confirmModal({
    type: "warning",
    title: t("qrRotation.activate"),
    message: t("qrRotation.confirmActivate"),
    confirmLabel: t("qrRotation.activate"),
  });
  if (!confirmed) return;

  try {
    await api.post(`/tables/${table.id}/qr/activate`);
    await fetchTables();
    toast.success(t("qrRotation.alerts.activated"));
  } catch (error) {
    console.error("Failed to activate QR rotation:", error);
    toast.error(t("qrRotation.alerts.activateFailed"));
  }
};

const discardTableQRCode = async (table: TableViewModel) => {
  const confirmed = await confirmModal({
    type: "warning",
    title: t("qrRotation.discard"),
    message: t("qrRotation.confirmDiscard"),
    confirmLabel: t("qrRotation.discard"),
  });
  if (!confirmed) return;

  try {
    await api.post(`/tables/${table.id}/qr/discard`);
    await fetchTables();
    toast.success(t("qrRotation.alerts.discarded"));
  } catch (error) {
    console.error("Failed to discard QR rotation:", error);
    toast.error(t("qrRotation.alerts.discardFailed"));
  }
};

const prepareFilteredTableQRCodes = async () => {
  const targets = filteredTables.value.filter(
    (table) => !tableHasPendingQr(table),
  );
  if (targets.length === 0) {
    toast.warning(t("qrRotation.alerts.noneToPrepare"));
    return;
  }

  try {
    await Promise.all(
      targets.map((table) => api.post(`/tables/${table.id}/qr/prepare`)),
    );
    await fetchTables();
    toast.success(t("qrRotation.alerts.prepared"));
  } catch (error) {
    console.error("Failed to prepare table QR rotations:", error);
    toast.error(t("qrRotation.alerts.prepareFailed"));
  }
};

const discardAllPreparedTableQRCodes = async () => {
  const targets = tables.value.filter(tableHasPendingQr);
  if (targets.length === 0) return;

  const confirmed = await confirmModal({
    type: "warning",
    title: t("qrRotation.discardAll"),
    message: t("qrRotation.confirmDiscardAll"),
    confirmLabel: t("qrRotation.discardAll"),
  });
  if (!confirmed) return;

  try {
    await Promise.all(
      targets.map((table) => api.post(`/tables/${table.id}/qr/discard`)),
    );
    await fetchTables();
    toast.success(t("qrRotation.alerts.discarded"));
  } catch (error) {
    console.error("Failed to discard table QR rotations:", error);
    toast.error(t("qrRotation.alerts.discardFailed"));
  }
};

const viewQRCode = (table: TableViewModel) => {
  selectedTable.value = table;
  showQRModal.value = true;
};

const manageSeats = (table: TableViewModel) => {
  router.push({
    name: "TableDetail",
    params: { id: table.id },
  });
};

const editTable = (table: TableViewModel) => {
  editingTable.value = table;
  tableForm.value = {
    ...table,
    qrMode: table.qrMode || "table",
    seatConfig: {
      count: table.seatCount || table.capacity || 4,
      numberingStyle: table.seatNumberingStyle || "numeric",
    },
  };
  showTableModal.value = true;
};

const canDeleteTable = (table: TableViewModel) =>
  table.status !== "occupied" && !table.currentOrderId;

const deleteTable = async (table: TableViewModel) => {
  if (!canDeleteTable(table)) {
    toast.error(t("tables.deleteBlocked"));
    return;
  }

  const confirmed = await confirmModal({
    type: "danger",
    title: t("tables.confirm.deleteTitle"),
    message: t("tables.confirm.delete", { number: table.tableNumber }),
    confirmLabel: t("tables.confirm.deleteAction"),
  });
  if (!confirmed) return;

  try {
    await api.delete(`/tables/${table.id}`);
    if (selectedTable.value?.id === table.id) {
      selectedTable.value = null;
      showQRModal.value = false;
    }
    selectedTableIds.value = selectedTableIds.value.filter(
      (id) => id !== table.id,
    );
    await fetchTables();
    toast.success(t("tables.alert.deleteSuccess"));
  } catch (error) {
    console.error("Failed to delete table:", error);
    toast.error(t("tables.alert.deleteFailed"));
  }
};

const changeTableStatus = async (table: TableViewModel) => {
  try {
    if (table.status === "occupied") {
      await api.post(`/tables/${table.id}/release`);
    } else if (table.status === "available") {
      // Manual seating from the floor plan — no order exists yet, so omit orderId
      await api.post(`/tables/${table.id}/occupy`, { occupiedBy: "manual" });
    } else if (table.status === "maintenance") {
      await api.put(`/tables/${table.id}`, { isActive: true });
    }
    await fetchTables();
  } catch (error) {
    console.error("Failed to change table status:", error);
    toast.error(t("tables.alert.statusChangeFailed"));
  }
};

const closeTableModal = () => {
  showTableModal.value = false;
  editingTable.value = null;
  tableForm.value = defaultTableForm();
};

const saveTable = async () => {
  const restaurantId = authStore.restaurantId;
  if (!restaurantId) return;

  // Captured before closeTableModal() clears editingTable
  const isEdit = Boolean(editingTable.value);

  try {
    const isExistingSeatMode =
      editingTable.value?.qrMode === "seat" &&
      tableForm.value.qrMode === "seat";
    const isModeSwitch =
      editingTable.value &&
      editingTable.value.qrMode !== tableForm.value.qrMode;
    if (isModeSwitch) {
      const confirmed = await confirmModal({
        type: "warning",
        title: t("tableDetail.confirm.switchModeTitle"),
        message: t("tables.modeSwitchWarning"),
        confirmLabel: t("tableDetail.confirm.switchModeAction"),
      });
      if (!confirmed) return;
    }
    if (editingTable.value) {
      const payload = {
        number: tableForm.value.tableNumber,
        name: tableForm.value.tableName || undefined,
        capacity: tableForm.value.capacity,
        location: tableForm.value.location || undefined,
        isActive: tableForm.value.status !== "maintenance",
        qrMode: tableForm.value.qrMode,
        seatNumberingStyle: tableForm.value.seatConfig.numberingStyle,
      } as Record<string, unknown>;
      if (!isExistingSeatMode) {
        payload.seatCount =
          tableForm.value.qrMode === "seat"
            ? tableForm.value.seatConfig.count
            : 0;
      }
      await api.put(`/tables/${editingTable.value.id}`, payload);
    } else {
      await api.post("/tables", {
        restaurantId,
        number: tableForm.value.tableNumber,
        name: tableForm.value.tableName || undefined,
        capacity: tableForm.value.capacity,
        location: tableForm.value.location || undefined,
        qrMode: tableForm.value.qrMode,
        seatCount:
          tableForm.value.qrMode === "seat"
            ? tableForm.value.seatConfig.count
            : 0,
        seatNumberingStyle: tableForm.value.seatConfig.numberingStyle,
      });
    }
    closeTableModal();
    await fetchTables();
    toast.success(
      isEdit
        ? t("tables.alert.updateSuccess")
        : t("tables.alert.createSuccess"),
    );
  } catch (error) {
    console.error("Failed to save table:", error);
    // The API answers these two with a 409 and a specific code. Showing only
    // "儲存失敗" left the owner retrying forever with no idea that the seat
    // count is managed elsewhere, or that capacity cannot drop below it.
    toast.error(
      resolveUserFacingError(error, t, {
        codeKeys: {
          SEAT_COUNT_VIA_SEAT_MANAGEMENT: "qrMode.seatCountManaged",
          SEAT_COUNT_EXCEEDS_CAPACITY: "qrMode.seatCountExceedsCapacity",
        },
        fallbackKey: "tables.alert.saveFailed",
      }).message,
    );
  }
};

const downloadQRCode = () => {
  if (!selectedTable.value || !tableQrIsReady(selectedTable.value)) {
    toast.warning(t("qrReadiness.notReadyDescription"));
    return;
  }

  const dataUrl = qrModalRef.value?.getDataUrl();
  if (!dataUrl) return;
  const link = document.createElement("a");
  link.download = `QR-${selectedTable.value?.tableNumber || "table"}.png`;
  link.href = dataUrl;
  link.click();
};

const printQRCode = () => {
  if (!selectedTable.value || !tableQrIsReady(selectedTable.value)) {
    toast.warning(t("qrReadiness.notReadyDescription"));
    return;
  }

  const dataUrl = qrModalRef.value?.getDataUrl();
  if (!dataUrl) return;
  const label = t("tables.qrModal.title", {
    number: selectedTable.value?.tableNumber || "",
  });
  if (!printQRCodeSheet(label, [{ label, dataUrl }])) {
    toast.error(t("tables.alert.printFailed"));
  }
};

/**
 * Re-stickering a venue means printing many codes at once — one sheet per table
 * is not workable for a rollout (#88 phase 2).
 */
const printTableQRCodes = async (
  targets: Array<{
    tableNumber: string;
    qrCode?: string;
    pendingQrCode?: string;
  }>,
) => {
  const readyTargets = targets.filter(tableQrIsReady);
  const skippedCount = targets.length - readyTargets.length;
  if (skippedCount > 0) {
    toast.warning(t("qrReadiness.skippedNotReady", { count: skippedCount }));
  }

  if (readyTargets.length === 0) {
    toast.warning(t("tables.alert.nothingToPrint"));
    return;
  }

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    toast.error(t("tables.alert.printFailed"));
    return;
  }

  try {
    const qrCodes = await Promise.all(
      readyTargets.map(async (table) => ({
        label: t("tables.qrModal.title", { number: table.tableNumber }),
        dataUrl: await toPrintableDataUrl(printableTableQrCode(table)),
      })),
    );
    if (
      !printQRCodeSheetInWindow(
        printWindow,
        t("tables.qrModal.printAllTitle"),
        qrCodes,
      )
    ) {
      toast.error(t("tables.alert.printFailed"));
    }
  } catch (error) {
    console.error("Failed to prepare table QR codes for printing:", error);
    toast.error(t("tables.alert.printFailed"));
  }
};

const printAllTableQRCodes = async () => {
  await printTableQRCodes(tables.value);
};

const fetchTables = async () => {
  const restaurantId = authStore.restaurantId;
  if (!restaurantId) return;

  try {
    const response = await api.get("/tables", {
      restaurantId,
      limit: TABLE_FETCH_LIMIT,
    });
    if (response.data.success && response.data.data) {
      tables.value = unwrapApiList<ApiTable>(response.data.data).map(mapTable);
      tablePagination.value = response.data.pagination ?? {
        page: 1,
        limit: TABLE_FETCH_LIMIT,
        total: tables.value.length,
        totalPages: 1,
      };
      // A selected id whose table has since been deleted would print a QR that
      // no longer resolves, so drop anything the server no longer returns.
      const liveIds = new Set(tables.value.map((table) => table.id));
      selectedTableIds.value = selectedTableIds.value.filter((id) =>
        liveIds.has(id),
      );
      const editId = Number(route.query.editTable);
      if (
        editId &&
        handledRouteEditId.value !== editId &&
        !showTableModal.value
      ) {
        const tableToEdit = tables.value.find((table) => table.id === editId);
        if (tableToEdit) {
          handledRouteEditId.value = editId;
          editTable(tableToEdit);
        }
      }
    }
  } catch (error) {
    console.error("Failed to fetch tables:", error);
    toast.error(t("tables.alert.loadFailed"));
  }
};

onMounted(() => {
  fetchTables();
});
</script>
