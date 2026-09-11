/**
 * Service Bookings Routes (預約服務)
 *
 * Public: browse availability, create a booking, pay with 代幣, verify/cancel by
 * code. Staff/admin: list, confirm (cash), complete, no-show.
 * See docs/superpowers/specs/2026-06-03-service-reservation-system.md.
 */

import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware, requireRole } from "../../../middleware/auth";
import type { AuthUser } from "../../../middleware/auth";
import { moduleGate } from "../../../middleware/moduleGate";
import { rateLimitMiddleware } from "../../../middleware/rateLimiter";
import type { Env } from "../../../types/env";
import {
  badRequest,
  forbidden,
  notFound,
} from "../../../shared/utils/api-error";
import {
  SERVICE_BOOKING_STATUS,
  type ServiceBookingStatus,
} from "@makanmasak/database";
import {
  MAX_BATCH_SLOT_CREATION_COUNT,
  ServiceBookingService,
} from "../services/ServiceBookingService";

const app = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();

const MAX_PUBLIC_RECURRENCE_COUNT = 12;

const recurringCreateRateLimit = rateLimitMiddleware({
  windowMs: 15 * 60 * 1000,
  maxRequests: 5,
  keyPrefix: "service_booking_recurring",
  message: "Too many recurring booking requests. Please try again later.",
});

const waitlistRateLimit = rateLimitMiddleware({
  windowMs: 15 * 60 * 1000,
  maxRequests: 5,
  keyPrefix: "service_booking_waitlist",
  message: "Too many waitlist requests. Please try again later.",
});

const idString = z.preprocess((value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return value;
}, z.string().trim().min(1));

const createSchema = z.object({
  restaurantId: z.string().min(1),
  serviceItemId: z.number().int().positive(),
  customerName: z.string().min(1).max(100),
  customerPhone: z.string().min(3).max(30),
  customerEmail: z.email().optional(),
  customerId: z.string().optional(),
  bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  bookingTime: z.string().regex(/^\d{2}:\d{2}$/),
  partySize: z.number().int().positive().max(100).optional(),
  employeeId: idString.optional(),
  specialRequests: z.string().max(500).optional(),
  voucherCode: z.string().min(1).max(64).optional(),
  paymentRequirement: z.enum(["none", "deposit", "prepay"]).optional(),
  depositAmountCents: z.number().int().min(1).optional(),
  reminderOptIn: z.boolean().optional(),
  reminderMinutesBefore: z.number().int().min(5).max(10080).optional(),
});

const recurringCreateSchema = z.lazy(() =>
  createSchema.omit({ bookingDate: true }).extend({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    count: z.number().int().min(1).max(MAX_PUBLIC_RECURRENCE_COUNT),
    intervalWeeks: z.number().int().min(1).max(52).optional(),
  }),
);

const waitlistSchema = z.lazy(() =>
  createSchema
    .omit({
      voucherCode: true,
      paymentRequirement: true,
      depositAmountCents: true,
      reminderOptIn: true,
      reminderMinutesBefore: true,
    })
    .extend({
      notes: z.string().max(500).optional(),
    }),
);

const paySchema = z.lazy(() =>
  z.object({
    creditCardPublicId: z.string().min(1),
    pin: z.string().optional(),
  }),
);

const contactProofSchema = z.lazy(() =>
  z.object({
    requireContact: z.boolean().optional().default(false),
    customerPhone: z.string().min(3).max(30).optional(),
    customerEmail: z.email().optional(),
  }),
);

const dateSchema = z.lazy(() => z.string().regex(/^\d{4}-\d{2}-\d{2}$/));
const timeSlotSchema = z.lazy(() => z.string().regex(/^\d{2}:\d{2}$/));

const createSlotSchema = z.lazy(() =>
  z.object({
    restaurantId: z.string().min(1),
    serviceItemId: z.number().int().positive(),
    date: dateSchema,
    timeSlot: timeSlotSchema,
    maxCapacity: z.number().int().min(1).max(1000),
    isAvailable: z.boolean().optional().default(true),
    blockReason: z.string().max(300).optional(),
  }),
);

const batchCreateSlotsSchema = z.lazy(() =>
  z
    .object({
      restaurantId: z.string().min(1),
      serviceItemId: z.number().int().positive(),
      startDate: dateSchema,
      endDate: dateSchema,
      timeSlots: z.array(timeSlotSchema).min(1).max(96),
      maxCapacity: z.number().int().min(1).max(1000),
      isAvailable: z.boolean().optional().default(true),
    })
    .superRefine((value, ctx) => {
      const totalSlots = countBatchSlots(
        value.startDate,
        value.endDate,
        value.timeSlots.length,
      );
      if (totalSlots != null && totalSlots > MAX_BATCH_SLOT_CREATION_COUNT) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["timeSlots"],
          message: `Cannot create more than ${MAX_BATCH_SLOT_CREATION_COUNT} slots at once`,
        });
      }
    }),
);

