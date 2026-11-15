import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/services/api";
import { getQuotaMeters, planService, toQuotaMeter } from "./planService";

vi.mock("@/services/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  unwrapApiPayload: vi.fn((payload) => payload.data ?? payload),
}));

const envelope = (data: unknown) => ({ data: { success: true, data } });

describe("planService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the plan overview", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(
      envelope({ currentTier: "trial" }) as never,
    );

    await expect(planService.getPlan()).resolves.toEqual({
      currentTier: "trial",
    });
    expect(api.get).toHaveBeenCalledOnce();
    expect(api.get).toHaveBeenCalledWith("/billing/plan");
  });

  it("scopes every plan call to the shop an admin names", async () => {
    vi.mocked(api.get).mockResolvedValue(envelope({}) as never);
    vi.mocked(api.post).mockResolvedValue(envelope({}) as never);
    vi.mocked(api.delete).mockResolvedValue(envelope({}) as never);

    await planService.getPlan("shop 9");
    await planService.getImpact("pro", "shop 9");
    await planService.changePlan("pro", "shop 9");
    await planService.cancelPending("shop 9");

    expect(api.get).toHaveBeenCalledWith("/billing/plan?restaurantId=shop%209");
    expect(api.get).toHaveBeenCalledWith("/billing/plan/impact", {
      planTier: "pro",
      restaurantId: "shop 9",
    });
    expect(api.post).toHaveBeenCalledWith(
      "/billing/plan/change?restaurantId=shop%209",
      { planTier: "pro" },
    );
    expect(api.delete).toHaveBeenCalledWith(
      "/billing/plan/pending?restaurantId=shop%209",
    );
  });

  it("asks for the impact of one target plan", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(
      envelope({ toTier: "basic", lostModules: [], items: [] }) as never,
    );

    await planService.getImpact("basic");

    expect(api.get).toHaveBeenCalledWith("/billing/plan/impact", {
      planTier: "basic",
    });
  });

  it("posts the plan change and returns the fresh overview", async () => {
    vi.mocked(api.post).mockResolvedValueOnce(
      envelope({ currentTier: "pro" }) as never,
    );

    await expect(planService.changePlan("pro")).resolves.toEqual({
      currentTier: "pro",
    });
    expect(api.post).toHaveBeenCalledWith("/billing/plan/change", {
      planTier: "pro",
    });
  });

  it("cancels the pending change", async () => {
    vi.mocked(api.delete).mockResolvedValueOnce(
      envelope({ pendingChange: null }) as never,
    );

    await planService.cancelPending();

    expect(api.delete).toHaveBeenCalledWith("/billing/plan/pending");
  });
});

describe("quota meters", () => {
  it("trusts state and enforced when the API sends them", () => {
    expect(
      toQuotaMeter({
        meterKey: "api.requests",
        total: 1,
        softLimit: 10,
        hardLimit: 20,
        state: "warning",
        enforced: true,
      }),
    ).toMatchObject({ state: "warning", enforced: true });
  });

  it("derives state from the limits when the field is absent", () => {
    const meter = (total: number) =>
      toQuotaMeter({
        meterKey: "orders.created",
        total,
        softLimit: 80,
        hardLimit: 100,
      });

    expect(meter(10)).toMatchObject({ state: "ok", enforced: true });
    expect(meter(80).state).toBe("warning");
    expect(meter(100).state).toBe("over");
  });

  it("treats unmetered keys as not enforced and unlimited as ok", () => {
    expect(
      toQuotaMeter({ meterKey: "api.requests", total: 9_999 }),
    ).toMatchObject({ state: "ok", enforced: false });
  });

  it("reads and normalises /me/usage", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(
      envelope({
        meters: [{ meterKey: "print.jobs", total: 5, hardLimit: 5 }],
      }) as never,
    );

    await expect(getQuotaMeters()).resolves.toEqual([
      expect.objectContaining({ meterKey: "print.jobs", state: "over" }),
    ]);
    expect(api.get).toHaveBeenCalledWith("/me/usage");
  });
});
