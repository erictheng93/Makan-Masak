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
import { computeDiscountCents } from "@makanmasak/utils";
import { useI18n } from "@/composables/useI18n";
import { useCurrency } from "@/composables/useCurrency";
import type { CustomerCoupon } from "@/types/coupon";

const { t } = useI18n();
const { formatPrice, currencyCode } = useCurrency();

const props = defineProps<{
  coupons: CustomerCoupon[];
  orderAmount: number;
}>();

defineEmits<{
  "select-coupon": [coupon: CustomerCoupon];
}>();

const toCents = (amount: number | null | undefined): number | null =>
  amount == null || !Number.isFinite(Number(amount))
    ? null
    : Math.round(Number(amount) * 100);

// Same rule as the server (computeDiscountCents): worked in cents, rounded to
// the restaurant currency's precision, then capped. Working in major units
// here used to show RM2.00 for 10% of RM23.50 while the server gave RM2.35.
const computeSaving = (coupon: CustomerCoupon): number => {
  const isPercentage = coupon.discountType === "percentage";
  const savingCents = computeDiscountCents(
    {
      discountType: coupon.discountType,
      percent: isPercentage ? Number(coupon.discountValue) : null,
      fixedCents: isPercentage ? null : toCents(coupon.discountValue),
      maxDiscountCents: toCents(coupon.maxDiscountAmount),
    },
    toCents(props.orderAmount) ?? 0,
    currencyCode.value,
  );
  return savingCents / 100;
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