const blockSlotSchema = z.lazy(() =>
  z.object({
    restaurantId: z.string().min(1),
    serviceItemId: z.number().int().positive(),
    date: dateSchema,
    timeSlot: timeSlotSchema,
    blockReason: z.string().max(300).optional(),
  }),
);

function countBatchSlots(
  startDate: string,
  endDate: string,
  timeSlotCount: number,
): number | null {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }
  if (start > end) return null;
  const dayCount =
    Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  return dayCount * timeSlotCount;
}

// ── Public ─────────────────────────────────────────────

app.get("/availability", async (c) => {
  const serviceItemId = Number(c.req.query("serviceItemId"));
  const date = c.req.query("date") ?? "";
  if (!Number.isInteger(serviceItemId) || serviceItemId <= 0) {
    throw badRequest("serviceItemId is required", "SERVICE_ITEM_ID_REQUIRED");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw badRequest("date (YYYY-MM-DD) is required", "DATE_REQUIRED");
  }
  const slots = await new ServiceBookingService(c.env).getAvailability({
    serviceItemId,
    date,
  });
  return c.json({ success: true, data: { slots } });
});

app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    throw badRequest(
      "Validation failed",
      "VALIDATION_ERROR",
      parsed.error.flatten().fieldErrors,
    );
  }
  const booking = await new ServiceBookingService(c.env).createBooking(
    parsed.data,
  );
  return c.json({ success: true, data: { booking } }, 201);
});

app.post("/recurring", recurringCreateRateLimit, async (c) => {
  const body = await c.req.json();
  const parsed = recurringCreateSchema.safeParse(body);
  if (!parsed.success) {
    throw badRequest(
      "Validation failed",
      "VALIDATION_ERROR",
      parsed.error.flatten().fieldErrors,
    );
  }
  const bookings = await new ServiceBookingService(
    c.env,
  ).createRecurringBookings(parsed.data);
  return c.json({ success: true, data: { bookings } }, 201);
});

app.post("/waitlist", waitlistRateLimit, async (c) => {
  const body = await c.req.json();
  const parsed = waitlistSchema.safeParse(body);
  if (!parsed.success) {
    throw badRequest(
      "Validation failed",
      "VALIDATION_ERROR",
      parsed.error.flatten().fieldErrors,
    );
  }
  const waitlistEntry = await new ServiceBookingService(c.env).joinWaitlist(
    parsed.data,
  );
  return c.json({ success: true, data: { waitlistEntry } }, 201);
});

app.post("/:id/pay", async (c) => {
  const body = await c.req.json();
  const parsed = paySchema.safeParse(body);
  if (!parsed.success) {
    throw badRequest(
      "Validation failed",
      "VALIDATION_ERROR",
      parsed.error.flatten().fieldErrors,
    );
  }
  const booking = await new ServiceBookingService(c.env).payWithCredits({
    bookingId: c.req.param("id") ?? "",
    creditCardPublicId: parsed.data.creditCardPublicId,
    pin: parsed.data.pin,
  });
  return c.json({ success: true, data: { booking } });
});

// Rate-limited: the confirmation code is the anonymous ownership credential, so
// throttle lookups to resist enumeration.
const verifyRateLimit = rateLimitMiddleware({
  windowMs: 15 * 60 * 1000,
  maxRequests: 20,
  keyPrefix: "service_booking_verify",
  message: "Too many lookups. Please try again later.",
});

app.get("/verify/:code/ics", verifyRateLimit, async (c) => {
  const parsed = contactProofSchema.safeParse({
    requireContact: parseBoolean(c.req.query("requireContact")),
    customerPhone: c.req.query("customerPhone") ?? c.req.query("phone"),
    customerEmail: c.req.query("customerEmail") ?? c.req.query("email"),
  });
  if (!parsed.success) {
    throw badRequest(
      "Validation failed",
      "VALIDATION_ERROR",
      parsed.error.flatten().fieldErrors,
    );
  }
  const ics = await new ServiceBookingService(
    c.env,
  ).generateCalendarInviteByConfirmationCode(
    c.req.param("code") ?? "",
    parsed.data,
  );
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="service-booking.ics"',
    },
  });
});

app.get("/verify/:code", verifyRateLimit, async (c) => {
  const parsed = contactProofSchema.safeParse({
    requireContact: parseBoolean(c.req.query("requireContact")),
    customerPhone: c.req.query("customerPhone") ?? c.req.query("phone"),
    customerEmail: c.req.query("customerEmail") ?? c.req.query("email"),
  });
  if (!parsed.success) {
    throw badRequest(
      "Validation failed",
      "VALIDATION_ERROR",
      parsed.error.flatten().fieldErrors,
    );
  }
  const booking = await new ServiceBookingService(c.env).getByConfirmationCode(
    c.req.param("code") ?? "",
    parsed.data,
  );
  if (!booking) throw notFound("Booking not found", "BOOKING_NOT_FOUND");
  return c.json({ success: true, data: { booking } });
});

