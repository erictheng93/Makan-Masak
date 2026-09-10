import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { DiscountType, DistributionType, TargetType } from "../schema";
import {
  couponDistributions,
  coupons,
  couponUsage,
  customers,
  menuItems as menuItemsTable,
  orders,
  userCoupons,
} from "../schema";
import {
  amountFromCents,
  fromCents,
  percentageFromBps,
  toCents,
  toRequiredCents,
  toRequiredPercentageBps,
} from "../utils/money";
import { BaseService } from "./base";

/** 完整的 `coupons` 資料列，即 `insert`/`update` … `returning()` 回傳的形狀。 */
export type CouponRow = typeof coupons.$inferSelect;

/** mapCouponMoneyFields 會讀取的金額欄位子集（`_cents` / `_bps`）。 */
type CouponMoneyColumns = Pick<
  CouponRow,
  | "discountType"
  | "discountPercentageBps"
  | "discountValueCents"
  | "maxDiscountAmountCents"
  | "minOrderAmountCents"
>;

export type CouponWithMoneyFields<T extends CouponMoneyColumns = CouponRow> =
  T & {
    discountValue: number | null;
    maxDiscountAmount: number | null;
    minOrderAmount: number | null;
  };

// 優惠券驗證結果接口
export interface CouponValidationResult {
  valid: boolean;
  coupon?: CouponWithMoneyFields;
  error?: string;
  discountAmount?: number;
  finalAmount?: number;
}

// 優惠券資格檢查失敗的穩定錯誤代碼
export type CouponEligibilityCode =
  | "COUPON_NOT_FOUND"
  | "COUPON_NOT_VISIBLE"
  | "COUPON_WRONG_RESTAURANT"
  | "COUPON_INACTIVE"
  | "COUPON_NOT_STARTED"
  | "COUPON_EXPIRED"
  | "COUPON_USAGE_LIMIT_REACHED"
  | "COUPON_MIN_ORDER_NOT_MET"
  | "COUPON_USER_LIMIT_REACHED"
  // 設了每人上限、但呼叫端沒有身分且此券無總量上限（訪客訂單）
  | "COUPON_REQUIRES_IDENTITY"
  | "COUPON_NOT_APPLICABLE"
  | "COUPON_ALREADY_USED";

/**
 * 優惠券資格檢查失敗錯誤。
 *
 * 帶穩定 code 的一般 Error，由 API 層對照 `CouponEligibilityCode` 轉譯成
 * 對應的 ApiError 與狀態碼。
 *
 * 注意：這裡不是「packages/database 不能依賴 ApiError」——那句舊註解已不成立。
 * ApiError 住在 `@makanmasak/utils`，本套件本來就依賴它，
 * `ticket-primitives/state-machine.ts` 與 `order.ts` 也直接擲出 ApiError。
 * 這個類別留著是因為它的 code 列舉是 API 層對照表的來源，
 * 換掉會動到轉譯表——那是另一張票的範圍（#352 刻意不擴大）。
 * 可透過 `CouponService.EligibilityError` 取得（免經 package index 再匯出）。
 */
export class CouponEligibilityError extends Error {
  constructor(
    public readonly code: CouponEligibilityCode,
    message: string,
  ) {
    super(message);
    this.name = "CouponEligibilityError";
  }
}

/** Raised when a target type has no defined audience yet. */
export class CouponDistributionTargetError extends Error {
  readonly code = "COUPON_DISTRIBUTION_TARGET_UNSUPPORTED";

  constructor(targetType: string) {
    super(`不支援的發放對象：${targetType}`);
    this.name = "CouponDistributionTargetError";
  }
}

/**
 * Audience selectors for a distribution batch.
 *
 * `customers` is a platform-level table with no restaurant column, so a
 * restaurant's audience is derived from who has ordered there. A platform
 * coupon (restaurant_id IS NULL) addresses every active customer instead.
 */
export interface DistributionTargetCriteria {
  /** targetType "user": the exact customers to issue to. */
  customerIds?: string[];
  /** targetType "vip": minimum completed orders at this restaurant. */
  minOrders?: number;
}

export interface DistributeCouponInput {
  couponId: number;
  distributionType: DistributionType;
  targetType?: TargetType;
  targetCriteria?: DistributionTargetCriteria;
  expiresAt?: Date | null;
  notes?: string | null;
  createdBy?: string | null;
}

/**
 * Batch size for the `IN (...)` lists an audience is fed through. An audience is
 * unbounded in principle and the API accepts up to 5000 explicit ids, both of
 * which run into D1's bound-parameter limit.
 */
const AUDIENCE_ID_CHUNK = 100;

export interface DistributeCouponResult {
  distributionId: number;
  /** Customers the audience resolved to. */
  targeted: number;
  /** New user_coupons rows written. */
  issued: number;
  /** Already holding a live instance, so left alone. */
  skipped: number;
}

/** Stable duplicate-code signal for API transports to map to a 409. */
export class CouponDuplicateCodeError extends Error {
  readonly code = "COUPON_CODE_EXISTS";

  constructor() {
    super("此優惠券代碼在本店已存在，請換一個");
    this.name = "CouponDuplicateCodeError";
  }
}

