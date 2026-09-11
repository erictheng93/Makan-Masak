import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware, requireRole } from "../../../middleware/auth";
import {
  validateBody,
  validateQuery,
  validateParams,
} from "../../../middleware/validation";
import { FeedbackService, type FeedbackFilters } from "@makanmasak/database";
import {
  createFeedbackSchema,
  updateFeedbackSchema,
  updateFeedbackStatusSchema,
  addResponseSchema,
  feedbackFiltersSchema,
  feedbackIdParamSchema,
  responseIdParamSchema,
  updateResponseSchema,
  type AddResponseInput,
  type CreateFeedbackInput,
  type FeedbackFiltersInput,
  type FeedbackIdParamInput,
  type ResponseIdParamInput,
  type UpdateFeedbackInput,
  type UpdateFeedbackStatusInput,
  type UpdateResponseInput,
} from "../schemas/validation";
import type { Env } from "../../../types/env";
import { notFound, forbidden } from "../../../shared/utils/api-error";

const routes = new Hono<{ Bindings: Env }>();
const feedbackBatchSyncSchema = z.lazy(() => z.object({}).loose());

function createFeedbackService(env: Env): FeedbackService {
  return new FeedbackService(env.DB, env);
}

function createFeedbackBatchSyncId(payload: Record<string, unknown>): string {
  if (typeof payload.sync_id === "string" && payload.sync_id.trim()) {
    return encodeURIComponent(payload.sync_id);
  }
  return `${Date.now()}`;
}

/** Owner (role=1) can only access their own feedback. Returns the feedback record. */
async function assertOwnerAccess(
  service: FeedbackService,
  feedbackId: number,
  user: { role: number; id: string },
) {
  const feedback = await service.getFeedbackById(feedbackId);
  if (!feedback) throw notFound("Feedback not found", "FEEDBACK_NOT_FOUND");
  if (user.role === 1 && feedback.userId !== user.id) {
    throw forbidden("Access denied", "FEEDBACK_ACCESS_DENIED");
  }
  return feedback;
}

routes.post(
  "/",
  authMiddleware,
  requireRole([1]),
  validateBody(createFeedbackSchema),
  async (c) => {
    const user = c.get("user");
    const data = c.get("validatedBody") as CreateFeedbackInput;
    const service = createFeedbackService(c.env);

    if (!user.restaurantId) {
      return c.json(
        {
          success: false,
          error: {
            code: "NO_RESTAURANT",
            message: "No restaurant associated with this account",
          },
        },
        400,
      );
    }

    const feedback = await service.createFeedback({
      restaurantId: String(user.restaurantId),
      userId: user.id,
      category: data.category,
      priority: data.priority,
      relatedModule: data.relatedModule,
      subject: data.subject,
      description: data.description,
      attachmentUrls: data.attachmentUrls,
    });

    return c.json({ success: true, data: feedback }, 201);
  },
);

routes.post(
  "/batch-sync",
  authMiddleware,
  validateBody(feedbackBatchSyncSchema),
  async (c) => {
    const user = c.get("user");
    const payload = c.get("validatedBody") as Record<string, unknown>;
    const now = new Date().toISOString();
    const syncId = createFeedbackBatchSyncId(payload);
    const restaurantId =
      user.restaurantId == null ? "global" : String(user.restaurantId);
    const scope = encodeURIComponent(restaurantId);
    const record = {
      userId: user.id,
      restaurantId:
        user.restaurantId == null ? null : String(user.restaurantId),
      payload,
      syncedAt: now,
    };

    await c.env.CACHE_KV.put(
      `feedback:batch-sync:${scope}:${user.id}:${syncId}`,
      JSON.stringify(record),
      { expirationTtl: 60 * 60 * 24 * 30 },
    );
    await c.env.CACHE_KV.put(
      `feedback:batch-sync:${scope}:${user.id}:latest`,
      JSON.stringify(record),
      { expirationTtl: 60 * 60 * 24 * 30 },
    );

    return c.json({
      success: true,
      data: {
        syncId,
        synced: true,
        itemCount: Array.isArray(payload.feedback)
          ? payload.feedback.length
          : 0,
        restaurantId: record.restaurantId,
        syncedAt: now,
      },
    });
  },
);

// Must be registered before /:id to avoid route conflict
routes.get("/stats", authMiddleware, requireRole([0, 1]), async (c) => {
  const user = c.get("user");
  const service = createFeedbackService(c.env);
  const stats = await service.getFeedbackStats(
    user.role === 1 ? { userId: user.id } : {},
  );
  return c.json({ success: true, data: stats });
});

routes.get(
  "/",
  authMiddleware,
  requireRole([0, 1]),
  validateQuery(feedbackFiltersSchema),
  async (c) => {
    const user = c.get("user");
    const query = c.get("validatedQuery") as FeedbackFiltersInput;
    const service = createFeedbackService(c.env);

    const filters: FeedbackFilters = {
      category: query.category,
      status: query.status,
      priority: query.priority,
      relatedModule: query.relatedModule,
      search: query.search,
    };

    // Owner role: only see own feedback
    if (user.role === 1) {
      filters.userId = user.id;
    } else if (query.restaurantId) {
      // Admin: optional filter by restaurant
      filters.restaurantId = query.restaurantId;
    }

    const result = await service.listFeedback(
      filters,
      query.page,
      query.limit,
      user.role === 0,
    );

    return c.json({ success: true, ...result });
  },
);

