/**
 * AI Analytics Routes
 * API endpoints for AI-powered business analytics
 */

import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../../../types/env";
import { AIAnalyticsService } from "../services/AIAnalyticsService";
import {
  configureAISchema,
  testProviderSchema,
  generateAnalyticsSchema,
  productQuerySchema,
  usageQuerySchema,
} from "../schemas/validation";
import { validateBody, validateQuery } from "../../../middleware/validation";
import { moduleGate } from "../../../middleware/moduleGate";
import { quotaGate } from "../../../middleware/quotaGate";
import { meterEmit } from "../../../shared/utils/meter";
import { forbidden, badRequest } from "../../../shared/utils/api-error";
import { encryptionSettings } from "../../../shared/utils/encryption";

type AiAnalyticsEnv = {
  Bindings: Env;
  Variables: {
    user: { id: number; username: string; role: number; restaurantId: string };
  };
};

const routes = new Hono<AiAnalyticsEnv>();

function assertRestaurantScope(
  user: AiAnalyticsEnv["Variables"]["user"],
  restaurantId: string,
) {
  if (user.role === 0) {
    return;
  }

  if (String(user.restaurantId) !== restaurantId) {
    throw forbidden("Cannot access AI analytics for another restaurant");
  }
}

async function trackAiRequest<E extends { Bindings: Env }>(c: Context<E>) {
  await meterEmit(c, "ai.requests");
}

/**
 * GET /config/:restaurantId
 * Get AI configuration for a restaurant
 */
routes.get(
  "/config/:restaurantId",
  moduleGate("ai_analytics"),
  quotaGate("ai.requests"),
  async (c) => {
    await trackAiRequest(c);
    const restaurantId = c.req.param("restaurantId");
    if (!restaurantId)
      throw badRequest("Missing restaurantId parameter", "MISSING_PARAM");
    const user = c.get("user");
    const userRole = user.role;

    // Check permissions (Admin or Owner only)
    if (userRole !== 0 && userRole !== 1) {
      throw forbidden("Unauthorized");
    }
    assertRestaurantScope(user, restaurantId);

    const service = new AIAnalyticsService(c.env.DB, encryptionSettings(c.env));
    const config = await service.getConfig(restaurantId);

    if (!config) {
      return c.json({
        success: true,
        config: null,
        availableProviders: [
          "anthropic",
          "openai",
          "google",
          "deepseek",
          "custom",
        ],
      });
    }

    return c.json({
      success: true,
      config: {
        ...config,
        apiKeyEncrypted: "***", // Never return actual API key
      },
    });
  },
);

/**
 * POST /config
 * Configure AI provider for a restaurant
 */
routes.post(
  "/config",
  moduleGate("ai_analytics"),
  quotaGate("ai.requests"),
  validateBody(configureAISchema),
  async (c) => {
    await trackAiRequest(c);
    const data = c.get("validatedBody");
    const user = c.get("user");
    const userRole = user.role;

    // Check permissions
    if (userRole !== 0 && userRole !== 1) {
      throw forbidden("Unauthorized");
    }
    assertRestaurantScope(user, data.restaurantId);

    const service = new AIAnalyticsService(c.env.DB, encryptionSettings(c.env));

    // Test the provider first
    const testResult = await service.testProvider({
      provider: data.provider,
      apiKey: data.apiKey,
      model: data.model,
      baseUrl: data.customBaseUrl,
    });

    if (!testResult.success) {
      throw badRequest(`Provider test failed: ${testResult.error}`);
    }

    await service.saveConfig(data);

    return c.json({
      success: true,
      message: "AI configuration saved successfully",
      testResult: {
        latency: testResult.latencyMs,
        model: testResult.model,
      },
    });
  },
);

/**
 * POST /test-provider
 * Test an AI provider configuration
 */
routes.post(
  "/test-provider",
  moduleGate("ai_analytics"),
  quotaGate("ai.requests"),
  validateBody(testProviderSchema),
  async (c) => {
    await trackAiRequest(c);
    const data = c.get("validatedBody");
    const service = new AIAnalyticsService(c.env.DB, encryptionSettings(c.env));
    const result = await service.testProvider(data);
    return c.json(result);
  },
);

/**
 * GET /models/:provider
 * Get available models for a provider
 */
routes.get("/models/:provider", moduleGate("ai_analytics"), (c) => {
  const provider = c.req.param("provider");
  if (!provider)
    throw badRequest("Missing provider parameter", "MISSING_PARAM");
  const models = AIAnalyticsService.getAvailableModels(provider);
  const defaultModel = AIAnalyticsService.getDefaultModel(provider);

  return c.json({
    success: true,
    provider,
    models,
    defaultModel,
  });
});

/**
 * POST /generate
 * Generate AI analytics report
 */
routes.post(
  "/generate",
  moduleGate("ai_analytics"),
  quotaGate("ai.requests"),
  validateBody(generateAnalyticsSchema),
  async (c) => {
    await trackAiRequest(c);
    const data = c.get("validatedBody");
    const user = c.get("user");
    const userRole = user.role;

    // Check permissions
    if (userRole !== 0 && userRole !== 1) {
      throw forbidden("Unauthorized");
    }
    assertRestaurantScope(user, data.restaurantId);

    const service = new AIAnalyticsService(c.env.DB, encryptionSettings(c.env));
    const report = await service.generateReport(
      data.restaurantId,
      data.timeRange,
      {
        includeForecasting: data.includeForecasting,
        refreshCache: data.refreshCache,
      },
    );

    return c.json({
      success: true,
      report,
      cached: false,
    });
  },
);

