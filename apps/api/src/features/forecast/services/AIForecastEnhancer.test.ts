import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { IngredientForecastItem } from "@makanmasak/shared-types";
import { AIForecastEnhancer } from "./AIForecastEnhancer";
import type { EncryptionSettings } from "../../../shared/utils/encryption";
import { createProvider } from "@makanmasak/ai-analytics";

const chat = vi.hoisted(() => vi.fn());

vi.mock("@makanmasak/ai-analytics", () => ({
  createProvider: vi.fn(() => ({ chat })),
}));

function createForecast(
  overrides: Partial<IngredientForecastItem> = {},
): IngredientForecastItem {
  return {
    ingredientId: 1,
    ingredientName: "Rice",
    unit: "kg",
    predictedQuantity: 10,
    confidence: 0.8,
    contributingItems: [],
    currentStock: 6,
    ...overrides,
  };
}

/**
 * The weak-key guard is production-only, so unit tests keep the short
 * placeholder key and opt out explicitly. `AIForecastEnhancer.production.test.ts`
 * covers the opted-in direction.
 */
function encryption(overrides: Partial<EncryptionSettings> = {}) {
  return { key: "encryption-key", requireStrongKey: false, ...overrides };
}

function createDb(config: unknown) {
  const first = vi.fn(async () => config);
  const bind = vi.fn(() => ({ first }));
  const prepare = vi.fn(() => ({ bind }));

  return {
    db: { prepare } as unknown as D1Database,
    prepare,
    bind,
    first,
  };
}

