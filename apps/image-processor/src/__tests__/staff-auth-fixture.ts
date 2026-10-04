import { vi, type Mock } from "vitest";

export function staffAuthDatabase(
  user: Record<string, unknown> | null = {
    id: "01890a5d-ac96-774b-bcce-b302099a8057",
    username: "admin",
    role: 0,
    restaurant_id: null,
    is_active: 1,
    token_version: 1,
  },
  sessionActive = true,
): { prepare: Mock } {
  return {
    prepare: vi.fn((query: string) => ({
      bind: vi.fn(() => ({
        first: vi
          .fn()
          .mockResolvedValue(
            query.includes("FROM sessions")
              ? sessionActive
                ? { id: "session-1" }
                : null
              : user,
          ),
      })),
    })),
  };
}
