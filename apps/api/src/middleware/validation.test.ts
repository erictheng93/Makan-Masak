import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  commonSchemas,
  validateBody,
  validateOptionalBody,
} from "./validation";
import { ApiError } from "../shared/utils/api-error";

describe("common validation schemas", () => {
  it("bounds pagination result size and offset cost", () => {
    expect(commonSchemas.paginationQuery.parse({})).toEqual({
      page: 1,
      limit: 20,
    });
    expect(
      commonSchemas.paginationQuery.parse({ page: "1000", limit: "100" }),
    ).toEqual({ page: 1000, limit: 100 });

    expect(() =>
      commonSchemas.paginationQuery.parse({ limit: "101" }),
    ).toThrow();
    expect(() =>
      commonSchemas.paginationQuery.parse({ page: "1001" }),
    ).toThrow();
  });
});

// The two shapes that #355 is about: a schema whose every field is optional
// (an absent body is a legitimate call) and one with a required field (an
// absent body must be rejected — but by the schema, naming the field).
const allOptionalSchema = z.object({ comments: z.string().optional() });
const requiredFieldSchema = z.object({ reason: z.string().min(1) });

interface ErrorBody {
  success: false;
  error: { code: string; message: string; details?: { field: string }[] };
}

/**
 * Mirrors the `app.onError` in app-factory.ts. Without it Hono's default
 * handler flattens every throw to a bare 500 and the middleware's own 400s
 * would be untestable — they are thrown, not returned.
 */
function createApp(middleware: MiddlewareHandler, handler?: MiddlewareHandler) {
  const app = new Hono();
  app.post(
    "/",
    middleware,
    // The validator is passed in as a bare MiddlewareHandler, so Hono cannot
    // infer `validatedBody` into this app's Variables the way an inline
    // `app.post(path, validateBody(schema), handler)` chain does. Reading it
    // through a narrowed `c.get` is the same escape hatch rateLimiter.ts uses.
    handler ??
      ((c) =>
        c.json({
          success: true,
          data: (c.get as (key: string) => Record<string, unknown>)(
            "validatedBody",
          ),
        })),
  );
  app.onError((err, c) =>
    err instanceof ApiError
      ? c.json(
          {
            success: false,
            error: {
              code: err.code,
              message: err.message,
              ...(err.details !== undefined && { details: err.details }),
            },
          },
          err.status as 400,
        )
      : c.text("Internal Server Error", 500),
  );
  return app;
}

function post(app: Hono, init: RequestInit = {}) {
  return app.request("/", { method: "POST", ...init });
}

describe("validateBody", () => {
  it("treats an absent body as {} and lets an all-optional schema pass", async () => {
    const res = await post(createApp(validateBody(allOptionalSchema)));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({ success: true, data: {} }),
    );
  });

  it("treats an empty-string body as {} as well", async () => {
    const res = await post(createApp(validateBody(allOptionalSchema)), {
      body: "",
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({ success: true, data: {} }),
    );
  });

  it("lets the schema reject an absent body, naming the missing field", async () => {
    const res = await post(createApp(validateBody(requiredFieldSchema)));

    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "reason" })]),
    );
  });

  it("still answers INVALID_JSON for a non-empty unparseable body", async () => {
    const res = await post(createApp(validateBody(allOptionalSchema)), {
      body: '{"a":',
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("INVALID_JSON");
  });

  it("validates a well-formed body", async () => {
    const res = await post(createApp(validateBody(requiredFieldSchema)), {
      body: JSON.stringify({ reason: "sick", extra: "dropped" }),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({ success: true, data: { reason: "sick" } }),
    );
  });

  it("leaves the request body readable by the handler", async () => {
    // ~200 call sites sit behind this middleware; some handlers re-read the
    // raw request. Reading through a clone is what keeps that working.
    const app = createApp(validateBody(requiredFieldSchema), async (c) => {
      const reread = await c.req.json();
      return c.json({ success: true, data: reread });
    });

    const res = await post(app, {
      body: JSON.stringify({ reason: "sick" }),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({ data: { reason: "sick" } }),
    );
  });

  it("still validates when an upstream middleware already consumed the body", async () => {
    // c.req.json() upstream disturbs c.req.raw, so the clone throws; the
    // middleware has to fall back to Hono's own cached copy rather than
    // reporting the request as malformed.
    const app = new Hono();
    const consumeUpstream: MiddlewareHandler = async (c, next) => {
      await c.req.json();
      await next();
    };
    app.post("/", consumeUpstream, validateBody(requiredFieldSchema), (c) =>
      c.json({ success: true, data: c.get("validatedBody") }),
    );
    app.onError((err, c) =>
      err instanceof ApiError
        ? c.json(
            { success: false, error: { code: err.code, message: err.message } },
            err.status as 400,
          )
        : c.text("Internal Server Error", 500),
    );

    const res = await post(app, {
      body: JSON.stringify({ reason: "sick" }),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({ data: { reason: "sick" } }),
    );
  });
});

describe("validateOptionalBody", () => {
  it("still accepts an absent body", async () => {
    const res = await post(createApp(validateOptionalBody(allOptionalSchema)));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({ success: true, data: {} }),
    );
  });

  it("still validates a body that is present", async () => {
    const res = await post(createApp(validateOptionalBody(allOptionalSchema)), {
      body: JSON.stringify({ comments: 42 }),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});
