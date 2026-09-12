<template>
  <section
    data-testid="notification-settings"
    class="rounded-2xl bg-ios-card p-6 shadow-ios-card"
  >
    <h3 class="text-lg font-semibold text-ios-text">
      {{ t("notifications.title") }}
    </h3>
    <p class="mt-1 text-sm text-ios-secondary">
      {{ t("notifications.subtitle") }}
    </p>

    <div class="mt-5 space-y-5">
      <label class="flex items-start justify-between gap-4">
        <span class="min-w-0">
          <span class="block text-sm font-medium text-ios-text">
            {{ t("notifications.marketingLabel") }}
          </span>
          <span class="mt-0.5 block text-xs text-ios-secondary">
            {{ t("notifications.marketingHint") }}
          </span>
        </span>
        <input
          data-testid="marketing-toggle"
          type="checkbox"
          class="mt-1 h-5 w-5 shrink-0 rounded text-ios-blue focus:ring-ios-blue"
          :checked="marketingOn"
          :disabled="saving"
          @change="onMarketingChange"
        />
      </label>

      <label class="flex items-start justify-between gap-4">
        <span class="min-w-0">
          <span class="block text-sm font-medium text-ios-text">
            {{ t("notifications.followedOnlyLabel") }}
          </span>
          <span class="mt-0.5 block text-xs text-ios-secondary">
            {{ t("notifications.followedOnlyHint") }}
          </span>
        </span>
        <input
          data-testid="followed-only-toggle"
          type="checkbox"
          class="mt-1 h-5 w-5 shrink-0 rounded text-ios-blue focus:ring-ios-blue"
          :checked="preferences.followedOnly"
          :disabled="saving"
          @change="onFollowedOnlyChange"
        />
      </label>

      <div class="rounded-2xl bg-ios-bg p-4">
        <p class="text-sm font-medium text-ios-text">
          {{ t("notifications.quietHoursTitle") }}
        </p>
        <p class="mt-0.5 text-xs text-ios-secondary">
          {{ t("notifications.quietHoursHint") }}
        </p>
        <div class="mt-3 flex flex-wrap items-end gap-3">
          <label class="flex flex-col gap-1 text-xs text-ios-secondary">
            {{ t("notifications.quietHoursStart") }}
            <input
              v-model="quietStart"
              data-testid="quiet-hours-start"
              type="time"
              class="rounded-xl bg-ios-card px-3 py-2 text-sm text-ios-text shadow-ios-sm focus:outline-none focus:ring-2 focus:ring-ios-blue/30"
            />
          </label>
          <label class="flex flex-col gap-1 text-xs text-ios-secondary">
            {{ t("notifications.quietHoursEnd") }}
            <input
              v-model="quietEnd"
              data-testid="quiet-hours-end"
              type="time"
              class="rounded-xl bg-ios-card px-3 py-2 text-sm text-ios-text shadow-ios-sm focus:outline-none focus:ring-2 focus:ring-ios-blue/30"
            />
          </label>
          <button
            type="button"
            data-testid="quiet-hours-save"
            class="rounded-full bg-ios-blue px-4 py-2 text-sm font-medium text-white transition-colors duration-200 ease-out disabled:opacity-60"
            :disabled="saving"
            @click="saveQuietHours"
          >
            {{ t("notifications.quietHoursSave") }}
          </button>
          <button
            type="button"
            data-testid="quiet-hours-clear"
            class="rounded-full bg-ios-blue-soft px-4 py-2 text-sm font-medium text-ios-blue-deep transition-colors duration-200 ease-out disabled:opacity-60"
            :disabled="saving"
            @click="clearQuietHours"
          >
            {{ t("notifications.quietHoursClear") }}
          </button>
        </div>
        <p
          v-if="quietHoursError"
          data-testid="quiet-hours-error"
          class="mt-2 text-xs text-ios-red-deep"
        >
          {{ t("notifications.quietHoursIncomplete") }}
        </p>
      </div>

      <div
        v-if="needsPush"
        data-testid="push-required-hint"
        class="rounded-2xl bg-ios-orange-soft p-4"
      >
        <p class="text-sm font-medium text-ios-orange-deep">
          {{ t("notifications.pushRequiredTitle") }}
        </p>
        <p class="mt-0.5 text-xs text-ios-orange-deep">
          {{ t("notifications.pushRequiredHint") }}
        </p>
        <!-- Web push is built but unlaunched, and the API answers its endpoints
             with 404 while it is switched off. The button stays visible, greyed
             and inert, rather than hidden: hiding it makes the product look
             smaller than it is, while leaving it live sends a subscribe request
             the API refuses. See composables/useFeatureAvailability.ts. -->
        <button
          data-testid="enable-push-button"
          type="button"
          class="mt-3 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors duration-200 ease-out"
          :class="
            pushUnavailable
              ? 'bg-ios-card text-ios-tertiary cursor-not-allowed select-none'
              : 'bg-ios-blue text-white'
          "
          :disabled="pushUnavailable"
          :data-disabled="pushUnavailable ? 'true' : undefined"
          :aria-disabled="pushUnavailable ? 'true' : undefined"
          :title="pushUnavailable ? PUSH_UNAVAILABLE_LABEL : undefined"
          @click="enablePush"
        >
          啟用推播
          <span v-if="pushUnavailable" class="text-xs">{{
            PUSH_UNAVAILABLE_LABEL
          }}</span>
        </button>
      </div>

      <p
        v-if="statusMessage"
        data-testid="notification-settings-status"
        class="text-sm"
        :class="statusIsError ? 'text-ios-red-deep' : 'text-ios-secondary'"
      >
        {{ statusMessage }}
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { parseUserFacingError } from "@makanmasak/shared/utils/user-facing-error";
import { CUSTOMER_CONSENT_VERSIONS } from "@makanmasak/shared-types";
import { customerIdentityApi } from "@/services/customerIdentityApi";
import type { CustomerNotificationPreferences } from "@/services/customerIdentityApi";
import customerPushService from "@/utils/push-notifications";
import { useFeatureAvailability } from "@/composables/useFeatureAvailability";
import { useI18n } from "@/composables/useI18n";

