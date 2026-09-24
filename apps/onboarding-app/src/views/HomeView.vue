<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import {
  CloudIcon,
  ShieldCheckIcon,
  RocketLaunchIcon,
  ArrowRightIcon,
} from "@heroicons/vue/24/outline";
import { useI18n } from "@/i18n";

const { t } = useI18n();

const DEMO_RESTAURANT_ID = "019469a0-0099-7000-8000-000000000099";
function resolveCustomerAppUrl(): string {
  const customerAppUrl = import.meta.env.VITE_CUSTOMER_APP_URL;
  if (customerAppUrl) {
    return customerAppUrl.replace(/\/+$/, "");
  }

  if (import.meta.env.PROD) {
    throw new Error("VITE_CUSTOMER_APP_URL is required for production builds");
  }

  return "http://localhost:3000";
}

const CUSTOMER_APP_URL = resolveCustomerAppUrl();
const demoUrl = `${CUSTOMER_APP_URL}/restaurant/${DEMO_RESTAURANT_ID}/shop/order-type`;

const features = computed(() => [
  {
    icon: CloudIcon,
    title: t("home.features.hosted.title"),
    description: t("home.features.hosted.description"),
  },
  {
    icon: ShieldCheckIcon,
    title: t("home.features.secure.title"),
    description: t("home.features.secure.description"),
  },
  {
    icon: RocketLaunchIcon,
    title: t("home.features.assisted.title"),
    description: t("home.features.assisted.description"),
  },
]);
</script>

<template>
  <div>
    <!-- Hero Section -->
    <section class="pt-16 pb-20 text-center sm:pt-20 sm:pb-24">
      <h1
        class="text-4xl font-semibold tracking-tight text-ios-text sm:text-5xl"
      >
        {{ t("home.hero.titleLine1") }}<br />
        <span class="text-primary-500">{{ t("home.hero.titleLine2") }}</span>
      </h1>
      <p
        class="mx-auto mt-5 max-w-xl text-base leading-relaxed text-gray-500 sm:text-lg"
      >
        {{ t("home.hero.subtitle") }}
      </p>

      <div class="mt-10 flex flex-col items-center gap-4">
        <RouterLink
          to="/apply"
          class="inline-flex items-center justify-center rounded-full bg-primary-500 px-8 py-3.5 text-base font-semibold text-white shadow-sm transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-primary-600 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
        >
          {{ t("home.hero.ctaApply") }}
          <ArrowRightIcon class="ml-2 h-4 w-4" />
        </RouterLink>
        <a
          :href="demoUrl"
          target="_blank"
          class="text-sm font-medium text-primary-700 transition-colors duration-200 hover:text-primary-800"
        >
          {{ t("home.hero.ctaDemo") }}
        </a>
      </div>
    </section>

    <!-- Features -->
    <section class="grid grid-cols-1 gap-5 md:grid-cols-3 md:gap-6">
      <div
        v-for="feature in features"
        :key="feature.title"
        class="group flex flex-col rounded-3xl bg-white p-8 shadow-card transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-[0_12px_32px_rgba(0,0,0,0.08)]"
      >
        <div
          class="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50"
        >
          <component
            :is="feature.icon"
            class="h-6 w-6 text-primary-500"
            aria-hidden="true"
          />
        </div>
        <h3 class="mt-5 text-lg font-semibold text-ios-text">
          {{ feature.title }}
        </h3>
        <p class="mt-2 text-sm leading-relaxed text-gray-500">
          {{ feature.description }}
        </p>
      </div>
    </section>

    <!-- Subtle CTA -->
    <section
      class="mt-16 flex flex-col items-center justify-between gap-5 rounded-3xl bg-white p-8 shadow-card sm:flex-row sm:gap-6 sm:p-10"
    >
      <div class="text-center sm:text-left">
        <h2 class="text-lg font-semibold text-ios-text sm:text-xl">
          {{ t("home.cta.title") }}
        </h2>
        <p class="mt-1 text-sm text-gray-500">
          {{ t("home.cta.subtitle") }}
        </p>
      </div>
      <RouterLink
        to="/apply"
        class="inline-flex shrink-0 items-center justify-center rounded-full bg-primary-500 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-primary-600 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
      >
        {{ t("home.cta.button") }}
        <ArrowRightIcon class="ml-2 h-4 w-4" />
      </RouterLink>
    </section>
  </div>
</template>
