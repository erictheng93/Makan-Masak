/**
 * Partnership Service
 * 特約商店服務層 - 管理院校/機構合作夥伴關係
 */

import type { SQL } from "drizzle-orm";
import { and, desc, eq, gte, like, lte, or, sql } from "drizzle-orm";
import {
  partnershipPlans,
  partnerships,
  partnershipUsageLogs,
  verifiedMembers,
  type MemberStatus,
  type MemberType,
  type NewPartnership,
  type NewPartnershipPlan,
  type NewPartnershipUsageLog,
  type NewVerifiedMember,
  type Partnership,
  type PartnershipPlan,
  type PartnershipStatus,
  type PartnershipUsageLog,
  type PartnerType,
  type VerificationMethod,
  type VerifiedMember,
} from "../schema";
import {
  fromCents,
  percentageFromBps,
  toCents,
  toPercentageBps,
  toRequiredCents,
} from "../utils/money";
import { computeDiscountCents } from "@makanmasak/utils";
import { paginateWithCursor } from "../utils/pagination-helpers";
import { BaseService } from "./base";

// ================================================
// INTERFACES
// ================================================

/**
 * 合作夥伴查詢過濾器
 */
export interface PartnershipFilters {
  partnerType?: PartnerType;
  status?: PartnershipStatus;
  isActive?: boolean;
  search?: string; // 搜尋名稱或代碼
  contractActive?: boolean; // 合約是否在有效期內
}

/**
 * 方案查詢過濾器
 */
export interface PlanFilters {
  partnershipId?: string;
  restaurantId?: string;
  isActive?: boolean;
  validOnly?: boolean; // 僅返回有效期內的方案
}

/**
 * 會員查詢過濾器
 */
export interface MemberFilters {
  partnershipId?: string;
  status?: MemberStatus;
  memberType?: MemberType;
  search?: string; // 搜尋姓名、會員編號或 Email
  verifiedOnly?: boolean;
}

/**
 * 方案驗證結果
 */
export interface PlanValidationResult {
  valid: boolean;
  plan?: PartnershipPlan;
  error?: string;
  discountAmount?: number;
  finalAmount?: number;
  canCombineWithOthers?: {
    coupons: boolean;
    promotions: boolean;
  };
}

/**
 * 會員驗證請求
 */
export interface MemberVerificationRequest {
  partnershipId: string;
  memberId: string; // 學號/工號
  fullName: string;
  memberType: MemberType;
  email?: string;
  phone?: string;
  verificationMethod: VerificationMethod;
  verificationDocumentUrl?: string;
  department?: string;
  gradeOrPosition?: string;
  studentIdPhotoUrl?: string;
}

/**
 * 使用統計
 */
export interface UsageStatistics {
  totalUsageCount: number;
  totalDiscountGiven: number;
  totalRevenue: number;
  uniqueMembers: number;
  averageDiscount: number;
  averageOrderValue: number;
}

type PartnershipMoneyInput = {
  defaultDiscountValue?: number | null;
  totalDiscountGiven?: number | null;
  totalRevenue?: number | null;
};

type PartnershipPlanMoneyInput = {
  discountValue?: number | null;
  maxDiscountAmount?: number | null;
  minOrderAmount?: number | null;
  maxOrderAmount?: number | null;
  totalDiscountGiven?: number | null;
  totalRevenue?: number | null;
};

type VerifiedMemberMoneyInput = {
  totalDiscountReceived?: number | null;
  totalSpending?: number | null;
};

type UsageLogMoneyInput = {
  discountValue: number;
  discountAmount: number;
  originalAmount: number;
  finalAmount: number;
};

// ================================================
// SERVICE CLASS
// ================================================

export class PartnershipService extends BaseService {
  private discountValueCents(
    discountType: string | null | undefined,
    discountValue: number | null | undefined,
  ): number | null {
    if (discountValue == null || discountType === "percentage") {
      return null;
    }

    return toRequiredCents(discountValue);
  }

  private discountPercentageBps(
    discountType: string | null | undefined,
    discountValue: number | null | undefined,
  ): number | null {
    return discountType === "percentage"
      ? toPercentageBps(discountValue)
      : null;
  }

