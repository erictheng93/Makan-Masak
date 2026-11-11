import { nextTick, type ObjectDirective } from "vue";

const focusable =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]';
const cleanup = new WeakMap<HTMLElement, () => void>();

/** Keep the existing inline dialogs keyboard-contained and return to their trigger. */
export const vDialogFocus: ObjectDirective<HTMLElement> = {
  mounted(element) {
    const trigger = document.activeElement as HTMLElement | null;
    const controls = () =>
      Array.from(element.querySelectorAll<HTMLElement>(focusable));
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = controls();
      const target = event.shiftKey ? items.at(-1) : items[0];
      if (
        !items.length ||
        document.activeElement === element ||
        (event.shiftKey
          ? document.activeElement === items[0]
          : document.activeElement === items.at(-1))
      ) {
        event.preventDefault();
        (target || element).focus();
      }
    };
    element.addEventListener("keydown", keydown);
    nextTick(() => (controls()[0] || element).focus());
    cleanup.set(element, () => {
      element.removeEventListener("keydown", keydown);
      if (trigger?.isConnected) trigger.focus();
    });
  },
  unmounted(element) {
    cleanup.get(element)?.();
    cleanup.delete(element);
  },
};
