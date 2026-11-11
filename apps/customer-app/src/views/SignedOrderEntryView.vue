<template>
  <main
    class="customer-shell min-h-screen bg-ios-bg flex items-center justify-center px-5"
    aria-live="polite"
  >
    <section
      class="w-full max-w-md bg-ios-card rounded-3xl p-8 text-center shadow-[0_4px_16px_rgb(0,0,0,0.06)]"
    >
      <template v-if="!errorMessage">
        <div
          class="mx-auto mb-5 h-9 w-9 animate-spin rounded-full border-2 border-ios-separator border-t-ios-blue"
          aria-hidden="true"
        ></div>
        <h1 class="text-xl font-semibold text-ios-text">
          {{ t("qrScanView.processing") }}
        </h1>
      </template>

      <template v-else>
        <h1 class="text-xl font-semibold text-ios-text">
          {{ t("toast.qrValidationFailed") }}
        </h1>
        <p class="mt-3 text-ios-secondary" role="alert">
          {{ errorMessage }}
        </p>
        <button
          class="mt-6 w-full rounded-full bg-ios-blue px-6 py-3.5 font-semibold text-white transition-colors hover:bg-ios-blue/90"
          type="button"
          @click="processQrCode"
        >
          {{ t("common.retry") }}
        </button>
        <button
          type="button"
          class="mt-3 w-full rounded-full bg-ios-bg px-6 py-3 text-ios-blue"
          @click="router.push('/scan')"
        >
          {{ t("home.scanQR") }}
        </button>
      </template>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "@/composables/useI18n";
import { signedQrApi } from "@/services/signedQrApi";
import { parseQRContent, validateQRData } from "@/utils/qr-parser";

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const errorMessage = ref("");

async function processQrCode() {
  errorMessage.value = "";

  try {
    const qrCode = new URL(route.fullPath, window.location.origin).toString();
    const qrData = parseQRContent(qrCode);

    if (
      !qrData ||
      (qrData.type !== "table" && qrData.type !== "seat") ||
      !validateQRData(qrData)
    ) {
      throw new Error(t("toast.qrValidationFailed"));
    }

    const verified = await signedQrApi.verify(qrData.type, qrCode);
    localStorage.setItem(
      `makanmakan_table_qr:${verified.restaurantId}:${verified.tableId}`,
      qrCode,
    );

    await router.replace({
      name: "RestaurantMenu",
      params: {
        restaurantId: verified.restaurantId,
        tableId: verified.tableId,
      },
      // seatNumber rides along so the menu can show the label printed on the
      // sticker. The id alone is not displayable: it is a global row id, not
      // the seat's number on this table.
      ...(verified.type === "seat"
        ? {
            query: {
              seatId: String(verified.seatId),
              seatNumber: verified.seatNumber,
            },
          }
        : {}),
    });
  } catch {
    errorMessage.value = t("toast.qrProcessError");
  }
}

onMounted(processQrCode);
</script>