/**
 * Marketing push preferences (#335).
 *
 * Two records back one switch, and both are required before anything is sent:
 * the `marketing` consent row is the legal ledger of what the diner agreed to,
 * and `customer_notification_preferences.marketing_enabled` is the switch the
 * broadcast fan-out reads. The toggle therefore writes both, and reads as "on"
 * only when both say so — a preference left enabled while consent was withdrawn
 * must not look like an opt-in.
 *
 * Deliberately not wired to `PATCH /customer/preferences`. That older row's
 * `marketing_opt_in` / `promo_from_favorites_opt_in` flags have never had a
 * reader, so writing them would report success while changing nothing about who
 * receives a broadcast.
 */

/**
 * TODO(i18n): hard-coded zh-TW, carried over verbatim with the button this
 * moved from (ProfileView). Left as a literal rather than keyed because the
 * existing web-push regression test asserts this rendered copy.
 */
const PUSH_UNAVAILABLE_LABEL = "尚未開放";

const { t } = useI18n();
const { isDisabled } = useFeatureAvailability();

const preferences = ref<CustomerNotificationPreferences>({
  marketingEnabled: true,
  followedOnly: true,
  quietHoursStartMin: null,
  quietHoursEndMin: null,
  updatedAt: null,
});
const marketingConsented = ref(false);
const quietStart = ref("");
const quietEnd = ref("");
const saving = ref(false);
const quietHoursError = ref(false);
const statusMessage = ref("");
const statusIsError = ref(false);
/** `null` until asked; never asked while web push is unlaunched. */
const pushSubscribed = ref<boolean | null>(null);

const pushUnavailable = computed(() => isDisabled("webPush"));

const marketingOn = computed(
  () => marketingConsented.value && preferences.value.marketingEnabled,
);

const needsPush = computed(
  () => pushUnavailable.value || pushSubscribed.value === false,
);

/** Minutes from midnight <-> the "HH:MM" an `input[type=time]` speaks. */
const toTimeInput = (minutes: number | null): string => {
  if (minutes === null) return "";
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
};

const toMinutes = (value: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return Number.isFinite(minutes) ? minutes : null;
};

const applyPreferences = (next: CustomerNotificationPreferences) => {
  preferences.value = next;
  quietStart.value = toTimeInput(next.quietHoursStartMin);
  quietEnd.value = toTimeInput(next.quietHoursEndMin);
};

const reportSaved = () => {
  statusIsError.value = false;
  statusMessage.value = t("notifications.saved");
};

/**
 * Only `QUIET_HOURS_INCOMPLETE` gets a field-level message; it is the one
 * failure the diner can fix in place. Everything else is a generic retry notice,
 * and the server's own prose is never rendered.
 */
