<template>
  <div class="customer-shell min-h-screen bg-ios-bg">
    <nav class="sticky top-0 z-10 border-b border-gray-100 bg-white shadow-sm">
      <div class="mx-auto flex max-w-md items-center gap-3 px-4 py-3">
        <button
          type="button"
          class="text-gray-500 hover:text-gray-700"
          :aria-label="t('serviceBooking.back')"
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
          <h1 class="truncate text-lg font-semibold text-gray-900">
            {{ t("serviceBooking.title") }}
          </h1>
          <p class="truncate text-xs text-gray-500">
            {{ serviceItem?.name || t("serviceBooking.loading") }}
          </p>
        </div>
      </div>
    </nav>

    <main class="mx-auto max-w-md px-4 py-5">
      <div
        v-if="isLoadingService"
        class="py-12 text-center text-sm text-gray-500"
      >
        {{ t("serviceBooking.loadingService") }}
      </div>

      <section
        v-else-if="loadError"
        class="rounded-xl border border-red-100 bg-white p-4 text-sm text-red-700"
      >
        {{ loadError }}
      </section>

      <template v-else-if="serviceItem">
        <section
          class="rounded-xl border border-gray-200 bg-white p-4"
          data-testid="service-booking-service-summary"
        >
          <p class="text-xs font-medium uppercase tracking-wide text-gray-500">
            {{ serviceTypeLabel(serviceItem.serviceType) }}
          </p>
          <h2 class="mt-1 text-xl font-semibold text-gray-900">
            {{ serviceItem.name }}
          </h2>
          <p
            v-if="serviceItem.description"
            class="mt-2 text-sm leading-6 text-gray-600"
          >
            {{ serviceItem.description }}
          </p>
          <div class="mt-3 flex flex-wrap gap-2 text-sm">
            <span class="font-semibold text-gray-900">
              {{ servicePriceLabel }}
            </span>
            <span v-if="serviceItem.durationMinutes" class="text-gray-500">
              {{
                tWithParams("serviceBooking.durationMinutes", {
                  minutes: serviceItem.durationMinutes,
                })
              }}
            </span>
          </div>
        </section>

        <section class="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <div class="flex items-end gap-3">
            <div class="flex-1">
              <label
                for="servicebooking-field-1"
                class="mb-2 block text-sm font-medium text-gray-700"
              >
                {{ t("serviceBooking.bookingDate") }}
              </label>
              <input
                id="servicebooking-field-1"
                v-model="bookingDate"
                data-testid="service-booking-date"
                type="date"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-ios-blue focus:ring-2 focus:ring-blue-500/20"
                @change="
                  messageContext = 'availability';
                  loadAvailability();
                "
              />
            </div>
            <button
              type="button"
              data-testid="service-booking-load-slots"
              class="rounded-lg border border-ios-blue px-3 py-2 text-sm font-semibold text-ios-blue disabled:opacity-50"
              :disabled="isLoadingSlots"
              @click="
                messageContext = 'availability';
                loadAvailability();
              "
            >
              {{ t("serviceBooking.checkSlots") }}
            </button>
            <div v-if="messageContext === 'availability'" class="space-y-2">
              <p
                v-if="errorMessage"
                id="booking-error"
                role="alert"
                class="mt-3 text-sm text-ios-red-deep"
              >
                {{ errorMessage }}
              </p>
              <p
                v-if="successMessage"
                role="status"
                class="mt-3 text-sm text-ios-green-deep"
              >
                {{ successMessage }}
              </p>
            </div>
          </div>

          <div class="mt-4 grid grid-cols-2 gap-2">
            <button
              v-for="slot in slots"
              :key="slot.timeSlot"
              type="button"
              data-testid="service-booking-slot"
              class="rounded-lg border px-3 py-2 text-sm font-medium"
              :class="
                selectedTime === slot.timeSlot
                  ? 'border-ios-blue bg-blue-50 text-ios-blue'
                  : slot.isAvailable
                    ? 'border-gray-200 text-gray-700'
                    : 'border-gray-100 bg-gray-50 text-gray-400'
              "
              :disabled="!slot.isAvailable"
              :aria-pressed="selectedTime === slot.timeSlot"
              @click="selectedTime = slot.timeSlot"
            >
              <span>{{ slot.timeSlot }}</span>
              <span class="ml-1 text-xs">
                {{
                  slot.remaining === null
                    ? t("serviceBooking.slotAvailable")
                    : tWithParams("serviceBooking.slotRemaining", {
                        count: slot.remaining,
                      })
                }}
              </span>
            </button>
          </div>
          <p
            v-if="slots.length === 0 && !isLoadingSlots"
            data-testid="service-booking-empty-slots"
            class="mt-3 text-sm text-gray-500"
          >
            {{ t("serviceBooking.noSlots") }}
          </p>
        </section>

        <details :open="!booking" class="mt-4">
          <summary class="font-semibold text-ios-text">
            {{ t("serviceBooking.create") }}
          </summary>
          <form
            class="mt-4 space-y-3 rounded-xl border border-gray-200 bg-white p-4"
            @submit.prevent="
              messageContext = 'create';
              createBooking();
            "
          >
            <div>
              <label
                for="servicebooking-field-2"
                class="mb-2 block text-sm font-medium text-gray-700"
              >
                {{ t("serviceBooking.name") }}
              </label>
              <input
                id="servicebooking-field-2"
                v-model="form.customerName"
                :aria-describedby="
                  errorMessage && messageContext === 'create'
                    ? 'booking-error'
                    : undefined
                "
                data-testid="service-booking-name"
                type="text"
                required
                maxlength="100"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-ios-blue focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <div>
              <label
                for="servicebooking-field-3"
                class="mb-2 block text-sm font-medium text-gray-700"
              >
                {{ t("serviceBooking.phone") }}
              </label>
              <input
                id="servicebooking-field-3"
                v-model="form.customerPhone"
                :aria-describedby="
                  errorMessage && messageContext === 'create'
                    ? 'booking-error'
                    : undefined
                "
                data-testid="service-booking-phone"
                type="tel"
                required
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-ios-blue focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <div>
              <label
                for="servicebooking-field-4"
                class="mb-2 block text-sm font-medium text-gray-700"
              >
                {{ t("serviceBooking.email") }}
              </label>
              <input
                id="servicebooking-field-4"
                v-model="form.customerEmail"
                :aria-describedby="
                  errorMessage && messageContext === 'create'
                    ? 'booking-error'
                    : undefined
                "
                data-testid="service-booking-email"
                type="email"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-ios-blue focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label
                  for="servicebooking-field-5"
                  class="mb-2 block text-sm font-medium text-gray-700"
                >
                  {{ t("serviceBooking.partySize") }}
                </label>
                <input
                  id="servicebooking-field-5"
                  v-model.number="form.partySize"
                  :aria-describedby="
                    errorMessage && messageContext === 'create'
                      ? 'booking-error'
                      : undefined
                  "
                  data-testid="service-booking-party-size"
                  type="number"
                  min="1"
                  max="100"
                  class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-ios-blue focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <div>
                <label
                  for="servicebooking-field-6"
                  class="mb-2 block text-sm font-medium text-gray-700"
                >
                  {{ t("serviceBooking.voucherCode") }}
                </label>
                <input
                  id="servicebooking-field-6"
                  v-model="form.voucherCode"
                  :aria-describedby="
                    errorMessage && messageContext === 'create'
                      ? 'booking-error'
                      : undefined
                  "
                  data-testid="service-booking-voucher"
                  type="text"
                  maxlength="64"
                  class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-ios-blue focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>
            <div>
              <label
                for="servicebooking-field-7"
                class="mb-2 block text-sm font-medium text-gray-700"
              >
                {{ t("serviceBooking.notes") }}
              </label>
              <textarea
                id="servicebooking-field-7"
                v-model="form.specialRequests"
                :aria-describedby="
                  errorMessage && messageContext === 'create'
                    ? 'booking-error'
                    : undefined
                "
                data-testid="service-booking-requests"
                rows="2"
                maxlength="500"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-ios-blue focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <button
              type="submit"
              data-testid="service-booking-create"
              class="w-full rounded-lg bg-ios-blue px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
              :disabled="isCreating || !selectedTime"
            >
              {{ t("serviceBooking.create") }}
            </button>
            <div v-if="messageContext === 'create'" class="space-y-2">
              <p
                v-if="errorMessage"
                id="booking-error"
                role="alert"
                class="mt-3 text-sm text-ios-red-deep"
              >
                {{ errorMessage }}
              </p>
              <p
                v-if="successMessage"
                role="status"
                class="mt-3 text-sm text-ios-green-deep"
              >
                {{ successMessage }}
              </p>
            </div>
          </form>
        </details>

        <section
          v-if="booking"
          class="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4"
          data-testid="service-booking-confirmation"
          tabindex="-1"
          role="status"
        >
          <h2 class="text-base font-semibold text-emerald-900">
            {{ t("serviceBooking.created") }}
          </h2>
          <p class="mt-1 text-sm text-emerald-800">
            {{ t("serviceBooking.confirmationCode") }}
            <span class="font-mono font-semibold">{{
              booking.confirmationCode
            }}</span>
          </p>
          <dl
            class="mt-3 grid gap-2 text-sm text-emerald-900"
            :class="
              booking.paymentRequirement === 'none'
                ? 'grid-cols-1'
                : 'grid-cols-2'
            "
          >
            <div v-if="booking.paymentRequirement !== 'none'">
              <dt>{{ t("serviceBooking.amountDue") }}</dt>
              <dd class="font-semibold">
                {{ formatPrice(booking.amountDueCents / 100) }}
              </dd>
            </div>
            <div>
              <dt>{{ t("serviceBooking.status") }}</dt>
              <dd class="font-semibold">
                {{ bookingStatusLabel(booking) }}
              </dd>
            </div>
            <div>
              <dt>{{ t("serviceBooking.paymentStatusLabel") }}</dt>
              <dd class="font-semibold">
                {{ paymentStatusLabel(booking) }}
              </dd>
            </div>
          </dl>
          <div v-if="canPayWithCredits" class="mt-4 space-y-2">
            <label
              for="service-booking-credit-id"
              class="block text-sm font-medium"
              >{{ t("serviceBooking.creditCardPlaceholder") }}</label
            >
            <input
              id="service-booking-credit-id"
              v-model="creditCardPublicId"
              data-testid="service-booking-credit-id"
              type="text"
              class="w-full rounded-lg border border-emerald-200 px-3 py-2 text-sm"
              :placeholder="t('serviceBooking.creditCardPlaceholder')"
            />
            <label
              for="service-booking-credit-pin"
              class="block text-sm font-medium"
              >{{ t("serviceBooking.creditPinPlaceholder") }}</label
            >
            <input
              id="service-booking-credit-pin"
              v-model="creditPin"
              data-testid="service-booking-credit-pin"
              type="password"
              class="w-full rounded-lg border border-emerald-200 px-3 py-2 text-sm"
              :placeholder="t('serviceBooking.creditPinPlaceholder')"
            />
            <button
              type="button"
              data-testid="service-booking-pay"
              class="w-full rounded-lg bg-emerald-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
              :disabled="isPaying || !creditCardPublicId.trim()"
              @click="
                messageContext = 'payment';
                payBooking();
              "
            >
              {{ t("serviceBooking.payWithCredits") }}
            </button>
            <div v-if="messageContext === 'payment'" class="space-y-2">
              <p
                v-if="errorMessage"
                id="booking-error"
                role="alert"
                class="mt-3 text-sm text-ios-red-deep"
              >
                {{ errorMessage }}
              </p>
              <p
                v-if="successMessage"
                role="status"
                class="mt-3 text-sm text-ios-green-deep"
              >
                {{ successMessage }}
              </p>
            </div>
          </div>
        </section>

        <details class="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <summary class="text-base font-semibold text-gray-900">
            {{ t("serviceBooking.lookupTitle") }}
          </summary>
          <div v-if="messageContext === 'lookup'" class="space-y-2">
            <p
              v-if="errorMessage"
              id="booking-error"
              role="alert"
              class="mt-3 text-sm text-ios-red-deep"
            >
              {{ errorMessage }}
            </p>
            <p
              v-if="successMessage"
              role="status"
              class="mt-3 text-sm text-ios-green-deep"
            >
              {{ successMessage }}
            </p>
          </div>
          <div class="mt-3 grid gap-2">
            <label
              for="service-booking-verify-code"
              class="block text-sm font-medium"
              >{{ t("serviceBooking.confirmationCode") }}</label
            >
            <input
              id="service-booking-verify-code"
              v-model="verifyCode"
              data-testid="service-booking-verify-code"
              type="text"
              class="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              :placeholder="t('serviceBooking.confirmationCodePlaceholder')"
            />
            <label
              for="service-booking-verify-contact"
              class="block text-sm font-medium"
              >{{ t("serviceBooking.contactPlaceholder") }}</label
            >
            <input
              id="service-booking-verify-contact"
              v-model="verifyContact"
              data-testid="service-booking-verify-contact"
              type="text"
              class="min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              :placeholder="t('serviceBooking.contactPlaceholder')"
            />
            <button
              type="button"
              data-testid="service-booking-verify"
              class="rounded-lg border border-ios-blue px-3 py-2 text-sm font-semibold text-ios-blue"
              @click="
                messageContext = 'lookup';
                verifyBooking();
              "
            >
              {{ t("serviceBooking.lookup") }}
            </button>
          </div>
          <div
            v-if="verifiedBooking"
            data-testid="service-booking-verified"
            class="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700"
          >
            {{ verifiedBooking.serviceNameSnapshot }} ·
            {{ verifiedBooking.bookingDate }}
            {{ verifiedBooking.bookingTime }} ·
            {{ bookingStatusLabel(verifiedBooking) }} ·
            {{ paymentStatusLabel(verifiedBooking) }}
            <button
              v-if="
                verifiedBooking.status === 'pending' ||
                verifiedBooking.status === 'confirmed'
              "
              type="button"
              data-testid="service-booking-cancel"
              class="mt-2 block rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-600"
              @click="
                messageContext = 'lookup';
                cancelVerifiedBooking();
              "
            >
              {{ t("serviceBooking.cancel") }}
            </button>
          </div>
        </details>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch, nextTick } from "vue";
