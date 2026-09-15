<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useToast } from "vue-toastification";
import { useOnboardingStore } from "@/stores/onboarding";
import { ArrowPathIcon, MapPinIcon } from "@heroicons/vue/24/outline";
import { useI18n } from "@/i18n";

const { t } = useI18n();
const router = useRouter();
const toast = useToast();
const store = useOnboardingStore();

const form = ref({
  businessName: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  address: "",
  district: "",
  city: "",
  latitude: null as number | null,
  longitude: null as number | null,
  // Self-service shops start on the trial; the page offers no plan choice, and
  // the platform moves a shop onto a paid tier after it has been activated.
  planId: "trial" as const,
});

const errors = ref<Record<string, string>>({});
const isLocating = ref(false);

const parseCoordinate = (value: number | string | null): number | null => {
  if (value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const validate = (): boolean => {
  errors.value = {};

  if (!form.value.businessName.trim()) {
    errors.value.businessName = t("apply.validation.businessNameRequired");
  }

  if (!form.value.contactName.trim()) {
    errors.value.contactName = t("apply.validation.contactNameRequired");
  }

  if (!form.value.contactEmail.trim()) {
    errors.value.contactEmail = t("apply.validation.emailRequired");
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.value.contactEmail)) {
    errors.value.contactEmail = t("apply.validation.emailInvalid");
  }

  if (!form.value.contactPhone.trim()) {
    errors.value.contactPhone = t("apply.validation.phoneRequired");
  }

  if (form.value.address.trim().length < 3) {
    errors.value.address = t("apply.validation.addressRequired");
  }

  if (!form.value.district.trim()) {
    errors.value.district = t("apply.validation.districtRequired");
  }

  if (!form.value.city.trim()) {
    errors.value.city = t("apply.validation.cityRequired");
  }

  const latitude = parseCoordinate(form.value.latitude);
  const longitude = parseCoordinate(form.value.longitude);

  if (latitude === null) {
    errors.value.latitude = t("apply.validation.latitudeRequired");
  } else if (latitude < -90 || latitude > 90) {
    errors.value.latitude = t("apply.validation.latitudeInvalid");
  }

  if (longitude === null) {
    errors.value.longitude = t("apply.validation.longitudeRequired");
  } else if (longitude < -180 || longitude > 180) {
    errors.value.longitude = t("apply.validation.longitudeInvalid");
  }

  return Object.keys(errors.value).length === 0;
};

const handleSubmit = async () => {
  if (!validate()) return;

  store.clearError();
  const latitude = parseCoordinate(form.value.latitude);
  const longitude = parseCoordinate(form.value.longitude);

  if (latitude === null || longitude === null) return;

  const success = await store.submitApplication({
    businessName: form.value.businessName,
    contactName: form.value.contactName,
    contactEmail: form.value.contactEmail,
    contactPhone: form.value.contactPhone,
    address: form.value.address,
    district: form.value.district,
    city: form.value.city,
    latitude,
    longitude,
    planId: form.value.planId,
  });

  if (success) {
    toast.success(t("apply.toast.submitSuccess"));
    router.push({
      path: "/success",
      hash: `#${encodeURIComponent(store.applicationSecret!)}`,
    });
  } else {
    toast.error(store.apiError || t("apply.toast.submitFailureFallback"));
  }
};

const useCurrentLocation = () => {
  if (!navigator.geolocation) {
    toast.error(t("apply.form.location.unsupported"));
    return;
  }

  isLocating.value = true;
  navigator.geolocation.getCurrentPosition(
    (position) => {
      form.value.latitude = Number(position.coords.latitude.toFixed(6));
      form.value.longitude = Number(position.coords.longitude.toFixed(6));
      errors.value.latitude = "";
      errors.value.longitude = "";
      isLocating.value = false;
    },
    () => {
      toast.error(t("apply.form.location.failure"));
      isLocating.value = false;
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
  );
};
</script>

<template>
  <div class="max-w-2xl mx-auto">
    <!-- Progress -->
    <div class="flex items-center justify-center mb-8">
      <div class="flex items-center">
        <div
          class="w-8 h-8 rounded-full bg-primary-600 text-white flex items-center justify-center font-medium"
        >
          1
        </div>
        <div class="w-24 h-1 bg-gray-200">
          <div class="w-0 h-full bg-primary-600" />
        </div>
        <div
          class="w-8 h-8 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center font-medium"
        >
          2
        </div>
      </div>
    </div>

    <div class="card">
      <h1 class="text-2xl font-bold text-gray-900 mb-6">
        {{ t("apply.title") }}
      </h1>

      <!-- API Error Alert -->
      <div
        v-if="store.apiError"
        class="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg"
      >
        <p class="text-sm text-red-700">{{ store.apiError }}</p>
      </div>

      <form @submit.prevent="handleSubmit" class="space-y-6">
        <!-- 餐廳名稱 -->
        <div>
          <label class="label"
            >{{ t("apply.form.businessName.label") }} *</label
          >
          <input
            v-model="form.businessName"
            data-testid="onboarding-business-name"
            type="text"
            class="input"
            :class="{ 'input-error': errors.businessName }"
            :placeholder="t('apply.form.businessName.placeholder')"
          />
          <p v-if="errors.businessName" class="mt-1 text-sm text-red-600">
            {{ errors.businessName }}
          </p>
        </div>

        <!-- 聯絡人姓名 -->
        <div>
          <label class="label">{{ t("apply.form.contactName.label") }} *</label>
          <input
            v-model="form.contactName"
            data-testid="onboarding-contact-name"
            type="text"
            class="input"
            :class="{ 'input-error': errors.contactName }"
            :placeholder="t('apply.form.contactName.placeholder')"
          />
          <p v-if="errors.contactName" class="mt-1 text-sm text-red-600">
            {{ errors.contactName }}
          </p>
        </div>

        <!-- Email -->
        <div>
          <label class="label"
            >{{ t("apply.form.contactEmail.label") }} *</label
          >
          <input
            v-model="form.contactEmail"
            data-testid="onboarding-contact-email"
            type="email"
            class="input"
            :class="{ 'input-error': errors.contactEmail }"
            :placeholder="t('apply.form.contactEmail.placeholder')"
          />
          <p v-if="errors.contactEmail" class="mt-1 text-sm text-red-600">
            {{ errors.contactEmail }}
          </p>
        </div>

        <!-- 電話 -->
        <div>
          <label class="label"
            >{{ t("apply.form.contactPhone.label") }} *</label
          >
          <input
            v-model="form.contactPhone"
            data-testid="onboarding-contact-phone"
            type="tel"
            class="input"
            :class="{ 'input-error': errors.contactPhone }"
            :placeholder="t('apply.form.contactPhone.placeholder')"
          />
          <p v-if="errors.contactPhone" class="mt-1 text-sm text-red-600">
            {{ errors.contactPhone }}
          </p>
        </div>

        <!-- 餐廳位置 -->
        <div class="space-y-3">
          <div
            class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
          >
            <div>
              <label class="label"
                >{{ t("apply.form.location.label") }} *</label
              >
              <p class="mt-1 text-sm text-gray-500">
                {{ t("apply.form.location.help") }}
              </p>
            </div>
            <button
              type="button"
              class="btn btn-secondary shrink-0"
              :disabled="isLocating"
              @click="useCurrentLocation"
            >
              <ArrowPathIcon
                v-if="isLocating"
                class="h-4 w-4 mr-2 animate-spin"
              />
              <MapPinIcon v-else class="h-4 w-4 mr-2" />
              {{
                isLocating
                  ? t("apply.form.location.locating")
                  : t("apply.form.location.useCurrent")
              }}
            </button>
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <input
                v-model.number="form.latitude"
                data-testid="onboarding-latitude"
                type="number"
                step="0.000001"
                min="-90"
                max="90"
                class="input"
                :class="{ 'input-error': errors.latitude }"
                :placeholder="t('apply.form.location.latitudePlaceholder')"
              />
              <p v-if="errors.latitude" class="mt-1 text-sm text-red-600">
                {{ errors.latitude }}
              </p>
            </div>
            <div>
              <input
                v-model.number="form.longitude"
                data-testid="onboarding-longitude"
                type="number"
                step="0.000001"
                min="-180"
                max="180"
                class="input"
                :class="{ 'input-error': errors.longitude }"
                :placeholder="t('apply.form.location.longitudePlaceholder')"
              />
              <p v-if="errors.longitude" class="mt-1 text-sm text-red-600">
                {{ errors.longitude }}
              </p>
            </div>
          </div>
        </div>

        <!-- 店家地址 -->
        <div>
          <label for="onboarding-address" class="label"
            >{{ t("apply.form.address.label") }} *</label
          >
          <input
            id="onboarding-address"
            v-model="form.address"
            data-testid="onboarding-address"
            type="text"
            autocomplete="street-address"
            maxlength="200"
            class="input"
            :class="{ 'input-error': errors.address }"
            :placeholder="t('apply.form.address.placeholder')"
          />
          <p v-if="errors.address" class="mt-1 text-sm text-red-600">
            {{ errors.address }}
          </p>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label for="onboarding-district" class="label"
              >{{ t("apply.form.district.label") }} *</label
            >
            <input
              id="onboarding-district"
              v-model="form.district"
              data-testid="onboarding-district"
              type="text"
              autocomplete="address-level2"
              maxlength="100"
              class="input"
              :class="{ 'input-error': errors.district }"
              :placeholder="t('apply.form.district.placeholder')"
            />
            <p v-if="errors.district" class="mt-1 text-sm text-red-600">
              {{ errors.district }}
            </p>
          </div>
          <div>
            <label for="onboarding-city" class="label"
              >{{ t("apply.form.city.label") }} *</label
            >
            <input
              id="onboarding-city"
              v-model="form.city"
              data-testid="onboarding-city"
              type="text"
              autocomplete="address-level1"
              maxlength="100"
              class="input"
              :class="{ 'input-error': errors.city }"
              :placeholder="t('apply.form.city.placeholder')"
            />
            <p v-if="errors.city" class="mt-1 text-sm text-red-600">
              {{ errors.city }}
            </p>
          </div>
        </div>

        <!-- 提交按鈕 -->
        <div class="flex justify-between pt-4">
          <button
            type="button"
            class="btn btn-secondary"
            @click="router.push('/')"
          >
            {{ t("common.back") }}
          </button>
          <button
            type="submit"
            data-testid="onboarding-submit"
            class="btn btn-primary"
            :disabled="store.isLoading"
          >
            <ArrowPathIcon
              v-if="store.isLoading"
              class="h-4 w-4 mr-2 animate-spin"
            />
            {{
              store.isLoading
                ? t("apply.form.submitting")
                : t("apply.form.next")
            }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
