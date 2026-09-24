/**
 * Reservations Routes
 * API routes for reservation management system
 */

import { Hono } from "hono";
import { z } from "zod";
import { normalizeE164Phone } from "@makanmasak/utils";
import { authMiddleware, requireRole } from "../../../middleware/auth";
import { idempotencyMiddleware } from "../../../middleware/idempotency";
import { moduleGate } from "../../../middleware/moduleGate";
import { rateLimitMiddleware } from "../../../middleware/rateLimiter";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../../../middleware/validation";
import { ReservationService } from "@makanmasak/database";
import type { Env } from "../../../types/env";
import type { AuthUser } from "../../../middleware/auth";
import {
  ReservationStatus,
  type CreateReservationRequest,
  type UpdateReservationRequest,
  type ReservationFilters,
} from "@makanmasak/shared-types";
import {
  notFound,
  forbidden,
  badRequest,
} from "../../../shared/utils/api-error";

const app = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();

// The production native binding is the atomic 5/60s floor for anonymous
// mutations. This KV counter is intentionally a longer-window second layer.
const publicReservationCreateRateLimit = rateLimitMiddleware({
  windowMs: 15 * 60 * 1000,
  maxRequests: 5,
  keyPrefix: "public_reservation_create",
  message: "訂位請求過於頻繁，請稍後再試。",
});

const publicReservationCancelRateLimit = rateLimitMiddleware({
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  keyPrefix: "public_reservation_cancel",
  message: "取消訂位請求過於頻繁，請稍後再試。",
});

const publicReservationLookupRateLimit = rateLimitMiddleware({
  windowMs: 15 * 60 * 1000,
  maxRequests: 20,
  keyPrefix: "public_reservation_lookup",
  message: "查詢訂位請求過於頻繁，請稍後再試。",
});

const publicReservationAvailabilityRateLimit = rateLimitMiddleware({
  windowMs: 60 * 1000,
  maxRequests: 30,
  keyPrefix: "public_reservation_availability",
  message: "查詢可用時段過於頻繁，請稍後再試。",
});

const reservationPhoneSchema = z
  .string()
  .trim()
  .min(7)
  .max(30)
  .transform(normalizeE164Phone)
  .pipe(z.string().regex(/^\+[1-9]\d{6,14}$/));

const publicReservationSchema = z
  .object({
    restaurantId: z.string().trim().min(1).max(128),
    customerName: z.string().trim().min(1).max(100),
    customerPhone: reservationPhoneSchema,
    customerEmail: z.email().max(254).optional(),
    partySize: z.number().int().min(1).max(20),
    reservationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reservationTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    durationMinutes: z.number().int().min(15).max(480).optional(),
    specialRequests: z.string().trim().max(500).optional(),
  })
  .strict();

const staffReservationSchema = publicReservationSchema.extend({
  customerId: z.string().trim().min(1).max(128).optional(),
});

