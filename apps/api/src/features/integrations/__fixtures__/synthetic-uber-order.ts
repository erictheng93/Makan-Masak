/**
 * Synthetic #408 scenarios, NOT captured Uber responses or unit evidence.
 * TWD's two encodings describe the same NT$120 item (NT$100 + NT$20),
 * quantity 2. Neither encoding may be accepted before external verification.
 * MYR uses the existing sen assumption: RM12 (RM10 + RM2), quantity 2.
 */
export function syntheticUberOrder(
  currency: "MYR" | "TWD" = "MYR",
  twdEncoding: "whole" | "hundredths" = "hundredths",
) {
  const money = (amount: number, formatted: string) => ({
    amount,
    currency_code: currency,
    formatted_amount: formatted,
  });
  const unit =
    currency === "MYR" ? 1200 : twdEncoding === "whole" ? 120 : 12000;
  const base =
    currency === "MYR" ? 1000 : twdEncoding === "whole" ? 100 : 10000;
  const extra = currency === "MYR" ? 200 : twdEncoding === "whole" ? 20 : 2000;
  const display = currency === "MYR" ? "RM12.00" : "NT$120";
  const totalDisplay = currency === "MYR" ? "RM24.00" : "NT$240";
  return {
    id: `synthetic-${currency.toLowerCase()}-${twdEncoding}`,
    store: { id: "synthetic-store" },
    cart: {
      special_instructions: "Pack separately",
      items: [
        {
          id: "101",
          title: "Tea",
          quantity: 2,
          special_instructions: "No ice",
          price: {
            unit_price: money(unit, display),
            base_unit_price: money(
              base,
              currency === "MYR" ? "RM10.00" : "NT$100",
            ),
            total_price: money(unit * 2, totalDisplay),
          },
          selected_modifier_groups: [
            {
              id: "milk",
              title: "Milk",
              selected_items: [
                {
                  id: "oat",
                  title: "Oat",
                  quantity: 1,
                  price: {
                    unit_price: money(
                      extra,
                      currency === "MYR" ? "RM2.00" : "NT$20",
                    ),
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    payment: {
      charges: {
        total: money(unit * 2, totalDisplay),
        sub_total: money(unit * 2, totalDisplay),
        tax: money(0, currency === "MYR" ? "RM0.00" : "NT$0"),
      },
    },
  };
}
