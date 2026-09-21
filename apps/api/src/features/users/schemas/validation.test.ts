import { describe, expect, it } from "vitest";
import { updateUserSchema, userRoleSchema } from "./validation";

describe("user update validation", () => {
  it("rejects a role sent to the ordinary profile update", () => {
    // A Zod object strips unknown keys by default, which used to turn a role
    // change into a deceptive 200 OK with no persisted change. Roles have an
    // explicit privileged endpoint, so PUT must fail closed instead.
    expect(
      updateUserSchema.safeParse({ fullName: "Updated Name", role: 4 }).success,
    ).toBe(false);
  });

  it("accepts only supported role values on the dedicated endpoint", () => {
    expect(userRoleSchema.safeParse({ role: 4 }).success).toBe(true);
    expect(userRoleSchema.safeParse({ role: 5 }).success).toBe(false);
  });
});
