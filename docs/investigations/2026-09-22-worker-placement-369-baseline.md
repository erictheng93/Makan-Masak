# #369: authenticated MY/SIN baseline, 2026-09-22

The authenticated endpoints work, but remain slow from this Malaysia connection.
This run did not reproduce HiNet/SJC routing and does not close #369.

## Method and scope

- UTC window: 2026-09-22 01:45:46–01:49:01 (09:45:46–09:49:01 Malaysia time).
- API: `https://api.makanmasak.com`, observation version
  `e12ebc5c-3b79-47b7-8ffe-1806ebac8d74`; placement was not changed for this test.
- Used the supplied `owner1` QA account once, verified role 1 and a restaurant
  assignment, and reused its token. Other staff accounts were not needed for this
  owner-endpoint baseline. No orders, menu items, or restaurant settings were
  created or changed. Login has its normal session side effects.
- The order list returned **7 orders**, with pagination total 7, limit 20, page 1.
  This is a small existing dataset, not a production-volume load test. No order
  bodies, names, restaurant identifiers, credentials or tokens are in the evidence.
- All requests used `MakanMasak-Placement-Probe/369 owner-baseline` as User-Agent.
- Each endpoint: 5 warmup requests, then 30 measured requests; one new curl process
  per request and a one-second pause after completion. Endpoints were tested
  sequentially: info, orders, dashboard. No retries, redirects or cache-busting
  parameters. Warmup does not prove isolate reuse or a particular cache state.
- Trace requests before and after both reported country **MY**, colo **SIN**.
  Analytics Engine independently recorded **MY / SIN / ASN 4788** for all 105
  endpoint probes. This is the network as seen by Cloudflare; no claim is made
  about the machine's physical location or the absence of an upstream proxy.

## Results

Percentiles are nearest-rank over the 30 measured HTTP 200, curl-exit-0 responses
per endpoint. Times below are milliseconds; warmup samples are excluded.

| Endpoint | Success | TTFB p50 | TTFB p95 | X-Response-Time p50 | X-Response-Time p95 |
| --- | --- | --- | --- | --- | --- |
| `/info` | 30/30 | 89.488 | 696.607 | 0 | 0 |
| `/api/v1/orders?restaurantId=…&limit=20` | 30/30 | 891.788 | 1569.329 | 498 | 1185 |
| `/api/v1/analytics/realtime-dashboard?restaurantId=…` | 30/30 | 1198.970 | 1840.422 | 987 | 1680 |

All 105 requests, including warmup, returned HTTP 200 with no curl transport
failures. All 90 measured cf-ray suffixes were SIN. No response cf-placement or
X-Cache value was available; their values remain **unknown**, not “local” or
“uncached.” X-Response-Time was present on all measured responses.

`/info` has substantial TTFB variation even though its middleware timer rounds to
zero. This points to time outside that timer, but these measurements do not
separate networking, placement forwarding, startup and earlier middleware. Do
not subtract independently calculated p50s to claim a network-time breakdown.

## Dependency diagnostic, after the baseline

Five read-only `/api/v1/system/health` probes (without `deep=1`) all returned 200
through SIN. Each reported healthy D1 and KV:

| Probe | D1 elapsed ms | KV elapsed ms | D1 primary | D1 region |
| --- | --- | --- | --- | --- |
| 1 | 127 | 312 | true | APAC |
| 2 | 110 | 3 | true | APAC |
| 3 | 107 | 4 | true | APAC |
| 4 | 108 | 3 | true | APAC |
| 5 | 105 | 3 | true | APAC |

D1 probe p50 is **108 ms**. APAC is a region, not proof of the same city as SIN;
this endpoint does not expose the current D1 serving colo. The single first KV
read is slower, but n=5 and a fixed sentinel key cannot characterize authentication
or business KV access. These probes are separate requests, not spans inside the
orders/dashboard requests; their times cannot be added up to explain those paths.

Source context: `OrdersService.getOrders` awaits permission filtering and then the
base order service. `AnalyticsService.getRealtimeData` calls the restaurant-scoped
database dashboard service directly. Measuring auth/permission checks and D1/KV
waits inside those actual requests is the next useful diagnostic; this run does
not identify a specific slow query or prove that SQL execution is the bottleneck.

## Analytics Engine verification

An exact-window query read back 35 `probe` points for each of the three endpoints,
all MY/SIN/4788: 105 weighted requests, matching the client request count including
warmup. The readback checks classification/ingestion, not the client percentiles.
The dataset stores middleware elapsed time with a different scope from the
X-Response-Time header used in the result table.

String timestamp comparisons were rejected by the SQL API with HTTP 422. The
successful saved query uses `toDateTime(unix_seconds)` for both bounds. This
diagnostic query error was not a business-endpoint failure.

Sanitized evidence: [summary, all samples, health probes and exact SQL](./2026-09-22-worker-placement-369-baseline.json).
All reported percentile calculations and success counts were independently
recomputed from the saved samples before committing the report.

## Decision

- Functional connectivity for this owner and these endpoints: passed.
- HiNet/SJC reproduction: **not tested from a HiNet connection**; no SJC observed.
- Performance: orders p50 498 ms is above the proposed 150 ms Worker-time target,
  even on this SIN baseline. This is not a failed Tokyo experiment: no placement
  change was made. Dashboard p50 is approximately 1.2 seconds from the client.
- No closure or placement decision yet. Obtain HiNet and another Taiwan-network
  baseline, repeat at another time, and use the same restaurant/dataset for the
  Tokyo comparison. A Tokyo hint might still reduce SIN-to-D1 round trips, but
  this run alone cannot establish the best location or cross-network regressions.
- While the product has no organic users, controlled synthetic comparisons can
  proceed without waiting an empty week. They establish scenario-specific
  behavior, not the eventual real-user routing distribution. Record larger-data
  scenarios separately rather than silently changing the dataset mid-comparison.
