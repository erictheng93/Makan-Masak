/**
 * 收據管理路由
 */

import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware, requireRole } from "../../../middleware/auth";
import {
  validateBody,
  validateQuery,
  validateParams,
  boundedLimitQuery,
  boundedPageQuery,
} from "../../../middleware/validation";
import { ReceiptService } from "../services/ReceiptService";
import { PosTenantAccessService } from "../services/PosTenantAccessService";
import { printReceiptSchema, receiptParamsSchema } from "../schemas";
import type { Env } from "../../../types/env";
import { badRequest, notFound } from "../../../shared/utils/api-error";
import { resolveOrderIdentity } from "../../../shared/services/order-identity";
import { moduleGate } from "../../../middleware/moduleGate";
import { quotaGate } from "../../../middleware/quotaGate";
import { meterEmit } from "../../../shared/utils/meter";

const app = new Hono<{ Bindings: Env }>();
const printReceiptRouteSchema = printReceiptSchema.extend({
  orderId: z.union([z.number().int().positive(), z.string().min(1)]),
});

export const receiptListQuerySchema = z.lazy(() =>
  z.object({
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    receiptType: z.enum(["customer", "kitchen", "merchant"]).optional(),
    page: boundedPageQuery(),
    limit: boundedLimitQuery(),
  }),
);

/**
 * 打印收據
 * POST /receipts/print
 */
app.post(
  "/print",
  authMiddleware,
  requireRole([0, 1, 4]), // Admin, Owner, Cashier
  // Physical receipt printing is the "receipt_printing" module (pro tier+),
  // not "pos" — the two happen to share every plan tier today, but the
  // separate key exists so an admin can disable printing specifically via a
  // moduleOverride without disabling the whole POS terminal. It also carries
  // the same print-job quota metering as orders/:id/receipt.
  moduleGate("receipt_printing"),
  quotaGate("print.jobs"),
  validateBody(printReceiptRouteSchema),
  async (c) => {
    const data = c.get("validatedBody");
    const user = c.get("user");
    const registerId = c.req.header("X-Register-Id");
    const shiftId = c.req.header("X-Shift-Id");

    if (!registerId) {
      throw badRequest("需要指定收銀機ID");
    }

    await new PosTenantAccessService(c.env.DB).requireRegisterAndShift(
      user,
      registerId,
      shiftId,
    );

    const orderIdentity = await resolveOrderIdentity(c.env.DB, data.orderId, {
      restaurantId:
        user.restaurantId !== undefined ? String(user.restaurantId) : undefined,
    });
    const receiptService = new ReceiptService(c.env.DB);
    const result = await receiptService.printReceipt(
      { ...data, orderId: orderIdentity.id },
      registerId,
      shiftId,
    );

    if (!result.success) {
      throw badRequest(result.error || "打印收據失敗");
    }

    await meterEmit(c, "print.jobs");

    return c.json({
      success: true,
      data: result.data
        ? { ...result.data, orderPublicId: orderIdentity.publicId }
        : result.data,
    });
  },
);

/**
 * 重打收據
 * POST /receipts/:receiptId/reprint
 */
app.post(
  "/:receiptId/reprint",
  authMiddleware,
  requireRole([0, 1, 4]), // Admin, Owner, Cashier
  moduleGate("receipt_printing"),
  quotaGate("print.jobs"),
  validateParams(receiptParamsSchema),
  async (c) => {
    const { receiptId } = c.get("validatedParams");
    await new PosTenantAccessService(c.env.DB).requireReceipt(
      c.get("user"),
      receiptId,
    );

    const receiptService = new ReceiptService(c.env.DB);
    const result = await receiptService.reprintReceipt(receiptId);

    if (!result.success) {
      if (result.error === "收據不存在") {
        throw notFound("收據不存在", "RECEIPT_NOT_FOUND");
      }
      throw badRequest(result.error || "重打收據失敗");
    }

    await meterEmit(c, "print.jobs");

    return c.json({
      success: true,
      message: "收據重打中",
    });
  },
);

/**
 * 取消收據打印
 * POST /receipts/:receiptId/cancel
 */
app.post(
  "/:receiptId/cancel",
  authMiddleware,
  requireRole([0, 1, 4]), // Admin, Owner, Cashier
  validateParams(receiptParamsSchema),
  async (c) => {
    const { receiptId } = c.get("validatedParams");
    await new PosTenantAccessService(c.env.DB).requireReceipt(
      c.get("user"),
      receiptId,
    );

    const receiptService = new ReceiptService(c.env.DB);
    const result = await receiptService.cancelPrint(receiptId);

    if (!result.success) {
      throw badRequest(result.error || "取消打印失敗");
    }

    return c.json({
      success: true,
      message: "打印已取消",
    });
  },
);

/**
 * 獲取收據列表
 * GET /registers/:registerId/receipts
 */
app.get(
  "/registers/:registerId/receipts",
  authMiddleware,
  requireRole([0, 1, 4]), // Admin, Owner, Cashier
  validateParams(
    z.lazy(() =>
      z.object({
        registerId: z.uuid(),
      }),
    ),
  ),
  validateQuery(receiptListQuerySchema),
  async (c) => {
    const { registerId } = c.get("validatedParams");
    const { startDate, endDate, receiptType, page, limit } =
      c.get("validatedQuery");
    await new PosTenantAccessService(c.env.DB).requireRegister(
      c.get("user"),
      registerId,
    );

    const receiptService = new ReceiptService(c.env.DB);
    const result = await receiptService.getReceipts(registerId, {
      startDate,
      endDate,
      receiptType,
      page,
      limit,
    });

    if (!result.success) {
      throw badRequest(result.error || "獲取收據列表失敗");
    }

    return c.json({
      success: true,
      data: result.data,
    });
  },
);

/**
 * 獲取收據詳情
 * GET /receipts/:receiptId
 */
app.get(
  "/:receiptId",
  authMiddleware,
  requireRole([0, 1, 4]), // Admin, Owner, Cashier
  validateParams(receiptParamsSchema),
  async (c) => {
    const { receiptId } = c.get("validatedParams");
    await new PosTenantAccessService(c.env.DB).requireReceipt(
      c.get("user"),
      receiptId,
    );

    const receiptService = new ReceiptService(c.env.DB);
    const result = await receiptService.getReceiptDetail(receiptId);

    if (!result.success) {
      if (result.error === "收據不存在") {
        throw notFound("收據不存在", "RECEIPT_NOT_FOUND");
      }
      throw badRequest(result.error || "獲取收據詳情失敗");
    }

    return c.json({
      success: true,
      data: result.data,
    });
  },
);

export default app;
