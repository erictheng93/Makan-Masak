<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useTenantsStore } from "@/stores/tenants";
import { XMarkIcon } from "@heroicons/vue/24/outline";
import {
  ONBOARDING_LOCALES,
  ONBOARDING_LOCALE_NAMES,
  citiesForCountry,
  defaultOnboardingLocale,
  type SupportedCountryCode,
} from "@makanmasak/shared-types";
import type {
  LicenseTier,
  OperatorOnboardingRequest,
  OperatorOnboardingResult,
} from "@/types";
import { useI18n } from "@/i18n";

const { t } = useI18n();

const props = defineProps<{
  show: boolean;
}>();

const emit = defineEmits<{
  close: [];
  success: [];
}>();

const tenantsStore = useTenantsStore();

const emptyForm = () => ({
  businessName: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  countryCode: "TW" as SupportedCountryCode,
  city: "",
  locale: defaultOnboardingLocale("TW"),
  district: "",
  address: "",
  latitude: null as number | null,
  longitude: null as number | null,
  licenseTier: "standard" as LicenseTier,
  approveImmediately: true,
});

// 表單資料
const form = ref(emptyForm());

// 表單錯誤
const errors = ref<Record<string, string>>({});
const submitting = ref(false);
const submitError = ref("");
const result = ref<OperatorOnboardingResult | null>(null);
const copied = ref(false);

const countryOptions: SupportedCountryCode[] = ["TW", "MY"];
const cityOptions = computed(() => citiesForCountry(form.value.countryCode));

watch(
  () => form.value.countryCode,
  () => {
    form.value.city = "";
    form.value.locale = defaultOnboardingLocale(form.value.countryCode);
  },
);

// 方案選項（licenseTier 與入駐申請的 planId 同名）
const planOptions = computed(() =>
  (["standard", "professional", "enterprise"] as const).map((value) => ({
    value,
    label: t(`tenants.createModal.plan.${value}.label`),
    description: t(`tenants.createModal.plan.${value}.description`),
  })),
);

// 重置表單
watch(
  () => props.show,
  (newVal) => {
    if (newVal) {
      form.value = emptyForm();
      errors.value = {};
      submitError.value = "";
      result.value = null;
      copied.value = false;
    }
  },
);

const inRange = (value: number | null, limit: number) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  Math.abs(value) <= limit;

// 驗證表單
const validate = (): boolean => {
  errors.value = {};
  const f = form.value;

  if (!f.businessName.trim()) {
    errors.value.businessName = t(
      "tenants.createModal.validation.businessNameRequired",
    );
  }
  if (!f.contactName.trim()) {
    errors.value.contactName = t(
      "tenants.createModal.validation.contactNameRequired",
    );
  }
  if (!f.contactEmail.trim()) {
    errors.value.contactEmail = t(
      "tenants.createModal.validation.emailRequired",
    );
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.contactEmail)) {
    errors.value.contactEmail = t(
      "tenants.createModal.validation.emailInvalid",
    );
  }
  if (!f.contactPhone.trim()) {
    errors.value.contactPhone = t(
      "tenants.createModal.validation.phoneRequired",
    );
  }
  if (!f.city) {
    errors.value.city = t("tenants.createModal.validation.cityRequired");
  }
  if (!inRange(f.latitude, 90) || !inRange(f.longitude, 180)) {
    errors.value.coordinates = t(
      "tenants.createModal.validation.coordinatesInvalid",
    );
  }

  return Object.keys(errors.value).length === 0;
};

const apiErrorMessage = (e: unknown): string | undefined => {
  const apiError = (
    e as { response?: { data?: { error?: { message?: string } | string } } }
  )?.response?.data?.error;
  return typeof apiError === "string" ? apiError : apiError?.message;
};

// 提交表單
const handleSubmit = async () => {
  if (!validate()) return;

  const f = form.value;
  const request: OperatorOnboardingRequest = {
    businessName: f.businessName.trim(),
    contactName: f.contactName.trim(),
    contactEmail: f.contactEmail.trim(),
    contactPhone: f.contactPhone.trim(),
    countryCode: f.countryCode,
    city: f.city,
    district: f.district.trim() || undefined,
    address: f.address.trim() || undefined,
    latitude: f.latitude!,
    longitude: f.longitude!,
    planId: f.licenseTier,
    locale: f.locale,
    approveImmediately: f.approveImmediately,
  };

  submitting.value = true;
  submitError.value = "";
  try {
    result.value = await tenantsStore.createTenant(request);
  } catch (e) {
    console.error("創建租戶失敗:", e);
    submitError.value =
      apiErrorMessage(e) ??
      (e instanceof Error
        ? e.message
        : t("tenants.createModal.error.createFailed"));
  } finally {
    submitting.value = false;
  }
};

