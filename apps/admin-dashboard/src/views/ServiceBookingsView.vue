<template>
  <div class="space-y-6" data-testid="service-bookings-view">
    <div
      class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
    >
      <div>
        <h1 class="text-2xl font-semibold text-gray-900">
          {{ t("serviceBookings.title") }}
        </h1>
        <p class="mt-1 text-sm text-gray-500">
          {{ t("serviceBookings.subtitle") }}
        </p>
      </div>
      <button
        type="button"
        data-testid="service-bookings-refresh"
        class="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        :disabled="isLoading"
        @click="loadBookings"
      >
        {{ t("common.refresh") }}
      </button>
    </div>

    <section class="rounded-lg bg-white p-5 shadow">
      <div class="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div>
          <label class="mb-2 block text-sm font-medium text-gray-700">
            {{ t("serviceBookings.filters.date") }}
          </label>
          <input
            v-model="filters.date"
            data-testid="service-bookings-date"
            type="date"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            @change="loadBookings"
          />
        </div>
        <div>
          <label class="mb-2 block text-sm font-medium text-gray-700">
            {{ t("serviceBookings.filters.status") }}
          </label>
          <select
            v-model="filters.status"
            data-testid="service-bookings-status"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            @change="loadBookings"
          >
            <option value="">
              {{ t("serviceBookings.filters.allStatuses") }}
            </option>
            <option value="pending">
              {{ t("serviceBookings.status.pendingPayment") }}
            </option>
            <option value="confirmed">
              {{ t("serviceBookings.status.confirmed") }}
            </option>
            <option value="completed">
              {{ t("serviceBookings.status.completed") }}
            </option>
            <option value="no_show">
              {{ t("serviceBookings.status.no_show") }}
            </option>
            <option value="cancelled">
              {{ t("serviceBookings.status.cancelled") }}
            </option>
          </select>
        </div>
      </div>
      <p v-if="errorMessage" class="mt-4 text-sm text-red-600">
        {{ errorMessage }}
      </p>
      <p v-if="successMessage" class="mt-4 text-sm text-green-700">
        {{ successMessage }}
      </p>
    </section>

    <section class="overflow-hidden rounded-lg bg-white shadow">
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm">
          <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th class="px-4 py-3">
                {{ t("serviceBookings.table.booking") }}
              </th>
              <th class="px-4 py-3">
                {{ t("serviceBookings.table.customer") }}
              </th>
              <th class="px-4 py-3">
                {{ t("serviceBookings.table.time") }}
              </th>
              <th class="px-4 py-3">
                {{ t("serviceBookings.table.payment") }}
              </th>
              <th class="px-4 py-3">
                {{ t("serviceBookings.table.status") }}
              </th>
              <th class="px-4 py-3 text-right">
                {{ t("serviceBookings.table.actions") }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 bg-white">
            <tr v-if="isLoading">
              <td colspan="6" class="px-4 py-8 text-center text-gray-500">
                {{ t("common.loading") }}
              </td>
            </tr>
            <tr v-else-if="bookings.length === 0">
              <td colspan="6" class="px-4 py-8 text-center text-gray-500">
                {{ t("serviceBookings.empty") }}
              </td>
            </tr>
            <tr
              v-for="booking in bookings"
              v-else
              :key="booking.id"
              data-testid="service-booking-row"
            >
              <td class="px-4 py-3 align-top">
                <div class="font-medium text-gray-900">
                  {{ booking.serviceNameSnapshot }}
                </div>
                <div class="mt-1 font-mono text-xs text-gray-500">
                  {{ booking.confirmationCode }}
                </div>
                <div
                  v-if="booking.specialRequests"
                  class="mt-1 max-w-xs text-xs text-gray-500"
                >
                  {{ booking.specialRequests }}
                </div>
              </td>
              <td class="px-4 py-3 align-top text-gray-600">
                <div class="font-medium text-gray-900">
                  {{ booking.customerName }}
                </div>
                <div>{{ booking.customerPhone }}</div>
                <div v-if="booking.customerEmail">
                  {{ booking.customerEmail }}
                </div>
                <div>
                  {{
                    t("serviceBookings.partySize", {
                      count: booking.partySize,
                    })
                  }}
                </div>
              </td>
              <td class="px-4 py-3 align-top text-gray-600">
                <div>{{ booking.bookingDate }}</div>
                <div>{{ booking.bookingTime }}</div>
              </td>
              <td class="px-4 py-3 align-top text-gray-600">
                <div>{{ formatCents(booking.amountDueCents) }}</div>
                <div class="mt-1 text-xs">
                  {{ paymentMethodLabel(booking.paymentMethod) }} ·
                  {{ paymentStatusLabel(booking.paymentStatus) }}
                </div>
              </td>
              <td class="px-4 py-3 align-top">
                <span
                  class="rounded-full px-2 py-1 text-xs font-medium"
                  :class="statusClass(booking.status)"
                >
                  {{ statusLabel(booking.status) }}
                </span>
              </td>
              <td class="px-4 py-3 align-top">
                <div class="flex flex-wrap justify-end gap-2">
                  <button
                    v-if="booking.status === 'pending'"
                    type="button"
                    :data-testid="`booking-confirm-cash-${booking.id}`"
                    class="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    :disabled="isSaving"
                    @click="runAction(() => confirmCash(booking.id))"
                  >
                    {{ t("serviceBookings.actions.confirmCash") }}
                  </button>
                  <button
                    v-if="booking.status === 'confirmed'"
                    type="button"
                    :data-testid="`booking-complete-${booking.id}`"
                    class="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                    :disabled="isSaving"
                    @click="runAction(() => completeBooking(booking.id))"
                  >
                    {{ t("serviceBookings.actions.complete") }}
                  </button>
                  <button
                    v-if="booking.status === 'confirmed'"
                    type="button"
                    :data-testid="`booking-no-show-${booking.id}`"
                    class="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                    :disabled="isSaving"
                    @click="runAction(() => markNoShow(booking.id))"
                  >
                    {{ t("serviceBookings.actions.noShow") }}
                  </button>
                  <button
                    v-if="
                      booking.status === 'pending' ||
                      booking.status === 'confirmed'
                    "
                    type="button"
                    :data-testid="`booking-cancel-${booking.id}`"
                    class="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                    :disabled="isSaving"
                    @click="runAction(() => cancelBooking(booking.id))"
                  >
                    {{ t("common.cancel") }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, watch } from "vue";
import { useI18n } from "@/i18n";
import { useAuthStore } from "@/stores/auth";
import { useCurrency } from "@/composables/useCurrency";
import {
  serviceBookingsService,
  type ServiceBooking,
  type ServiceBookingStatus,
} from "@/services/serviceBookingsService";

const authStore = useAuthStore();
const { t } = useI18n();
const { formatPrice } = useCurrency();
const today = new Date().toISOString().slice(0, 10);

const bookings = ref<ServiceBooking[]>([]);
const isLoading = ref(false);
const isSaving = ref(false);
const errorMessage = ref("");
const successMessage = ref("");

const filters = reactive<{
  date: string;
  status: "" | ServiceBookingStatus;
}>({
  date: today,
  status: "",
});

watch(
  () => authStore.restaurantId,
  () => {
    void loadBookings();
  },
);

onMounted(() => {
  void loadBookings();
});

async function loadBookings() {
  if (!authStore.restaurantId) {
    bookings.value = [];
    return;
  }
  isLoading.value = true;
  errorMessage.value = "";
  try {
    bookings.value = await serviceBookingsService.listBookings({
      restaurantId: authStore.restaurantId,
      date: filters.date || undefined,
      status: filters.status || undefined,
    });
  } catch (error) {
    console.error("Load service bookings failed:", error);
    errorMessage.value = t("serviceBookings.messages.loadFailed");
  } finally {
    isLoading.value = false;
  }
}

async function runAction(action: () => Promise<string>) {
  isSaving.value = true;
  errorMessage.value = "";
  successMessage.value = "";
  try {
    successMessage.value = await action();
    await loadBookings();
  } catch (error) {
    console.error("Service booking action failed:", error);
    errorMessage.value = t("serviceBookings.messages.updateFailed");
  } finally {
    isSaving.value = false;
  }
}

async function confirmCash(id: string): Promise<string> {
  await serviceBookingsService.confirmCash(id);
  return t("serviceBookings.messages.confirmCashSuccess");
}

async function completeBooking(id: string): Promise<string> {
  await serviceBookingsService.complete(id);
  return t("serviceBookings.messages.completeSuccess");
}

async function markNoShow(id: string): Promise<string> {
  await serviceBookingsService.markNoShow(id);
  return t("serviceBookings.messages.noShowSuccess");
}

async function cancelBooking(id: string): Promise<string> {
  await serviceBookingsService.cancel(id);
  return t("serviceBookings.messages.cancelSuccess");
}

function formatCents(cents: number): string {
  return formatPrice(cents / 100);
}

function statusLabel(status: ServiceBookingStatus): string {
  return t(`serviceBookings.status.${status}`);
}

function statusClass(status: ServiceBookingStatus): string {
  const classes: Record<ServiceBookingStatus, string> = {
    pending: "bg-blue-50 text-blue-700",
    confirmed: "bg-green-50 text-green-700",
    completed: "bg-gray-100 text-gray-700",
    cancelled: "bg-red-50 text-red-700",
    no_show: "bg-amber-50 text-amber-700",
  };
  return classes[status];
}

function paymentMethodLabel(method: ServiceBooking["paymentMethod"]): string {
  return t(`serviceBookings.paymentMethods.${method}`);
}

function paymentStatusLabel(status: ServiceBooking["paymentStatus"]): string {
  return t(`serviceBookings.paymentStatuses.${status}`);
}
</script>
