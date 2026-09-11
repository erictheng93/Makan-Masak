import { describe, expect, it, vi } from "vitest";
import { CustomerWebPushService } from "./CustomerWebPushService";

describe("CustomerWebPushService", () => {
  it("does not load or deliver subscriptions when web push is disabled", async () => {
    const d1 = { prepare: vi.fn() };
    const service = new CustomerWebPushService(d1 as never, {
      JWT_SECRET: "test",
      WEB_PUSH_ENABLED: "false",
    });

    await expect(
      service.sendWaitingCalled({ customerId: "customer-1" } as never),
    ).resolves.toEqual({
      targeted: 0,
      sent: 0,
      failed: 0,
      stale: 0,
      skipped: true,
    });
    expect(d1.prepare).not.toHaveBeenCalled();
  });

  describe("deliverToSubscription", () => {
    function createEnv(deliverer: ReturnType<typeof vi.fn>) {
      return {
        JWT_SECRET: "test",
        WEB_PUSH_DELIVERER: deliverer,
      } as never;
    }

    function createD1() {
      const statements: string[] = [];
      const d1 = {
        statements,
        prepare: vi.fn((sql: string) => {
          statements.push(sql);
          const statement = {
            bind: vi.fn(() => statement),
            run: vi.fn(async () => ({ success: true, meta: {} })),
            all: vi.fn(async () => ({ results: [], meta: {} })),
            first: vi.fn(async () => null),
            raw: vi.fn(async () => []),
          };
          return statement;
        }),
      };
      return d1;
    }

    const SUBSCRIPTION = {
      id: "sub-1",
      endpoint: "https://push.example.com/sub-1",
      p256dhKey: "p256dh",
      authKey: "auth",
    };

    it("clears the failure count after a delivery the push service accepted", async () => {
      const deliverer = vi.fn(async () => ({ ok: true, status: 201 }));
      const d1 = createD1();
      const service = new CustomerWebPushService(
        d1 as never,
        createEnv(deliverer),
      );

      await expect(
        service.deliverToSubscription(SUBSCRIPTION, { type: "x" }),
      ).resolves.toEqual({ ok: true, status: 201 });

      expect(deliverer).toHaveBeenCalledWith(
        expect.objectContaining({
          subscription: expect.objectContaining({ id: "sub-1" }),
          payload: { type: "x" },
        }),
      );
      expect(d1.statements.join(" ")).toContain("failure_count = 0");
    });

    it("counts a 410 as a failure rather than deleting the subscription", async () => {
      const deliverer = vi.fn(async () => ({ ok: false, status: 410 }));
      const d1 = createD1();
      const service = new CustomerWebPushService(
        d1 as never,
        createEnv(deliverer),
      );

      await expect(
        service.deliverToSubscription(SUBSCRIPTION, { type: "x" }),
      ).resolves.toEqual({ ok: false, status: 410 });

      const sql = d1.statements.join(" ");
      // Three strikes takes it out of every load query; the 90-day prune
      // removes it later. A push service can 410 an endpoint a later
      // re-subscribe revives.
      expect(sql).toContain("failure_count = failure_count + 1");
      expect(sql).not.toContain("DELETE");
    });

    it("reports a thrown transport error as status 0, still counting it", async () => {
      const deliverer = vi.fn(async () => {
        throw new Error("network down");
      });
      const d1 = createD1();
      const service = new CustomerWebPushService(
        d1 as never,
        createEnv(deliverer),
      );
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await expect(
        service.deliverToSubscription(SUBSCRIPTION, { type: "x" }),
      ).resolves.toEqual({ ok: false, status: 0 });
      expect(d1.statements.join(" ")).toContain(
        "failure_count = failure_count + 1",
      );
      consoleError.mockRestore();
    });
  });
});
