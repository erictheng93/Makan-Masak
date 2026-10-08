import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useTenantsStore } from "./tenants";
import {
  deploymentsApi,
  healthApi,
  licensesApi,
  tenantsApi,
} from "@/services/api";
import type {
  DeploymentLog,
  HealthCheck,
  License,
  Tenant,
  TenantResource,
} from "@/types";

vi.mock("@/services/api", () => ({
  tenantsApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getResources: vi.fn(),
  },
  deploymentsApi: {
    getHistory: vi.fn(),
    provision: vi.fn(),
    deploy: vi.fn(),
  },
  healthApi: {
    getTenantStatus: vi.fn(),
  },
  licensesApi: {
    getTenantLicense: vi.fn(),
  },
}));

const tenant = (overrides: Partial<Tenant> = {}): Tenant => ({
  id: "tenant-1",
  businessName: "Demo Noodles",
  contactEmail: "owner@example.com",
  status: "active",
  licenseTier: "standard",
  createdAt: "2026-06-07T00:00:00.000Z",
  ...overrides,
});

const resource = (): TenantResource => ({
  id: "resource-1",
  tenantId: "tenant-1",
  resourceType: "d1",
  resourceName: "tenant-db",
  resourceId: "db-1",
  status: "provisioned",
  createdAt: "2026-06-07T00:00:00.000Z",
});

const deployment = (id = "deployment-1"): DeploymentLog => ({
  id,
  tenantId: "tenant-1",
  deploymentType: "update",
  fromVersion: "1.0.0",
  toVersion: "1.1.0",
  status: "completed",
  startedAt: "2026-06-07T00:00:00.000Z",
});

const healthCheck = (): HealthCheck => ({
  id: "health-1",
  tenantId: "tenant-1",
  status: "healthy",
  responseTimeMs: 120,
  checkedAt: "2026-06-07T00:00:00.000Z",
});

