[CmdletBinding()]
param(
  [string]$Origin = "https://api.makanmasak.com",
  [string]$RunLabel = "hinet-sjc-authenticated-before-placement",
  [ValidateRange(1, 20)]
  [int]$WarmupCount = 5,
  [ValidateRange(1, 100)]
  [int]$MeasuredCount = 30,
  [ValidateRange(0, 30)]
  [int]$PauseSeconds = 1,
  [string]$OutputPath = (Join-Path $env:TEMP "worker-placement-369.json")
)

$ErrorActionPreference = "Stop"

function Get-NearestRankPercentile {
  param(
    [AllowEmptyCollection()]
    [object[]]$Values,
    [ValidateRange(0, 1)]
    [double]$Percentile
  )

  $sorted = @($Values | Where-Object { $null -ne $_ } | Sort-Object)
  if ($sorted.Count -eq 0) {
    return $null
  }

  $rank = [Math]::Ceiling($Percentile * $sorted.Count)
  return $sorted[[Math]::Max(0, $rank - 1)]
}

function Get-SanitizedTrace {
  $raw = (Invoke-WebRequest `
      -UseBasicParsing `
      -Uri "$Origin/cdn-cgi/trace" `
      -Headers @{ "User-Agent" = "MakanMasak-Placement-Probe/369 $RunLabel-trace" }
  ).Content
  $pairs = @{}
  foreach ($line in ($raw -split "`n")) {
    if ($line -match "^([^=]+)=(.*)$") {
      $pairs[$Matches[1]] = $Matches[2].Trim()
    }
  }

  return [ordered]@{
    utc = [DateTimeOffset]::UtcNow.ToString("o")
    loc = $pairs.loc
    colo = $pairs.colo
    http = $pairs.http
    tls = $pairs.tls
  }
}

