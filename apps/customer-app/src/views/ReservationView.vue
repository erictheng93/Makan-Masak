<template>
  <div class="min-h-screen bg-ios-bg">
    <nav class="sticky top-0 z-10 bg-white/80 shadow-card-sm backdrop-blur-xl">
      <div class="mx-auto flex max-w-md items-center gap-3 px-4 py-3">
        <button
          type="button"
          class="flex h-11 w-11 items-center justify-center rounded-full bg-ios-bg text-ios-text transition-colors hover:bg-ios-separator"
          :aria-label="t('reservationBooking.back')"
          @click="goBack"
        >
          <svg
            class="h-6 w-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <div class="min-w-0">
          <h1 class="truncate text-lg font-semibold text-ios-text">
            {{ t("reservationBooking.title") }}
          </h1>
          <p class="truncate text-xs text-ios-secondary">
            {{ restaurant?.name || t("serviceBooking.loading") }}
          </p>
        </div>
      </div>
    </nav>

    <main class="mx-auto max-w-md px-4 py-5">
      <p
        v-if="isLoadingRestaurant"
        class="py-12 text-center text-sm text-ios-secondary"
      >
        {{ t("serviceBooking.loading") }}
      </p>
      <section
        v-else-if="loadError"
        class="rounded-2xl bg-ios-red-soft p-4 text-sm text-ios-red-deep shadow-card-sm"
      >
        {{ loadError }}
      </section>

      <template v-else-if="restaurant">
        <section
          class="rounded-2xl bg-ios-card p-4 shadow-card-sm"
          data-testid="reservation-restaurant-summary"
        >
          <h2 class="text-xl font-semibold text-ios-text">
            {{ restaurant.name }}
          </h2>
          <p v-if="restaurant.address" class="mt-1 text-sm text-ios-secondary">
            {{ restaurant.address }}
          </p>
        </section>

        <section class="mt-4 rounded-2xl bg-ios-card p-4 shadow-card-sm">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-2 block text-sm font-medium text-ios-text/70">
                {{ t("serviceBooking.bookingDate") }}
              </label>
              <input
                v-model="bookingDate"
                data-testid="reservation-date"
                :min="today"
                type="date"
                class="min-h-11 w-full rounded-xl border border-ios-separator px-3 py-2 text-sm text-ios-text focus:border-ios-blue focus:ring-2 focus:ring-ios-blue/20"
                @change="loadAvailability"
              />
            </div>
            <div>
              <label class="mb-2 block text-sm font-medium text-ios-text/70">
                {{ t("serviceBooking.partySize") }}
              </label>
              <input
                v-model.number="form.partySize"
                data-testid="reservation-party-size"
                type="number"
                min="1"
                max="20"
                class="min-h-11 w-full rounded-xl border border-ios-separator px-3 py-2 text-sm text-ios-text focus:border-ios-blue focus:ring-2 focus:ring-ios-blue/20"
                @change="loadAvailability"
              />
            </div>
          </div>
          <button
            type="button"
            data-testid="reservation-load-slots"
            class="mt-3 min-h-11 w-full rounded-full bg-ios-blue-soft px-3 py-2 text-sm font-semibold text-ios-blue-deep transition-colors hover:bg-ios-bg disabled:opacity-50"
            :disabled="isLoadingSlots"
            @click="loadAvailability"
          >
            {{ t("serviceBooking.checkSlots") }}
          </button>

          <div class="mt-4 grid grid-cols-2 gap-2">
            <button
              v-for="slot in slots"
              :key="slot.time"
              type="button"
              data-testid="reservation-slot"
              class="min-h-11 rounded-full px-3 py-2 text-sm font-medium shadow-card-sm"
              :class="
                selectedTime === slot.time
                  ? 'bg-ios-blue text-white'
                  : slot.available
                    ? 'bg-ios-bg text-ios-text'
                    : 'bg-ios-bg text-ios-tertiary'
              "
              :disabled="!slot.available"
              @click="selectedTime = slot.time"
            >
              <span>{{ slot.time }}</span>
              <span class="ml-1 text-xs">
                {{
                  slot.available
                    ? tWithParams("serviceBooking.slotRemaining", {
                        count: slot.remainingTables,
                      })
                    : t("discovery.closed")
                }}
              </span>
            </button>
          </div>
          <p
            v-if="slots.length === 0 && !isLoadingSlots"
            data-testid="reservation-empty-slots"
            class="mt-3 text-sm text-ios-secondary"
          >
            {{ t("serviceBooking.noSlots") }}
          </p>
        </section>

        <form
          class="mt-4 space-y-3 rounded-2xl bg-ios-card p-4 shadow-card-sm"
          @submit.prevent="createReservation"
        >
          <div>
            <label class="mb-2 block text-sm font-medium text-ios-text/70">
              {{ t("serviceBooking.name") }}
            </label>
            <input
              v-model="form.customerName"
              data-testid="reservation-name"
              type="text"
              required
              maxlength="100"
              class="min-h-11 w-full rounded-xl border border-ios-separator px-3 py-2 text-sm text-ios-text focus:border-ios-blue focus:ring-2 focus:ring-ios-blue/20"
            />
          </div>
          <div>
            <label class="mb-2 block text-sm font-medium text-ios-text/70">
              {{ t("serviceBooking.phone") }}
            </label>
            <input
              v-model="form.customerPhone"
              data-testid="reservation-phone"
              type="tel"
              required
              maxlength="30"
              class="min-h-11 w-full rounded-xl border border-ios-separator px-3 py-2 text-sm text-ios-text focus:border-ios-blue focus:ring-2 focus:ring-ios-blue/20"
            />
          </div>
          <div>
            <label class="mb-2 block text-sm font-medium text-ios-text/70">
              {{ t("serviceBooking.email") }}
            </label>
            <input
              v-model="form.customerEmail"
              data-testid="reservation-email"
              type="email"
              maxlength="254"
              class="min-h-11 w-full rounded-xl border border-ios-separator px-3 py-2 text-sm text-ios-text focus:border-ios-blue focus:ring-2 focus:ring-ios-blue/20"
            />
          </div>
          <div>
            <label class="mb-2 block text-sm font-medium text-ios-text/70">
              {{ t("serviceBooking.notes") }}
            </label>
            <textarea
              v-model="form.specialRequests"
              data-testid="reservation-requests"
              rows="2"
              maxlength="500"
              class="w-full rounded-xl border border-ios-separator px-3 py-2 text-sm text-ios-text focus:border-ios-blue focus:ring-2 focus:ring-ios-blue/20"
            />
          </div>
          <button
            type="submit"
            data-testid="reservation-create"
            class="min-h-11 w-full rounded-full bg-ios-blue px-4 py-3 text-sm font-semibold text-white shadow-card-sm transition-transform active:scale-[0.98] disabled:opacity-50"
            :disabled="isCreating || !selectedTime"
          >
            {{ t("serviceBooking.create") }}
          </button>
        </form>

        <section
          v-if="createdReservation"
          class="mt-4 rounded-2xl bg-ios-green-soft p-4 shadow-card-sm"
          data-testid="reservation-confirmation"
        >
          <h2 class="text-base font-semibold text-ios-green-deep">
            {{ t("serviceBooking.created") }}
          </h2>
          <p class="mt-1 text-sm text-ios-green-deep">
            {{ t("serviceBooking.confirmationCode") }}
            <span class="font-mono font-semibold">{{
              createdReservation.confirmationCode
            }}</span>
          </p>
          <p class="mt-2 text-sm text-ios-green-deep">
            {{ createdReservation.reservationDate }}
            {{ createdReservation.reservationTime }} ·
            {{ reservationStatusLabel(createdReservation.status) }}
          </p>
        </section>

        <section class="mt-4 rounded-2xl bg-ios-card p-4 shadow-card-sm">
          <h2 class="text-base font-semibold text-ios-text">
            {{ t("serviceBooking.lookupTitle") }}
          </h2>
          <div class="mt-3 flex gap-2">
            <input
              v-model="verifyCode"
              data-testid="reservation-verify-code"
              type="text"
              class="min-h-11 min-w-0 flex-1 rounded-xl border border-ios-separator px-3 py-2 text-sm text-ios-text focus:border-ios-blue focus:ring-2 focus:ring-ios-blue/20"
              :placeholder="t('serviceBooking.confirmationCodePlaceholder')"
            />
            <button
              type="button"
              data-testid="reservation-verify"
              class="min-h-11 rounded-full bg-ios-blue-soft px-3 py-2 text-sm font-semibold text-ios-blue-deep transition-colors hover:bg-ios-bg"
              @click="verifyReservation"
            >
              {{ t("serviceBooking.lookup") }}
            </button>
          </div>
          <div
            v-if="verifiedReservation"
            data-testid="reservation-verified"
            class="mt-3 rounded-xl bg-ios-bg px-3 py-2 text-sm text-ios-text/70"
          >
            {{ verifiedReservation.reservationDate }}
            {{ verifiedReservation.reservationTime }} ·
            {{ verifiedReservation.partySize }}
            {{ t("serviceBooking.partySize") }} ·
            {{ reservationStatusLabel(verifiedReservation.status) }}
            <button
              v-if="canCancel(verifiedReservation.status)"
              type="button"
              data-testid="reservation-cancel"
              class="mt-2 block min-h-11 rounded-full bg-ios-red-soft px-3 py-2 text-sm font-semibold text-ios-red-deep transition-colors hover:bg-ios-bg"
              :disabled="isCancelling"
              @click="cancelVerifiedReservation"
            >
              {{ t("serviceBooking.cancel") }}
            </button>
          </div>
        </section>

        <p v-if="errorMessage" class="mt-3 text-sm text-ios-red-deep">
          {{ errorMessage }}
        </p>
        <p v-if="successMessage" class="mt-3 text-sm text-ios-green-deep">
          {{ successMessage }}
        </p>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import type {
  ReservationResponse,
  ReservationStatus,
  Restaurant,
  TimeSlotAvailability,
} from "@makanmasak/shared-types";
import { useI18n } from "@/composables/useI18n";
import { menuApi } from "@/services/menuApi";
import { reservationsApi } from "@/services/reservationsApi";

