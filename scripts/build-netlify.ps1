<#
  build-netlify.ps1 — package v2/frontend into a Netlify-ready zip.

  IMPORTANT: builds zip entries with FORWARD-SLASH paths using .NET ZipArchive.
  Do NOT use PowerShell's Compress-Archive here — on Windows PowerShell 5.1 it
  writes backslash separators into the archive, which violates the ZIP spec.
  Netlify then extracts "css\styles.css" as a single root file instead of
  css/styles.css, so every css/js/asset request 404s and the site is broken.

  Usage:  powershell -File scripts\build-netlify.ps1
#>
$ErrorActionPreference = 'Stop'
$repo  = Split-Path -Parent $PSScriptRoot
$src   = Join-Path $repo 'v2\frontend'
$stage = Join-Path $repo 'netlify-build'
$zip   = Join-Path $env:USERPROFILE 'Downloads\UBC-Operations-Netlify.zip'

New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item -Recurse -Force "$src\*" $stage

# SPA/PWA fallback + caching for Netlify
"/*    /index.html   200" | Out-File -Encoding ascii (Join-Path $stage '_redirects')
@'
/service-worker.js
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
/assets/*
  Cache-Control: public, max-age=31536000, immutable
'@ | Out-File -Encoding ascii (Join-Path $stage '_headers')

if (Test-Path $zip) { [System.IO.File]::Delete($zip) }
Add-Type -AssemblyName System.IO.Compression | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null
$fs = [System.IO.File]::Open($zip, [System.IO.FileMode]::CreateNew)
$archive = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
$root = (Resolve-Path $stage).Path.TrimEnd('\') + '\'
Get-ChildItem -Recurse -File $stage | ForEach-Object {
  $rel = $_.FullName.Substring($root.Length) -replace '\\', '/'   # forward slashes!
  $entry = $archive.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
  $es = $entry.Open()
  $bytes = [System.IO.File]::ReadAllBytes($_.FullName)
  $es.Write($bytes, 0, $bytes.Length); $es.Close()
}
$archive.Dispose(); $fs.Close()
Write-Host ("Built {0} ({1:N1} KB) with forward-slash entries." -f $zip, ((Get-Item $zip).Length / 1KB))
