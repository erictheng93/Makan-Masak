-- Run each statement separately against the Analytics Engine SQL API.
-- Distribution includes failures; do not derive routing share from 200s alone.
SELECT
  blob4 AS country,
  blob16 AS ingress_colo,
  blob17 AS asn,
  blob19 AS traffic_type,
  SUM(_sample_interval) AS requests,
  SUM(IF(blob10 LIKE '4%', _sample_interval, 0)) AS client_errors,
  SUM(IF(blob10 LIKE '5%', _sample_interval, 0)) AS server_errors
FROM "makanmasak-metrics-prod"
WHERE blob1 = 'api_request'
  AND blob19 IN ('organic', 'probe')
  AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY country, ingress_colo, asn, traffic_type
ORDER BY requests DESC;

-- Successful latency: preserve endpoint/method/cache/placement cohorts.
-- This measures middleware duration, NOT client TTFB or D1 query time.
SELECT
  blob4 AS country,
  blob16 AS ingress_colo,
  blob17 AS asn,
  blob18 AS placement_header,
  blob19 AS traffic_type,
  blob8 AS endpoint,
  blob9 AS method,
  blob20 AS cache_status,
  SUM(_sample_interval) AS requests,
  QUANTILEEXACTWEIGHTED(0.50)(double2, _sample_interval) AS p50_ms,
  QUANTILEEXACTWEIGHTED(0.95)(double2, _sample_interval) AS p95_ms
FROM "makanmasak-metrics-prod"
WHERE blob1 = 'api_request'
  AND blob19 IN ('organic', 'probe')
  AND blob4 IN ('TW', 'MY')
  AND blob10 = '200'
  AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY country, ingress_colo, asn, placement_header, traffic_type, endpoint, method, cache_status
ORDER BY requests DESC;