// assertCouponRedeemable 所需的優惠券欄位子集
export interface RedeemableCouponRow {
  id: number;
  restaurantId: string | null;
  deletedAt: Date | null;
  isActive: boolean | null;
  isVisible: boolean | null;
  validFrom: Date;
  validTo: Date;
  usageLimit: number | null;
  usedCount: number | null;
  usageLimitPerUser: number | null;
  minOrderAmountCents: number | null;
  applicableMenuItems: number[] | null;
  applicableCategories: number[] | null;
}

// 資格檢查的執行情境
export interface CouponEligibilityContext {
  restaurantId: string;
  orderAmountCents: number;
  userId?: string;
  menuItems?: Array<{ menuItemId: number; quantity: number }>;
  /**
   * - "validate": 顧客探索/預覽路徑 — 額外強制 isVisible
   * - "redeem":   兌換路徑 — 隱藏但仍啟用中的代碼視為合法，可兌換
   */
  mode: "validate" | "redeem";
}

// 優惠券創建資料接口
export interface CreateCouponData {
  restaurantId?: string;
  code: string;
  name: string;
  description?: string;
  discountType: DiscountType;
  discountValue: number;
  maxDiscountAmount?: number | null;
  minOrderAmount?: number;
  applicableMenuItems?: number[];
  applicableCategories?: number[];
  usageLimit?: number | null;
  usageLimitPerUser?: number | null;
  validFrom: Date;
  validTo: Date;
  isActive?: boolean;
  isVisible?: boolean;
  createdBy?: string;
}

// 優惠券使用資料接口
export interface UseCouponData {
  couponId: number;
  orderId: string;
  userId?: string;
  discountAmount: number;
  originalAmount: number;
  finalAmount: number;
}

// 優惠券查詢過濾器
export interface CouponFilters {
  restaurantId?: string;
  isActive?: boolean;
  isVisible?: boolean;
  discountType?: DiscountType;
  status?: "active" | "expired" | "exhausted" | "inactive";
  validOnly?: boolean;
  search?: string;
}

export class CouponService extends BaseService {
  /**
   * 讓 API 層可經由已匯出的 CouponService 取得錯誤類別
   * （services/index.ts 未逐一再匯出 coupon.ts 的所有符號）。
   */
  static readonly EligibilityError = CouponEligibilityError;
  static readonly DuplicateCodeError = CouponDuplicateCodeError;
  static readonly DistributionTargetError = CouponDistributionTargetError;

  private mapCouponMoneyFields<T extends CouponMoneyColumns>(
    coupon: T,
  ): CouponWithMoneyFields<T> {
    const hasDiscountValue =
      "discountPercentageBps" in coupon || "discountValueCents" in coupon;
    const hasMaxDiscountAmount = "maxDiscountAmountCents" in coupon;
    const hasMinOrderAmount = "minOrderAmountCents" in coupon;

    const normalized: CouponWithMoneyFields<T> = {
      ...coupon,
      discountValue: null,
      maxDiscountAmount: null,
      minOrderAmount: null,
    };

    if (hasDiscountValue) {
      normalized.discountValue =
        coupon.discountType === "percentage"
          ? percentageFromBps(coupon.discountPercentageBps)
          : amountFromCents(coupon.discountValueCents);
    }

    if (hasMaxDiscountAmount) {
      normalized.maxDiscountAmount = amountFromCents(
        coupon.maxDiscountAmountCents,
      );
    }

    if (hasMinOrderAmount) {
      normalized.minOrderAmount = amountFromCents(coupon.minOrderAmountCents);
    }

    return normalized;
  }

  private toCouponUpdate(updates: Partial<CreateCouponData>) {
    const {
      restaurantId,
      discountValue,
      maxDiscountAmount,
      minOrderAmount,
      ...nonMoneyUpdates
    } = updates;
    void restaurantId;
    void discountValue;
    void maxDiscountAmount;
    void minOrderAmount;
    return nonMoneyUpdates;
  }

  /**
   * 驗證優惠券代碼
   * @param code 優惠券代碼
   * @param restaurantId 餐廳ID
   * @param orderAmount 訂單金額
   * @param userId 用戶ID (可選)
   * @param menuItems 訂單商品 (用於檢查適用商品)
   */
  async validateCoupon(
    code: string,
    restaurantId: string,
    orderAmount: number,
    userId?: string,
    menuItems?: Array<{ menuItemId: number; quantity: number }>,
  ): Promise<CouponValidationResult> {
    try {
      // Codes are unique per tenant (0013), so a bare `code` lookup is no
      // longer unambiguous: this restaurant and the platform can both own
      // WELCOME10. Restrict the search to the two that may legitimately apply
      // and prefer the restaurant's own over the platform one. Soft-deleted
      // rows are excluded here rather than only inside assertCouponRedeemable,
      // so a deleted row can never shadow a live one with the same code.
      const coupon = await this.db.query.coupons.findFirst({
        where: and(
          eq(coupons.code, code.toUpperCase()),
          isNull(coupons.deletedAt),
          or(
            eq(coupons.restaurantId, restaurantId),
            isNull(coupons.restaurantId),
          ),
        ),
        orderBy: [asc(sql`${coupons.restaurantId} IS NULL`)],
      });

      if (!coupon) {
        return { valid: false, error: "優惠券代碼不存在或已失效" };
      }

      const orderAmountCents = toRequiredCents(orderAmount);

      try {
        await this.assertCouponRedeemable(coupon, {
          restaurantId,
          orderAmountCents,
          userId,
          menuItems,
          mode: "validate",
        });
      } catch (error) {
        if (error instanceof CouponEligibilityError) {
          return { valid: false, error: error.message };
        }
        throw error;
      }

      // 計算折扣金額
      let discountAmountCents = 0;
      if (coupon.discountType === "percentage") {
        const discountPercentage =
          percentageFromBps(coupon.discountPercentageBps) ?? 0;
        discountAmountCents = Math.round(
          orderAmountCents * (discountPercentage / 100),
        );

        // 應用最大折扣金額限制
        const maxDiscountAmountCents = coupon.maxDiscountAmountCents;
        if (
          maxDiscountAmountCents &&
          discountAmountCents > maxDiscountAmountCents
        ) {
          discountAmountCents = maxDiscountAmountCents;
        }
      } else {
        discountAmountCents = coupon.discountValueCents ?? 0;
      }

      // 確保折扣金額不超過訂單金額
      discountAmountCents = Math.min(discountAmountCents, orderAmountCents);
      const finalAmountCents = Math.max(
        0,
        orderAmountCents - discountAmountCents,
      );
      const discountAmount = fromCents(discountAmountCents);
      const finalAmount = fromCents(finalAmountCents);

      return {
        valid: true,
        coupon: this.mapCouponMoneyFields(coupon),
        discountAmount,
        finalAmount,
      };
    } catch (error) {
      console.error("Coupon validation error:", error);
      return { valid: false, error: "優惠券驗證失敗，請稍後再試" };
    }
  }

