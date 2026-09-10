import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "@/services/api";
import { customerIdentityApi } from "@/services/customerIdentityApi";

vi.mock("@/services/api", () => ({
  apiClient: {
    post: vi.fn(),
  },
}));

const PHONE = "+886912345678";

describe("customerIdentityApi phone password reset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks verify-otp for a reset token rather than a session", async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      resetToken: "reset-token-value-0001",
      expiresInSeconds: 900,
    });

    await expect(
      customerIdentityApi.verifyPasswordResetOtp(PHONE, "123456"),
    ).resolves.toEqual(
      expect.objectContaining({ resetToken: "reset-token-value-0001" }),
    );

    expect(apiClient.post).toHaveBeenCalledOnce();
    expect(apiClient.post).toHaveBeenCalledWith(
      "/customer/auth/verify-otp",
      // `purpose` is what makes the endpoint answer with a reset token; without
      // it the same call signs the diner in instead.
      expect.objectContaining({
        phone: PHONE,
        otp: "123456",
        purpose: "password_reset",
      }),
      // A wrong code answers 401 and that 401 is the answer, not a dead session.
      expect.objectContaining({ credentialCheck: true }),
    );
  });

  it("leaves the login verifyOtp call untouched", async () => {
    vi.mocked(apiClient.post).mockResolvedValue({});

    await customerIdentityApi.verifyOtp(PHONE, "123456");

    expect(apiClient.post).toHaveBeenCalledWith(
      "/customer/auth/verify-otp",
      { phone: PHONE, otp: "123456" },
      expect.objectContaining({ credentialCheck: true }),
    );
  });
});
