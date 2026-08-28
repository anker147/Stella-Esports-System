param(
  [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
$stage = Join-Path $dist 'stage'
$trayOutput = Join-Path $dist 'tray'
$setupOutput = Join-Path $dist 'setup'
$releaseOutput = Join-Path $dist 'release'
$payloadPath = Join-Path $root 'desktop\StellaSetup\Payload\payload.zip'
$dotnetHome = Join-Path $root '.dotnet-home'
$nugetPackages = Join-Path $root '.nuget-packages'
$env:DOTNET_CLI_HOME = $dotnetHome
$env:NUGET_PACKAGES = $nugetPackages
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'

$releaseData = Get-Content (Join-Path $root 'data\update-log.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version = [string]$releaseData.currentVersion
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "Invalid release version: $version" }

function Reset-Directory([string]$path) {
  $full = [System.IO.Path]::GetFullPath($path)
  $rootFull = [System.IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
  if (-not $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe output path: $full" }
  if (Test-Path -LiteralPath $full) { Remove-Item -LiteralPath $full -Recurse -Force }
  New-Item -ItemType Directory -Path $full -Force | Out-Null
}

function Write-Utf8NoBom([string]$path, [string]$content) {
  [System.IO.File]::WriteAllText($path, $content, (New-Object System.Text.UTF8Encoding($false)))
}

if (-not $SkipTests) {
  & (Join-Path $root 'runtime\node.exe') --test (Join-Path $root 'server\*.test.js')
  if ($LASTEXITCODE -ne 0) { throw 'Node.js tests failed' }
}

Reset-Directory $stage
Reset-Directory $trayOutput
Reset-Directory $setupOutput
Reset-Directory $releaseOutput
New-Item -ItemType Directory -Path (Split-Path -Parent $payloadPath) -Force | Out-Null
if (Test-Path -LiteralPath $payloadPath) { Remove-Item -LiteralPath $payloadPath -Force }

Write-Host "Publishing self-contained tray application $version..."
dotnet publish (Join-Path $root 'desktop\StellaDirector\StellaDirector.csproj') `
  -c Release -r win-x64 --self-contained true `
  -p:PublishSingleFile=false `
  -p:DebugType=None -p:DebugSymbols=false -p:Version=$version `
  -o $trayOutput
if ($LASTEXITCODE -ne 0) { throw 'Tray publish failed' }

Copy-Item (Join-Path $trayOutput '*') $stage -Recurse
New-Item -ItemType Directory -Path (Join-Path $stage 'runtime'),(Join-Path $stage 'server'),(Join-Path $stage 'public'),(Join-Path $stage 'data'),(Join-Path $stage 'defaults\data') -Force | Out-Null
Copy-Item (Join-Path $root 'runtime\node.exe') (Join-Path $stage 'runtime\node.exe')
Get-ChildItem (Join-Path $root 'server') -File | Where-Object { $_.Name -notlike '*.test.js' } | Copy-Item -Destination (Join-Path $stage 'server')
Copy-Item (Join-Path $root 'public\*') (Join-Path $stage 'public') -Recurse
Copy-Item (Join-Path $root 'data\update-log.json') (Join-Path $stage 'data\update-log.json')
Copy-Item (Join-Path $root 'data\bp-config.json') (Join-Path $stage 'defaults\data\bp-config.json')
Write-Utf8NoBom (Join-Path $stage 'defaults\data\bp-state.json') '{"schemaVersion":1,"sessions":{},"forfeits":{}}'
Write-Utf8NoBom (Join-Path $stage 'defaults\data\material-library.json') '{"schemaVersion":2,"entries":{},"watchedFolders":[],"excludedPaths":[]}'
$canonicalRoot = 'E:\2026' + [char]0x8FFD + [char]0x98CE + [char]0x676F
$migrationDefaults = [ordered]@{
  schemaVersion = 1
  canonicalRoot = $canonicalRoot
  lastSelectedFolderId = $null
  lastValidation = $null
  lastSuccessfulSync = $null
  lastRollback = $null
  updatedAt = $null
}
Write-Utf8NoBom (Join-Path $stage 'defaults\data\obs-path-migration.json') ($migrationDefaults | ConvertTo-Json)
Write-Utf8NoBom (Join-Path $stage 'defaults\data\runtime-config.json') '{}'
Write-Utf8NoBom (Join-Path $stage 'version.json') (@{ product='stella-director'; version=$version; builtAt=(Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json)

& (Join-Path $root 'runtime\node.exe') (Join-Path $root 'scripts\sanitize-package-data.js') $stage
if ($LASTEXITCODE -ne 0) { throw 'Packaged data sanitization failed' }
& (Join-Path $root 'runtime\node.exe') (Join-Path $root 'scripts\validate-package-json.js') (Join-Path $stage 'defaults\data')
if ($LASTEXITCODE -ne 0) { throw 'Generated default JSON validation failed' }

$files = Get-ChildItem $stage -Recurse -File | Where-Object { $_.Name -ne 'payload-manifest.json' } | ForEach-Object {
  $relative = $_.FullName.Substring($stage.Length + 1).Replace('\','/')
  [ordered]@{
    path = $relative
    size = $_.Length
    sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  }
} | Sort-Object path
$manifest = [ordered]@{
  product = 'stella-director'
  version = $version
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  files = @($files)
}
Write-Utf8NoBom (Join-Path $stage 'payload-manifest.json') ($manifest | ConvertTo-Json -Depth 5)

Write-Host 'Compressing application payload...'
$sevenZip = 'C:\Program Files\7-Zip\7z.exe'
if (Test-Path -LiteralPath $sevenZip) {
  Push-Location $stage
  try { & $sevenZip a -tzip -mx=7 -mcu=on $payloadPath '.\*' | Out-Host }
  finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { throw 'Payload compression failed' }
} else {
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $payloadPath -CompressionLevel Optimal
}

Write-Host 'Publishing self-contained installer...'
dotnet publish (Join-Path $root 'desktop\StellaSetup\StellaSetup.csproj') `
  -c Release -r win-x64 --self-contained true `
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
  -p:DebugType=None -p:DebugSymbols=false -p:Version=$version `
  -o $setupOutput
if ($LASTEXITCODE -ne 0) { throw 'Installer publish failed' }

$installerName = "StellaDirector-$version-Setup.exe"
$installerPath = Join-Path $releaseOutput $installerName
Copy-Item (Join-Path $setupOutput 'StellaSetup.exe') $installerPath
$hash = (Get-FileHash $installerPath -Algorithm SHA256).Hash.ToLowerInvariant()
@"
File: $installerName
Version: $version
SHA256: $hash
BuiltAt: $((Get-Date).ToUniversalTime().ToString('o'))
"@ | ForEach-Object { Write-Utf8NoBom (Join-Path $releaseOutput "$installerName.sha256.txt") $_ }

Write-Host "Installer ready: $installerPath"
Get-Item $installerPath | Select-Object FullName,Length,LastWriteTime
