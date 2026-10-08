import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeCronExpression } from "../utils/cron";
import { GROUP_ORDER_EXPIRY_CRON } from "../workers/group-order-expiry";

/**
 * A cron job is wired in two places: the schedule string in wrangler.toml, and
 * the cronMatches() branch in the handler that claims it. Nothing connects
 * them but an exact string, so an edit to one side silently stops the job --
 * no error, no failing request, just work that quietly never runs again. These
 * tests are the connection.
 */

const apiRoot = resolve(fileURLToPath(new URL("../..", import.meta.url).href));

function readConfig(path: string): string {
  return readFileSync(resolve(apiRoot, path), "utf8");
}

/** Schedule strings from the `crons = [...]` array, ignoring comments. */
function declaredCrons(config: string): string[] {
  const block = config.match(/\n\[triggers\][\s\S]*?crons = \[([\s\S]*?)\]/);
  if (!block) return [];

  return block[1]
    .split("\n")
    .map((line) => line.replace(/#.*$/, "").trim())
    .flatMap((line) => [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1]))
    .map(normalizeCronExpression);
}

/** Schedule strings the handler actually branches on. */
function matchedCrons(source: string): string[] {
  return [...source.matchAll(/cronMatches\([^,]+,\s*"([^"]+)"\)/g)]
    .map((match) => match[1])
    .map(normalizeCronExpression);
}

describe("API cron wiring", () => {
  const config = readConfig("wrangler.toml");
  const handler = readConfig("src/index.ts");

  it("declares every schedule the handler branches on", () => {
    const declared = new Set(declaredCrons(config));
    const orphaned = [...new Set(matchedCrons(handler))].filter(
      (cron) => !declared.has(cron),
    );

    // An orphaned branch is a job that can never fire.
    expect(orphaned).toEqual([]);
  });

  it("has a handler branch for every schedule it declares", () => {
    const matched = new Set(matchedCrons(handler));
    const unused = declaredCrons(config).filter((cron) => !matched.has(cron));

    // An unclaimed schedule wakes the Worker to do nothing.
    expect(unused).toEqual([]);
  });

  // Regression: aggregation and reconciliation shared one */5 entry, so neither
  // could be retimed without moving the other. They want opposite cadences.
  it("keeps usage aggregation and payment reconciliation on separate ticks", () => {
    const aggregation = handler.match(
      /cronMatches\(event\.cron, "([^"]+)"\)\)\s*\{\s*await runJob\("[^"]+", async \(\) => \{\s*console\.log\("\[Cron\] Running usage aggregation/,
    );
    const reconciliation = handler.match(
      /cronMatches\(event\.cron, "([^"]+)"\)\)\s*\{\s*await runJob\("[^"]+", async \(\) => \{\s*console\.log\("\[Cron\] Running market checkout payment reconciliation/,
    );

    expect(aggregation?.[1]).toBeDefined();
    expect(reconciliation?.[1]).toBeDefined();
    expect(aggregation?.[1]).not.toBe(reconciliation?.[1]);
    // Money settlement stays frequent; metering does not need to be.
    expect(reconciliation?.[1]).toBe("*/5 * * * *");
  });

  it("keeps the group order expiry sweep wired through its exported cron constant", () => {
    expect(declaredCrons(config)).toContain(
      normalizeCronExpression(GROUP_ORDER_EXPIRY_CRON),
    );
    expect(handler).toContain(
      "cronMatches(event.cron, GROUP_ORDER_EXPIRY_CRON)",
    );
  });
});

describe("backup scheduler cron wiring", () => {
  const config = readFileSync(
    resolve(apiRoot, "../backup-scheduler/wrangler.toml"),
    "utf8",
  );

  // Backups are a per-restaurant feature with no configurations in production,
  // so the schedules were running against an empty set -- including a */5
  // health check for a system that had never stored anything. The handler is
  // kept intact so restoring them is a config change, not a rewrite.
  it("declares no schedules while the feature has no adopters", () => {
    expect(declaredCrons(config)).toEqual([]);
  });

  it("keeps the triggers block so the empty array clears them on deploy", () => {
    // Deleting the block instead would leave the deployed triggers running.
    expect(config).toMatch(/\[triggers\]\s*\ncrons = \[\]/);
  });
});
