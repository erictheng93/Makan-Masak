/**
 * Order ids are text UUIDs in production; legacy fixtures and older servers
 * use positive integers. Accept both, and compare them as strings so a
 * number-vs-string or a `Number(uuid)` NaN never silently misses a match.
 */
export const toOrderId = (value: unknown): string | number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  return typeof value === "string" && value.trim() !== "" ? value : null;
};

export const sameOrderId = (a: unknown, b: unknown): boolean =>
  a !== undefined &&
  a !== null &&
  b !== undefined &&
  b !== null &&
  String(a) === String(b);
