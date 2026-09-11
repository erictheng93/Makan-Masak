/**
 * 報表統計路由
 */

import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware, requireRole } from "../../../middleware/auth";
import { validateQuery } from "../../../middleware/validation";
import { ReportService } from "../services/ReportService";
import { PosTenantAccessService } from "../services/PosTenantAccessService";
import type { Env } from "../../../types/env";
import {
  ApiError,
  forbidden,
  badRequest,
} from "../../../shared/utils/api-error";

const app = new Hono<{ Bindings: Env }>();

/**
 * 獲取日營業報表
 * GET /reports/daily
 */
app.get(
  "/daily",
  authMiddleware,
  requireRole([0, 1]), // Admin or Owner
  validateQuery(
    z.lazy(() =>
      z.object({
        restaurantId: z.string().optional(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    ),
  ),
  async (c) => {
    const user = c.get("user");
    const { restaurantId, date } = c.get("validatedQuery");

    // 確定餐廳ID
    let finalRestaurantId: string | undefined;
    if (restaurantId) {
      finalRestaurantId = restaurantId;
      if (user.role === 1 && user.restaurantId !== finalRestaurantId) {
        throw forbidden("只能查看自己餐廳的報表");
      }
    } else if (user.restaurantId) {
      finalRestaurantId = String(user.restaurantId);
    } else {
      throw badRequest("需要指定餐廳ID");
    }

    const reportService = new ReportService(c.env.DB);
    const result = await reportService.getDailyReport(finalRestaurantId!, date);

    if (!result.success) {
      throw badRequest(result.error || "獲取日營業報表失敗");
    }

    return c.json({
      success: true,
      data: result.data,
    });
  },
);

/**
 * 獲取收銀機使用統計
 * GET /reports/register-usage
 */
app.get(
  "/register-usage",
  authMiddleware,
  requireRole([0, 1]), // Admin or Owner
  validateQuery(
    z.lazy(() =>
      z.object({
        restaurantId: z.string().optional(),
        period: z.enum(["day", "week", "month"]).optional().default("day"),
      }),
    ),
  ),
  async (c) => {
    const user = c.get("user");
    const { restaurantId, period } = c.get("validatedQuery");

    // 確定餐廳ID
    let finalRestaurantId: string | undefined;
    if (restaurantId) {
      finalRestaurantId = restaurantId;
      if (user.role === 1 && user.restaurantId !== finalRestaurantId) {
        throw forbidden("只能查看自己餐廳的統計");
      }
    } else if (user.restaurantId) {
      finalRestaurantId = String(user.restaurantId);
    } else {
      throw badRequest("需要指定餐廳ID");
    }

    const reportService = new ReportService(c.env.DB);
    const result = await reportService.getRegisterUsageStats(
      finalRestaurantId!,
      period,
    );

    if (!result.success) {
      throw badRequest(result.error || "獲取收銀機使用統計失敗");
    }

    return c.json({
      success: true,
      data: result.data,
    });
  },
);

/**
 * 匯出報表
 * GET /reports/export
 */
app.get(
  "/export",
  authMiddleware,
  requireRole([0, 1]), // Admin or Owner
  validateQuery(
    z.lazy(() =>
      z.object({
        restaurantId: z.string().optional(),
        type: z.enum(["daily", "shift", "register-usage"]),
        format: z.enum(["json", "csv", "pdf"]).optional().default("json"),
        startDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        endDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        shiftId: z.uuid().optional(),
        registerId: z.uuid().optional(),
      }),
    ),
  ),
  async (c) => {
    const user = c.get("user");
    const { restaurantId, type, format, startDate, shiftId } =
      c.get("validatedQuery");

    // 確定餐廳ID
    let finalRestaurantId: string | undefined;
    if (restaurantId) {
      finalRestaurantId = restaurantId;
      if (user.role === 1 && user.restaurantId !== finalRestaurantId) {
        throw forbidden("只能匯出自己餐廳的報表");
      }
    } else if (user.restaurantId) {
      finalRestaurantId = String(user.restaurantId);
    } else {
      throw badRequest("需要指定餐廳ID");
    }

    const reportService = new ReportService(c.env.DB);
    let result: {
      success: boolean;
      data?: Record<string, unknown>;
      error?: string;
    };

    switch (type) {
      case "daily":
        if (!startDate) {
          throw badRequest("日報表需要指定日期");
        }
        result = await reportService.getDailyReport(
          finalRestaurantId!,
          startDate,
        );
        break;

      case "shift":
        if (!shiftId) {
          throw badRequest("班次報表需要指定班次ID");
        }
        // 這條分支不吃上面算出來的 finalRestaurantId，只吃 shiftId，所以上面
        // 那段餐廳範圍檢查對它完全沒有作用。班次歸屬要另外查
        // (cash_shifts -> cash_registers.restaurant_id)。
        await new PosTenantAccessService(c.env.DB).requireShift(user, shiftId);
        result = await reportService.generateShiftReport(shiftId);
        break;

      case "register-usage":
        result = await reportService.getRegisterUsageStats(
          finalRestaurantId!,
          "day",
        );
        break;

      default:
        throw badRequest("不支援的報表類型");
    }

    if (!result.success) {
      throw badRequest(result.error || "匯出報表失敗");
    }

    // 根據格式返回不同的響應
    switch (format) {
      case "json":
        return c.json({
          success: true,
          data: result.data,
        });

      case "csv": {
        // 簡化的CSV格式（實際應用中需要更完整的CSV轉換）
        const csvData = convertToCSV(result.data, type);
        return new Response(csvData, {
          headers: {
            "Content-Type": "text/csv",
            "Content-Disposition": `attachment; filename="${type}-report-${Date.now()}.csv"`,
          },
        });
      }

      case "pdf":
        // PDF生成（實際應用中需要PDF生成庫）
        throw new ApiError("FORMAT_NOT_SUPPORTED", "PDF格式暫未支援", 501);

      default:
        throw badRequest("不支援的匯出格式");
    }
  },
);

/**
 * 簡化的CSV轉換函數
 */
function convertToCSV(
  data: Record<string, unknown> | undefined,
  type: string,
): string {
  // 這是一個簡化的實現，實際應用中需要更完整的CSV轉換邏輯
  if (type === "daily" && data) {
    const summary = (data.summary as Record<string, unknown>) || {};
    const headers = [
      "日期",
      "總訂單",
      "總營收",
      "總稅額",
      "總折扣",
      "退款次數",
      "退款金額",
      "淨營收",
    ];
    const row = [
      data.date,
      summary.totalOrders,
      summary.totalSales,
      summary.totalTax,
      summary.totalDiscounts,
      summary.totalRefunds,
      summary.totalRefundAmount,
      summary.netSales,
    ];
    return [headers.join(","), row.join(",")].join("\n");
  }

  return "CSV格式轉換暫未完整實現";
}

export default app;