routes.get(
  "/:id",
  authMiddleware,
  requireRole([0, 1]),
  validateParams(feedbackIdParamSchema),
  async (c) => {
    const user = c.get("user");
    const { id } = c.get("validatedParams") as FeedbackIdParamInput;
    const service = createFeedbackService(c.env);

    const feedback = await assertOwnerAccess(service, id, user);

    // Filter out internal responses for non-admins
    if (user.role !== 0) {
      feedback.responses = feedback.responses?.filter((r) => !r.isInternal);
    }

    return c.json({ success: true, data: feedback });
  },
);

routes.put(
  "/:id/status",
  authMiddleware,
  requireRole([0]),
  validateParams(feedbackIdParamSchema),
  validateBody(updateFeedbackStatusSchema),
  async (c) => {
    const user = c.get("user");
    const { id } = c.get("validatedParams") as FeedbackIdParamInput;
    const { status } = c.get("validatedBody") as UpdateFeedbackStatusInput;
    const service = createFeedbackService(c.env);

    const feedback = await service.updateFeedbackStatus(
      id,
      status,
      status === "resolved" ? user.id : undefined,
    );

    return c.json({
      success: true,
      data: feedback,
      message: "Status updated successfully",
    });
  },
);

routes.patch(
  "/:id",
  authMiddleware,
  requireRole([0, 1]),
  validateParams(feedbackIdParamSchema),
  validateBody(updateFeedbackSchema),
  async (c) => {
    const user = c.get("user");
    const { id } = c.get("validatedParams") as FeedbackIdParamInput;
    const data = c.get("validatedBody") as UpdateFeedbackInput;
    const service = createFeedbackService(c.env);

    if (user.role === 1) {
      await assertOwnerAccess(service, id, user);
    }

    const updated = await service.updateFeedback(
      id,
      data,
      user.id,
      user.role === 0,
    );

    if (!updated) {
      throw notFound(
        "Feedback not found or cannot be edited",
        "FEEDBACK_NOT_EDITABLE",
      );
    }

    return c.json({ success: true, data: updated });
  },
);

routes.delete(
  "/:id",
  authMiddleware,
  requireRole([0, 1]),
  validateParams(feedbackIdParamSchema),
  async (c) => {
    const user = c.get("user");
    const { id } = c.get("validatedParams") as FeedbackIdParamInput;
    const service = createFeedbackService(c.env);

    if (user.role === 1) {
      await assertOwnerAccess(service, id, user);
    }

    const deleted = await service.deleteFeedback(id, user.id, user.role === 0);

    if (!deleted) {
      throw notFound(
        "Feedback not found or cannot be deleted",
        "FEEDBACK_NOT_DELETABLE",
      );
    }

    return c.json({ success: true });
  },
);

routes.post(
  "/:id/responses",
  authMiddleware,
  requireRole([0, 1]),
  validateParams(feedbackIdParamSchema),
  validateBody(addResponseSchema),
  async (c) => {
    const user = c.get("user");
    const { id } = c.get("validatedParams") as FeedbackIdParamInput;
    const { message, isInternal } = c.get("validatedBody") as AddResponseInput;
    const service = createFeedbackService(c.env);

    await assertOwnerAccess(service, id, user);

    // Only admins can post internal notes
    const internal = user.role === 0 ? (isInternal ?? false) : false;

    const response = await service.addResponse(id, user.id, message, internal);

    return c.json({ success: true, data: response }, 201);
  },
);

routes.put(
  "/:id/responses/:responseId",
  authMiddleware,
  requireRole([0, 1]),
  validateParams(responseIdParamSchema),
  validateBody(updateResponseSchema),
  async (c) => {
    const user = c.get("user");
    const { id, responseId } = c.get("validatedParams") as ResponseIdParamInput;
    const { message } = c.get("validatedBody") as UpdateResponseInput;
    const service = createFeedbackService(c.env);

    if (user.role === 1) {
      await assertOwnerAccess(service, id, user);
    }

    const updated = await service.updateResponse(
      responseId,
      user.id,
      message,
      user.role === 0,
    );

    if (!updated)
      throw notFound("Response not found or not yours", "RESPONSE_NOT_FOUND");

    return c.json({ success: true, data: updated });
  },
);

routes.delete(
  "/:id/responses/:responseId",
  authMiddleware,
  requireRole([0, 1]),
  validateParams(responseIdParamSchema),
  async (c) => {
    const user = c.get("user");
    const { id, responseId } = c.get("validatedParams") as ResponseIdParamInput;
    const service = createFeedbackService(c.env);

    if (user.role === 1) {
      await assertOwnerAccess(service, id, user);
    }

    const deleted = await service.deleteResponse(
      responseId,
      user.id,
      user.role === 0,
    );

    if (!deleted)
      throw notFound("Response not found or not yours", "RESPONSE_NOT_FOUND");

    return c.json({ success: true });
  },
);

export default routes;