  /**
   * 單一共享的優惠券資格檢查 — /validate 與兌換路徑共用同一份實作。
   * 任一規則不符即擲出帶穩定 code 的 CouponEligibilityError：
   * 軟刪除、isVisible（僅 validate 模式）、餐廳歸屬、isActive、
   * 有效期、總使用上限（advisory）、最低訂單金額、每用戶上限、適用商品/分類。
   *
   * 注意：usageLimit 在此僅為提早給出明確錯誤的 advisory 檢查；
   * 真正的權威判斷是 claimUsageSlot() 的條件式 UPDATE。
   */
  async assertCouponRedeemable(
    coupon: RedeemableCouponRow,
    context: CouponEligibilityContext,
  ): Promise<void> {
    // 軟刪除視同不存在
    if (coupon.deletedAt) {
      throw new CouponEligibilityError(
        "COUPON_NOT_FOUND",
        "優惠券代碼不存在或已失效",
      );
    }

    // 隱藏優惠券只在顧客探索/預覽路徑攔下；
    // 收銀端兌換「隱藏但啟用中」的代碼是合法情境。
    // 訊息與「不存在」相同，避免洩漏隱藏代碼的存在。
    if (context.mode === "validate" && !coupon.isVisible) {
      throw new CouponEligibilityError(
        "COUPON_NOT_VISIBLE",
        "優惠券代碼不存在或已失效",
      );
    }

    // 餐廳歸屬：restaurantId 為 NULL 代表全平台通用
    if (coupon.restaurantId && coupon.restaurantId !== context.restaurantId) {
      throw new CouponEligibilityError(
        "COUPON_WRONG_RESTAURANT",
        "此優惠券不適用於此餐廳",
      );
    }

    if (!coupon.isActive) {
      throw new CouponEligibilityError("COUPON_INACTIVE", "優惠券已停用");
    }

    // 檢查有效期（validFrom/validTo 為 INTEGER ms，Drizzle 已還原成 Date）
    const now = new Date();
    if (now < coupon.validFrom) {
      throw new CouponEligibilityError("COUPON_NOT_STARTED", "優惠券尚未生效");
    }
    if (now > coupon.validTo) {
      throw new CouponEligibilityError("COUPON_EXPIRED", "優惠券已過期");
    }

    // 總使用上限（advisory；權威在 claimUsageSlot 的條件式 UPDATE）
    if (coupon.usageLimit && (coupon.usedCount || 0) >= coupon.usageLimit) {
      throw new CouponEligibilityError(
        "COUPON_USAGE_LIMIT_REACHED",
        "優惠券使用次數已達上限",
      );
    }

    // 檢查最低訂單金額
    const minOrderAmountCents = coupon.minOrderAmountCents ?? 0;
    if (
      minOrderAmountCents > 0 &&
      context.orderAmountCents < minOrderAmountCents
    ) {
      throw new CouponEligibilityError(
        "COUPON_MIN_ORDER_NOT_MET",
        `訂單金額需滿 $${amountFromCents(minOrderAmountCents)} 才可使用此優惠券`,
      );
    }

    // 檢查每用戶使用上限。
    // 注意：count-then-insert 存在小競態（兩個併發請求可能同時通過檢查），
    // D1 沒有交易可用；總量上限仍由 claimUsageSlot 原子保證。
    if (coupon.usageLimitPerUser) {
      if (!context.userId) {
        // 訪客訂單沒有可鍵的身分：coupon_usage.user_id 是 users.id 的外鍵，
        // 訪客只帶電話而電話在這張表沒有欄位可放，所以無法逐人計數。
        // 若同時連總量上限都沒有，「每人 N 次」就完全無界 —— 直接拒絕，
        // 不要讓一張設了每人上限的券變成無限量券。
        // 有 usageLimit 時仍放行：claimUsageSlot 的原子 UPDATE 是權威封頂，
        // 損害有界，維持既有的訪客可用行為。
        if (!coupon.usageLimit) {
          throw new CouponEligibilityError(
            "COUPON_REQUIRES_IDENTITY",
            "此優惠券限定每人使用次數，請先登入再使用",
          );
        }
      } else {
        const userUsageCount = await this.db
          .select({ count: sql<number>`count(*)` })
          .from(couponUsage)
          .where(
            and(
              eq(couponUsage.couponId, coupon.id),
              eq(couponUsage.userId, context.userId),
              eq(couponUsage.status, "active"),
            ),
          );

        if ((userUsageCount[0]?.count ?? 0) >= coupon.usageLimitPerUser) {
          throw new CouponEligibilityError(
            "COUPON_USER_LIMIT_REACHED",
            "您已達到此優惠券的使用次數上限",
          );
        }
      }
    }

    // 檢查適用商品限制（有提供訂單商品時才檢查）
    if (coupon.applicableMenuItems && context.menuItems) {
      const applicableItems = coupon.applicableMenuItems;
      const hasApplicableItem = context.menuItems.some((item) =>
        applicableItems.includes(item.menuItemId),
      );

      if (!hasApplicableItem) {
        throw new CouponEligibilityError(
          "COUPON_NOT_APPLICABLE",
          "此優惠券不適用於購物車中的商品",
        );
      }
    }

    // 檢查適用分類限制
    if (coupon.applicableCategories && context.menuItems) {
      const applicableCategories = coupon.applicableCategories;

      // 查詢商品的分類資訊
      const menuItemIds = context.menuItems.map((item) => item.menuItemId);
      const itemCategories = await this.db.query.menuItems.findMany({
        where: inArray(menuItemsTable.id, menuItemIds),
        with: {
          category: true,
        },
      });

      const hasApplicableCategory = itemCategories.some(
        (item) =>
          item.category && applicableCategories.includes(item.category.id),
      );

      if (!hasApplicableCategory) {
        throw new CouponEligibilityError(
          "COUPON_NOT_APPLICABLE",
          "此優惠券不適用於購物車中商品的分類",
        );
      }
    }
  }

