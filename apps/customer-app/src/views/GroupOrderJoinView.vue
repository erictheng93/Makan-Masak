<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { apiClient } from "@/services/api";
import { useGroupOrder } from "@/composables/useGroupOrder";
import { useI18n } from "@/composables/useI18n";
import {
  getGroupOrderErrorI18nKey,
  isGroupOrderNotFound,
} from "@/utils/group-order-error";

interface GroupOrderJoinPreview {
  groupOrderId: string;
  restaurantId: string;
  hostName: string;
  memberCount: number;
  fulfillmentType: "dine_in" | "delivery" | "pickup";
  expiresAt: string;
  status: string;
}

const props = defineProps<{
  shareCode: string;
}>();

const router = useRouter();
const { t, tWithParams, currentLanguage } = useI18n();
const preview = ref<GroupOrderJoinPreview | null>(null);
const isLoading = ref(true);
const isNotFound = ref(false);
const previewError = ref("");
const isJoining = ref(false);
const joinError = ref("");
const showJoinForm = ref(false);
const memberName = ref("");

const groupOrder = useGroupOrder({ restaurantId: "" });

const fulfillmentLabel = computed(() => {
  switch (preview.value?.fulfillmentType) {
    case "delivery":
      return t("groupJoin.fulfillmentDelivery");
    case "pickup":
      return t("groupJoin.fulfillmentPickup");
    case "dine_in":
    default:
      return t("groupJoin.fulfillmentDineIn");
  }
});

const expiresAtLabel = computed(() => {
  if (!preview.value?.expiresAt) return "";
  return new Intl.DateTimeFormat(currentLanguage.value, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(preview.value.expiresAt));
});

async function loadPreview(): Promise<void> {
  isLoading.value = true;
  isNotFound.value = false;
  previewError.value = "";

  try {
    preview.value = await apiClient.get<GroupOrderJoinPreview>(
      `/orders/group/join/${props.shareCode}`,
    );
  } catch (error) {
    preview.value = null;
    if (isGroupOrderNotFound(error)) {
      isNotFound.value = true;
    } else {
      previewError.value = t(
        getGroupOrderErrorI18nKey(error, "groupJoin.loadFailed"),
      );
    }
  } finally {
    isLoading.value = false;
  }
}

function openJoinForm(): void {
  showJoinForm.value = true;
  joinError.value = "";
}

async function submitJoin(): Promise<void> {
  const name = memberName.value.trim();
  if (!name) {
    joinError.value = t("groupJoin.nameRequired");
    return;
  }

  isJoining.value = true;
  joinError.value = "";

  try {
    const joined = await groupOrder.joinGroupOrder(props.shareCode, name);
    const groupOrderId = groupOrder.groupOrder.value?.id;

    if (!joined || !groupOrderId) {
      // joinGroupOrder catches its own failure into the composable's error ref,
      // which holds a translation key rather than a message.
      joinError.value = t(groupOrder.error.value ?? "groupJoin.joinFailed");
      return;
    }

    // Straight to the table menu so the new member can start ordering; a
    // group without a table has no menu route, so it keeps the shared cart.
    const { restaurantId, tableId } = groupOrder.groupOrder.value ?? {};
    await router.push(
      restaurantId && tableId
        ? {
            name: "RestaurantMenu",
            params: { restaurantId, tableId: Number(tableId) },
          }
        : { name: "GroupOrder", params: { groupOrderId } },
    );
  } catch (error) {
    joinError.value = t(
      getGroupOrderErrorI18nKey(error, "groupJoin.joinFailed"),
    );
  } finally {
    isJoining.value = false;
  }
}

onMounted(() => {
  void loadPreview();
});
</script>

