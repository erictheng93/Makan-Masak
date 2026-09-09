<template>
  <div class="fixed inset-0 z-50 overflow-y-auto">
    <div class="flex items-center justify-center min-h-screen px-4">
      <div class="fixed inset-0 bg-black opacity-30" @click="$emit('close')" />
      <div
        class="relative bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
      >
        <div class="p-6">
          <div class="flex items-center justify-between mb-6">
            <h3 class="text-lg font-semibold text-gray-900">
              {{
                isEditing
                  ? t("couponForm.editTitle")
                  : t("couponForm.createTitle")
              }}
            </h3>
            <button
              class="text-gray-400 hover:text-gray-600 transition-colors"
              @click="$emit('close')"
            >
              <XMarkIcon class="h-6 w-6" />
            </button>
          </div>

          <form @submit.prevent="handleSubmit">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <!-- 基本資訊 -->
              <div class="md:col-span-2">
                <h4 class="text-sm font-medium text-gray-900 mb-4">
                  {{ t("couponForm.basicInfo") }}
                </h4>
              </div>

              <div class="md:col-span-2">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  {{ t("couponForm.couponName") }}
                  <span class="text-red-500">*</span>
                </label>
                <input
                  v-model="form.name"
                  data-testid="coupon-name"
                  type="text"
                  required
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  :placeholder="t('couponForm.couponNamePlaceholder')"
                />
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  {{ t("couponForm.couponCode") }}
                  <span class="text-red-500">*</span>
                </label>
                <input
                  v-model="form.code"
                  data-testid="coupon-code"
                  type="text"
                  required
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  placeholder="NEWUSER10"
                  :class="{ 'bg-gray-100': isEditing }"
                  :readonly="isEditing"
                  style="text-transform: uppercase"
                  @input="form.code = form.code.toUpperCase()"
                />
                <p v-if="isEditing" class="text-xs text-gray-500 mt-1">
                  {{ t("couponForm.codeReadonly") }}
                </p>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  {{ t("couponForm.discountType") }}
                  <span class="text-red-500">*</span>
                </label>
                <select
                  v-model="form.discountType"
                  data-testid="coupon-discount-type"
                  required
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                >
                  <option value="">{{ t("couponForm.selectType") }}</option>
                  <option value="percentage">
                    {{ t("couponForm.percentageDiscount") }}
                  </option>
                  <option value="fixed">
                    {{ t("couponForm.fixedDiscount") }}
                  </option>
                </select>
              </div>

              <div class="md:col-span-2">
                <label class="block text-sm font-medium text-gray-700 mb-2">{{
                  t("couponForm.descriptionLabel")
                }}</label>
                <textarea
                  v-model="form.description"
                  rows="3"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  :placeholder="t('couponForm.descriptionPlaceholder')"
                />
              </div>

              <!-- 折扣設定 -->
              <div class="md:col-span-2">
                <h4 class="text-sm font-medium text-gray-900 mb-4 mt-6">
                  {{ t("couponForm.discountSettings") }}
                </h4>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  {{ t("couponForm.discountValue") }}
                  <span class="text-red-500">*</span>
                </label>
                <div class="relative">
                  <input
                    v-model.number="form.discountValue"
                    data-testid="coupon-discount-value"
                    type="number"
                    step="0.01"
                    min="0"
                    :max="form.discountType === 'percentage' ? 100 : undefined"
                    required
                    class="w-full px-3 py-2 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                    :placeholder="
                      form.discountType === 'percentage' ? '10' : '5.00'
                    "
                  />
                  <div class="absolute right-3 top-2 text-gray-500 text-sm">
                    {{
                      form.discountType === "percentage" ? "%" : currencySymbol
                    }}
                  </div>
                </div>
              </div>

              <div v-if="form.discountType === 'percentage'">
                <label class="block text-sm font-medium text-gray-700 mb-2">{{
                  t("couponForm.maxDiscountAmount")
                }}</label>
                <div class="relative">
                  <input
                    v-model.number="form.maxDiscountAmount"
                    data-testid="coupon-max-discount"
                    type="number"
                    step="0.01"
                    min="0"
                    class="w-full px-3 py-2 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                    placeholder="50.00"
                  />
                  <div class="absolute right-3 top-2 text-gray-500 text-sm">
                    {{ currencySymbol }}
                  </div>
                </div>
                <p class="text-xs text-gray-500 mt-1">
                  {{ t("couponForm.maxDiscountHint") }}
                </p>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">{{
                  t("couponForm.minOrderAmount")
                }}</label>
                <div class="relative">
                  <input
                    v-model.number="form.minOrderAmount"
                    data-testid="coupon-min-order"
                    type="number"
                    step="0.01"
                    min="0"
                    class="w-full px-3 py-2 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                    placeholder="0.00"
                  />
                  <div class="absolute right-3 top-2 text-gray-500 text-sm">
                    {{ currencySymbol }}
                  </div>
                </div>
                <p class="text-xs text-gray-500 mt-1">
                  {{ t("couponForm.minOrderHint") }}
                </p>
              </div>

              <!-- 使用限制 -->
              <div class="md:col-span-2">
                <h4 class="text-sm font-medium text-gray-900 mb-4 mt-6">
                  {{ t("couponForm.usageLimits") }}
                </h4>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">{{
                  t("couponForm.totalUsageLimit")
                }}</label>
                <input
                  v-model.number="form.usageLimit"
                  type="number"
                  min="1"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  :placeholder="t('couponForm.unlimitedPlaceholder')"
                />
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">{{
                  t("couponForm.perUserLimit")
                }}</label>
                <input
                  v-model.number="form.usageLimitPerUser"
                  type="number"
                  min="1"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  :placeholder="t('couponForm.unlimitedPlaceholder')"
                />
              </div>

              <!-- 有效期設定 -->
              <div class="md:col-span-2">
                <h4 class="text-sm font-medium text-gray-900 mb-4 mt-6">
                  {{ t("couponForm.validitySettings") }}
                </h4>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  {{ t("couponForm.startDate") }}
                  <span class="text-red-500">*</span>
                </label>
                <input
                  v-model="form.validFrom"
                  data-testid="coupon-valid-from"
                  type="datetime-local"
                  required
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                />
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  {{ t("couponForm.endDate") }}
                  <span class="text-red-500">*</span>
                </label>
                <input
                  v-model="form.validTo"
                  data-testid="coupon-valid-to"
                  type="datetime-local"
                  required
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                />
              </div>

              <!-- 狀態設定 -->
              <div class="md:col-span-2">
                <h4 class="text-sm font-medium text-gray-900 mb-4 mt-6">
                  {{ t("couponForm.statusSettings") }}
                </h4>
                <div class="flex items-center space-x-6">
                  <label class="flex items-center">
                    <input
                      v-model="form.isActive"
                      type="checkbox"
                      class="rounded border-gray-300 text-teal-600 focus:ring-teal-500 h-4 w-4"
                    />
                    <span class="ml-2 text-sm text-gray-700">{{
                      t("couponForm.enableCoupon")
                    }}</span>
                  </label>
                  <label class="flex items-center">
                    <input
                      v-model="form.isVisible"
                      type="checkbox"
                      class="rounded border-gray-300 text-teal-600 focus:ring-teal-500 h-4 w-4"
                    />
                    <span class="ml-2 text-sm text-gray-700">{{
                      t("couponForm.visibleToCustomers")
                    }}</span>
                  </label>
                </div>
                <p class="text-xs text-gray-500 mt-2">
                  {{ t("couponForm.statusHint") }}
                </p>
              </div>
            </div>

            <!-- 預覽區域 -->
            <div
              v-if="form.name && form.discountType && form.discountValue"
              class="mt-8 p-4 bg-teal-50 rounded-lg border border-teal-200"
            >
              <h4 class="text-sm font-medium text-gray-900 mb-2">
                {{ t("couponForm.preview") }}
              </h4>
              <div
                class="bg-white rounded-lg p-4 border border-teal-300 shadow-sm"
              >
                <div class="flex items-start justify-between">
                  <div class="flex-1">
                    <h5 class="font-semibold text-gray-900">{{ form.name }}</h5>
                    <p class="text-sm text-gray-600 font-mono mt-1">
                      {{ form.code || "COUPON_CODE" }}
                    </p>
                    <p
                      v-if="form.description"
                      class="text-xs text-gray-500 mt-2"
                    >
                      {{ form.description }}
                    </p>
                  </div>
                  <div class="text-right">
                    <div class="text-lg font-bold text-teal-600">
                      <span v-if="form.discountType === 'percentage'">
                        {{ form.discountValue }}% {{ t("couponForm.discount") }}
                        <span
                          v-if="form.maxDiscountAmount"
                          class="text-xs text-gray-500 block"
                        >
                          {{
                            t("couponForm.maxDiscount", {
                              amount: formatPrice(form.maxDiscountAmount),
                            })
                          }}
                        </span>
                      </span>
                      <span v-else
                        >{{ formatPrice(form.discountValue) }}
                        {{ t("couponForm.discount") }}</span
                      >
                    </div>
                  </div>
                </div>
                <div
                  class="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-500 space-y-1"
                >
                  <div v-if="form.minOrderAmount > 0">
                    {{ t("couponForm.minSpend") }}:
                    {{ formatPrice(form.minOrderAmount) }}
                  </div>
                  <div v-if="form.validFrom && form.validTo">
                    {{ t("couponForm.validity") }}:
                    {{ formatDisplayDate(form.validFrom) }} -
                    {{ formatDisplayDate(form.validTo) }}
                  </div>
                  <div v-if="form.usageLimitPerUser">
                    {{
                      t("couponForm.perUserLimitPreview", {
                        count: form.usageLimitPerUser,
                      })
                    }}
                  </div>
                </div>
              </div>
            </div>

            <!-- 操作按鈕 -->
            <div class="flex justify-end space-x-3 mt-8">
              <button
                type="button"
                class="px-6 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                @click="$emit('close')"
              >
                {{ t("common.cancel") }}
              </button>
              <button
                type="submit"
                data-testid="coupon-submit"
                class="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="isSubmitting || !isFormValid"
              >
                <span v-if="isSubmitting">
                  <svg
                    class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      class="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      stroke-width="4"
                    ></circle>
                    <path
                      class="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  {{ t("couponForm.processing") }}
                </span>
                <span v-else>
                  {{
                    isEditing
                      ? t("couponForm.update")
                      : t("couponForm.createBtn")
                  }}
                </span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useI18n } from "@/i18n";
