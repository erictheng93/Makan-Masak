import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../../../middleware/auth";
import routes from "./index";
import type { ModuleKey } from "@makanmasak/database";

const currentUser = vi.hoisted(() => ({
  value: {
    id: "user-10",
    username: "owner",
    role: 1,
    restaurantId: "restaurant-1",
  } as AuthUser,
}));
const createPartnership = vi.hoisted(() => vi.fn());
const listPartnerships = vi.hoisted(() => vi.fn());
const getPartnership = vi.hoisted(() => vi.fn());
const getPartnershipStatistics = vi.hoisted(() => vi.fn());
const updatePartnership = vi.hoisted(() => vi.fn());
const deletePartnership = vi.hoisted(() => vi.fn());
const createPlan = vi.hoisted(() => vi.fn());
const listPlans = vi.hoisted(() => vi.fn());
const getPlan = vi.hoisted(() => vi.fn());
const validatePlan = vi.hoisted(() => vi.fn());
const updatePlan = vi.hoisted(() => vi.fn());
const deletePlan = vi.hoisted(() => vi.fn());
const submitMemberVerification = vi.hoisted(() => vi.fn());
const getMember = vi.hoisted(() => vi.fn());
const approveMember = vi.hoisted(() => vi.fn());
const rejectMember = vi.hoisted(() => vi.fn());
const updateMember = vi.hoisted(() => vi.fn());
const logUsage = vi.hoisted(() => vi.fn());
const cancelUsageLog = vi.hoisted(() => vi.fn());
const refundUsageLog = vi.hoisted(() => vi.fn());
const getUsageLog = vi.hoisted(() => vi.fn());
const listUsageLogs = vi.hoisted(() => vi.fn());

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: vi.fn(async (c, next) => {
    c.set("user", currentUser.value);
    await next();
  }),
  requireRole: vi.fn(() => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  }),
}));

const gateMocks = vi.hoisted(() => ({
  moduleGate: vi.fn(
    (_module: ModuleKey) => async (_c: unknown, next: () => Promise<void>) => {
      await next();
    },
  ),
}));

vi.mock("../../../middleware/moduleGate", () => ({
  moduleGate: gateMocks.moduleGate,
}));

vi.mock("@makanmasak/database", () => ({
  PartnershipService: class {
    createPartnership = createPartnership;
    listPartnerships = listPartnerships;
    getPartnership = getPartnership;
    getPartnershipStatistics = getPartnershipStatistics;
    updatePartnership = updatePartnership;
    deletePartnership = deletePartnership;
    createPlan = createPlan;
    listPlans = listPlans;
    getPlan = getPlan;
    validatePlan = validatePlan;
    updatePlan = updatePlan;
    deletePlan = deletePlan;
    submitMemberVerification = submitMemberVerification;
    getMember = getMember;
    approveMember = approveMember;
    rejectMember = rejectMember;
    updateMember = updateMember;
    logUsage = logUsage;
    cancelUsageLog = cancelUsageLog;
    refundUsageLog = refundUsageLog;
    getUsageLog = getUsageLog;
    listUsageLogs = listUsageLogs;
  },
}));

// moduleGate(...) is called once per route at registration (module import
// time), not per-request — capture the keys now, before any
// vi.clearAllMocks()-equivalent reset in beforeEach loses the call history.
const moduleGateRegistrationKeys = gateMocks.moduleGate.mock.calls.map(
  (call) => call[0],
);

const partnershipId = "11111111-1111-4111-8111-111111111111";
const planId = "22222222-2222-4222-8222-222222222222";
const memberId = "33333333-3333-4333-8333-333333333333";
const usageId = "44444444-4444-4444-8444-444444444444";
const contractStart = Date.parse("2026-06-01T00:00:00.000Z");
const contractEnd = Date.parse("2026-12-31T00:00:00.000Z");

function createEnv() {
  return {
    DB: {},
    CACHE_KV: {},
  };
}

function partnershipBody() {
  return {
    partnerCode: "UNI",
    partnerName: "University Partner",
    partnerType: "university",
    contactPerson: "Ada Chen",
    contactPhone: "0912345678",
    contactEmail: "ada@example.test",
    contractStartDate: contractStart,
    contractEndDate: contractEnd,
    defaultDiscountType: "percentage",
    defaultDiscountValue: 10,
  };
}