  private resolveDiscountValue(
    discountType: string | null | undefined,
    percentageBps: number | null | undefined,
    valueCents: number | null | undefined,
  ): number | null {
    return discountType === "percentage"
      ? percentageFromBps(percentageBps)
      : valueCents == null
        ? null
        : fromCents(valueCents);
  }

  private toPartnershipInsert(
    data: Partial<NewPartnership> & PartnershipMoneyInput,
  ): Partial<NewPartnership> {
    const {
      defaultDiscountValue,
      totalDiscountGiven,
      totalRevenue,
      ...insert
    } = data;
    void defaultDiscountValue;
    void totalDiscountGiven;
    void totalRevenue;
    return insert;
  }

  private toPlanInsert(
    data: Partial<NewPartnershipPlan> & PartnershipPlanMoneyInput,
  ): Partial<NewPartnershipPlan> {
    const {
      discountValue,
      maxDiscountAmount,
      minOrderAmount,
      maxOrderAmount,
      totalDiscountGiven,
      totalRevenue,
      ...insert
    } = data;
    void discountValue;
    void maxDiscountAmount;
    void minOrderAmount;
    void maxOrderAmount;
    void totalDiscountGiven;
    void totalRevenue;
    return insert;
  }

  private toVerifiedMemberInsert(
    data: Partial<NewVerifiedMember> & VerifiedMemberMoneyInput,
  ): Partial<NewVerifiedMember> {
    const { totalDiscountReceived, totalSpending, ...insert } = data;
    void totalDiscountReceived;
    void totalSpending;
    return insert;
  }

  private toUsageLogInsert(
    data: Partial<NewPartnershipUsageLog> & UsageLogMoneyInput,
  ): Partial<NewPartnershipUsageLog> {
    const {
      discountValue,
      discountAmount,
      originalAmount,
      finalAmount,
      ...insert
    } = data;
    void discountValue;
    void discountAmount;
    void originalAmount;
    void finalAmount;
    return insert;
  }

  // ================================================
  // PARTNERSHIP MANAGEMENT (合作夥伴管理)
  // ================================================

  /**
   * 創建新合作夥伴
   */
  async createPartnership(
    data: NewPartnership & PartnershipMoneyInput,
  ): Promise<Partnership> {
    const defaultDiscountValueCents =
      data.defaultDiscountValue !== undefined
        ? this.discountValueCents(
            data.defaultDiscountType,
            data.defaultDiscountValue,
          )
        : (data.defaultDiscountValueCents ?? null);
    const defaultDiscountPercentageBps =
      data.defaultDiscountValue !== undefined
        ? this.discountPercentageBps(
            data.defaultDiscountType,
            data.defaultDiscountValue,
          )
        : data.defaultDiscountType === "percentage"
          ? (data.defaultDiscountPercentageBps ?? null)
          : null;

    const [result] = await this.db
      .insert(partnerships)
      .values({
        ...(this.toPartnershipInsert(data) as NewPartnership),
        defaultDiscountValueCents,
        defaultDiscountPercentageBps,
        totalDiscountGivenCents:
          data.totalDiscountGivenCents ??
          toRequiredCents(data.totalDiscountGiven ?? 0),
        totalRevenueCents:
          data.totalRevenueCents ?? toRequiredCents(data.totalRevenue ?? 0),
      })
      .returning();
    return result;
  }

  /**
   * 獲取合作夥伴詳情
   */
  async getPartnership(id: string): Promise<Partnership | undefined> {
    return await this.db.query.partnerships.findFirst({
      where: eq(partnerships.id, id),
    });
  }

  /**
   * 通過代碼獲取合作夥伴
   */
  async getPartnershipByCode(code: string): Promise<Partnership | undefined> {
    return await this.db.query.partnerships.findFirst({
      where: eq(partnerships.partnerCode, code),
    });
  }