// Public cancel proves ownership with the confirmation code (NOT the booking id,
// which would be an IDOR). Rate-limited against code enumeration.
app.post("/verify/:code/cancel", verifyRateLimit, async (c) => {
  const body = await readJsonBody(c.req);
  const parsed = contactProofSchema.safeParse({
    requireContact:
      parseBoolean(body.requireContact) ??
      parseBoolean(c.req.query("requireContact")),
    customerPhone:
      stringValue(body.customerPhone) ??
      stringValue(body.phone) ??
      c.req.query("customerPhone") ??
      c.req.query("phone"),
    customerEmail:
      stringValue(body.customerEmail) ??
      stringValue(body.email) ??
      c.req.query("customerEmail") ??
      c.req.query("email"),
  });
  if (!parsed.success) {
    throw badRequest(
      "Validation failed",
      "VALIDATION_ERROR",
      parsed.error.flatten().fieldErrors,
    );
  }
  const booking = await new ServiceBookingService(
    c.env,
  ).cancelByConfirmationCode(c.req.param("code") ?? "", parsed.data);
  return c.json({ success: true, data: { booking } });
});

// ── Staff / admin ──────────────────────────────────────

app.use("/*", authMiddleware);
app.use("/*", moduleGate("reservations"));

// Restaurant scope for staff routes: admins (role 0) are unscoped; everyone
// else is confined to their own restaurant. Without this, role gating alone
// lets any owner/crew/cashier read or mutate another restaurant's bookings
// (cross-tenant IDOR). Mirrors the reservations feature's scope checks.
function scopedRestaurantId(user: AuthUser): string | null {
  return user.restaurantId != null ? String(user.restaurantId) : null;
}

function assertRestaurantScope(user: AuthUser, restaurantId: string): void {
  const scoped = scopedRestaurantId(user);
  if (user.role !== 0 && restaurantId !== scoped) {
    throw forbidden("無權限操作此餐廳的預約");
  }
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

async function readJsonBody(req: {
  json: () => Promise<unknown>;
  header: (name: string) => string | undefined;
}): Promise<Record<string, unknown>> {
  if (!req.header("content-type")?.includes("application/json")) return {};
  const body = await req.json().catch(() => ({}));
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

async function loadBookingInScope(
  service: ServiceBookingService,
  id: string,
  user: AuthUser,
) {
  const booking = await service.getById(id); // throws notFound if missing
  if (user.role !== 0 && booking.restaurantId !== scopedRestaurantId(user)) {
    throw forbidden("無權限操作此預約");
  }
  return booking;
}

// Owner(1)/admin(0)/cashier(4) manage; service crew(3) can confirm/complete.
app.get("/slots", requireRole([0, 1]), async (c) => {
  const user = c.get("user");
  const requested = c.req.query("restaurantId") ?? "";
  const restaurantId = user.role === 0 ? requested : scopedRestaurantId(user);
  if (!restaurantId) {
    throw badRequest("restaurantId is required", "RESTAURANT_ID_REQUIRED");
  }
  if (requested) assertRestaurantScope(user, requested);

  const serviceItemId = c.req.query("serviceItemId")
    ? Number(c.req.query("serviceItemId"))
    : undefined;
  if (
    serviceItemId !== undefined &&
    (!Number.isInteger(serviceItemId) || serviceItemId <= 0)
  ) {
    throw badRequest("serviceItemId must be a positive integer");
  }

  const date = c.req.query("date") ?? undefined;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw badRequest("date must use YYYY-MM-DD", "DATE_REQUIRED");
  }

  const slots = await new ServiceBookingService(c.env).listSlots({
    restaurantId,
    serviceItemId,
    date,
  });
  return c.json({ success: true, data: { slots } });
});

app.post("/slots", requireRole([0, 1]), async (c) => {
  const parsed = createSlotSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    throw badRequest(
      "Validation failed",
      "VALIDATION_ERROR",
      parsed.error.flatten().fieldErrors,
    );
  }

  assertRestaurantScope(c.get("user"), parsed.data.restaurantId);
  const slot = await new ServiceBookingService(c.env).createSlot(parsed.data);
  return c.json({ success: true, data: { slot } }, 201);
});

app.post("/slots/batch", requireRole([0, 1]), async (c) => {
  const parsed = batchCreateSlotsSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    throw badRequest(
      "Validation failed",
      "VALIDATION_ERROR",
      parsed.error.flatten().fieldErrors,
    );
  }

  assertRestaurantScope(c.get("user"), parsed.data.restaurantId);
  const result = await new ServiceBookingService(c.env).batchCreateSlots(
    parsed.data,
  );
  return c.json({ success: true, data: result }, 201);
});

