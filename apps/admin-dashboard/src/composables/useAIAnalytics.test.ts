import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { api } from "@/services/api";
import { useAIAnalytics } from "./useAIAnalytics";

// The failure paths below are driven on purpose and the code logs each one.
const silencedConsole: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  for (const method of ["error"] as const) {
    silencedConsole.push(
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
  }
});
afterEach(() => {
  silencedConsole.splice(0).forEach((spy) => spy.mockRestore());
});

describe("useAIAnalytics", () => {
  it("preserves an API error code when report generation fails", async () => {
    vi.mocked(api.post).mockRejectedValueOnce({
      response: {
        data: {
          error: {
            code: "AI_PROVIDER_NOT_CONFIGURED",
            message: "AI provider not configured.",
          },
        },
      },
    });

    const { generateReport, error, errorCode } = useAIAnalytics();

    await expect(
      generateReport("restaurant-1", { range: "30d" }),
    ).resolves.toBeNull();
    expect(error.value).toBe("AI provider not configured.");
    expect(errorCode.value).toBe("AI_PROVIDER_NOT_CONFIGURED");
  });
});
