import { afterEach, describe, expect, it, vi } from "vitest";
import { menuImageAttrs } from "./menu-image";

const v = {
  thumbnail: "https://i.test/1/thumbnail",
  small: "https://i.test/1/small",
  medium: "https://i.test/1/medium",
  large: "https://i.test/1/large",
};

afterEach(() => vi.unstubAllEnvs());

describe("menuImageAttrs", () => {
  it("builds a width srcset from full variants and falls back to the chosen src", () => {
    expect(menuImageAttrs(v.medium, v, "70px", "thumbnail")).toEqual({
      src: v.thumbnail,
      sizes: "70px",
      srcset: `${v.thumbnail} 150w, ${v.small} 300w, ${v.medium} 600w, ${v.large} 1200w`,
    });
  });

  it("offers nothing larger than the cap it is given", () => {
    const attrs = menuImageAttrs(v.medium, v, "334px", "medium", "medium");
    expect(attrs.srcset).toBe(
      `${v.thumbnail} 150w, ${v.small} 300w, ${v.medium} 600w`,
    );
    expect(attrs.src).toBe(v.medium);
  });

  it("accepts variants stored as a JSON string", () => {
    const attrs = menuImageAttrs(v.medium, JSON.stringify(v), "100vw");
    expect(attrs.src).toBe(v.medium);
    expect(attrs.srcset).toContain(`${v.large} 1200w`);
  });

  it("emits entries only for variants that exist", () => {
    const attrs = menuImageAttrs(
      "https://i.test/o",
      { medium: v.medium },
      "5px",
      "thumbnail",
    );
    expect(attrs.srcset).toBe(`${v.medium} 600w`);
    expect(attrs.src).toBe(v.medium);
  });

  it.each([null, undefined, "not json", "42", 7, { small: 3 }, []])(
    "returns the plain imageUrl for unusable variants %j",
    (bad) => {
      expect(menuImageAttrs("https://i.test/o", bad, "5px")).toEqual({
        src: "https://i.test/o",
      });
    },
  );

  it("prefixes relative urls with the image base and leaves absolute ones alone", () => {
    vi.stubEnv("VITE_IMAGE_BASE_URL", "https://cdn.test");
    expect(menuImageAttrs("/images/1/medium", null, "5px").src).toBe(
      "https://cdn.test/images/1/medium",
    );
    expect(
      menuImageAttrs("/x", { small: "/images/1/small" }, "5px").srcset,
    ).toBe("https://cdn.test/images/1/small 300w");
    expect(menuImageAttrs("https://i.test/o", null, "5px").src).toBe(
      "https://i.test/o",
    );
  });

  it("returns no src when there is no image at all", () => {
    expect(menuImageAttrs(null, null, "5px").src).toBeUndefined();
  });
});
