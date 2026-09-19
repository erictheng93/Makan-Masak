import { describe, expect, it } from "vitest";
import {
  allocateTolerant,
  computeSplitBills,
  type SplitCartItem,
  type SplitComputationInput,
  type SplitMember,
} from "./split-allocation";

const members: SplitMember[] = [
  { id: "host", role: "creator" },
  { id: "m2", role: "member" },
  { id: "m3", role: "member" },
];

function buildItem(
  memberId: string,
  totalPriceCents: number,
  overrides: Partial<SplitCartItem> = {},
): SplitCartItem {
  return {
    id: `item-${memberId}-${totalPriceCents}`,
    memberId,
    menuItemId: 1,
    quantity: 1,
    unitPriceCents: totalPriceCents,
    totalPriceCents,
    ...overrides,
  };
}

function buildInput(
  overrides: Partial<SplitComputationInput> = {},
): SplitComputationInput {
  return {
    currency: "TWD",
    splitType: "equal",
    feeMode: "proportional",
    members,
    cartItems: [buildItem("host", 10000)],
    ...overrides,
  };
}

function expectOk(result: ReturnType<typeof computeSplitBills>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
  return result.bills;
}

describe("allocateTolerant", () => {
  it("is allocateCents for an aligned total", () => {
    expect(allocateTolerant(10000, [1, 1, 1], "TWD")).toEqual([
      3400, 3300, 3300,
    ]);
  });

  it("puts a legacy sub-unit residue on the first share", () => {
    expect(allocateTolerant(1250, [1, 1], "TWD")).toEqual([650, 600]);
  });

  it("returns nothing for no weights", () => {
    expect(allocateTolerant(1000, [], "TWD")).toEqual([]);
  });
});