const license = (): License => ({
  id: "license-1",
  tenantId: "tenant-1",
  licenseKey: "license-key",
  tier: "standard",
  createdAt: "2026-06-07T00:00:00.000Z",
});

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("useTenantsStore", () => {
  it("fetches tenants and derives status counts", async () => {
    vi.mocked(tenantsApi.list).mockResolvedValue({
      data: [
        tenant({ id: "tenant-active", status: "active" }),
        tenant({ id: "tenant-pending", status: "pending" }),
        tenant({ id: "tenant-provisioning", status: "provisioning" }),
      ],
      total: 3,
      page: 1,
      limit: 50,
      totalPages: 1,
    });
    const store = useTenantsStore();

    await store.fetchTenants();

    expect(store.totalTenants).toBe(3);
    expect(store.activeTenants.map((item) => item.id)).toEqual([
      "tenant-active",
    ]);
    expect(store.pendingTenants.map((item) => item.id)).toEqual([
      "tenant-pending",
      "tenant-provisioning",
    ]);
    expect(store.statusCounts).toMatchObject({
      active: 1,
      pending: 1,
      provisioning: 1,
      suspended: 0,
      terminated: 0,
    });
    expect(store.loading).toBe(false);
  });

  it("creates, updates, and deletes tenants in local state", async () => {
    const original = tenant();
    const updated = tenant({
      businessName: "Updated Noodles",
      status: "suspended",
    });
    vi.mocked(tenantsApi.create).mockResolvedValue(original);
    vi.mocked(tenantsApi.update).mockResolvedValue(updated);
    vi.mocked(tenantsApi.delete).mockResolvedValue(undefined);
    const store = useTenantsStore();

    await expect(
      store.createTenant({
        businessName: "Demo Noodles",
        contactEmail: "owner@example.com",
        licenseTier: "standard",
      }),
    ).resolves.toEqual(original);
    expect(store.tenants).toEqual([original]);

    store.currentTenant = original;
    await expect(
      store.updateTenant("tenant-1", { businessName: "Updated Noodles" }),
    ).resolves.toEqual(updated);
    expect(store.tenants).toEqual([updated]);
    expect(store.currentTenant).toEqual(updated);

    await store.deleteTenant("tenant-1");
    expect(store.tenants).toEqual([]);
  });

  it("records API errors while restoring loading state", async () => {
    vi.mocked(tenantsApi.list).mockRejectedValue(new Error("API unavailable"));
    const store = useTenantsStore();

    await expect(store.fetchTenants()).rejects.toThrow("API unavailable");

    expect(store.error).toBe("API unavailable");
    expect(store.loading).toBe(false);
  });

  it("loads tenant detail side panels from resource, deployment, health, and license APIs", async () => {
    vi.mocked(tenantsApi.getResources).mockResolvedValue([resource()]);
    vi.mocked(deploymentsApi.getHistory).mockResolvedValue([deployment()]);
    vi.mocked(healthApi.getTenantStatus).mockResolvedValue([healthCheck()]);
    vi.mocked(licensesApi.getTenantLicense).mockResolvedValue([license()]);
    const store = useTenantsStore();

    await store.fetchTenantResources("tenant-1");
    await store.fetchTenantDeployments("tenant-1");
    await store.fetchTenantHealthChecks("tenant-1");
    await store.fetchTenantLicenses("tenant-1");

    expect(store.currentResources).toEqual([resource()]);
    expect(store.currentDeployments).toEqual([deployment()]);
    expect(store.currentHealthChecks).toEqual([healthCheck()]);
    expect(store.currentLicenses).toEqual([license()]);
  });

  it("normalizes tenant health API summary payloads into health checks", async () => {
    vi.mocked(healthApi.getTenantStatus).mockResolvedValue({
      recentChecks: [
        {
          status: "degraded",
          responseTimeMs: 850,
          checkedAt: "2026-06-07T01:00:00.000Z",
        },
      ],
    } as never);
    const store = useTenantsStore();

    await store.fetchTenantHealthChecks("tenant-1");

    expect(store.currentHealthChecks).toEqual([
      {
        id: "tenant-1-health-0",
        tenantId: "tenant-1",
        status: "degraded",
        responseTimeMs: 850,
        checkedAt: "2026-06-07T01:00:00.000Z",
      },
    ]);
  });

  it("normalizes tenant license API summary payloads into license rows", async () => {
    vi.mocked(licensesApi.getTenantLicense).mockResolvedValue({
      tenantId: "tenant-1",
      licenseKey: "MKM-STD-TENANT-1234",
      tier: "standard",
      expiresAt: "2027-06-07T00:00:00.000Z",
    } as never);
    const store = useTenantsStore();

    await store.fetchTenantLicenses("tenant-1");

    expect(store.currentLicenses).toEqual([
      {
        id: "tenant-1-license",
        tenantId: "tenant-1",
        licenseKey: "MKM-STD-TENANT-1234",
        tier: "standard",
        expiresAt: "2027-06-07T00:00:00.000Z",
        createdAt: "2027-06-07T00:00:00.000Z",
      },
    ]);
  });

  it("updates provisioning resources and prepends new deployments", async () => {
    vi.mocked(deploymentsApi.provision).mockResolvedValue([resource()]);
    vi.mocked(deploymentsApi.deploy).mockResolvedValue(deployment("new"));
    const store = useTenantsStore();
    store.currentDeployments = [deployment("old")];

    await expect(store.provisionTenant("tenant-1")).resolves.toEqual([
      resource(),
    ]);
    expect(store.currentResources).toEqual([resource()]);

    await expect(
      store.deployTenant("tenant-1", "1.1.0", "update"),
    ).resolves.toEqual(deployment("new"));
    expect(store.currentDeployments.map((item) => item.id)).toEqual([
      "new",
      "old",
    ]);
    expect(deploymentsApi.deploy).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        targetVersion: "1.1.0",
        deploymentType: "update",
      }),
    );
  });

  it("clears current tenant detail state", () => {
    const store = useTenantsStore();
    store.currentTenant = tenant();
    store.currentResources = [resource()];
    store.currentDeployments = [deployment()];
    store.currentHealthChecks = [healthCheck()];
    store.currentLicenses = [license()];

    store.clearCurrentTenant();

    expect(store.currentTenant).toBeNull();
    expect(store.currentResources).toEqual([]);
    expect(store.currentDeployments).toEqual([]);
    expect(store.currentHealthChecks).toEqual([]);
    expect(store.currentLicenses).toEqual([]);
  });
});
