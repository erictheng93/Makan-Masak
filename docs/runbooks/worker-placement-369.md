# Worker placement investigation (#369)

Status: instrumentation and measurement procedure prepared; no placement change
or production acceptance is implied by this document.

Issue: <https://github.com/erictheng93/Makan-Masak/issues/369>.

## Telemetry contract

`advancedAnalyticsMiddleware` writes `api_request` to the production dataset
`makanmasak-metrics-prod`. Existing positions are unchanged:

| Column | Meaning |
| --- | --- |
| blob4 | Country: runtime `request.cf.country`, then CF-IPCountry, then unknown |
| blob8 / blob9 / blob10 | Endpoint / method / status code |
| double2 | Middleware elapsed milliseconds, including downstream waits |
| blob16 | Ingress colo from `request.cf.colo`, or unknown |
| blob17 | ASN from `request.cf.asn`, or unknown |
| blob18 | Advisory `cf-placement` request header (`local-XXX` / `remote-XXX`), or unknown |
| blob19 | `probe` for User-Agent starting `MakanMasak-Placement-Probe/369`, otherwise `organic` |
| blob20 | Response X-Cache value, or unknown |

These are the final five available blob slots (20 total). Do not insert columns
or add another index: the single sampling index remains restaurant ID. Other
event types default these fields to unknown. Old rows have no new fields; exclude
them explicitly rather than treating them as organic or as zero-latency samples.

The probe label is client-controlled and is only a measurement convention.
Likewise, a well-formed placement header is not proof of execution location:
correlate with Cloudflare execution telemetry. Missing placement metadata means
unknown, not local. Do not infer execution location from cf-ray or ingress colo
after placement is enabled. The middleware runs after early security/rate-limit
checks, so this dataset is not an inventory of every request reaching the edge.

`double2` and X-Response-Time are different timing scopes. The global metrics
middleware overwrites the orders feature's timing header on the normal application
path. Neither metric includes all cold-start or client networking overhead, and
neither isolates D1 latency. Compare each metric only against itself.

## Baseline collection

1. Run `pnpm verify`, the targeted analytics tests, and
   `pnpm --filter @makanmasak/api run build:prod`. Deploy the observation-only API
   change through the normal release process. Record commit, version, UTC time,
   bundle size and upload-reported Worker Startup Time.
2. Verify newly written points have country, blob16/17 and blob19. Verify a marked
   probe is excluded from organic results. A local unit test cannot prove the
   production binding/SQL permissions or runtime metadata work.
3. Collect seven days of organic traffic. Run `worker-placement-369.sql` through
   the Analytics Engine SQL API or console. Its two statements are separate
   queries: the first measures distribution including failures; the second
   measures successful latency and separates cache states. The token needs
   Account Analytics Read. All counts/quantiles are sampling-weighted.
4. Record the start/end window, request counts, unknown-country/colo coverage,
   country/ASN/colo distribution and endpoint p50/p95. No TW rows means no evidence,
   not proof that Taiwanese routing is healthy. Seven days with very few samples
   still requires explicitly qualified conclusions.

## Repeatable client measurements

Use a dedicated QA account and a fixed restaurant/dataset. Obtain its token once;
logging in again invalidates its existing sessions, so do not use an account
currently doing browser QA. Never commit the token or raw response bodies.

Run from HiNet, a second Taiwan ISP, and Malaysia, with VPN/proxy state recorded.
Repeat at different times. Use the same origin, endpoint, token/account, restaurant,
dataset, interval and connection policy before and after. Start with `/info`, then
the following authenticated endpoints (substitute the same RID each time):

- `/api/v1/orders?restaurantId=RID&limit=20`
- `/api/v1/analytics/realtime-dashboard?restaurantId=RID`

The following Bash procedure samples **one endpoint per run**, with five warmup
requests and 30 measured requests. Change ENDPOINT and RUN_LABEL for each run.
Each curl process makes a new client connection; warmup only attempts to warm the
Worker and caches and does not prove isolate reuse. Do not label a request cold
solely because it followed a pause. Browser connection reuse needs its own cohort.