import { useRouter } from "vue-router";
import type { RestaurantServiceItem } from "@makanmasak/shared-types";
import { useFeatureAvailability } from "@/composables/useFeatureAvailability";
import { restaurantContactApi } from "@/services/restaurantContactApi";
import { menuApi } from "@/services/menuApi";
import { useI18n } from "@/composables/useI18n";
import { useCurrency } from "@/composables/useCurrency";
import { useAppStore } from "@/stores/app";
import {
  serviceBookingsApi,
  type ServiceBooking,
  type ServiceBookingAvailabilitySlot,
  type ServiceBookingStatus,
} from "@/services/serviceBookingsApi";

const props = defineProps<{
  restaurantId: string;
  serviceItemId: number;
}>();

const router = useRouter();
const { t, tWithParams, hasTranslation } = useI18n();
const appStore = useAppStore();
// A booking link can be opened cold, or after browsing another restaurant, so
// the store's current restaurant is only trusted when it is this one.
const fetchedRestaurantCurrency = ref<unknown>(null);
const { formatPrice } = useCurrency(() =>
  String(appStore.currentRestaurant?.id ?? "") === props.restaurantId
    ? appStore.currentRestaurant?.settings?.currency
    : fetchedRestaurantCurrency.value,
);
const { isDisabled } = useFeatureAvailability();
const storedValueCreditsDisabled = computed(() =>
  isDisabled("storedValueCredits"),
);
const canPayWithCredits = computed(
  () =>
    !storedValueCreditsDisabled.value &&
    booking.value?.paymentRequirement !== "pay_at_venue",
);
// The diner's calendar day. toISOString() gives the UTC one, which in Taiwan
// defaulted the date picker to yesterday from midnight until 08:00.
const now = new Date();
const today = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, "0"),
  String(now.getDate()).padStart(2, "0"),
].join("-");

