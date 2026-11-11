import { nextTick, watch } from "vue";

// Restore after the leave transition has removed the background's inert state.
export function useDialogReturnFocus(isOpen: () => boolean) {
  let opener: HTMLElement | null = null;
  watch(
    isOpen,
    (open) => {
      if (open)
        opener =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
    },
    { immediate: true, flush: "sync" },
  );
  return async () => {
    await nextTick();
    if (!isOpen() && opener?.isConnected) opener.focus();
  };
}
