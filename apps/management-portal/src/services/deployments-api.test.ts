import { beforeEach, describe, expect, it, vi } from "vitest";

const { post } = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock("axios", () => {
  const client = {
    post,
    get: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  };
  return { default: { create: () => client } };
});
vi.mock("vue-toastification", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import { deploymentsApi, isSemver } from "./api";

describe("deploymentsApi contract with management-api", () => {
  beforeEach(() => post.mockReset());

  it("deploy sends targetVersion + deploymentType and maps the response to a log", async () => {
    post.mockResolvedValue({
      data: {
        success: true,
        data: {
          deploymentId: "d-1",
          tenantId: "t-1",
          version: "1.2.0",
          status: "completed",
        },
      },
    });

    const log = await deploymentsApi.deploy({
      tenantId: "t-1",
      targetVersion: "1.2.0",
      deploymentType: "initial",
    });

    expect(post).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledWith(
      "/deployments/deploy",
      expect.objectContaining({
        tenantId: "t-1",
        targetVersion: "1.2.0",
        deploymentType: "initial",
      }),
    );
    expect(log).toEqual(
      expect.objectContaining({
        id: "d-1",
        tenantId: "t-1",
        toVersion: "1.2.0",
        deploymentType: "initial",
        status: "completed",
      }),
    );
  });

  it("batchDeploy sends targetVersion and maps summary/results", async () => {
    post.mockResolvedValue({
      data: {
        success: true,
        data: {
          targetVersion: "1.2.0",
          results: [
            { tenantId: "a", success: true },
            { tenantId: "b", success: false },
          ],
          summary: { total: 2, succeeded: 1, failed: 1 },
        },
      },
    });

    const out = await deploymentsApi.batchDeploy({
      tenantIds: ["a", "b"],
      targetVersion: "1.2.0",
    });

    expect(post).toHaveBeenCalledWith(
      "/deployments/batch",
      expect.objectContaining({
        tenantIds: ["a", "b"],
        targetVersion: "1.2.0",
      }),
    );
    expect(out).toEqual({ queued: 1, failed: ["b"] });
  });

  it("isSemver matches the backend regex", () => {
    expect(isSemver("1.2.0")).toBe(true);
    for (const v of ["", "latest", "v1.2.0", "1.2", "1.2.0-beta"]) {
      expect(isSemver(v)).toBe(false);
    }
  });
});
