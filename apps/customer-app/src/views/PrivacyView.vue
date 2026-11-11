<template>
  <div class="customer-shell min-h-screen bg-ios-bg">
    <div class="max-w-4xl mx-auto py-8 px-4">
      <h1 class="text-3xl font-bold text-gray-900 mb-8">
        {{ t("privacy.title") }}
      </h1>

      <nav :aria-label="t('privacy.title')" class="ui-toolbar mb-6 flex-wrap">
        <a
          href="#dataCollection"
          class="inline-flex min-h-11 items-center rounded-full bg-white px-4 text-sm text-ios-blue shadow-card-sm"
          >{{ t("privacy.dataCollection.title") }}</a
        ><a
          href="#dataUsage"
          class="inline-flex min-h-11 items-center rounded-full bg-white px-4 text-sm text-ios-blue shadow-card-sm"
          >{{ t("privacy.dataUsage.title") }}</a
        ><a
          href="#dataProtection"
          class="inline-flex min-h-11 items-center rounded-full bg-white px-4 text-sm text-ios-blue shadow-card-sm"
          >{{ t("privacy.dataProtection.title") }}</a
        ><a
          href="#contact"
          class="inline-flex min-h-11 items-center rounded-full bg-white px-4 text-sm text-ios-blue shadow-card-sm"
          >{{ t("privacy.contact.title") }}</a
        >
      </nav>
      <div class="customer-prose bg-white rounded-2xl shadow-sm p-6 space-y-6">
        <section id="dataCollection" class="scroll-mt-24">
          <h2 class="text-xl font-semibold text-gray-900 mb-4">
            {{ t("privacy.dataCollection.title") }}
          </h2>
          <p class="text-gray-700">
            {{ t("privacy.dataCollection.description") }}
          </p>
        </section>

        <section id="dataUsage" class="scroll-mt-24">
          <h2 class="text-xl font-semibold text-gray-900 mb-4">
            {{ t("privacy.dataUsage.title") }}
          </h2>
          <p class="text-gray-700">
            {{ t("privacy.dataUsage.description") }}
          </p>
        </section>

        <section id="dataProtection" class="scroll-mt-24">
          <h2 class="text-xl font-semibold text-gray-900 mb-4">
            {{ t("privacy.dataProtection.title") }}
          </h2>
          <p class="text-gray-700">
            {{ t("privacy.dataProtection.description") }}
          </p>
        </section>

        <section id="contact" class="scroll-mt-24">
          <h2 class="text-xl font-semibold text-gray-900 mb-4">
            {{ t("privacy.contact.title") }}
          </h2>
          <p class="text-gray-700">
            {{ t("privacy.contact.description") }}
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
