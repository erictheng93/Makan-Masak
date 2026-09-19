/**
 * Integer-cents bill splitting for group orders.
 *
 * Everything here is cents on the restaurant currency's real precision: TWD
 * and VND shares are whole dollars, MYR shares are sen. Shares come from
 * `allocateCents` (largest remainder), so NT$100 across three diners is
 * 34/33/33 and the parts always add up to the whole — the float version this
 * replaces produced NT$33.33 shares and dumped the leftover on the host.
 */
import {
  allocateCents,
  currencyStepCents,
  floorToCurrencyCents,
  roundToCurrencyCents,
  type CurrencyCode,
} from "@makanmasak/utils";
import type {
  GroupOrderFeeMode,
  SplitBillItem,
} from "@makanmasak/shared-types";

export type SplitType =
  | "equal"
  | "proportional"
  | "individual"
  | "by_item"
  | "custom";

export interface SplitMember {
  id: string;
  role?: string | null;
}

export interface SplitCartItem {
  id: string;
  memberId: string;
  menuItemId: number;
  quantity: number;
  unitPriceCents?: number | null;
  totalPriceCents?: number | null;
}

export interface SplitComputationInput {
  currency: CurrencyCode;
  splitType: SplitType;
  feeMode: GroupOrderFeeMode;
  /** Active members, in join order (ties in allocation go to the earlier). */
  members: readonly SplitMember[];
  cartItems: readonly SplitCartItem[];
  /** Required for "custom". Amounts in cents. */
  customAmounts?: ReadonlyArray<{ memberId: string; amountCents: number }>;
  /**
   * The real order's charges, handed over at finalization. When present the
   * rates are ignored and these exact amounts are divided up.
   */
  shared?: { serviceChargeCents: number; taxCents: number };
  /** Used when `shared` is absent. Fractional: 0.1 = 10%. */
  rates?: { serviceChargeRate: number; taxRate: number };
  /** The total the bills must add up to; defaults to their own sum. */
  orderTotalCents?: number;
}

export interface SplitBillCents {
  memberId: string;
  subtotalCents: number;
  serviceChargeCents: number;
  taxCents: number;
  totalCents: number;
  items: SplitBillItem[];
}

export type SplitComputation =
  | { ok: true; bills: SplitBillCents[]; cartTotalCents: number }
  | {
      ok: false;
      error: string;
      code?: string;
      expectedTotalCents?: number;
      roundedTotalCents?: number;
    };

/**
 * `allocateCents`, tolerating a total that is off the currency step.
 *
 * Only legacy data can produce one (a TWD cart priced NT$12.50 before
 * precision was validated). The aligned part is allocated normally and the
 * sub-unit residue goes to the first share, so the parts still sum exactly.
 */
export function allocateTolerant(
  totalCents: number,
  weights: readonly number[],
  currency: CurrencyCode,
): number[] {
  if (weights.length === 0) return [];
  const aligned = floorToCurrencyCents(totalCents, currency);
  const shares = allocateCents(aligned, weights, currency);
  shares[0] += totalCents - aligned;
  return shares;
}

const cents = (value: number | null | undefined): number => value ?? 0;

