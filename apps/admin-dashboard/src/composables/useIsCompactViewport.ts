import { onMounted, onUnmounted, ref } from "vue";

// Below Tailwind's `lg` (1024px). Guarded: jsdom and SSR have no matchMedia.
const QUERY = "(max-width: 1023.98px)";

export function useIsCompactViewport() {
  const mq =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(QUERY)
      : null;
  const isCompact = ref(mq?.matches ?? false);
  const update = (e: { matches: boolean }) => {
    isCompact.value = e.matches;
  };
  onMounted(() => mq?.addEventListener("change", update));
  onUnmounted(() => mq?.removeEventListener("change", update));
  return isCompact;
}
