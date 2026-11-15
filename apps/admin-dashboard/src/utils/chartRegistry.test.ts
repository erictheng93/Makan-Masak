// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Chart } from "chart.js";
import "./chartRegistry";

describe("chartRegistry", () => {
  it.each(["bar", "line"] as const)(
    "registers the %s controller used by new Chart()",
    (type) => {
      expect(() => Chart.registry.getController(type)).not.toThrow();
    },
  );
});