describe("AIForecastEnhancer", () => {
  // The fixtures store the API key as legacy base64, so every decrypt warns.
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(createProvider).mockClear();
    chat.mockReset();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("returns statistical forecasts unchanged when AI is not configured", async () => {
    const { db, prepare } = createDb(null);
    const service = new AIForecastEnhancer(db, encryption());
    const forecasts = [createForecast()];

    await expect(
      service.enhancePredictions("restaurant-1", forecasts, {
        startDate: "2026-06-08",
        endDate: "2026-06-09",
      }),
    ).resolves.toEqual({
      enhancedForecasts: forecasts,
      recommendations: [],
      adjustmentReasons: {},
    });

    expect(prepare).toHaveBeenCalledWith(
      "SELECT provider, api_key_encrypted, model, custom_base_url FROM ai_configurations WHERE restaurant_id = ? AND enabled = 1 LIMIT 1",
    );
    expect(createProvider).not.toHaveBeenCalled();
  });

  it("decrypts legacy API keys and applies clamped LLM forecast adjustments", async () => {
    const { db, bind } = createDb({
      provider: "openai",
      api_key_encrypted: "c2stdGVzdA==",
      model: "gpt-test",
      custom_base_url: "https://llm.test",
    });
    chat.mockResolvedValue({
      content: `Here is the plan:
\`\`\`json
{
  "adjustments": [
    { "ingredientId": 1, "adjustmentFactor": 2.5, "reason": "event demand" },
    { "ingredientId": 2, "adjustmentFactor": 0.25, "reason": "rain slowdown" }
  ],
  "recommendations": ["r1", "r2", "r3", "r4", "r5", "r6"]
}
\`\`\``,
    });
    const service = new AIForecastEnhancer(db, encryption());
    const forecasts = [
      createForecast({
        ingredientId: 1,
        predictedQuantity: 10,
        currentStock: 8,
      }),
      createForecast({
        ingredientId: 2,
        ingredientName: "Chicken",
        predictedQuantity: 10,
        currentStock: 12,
      }),
      createForecast({
        ingredientId: 3,
        ingredientName: "Tea",
        predictedQuantity: 5,
        currentStock: undefined,
      }),
    ];

    const result = await service.enhancePredictions("restaurant-1", forecasts, {
      startDate: "2026-06-13",
      endDate: "2026-06-14",
    });

    expect(bind).toHaveBeenCalledWith("restaurant-1");
    expect(createProvider).toHaveBeenCalledWith({
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-test",
      baseUrl: "https://llm.test",
    });
    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("Rice"),
        systemPrompt: expect.any(String),
        maxTokens: 2000,
        temperature: 0.3,
        responseFormat: "json",
      }),
    );
    expect(result).toEqual({
      enhancedForecasts: [
        expect.objectContaining({
          ingredientId: 1,
          predictedQuantity: 20,
          gap: 12,
        }),
        expect.objectContaining({
          ingredientId: 2,
          predictedQuantity: 5,
          gap: undefined,
        }),
        forecasts[2],
      ],
      recommendations: ["r1", "r2", "r3", "r4", "r5"],
      adjustmentReasons: {
        1: "event demand",
        2: "rain slowdown",
      },
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("legacy base64"),
    );
  });

  it("treats malformed LLM output as no-op AI enhancement", async () => {
    const { db } = createDb({
      provider: "anthropic",
      api_key_encrypted: "YW50aHJvcGljLWtleQ==",
      model: null,
      custom_base_url: null,
    });
    chat.mockResolvedValue({ content: "no json here" });
    const forecasts = [createForecast({ predictedQuantity: 12 })];

    const result = await new AIForecastEnhancer(
      db,
      encryption(),
    ).enhancePredictions("restaurant-1", forecasts, {
      startDate: "2026-06-08",
      endDate: "2026-06-09",
    });

    expect(createProvider).toHaveBeenCalledWith({
      provider: "anthropic",
      apiKey: "anthropic-key",
      model: undefined,
      baseUrl: undefined,
    });
    expect(result).toEqual({
      enhancedForecasts: forecasts,
      recommendations: [],
      adjustmentReasons: {},
    });
  });

  it("gracefully returns original forecasts when provider calls fail", async () => {
    const { db } = createDb({
      provider: "openai",
      api_key_encrypted: "c2stdGVzdA==",
      model: "gpt-test",
      custom_base_url: null,
    });
    chat.mockRejectedValue(new Error("llm unavailable"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const forecasts = [createForecast({ predictedQuantity: 8 })];

    await expect(
      new AIForecastEnhancer(db, encryption()).enhancePredictions(
        "restaurant-1",
        forecasts,
        {
          startDate: "2026-06-08",
          endDate: "2026-06-09",
        },
      ),
    ).resolves.toEqual({
      enhancedForecasts: forecasts,
      recommendations: [],
      adjustmentReasons: {},
    });

    expect(consoleError).toHaveBeenCalledWith(
      "[AIForecastEnhancer] AI enhancement failed:",
      expect.any(Error),
    );
    consoleError.mockRestore();
  });

  it("refuses to decrypt a stored API key in production without ENCRYPTION_KEY", async () => {
    // The decrypt happens before enhancePredictions' try/catch, so the refusal
    // surfaces instead of being swallowed by the graceful-degradation path.
    const { db } = createDb({
      provider: "openai",
      api_key_encrypted: "aXYtYmFzZTY0:Y3QtYmFzZTY0",
      model: null,
      custom_base_url: null,
    });
    const service = new AIForecastEnhancer(
      db,
      encryption({ key: "", requireStrongKey: true }),
    );

    await expect(
      service.enhancePredictions("restaurant-1", [createForecast()], {
        startDate: "2026-06-08",
        endDate: "2026-06-09",
      }),
    ).rejects.toThrow(/ENCRYPTION_KEY/);
    expect(createProvider).not.toHaveBeenCalled();
  });

  it("keeps decrypting with the short fixture key outside production", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { db } = createDb({
      provider: "openai",
      api_key_encrypted: btoa("sk-test"),
      model: null,
      custom_base_url: null,
    });
    chat.mockResolvedValue({
      content: JSON.stringify({ adjustments: [], recommendations: [] }),
    });

    await expect(
      new AIForecastEnhancer(db, encryption()).enhancePredictions(
        "restaurant-1",
        [createForecast()],
        { startDate: "2026-06-08", endDate: "2026-06-09" },
      ),
    ).resolves.toEqual(
      expect.objectContaining({ recommendations: [], adjustmentReasons: {} }),
    );
    expect(createProvider).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "openai", apiKey: "sk-test" }),
    );

    warn.mockRestore();
  });

  it("builds prompts from only the top thirty forecasts", () => {
    const service = new AIForecastEnhancer({} as D1Database, encryption());
    const forecasts = Array.from({ length: 31 }, (_, index) =>
      createForecast({
        ingredientId: index + 1,
        ingredientName: `Ingredient ${index + 1}`,
        predictedQuantity: index + 1,
        currentStock: index,
      }),
    );

    const prompt = service.buildPrompt(
      forecasts,
      { startDate: "2026-06-08", endDate: "2026-06-09" },
      ["holiday context"],
    );

    expect(prompt).toContain("2026-06-08");
    expect(prompt).toContain("2026-06-09");
    expect(prompt).toContain("Ingredient 1");
    expect(prompt).toContain("Ingredient 30");
    expect(prompt).not.toContain("Ingredient 31");
    expect(prompt).toContain("ID:30");
  });

  it("adds contextual markers for weekends, fixed holidays, lunar periods, and seasons", () => {
    const service = new AIForecastEnhancer({} as D1Database, encryption());

    expect(service.getHolidayContext("2026-01-01")).toHaveLength(3);
    expect(service.getHolidayContext("2026-06-13")).toHaveLength(3);
    expect(service.getHolidayContext("2026-09-15")).toHaveLength(1);
    expect(service.getHolidayContext("2026-03-10")).toEqual([]);
  });

  describe("on a host west of Greenwich", () => {
    // `getHolidayContext` takes a business-date string, and
    // `new Date("2026-01-01")` parses it at UTC midnight. Reading that instant
    // back with getMonth/getDate/getDay uses the host timezone, so every field
    // slips to the previous day at a negative offset: New Year's Day stops
    // being a holiday, the lunar-new-year window closes, and Saturday stops
    // being the weekend. Workers and CI both run at UTC, so the assertions
    // above cannot see any of it -- this block supplies the hostile host.
    const originalTZ = process.env.TZ;

    beforeAll(() => {
      process.env.TZ = "America/New_York";
    });

    afterAll(() => {
      if (originalTZ === undefined) delete process.env.TZ;
      else process.env.TZ = originalTZ;
    });

    it("still reads New Year's Day as the first of January", () => {
      const service = new AIForecastEnhancer({} as D1Database, encryption());

      expect(service.getHolidayContext("2026-01-01")).toEqual([
        "元旦",
        "農曆新年期間（可能）",
        "冬季（火鍋/熱湯需求增加）",
      ]);
    });

    it("still reads a Saturday as the weekend", () => {
      const service = new AIForecastEnhancer({} as D1Database, encryption());

      // 2026-03-07 is a Saturday; a New York host reads it as Friday the 6th.
      expect(service.getHolidayContext("2026-03-07")).toEqual(["週末"]);
    });
  });
});
