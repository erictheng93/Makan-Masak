import { describe, expect, it } from "vitest";
import { encodeForPrinter } from "./encoding";

describe("encodeForPrinter", () => {
  it("keeps UTF-8 untouched by default", () => {
    expect([...encodeForPrinter("中")]).toEqual([0xe4, 0xb8, 0xad]);
  });

  it("encodes Big5 and GBK after ESC @, with FS & to enter Chinese mode", () => {
    expect([...encodeForPrinter("\x1b@中a", "big5")]).toEqual([
      0x1b, 0x40, 0x1c, 0x26, 0xa4, 0xa4, 0x61,
    ]);
    expect([...encodeForPrinter("\x1b@中", "gbk")]).toEqual([
      0x1b, 0x40, 0x1c, 0x26, 0xd6, 0xd0,
    ]);
  });

  it("prints ? for glyphs the code page lacks", () => {
    expect(encodeForPrinter("😀", "big5").at(-1)).toBe(0x3f);
  });
});
