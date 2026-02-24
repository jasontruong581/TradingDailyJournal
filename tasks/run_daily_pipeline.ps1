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

function Write-Log {
    param([string]$Message)
    $line = "$(Get-Date -Format s) $Message"
    $line | Tee-Object -FilePath $runLog -Append
}

function Load-RunnerState {
    if (Test-Path $stateFile) {
        return Get-Content $stateFile -Raw | ConvertFrom-Json
    }
    return [PSCustomObject]@{ last_success_day_vn = $null }
}

function Save-RunnerState {
    param([string]$LastDay)
    $dir = Split-Path $stateFile -Parent
    if (!(Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir | Out-Null
    }
    [PSCustomObject]@{ last_success_day_vn = $LastDay } | ConvertTo-Json | Set-Content $stateFile -Encoding UTF8
}

function Get-DayRangeToProcess {
    param([string]$LastSuccessDay)

    # VN timezone: UTC+7
    $todayVn = (Get-Date).ToUniversalTime().AddHours(7).Date
    $targetDay = $todayVn.AddDays(-1) # process up to yesterday VN

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
    $python = "python"
    $venvPython = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
    if (Test-Path $venvPython) {
        $python = $venvPython
    }

    $accountsFile = Join-Path $ProjectRoot "state\accounts.json"
    $runnerState = Load-RunnerState
    $daysToProcess = Get-DayRangeToProcess -LastSuccessDay $runnerState.last_success_day_vn

    if ($daysToProcess.Count -eq 0) {
        Write-Log "No missing VN day to process. Exit."
        exit 0
    }

    Write-Log "Catch-up days: $($daysToProcess -join ', ')"

    foreach ($day in $daysToProcess) {
        $rawOut = Join-Path $ProjectRoot ("out\raw_events_{0}.csv" -f $day)
        Write-Log "Start processing day=$day"

        if (Test-Path $accountsFile) {
            Write-Log "Using multi-account config: $accountsFile"
            & $python "scripts/extract_mt5_events.py" --accounts-file $accountsFile --day-vn $day --output $rawOut --output-format csv
        }
        else {
            & $python "scripts/extract_mt5_events.py" --day-vn $day --output $rawOut --output-format csv
        }
        if ($LASTEXITCODE -ne 0) { throw "extract_mt5_events failed (day=$day) with exit code $LASTEXITCODE" }
        Write-Log "Extract completed: $rawOut"

        & $python "scripts/push_to_gsheet.py" --raw-events $rawOut --daily-summary "out/daily_summary_latest.csv"
        if ($LASTEXITCODE -ne 0) { throw "push_to_gsheet failed (day=$day) with exit code $LASTEXITCODE" }
        Write-Log "Push to Google Sheets completed for day=$day"

        & $python "scripts/build_dashboard_data.py" --raw-input $rawOut
        if ($LASTEXITCODE -ne 0) { throw "build_dashboard_data failed (day=$day) with exit code $LASTEXITCODE" }
        Write-Log "Dashboard data updated for day=$day"

        Save-RunnerState -LastDay $day
        Write-Log "Runner state updated: last_success_day_vn=$day"
    }

    Write-Log "Pipeline finished successfully"
    exit 0
}
catch {
    Write-Log "Pipeline failed: $($_.Exception.Message)"
    exit 1
}
