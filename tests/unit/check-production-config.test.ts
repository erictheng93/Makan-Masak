import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);

interface Finding {
  file: string;
  line: number;
  text: string;
}

interface Requirement {
  name?: string;
  anyOf?: string[][];
  level: "required" | "recommended";
  label?: string;
  why: string;
}

const { checkProductionConfig, REQUIRED_DEPLOYMENT_SECRETS } =
  require("../../scripts/check-production-config.cjs") as {
    checkProductionConfig: (options?: {
      root?: string;
      env?: Record<string, string | undefined>;
      requireDeploymentSecrets?: boolean;
      readDeployedSecrets?: (relativeFile: string) => Set<string> | null;
    }) => { violations: Finding[]; warnings: Finding[] };
    REQUIRED_DEPLOYMENT_SECRETS: Map<string, Requirement[]>;
  };

const API_TOML = "apps/api/wrangler.toml";

function apiRequirements(): Requirement[] {
  const requirements = REQUIRED_DEPLOYMENT_SECRETS.get(API_TOML);
  if (!requirements) {
    throw new Error(`no deployment secret requirements for ${API_TOML}`);
  }
  return requirements;
}

/** Every secret name the API Worker is expected to carry, groups flattened. */
function allApiSecretNames(): string[] {
  return apiRequirements().flatMap((requirement) =>
    requirement.anyOf ? requirement.anyOf.flat() : [requirement.name!],
  );
}

/** A deployed-secret reader that reports the given names for the API Worker. */
function deployedSecrets(names: string[]) {
  return (relativeFile: string) =>
    relativeFile === API_TOML ? new Set(names) : new Set<string>();
}

function textOf(findings: Finding[]): string {
  return findings.map((finding) => finding.text).join("\n");
}

