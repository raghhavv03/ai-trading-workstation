<#
.SYNOPSIS
    Stop FinAlly (Windows). Safe to run repeatedly.
.DESCRIPTION
    The `finally-data` volume is deliberately left intact, so your portfolio,
    trades, and chat history survive a stop/start cycle.
#>

$ErrorActionPreference = "Stop"

Set-Location (Join-Path $PSScriptRoot "..")

docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Docker does not appear to be running - nothing to stop."
    exit 0
}

docker compose down
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "FinAlly stopped. Your data volume (finally-data) was preserved."
