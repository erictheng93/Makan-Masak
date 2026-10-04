import { expect, it, vi } from "vitest";
import { VersionSyncService } from "./VersionSyncService";

// Known platform-flow gap: deployToTenant returns failures instead of throwing.
// Remove .fails when batch progress respects that result.
it.fails(
  "keeps a returned deployment failure out of completed progress",
  async () => {
    const values = new Map([
      [
        "update_plan:verification",
        JSON.stringify({
          id: "verification",
          targetVersion: "1.2.0",
          strategy: "all_at_once",
          tenantIds: ["tenant-1"],
          status: "planned",
        }),
      ],
    ]);
    const deployToTenant = vi.fn(async () => ({
      success: false,
      deploymentId: "deployment-1",
      error: "Bundle not found",
    }));
    const service = new VersionSyncService({
      CACHE_KV: {
        get: async (key: string) => values.get(key) ?? null,
        put: async (key: string, value: string) => values.set(key, value),
      },
      MANAGEMENT_DB: {
        prepare: () => ({
          bind: () => ({
            all: async () => ({
              results: [
                { id: "tenant-1", business_name: "Demo", status: "active" },
              ],
            }),
          }),
        }),
      },
    } as never);
    Object.assign(service, { provisioningService: { deployToTenant } });

    const progress = await service.executeBatchUpdatePlan("verification");

    expect(deployToTenant).toHaveBeenCalledOnce();
    expect(deployToTenant).toHaveBeenCalledWith("tenant-1", "1.2.0");
    expect(progress).toMatchObject({ completedTenants: 0, failedTenants: 1 });
  },
);