const reportFailure = (error: unknown) => {
  const { code } = parseUserFacingError(error);
  if (code === "QUIET_HOURS_INCOMPLETE") {
    quietHoursError.value = true;
    statusMessage.value = "";
    return;
  }
  statusIsError.value = true;
  statusMessage.value = t("notifications.saveFailed");
};

const savePreferences = async (
  patch: Parameters<
    typeof customerIdentityApi.updateNotificationPreferences
  >[0],
): Promise<boolean> => {
  saving.value = true;
  quietHoursError.value = false;
  try {
    applyPreferences(
      await customerIdentityApi.updateNotificationPreferences(patch),
    );
    reportSaved();
    return true;
  } catch (error) {
    reportFailure(error);
    return false;
  } finally {
    saving.value = false;
  }
};

const onMarketingChange = async (event: Event) => {
  const granted = (event.target as HTMLInputElement).checked;
  saving.value = true;
  quietHoursError.value = false;
  try {
    // Consent first: it is the record that authorises the send, and a preference
    // enabled without it would be a switch that promises something the fan-out
    // refuses to do.
    await customerIdentityApi.grantConsent({
      consentType: "marketing",
      version: CUSTOMER_CONSENT_VERSIONS.marketing,
      granted,
      source: "settings",
    });
    marketingConsented.value = granted;
    applyPreferences(
      await customerIdentityApi.updateNotificationPreferences({
        marketingEnabled: granted,
      }),
    );
    reportSaved();
  } catch (error) {
    reportFailure(error);
    // Re-read rather than assume: the consent may have landed and the
    // preference not, and the switch has to show what the server now holds.
    await loadState();
  } finally {
    saving.value = false;
  }
};

const onFollowedOnlyChange = async (event: Event) => {
  await savePreferences({
    followedOnly: (event.target as HTMLInputElement).checked,
  });
};

const saveQuietHours = async () => {
  await savePreferences({
    quietHoursStartMin: toMinutes(quietStart.value),
    quietHoursEndMin: toMinutes(quietEnd.value),
  });
};

const clearQuietHours = async () => {
  if (
    await savePreferences({ quietHoursStartMin: null, quietHoursEndMin: null })
  ) {
    quietStart.value = "";
    quietEnd.value = "";
  }
};

const enablePush = async () => {
  statusMessage.value = "";
  // Guarded here as well as on the button: the disabled attribute is
  // presentation, and this is what actually keeps the subscribe request --
  // which the API refuses while web push is unlaunched -- from being sent.
  if (pushUnavailable.value) {
    statusIsError.value = true;
    statusMessage.value = `推播${PUSH_UNAVAILABLE_LABEL}`;
    return;
  }
  try {
    const permission = await customerPushService.requestPermission();
    if (permission !== "granted") {
      statusIsError.value = true;
      statusMessage.value = t("notifications.pushPermissionDenied");
      return;
    }
    const subscription = await customerPushService.subscribe();
    pushSubscribed.value = Boolean(subscription);
    statusIsError.value = !subscription;
    statusMessage.value = subscription
      ? t("notifications.pushEnabled")
      : t("notifications.pushFailed");
  } catch (error) {
    console.warn("Failed to enable push:", error);
    statusIsError.value = true;
    statusMessage.value = t("notifications.pushFailed");
  }
};

async function loadState(): Promise<void> {
  const [prefs, consents] = await Promise.all([
    customerIdentityApi.getNotificationPreferences(),
    customerIdentityApi.listConsents(),
  ]);
  applyPreferences(prefs);
  // GET /customer/consents returns live grants only, so the absence of a
  // marketing row is itself the answer: no consent on file.
  marketingConsented.value = (consents ?? []).some(
    (row) => row.consent_type === "marketing" && row.granted === 1,
  );
}

onMounted(async () => {
  try {
    await loadState();
  } catch (error) {
    console.warn("Failed to load notification preferences:", error);
    statusIsError.value = true;
    statusMessage.value = t("notifications.loadFailed");
  }

  // Never asked while the feature is off: the endpoint 404s, and the answer is
  // already known -- nothing can be delivered either way.
  if (pushUnavailable.value) return;
  try {
    const subscriptions = await customerIdentityApi.listPushSubscriptions();
    pushSubscribed.value = (subscriptions ?? []).length > 0;
  } catch (error) {
    console.warn("Failed to read push subscriptions:", error);
  }
});
</script>
