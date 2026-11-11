// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { expect, it } from "vitest";
import { vDialogFocus } from "./dialog-focus";

it("keeps Tab and Shift+Tab inside when the dialog container itself is focused", async () => {
  const wrapper = mount(
    {
      directives: { dialogFocus: vDialogFocus },
      template:
        '<div v-dialog-focus tabindex="-1"><button>First</button><button>Last</button></div>',
    },
    { attachTo: document.body },
  );
  await nextTick();
  const root = wrapper.get("div");
  const [first, last] = wrapper.findAll("button");
  (root.element as HTMLElement).focus();
  await root.trigger("keydown", { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(last.element);
  (root.element as HTMLElement).focus();
  await root.trigger("keydown", { key: "Tab" });
  expect(document.activeElement).toBe(first.element);
  wrapper.unmount();
});