  /**
   * 記錄優惠券使用
   */
  async useCoupon(data: UseCouponData) {
    const [existingUsage] = await this.db
      .select({ id: couponUsage.id })
      .from(couponUsage)
      .where(
        and(
          eq(couponUsage.couponId, data.couponId),
          eq(couponUsage.orderId, data.orderId),
          sql`(${couponUsage.status} IS NULL OR ${couponUsage.status} != 'cancelled')`,
        ),
      )
      .limit(1);

    if (existingUsage) {
      throw new CouponEligibilityError(
        "COUPON_ALREADY_USED",
        "Coupon already used for this order",
      );
    }

    await this.claimUsageSlot(data.couponId);

    try {
      const usageRecord = await this.db
        .insert(couponUsage)
        .values({
          couponId: data.couponId,
          orderId: data.orderId,
          userId: data.userId,
          discountAmountCents: toRequiredCents(data.discountAmount),
          originalAmountCents: toRequiredCents(data.originalAmount),
          finalAmountCents: toRequiredCents(data.finalAmount),
          status: "active",
        })
        .returning();

      return usageRecord[0];
    } catch (error) {
      try {
        await this.releaseUsageSlot(data.couponId);
      } catch (rollbackError) {
        console.error("Coupon usage count rollback failed:", rollbackError);
      }

      throw error;
    }
  }

  /**
   * 原子地佔用一個使用名額（條件式 UPDATE，內含上限檢查）。
   * 名額已滿時擲出錯誤。後續消費名額的寫入若失敗，
   * 呼叫端必須以 releaseUsageSlot() 歸還。
   */
  async claimUsageSlot(couponId: number): Promise<void> {
    const claim = await this.d1
      .prepare(
        `UPDATE coupons
            SET used_count = coalesce(used_count, 0) + 1,
                updated_at_ms = unixepoch('now') * 1000
          WHERE id = ?
            AND (usage_limit IS NULL OR coalesce(used_count, 0) < usage_limit)`,
      )
      .bind(couponId)
      .run();

    if ((claim.meta?.changes ?? 0) === 0) {
      throw new CouponEligibilityError(
        "COUPON_USAGE_LIMIT_REACHED",
        "Coupon usage limit reached",
      );
    }
  }

  /**
   * 歸還一個先前佔用的使用名額（claimUsageSlot 的補償操作）。
   */
  async releaseUsageSlot(couponId: number): Promise<void> {
    await this.d1
      .prepare(
        `UPDATE coupons
            SET used_count = CASE
                  WHEN coalesce(used_count, 0) > 0
                  THEN coalesce(used_count, 0) - 1
                  ELSE 0
                END,
                updated_at_ms = unixepoch('now') * 1000
          WHERE id = ?`,
      )
      .bind(couponId)
      .run();
  }

