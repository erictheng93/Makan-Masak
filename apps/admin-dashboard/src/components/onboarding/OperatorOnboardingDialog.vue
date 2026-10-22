<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="operator-onboarding-title"
    data-testid="operator-onboarding-dialog"
  >
    <form
      class="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-ios-card"
      @submit.prevent="submit"
    >
      <h2
        id="operator-onboarding-title"
        class="text-lg font-semibold text-gray-900"
      >
        {{ t("platformOnboarding.create.title") }}
      </h2>
      <p class="mt-1 text-sm text-gray-600">
        {{ t("platformOnboarding.create.description") }}
      </p>

      <div class="mt-5 grid gap-4 sm:grid-cols-2">
        <label class="block text-sm font-medium text-gray-700 sm:col-span-2">
          {{ t("platformOnboarding.create.businessName") }}
          <input
            v-model.trim="form.businessName"
            data-testid="operator-business-name"
            required
            minlength="2"
            maxlength="100"
            :class="inputClass"
          />
        </label>
        <label class="block text-sm font-medium text-gray-700">
          {{ t("platformOnboarding.create.contactName") }}
          <input
            v-model.trim="form.contactName"
            data-testid="operator-contact-name"
            required
            minlength="2"
            maxlength="100"
            :class="inputClass"
          />
        </label>
        <label class="block text-sm font-medium text-gray-700">
          {{ t("platformOnboarding.create.contactEmail") }}
          <input
            v-model.trim="form.contactEmail"
            data-testid="operator-contact-email"
            type="email"
            required
            :class="inputClass"
          />
        </label>
        <label class="block text-sm font-medium text-gray-700">
          {{ t("platformOnboarding.create.contactPhone") }}
          <input
            v-model.trim="form.contactPhone"
            data-testid="operator-contact-phone"
            type="tel"
            required
            minlength="8"
            maxlength="20"
            :class="inputClass"
          />
        </label>
        <label class="block text-sm font-medium text-gray-700">
          {{ t("platformOnboarding.create.plan") }}
          <select
            v-model="form.planId"
            data-testid="operator-plan"
            :class="inputClass"
          >
            <option v-for="plan in PLANS" :key="plan" :value="plan">
              {{ planLabel(plan) }}
            </option>
          </select>
        </label>
        <label class="block text-sm font-medium text-gray-700">
          {{ t("platformOnboarding.create.country") }}
          <select
            v-model="form.countryCode"
            data-testid="operator-country"
            required
            :class="inputClass"
            @change="onCountryChange"
          >
            <option
              v-for="country in SUPPORTED_COUNTRIES"
              :key="country"
              :value="country"
            >
              {{ country }}
            </option>
          </select>
        </label>
        <label class="block text-sm font-medium text-gray-700">
          {{ t("platformOnboarding.create.city") }}
          <select
            v-model="form.city"
            data-testid="operator-city"
            required
            :class="inputClass"
            @change="form.marketId = ''"
          >
            <option v-for="city in cityOptions" :key="city" :value="city">
              {{ city }}
            </option>
          </select>
        </label>
        <label class="block text-sm font-medium text-gray-700">
          {{ t("platformOnboarding.create.emailLanguage") }}
          <select
            v-model="form.locale"
            data-testid="operator-email-language"
            :class="inputClass"
          >
            <option
              v-for="locale in ONBOARDING_LOCALES"
              :key="locale"
              :value="locale"
            >
              {{ ONBOARDING_LOCALE_NAMES[locale] }}
            </option>
          </select>
        </label>
        <label class="block text-sm font-medium text-gray-700">
          {{ t("platformOnboarding.create.district") }}
          <input
            v-model.trim="form.district"
            data-testid="operator-district"
            maxlength="100"
            :class="inputClass"
          />
        </label>
        <label class="block text-sm font-medium text-gray-700">
          {{ t("platformOnboarding.create.address") }}
          <input
            v-model.trim="form.address"
            data-testid="operator-address"
            maxlength="200"
            :class="inputClass"
          />
        </label>
        <label class="block text-sm font-medium text-gray-700">
          {{ t("platformOnboarding.create.market") }}
          <select
            v-model="form.marketId"
            data-testid="operator-market"
            :class="inputClass"
          >
            <option value="">
              {{ t("platformOnboarding.create.noMarket") }}
            </option>
            <option
              v-for="market in cityMarkets"
              :key="market.id"
              :value="market.id"
            >
              {{ market.name }}
            </option>
          </select>
        </label>
        <label class="block text-sm font-medium text-gray-700">
          {{ t("platformOnboarding.create.stall") }}
          <input
            v-model.trim="form.stallNumber"
            data-testid="operator-stall"
            maxlength="32"
            :disabled="!form.marketId"
            :class="inputClass"
          />
        </label>
        <label class="block text-sm font-medium text-gray-700">
          {{ t("platformOnboarding.create.latitude") }}
          <input
            v-model.number="form.latitude"
            data-testid="operator-latitude"
            type="number"
            step="any"
            min="-90"
            max="90"
            required
            :class="inputClass"
          />
        </label>
        <label class="block text-sm font-medium text-gray-700">
          {{ t("platformOnboarding.create.longitude") }}
          <input
            v-model.number="form.longitude"
            data-testid="operator-longitude"
            type="number"
            step="any"
            min="-180"
            max="180"
            required
            :class="inputClass"
          />
        </label>
      </div>

      <label
        class="mt-4 flex min-h-11 items-center gap-2 text-sm text-gray-700"
      >
        <input
          v-model="form.approveImmediately"
          data-testid="operator-approve-immediately"
          type="checkbox"
        />
        {{ t("platformOnboarding.create.approveImmediately") }}
      </label>

      <p
        v-if="submitError"
        role="alert"
        data-testid="operator-onboarding-error"
        class="mt-4 rounded-2xl bg-red-50 px-3 py-2 text-sm text-red-700"
      >
        {{ submitError }}
      </p>

      <div class="mt-5 flex justify-end gap-2">
        <button
          type="button"
          class="rounded-full bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
          @click="emit('close')"
        >
          {{ t("common.cancel") }}
        </button>
        <button
          type="submit"
          data-testid="submit-operator-onboarding"
          class="rounded-full bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          :disabled="isSubmitting"
        >
          {{
            isSubmitting
              ? t("platformOnboarding.create.submitting")
              : t("platformOnboarding.create.submit")
          }}
        </button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  ONBOARDING_LOCALES,
  ONBOARDING_LOCALE_NAMES,
  SUPPORTED_COUNTRIES,
  citiesForCountry,
  defaultOnboardingLocale,
  type SupportedCountryCode,
} from "@makanmasak/shared-types";
import {
  onboardingApplicationsService,
  type OperatorApplicationInput,
  type OperatorApplicationResult,
} from "@/services/onboardingApplicationsService";
import { marketsService, type MarketListItem } from "@/services/marketsService";
import { useI18n } from "@/i18n";

