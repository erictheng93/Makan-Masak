/**
 * 班次管理路由
 */

import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware, requireRole } from "../../../middleware/auth";
import {
  validateBody,
  validateQuery,
  validateParams,
} from "../../../middleware/validation";
import { ShiftService } from "../services/ShiftService";
import { ReportService } from "../services/ReportService";
import { PosTenantAccessService } from "../services/PosTenantAccessService";
import {
  startShiftSchema,
  endShiftSchema,
  shiftParamsSchema,
  statsQuerySchema,
} from "../schemas";
import type { Env } from "../../../types/env";
import { forbidden, badRequest } from "../../../shared/utils/api-error";

const app = new Hono<{ Bindings: Env }>();

/**
 * 開始班次
 * POST /shifts/start
 */
app.post(
  "/start",
  authMiddleware,
  requireRole([0, 1, 4]), // Admin, Owner, Cashier
  validateBody(startShiftSchema),
  async (c) => {
    const data = c.get("validatedBody");
    const user = c.get("user");

    // 如果不是管理員，操作員必須是自己
    if (user.role !== 0 && data.operatorId !== String(user.id)) {
      throw forbidden("只能為自己開班");
    }

    await new PosTenantAccessService(c.env.DB).requireRegister(
      user,
      data.registerId,
    );

    const shiftService = new ShiftService(c.env.DB);
    const result = await shiftService.startShift(data);

    if (!result.success) {
      throw badRequest(result.error || "開班失敗");
    }

    return c.json({
      success: true,
      data: result.data,
    });
  },
);

/**
 * 結束班次
 * POST /shifts/:shiftId/end
 */
app.post(
  "/:shiftId/end",
  authMiddleware,
  requireRole([0, 1, 4]), // Admin, Owner, Cashier
  validateParams(shiftParamsSchema),
  validateBody(endShiftSchema),
  async (c) => {
    const { shiftId } = c.get("validatedParams");
    const data = c.get("validatedBody");
    const user = c.get("user");
    await new PosTenantAccessService(c.env.DB).requireShift(user, shiftId);

    const shiftService = new ShiftService(c.env.DB);
    const result = await shiftService.endShift(shiftId, data, user.id);

    if (!result.success) {
      throw badRequest(result.error || "結班失敗");
    }

    return c.json({
      success: true,
      data: result.data,
    });
  },
);

/**
 * 暫停班次
 * POST /shifts/:shiftId/suspend
 */
app.post(
  "/:shiftId/suspend",
  authMiddleware,
  requireRole([0, 1, 4]), // Admin, Owner, Cashier
  validateParams(shiftParamsSchema),
  validateBody(
    z.lazy(() =>
      z.object({
        reason: z.string().max(200).optional(),
      }),
    ),
  ),
  async (c) => {
    const { shiftId } = c.get("validatedParams");
    const { reason } = c.get("validatedBody");
    await new PosTenantAccessService(c.env.DB).requireShift(
      c.get("user"),
      shiftId,
    );

    const shiftService = new ShiftService(c.env.DB);
    const result = await shiftService.suspendShift(shiftId, reason);

    if (!result.success) {
      throw badRequest(result.error || "暫停班次失敗");
    }

    return c.json({
      success: true,
      message: "班次已暫停",
    });
  },
);

/**
 * 恢復班次
 * POST /shifts/:shiftId/resume
 */
app.post(
  "/:shiftId/resume",
  authMiddleware,
  requireRole([0, 1, 4]), // Admin, Owner, Cashier
  validateParams(shiftParamsSchema),
  async (c) => {
    const { shiftId } = c.get("validatedParams");
    await new PosTenantAccessService(c.env.DB).requireShift(
      c.get("user"),
      shiftId,
    );

    const shiftService = new ShiftService(c.env.DB);
    const result = await shiftService.resumeShift(shiftId);

    if (!result.success) {
      throw badRequest(result.error || "恢復班次失敗");
    }

    return c.json({
      success: true,
      message: "班次已恢復",
    });
  },
);

/**
 * 獲取當前班次
 * GET /shifts/current/:registerId
 */
app.get(
  "/current/:registerId",
  authMiddleware,
  requireRole([0, 1, 4]), // Admin, Owner, Cashier
  validateParams(
    z.lazy(() =>
      z.object({
        registerId: z.uuid(),
      }),
    ),
  ),
  async (c) => {
    const { registerId } = c.get("validatedParams");
    await new PosTenantAccessService(c.env.DB).requireRegister(
      c.get("user"),
      registerId,
    );

    const shiftService = new ShiftService(c.env.DB);
    const result = await shiftService.getCurrentShift(registerId);

    if (!result.success) {
      throw badRequest(result.error || "獲取當前班次失敗");
    }

    return c.json({
      success: true,
      data: result.data,
    });
  },
);

/**
 * 生成班次報表
 * GET /shifts/:shiftId/report
 */
app.get(
  "/:shiftId/report",
  authMiddleware,
  requireRole([0, 1, 4]), // Admin, Owner, Cashier
  validateParams(shiftParamsSchema),
  async (c) => {
    const { shiftId } = c.get("validatedParams");
    await new PosTenantAccessService(c.env.DB).requireShift(
      c.get("user"),
      shiftId,
    );

    const reportService = new ReportService(c.env.DB);
    const result = await reportService.generateShiftReport(shiftId);

    if (!result.success) {
      throw badRequest(result.error || "獲取班次報表失敗");
    }

    return c.json({
      success: true,
      data: result.data,
    });
  },
);

/**
 * 獲取班次統計
 * GET /shifts/stats
 */
app.get(
  "/stats",
  authMiddleware,
  requireRole([0, 1]), // Admin or Owner
  validateQuery(statsQuerySchema),
  async (c) => {
    const user = c.get("user");
    const query = c.get("validatedQuery");

    // 確定餐廳ID
    let restaurantId: string | undefined;
    if (query.restaurantId) {
      restaurantId = String(query.restaurantId);
      if (user.role === 1 && user.restaurantId !== restaurantId) {
        throw forbidden("只能查看自己餐廳的統計");
      }
    } else if (user.restaurantId) {
      restaurantId = String(user.restaurantId);
    } else {
      throw badRequest("需要指定餐廳ID");
    }

    if (!restaurantId) {
      throw badRequest("需要指定餐廳ID");
    }

    const dateRange =
      query.dateFrom && query.dateTo
        ? {
            from: new Date(query.dateFrom),
            to: new Date(query.dateTo),
          }
        : undefined;

    const reportService = new ReportService(c.env.DB);
    const result = await reportService.getShiftStats(restaurantId, dateRange);

    if (!result.success) {
      throw badRequest(result.error || "獲取班次統計失敗");
    }

    return c.json({
      success: true,
      data: result.data,
    });
  },
);

export default app;
