import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import {
  mount,
  flushPromises,
  DOMWrapper,
  enableAutoUnmount,
} from "@vue/test-utils";
import SettingsView from "@/views/SettingsView.vue";
import { nextTick } from "vue";
import { useSettingsStore } from "./settings";

beforeEach(() => {
  setActivePinia(createPinia());
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.className = "";
});

describe("useSettingsStore", () => {
  it("loads saved settings by merging them with defaults", async () => {
    localStorage.setItem(
      "kitchen_settings",
      JSON.stringify({
        audioEnabled: false,
        refreshInterval: 45,
        theme: "dark",
      }),
    );
    const store = useSettingsStore();

    store.loadSettings();
    await nextTick();

    expect(store.settings).toMatchObject({
      audioEnabled: false,
      refreshInterval: 45,
      theme: "dark",
      autoRefresh: true,
      warningThreshold: 10,
      urgentThreshold: 15,
    });
    expect(store.audioEnabled).toBe(false);
    expect(store.refreshInterval).toBe(45);
  });

  it("falls back to defaults when persisted settings are invalid JSON", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    localStorage.setItem("kitchen_settings", "{not-json");
    const store = useSettingsStore();

    store.loadSettings();

    expect(store.settings.audioEnabled).toBe(true);
    expect(store.settings.refreshInterval).toBe(30);
    expect(console.error).toHaveBeenCalled();
  });

  it("persists updated settings and toggles common display options", async () => {
    const store = useSettingsStore();

    store.toggleAudio();
    store.toggleAutoRefresh();
    store.toggleCustomerNames();
    await nextTick();

    expect(store.settings.audioEnabled).toBe(false);
    expect(store.settings.autoRefresh).toBe(false);
    expect(store.settings.showCustomerNames).toBe(false);
    expect(JSON.parse(localStorage.getItem("kitchen_settings")!)).toMatchObject(
      {
        audioEnabled: false,
        autoRefresh: false,
        showCustomerNames: false,
      },
    );
  });

  it("clamps numeric settings to safe kitchen display ranges", () => {
    const store = useSettingsStore();

    store.setSoundVolume(150);
    store.setRefreshInterval(1);
    store.setUrgentThreshold(99);
    store.setWarningThreshold(-10);

    expect(store.settings.soundVolume).toBe(100);
    expect(store.settings.refreshInterval).toBe(5);
    expect(store.settings.urgentThreshold).toBe(60);
    expect(store.settings.warningThreshold).toBe(1);
  });

  it("applies theme and font size to the document root", () => {
    const store = useSettingsStore();

    store.setTheme("high-contrast");
    store.setFontSize("extra-large");

    expect(document.documentElement.getAttribute("data-theme")).toBe(
      "high-contrast",
    );
    expect(document.documentElement.className).toBe("text-xl");
  });
});

enableAutoUnmount(afterEach);
it("exposes current switches and keyboard-operable named setting dialogs", async () => {
  const wrapper = mount(SettingsView, { attachTo: document.body });
  const switches = wrapper.findAll('[role="switch"]');
  expect(switches).toHaveLength(3);
  const oldValue = switches[0].attributes("aria-checked");
  await switches[0].trigger("click");
  expect(switches[0].attributes("aria-checked")).not.toBe(oldValue);
  const trigger = wrapper
    .findAll("button")
    .find((button) => button.text().includes("緊急時間"));
  expect(trigger).toBeDefined();
  (trigger!.element as HTMLElement).focus();
  await trigger!.trigger("click");
  await flushPromises();
  const body = new DOMWrapper(document.body);
  const dialog = body.get('[role="dialog"]');
  expect(dialog.attributes("aria-modal")).toBe("true");
  expect(dialog.attributes("aria-labelledby")).toBeTruthy();
  await dialog.trigger("keydown", { key: "Escape" });
  await flushPromises();
  expect(body.find('[role="dialog"]').exists()).toBe(false);
  expect(document.activeElement).toBe(trigger!.element);
});
