/**
 * master-user-flow 1. 顧客端 → 座位與預約流程, against a real API and a real D1.
 *
 * 候位登記 → 叫號通知 → 入座確認, and 預約服務. The third node on the chart,
 * 線上訂位 (時段 · 人數 → 訂位確認), has no customer UI at all — no view, no
 * route, no API client (#385) — so there is nothing here to drive and it is
 * deliberately not faked through the public reservation endpoints.
 */
import { expect, test } from "@playwright/test";
import {
  Cleanup,
  apiData,
  apiRequest,
  assertNoOverlayError,
  createTable,
  e2eName,
  expectNoReload,
  getOwner,
  LIVE_TIMEOUT,
  markDocument,
  NAV_TIMEOUT,
  newDinerContext,
  requireStack,
} from "./customer-e2e";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await requireStack();
});

/** A Taiwan mobile number the join form accepts (^09\d{8}$), unique per call. */
function mobileNumber(): string {
  return `09${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 100)).padStart(2, "0")}`;
}

interface WaitingTicket {
  id: string;
  queueDisplay: string;
  partiesAhead: number;
  status: string;
  customerPhone: string;
}

/** The shop's calendar date `days` from now, as the booking form writes it. */
function shopDate(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toLocaleDateString("sv-SE", {
    timeZone: "Asia/Taipei",
  });
}

