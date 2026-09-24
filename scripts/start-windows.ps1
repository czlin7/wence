$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

$tokenFile = Join-Path $projectRoot 'api_key.txt'
if (-not [string]::IsNullOrWhiteSpace($env:TUSHARE_TOKEN)) {
    $env:TUSHARE_TOKEN = $env:TUSHARE_TOKEN.Trim()
}
elseif (Test-Path -LiteralPath $tokenFile -PathType Leaf) {
    $env:TUSHARE_TOKEN = (Get-Content -LiteralPath $tokenFile -Raw).Trim()
}

if ([string]::IsNullOrWhiteSpace($env:TUSHARE_TOKEN)) {
    $env:TUSHARE_TOKEN = (Read-Host 'Paste your Tushare token').Trim()
    if ([string]::IsNullOrWhiteSpace($env:TUSHARE_TOKEN)) { exit 0 }
}

$architecture = $env:PROCESSOR_ARCHITECTURE
if ($env:PROCESSOR_ARCHITEW6432) { $architecture = $env:PROCESSOR_ARCHITEW6432 }
if ($architecture -match 'ARM64') {
    $serverPath = Join-Path $projectRoot 'bin/windows/arm64/wence_server.exe'
}
elseif ($architecture -match '64') {
    $serverPath = Join-Path $projectRoot 'bin/windows/x86_64/wence_server.exe'
}
else {
    Write-Error 'This Windows build requires a 64-bit Windows installation.'
    exit 1
}
if (-not (Test-Path -LiteralPath $serverPath -PathType Leaf)) {
    Write-Error "The Wence server executable was not found: $serverPath"
    exit 1
}

$logDirectory = Join-Path $projectRoot 'Logs'
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$env:WENCE_ROOT = Join-Path $projectRoot 'web'
$env:WENCE_LOG_PATH = Join-Path $logDirectory 'wence_v3.log'

$port = $null
foreach ($candidate in 8765..8785) {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $candidate)
    try {
        $listener.Start()
        $listener.Stop()
        $port = $candidate
        break
    }
    catch {
        try { $listener.Stop() } catch { }
    }
}
if (-not $port) {
    Write-Error 'Ports 8765–8785 are all in use. Close another Wence instance and try again.'
    exit 1
}
$env:WENCE_PORT = [string]$port
$env:WENCE_SHUTDOWN_TOKEN = [Guid]::NewGuid().ToString('N')

$serverProcess = Start-Process -FilePath $serverPath -PassThru -WindowStyle Hidden
try {
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if ($serverProcess.HasExited) { break }
        try {
            $null = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 2
            $ready = $true
            break
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }
    if (-not $ready) {
        Write-Host "Wence could not start. See $($env:WENCE_LOG_PATH)"
        if (Test-Path -LiteralPath $env:WENCE_LOG_PATH) {
            Get-Content -LiteralPath $env:WENCE_LOG_PATH -Tail 12
        }
        exit 1
    }

    $url = "http://127.0.0.1:$port/"
    Start-Process $url
    Write-Host "Wence is running at $url"
    Write-Host 'Keep this window open. Press Ctrl+C here to stop Wence.'
    while (-not $serverProcess.HasExited) {
        Start-Sleep -Seconds 1
    }
}
finally {
    if (-not $serverProcess.HasExited) {
        try {
            $headers = @{ 'X-Wence-Shutdown' = $env:WENCE_SHUTDOWN_TOKEN }
            $null = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/shutdown" -Method Post -Headers $headers -TimeoutSec 3
        }
        catch { }
        try {
            Wait-Process -Id $serverProcess.Id -Timeout 10 -ErrorAction Stop
        }
        catch {
            Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
        }
    }
}
