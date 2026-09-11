# Intermittent `ERR_CONNECTION_CLOSED` against the production API

**Date:** 2026-09-12
**Related issue:** #325 (filed 2026-09-03)
**Live version measured:** `efe1eb7b-f1a2-4ba8-8d2e-d756687c6bc4`, deployed 2026-09-10T04:12Z
**Status:** Not reproduced. Both Worker-side hypotheses contradicted by evidence; one defect of the named class found and fixed anyway.

## Summary

Over a 26-minute window (2026-09-12 01:00–01:26 CST) I made **1,372 requests** to four
public production endpoints while `wrangler tail` recorded **1,385 Worker invocations**
on the same Worker.

- **Zero closed connections.** Not one curl exit 35/52/55/56 — the signatures of a
  connection reset, TLS failure or truncated recv. The symptom #325 was filed about did
  not occur.
- **Zero non-`ok` Worker outcomes.** All 1,385 tail events reported `outcome: "ok"`. No
  `exception`, no `exceededCpu`, no `exceededMemory`, no `canceled`, no `truncated`, and
  `exceptions: []` on every single event. **Hypotheses (1) "uncaught exception recycling
  the isolate" and (2) "CPU or memory limit" got no support at all.**
- **The edge never dropped an idle keep-alive connection.** A separate probe held one
  TCP+TLS connection open for 19.5 minutes with 30-second idle gaps and ran 40 transfers
  over it; `num_connects` was 1 on the first and **0 on all 39 others**.
- **Two requests did fail** — both curl exit 28 (client timeout at 12 s), neither a close.
  For both, the tail shows the Worker answered `200` with `outcome: "ok"`, one in
  **101 ms** and the other in **1 ms**, while Cloudflare measured `clientTcpRtt` of 901 ms
  and 952 ms on those two connections. The loss was entirely on the client↔edge path.
- **The `/info` slowness is not the Worker.** `/info` is a static handler. Its Worker-side
  `wallTime` is **1 ms at p50 and 5 ms at p95**. Its end-to-end p50 of 0.70 s is 0.24 s TCP
  + 0.26 s TLS + 0.21 s round trip. 96% of the wall clock is connection setup and network.

Conclusion: **(c) not reproducible, but not disproven** — with the important refinement
that the two mechanisms #325 proposed *inside* the Worker are now positively contradicted,
not merely unobserved. What is left standing is the third hypothesis, an edge/network-side
problem, and the two failures measured today are exactly that shape (a degraded client
path) differing only in how they expressed themselves — timeout rather than reset.

## Method

Three probes ran concurrently against `https://api.makanmasak.com`, read-only, capped
well under 2 req/s. Raw data is in the session scratch directory, not the repo.

| Probe | What it does | Why |
| --- | --- | --- |
| Sampler | 343 iterations over 26 min, alternating two connection modes; 4 endpoints per iteration, ~1 req/s | p50/p95/max per endpoint, and any non-zero curl exit |
| Tail | `wrangler tail --env production --format json` for 27 min | Worker-reported `outcome`, `wallTime`, `cpuTime`, `exceptions` |
| Idle probe | One curl process, 40 transfers paced 30 s apart by `--rate 2/m`, all on one connection | Does the edge drop an idle keep-alive connection? |

The sampler alternates deliberately:

- **`fresh`** — four separate curl processes, so every request pays a new TCP + TLS handshake.
- **`ka`** — one curl process with four URLs, so requests 2–4 reuse the connection.

Endpoints (all need no auth): `/info`, `/api/v1/monitoring/health`,
`/api/v1/system/health`, and `/api/v1/analytics/realtime-dashboard` (answers 401 but still
runs the Worker through routing, the geo rate limiter and `onError`).

Per request I recorded `http_code`, `exitcode`, `time_total`, `time_connect`,
`time_appconnect`, `time_starttransfer`, `num_connects`, `remote_ip` and the `cf-ray`
response header. **`cf-ray` is the join key**: every curl sample can be matched to the exact
tail event for the same request, which is what makes the client-side and server-side numbers
comparable rather than merely adjacent.

