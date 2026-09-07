import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/services/api";
import { ownerService } from "./ownerService";

vi.mock("@/services/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
  unwrapApiList: (payload: unknown) => {
    const data =
      typeof payload === "object" && payload !== null && "data" in payload
        ? (payload as { data: unknown }).data
        : payload;
    return Array.isArray(data) ? data : [];
  },
}));

const ALERT = {
  id: "0198c3a4-5b6c-7d8e-9f01-234567890abc",
  alertType: "inventory_low",
  severity: "high",
  title: "Coconut milk is below its minimum stock level",
  description: "Coconut milk is at 2 L, below the 5 L minimum.",
  details: { name: "Coconut milk" },
  createdAt: 1757116800000,
};

describe("ownerService", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
  });

  describe("listEmergencyAlerts", () => {
    it("unwraps the envelope into the alert list", async () => {
      vi.mocked(api.get).mockResolvedValueOnce({
        data: { success: true, data: [ALERT] },
      } as never);

      await expect(ownerService.listEmergencyAlerts()).resolves.toEqual([
        ALERT,
      ]);
      expect(api.get).toHaveBeenCalledWith("/alerts");
    });

    // A shape the panel cannot iterate must not reach the template: an owner
    // seeing a render crash is worse than an owner seeing no alerts.
    it.each([
      ["an error envelope", { success: false, error: { code: "NOPE" } }],
      ["a bare object", { success: true, data: { nope: true } }],
      ["nothing", undefined],
    ])("returns an empty list for %s", async (_label, payload) => {
      vi.mocked(api.get).mockResolvedValueOnce({ data: payload } as never);

      await expect(ownerService.listEmergencyAlerts()).resolves.toEqual([]);
    });

    it("propagates a request failure to the caller", async () => {
      vi.mocked(api.get).mockRejectedValueOnce(new Error("network down"));

      await expect(ownerService.listEmergencyAlerts()).rejects.toThrow(
        "network down",
      );
    });
  });

  // Ids are UUIDv7 text, not integers: a template literal must not coerce them.
  describe("alert actions", () => {
    it("posts a resolve for the given alert id", async () => {
      vi.mocked(api.post).mockResolvedValueOnce({} as never);

      await ownerService.resolveEmergencyAlert(ALERT.id);

      expect(api.post).toHaveBeenCalledWith(`/alerts/${ALERT.id}/resolve`);
    });

    it("posts an escalate for the given alert id", async () => {
      vi.mocked(api.post).mockResolvedValueOnce({} as never);

      await ownerService.escalateEmergencyAlert(ALERT.id);

      expect(api.post).toHaveBeenCalledWith(`/alerts/${ALERT.id}/escalate`);
    });

    // OwnerView's handler shows a toast on rejection; swallowing here would
    // make the button look like it worked.
    it.each([
      ["resolve", () => ownerService.resolveEmergencyAlert(ALERT.id)],
      ["escalate", () => ownerService.escalateEmergencyAlert(ALERT.id)],
    ])("lets a failed %s reject", async (_label, call) => {
      vi.mocked(api.post).mockRejectedValueOnce(new Error("404"));

      await expect(call()).rejects.toThrow("404");
    });
  });

  describe("getQuickActionRoute", () => {
    it("maps a known action to its route", () => {
      expect(ownerService.getQuickActionRoute("add-staff")).toBe(
        "/dashboard/employees",
      );
    });

    it("returns null for an unknown action", () => {
      expect(ownerService.getQuickActionRoute("teleport")).toBeNull();
    });
  });
});
