import { staffAuthDatabase } from "../__tests__/staff-auth-fixture";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sign } from "hono/jwt";
import { Hono } from "hono";
import imagesRouter from "./images";
import type { Env } from "../types/env";
import { jpegBytes, pngBytes } from "../utils/image-fixtures";

const mocks = vi.hoisted(() => ({
  createImage: vi.fn(),
  recordImageView: vi.fn(),
  uuidv7: vi.fn(),
}));

vi.mock("uuid", () => ({
  v7: mocks.uuidv7,
}));

vi.mock("@makanmasak/database", () => ({
  ImageService: vi.fn().mockImplementation(function ImageService() {
    return {
      createImage: mocks.createImage,
      recordImageView: mocks.recordImageView,
    };
  }),
}));

const JWT_SECRET = "test-jwt-secret-with-at-least-32-chars";
const ADMIN_UUID = "01890a5d-ac96-774b-bcce-b302099a8057";
const RESTAURANT_UUID = "01890a5d-ac96-774b-bcce-b302099a8058";
const IMAGE_UUID = "01890a5d-ac96-774b-bcce-b302099a8059";

async function tokenForRole(role: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    {
      sub: ADMIN_UUID,
      username: "admin",
      role,
      restaurantId: role === 0 ? null : RESTAURANT_UUID,
      iat: now,
      exp: now + 3600,
    },
    JWT_SECRET,
  );
}

async function adminToken(): Promise<string> {
  return tokenForRole(0);
}

function buildApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/images", imagesRouter);
  return app;
}

function buildEnv(role = 0) {
  return {
    JWT_SECRET,
    IMAGE_API_BASE_URL: "https://images.test",
    MAX_IMAGE_SIZE_MB: "1",
    ALLOWED_MIME_TYPES: "image/jpeg,image/png,image/webp,image/gif",
    MAX_UPLOADS_PER_MINUTE: "20",
    IMAGE_CACHE: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    IMAGES_BUCKET: {
      put: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    DB: staffAuthDatabase({
      id: ADMIN_UUID,
      username: "admin",
      role,
      restaurant_id: role === 0 ? null : RESTAURANT_UUID,
      is_active: 1,
      token_version: 1,
    }),
  } as unknown as Env;
}

function image(bytes: Uint8Array, name: string, type: string): File {
  const copy: Uint8Array<ArrayBuffer> = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy.buffer], name, { type });
}

async function upload(env: Env, files: Record<string, File>) {
  const formData = new FormData();
  for (const [key, file] of Object.entries(files)) formData.set(key, file);
  return buildApp().fetch(
    new Request(
      `https://images.test/images/upload?restaurantId=${RESTAURANT_UUID}&category=menu`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${await adminToken()}` },
        body: formData,
      },
    ),
    env,
    {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext,
  );
}

describe("POST /images/upload image dimensions", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.uuidv7.mockReturnValue(IMAGE_UUID);
    mocks.createImage.mockResolvedValue({ id: IMAGE_UUID });
  });

  it("records the original's real pixel size", async () => {
    const env = buildEnv();
    const response = await upload(env, {
      file: image(jpegBytes(2048, 1365), "plate.jpg", "image/jpeg"),
      thumbnail: image(jpegBytes(150, 100), "plate-thumb.jpg", "image/jpeg"),
    });

    expect(response.status).toBe(201);
    expect(mocks.createImage).toHaveBeenCalledOnce();
    expect(mocks.createImage).toHaveBeenCalledWith(
      expect.objectContaining({ width: 2048, height: 1365 }),
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("accepts an image exactly at the limit", async () => {
    const response = await upload(buildEnv(), {
      file: image(pngBytes(8192, 8192), "big.png", "image/png"),
    });

    expect(response.status).toBe(201);
  });

  it("rejects an original that declares more pixels than allowed, before storing anything", async () => {
    const env = buildEnv();
    const response = await upload(env, {
      file: image(pngBytes(60000, 60000), "bomb.png", "image/png"),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      variant: "original",
      width: 60000,
      height: 60000,
      maxDimension: 8192,
    });
    expect(env.IMAGES_BUCKET.put).not.toHaveBeenCalled();
    expect(mocks.createImage).not.toHaveBeenCalled();
  });

  it("rejects the whole upload when only a variant is oversized", async () => {
    const env = buildEnv();
    const response = await upload(env, {
      file: image(jpegBytes(2048, 1365), "plate.jpg", "image/jpeg"),
      large: image(jpegBytes(8193, 100), "plate-large.jpg", "image/jpeg"),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      variant: "large",
    });
    expect(env.IMAGES_BUCKET.put).not.toHaveBeenCalled();
  });

  it("stores an image whose size cannot be read, without dimensions, and logs it", async () => {
    const env = buildEnv();
    const response = await upload(env, {
      file: image(
        new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
        "odd.jpg",
        "image/jpeg",
      ),
    });

    expect(response.status).toBe(201);
    expect(mocks.createImage).toHaveBeenCalledWith(
      expect.objectContaining({ width: undefined, height: undefined }),
    );
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("variant=original"),
    );
  });
});
