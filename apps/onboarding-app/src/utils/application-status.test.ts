import { describe, expect, it } from "vitest";
import {
  getApplicationSecretFromHash,
  getApplicationStatusPath,
} from "./application-status";

describe("application status links", () => {
  it("places the tracking secret in the URL fragment", () => {
    expect(getApplicationStatusPath("app-123", "secret /?#")).toBe(
      "/status/app-123#secret%20%2F%3F%23",
    );
  });

  it("reads a URL-fragment secret without accepting an empty credential", () => {
    expect(getApplicationSecretFromHash("#secret%20value")).toBe(
      "secret value",
    );
    expect(getApplicationSecretFromHash("")).toBeNull();
    expect(getApplicationSecretFromHash("#")).toBeNull();
  });
});
