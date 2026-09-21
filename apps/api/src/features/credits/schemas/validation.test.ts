import { describe, expect, it } from "vitest";
import {
  accountingExportQuerySchema,
  freezeSchema,
  issueCardSchema,
  ledgerQuerySchema,
  onlineTopupSchema,
  setPinSchema,
  topupSchema,
} from "./validation";

describe("credits validation schemas", () => {
  it("validates card issue requests and optional PINs", () => {
    expect(
      issueCardSchema.parse({
        currency: "TWD",
        ownerCustomerId: "customer-1",
        pin: "123456",
        initialBalanceCents: 5000,
      }),
    ).toMatchObject({
      currency: "TWD",
      pin: "123456",
    });

    expect(() =>
      issueCardSchema.parse({ currency: "USD", pin: "123" }),
    ).toThrow();
  });

  it("defaults funding source and freeze status", () => {
    expect(
      topupSchema.parse({
        amountCents: 1000,
        currency: "MYR",
      }),
    ).toEqual({
      amountCents: 1000,
      currency: "MYR",
      fundingSource: "cash",
    });

    expect(freezeSchema.parse({})).toEqual({ status: "frozen" });
    expect(
      onlineTopupSchema.parse({
        amountCents: 500_000_000,
        currency: "VND",
      }),
    ).toMatchObject({ amountCents: 500_000_000, currency: "VND" });
  });

  it("validates PIN updates and coerces query numbers", () => {
    expect(setPinSchema.parse({ newPin: "9876" })).toEqual({
      newPin: "9876",
    });
    expect(ledgerQuerySchema.parse({ limit: "25", offset: "5" })).toEqual({
      limit: 25,
      offset: 5,
    });
    expect(accountingExportQuerySchema.parse({ from: "0", to: "10" })).toEqual({
      from: 0,
      to: 10,
    });

    expect(() => setPinSchema.parse({ newPin: "12ab" })).toThrow();
  });
});
