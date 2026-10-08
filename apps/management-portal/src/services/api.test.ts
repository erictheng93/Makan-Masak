import { describe, expect, it, vi } from "vitest";

vi.mock("vue-toastification", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import { isExpectedApiError } from "./api";

const failure = (code: string, expectedErrorCodes?: string[]) => ({
  config: { expectedErrorCodes } as never,
  response: {
    data: { success: false, error: { code, message: "x" } },
  } as never,
});

describe("isExpectedApiError", () => {
  it("recognizes a code the request said it handles", () => {
    expect(
      isExpectedApiError(
        failure("POLICY_BLOCKED_BY_UNKNOWN_COUNTRY", [
          "POLICY_BLOCKED_BY_UNKNOWN_COUNTRY",
        ]),
      ),
    ).toBe(true);
  });

  it("still reports every other error", () => {
    expect(
      isExpectedApiError(
        failure("POLICY_VALUE_INVALID", ["POLICY_BLOCKED_BY_UNKNOWN_COUNTRY"]),
      ),
    ).toBe(false);
    expect(
      isExpectedApiError(failure("POLICY_BLOCKED_BY_UNKNOWN_COUNTRY")),
    ).toBe(false);
    expect(isExpectedApiError({ config: undefined, response: undefined })).toBe(
      false,
    );
  });
});