  /**
   * 創建優惠券
   */
  async createCoupon(data: CreateCouponData) {
    // Scoped to match the unique indexes from 0013. A platform-wide lookup here
    // would reject a code purely because a different restaurant already uses
    // it, which is exactly what that migration removed. Soft-deleted rows are
    // excluded so a deleted coupon releases its code.
    const existingCoupon = await this.db.query.coupons.findFirst({
      where: and(
        eq(coupons.code, data.code.toUpperCase()),
        isNull(coupons.deletedAt),
        data.restaurantId
          ? eq(coupons.restaurantId, data.restaurantId)
          : isNull(coupons.restaurantId),
      ),
    });

    if (existingCoupon) {
      throw new CouponDuplicateCodeError();
    }

    const coupon = await this.db
      .insert(coupons)
      .values({
        restaurantId: data.restaurantId,
        code: data.code.toUpperCase(),
        name: data.name,
        description: data.description,
        discountType: data.discountType,
        discountPercentageBps:
          data.discountType === "percentage"
            ? toRequiredPercentageBps(data.discountValue)
            : null,
        discountValueCents:
          data.discountType === "percentage"
            ? null
            : toRequiredCents(data.discountValue),
        maxDiscountAmountCents: toCents(data.maxDiscountAmount),
        minOrderAmountCents: toRequiredCents(data.minOrderAmount || 0),
        applicableMenuItems: data.applicableMenuItems,
        applicableCategories: data.applicableCategories,
        usageLimit: data.usageLimit,
        usageLimitPerUser: data.usageLimitPerUser,
        validFrom: data.validFrom,
        validTo: data.validTo,
        isActive: data.isActive !== false,
        isVisible: data.isVisible !== false,
        createdBy: data.createdBy,
      })
      .returning();

    return coupon[0] ? this.mapCouponMoneyFields(coupon[0]) : coupon[0];
  }

  /**
   * 獲取優惠券列表
   */
  async getCoupons(filters: CouponFilters = {}, page = 1, limit = 20) {
    const whereConditions = [];

    if (filters.restaurantId) {
      // Management is tenant-scoped. Platform coupons remain available to
      // customers but are not silently mixed into an owner's administration.
      whereConditions.push(eq(coupons.restaurantId, filters.restaurantId));
    }

    if (filters.isActive !== undefined) {
      whereConditions.push(eq(coupons.isActive, filters.isActive));
    }

    if (filters.isVisible !== undefined) {
      whereConditions.push(eq(coupons.isVisible, filters.isVisible));
    }

    if (filters.discountType) {
      whereConditions.push(eq(coupons.discountType, filters.discountType));
    }

    // This mirrors the dashboard status helper, so filtering happens before
    // pagination rather than only on the records already loaded in the UI.
    if (filters.status) {
      const now = new Date();
      switch (filters.status) {
        case "inactive":
          whereConditions.push(eq(coupons.isActive, false));
          break;
        case "expired":
          whereConditions.push(
            and(eq(coupons.isActive, true), lt(coupons.validTo, now)),
          );
          break;
        case "exhausted":
          whereConditions.push(
            and(
              eq(coupons.isActive, true),
              gte(coupons.validTo, now),
              sql`${coupons.usageLimit} IS NOT NULL AND coalesce(${coupons.usedCount}, 0) >= ${coupons.usageLimit}`,
            ),
          );
          break;
        case "active":
          whereConditions.push(
            and(
              eq(coupons.isActive, true),
              lte(coupons.validFrom, now),
              gte(coupons.validTo, now),
              sql`(${coupons.usageLimit} IS NULL OR coalesce(${coupons.usedCount}, 0) < ${coupons.usageLimit})`,
            ),
          );
          break;
      }
    }

    // Soft-deleted rows stay available to an administrator by direct id for
    // history/statistics, but never appear in an active management list.
    whereConditions.push(sql`${coupons.deletedAt} IS NULL`);

    if (filters.validOnly) {
      const now = new Date();
      whereConditions.push(
        and(lte(coupons.validFrom, now), gte(coupons.validTo, now)),
      );
    }

    if (filters.search) {
      whereConditions.push(
        sql`(${coupons.name} LIKE ${"%" + filters.search + "%"} OR ${coupons.code} LIKE ${"%" + filters.search.toUpperCase() + "%"})`,
      );
    }

    const whereClause =
      whereConditions.length > 0
        ? whereConditions.reduce((acc, condition) => and(acc, condition))
        : undefined;

    // 查詢總數
    const totalResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(coupons)
      .where(whereClause);

    const total = totalResult[0]?.count || 0;

    // 查詢資料
    const couponList = await this.db.query.coupons.findMany({
      where: whereClause,
      orderBy: [desc(coupons.createdAt)],
      limit,
      offset: (page - 1) * limit,
      with: {
        restaurant: {
          columns: {
            id: true,
            name: true,
          },
        },
        creator: {
          columns: {
            id: true,
            username: true,
          },
        },
      },
    });

    return {
      coupons: couponList.map((coupon) => this.mapCouponMoneyFields(coupon)),
      total,
      page,
      limit,
    };
  }

  /**
   * 獲取單個優惠券詳情
   */
  async getCoupon(id: number) {
    const coupon = await this.db.query.coupons.findFirst({
      where: eq(coupons.id, id),
      with: {
        restaurant: {
          columns: {
            id: true,
            name: true,
          },
        },
        creator: {
          columns: {
            id: true,
            username: true,
          },
        },
        usages: {
          orderBy: [desc(couponUsage.usedAt)],
          limit: 10,
          with: {
            order: {
              columns: {
                id: true,
                orderNumber: true,
                totalAmountCents: true,
              },
            },
            user: {
              columns: {
                id: true,
                username: true,
              },
            },
          },
        },
      },
    });

    if (!coupon) {
      return null;
    }

    return this.mapCouponMoneyFields({
      ...coupon,
      usages: coupon.usages?.map((usage) => ({
        ...usage,
        order: usage.order
          ? {
              ...usage.order,
              totalAmount: amountFromCents(usage.order.totalAmountCents),
            }
          : usage.order,
      })),
    });
  }