const publicReservationCancelSchema = z
  .object({
    confirmationCode: z.string().trim().min(1).max(128),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

const publicReservationAvailabilitySchema = z.object({
  restaurantId: z.string().trim().min(1).max(128),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  partySize: z.coerce.number().int().min(1).max(20),
  duration: z.coerce.number().int().min(15).max(480).optional(),
});

const reservationIdParamSchema = z.object({
  id: z.string().trim().min(1).max(128),
});

const publicReservationConfirmationCodeParamSchema = z.object({
  code: z.string().trim().min(1).max(128),
});

const staffReservationCancelSchema = z
  .object({ reason: z.string().trim().max(500).optional() })
  .strict();

async function requireReservationAccess(
  c: { get(key: "user"): AuthUser },
  service: Pick<ReservationService, "getReservationById">,
  id: string,
) {
  const reservation = await service.getReservationById(id);
  if (!reservation) {
    throw notFound("Reservation not found");
  }

  const user = c.get("user");
  if (
    user.role !== 0 &&
    reservation.restaurantId !== String(user.restaurantId)
  ) {
    throw forbidden("Access denied to this reservation");
  }

  return reservation;
}

// ==========================================
// Public Routes - 顧客可使用
// ==========================================

/**
 * POST /reservations
 * 建立新訂位
 */
app.post(
  "/",
  publicReservationCreateRateLimit,
  validateBody(publicReservationSchema),
  idempotencyMiddleware({ scope: "public-reservation-create" }),
  async (c) => {
    const body = c.get("validatedBody") as CreateReservationRequest;
    const service = new ReservationService(c.env.DB, c.env);

    // A missing or retired restaurant used to fall through to slot allocation
    // and become a sanitised 500. Keep the anonymous API's response explicit
    // without exposing a disabled restaurant's details.
    const restaurant = await service.getPublicReservationRestaurant(
      body.restaurantId,
    );
    if (!restaurant) {
      throw notFound("Restaurant not found", "RESTAURANT_NOT_FOUND");
    }
    // The onboarding showcase shop (restaurants.is_demo) takes no bookings.
    if (restaurant.isDemo) {
      throw forbidden(
        "This is a demo restaurant. Orders and bookings are not accepted.",
        "DEMO_RESTAURANT",
      );
    }

    const reservation = await service.createReservation(body);

    return c.json(
      {
        success: true,
        data: reservation,
        message: "訂位成功！確認碼已發送至您的手機",
      },
      201,
    );
  },
);

/**
 * GET /reservations/verify/:code
 * 驗證確認碼並查詢訂位
 */
app.get(
  "/verify/:code",
  publicReservationLookupRateLimit,
  validateParams(publicReservationConfirmationCodeParamSchema),
  async (c) => {
    const { code } = c.get("validatedParams") as { code: string };
    const service = new ReservationService(c.env.DB, c.env);

    const reservation = await service.getReservationByCode(code);

    if (!reservation) {
      throw notFound("找不到此訂位");
    }

    return c.json({
      success: true,
      data: reservation,
    });
  },
);

/**
 * GET /reservations/availability
 * 查詢可用時段
 */
app.get(
  "/availability",
  publicReservationAvailabilityRateLimit,
  validateQuery(publicReservationAvailabilitySchema),
  async (c) => {
    const query = c.get("validatedQuery") as z.infer<
      typeof publicReservationAvailabilitySchema
    >;
    const service = new ReservationService(c.env.DB, c.env);

    const availability = await service.getAvailableSlots({
      ...query,
      duration: query.duration ?? 90,
    });

    return c.json({
      success: true,
      data: availability,
    });
  },
);

/**
 * DELETE /reservations/:id/cancel
 * 取消訂位（公開，使用確認碼驗證）
 */
app.delete(
  "/:id/cancel",
  publicReservationCancelRateLimit,
  validateParams(reservationIdParamSchema),
  validateBody(publicReservationCancelSchema),
  idempotencyMiddleware({ scope: "public-reservation-cancel" }),
  async (c) => {
    const { id } = c.get("validatedParams") as { id: string };
    const { confirmationCode, reason } = c.get("validatedBody") as z.infer<
      typeof publicReservationCancelSchema
    >;

    const service = new ReservationService(c.env.DB, c.env);

    // 驗證確認碼
    const reservation = await service.getReservationById(id);
    if (!reservation || reservation.confirmationCode !== confirmationCode) {
      throw forbidden("確認碼錯誤");
    }

    // 確認碼已經證明呼叫者持有這筆訂位；把該訂位的 restaurantId 一併帶進
    // 寫入條件，讓取消綁在剛剛驗證過的那一筆上。
    const cancelled = await service.cancelReservation(
      id,
      reason,
      reservation.restaurantId,
    );

    return c.json({
      success: true,
      data: cancelled,
      message: "訂位已取消",
    });
  },
);

// ==========================================
// Protected Routes - 需要認證
// ==========================================

app.use("/*", authMiddleware);
app.use("/*", moduleGate("reservations"));

/**
 * POST /reservations/staff
 * Staff-created reservations are separate from the anonymous diner endpoint:
 * they require auth, CSRF (at app-factory), tenant access, and an idempotency
 * key. A non-admin may never select a different restaurant in the body.
 */
app.post(
  "/staff",
  requireRole([0, 1, 4]),
  validateBody(staffReservationSchema),
  idempotencyMiddleware({ scope: "staff-reservation-create" }),
  async (c) => {
    const body = c.get("validatedBody") as CreateReservationRequest;

    const user = c.get("user");
    if (user.role !== 0) {
      const restaurantId = user.restaurantId?.toString();
      if (!restaurantId || body.restaurantId !== restaurantId) {
        throw forbidden("無權為其他餐廳建立訂位");
      }
    }

    const service = new ReservationService(c.env.DB, c.env);
    const reservation = await service.createReservation(body);
    return c.json(
      {
        success: true,
        data: reservation,
        message: "訂位成功！",
      },
      201,
    );
  },
);

/**
 * GET /reservations
 * 查詢訂位列表（店員/管理員）
 */
app.get("/", requireRole([0, 1, 4]), async (c) => {
  const user = c.get("user");
  const service = new ReservationService(c.env.DB, c.env);

  // 建構過濾條件
  const filters: ReservationFilters = {
    restaurantId:
      user.role === 0
        ? c.req.query("restaurantId")
        : user.restaurantId!.toString(),
    status: c.req.query("status") as ReservationStatus,
    reservationDate: c.req.query("date"),
    startDate: c.req.query("startDate"),
    endDate: c.req.query("endDate"),
    customerPhone: c.req.query("phone"),
    confirmationCode: c.req.query("code"),
    page: parseInt(c.req.query("page") || "1"),
    limit: parseInt(c.req.query("limit") || "20"),
    sortBy: (c.req.query("sortBy") ||
      "created_at") as ReservationFilters["sortBy"],
    sortOrder: (c.req.query("sortOrder") as "asc" | "desc") || "desc",
  };

  const result = await service.listReservations(filters);

  return c.json({
    success: true,
    data: result.data,
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / (filters.limit || 20)),
    },
  });
});

