import { describe, expect, it } from "vitest";
import { ApiError } from "@makanmasak/utils";
import { UserService } from "./user";

/** A db whose username / email lookups report an existing row when asked to. */
function serviceWith(existing: { username?: boolean; email?: boolean }) {
  const service = new UserService({} as D1Database, {} as never);
  let call = 0;
  const select = () => ({
    from: () => ({
      where: () => ({
        get: async () => {
          call += 1;
          // createUser checks the username first, then the email.
          if (call === 1) return existing.username ? { id: "u-1" } : undefined;
          return existing.email ? { id: "u-2" } : undefined;
        },
      }),
    }),
  });
  Object.defineProperty(service, "db", { value: { select } });
  return service;
}

const input = {
  username: "chef",
  password: "QaTemp!2026xyz",
  fullName: "Chef",
  email: "chef@example.com",
  role: 2,
  restaurantId: "rest-1",
} as never;

describe("UserService.createUser duplicate checks", () => {
  // A plain Error used to reach the client as a 500 "cannot process this".
  it("rejects a taken username with a 409 pinned to the username field", async () => {
    const error = await serviceWith({ username: true })
      .createUser(input)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: "USERNAME_TAKEN",
      details: [expect.objectContaining({ field: "username" })],
    });
  });

  it("rejects a taken email with a 409 pinned to the email field", async () => {
    const error = await serviceWith({ email: true })
      .createUser(input)
      .catch((e: unknown) => e);

    expect(error).toMatchObject({
      status: 409,
      code: "EMAIL_TAKEN",
      details: [expect.objectContaining({ field: "email" })],
    });
  });
});
