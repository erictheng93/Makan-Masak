import { afterEach, describe, expect, it, vi } from "vitest";

const meterEmit = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("./shared/utils/meter", () => ({ meterEmit }));

import { createApp } from "./app-factory";
import { ApiError } from "./shared/utils/api-error";

/**
 * `ApiError.details` is serialized into the response body. On a 4xx that is
 * the point — it names the field or the amount the caller has to change. On a
 * 5xx there is nothing for them to change, and the payload describes our side:
 * `RESTAURANT_CURRENCY_INVALID` attached the restaurant's internal id, and a
 * mixed-currency checkout attached a restaurantId → currency map, which is a
 * readout of other tenants' configuration.
 */
async function fetchThrowing(error: unknown) {
  const app = createApp(undefined, {
    disableEdgeCache: true,
    disableObservability: true,
  });
  // Registered after createApp, so the app's own `onError` still formats it.
  app.get("/__test/boom", () => {
    throw error;
  });
  return app.fetch(
    new Request("https://api.test/__test/boom", {
      headers: { Host: "api.test" },
    }),
    { NODE_ENV: "test" } as never,
  );
}

describe("ApiError details in the error envelope", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("serves details on a 4xx", async () => {
    const response = await fetchThrowing(
      new ApiError("CURRENCY_PRECISION", "Amounts must be whole", 400, {
        currency: "TWD",
        fields: [{ field: "price", amount: 12.5 }],
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: {
        code: "CURRENCY_PRECISION",
        details: {
          currency: "TWD",
          fields: [{ field: "price", amount: 12.5 }],
        },
      },
    });
  });

  it("withholds details on a 5xx", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await fetchThrowing(
      new ApiError(
        "RESTAURANT_CURRENCY_INVALID",
        "Restaurant currency is not configured correctly",
        500,
        { restaurantId: "restaurant-secret-id" },
      ),
    );

    expect(response.status).toBe(500);
    const body = (await response.json()) as {
      error: { code: string; details?: unknown };
    };
    expect(body.error.code).toBe("RESTAURANT_CURRENCY_INVALID");
    expect(body.error).not.toHaveProperty("details");
    expect(JSON.stringify(body)).not.toContain("restaurant-secret-id");
  });
});
