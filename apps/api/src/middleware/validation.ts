import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { badRequest } from "../shared/utils/api-error";

const formatZodDetails = (error: z.ZodError) =>
  error.issues.map((err) => ({
    field: err.path.join("."),
    message: err.message,
    code: err.code,
  }));

export const boundedPositiveIntegerQuery = (
  defaultValue: string,
  max: number,
) =>
  z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .optional()
    .prefault(defaultValue)
    .pipe(z.number().int().min(1).max(max));

export const boundedPageQuery = (defaultValue = "1") =>
  boundedPositiveIntegerQuery(defaultValue, 1000);

export const boundedLimitQuery = (defaultValue = "20", max = 100) =>
  boundedPositiveIntegerQuery(defaultValue, max);

// Standard pagination for new query schemas. Prefer commonSchemas.paginationQuery
// when page/limit/search are the only pagination fields; otherwise compose the
// boundedPageQuery/boundedLimitQuery helpers into feature-specific schemas.

// Generic validators contribute their inferred output type to the route's
// Variables, so c.get("validatedBody"|"validatedQuery"|"validatedParams")
// returns z.infer<typeof schema> in handlers chained after the middleware.

/**
 * Read the request body as text without consuming it.
 *
 * Reading through a clone leaves `c.req.raw` intact, so handlers chained after
 * the validator can still call `c.req.json()` / `c.req.text()`, and so can
 * `idempotencyMiddleware`, which clones the same way. If an upstream
 * middleware already consumed the raw body the clone throws — Hono's own
 * body cache still holds the text, so fall back to it rather than reporting a
 * perfectly good request as malformed.
 */
const readBodyText = async (c: Context): Promise<string> => {
  try {
    return await c.req.raw.clone().text();
  } catch {
    return await c.req.text();
  }
};

/**
 * Validate a JSON request body.
 *
 * An absent or empty body is handed to the schema as `{}` so the *schema*
 * decides whether a body was required: a schema whose fields are all optional
 * accepts the call, and one with required fields fails with a
 * `VALIDATION_ERROR` that names the missing fields. A body that is present but
 * unparseable is still `INVALID_JSON` — that distinction is the whole point,
 * and #355 records what collapsing it costs (approval endpoints that 400'd
 * with the wrong reason until the client was made to send a dummy body).
 */
export const validateBody = <T extends z.ZodTypeAny>(schema: T) =>
  createMiddleware<{ Variables: { validatedBody: z.infer<T> } }>(
    async (c, next) => {
      try {
        const rawBody = await readBodyText(c);
        const body = rawBody ? JSON.parse(rawBody) : {};
        const validated = schema.parse(body);
        c.set("validatedBody", validated);
        await next();
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw badRequest(
            "Validation failed",
            "VALIDATION_ERROR",
            formatZodDetails(error),
          );
        }
        throw badRequest("Invalid JSON body", "INVALID_JSON");
      }
    },
  );

/**
 * @deprecated Identical to {@link validateBody} since #355 — that one now
 * tolerates an absent body too. Kept so existing call sites keep compiling;
 * new code should use `validateBody`.
 */
export const validateOptionalBody = validateBody;

export const validateQuery = <T extends z.ZodTypeAny>(schema: T) =>
  createMiddleware<{ Variables: { validatedQuery: z.infer<T> } }>(
    async (c, next) => {
      try {
        const query = c.req.query();
        const validated = schema.parse(query);
        c.set("validatedQuery", validated);
        await next();
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw badRequest(
            "Validation failed",
            "VALIDATION_ERROR",
            formatZodDetails(error),
          );
        }
        throw badRequest("Invalid query parameters", "INVALID_QUERY");
      }
    },
  );

export const validateParams = <T extends z.ZodTypeAny>(schema: T) =>
  createMiddleware<{ Variables: { validatedParams: z.infer<T> } }>(
    async (c, next) => {
      try {
        const params = c.req.param();
        const validated = schema.parse(params);
        c.set("validatedParams", validated);
        await next();
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw badRequest(
            "Validation failed",
            "VALIDATION_ERROR",
            formatZodDetails(error),
          );
        }
        throw badRequest("Invalid path parameters", "INVALID_PARAMS");
      }
    },
  );

export const commonSchemas = {
  idParam: z.object({
    id: z.string().regex(/^\d+$/).transform(Number),
  }),

  restaurantIdParam: z.object({
    restaurantId: z.string().regex(/^\d+$/).transform(Number),
  }),

  paginationQuery: z.object({
    page: boundedPageQuery(),
    limit: boundedLimitQuery(),
    search: z.string().optional(),
  }),

  dateRangeQuery: z.object({
    startDate: z.iso.datetime().optional(),
    endDate: z.iso.datetime().optional(),
  }),
};