const serviceItem = ref<RestaurantServiceItem | null>(null);
const slots = ref<ServiceBookingAvailabilitySlot[]>([]);
const booking = ref<ServiceBooking | null>(null);
const verifiedBooking = ref<ServiceBooking | null>(null);
const isLoadingService = ref(true);
const isLoadingSlots = ref(false);
const isCreating = ref(false);
const isPaying = ref(false);
const loadError = ref("");
const messageContext = ref("availability");
const errorMessage = ref("");
const successMessage = ref("");
watch(booking, async (result) => {
  if (!result) return;
  await nextTick();
  const confirmation = document.querySelector<HTMLElement>(
    '[data-testid="service-booking-confirmation"]',
  );
  confirmation?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  confirmation?.focus();
});
const bookingDate = ref(today);
const selectedTime = ref("");
const creditCardPublicId = ref("");
const creditPin = ref("");
const verifyCode = ref("");
const verifyContact = ref("");

const form = reactive({
  customerName: "",
  customerPhone: "",
  customerEmail: "",
  partySize: 1,
  voucherCode: "",
  specialRequests: "",
});

const servicePriceLabel = computed(() => {
  if (!serviceItem.value) return "";
  if (serviceItem.value.priceLabel) return serviceItem.value.priceLabel;
  if (serviceItem.value.priceCents != null) {
    return formatPrice(serviceItem.value.priceCents / 100);
  }
  return t("serviceBooking.quoteOnSite");
});

