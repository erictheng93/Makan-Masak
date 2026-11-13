import { email } from "zod/mini";

// The same check management-api applies (z.email(); zod/mini shares its regex at a fraction of the bundle size), so the form never accepts
// an address the server will reject. Validates the trimmed value, which is
// what gets sent.
const emailSchema = email();

export const isValidEmail = (value: string): boolean =>
  emailSchema.safeParse(value.trim()).success;
