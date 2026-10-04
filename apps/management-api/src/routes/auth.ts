import { Hono } from "hono";
import { sign, verify } from "hono/jwt";
import { badRequest, unauthorized } from "@makanmasak/utils";
import type { ManagementEnv } from "../types";
import {
  MANAGEMENT_JWT_AUDIENCE,
  MANAGEMENT_JWT_ISSUER,
  requireCurrentAdmin,
  UUID_V7_PATTERN,
  managementJwtSecret,
} from "../middleware/auth";

const MANAGEMENT_TOKEN_TTL_SECONDS = 60 * 60;
const authRouter = new Hono<{ Bindings: ManagementEnv }>();

function getRequiredApiToken(body: unknown): string {
  if (
    !body ||
    typeof body !== "object" ||
    typeof (body as { token?: unknown }).token !== "string" ||
    !(body as { token: string }).token.trim()
  ) {
    throw badRequest("token is required");
  }

  return (body as { token: string }).token.trim();
}

authRouter.post("/exchange", async (c) => {
  const body = await c.req.json().catch(() => null);
  const apiToken = getRequiredApiToken(body);

  let apiPayload: Record<string, unknown>;
  try {
    apiPayload = await verify(apiToken, c.env.JWT_SECRET, "HS256");
  } catch {
    throw unauthorized("Invalid or expired API token");
  }

  if (
    apiPayload.role !== 0 ||
    typeof apiPayload.sub !== "string" ||
    !UUID_V7_PATTERN.test(apiPayload.sub) ||
    typeof apiPayload.username !== "string" ||
    apiPayload.aud !== undefined ||
    apiPayload.iss !== undefined ||
    apiPayload.type !== undefined ||
    typeof apiPayload.exp !== "number"
  ) {
    throw unauthorized("Admin API token required");
  }
  const principal = await requireCurrentAdmin(
    c.env,
    apiPayload.sub,
    apiPayload.tv,
  );
  if (principal.username !== apiPayload.username)
    throw unauthorized("Invalid API token identity");
  if (!c.env.PLATFORM_DB)
    throw unauthorized("Platform user lookup unavailable");
  const session = await c.env.PLATFORM_DB.prepare(
    "SELECT id FROM sessions WHERE user_id = ? AND token = ? AND is_active = 1 AND expires_at_ms > ? LIMIT 1",
  )
    .bind(principal.id, apiToken, Date.now())
    .first<{ id: string }>();
  if (!session) throw unauthorized("Session has been invalidated");
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + MANAGEMENT_TOKEN_TTL_SECONDS;
  const token = await sign(
    {
      id: principal.id,
      tv: apiPayload.tv,
      sid: session.id,
      email: principal.username,
      role: "admin",
      aud: MANAGEMENT_JWT_AUDIENCE,
      iss: MANAGEMENT_JWT_ISSUER,
      iat: now,
      exp: expiresAt,
    },
    managementJwtSecret(c.env),
  );

  return c.json({
    success: true,
    data: {
      token,
      tokenType: "Bearer",
      expiresAt,
    },
  });
});

export default authRouter;