  /**
   * 查詢合作夥伴列表
   */
  async listPartnerships(
    filters: PartnershipFilters = {},
    page = 1,
    limit = 20,
  ) {
    const conditions = [];
    const now = new Date();

    if (filters.partnerType) {
      conditions.push(eq(partnerships.partnerType, filters.partnerType));
    }

    if (filters.status) {
      conditions.push(eq(partnerships.status, filters.status));
    }

    if (filters.isActive !== undefined) {
      conditions.push(eq(partnerships.isActive, filters.isActive));
    }

    if (filters.search) {
      conditions.push(
        or(
          like(partnerships.partnerName, `%${filters.search}%`),
          like(partnerships.partnerCode, `%${filters.search}%`),
        ),
      );
    }

    if (filters.contractActive) {
      conditions.push(
        and(
          lte(partnerships.contractStartDate, now),
          gte(partnerships.contractEndDate, now),
        ),
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [results, countResult] = await Promise.all([
      this.db.query.partnerships.findMany({
        where: whereClause,
        orderBy: [desc(partnerships.createdAt)],
        limit,
        offset: (page - 1) * limit,
      }),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(partnerships)
        .where(whereClause),
    ]);

    const total = countResult[0]?.count || 0;

    return {
      data: results,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * 更新合作夥伴資訊
   */
  async updatePartnership(
    id: string,
    data: Partial<NewPartnership> & PartnershipMoneyInput,
  ): Promise<Partnership> {
    const updates: Partial<NewPartnership> = {
      ...this.toPartnershipInsert(data),
      updatedAt: new Date(),
    };

    if (
      data.defaultDiscountType !== undefined ||
      data.defaultDiscountValue !== undefined
    ) {
      const current =
        data.defaultDiscountType === undefined ||
        data.defaultDiscountValue === undefined
          ? await this.getPartnership(id)
          : undefined;
      updates.defaultDiscountValueCents = this.discountValueCents(
        data.defaultDiscountType ?? current?.defaultDiscountType,
        data.defaultDiscountValue ??
          this.resolveDiscountValue(
            current?.defaultDiscountType,
            current?.defaultDiscountPercentageBps,
            current?.defaultDiscountValueCents,
          ),
      );
      updates.defaultDiscountPercentageBps = this.discountPercentageBps(
        data.defaultDiscountType ?? current?.defaultDiscountType,
        data.defaultDiscountValue ??
          this.resolveDiscountValue(
            current?.defaultDiscountType,
            current?.defaultDiscountPercentageBps,
            current?.defaultDiscountValueCents,
          ),
      );
    }

    if (data.totalDiscountGiven !== undefined) {
      updates.totalDiscountGivenCents = toCents(data.totalDiscountGiven);
    }

    if (data.totalRevenue !== undefined) {
      updates.totalRevenueCents = toCents(data.totalRevenue);
    }

    const [result] = await this.db
      .update(partnerships)
      .set(updates)
      .where(eq(partnerships.id, id))
      .returning();

    return result;
  }

  /**
   * 刪除合作夥伴
   */
  async deletePartnership(id: string): Promise<void> {
    await this.db.delete(partnerships).where(eq(partnerships.id, id));
  }

  /**
   * 獲取合作夥伴統計資訊
   */
  async getPartnershipStatistics(
    partnershipId: string,
  ): Promise<UsageStatistics> {
    const stats = await this.db
      .select({
        totalUsageCount: sql<number>`COUNT(${partnershipUsageLogs.id})`,
        totalDiscountGiven: sql<number>`COALESCE(SUM(COALESCE(${partnershipUsageLogs.discountAmountCents}, 0)), 0) / 100.0`,
        totalRevenue: sql<number>`COALESCE(SUM(COALESCE(${partnershipUsageLogs.finalAmountCents}, 0)), 0) / 100.0`,
        uniqueMembers: sql<number>`COUNT(DISTINCT ${partnershipUsageLogs.memberId})`,
      })
      .from(partnershipUsageLogs)
      .where(
        and(
          eq(partnershipUsageLogs.partnershipId, partnershipId),
          eq(partnershipUsageLogs.status, "completed"),
        ),
      );

    const result = stats[0] || {
      totalUsageCount: 0,
      totalDiscountGiven: 0,
      totalRevenue: 0,
      uniqueMembers: 0,
    };

    return {
      ...result,
      averageDiscount:
        result.totalUsageCount > 0
          ? result.totalDiscountGiven / result.totalUsageCount
          : 0,
      averageOrderValue:
        result.totalUsageCount > 0
          ? result.totalRevenue / result.totalUsageCount
          : 0,
    };
  }

  // ================================================
  // PARTNERSHIP PLAN MANAGEMENT (特約方案管理)
  // ================================================

  /**
   * 創建特約方案
   */
  async createPlan(
    data: NewPartnershipPlan & PartnershipPlanMoneyInput,
  ): Promise<PartnershipPlan> {
    const discountValueCents =
      data.discountValue !== undefined
        ? this.discountValueCents(data.discountType, data.discountValue)
        : (data.discountValueCents ?? null);
    const discountPercentageBps =
      data.discountValue !== undefined
        ? this.discountPercentageBps(data.discountType, data.discountValue)
        : data.discountType === "percentage"
          ? (data.discountPercentageBps ?? null)
          : null;

    const [result] = await this.db
      .insert(partnershipPlans)
      .values({
        ...(this.toPlanInsert(data) as NewPartnershipPlan),
        discountValueCents,
        discountPercentageBps,
        maxDiscountAmountCents:
          data.maxDiscountAmount !== undefined
            ? toCents(data.maxDiscountAmount)
            : data.maxDiscountAmountCents,
        minOrderAmountCents:
          data.minOrderAmount != null
            ? toRequiredCents(data.minOrderAmount)
            : (data.minOrderAmountCents ?? 0),
        maxOrderAmountCents:
          data.maxOrderAmount !== undefined
            ? toCents(data.maxOrderAmount)
            : data.maxOrderAmountCents,
        totalDiscountGivenCents:
          data.totalDiscountGivenCents ??
          toRequiredCents(data.totalDiscountGiven ?? 0),
        totalRevenueCents:
          data.totalRevenueCents ?? toRequiredCents(data.totalRevenue ?? 0),
      })
      .returning();
    return result;
  }

  /**
   * 獲取方案詳情
   */
  async getPlan(id: string): Promise<PartnershipPlan | undefined> {
    return await this.db.query.partnershipPlans.findFirst({
      where: eq(partnershipPlans.id, id),
      with: {
        partnership: true,
        restaurant: true,
      },
    });
  }

  /**
   * 查詢方案列表
   */
  async listPlans(filters: PlanFilters = {}, page = 1, limit = 20) {
    const conditions = [];
    const now = new Date();

    if (filters.partnershipId) {
      conditions.push(
        eq(partnershipPlans.partnershipId, filters.partnershipId),
      );
    }

    if (filters.restaurantId) {
      conditions.push(eq(partnershipPlans.restaurantId, filters.restaurantId));
    }

    if (filters.isActive !== undefined) {
      conditions.push(eq(partnershipPlans.isActive, filters.isActive));
    }

    if (filters.validOnly) {
      conditions.push(
        and(
          lte(partnershipPlans.validFrom, now),
          gte(partnershipPlans.validTo, now),
        ),
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [results, countResult] = await Promise.all([
      this.db.query.partnershipPlans.findMany({
        where: whereClause,
        with: {
          partnership: true,
          restaurant: true,
        },
        orderBy: [
          desc(partnershipPlans.priority),
          desc(partnershipPlans.createdAt),
        ],
        limit,
        offset: (page - 1) * limit,
      }),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(partnershipPlans)
        .where(whereClause),
    ]);

    const total = countResult[0]?.count || 0;

    return {
      data: results,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * 更新方案
   */
  async updatePlan(
    id: string,
    data: Partial<NewPartnershipPlan> & PartnershipPlanMoneyInput,
  ): Promise<PartnershipPlan> {
    const updates: Partial<NewPartnershipPlan> = {
      ...this.toPlanInsert(data),
      updatedAt: new Date(),
    };

    if (data.discountType !== undefined || data.discountValue !== undefined) {
      const current =
        data.discountType === undefined || data.discountValue === undefined
          ? await this.db.query.partnershipPlans.findFirst({
              where: eq(partnershipPlans.id, id),
            })
          : undefined;
      updates.discountValueCents = this.discountValueCents(
        data.discountType ?? current?.discountType,
        data.discountValue ??
          this.resolveDiscountValue(
            current?.discountType,
            current?.discountPercentageBps,
            current?.discountValueCents,
          ),
      );
      updates.discountPercentageBps = this.discountPercentageBps(
        data.discountType ?? current?.discountType,
        data.discountValue ??
          this.resolveDiscountValue(
            current?.discountType,
            current?.discountPercentageBps,
            current?.discountValueCents,
          ),
      );
    }

    if (data.maxDiscountAmount !== undefined) {
      updates.maxDiscountAmountCents = toCents(data.maxDiscountAmount);
    }

    if (data.minOrderAmount !== undefined) {
      updates.minOrderAmountCents = toRequiredCents(data.minOrderAmount ?? 0);
    }

    if (data.maxOrderAmount !== undefined) {
      updates.maxOrderAmountCents = toCents(data.maxOrderAmount);
    }

    if (data.totalDiscountGiven !== undefined) {
      updates.totalDiscountGivenCents = toCents(data.totalDiscountGiven);
    }

    if (data.totalRevenue !== undefined) {
      updates.totalRevenueCents = toCents(data.totalRevenue);
    }

    const [result] = await this.db
      .update(partnershipPlans)
      .set(updates)
      .where(eq(partnershipPlans.id, id))
      .returning();

    return result;
  }

  /**
   * 刪除方案
   */
  async deletePlan(id: string): Promise<void> {
    await this.db.delete(partnershipPlans).where(eq(partnershipPlans.id, id));
  }

  /**
   * 驗證方案並計算折扣
   */
  async validatePlan(
    planId: string,
    memberId: string,
    orderAmount: number,
    _menuItems?: string[],
    _categories?: string[],
  ): Promise<PlanValidationResult> {
    try {
      // 獲取方案詳情
      const plan = await this.getPlan(planId);

      if (!plan) {
        return { valid: false, error: "方案不存在" };
      }

      // 檢查方案是否啟用
      if (!plan.isActive) {
        return { valid: false, error: "方案已停用" };
      }

      // 檢查有效期
      const now = new Date();
      if (now < plan.validFrom || now > plan.validTo) {
        return { valid: false, error: "方案已過期或尚未生效" };
      }

      // 檢查會員是否有效
      const member = await this.db.query.verifiedMembers.findFirst({
        where: eq(verifiedMembers.id, memberId),
      });

      if (!member || member.status !== "verified") {
        return { valid: false, error: "會員身份無效" };
      }

      // 檢查每日使用限制
      if (
        plan.usageLimitPerDay &&
        (plan.dailyUsageCount ?? 0) >= plan.usageLimitPerDay
      ) {
        return { valid: false, error: "今日使用次數已達上限" };
      }

      // 檢查每會員使用限制
      if (plan.usageLimitPerMember) {
        const memberUsageCount = await this.db
          .select({ count: sql<number>`count(*)` })
          .from(partnershipUsageLogs)
          .where(
            and(
              eq(partnershipUsageLogs.planId, planId),
              eq(partnershipUsageLogs.memberId, memberId),
              eq(partnershipUsageLogs.status, "completed"),
            ),
          );

        const count = memberUsageCount[0]?.count || 0;
        if (count >= plan.usageLimitPerMember) {
          return { valid: false, error: "您的使用次數已達上限" };
        }
      }

      const orderAmountCents = toRequiredCents(orderAmount);
      const minOrderAmountCents = plan.minOrderAmountCents ?? 0;
      const maxOrderAmountCents = plan.maxOrderAmountCents;

      // 檢查最低消費金額
      if (minOrderAmountCents > 0 && orderAmountCents < minOrderAmountCents) {
        return {
          valid: false,
          error: `最低消費金額為 ${fromCents(minOrderAmountCents)}`,
        };
      }

      // 檢查最高消費金額
      if (
        maxOrderAmountCents !== null &&
        orderAmountCents > maxOrderAmountCents
      ) {
        return {
          valid: false,
          error: `最高消費金額為 ${fromCents(maxOrderAmountCents)}`,
        };
      }

      // 檢查時間限制（星期幾）
      if (plan.applicableDays && plan.applicableDays.length > 0) {
        const dayOfWeek = new Date().getDay();
        if (!plan.applicableDays.includes(dayOfWeek)) {
          return { valid: false, error: "此優惠不適用於今天" };
        }
      }

      // 檢查時間限制（時段）
      if (plan.applicableTimeSlots && plan.applicableTimeSlots.length > 0) {
        const currentTime = new Date().toTimeString().slice(0, 5); // HH:MM
        const isInTimeSlot = plan.applicableTimeSlots.some((slot) => {
          return currentTime >= slot.start && currentTime <= slot.end;
        });

        if (!isInTimeSlot) {
          return { valid: false, error: "此優惠不適用於當前時段" };
        }
      }

      // 計算折扣金額 — 依方案所屬餐廳的幣別精度（TWD/VND 整數元）。
      const currency = await this.getRestaurantCurrency(plan.restaurantId);
      let discountAmountCents = 0;

      switch (plan.discountType) {
        case "percentage":
        case "fixed":
          discountAmountCents = computeDiscountCents(
            {
              discountType: plan.discountType,
              percent: percentageFromBps(plan.discountPercentageBps),
              fixedCents: plan.discountValueCents,
              maxDiscountCents: plan.maxDiscountAmountCents,
            },
            orderAmountCents,
            currency,
          );
          break;

        case "special_price":
          // 特價模式：折扣金額 = 原價 - 特價。特價是設定值，向下取到幣別
          // 精度前先算差額；結果再以 computeDiscountCents 的 fixed 規則收斂，
          // 既不為負也不超過（取整後的）原價。
          discountAmountCents = computeDiscountCents(
            {
              discountType: "fixed",
              fixedCents: orderAmountCents - (plan.discountValueCents ?? 0),
            },
            orderAmountCents,
            currency,
          );
          break;
      }
      const finalAmountCents = Math.max(
        0,
        orderAmountCents - discountAmountCents,
      );

      return {
        valid: true,
        plan,
        discountAmount: fromCents(discountAmountCents),
        finalAmount: fromCents(finalAmountCents),
        canCombineWithOthers: {
          coupons: !!plan.canCombineWithCoupons,
          promotions: !!plan.canCombineWithPromotions,
        },
      };
    } catch (error) {
      console.error("Plan validation error:", error);
      return { valid: false, error: "方案驗證失敗" };
    }
  }

  // ================================================
  // MEMBER MANAGEMENT (會員管理)
  // ================================================

  /**
   * 提交會員認證申請
   */
  async submitMemberVerification(
    data: MemberVerificationRequest,
  ): Promise<VerifiedMember> {
    const newMember: NewVerifiedMember = {
      partnershipId: data.partnershipId,
      memberId: data.memberId,
      memberType: data.memberType,
      fullName: data.fullName,
      email: data.email,
      phone: data.phone,
      verificationMethod: data.verificationMethod,
      verificationDocumentUrl: data.verificationDocumentUrl,
      department: data.department,
      gradeOrPosition: data.gradeOrPosition,
      studentIdPhotoUrl: data.studentIdPhotoUrl,
      status: "pending",
    };

    const [result] = await this.db
      .insert(verifiedMembers)
      .values(newMember)
      .returning();
    return result;
  }

  /**
   * 審核會員認證
   */
  async approveMember(
    memberId: string,
    verifiedBy: string,
    verificationExpiry?: Date,
  ): Promise<VerifiedMember> {
    const [result] = await this.db
      .update(verifiedMembers)
      .set({
        status: "verified",
        verifiedAt: new Date(),
        verifiedBy,
        verificationExpiry,
        updatedAt: new Date(),
      })
      .where(eq(verifiedMembers.id, memberId))
      .returning();

    return result;
  }

  /**
   * 拒絕會員認證
   */
  async rejectMember(
    memberId: string,
    rejectionReason: string,
  ): Promise<VerifiedMember> {
    const [result] = await this.db
      .update(verifiedMembers)
      .set({
        status: "rejected",
        rejectionReason,
        updatedAt: new Date(),
      })
      .where(eq(verifiedMembers.id, memberId))
      .returning();

    return result;
  }

  /**
   * 獲取會員詳情
   */
  async getMember(id: string): Promise<VerifiedMember | undefined> {
    return await this.db.query.verifiedMembers.findFirst({
      where: eq(verifiedMembers.id, id),
      with: {
        partnership: true,
        customer: true,
      },
    });
  }

  /**
   * 通過會員編號查找會員
   */
  async getMemberByMemberId(
    partnershipId: string,
    memberId: string,
  ): Promise<VerifiedMember | undefined> {
    return await this.db.query.verifiedMembers.findFirst({
      where: and(
        eq(verifiedMembers.partnershipId, partnershipId),
        eq(verifiedMembers.memberId, memberId),
      ),
    });
  }

  /**
   * 查詢會員列表
   */
  async listMembers(filters: MemberFilters = {}, page = 1, limit = 20) {
    const conditions = [];

    if (filters.partnershipId) {
      conditions.push(eq(verifiedMembers.partnershipId, filters.partnershipId));
    }

    if (filters.status) {
      conditions.push(eq(verifiedMembers.status, filters.status));
    }

    if (filters.memberType) {
      conditions.push(eq(verifiedMembers.memberType, filters.memberType));
    }

    if (filters.verifiedOnly) {
      conditions.push(eq(verifiedMembers.status, "verified"));
    }

    if (filters.search) {
      conditions.push(
        or(
          like(verifiedMembers.fullName, `%${filters.search}%`),
          like(verifiedMembers.memberId, `%${filters.search}%`),
          like(verifiedMembers.email, `%${filters.search}%`),
        ),
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [results, countResult] = await Promise.all([
      this.db.query.verifiedMembers.findMany({
        where: whereClause,
        with: {
          partnership: true,
        },
        orderBy: [desc(verifiedMembers.createdAt)],
        limit,
        offset: (page - 1) * limit,
      }),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(verifiedMembers)
        .where(whereClause),
    ]);

    const total = countResult[0]?.count || 0;

    return {
      data: results,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * 更新會員資訊
   */
  async updateMember(
    id: string,
    data: Partial<NewVerifiedMember> & VerifiedMemberMoneyInput,
  ): Promise<VerifiedMember> {
    const updates: Partial<NewVerifiedMember> = {
      ...this.toVerifiedMemberInsert(data),
      updatedAt: new Date(),
    };

    if (data.totalDiscountReceived !== undefined) {
      updates.totalDiscountReceivedCents = toCents(data.totalDiscountReceived);
    }

    if (data.totalSpending !== undefined) {
      updates.totalSpendingCents = toCents(data.totalSpending);
    }

    const [result] = await this.db
      .update(verifiedMembers)
      .set(updates)
      .where(eq(verifiedMembers.id, id))
      .returning();

    return result;
  }

  /**
   * 刪除會員
   */
  async deleteMember(id: string): Promise<void> {
    await this.db.delete(verifiedMembers).where(eq(verifiedMembers.id, id));
  }

  // ================================================
  // USAGE LOGGING (使用記錄)
  // ================================================

  /**
   * 記錄特約優惠使用
   */
  async logUsage(
    data: NewPartnershipUsageLog & UsageLogMoneyInput,
  ): Promise<PartnershipUsageLog> {
    const [result] = await this.db
      .insert(partnershipUsageLogs)
      .values({
        ...(this.toUsageLogInsert(data) as NewPartnershipUsageLog),
        discountValueCents: this.discountValueCents(
          data.discountType,
          data.discountValue,
        ),
        discountPercentageBps: this.discountPercentageBps(
          data.discountType,
          data.discountValue,
        ),
        discountAmountCents: toRequiredCents(data.discountAmount),
        originalAmountCents: toRequiredCents(data.originalAmount),
        finalAmountCents: toRequiredCents(data.finalAmount),
      })
      .returning();
    return result;
  }

  /**
   * 獲取使用記錄
   */
  async getUsageLog(id: string): Promise<PartnershipUsageLog | undefined> {
    return await this.db.query.partnershipUsageLogs.findFirst({
      where: eq(partnershipUsageLogs.id, id),
      with: {
        partnership: true,
        plan: true,
        member: true,
        order: true,
        restaurant: true,
      },
    });
  }

  /**
   * Build where clause from usage log filters
   */
  private buildUsageLogWhereClause(filters: {
    partnershipId?: string;
    planId?: string;
    memberId?: string;
    restaurantId?: string;
    status?: typeof partnershipUsageLogs.$inferSelect.status;
    startDate?: Date;
    endDate?: Date;
  }): SQL | undefined {
    const conditions = [];

    if (filters.partnershipId) {
      conditions.push(
        eq(partnershipUsageLogs.partnershipId, filters.partnershipId),
      );
    }

    if (filters.planId) {
      conditions.push(eq(partnershipUsageLogs.planId, filters.planId));
    }

    if (filters.memberId) {
      conditions.push(eq(partnershipUsageLogs.memberId, filters.memberId));
    }

    if (filters.restaurantId) {
      conditions.push(
        eq(partnershipUsageLogs.restaurantId, filters.restaurantId),
      );
    }

    if (filters.status) {
      conditions.push(eq(partnershipUsageLogs.status, filters.status));
    }

    if (filters.startDate) {
      conditions.push(gte(partnershipUsageLogs.usedAt, filters.startDate));
    }

    if (filters.endDate) {
      conditions.push(lte(partnershipUsageLogs.usedAt, filters.endDate));
    }

    return conditions.length > 0 ? and(...conditions) : undefined;
  }

  /**
   * 查詢使用記錄列表（支援游標分頁與偏移分頁）
   */
  async listUsageLogs(
    filters: {
      partnershipId?: string;
      planId?: string;
      memberId?: string;
      restaurantId?: string;
      status?: typeof partnershipUsageLogs.$inferSelect.status;
      startDate?: Date;
      endDate?: Date;
      cursor?: string;
    } = {},
    page = 1,
    limit = 20,
  ) {
    const { cursor, ...filterParams } = filters;
    const whereClause = this.buildUsageLogWhereClause(filterParams);

    // Cursor-based pagination path
    if (cursor) {
      return paginateWithCursor(
        this.db,
        partnershipUsageLogs,
        {
          cursor,
          limit,
          where: whereClause,
        },
        "id",
        "usedAt",
      );
    }

    // Offset-based pagination path (existing behavior)
    const [results, countResult] = await Promise.all([
      this.db.query.partnershipUsageLogs.findMany({
        where: whereClause,
        with: {
          partnership: true,
          plan: true,
          member: true,
          restaurant: true,
        },
        orderBy: [desc(partnershipUsageLogs.usedAt)],
        limit,
        offset: (page - 1) * limit,
      }),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(partnershipUsageLogs)
        .where(whereClause),
    ]);

    const total = countResult[0]?.count || 0;

    return {
      data: results,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * 取消使用記錄
   */
  async cancelUsageLog(
    id: string,
    reason: string,
  ): Promise<PartnershipUsageLog> {
    const [result] = await this.db
      .update(partnershipUsageLogs)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        cancellationReason: reason,
      })
      .where(eq(partnershipUsageLogs.id, id))
      .returning();

    return result;
  }

  /**
   * 退款使用記錄
   */
  async refundUsageLog(id: string): Promise<PartnershipUsageLog> {
    const [result] = await this.db
      .update(partnershipUsageLogs)
      .set({
        status: "refunded",
        refundedAt: new Date(),
      })
      .where(eq(partnershipUsageLogs.id, id))
      .returning();

    return result;
  }

  // ================================================
  // UTILITY METHODS (工具方法)
  // ================================================

  /**
   * 驗證 Email 網域
   */
  async verifyEmailDomain(
    email: string,
    partnershipId: string,
  ): Promise<boolean> {
    const partnership = await this.getPartnership(partnershipId);

    if (!partnership || !partnership.allowedEmailDomains) {
      return false;
    }

    const emailDomain = email.split("@")[1];
    return partnership.allowedEmailDomains.some(
      (domain) =>
        domain.toLowerCase() === `@${emailDomain.toLowerCase()}` ||
        domain.toLowerCase() === emailDomain.toLowerCase(),
    );
  }

  /**
   * 檢查合約是否有效
   */
  isContractValid(partnership: Partnership): boolean {
    const now = new Date();
    return (
      partnership.status === "active" &&
      !!partnership.isActive &&
      now >= partnership.contractStartDate &&
      now <= partnership.contractEndDate
    );
  }

  /**
   * 檢查會員認證是否過期
   */
  isMemberVerificationExpired(member: VerifiedMember): boolean {
    if (!member.verificationExpiry) {
      return false;
    }
    return new Date() > member.verificationExpiry;
  }

  /**
   * 重置每日使用計數（應由排程任務每日執行）
   */
  async resetDailyUsageCounts(): Promise<void> {
    await this.db
      .update(partnershipPlans)
      .set({ dailyUsageCount: 0 })
      .where(sql`1=1`);
  }
}
