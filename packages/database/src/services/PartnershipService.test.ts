import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import type { D1Database } from "@cloudflare/workers-types";
import { D1DatabaseAdapter } from "../../../../tests/helpers/d1-adapter";
import { PartnershipService } from "./PartnershipService";

function createServiceWithDb<TDb extends object>(db: TDb): PartnershipService {
  const service = new PartnershipService({} as D1Database, {
    JWT_SECRET: "test",
  });
  (service as unknown as { db: TDb }).db = db;
  return service;
}

describe("PartnershipService percentage discounts", () => {
  it("stores percentage plan values in basis points instead of cents", async () => {
    const returning = vi.fn(async () => [{ id: "plan-1" }]);
    const values = vi.fn(() => ({ returning }));
    const insert = vi.fn(() => ({ values }));
    const service = createServiceWithDb({ insert });
    const planData: Parameters<PartnershipService["createPlan"]>[0] = {
      id: "plan-1",
      partnershipId: "partner-1",
      restaurantId: "restaurant-1",
      planName: "Student 12.5",
      planCode: "STUDENT125",
      discountType: "percentage",
      discountValue: 12.5,
      minOrderAmount: 0,
      validFrom: new Date("2026-01-01T00:00:00Z"),
      validTo: new Date("2026-12-31T23:59:59Z"),
      isActive: true,
    };

    await service.createPlan(planData);

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        discountPercentageBps: 1250,
        discountValueCents: null,
      }),
    );
  });

  it("preserves direct cents and bps plan values when legacy values are omitted", async () => {
    const returning = vi.fn(async () => [{ id: "plan-1" }]);
    const values = vi.fn(() => ({ returning }));
    const insert = vi.fn(() => ({ values }));
    const service = createServiceWithDb({ insert });
    const planData: Parameters<PartnershipService["createPlan"]>[0] = {
      id: "plan-1",
      partnershipId: "partner-1",
      restaurantId: "restaurant-1",
      planName: "Student 12.5",
      planCode: "STUDENT125",
      discountType: "percentage",
      discountPercentageBps: 1250,
      discountValueCents: null,
      maxDiscountAmountCents: 500,
      minOrderAmountCents: 1000,
      maxOrderAmountCents: 30000,
      validFrom: new Date("2026-01-01T00:00:00Z"),
      validTo: new Date("2026-12-31T23:59:59Z"),
      isActive: true,
    };

    await service.createPlan(planData);

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        discountPercentageBps: 1250,
        discountValueCents: null,
        maxDiscountAmountCents: 500,
        minOrderAmountCents: 1000,
        maxOrderAmountCents: 30000,
      }),
    );
  });

  it("treats null legacy minimum order amounts as zero cents", async () => {
    const returning = vi.fn(async () => [{ id: "plan-1" }]);
    const values = vi.fn(() => ({ returning }));
    const insert = vi.fn(() => ({ values }));
    const service = createServiceWithDb({ insert });
    const planData: Parameters<PartnershipService["createPlan"]>[0] = {
      id: "plan-1",
      partnershipId: "partner-1",
      restaurantId: "restaurant-1",
      planName: "Student 12.5",
      planCode: "STUDENT125",
      discountType: "percentage",
      discountPercentageBps: 1250,
      minOrderAmount: null,
      validFrom: new Date("2026-01-01T00:00:00Z"),
      validTo: new Date("2026-12-31T23:59:59Z"),
      isActive: true,
    };

    await service.createPlan(planData);

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        minOrderAmountCents: 0,
      }),
    );
  });

  it("calculates percentage plan discounts from basis points first", async () => {
    const plan = {
      id: "plan-1",
      isActive: true,
      validFrom: new Date("2026-01-01T00:00:00Z"),
      validTo: new Date("2026-12-31T23:59:59Z"),
      usageLimitPerDay: null,
      dailyUsageCount: 0,
      usageLimitPerMember: null,
      minOrderAmount: 0,
      minOrderAmountCents: 0,
      maxOrderAmount: null,
      applicableDays: null,
      applicableTimeSlots: null,
      discountType: "percentage",
      discountValue: 0,
      discountPercentageBps: 1250,
      maxDiscountAmount: null,
      maxDiscountAmountCents: null,
      canCombineWithCoupons: true,
      canCombineWithPromotions: false,
    };
    const db = {
      query: {
        partnershipPlans: {
          findFirst: vi.fn(async () => plan),
        },
        restaurants: {
          findFirst: vi.fn(async () => ({ settings: { currency: "TWD" } })),
        },
        verifiedMembers: {
          findFirst: vi.fn(async () => ({
            id: "member-1",
            status: "verified",
          })),
        },
      },
    };
    const service = createServiceWithDb(db);

    const result = await service.validatePlan("plan-1", "member-1", 240);

    expect(result).toMatchObject({
      valid: true,
      discountAmount: 30,
      finalAmount: 210,
    });
  });

  it("validates maximum order amounts from cents first", async () => {
    const plan = {
      id: "plan-1",
      isActive: true,
      validFrom: new Date("2026-01-01T00:00:00Z"),
      validTo: new Date("2026-12-31T23:59:59Z"),
      usageLimitPerDay: null,
      dailyUsageCount: 0,
      usageLimitPerMember: null,
      minOrderAmount: 0,
      minOrderAmountCents: 0,
      maxOrderAmount: 1,
      maxOrderAmountCents: 30000,
      applicableDays: null,
      applicableTimeSlots: null,
      discountType: "percentage",
      discountValue: 0,
      discountPercentageBps: 1250,
      maxDiscountAmount: null,
      maxDiscountAmountCents: null,
      canCombineWithCoupons: true,
      canCombineWithPromotions: false,
    };
    const db = {
      query: {
        partnershipPlans: {
          findFirst: vi.fn(async () => plan),
        },
        restaurants: {
          findFirst: vi.fn(async () => ({ settings: { currency: "TWD" } })),
        },
        verifiedMembers: {
          findFirst: vi.fn(async () => ({
            id: "member-1",
            status: "verified",
          })),
        },
      },
    };
    const service = createServiceWithDb(db);

    const result = await service.validatePlan("plan-1", "member-1", 240);

    expect(result).toMatchObject({
      valid: true,
      discountAmount: 30,
      finalAmount: 210,
    });
  });
});

