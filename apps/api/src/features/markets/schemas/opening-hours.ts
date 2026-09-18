import { z } from "zod";

const clockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (00:00–23:59)");
const dayHours = z.union([
  z
    .object({
      closed: z.literal(true),
      open: clockTime.default("00:00"),
      close: clockTime.default("00:00"),
    })
    .strict(),
  z
    .object({
      open: clockTime,
      close: clockTime,
      closed: z.literal(false).optional(),
    })
    .strict(),
]);

// Both spellings are already used by market clients. An enum-backed record
// would require every weekday in Zod 4; partialRecord also permits draft hours.
export const marketOpeningHoursSchema = z.partialRecord(
  z.enum([
    "mon",
    "tue",
    "wed",
    "thu",
    "fri",
    "sat",
    "sun",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ]),
  dayHours,
);
