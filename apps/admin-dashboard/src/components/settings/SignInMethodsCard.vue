<template>
  <section
    v-if="providers.length > 0"
    class="rounded-2xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
    data-testid="signin-methods-card"
    :aria-busy="busy"
  >
    <h3 class="text-lg font-semibold text-ios-text mb-1">
      {{ t("settings.security.signInMethods.title") }}
    </h3>
    <p class="text-sm text-ios-text/60 mb-4">
      {{ t("settings.security.signInMethods.description") }}
    </p>
    <p
      class="text-xs text-ios-text/50 mb-4 -mt-2"
      data-testid="signin-methods-multi-shop"
    >
      {{ t("settings.security.signInMethods.multiShopHint") }}
    </p>

    <ul v-if="identities.length > 0" class="space-y-2 mb-4">
      <li
        v-for="identity in identities"
        :key="identity.id"
        :data-testid="`identity-${identity.id}`"
        class="flex items-center justify-between gap-3 rounded-xl bg-ios-bg px-4 py-3"
      >
        <div class="min-w-0">
          <p class="text-sm font-medium text-ios-text">
            {{ t(`auth.oauth.providers.${identity.provider}`) }}
            <span class="font-normal text-ios-text/60">
              {{ identity.displayName || identity.email }}
            </span>
          </p>
          <p class="text-xs text-ios-text/50">
            {{
              t("settings.security.signInMethods.linkedOn", {
                date: formatDate(identity.linkedAt),
              })
            }}
          </p>
        </div>
        <button
          type="button"
          :data-testid="`unlink-${identity.id}`"
          :disabled="busy"
          class="shrink-0 rounded-full px-4 py-1.5 text-[13px] font-semibold text-ios-red transition-opacity duration-200 ease-out hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue disabled:opacity-50"
          @click="unlink(identity)"
        >
          {{ t("settings.security.signInMethods.unlink") }}
        </button>
      </li>
    </ul>
    <p v-else class="text-sm text-ios-text/50 mb-4">
      {{ t("settings.security.signInMethods.none") }}
    </p>

    <p
      v-if="error"
      role="alert"
      data-testid="signin-methods-error"
      class="mb-3 text-sm text-ios-red"
    >
      {{ error }}
    </p>

    <div class="flex flex-wrap gap-2">
      <button
        v-for="provider in unlinkedProviders"
        :key="provider"
        type="button"
        :data-testid="`link-${provider}`"
        :disabled="busy"
        class="rounded-full bg-ios-blue px-5 py-2 text-[13px] font-semibold text-white transition-opacity duration-200 ease-out hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue focus-visible:ring-offset-2 disabled:opacity-50"
        @click="link(provider)"
      >
        {{ t("settings.security.signInMethods.link") }}
        {{ t(`auth.oauth.providers.${provider}`) }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useToast } from "vue-toastification";
import { useI18n } from "@/i18n";
import { useConfirmModal } from "@/composables/useConfirmModal";
import { useDateFormatter } from "@/composables/useDateFormatter";
import {
  fetchStaffOAuthProviders,
  listStaffOAuthIdentities,
  oauthErrorMessageKey,
  startStaffOAuthLink,
  unlinkStaffOAuthIdentity,
  type StaffOAuthIdentity,
  type StaffOAuthProvider,
} from "@/services/staffOAuthService";
import { getApiErrorCode } from "@makanmasak/shared/utils/unknown";

// Rendered for owners only (SettingsView gates it); the API enforces it too.
const RETURN_PATH = "/dashboard/settings?tab=security";

const { t } = useI18n();
const toast = useToast();
const route = useRoute();
const router = useRouter();
const { confirm } = useConfirmModal();
const { formatDate } = useDateFormatter();

const providers = ref<StaffOAuthProvider[]>([]);
const identities = ref<StaffOAuthIdentity[]>([]);
const busy = ref(false);
const error = ref("");

const unlinkedProviders = computed(() =>
  providers.value.filter(
    (p) => !identities.value.some((identity) => identity.provider === p),
  ),
);

async function refresh() {
  try {
    identities.value = await listStaffOAuthIdentities();
  } catch {
    error.value = t("settings.security.signInMethods.loadFailed");
  }
}

async function link(provider: StaffOAuthProvider) {
  busy.value = true;
  error.value = "";
  try {
    const url = await startStaffOAuthLink(provider, RETURN_PATH);
    window.location.assign(url);
  } catch {
    error.value = t("settings.security.signInMethods.linkFailed");
    busy.value = false;
  }
}

async function unlink(identity: StaffOAuthIdentity) {
  const confirmed = await confirm({
    type: "danger",
    title: t("settings.security.signInMethods.unlinkTitle"),
    message: t("settings.security.signInMethods.unlinkMessage", {
      provider: t(`auth.oauth.providers.${identity.provider}`),
    }),
    confirmLabel: t("settings.security.signInMethods.unlink"),
  });
  if (!confirmed) return;

  busy.value = true;
  error.value = "";
  try {
    await unlinkStaffOAuthIdentity(identity.id);
    toast.success(t("settings.security.signInMethods.unlinked"));
    await refresh();
  } catch (e: unknown) {
    error.value = t(
      getApiErrorCode(e) === "LAST_AUTH_METHOD"
        ? "settings.security.signInMethods.lastMethod"
        : "settings.security.signInMethods.unlinkFailed",
    );
  } finally {
    busy.value = false;
  }
}

/** ?oauth_linked / ?oauth_error on return from the provider. */
async function handleReturn() {
  const first = (v: unknown) => (typeof v === "string" ? v : undefined);
  const linked = first(route.query.oauth_linked);
  const failure = first(route.query.oauth_error);
  if (!linked && !failure) return;

  const { oauth_linked: _l, oauth_error: _e, ...query } = route.query;
  await router.replace({ path: route.path, query });

  if (failure) toast.error(t(oauthErrorMessageKey(failure)));
  else if (linked === "google" || linked === "line") {
    toast.success(
      t("settings.security.signInMethods.linked", {
        provider: t(`auth.oauth.providers.${linked}`),
      }),
    );
  }
}

onMounted(async () => {
  providers.value = await fetchStaffOAuthProviders();
  if (providers.value.length === 0) return;
  await Promise.all([refresh(), handleReturn()]);
});
</script>
