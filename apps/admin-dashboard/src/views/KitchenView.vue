<script setup lang="ts">
import ModuleGate from "@makanmasak/shared/components/ModuleGate.vue";
import { useI18n } from "@/i18n";
import { KITCHEN_DISPLAY_URL } from "@/utils/loginRedirect";
const { t } = useI18n();
</script>

<template>
  <div class="ui-page space-y-6">
    <header>
      <h1 class="ui-page-heading text-2xl font-bold text-ios-text">
        {{ t("nav.kitchen") }}
      </h1>
      <p class="text-sm text-ios-text/70">{{ t("ui.kitchenDescription") }}</p>
    </header>
    <ModuleGate module="kitchen_display">
      <section class="ui-panel bg-white p-6 space-y-4">
        <p class="text-sm text-ios-text/70">{{ t("ui.kitchenEnabled") }}</p>
        <a :href="KITCHEN_DISPLAY_URL" class="btn btn-primary">{{
          t("ui.openKitchen")
        }}</a>
      </section>
      <template #fallback>
        <section class="ui-panel bg-white p-6 space-y-4">
          <p class="text-sm text-ios-text/70">
            {{ t("ui.kitchenUnavailable") }}
          </p>
          <RouterLink to="/dashboard/billing" class="btn btn-primary">{{
            t("billing.title")
          }}</RouterLink>
        </section>
      </template>
      <template #loading>
        <div class="ui-panel h-32 bg-white p-6" role="status">
          {{ t("common.loading") }}
        </div>
      </template>
    </ModuleGate>
  </div>
</template>
