<template>
  <section class="space-y-5" data-testid="shop-wallet-settings">
    <header class="space-y-1">
      <h3 class="text-lg font-semibold text-ios-text">
        {{ t("shopWallet.title") }}
      </h3>
      <p class="text-sm leading-6 text-ios-secondary">
        {{ t("shopWallet.subtitle") }}
      </p>
    </header>

    <!-- Only MYR shops: neither wallet settles any other currency, so offering
         the form to a TWD or VND shop would only produce a server rejection. -->
    <div
      v-if="!isSupportedCurrency"
      data-testid="shop-wallet-unavailable"
      class="rounded-2xl bg-ios-orange-soft px-5 py-4 text-sm leading-6 text-ios-orange-deep"
    >
      {{ t("shopWallet.unavailableCurrency", { currency: currencyCode }) }}
    </div>

    <div
      v-else-if="!restaurantId"
      data-testid="shop-wallet-no-restaurant"
      class="rounded-2xl bg-ios-orange-soft px-5 py-4 text-sm text-ios-orange-deep"
    >
      {{ t("shopWallet.selectRestaurant") }}
    </div>

    <template v-else>
      <p
        class="rounded-2xl bg-ios-blue-soft px-5 py-4 text-sm leading-6 text-ios-blue-deep"
        data-testid="shop-wallet-payout-note"
      >
        {{ t("shopWallet.payoutNote", { example: payoutExample }) }}
      </p>

      <div
        v-if="loadError"
        data-testid="shop-wallet-error"
        class="rounded-2xl bg-ios-red-soft px-5 py-4 text-sm text-ios-red-deep"
      >
        {{ loadError }}
      </div>

      <div
        v-if="isLoading"
        data-testid="shop-wallet-loading"
        class="rounded-2xl bg-white px-5 py-6 text-sm text-ios-secondary shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
      >
        {{ t("shopWallet.loading") }}
      </div>

      <article
        v-for="provider in providers"
        v-else
        :key="provider"
        :data-testid="`shop-wallet-card-${provider}`"
        :data-status="statusOf(provider)"
        class="rounded-2xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
      >
        <div
          class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
        >
          <div class="space-y-1">
            <h4 class="text-base font-semibold text-ios-text">
              {{ t(`shopWallet.providers.${provider}.name`) }}
            </h4>
            <p class="text-sm text-ios-secondary">
              {{ t(`shopWallet.providers.${provider}.description`) }}
            </p>
          </div>
          <span
            :data-testid="`shop-wallet-status-${provider}`"
            class="self-start rounded-full px-3 py-1 text-xs font-semibold"
            :class="statusBadgeClass(provider)"
          >
            {{ t(`shopWallet.status.${statusOf(provider)}`) }}
          </span>
        </div>

        <dl
          v-if="credentialOf(provider)"
          class="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3"
          :data-testid="`shop-wallet-summary-${provider}`"
        >
          <div>
            <dt class="text-xs font-medium text-ios-tertiary">
              {{ t("shopWallet.fields.merchantId") }}
            </dt>
            <dd
              class="mt-1 font-mono text-sm text-ios-text"
              :data-testid="`shop-wallet-merchant-${provider}`"
            >
              {{ credentialOf(provider)?.merchantIdMasked }}
            </dd>
          </div>
          <div>
            <dt class="text-xs font-medium text-ios-tertiary">
              {{ t("shopWallet.fields.environment") }}
            </dt>
            <dd class="mt-1 text-sm text-ios-text">
              {{
                t(
                  `shopWallet.environments.${credentialOf(provider)?.environment}`,
                )
              }}
            </dd>
          </div>
          <div>
            <dt class="text-xs font-medium text-ios-tertiary">
              {{ t("shopWallet.fields.secretUpdated") }}
            </dt>
            <dd class="mt-1 text-sm text-ios-text">
              {{ formatDate(credentialOf(provider)?.secretUpdatedAtMs) }}
            </dd>
          </div>
        </dl>

        <form
          v-if="openForm === provider"
          class="mt-5 space-y-4"
          :data-testid="`shop-wallet-form-${provider}`"
          @submit.prevent="submit(provider)"
        >
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label class="block">
              <span class="mb-2 block text-sm font-medium text-ios-text">
                {{ t("shopWallet.fields.merchantId") }}
              </span>
              <input
                v-model.trim="form.merchantId"
                :data-testid="`shop-wallet-merchant-input-${provider}`"
                type="text"
                required
                maxlength="128"
                class="w-full rounded-xl bg-ios-bg px-4 py-2.5 text-sm text-ios-text focus:outline-none focus:ring-2 focus:ring-ios-blue/30"
              />
            </label>
            <label class="block">
              <span class="mb-2 block text-sm font-medium text-ios-text">
                {{ t("shopWallet.fields.displayName") }}
              </span>
              <input
                v-model.trim="form.displayName"
                type="text"
                maxlength="128"
                class="w-full rounded-xl bg-ios-bg px-4 py-2.5 text-sm text-ios-text focus:outline-none focus:ring-2 focus:ring-ios-blue/30"
              />
            </label>
            <label class="block">
              <span class="mb-2 block text-sm font-medium text-ios-text">
                {{ t("shopWallet.fields.merchantKey") }}
              </span>
              <input
                v-model.trim="form.merchantKey"
                :data-testid="`shop-wallet-key-input-${provider}`"
                type="password"
                autocomplete="off"
                maxlength="512"
                :placeholder="
                  credentialOf(provider)
                    ? t('shopWallet.fields.secretKeepPlaceholder')
                    : ''
                "
                class="w-full rounded-xl bg-ios-bg px-4 py-2.5 text-sm text-ios-text focus:outline-none focus:ring-2 focus:ring-ios-blue/30"
              />
            </label>
            <label class="block">
              <span class="mb-2 block text-sm font-medium text-ios-text">
                {{ t("shopWallet.fields.webhookSecret") }}
              </span>
              <input
                v-model.trim="form.webhookSecret"
                type="password"
                autocomplete="off"
                maxlength="512"
                class="w-full rounded-xl bg-ios-bg px-4 py-2.5 text-sm text-ios-text focus:outline-none focus:ring-2 focus:ring-ios-blue/30"
              />
            </label>
            <label class="block sm:col-span-2">
              <span class="mb-2 block text-sm font-medium text-ios-text">
                {{ t("shopWallet.fields.environment") }}
              </span>
              <select
                v-model="form.environment"
                class="w-full rounded-xl bg-ios-bg px-4 py-2.5 text-sm text-ios-text focus:outline-none focus:ring-2 focus:ring-ios-blue/30"
              >
                <option value="sandbox">
                  {{ t("shopWallet.environments.sandbox") }}
                </option>
                <option value="production">
                  {{ t("shopWallet.environments.production") }}
                </option>
              </select>
            </label>
          </div>

          <p class="text-xs leading-5 text-ios-tertiary">
            {{ t("shopWallet.secretsNeverShown") }}
          </p>

          <div class="flex flex-wrap gap-3">
            <button
              type="submit"
              :disabled="isSaving"
              :data-testid="`shop-wallet-save-${provider}`"
              class="rounded-full bg-ios-blue px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-200 ease-out hover:bg-ios-blue-deep disabled:opacity-50"
            >
              {{
                isSaving
                  ? t("shopWallet.actions.saving")
                  : t("shopWallet.actions.save")
              }}
            </button>
            <button
              type="button"
              class="rounded-full bg-ios-bg px-5 py-2.5 text-sm font-semibold text-ios-secondary transition-colors duration-200 ease-out hover:bg-ios-separator"
              @click="closeForm"
            >
              {{ t("shopWallet.actions.cancel") }}
            </button>
          </div>
        </form>

        <div v-else class="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            :data-testid="`shop-wallet-connect-${provider}`"
            class="rounded-full bg-ios-blue px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-200 ease-out hover:bg-ios-blue-deep"
            @click="openFormFor(provider)"
          >
            {{
              credentialOf(provider)
                ? t("shopWallet.actions.update")
                : t("shopWallet.actions.connect")
            }}
          </button>
          <button
            v-if="credentialOf(provider)"
            type="button"
            :data-testid="`shop-wallet-disconnect-${provider}`"
            :disabled="isSaving"
            class="rounded-full bg-ios-red-soft px-5 py-2.5 text-sm font-semibold text-ios-red-deep transition-colors duration-200 ease-out hover:bg-ios-red/20 disabled:opacity-50"
            @click="disconnect(provider)"
          >
            {{ t("shopWallet.actions.disconnect") }}
          </button>
        </div>
      </article>
    </template>
  </section>
