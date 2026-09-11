# The Worker cold-start floor on `api.makanmasak.com`

**Date:** 2026-09-12
**Related issue:** #323 (filed 2026-09-03, before #322 moved the Worker to APAC)
**Live version measured:** `efe1eb7b-f1a2-4ba8-8d2e-d756687c6bc4`, deployed 2026-09-10T04:12Z
**Status:** Premise confirmed and quantified. This investigation itself shipped no code —
every change small enough to belong to #323 was measured and rejected on its own numbers.
The one change large enough to matter was split out as #362 and **has since shipped**: see
[Fix (#362)](#fix-362--defer-module-scope-zod-construction) below.

## Summary

`GET /info` is a static handler that reads four `c.env` strings and returns JSON. It touches
no binding. Over **320 requests in 47 minutes**, its Worker-reported `wallTime` was
**strictly bimodal**: 290 samples (91%) answered in 0–4 ms, 30 samples (9%) took 20–159 ms
with a p50 of 50 ms and `cpuTime` equal to 96% of `wallTime`, and **nothing at all landed
between 5 ms and 20 ms**. End to end on a fresh connection the two groups are 0.54 s and
1.25 s at p50.

- **The cold path costs about half a second, and nine tenths of it is invisible to
  `wallTime`.** Isolate startup happens *after* the TLS handshake completes and *before* the
  handler runs, so it appears in neither `wallTime` nor `cpuTime`. Measured as
  `TTFB-after-TLS − wallTime` it is **395 ms at its floor and 607 ms at p50** on a cold
  isolate, against **87 ms and 105 ms** on a warm one — a gap of 462–502 ms whose
  distributions barely overlap.
- **The part that *is* in `wallTime` is Hono's route matcher.** Hono's `SmartRouter` does no
  work at registration time; the first `match()` replays every registered route into
  RegExpRouter and compiles the matcher. This Worker ends up with **2,330** entries in
  `app.routes` — routes and middleware from 51 feature modules, flattened — and that build is
  charged in full to whichever request arrives first in a new isolate. Reproduced locally
  against the shipped bundle: first request ~48–120 ms (median ~60), every later one ~1–3 ms,
  and a 404 to a nonexistent path absorbs it, so the cost is global rather than per-path.
- **The issue's own hypothesis about the bundle is half right and half wrong.** The bundle is
  large (2,325 KiB minified / 577 KiB gzip, 808 modules) and it does drive the cold start.
  But `@hono/swagger-ui` and `@hono/zod-openapi` contribute **zero bytes** — the whole
  `apps/api/src/openapi/` directory (14 files, 6,443 lines) is unreachable from the Worker
  entry and is tree-shaken away. There is no OpenAPI document built at import time.
- **What top-level init actually spends its time on** is zod. Of ~405 ms of module-scope
  *execution* (measured in Node against the unminified bundle), **~217 ms (54%) is
  constructing zod schemas** in the 36 modules under `features/*/schemas/` (34 of them named
  `validation.ts`). `createApp()` itself is only 12–22 ms of it.
- **Nothing in scope for this issue moves the needle.** Pre-building the router at module
  scope works (first request 73 ms → 14 ms locally) but is *net zero on the wire*, because
  startup is on the client's critical path too — it moves the cost, it does not remove it,
  and it spends part of the 400 ms startup budget that gates deploys. Lazy-importing fflate
  removes ~20 ms of module-scope execution but **grows** the bundle by 24.5 KiB. Adding
  `sideEffects: false` to the workspace packages saves 0.85 KiB. All three were built,
  measured, and reverted; the numbers are below.

**The premise of #323 holds after #322.** The 150 ms–1.1 s spread it reported is real and is
not the trans-Pacific hop: it is warm-versus-cold. The single lever with a large enough
effect to be worth pulling — deferring module-scope zod construction, which needs the feature
routers to mount lazily — is out of scope here and needs its own issue.

## Method

Read-only against production. No deploy, no D1 or KV write. Three things ran concurrently
for 47 minutes (2026-09-12 20:54:57–21:42:08 UTC):

| Probe | What it does | Why |
| --- | --- | --- |
| Round sampler | 10 rounds; 5 min idle, then 6 requests ~1.5 s apart | the design #323 asked for: idle, then a burst |
| Dense sampler | 260 requests, one every 8 s | enough samples to see the shape of the distribution |
| Tail | `wrangler tail --env production --format json` | `wallTime`, `cpuTime`, `outcome`, `cf.clientTcpRtt` |

Every request is `GET https://api.makanmasak.com/info` on a **fresh TCP+TLS connection**, so
`time_starttransfer − time_appconnect` ("TTFB after TLS") is comparable across all of them,
and `cf-ray` joins each curl sample to its tail event. Peak rate ~0.7 req/s, average
~0.06 req/s, well under the 2 req/s cap.

The round design turned out to be the wrong lens and the dense one the right one. Cold and
warm are not a function of *when* you ask — a colo has many machines, each with its own
isolate, and a fresh connection can land on any of them. Two requests 1.5 s apart routinely
straddle a cold and a warm machine. What separates them is not position in a burst but
`wallTime`, which is cleanly bimodal, so that is the classifier used throughout:
**cold = `wallTime` ≥ 15 ms**. Nothing in the whole run lands between 5 ms and 20 ms.

Local work used `wrangler deploy --env production --dry-run --outdir` (builds, never
uploads) plus esbuild's `--metafile`. The resulting bundle has no external imports beyond
six `node:` builtins, so it can be evaluated directly in Node — which is what the compile /
evaluate / first-request numbers below come from. Node's V8 is not workerd and the absolute
values are an upper bound; they are used only as **relative** measures, and each A/B was run
interleaved on the same machine.

## 1. Bundle

`pnpm exec wrangler deploy --env production --dry-run` reports:

| | raw | gzip |
| --- | --- | --- |
| `minify = true` (what ships) | **2,325.13 KiB** | **576.90 KiB** |
| `--minify false` | 4,854.24 KiB | 866.68 KiB |

808 input modules. The note at `apps/api/wrangler.toml:9` records 1,792 KiB / 453 KiB gzip
when minification was turned on; the bundle has grown **30%** since (and 21% gzip).

Top contributors, grouped from the esbuild metafile (bytes in output, minified):

| Group | KiB | share |
| --- | --- | --- |
| `packages/database` | 543.5 | 23.4% |
| `zod` | 334.2 | 14.4% |
| `drizzle-orm` | 81.8 | 3.5% |
| `hono` | 40.3 | 1.7% |
| `qrcode` | 28.6 | 1.2% |
| `semver` (pulled only by `jsonwebtoken`) | 27.3 | 1.2% |
| `bcryptjs` | 21.7 | 0.9% |
| `@makanmasak/ai-analytics` | 32.6 | 1.4% |
| `@makanmasak/utils` | 53.2 | 2.3% |
| `fflate` | 9.4 | 0.4% |
| `jsonwebtoken` | 12.1 | 0.5% |
| `apps/api`'s own 51 feature modules + middleware | 1,155.3 | 49.7% |

Coarsely: **npm 25.4%, workspace packages 24.9%, `apps/api` source 49.7%.** The largest
single `apps/api` feature is `market-checkouts` at 91.0 KiB; no single module exceeds 49 KiB.
There is no dominant blob to delete — it is a long tail.

Three things the issue asked about specifically:

- **swagger-ui / zod-openapi: 0 bytes.** `@hono/swagger-ui` and `@hono/zod-openapi` are
  declared dependencies of `apps/api` but nothing in the Worker graph imports them. The only
  importer is `apps/api/src/openapi/` (14 files, 6,443 lines), and **nothing outside that
  directory references it** — not `app-factory.ts`, not `index.ts`. It is dead code that
  costs typecheck and lint time but not one byte of bundle and not one millisecond of cold
  start. Deleting it is worth doing; it is not a cold-start fix.
- **i18n catalogs: 0 bytes.** Nothing from `@makanmasak/i18n` reaches this Worker.
- **bcryptjs: 21.7 KiB.** Real, small, and unavoidable while login runs here.

`packages/database` at 543.5 KiB is the one number worth staring at, and the obvious cheap
fix does not work: adding `"sideEffects": false` to `packages/database` and `packages/utils`
changed the bundle from 2,325.24 KiB to **2,324.39 KiB** — 0.85 KiB, i.e. esbuild was already
tree-shaking them effectively. What is in the bundle is genuinely reachable.

## 2. Top-level init

`apps/api/src/index.ts:11` calls `createApp()` once at module scope. There is no second call
and nothing to memoise — the "is `createApp` memoised per isolate?" question resolves to
"there is only ever one call per isolate already".

Measured in Node against the bundle produced by wrangler, with `vm.SourceTextModule` so that
compile and evaluate can be separated (median of 5, machine otherwise idle):

| Phase | ms |
| --- | --- |
| compile (parse the 2,325 KiB minified bundle) | 73 |
| compile (unminified, 4,854 KiB) | 90 |
| **evaluate (run every module's top level)** | **405–460** |
| — of which `createApp()` itself | **12–22** |

So route registration is *not* the expensive part of startup. Attributing the evaluate phase
per module (probes inserted at esbuild's module-boundary comments in the unminified build,
87 probes so the instrumentation itself is negligible):

| What | ms | share of evaluate |
| --- | --- | --- |
| `src/features/*/schemas/*.ts` — 36 modules, zod schemas built at module scope | **~217** | **54%** |
| `src/app-factory.ts` module body (two largest of its five emitted fragments) | ~72 | 18% |
| `fflate` (builds its Huffman tables at import) | 20–25 | 5% |
| `src/index.ts` (i.e. the `createApp()` call) | 12–17 | 4% |
| everything else (`packages/*` ≈ 2.6 ms, unenv ≈ 0.1 ms, 800 other modules) | remainder | |

The heaviest individual schema files are `qr-codes` (24 ms), `orders` (20), `menu` (21),
`partnerships` (22), `tables` (30 at worst), `scheduling` (16), `restaurants` (14),
`markets` (16), `authentication` (16) — 7,174 lines of source across the 36 files, which
esbuild tree-shakes down to 108 KiB in the bundle. Every one of them is evaluated on every
cold start, because each feature's `routes/index.ts` imports its schemas at module scope and
`app-factory.ts` imports all 51 features at module scope
(`apps/api/src/app-factory.ts:37-123`).

What is *not* there, having been looked for:

- No `JSON.parse` of embedded data at module scope anywhere in `apps/api/src`.
- No OpenAPI/Swagger document generated at import time (the generator is unreachable, above).
- No large constant tables. The biggest are three `Set`s in
  `apps/api/src/middleware/geo-rate-limiting.ts:181,195,207` (high-risk countries, bot ASNs,
  trusted ASNs) and two in `apps/api/src/app-factory.ts:139-144`; together they are noise.
- No service singletons constructed at module scope. The `new` calls at module scope are
  `new Hono()` per feature router and a handful of `ConsoleLogger`s.
- `packages/database` contributes 543 KiB of *compile* and 2.6 ms of *execute*. It is a
  parse-time cost, not an init-time one.

### The one-time cost that lands inside `wallTime`

Separately from module evaluation, the **first request** in each isolate costs ~48–120 ms
against ~1–3 ms for every request after it. It is global, not per-path — routing a 404 to
`/zzz-nope` first makes the following `/info` cost 2.3 ms:

```
moduleEval=478.2ms
GET /zzz-nope              -> 404  53.8ms
GET /info                  -> 200   2.3ms
GET /info                  -> 200   1.9ms
GET /api/v1/monitoring/health -> 503  11.3ms
POST /api/v1/auth/login    -> 400   5.0ms
```

That is Hono's `SmartRouter`. It buffers `[method, path, handler]` on `add()` and does the
real work on the first `match()`: replay every route into RegExpRouter, compile, then rebind
its own `match` to the concrete router (`hono/dist/router/smart-router/router.js`). With
2,330 registrations it is a ~50 ms job, and it is charged to a request.

## 3. Cold versus warm in production

320 requests, 20:54:57–21:42:08 UTC. All 320 returned `200` with curl exit 0; all 323 fetch
events in the tail (plus 12 crons) reported `outcome: "ok"`. Every one of the 320 samples
joined to its tail event by `cf-ray` — no coverage gap this time. 312 landed in SIN, 8 in SJC.

### `wallTime` is bimodal, and the valley is empty

| `wallTime` bucket | samples |
| --- | --- |
| 0–2 ms | 217 |
| 2–5 ms | 73 |
| **5–20 ms** | **0** |
| 20–30 ms | 3 |
| 30–40 ms | 9 |
| 40–60 ms | 5 |
| 60–80 ms | 2 |
| 80–120 ms | 3 |
| 120–200 ms | 8 |

Percentiles across all 320: p50 1, p75 2, p90 4, p95 43, p99 142, max 159 ms. Splitting at
the empty valley (cold = `wallTime` ≥ 15 ms):

| | n | `wallTime` p50 | mean | max | `cpuTime` p50 | `cpuTime`/`wallTime` |
| --- | --- | --- | --- | --- | --- | --- |
| cold | 30 (9%) | **50 ms** | 71.4 | 159 | 49 ms | **0.96** |
| warm | 290 (91%) | **1 ms** | 1.2 | 4 | 1 ms | 0.83 |

`cpuTime ≈ wallTime` on the cold group is the tell: this is compute, not I/O, in a handler
that performs no I/O at all. Roughly 50 ms of pure CPU that a warm isolate does not spend.

### The much larger term is before the handler runs

Every request here paid its own TCP and TLS handshake, so `time_starttransfer −
time_appconnect` is comparable across all 320, and subtracting the Worker's own `wallTime`
leaves everything between "TLS finished" and "the handler started" — dispatch, isolate
creation, script fetch, compile, top-level evaluation, and one network leg.

| pre-handler residual (ms) | min | p25 | p50 | p75 | p90 | max |
| --- | --- | --- | --- | --- | --- | --- |
| cold (n=30) | **395** | 510 | **607** | 791 | 896 | 1357 |
| warm (n=290) | 87 | 98 | **105** | 119 | 298 | 966 |

Delta of medians **502 ms**; restricted to SIN to remove the anycast excursions, **462 ms**
(cold n=23 p50 567, warm n=289 p50 105). The floors differ by 308 ms, which is the
conservative reading: even the luckiest cold request paid 4.5× the warm median before its
handler started.

This cannot be blamed on the network. The two groups' connection legs are
indistinguishable — cold TCP p50 0.307 s / TLS p50 0.216 s, warm 0.289 s / 0.128 s — and the
separation is an order of magnitude larger than the jitter in either.

**No isolate was ever pre-warmed.** If Cloudflare started the isolate during the TLS
handshake for this Worker, there would be samples that pay the router build but not
startup — high `wallTime`, low residual. There were **0 of 30**; every cold sample's residual
was ≥ 395 ms. This is the observation that decides section 4.

### What the round design actually showed

The design #323 asked for — idle ≥ 5 minutes, then one request plus five follow-ups — rests
on a premise that turns out to be false. A colo has many machines, each with its own isolate;
a fresh connection can land on any of them. Cold is not a function of position in the burst:

| round | first request after 5 min idle | #2 | #3 | #4 | #5 | #6 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 31 ms **cold** | 35 ms **cold** | 43 ms **cold** | 121 ms **cold** | 40 ms **cold** | 1 ms |
| 2 | 2 ms | 115 ms **cold** | 1 ms | 1 ms | 33 ms **cold** | 53 ms **cold** |
| 3 | 2 ms | 1 ms | 1 ms | 1 ms | 3 ms | 2 ms |
| 4 | 2 ms | 0 ms | 1 ms | 2 ms | 2 ms | 32 ms **cold** |
| 5 | 1 ms | 2 ms | 1 ms | 1 ms | 3 ms | 2 ms |
| 6 | 1 ms | 0 ms | 1 ms | 1 ms | 1 ms | 1 ms |
| 7 | 1 ms | 1 ms | 1 ms | 1 ms | 4 ms | 0 ms |
| 8 | 2 ms | 2 ms | 1 ms | 1 ms | 1 ms | 0 ms |
| 9 | 1 ms | 1 ms | 142 ms **cold** | 2 ms | 1 ms | 1 ms |
| 10 | 42 ms **cold** | 1 ms | 60 ms **cold** | 35 ms **cold** | 1 ms | 1 ms |

Only 2 of 10 "first requests after idle" were cold, while cold requests appeared at every
position. Rounds 3 and 5–8 were entirely warm after five minutes of silence — isolates here
survive a 5-minute idle far more often than not. The per-round residuals track the same
split exactly: round 9's third request (142 ms `wallTime`) had a residual of 641 ms while its
neighbours sat at 102–111 ms.

The right way to sample this is what the dense probe did: hammer fresh connections and read
the bimodality out of `wallTime`. Note that doing so *suppresses* the effect — the cold
fraction fell from 33% in the first 60 samples to 9% over 320, because the probe itself kept
isolates alive. The 9% is a lower bound for an idle Worker, not a forecast.

### Putting it together

| | warm | cold | difference |
| --- | --- | --- | --- |
| isolate startup (pre-handler residual, minus the warm baseline) | — | ~460–500 ms | **~460–500 ms** |
| Hono route-matcher build (inside `wallTime`) | — | ~50 ms | **~50 ms** |
| handler | ~1 ms | ~1 ms | — |
| **end to end on a fresh connection, p50** | **0.536 s** | **1.250 s** | **0.714 s** |

Uncertainty: the residual is a client-side subtraction, so it carries the last mile's noise —
`clientTcpRtt` p50 was 186 ms (cold) and 102 ms (warm), and the client machine was at load
average 6 on 4 cores. Those move the estimate by tens of milliseconds, not hundreds. What
makes the ~500 ms trustworthy is that the two distributions are nearly disjoint (a cold
minimum of 395 ms against a warm p75 of 119 ms) and that the split is defined by a
*server-side* number, `wallTime`, which no
amount of client noise can shift. The uncertainty on "cold start costs about half a second"
is roughly ±100 ms; the uncertainty on "cold start is much larger than 50 ms" is nil.

This also explains #325's reading of the same endpoint. That investigation measured `/info`
`wallTime` at p50 1 ms and concluded the Worker contributes nothing — true at p50, and its
own data carries the counter-evidence at `max 217 ms`. It was sampling at ~1 req/s, which
keeps isolates warm; the p50 is a warm p50.

## 4. Decision

The issue asked: if the cold-start delta is under ~50 ms and the bundle is modest, say so and
stop; otherwise make the smallest change with the largest effect. The delta is ~500 ms and
the bundle is 2.3 MB, so the second branch applies — but **every change small enough to
belong to this issue fails on its own measurements.** Three were built and reverted:

### Rejected: pre-build the route matcher at module scope

A 40-line module (`core/router-warmup.ts`) calling `app.router.match("GET", "/info")` once
after `createApp()`, with five unit tests (verified red first: stubbing the call out failed
2 of 5). It works exactly as intended, interleaved A/B over 6 runs of the shipped bundle:

| | first `GET /info` in the isolate | module eval |
| --- | --- | --- |
| before | 53.4, 65.8, 82.6, 59.6, 80.4, 119.6 ms (median ~73) | 489–740 ms |
| after | 11.0, 14.3, 13.2, 18.8, 14.5, 32.8 ms (median ~14) | 580–1167 ms |

Bundle cost: +0.11 KiB. So it removes ~59 ms from the first request — and adds the same
~55–90 ms to module evaluation.

**It was reverted because the production data says that is a wash.** Isolate startup is not
free: it sits on the client's critical path after the TLS handshake (section 3). Moving 53 ms
from the `wallTime` bucket into the startup bucket changes which number reports it, not what
the user waits for. It has two costs and no benefit:

- it spends ~55 ms of the **400 ms startup-time limit** Cloudflare enforces at upload, on a
  Worker whose startup is already the dominant term — a deploy that trips that limit fails;
- it deletes the observability signal. The bimodal `wallTime` is *how this cold start was
  found*. Flattening cold `wallTime` to 1 ms would hide a 500 ms problem.

The discriminating check, because this is the fix everyone will propose next: if Cloudflare
ever pre-warmed isolates ahead of a request, there would be requests that pay the router
build but not startup — high `wallTime`, low residual. Across the whole run there were
**zero** such samples (see section 3). Startup and the router build always arrive together.

### Rejected: lazy-import `fflate`

`apps/api/src/features/qr-codes/services/QrCodesService.ts:17` imports `fflate` statically for
one method (`renderBatchArchive`, bulk QR zip). Moving it to `await import("fflate")` inside
that already-`async` method removes ~20 ms from module evaluation — but the bundle went from
2,325.13 KiB to **2,349.67 KiB (+24.5 KiB, +7.7 KiB gzip)**, because esbuild has to keep the
module in an `__esm` wrapper instead of inlining and shaking it. The note at
`apps/api/wrangler.toml:9` already established that this Worker's cold start is compile-bound
rather than fetch-bound, so trading 20 ms of execute for 24.5 KiB of extra parse is not
obviously positive, and a 5% effect could not be separated from noise on a machine at load
average 6. Reverted.

### Rejected: `sideEffects: false` on the workspace packages

2,325.24 KiB → 2,324.39 KiB. Reverted.

### Not attempted here: the one that would actually work

**Defer module-scope zod construction.** It is 54% of module evaluation — the single largest
attributable item in the whole startup path, several times larger than anything else on this
list. It cannot be done in a small diff: the schemas are built at module scope because each
feature's routes import them at module scope and `app-factory.ts` imports all 51 features at
module scope, so deferring them means the feature routers mount lazily. That is the refactor
this issue deliberately excludes, and it should carry its own issue with its own measurement.
The number to beat is in section 2: ~217 ms of ~405 ms.

Two smaller follow-ups, neither a cold-start fix:

- Delete `apps/api/src/openapi/` (14 files, 6,443 lines, zero references) and the
  `@hono/swagger-ui` / `@hono/zod-openapi` dependencies with it. Saves nothing at runtime;
  saves typecheck, lint and reader time, and stops the issue tracker rediscovering "the
  swagger blob" every few months.
- `semver` is in a Workers bundle only because `jsonwebtoken` feature-detects Node's crypto
  key-details support with it. 27.3 KiB for three `satisfies()` calls that always answer the
  same thing on workerd.

## Fix (#362) — defer module-scope zod construction

Shipped on `fix/362-lazy-feature-mount`. The number section 2 named to beat was ~217 ms of
~405 ms of module evaluation.

### Mechanism: `z.lazy`, not lazy mounting

Section 4 assumed deferring the schemas "means the feature routers mount lazily". It does
not. `z.lazy(() => z.object({...}))` is a cheap placeholder — zod 4 runs the thunk on the
first `parse()` and caches the result on the shared `def` — and every validator in
`middleware/validation.ts` takes `z.ZodTypeAny`, so the schema can stay exactly where it is
and the mounting in `app-factory.ts` never changes. Measured cost of the wrapper itself, cold
and un-JITted: 200 eager 13-field objects cost 304 ms to build, 200 `z.lazy` wrappers cost
2.2 ms — the wrapper defers ~99% of construction.

482 schemas across 63 files were wrapped: module-scope consts under `features/*/schemas/`,
the same in route modules, inline schemas handed straight to
`validateBody`/`validateQuery`/`validateParams`, and two members of `commonSchemas`.

Two boundaries fell out of the mechanism rather than being chosen:

- **A schema something composes from stays eager.** `ZodLazy` carries only the shared
  `ZodType` surface, so `.extend()` / `.pick()` / `.omit()` / `.merge()` / `.partial()` /
  `.shape` and the per-type refinements (`.max()`, `.int()`, ...) are not on it. TypeScript
  rejects the wrap, which is how the boundary was found rather than guessed: wrapping
  everything indiscriminately produced 97 compile errors, and walking them back — including
  the ones that only surfaced downstream, where a broken `...schema.shape` spread turned a
  route handler's `validatedQuery` into `unknown` — is what produced the exclusion rule.
  `z.infer<typeof schema>` is identical through the wrapper, so no consumer type moved.
- **`src/contracts/` is excluded.** It contributes zero bytes to the Worker bundle, so
  wrapping it buys nothing — and it would have been actively harmful: the `lazy` case in
  `scripts/check-api-contracts.cjs` recurses into `def.getter()` while discarding the
  `|null` / `?` suffix it accumulated on the way in, so a wrapped response schema silently
  reports `object|null` as `object`. That latent bug is worth fixing before anyone lazifies
  a contract schema; it is untouched here because nothing reaches it.

### Numbers

Node against the bundle wrangler builds, same method as section 2, interleaved A/B in one
process over 11 rounds so both bundles see the same machine, median:

| | before | after | delta |
| --- | --- | --- | --- |
| **module evaluate** | **473.4 ms** | **246.0 ms** | **−227.4 ms (−48.0%)** |
| compile | 144.1 ms | 143.4 ms | within noise |
| bundle (minified) | 2338.11 KiB | 2343.76 KiB | +5.65 KiB (+0.24%) |
| bundle (gzip) | 580.32 KiB | 580.98 KiB | +0.66 KiB |

That run landed at load average 4, and its `before` reproduces section 2 (473 ms against
405–460 ms, 144 ms compile against 73 ms — Node's V8 on a busier laptop, same shape). Two
earlier runs of the same A/B at load average 8–26 read 1067.5 → 559.9 ms and 892.3 → 494.3 ms:
the absolute values roughly double under load but the ratio does not move — −47.6%, −44.6%,
−48.0% across three independent runs. The ratio is the measurement.

Compile is unchanged, which is worth stating plainly: this removes *execution*, not bytes. The
bundle grows 5.65 KiB because 482 schema expressions each gained a closure, and the note at
`apps/api/wrangler.toml:9` about this Worker being compile-bound still stands — `z.lazy` does
nothing for that term.

What moves onto the request path is ~1 ms, once per schema, and only for schemas a request
actually reaches: first `POST /api/v1/auth/login` with a bad body 14.2 → 15.2 ms, second call
4.7 → 4.9 ms. The `SmartRouter` first-`match()` build is a separate term and is untouched
(111.0 → 113.3 ms) — which also confirms the two costs really are independent.

Evidence that behaviour did not move: 2783 unit tests in `apps/api` pass, `pnpm
contract:check` reports no contract change, and a 30-case differential replayed against both
bundles in the same harness — 14 of them 400s straight out of the validators — returns
identical status codes and identical error payloads down to the `details` field lists. The
only two responses that differ are `/system/health` and `/monitoring/health`, in their
timestamps and latency numbers.

**Record `Worker Startup Time` from the next deploy in #362.** `wrangler` prints it on upload
and the platform rejects above 400 ms; limitation 4 below is still open, and this change is
the first thing that should have moved it.

### Assessed and not shipped: per-prefix lazy mounting

The other candidate for #362 was replacing `apiV1.route("/menu", menuFeature.routes)` with a
proxy that imports the feature on first hit. It was measured and then rejected on three
findings, in that order.

**The headroom is real but smaller than it looks.** A bundle with 50 of the 51 features
stripped out of `app-factory.ts` (orders left resident, i.e. the best case a lazy mount could
reach for a request that touches one prefix) evaluates in 247.7 ms against the shipped
547.7 ms on the same machine and in the same interleaved run — so ~300 ms, or 55% of what remains after `z.lazy`. But most of that is
*moved*, not removed: the first request to each prefix pays that feature's evaluation inside
`wallTime`, and section 4 already established that moving cost between startup and the first
request is a wash on the wire because startup is on the client's critical path too. Only the
features an isolate never touches are genuinely saved. Compile would not improve either — the
code still ships, wrapped in esbuild `__esm` closures, which the fflate experiment showed
*grows* the bundle.

**It cannot preserve `hasConcreteApiRoute`.** The middleware at `app-factory.ts:666` answers
404 by scanning `apiV1.routes` — the flattened registration table — and
`hasConcreteApiRoute` (`app-factory.ts:192-210`) explicitly skips `route.method === "ALL"`.
A lazy wrapper registered as `apiV1.all("/menu/*", proxy)` is therefore invisible to it and
every request to a lazily-mounted prefix 404s; registered with explicit methods, its
`"/menu/*"` pattern matches everything under the prefix, so `GET /api/v1/menu/does-not-exist`
stops returning `ROUTE_NOT_FOUND`. Either way a route's behaviour changes, which is the one
thing #362 was not allowed to do. Preserving it needs a build-time route manifest per
feature — a much larger change with a new failure mode (manifest drift).

**A sub-app gets a fresh context, and both halves of that were reproduced.** With
`sub.fetch(c.req.raw, c.env, ...)`, a feature that reads `c.get("user")` sees `null` where the
eager mount sees the value `optionalAuth` set, and the parent's `onError` never runs — the
sub-app answers `500 Internal Server Error` as plain text instead of the unified
`{success:false,error:{code,message}}` envelope. That matters here because the prefix-level
middleware in `app-factory.ts` is where a lot of authorization lives:
`apiV1.use("/restaurants/*", optionalAuth)`, `"/menu/*"` the same, and
`authMiddleware` on `/pos/*`, `/payments/*`, `/users/*`, `/analytics/*`, `/ai-analytics/*`,
`/system/*`, `/cache/*`, `/monitoring/*`, `/backup/*`, `/leaves/*`, `/scheduling/*`,
`/forecast/*`, `/ingredients/*`, `/feedback/*`, `/notifications/*`, `/partnerships/*`,
`/admin/*`. The full set of variables that would have to be forwarded is `user` (320 reads),
`validatedParams` (276), `validatedBody` (213), `validatedQuery` (102), `customer` (38),
`backupController` (13), `requestId` (5), `tenant` (3), `guestOrder` (3), `guestSession`,
`requestTimestamp`, `healthStatus`, `analytics`. Hono offers no supported way to seed a
sub-app's `Variables`, so every one of those would ride on bespoke plumbing where a missed
key is a silent authorization bug. Two smaller hazards confirmed alongside: Hono throws if
`route()` is called after the matcher is built (so "register on first request" is not
available), and `c.executionCtx` throws when the runtime did not supply one, so a wrapper
cannot pass it through unconditionally.

Shared prefixes are a fourth constraint that survives all of the above — `/restaurants` is
restaurants + members + reviews.publicRoutes, `/orders` is orders + group-orders +
reviews.orderRoutes, `/auth` is auth + verification, `/admin/*` is four routers — and the
comment at `app-factory.ts:686-698` records why the registration order of the orders mounts
is load-bearing.

## Limitations — read before treating this as settled

1. **One client, one network, one hour.** Every sample came from a single machine in Taiwan
   reaching SIN (and a handful of anycast excursions to SJC). Production served essentially
   no other traffic during the window, which is *why* cold isolates were easy to hit — and
   also means the 9% cold rate measured here describes an idle Worker under a probe that was
   itself keeping isolates alive. It is not a forecast for a busy one, in either direction.
2. **The client machine was loaded.** Load average reached 6.3 on 4 cores (a second agent
   shares it). That inflates client-side timings, but it inflates cold and warm samples
   alike, and the cold/warm residual distributions are disjoint by more than 300 ms — far
   above scheduling jitter. The `wallTime` classifier is server-side and immune.
3. **Node is not workerd.** Every compile/evaluate/first-request number in sections 1, 2 and
   4 is Node's V8 on a laptop. They are used as relative measures and each A/B was
   interleaved. The one place a Node number is quoted against a production one — ~405 ms of
   module evaluation versus ~500 ms of measured startup — is flagged as coincidence-shaped
   agreement, not proof.
4. **Cloudflare's own startup-time number was never read.** `wrangler` prints
   `Worker Startup Time: N ms` on upload, and the platform rejects above 400 ms. This
   investigation could not upload, and `wrangler versions view` does not report it. **That
   single number would settle how close this Worker is to the limit**, and is the first
   thing whoever deploys next should paste into #323.
5. **`/info` only.** Endpoints that touch D1 or KV add their own latency on top of
   everything measured here; the cold-start term is the same for all of them, but the ratio
   is not.
6. **The router-build attribution is inferred, not instrumented.** It rests on the shape
   (one-time, global, absorbed by any first request, ~50 ms) matching `SmartRouter`'s
   documented behaviour exactly. No profiler was run inside workerd.

## What would change the conclusion

- **`Worker Startup Time` from the next real deploy.** If it is comfortably under 400 ms,
  pre-building the router becomes cheap to reconsider — though still net-zero on the wire.
  If it is near 400 ms, that is an independent reason to cut module-scope work urgently.
- **Evidence that Cloudflare overlaps isolate startup with the TLS handshake for this
  Worker.** This run found none: 30 of 30 cold samples paid a ≥ 395 ms pre-handler residual,
  and no sample paid the router build without it. A run that finds even a few would reopen
  the pre-build question.
- **A measurement from a client with a good last mile.** Cold and warm are separated here by
  ~500 ms against a ~100 ms warm baseline, so the conclusion does not depend on the network
  — but a European or US client would tighten the error bars on the residual.
- **Real traffic.** Everything here describes a Worker that is idle enough for isolates to be
  evicted between requests. Once ordering traffic is continuous, the cold fraction is what
  matters, and it is not measurable from an idle production environment.

## Files changed

The investigation itself shipped the document only; the three code changes in section 4 were
built, measured and reverted, and their numbers are there.

The #362 fix that followed changed 63 files under `apps/api/src` — 482 module-scope zod
schemas wrapped in `z.lazy`, plus the convention note at the top of
`apps/api/src/middleware/validation.ts` that explains to the next contributor when to wrap and
when not to.