import { useCurrency } from "@/composables/useCurrency";
import { useDateFormatter } from "@/composables/useDateFormatter";
import { XMarkIcon } from "@heroicons/vue/24/outline";
import type { Coupon } from "@makanmasak/shared-types";

const { t } = useI18n();
const { formatPrice, currencySymbol } = useCurrency();
const { formatDate } = useDateFormatter();

// Props
interface Props {
  coupon?: Pick<
    Coupon,
    | "id"
    | "code"
    | "name"
    | "description"
    | "discountType"
    | "discountValue"
    | "maxDiscountAmount"
    | "minOrderAmount"
    | "usageLimit"
    | "usageLimitPerUser"
    | "validFrom"
    | "validTo"
    | "isActive"
    | "isVisible"
  >;
}

const props = withDefaults(defineProps<Props>(), {
  coupon: undefined,
});

interface CouponSavePayload {
  name: string;
  code: string;
  description: string;
  discountType: "percentage" | "fixed" | "";
  discountValue: number;
  maxDiscountAmount?: number | null;
  minOrderAmount: number;
  usageLimit?: number | null;
  usageLimitPerUser?: number | null;
  validFrom: string;
  validTo: string;
  isActive: boolean;
  isVisible: boolean;
}

// Emits
const emit = defineEmits<{
  close: [];
  save: [couponData: CouponSavePayload];
}>();