/**
 * GET /reservations/:id
 * 查詢單一訂位詳情
 */
app.get("/:id", requireRole([0, 1, 3, 4]), async (c) => {
  const id = c.req.param("id");
  if (!id) throw badRequest("Missing id parameter", "MISSING_PARAM");
  const service = new ReservationService(c.env.DB, c.env);

  const reservation = await service.getReservationById(id);

  if (!reservation) {
    throw notFound("找不到此訂位");
  }

  // 權限檢查：非管理員只能查看自己餐廳的訂位
  const user = c.get("user");
  if (
    user.role !== 0 &&
    reservation.restaurantId !== user.restaurantId!.toString()
  ) {
    throw forbidden("無權限查看此訂位");
  }

  return c.json({
    success: true,
    data: reservation,
  });
});

/**
 * PUT /reservations/:id
 * 更新訂位資訊
 */
app.put("/:id", requireRole([0, 1, 4]), async (c) => {
  const id = c.req.param("id");
  if (!id) throw badRequest("Missing id parameter", "MISSING_PARAM");
  const body = await c.req.json<UpdateReservationRequest>();
  const service = new ReservationService(c.env.DB, c.env);

  // 權限檢查
  const existing = await service.getReservationById(id);
  if (!existing) {
    throw notFound("找不到此訂位");
  }

  const user = c.get("user");
  if (
    user.role !== 0 &&
    existing.restaurantId !== user.restaurantId!.toString()
  ) {
    throw forbidden("無權限修改此訂位");
  }

  const updated = await service.updateReservation(id, body);

  return c.json({
    success: true,
    data: updated,
    message: "訂位已更新",
  });
});

/**
 * POST /reservations/:id/cancel
 * Staff cancellation remains authenticated and CSRF-protected. The public
 * counterpart uses DELETE plus a confirmation code above.
 */
app.post(
  "/:id/cancel",
  requireRole([0, 1, 4]),
  validateParams(reservationIdParamSchema),
  validateBody(staffReservationCancelSchema),
  async (c) => {
    const { id } = c.get("validatedParams") as { id: string };
    const { reason } = c.get("validatedBody") as z.infer<
      typeof staffReservationCancelSchema
    >;

    const service = new ReservationService(c.env.DB, c.env);
    const reservation = await requireReservationAccess(c, service, id);
    const cancelled = await service.cancelReservation(
      id,
      reason,
      reservation.restaurantId,
    );

    return c.json({
      success: true,
      data: cancelled,
      message: "訂位已取消",
    });
  },
);

/**
 * POST /reservations/:id/confirm
 * 確認訂位
 */
app.post("/:id/confirm", requireRole([0, 1, 4]), async (c) => {
  const id = c.req.param("id");
  if (!id) throw badRequest("Missing id parameter", "MISSING_PARAM");
  const service = new ReservationService(c.env.DB, c.env);

  const reservation = await requireReservationAccess(c, service, id);
  const confirmed = await service.confirmReservation(
    id,
    reservation.restaurantId,
  );

  return c.json({
    success: true,
    data: confirmed,
    message: "訂位已確認",
  });
});

