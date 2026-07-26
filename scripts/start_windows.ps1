<#
.SYNOPSIS
    Start TradeAlly (Windows). Safe to run repeatedly.
.EXAMPLE
    .\scripts\start_windows.ps1            # build if needed, start, open browser
    .\scripts\start_windows.ps1 -Build     # force a rebuild first
    .\scripts\start_windows.ps1 -NoOpen    # don't open the browser
#>
param(
    [switch]$Build,
    [switch]$NoOpen
)

$ErrorActionPreference = "Stop"

Set-Location (Join-Path $PSScriptRoot "..")

docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker does not appear to be running. Start Docker Desktop and try again."
    exit 1
}

if (-not (Test-Path ".env")) {
    Write-Host "No .env found - creating one from .env.example"
    Copy-Item ".env.example" ".env"
}

$existingImage = docker compose images -q tradeally 2>$null
if ($Build -or [string]::IsNullOrWhiteSpace($existingImage)) {
    Write-Host "Building the TradeAlly image..."
    docker compose build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

docker compose up -d
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$url = "http://localhost:8000"
Write-Host ""
Write-Host "TradeAlly is starting at $url"
Write-Host "  logs:  docker compose logs -f"
Write-Host "  stop:  .\scripts\stop_windows.ps1"

if (-not $NoOpen) {
    Start-Process $url
}
