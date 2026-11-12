// Smallest byte sequences that carry a real, readable header for each format.
// Test-only: enough for the upload path, not decodable pictures.

const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number) => [n >>> 24, (n >> 16) & 0xff, ...be16(n & 0xffff)];
const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const text = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

export const jpegBytes = (width = 4, height = 3, tail = 0x00): Uint8Array =>
  new Uint8Array([
    ...[0xff, 0xd8],
    // APP0 first, as real files have: the frame header is not the first segment.
    ...[0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46],
    ...[0xff, 0xc0, 0x00, 0x0b, 0x08, ...be16(height), ...be16(width)],
    ...[0x01, 0x01, 0x11, 0x00, tail],
  ]);

export const pngBytes = (width: number, height: number): Uint8Array =>
  new Uint8Array([
    ...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    ...be32(13),
    ...text("IHDR"),
    ...be32(width),
    ...be32(height),
    ...[8, 6, 0, 0, 0],
  ]);

export const gifBytes = (width: number, height: number): Uint8Array =>
  new Uint8Array([...text("GIF89a"), ...le16(width), ...le16(height), 0, 0, 0]);

const riff = (chunk: number[]) =>
  new Uint8Array([...text("RIFF"), 0, 0, 0, 0, ...text("WEBP"), ...chunk]);

export const webpLossyBytes = (width: number, height: number): Uint8Array =>
  riff([
    ...text("VP8 "),
    ...[0, 0, 0, 0],
    ...[0, 0, 0, 0x9d, 0x01, 0x2a],
    ...le16(width),
    ...le16(height),
  ]);

export const webpLosslessBytes = (
  width: number,
  height: number,
): Uint8Array => {
  const bits = (width - 1) | ((height - 1) << 14);
  return riff([
    ...text("VP8L"),
    ...[0, 0, 0, 0],
    0x2f,
    ...le16(bits & 0xffff),
    ...le16(bits >>> 16),
    ...[0, 0, 0, 0, 0],
  ]);
};

export const webpExtendedBytes = (width: number, height: number): Uint8Array =>
  riff([
    ...text("VP8X"),
    ...[10, 0, 0, 0],
    ...[0, 0, 0, 0],
    ...le16((width - 1) & 0xffff),
    (width - 1) >> 16,
    ...le16((height - 1) & 0xffff),
    (height - 1) >> 16,
  ]);
