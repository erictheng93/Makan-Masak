import { ref } from "vue";
import { useI18n } from "@/i18n";
import { getAuthToken } from "@/utils/authTokenProvider";

export type ImageUploadState = "idle" | "uploading" | "success" | "error";
export type ImageVariantKey = "thumbnail" | "small" | "medium" | "large";
export type ImageVariants = Partial<Record<ImageVariantKey, string>>;

export interface ImageUploadResult {
  imageId: string;
  imageUrl: string;
  imageVariants: ImageVariants;
}

type UploadResponse = {
  success?: boolean;
  data?: {
    id?: string;
    variants?: Record<string, string | undefined>;
  };
};

// Input cap only: the photo is re-encoded in the browser before upload, so a
// 48MP phone shot never crosses the wire at full size.
const MAX_FILE_SIZE_BYTES = 30 * 1024 * 1024;
// When the browser cannot re-encode, the raw file is sent under all five
// form keys, and image-processor rejects requests over
// MAX_UPLOAD_REQUEST_SIZE_MB (12MB). 5 x 2MB stays under it.
const RAW_FALLBACK_MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const VARIANT_KEYS: ImageVariantKey[] = [
  "thumbnail",
  "small",
  "medium",
  "large",
];

// Largest first: each size is drawn from the previous canvas, so the full
// resolution bitmap is decoded exactly once. "file" is what image-processor
// stores as the "original" variant.
const CLIENT_VARIANT_SPECS: Array<{
  key: ImageVariantKey | "file";
  maxSize: number;
}> = [
  { key: "file", maxSize: 2048 },
  { key: "large", maxSize: 1200 },
  { key: "medium", maxSize: 600 },
  { key: "small", maxSize: 300 },
  { key: "thumbnail", maxSize: 150 },
];
const ENCODE_QUALITY = 0.85;

function pickSupportedVariants(
  variants: Record<string, string | undefined> = {},
): ImageVariants {
  return VARIANT_KEYS.reduce<ImageVariants>((picked, key) => {
    const value = variants[key];
    if (value) {
      picked[key] = value;
    }
    return picked;
  }, {});
}

const canvasToBlob = (canvas: HTMLCanvasElement, type: string) =>
  new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, type, ENCODE_QUALITY);
  });

// Safari before 17 cannot encode WebP and silently hands back a PNG, which
// would be several MB at 2048px; fall back to JPEG instead.
async function encodeCanvas(canvas: HTMLCanvasElement): Promise<Blob | null> {
  const webp = await canvasToBlob(canvas, "image/webp");
  if (webp?.type === "image/webp") {
    return webp;
  }
  const jpeg = await canvasToBlob(canvas, "image/jpeg");
  return jpeg?.type === "image/jpeg" ? jpeg : null;
}

/**
 * Decodes the photo once and re-encodes every upload size from it.
 * Returns null when the browser cannot do that, so the caller can fall back.
 */
async function compressImage(
  file: File,
): Promise<Array<{ key: string; file: File }> | null> {
  if (
    typeof createImageBitmap !== "function" ||
    typeof document === "undefined"
  ) {
    return null;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }

  const baseName = file.name.replace(/\.[^/.]+$/, "");
  // Cache before the loop: a closed ImageBitmap reports 0×0 (HTML spec), and
  // the first iteration closes it.
  const { width, height } = bitmap;
  const longEdge = Math.max(width, height);
  const outputs: Array<{ key: string; file: File }> = [];
  let source: CanvasImageSource = bitmap;

  try {
    for (const { key, maxSize } of CLIENT_VARIANT_SPECS) {
      const scale = Math.min(1, maxSize / longEdge);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        return null;
      }
      context.imageSmoothingQuality = "high";
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      // Free the full-resolution pixels (~190MB for 48MP) as soon as the
      // first, largest canvas holds a copy.
      bitmap.close?.();
      source = canvas;

      const blob = await encodeCanvas(canvas);
      if (!blob) {
        return null;
      }
      const ext = blob.type === "image/webp" ? "webp" : "jpg";
      outputs.push({
        key,
        file: new File([blob], `${key}-${baseName}.${ext}`, {
          type: blob.type,
          lastModified: Date.now(),
        }),
      });
    }
  } catch {
    return null;
  } finally {
    bitmap.close?.();
  }

  return outputs;
}

async function buildUploadFormData(file: File): Promise<FormData | null> {
  const formData = new FormData();
  const compressed = await compressImage(file);

  if (compressed) {
    for (const output of compressed) {
      formData.append(output.key, output.file);
    }
    return formData;
  }

  // The worker only stores the variants it receives and the menu needs
  // "medium", so the raw file has to stand in for every size.
  if (file.size > RAW_FALLBACK_MAX_BYTES) {
    return null;
  }
  for (const { key } of CLIENT_VARIANT_SPECS) {
    formData.append(key, file);
  }
  return formData;
}

export function useImageUpload() {
  const { t } = useI18n();
  const state = ref<ImageUploadState>("idle");
  const errorMessage = ref("");
  const result = ref<ImageUploadResult | null>(null);

  const setError = (messageKey: string) => {
    state.value = "error";
    errorMessage.value = t(messageKey);
    result.value = null;
  };

  const upload = async (
    file: File,
    options: { restaurantId?: string | null } = {},
  ): Promise<ImageUploadResult | null> => {
    errorMessage.value = "";
    result.value = null;

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      setError("menu.upload.invalidType");
      return null;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError("menu.upload.fileTooLarge");
      return null;
    }

    state.value = "uploading";

    try {
      const formData = await buildUploadFormData(file);
      if (!formData) {
        setError("menu.upload.unreadable");
        return null;
      }

      // Platform admins (role 0) carry restaurantId: null in their token, so
      // apps/image-processor resolves the owning restaurant from this query
      // param instead. Without it every admin upload is rejected with 403
      // "Restaurant access is required for image uploads". Shop owners ignore
      // the param — the worker always trusts their token for role !== 0.
      const query = new URLSearchParams({ category: "menu" });
      if (options.restaurantId) {
        query.set("restaurantId", options.restaurantId);
      }

      const response = await fetch(
        `${import.meta.env.VITE_IMAGE_API_URL}/images/upload?${query.toString()}`,
        {
          method: "POST",
          // getAuthToken reads the auth-client storage directly — the Pinia
          // token ref can lag behind interceptor/proactive refreshes.
          headers: {
            Authorization: `Bearer ${getAuthToken() ?? ""}`,
          },
          body: formData,
        },
      );

      if (!response.ok) {
        throw new Error(`Image upload failed with HTTP ${response.status}`);
      }

      const body = (await response.json()) as UploadResponse;
      const variants = pickSupportedVariants(body.data?.variants);
      const imageId = body.data?.id;
      const imageUrl = variants.medium;

      if (!body.success || !imageId || !imageUrl) {
        throw new Error("Image upload response missing required data");
      }

      result.value = {
        imageId,
        imageUrl,
        imageVariants: variants,
      };
      state.value = "success";
      return result.value;
    } catch {
      setError("menu.upload.failed");
      return null;
    }
  };

  const reset = () => {
    state.value = "idle";
    errorMessage.value = "";
    result.value = null;
  };

  return {
    upload,
    reset,
    state,
    errorMessage,
    result,
  };
}