const emit = defineEmits<{
  close: [];
  created: [result: OperatorApplicationResult];
}>();

const { t } = useI18n();

const PLANS = ["trial", "standard", "professional", "enterprise"] as const;
const inputClass =
  "mt-1 w-full rounded-2xl bg-gray-50 px-3 py-2 text-sm font-normal focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50";

const form = ref({
  businessName: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  countryCode: "TW" as SupportedCountryCode,
  city: citiesForCountry("TW")[0] ?? "",
  locale: defaultOnboardingLocale("TW"),
  district: "",
  address: "",
  marketId: "",
  stallNumber: "",
  planId: "trial" as OperatorApplicationInput["planId"],
  latitude: null as number | null,
  longitude: null as number | null,
  approveImmediately: true,
});
const markets = ref<MarketListItem[]>([]);
const isSubmitting = ref(false);
const submitError = ref("");

const cityOptions = computed(() => citiesForCountry(form.value.countryCode));
const cityMarkets = computed(() =>
  markets.value.filter((market) => market.city === form.value.city),
);

function onCountryChange() {
  form.value.city = cityOptions.value[0] ?? "";
  form.value.locale = defaultOnboardingLocale(form.value.countryCode);
  form.value.marketId = "";
}

function planLabel(plan: (typeof PLANS)[number]) {
  return plan === "trial"
    ? t("platformOnboarding.plan.trial")
    : plan.charAt(0).toUpperCase() + plan.slice(1);
}

async function submit() {
  const { latitude, longitude, marketId, stallNumber, address, district } =
    form.value;
  if (latitude === null || longitude === null) return;
  isSubmitting.value = true;
  submitError.value = "";
  try {
    const result = await onboardingApplicationsService.createForOwner({
      businessName: form.value.businessName,
      contactName: form.value.contactName,
      contactEmail: form.value.contactEmail,
      contactPhone: form.value.contactPhone,
      countryCode: form.value.countryCode,
      city: form.value.city,
      planId: form.value.planId,
      latitude,
      longitude,
      locale: form.value.locale,
      approveImmediately: form.value.approveImmediately,
      // The server rejects empty strings for these optional fields.
      ...(address ? { address } : {}),
      ...(district ? { district } : {}),
      ...(marketId ? { marketId } : {}),
      ...(marketId && stallNumber ? { stallNumber } : {}),
    });
    emit("created", result);
  } catch (createError) {
    console.error("Failed to create onboarding application:", createError);
    const code = (
      createError as { response?: { data?: { error?: { code?: string } } } }
    )?.response?.data?.error?.code;
    submitError.value =
      code === "APPLICATION_ALREADY_PENDING"
        ? t("platformOnboarding.create.errors.duplicate")
        : t("platformOnboarding.create.errors.failed", {
            code: code ?? "UNKNOWN",
          });
  } finally {
    isSubmitting.value = false;
  }
}

onMounted(async () => {
  try {
    markets.value = await marketsService.listMarkets();
  } catch (loadError) {
    // Market is optional; the form still works without the list.
    console.error("Failed to load markets for onboarding:", loadError);
  }
});
</script>
