<template>
  <div class="space-y-6">
    <!-- Action Bar -->
    <div class="flex justify-end mb-0">
      <button
        class="flex items-center px-5 py-2.5 rounded-full text-[13px] font-semibold bg-ios-blue text-white hover:bg-blue-600 transition-colors shadow-sm"
        @click="showCreateDialog = true"
      >
        <Plus class="w-4 h-4 mr-1.5" />
        {{ t("reservation.create") }}
      </button>
    </div>

    <!-- Filters Card -->
    <div class="card p-6">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">{{
            t("reservation.filter.date")
          }}</label>
          <input
            v-model="filters.date"
            type="date"
            class="form-input"
            @change="loadReservations()"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">{{
            t("reservation.filter.status")
          }}</label>
          <select
            v-model="filters.status"
            class="form-input"
            @change="loadReservations()"
          >
            <option value="">{{ t("reservation.filter.allStatus") }}</option>
            <option value="pending">
              {{ t("reservation.statusText.pending") }}
            </option>
            <option value="confirmed">
              {{ t("reservation.statusText.confirmed") }}
            </option>
            <option value="arrived">
              {{ t("reservation.statusText.arrived") }}
            </option>
            <option value="seated">
              {{ t("reservation.statusText.seated") }}
            </option>
            <option value="completed">
              {{ t("reservation.statusText.completed") }}
            </option>
            <option value="cancelled">
              {{ t("reservation.statusText.cancelled") }}
            </option>
            <option value="no_show">
              {{ t("reservation.statusText.no_show") }}
            </option>
          </select>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">{{
            t("reservation.customerPhone")
          }}</label>
          <input
            v-model="filters.phone"
            type="tel"
            class="form-input"
            :placeholder="t('reservation.filter.enterPhone')"
            @keyup.enter="loadReservations()"
          />
        </div>

        <div class="flex items-end space-x-2">
          <button class="btn-primary flex-1" @click="loadReservations()">
            <Search class="w-4 h-4 mr-2" />
            {{ t("common.search") }}
          </button>
          <button class="btn-secondary flex-1" @click="resetFilters">
            <RotateCcw class="w-4 h-4 mr-2" />
            {{ t("common.reset") }}
          </button>
        </div>
      </div>
    </div>

    <!-- Reservations List -->
    <div class="card">
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {{ t("reservation.confirmationCode") }}
              </th>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {{ t("reservation.customerName") }}
              </th>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {{ t("reservation.datetime") }}
              </th>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {{ t("reservation.partySize") }}
              </th>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {{ t("reservation.status") }}
              </th>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {{ t("reservation.specialRequests") }}
              </th>
              <th
                class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {{ t("common.actions") }}
              </th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            <template v-if="loading">
              <tr v-for="i in 5" :key="i" class="animate-pulse">
                <td class="px-6 py-4">
                  <div class="h-4 bg-gray-200 rounded w-20"></div>
                </td>
                <td class="px-6 py-4">
                  <div class="h-4 bg-gray-200 rounded w-32"></div>
                </td>
                <td class="px-6 py-4">
                  <div class="h-4 bg-gray-200 rounded w-40"></div>
                </td>
                <td class="px-6 py-4">
                  <div class="h-4 bg-gray-200 rounded w-12"></div>
                </td>
                <td class="px-6 py-4">
                  <div class="h-6 bg-gray-200 rounded w-16"></div>
                </td>
                <td class="px-6 py-4">
                  <div class="h-4 bg-gray-200 rounded w-24"></div>
                </td>
                <td class="px-6 py-4">
                  <div class="h-8 bg-gray-200 rounded w-32 ml-auto"></div>
                </td>
              </tr>
            </template>
            <tr v-else-if="reservations.length === 0">
              <td colspan="7" class="px-6 py-12 text-center text-gray-500">
                <Calendar class="w-12 h-12 mx-auto mb-3 text-gray-400" />
                <p>{{ t("reservation.noRecords") }}</p>
              </td>
            </tr>
            <tr
              v-for="reservation in reservations"
              :key="reservation.id"
              class="hover:bg-gray-50"
            >
              <td class="px-6 py-4 whitespace-nowrap">
                <span class="text-sm font-mono text-gray-900">{{
                  reservation.confirmationCode
                }}</span>
              </td>
              <td class="px-6 py-4">
                <div class="text-sm">
                  <div class="font-medium text-gray-900">
                    {{ reservation.customerName }}
                  </div>
                  <div class="text-gray-500">
                    {{ reservation.customerPhone }}
                  </div>
                </div>
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                {{ reservation.reservationDate }}
                {{ reservation.reservationTime }}
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                {{ reservation.partySize }} {{ t("reservation.people") }}
              </td>
              <td class="px-6 py-4 whitespace-nowrap">
                <span
                  :class="getStatusBadgeClass(reservation.status)"
                  class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full"
                >
                  {{ getStatusText(reservation.status) }}
                </span>
              </td>
              <td class="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">
                {{ reservation.specialRequests || "--" }}
              </td>
              <td
                class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2"
              >
                <button
                  class="text-blue-600 hover:text-blue-900"
                  :title="t('reservation.viewDetail')"
                  @click="viewDetail(reservation)"
                >
                  <Eye class="w-5 h-5" />
                </button>
                <button
                  v-if="reservation.status === 'pending'"
                  class="text-green-600 hover:text-green-900"
                  :title="t('reservation.confirmReservation')"
                  @click="confirmReservation(reservation.id)"
                >
                  <CheckCircle class="w-5 h-5" />
                </button>
                <button
                  v-if="reservation.status === 'confirmed'"
                  class="text-teal-600 hover:text-teal-900"
                  :title="t('reservation.markArrived')"
                  @click="markArrived(reservation.id)"
                >
                  <UserCheck class="w-5 h-5" />
                </button>
                <button
                  v-if="reservation.status === 'arrived'"
                  class="text-teal-600 hover:text-teal-900"
                  :title="t('reservation.markSeated')"
                  @click="markSeated(reservation.id)"
                >
                  <CheckCheck class="w-5 h-5" />
                </button>
                <button
                  v-if="['pending', 'confirmed'].includes(reservation.status)"
                  class="text-red-600 hover:text-red-900"
                  :title="t('reservation.cancelReservation')"
                  @click="cancelReservation(reservation.id)"
                >
                  <XCircle class="w-5 h-5" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div
        v-if="pagination.total > 0"
        class="px-6 py-4 flex items-center justify-between border-t border-gray-200"
      >
        <div class="flex-1 flex justify-between sm:hidden">
          <button
            :disabled="pagination.page === 1"
            class="btn-secondary"
            @click="
              pagination.page--;
              loadReservations();
            "
          >
            {{ t("reservation.pagination.previous") }}
          </button>
          <button
            :disabled="pagination.page * pagination.limit >= pagination.total"
            class="btn-secondary"
            @click="
              pagination.page++;
              loadReservations();
            "
          >
            {{ t("reservation.pagination.next") }}
          </button>
        </div>
        <div
          class="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between"
        >
          <div>
            <p class="text-sm text-gray-700">
              {{
                t("reservation.pagination.showing", {
                  start: (pagination.page - 1) * pagination.limit + 1,
                  end: Math.min(
                    pagination.page * pagination.limit,
                    pagination.total,
                  ),
                  total: pagination.total,
                })
              }}
            </p>
          </div>
          <div>
            <nav
              class="relative z-0 inline-flex rounded-md shadow-sm -space-x-px"
            >
              <button
                :disabled="pagination.page === 1"
                class="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                @click="
                  pagination.page--;
                  loadReservations();
                "
              >
                <ChevronLeft class="h-5 w-5" />
              </button>
              <button
                v-for="page in getPaginationPages()"
                :key="page"
                :class="[
                  page === pagination.page
                    ? 'z-10 bg-primary-50 border-primary-500 text-primary-600'
                    : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50',
                  'relative inline-flex items-center px-4 py-2 border text-sm font-medium',
                ]"
                @click="
                  pagination.page = page;
                  loadReservations();
                "
              >
                {{ page }}
              </button>
              <button
                :disabled="
                  pagination.page * pagination.limit >= pagination.total
                "
                class="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                @click="
                  pagination.page++;
                  loadReservations();
                "
              >
                <ChevronRight class="h-5 w-5" />
              </button>
            </nav>
          </div>
        </div>
      </div>
    </div>

    <!-- Create Reservation Dialog -->
    <TransitionRoot as="template" :show="showCreateDialog">
      <Dialog as="div" class="relative z-10" @close="showCreateDialog = false">
        <TransitionChild
          as="template"
          enter="ease-out duration-300"
          enter-from="opacity-0"
          enter-to="opacity-100"
          leave="ease-in duration-200"
          leave-from="opacity-100"
          leave-to="opacity-0"
        >
          <div
            class="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
          />
        </TransitionChild>

        <div class="fixed inset-0 z-10 overflow-y-auto">
          <div
            class="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0"
          >
            <TransitionChild
              as="template"
              enter="ease-out duration-300"
              enter-from="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enter-to="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leave-from="opacity-100 translate-y-0 sm:scale-100"
              leave-to="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <DialogPanel
                class="relative transform overflow-hidden rounded-lg bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg"
              >
                <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                  <DialogTitle
                    as="h3"
                    class="text-lg font-medium leading-6 text-gray-900 mb-4"
                  >
                    {{ t("reservation.create") }}
                  </DialogTitle>
                  <div class="space-y-4">
                    <div>
                      <label
                        class="block text-sm font-medium text-gray-700 mb-1"
                        >{{ t("reservation.customerNameRequired") }}</label
                      >
                      <input
                        v-model="form.customerName"
                        type="text"
                        class="form-input"
                      />
                    </div>
                    <div>
                      <label
                        class="block text-sm font-medium text-gray-700 mb-1"
                        >{{ t("reservation.customerPhoneRequired") }}</label
                      >
                      <input
                        v-model="form.customerPhone"
                        type="tel"
                        class="form-input"
                      />
                    </div>
                    <div>
                      <label
                        class="block text-sm font-medium text-gray-700 mb-1"
                        >{{ t("reservation.customerEmail") }}</label
                      >
                      <input
                        v-model="form.customerEmail"
                        type="email"
                        class="form-input"
                      />
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                      <div>
                        <label
                          class="block text-sm font-medium text-gray-700 mb-1"
                          >{{ t("reservation.reservationDate") }}</label
                        >
                        <input
                          v-model="formDate"
                          type="date"
                          class="form-input"
                        />
                      </div>
                      <div>
                        <label
                          class="block text-sm font-medium text-gray-700 mb-1"
                          >{{ t("reservation.reservationTime") }}</label
                        >
                        <input
                          v-model="formTime"
                          type="time"
                          class="form-input"
                        />
                      </div>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                      <div>
                        <label
                          class="block text-sm font-medium text-gray-700 mb-1"
                          >{{ t("reservation.partySizeRequired") }}</label
                        >
                        <input
                          v-model.number="form.partySize"
                          type="number"
                          min="1"
                          max="20"
                          class="form-input"
                        />
                      </div>
                      <div>
                        <label
                          class="block text-sm font-medium text-gray-700 mb-1"
                          >{{ t("reservation.durationLabel") }}</label
                        >
                        <input
                          v-model.number="form.durationMinutes"
                          type="number"
                          min="30"
                          max="240"
                          step="30"
                          class="form-input"
                        />
                      </div>
                    </div>
                    <div>
                      <label
                        class="block text-sm font-medium text-gray-700 mb-1"
                        >{{ t("reservation.specialRequests") }}</label
                      >
                      <textarea
                        v-model="form.specialRequests"
                        rows="3"
                        class="form-input"
                        :placeholder="
                          t('reservation.specialRequestsPlaceholder')
                        "
                      ></textarea>
                    </div>
                  </div>
                </div>
                <div
                  class="bg-gray-50 px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6"
                >
                  <button
                    :disabled="submitting"
                    class="btn-primary w-full sm:ml-3 sm:w-auto disabled:opacity-50"
                    @click="createReservation"
                  >
                    <span v-if="!submitting">{{
                      t("reservation.confirmCreate")
                    }}</span>
                    <span v-else class="flex items-center justify-center">
                      <Loader2 class="animate-spin w-4 h-4 mr-2" />
                      {{ t("reservation.creating") }}
                    </span>
                  </button>
                  <button
                    class="btn-secondary mt-3 w-full sm:mt-0 sm:w-auto"
                    @click="showCreateDialog = false"
                  >
                    {{ t("common.cancel") }}
                  </button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </TransitionRoot>

    <!-- Detail Dialog -->
    <TransitionRoot as="template" :show="showDetailDialog">
      <Dialog as="div" class="relative z-10" @close="showDetailDialog = false">
        <TransitionChild
          as="template"
          enter="ease-out duration-300"
          enter-from="opacity-0"
          enter-to="opacity-100"
          leave="ease-in duration-200"
          leave-from="opacity-100"
          leave-to="opacity-0"
        >
          <div
            class="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
          />
        </TransitionChild>

        <div class="fixed inset-0 z-10 overflow-y-auto">
          <div
            class="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0"
          >
            <TransitionChild
              as="template"
              enter="ease-out duration-300"
              enter-from="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enter-to="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leave-from="opacity-100 translate-y-0 sm:scale-100"
              leave-to="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <DialogPanel
                class="relative transform overflow-hidden rounded-lg bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-2xl"
              >
                <div class="bg-white px-4 pt-5 pb-4 sm:p-6">
                  <DialogTitle
                    as="h3"
                    class="text-lg font-medium leading-6 text-gray-900 mb-4"
                  >
                    {{ t("reservation.detail") }}
                  </DialogTitle>
                  <div v-if="selectedReservation" class="space-y-4">
                    <div class="grid grid-cols-2 gap-4">
                      <div>
                        <label class="text-sm font-medium text-gray-500">{{
                          t("reservation.confirmationCode")
                        }}</label>
                        <p class="mt-1 text-sm text-gray-900 font-mono">
                          {{ selectedReservation.confirmationCode }}
                        </p>
                      </div>
                      <div>
                        <label class="text-sm font-medium text-gray-500">{{
                          t("reservation.status")
                        }}</label>
                        <p class="mt-1">
                          <span
                            :class="
                              getStatusBadgeClass(selectedReservation.status)
                            "
                            class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full"
                          >
                            {{ getStatusText(selectedReservation.status) }}
                          </span>
                        </p>
                      </div>
                      <div>
                        <label class="text-sm font-medium text-gray-500">{{
                          t("reservation.customerName")
                        }}</label>
                        <p class="mt-1 text-sm text-gray-900">
                          {{ selectedReservation.customerName }}
                        </p>
                      </div>
                      <div>
                        <label class="text-sm font-medium text-gray-500">{{
                          t("reservation.customerPhone")
                        }}</label>
                        <p class="mt-1 text-sm text-gray-900">
                          {{ selectedReservation.customerPhone }}
                        </p>
                      </div>
                      <div class="col-span-2">
                        <label class="text-sm font-medium text-gray-500">{{
                          t("reservation.datetime")
                        }}</label>
                        <p class="mt-1 text-sm text-gray-900">
                          {{ selectedReservation.reservationDate }}
                          {{ selectedReservation.reservationTime }}
                        </p>
                      </div>
                      <div>
                        <label class="text-sm font-medium text-gray-500">{{
                          t("reservation.partySize")
                        }}</label>
                        <p class="mt-1 text-sm text-gray-900">
                          {{ selectedReservation.partySize }}
                          {{ t("reservation.people") }}
                        </p>
                      </div>
                      <div>
                        <label class="text-sm font-medium text-gray-500">{{
                          t("reservation.duration")
                        }}</label>
                        <p class="mt-1 text-sm text-gray-900">
                          {{ selectedReservation.durationMinutes }}
                          {{ t("reservation.minutes") }}
                        </p>
                      </div>
                      <div class="col-span-2">
                        <label class="text-sm font-medium text-gray-500">{{
                          t("reservation.specialRequests")
                        }}</label>
                        <p class="mt-1 text-sm text-gray-900">
                          {{ selectedReservation.specialRequests || "--" }}
                        </p>
                      </div>
                      <div class="col-span-2">
                        <label class="text-sm font-medium text-gray-500">{{
                          t("reservation.notes")
                        }}</label>
                        <p class="mt-1 text-sm text-gray-900">
                          {{ selectedReservation.notes || "--" }}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
                <div
                  class="bg-gray-50 px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6"
                >
                  <button
                    class="btn-secondary w-full sm:w-auto"
                    @click="showDetailDialog = false"
                  >
                    {{ t("common.close") }}
                  </button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </TransitionRoot>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onBeforeUnmount, onMounted, computed } from "vue";
