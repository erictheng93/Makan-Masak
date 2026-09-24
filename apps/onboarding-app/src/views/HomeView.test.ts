import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

vi.mock("vue-router", () => ({
  RouterLink: { template: "<a><slot /></a>" },
}));
vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

import HomeView from "./HomeView.vue";

// jsdom gives import.meta.url an http: scheme, so resolve from the file path.
const PUBLIC_DIR = resolve(__dirname, "../../public");

describe("home page tour", () => {
  it("points the secondary link at the on-page tour, not an external demo", () => {
    const wrapper = mount(HomeView);
    const link = wrapper
      .findAll("a")
      .find((a) => a.text() === "home.hero.ctaTour");

    expect(link?.attributes("href")).toBe("#how-it-works");
    expect(wrapper.find("#how-it-works").exists()).toBe(true);
  });

  it("shows four captioned screenshots that exist in public/", () => {
    const wrapper = mount(HomeView);
    const images = wrapper.findAll("[data-tour-step] img");

    expect(images.map((img) => img.attributes("alt"))).toEqual([
      "home.tour.steps.order.alt",
      "home.tour.steps.kitchen.alt",
      "home.tour.steps.tracking.alt",
      "home.tour.steps.dashboard.alt",
    ]);
    for (const img of images) {
      expect(existsSync(PUBLIC_DIR + img.attributes("src"))).toBe(true);
    }
  });
});
