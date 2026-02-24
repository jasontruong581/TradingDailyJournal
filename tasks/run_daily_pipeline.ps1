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

function Write-Log {
    param([string]$Message)
    $line = "$(Get-Date -Format s) $Message"
    $line | Tee-Object -FilePath $runLog -Append
}

try {
    $python = "python"
    $venvPython = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
    if (Test-Path $venvPython) {
        $python = $venvPython
    }

    $day = (Get-Date).AddDays(-1).ToString("yyyy-MM-dd")
    $rawOut = Join-Path $ProjectRoot ("out\raw_events_{0}.csv" -f $day)

    Write-Log "Start daily pipeline for day=$day"

    & $python "scripts/extract_mt5_events.py" --day-vn $day --output $rawOut --output-format csv
    if ($LASTEXITCODE -ne 0) { throw "extract_mt5_events failed with exit code $LASTEXITCODE" }
    Write-Log "Extract completed: $rawOut"

    & $python "scripts/push_to_gsheet.py" --raw-events $rawOut --daily-summary "out/daily_summary_latest.csv"
    if ($LASTEXITCODE -ne 0) { throw "push_to_gsheet failed with exit code $LASTEXITCODE" }
    Write-Log "Push to Google Sheets completed"

    Write-Log "Pipeline finished successfully"
    exit 0
}
catch {
    Write-Log "Pipeline failed: $($_.Exception.Message)"
    exit 1
}