const props = defineProps<{ restaurantId: string }>();

const router = useRouter();
const { t, tWithParams } = useI18n();
const now = new Date();
const today = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, "0"),
  String(now.getDate()).padStart(2, "0"),
].join("-");

const restaurant = ref<Restaurant | null>(null);
const slots = ref<TimeSlotAvailability[]>([]);
const createdReservation = ref<ReservationResponse | null>(null);
const verifiedReservation = ref<ReservationResponse | null>(null);
const isLoadingRestaurant = ref(true);
const isLoadingSlots = ref(false);
const isCreating = ref(false);
const isCancelling = ref(false);
const loadError = ref("");
const errorMessage = ref("");
const successMessage = ref("");
const bookingDate = ref(today);
const selectedTime = ref("");
const verifyCode = ref("");
const createIdempotencyKey = ref(crypto.randomUUID());
const lastCreatePayload = ref<string | null>(null);
const cancelIdempotencyKey = ref("");
const lastCancelPayload = ref<string | null>(null);
const form = reactive({
  customerName: "",
  customerPhone: "",
  customerEmail: "",
  partySize: 1,
  specialRequests: "",
});

onMounted(async () => {
  await loadRestaurant();
  await loadAvailability();
});

async function loadRestaurant() {
  isLoadingRestaurant.value = true;
  loadError.value = "";
  try {
    restaurant.value = await menuApi.getRestaurant(props.restaurantId);
  } catch (error) {
    console.error("Load reservation restaurant failed:", error);
    loadError.value = t("serviceBooking.loadFailed");
  } finally {
    isLoadingRestaurant.value = false;
  }
}