```bash
umask 077
ORIGIN=https://api.makanmasak.com
ENDPOINT='/api/v1/orders?restaurantId=RID&limit=20'
RUN_LABEL=before-hinet-orders
read -r -s -p 'Dedicated QA bearer token: ' PROBE_TOKEN; echo
# JWT characters only: keep the token out of curl argv and reject config injection.
[[ "$PROBE_TOKEN" =~ ^[A-Za-z0-9_.-]+$ ]] || exit 1
OUT=$(mktemp -d "${TMPDIR:-/tmp}/placement-369.XXXXXX")
printf 'phase,index,utc,curl_exit,http_status,dns_s,tcp_s,tls_s,ttfb_s,total_s\n' > "$OUT/timings.csv"
for i in $(seq 1 35); do
  phase=measured
  [ "$i" -le 5 ] && phase=warmup
  stamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  printf '%s,%s,%s,' "$phase" "$i" "$stamp" >> "$OUT/timings.csv"
  timing=$(printf 'header = "Authorization: Bearer %s"\n' "$PROBE_TOKEN" |
    curl -q --config - --silent --show-error --connect-timeout 10 --max-time 30 \
      --user-agent "MakanMasak-Placement-Probe/369 $RUN_LABEL" \
      --dump-header "$OUT/$i.headers" --output /dev/null \
      --write-out '%{http_code},%{time_namelookup},%{time_connect},%{time_appconnect},%{time_starttransfer},%{time_total}' \
      "$ORIGIN$ENDPOINT" 2> "$OUT/$i.error")
  result=$?
  printf '%s,%s\n' "$result" "$timing" >> "$OUT/timings.csv"
  sleep 1
done
unset PROBE_TOKEN
printf 'Evidence directory: %s\n' "$OUT"
```

Do not use `--location`, retries or `--fail`: redirects, transport errors, 401s,
429s and 5xx must remain visible rather than becoming misleading fast successes.
Do not add random query parameters assuming they bypass all caches. Record
X-Cache and endpoint-level caching separately; compare like-for-like cohorts.
Raw header files can contain cookies: keep them private and publish only selected
headers (cf-ray, cf-placement if present, x-response-time, x-cache, x-request-id).

Summarize the measured cohort: total attempts, transport failures, counts by HTTP
status, then p50/p95 of TTFB and X-Response-Time **only for transport-successful
HTTP 200 responses**. At least 30 successful samples per condition are needed;
keep failed attempts in the report when extending a run. Timing values in CSV are
cumulative seconds from curl start, not individual DNS/TCP/TLS phase durations.
Convert to milliseconds before comparing with X-Response-Time. Missing timing
headers are missing data, never zero. Use nearest-rank percentiles and state n.

Record `/cdn-cgi/trace` colo/loc separately without publishing its IP field. A
separate trace request need not enter the same colo as a business request. For
D1 diagnosis use `/api/v1/system/health` (without `deep=1`) and retain only the
database probe elapsed time and servedByPrimary/servedByRegion fields. Those are
probe measurements, not a breakdown of the orders/dashboard request. Confirm
current D1 serving colo via controlled provider telemetry before choosing Tokyo;
the old NRT observation is not a permanent location guarantee.

## Placement experiment and decision

After enough baseline evidence, test only the API Worker with:

```toml
[env.production.placement]
region = "aws:ap-northeast-1"
```

Keep all other code, datasets and cache settings constant. Do not enable Smart
Placement or read replication in the same experiment. Region hints choose a
Cloudflare location near the named cloud region, not a guaranteed NRT machine
or the same physical location as D1. Check actual execution telemetry and whether
the request-side cf-placement header is available for explicit hints; curl is not
guaranteed to receive a response copy.

Record both deployments and observation windows. Suggested acceptance rules,
fixed before the experiment:

- Warm successful HiNet/SJC orders X-Response-Time p50 <150 ms, with p95 reported.
- Both orders and dashboard TTFB improve for the affected cohort; report their
  absolute p50/p95 and sample sizes. A lower Worker duration alone is insufficient.
- Other Taiwan and Malaysia cohorts: no >10% TTFB p50/p95 regression, and no new
  functional/transport failures. Repeat borderline results across time windows
  before deciding; 30 samples are diagnostic, not statistical proof of reliability.
- Organic traffic corroborates the result where available. Clearly identify
  insufficient volume and any SJC condition that could not be reproduced.
- Record startup time without conflating it with request cold-start latency.
  Cloudflare's current startup limit is 1 second; 400 ms may remain a stricter
  internal target, but is not the current platform limit.

If worse, remove only the placement block and redeploy, retaining observation
fields. Record the rollback version and repeat the same probes. Do not roll back
unrelated releases just to revert placement.

Close #369 only with deployment/version evidence, before/after results, actual
placement evidence, sample/coverage limitations and a rollback recipe. The
instrumentation commit alone does not close it. If D1 gets faster but business
latency remains high, profile auth/KV/serial queries next. If residual latency is
client-to-ingress, provide sanitized Ray IDs, timestamps and ISP details to
Cloudflare; placement cannot remove that network leg.

Sources checked during the investigation:

- <https://developers.cloudflare.com/workers/configuration/placement/>
- <https://developers.cloudflare.com/changelog/post/2025-10-10-increased-startup-time/>