onMounted(async () => {
  void loadRestaurantCurrency();
  await loadService();
  await loadAvailability();
});

async function loadService() {
  isLoadingService.value = true;
  loadError.value = "";
  try {
    const services = await restaurantContactApi.listServiceItems(
      props.restaurantId,
    );
    serviceItem.value =
      services.find((service) => service.id === props.serviceItemId) ?? null;
    if (!serviceItem.value) {
      loadError.value = t("serviceBooking.notFound");
    } else if (!serviceItem.value.requiresBooking) {
      loadError.value = t("serviceBooking.bookingUnavailable");
    }
  } catch (error) {
    console.error("Load service item failed:", error);
    loadError.value = t("serviceBooking.loadFailed");
  } finally {
    isLoadingService.value = false;
  }
}

// Date @change and "check slots" can both fire a load; only the latest one
// may write, or an older date's slots land over the newer ones.
let availabilityRequest = 0;

async function loadAvailability() {
  if (!serviceItem.value || !bookingDate.value) return;
  const request = ++availabilityRequest;
  isLoadingSlots.value = true;
  errorMessage.value = "";
  selectedTime.value = "";
  try {
    const loaded = await serviceBookingsApi.getAvailability({
      serviceItemId: props.serviceItemId,
      date: bookingDate.value,
    });
    if (request !== availabilityRequest) return;
    slots.value = loaded;
    // Keep a slot the diner picked while this load was in flight, if it is
    // still open; resetting it booked a time they had not chosen.
    const available = loaded.filter((slot) => slot.isAvailable);
    selectedTime.value =
      available.find((slot) => slot.timeSlot === selectedTime.value)
        ?.timeSlot ??
      available[0]?.timeSlot ??
      "";
  } catch (error) {
    if (request !== availabilityRequest) return;
    console.error("Load service booking availability failed:", error);
    errorMessage.value = t("serviceBooking.slotsFailed");
  } finally {
    if (request === availabilityRequest) isLoadingSlots.value = false;
  }
}