## Raw numbers

### Per endpoint, end to end (seconds, n = 343 each)

| Endpoint | p50 | p95 | max | min |
| --- | --- | --- | --- | --- |
| `/info` | 0.718 | 2.668 | 7.741 | 0.291 |
| `/api/v1/monitoring/health` | 0.606 | 1.720 | 7.481 | 0.097 |
| `/api/v1/system/health` | 0.540 | 1.959 | 5.012 | 0.164 |
| `/api/v1/analytics/realtime-dashboard` | 0.451 | 1.640 | 3.239 | 0.089 |

Status codes were exactly as expected on all 1,372: `200` × 1,029 and `401` × 343.

### Split by connection mode — the handshake is most of it

| Mode | Endpoint | n | p50 | p95 | max |
| --- | --- | --- | --- | --- | --- |
| fresh | `/info` | 172 | 0.698 | 2.641 | 7.741 |
| fresh | `/api/v1/monitoring/health` | 172 | 0.837 | 1.981 | 7.481 |
| fresh | `/api/v1/system/health` | 171 | 0.870 | 2.484 | 4.416 |
| fresh | `/api/v1/analytics/realtime-dashboard` | 172 | 0.785 | 1.921 | 3.239 |
| ka | `/info` | 170 | 0.738 | 3.139 | 6.325 |
| ka | `/api/v1/monitoring/health` | 171 | 0.320 | 1.380 | 5.263 |
| ka | `/api/v1/system/health` | 171 | 0.249 | 0.625 | 5.012 |
| ka | `/api/v1/analytics/realtime-dashboard` | 171 | 0.117 | 0.547 | 2.447 |

`ka` `/info` looks anomalous only because `/info` is always the *first* URL in a `ka`
iteration, so it pays the handshake the other three then reuse. Read the other three rows:
**reusing a connection takes 0.12–0.32 s where a fresh one takes 0.79–0.87 s.**

### Decomposition (fresh-connection samples, p50 seconds)

| Endpoint | TCP | TLS | TTFB after TLS | body | total |
| --- | --- | --- | --- | --- | --- |
| `/info` | 0.239 | 0.260 | 0.213 | 0.001 | 0.698 |
| `/api/v1/monitoring/health` | 0.237 | 0.270 | 0.339 | 0.001 | 0.837 |
| `/api/v1/system/health` | 0.253 | 0.265 | 0.348 | 0.001 | 0.870 |
| `/api/v1/analytics/realtime-dashboard` | 0.260 | 0.274 | 0.263 | 0.000 | 0.785 |

### Client-measured TTFB vs the Worker's own `wallTime`, joined on `cf-ray`

| Endpoint | n | TTFB-after-TLS p50 | Worker `wallTime` p50 | gap |
| --- | --- | --- | --- | --- |
| `/info` | 168 | 0.213 s | **0.001 s** | 0.212 s |
| `/api/v1/monitoring/health` | 168 | 0.339 s | 0.089 s | 0.248 s |
| `/api/v1/system/health` | 167 | 0.348 s | 0.091 s | 0.254 s |
| `/api/v1/analytics/realtime-dashboard` | 168 | 0.261 s | 0.003 s | 0.258 s |

The gap is 0.21–0.26 s on every endpoint, which is one client↔edge round trip:
Cloudflare's own `clientTcpRtt` for these connections has a p50 of **205 ms**. The two
independent measurements agree, which is the strongest single piece of evidence here —
the Worker's contribution to `/info` is 1 ms and everything else is the wire.

### Failures

Two, out of 1,372. Both are curl exit **28** (timeout), not a close.

| Time (UTC) | Endpoint | Mode | exit | `time_connect` | `time_appconnect` | `time_starttransfer` | curl message |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 17:02:51 | `/api/v1/system/health` | fresh | 28 | 1.442 | 8.712 | 10.303 | timed out, 436/436 bytes received |
| 17:22:01 | `/info` | ka | 28 | 1.051 | 2.299 | 7.234 | timed out, 0/2250 bytes received |

