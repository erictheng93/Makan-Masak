import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import imagesRouter from "./images";
import type { Env } from "../types/env";

function buildApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/images", imagesRouter);
  return app;
}

function buildEnv(object: unknown | null): Env {
  return {
    IMAGE_API_BASE_URL: "https://images.test",
    IMAGES_BUCKET: {
      get: vi.fn().mockResolvedValue(object),
    },
  } as unknown as Env;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /images/:imageId/:variant", () => {
  it("streams an R2 object with immutable cache headers and ETag", async () => {
    const object = {
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("image-bytes"));
          controller.close();
        },
      }),
      httpEtag: '"r2-etag"',
      writeHttpMetadata(headers: Headers) {
        headers.set("Content-Type", "image/webp");
      },
    };

    const response = await buildApp().fetch(
      new Request("https://images.test/images/image-1/medium"),
      buildEnv(object),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(response.headers.get("ETag")).toBe('"r2-etag"');
    expect(await response.text()).toBe("image-bytes");
  });

  // Without an edge copy every view re-ran the Worker and read R2 (~0.6–1s).
  it("serves the second view from the edge cache without reading R2", async () => {
    const stored = new Map<string, Response>();
    const put = vi.fn(async (key: Request, response: Response) => {
      stored.set(key.url, response);
    });
    vi.stubGlobal("caches", {
      default: {
        match: vi.fn(async (key: Request) => stored.get(key.url)?.clone()),
        put,
        delete: vi.fn(),
      },
    });
    const env = buildEnv({
      body: new Blob(["image-bytes"]).stream(),
      httpEtag: '"r2-etag"',
      writeHttpMetadata(headers: Headers) {
        headers.set("Content-Type", "image/jpeg");
      },
    });
    const url = "https://images.test/images/image-1/medium?v=2";

    const first = await buildApp().fetch(new Request(url), env);
    expect(await first.text()).toBe("image-bytes");
    await vi.waitFor(() => expect(put).toHaveBeenCalledOnce());
    // The edge copy expires in a day so a deleted image stops being served.
    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://images.test/images/image-1/medium",
      }),
      expect.any(Response),
    );
    expect(put.mock.calls[0][1].headers.get("Cache-Control")).toBe(
      "public, max-age=86400",
    );

    const second = await buildApp().fetch(new Request(url), env);
    expect(second.status).toBe(200);
    expect(await second.text()).toBe("image-bytes");
    expect(second.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(env.IMAGES_BUCKET.get).toHaveBeenCalledOnce();
  });

  it("returns 404 when the R2 object is missing", async () => {
    const response = await buildApp().fetch(
      new Request("https://images.test/images/image-1/missing"),
      buildEnv(null),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: "Image not found",
    });
  });
});