import { createVisibilityAwarePoller } from "@/services/visibilityAwarePoller";
import { notifySeatingChanged } from "./seatingEvents";
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  TransitionChild,
  TransitionRoot,
} from "@headlessui/vue";
import {
  Plus,
  Calendar,
  Search,
  RotateCcw,
  Eye,
  CheckCircle,
  CheckCheck,
  UserCheck,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-vue-next";
import { useToast } from "vue-toastification";
import { useI18n } from "@/i18n";
import { useConfirmModal } from "@/composables/useConfirmModal";
import { useAuthStore } from "@/stores/auth";
import { ReservationService } from "@/services/reservationService";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";
import {
  ReservationStatus,
  type Reservation,
  type CreateReservationRequest,
} from "@makanmasak/shared-types";

type ReservationFilterStatus = "" | ReservationStatus;

interface ReservationFiltersState {
  date: string;
  status: ReservationFilterStatus;
  phone: string;
}

const toast = useToast();
const authStore = useAuthStore();
const { t } = useI18n();
const { confirm: confirmModal } = useConfirmModal();

// State
const loading = ref(false);
const submitting = ref(false);
const showCreateDialog = ref(false);
const showDetailDialog = ref(false);
const reservations = ref<Reservation[]>([]);
const selectedReservation = ref<Reservation | null>(null);

// Filters
const filters = reactive<ReservationFiltersState>({
  date: "",
  status: "",
  phone: "",
});

// Pagination
const pagination = reactive({
  page: 1,
  limit: 20,
  total: 0,
});

// Form
const form = reactive<Partial<CreateReservationRequest>>({
  customerName: "",
  customerPhone: "",
  customerEmail: "",
  partySize: 2,
  durationMinutes: 90,
  specialRequests: "",
});

const formDate = ref("");
const formTime = ref("");

// Restaurant ID — use authStore.restaurantId which handles admin managing other restaurants
const restaurantId = computed(() => authStore.restaurantId || "");

/**
 * Load reservations list
 */
async function loadReservations({ background = false } = {}) {
  // A background tick keeps the rows on screen and stays quiet on failure;
  // the placeholder and the toast are for loads the user asked for.
  if (!background) loading.value = true;
  try {
    const response = await ReservationService.listReservations({
      restaurantId: restaurantId.value,
      reservationDate: filters.date || undefined,
      status: filters.status || undefined,
      customerPhone: filters.phone || undefined,
      page: pagination.page,
      limit: pagination.limit,
    });

    // Extract data from API response wrapper { success, data, meta }
    const payload = response?.success ? response.data : response;
    reservations.value = Array.isArray(payload) ? payload : [];
    if (response?.meta) {
      pagination.total = response.meta.total || reservations.value.length;
    } else {
      pagination.total = reservations.value.length;
    }
    // Every create/confirm/arrive/seat/cancel ends in this reload.
    if (!background) notifySeatingChanged();
  } catch (error) {
    console.error("Load reservations error:", error);
    if (!background) toast.error(t("reservation.loadError"));
  } finally {
    if (!background) loading.value = false;
  }
}

// Customers book online while this tab is open.
const reservationsPoller = createVisibilityAwarePoller({
  intervalMs: 30_000,
  onTick: () => {
    if (loading.value || submitting.value) return;
    return loadReservations({ background: true });
  },
});

/**
 * Create reservation
 */
async function createReservation() {
  if (
    !form.customerName ||
    !form.customerPhone ||
    !formDate.value ||
    !formTime.value ||
    !form.partySize
  ) {
    toast.warning(t("common.fillRequired"));
    return;
  }

  submitting.value = true;
  try {
    const request: CreateReservationRequest = {
      restaurantId: restaurantId.value,
      customerName: form.customerName,
      customerPhone: form.customerPhone,
      customerEmail: form.customerEmail,
      partySize: form.partySize,
      reservationDate: formDate.value,
      reservationTime: formTime.value,
      durationMinutes: form.durationMinutes || 90,
      specialRequests: form.specialRequests,
    };

    await ReservationService.createReservation(request);
    toast.success(t("reservation.createSuccess"));
    showCreateDialog.value = false;
    resetForm();
    await loadReservations();
  } catch (error: unknown) {
    console.error("Create reservation error:", error);
    toast.error(
      resolveUserFacingError(error, t, {
        fallbackKey: "reservation.createError",
      }).message,
    );
  } finally {
    submitting.value = false;
  }
}

/**
 * Confirm reservation
 */
async function confirmReservation(id: string) {
  const confirmed = await confirmModal({
    type: "warning",
    title: t("reservation.confirmTitle"),
    message: t("reservation.confirmPrompt"),
    confirmLabel: t("reservation.confirmAction"),
  });
  if (!confirmed) return;

  try {
    await ReservationService.confirmReservation(id);
    toast.success(t("reservation.confirmSuccess"));
    await loadReservations();
  } catch (error: unknown) {
    console.error("Confirm reservation error:", error);
    toast.error(
      resolveUserFacingError(error, t, {
        fallbackKey: "reservation.confirmError",
      }).message,
    );
  }
}

/**
 * Mark arrived
 */
async function markArrived(id: string) {
  try {
    await ReservationService.markArrived(id);
    toast.success(t("reservation.arrivedSuccess"));
    await loadReservations();
  } catch (error: unknown) {
    console.error("Mark arrived error:", error);
    toast.error(
      resolveUserFacingError(error, t, {
        fallbackKey: "reservation.arrivedError",
      }).message,
    );
  }
}

/**
 * Mark seated
 */
async function markSeated(id: string) {
  try {
    await ReservationService.markSeated(id);
    toast.success(t("reservation.seatedSuccess"));
    await loadReservations();
  } catch (error: unknown) {
    console.error("Mark seated error:", error);
    toast.error(
      resolveUserFacingError(error, t, {
        fallbackKey: "reservation.seatedError",
      }).message,
    );
  }
}

/**
 * Cancel reservation
 */
async function cancelReservation(id: string) {
  const confirmed = await confirmModal({
    type: "danger",
    title: t("reservation.cancelTitle"),
    message: t("reservation.cancelPrompt"),
    confirmLabel: t("reservation.cancelAction"),
  });
  if (!confirmed) return;

  try {
    await ReservationService.cancelReservation(id);
    toast.success(t("reservation.cancelSuccess"));
    await loadReservations();
  } catch (error: unknown) {
    console.error("Cancel reservation error:", error);
    toast.error(
      resolveUserFacingError(error, t, {
        fallbackKey: "reservation.cancelError",
      }).message,
    );
  }
}

/**
 * View detail
 */
function viewDetail(reservation: Reservation) {
  selectedReservation.value = reservation;
  showDetailDialog.value = true;
}

/**
 * Reset filters
 */
function resetFilters() {
  filters.date = "";
  filters.status = "";
  filters.phone = "";
  pagination.page = 1;
  loadReservations();
}

/**
 * Reset form
 */
function resetForm() {
  form.customerName = "";
  form.customerPhone = "";
  form.customerEmail = "";
  form.partySize = 2;
  form.durationMinutes = 90;
  form.specialRequests = "";
  formDate.value = "";
  formTime.value = "";
}

/**
 * Get status text
 */
function getStatusText(status: string): string {
  const key = `reservation.statusText.${status}`;
  const result = t(key);
  return result === key ? status : result;
}

/**
 * Get status badge class
 */
// Seven statuses, five hues. `arrived` and `seated` were purple and indigo,
// which the palette does not have; mapping both to teal would have made two
// distinct states look identical. They are adjacent steps in the same journey,
// so they share teal and separate by depth instead -- arrived is the lighter
// tint, seated the saturated one, the same way the timer moves neutral → orange
// → red under pressure.
function getStatusBadgeClass(status: string): string {
  const classMap: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    confirmed: "bg-green-100 text-green-800",
    arrived: "bg-teal-100 text-teal-800",
    seated: "bg-teal-200 text-teal-900",
    completed: "bg-blue-100 text-blue-800",
    cancelled: "bg-red-100 text-red-800",
    no_show: "bg-gray-100 text-gray-800",
  };
  return classMap[status] || "bg-gray-100 text-gray-800";
}

/**
 * Get pagination pages
 */
function getPaginationPages(): number[] {
  const totalPages = Math.ceil(pagination.total / pagination.limit);
  const current = pagination.page;
  const pages: number[] = [];

  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) {
      pages.push(i);
    }
  } else {
    if (current <= 4) {
      for (let i = 1; i <= 5; i++) pages.push(i);
      pages.push(-1); // Separator
      pages.push(totalPages);
    } else if (current >= totalPages - 3) {
      pages.push(1);
      pages.push(-1);
      for (let i = totalPages - 4; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      pages.push(-1);
      for (let i = current - 1; i <= current + 1; i++) pages.push(i);
      pages.push(-1);
      pages.push(totalPages);
    }
  }

  return pages;
}

// Initialize
onMounted(async () => {
  reservationsPoller.start();
  await loadReservations();
});
onBeforeUnmount(() => reservationsPoller.stop());
</script>