function planBody() {
  return {
    partnershipId,
    restaurantId: "restaurant-1",
    planCode: "UNI10",
    planName: "University 10",
    discountType: "percentage",
    discountValue: 10,
    validFrom: contractStart,
    validTo: contractEnd,
  };
}

describe("partnership routes", () => {
  beforeEach(() => {
    currentUser.value = {
      id: "user-10",
      username: "owner",
      role: 1,
      restaurantId: "restaurant-1",
    };
    createPartnership.mockReset();
    listPartnerships.mockReset();
    getPartnership.mockReset();
    getPartnershipStatistics.mockReset();
    updatePartnership.mockReset();
    deletePartnership.mockReset();
    createPlan.mockReset();
    listPlans.mockReset();
    getPlan.mockReset();
    validatePlan.mockReset();
    updatePlan.mockReset();
    deletePlan.mockReset();
    submitMemberVerification.mockReset();
    getMember.mockReset();
    approveMember.mockReset();
    rejectMember.mockReset();
    updateMember.mockReset();
    logUsage.mockReset();
    cancelUsageLog.mockReset();
    refundUsageLog.mockReset();
    getUsageLog.mockReset();
    listUsageLogs.mockReset();
  });

  it("creates, lists, reads, updates, reports, and deletes partnerships", async () => {
    createPartnership.mockResolvedValue({
      id: partnershipId,
      status: "active",
    });
    listPartnerships.mockResolvedValue({
      data: [{ id: partnershipId, partnerCode: "UNI" }],
      pagination: { page: 2, limit: 5, total: 1 },
    });
    getPartnership.mockResolvedValue({
      id: partnershipId,
      partnerName: "University Partner",
    });
    getPartnershipStatistics.mockResolvedValue({
      totalMembers: 12,
      totalUsage: 30,
    });
    updatePartnership.mockResolvedValue({
      id: partnershipId,
      partnerName: "Updated Partner",
    });
    deletePartnership.mockResolvedValue(undefined);
    const env = createEnv();

    const createResponse = await routes.fetch(
      new Request("https://test/", {
        method: "POST",
        body: JSON.stringify(partnershipBody()),
      }),
      env as never,
    );
    expect(createResponse.status).toBe(200);
    await expect(createResponse.json()).resolves.toMatchObject({
      data: { id: partnershipId, status: "active" },
    });
    expect(createPartnership).toHaveBeenCalledWith(
      expect.objectContaining({
        partnerCode: "UNI",
        createdBy: "user-10",
        contractStartDate: new Date(contractStart),
        contractEndDate: new Date(contractEnd),
      }),
    );

    const listResponse = await routes.fetch(
      new Request("https://test/?partnerType=university&page=2&limit=5"),
      env as never,
    );
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      success: true,
      data: [{ id: partnershipId, partnerCode: "UNI" }],
    });
    expect(listPartnerships).toHaveBeenCalledWith(
      { partnerType: "university" },
      2,
      5,
    );

    const detailResponse = await routes.fetch(
      new Request(`https://test/${partnershipId}`),
      env as never,
    );
    expect(detailResponse.status).toBe(200);
    await expect(detailResponse.json()).resolves.toMatchObject({
      data: { id: partnershipId, partnerName: "University Partner" },
    });

    const statsResponse = await routes.fetch(
      new Request(`https://test/${partnershipId}/statistics`),
      env as never,
    );
    expect(statsResponse.status).toBe(200);
    await expect(statsResponse.json()).resolves.toMatchObject({
      data: { totalMembers: 12, totalUsage: 30 },
    });

    const updateResponse = await routes.fetch(
      new Request(`https://test/${partnershipId}`, {
        method: "PUT",
        body: JSON.stringify({ partnerName: "Updated Partner" }),
      }),
      env as never,
    );
    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toMatchObject({
      data: { id: partnershipId, partnerName: "Updated Partner" },
    });

    const deleteResponse = await routes.fetch(
      new Request(`https://test/${partnershipId}`, { method: "DELETE" }),
      env as never,
    );
    expect(deleteResponse.status).toBe(200);
    await expect(deleteResponse.json()).resolves.toMatchObject({
      message: "Partnership deleted successfully",
    });
  });

  it("lists plans pinned to the caller's own restaurant, ignoring a spoofed restaurantId", async () => {
    listPlans.mockResolvedValue({
      data: [{ id: planId, planCode: "UNI10" }],
      pagination: { page: 1, limit: 20, total: 1 },
    });
    const env = createEnv();

    // Non-admin owner of restaurant-1 tries to read another restaurant's
    // plans (or enumerate platform-wide by supplying someone else's id) —
    // the route must ignore the query param and pin to their own restaurant.
    const response = await routes.fetch(
      new Request("https://test/plans?restaurantId=restaurant-999"),
      env as never,
    );

    expect(response.status).toBe(200);
    expect(listPlans).toHaveBeenCalledWith(
      { restaurantId: "restaurant-1" },
      1,
      20,
    );
  });

  it("lets an admin list plans across restaurants or filter by an explicit restaurantId", async () => {
    currentUser.value = {
      id: "user-1",
      username: "admin",
      role: 0,
      restaurantId: "restaurant-1",
    };
    listPlans.mockResolvedValue({
      data: [],
      pagination: { page: 1, limit: 20, total: 0 },
    });
    const env = createEnv();

    await routes.fetch(new Request("https://test/plans"), env as never);
    expect(listPlans).toHaveBeenCalledWith({}, 1, 20);

    await routes.fetch(
      new Request("https://test/plans?restaurantId=restaurant-999"),
      env as never,
    );
    expect(listPlans).toHaveBeenCalledWith(
      { restaurantId: "restaurant-999" },
      1,
      20,
    );
  });

  it("creates, reads, validates, updates, and deletes plans", async () => {
    createPlan.mockResolvedValue({ id: planId, planCode: "UNI10" });
    getPlan.mockResolvedValue({
      id: planId,
      planName: "University 10",
      restaurantId: "restaurant-1",
    });
    validatePlan.mockResolvedValue({ valid: true, discountAmount: 30 });
    updatePlan.mockResolvedValue({ id: planId, planName: "Updated Plan" });
    deletePlan.mockResolvedValue(undefined);
    const env = createEnv();

    const createResponse = await routes.fetch(
      new Request("https://test/plans", {
        method: "POST",
        body: JSON.stringify(planBody()),
      }),
      env as never,
    );
    expect(createResponse.status).toBe(200);
    await expect(createResponse.json()).resolves.toMatchObject({
      data: { id: planId, planCode: "UNI10" },
    });
    expect(createPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        createdBy: "user-10",
        validFrom: new Date(contractStart),
        validTo: new Date(contractEnd),
      }),
    );

    const detailResponse = await routes.fetch(
      new Request(`https://test/plans/${planId}`),
      env as never,
    );
    expect(detailResponse.status).toBe(200);
    await expect(detailResponse.json()).resolves.toMatchObject({
      data: { id: planId, planName: "University 10" },
    });

    const validateResponse = await routes.fetch(
      new Request("https://test/plans/validate", {
        method: "POST",
        body: JSON.stringify({
          planId,
          memberId,
          orderAmount: 300,
          menuItems: ["101"],
          categories: ["drinks"],
        }),
      }),
      env as never,
    );
    expect(validateResponse.status).toBe(200);
    await expect(validateResponse.json()).resolves.toMatchObject({
      data: { valid: true, discountAmount: 30 },
    });
    expect(validatePlan).toHaveBeenCalledWith(
      planId,
      memberId,
      300,
      ["101"],
      ["drinks"],
    );

    const updateResponse = await routes.fetch(
      new Request(`https://test/plans/${planId}`, {
        method: "PUT",
        body: JSON.stringify({ planName: "Updated Plan" }),
      }),
      env as never,
    );
    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toMatchObject({
      data: { id: planId, planName: "Updated Plan" },
    });

    const deleteResponse = await routes.fetch(
      new Request(`https://test/plans/${planId}`, { method: "DELETE" }),
      env as never,
    );
    expect(deleteResponse.status).toBe(200);
    await expect(deleteResponse.json()).resolves.toMatchObject({
      message: "Plan deleted successfully",
    });

    // GET /plans, GET /plans/:planId, and POST /plans/validate must carry
    // the same "loyalty" gate as the other 18 partnership routes (see
    // module-gate.test.ts for the real, unmocked-gate proof). POST
    // /members/verify stays deliberately public/ungated (self-service
    // applicant flow authenticated by nothing — see its own comment).
    const loyaltyCount = moduleGateRegistrationKeys.filter(
      (key) => key === "loyalty",
    ).length;
    expect(loyaltyCount).toBeGreaterThanOrEqual(21);
  });

  it("submits, reads, approves, rejects, and updates members", async () => {
    submitMemberVerification.mockResolvedValue({
      id: memberId,
      status: "pending",
    });
    getMember.mockResolvedValue({ id: memberId, status: "pending" });
    approveMember.mockResolvedValue({ id: memberId, status: "verified" });
    rejectMember.mockResolvedValue({ id: memberId, status: "rejected" });
    updateMember.mockResolvedValue({ id: memberId, department: "CS" });
    const env = createEnv();

    const verifyResponse = await routes.fetch(
      new Request("https://test/members/verify", {
        method: "POST",
        body: JSON.stringify({
          partnershipId,
          memberId: "STU12345",
          memberType: "student",
          fullName: "Ada Chen",
          email: "ada@example.test",
          verificationMethod: "manual",
        }),
      }),
      env as never,
    );
    expect(verifyResponse.status).toBe(200);
    await expect(verifyResponse.json()).resolves.toMatchObject({
      data: { id: memberId, status: "pending" },
      message: "Verification request submitted successfully",
    });

    const detailResponse = await routes.fetch(
      new Request(`https://test/members/${memberId}`),
      env as never,
    );
    expect(detailResponse.status).toBe(200);
    await expect(detailResponse.json()).resolves.toMatchObject({
      data: { id: memberId, status: "pending" },
    });

    const expiry = Date.parse("2027-06-01T00:00:00.000Z");
    const approveResponse = await routes.fetch(
      new Request(`https://test/members/${memberId}/approve`, {
        method: "POST",
        body: JSON.stringify({ verificationExpiry: expiry }),
      }),
      env as never,
    );
    expect(approveResponse.status).toBe(200);
    expect(approveMember).toHaveBeenCalledWith(
      memberId,
      "user-10",
      new Date(expiry),
    );

    const rejectResponse = await routes.fetch(
      new Request(`https://test/members/${memberId}/reject`, {
        method: "POST",
        body: JSON.stringify({ rejectionReason: "Document mismatch" }),
      }),
      env as never,
    );
    expect(rejectResponse.status).toBe(200);
    expect(rejectMember).toHaveBeenCalledWith(memberId, "Document mismatch");

    const updateResponse = await routes.fetch(
      new Request(`https://test/members/${memberId}`, {
        method: "PUT",
        body: JSON.stringify({ department: "CS" }),
      }),
      env as never,
    );
    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toMatchObject({
      data: { id: memberId, department: "CS" },
    });
  });

  it("logs, cancels, and refunds partnership usage", async () => {
    getPlan.mockResolvedValue({ id: planId, restaurantId: "restaurant-1" });
    getUsageLog.mockResolvedValue({
      id: usageId,
      restaurantId: "restaurant-1",
    });
    logUsage.mockResolvedValue({ id: usageId, status: "completed" });
    cancelUsageLog.mockResolvedValue({ id: usageId, status: "cancelled" });
    refundUsageLog.mockResolvedValue({ id: usageId, status: "refunded" });
    const env = createEnv();

    const usageResponse = await routes.fetch(
      new Request("https://test/usage", {
        method: "POST",
        body: JSON.stringify({
          partnershipId,
          planId,
          memberId,
          orderId: 42,
          restaurantId: "restaurant-1",
          discountType: "percentage",
          discountValue: 10,
          discountAmount: 30,
          originalAmount: 300,
          finalAmount: 270,
          channel: "dine_in",
        }),
      }),
      env as never,
    );
    expect(usageResponse.status).toBe(200);
    await expect(usageResponse.json()).resolves.toMatchObject({
      data: { id: usageId, status: "completed" },
      message: "Usage logged successfully",
    });
    expect(logUsage).toHaveBeenCalledWith(
      expect.objectContaining({ verifiedByUserId: "user-10" }),
    );

    const cancelResponse = await routes.fetch(
      new Request(`https://test/usage/${usageId}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason: "Customer returned item" }),
      }),
      env as never,
    );
    expect(cancelResponse.status).toBe(200);
    await expect(cancelResponse.json()).resolves.toMatchObject({
      message: "Usage cancelled successfully",
    });
    expect(cancelUsageLog).toHaveBeenCalledWith(
      usageId,
      "Customer returned item",
      "restaurant-1",
    );

    const refundResponse = await routes.fetch(
      new Request(`https://test/usage/${usageId}/refund`, { method: "POST" }),
      env as never,
    );
    expect(refundResponse.status).toBe(200);
    await expect(refundResponse.json()).resolves.toMatchObject({
      message: "Usage refunded successfully",
      data: { id: usageId, status: "refunded" },
    });
  });

  describe("tenant isolation", () => {
    const foreignPlan = { id: planId, restaurantId: "restaurant-2" };
    const foreignLog = { id: usageId, restaurantId: "restaurant-2" };
    const app = new Hono();
    app.onError((err, c) =>
      c.json({}, ((err as { status?: number }).status ?? 500) as 404),
    );
    app.route("/", routes);
    const send = (path: string, method = "GET", body?: unknown) =>
      app.fetch(
        new Request(`https://test${path}`, {
          method,
          ...(body !== undefined && { body: JSON.stringify(body) }),
        }),
        createEnv() as never,
      );

    it("rewrites restaurantId when an owner creates a plan for another restaurant", async () => {
      createPlan.mockResolvedValue({ id: planId });
      await send("/plans", "POST", {
        ...planBody(),
        restaurantId: "restaurant-2",
      });
      expect(createPlan).toHaveBeenCalledWith(
        expect.objectContaining({ restaurantId: "restaurant-1" }),
      );
    });

    it("404s read/update/delete of another restaurant's plan without writing", async () => {
      getPlan.mockResolvedValue(foreignPlan);
      expect((await send(`/plans/${planId}`)).status).toBe(404);
      expect(
        (await send(`/plans/${planId}`, "PUT", { planName: "Renamed plan" }))
          .status,
      ).toBe(404);
      expect((await send(`/plans/${planId}`, "DELETE")).status).toBe(404);
      expect(updatePlan).not.toHaveBeenCalled();
      expect(deletePlan).not.toHaveBeenCalled();
    });

    it("passes the caller's restaurant to plan writes as a DB-level scope", async () => {
      getPlan.mockResolvedValue({ id: planId, restaurantId: "restaurant-1" });
      updatePlan.mockResolvedValue({ id: planId });
      await send(`/plans/${planId}`, "PUT", { planName: "Renamed plan" });
      await send(`/plans/${planId}`, "DELETE");
      expect(updatePlan).toHaveBeenCalledWith(
        planId,
        expect.anything(),
        "restaurant-1",
      );
      expect(deletePlan).toHaveBeenCalledWith(planId, "restaurant-1");
    });

    it("pins the usage list to the caller's restaurant", async () => {
      listUsageLogs.mockResolvedValue({ data: [], pagination: {} });
      await send("/usage?restaurantId=restaurant-2");
      expect(listUsageLogs).toHaveBeenCalledWith(
        expect.objectContaining({ restaurantId: "restaurant-1" }),
        1,
        20,
      );
    });

    it("rejects logging usage against another restaurant's plan", async () => {
      getPlan.mockResolvedValue(foreignPlan);
      const res = await send("/usage", "POST", {
        partnershipId,
        planId,
        memberId,
        orderId: 42,
        restaurantId: "restaurant-2",
        discountType: "percentage",
        discountValue: 10,
        discountAmount: 30,
        originalAmount: 300,
        finalAmount: 270,
        channel: "dine_in",
      });
      expect(res.status).toBe(404);
      expect(logUsage).not.toHaveBeenCalled();
    });

    it("404s cancel/refund of another restaurant's usage log", async () => {
      getUsageLog.mockResolvedValue(foreignLog);
      expect(
        (
          await send(`/usage/${usageId}/cancel`, "POST", {
            reason: "Wrong order",
          })
        ).status,
      ).toBe(404);
      expect((await send(`/usage/${usageId}/refund`, "POST")).status).toBe(404);
      expect(cancelUsageLog).not.toHaveBeenCalled();
      expect(refundUsageLog).not.toHaveBeenCalled();
    });
  });
});
