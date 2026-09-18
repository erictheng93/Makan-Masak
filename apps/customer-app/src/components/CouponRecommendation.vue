<template>
  <div
    v-if="recommendedCoupons.length > 0"
    class="bg-ios-blue/10 rounded-2xl p-4"
  >
    <div class="flex items-center space-x-2 mb-3">
      <svg
        class="w-5 h-5 text-ios-blue"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <h4 class="text-sm font-semibold text-ios-blue">
        {{ t("cart.recommendedForYou") }}
      </h4>
    </div>

    <div class="space-y-2">
      <div
        v-for="coupon in recommendedCoupons"
        :key="coupon.id"
        class="bg-white rounded-lg p-3 active:shadow-card-sm transition-shadow cursor-pointer"
        @click="$emit('select-coupon', coupon)"
      >
        <div class="flex justify-between items-center">
          <div class="flex-1">
            <div class="flex items-center space-x-2">
              <span class="font-medium text-ios-text">{{ coupon.name }}</span>
              <span
                class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-ios-blue/15 text-ios-blue"
              >
                {{ formatDiscount(coupon) }}
              </span>
            </div>
            <p class="text-xs text-ios-secondary mt-1">
              {{ coupon.description }}
            </p>
            <div class="text-xs text-ios-blue mt-1">
              {{ t("cart.potentialSaving") }}:
              {{ calculatePotentialSaving(coupon) }}
            </div>
          </div>
          <button class="text-ios-blue text-sm font-medium">
            {{ t("cart.use") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "@/composables/useI18n";
import { useCurrency } from "@/composables/useCurrency";
import type { CustomerCoupon } from "@/types/coupon";

const { t } = useI18n();
const { formatPrice } = useCurrency();

const props = defineProps<{
  coupons: CustomerCoupon[];
  orderAmount: number;
}>();

defineEmits<{
  "select-coupon": [coupon: CustomerCoupon];
}>();

const computeSaving = (coupon: CustomerCoupon): number => {
  let saving = 0;
  if (coupon.discountType === "percentage") {
    saving = Math.round(props.orderAmount * (coupon.discountValue / 100));
    if (coupon.maxDiscountAmount && saving > coupon.maxDiscountAmount) {
      saving = coupon.maxDiscountAmount;
    }
  } else {
    saving = Number(coupon.discountValue);
  }
  return Math.min(saving, props.orderAmount);
};

const recommendedCoupons = computed(() => {
  return props.coupons
    .map((coupon) => ({ coupon, saving: computeSaving(coupon) }))
    .filter(({ coupon, saving }) => {
      const meetsMinOrder =
        !coupon.minOrderAmount || props.orderAmount >= coupon.minOrderAmount;
      return meetsMinOrder && saving > 0;
    })
    .sort((a, b) => b.saving - a.saving)
    .slice(0, 2)
    .map(({ coupon }) => coupon);
});

const formatDiscount = (coupon: CustomerCoupon) => {
  if (coupon.discountType === "percentage") {
    return `${coupon.discountValue}% ${t("common.off")}`;
  } else {
    return `${formatPrice(coupon.discountValue)} ${t("common.off")}`;
  }
};

const calculatePotentialSaving = (coupon: CustomerCoupon): string => {
  return formatPrice(computeSaving(coupon));
};
</script>
