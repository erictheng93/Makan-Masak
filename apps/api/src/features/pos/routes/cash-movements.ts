/**
 * 現金操作路由
 */

import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware, requireRole } from "../../../middleware/auth";
import {
  validateBody,
  validateQuery,
  validateParams,
} from "../../../middleware/validation";
import { CashMovementService } from "../services/CashMovementService";
import { PosTenantAccessService } from "../services/PosTenantAccessService";
import {
  cashMovementSchema,
  shiftParamsSchema,
  movementsQuerySchema,
} from "../schemas";
import type { Env } from "../../../types/env";
import { badRequest } from "../../../shared/utils/api-error";

const app = new Hono<{ Bindings: Env }>();

/**
 * 記錄現金操作
 * POST /shifts/:shiftId/cash-movements
 */
app.post(
  "/shifts/:shiftId/cash-movements",
  authMiddleware,
  requireRole([0, 1, 4]), // Admin, Owner, Cashier
  validateParams(shiftParamsSchema),
  validateBody(cashMovementSchema),
  async (c) => {
    const { shiftId } = c.get("validatedParams");
    const data = c.get("validatedBody");
    const user = c.get("user");
    await new PosTenantAccessService(c.env.DB).requireShift(user, shiftId);

    const cashMovementService = new CashMovementService(c.env.DB);
    const result = await cashMovementService.processCashMovement(
      shiftId,
      data,
      user.id,
    );

    if (!result.success) {
      throw badRequest(result.error || "現金操作記錄失敗");
    }

    return c.json({
      success: true,
      message: "現金操作記錄成功",
    });
  },
);

/**
 * 獲取現金流動記錄
 * GET /shifts/:shiftId/cash-movements
 */
app.get(
  "/shifts/:shiftId/cash-movements",
  authMiddleware,
  requireRole([0, 1, 4]), // Admin, Owner, Cashier
  validateParams(shiftParamsSchema),
  validateQuery(movementsQuerySchema),
  async (c) => {
    const { shiftId } = c.get("validatedParams");
    const { type, page, limit } = c.get("validatedQuery");
    await new PosTenantAccessService(c.env.DB).requireShift(
      c.get("user"),
      shiftId,
    );

    const cashMovementService = new CashMovementService(c.env.DB);
    const result = await cashMovementService.getCashMovements(shiftId, {
      type,
      page,
      limit,
    });

    if (!result.success) {
      throw badRequest(result.error || "獲取現金流動記錄失敗");
    }

    return c.json({
      success: true,
      data: result.data,
    });
  },
);

/**
 * 獲取現金盤點記錄
 * GET /registers/:registerId/cash-count
 */
app.get(
  "/registers/:registerId/cash-count",
  authMiddleware,
  requireRole([0, 1, 4]), // Admin, Owner, Cashier
  validateParams(
    z.lazy(() =>
      z.object({
        registerId: z.uuid(),
      }),
    ),
  ),
  validateQuery(
    z.lazy(() =>
      z.object({
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      }),
    ),
  ),
  async (c) => {
    const { registerId } = c.get("validatedParams");
    const { date } = c.get("validatedQuery");
    await new PosTenantAccessService(c.env.DB).requireRegister(
      c.get("user"),
      registerId,
    );

    const cashMovementService = new CashMovementService(c.env.DB);
    const result = await cashMovementService.getCashCount(registerId, date);

    if (!result.success) {
      throw badRequest(result.error || "獲取現金盤點記錄失敗");
    }

    return c.json({
      success: true,
      data: result.data,
    });
  },
);

/**
 * 審核現金操作
 * POST /cash-movements/:movementId/approve
 */
app.post(
  "/cash-movements/:movementId/approve",
  authMiddleware,
  requireRole([0, 1]), // Admin or Owner only
  validateParams(
    z.lazy(() =>
      z.object({
        movementId: z.uuid(),
      }),
    ),
  ),
  async (c) => {
    const { movementId } = c.get("validatedParams");
    const user = c.get("user");
    await new PosTenantAccessService(c.env.DB).requireCashMovement(
      user,
      movementId,
    );

    const cashMovementService = new CashMovementService(c.env.DB);
    const result = await cashMovementService.approveCashMovement(
      movementId,
      user.id,
    );

    if (!result.success) {
      throw badRequest(result.error || "審核現金操作失敗");
    }

    return c.json({
      success: true,
      message: "現金操作已審核通過",
    });
  },
);

/**
 * 拒絕現金操作
 * POST /cash-movements/:movementId/reject
 */
app.post(
  "/cash-movements/:movementId/reject",
  authMiddleware,
  requireRole([0, 1]), // Admin or Owner only
  validateParams(
    z.lazy(() =>
      z.object({
        movementId: z.uuid(),
      }),
    ),
  ),
  validateBody(
    z.lazy(() =>
      z.object({
        reason: z.string().max(200).optional(),
      }),
    ),
  ),
  async (c) => {
    const { movementId } = c.get("validatedParams");
    const { reason } = c.get("validatedBody");
    const user = c.get("user");
    await new PosTenantAccessService(c.env.DB).requireCashMovement(
      user,
      movementId,
    );

    const cashMovementService = new CashMovementService(c.env.DB);
    const result = await cashMovementService.rejectCashMovement(
      movementId,
      user.id,
      reason,
    );

    if (!result.success) {
      throw badRequest(result.error || "拒絕現金操作失敗");
    }

    return c.json({
      success: true,
      message: "現金操作已拒絕",
    });
  },
);

export default app;
