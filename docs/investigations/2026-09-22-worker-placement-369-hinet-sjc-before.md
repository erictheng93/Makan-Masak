# #369: authenticated Taiwan/SJC baseline, 2026-09-22

The issue is reproduced on the current Taiwan test connection: all measured
requests entered Cloudflare through SJC while D1 reported its primary in APAC.
The authenticated business endpoints remain materially slower than `/info`.
This is a before-placement baseline, not closure evidence.

## Method and scope

- UTC window: 2026-09-22 07:06:12–07:09:37 (15:06:12–15:09:37 Taipei time).
- API: `https://api.makanmasak.com`; production placement was disabled.
- Used the dedicated role-1 owner QA account once, verified a restaurant
  assignment, and reused its token. No business data or settings were changed.
  Login has its normal session-invalidation side effect.
- Each endpoint had 5 warmup requests followed by 30 measured requests. Requests
  were sequential, used a new curl process, and paused one second after each
  completion. There were no retries, redirects, or cache-busting parameters.
- The trace before and after reported country **TW** and colo **SJC**. The run was
  labelled HiNet based on the operator's test context; the sanitized evidence
  intentionally does not retain an IP address or independently identify the ISP.
- Credentials, tokens, restaurant identifiers, and response bodies are absent
  from the saved evidence.

## Results

Percentiles are nearest-rank over the 30 measured HTTP 200, curl-exit-0 responses
per endpoint. Times are milliseconds; warmup samples are excluded.

| Endpoint | Success | TTFB p50 | TTFB p95 | X-Response-Time p50 | X-Response-Time p95 |
| --- | --- | --- | --- | --- | --- |
| `/info` | 30/30 | 427.581 | 476.456 | 0 | 0 |
| `/api/v1/orders?restaurantId=…&limit=20` | 30/30 | 814.640 | 881.811 | 366 | 382 |
| `/api/v1/analytics/realtime-dashboard?restaurantId=…` | 30/30 | 1058.952 | 1532.821 | 611 | 651 |

All 105 endpoint requests, including warmups, returned HTTP 200 without a curl
transport error. All 90 measured cf-ray suffixes were SJC. X-Response-Time and
X-Request-ID were present on every measured response. Response placement and
cache headers were absent; absence is unknown and must not be interpreted as
local placement or a cache miss.

The `/info` p50 establishes roughly 428 ms of client-observed latency even when
its middleware timer rounds to zero. Orders adds a 366 ms Worker median and the
dashboard adds 611 ms. These independently measured percentiles cannot be
subtracted into a precise network or dependency breakdown.

## Dependency diagnostic

Five read-only `/api/v1/system/health` probes after the endpoint samples all
returned HTTP 200. Each reported D1 served by the primary in APAC.

| Probe | Client ms | D1 elapsed ms | KV elapsed ms | D1 primary | D1 region |
| --- | --- | --- | --- | --- | --- |
| 1 | 533 | 111 | 115 | true | APAC |
| 2 | 539 | 117 | 3 | true | APAC |
| 3 | 567 | 134 | 12 | true | APAC |
| 4 | 532 | 115 | 3 | true | APAC |
| 5 | 525 | 109 | 4 | true | APAC |

D1 probe p50/p95 was **115/134 ms**; KV p50/p95 was **4/115 ms**. These are
separate health requests, not spans inside orders or dashboard. APAC is also not
proof of D1's city or physical proximity to a Tokyo placement hint.

## Evidence and limitations

The sanitized [JSON evidence](./2026-09-22-worker-placement-369-hinet-sjc-before.json)
contains all 105 endpoint samples, five health probes, traces, and summaries.
Success counts and percentile values were independently recomputed from the
saved samples. Analytics Engine readback was not performed for this run because
the local Wrangler session is authenticated to a different Cloudflare account;
the earlier production ingestion proof remains valid, but it is not a substitute
for this cohort's provider-side execution-location evidence.

This is one short time window, one account, one small existing dataset, and one
Taiwan connection. It reproduces TW-to-SJC ingress but does not measure a second
Taiwan ISP, organic traffic, large restaurants, or cross-region regressions.

## Decision

- #369 is reproduced strongly enough to justify the controlled placement test:
  TW/SJC ingress is stable across the cohort, and both business endpoints exceed
  the proposed latency target before any placement change.
- Do not close the issue yet. Deploy only the API Worker with the documented
  Tokyo region hint, prove its actual execution placement, and repeat this exact
  cohort. A second Taiwan ISP and the existing Malaysia/SIN cohort are required
  regression checks.
- If placement lowers D1 proximity but orders/dashboard remain slow, investigate
  the serial authentication lookup and serial business-query waves already
  identified in the code review. Those optimizations should be measured as a
  separate experiment rather than bundled into the placement comparison.
- Production deployment and Analytics Engine queries require credentials for the
  production Cloudflare account. The currently active local Wrangler account
  cannot perform either operation.
