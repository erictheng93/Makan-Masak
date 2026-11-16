import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useHealthStore } from "./health";
import { healthApi } from "@/services/api";
import type { HealthCheck } from "@/types";

vi.mock("@/services/api", () => ({
  healthApi: {
    getAllStatus: vi.fn(),
    check: vi.fn(),
  },
}));

const check = (
  tenantId: string,
  status: HealthCheck["status"],
  responseTimeMs?: number,
): HealthCheck => ({
  id: `health-${tenantId}`,
  tenantId,
  status,
  responseTimeMs,
  checkedAt: "2026-06-07T00:00:00.000Z",
});

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("useHealthStore", () => {
  it("fetches all health checks and computes dashboard summary", async () => {
    // Real GET /health/tenants shape: one row per tenant, latest check nested.
    const row = (
      tenantId: string,
      status: HealthCheck["status"],
      responseTimeMs: number | null,
    ) => ({
      tenantId,
      health: {
        status,
        responseTimeMs,
        lastCheck: responseTimeMs === null ? null : "2026-06-07T00:00:00Z",
      },
    });
    vi.mocked(healthApi.getAllStatus).mockResolvedValue({
      tenants: [
        row("tenant-1", "healthy", 100),
        row("tenant-2", "degraded", 500),
        row("tenant-3", "down", 1000),
        row("tenant-4", "unknown", null),
      ],
    });
    const store = useHealthStore();

    await store.fetchAllHealthChecks();

    expect(store.healthyCount).toBe(1);
    expect(store.degradedCount).toBe(1);
    expect(store.downCount).toBe(1);
    expect(store.overallStatus).toBe("down");
    expect(store.averageResponseTime).toBe(533);
    expect(store.groupedByStatus.healthy.map((item) => item.tenantId)).toEqual([
      "tenant-1",
    ]);
    expect(store.groupedByStatus.unknown.map((item) => item.tenantId)).toEqual([
      "tenant-4",
    ]);
    expect(store.lastUpdated).toBeInstanceOf(Date);
    expect(store.loading).toBe(false);
  });

  it("upserts a tenant health check result", async () => {
    vi.mocked(healthApi.check).mockResolvedValue(
      check("tenant-1", "degraded", 420),
    );
    const store = useHealthStore();
    store.healthChecks = [check("tenant-1", "healthy", 100)];

    await expect(store.checkTenantHealth("tenant-1")).resolves.toEqual(
      check("tenant-1", "degraded", 420),
    );

    expect(store.healthChecks).toEqual([check("tenant-1", "degraded", 420)]);

    vi.mocked(healthApi.check).mockResolvedValue(
      check("tenant-2", "healthy", 90),
    );
    await store.checkTenantHealth("tenant-2");
    expect(store.healthChecks.map((item) => item.tenantId)).toEqual([
      "tenant-1",
      "tenant-2",
    ]);
  });

  it("uses degraded or healthy overall status when no tenants are down", () => {
    const store = useHealthStore();

    store.healthChecks = [
      check("tenant-1", "healthy", 100),
      check("tenant-2", "degraded", 500),
    ];
    expect(store.overallStatus).toBe("degraded");

    store.healthChecks = [check("tenant-1", "healthy", 100)];
    expect(store.overallStatus).toBe("healthy");

    store.healthChecks = [];
    expect(store.overallStatus).toBe("unknown");
  });

  it("maps status colors and labels for UI badges", () => {
    const store = useHealthStore();

    expect(store.getStatusColor("healthy")).toBe("green");
    expect(store.getStatusColor("degraded")).toBe("yellow");
    expect(store.getStatusColor("down")).toBe("red");
    expect(store.getStatusColor("unknown")).toBe("gray");

    expect(store.getStatusLabel("healthy")).not.toBe("");
    expect(store.getStatusLabel("degraded")).not.toBe("");
    expect(store.getStatusLabel("down")).not.toBe("");
    expect(store.getStatusLabel("unknown")).not.toBe("");
  });
});
