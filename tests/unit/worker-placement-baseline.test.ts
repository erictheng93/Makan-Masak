import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const baseline = JSON.parse(
  readFileSync(
    new URL(
      "../../docs/investigations/2026-09-22-worker-placement-369-baseline.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  samples: Array<{
    endpoint: string;
    phase: string;
    status: number;
    curl_exit: number;
    cf_ray: string;
    ttfb_ms: number;
    worker_ms: number;
  }>;
  summary: {
    endpoints: Record<string, Record<string, number>>;
  };
};

it("recomputes the placement report's counts and nearest-rank percentiles", () => {
  expect(baseline.samples).toHaveLength(105);
  for (const sample of baseline.samples) {
    expect(sample.status).toBe(200);
    expect(sample.curl_exit).toBe(0);
  }
  for (const [endpoint, summary] of Object.entries(
    baseline.summary.endpoints,
  )) {
    const samples = baseline.samples.filter(
      (sample) => sample.endpoint === endpoint && sample.phase === "measured",
    );
    expect(samples).toHaveLength(30);
    expect(summary.attempts).toBe(samples.length);
    expect(summary.successes).toBe(samples.length);
    expect(summary.transport_failures).toBe(0);
    expect(samples.every((sample) => sample.cf_ray.endsWith("-SIN"))).toBe(
      true,
    );
    for (const metric of ["ttfb_ms", "worker_ms"] as const) {
      const values = samples
        .map((sample) => sample[metric])
        .sort((a, b) => a - b);
      for (const percentile of [50, 95]) {
        expect(summary[`${metric}_p${percentile}`]).toBeCloseTo(
          values[Math.ceil((values.length * percentile) / 100) - 1],
          6,
        );
      }
    }
  }
});