/**
 * GET /products/traffic-drivers/:restaurantId
 * Get traffic driver products
 */
routes.get(
  "/products/traffic-drivers/:restaurantId",
  moduleGate("ai_analytics"),
  quotaGate("ai.requests"),
  validateQuery(productQuerySchema),
  async (c) => {
    await trackAiRequest(c);
    const restaurantId = c.req.param("restaurantId");
    if (!restaurantId)
      throw badRequest("Missing restaurantId parameter", "MISSING_PARAM");
    assertRestaurantScope(c.get("user"), restaurantId);
    const { timeRange, limit } = c.get("validatedQuery");

    const service = new AIAnalyticsService(c.env.DB, encryptionSettings(c.env));
    const products = await service.getTrafficDrivers(
      restaurantId,
      {
        range: timeRange as
          | "7d"
          | "14d"
          | "30d"
          | "90d"
          | "180d"
          | "1y"
          | "custom",
      },
      limit,
    );

    return c.json({ success: true, products });
  },
);

/**
 * GET /products/bestsellers/:restaurantId
 * Get bestselling products
 */
routes.get(
  "/products/bestsellers/:restaurantId",
  moduleGate("ai_analytics"),
  quotaGate("ai.requests"),
  validateQuery(productQuerySchema),
  async (c) => {
    await trackAiRequest(c);
    const restaurantId = c.req.param("restaurantId");
    if (!restaurantId)
      throw badRequest("Missing restaurantId parameter", "MISSING_PARAM");
    assertRestaurantScope(c.get("user"), restaurantId);
    const { timeRange, limit } = c.get("validatedQuery");

    const service = new AIAnalyticsService(c.env.DB, encryptionSettings(c.env));
    const products = await service.getBestsellers(
      restaurantId,
      {
        range: timeRange as
          | "7d"
          | "14d"
          | "30d"
          | "90d"
          | "180d"
          | "1y"
          | "custom",
      },
      limit,
    );

    return c.json({ success: true, products });
  },
);

/**
 * GET /products/profit-leaders/:restaurantId
 * Get profit leader products
 */
routes.get(
  "/products/profit-leaders/:restaurantId",
  moduleGate("ai_analytics"),
  quotaGate("ai.requests"),
  validateQuery(productQuerySchema),
  async (c) => {
    await trackAiRequest(c);
    const restaurantId = c.req.param("restaurantId");
    if (!restaurantId)
      throw badRequest("Missing restaurantId parameter", "MISSING_PARAM");
    assertRestaurantScope(c.get("user"), restaurantId);
    const { timeRange, limit } = c.get("validatedQuery");

    const service = new AIAnalyticsService(c.env.DB, encryptionSettings(c.env));
    const products = await service.getProfitLeaders(
      restaurantId,
      {
        range: timeRange as
          | "7d"
          | "14d"
          | "30d"
          | "90d"
          | "180d"
          | "1y"
          | "custom",
      },
      limit,
    );

    return c.json({ success: true, products });
  },
);

/**
 * GET /products/analysis/:restaurantId
 * Get comprehensive product analysis
 */
routes.get(
  "/products/analysis/:restaurantId",
  moduleGate("ai_analytics"),
  quotaGate("ai.requests"),
  validateQuery(productQuerySchema),
  async (c) => {
    await trackAiRequest(c);
    const restaurantId = c.req.param("restaurantId");
    if (!restaurantId)
      throw badRequest("Missing restaurantId parameter", "MISSING_PARAM");
    assertRestaurantScope(c.get("user"), restaurantId);
    const { timeRange } = c.get("validatedQuery");

    const service = new AIAnalyticsService(c.env.DB, encryptionSettings(c.env));
    const products = await service.analyzeProducts(restaurantId, {
      range: timeRange as
        | "7d"
        | "14d"
        | "30d"
        | "90d"
        | "180d"
        | "1y"
        | "custom",
    });

    return c.json({ success: true, products });
  },
);

/**
 * GET /usage/:restaurantId
 * Get AI usage statistics
 */
routes.get(
  "/usage/:restaurantId",
  moduleGate("ai_analytics"),
  quotaGate("ai.requests"),
  validateQuery(usageQuerySchema),
  async (c) => {
    await trackAiRequest(c);
    const restaurantId = c.req.param("restaurantId");
    if (!restaurantId)
      throw badRequest("Missing restaurantId parameter", "MISSING_PARAM");
    assertRestaurantScope(c.get("user"), restaurantId);
    const { startDate, endDate } = c.get("validatedQuery");

    const service = new AIAnalyticsService(c.env.DB, encryptionSettings(c.env));
    const usage = await service.getUsageStats(restaurantId, startDate, endDate);

    return c.json({
      success: true,
      usage,
    });
  },
);

export default routes;
