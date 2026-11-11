<template>
  <div class="customer-shell min-h-screen bg-ios-bg">
    <div class="max-w-4xl mx-auto py-8 px-4">
      <h1 class="text-3xl font-bold text-gray-900 mb-8">
        {{ t("terms.title") }}
      </h1>

      <nav :aria-label="t('terms.title')" class="ui-toolbar mb-6 flex-wrap">
        <a
          href="#usage"
          class="inline-flex min-h-11 items-center rounded-full bg-white px-4 text-sm text-ios-blue shadow-card-sm"
          >{{ t("terms.usage.title") }}</a
        ><a
          href="#responsibility"
          class="inline-flex min-h-11 items-center rounded-full bg-white px-4 text-sm text-ios-blue shadow-card-sm"
          >{{ t("terms.responsibility.title") }}</a
        ><a
          href="#disclaimer"
          class="inline-flex min-h-11 items-center rounded-full bg-white px-4 text-sm text-ios-blue shadow-card-sm"
          >{{ t("terms.disclaimer.title") }}</a
        ><a
          href="#changes"
          class="inline-flex min-h-11 items-center rounded-full bg-white px-4 text-sm text-ios-blue shadow-card-sm"
          >{{ t("terms.changes.title") }}</a
        >
      </nav>
      <div class="customer-prose bg-white rounded-2xl shadow-sm p-6 space-y-6">
        <section id="usage" class="scroll-mt-24">
          <h2 class="text-xl font-semibold text-gray-900 mb-4">
            {{ t("terms.usage.title") }}
          </h2>
          <p class="text-gray-700">
            {{ t("terms.usage.description") }}
          </p>
        </section>

        <section id="responsibility" class="scroll-mt-24">
          <h2 class="text-xl font-semibold text-gray-900 mb-4">
            {{ t("terms.responsibility.title") }}
          </h2>
          <p class="text-gray-700">
            {{ t("terms.responsibility.description") }}
          </p>
        </section>

        <section id="disclaimer" class="scroll-mt-24">
          <h2 class="text-xl font-semibold text-gray-900 mb-4">
            {{ t("terms.disclaimer.title") }}
          </h2>
          <p class="text-gray-700">
            {{ t("terms.disclaimer.description") }}
          </p>
        </section>

        <section id="changes" class="scroll-mt-24">
          <h2 class="text-xl font-semibold text-gray-900 mb-4">
            {{ t("terms.changes.title") }}
          </h2>
          <p class="text-gray-700">
            {{ t("terms.changes.description") }}
          </p>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "@/composables/useI18n";

const { t } = useI18n();
</script>