async function loadAvailability() {
  if (!restaurant.value || !bookingDate.value) return;
  isLoadingSlots.value = true;
  errorMessage.value = "";
  selectedTime.value = "";
  try {
    const availability = await reservationsApi.getAvailability({
      restaurantId: props.restaurantId,
      date: bookingDate.value,
      partySize: form.partySize,
    });
    slots.value = availability.slots;
    selectedTime.value = slots.value.find((slot) => slot.available)?.time ?? "";
  } catch (error) {
    console.error("Load reservation availability failed:", error);
    errorMessage.value = t("serviceBooking.slotsFailed");
  } finally {
    isLoadingSlots.value = false;
  }
}

async function createReservation() {
  if (!selectedTime.value) return;
  isCreating.value = true;
  errorMessage.value = "";
  successMessage.value = "";
  const input = {
    restaurantId: props.restaurantId,
    customerName: form.customerName.trim(),
    customerPhone: form.customerPhone.trim(),
    customerEmail: form.customerEmail.trim() || undefined,
    partySize: form.partySize,
    reservationDate: bookingDate.value,
    reservationTime: selectedTime.value,
    specialRequests: form.specialRequests.trim() || undefined,
  };
  const payload = JSON.stringify(input);
  if (lastCreatePayload.value !== payload) {
    createIdempotencyKey.value = crypto.randomUUID();
    lastCreatePayload.value = payload;
  }
  try {
    createdReservation.value = await reservationsApi.create(
      input,
      createIdempotencyKey.value,
    );
    verifyCode.value = createdReservation.value.confirmationCode;
    verifiedReservation.value = createdReservation.value;
    // Keep the same key through a failed request so a retry is safe, but do
    // not reuse a completed operation's key for a separate reservation.
    createIdempotencyKey.value = crypto.randomUUID();
    lastCreatePayload.value = null;
    successMessage.value = t("serviceBooking.createSuccess");
    await loadAvailability();
  } catch (error) {
    console.error("Create reservation failed:", error);
    errorMessage.value = t("serviceBooking.createFailed");
  } finally {
    isCreating.value = false;
  }
}

