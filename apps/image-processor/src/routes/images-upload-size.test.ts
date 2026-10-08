import { staffAuthDatabase } from "../__tests__/staff-auth-fixture";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sign } from "hono/jwt";
import { Hono } from "hono";
import imagesRouter from "./images";
import type { Env } from "../types/env";

const JWT_SECRET = "test-jwt-secret-with-at-least-32-chars";
const ADMIN_UUID = "01890a5d-ac96-774b-bcce-b302099a8057";
const RESTAURANT_UUID = "01890a5d-ac96-774b-bcce-b302099a8058";

async function adminToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    {
      sub: ADMIN_UUID,
      username: "admin",
      role: 0,
      restaurantId: null,
      iat: now,
      exp: now + 3600,
    },
    JWT_SECRET,
  );
}

function buildEnv(): Env {
  return {
    JWT_SECRET,
    DB: staffAuthDatabase(),
    // The post-parse check must still enforce the 1MB image limit even though
    // the request limit allows multipart overhead.
    MAX_IMAGE_SIZE_MB: "1",
    MAX_UPLOAD_REQUEST_SIZE_MB: "2",
    ALLOWED_MIME_TYPES: "image/jpeg,image/png,image/webp,image/gif",
    MAX_UPLOADS_PER_MINUTE: "20",
  } as unknown as Env;
}

// Build a multipart/form-data body delivered as a stream so the runtime does
// NOT attach a Content-Length header — reproducing the omitted-header case the
// header-only middleware check cannot catch.
function streamedMultipartRequest(
  token: string,
  fileBytes: Uint8Array,
): Request {
  const boundary = "----imgprocessortestboundary";
  const enc = new TextEncoder();
  const header = enc.encode(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="big.jpg"\r\n` +
      `Content-Type: image/jpeg\r\n\r\n`,
  );
  const footer = enc.encode(`\r\n--${boundary}--\r\n`);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(header);
      controller.enqueue(fileBytes);
      controller.enqueue(footer);
      controller.close();
    },
  });

  return new Request("https://images.test/images/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      // Intentionally NO Content-Length header.
    },
    body: stream,
    // Required by undici/Workers when the body is a stream.
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

function multipartRequest(token: string, formData: FormData): Request {
  return new Request(
    `https://images.test/images/upload?restaurantId=${RESTAURANT_UUID}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    },
  );
}

function imageFile(bytes: Uint8Array, name: string, type = "image/jpeg"): File {
  const copy: Uint8Array<ArrayBuffer> = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy.buffer], name, { type });
}

describe("POST /images/upload size enforcement", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  it("rejects an oversized file even when Content-Length is missing", async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.route("/images", imagesRouter);
    const token = await adminToken();

    // ~1.2MB, valid JPEG magic bytes so securityScan passes.
    const fileBytes = new Uint8Array(1_200_000);
    fileBytes[0] = 0xff;
    fileBytes[1] = 0xd8;
    fileBytes[2] = 0xff;

    const response = await app.fetch(
      streamedMultipartRequest(token, fileBytes),
      buildEnv(),
    );

    expect(response.status).toBe(413);
    const body = (await response.json()) as {
      success: boolean;
      error: string;
      maxSize?: number;
    };
    expect(body.success).toBe(false);
    expect(body.error).toContain("File too large");
    expect(body.maxSize).toBe(1);
  });

  it("rejects a multipart request above the separate request limit", async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.route("/images", imagesRouter);
    const token = await adminToken();
    const validJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
    const formData = new FormData();
    formData.set("file", imageFile(validJpeg, "original.jpg"));

    const response = await app.fetch(
      new Request(
        `https://images.test/images/upload?restaurantId=${RESTAURANT_UUID}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Length": String(2.1 * 1024 * 1024),
          },
          body: formData,
        },
      ),
      buildEnv(),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: "File too large. Maximum size: 2MB",
      maxSize: 2,
    });
  });

  it("rejects an upload variant whose field name is not allowlisted", async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.route("/images", imagesRouter);
    const token = await adminToken();
    const validJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
    const formData = new FormData();
    formData.set("file", imageFile(validJpeg, "original.jpg"));
    formData.set("../../../escape", imageFile(validJpeg, "escape.jpg"));

    const response = await app.fetch(
      multipartRequest(token, formData),
      buildEnv(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: "Invalid image variant",
      variant: "../../../escape",
    });
  });

  it("rejects an upload variant with a disallowed MIME type", async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.route("/images", imagesRouter);
    const token = await adminToken();
    const validJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
    const formData = new FormData();
    formData.set("file", imageFile(validJpeg, "original.jpg"));
    formData.set(
      "medium",
      imageFile(
        new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        "medium.pdf",
        "application/pdf",
      ),
    );

    const response = await app.fetch(
      multipartRequest(token, formData),
      buildEnv(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: "Invalid file type",
      variant: "medium",
      receivedType: "application/pdf",
    });
  });

  it("rejects an oversized upload variant", async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.route("/images", imagesRouter);
    const token = await adminToken();
    const validJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
    const oversizedVariant = new Uint8Array(1_200_000);
    oversizedVariant[0] = 0xff;
    oversizedVariant[1] = 0xd8;
    oversizedVariant[2] = 0xff;
    const formData = new FormData();
    formData.set("file", imageFile(validJpeg, "original.jpg"));
    formData.set("medium", imageFile(oversizedVariant, "medium.jpg"));

    const response = await app.fetch(
      multipartRequest(token, formData),
      buildEnv(),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: "File too large. Maximum size: 1MB",
      variant: "medium",
      maxSize: 1,
    });
  });
});