Matched to their tail events by `cf-ray`:

| `cf-ray` | Worker outcome | `wallTime` | `cpuTime` | Hono log | `clientTcpRtt` |
| --- | --- | --- | --- | --- | --- |
| `a3983e6c1f39eb44` | **ok** | 101 ms | 7 ms | `GET /api/v1/system/health 200 89ms` | **901 ms** |
| `a3985a3f48fb1e94` | **ok** | **1 ms** | 1 ms | `GET /info 200 0ms` | **952 ms** |

The second one is the clearest statement of the whole investigation: the Worker produced a
complete `200` for `/info` in one millisecond, and the client sat for twelve seconds and
received **zero bytes of body**. On the first, the TLS handshake alone consumed 7.3 s
(1.44 s → 8.71 s).

Both failures landed on connections where Cloudflare measured ~900 ms RTT against a p50 of
205 ms. Across all 1,378 tail events with the field: min 72, p50 205, p90 309, p95 385,
p99 795, max 3,326 ms; 43 connections over 500 ms and 7 over 1,000 ms. The last mile from
this client is poor and occasionally pathological, and that is sufficient to explain
everything observed.

### Slow requests are slow before they reach the Worker

67 samples exceeded 2 s end to end. **62 of them had a Worker `wallTime` under 200 ms**,
and the largest `wallTime` among all 67 was 858 ms. The worst offenders:

| Time (UTC) | Endpoint | total | TCP | TLS | TTFB | Worker `wallTime` |
| --- | --- | --- | --- | --- | --- | --- |
| 17:17:41 | `/info` | 7.741 | 1.822 | 3.705 | 2.214 | **3 ms** |
| 17:25:28 | `/api/v1/monitoring/health` | 7.481 | 0.252 | 0.722 | 6.507 | **11 ms** |
| 17:00:53 | `/info` | 6.325 | 0.300 | 5.562 | 0.463 | **1 ms** |
| 17:19:18 | `/info` | 5.987 | 0.489 | 4.379 | 1.117 | **1 ms** |
| 17:06:58 | `/info` | 5.513 | 0.257 | 4.986 | 0.263 | **2 ms** |
| 17:10:49 | `/api/v1/monitoring/health` | 5.385 | 2.739 | 2.383 | 0.252 | 125 ms |

(This table is not filtered by connection mode; the 17:11:37 and 17:00:53 rows elsewhere in
the data with `tcp=0 tls=0` are reused connections that stalled for 5 s on a warm socket
while the Worker answered in 96 ms and 93 ms.)

### Idle keep-alive probe

40 transfers, 30 s apart, 19.5 minutes, one curl process.

- `num_connects`: **1 on transfer #1, 0 on transfers #2–#40.** The connection was
  established once and survived every 30-second idle gap.
- Exit codes: `0` × 40. Status: `200` × 30, `401` × 10.
- `time_total` p50 0.326, p95 1.196, max 3.751.
- Every `cf-ray` shares the suffix `fdab` — same connection, same colo, throughout.

This is the probe aimed squarely at the most plausible benign explanation for
`ERR_CONNECTION_CLOSED` on a POST: the browser reuses a keep-alive socket the edge is
closing at the same moment, and Chrome does not silently retry non-idempotent requests the
way it retries GETs. **That mechanism did not fire once today at a 30-second idle
interval.** It is not ruled out at longer idle intervals, which I did not test.

## Tail outcome counts

| Outcome | Count |
| --- | --- |
| `ok` | **1,385** |
| `exception` | 0 |
| `exceededCpu` | 0 |
| `exceededMemory` | 0 |
| `canceled` | 0 |
| `unknown` | 0 |

Also zero: events with a non-empty `exceptions` array, and events with `truncated: true`.

`cpuTime` never came close to a limit: p50 1–2 ms on every endpoint, max 249 ms. There is no
`[limits]` block and no `cpu_ms` key anywhere in `apps/api/wrangler.toml`, so the default
applies, and nothing here is within two orders of magnitude of it.

Worker-side `wallTime`, by endpoint:

| Endpoint | n | p50 | p95 | max | `cpuTime` p50 | `cpuTime` max |
| --- | --- | --- | --- | --- | --- | --- |
| `/info` | 344 | 1 | 5 | 217 | 1 | 214 |
| `/api/v1/monitoring/health` | 344 | 90 | 676 | 941 | 2 | 149 |
| `/api/v1/system/health` | 345 | 90 | 116 | 375 | 2 | 249 |
| `/api/v1/analytics/realtime-dashboard` | 345 | 3 | 8 | 214 | 2 | 189 |

Seven further events were cron invocations (`event.cron`), `wallTime` 1,465–1,576 ms. They
account for the unlabelled row in the raw output and are unrelated.

One asymmetry worth a follow-up, though it is not #325: `/api/v1/monitoring/health` has a
p95 of 676 ms and a max of 941 ms against `/api/v1/system/health`'s 116 ms and 375 ms, even
though CLAUDE.md describes both as "D1 probe + KV read". The monitoring variant additionally
pulls latency and error rate from Analytics Engine. That is the only Worker-side latency in
these measurements large enough to be worth chasing.

Requests ran in SIN (1,280), HKG (83) and SJC (15). The SJC ones are anycast routing
excursions to San Jose from a Taiwan client; they are a handful of samples and were not
correlated with failures. Colo is *not* where the Worker is pinned — there is deliberately no
`[placement]` block (see the #322 note at `apps/api/wrangler.toml:386`); the Worker runs at
the client edge.

### Tail coverage caveat

32 of my 1,372 `cf-ray` values never appeared in the tail stream. They cluster in two bands:
17:00:28–17:00:43 (tail was still attaching; it started 3 s after the sampler) and
17:10:12–17:10:20 (an apparent ~10 s gap in the stream). **Every one of those 32 requests
returned 200 or 401 to curl with exit code 0**, so none is a request that vanished at the
edge. The honest reading is that `wrangler tail` is a best-effort sampled stream that
dropped ~2.3% of events, which means the tail on its own cannot *prove* no exception ever
occurred — only that none occurred in the 97.7% it did report, and that no request curl saw
fail is missing from it.

## Code review

Read: `apps/api/src/index.ts`, `apps/api/src/app-factory.ts`, `apps/api/wrangler.toml`, the
scheduling templates POST and its service, the realtime-dashboard handler, both SSE
handlers, and every `waitUntil` call site in `apps/api`.

### Defect found and fixed — the only unguarded `waitUntil` in `apps/api`

`apps/api/src/features/menu/routes/index.ts:284` (pre-fix) handed a promise to
`executionCtx.waitUntil` with nothing to absorb a rejection:

```ts
c.executionCtx.waitUntil(service.incrementViewCount(id));
```

and `MenuService.incrementViewCount` (`apps/api/src/features/menu/services/MenuService.ts:795-806`)
logs and then **rethrows** at line 804. So a transient D1 write failure on the public
`GET /api/v1/menu/items/:id` read becomes an unhandled rejection, and the Workers runtime
reports the whole invocation as `outcome: "exception"` **after a 200 has already gone to the
client**. That is precisely the signal #325's hypothesis (1) was reaching for — an
`exception` outcome that does not correspond to any failed response.

This is the *only* such site. Every other `waitUntil` in the repo is already guarded, by one
of three established conventions:

- an explicit `.catch()` at the call site — `quotaGate.ts:182`,
  `monitoring/routes/overviewCache.ts:111`, `SemanticDiscoveryService.ts:156`,
  `system/routes/index.ts:414` (`runAfterResponse`)
- `Promise.allSettled` — `waiting-list/routes/index.ts:51`
- a try/catch inside the awaited method that never rethrows —
  `edge-cache.ts` (`populateCacheAPI`, `recordCacheMetric`), `analytics.ts`
  (`triggerPerformanceAlert`, `triggerSecurityAlert`), `geo-rate-limiting.ts`
  (`triggerSecurityAlert`), both order-sync closures, `AuthService.runInBackground`

Fixed by bringing the menu route into line with the rest:

```ts
c.executionCtx.waitUntil(
  service.incrementViewCount(id).catch(() => undefined),
);
```

Covered by a new test in `apps/api/src/features/menu/routes/index.test.ts` that captures the
promise handed to `waitUntil` and asserts it settles. Verified red before the fix
(`AssertionError: promise rejected "Error: D1_ERROR: database is locked" instead of
resolving`) and green after, with the other 44 tests in the file unchanged.

**This is not a claim that it caused #325.** The response has already been sent when the
rejection happens, so it cannot close a connection or fail a write, and none of the endpoints
#325 named touches this route. It is a real defect of the class the issue asked me to look
for, and it makes the `exception` outcome trustworthy as a signal next time someone tails
this Worker.

### Defects found and deliberately *not* fixed — both SSE handlers are dead code

`apps/api/src/features/analytics/routes/index.ts:540` (`GET /api/v1/analytics/sse`) and
`apps/api/src/features/kitchen/routes/index.ts:315` (kitchen SSE) both have genuine bugs:

- **Analytics SSE.** `cancel()` at line 647 is empty, so a client disconnect clears neither
  `heartbeatInterval` (line 578) nor `statsInterval` (line 596); only an `abort` listener and
  a **one-hour** `setTimeout(cleanup, 3600000)` at line 644 ever stop them. Until then the
  stats interval runs `getRealtimeData()` against D1 every 10 s. Worse, the `catch` inside
  that interval responds to a failed `controller.enqueue` by calling `controller.enqueue`
  again (line 625) — on a closed controller that throws a second time, inside an `async`
  `setInterval` callback, i.e. an unhandled rejection.
- **Kitchen SSE.** `stream.writeSSE(...)` inside `setInterval` (line 330) is async and is
  neither awaited nor `.catch()`ed, so the surrounding `try`/`catch` cannot see it; and the
  handler awaits a promise resolved only from a `c.req.raw.signal` abort listener (line 349)
  with no timeout at all.

I did not fix these, because **nothing reaches them**. The only consumer of
`useStatisticsSSE` is `apps/admin-dashboard/src/components/StatisticsDashboard.vue`, and that
component has zero references anywhere in the monorepo — it is never imported, routed to, or
dynamically loaded. `apps/kitchen-display` contains no `EventSource` and no reference to any
SSE path. Realtime is served by WebSockets through `apps/realtime` and its Durable Object
instead. Fixing unreachable code under an investigation issue would be blast radius without
a way to verify the result; it belongs in its own issue, alongside the question of whether
either endpoint should exist.

That also disposes of a tempting theory. A browser multiplexes an `EventSource` and every
other API call to the same origin onto **one** HTTP/2 connection, so a stream that dies badly
is a plausible route to errors appearing "across endpoints" at once. It cannot be the
explanation here, because no shipped client ever opens one.

### Everything else the issue asked about

- **Errors thrown after a response starts streaming.** The only streaming responses in
  `apps/api` are the two SSE handlers above. Every other route returns `c.json(...)` whole.
  `app.onError` (`apps/api/src/app-factory.ts:372`) is synchronous and cannot run after
  headers are flushed on a non-streaming response.
- **`Response` bodies consumed twice.** None. `smartCacheMiddleware` caches via
  `c.res.clone().json()` (`edge-cache.ts:551`), and `idempotency.ts:214-237` clones first and
  has an explicit, commented fallback to Hono's cached `c.req.json()` for the case where an
  upstream middleware already drained the body.
- **Large synchronous work / bcrypt in the request path.** Not on these paths;
  `cpuTime` p50 is 1–2 ms and never exceeded 249 ms. `inputSanitizationMiddleware`
  (`security.ts:100`) is a no-op that only calls `next()`.
- **Anything that closes the connection deliberately.** There is **no** `AbortController` and
  **no** `AbortSignal` anywhere in `apps/api/src`. The only `signal` references are the two
  SSE handlers *listening* for `c.req.raw.signal` abort, never firing one.
- **Realtime dashboard after `23158e36`.** The batching commit is in the deployed version
  (`efe1eb7b`, 2026-09-10, which is later than both `23158e36` on 2026-09-02 and the #322 /
  #323 / #324 work). Unauthenticated it returns 401 in a p50 `wallTime` of 3 ms, which
  exercises routing, the geo rate limiter and `onError` but **not** the D1 path the commit
  changed. See the limitations below.
- **Rate limiting is not in the path for three of the four endpoints.** `skipPaths` is
  matched with `path.includes(...)` (`geo-rate-limiting.ts:903`), so `/info`,
  `/api/v1/monitoring/health` and `/api/v1/system/health` all skip the geo limiter.
  `realtime-dashboard` does not skip it, and still answers in 3 ms, because it is enforced by
  the native rate-limit binding rather than the KV path.
- **Error-level logs.** 345 appeared in the tail. All 345 are my own unauthenticated
  `realtime-dashboard` probes: `app.onError` logs every `ApiError` at `console.error`,
  including a 401. There were no unexplained errors. (Logging a client auth failure at error
  level is arguably wrong, but it is not this issue.)

## Limitations — read before treating this as an all-clear

1. **One client, one network, one quiet hour.** Every sample came from a single machine in
   Taiwan (HiNet, AS17421) reaching SIN/HKG. Production served **no other traffic at all**
   during the window — all 1,385 tail events were mine plus 7 crons. #325 was reported from
   an *active admin dashboard session* with an authenticated user doing real work.
   Concurrency, authenticated routes, and POSTs with bodies were not exercised.
2. **Invocation-status counts are not available to me.** Item (2) of the issue asks for
   Cloudflare's aggregated `exception` / `exceededCpu` / `clientDisconnected` counts over the
   2026-09-03 window. `wrangler` here is OAuth-logged-in and there is no
   `CLOUDFLARE_API_TOKEN`, so the GraphQL Analytics API and the dashboard are both out of
   reach. **This is the single piece of evidence that could settle the question
   retrospectively**, and someone with dashboard access should pull it rather than sampling
   again.
3. **`realtime-dashboard` was not re-measured authenticated.** No credentials, and this
   investigation was read-only against production. The 401 path does not touch the 21-query
   → batched code the issue asks about.
4. **The idle-connection test covers 30-second gaps only.** A browser tab left alone for
   several minutes, then clicked, is a longer idle than anything measured here.
5. **`wrangler tail` dropped ~2.3% of events.** See the coverage caveat above.

## What would change the conclusion

- **Cloudflare's invocation-status counts for 2026-09-03** showing a non-zero
  `exception`, `exceededMemory` or `clientDisconnected` bucket. That would move this from
  "not reproduced" to "reproduced and explained", and would point at which of the three
  hypotheses was right.
- **A recurrence captured with `cf-ray` in hand.** If the browser's failed request carries a
  ray, it can be matched to a tail event — or to the *absence* of one, which would be the
  first direct evidence of an edge-side termination before the Worker ran. Whoever hits this
  next should grab the ray from the Network panel before anything else.
- **A recurrence from a different network.** Both failures today were on connections with
  ~900 ms RTT. If the same symptom appears from a client whose `clientTcpRtt` is normal, the
  network explanation collapses and the edge or the Worker comes back into scope.
- **An idle-connection probe at 5–15 minute gaps** showing the edge dropping the connection.
  That would restore the keep-alive race as the explanation for the POST that failed once and
  succeeded on retry, which remains the single most characteristic detail in the original
  report and the one this investigation has least to say about.

## Files changed

- `apps/api/src/features/menu/routes/index.ts` — `.catch()` on the view-count `waitUntil`
- `apps/api/src/features/menu/routes/index.test.ts` — harness captures `waitUntil` promises;
  new test asserting the background write cannot reject

Verification: `pnpm exec vitest run src/features/menu/routes/index.test.ts` (45 passed) and
`pnpm exec turbo run typecheck lint --filter=./apps/api --concurrency=1` (6/6 tasks, exit 0).
