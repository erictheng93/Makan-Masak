export type PrinterEncoding = "utf8" | "big5" | "gbk";

const tables = new Map<string, Map<string, number[]>>();

// Node only encodes UTF-8, so invert the decoder once per encoding.
function table(encoding: "big5" | "gbk"): Map<string, number[]> {
  let map = tables.get(encoding);
  if (map) return map;
  map = new Map();
  const decoder = new TextDecoder(encoding);
  for (let hi = 0x81; hi <= 0xfe; hi++) {
    for (let lo = 0x40; lo <= 0xfe; lo++) {
      if (lo === 0x7f) continue;
      const ch = decoder.decode(Uint8Array.of(hi, lo));
      if (ch.length && !ch.includes("�") && !map.has(ch)) {
        map.set(ch, [hi, lo]);
      }
    }
  }
  tables.set(encoding, map);
  return map;
}

/**
 * ESC/POS text → bytes. ASCII and control bytes pass through; anything else
 * uses the printer's multi-byte code page, "?" when it has no such glyph.
 * Non-UTF-8 output enters Chinese mode (FS &) right after ESC @.
 */
export function encodeForPrinter(
  commands: string,
  encoding: PrinterEncoding = "utf8",
): Buffer {
  if (encoding === "utf8") return Buffer.from(commands, "utf8");
  const map = table(encoding);
  const bytes: number[] = [];
  for (const ch of commands) {
    const code = ch.codePointAt(0)!;
    bytes.push(...(code < 0x80 ? [code] : (map.get(ch) ?? [0x3f])));
  }
  const init = bytes[0] === 0x1b && bytes[1] === 0x40 ? 2 : 0;
  bytes.splice(init, 0, 0x1c, 0x26);
  return Buffer.from(bytes);
}