  /**
   * 更新優惠券
   */
  async updateCoupon(id: number, updates: Partial<CreateCouponData>) {
    const centsUpdates: Record<string, number | null | undefined> = {};
    if (
      updates.discountValue !== undefined ||
      updates.discountType !== undefined
    ) {
      const current =
        updates.discountType === undefined ||
        updates.discountValue === undefined
          ? await this.db.query.coupons.findFirst({
              where: eq(coupons.id, id),
            })
          : undefined;
      const discountType = updates.discountType ?? current?.discountType;
      const discountValue =
        updates.discountValue ??
        (current?.discountType === "percentage"
          ? percentageFromBps(current?.discountPercentageBps)
          : amountFromCents(current?.discountValueCents));
      centsUpdates.discountValueCents =
        discountType === "percentage"
          ? null
          : discountValue == null
            ? undefined
            : toRequiredCents(discountValue);
      centsUpdates.discountPercentageBps =
        discountType === "percentage" && discountValue != null
          ? toRequiredPercentageBps(discountValue)
          : discountType === undefined
            ? undefined
            : null;
    }
    if (updates.maxDiscountAmount !== undefined) {
      centsUpdates.maxDiscountAmountCents = toCents(updates.maxDiscountAmount);
    }
    if (updates.minOrderAmount !== undefined) {
      centsUpdates.minOrderAmountCents = toRequiredCents(
        updates.minOrderAmount,
      );
    }

    const coupon = await this.db
      .update(coupons)
      .set({
        ...this.toCouponUpdate(updates),
        ...centsUpdates,
        updatedAt: new Date(),
      })
      .where(eq(coupons.id, id))
      .returning();

    return coupon[0] ? this.mapCouponMoneyFields(coupon[0]) : coupon[0];
  }

  /**
   * 停用優惠券
   */
  async deactivateCoupon(id: number) {
    return await this.updateCoupon(id, { isActive: false });
  }

  /**
   * 刪除優惠券
   */
  async deleteCoupon(id: number): Promise<void> {
    await this.db
      .update(coupons)
      .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
      .where(and(eq(coupons.id, id), sql`${coupons.deletedAt} IS NULL`));
  }

  /**
   * Cancelling an order releases only an active usage row once. The existing
   * refund release marker is also the idempotency marker for this path.
   */
  async releaseUsageForCancelledOrder(orderId: string): Promise<void> {
    const candidates = await this.db
      .select({ id: couponUsage.id, couponId: couponUsage.couponId })
      .from(couponUsage)
      .where(
        and(
          eq(couponUsage.orderId, orderId),
          eq(couponUsage.status, "active"),
          sql`${couponUsage.refundCountReleasedAt} IS NULL`,
        ),
      );

    if (candidates.length === 0) return;

    const now = new Date();
    const writes = candidates.flatMap((usage) => [
      // Run this before marking the usage row. The conditional re-check makes
      // stale reads and concurrent/repeated cancellations harmless; D1 batch
      // applies every statement atomically.
      this.db
        .update(coupons)
        .set({
          usedCount: sql`CASE WHEN EXISTS (
            SELECT 1 FROM coupon_usage
            WHERE id = ${usage.id}
              AND status = 'active'
              AND refund_count_released_at_ms IS NULL
          ) AND coalesce(${coupons.usedCount}, 0) > 0
            THEN coalesce(${coupons.usedCount}, 0) - 1
            ELSE coalesce(${coupons.usedCount}, 0)
          END`,
          updatedAt: now,
        })
        .where(eq(coupons.id, usage.couponId)),
      this.db
        .update(couponUsage)
        .set({
          status: "cancelled",
          refundCountReleasedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(couponUsage.id, usage.id),
            eq(couponUsage.status, "active"),
            sql`${couponUsage.refundCountReleasedAt} IS NULL`,
          ),
        ),
    ]);

    // candidates is non-empty above, so the write list has at least the two
    // statements produced for its first usage. D1's typed batch API requires
    // that non-empty tuple shape in addition to the runtime guarantee.
    await this.db.batch([writes[0]!, ...writes.slice(1)]);
  }

  /**
   * 獲取優惠券使用統計
   */
  async getCouponStats(couponId: number) {
    const stats = await this.db
      .select({
        totalUsed: sql<number>`count(*)`,
        totalDiscount: sql<number>`sum(COALESCE(${couponUsage.discountAmountCents}, 0)) / 100.0`,
        avgDiscount: sql<number>`avg(COALESCE(${couponUsage.discountAmountCents}, 0)) / 100.0`,
        lastUsed: sql<string>`max(${couponUsage.usedAt})`,
      })
      .from(couponUsage)
      .where(
        and(
          eq(couponUsage.couponId, couponId),
          eq(couponUsage.status, "active"),
        ),
      );

    return stats[0];
  }