const resultTitle = computed(() => {
  if (result.value?.approval)
    return t("tenants.createModal.result.approvedTitle");
  if (result.value?.approvalError) {
    return t("tenants.createModal.result.approvalFailedTitle");
  }
  return t("tenants.createModal.result.filedTitle");
});

const deliveryText = computed(() => {
  const delivery = result.value?.approval?.credentialDelivery;
  if (!delivery) return "";
  const key = {
    sent: "deliverySent",
    pending: "deliveryPending",
    failed: "deliveryFailed",
  }[delivery.status];
  return t(`tenants.createModal.result.${key}`, {
    email: delivery.recipientEmail,
  });
});

const copySetupLink = async () => {
  const link = result.value?.approval?.ownerAccount?.setupPasswordLink;
  if (!link) return;
  await navigator.clipboard.writeText(link);
  copied.value = true;
};

// 只有真的建出租戶才算「創建成功」；未送出或只送出申請時單純關閉
const finish = () => {
  if (result.value?.approval) emit("success");
  else emit("close");
};
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="fixed inset-0 z-50 overflow-y-auto">
      <!-- 背景遮罩 -->
      <div
        class="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
        @click="finish"
      />

      <!-- Modal -->
      <div
        class="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0"
      >
        <div
          data-testid="management-tenant-create-modal"
          class="relative transform overflow-hidden rounded-lg bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg"
        >
          <!-- 標題 -->
          <div
            class="flex items-center justify-between px-6 py-4 border-b border-gray-200"
          >
            <h3 class="text-lg font-semibold text-gray-900">
              {{ t("tenants.create") }}
            </h3>
            <button
              type="button"
              class="text-gray-400 hover:text-gray-500"
              @click="finish"
            >
              <XMarkIcon class="h-6 w-6" />
            </button>
          </div>

          <!-- 結果 -->
          <div
            v-if="result"
            data-testid="management-tenant-create-result"
            :data-status="
              result.approval
                ? 'approved'
                : result.approvalError
                  ? 'approval-failed'
                  : 'filed'
            "
            class="px-6 py-4 space-y-4"
          >
            <h4 class="text-base font-semibold text-gray-900">
              {{ resultTitle }}
            </h4>
            <div
              v-if="result.approvalError"
              data-testid="management-tenant-approval-error"
              class="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700"
            >
              {{ result.approvalError.message }}
              <span class="block text-xs text-red-500">
                {{ result.approvalError.code }}
              </span>
            </div>
            <template v-if="result.approval?.ownerAccount">
              <div>
                <p class="label">
                  {{ t("tenants.createModal.result.username") }}
                </p>
                <p class="text-sm text-gray-900">
                  {{ result.approval.ownerAccount.username }}
                </p>
              </div>
              <div>
                <p class="label">
                  {{ t("tenants.createModal.result.setupLink") }}
                </p>
                <div class="flex items-center gap-2">
                  <input
                    data-testid="management-tenant-setup-link"
                    type="text"
                    readonly
                    class="input"
                    :value="result.approval.ownerAccount.setupPasswordLink"
                  />
                  <button
                    type="button"
                    class="btn btn-secondary btn-sm whitespace-nowrap"
                    @click="copySetupLink"
                  >
                    {{
                      copied
                        ? t("tenants.createModal.result.copied")
                        : t("tenants.createModal.result.copy")
                    }}
                  </button>
                </div>
                <p class="mt-1 text-xs text-gray-500">
                  {{ t("tenants.createModal.result.setupLinkExpires") }}:
                  {{
                    new Date(
                      result.approval.ownerAccount.setupPasswordExpiresAt,
                    ).toLocaleString()
                  }}
                </p>
              </div>
            </template>
            <div v-if="deliveryText">
              <p class="label">
                {{ t("tenants.createModal.result.delivery") }}
              </p>
              <p
                data-testid="management-tenant-credential-delivery"
                :data-status="result.approval?.credentialDelivery?.status"
                class="text-sm"
                :class="
                  result.approval?.credentialDelivery?.status === 'failed'
                    ? 'text-red-600'
                    : 'text-gray-700'
                "
              >
                {{ deliveryText }}
              </p>
            </div>
          </div>

          <!-- 表單 -->
          <form
            v-else
            @submit.prevent="handleSubmit"
            class="px-6 py-4 space-y-4"
          >
            <!-- 商家名稱 -->
            <div>
              <label class="label">
                {{ t("tenants.createModal.field.businessName") }} *
              </label>
              <input
                v-model="form.businessName"
                data-testid="management-tenant-business-name"
                type="text"
                class="input"
                :class="{ 'input-error': errors.businessName }"
                :placeholder="
                  t('tenants.createModal.field.businessNamePlaceholder')
                "
              />
              <p v-if="errors.businessName" class="mt-1 text-sm text-red-600">
                {{ errors.businessName }}
              </p>
            </div>

            <!-- 聯絡人 -->
            <div>
              <label class="label">
                {{ t("tenants.createModal.field.contactName") }} *
              </label>
              <input
                v-model="form.contactName"
                data-testid="management-tenant-contact-name"
                type="text"
                class="input"
                :class="{ 'input-error': errors.contactName }"
                :placeholder="
                  t('tenants.createModal.field.contactNamePlaceholder')
                "
              />
              <p v-if="errors.contactName" class="mt-1 text-sm text-red-600">
                {{ errors.contactName }}
              </p>
            </div>

            <!-- 聯絡 Email -->
            <div>
              <label class="label">
                {{ t("tenants.createModal.field.contactEmail") }} *
              </label>
              <input
                v-model="form.contactEmail"
                data-testid="management-tenant-contact-email"
                type="email"
                class="input"
                :class="{ 'input-error': errors.contactEmail }"
                :placeholder="
                  t('tenants.createModal.field.contactEmailPlaceholder')
                "
              />
              <p v-if="errors.contactEmail" class="mt-1 text-sm text-red-600">
                {{ errors.contactEmail }}
              </p>
            </div>

            <!-- 聯絡電話 -->
            <div>
              <label class="label">
                {{ t("tenants.createModal.field.contactPhone") }} *
              </label>
              <input
                v-model="form.contactPhone"
                data-testid="management-tenant-contact-phone"
                type="tel"
                class="input"
                :class="{ 'input-error': errors.contactPhone }"
                :placeholder="
                  t('tenants.createModal.field.contactPhonePlaceholder')
                "
              />
              <p v-if="errors.contactPhone" class="mt-1 text-sm text-red-600">
                {{ errors.contactPhone }}
              </p>
            </div>

            <!-- 國家 / 城市 -->
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="label">
                  {{ t("tenants.createModal.field.country") }} *
                </label>
                <select
                  v-model="form.countryCode"
                  data-testid="management-tenant-country"
                  class="input"
                >
                  <option
                    v-for="code in countryOptions"
                    :key="code"
                    :value="code"
                  >
                    {{ t(`tenants.createModal.country.${code}`) }}
                  </option>
                </select>
              </div>
              <div>
                <label class="label">
                  {{ t("tenants.createModal.field.city") }} *
                </label>
                <select
                  v-model="form.city"
                  data-testid="management-tenant-city"
                  class="input"
                  :class="{ 'input-error': errors.city }"
                >
                  <option value="" disabled>
                    {{ t("tenants.createModal.field.cityPlaceholder") }}
                  </option>
                  <option v-for="city in cityOptions" :key="city" :value="city">
                    {{ city }}
                  </option>
                </select>
                <p v-if="errors.city" class="mt-1 text-sm text-red-600">
                  {{ errors.city }}
                </p>
              </div>
            </div>

            <div>
              <label class="label" for="management-tenant-email-language">
                {{ t("tenants.createModal.field.emailLanguage") }}
              </label>
              <select
                id="management-tenant-email-language"
                v-model="form.locale"
                data-testid="management-tenant-email-language"
                class="input"
              >
                <option
                  v-for="locale in ONBOARDING_LOCALES"
                  :key="locale"
                  :value="locale"
                >
                  {{ ONBOARDING_LOCALE_NAMES[locale] }}
                </option>
              </select>
            </div>

            <!-- 區域 / 地址 -->
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="label">
                  {{ t("tenants.createModal.field.district") }}
                </label>
                <input
                  v-model="form.district"
                  data-testid="management-tenant-district"
                  type="text"
                  class="input"
                />
              </div>
              <div>
                <label class="label">
                  {{ t("tenants.createModal.field.address") }}
                </label>
                <input
                  v-model="form.address"
                  data-testid="management-tenant-address"
                  type="text"
                  class="input"
                />
              </div>
            </div>

            <!-- 座標 -->
            <div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="label">
                    {{ t("tenants.createModal.field.latitude") }} *
                  </label>
                  <input
                    v-model.number="form.latitude"
                    data-testid="management-tenant-latitude"
                    type="number"
                    step="any"
                    class="input"
                    :class="{ 'input-error': errors.coordinates }"
                  />
                </div>
                <div>
                  <label class="label">
                    {{ t("tenants.createModal.field.longitude") }} *
                  </label>
                  <input
                    v-model.number="form.longitude"
                    data-testid="management-tenant-longitude"
                    type="number"
                    step="any"
                    class="input"
                    :class="{ 'input-error': errors.coordinates }"
                  />
                </div>
              </div>
              <p v-if="errors.coordinates" class="mt-1 text-sm text-red-600">
                {{ errors.coordinates }}
              </p>
              <p v-else class="mt-1 text-xs text-gray-500">
                {{ t("tenants.createModal.field.coordinatesHint") }}
              </p>
            </div>

            <!-- 方案選擇 -->
            <div>
              <label class="label">
                {{ t("tenants.createModal.field.selectPlan") }}
              </label>
              <div class="space-y-2">
                <label
                  v-for="plan in planOptions"
                  :key="plan.value"
                  class="flex items-start p-3 border rounded-lg cursor-pointer transition-colors"
                  :class="{
                    'border-primary-500 bg-primary-50':
                      form.licenseTier === plan.value,
                    'border-gray-200 hover:border-gray-300':
                      form.licenseTier !== plan.value,
                  }"
                >
                  <input
                    v-model="form.licenseTier"
                    :data-testid="`management-tenant-license-${plan.value}`"
                    type="radio"
                    :value="plan.value"
                    class="mt-1 h-4 w-4 text-primary-600 focus:ring-primary-500"
                  />
                  <div class="ml-3">
                    <div class="text-sm font-medium text-gray-900">
                      {{ plan.label }}
                    </div>
                    <div class="text-xs text-gray-500">
                      {{ plan.description }}
                    </div>
                  </div>
                </label>
              </div>
            </div>

            <!-- 立即核准 -->
            <label class="flex items-start gap-3 cursor-pointer">
              <input
                v-model="form.approveImmediately"
                data-testid="management-tenant-approve-immediately"
                type="checkbox"
                class="mt-1 h-4 w-4 rounded text-primary-600 focus:ring-primary-500"
              />
              <span>
                <span class="block text-sm font-medium text-gray-900">
                  {{ t("tenants.createModal.field.approveImmediately") }}
                </span>
                <span class="block text-xs text-gray-500">
                  {{ t("tenants.createModal.field.approveImmediatelyHint") }}
                </span>
              </span>
            </label>
          </form>

          <!-- 錯誤提示 -->
          <div
            v-if="submitError"
            class="mx-6 mb-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700"
          >
            {{ submitError }}
          </div>

          <!-- 操作按鈕 -->
          <div
            class="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50"
          >
            <button
              v-if="result"
              type="button"
              data-testid="management-tenant-create-done"
              class="btn btn-primary"
              @click="finish"
            >
              {{ t("tenants.createModal.result.done") }}
            </button>
            <template v-else>
              <button
                type="button"
                data-testid="management-tenant-create-cancel"
                class="btn btn-secondary"
                @click="emit('close')"
              >
                {{ t("common.cancel") }}
              </button>
              <button
                type="button"
                data-testid="management-tenant-create-submit"
                class="btn btn-primary"
                :disabled="submitting"
                @click="handleSubmit"
              >
                <span v-if="submitting" class="loading-spinner mr-2" />
                {{
                  submitting
                    ? t("tenants.createModal.creating")
                    : t("tenants.createModal.submit")
                }}
              </button>
            </template>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
