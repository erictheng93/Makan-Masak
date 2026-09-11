import { z } from "zod";

const sanitizeFreeText = (input: string): string =>
  input.replace(/[<>"`=]/g, "");

const notesSchema = (maxLength: number) =>
  z.string().max(maxLength).transform(sanitizeFreeText);

const selectedCustomizationsSchema = z
  .object({
    size: z
      .object({
        id: z.string(),
        name: z.string(),
        priceAdjustment: z.number().optional(),
      })
      .optional(),
    options: z
      .array(
        z.object({
          id: z.string(),
          optionName: z.string(),
          choiceId: z.string(),
          choiceName: z.string(),
          priceAdjustment: z.number().optional(),
        }),
      )
      .optional(),
    addOns: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          unitPrice: z.number().positive(),
          quantity: z.number().int().positive(),
          totalPrice: z.number().positive(),
        }),
      )
      .optional(),
    specialInstructions: notesSchema(200).optional(),
  })
  .optional();

const marketCheckoutVendorItemSchema = z.lazy(() =>
  z.object({
    menuItemId: z.number().int().positive(),
    quantity: z.number().int().positive().max(99),
    customizations: selectedCustomizationsSchema,
    notes: notesSchema(200).optional(),
  }),
);

const marketCheckoutVendorSchema = z.lazy(() =>
  z.object({
    restaurantId: z.string().min(1),
    items: z.array(marketCheckoutVendorItemSchema).min(1).max(20),
    notes: notesSchema(500).optional(),
    clientMutationId: z.string().max(100).optional(),
  }),
);

export const createMarketCheckoutSchema = z.lazy(() =>
  z.object({
    marketSlug: z.string().min(1).max(120),
    guestName: z.string().max(50).default("Guest"),
    // The credential POST /:id/guest-token compares against when a customer has
    // lost their guest token. Optional but never defaulted: a default would mint
    // the same credential for every checkout that omitted the field, and a value
    // the customer never chose is one anybody can supply. Absent instead stores
    // nothing, and the recovery endpoint already fails closed on a session with
    // no digits — the checkout still completes, it just has no recovery path.
    phoneLastDigits: z
      .string()
      .regex(/^\d{3}$/, "Must be exactly 3 digits")
      .optional(),
    vendors: z.array(marketCheckoutVendorSchema).min(2).max(20),
    notes: notesSchema(500).optional(),
  }),
);

export type CreateMarketCheckoutInput = z.infer<
  typeof createMarketCheckoutSchema
>;