describe("PartnershipService currency precision", () => {
  function buildPlan(overrides: Record<string, unknown> = {}) {
    return {
      id: "plan-1",
      restaurantId: "restaurant-1",
      isActive: true,
      validFrom: new Date("2026-01-01T00:00:00Z"),
      validTo: new Date("2099-12-31T23:59:59Z"),
      usageLimitPerDay: null,
      dailyUsageCount: 0,
      usageLimitPerMember: null,
      minOrderAmountCents: 0,
      maxOrderAmountCents: null,
      applicableDays: null,
      applicableTimeSlots: null,
      discountType: "percentage",
      discountPercentageBps: 1500,
      discountValueCents: null,
      maxDiscountAmountCents: null,
      ...overrides,
    };
  }

  function buildService(plan: object, currency: string) {
    const restaurantsFindFirst = vi.fn(async () => ({
      settings: { currency },
    }));
    const service = createServiceWithDb({
      query: {
        partnershipPlans: { findFirst: vi.fn(async () => plan) },
        restaurants: { findFirst: restaurantsFindFirst },
        verifiedMembers: {
          findFirst: vi.fn(async () => ({
            id: "member-1",
            status: "verified",
          })),
        },
      },
    });
    return { service, restaurantsFindFirst };
  }

  it("rounds a TWD percentage discount to whole dollars", async () => {
    const { service, restaurantsFindFirst } = buildService(buildPlan(), "TWD");

    // 15% of NT$155 = NT$23.25 → NT$23.
    const result = await service.validatePlan("plan-1", "member-1", 155);

    expect(result).toMatchObject({
      valid: true,
      discountAmount: 23,
      finalAmount: 132,
    });
    expect(restaurantsFindFirst).toHaveBeenCalledOnce();
  });

  it("keeps sen for MYR", async () => {
    const { service } = buildService(buildPlan(), "MYR");

    const result = await service.validatePlan("plan-1", "member-1", 155);

    expect(result).toMatchObject({
      discountAmount: 23.25,
      finalAmount: 131.75,
    });
  });

  it("floors a legacy fractional fixed discount for TWD", async () => {
    const { service } = buildService(
      buildPlan({ discountType: "fixed", discountValueCents: 1250 }),
      "TWD",
    );

    const result = await service.validatePlan("plan-1", "member-1", 100);

    expect(result).toMatchObject({ discountAmount: 12, finalAmount: 88 });
  });

  it("floors a special-price difference for TWD", async () => {
    const { service } = buildService(
      buildPlan({ discountType: "special_price", discountValueCents: 8050 }),
      "TWD",
    );

    // NT$100 against a legacy NT$80.50 special price: the NT$19.50 difference
    // is floored, so the customer pays a whole NT$81.
    const result = await service.validatePlan("plan-1", "member-1", 100);

    expect(result).toMatchObject({ discountAmount: 19, finalAmount: 81 });
  });
});