app.post("/slots/block", requireRole([0, 1]), async (c) => {
  const parsed = blockSlotSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    throw badRequest(
      "Validation failed",
      "VALIDATION_ERROR",
      parsed.error.flatten().fieldErrors,
    );
  }

  assertRestaurantScope(c.get("user"), parsed.data.restaurantId);
  const slot = await new ServiceBookingService(c.env).blockSlot(parsed.data);
  return c.json({ success: true, data: { slot } });
});

app.get("/reminders/due", requireRole([0, 1, 3, 4]), async (c) => {
  const user = c.get("user");
  const requested = c.req.query("restaurantId") ?? "";
  const restaurantId =
    user.role === 0 ? requested || undefined : scopedRestaurantId(user);
  if (requested) assertRestaurantScope(user, requested);
  const beforeRaw = c.req.query("before") ?? new Date().toISOString();
  const before = new Date(beforeRaw);
  if (Number.isNaN(before.getTime())) {
    throw badRequest("before must be an ISO datetime", "DATETIME_INVALID");
  }
  const bookings = await new ServiceBookingService(c.env).listDueReminders({
    before,
    restaurantId: restaurantId ?? undefined,
  });
  return c.json({ success: true, data: { bookings } });
});

app.post("/:id/reminder-sent", requireRole([0, 1, 3, 4]), async (c) => {
  const service = new ServiceBookingService(c.env);
  const id = c.req.param("id") ?? "";
  await loadBookingInScope(service, id, c.get("user"));
  const booking = await service.markReminderSent(id);
  return c.json({ success: true, data: { booking } });
});

app.get("/:id/ics", requireRole([0, 1, 3, 4]), async (c) => {
  const service = new ServiceBookingService(c.env);
  const id = c.req.param("id") ?? "";
  await loadBookingInScope(service, id, c.get("user"));
  const ics = await service.generateCalendarInvite(id);
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="service-booking.ics"',
    },
  });
});

app.get("/", requireRole([0, 1, 3, 4]), async (c) => {
  const user = c.get("user");
  const requested = c.req.query("restaurantId") ?? "";
  // Non-admins may only ever list their own restaurant — derive scope from the
  // token, don't trust the query param.
  const restaurantId = user.role === 0 ? requested : scopedRestaurantId(user);
  if (!restaurantId) {
    throw badRequest("restaurantId is required", "RESTAURANT_ID_REQUIRED");
  }
  if (user.role !== 0 && requested && requested !== restaurantId) {
    throw forbidden("無權限查看此餐廳的預約");
  }
  const status = c.req.query("status") as ServiceBookingStatus | undefined;
  const bookings = await new ServiceBookingService(c.env).listByRestaurant({
    restaurantId,
    date: c.req.query("date") ?? undefined,
    status:
      status && Object.values(SERVICE_BOOKING_STATUS).includes(status)
        ? status
        : undefined,
  });
  return c.json({ success: true, data: { bookings } });
});

app.get("/:id", requireRole([0, 1, 3, 4]), async (c) => {
  const service = new ServiceBookingService(c.env);
  const booking = await loadBookingInScope(
    service,
    c.req.param("id") ?? "",
    c.get("user"),
  );
  return c.json({ success: true, data: { booking } });
});

app.delete("/:id", requireRole([0, 1, 4]), async (c) => {
  const service = new ServiceBookingService(c.env);
  const id = c.req.param("id") ?? "";
  await loadBookingInScope(service, id, c.get("user"));
  const booking = await service.cancelBooking(id);
  return c.json({ success: true, data: { booking } });
});

app.post("/:id/confirm-cash", requireRole([0, 1, 4]), async (c) => {
  const service = new ServiceBookingService(c.env);
  const id = c.req.param("id") ?? "";
  await loadBookingInScope(service, id, c.get("user"));
  const booking = await service.confirmCash(id);
  return c.json({ success: true, data: { booking } });
});

app.post("/:id/complete", requireRole([0, 1, 3, 4]), async (c) => {
  const service = new ServiceBookingService(c.env);
  const id = c.req.param("id") ?? "";
  await loadBookingInScope(service, id, c.get("user"));
  const booking = await service.transition(id, "completed");
  return c.json({ success: true, data: { booking } });
});

app.post("/:id/no-show", requireRole([0, 1, 4]), async (c) => {
  const service = new ServiceBookingService(c.env);
  const id = c.req.param("id") ?? "";
  await loadBookingInScope(service, id, c.get("user"));
  const booking = await service.transition(id, "no_show");
  return c.json({ success: true, data: { booking } });
});

export default app;