/**
 * POST /reservations/:id/arrive
 * 標記到店
 */
app.post("/:id/arrive", requireRole([0, 1, 3, 4]), async (c) => {
  const id = c.req.param("id");
  if (!id) throw badRequest("Missing id parameter", "MISSING_PARAM");
  const service = new ReservationService(c.env.DB, c.env);

  const reservation = await requireReservationAccess(c, service, id);
  const arrived = await service.markArrived(id, reservation.restaurantId);

  return c.json({
    success: true,
    data: arrived,
    message: "已標記到店",
  });
});

/**
 * POST /reservations/:id/seat
 * 標記入座
 */
app.post("/:id/seat", requireRole([0, 1, 3, 4]), async (c) => {
  const id = c.req.param("id");
  if (!id) throw badRequest("Missing id parameter", "MISSING_PARAM");
  const service = new ReservationService(c.env.DB, c.env);

  const reservation = await requireReservationAccess(c, service, id);
  const seated = await service.markSeated(id, reservation.restaurantId);

  return c.json({
    success: true,
    data: seated,
    message: "已標記入座",
  });
});

/**
 * POST /reservations/:id/complete
 * 完成訂位
 */
app.post("/:id/complete", requireRole([0, 1, 3, 4]), async (c) => {
  const id = c.req.param("id");
  if (!id) throw badRequest("Missing id parameter", "MISSING_PARAM");
  const service = new ReservationService(c.env.DB, c.env);

  const reservation = await requireReservationAccess(c, service, id);
  const completed = await service.completeReservation(
    id,
    reservation.restaurantId,
  );

  return c.json({
    success: true,
    data: completed,
    message: "訂位已完成",
  });
});

/**
 * POST /reservations/:id/no-show
 * 標記未到店
 */
app.post("/:id/no-show", requireRole([0, 1, 4]), async (c) => {
  const id = c.req.param("id");
  if (!id) throw badRequest("Missing id parameter", "MISSING_PARAM");
  const service = new ReservationService(c.env.DB, c.env);

  const reservation = await requireReservationAccess(c, service, id);
  const noShow = await service.markNoShow(id, reservation.restaurantId);

  return c.json({
    success: true,
    data: noShow,
    message: "已標記未到店",
  });
});

/**
 * GET /reservations/stats/:restaurantId
 * 取得訂位統計
 */
app.get("/stats/:restaurantId", requireRole([0, 1]), async (c) => {
  const restaurantId = c.req.param("restaurantId");
  if (!restaurantId)
    throw badRequest("Missing restaurantId parameter", "MISSING_PARAM");
  const date = c.req.query("date"); // YYYY-MM-DD
  const service = new ReservationService(c.env.DB, c.env);

  // 權限檢查
  const user = c.get("user");
  if (user.role !== 0 && restaurantId !== user.restaurantId!.toString()) {
    throw forbidden("無權限查看此統計");
  }

  const stats = await service.getReservationStats(restaurantId, date);

  return c.json({
    success: true,
    data: stats,
  });
});

// ==========================================
// Slot Management Routes - 時段管理
// ==========================================

/**
 * POST /reservations/slots
 * 建立時段
 */
app.post("/slots", requireRole([0, 1]), async (c) => {
  const body = await c.req.json();
  const service = new ReservationService(c.env.DB, c.env);

  // 權限檢查
  const user = c.get("user");
  if (user.role !== 0 && body.restaurantId !== user.restaurantId) {
    throw forbidden("無權限建立時段");
  }

  const slot = await service.createSlot(body);

  return c.json({
    success: true,
    data: slot,
    message: "時段建立成功",
  });
});

/**
 * POST /reservations/slots/batch
 * 批次建立時段
 */
app.post("/slots/batch", requireRole([0, 1]), async (c) => {
  const body = await c.req.json();
  const service = new ReservationService(c.env.DB, c.env);

  // 權限檢查
  const user = c.get("user");
  if (user.role !== 0 && body.restaurantId !== user.restaurantId) {
    throw forbidden("無權限建立時段");
  }

  const count = await service.batchCreateSlots(body);

  return c.json({
    success: true,
    data: { created: count },
    message: `成功建立 ${count} 個時段`,
  });
});

export default app;
