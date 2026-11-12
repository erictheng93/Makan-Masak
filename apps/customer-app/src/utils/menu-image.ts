const WIDTHS = [
  ["thumbnail", 150],
  ["small", 300],
  ["medium", 600],
  ["large", 1200],
] as const;

type VariantName = (typeof WIDTHS)[number][0];

export interface MenuImageAttrs {
  src: string | undefined;
  srcset?: string;
  sizes?: string;
}

// Relative paths get the image host; absolute URLs pass through untouched.
export function resolveImageUrl(url: string): string {
  return url.startsWith("/")
    ? `${import.meta.env.VITE_IMAGE_BASE_URL || ""}${url}`
    : url;
}

// Older rows store variants as a JSON string, null, or with keys missing.
function parseVariants(raw: unknown): Partial<Record<VariantName, string>> {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object") return {};
  const out: Partial<Record<VariantName, string>> = {};
  for (const [name] of WIDTHS) {
    const url = (value as Record<string, unknown>)[name];
    if (typeof url === "string" && url) out[name] = url;
  }
  return out;
}

/**
 * `sizes` must be the laid-out width in px (not rem): the preload scanner
 * resolves rem against 16px before this app's 14px mobile root applies.
 * `fallback` is the variant used for `src` when the browser ignores srcset.
 */
export function menuImageAttrs(
  imageUrl: string | null | undefined,
  imageVariants: unknown,
  sizes: string,
  fallback: VariantName = "medium",
  // Largest variant worth offering. A 3x phone asks for three times the CSS
  // width, which on a card buys nothing visible for twice the bytes.
  largest: VariantName = "large",
): MenuImageAttrs {
  const variants = parseVariants(imageVariants);
  const limit = WIDTHS.findIndex(([name]) => name === largest);
  const srcset = WIDTHS.slice(0, limit + 1)
    .filter(([name]) => variants[name])
    .map(([name, w]) => `${resolveImageUrl(variants[name]!)} ${w}w`)
    .join(", ");
  const src = variants[fallback] || variants.medium || imageUrl || undefined;

  return {
    src: src ? resolveImageUrl(src) : undefined,
    ...(srcset ? { srcset, sizes } : {}),
  };
}