  /**
   * 獲取優惠券彙總統計（跨所有優惠券）
   */
  async getCouponSummaryStats(restaurantId?: string): Promise<{
    total: number;
    active: number;
    totalUsed: number;
    totalSavings: number;
  }> {
    const restaurantFilter = restaurantId
      ? eq(coupons.restaurantId, restaurantId)
      : undefined;

    const nowMs = Date.now();

    // Total and active counts from coupons table
    const couponCounts = await this.db
      .select({
        total: sql<number>`count(*)`,
        active: sql<number>`sum(CASE
          WHEN ${coupons.isActive} = 1
            AND ${coupons.validFrom} <= ${nowMs}
            AND ${coupons.validTo} >= ${nowMs}
            AND (${coupons.usageLimit} IS NULL OR ${coupons.usedCount} < ${coupons.usageLimit})
          THEN 1 ELSE 0 END)`,
        totalUsed: sql<number>`coalesce(sum(${coupons.usedCount}), 0)`,
      })
      .from(coupons)
      .where(restaurantFilter);

    // Total savings from coupon_usage table
    const savingsResult = restaurantId
      ? await this.db
          .select({
            totalSavings: sql<number>`coalesce(sum(COALESCE(${couponUsage.discountAmountCents}, 0)), 0) / 100.0`,
          })
          .from(couponUsage)
          .innerJoin(coupons, eq(couponUsage.couponId, coupons.id))
          .where(
            and(
              eq(couponUsage.status, "active"),
              eq(coupons.restaurantId, restaurantId),
            ),
          )
      : await this.db
          .select({
            totalSavings: sql<number>`coalesce(sum(COALESCE(${couponUsage.discountAmountCents}, 0)), 0) / 100.0`,
          })
          .from(couponUsage)
          .where(eq(couponUsage.status, "active"));

    return {
      total: couponCounts[0]?.total || 0,
      active: couponCounts[0]?.active || 0,
      totalUsed: couponCounts[0]?.totalUsed || 0,
      totalSavings: savingsResult[0]?.totalSavings || 0,
    };
  }

  /**
   * 獲取可用的優惠券 (供前端顯示)
   */
  async getAvailableCoupons(restaurantId: string, _userId?: string) {
    const now = new Date();

    const couponList = await this.db.query.coupons.findMany({
      where: and(
        eq(coupons.isActive, true),
        eq(coupons.isVisible, true),
        // deleteCoupon also clears isActive, so this is belt-and-braces -- but
        // the delete marker is the canonical signal and reading it here keeps
        // the invariant explicit instead of incidental.
        isNull(coupons.deletedAt),
        sql`(${coupons.restaurantId} = ${restaurantId} OR ${coupons.restaurantId} IS NULL)`,
        lte(coupons.validFrom, now),
        gte(coupons.validTo, now),
        sql`(${coupons.usageLimit} IS NULL OR ${coupons.usedCount} < ${coupons.usageLimit})`,
      ),
      orderBy: [
        asc(coupons.minOrderAmountCents),
        desc(coupons.discountPercentageBps),
        desc(coupons.discountValueCents),
      ],
    });

    return couponList.map((coupon) => this.mapCouponMoneyFields(coupon));
  }

  /**
   * Narrow a caller-supplied customer id list to the ids this coupon may
   * actually address, preserving the caller's order.
   *
   * The audience for a restaurant coupon is "has ordered here", exactly as the
   * derived branches below define it; for a platform coupon it is "is an active
   * customer", exactly as the platform branch defines it. `targetType: "user"`
   * only chooses *which* members of that audience to issue to — it may not
   * widen it.
   */
  private async intersectWithAudience(
    restaurantId: string | null,
    requested: string[],
  ): Promise<string[]> {
    const allowed = new Set<string>();

    for (let i = 0; i < requested.length; i += AUDIENCE_ID_CHUNK) {
      const slice = requested.slice(i, i + AUDIENCE_ID_CHUNK);
      const rows =
        restaurantId === null
          ? await this.db
              .select({ id: customers.id })
              .from(customers)
              .where(
                and(
                  inArray(customers.id, slice),
                  eq(customers.status, "active"),
                  isNull(customers.deletedAt),
                ),
              )
          : await this.db
              .select({ id: orders.customerId })
              .from(orders)
              .where(
                and(
                  eq(orders.restaurantId, restaurantId),
                  inArray(orders.customerId, slice),
                  sql`${orders.status} != 'cancelled'`,
                ),
              )
              .groupBy(orders.customerId);

      for (const row of rows) {
        if (typeof row.id === "string" && row.id !== "") allowed.add(row.id);
      }
    }

    return requested.filter((id) => allowed.has(id));
  }

