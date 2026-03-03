param(
    [string]$ProjectRoot = "d:\Hoang\Side Project\.net pj\trading"
)

$ErrorActionPreference = "Stop"
Set-Location $ProjectRoot

$logDir = Join-Path $ProjectRoot "logs"
if (!(Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir | Out-Null
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$runLog = Join-Path $logDir "pipeline_$stamp.log"
$stateFile = Join-Path $ProjectRoot "state\pipeline_runner_state.json"
$runtimeLockFile = Join-Path $ProjectRoot "state\python_runtime_lock.json"

function Write-Log {
    param([string]$Message)
    $line = "$(Get-Date -Format s) $Message"
    $line | Tee-Object -FilePath $runLog -Append
}

function Load-RunnerState {
    if (Test-Path $stateFile) {
        $s = Get-Content $stateFile -Raw | ConvertFrom-Json
        if (-not ($s.PSObject.Properties.Name -contains "last_success_day_xm")) {
            # Backward compatibility with old state key.
            $fallback = $null
            if ($s.PSObject.Properties.Name -contains "last_success_day_vn") {
                $fallback = $s.last_success_day_vn
            }
            return [PSCustomObject]@{ last_success_day_xm = $fallback }
        }
        return $s
    }
    return [PSCustomObject]@{ last_success_day_xm = $null }
}

function Save-RunnerState {
    param([string]$LastDay)
    $dir = Split-Path $stateFile -Parent
    if (!(Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir | Out-Null
    }
    [PSCustomObject]@{ last_success_day_xm = $LastDay } | ConvertTo-Json | Set-Content $stateFile -Encoding UTF8
}

function Resolve-PythonExe {
    param([string]$Root)

    if ($env:PIPELINE_PYTHON) {
        if (Test-Path $env:PIPELINE_PYTHON) {
            return $env:PIPELINE_PYTHON
        }
        throw "PIPELINE_PYTHON is set but path not found: $($env:PIPELINE_PYTHON)"
    }

    $venvPython = Join-Path $Root ".venv\Scripts\python.exe"
    if (Test-Path $venvPython) {
        return $venvPython
    }

    $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
    if ($pythonCmd) {
        return $pythonCmd.Source
    }

    throw "Python executable not found. Set PIPELINE_PYTHON or create .venv\Scripts\python.exe"
}

function Probe-PythonRuntime {
    param([string]$PythonExe)

    $probeScript = @'
import json
import sys
import platform

result = {
    "python_executable": sys.executable,
    "python_version": platform.python_version(),
    "ok_mt5": False,
    "ok_deps": False,
    "mt5_file": "",
    "mt5_error": "",
    "deps_error": ""
}

try:
    import MetaTrader5 as mt5
    result["ok_mt5"] = True
    result["mt5_file"] = getattr(mt5, "__file__", "")
except Exception as exc:
    result["mt5_error"] = str(exc)

try:
    import dotenv
    import gspread
    import google.auth
    result["ok_deps"] = True
except Exception as exc:
    result["deps_error"] = str(exc)

print(json.dumps(result, ensure_ascii=True))
'@

    $out = $probeScript | & $PythonExe -
    if ($LASTEXITCODE -ne 0) {
        throw "Python runtime probe failed with exit code $LASTEXITCODE"
    }
    if (-not $out) {
        throw "Python runtime probe returned empty output"
    }
    return ($out | ConvertFrom-Json)
}

function Assert-PythonRuntimeLock {
    param(
        [PSCustomObject]$Probe,
        [string]$LockFile
    )

    $lockDir = Split-Path $LockFile -Parent
    if (!(Test-Path $lockDir)) {
        New-Item -ItemType Directory -Path $lockDir | Out-Null
    }

    $current = [PSCustomObject]@{
        python_executable = $Probe.python_executable
        python_version    = $Probe.python_version
        mt5_file          = $Probe.mt5_file
        updated_at_utc    = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    }

    if (Test-Path $LockFile) {
        $locked = Get-Content $LockFile -Raw | ConvertFrom-Json
        $changed = (
            $locked.python_executable -ne $current.python_executable -or
            $locked.python_version -ne $current.python_version -or
            $locked.mt5_file -ne $current.mt5_file
        )

        if ($changed) {
            if ($env:ALLOW_PYTHON_RUNTIME_CHANGE -eq "1") {
                Write-Log "WARNING: Python runtime changed but ALLOW_PYTHON_RUNTIME_CHANGE=1, updating lock."
            }
            else {
                throw "Python runtime changed from lock file. Set ALLOW_PYTHON_RUNTIME_CHANGE=1 for one run to accept new runtime."
            }
        }
    }

    $current | ConvertTo-Json | Set-Content $LockFile -Encoding UTF8
}

function Get-DayRangeToProcess {
    param([string]$LastSuccessDay)

    # XM server timezone: UTC+2
    $todayXm = (Get-Date).ToUniversalTime().AddHours(2).Date
    $targetDay = $todayXm.AddDays(-1) # process up to yesterday XM

    if ($LastSuccessDay) {
        $startDay = [datetime]::ParseExact($LastSuccessDay, "yyyy-MM-dd", $null).AddDays(1)
    }
    else {
        # First run fallback: process yesterday only
        $startDay = $targetDay
    }

    if ($startDay -gt $targetDay) {
        return @()
    }

    $days = @()
    $cursor = $startDay
    while ($cursor -le $targetDay) {
        $days += $cursor.ToString("yyyy-MM-dd")
        $cursor = $cursor.AddDays(1)
    }
    return $days
}

try {
    $python = Resolve-PythonExe -Root $ProjectRoot
    Write-Log "Python resolved: $python"

    $probe = Probe-PythonRuntime -PythonExe $python
    Write-Log "Python probe: exe=$($probe.python_executable) version=$($probe.python_version) ok_mt5=$($probe.ok_mt5) ok_deps=$($probe.ok_deps)"
    if (-not $probe.ok_mt5) { throw "MetaTrader5 import failed: $($probe.mt5_error)" }
    if (-not $probe.ok_deps) { throw "Pipeline dependencies import failed: $($probe.deps_error)" }
    Assert-PythonRuntimeLock -Probe $probe -LockFile $runtimeLockFile

    $accountsFile = Join-Path $ProjectRoot "state\accounts.json"
    $runnerState = Load-RunnerState
    $daysToProcess = Get-DayRangeToProcess -LastSuccessDay $runnerState.last_success_day_xm

    if ($daysToProcess.Count -eq 0) {
        Write-Log "No missing XM day to process. Exit."
        exit 0
    }

    Write-Log "Catch-up days: $($daysToProcess -join ', ')"

    foreach ($day in $daysToProcess) {
        $rawOut = Join-Path $ProjectRoot ("out\raw_events_{0}.csv" -f $day)
        Write-Log "Start processing day=$day"

        if (Test-Path $accountsFile) {
            Write-Log "Using multi-account config: $accountsFile"
            & $python "scripts/extract_mt5_events.py" --accounts-file $accountsFile --day-xm $day --output $rawOut --output-format csv
        }
        else {
            & $python "scripts/extract_mt5_events.py" --day-xm $day --output $rawOut --output-format csv
        }
        if ($LASTEXITCODE -ne 0) { throw "extract_mt5_events failed (day=$day) with exit code $LASTEXITCODE" }
        Write-Log "Extract completed: $rawOut"

        & $python "scripts/build_dashboard_data.py" --raw-input $rawOut
        if ($LASTEXITCODE -ne 0) { throw "build_dashboard_data failed (day=$day) with exit code $LASTEXITCODE" }
        Write-Log "Dashboard data updated for day=$day"

        # Push full merged history to avoid overwriting sheet with only latest day.
        & $python "scripts/push_to_gsheet.py" --raw-events "dashboard/data/raw_events_history.csv" --daily-summary "dashboard/data/daily_summary_history.csv"
        if ($LASTEXITCODE -ne 0) { throw "push_to_gsheet failed (day=$day) with exit code $LASTEXITCODE" }
        Write-Log "Push full history to Google Sheets completed for day=$day"

        # Optional: push incremental day output to Cloudflare Worker API (D1-backed).
        # Enabled when WORKER_API_URL and WORKER_API_TOKEN are configured in environment/.env.
        & $python "scripts/push_to_cloudflare_worker.py" --summary-input "out/daily_summary_latest.csv" --raw-input $rawOut --skip-if-missing
        if ($LASTEXITCODE -ne 0) { throw "push_to_cloudflare_worker failed (day=$day) with exit code $LASTEXITCODE" }
        Write-Log "Push incremental day data to Cloudflare Worker completed for day=$day"

        Save-RunnerState -LastDay $day
        Write-Log "Runner state updated: last_success_day_xm=$day"
    }

    Write-Log "Pipeline finished successfully"
    exit 0
}
catch {
    Write-Log "Pipeline failed: $($_.Exception.Message)"
    exit 1
}
