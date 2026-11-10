// @vitest-environment jsdom

import { ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useImageUpload } from "./useImageUpload";

vi.mock("@/utils/authTokenProvider", () => ({
  setAuthTokenProvider: vi.fn(),
  getAuthToken: () => "admin-token",
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: ref("zh-TW"),
  }),
}));

describe("useImageUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VITE_IMAGE_API_URL", "http://localhost:8790");
    globalThis.fetch = vi.fn();
  });

  it("rejects unsupported file types without sending a request", async () => {
    const uploader = useImageUpload();
    const file = new File(["not an image"], "menu.pdf", {
      type: "application/pdf",
    });

    const result = await uploader.upload(file);

    expect(result).toBeNull();
    expect(uploader.state.value).toBe("error");
    expect(uploader.errorMessage.value).toBe("menu.upload.invalidType");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects files larger than 30MB without sending a request", async () => {
    const uploader = useImageUpload();
    const file = new File([new Uint8Array(31 * 1024 * 1024)], "large.jpg", {
      type: "image/jpeg",
    });

    const result = await uploader.upload(file);

    expect(result).toBeNull();
    expect(uploader.state.value).toBe("error");
    expect(uploader.errorMessage.value).toBe("menu.upload.fileTooLarge");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports a photo it cannot open instead of calling it too large", async () => {
    // jsdom has no createImageBitmap, so this exercises the no-compression path.
    const uploader = useImageUpload();
    const file = new File([new Uint8Array(3 * 1024 * 1024)], "big.jpg", {
      type: "image/jpeg",
    });

    const result = await uploader.upload(file);

    expect(result).toBeNull();
    expect(uploader.errorMessage.value).toBe("menu.upload.unreadable");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uploads all four client variants and keeps only supported variants", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          id: "image-1",
          variants: {
            thumbnail: "https://cdn.example/thumb.webp",
            small: "https://cdn.example/small.webp",
            medium: "https://cdn.example/medium.webp",
            large: "https://cdn.example/large.webp",
            original: "https://cdn.example/original.webp",
          },
        },
      }),
    } as Response);
    const uploader = useImageUpload();
    const file = new File(["jpeg bytes"], "menu.jpg", {
      type: "image/jpeg",
    });

    const result = await uploader.upload(file);

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8790/images/upload?category=menu",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer admin-token",
        }),
        body: expect.any(FormData),
      }),
    );
    const request = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect((request.body as FormData).get("file")).toBe(file);
    expect((request.body as FormData).get("thumbnail")).toBe(file);
    expect((request.body as FormData).get("small")).toBe(file);
    expect((request.body as FormData).get("medium")).toBe(file);
    expect((request.body as FormData).get("large")).toBe(file);
    expect(result).toEqual({
      imageId: "image-1",
      imageUrl: "https://cdn.example/medium.webp",
      imageVariants: {
        thumbnail: "https://cdn.example/thumb.webp",
        small: "https://cdn.example/small.webp",
        medium: "https://cdn.example/medium.webp",
        large: "https://cdn.example/large.webp",
      },
    });
    expect(uploader.result.value).toEqual(result);
    expect(uploader.state.value).toBe("success");
  });

  it("forwards the managed restaurant id so platform admins are not rejected", async () => {
    // A role 0 token carries restaurantId: null, so apps/image-processor reads
    // the target restaurant off this query param; omitting it returns 403
    // "Restaurant access is required for image uploads".
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { id: "image-1", variants: { medium: "https://cdn/m.webp" } },
      }),
    } as Response);
    const uploader = useImageUpload();
    const file = new File(["jpeg bytes"], "menu.jpg", { type: "image/jpeg" });

    await uploader.upload(file, {
      restaurantId: "019f9373-397c-7202-99d6-24c61976f3ff",
    });

    const [url] = vi.mocked(fetch).mock.calls[0] ?? [];
    const query = new URL(String(url)).searchParams;
    expect(query.get("category")).toBe("menu");
    expect(query.get("restaurantId")).toBe(
      "019f9373-397c-7202-99d6-24c61976f3ff",
    );
  });

  it("omits restaurantId when no restaurant is in context", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { id: "image-1", variants: { medium: "https://cdn/m.webp" } },
      }),
    } as Response);
    const uploader = useImageUpload();
    const file = new File(["jpeg bytes"], "menu.jpg", { type: "image/jpeg" });

    await uploader.upload(file, { restaurantId: null });

    const [url] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(new URL(String(url)).searchParams.has("restaurantId")).toBe(false);
  });

  it("enters error state when the upload request fails", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ success: false }),
    } as Response);
    const uploader = useImageUpload();
    const file = new File(["png bytes"], "menu.png", {
      type: "image/png",
    });

    const result = await uploader.upload(file);

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8790/images/upload?category=menu",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer admin-token",
        }),
        body: expect.any(FormData),
      }),
    );
    expect(result).toBeNull();
    expect(uploader.state.value).toBe("error");
    expect(uploader.errorMessage.value).toBe("menu.upload.failed");
  });

  describe("in-browser compression", () => {
    const drawn: Array<[number, number]> = [];
    let close: ReturnType<typeof vi.fn>;
    let encodeAs: (requested: string) => string;

    beforeEach(() => {
      drawn.length = 0;
      encodeAs = (requested) => requested;
      vi.stubGlobal(
        "createImageBitmap",
        vi.fn(async () => {
          // Like a real ImageBitmap, a closed one reports 0×0.
          const bitmap = { width: 8000, height: 6000, close: vi.fn() };
          bitmap.close.mockImplementation(() => {
            bitmap.width = 0;
            bitmap.height = 0;
          });
          close = bitmap.close;
          return bitmap;
        }),
      );
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
        () =>
          ({
            imageSmoothingQuality: "low",
            drawImage: (
              _src: unknown,
              _x: number,
              _y: number,
              w: number,
              h: number,
            ) => drawn.push([w, h]),
          }) as unknown as CanvasRenderingContext2D,
      );
      vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
        (cb, type) => cb(new Blob(["px"], { type: encodeAs(type ?? "") })),
      );
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { id: "image-1", variants: { medium: "https://cdn/m.webp" } },
        }),
      } as Response);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    const sentForm = () =>
      (vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).body as FormData;

    it("decodes a large phone photo once and sends only re-encoded sizes", async () => {
      const uploader = useImageUpload();
      const file = new File([new Uint8Array(20 * 1024 * 1024)], "dish.jpg", {
        type: "image/jpeg",
      });

      await uploader.upload(file);

      expect(createImageBitmap).toHaveBeenCalledOnce();
      expect(close).toHaveBeenCalled();
      expect(drawn).toEqual([
        [2048, 1536],
        [1200, 900],
        [600, 450],
        [300, 225],
        [150, 113],
      ]);
      const form = sentForm();
      const original = form.get("file") as File;
      expect(original).not.toBe(file);
      expect(original.type).toBe("image/webp");
      expect(original.name).toBe("file-dish.webp");
      for (const key of ["large", "medium", "small", "thumbnail"]) {
        expect((form.get(key) as File).type).toBe("image/webp");
      }
      expect(uploader.state.value).toBe("success");
    });

    it("falls back to JPEG where the browser cannot encode WebP", async () => {
      encodeAs = (requested) =>
        requested === "image/webp" ? "image/png" : requested;
      const uploader = useImageUpload();

      await uploader.upload(
        new File(["jpeg"], "dish.jpg", { type: "image/jpeg" }),
      );

      const original = sentForm().get("file") as File;
      expect(original.type).toBe("image/jpeg");
      expect(original.name).toBe("file-dish.jpg");
    });
  });
});