// Reactive state
const isSubmitting = ref(false);
const form = ref({
  name: "",
  code: "",
  description: "",
  discountType: "" as "percentage" | "fixed" | "",
  discountValue: 0,
  maxDiscountAmount: null as number | null,
  minOrderAmount: 0,
  usageLimit: null as number | null,
  usageLimitPerUser: null as number | null,
  validFrom: "",
  validTo: "",
  isActive: true,
  isVisible: true,
});

// Computed
const isEditing = computed(() => !!props.coupon);

const isFormValid = computed(() => {
  return (
    form.value.name &&
    form.value.code &&
    form.value.discountType &&
    form.value.discountValue > 0 &&
    form.value.validFrom &&
    form.value.validTo &&
    new Date(form.value.validFrom) < new Date(form.value.validTo)
  );
});

// Methods
const formatDisplayDate = (dateString: string) => {
  if (!dateString) return "";
  return formatDate(dateString);
};

// Convert a Date to local datetime-local input format (YYYY-MM-DDTHH:mm)
const toLocalDatetimeString = (date: Date): string => {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const resetForm = () => {
  if (props.coupon) {
    // 編輯模式：填入現有資料
    form.value = {
      name: props.coupon.name,
      code: props.coupon.code,
      description: props.coupon.description || "",
      discountType: props.coupon.discountType,
      discountValue: props.coupon.discountValue,
      maxDiscountAmount: props.coupon.maxDiscountAmount ?? null,
      minOrderAmount: props.coupon.minOrderAmount || 0,
      usageLimit: props.coupon.usageLimit ?? null,
      usageLimitPerUser: props.coupon.usageLimitPerUser ?? null,
      validFrom: toLocalDatetimeString(new Date(props.coupon.validFrom)),
      validTo: toLocalDatetimeString(new Date(props.coupon.validTo)),
      isActive: props.coupon.isActive,
      isVisible: props.coupon.isVisible,
    };
  } else {
    // 新建模式：設定預設值
    const now = new Date();
    const nextMonth = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    form.value = {
      name: "",
      code: "",
      description: "",
      discountType: "",
      discountValue: 0,
      maxDiscountAmount: null,
      minOrderAmount: 0,
      usageLimit: null,
      usageLimitPerUser: null,
      validFrom: toLocalDatetimeString(now),
      validTo: toLocalDatetimeString(nextMonth),
      isActive: true,
      isVisible: true,
    };
  }
};

const handleSubmit = async () => {
  if (!isFormValid.value || isSubmitting.value) return;

  isSubmitting.value = true;
  try {
    // 準備提交資料
    const submitData = {
      ...form.value,
      validFrom: new Date(form.value.validFrom).toISOString(), // Full ISO 8601 with Z
      validTo: new Date(form.value.validTo).toISOString(),
      // Null is intentional: it clears a previously configured cap.
      maxDiscountAmount:
        typeof form.value.maxDiscountAmount === "number"
          ? form.value.maxDiscountAmount
          : null,
      usageLimit:
        typeof form.value.usageLimit === "number"
          ? form.value.usageLimit
          : null,
      usageLimitPerUser:
        typeof form.value.usageLimitPerUser === "number"
          ? form.value.usageLimitPerUser
          : null,
    };

    emit("save", submitData);
  } catch (error) {
    console.error("Submit error:", error);
  } finally {
    isSubmitting.value = false;
  }
};

// Watchers
watch(
  () => form.value.discountType,
  (newType) => {
    if (newType !== "percentage") {
      form.value.maxDiscountAmount = null;
    }
  },
);

// Initialize
onMounted(() => {
  resetForm();
});
</script>

<style scoped>
/* 客製化滾動條樣式 */
::-webkit-scrollbar {
  width: 6px;
}

::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 3px;
}

::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8;
}
</style>
