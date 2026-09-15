<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "@/composables/useI18n";

/**
 * The share link was the one piece of the group-order flow with no UI.
 * `useGroupOrder().getShareLink()` has existed and been unit-tested all along,
 * and `/group/:shareCode` resolves, but no view ever called it -- so a host
 * could build a shared cart that nobody could be invited into.
 */
const props = defineProps<{
  shareCode: string;
  shareLink: string;
}>();

const { t } = useI18n();
const feedback = ref<"copied" | "failed" | null>(null);

const canShare = computed(
  () => props.shareCode.length > 0 && props.shareLink.length > 0,
);

async function copyLink(): Promise<void> {
  try {
    // Clipboard access is unavailable on insecure origins and can be denied
    // outright, so the link stays on screen as the manual fallback.
    await navigator.clipboard.writeText(props.shareLink);
    feedback.value = "copied";
  } catch {
    feedback.value = "failed";
  }
}
</script>

<template>
  <section
    v-if="canShare"
    data-testid="group-order-invite"
    class="mt-4 rounded-2xl bg-ios-card p-5 shadow-card-sm"
  >
    <div class="flex items-center justify-between gap-3">
      <div>
        <h2 class="text-sm font-semibold text-ios-text">
          {{ t("group.inviteTitle") }}
        </h2>
        <p class="mt-1 text-xs text-ios-secondary">
          {{ t("group.inviteDesc") }}
        </p>
      </div>
      <button
        data-testid="copy-invite-link"
        type="button"
        class="shrink-0 rounded-full bg-ios-blue px-4 py-2 text-sm font-semibold text-white transition-all duration-200 active:scale-[0.98]"
        @click="copyLink"
      >
        {{ t("group.inviteCopyLink") }}
      </button>
    </div>

    <p
      data-testid="invite-link-value"
      class="mt-4 select-all break-all rounded-xl bg-ios-bg p-4 font-mono text-sm text-ios-text"
    >
      {{ shareLink }}
    </p>

    <p class="mt-2 text-xs text-ios-secondary">
      {{ t("group.inviteCodeLabel") }}
      <span data-testid="invite-share-code" class="select-all font-mono">{{
        shareCode
      }}</span>
    </p>

    <p
      v-if="feedback === 'copied'"
      data-testid="invite-copied"
      class="mt-3 rounded-xl bg-ios-green/10 p-3 text-sm text-ios-green"
    >
      {{ t("group.inviteCopied") }}
    </p>
    <p
      v-else-if="feedback === 'failed'"
      data-testid="invite-copy-failed"
      class="mt-3 rounded-xl bg-ios-orange/10 p-3 text-sm text-ios-orange"
    >
      {{ t("group.inviteCopyFailed") }}
    </p>
  </section>
</template>
