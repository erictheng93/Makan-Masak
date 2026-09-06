import { Hono } from "hono";
import {
  authMiddleware,
  requireRole,
  requireRestaurantAccess,
} from "../../../middleware/auth";
import {
  validateBody,
  validateQuery,
  validateParams,
} from "../../../middleware/validation";
import { IngredientService } from "../services/IngredientService";
import { alertIfBelowMinimum } from "../../alerts/producers";
import { RecipeService } from "../services/RecipeService";
import {
  restaurantIdParamSchema,
  ingredientIdParamSchema,
  menuItemIdParamSchema,
  createIngredientSchema,
  updateIngredientSchema,
  bulkImportSchema,
  updateStockSchema,
  adjustStockSchema,
  setRecipeSchema,
  ingredientListQuerySchema,
} from "../schemas/validation";
import { notFound, conflict } from "../../../shared/utils/api-error";
import type { AuthUser } from "../../../middleware/auth";
import type { Env } from "../../../shared/types";

const routes = new Hono<{ Bindings: Env }>();

// GET /api/v1/ingredients/:restaurantId
routes.get(
  "/:restaurantId",
  authMiddleware,
  requireRole([0, 1]),
  requireRestaurantAccess("restaurantId"),
  validateParams(restaurantIdParamSchema),
  validateQuery(ingredientListQuerySchema),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const query = c.get("validatedQuery");
    const service = new IngredientService(c.env.DB);

    const result = await service.list(restaurantId, query);

    return c.json({ success: true, data: result });
  },
);

// POST /api/v1/ingredients/:restaurantId
routes.post(
  "/:restaurantId",
  authMiddleware,
  requireRole([0, 1]),
  requireRestaurantAccess("restaurantId"),
  validateParams(restaurantIdParamSchema),
  validateBody(createIngredientSchema),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const body = c.get("validatedBody");
    const service = new IngredientService(c.env.DB);

    const ingredient = await service.create(restaurantId, body);

    return c.json({ success: true, data: { ingredient } }, 201);
  },
);

// POST /api/v1/ingredients/:restaurantId/bulk
routes.post(
  "/:restaurantId/bulk",
  authMiddleware,
  requireRole([0, 1]),
  requireRestaurantAccess("restaurantId"),
  validateParams(restaurantIdParamSchema),
  validateBody(bulkImportSchema),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const { ingredients } = c.get("validatedBody");
    const service = new IngredientService(c.env.DB);

    const result = await service.bulkImport(restaurantId, ingredients);

    return c.json({ success: true, data: result }, 201);
  },
);

// GET /api/v1/ingredients/:restaurantId/categories
routes.get(
  "/:restaurantId/categories",
  authMiddleware,
  requireRole([0, 1]),
  requireRestaurantAccess("restaurantId"),
  validateParams(restaurantIdParamSchema),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const service = new IngredientService(c.env.DB);

    const categories = await service.getCategories(restaurantId);

    return c.json({ success: true, data: { categories } });
  },
);

// GET /api/v1/ingredients/:restaurantId/recipes/missing
routes.get(
  "/:restaurantId/recipes/missing",
  authMiddleware,
  requireRole([0, 1]),
  requireRestaurantAccess("restaurantId"),
  validateParams(restaurantIdParamSchema),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const service = new RecipeService(c.env.DB);

    const menuItems = await service.getMenuItemsWithoutRecipes(restaurantId);

    return c.json({ success: true, data: { menuItems } });
  },
);

// GET /api/v1/ingredients/:restaurantId/:id
routes.get(
  "/:restaurantId/:id",
  authMiddleware,
  requireRole([0, 1]),
  requireRestaurantAccess("restaurantId"),
  validateParams(ingredientIdParamSchema),
  async (c) => {
    const { restaurantId, id } = c.get("validatedParams");
    const service = new IngredientService(c.env.DB);

    const ingredient = await service.get(restaurantId, id);
    if (!ingredient) {
      throw notFound("Ingredient not found", "INGREDIENT_NOT_FOUND");
    }

    await alertIfBelowMinimum(c.env, restaurantId, ingredient);

    return c.json({ success: true, data: { ingredient } });
  },
);

// PUT /api/v1/ingredients/:restaurantId/:id
routes.put(
  "/:restaurantId/:id",
  authMiddleware,
  requireRole([0, 1]),
  requireRestaurantAccess("restaurantId"),
  validateParams(ingredientIdParamSchema),
  validateBody(updateIngredientSchema),
  async (c) => {
    const { restaurantId, id } = c.get("validatedParams");
    const body = c.get("validatedBody");
    const service = new IngredientService(c.env.DB);

    const user: AuthUser = c.get("user");
    const ingredient = await service.update(restaurantId, id, body, user.id);
    if (!ingredient) {
      throw notFound("Ingredient not found", "INGREDIENT_NOT_FOUND");
    }

    return c.json({ success: true, data: { ingredient } });
  },
);

