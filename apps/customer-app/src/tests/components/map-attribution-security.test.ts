import { AttributionControl } from "maplibre-gl";
import { expect, it } from "vitest";

it("strips adjacent dangerous attribution attributes and preserves HTTPS credits", () => {
  const control = new AttributionControl({
    customAttribution: [
      '<details open onload="1" ontoggle="alert(1)">Market</details>',
      '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    ],
  });
  const canvas = document.createElement("div");
  const element = control.onAdd({
    style: {
      tileManagers: {
        basemap: {
          used: true,
          getSource: () => ({
            attribution:
              '<a href="javascript:alert(1)" onclick="alert(1)">Unsafe</a>',
          }),
        },
      },
    },
    _getUIString: (key: string) => key,
    getCanvasContainer: () => canvas,
    on: () => {},
    off: () => {},
  } as never);

  expect(
    element.querySelector('a[href="https://www.openstreetmap.org/copyright"]')
      ?.textContent,
  ).toBe("OpenStreetMap");
  const details = element.querySelector("details");
  const unsafeLink = Array.from(element.querySelectorAll("a")).find(
    (link) => link.textContent === "Unsafe",
  );
  expect(details?.hasAttribute("open")).toBe(true);
  expect([
    details?.getAttribute("onload"),
    details?.getAttribute("ontoggle"),
    unsafeLink?.getAttribute("href"),
    unsafeLink?.getAttribute("onclick"),
  ]).toEqual([null, null, null, null]);

  control.onRemove();
});