describe("PartnershipService percentage discounts with real D1", () => {
  let db: D1DatabaseAdapter | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it("persists percentage plans as bps and zero min-order cents", async () => {
    db = createPartnershipServiceTestDb();
    await seedPartnershipPlanRelations(db);
    const now = new Date();
    const validFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const validTo = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const service = new PartnershipService(db as unknown as D1Database, {
      JWT_SECRET: "test",
      NODE_ENV: "test",
    });
    const plan = await service.createPlan({
      id: "plan-real",
      partnershipId: "partnership-real",
      restaurantId: "restaurant-partnership-real",
      planName: "Student 12.5",
      planCode: "STUDENT125",
      discountType: "percentage",
      discountValue: 12.5,
      minOrderAmount: null,
      validFrom,
      validTo,
      isActive: true,
      canCombineWithCoupons: true,
      canCombineWithPromotions: false,
    });

    const persisted = await db
      .prepare(
        `
          SELECT
            discount_percentage_bps AS discountPercentageBps,
            discount_value_cents AS discountValueCents,
            min_order_amount_cents AS minOrderAmountCents
          FROM partnership_plans
          WHERE id = ?
        `,
      )
      .bind(plan.id)
      .first();

    expect(persisted).toEqual({
      discountPercentageBps: 1250,
      discountValueCents: null,
      minOrderAmountCents: 0,
    });

    const validation = await service.validatePlan(plan.id, "member-real", 240);
    expect(validation).toMatchObject({
      valid: true,
      discountAmount: 30,
      finalAmount: 210,
    });
  });

  it("rejects real percentage plans below persisted min-order cents", async () => {
    db = createPartnershipServiceTestDb();
    await seedPartnershipPlanRelations(db);
    const now = new Date();
    const validFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const validTo = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const service = new PartnershipService(db as unknown as D1Database, {
      JWT_SECRET: "test",
      NODE_ENV: "test",
    });
    const plan = await service.createPlan({
      id: "plan-min-real",
      partnershipId: "partnership-real",
      restaurantId: "restaurant-partnership-real",
      planName: "Student 12.5 Min 500",
      planCode: "STUDENT125MIN500",
      discountType: "percentage",
      discountValue: 12.5,
      minOrderAmount: 500,
      validFrom,
      validTo,
      isActive: true,
      canCombineWithCoupons: true,
      canCombineWithPromotions: false,
    });

    const persisted = await db
      .prepare(
        `
          SELECT min_order_amount_cents AS minOrderAmountCents
          FROM partnership_plans
          WHERE id = ?
        `,
      )
      .bind(plan.id)
      .first();

    expect(persisted).toEqual({ minOrderAmountCents: 50000 });

    const validation = await service.validatePlan(plan.id, "member-real", 240);
    expect(validation).toMatchObject({
      valid: false,
      error: "最低消費金額為 500",
    });
  });
});