describe("computeSplitBills", () => {
  it("splits NT$100 three ways as 34/33/33", () => {
    const bills = expectOk(computeSplitBills(buildInput()));
    expect(bills.map((bill) => bill.subtotalCents)).toEqual([3400, 3300, 3300]);
    expect(bills.map((bill) => bill.totalCents)).toEqual([3400, 3300, 3300]);
  });

  it("keeps sen when splitting RM100 three ways", () => {
    const bills = expectOk(computeSplitBills(buildInput({ currency: "MYR" })));
    expect(bills.map((bill) => bill.subtotalCents)).toEqual([3334, 3333, 3333]);
  });

  it("rounds a TWD service charge whole, then shares it by subtotal", () => {
    // NT$155 total, 10% = NT$15.50 → NT$16, shared 100:55.
    const bills = expectOk(
      computeSplitBills(
        buildInput({
          splitType: "individual",
          members: members.slice(0, 2),
          cartItems: [buildItem("host", 10000), buildItem("m2", 5500)],
          rates: { serviceChargeRate: 0.1, taxRate: 0 },
        }),
      ),
    );
    expect(bills).toMatchObject([
      { memberId: "host", serviceChargeCents: 1000, totalCents: 11000 },
      { memberId: "m2", serviceChargeCents: 600, totalCents: 6100 },
    ]);
    expect(bills.reduce((sum, bill) => sum + bill.totalCents, 0)).toBe(17100);
  });

  it("keeps sen for an MYR service charge: RM155 + 10% = RM15.50", () => {
    const bills = expectOk(
      computeSplitBills(
        buildInput({
          currency: "MYR",
          splitType: "individual",
          members: members.slice(0, 2),
          cartItems: [buildItem("host", 10000), buildItem("m2", 5500)],
          rates: { serviceChargeRate: 0.1, taxRate: 0 },
        }),
      ),
    );
    expect(bills.map((bill) => bill.serviceChargeCents)).toEqual([1000, 550]);
  });

  it("gives per-member tax in whole units that add up to the order's", () => {
    const bills = expectOk(
      computeSplitBills(
        buildInput({
          splitType: "proportional",
          cartItems: [
            buildItem("host", 10000),
            buildItem("m2", 10000),
            buildItem("m3", 10000),
          ],
          shared: { serviceChargeCents: 0, taxCents: 1000 },
          orderTotalCents: 31000,
        }),
      ),
    );
    expect(bills.map((bill) => bill.taxCents)).toEqual([400, 300, 300]);
    expect(bills.reduce((sum, bill) => sum + bill.totalCents, 0)).toBe(31000);
  });

  it("puts every fee on the host under the host fee mode", () => {
    const bills = expectOk(
      computeSplitBills(
        buildInput({
          feeMode: "host",
          rates: { serviceChargeRate: 0.1, taxRate: 0.05 },
        }),
      ),
    );
    expect(bills.map((bill) => bill.serviceChargeCents)).toEqual([1000, 0, 0]);
    expect(bills.map((bill) => bill.taxCents)).toEqual([500, 0, 0]);
  });

  it("shares a fee in equal parts under the equal fee mode", () => {
    const bills = expectOk(
      computeSplitBills(
        buildInput({
          splitType: "individual",
          feeMode: "equal",
          cartItems: [buildItem("host", 10000)],
          shared: { serviceChargeCents: 1000, taxCents: 0 },
          orderTotalCents: 11000,
        }),
      ),
    );
    expect(bills.map((bill) => bill.serviceChargeCents)).toEqual([
      400, 300, 300,
    ]);
  });

  it("divides a custom split's fees over its own amounts", () => {
    const bills = expectOk(
      computeSplitBills(
        buildInput({
          splitType: "custom",
          customAmounts: [
            { memberId: "host", amountCents: 6000 },
            { memberId: "m3", amountCents: 4000 },
          ],
          rates: { serviceChargeRate: 0.1, taxRate: 0 },
        }),
      ),
    );
    expect(bills).toMatchObject([
      { memberId: "host", serviceChargeCents: 600, totalCents: 6600 },
      { memberId: "m3", serviceChargeCents: 400, totalCents: 4400 },
    ]);
  });

  it("refuses a custom split without amounts or with an unknown member", () => {
    expect(
      computeSplitBills(buildInput({ splitType: "custom", customAmounts: [] })),
    ).toMatchObject({ ok: false, error: expect.stringContaining("required") });
    expect(
      computeSplitBills(
        buildInput({
          splitType: "custom",
          customAmounts: [{ memberId: "ghost", amountCents: 100 }],
        }),
      ),
    ).toMatchObject({ ok: false, error: "Member ghost not found in group" });
  });

  it("refuses an unsupported split type", () => {
    expect(
      computeSplitBills(
        buildInput({
          splitType: "weird" as SplitComputationInput["splitType"],
        }),
      ),
    ).toMatchObject({ ok: false, error: "Unsupported split type: weird" });
  });

  it("puts a legacy total-rounding residue on the host's subtotal", () => {
    // A legacy NT$12.50 cart whose order total was rounded to NT$13.
    const bills = expectOk(
      computeSplitBills(
        buildInput({
          splitType: "individual",
          members: members.slice(0, 2),
          cartItems: [buildItem("m2", 1250)],
          shared: { serviceChargeCents: 0, taxCents: 0 },
          orderTotalCents: 1300,
        }),
      ),
    );
    expect(bills).toMatchObject([
      { memberId: "host", subtotalCents: 50, totalCents: 50 },
      { memberId: "m2", subtotalCents: 1250, totalCents: 1250 },
    ]);
  });

  it("falls back to the first bill when there is no host", () => {
    const bills = expectOk(
      computeSplitBills(
        buildInput({
          members: [{ id: "a" }, { id: "b" }],
          cartItems: [buildItem("a", 1250)],
          splitType: "individual",
          orderTotalCents: 1300,
        }),
      ),
    );
    expect(bills[0]).toMatchObject({ memberId: "a", totalCents: 1300 });
  });

  it("refuses a total that disagrees by more than rounding can explain", () => {
    expect(
      computeSplitBills(buildInput({ orderTotalCents: 10100 })),
    ).toMatchObject({
      ok: false,
      code: "SPLIT_TOTAL_MISMATCH",
      expectedTotalCents: 10100,
      roundedTotalCents: 10000,
    });
    expect(
      computeSplitBills(
        buildInput({ currency: "MYR", orderTotalCents: 10004 }),
      ),
    ).toMatchObject({ ok: false, code: "SPLIT_TOTAL_MISMATCH" });
  });

  it("treats missing cart prices as zero", () => {
    const bills = expectOk(
      computeSplitBills(
        buildInput({
          splitType: "individual",
          members: members.slice(0, 1),
          cartItems: [
            buildItem("host", 0, {
              totalPriceCents: null,
              unitPriceCents: null,
            }),
          ],
        }),
      ),
    );
    expect(bills[0]).toMatchObject({
      subtotalCents: 0,
      items: [{ unitPrice: 0, totalPrice: 0 }],
    });
  });
});
