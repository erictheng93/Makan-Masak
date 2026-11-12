export interface ImageDimensions {
  width: number;
  height: number;
}

const ascii = (bytes: Uint8Array, offset: number, text: string): boolean => {
  for (let i = 0; i < text.length; i++)
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  return true;
};

const be16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const le16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const le24 = (b: Uint8Array, o: number) => le16(b, o) | (b[o + 2] << 16);
const be32 = (b: Uint8Array, o: number) =>
  b[o] * 0x1000000 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);

function jpegDimensions(b: Uint8Array): ImageDimensions | null {
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    // Fill bytes before a marker, and markers that carry no length.
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    // Start of scan or end of image: no frame header came before the pixels.
    if (marker === 0xda || marker === 0xd9) return null;
    const length = be16(b, i + 2);
    if (length < 2) return null;
    // SOF0-SOF15 hold the frame size; C4, C8 and CC share the range but are
    // Huffman tables, a reserved marker and arithmetic conditioning.
    const isFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isFrame) {
      if (i + 8 >= b.length) return null;
      return { height: be16(b, i + 5), width: be16(b, i + 7) };
    }
    i += 2 + length;
  }
  return null;
}

function webpDimensions(b: Uint8Array): ImageDimensions | null {
  if (b.length < 30) return null;
  if (ascii(b, 12, "VP8X"))
    return { width: le24(b, 24) + 1, height: le24(b, 27) + 1 };
  if (ascii(b, 12, "VP8L") && b[20] === 0x2f) {
    const bits = le16(b, 21) | (le16(b, 23) << 16);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (
    ascii(b, 12, "VP8 ") &&
    b[23] === 0x9d &&
    b[24] === 0x01 &&
    b[25] === 0x2a
  )
    return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
  return null;
}

/**
 * Reads the pixel size a JPEG, PNG, GIF or WebP declares in its header.
 * Returns null when the bytes are not one of those or the header is cut short,
 * so a caller can treat "cannot tell" as "not an image we accept".
 */
export function readImageDimensions(bytes: Uint8Array): ImageDimensions | null {
  let size: ImageDimensions | null = null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    size = jpegDimensions(bytes);
  } else if (
    bytes.length >= 24 &&
    be32(bytes, 0) === 0x89504e47 &&
    ascii(bytes, 12, "IHDR")
  ) {
    size = { width: be32(bytes, 16), height: be32(bytes, 20) };
  } else if (
    bytes.length >= 10 &&
    (ascii(bytes, 0, "GIF87a") || ascii(bytes, 0, "GIF89a"))
  ) {
    size = { width: le16(bytes, 6), height: le16(bytes, 8) };
  } else if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) {
    size = webpDimensions(bytes);
  }
  return size && size.width > 0 && size.height > 0 ? size : null;
}
