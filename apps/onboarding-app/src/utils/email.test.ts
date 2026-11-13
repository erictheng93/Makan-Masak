import { describe, expect, it } from "vitest";
import { isValidEmail } from "./email";

describe("isValidEmail", () => {
  it.each([
    "a+tag@example.com",
    "x@sub.example.co.uk",
    "mei@example.com",
    "  mei@example.com  ",
  ])("accepts %s", (value) => {
    expect(isValidEmail(value)).toBe(true);
  });

  it.each([
    "a@b.c",
    "a@-b.com",
    "a..b@x.com",
    "a@b..com",
    "user@exa_mple.com",
    "a@b.co.",
    "no-at.example.com",
    "a b@example.com",
    "",
  ])("rejects %s", (value) => {
    expect(isValidEmail(value)).toBe(false);
  });
});
