// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Component } from "vue";
import { useConfirmModal } from "@/composables/useConfirmModal";

let ConfirmModal: Component;

const mountModal = () =>
  mount(ConfirmModal, {
    attachTo: document.body,
    global: { stubs: { RouterLink: { template: "<a><slot /></a>" } } },
  });

describe("ConfirmModal details", () => {
  beforeAll(async () => {
    ConfirmModal = (await import("./ConfirmModal.vue")).default;
  }, 30_000);

  beforeEach(() => {
    useConfirmModal().modalState.value = null;
    document.body.innerHTML = "";
  });

  it("lists each section and keeps confirm usable by default", async () => {
    const wrapper = mountModal();
    void useConfirmModal().confirm({
      title: "t",
      message: "m",
      confirmLabel: "go",
      sections: [{ heading: "Lost", items: ["a", "b"] }],
    });
    await wrapper.vm.$nextTick();

    const section = document.querySelector(
      '[data-testid="confirm-modal-section"]',
    );
    expect(section?.textContent).toContain("Lost");
    expect(section?.querySelectorAll("li")).toHaveLength(2);
    const confirmButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="confirm-modal-confirm"]',
    );
    expect(confirmButton?.disabled).toBe(false);
    wrapper.unmount();
  });

  it("disables confirm and shows the way out when blocked", async () => {
    const wrapper = mountModal();
    void useConfirmModal().confirm({
      title: "t",
      message: "m",
      confirmLabel: "go",
      confirmDisabled: true,
      link: { to: "/dashboard/pos", label: "Close the shift" },
    });
    await wrapper.vm.$nextTick();

    expect(
      document.querySelector<HTMLButtonElement>(
        '[data-testid="confirm-modal-confirm"]',
      )?.disabled,
    ).toBe(true);
    expect(
      document.querySelector('[data-testid="confirm-modal-link"]')?.textContent,
    ).toContain("Close the shift");
    wrapper.unmount();
  });
});
