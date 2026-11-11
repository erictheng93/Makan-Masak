<template>
  <div class="customer-shell min-h-screen bg-ios-bg">
    <div class="max-w-4xl mx-auto py-8 px-4">
      <h1 class="text-3xl font-bold text-gray-900 mb-8">
        {{ t("about.title") }}
      </h1>

      <div class="bg-white rounded-2xl shadow-card-sm p-6 space-y-6">
        <section>
          <h2 class="text-xl font-semibold text-gray-900 mb-4">MakanMasak</h2>
          <p class="text-gray-700 leading-relaxed">
            {{ t("about.description") }}
          </p>
        </section>

        <section>
          <h2 class="text-xl font-semibold text-gray-900 mb-4">
            {{ t("about.features.title") }}
          </h2>
          <ul class="list-disc list-inside text-gray-700 space-y-2">
            <li>{{ t("about.features.qrOrder") }}</li>
            <li>{{ t("about.features.tracking") }}</li>
            <li>{{ t("about.features.payment") }}</li>
            <li>{{ t("about.features.customization") }}</li>
            <li>{{ t("about.features.management") }}</li>
          </ul>
        </section>

        <section>
          <h2 class="text-xl font-semibold text-gray-900 mb-4">
            {{ t("about.contact.title") }}
          </h2>
          <p class="text-gray-700">
            {{ t("about.contact.description") }}
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