  /**
   * Resolve a distribution audience to customer ids.
   *
   * `customers` carries no restaurant column, so a restaurant's audience comes
   * from who has ordered there. A platform coupon addresses every active
   * customer instead.
   */
  private async resolveDistributionAudience(
    restaurantId: string | null,
    targetType: TargetType,
    criteria: DistributionTargetCriteria,
  ): Promise<string[]> {
    if (targetType === "user") {
      // `customerIds` is the only branch where the audience is asserted by the
      // caller rather than derived, and it used to be echoed straight back. The
      // route proves the coupon belongs to the caller's restaurant; nothing
      // proved the same of the recipients, so an owner could issue their own
      // coupon to any customer id they could name — including customers who
      // have only ever ordered somewhere else (#265/#275 shape).
      //
      // Non-members are dropped silently rather than answered with a 400 that
      // names them: naming an id confirms it exists, and every sibling branch
      // here already derives the audience and reports the truth in
      // `targeted`/`issued`, so a caller who submits 10 ids and is told
      // `targeted: 7` can see the drop without being handed an oracle.
      const requested = [
        ...new Set((criteria.customerIds ?? []).filter(Boolean)),
      ];
      if (requested.length === 0) return [];
      return await this.intersectWithAudience(restaurantId, requested);
    }

    // "group" names a concept the schema has no table for. Fail loudly rather
    // than silently issuing to nobody.
    if (targetType === "group") {
      throw new CouponDistributionTargetError(targetType);
    }

    if (restaurantId === null) {
      if (targetType !== "all") {
        throw new CouponDistributionTargetError(targetType);
      }
      const rows = await this.db
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(eq(customers.status, "active"), isNull(customers.deletedAt)),
        );
      return rows.map((row) => row.id);
    }

    const orderCounts = await this.db
      .select({
        customerId: orders.customerId,
        orderCount: sql<number>`count(*)`,
      })
      .from(orders)
      .where(
        and(
          eq(orders.restaurantId, restaurantId),
          sql`${orders.customerId} IS NOT NULL`,
          sql`${orders.status} != 'cancelled'`,
        ),
      )
      .groupBy(orders.customerId);

    const minOrders = Math.max(1, criteria.minOrders ?? 5);
    return orderCounts
      .filter((row) => {
        if (targetType === "all") return true;
        if (targetType === "new_user") return row.orderCount <= 1;
        return row.orderCount >= minOrders;
      })
      .map((row) => row.customerId)
      .filter((id): id is string => typeof id === "string" && id !== "");
  }

  /**
   * Issue a coupon to an audience, recording the batch and one holdable
   * instance per customer.
   *
   * Customers already holding a live instance are skipped rather than issued a
   * second one; `user_coupons_holder_live_unique` (0014) is the authority under
   * concurrency, since that read is not atomic against a parallel batch.
   */
  async distributeCoupon(
    input: DistributeCouponInput,
  ): Promise<DistributeCouponResult> {
    const coupon = await this.db.query.coupons.findFirst({
      where: and(eq(coupons.id, input.couponId), isNull(coupons.deletedAt)),
    });

    if (!coupon) {
      throw new Error("優惠券不存在");
    }

    const targetType = input.targetType ?? "all";
    const audience = await this.resolveDistributionAudience(
      coupon.restaurantId ?? null,
      targetType,
      input.targetCriteria ?? {},
    );

    // Chunked because both of these run through D1's bound-parameter limit,
    // and an audience is unbounded in principle.
    const CHUNK = AUDIENCE_ID_CHUNK;
    const alreadyHolding = new Set<string>();
    for (let i = 0; i < audience.length; i += CHUNK) {
      const slice = audience.slice(i, i + CHUNK);
      const held = await this.db
        .select({ ownerCustomerId: userCoupons.ownerCustomerId })
        .from(userCoupons)
        .where(
          and(
            eq(userCoupons.couponId, input.couponId),
            inArray(userCoupons.ownerCustomerId, slice),
            inArray(userCoupons.state, ["issued", "reserved"]),
          ),
        );
      for (const row of held) alreadyHolding.add(row.ownerCustomerId);
    }

    const recipients = audience.filter((id) => !alreadyHolding.has(id));
    const now = new Date();

    const [distribution] = await this.db
      .insert(couponDistributions)
      .values({
        couponId: input.couponId,
        distributionType: input.distributionType,
        targetType,
        targetCriteria: input.targetCriteria ?? null,
        totalDistributed: recipients.length,
        totalUsed: 0,
        distributedAt: now,
        expiresAt: input.expiresAt ?? null,
        createdAt: now,
        createdBy: input.createdBy ?? null,
        notes: input.notes ?? null,
      })
      .returning({ id: couponDistributions.id });

    for (let i = 0; i < recipients.length; i += CHUNK) {
      await this.db
        .insert(userCoupons)
        .values(
          recipients.slice(i, i + CHUNK).map((customerId) => ({
            couponId: input.couponId,
            ownerCustomerId: customerId,
            state: "issued" as const,
            expiresAtMs: input.expiresAt ?? null,
            createdAt: now,
            updatedAt: now,
          })),
        )
        // A parallel batch may have issued to the same customer between the
        // read above and this write; the partial unique index catches it and
        // the row is simply not duplicated.
        .onConflictDoNothing();
    }

    return {
      distributionId: distribution!.id,
      targeted: audience.length,
      issued: recipients.length,
      skipped: audience.length - recipients.length,
    };
  }

  /** Distribution batches for one coupon, newest first. */
  async getCouponDistributions(couponId: number) {
    return await this.db
      .select({
        id: couponDistributions.id,
        distributionType: couponDistributions.distributionType,
        targetType: couponDistributions.targetType,
        targetCriteria: couponDistributions.targetCriteria,
        totalDistributed: couponDistributions.totalDistributed,
        totalUsed: couponDistributions.totalUsed,
        distributedAt: couponDistributions.distributedAt,
        expiresAt: couponDistributions.expiresAt,
        notes: couponDistributions.notes,
      })
      .from(couponDistributions)
      .where(eq(couponDistributions.couponId, couponId))
      .orderBy(desc(couponDistributions.distributedAt));
  }
}
