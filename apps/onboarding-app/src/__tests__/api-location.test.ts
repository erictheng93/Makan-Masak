import { describe, expect, it } from "vitest";
import type { CreateApplicationData } from "@/services/api";

describe("onboarding application payload", () => {
  it("carries mandatory restaurant coordinates", () => {
    const payload: CreateApplicationData = {
      businessName: "GPS Dumpling",
      contactName: "Lin Mei",
      contactEmail: "mei@example.com",
      contactPhone: "0912345678",
      address: "1 Fengjia Road",
      district: "Xitun District",
      city: "Taichung City",
      planId: "standard",
      latitude: 24.147736,
      longitude: 120.673648,
    };

    expect(payload.latitude).toBe(24.147736);
    expect(payload.longitude).toBe(120.673648);
    expect(payload.address).toBe("1 Fengjia Road");
    expect(payload.district).toBe("Xitun District");
    expect(payload.city).toBe("Taichung City");
  });
});
