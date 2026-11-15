import { describe, expect, it } from "vitest";
import { sanitizeApiErrorDetails } from "./api-error";

describe("sanitizeApiErrorDetails", () => {
  it("redacts sensitive detail fields before API serialization", () => {
    expect(
      sanitizeApiErrorDetails({
        field: "email",
        token: "secret-token",
        nested: {
          apiKey: "secret-key",
          value: "kept",
        },
      }),
    ).toEqual({
      field: "email",
      token: "[REDACTED]",
      nested: {
        apiKey: "[REDACTED]",
        value: "kept",
      },
    });
  });

  it("keeps meterKey so a 429 names the quota that was hit", () => {
    expect(
      sanitizeApiErrorDetails({
        meterKey: "orders.created",
        dedupKey: "x",
      }),
    ).toEqual({ meterKey: "orders.created", dedupKey: "[REDACTED]" });
  });
});
