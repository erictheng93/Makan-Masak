/**
 * 營運管理流程 → 食材庫存, against a real API and a real D1.
 *
 * The write path under test is the stock movement, because that is the one
 * #267 said was decorative: the ingredients page had no sidebar entry, the
 * recipe editor had zero importers, and the purchase list therefore always
 * reported "no purchase needed" regardless of stock. Both halves are fixed;
 * these tests hold them fixed.
 *
 * Ingredients themselves are created through the API rather than the form,
 * because `IngredientForm.vue` carries no test hooks at all. Driving it by
 * label would couple the spec to six locales' worth of copy for no extra
 * coverage — the interesting assertion is what the adjustment does to the
 * server, and that dialog is fully instrumented.
 */
import { expect, test } from "@playwright/test";
import {
  apiCleanup,
  apiRequest,
  assertAuthenticated,
  assertNoOverlayError,
  getOwnerContext,
  gotoAdmin,
  installAdminSession,
  POLL_TIMEOUT,
  requireStack,
  suffix,
} from "./admin-e2e";

interface Ingredient {
  id?: number;
  name?: string;
  unit?: string;
  currentStock?: number | null;
  minStockLevel?: number | null;
}

interface IngredientList {
  items?: Ingredient[];
  total?: number;
}

async function createIngredient(
  restaurantId: string,
  token: string,
  overrides: Partial<Ingredient> = {},
) {
  const result = await apiRequest<{ ingredient: Ingredient }>(
    `/api/v1/ingredients/${restaurantId}`,
    {
      token,
      method: "POST",
      body: {
        name: `E2E Ingredient ${suffix()}`,
        unit: "g",
        currentStock: 5,
        minStockLevel: 10,
        ...overrides,
      },
    },
  );
  expect(result.ok, `ingredient fixture create returned ${result.status}`).toBe(
    true,
  );
  return result.body.data!.ingredient;
}

async function readIngredient(
  restaurantId: string,
  token: string,
  id: number,
): Promise<Ingredient | undefined> {
  const list = await apiRequest<IngredientList>(
    `/api/v1/ingredients/${restaurantId}`,
    { token },
  );
  return list.body.data?.items?.find((item) => item.id === id);
}

test.describe.configure({ mode: "serial" });

test.describe("食材庫存 (real API)", () => {
  test("an ingredient below its minimum renders as low, and the filter keeps it", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await requireStack();

    const { login, token, restaurantId } = await getOwnerContext();
    const low = await createIngredient(restaurantId, token, {
      currentStock: 5,
      minStockLevel: 10,
    });
    const healthy = await createIngredient(restaurantId, token, {
      currentStock: 99,
      minStockLevel: 10,
    });

    await installAdminSession(page, login);

    try {
      await gotoAdmin(page, "/dashboard/ingredients", {
        expectApi: `/api/v1/ingredients/${restaurantId}`,
      });
      await assertAuthenticated(page);

      const lowRow = page.locator("tr").filter({ hasText: low.name! });
      const healthyRow = page.locator("tr").filter({ hasText: healthy.name! });

      // The state lives in a data attribute rather than a colour class. Low
      // stock used to be signalled by red text alone, which an owner who
      // cannot distinguish it never sees at all.
      await expect(lowRow.locator("[data-stock-state]")).toHaveAttribute(
        "data-stock-state",
        "low",
      );
      await expect(healthyRow.locator("[data-stock-state]")).toHaveAttribute(
        "data-stock-state",
        "ok",
      );

      await page.getByTestId("low-stock-filter").click();
      await expect(lowRow).toBeVisible();
      await expect(healthyRow).toHaveCount(0);

      await assertNoOverlayError(page);
    } finally {
      for (const id of [low.id, healthy.id]) {
        if (id)
          await apiCleanup(`/api/v1/ingredients/${restaurantId}/${id}`, token);
      }
    }
  });

  test("a stock movement through the dialog changes the real stock level", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await requireStack();

    const { login, token, restaurantId } = await getOwnerContext();
    const ingredient = await createIngredient(restaurantId, token, {
      currentStock: 5,
      minStockLevel: 10,
    });

    await installAdminSession(page, login);

    try {
      await gotoAdmin(page, "/dashboard/ingredients", {
        expectApi: `/api/v1/ingredients/${restaurantId}`,
      });
      await assertAuthenticated(page);

      await page.getByTestId(`adjust-stock-${ingredient.id}`).click();
      await page.getByTestId("direction-in").click();
      await page.getByTestId("movement-quantity").fill("20");
      await page.getByTestId("movement-reason").selectOption("purchase");

      const moved = page.waitForResponse(
        (response) =>
          response
            .url()
            .includes(
              `/api/v1/ingredients/${restaurantId}/${ingredient.id}/movements`,
            ) && response.request().method() === "POST",
      );
      await page.getByTestId("movement-submit").click();
      const response = await moved;
      expect(
        response.ok(),
        `stock movement returned ${response.status()}`,
      ).toBe(true);

      // 5 in, 20 added, 25 out — asserted on the server, because the dialog
      // shows its own optimistic preview.
      await expect
        .poll(
          async () =>
            (await readIngredient(restaurantId, token, ingredient.id!))
              ?.currentStock,
          { timeout: POLL_TIMEOUT },
        )
        .toBe(25);

      // And the row is no longer low, which is the fact the purchase list reads.
      const row = page.locator("tr").filter({ hasText: ingredient.name! });
      await expect(row.locator("[data-stock-state]")).toHaveAttribute(
        "data-stock-state",
        "ok",
      );

      await assertNoOverlayError(page);
    } finally {
      if (ingredient.id) {
        await apiCleanup(
          `/api/v1/ingredients/${restaurantId}/${ingredient.id}`,
          token,
        );
      }
    }
  });
});