export function computeSplitBills(
  input: SplitComputationInput,
): SplitComputation {
  const { currency, members, cartItems, feeMode } = input;
  const cartTotalCents = cartItems.reduce(
    (sum, item) => sum + cents(item.totalPriceCents),
    0,
  );

  // 1. Who gets a bill, and each bill's own subtotal.
  let recipients: Array<{
    member: SplitMember;
    subtotalCents: number;
    items: SplitBillItem[];
  }>;
  let feeBaseCents: number;

  if (
    input.splitType === "by_item" ||
    input.splitType === "individual" ||
    input.splitType === "proportional"
  ) {
    // "proportional" shares this branch on purpose: every shared cost the
    // system can produce (tax, service charge) is itself proportional to
    // subtotal. A cost that is not — a flat delivery fee — would have to split
    // it back out (see the note in GroupOrdersService.test.ts).
    recipients = members.map((member) => {
      const own = cartItems.filter((item) => item.memberId === member.id);
      return {
        member,
        subtotalCents: own.reduce(
          (sum, item) => sum + cents(item.totalPriceCents),
          0,
        ),
        items: own.map((item) => ({
          cartItemId: item.id,
          menuItemId: item.menuItemId,
          name: "",
          quantity: item.quantity,
          unitPrice: cents(item.unitPriceCents) / 100,
          totalPrice: cents(item.totalPriceCents) / 100,
        })),
      };
    });
    feeBaseCents = cartTotalCents;
  } else if (input.splitType === "equal") {
    const shares = allocateTolerant(
      cartTotalCents,
      members.map(() => 1),
      currency,
    );
    recipients = members.map((member, index) => ({
      member,
      subtotalCents: shares[index],
      items: [],
    }));
    feeBaseCents = cartTotalCents;
  } else if (input.splitType === "custom") {
    const customAmounts = input.customAmounts ?? [];
    if (customAmounts.length === 0) {
      return {
        ok: false,
        error: "Custom amounts are required for custom split type",
      };
    }
    recipients = [];
    for (const custom of customAmounts) {
      const member = members.find((m) => m.id === custom.memberId);
      if (!member) {
        return {
          ok: false,
          error: `Member ${custom.memberId} not found in group`,
        };
      }
      recipients.push({ member, subtotalCents: custom.amountCents, items: [] });
    }
    feeBaseCents = customAmounts.reduce(
      (sum, custom) => sum + custom.amountCents,
      0,
    );
  } else {
    return {
      ok: false,
      error: `Unsupported split type: ${String(input.splitType)}`,
    };
  }

  // 2. Each shared fee, whole, then divided according to the fee mode.
  const hostId = members.find((member) => member.role === "creator")?.id;
  const wholeFee = (sharedCents: number | undefined, rate: number) =>
    input.shared
      ? (sharedCents ?? 0)
      : roundToCurrencyCents(feeBaseCents * rate, currency);
  const divideFee = (fee: number): number[] => {
    if (feeMode === "host") {
      // Nobody but the host sees a fee; the host sees all of it.
      return recipients.map(({ member }) => (member.id === hostId ? fee : 0));
    }
    const weights =
      feeMode === "equal"
        ? recipients.map(() => 1)
        : recipients.map(({ subtotalCents }) => Math.max(subtotalCents, 0));
    return allocateTolerant(fee, weights, currency);
  };

  const serviceShares = divideFee(
    wholeFee(
      input.shared?.serviceChargeCents,
      input.rates?.serviceChargeRate ?? 0,
    ),
  );
  const taxShares = divideFee(
    wholeFee(input.shared?.taxCents, input.rates?.taxRate ?? 0),
  );

  const bills: SplitBillCents[] = recipients.map((recipient, index) => ({
    memberId: recipient.member.id,
    subtotalCents: recipient.subtotalCents,
    serviceChargeCents: serviceShares[index],
    taxCents: taxShares[index],
    totalCents:
      recipient.subtotalCents + serviceShares[index] + taxShares[index],
    items: recipient.items,
  }));

  // 3. Reconcile with the real order's total. Shares are exact, so this is
  // zero unless the order and the cart disagree — or the order is a legacy
  // one whose fractional TWD subtotal had its grand total rounded to the
  // dollar. That residue (under one unit) lands on the host's subtotal, the
  // one line not copied from the real order's charges. Anything larger means
  // the cart no longer matches the order and is refused.
  const billsTotalCents = bills.reduce((sum, bill) => sum + bill.totalCents, 0);
  const targetTotalCents = input.orderTotalCents ?? billsTotalCents;
  const remainderCents = targetTotalCents - billsTotalCents;
  const step = currencyStepCents(currency);
  const toleranceCents = step > 1 ? step / 2 : bills.length;

  if (Math.abs(remainderCents) > toleranceCents) {
    return {
      ok: false,
      error: "Split total does not match order total",
      code: "SPLIT_TOTAL_MISMATCH",
      expectedTotalCents: targetTotalCents,
      roundedTotalCents: billsTotalCents,
    };
  }

  if (remainderCents !== 0 && bills.length > 0) {
    const hostBill = bills.find((bill) => bill.memberId === hostId) ?? bills[0];
    hostBill.subtotalCents += remainderCents;
    hostBill.totalCents += remainderCents;
  }

  return { ok: true, bills, cartTotalCents };
}