function Invoke-PlacementProbe {
  param(
    [string]$Label,
    [string]$Path,
    [int]$Sample,
    [string]$Phase,
    [string]$TempDirectory,
    [string]$BearerToken
  )

  $headerFile = Join-Path $TempDirectory "$Label-$Sample.headers"
  $errorFile = Join-Path $TempDirectory "$Label-$Sample.error"
  $userAgent = "MakanMasak-Placement-Probe/369 $RunLabel-$Label"
  $curlConfig = "header = `"Authorization: Bearer $BearerToken`"`n"
  $timing = $curlConfig | & curl.exe `
    -q `
    --config - `
    --silent `
    --show-error `
    --connect-timeout 10 `
    --max-time 30 `
    --user-agent $userAgent `
    --dump-header $headerFile `
    --output NUL `
    --write-out "%{http_code}|%{time_namelookup}|%{time_connect}|%{time_appconnect}|%{time_starttransfer}|%{time_total}" `
    "$Origin$Path" 2> $errorFile
  $curlExit = $LASTEXITCODE

  $headers = if (Test-Path -LiteralPath $headerFile) {
    @(Get-Content -LiteralPath $headerFile)
  } else {
    @()
  }

  function Get-HeaderValue {
    param([string]$Name)

    $escapedName = [regex]::Escape($Name)
    $line = $headers |
      Where-Object { $_ -match "^${escapedName}:\s*(.*)$" } |
      Select-Object -Last 1
    if ($line -and $line -match ":\s*(.*)$") {
      return $Matches[1].Trim()
    }
    return $null
  }

  $parts = [string]$timing -split "\|"
  $workerHeader = Get-HeaderValue "X-Response-Time"

  return [ordered]@{
    utc = [DateTimeOffset]::UtcNow.ToString("o")
    endpoint = $Label
    sample = $Sample
    phase = $Phase
    curl_exit = $curlExit
    status = if ($parts.Count -ge 1) { [int]$parts[0] } else { 0 }
    dns_ms = if ($parts.Count -ge 2) { [double]$parts[1] * 1000 } else { $null }
    tcp_ms = if ($parts.Count -ge 3) { [double]$parts[2] * 1000 } else { $null }
    tls_ms = if ($parts.Count -ge 4) { [double]$parts[3] * 1000 } else { $null }
    ttfb_ms = if ($parts.Count -ge 5) { [double]$parts[4] * 1000 } else { $null }
    total_ms = if ($parts.Count -ge 6) { [double]$parts[5] * 1000 } else { $null }
    worker_ms = if ($workerHeader -match "^\d+(?:\.\d+)?$") {
      [double]$workerHeader
    } else {
      $null
    }
    cf_ray = Get-HeaderValue "CF-RAY"
    placement = Get-HeaderValue "cf-placement"
    cache = Get-HeaderValue "X-Cache"
    request_id = Get-HeaderValue "X-Request-ID"
    error_present = if (Test-Path -LiteralPath $errorFile) {
      (Get-Item -LiteralPath $errorFile).Length -gt 0
    } else {
      $false
    }
  }
}

$username = Read-Host "Dedicated QA username"
$securePassword = Read-Host "Dedicated QA password" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR(
  $securePassword
)
try {
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
    $passwordPointer
  )
  $loginBody = @{
    username = $username
    password = $plainPassword
  } | ConvertTo-Json -Compress
  $login = Invoke-RestMethod `
    -Method Post `
    -Uri "$Origin/api/v1/auth/login" `
    -ContentType "application/json" `
    -Body $loginBody `
    -Headers @{
      "User-Agent" = "MakanMasak-Placement-Probe/369 $RunLabel-login"
    }
} finally {
  if ($passwordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
  $plainPassword = $null
  $loginBody = $null
  $securePassword = $null
}

$token = [string]$login.data.token
$restaurantId = [string]$login.data.user.restaurantId
$role = [int]$login.data.user.role
if (-not $login.success -or [string]::IsNullOrWhiteSpace($token)) {
  throw "Login did not return an access token"
}
if ($token -notmatch "^[A-Za-z0-9_.-]+$") {
  throw "Login returned an unsafe token format"
}
if ($role -ne 1 -or [string]::IsNullOrWhiteSpace($restaurantId)) {
  throw "The QA account is not an assigned owner"
}
Write-Output "LOGIN_OK role=1 restaurant_assigned=true"

$tempDirectory = Join-Path $env:TEMP (
  "placement-369-" + [guid]::NewGuid().ToString("N")
)
New-Item -ItemType Directory -Path $tempDirectory | Out-Null

try {
  $traceBefore = Get-SanitizedTrace
  $samples = [System.Collections.Generic.List[object]]::new()
  $targets = @(
    @{ label = "info"; path = "/info" },
    @{
      label = "orders"
      path = "/api/v1/orders?restaurantId=$([uri]::EscapeDataString($restaurantId))&limit=20"
    },
    @{
      label = "dashboard"
      path = "/api/v1/analytics/realtime-dashboard?restaurantId=$([uri]::EscapeDataString($restaurantId))"
    }
  )

  foreach ($target in $targets) {
    $totalSamples = $WarmupCount + $MeasuredCount
    for ($sample = 1; $sample -le $totalSamples; $sample++) {
      $phase = if ($sample -le $WarmupCount) { "warmup" } else { "measured" }
      $samples.Add((Invoke-PlacementProbe `
            -Label $target.label `
            -Path $target.path `
            -Sample $sample `
            -Phase $phase `
            -TempDirectory $tempDirectory `
            -BearerToken $token
        ))
      if ($PauseSeconds -gt 0) {
        Start-Sleep -Seconds $PauseSeconds
      }
    }

    $successful = @(
      $samples | Where-Object {
        $_.endpoint -eq $target.label -and
        $_.phase -eq "measured" -and
        $_.curl_exit -eq 0 -and
        $_.status -eq 200
      }
    )
    Write-Output (
      (
        "ENDPOINT_DONE label={0} success={1}/{2} ttfb_p50_ms={3} " +
        "ttfb_p95_ms={4} worker_p50_ms={5} worker_p95_ms={6}"
      ) -f
      $target.label,
      $successful.Count,
      $MeasuredCount,
      (Get-NearestRankPercentile $successful.ttfb_ms 0.50),
      (Get-NearestRankPercentile $successful.ttfb_ms 0.95),
      (Get-NearestRankPercentile $successful.worker_ms 0.50),
      (Get-NearestRankPercentile $successful.worker_ms 0.95)
    )
  }

  $healthProbes = [System.Collections.Generic.List[object]]::new()
  for ($sample = 1; $sample -le 5; $sample++) {
    $stopwatch = [Diagnostics.Stopwatch]::StartNew()
    $response = Invoke-WebRequest `
      -UseBasicParsing `
      -Uri "$Origin/api/v1/system/health" `
      -Headers @{
        "User-Agent" = "MakanMasak-Placement-Probe/369 $RunLabel-health"
      }
    $stopwatch.Stop()
    $body = $response.Content | ConvertFrom-Json
    $database = $body.services | Where-Object name -eq "database"
    $kv = $body.services | Where-Object name -eq "kv_storage"
    $healthProbes.Add([ordered]@{
        utc = [DateTimeOffset]::UtcNow.ToString("o")
        sample = $sample
        status = [int]$response.StatusCode
        client_ms = $stopwatch.ElapsedMilliseconds
        cf_ray = [string]$response.Headers["CF-RAY"]
        db_ms = [double]$database.responseTime
        db_region = [string]$database.servedByRegion
        db_primary = [bool]$database.servedByPrimary
        kv_ms = [double]$kv.responseTime
      })
    if ($PauseSeconds -gt 0) {
      Start-Sleep -Seconds $PauseSeconds
    }
  }
  $traceAfter = Get-SanitizedTrace

  $summary = foreach ($target in $targets) {
    $measured = @(
      $samples | Where-Object {
        $_.endpoint -eq $target.label -and $_.phase -eq "measured"
      }
    )
    $successful = @(
      $measured | Where-Object { $_.curl_exit -eq 0 -and $_.status -eq 200 }
    )
    [ordered]@{
      endpoint = $target.label
      attempts = $MeasuredCount
      success = $successful.Count
      statuses = @(
        $measured | Group-Object status | ForEach-Object {
          $statusGroup = $_
          [ordered]@{
            status = [int]$statusGroup.Name
            count = $statusGroup.Count
          }
        }
      )
      ttfb_p50_ms = Get-NearestRankPercentile $successful.ttfb_ms 0.50
      ttfb_p95_ms = Get-NearestRankPercentile $successful.ttfb_ms 0.95
      worker_p50_ms = Get-NearestRankPercentile $successful.worker_ms 0.50
      worker_p95_ms = Get-NearestRankPercentile $successful.worker_ms 0.95
      cf_colos = @(
        $successful.cf_ray |
          ForEach-Object {
            if ($_ -match "-([A-Z]{3})$") { $Matches[1] } else { "unknown" }
          } |
          Group-Object |
          ForEach-Object { [ordered]@{ colo = $_.Name; count = $_.Count } }
      )
    }
  }

  $evidence = [ordered]@{
    schema_version = 1
    issue = 369
    run_label = $RunLabel
    placement = "disabled"
    account = @{
      role = 1
      restaurant_assigned = $true
      identifiers_redacted = $true
    }
    trace_before = $traceBefore
    trace_after = $traceAfter
    summary = @($summary)
    health_summary = @{
      samples = 5
      db_p50_ms = Get-NearestRankPercentile $healthProbes.db_ms 0.50
      db_p95_ms = Get-NearestRankPercentile $healthProbes.db_ms 0.95
      kv_p50_ms = Get-NearestRankPercentile $healthProbes.kv_ms 0.50
      kv_p95_ms = Get-NearestRankPercentile $healthProbes.kv_ms 0.95
      regions = @($healthProbes.db_region | Select-Object -Unique)
      primary_all = @($healthProbes | Where-Object { -not $_.db_primary }).Count -eq 0
    }
    samples = $samples
    health_probes = $healthProbes
  }

  $parent = Split-Path -Parent $OutputPath
  if ($parent -and -not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent | Out-Null
  }
  $evidence |
    ConvertTo-Json -Depth 12 |
    Set-Content -LiteralPath $OutputPath -Encoding utf8NoBOM

  Write-Output "EVIDENCE_PATH=$OutputPath"
  Write-Output ($evidence.summary | ConvertTo-Json -Compress -Depth 8)
  Write-Output ($evidence.health_summary | ConvertTo-Json -Compress -Depth 8)
} finally {
  if (Test-Path -LiteralPath $tempDirectory) {
    Remove-Item -LiteralPath $tempDirectory -Recurse -Force
  }
  $token = $null
  $restaurantId = $null
  $login = $null
}
