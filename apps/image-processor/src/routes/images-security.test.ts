import { staffAuthDatabase } from "../__tests__/staff-auth-fixture";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sign } from "hono/jwt";
import { Hono } from "hono";
import imagesRouter from "./images";
import { ImageService } from "../services/image-service";
import type { Env } from "../types/env";

const JWT_SECRET = "test-jwt-secret-with-at-least-32-chars";
const USER_UUID = "01890a5d-ac96-774b-bcce-b302099a8057";
const IMAGE_ID = "01890a5d-ac96-774b-bcce-b302099a8059";

async function token(role: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    {
      sub: USER_UUID,
      username: "u",
      role,
      restaurantId: null,
      iat: now,
      exp: now + 3600,
    },
    JWT_SECRET,
  );
}

function call(path: string, role: number, init: RequestInit = {}) {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/images", imagesRouter);
  return token(role).then((t) =>
    app.fetch(
      new Request(`https://images.test/images${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${t}`,
          "Content-Type": "application/json",
        },
      }),
      {
        JWT_SECRET,
        IMAGE_API_BASE_URL: "https://images.test",
        DB: staffAuthDatabase({
          id: USER_UUID,
          username: "u",
          role,
          restaurant_id: null,
          is_active: 1,
          token_version: 1,
        }),
      } as unknown as Env,
      { waitUntil: vi.fn(), passThroughException: vi.fn() } as never,
    ),
  );
}

afterEach(() => vi.restoreAllMocks());

describe("image-processor security regressions", () => {
  it("GET /images returns 403 for a non-admin without restaurantId", async () => {
    const list = vi.spyOn(ImageService.prototype, "listImages");
    const res = await call("", 2);
    expect(res.status).toBe(403);
    expect(list).not.toHaveBeenCalled();
  });

  it("PUT /images/:id ignores client-supplied variants", async () => {
    const update = vi
      .spyOn(ImageService.prototype, "updateImageMetadata")
      .mockResolvedValue({ success: true });
    await call(`/${IMAGE_ID}`, 0, {
      method: "PUT",
      body: JSON.stringify({
        altText: "x",
        variants: { original: "https://evil.example/" },
      }),
    });
    expect(update).toHaveBeenCalledWith(IMAGE_ID, { altText: "x" });
  });

  it("GET /images/:id/view redirects only to the generated URL", async () => {
    vi.spyOn(ImageService.prototype, "getImageMetadata").mockResolvedValue({
      success: true,
      data: {
        variants: {
          original: "https://evil.example/o",
          medium: "https://evil.example/m",
        },
      },
    } as never);
    vi.spyOn(ImageService.prototype, "recordImageView").mockResolvedValue(
      undefined as never,
    );
    const known = await call(`/${IMAGE_ID}/view?variant=medium`, 0);
    expect(known.status).toBe(302);
    expect(known.headers.get("Location")).toBe(
      `https://images.test/images/${IMAGE_ID}/medium`,
    );
    const unknown = await call(`/${IMAGE_ID}/view?variant=nope`, 0);
    expect(unknown.headers.get("Location")).toBe(
      `https://images.test/images/${IMAGE_ID}/original`,
    );
  });
});