async function verifyReservation() {
  if (!verifyCode.value.trim()) return;
  errorMessage.value = "";
  successMessage.value = "";
  cancelIdempotencyKey.value = "";
  lastCancelPayload.value = null;
  try {
    verifiedReservation.value = await reservationsApi.verify(
      verifyCode.value.trim(),
    );
  } catch (error) {
    console.error("Verify reservation failed:", error);
    errorMessage.value = t("serviceBooking.lookupFailed");
  }
}

async function cancelVerifiedReservation() {
  if (!verifiedReservation.value || !verifyCode.value.trim()) return;
  isCancelling.value = true;
  errorMessage.value = "";
  successMessage.value = "";
  const input = {
    reservationId: verifiedReservation.value.id,
    confirmationCode: verifyCode.value.trim(),
  };
  const payload = JSON.stringify(input);
  if (lastCancelPayload.value !== payload) {
    cancelIdempotencyKey.value = crypto.randomUUID();
    lastCancelPayload.value = payload;
  }
  try {
    const cancelled = await reservationsApi.cancel(
      input,
      cancelIdempotencyKey.value,
    );
    verifiedReservation.value = cancelled;
    if (createdReservation.value?.id === cancelled.id) {
      createdReservation.value = cancelled;
    }
    successMessage.value = t("serviceBooking.cancelSuccess");
    await loadAvailability();
  } catch (error) {
    console.error("Cancel reservation failed:", error);
    errorMessage.value = t("serviceBooking.cancelFailed");
  } finally {
    isCancelling.value = false;
  }
}

function canCancel(status: ReservationStatus) {
  return status === "pending" || status === "confirmed";
}

function reservationStatusLabel(status: ReservationStatus) {
  const supported = [
    "pending",
    "confirmed",
    "cancelled",
    "completed",
    "no_show",
  ];
  return supported.includes(status)
    ? t(`serviceBooking.bookingStatus.${status}`)
    : status;
}

function goBack() {
  router.push({
    name: "ShopMenu",
    params: { restaurantId: props.restaurantId },
  });
}
</script>