function createPartnershipServiceTestDb(): D1DatabaseAdapter {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE partnership_plans (
      id TEXT PRIMARY KEY NOT NULL,
      partnership_id TEXT NOT NULL,
      restaurant_id TEXT NOT NULL,
      plan_code TEXT NOT NULL,
      plan_name TEXT NOT NULL,
      plan_name_en TEXT,
      description TEXT,
      discount_type TEXT NOT NULL,
      discount_percentage_bps INTEGER,
      discount_value_cents INTEGER,
      max_discount_amount_cents INTEGER,
      min_order_amount_cents INTEGER,
      max_order_amount_cents INTEGER,
      applicable_menu_items TEXT DEFAULT '[]',
      applicable_categories TEXT DEFAULT '[]',
      excluded_menu_items TEXT DEFAULT '[]',
      excluded_categories TEXT DEFAULT '[]',
      applicable_days TEXT DEFAULT '[]',
      applicable_time_slots TEXT DEFAULT '[]',
      usage_limit_per_member INTEGER,
      usage_limit_per_day INTEGER,
      daily_usage_count INTEGER DEFAULT 0,
      total_usage_count INTEGER DEFAULT 0,
      valid_from_ms INTEGER NOT NULL,
      valid_to_ms INTEGER NOT NULL,
      priority INTEGER DEFAULT 0,
      can_combine_with_coupons INTEGER DEFAULT 0,
      can_combine_with_promotions INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      badge_text TEXT,
      badge_color TEXT,
      show_on_menu INTEGER DEFAULT 1,
      total_discount_given_cents INTEGER,
      total_revenue_cents INTEGER,
      terms_and_conditions TEXT,
      notes TEXT,
      metadata TEXT DEFAULT '{}',
      created_at_ms INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at_ms INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      deleted_at_ms INTEGER,
      created_by INTEGER
    );

    CREATE TABLE partnerships (
      id TEXT PRIMARY KEY NOT NULL,
      partner_code TEXT NOT NULL UNIQUE,
      partner_name TEXT NOT NULL,
      partner_name_en TEXT,
      partner_type TEXT NOT NULL,
      contact_person TEXT NOT NULL,
      contact_title TEXT,
      contact_phone TEXT NOT NULL,
      contact_email TEXT NOT NULL,
      address TEXT,
      contract_number TEXT UNIQUE,
      contract_start_date_ms INTEGER NOT NULL,
      contract_end_date_ms INTEGER NOT NULL,
      contract_document_url TEXT,
      verification_method TEXT NOT NULL DEFAULT 'manual',
      verification_config TEXT DEFAULT '{}',
      allowed_email_domains TEXT DEFAULT '[]',
      default_discount_type TEXT,
      default_discount_percentage_bps INTEGER,
      default_discount_value_cents INTEGER,
      total_verified_members INTEGER DEFAULT 0,
      total_usage_count INTEGER DEFAULT 0,
      total_discount_given_cents INTEGER,
      total_revenue_cents INTEGER,
      status TEXT NOT NULL DEFAULT 'draft',
      is_active INTEGER DEFAULT 1,
      logo_url TEXT,
      description TEXT,
      notes TEXT,
      tags TEXT DEFAULT '[]',
      metadata TEXT DEFAULT '{}',
      created_at_ms INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at_ms INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      deleted_at_ms INTEGER,
      created_by INTEGER
    );

    CREATE TABLE restaurants (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      address TEXT NOT NULL,
      district TEXT NOT NULL,
      city TEXT NOT NULL DEFAULT '台中市',
      phone TEXT NOT NULL,
      email TEXT,
      website TEXT,
      messaging_channels TEXT,
      business_hours TEXT,
      is_available INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      logo_url TEXT,
      banner_url TEXT,
      image_urls TEXT,
      shop_qr_code TEXT UNIQUE,
      shop_qr_code_image_url TEXT,
      enable_shop_mode INTEGER NOT NULL DEFAULT 0,
      shop_qr_settings TEXT,
      shop_qr_version INTEGER NOT NULL DEFAULT 1,
      is_demo INTEGER NOT NULL DEFAULT 0,
      settings TEXT,
      timezone TEXT NOT NULL DEFAULT 'Asia/Taipei',
      country_code TEXT,
      rating REAL DEFAULT 0,
      review_count INTEGER NOT NULL DEFAULT 0,
      total_orders INTEGER NOT NULL DEFAULT 0,
      created_at_ms INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at_ms INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      deleted_at_ms INTEGER,
      latitude REAL,
      longitude REAL,
      cuisine_tags TEXT,
      price_range INTEGER,
      supports_takeaway INTEGER NOT NULL DEFAULT 0,
      supports_delivery INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX restaurants_country_code_idx
      ON restaurants (country_code);

    CREATE TABLE verified_members (
      id TEXT PRIMARY KEY NOT NULL,
      partnership_id TEXT NOT NULL,
      customer_id TEXT,
      member_id TEXT NOT NULL,
      member_type TEXT NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      verification_method TEXT NOT NULL,
      verification_document_url TEXT,
      verified_at_ms INTEGER,
      verified_by INTEGER,
      verification_expiry_ms INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      rejection_reason TEXT,
      total_usage_count INTEGER DEFAULT 0,
      total_discount_received_cents INTEGER,
      total_spending_cents INTEGER,
      last_used_at_ms INTEGER,
      department TEXT,
      grade_or_position TEXT,
      student_id_photo_url TEXT,
      notes TEXT,
      metadata TEXT DEFAULT '{}',
      created_at_ms INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at_ms INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      deleted_at_ms INTEGER
    );
  `);
  return new D1DatabaseAdapter(sqlite);
}

async function seedPartnershipPlanRelations(db: D1DatabaseAdapter) {
  const nowMs = Date.now();
  await db
    .prepare(
      `
        INSERT INTO partnerships (
          id,
          partner_code,
          partner_name,
          partner_type,
          contact_person,
          contact_phone,
          contact_email,
          contract_start_date_ms,
          contract_end_date_ms,
          status,
          is_active,
          created_at_ms,
          updated_at_ms
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      "partnership-real",
      "PARTNER_REAL",
      "Test University",
      "university",
      "Test Owner",
      "0912345678",
      "owner@example.test",
      nowMs - 24 * 60 * 60 * 1000,
      nowMs + 24 * 60 * 60 * 1000,
      "active",
      1,
      nowMs,
      nowMs,
    )
    .run();
  await db
    .prepare(
      `
        INSERT INTO restaurants (
          id,
          name,
          type,
          category,
          address,
          district,
          city,
          phone,
          created_at_ms,
          updated_at_ms
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      "restaurant-partnership-real",
      "Partner Restaurant",
      "restaurant",
      "casual",
      "1 Test Road",
      "West",
      "Taichung",
      "0412345678",
      nowMs,
      nowMs,
    )
    .run();
  await db
    .prepare(
      `
        INSERT INTO verified_members (
          id,
          partnership_id,
          member_id,
          member_type,
          full_name,
          verification_method,
          verified_at_ms,
          status,
          created_at_ms,
          updated_at_ms
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      "member-real",
      "partnership-real",
      "S123456",
      "student",
      "Verified Student",
      "manual",
      nowMs,
      "verified",
      nowMs,
      nowMs,
    )
    .run();
}