<template>
  <main class="min-h-screen bg-ios-bg px-4 py-8">
    <section class="mx-auto w-full max-w-md">
      <div v-if="isLoading" class="py-16 text-center text-ios-secondary">
        {{ t("groupJoin.loading") }}
      </div>

      <div
        v-else-if="isNotFound"
        data-testid="join-not-found"
        class="rounded-2xl bg-ios-card p-6 text-center shadow-card-sm"
      >
        <h1 class="text-xl font-semibold text-ios-text">
          {{ t("groupJoin.notFoundTitle") }}
        </h1>
        <p class="mt-2 text-sm text-ios-secondary">
          {{ t("groupJoin.notFoundDesc") }}
        </p>
      </div>

      <div
        v-else-if="previewError"
        data-testid="join-preview-error"
        class="rounded-2xl bg-ios-card p-6 text-center shadow-card-sm"
      >
        <h1 class="text-xl font-semibold text-ios-text">
          {{ t("groupJoin.loadFailedTitle") }}
        </h1>
        <p class="mt-2 text-sm text-ios-secondary">{{ previewError }}</p>
        <button
          data-testid="join-retry-button"
          type="button"
          class="mt-5 rounded-full bg-ios-blue px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 active:scale-[0.98]"
          @click="loadPreview"
        >
          {{ t("groupJoin.retry") }}
        </button>
      </div>

      <div v-else-if="preview" class="rounded-2xl bg-ios-card p-6 shadow-card">
        <p class="text-sm font-medium text-ios-secondary">
          {{ t("groupJoin.label") }}
        </p>
        <h1 class="mt-1 text-2xl font-semibold text-ios-text">
          {{
            tWithParams("groupJoin.hostOrdering", {
              hostName: preview.hostName,
            })
          }}
        </h1>

        <dl class="mt-6 grid grid-cols-2 gap-3 text-sm">
          <div class="rounded-xl bg-ios-bg p-4">
            <dt class="text-ios-secondary">{{ t("groupJoin.members") }}</dt>
            <dd class="mt-1 text-lg font-semibold text-ios-text">
              {{ preview.memberCount }}
            </dd>
          </div>
          <div class="rounded-xl bg-ios-bg p-4">
            <dt class="text-ios-secondary">{{ t("groupJoin.fulfillment") }}</dt>
            <dd class="mt-1 text-lg font-semibold text-ios-text">
              {{ fulfillmentLabel }}
            </dd>
          </div>
          <div class="col-span-2 rounded-xl bg-ios-bg p-4">
            <dt class="text-ios-secondary">{{ t("groupJoin.expires") }}</dt>
            <dd class="mt-1 font-semibold text-ios-text">
              {{ expiresAtLabel }}
            </dd>
          </div>
        </dl>

        <button
          v-if="!showJoinForm"
          data-testid="join-confirm-button"
          type="button"
          class="mt-6 w-full rounded-full bg-ios-blue px-4 py-3.5 text-base font-semibold text-white transition-all duration-200 active:scale-[0.98]"
          @click="openJoinForm"
        >
          {{ t("groupJoin.join") }}
        </button>

        <form v-else class="mt-6 space-y-4" @submit.prevent="submitJoin">
          <label class="block text-sm font-medium text-ios-text">
            {{ t("groupJoin.yourName") }}
            <input
              v-model="memberName"
              data-testid="join-name-input"
              class="mt-2 block w-full rounded-xl border-0 bg-ios-bg px-4 py-3 text-ios-text transition-all duration-200 placeholder:text-ios-tertiary focus:bg-white focus:ring-2 focus:ring-ios-blue/30"
              autocomplete="name"
              type="text"
              :placeholder="t('groupJoin.namePlaceholder')"
            />
          </label>

          <p v-if="joinError" class="text-sm text-ios-red">{{ joinError }}</p>

          <button
            data-testid="join-submit-button"
            type="button"
            class="w-full rounded-full bg-ios-blue px-4 py-3.5 text-base font-semibold text-white transition-all duration-200 active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100"
            :disabled="isJoining"
            @click="submitJoin"
          >
            {{ isJoining ? t("groupJoin.joining") : t("groupJoin.joinNow") }}
          </button>
        </form>
      </div>
    </section>
  </main>
</template>