test.describe("座位與預約流程 (real API)", () => {
  test("候位登記 → 叫號 → 確認已抵達, with the call arriving without a reload", async ({
    browser,
  }) => {
    const localCleanup = new Cleanup();
    const { context, page } = await newDinerContext(browser);
    try {
      const owner = await getOwner();
      const rid = owner.restaurantId;
      const table = await createTable(localCleanup);

      const cancelTicket = (id: string, phone: string) =>
        localCleanup.add(`cancel waiting ticket ${id}`, () =>
          apiRequest(`/api/v1/waiting-list/${id}`, {
            method: "DELETE",
            body: { customerPhone: phone },
          }),
        );

      // Someone already in the queue, so "parties ahead" has something to count.
      const earlierPhone = mobileNumber();
      const earlier = await apiData<WaitingTicket>(
        "earlier diner joins",
        "/api/v1/waiting-list",
        {
          method: "POST",
          body: {
            restaurantId: rid,
            customerName: e2eName("先到"),
            customerPhone: earlierPhone,
            partySize: 2,
          },
        },
      );
      cancelTicket(earlier.id, earlierPhone);

      // --- 候位登記 through the page ------------------------------------------
      await page.goto(`/r/${rid}/wait-list`);
      const name = e2eName("候位");
      const phone = mobileNumber();
      await page.getByTestId("customer-name-input").fill(name);
      await page.getByTestId("customer-phone-input").fill(phone);
      await page.getByTestId("party-size-select").selectOption("3");
      await page.getByTestId("notes-input").fill("需要兒童椅");

      const joined = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/waiting-list") &&
          response.request().method() === "POST",
      );
      await page.getByTestId("join-button").click();
      const joinResponse = await joined;
      expect(joinResponse.status(), "join waiting list").toBe(201);
      const ticketId = ((await joinResponse.json()) as { data: WaitingTicket })
        .data.id;
      cancelTicket(ticketId, phone);

      await expect(page).toHaveURL(new RegExp(`/wait-list/${ticketId}$`));

      const server = await apiData<WaitingTicket & { partySize: number }>(
        "read ticket",
        `/api/v1/waiting-list/${ticketId}`,
      );
      expect(server).toEqual(
        expect.objectContaining({
          status: "waiting",
          partySize: 3,
          customerPhone: phone,
        }),
      );
      expect(server.partiesAhead).toBeGreaterThanOrEqual(1);

      await expect(page.getByTestId("queue-number")).toHaveText(
        server.queueDisplay,
        { timeout: NAV_TIMEOUT },
      );
      await expect(page.getByTestId("ticket-status")).toHaveText("候位中");
      await expect(page.getByTestId("parties-ahead")).toHaveText(
        String(server.partiesAhead),
      );
      await expect(page.getByTestId("confirm-arrival-button")).toHaveCount(0);
      await markDocument(page);

      // --- 叫號: staff call, which needs a table to call the party to ---------
      await apiData(
        "staff calls the ticket",
        `/api/v1/waiting-list/${ticketId}/call`,
        {
          token: owner.token,
          method: "POST",
          body: { tableId: table.id },
        },
      );

      await expect(
        page.getByTestId("ticket-status"),
        "the called status should reach the open ticket page",
      ).toHaveText("已叫號", { timeout: LIVE_TIMEOUT });
      await expectNoReload(page);

      // --- 入座確認 -------------------------------------------------------------
      const confirmed = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/waiting-list/${ticketId}/confirm`) &&
          response.request().method() === "POST",
      );
      await page.getByTestId("confirm-arrival-button").click();
      expect((await confirmed).status(), "confirm arrival").toBe(200);
      await expect(page.getByTestId("ticket-status")).toHaveText("已確認抵達");

      const after = await apiData<WaitingTicket>(
        "read ticket after confirm",
        `/api/v1/waiting-list/${ticketId}`,
      );
      expect(after.status).toBe("confirmed");
      await assertNoOverlayError(page);
    } finally {
      await context.close();
      await localCleanup.run();
    }
  });

  test("預約服務: book a slot the owner opened and read the booking back", async ({
    browser,
  }) => {
    const localCleanup = new Cleanup();
    const { context, page } = await newDinerContext(browser);
    try {
      const owner = await getOwner();
      const rid = owner.restaurantId;
      const auth = { token: owner.token };

      const serviceName = e2eName("足部按摩");
      const serviceItem = await apiData<{ id: number }>(
        "create service item",
        `/api/v1/restaurants/${rid}/service-items`,
        {
          ...auth,
          method: "POST",
          body: {
            name: serviceName,
            serviceType: "general",
            requiresBooking: true,
            priceCents: 30_000,
            durationMinutes: 45,
          },
        },
      );
      localCleanup.add(`delete service item ${serviceItem.id}`, () =>
        apiRequest(
          `/api/v1/restaurants/${rid}/service-items/${serviceItem.id}`,
          {
            ...auth,
            method: "DELETE",
          },
        ),
      );

      // A date a few days out, in the shop's timezone, so the slots are
      // neither in the past nor dependent on what "today" is in UTC.
      const date = shopDate(3);
      await apiData("open slots", "/api/v1/service-bookings/slots/batch", {
        ...auth,
        method: "POST",
        body: {
          restaurantId: rid,
          serviceItemId: serviceItem.id,
          startDate: date,
          endDate: date,
          timeSlots: ["14:00", "15:30"],
          maxCapacity: 2,
        },
      });

      await page.goto(`/restaurant/${rid}/services/${serviceItem.id}/book`);
      await expect(
        page.getByTestId("service-booking-service-summary"),
      ).toContainText(serviceName, { timeout: NAV_TIMEOUT });

      const slotsLoaded = page.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/service-bookings/availability") &&
          response.url().includes(`date=${date}`),
      );
      await page.getByTestId("service-booking-date").fill(date);
      await page.getByTestId("service-booking-load-slots").click();
      await slotsLoaded;
      const slots = page.getByTestId("service-booking-slot");
      await expect(slots).toHaveCount(2);
      await slots.filter({ hasText: "15:30" }).click();

      const customerName = e2eName("預約人");
      const phone = mobileNumber();
      await page.getByTestId("service-booking-name").fill(customerName);
      await page.getByTestId("service-booking-phone").fill(phone);
      await page.getByTestId("service-booking-party-size").fill("2");
      await page.getByTestId("service-booking-requests").fill("怕癢");

      const created = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/service-bookings") &&
          response.request().method() === "POST",
      );
      await page.getByTestId("service-booking-create").click();
      const response = await created;
      expect(response.status(), "create booking").toBe(201);
      const booking = (
        (await response.json()) as {
          data: { booking: { id: string; confirmationCode: string } };
        }
      ).data.booking;
      localCleanup.add(`cancel booking ${booking.id}`, () =>
        apiRequest(`/api/v1/service-bookings/${booking.id}`, {
          ...auth,
          method: "DELETE",
        }),
      );

      const confirmation = page.getByTestId("service-booking-confirmation");
      await expect(confirmation).toContainText("預約已建立");
      await expect(confirmation).toContainText(booking.confirmationCode);

      const stored = await apiData<{
        booking: Record<string, unknown>;
      }>("read booking", `/api/v1/service-bookings/${booking.id}`, auth);
      expect(stored.booking).toEqual(
        expect.objectContaining({
          serviceItemId: serviceItem.id,
          bookingDate: date,
          bookingTime: "15:30",
          customerName,
          customerPhone: phone,
          partySize: 2,
          specialRequests: "怕癢",
          confirmationCode: booking.confirmationCode,
        }),
      );

      // The booking took one of the slot's two places.
      const availability = await apiData<{
        slots: Array<{ timeSlot: string; remaining: number | null }>;
      }>(
        "read availability",
        `/api/v1/service-bookings/availability?serviceItemId=${serviceItem.id}&date=${date}`,
      );
      expect(
        availability.slots.find((slot) => slot.timeSlot === "15:30")?.remaining,
      ).toBe(1);
      await assertNoOverlayError(page);
    } finally {
      await context.close();
      await localCleanup.run();
    }
  });
});
