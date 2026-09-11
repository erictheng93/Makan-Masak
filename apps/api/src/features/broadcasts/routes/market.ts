import { Hono } from "hono";
import { authMiddleware, requireRole } from "../../../middleware/auth";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../../../shared/middleware";
import { BroadcastService } from "../services/BroadcastService";
import {
  broadcastHistoryQuerySchema,
  broadcastScopeParamSchema,
  sendBroadcastSchema,
  type BroadcastHistoryQueryInput,
  type BroadcastScopeParamInput,
  type SendBroadcastInput,
} from "../schemas/validation";
import type { Env } from "../../../types/env";

/**
 * Market-scoped announcements (#335), mounted at `/api/v1/markets`.
 *
 * Platform admin (role 0) only. A market speaks for every vendor in it, and
 * there is no market-operator identity to delegate to: that role is Phase 2
 * future work in the discovery spec and does not exist in this codebase — the
 * markets feature has exactly one admin surface, `/api/v1/admin/markets`, and
 * it is role 0 as well. When `market_operator` lands, this is the line that
 * changes, and it needs a per-market ownership check beside it rather than a
 * bare role widening.
 */
const app = new Hono<{ Bindings: Env }>();

const MARKET_BROADCAST_ROLES = [0];

/**
 * Send an announcement to this market's followers.
 * POST /api/v1/markets/:id/broadcasts
 */
app.post(
  "/:id/broadcasts",
  authMiddleware,
  requireRole(MARKET_BROADCAST_ROLES),
  validateParams(broadcastScopeParamSchema),
  validateBody(sendBroadcastSchema),
  async (c) => {
    const { id: marketId } = c.get(
      "validatedParams",
    ) as BroadcastScopeParamInput;
    const body = c.get("validatedBody") as SendBroadcastInput;

    const service = new BroadcastService(c.env);
    const result = await service.send({
      scopeType: "market",
      scopeId: marketId,
      sentBy: String(c.get("user").id),
      title: body.title,
      body: body.body,
      url: body.url,
      // Market scope has no fan-in to add: its own followers are the audience.
    });

    return c.json({ success: true, data: result }, 201);
  },
);

/**
 * Send history for this market, newest first.
 * GET /api/v1/markets/:id/broadcasts
 */
app.get(
  "/:id/broadcasts",
  authMiddleware,
  requireRole(MARKET_BROADCAST_ROLES),
  validateParams(broadcastScopeParamSchema),
  validateQuery(broadcastHistoryQuerySchema),
  async (c) => {
    const { id: marketId } = c.get(
      "validatedParams",
    ) as BroadcastScopeParamInput;
    const { page, limit } = c.get(
      "validatedQuery",
    ) as BroadcastHistoryQueryInput;

    const service = new BroadcastService(c.env);
    const result = await service.listHistory("market", marketId, page, limit);

    return c.json({ success: true, data: result });
  },
);

export default app;