// PATCH /api/v1/ingredients/:restaurantId/:id/stock
routes.patch(
  "/:restaurantId/:id/stock",
  authMiddleware,
  requireRole([0, 1]),
  requireRestaurantAccess("restaurantId"),
  validateParams(ingredientIdParamSchema),
  validateBody(updateStockSchema),
  async (c) => {
    const { restaurantId, id } = c.get("validatedParams");
    const { quantity } = c.get("validatedBody");
    const user: AuthUser = c.get("user");
    const service = new IngredientService(c.env.DB);

    const updated = await service.updateStock(
      restaurantId,
      id,
      quantity,
      user.id,
    );
    if (!updated) {
      throw notFound("Ingredient not found", "INGREDIENT_NOT_FOUND");
    }

    await alertIfBelowMinimum(
      c.env,
      restaurantId,
      await service.get(restaurantId, id),
    );

    return c.json({ success: true, data: { updated: true } });
  },
);

// POST /api/v1/ingredients/:restaurantId/:id/movements
routes.post(
  "/:restaurantId/:id/movements",
  authMiddleware,
  requireRole([0, 1]),
  requireRestaurantAccess("restaurantId"),
  validateParams(ingredientIdParamSchema),
  validateBody(adjustStockSchema),
  async (c) => {
    const { restaurantId, id } = c.get("validatedParams");
    const body = c.get("validatedBody");
    const user: AuthUser = c.get("user");
    const service = new IngredientService(c.env.DB);

    const updated = await service.adjustStock(restaurantId, id, body, user.id);
    if (!updated) {
      // Either the ingredient is gone, or another adjustment landed between
      // the read and the conditional update. Both are "try again from the
      // current figure", and neither wrote anything.
      throw notFound(
        "Ingredient not found or stock changed concurrently",
        "INGREDIENT_STOCK_CONFLICT",
      );
    }

    await alertIfBelowMinimum(
      c.env,
      restaurantId,
      await service.get(restaurantId, id),
    );

    return c.json({ success: true, data: updated });
  },
);

// GET /api/v1/ingredients/:restaurantId/:id/movements
routes.get(
  "/:restaurantId/:id/movements",
  authMiddleware,
  requireRole([0, 1]),
  requireRestaurantAccess("restaurantId"),
  validateParams(ingredientIdParamSchema),
  async (c) => {
    const { restaurantId, id } = c.get("validatedParams");
    const service = new IngredientService(c.env.DB);

    const movements = await service.listMovements(restaurantId, id);

    return c.json({ success: true, data: { movements } });
  },
);

// DELETE /api/v1/ingredients/:restaurantId/:id
routes.delete(
  "/:restaurantId/:id",
  authMiddleware,
  requireRole([0, 1]),
  requireRestaurantAccess("restaurantId"),
  validateParams(ingredientIdParamSchema),
  async (c) => {
    const { restaurantId, id } = c.get("validatedParams");

    // Check if ingredient is used in any recipe
    const recipeService = new RecipeService(c.env.DB);
    const usage = await recipeService.getIngredientUsage(restaurantId, id);
    if (usage.length > 0) {
      const names = usage.map((u) => u.menuItemName).join(", ");
      throw conflict(
        `Cannot delete: ingredient is used in recipes for: ${names}`,
        "INGREDIENT_IN_USE",
      );
    }

    const service = new IngredientService(c.env.DB);
    const deleted = await service.delete(restaurantId, id);
    if (!deleted) {
      throw notFound("Ingredient not found", "INGREDIENT_NOT_FOUND");
    }

    return c.json({ success: true, data: { deleted: true } });
  },
);

// GET /api/v1/ingredients/:restaurantId/recipes/:menuItemId
routes.get(
  "/:restaurantId/recipes/:menuItemId",
  authMiddleware,
  requireRole([0, 1]),
  requireRestaurantAccess("restaurantId"),
  validateParams(menuItemIdParamSchema),
  async (c) => {
    const { restaurantId, menuItemId } = c.get("validatedParams");
    const service = new RecipeService(c.env.DB);

    const recipe = await service.getRecipe(restaurantId, menuItemId);

    return c.json({ success: true, data: { recipe } });
  },
);

// PUT /api/v1/ingredients/:restaurantId/recipes/:menuItemId
routes.put(
  "/:restaurantId/recipes/:menuItemId",
  authMiddleware,
  requireRole([0, 1]),
  requireRestaurantAccess("restaurantId"),
  validateParams(menuItemIdParamSchema),
  validateBody(setRecipeSchema),
  async (c) => {
    const { restaurantId, menuItemId } = c.get("validatedParams");
    const { ingredients } = c.get("validatedBody");
    const service = new RecipeService(c.env.DB);

    await service.setRecipe(restaurantId, menuItemId, ingredients);

    return c.json({ success: true, data: { updated: true } });
  },
);

// POST /api/v1/ingredients/:restaurantId/recipes/:menuItemId/validate
routes.post(
  "/:restaurantId/recipes/:menuItemId/validate",
  authMiddleware,
  requireRole([0, 1]),
  requireRestaurantAccess("restaurantId"),
  validateParams(menuItemIdParamSchema),
  async (c) => {
    const { restaurantId, menuItemId } = c.get("validatedParams");
    const service = new RecipeService(c.env.DB);

    const result = await service.validateRecipe(restaurantId, menuItemId);

    return c.json({ success: true, data: result });
  },
);

export default routes;