</template>

<script setup lang="ts">
/**
 * Where an owner connects their own Touch 'n Go eWallet or GrabPay merchant
 * account.
 *
 * Two things this component is careful about:
 *
 * - **It never displays a secret**, because the API never returns one. The
 *   secret inputs are always blank on open; leaving them blank on an update
 *   keeps whatever is stored.
 * - **It is only shown to MYR shops.** Both wallets settle MYR alone, so the
 *   currency check here is the same one the server makes — shown early so the
 *   owner reads an explanation rather than a rejection.
 */
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useI18n } from "@/i18n";
import { useToast } from "vue-toastification";
import { useCurrency } from "@/composables/useCurrency";
import { useAuthStore } from "@/stores/auth";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";
import {
  shopPaymentsService,
  type ShopPaymentCredential,
  type ShopPaymentEnvironment,
  type ShopPaymentProvider,
} from "@/services/shopPaymentsService";

const { t } = useI18n();
const toast = useToast();
const authStore = useAuthStore();
const { currencyCode, formatCents } = useCurrency();

/** The wallets this UI knows how to render, in display order. */
const providers: ShopPaymentProvider[] = ["tng", "grabpay"];

const restaurantId = computed(() => authStore.restaurantId);
const isSupportedCurrency = computed(() => currencyCode.value === "MYR");

