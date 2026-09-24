param(
    [string]$OutputPath,
    [string]$WindowsX64Server
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $projectRoot 'dist\wence-v3.zip'
}
if ([string]::IsNullOrWhiteSpace($WindowsX64Server)) {
    $WindowsX64Server = Join-Path $projectRoot 'bin\windows\x86_64\wence_server.exe'
}
$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
if (-not (Test-Path -LiteralPath $WindowsX64Server -PathType Leaf)) {
    throw "Windows x64 server executable not found: $WindowsX64Server"
}

$includeFiles = @(
    '.gitattributes',
    '.gitignore',
    'CHANGELOG.md',
    'README.md',
    'README.zh-CN.md',
    'THIRD_PARTY_NOTICES.md',
    'Logs/.gitkeep',
    'Models/.gitkeep',
    'bin/llama/README.md'
)
$includeDirectories = @(
    'bin/macos',
    'bin/windows',
    'bin/llama/packages',
    'scripts',
    'server',
    'third_party',
    'web'
)

$files = [System.Collections.Generic.List[System.IO.FileInfo]]::new()
foreach ($relativePath in $includeFiles) {
    $path = Join-Path $projectRoot $relativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required package file not found: $relativePath"
    }
    $files.Add((Get-Item -LiteralPath $path))
}
foreach ($relativePath in $includeDirectories) {
    $path = Join-Path $projectRoot $relativePath
    if (-not (Test-Path -LiteralPath $path -PathType Container)) {
        throw "Required package directory not found: $relativePath"
    }
    Get-ChildItem -LiteralPath $path -File -Recurse | ForEach-Object { $files.Add($_) }
}

$x64Path = [System.IO.Path]::GetFullPath($WindowsX64Server)
$standardX64Path = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'bin\windows\x86_64\wence_server.exe'))
if (-not $x64Path.Equals($standardX64Path, [System.StringComparison]::OrdinalIgnoreCase)) {
    $null = $files.RemoveAll([Predicate[System.IO.FileInfo]]{ param($file) $file.FullName.Equals($standardX64Path, [System.StringComparison]::OrdinalIgnoreCase) })
    $files.Add((Get-Item -LiteralPath $x64Path))
}

$outputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$temporaryZip = Join-Path ([System.IO.Path]::GetTempPath()) ('wence-package-' + [guid]::NewGuid().ToString('N') + '.zip')
$stream = $null
$archive = $null
try {
    Add-Type -AssemblyName System.IO.Compression
    $stream = [System.IO.File]::Open($temporaryZip, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    $archive = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create)
    foreach ($file in $files) {
        $fullPath = [System.IO.Path]::GetFullPath($file.FullName)
        if ($fullPath.Equals($x64Path, [System.StringComparison]::OrdinalIgnoreCase)) {
            $entryPath = 'bin/windows/x86_64/wence_server.exe'
        } else {
            $entryPath = $fullPath.Substring($projectRoot.Length).TrimStart('\', '/').Replace('\', '/')
        }
        $entry = $archive.CreateEntry(('wence_v3/' + $entryPath), [System.IO.Compression.CompressionLevel]::Optimal)
        $input = [System.IO.File]::OpenRead($fullPath)
        $output = $entry.Open()
        try { $input.CopyTo($output) }
        finally { $output.Dispose(); $input.Dispose() }
    }
} finally {
    if ($archive) { $archive.Dispose() }
    if ($stream) { $stream.Dispose() }
}

Move-Item -LiteralPath $temporaryZip -Destination $OutputPath -Force
Write-Host "Created portable package: $OutputPath"
