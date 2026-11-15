import { describe, expect, it } from "vitest";
import { formatBytes, formatCount, formatMeterValue } from "./billingLabels";

describe("billing number formats", () => {
  it("uses decimal units so plan limits read as round numbers", () => {
    expect(formatBytes(1_000_000_000, "zh-TW")).toBe("1 GB");
    expect(formatBytes(5_000_000_000, "zh-TW")).toBe("5 GB");
    expect(formatBytes(50_000_000_000, "en-US")).toBe("50 GB");
    expect(formatBytes(0, "zh-TW")).toBe("0 B");
    expect(formatBytes(800_000_000, "zh-TW")).toBe("800 MB");
  });

  it("adds thousands separators and picks bytes only for storage", () => {
    expect(formatCount(10000, "en-US")).toBe("10,000");
    expect(formatMeterValue("orders.created", 10000, "en-US")).toBe("10,000");
    expect(formatMeterValue("storage.bytes", 1_000_000_000, "en-US")).toBe(
      "1 GB",
    );
  });
});