describe("check-production-config", () => {
  it("still requires at least one deployment secret", () => {
    // Regression guard for the incident this gate exists to prevent: the map
    // was an empty Map, so `pnpm deploy:prod` deployed a Worker with three
    // secrets and reported success every single time.
    expect(REQUIRED_DEPLOYMENT_SECRETS.size).toBeGreaterThan(0);
    expect(apiRequirements().length).toBeGreaterThan(0);
    expect(allApiSecretNames()).toContain("JWT_SECRET");
  });

  it("accepts the checked-in production runtime URL configuration", () => {
    const result = checkProductionConfig({
      root: process.cwd(),
      env: {},
      readDeployedSecrets: deployedSecrets(allApiSecretNames()),
    });

    expect(result.violations).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("can skip deployment secret checks for non-deploy CI gates", () => {
    const readDeployedSecrets = vi.fn(() => new Set<string>());

    const result = checkProductionConfig({
      root: process.cwd(),
      env: {},
      requireDeploymentSecrets: false,
      readDeployedSecrets,
    });

    expect(result.violations).toEqual([]);
    expect(result.warnings).toEqual([]);
    // The CI gate must never shell out to wrangler.
    expect(readDeployedSecrets).not.toHaveBeenCalled();
  });

  it("honours CHECK_PRODUCTION_CONFIG_REQUIRE_DEPLOYMENT_SECRETS=false", () => {
    const readDeployedSecrets = vi.fn(() => new Set<string>());

    const result = checkProductionConfig({
      root: process.cwd(),
      env: { CHECK_PRODUCTION_CONFIG_REQUIRE_DEPLOYMENT_SECRETS: "false" },
      readDeployedSecrets,
    });

    expect(result.violations).toEqual([]);
    expect(readDeployedSecrets).not.toHaveBeenCalled();
  });

  it("blocks the deploy when a required secret is absent from the Worker", () => {
    const result = checkProductionConfig({
      root: process.cwd(),
      env: {},
      readDeployedSecrets: deployedSecrets(
        allApiSecretNames().filter((name) => name !== "JWT_SECRET"),
      ),
    });

    expect(textOf(result.violations)).toContain(
      "missing production secret: JWT_SECRET",
    );
    expect(textOf(result.warnings)).not.toContain("JWT_SECRET");
  });

  it("reproduces the real production state: three secrets, no blockers", () => {
    // makanmasak-api-prod as of the incident.
    const result = checkProductionConfig({
      root: process.cwd(),
      env: {},
      readDeployedSecrets: deployedSecrets([
        "CLOUDFLARE_API_TOKEN",
        "JWT_SECRET",
        "QR_SIGNING_KEY",
      ]),
    });

    expect(textOf(result.warnings)).toContain(
      "missing production secret: ENCRYPTION_KEY",
    );
    expect(textOf(result.warnings)).toContain("SMS vendor credentials");
    // Every gap here disables one capability while the rest of the system keeps
    // serving, so none of them blocks a deploy. Only a secret whose absence
    // breaks the Worker for everyone belongs in violations.
    expect(result.violations).toEqual([]);
  });

  it("requires the Cloudflare email binding in the production environment", () => {
    const root = mkdtempSync(join(tmpdir(), "prod-config-email-"));
    mkdirSync(join(root, "apps", "api"), { recursive: true });
    writeFileSync(
      join(root, "apps", "api", "wrangler.toml"),
      [
        "[[send_email]]",
        'name = "NOTIFICATION_EMAIL"',
        "[env.production]",
        'name = "makanmasak-api-prod"',
        "[env.production.vars]",
        'API_BASE_URL = "https://api.makanmasak.com"',
        'CORS_ORIGIN = "https://makanmasak.com"',
      ].join("\n"),
    );

    const result = checkProductionConfig({
      root,
      env: {},
      requireDeploymentSecrets: false,
    });

    expect(textOf(result.violations)).toContain(
      "missing production binding: send_email:NOTIFICATION_EMAIL",
    );
  });

  it("keeps ENCRYPTION_KEY at warning level now that #300 made its absence fail closed", () => {
    // Pinned deliberately, not inherited. Before #300 an absent key silently
    // derived a reproducible AES key from the empty string; the crypto helpers
    // now throw in production instead. That turns the gap into a fail-fast,
    // feature-confined failure — the same shape as an unconfigured SMS vendor — so it stays
    // a warning. "required" is reserved for secrets whose absence breaks the
    // Worker for everyone. Flipping this to "required" should be a conscious
    // edit to both the entry and this test, not a drive-by.
    const encryptionKey = apiRequirements().find(
      (requirement) => requirement.name === "ENCRYPTION_KEY",
    );

    expect(encryptionKey).toBeDefined();
    expect(encryptionKey!.level).toBe("recommended");

    const result = checkProductionConfig({
      root: process.cwd(),
      env: {},
      readDeployedSecrets: deployedSecrets(
        allApiSecretNames().filter((name) => name !== "ENCRYPTION_KEY"),
      ),
    });

    expect(result.violations).toEqual([]);
    expect(textOf(result.warnings)).toContain(
      "missing production secret: ENCRYPTION_KEY",
    );
  });

  it("treats the SMS vendors as alternatives, not as additive requirements", () => {
    const withMitakeOnly = checkProductionConfig({
      root: process.cwd(),
      env: {},
      readDeployedSecrets: deployedSecrets([
        ...allApiSecretNames().filter((name) => !name.startsWith("TWILIO_")),
        // Mitake and Every8d present, Twilio absent.
      ]),
    });

    expect(withMitakeOnly.violations).toEqual([]);
    expect(withMitakeOnly.warnings).toEqual([]);
  });

  it("warns when an SMS vendor group is only half configured", () => {
    const result = checkProductionConfig({
      root: process.cwd(),
      env: {},
      readDeployedSecrets: deployedSecrets([
        "JWT_SECRET",
        "QR_SIGNING_KEY",
        "ENCRYPTION_KEY",
        // A username without its password is not a usable vendor.
        "MITAKE_USERNAME",
      ]),
    });

    expect(result.violations).toEqual([]);
    expect(textOf(result.warnings)).toContain("SMS vendor credentials");
  });

  it("blocks rather than skips when the deployed secret list cannot be read", () => {
    // A silent skip here would restore exactly the green-on-nothing behaviour
    // the empty requirement map used to produce.
    const result = checkProductionConfig({
      root: process.cwd(),
      env: {},
      readDeployedSecrets: () => null,
    });

    expect(textOf(result.violations)).toContain(
      "could not read the deployed production secret list",
    );
  });

  it("rejects a required secret committed as a plaintext wrangler var", () => {
    const root = mkdtempSync(join(tmpdir(), "prod-config-"));
    mkdirSync(join(root, "apps", "api"), { recursive: true });
    writeFileSync(
      join(root, "apps", "api", "wrangler.toml"),
      [
        "[env.production]",
        'name = "makanmasak-api-prod"',
        "[env.production.vars]",
        'API_BASE_URL = "https://api.makanmasak.com"',
        'CORS_ORIGIN = "https://makanmasak.com"',
        'JWT_SECRET = "committed-by-mistake"',
        "",
      ].join("\n"),
    );

    const result = checkProductionConfig({
      root,
      env: {},
      // The static half runs even with the live check switched off.
      requireDeploymentSecrets: false,
    });

    expect(textOf(result.violations)).toContain(
      "production secret must not be committed as a wrangler var: JWT_SECRET",
    );
  });
});