async function createBooking() {
  if (!serviceItem.value || !selectedTime.value) return;
  isCreating.value = true;
  errorMessage.value = "";
  successMessage.value = "";
  try {
    booking.value = await serviceBookingsApi.createBooking({
      restaurantId: props.restaurantId,
      serviceItemId: props.serviceItemId,
      customerName: form.customerName.trim(),
      customerPhone: form.customerPhone.trim(),
      customerEmail: form.customerEmail.trim() || undefined,
      bookingDate: bookingDate.value,
      bookingTime: selectedTime.value,
      partySize: form.partySize,
      specialRequests: form.specialRequests.trim() || undefined,
      voucherCode: form.voucherCode.trim() || undefined,
    });
    verifyCode.value = booking.value.confirmationCode;
    verifyContact.value =
      form.customerEmail.trim() || form.customerPhone.trim() || "";
    successMessage.value = t("serviceBooking.createSuccess");
    await loadAvailability();
  } catch (error) {
    console.error("Create service booking failed:", error);
    errorMessage.value = t("serviceBooking.createFailed");
  } finally {
    isCreating.value = false;
  }
}

async function payBooking() {
  if (
    storedValueCreditsDisabled.value ||
    booking.value?.paymentRequirement === "pay_at_venue" ||
    !booking.value
  ) {
    return;
  }
  isPaying.value = true;
  errorMessage.value = "";
  successMessage.value = "";
  try {
    booking.value = await serviceBookingsApi.payWithCredits({
      bookingId: booking.value.id,
      creditCardPublicId: creditCardPublicId.value.trim(),
      pin: creditPin.value.trim() || undefined,
    });
    verifiedBooking.value = booking.value;
    successMessage.value = t("serviceBooking.paySuccess");
  } catch (error) {
    console.error("Pay service booking failed:", error);
    errorMessage.value = t("serviceBooking.payFailed");
  } finally {
    isPaying.value = false;
  }
}

