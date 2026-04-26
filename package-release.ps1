# RSS Reader Plugin - Packaging Script
# This script helps you package the plugin for release

Write-Host "📦 Packaging RSS Reader Plugin..." -ForegroundColor Cyan

# Check if dist directory exists
if (-not (Test-Path "dist")) {
    Write-Host "❌ dist directory not found. Running build first..." -ForegroundColor Yellow
    npm run build
}

# Get version from plugin.json
$pluginJson = Get-Content "plugin.json" -Raw | ConvertFrom-Json
$version = $pluginJson.version
$packageName = "siyuan-rss-reader-v$version"

Write-Host "📋 Plugin version: $version" -ForegroundColor Green
Write-Host "📦 Package name: $packageName.zip" -ForegroundColor Green

# Create temp directory for packaging
$tempDir = "temp-package"
if (Test-Path $tempDir) {
    Remove-Item -Recurse -Force $tempDir
}
New-Item -ItemType Directory -Path $tempDir | Out-Null

# Copy dist contents to temp directory
Copy-Item "dist\*" $tempDir -Recurse

# Compress to zip file
Compress-Archive -Path "$tempDir\*" -DestinationPath "$packageName.zip" -Force

# Clean up temp directory
Remove-Item -Recurse -Force $tempDir

Write-Host "✅ Package created: $packageName.zip" -ForegroundColor Green
Write-Host "📍 Location: $(Get-Location)\$packageName.zip" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Test the package by installing it in SiYuan" -ForegroundColor White
Write-Host "2. Create a GitHub repository (if not already done)" -ForegroundColor White
Write-Host "3. Create a GitHub Release and upload the zip file" -ForegroundColor White
Write-Host "4. Submit to SiYuan Plugin Market" -ForegroundColor White
