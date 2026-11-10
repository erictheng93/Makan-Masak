import { useToast } from "vue-toastification";
import { useI18n } from "@/i18n";
import UndoToast from "@/components/common/UndoToast.vue";

/** Success toast with an Undo button; `onUndo` runs once and closes the toast. */
export function useUndoToast() {
  const toast = useToast();
  const { t } = useI18n();
  return (message: string, onUndo: () => void) => {
    const id = toast.success(
      {
        component: UndoToast,
        props: { message, label: t("common.undo") },
        listeners: {
          undo: () => {
            toast.dismiss(id);
            onUndo();
          },
        },
      },
      { timeout: 8000, closeOnClick: false },
    );
  };
}
