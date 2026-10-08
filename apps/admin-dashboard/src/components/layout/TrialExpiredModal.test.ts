// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { UserRole } from "@/types";
import TrialExpiredModal from "./TrialExpiredModal.vue";

const isTrialExpired = ref(true);
const user = ref<{ role: UserRole } | null>({ role: UserRole.OWNER });

vi.mock("@makanmasak/shared/composables/useModuleAccess", () => ({
  useModuleAccess: () => ({ isTrialExpired }),
}));
vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({ user: user.value }),
}));
vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));

const showModal = vi.fn(function (this: HTMLDialogElement) {
  this.setAttribute("open", "");
});

// Shared refs drive every live instance, so leftovers would fire showModal.
const mounted: VueWrapper[] = [];

function mountModal() {
  const wrapper = mount(TrialExpiredModal, {
    global: { stubs: { "router-link": { template: "<a><slot /></a>" } } },
  });
  mounted.push(wrapper);
  return wrapper;
}

describe("TrialExpiredModal", () => {
  afterEach(() => {
    mounted.splice(0).forEach((w) => w.unmount());
  });

  beforeEach(() => {
    sessionStorage.clear();
    showModal.mockClear();
    isTrialExpired.value = true;
    user.value = { role: UserRole.OWNER };
    HTMLDialogElement.prototype.showModal = showModal;
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  });

  it("opens once for an owner whose trial has expired", async () => {
    mountModal();
    await nextTick();
    expect(showModal).toHaveBeenCalledOnce();
  });

  it("does not reopen after it was dismissed in this login session", async () => {
    const wrapper = mountModal();
    await wrapper
      .get('[data-testid="trial-expired-modal-continue"]')
      .trigger("click");
    expect(sessionStorage.getItem("trial_expired_modal_seen")).toBe("1");

    showModal.mockClear();
    mountModal(); // e.g. a page reload within the same session
    await nextTick();
    expect(showModal).not.toHaveBeenCalled();
  });

  it.each([
    ["trial still running", () => (isTrialExpired.value = false)],
    ["not an owner", () => (user.value = { role: UserRole.CHEF })],
  ])("stays closed when %s", async (_label, arrange) => {
    arrange();
    mountModal();
    await nextTick();
    expect(showModal).not.toHaveBeenCalled();
  });
});
