import { describe, expect, it } from "vitest";
import { readImageDimensions } from "./image-dimensions";
import {
  gifBytes,
  jpegBytes,
  pngBytes,
  webpExtendedBytes,
  webpLosslessBytes,
  webpLossyBytes,
} from "./image-fixtures";

describe("readImageDimensions", () => {
  it.each([
    ["JPEG", jpegBytes(4032, 3024), 4032, 3024],
    ["PNG", pngBytes(60000, 70000), 60000, 70000],
    ["GIF", gifBytes(320, 200), 320, 200],
    ["lossy WebP", webpLossyBytes(2048, 1365), 2048, 1365],
    ["lossless WebP", webpLosslessBytes(1200, 800), 1200, 800],
    ["extended WebP", webpExtendedBytes(16000, 9000), 16000, 9000],
  ])("reads %s", (_name, bytes, width, height) => {
    expect(readImageDimensions(bytes)).toEqual({ width, height });
  });

  it("finds a progressive JPEG frame behind fill bytes and a large segment", () => {
    const exif = new Array(70000 - 2).fill(0x41);
    const bytes = new Uint8Array([
      ...[0xff, 0xd8],
      // Two segments: one cannot hold 70000 bytes of length.
      ...[0xff, 0xe1, 0xff, 0xff, ...exif.slice(0, 0xffff - 2)],
      ...[0xff, 0xe1, 0x00, 0x04, 0x41, 0x41],
      ...[0xff, 0xff, 0xff, 0xc4, 0x00, 0x03, 0x00],
      ...[0xff, 0xc2, 0x00, 0x0b, 0x08, 0x02, 0x58, 0x03, 0x20, 0x01, 0x01],
    ]);
    expect(readImageDimensions(bytes)).toEqual({ width: 800, height: 600 });
  });

  it.each([
    ["empty input", new Uint8Array()],
    ["only a JPEG signature", new Uint8Array([0xff, 0xd8, 0xff, 0x00])],
    [
      "a JPEG that reaches its pixels with no frame",
      new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0x00, 0x00]),
    ],
    ["a JPEG cut inside its frame header", jpegBytes(4, 3).slice(0, 13)],
    ["a PNG cut before its size", pngBytes(4, 3).slice(0, 18)],
    ["a zero-sized GIF", gifBytes(0, 10)],
    [
      "a RIFF file that is not WebP",
      new Uint8Array(
        [...webpLossyBytes(4, 3)].map((b, i) => (i === 8 ? 0x41 : b)),
      ),
    ],
    [
      "a WebP with an unknown first chunk",
      new Uint8Array(
        [...webpLossyBytes(4, 3)].map((b, i) => (i === 12 ? 0x41 : b)),
      ),
    ],
    ["a PDF", new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])],
  ])("returns null for %s", (_name, bytes) => {
    expect(readImageDimensions(bytes)).toBeNull();
  });
});
