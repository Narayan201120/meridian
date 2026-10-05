# Free the ports the E2E suites use.
#
# Playwright starts and stops the backend and Expo itself, but on Windows a
# uvicorn or Metro process sometimes outlives the run. The next run then aborts
# with "http://127.0.0.1:8098/api/v1/health is already used" and no test output
# at all, which reads like a broken suite rather than a stale process.
#
# This exists because that happened three times in one session, each time
# costing a confused detour. It is Windows-specific on purpose; the CI runner
# does not need it, which is why it is a manual script and not part of `e2e`.
$ErrorActionPreference = "SilentlyContinue"

# Probed over HTTP rather than read from the port table. On this machine
# Get-NetTCPConnection reported port 8098 as held by a process named "Idle"
# with no PID, and earlier in the same session reported port 8000 as free while
# uvicorn was demonstrably serving on it. The port table lies here; an actual
# request does not.
$targets = @(
  @{ Port = 8098; Path = "/api/v1/health" },
  @{ Port = 8099; Path = "/" },
  @{ Port = 8097; Path = "/" }
)

$busy = @()
foreach ($t in $targets) {
  try {
    Invoke-WebRequest -Uri "http://127.0.0.1:$($t.Port)$($t.Path)" -TimeoutSec 3 -UseBasicParsing | Out-Null
    $busy += $t.Port
  } catch {
    # Nothing answered, which is the state we want.
  }
}

if ($busy.Count -eq 0) {
  Write-Output "e2e ports already free"
  exit 0
}

# Killed by matching the process list, not by looking up the port's owner.
# netstat and Get-NetTCPConnection both fail to map a live listener to a PID on
# this machine: netstat shows nothing on 8098 while an HTTP request to it
# succeeds, and Get-NetTCPConnection reports the owner as a process named
# "Idle" with an empty PID. The process list is the only source that has given a
# usable answer here.
#
# $self and $parent are excluded because a command-line match will happily match
# the shell that invoked this script, and a cleanup script that kills its caller
# is worse than the stale process it was meant to remove.
$self = $PID
$parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId

$targets = Get-CimInstance Win32_Process | Where-Object {
  $_.ProcessId -ne $self -and
  $_.ProcessId -ne $parent -and
  ($_.CommandLine -like "*e2e_server*" -or
   $_.CommandLine -like "*playwright*test -c*" -or
   ($_.Name -eq "node.exe" -and $_.CommandLine -like "*meridian*"))
}

if (-not $targets) {
  Write-Output "ports answer but no matching process found; leaving them alone"
  exit 0
}

foreach ($t in $targets) {
  Write-Output "stopping $($t.Name) [$($t.ProcessId)]"
  Stop-Process -Id $t.ProcessId -Force
}

Start-Sleep -Seconds 2

$stillBusy = @()
foreach ($t in $targets) {
  try {
    Invoke-WebRequest -Uri "http://127.0.0.1:$($t.Port)$($t.Path)" -TimeoutSec 3 -UseBasicParsing | Out-Null
    $stillBusy += $t.Port
  } catch { }
}

if ($stillBusy.Count -gt 0) {
  Write-Output "WARNING: still answering: $($stillBusy -join ', ')"
  exit 1
}

Write-Output "e2e ports freed"