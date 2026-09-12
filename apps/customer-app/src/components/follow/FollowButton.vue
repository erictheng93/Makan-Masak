<template>
  <button
    type="button"
    data-testid="follow-button"
    :data-follow-target="`${targetType}:${targetId}`"
    :data-following="following ? 'true' : 'false'"
    :aria-pressed="following ? 'true' : 'false'"
    :aria-label="ariaLabel"
    :disabled="busy"
    class="inline-flex shrink-0 items-center gap-1 rounded-full font-medium transition-colors duration-200 ease-out disabled:opacity-60"
    :class="[
      compact ? 'px-2.5 py-1 text-xs' : 'px-4 py-1.5 text-sm',
      following
        ? 'bg-ios-blue text-white'
        : 'bg-ios-blue-soft text-ios-blue-deep',
    ]"
    @click.stop.prevent="onClick"
  >
    <svg
      class="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      :fill="following ? 'currentColor' : 'none'"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l8.84 8.84 8.84-8.84a5.5 5.5 0 000-7.78z"
      />
    </svg>
    <span>{{ label }}</span>
  </button>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useToast } from "vue-toastification";
import { useI18n } from "@/composables/useI18n";
import {
  hasCustomerSession,
  useFollowing,
  type FollowTargetType,
} from "@/composables/useFollowing";

/**
 * The one control that puts a diner into — or out of — a market's or
 * restaurant's broadcast audience (#335). It owns no state of its own: the
 * following/not-following label is read from the shared `useFollowing` list, so
 * twenty of these on one page agree with each other and cost one GET between
 * them.
 *
 * `name` is presentational only, for the accessible label. Everything the API
 * needs is `targetType` + `targetId`.
 */
const props = withDefaults(
  defineProps<{
    targetType: FollowTargetType;
    targetId: string;
    name?: string;
    compact?: boolean;
  }>(),
  { name: "", compact: false },
);

const router = useRouter();
const route = useRoute();
const toast = useToast();
const { t } = useI18n();
const { ensureLoaded, isFollowing, toggle } = useFollowing();

const busy = ref(false);

const following = computed(() => isFollowing(props.targetType, props.targetId));

const label = computed(() =>
  following.value ? t("follow.following") : t("follow.follow"),
);

/**
 * Twenty of these on one page all read "追蹤" to a screen reader, so the target
 * name is what tells them apart. Composed rather than templated through a
 * locale string: the two halves are a translated verb and a proper noun, and
 * keeping them separate means a market called "追蹤中" cannot rewrite the verb.
 */
const ariaLabel = computed(() =>
  props.name ? `${label.value} ${props.name}` : undefined,
);

onMounted(() => {
  // An anonymous visitor has no favorites to fetch, and asking would spend a
  // 401 to learn that. The button still renders, and the click routes to login.
  if (!hasCustomerSession()) return;
  void ensureLoaded();
});

const onClick = async () => {
  if (!hasCustomerSession()) {
    router.push({
      path: "/login",
      query: { redirect: route.fullPath },
    });
    return;
  }

  if (busy.value) return;
  busy.value = true;
  const wasFollowing = following.value;
  try {
    await toggle(props.targetType, props.targetId);
  } catch {
    // `toggle` has already put the shared state back, so the label is correct
    // again by the time this runs; all that is left is to say so. The message
    // names the action the diner attempted, not the one they are now in.
    toast.error(
      wasFollowing ? t("follow.unfollowFailed") : t("follow.followFailed"),
    );
  } finally {
    busy.value = false;
  }
};
</script>