async function verifyBooking() {
  if (!verifyCode.value.trim()) return;
  errorMessage.value = "";
  successMessage.value = "";
  try {
    verifiedBooking.value = await serviceBookingsApi.verify(
      verifyCode.value.trim(),
      contactProofFromInput(),
    );
  } catch (error) {
    console.error("Verify service booking failed:", error);
    errorMessage.value = t("serviceBooking.lookupFailed");
  }
}

async function cancelVerifiedBooking() {
  if (!verifyCode.value.trim()) return;
  errorMessage.value = "";
  successMessage.value = "";
  try {
    verifiedBooking.value = await serviceBookingsApi.cancelByCode(
      verifyCode.value.trim(),
      contactProofFromInput(),
    );
    if (
      booking.value?.confirmationCode === verifiedBooking.value.confirmationCode
    ) {
      booking.value = verifiedBooking.value;
    }
    successMessage.value = t("serviceBooking.cancelSuccess");
    await loadAvailability();
  } catch (error) {
    console.error("Cancel service booking failed:", error);
    errorMessage.value = t("serviceBooking.cancelFailed");
  }
}

function goBack() {
  router.push({
    name: "ShopMenu",
    params: { restaurantId: props.restaurantId },
    query: { services: "true" },
  });
}

async function loadRestaurantCurrency() {
  if (String(appStore.currentRestaurant?.id ?? "") === props.restaurantId) {
    return;
  }
  try {
    const restaurant = await menuApi.getRestaurant(props.restaurantId);
    fetchedRestaurantCurrency.value = restaurant?.settings?.currency ?? null;
  } catch (error) {
    console.warn("Load restaurant currency failed:", error);
  }
}

function statusLabel(status: ServiceBookingStatus): string {
  return t(`serviceBooking.bookingStatus.${status}`);
}

function bookingStatusLabel(booking: ServiceBooking): string {
  if (
    (booking.status === "pending" || booking.status === "confirmed") &&
    booking.paymentStatus === "unpaid" &&
    (booking.paymentRequirement === "pay_at_venue" ||
      (storedValueCreditsDisabled.value &&
        (booking.paymentRequirement === "prepay" ||
          booking.paymentRequirement === "deposit")))
  ) {
    return tWithParams("serviceBooking.payAtCounter", {
      amount: formatPrice(booking.amountDueCents / 100),
      code: booking.confirmationCode,
    });
  }

  return statusLabel(booking.status);
}

function paymentStatusLabel(booking: ServiceBooking): string {
  if (booking.paymentRequirement === "none") {
    return t("serviceBooking.paymentStatus.not_required");
  }
  return t(`serviceBooking.paymentStatus.${booking.paymentStatus}`);
}

function contactProofFromInput() {
  const value = verifyContact.value.trim();
  if (!value) return undefined;
  return value.includes("@")
    ? { requireContact: true, customerEmail: value }
    : { requireContact: true, customerPhone: value };
}

function serviceTypeLabel(type: RestaurantServiceItem["serviceType"]): string {
  const key = `serviceBooking.serviceType.${type}`;
  return hasTranslation(key) ? t(key) : type;
}
</script>
