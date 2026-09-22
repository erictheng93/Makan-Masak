# #369: Taiwan/SJC after Tokyo targeted placement, 2026-09-22

Production API version `37a3769e-b379-4942-992c-8b25ad9e2f9f` targets the
Cloudflare location nearest AWS Tokyo (`aws:ap-northeast-1`). Two authenticated
HiNet/SJC windows show large improvements for the D1-backed orders and dashboard
endpoints with no request failures. The placement should remain deployed.

## Deployment and safety

- Deployed at 2026-09-22 10:26 UTC with 100% traffic after production build,
  config validation, targeted tests, and the affected-package gate.
- Upload was 2420.32 KiB / gzip 603.17 KiB; Worker Startup Time was 126 ms.
- The change only adds targeted placement to the production API Worker. It does
  not change application code, routes, bindings, secrets, data, or migrations.
- Public `/info` and `/api/v1/system/health` returned HTTP 200 immediately after
  deployment. D1 and KV were healthy; D1 served from the APAC primary.
- Rollback target: `638784db-88f8-4311-b745-d91984cc3ec5`.

## Method

The same role-1 owner QA account, restaurant and read-only endpoints as the
[before baseline](./2026-09-22-worker-placement-369-hinet-sjc-before.md) were
used. Each of two consecutive windows ran five warmups and 30 measured requests
per endpoint, followed by five health probes. All 210 endpoint requests,
including warmups, and all ten health probes returned HTTP 200 without transport
errors. Both traces and all measured cf-ray suffixes remained TW/SJC.

## Results

Percentiles are nearest-rank over the combined 60 measured HTTP 200 responses
per endpoint. Times are milliseconds.

| Endpoint | Before p50/p95 | After p50/p95 | Change p50/p95 | Worker before | Worker after |
| --- | --- | --- | --- | --- | --- |
| `/info` | 427.581 / 476.456 | 539.120 / 566.100 | +26.1% / +18.8% | 0 / 0 | 0 / 0 |
| orders | 814.640 / 881.811 | 612.270 / 801.800 | -24.8% / -9.1% | 366 / 382 | 52 / 123 |
| dashboard | 1058.952 / 1532.821 | 656.690 / 805.220 | -38.0% / -47.5% | 611 / 651 | 88 / 170 |

Orders Worker p50 is 52 ms, comfortably below the predeclared 150 ms target.
The first orders window had a 1000.749 ms p95, but this did not repeat: the
second was 740.568 ms and the combined p95 is 801.800 ms, below baseline.
Targeted placement adds roughly 90–112 ms to the no-work `/info` path while
removing much larger cross-Pacific waits from D1-heavy endpoints.

Across ten health probes, D1 p50/p95 improved from 115/134 ms to 14/57 ms and
was always served by the APAC primary. KV p50 stayed at 4 ms while p95 was 260
ms versus 115 ms before; with only ten independent probes and no corresponding
business failure, this remains a follow-up signal rather than a rollback reason.

## Placement evidence

Wrangler's deployed-version metadata reports `placement_mode: targeted` with
target `aws:ap-northeast-1`. Among 180 measured responses, 115 included
`Cf-Placement: remote-NRT`; 65 included Cloudflare's incomplete `remote-` value.
Analytics Engine independently recorded TW, SJC, HiNet ASN 3462 and HTTP 200 for
the probe endpoints. Its request-side placement field remained `unknown`, which
means the platform added the placement response header after Worker middleware
ran; it is not contradictory evidence.

The sanitized [JSON evidence](./2026-09-22-worker-placement-369-hinet-sjc-after.json)
contains both window summaries, deployment metadata, placement counts and the
combined dependency results. It omits credentials, tokens, restaurant IDs,
response bodies and request IDs.

## Decision and remaining closure checks

Keep the Tokyo placement: the affected HiNet/SJC scenario now passes its latency
and functional acceptance rules. This does not yet justify closing #369 because
the predeclared cross-region guardrail still requires after-placement checks from
a second Taiwan ISP and Malaysia/SIN. Organic traffic remains too sparse to
replace those cohorts. Repeat the same read-only probe from those networks and
confirm no greater than 10% TTFB p50/p95 regression before closing the issue.
