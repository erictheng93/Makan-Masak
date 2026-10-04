<template>
  <div class="min-h-screen bg-ios-bg text-ios-text">
    <main class="max-w-md mx-auto px-4 py-8 space-y-5">
      <section class="bg-white rounded-2xl shadow-card p-6 animate-slide-up">
        <div class="flex items-center gap-3 mb-6">
          <button
            class="w-10 h-10 rounded-full bg-ios-bg flex items-center justify-center text-ios-text active:scale-95 transition-transform duration-150"
            type="button"
            @click="router.back()"
          >
            <ArrowLeftIcon class="w-5 h-5" />
          </button>
          <div>
            <h1 class="text-2xl font-semibold text-ios-text">
              {{ t("waitingList.history.title") }}
            </h1>
            <p class="text-sm text-ios-secondary">
              {{ t("waitingList.history.subtitle") }}
            </p>
          </div>
        </div>

        <form class="space-y-4" @submit.prevent="loadHistory">
          <label class="block">
            <span class="text-sm font-medium text-ios-text">{{
              t("waitingList.form.phone")
            }}</span>
            <input
              v-model.trim="customerPhone"
              data-testid="history-phone-input"
              class="mt-2 w-full rounded-2xl border-0 bg-ios-bg px-4 py-3 text-ios-text placeholder:text-ios-tertiary focus:ring-2 focus:ring-ios-blue transition-shadow duration-200 ease-out"
              inputmode="tel"
              autocomplete="tel"
              :placeholder="t('waitingList.form.phonePlaceholder')"
              required
            />
          </label>

          <p
            v-if="message"
            data-testid="history-message"
            class="text-sm text-ios-red"
          >
            {{ message }}
          </p>

          <button
            data-testid="load-history-button"
            class="w-full rounded-full bg-ios-blue px-5 py-3.5 font-semibold text-white active:scale-[0.98] transition-transform duration-200 ease-out disabled:opacity-60"
            type="submit"
            :disabled="isLoading"
          >
            {{
              isLoading
                ? t("waitingList.history.loading")
                : t("waitingList.history.submit")
            }}
          </button>
        </form>
      </section>

      <section
        v-if="history.length > 0"
        class="bg-white rounded-2xl shadow-card overflow-hidden animate-slide-up"
      >
        <div
          v-for="ticket in history"
          :key="ticket.id"
          class="px-5 py-4 border-b border-ios-bg last:border-b-0"
        >
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-xl font-semibold text-ios-text">
                {{ ticket.queueDisplay }}
              </p>
              <p class="mt-1 text-sm text-ios-secondary">
                {{
                  tWithParams("waitingList.history.partySummary", {
                    size: ticket.partySize,
                  })
                }}
              </p>
            </div>
            <span
              class="rounded-full px-2.5 py-1 text-xs font-semibold"
              :class="statusClass(ticket.status)"
            >
              {{ t(`waitingList.status.${ticket.status}`) }}
            </span>
          </div>

          <div class="mt-3 flex items-center justify-between text-sm">
            <span class="text-ios-secondary">{{ formatDate(ticket) }}</span>
            <button
              v-if="!isTerminalWaitingStatus(ticket.status)"
              class="font-semibold text-ios-blue"
              type="button"
              @click="openTicket(ticket.id)"
            >
              {{ t("waitingList.history.openTicket") }}
            </button>
          </div>
        </div>
      </section>

      <section
        v-else-if="hasSearched && !isLoading"
        class="bg-white rounded-2xl shadow-card p-8 text-center animate-slide-up"
      >
        <ClockIcon class="mx-auto h-10 w-10 text-ios-tertiary" />
        <p class="mt-4 font-semibold text-ios-text">
          {{ t("waitingList.history.empty") }}
        </p>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { hasCustomerAccessToken } from "@/services/customerAccessToken";
import { ref } from "vue";
import { useRouter } from "vue-router";
import { ArrowLeftIcon, ClockIcon } from "@heroicons/vue/24/outline";
import { useI18n } from "@/composables/useI18n";
import { isTerminalWaitingStatus } from "@/composables/useWaitingTicket";
import { waitingListApi } from "@/services/waitingListApi";
import {
  WaitingStatus,
  type WaitingListResponse,
} from "@makanmasak/shared-types";

const props = defineProps<{
  restaurantId: string;
}>();

const router = useRouter();
const { t, tWithParams, currentLanguage } = useI18n();

const customerPhone = ref("");
const history = ref<WaitingListResponse[]>([]);
const message = ref("");
const isLoading = ref(false);
const hasSearched = ref(false);

const normalizedPhone = () => customerPhone.value.replace(/[-\s]/g, "");

const loadHistory = async () => {
  const phone = normalizedPhone();
  if (!/^09\d{8}$/.test(phone)) {
    message.value = t("waitingList.errors.invalidPhone");
    return;
  }

  if (!hasCustomerAccessToken()) {
    void router.push({
      path: "/login",
      query: {
        redirect: `/r/${props.restaurantId}/wait-list/history`,
        phone,
        mode: "otp",
      },
    });
    return;
  }
  isLoading.value = true;
  hasSearched.value = true;
  message.value = "";

  try {
    history.value = await waitingListApi.history(props.restaurantId, phone);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      error.status === 403
    ) {
      void router.push({
        path: "/login",
        query: {
          redirect: `/r/${props.restaurantId}/wait-list/history`,
          phone,
          mode: "otp",
        },
      });
    }
    history.value = [];
    message.value = t("waitingList.history.loadFailed");
  } finally {
    isLoading.value = false;
  }
};

const openTicket = (ticketId: string) => {
  void router.push(`/r/${props.restaurantId}/wait-list/${ticketId}`);
};

const formatDate = (ticket: WaitingListResponse) =>
  new Date(ticket.createdAt).toLocaleString(currentLanguage.value, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const statusClass = (status: WaitingStatus) => {
  if (status === WaitingStatus.SEATED) {
    return "bg-ios-green/10 text-ios-green";
  }
  if (status === WaitingStatus.CANCELLED || status === WaitingStatus.EXPIRED) {
    return "bg-ios-red/10 text-ios-red";
  }
  if (status === WaitingStatus.CALLED || status === WaitingStatus.CONFIRMED) {
    return "bg-ios-blue/10 text-ios-blue";
  }
  return "bg-ios-bg text-ios-secondary";
};
</script>