const credentials = ref<ShopPaymentCredential[]>([]);
const isLoading = ref(false);
const isSaving = ref(false);
const loadError = ref("");
const openForm = ref<ShopPaymentProvider | null>(null);

const form = reactive({
  merchantId: "",
  displayName: "",
  merchantKey: "",
  webhookSecret: "",
  environment: "sandbox" as ShopPaymentEnvironment,
});

/** A worked example in the shop's own currency, so "your account" is concrete. */
const payoutExample = computed(() => formatCents(1250));

function credentialOf(
  provider: ShopPaymentProvider,
): ShopPaymentCredential | undefined {
  return credentials.value.find((c) => c.provider === provider);
}

function statusOf(provider: ShopPaymentProvider): string {
  return credentialOf(provider)?.status ?? "notConnected";
}

function statusBadgeClass(provider: ShopPaymentProvider): string {
  const status = statusOf(provider);
  if (status === "connected") return "bg-ios-green-soft text-ios-green-deep";
  if (status === "disabled") return "bg-ios-orange-soft text-ios-orange-deep";
  return "bg-ios-bg text-ios-secondary";
}

function formatDate(ms?: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString();
}

function openFormFor(provider: ShopPaymentProvider): void {
  const existing = credentialOf(provider);
  openForm.value = provider;
  form.merchantId = "";
  form.displayName = existing?.displayName ?? "";
  // Always blank: there is nothing stored on the client to prefill them with,
  // and a masked placeholder in a password field reads as a real value.
  form.merchantKey = "";
  form.webhookSecret = "";
  form.environment = existing?.environment ?? "sandbox";
}

function closeForm(): void {
  openForm.value = null;
}

async function load(): Promise<void> {
  const id = restaurantId.value;
  if (!id || !isSupportedCurrency.value) return;
  isLoading.value = true;
  loadError.value = "";
  try {
    const payload = await shopPaymentsService.list(id);
    credentials.value = payload.credentials;
  } catch (error) {
    loadError.value = resolveUserFacingError(error, t, {
      fallbackKey: "shopWallet.alerts.loadFailed",
    }).message;
  } finally {
    isLoading.value = false;
  }
}

async function submit(provider: ShopPaymentProvider): Promise<void> {
  const id = restaurantId.value;
  if (!id) return;
  const existing = credentialOf(provider);
  const secret = {
    ...(form.merchantKey ? { merchantKey: form.merchantKey } : {}),
    ...(form.webhookSecret ? { webhookSecret: form.webhookSecret } : {}),
  };
  if (!existing && Object.keys(secret).length === 0) {
    toast.error(t("shopWallet.alerts.secretRequired"));
    return;
  }

  isSaving.value = true;
  try {
    if (existing) {
      await shopPaymentsService.update(id, provider, {
        ...(form.merchantId ? { merchantId: form.merchantId } : {}),
        displayName: form.displayName || null,
        environment: form.environment,
        ...(Object.keys(secret).length > 0 ? { secret } : {}),
      });
    } else {
      await shopPaymentsService.connect(id, provider, {
        merchantId: form.merchantId,
        displayName: form.displayName || null,
        environment: form.environment,
        secret,
      });
    }
    toast.success(t("shopWallet.alerts.saved"));
    closeForm();
    await load();
  } catch (error) {
    toast.error(
      resolveUserFacingError(error, t, {
        fallbackKey: "shopWallet.alerts.saveFailed",
      }).message,
    );
  } finally {
    isSaving.value = false;
  }
}

async function disconnect(provider: ShopPaymentProvider): Promise<void> {
  const id = restaurantId.value;
  if (!id) return;
  isSaving.value = true;
  try {
    await shopPaymentsService.disconnect(id, provider);
    toast.success(t("shopWallet.alerts.disconnected"));
    await load();
  } catch (error) {
    toast.error(
      resolveUserFacingError(error, t, {
        fallbackKey: "shopWallet.alerts.disconnectFailed",
      }).message,
    );
  } finally {
    isSaving.value = false;
  }
}

onMounted(load);
watch([restaurantId, isSupportedCurrency], load);
</script>
