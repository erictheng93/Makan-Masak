import { ref } from "vue";
import type { RouteLocationRaw } from "vue-router";

export interface ConfirmModalOptions {
  type?: "danger" | "warning";
  title: string;
  message: string;
  confirmLabel: string;
  /** Scannable detail under the message, one bulleted list per heading. */
  sections?: Array<{ heading: string; items: string[]; blocking?: boolean }>;
  /** Greys the confirm button, e.g. while a blocking condition holds. */
  confirmDisabled?: boolean;
  /** A way out to the page that resolves the condition; closes the modal. */
  link?: { to: RouteLocationRaw; label: string };
}

export interface ConfirmModalState extends ConfirmModalOptions {
  type: "danger" | "warning";
  resolve: (confirmed: boolean) => void;
}

const modalState = ref<ConfirmModalState | null>(null);

export function useConfirmModal() {
  function confirm(options: ConfirmModalOptions): Promise<boolean> {
    return new Promise((resolve) => {
      modalState.value = {
        type: options.type ?? "danger",
        title: options.title,
        message: options.message,
        confirmLabel: options.confirmLabel,
        sections: options.sections,
        confirmDisabled: options.confirmDisabled,
        link: options.link,
        resolve,
      };
    });
  }

  function close(confirmed: boolean) {
    modalState.value?.resolve(confirmed);
    modalState.value = null;
  }

  return {
    modalState,
    confirm,
    close,
  };
}
