# Generate a simple preview.png placeholder (1024x768)
# This script creates a basic PNG file with text overlay

$width = 1024
$height = 768

# Create a bitmap
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)

# Fill background with gradient-like color
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(40, 44, 52))
$graphics.FillRectangle($brush, 0, 0, $width, $height)

# Add title text
$titleFont = New-Object System.Drawing.Font("Arial", 48, [System.Drawing.FontStyle]::Bold)
$titleBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$titleText = "RSS Reader"
$titleSize = $graphics.MeasureString($titleText, $titleFont)
$titleX = ($width - $titleSize.Width) / 2
$titleY = ($height - $titleSize.Height) / 2 - 50
$graphics.DrawString($titleText, $titleFont, $titleBrush, $titleX, $titleY)

# Add subtitle
$subtitleFont = New-Object System.Drawing.Font("Arial", 24)
$subtitleBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(180, 190, 200))
$subtitleText = "SiYuan Note Plugin"
$subtitleSize = $graphics.MeasureString($subtitleText, $subtitleFont)
$subtitleX = ($width - $subtitleSize.Width) / 2
$subtitleY = $titleY + $titleSize.Height + 20
$graphics.DrawString($subtitleText, $subtitleFont, $subtitleBrush, $subtitleX, $subtitleY)

# Add version info
$versionFont = New-Object System.Drawing.Font("Arial", 18)
$versionBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(120, 130, 140))
$versionText = "v0.1.1"
$versionSize = $graphics.MeasureString($versionText, $versionFont)
$versionX = ($width - $versionSize.Width) / 2
$versionY = $subtitleY + $subtitleSize.Height + 40
$graphics.DrawString($versionText, $versionFont, $versionBrush, $versionX, $versionY)

# Save to file
$outputPath = Join-Path $PSScriptRoot "preview.png"
$bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)

# Clean up
$graphics.Dispose()
$bitmap.Dispose()
$brush.Dispose()
$titleBrush.Dispose()
$subtitleBrush.Dispose()
$versionBrush.Dispose()
$titleFont.Dispose()
$subtitleFont.Dispose()
$versionFont.Dispose()

$fileSize = (Get-Item $outputPath).Length
Write-Host "✅ preview.png created successfully!"
Write-Host "📍 Location: $outputPath"
Write-Host "📏 Size: ${width}x${height}"
Write-Host "💾 File size: $([math]::Round($fileSize / 1KB, 2)) KB"

if ($fileSize -gt 200KB) {
    Write-Host "⚠️  Warning: File size exceeds 200KB limit!"
} else {
    Write-Host "✅ File size is within the 200KB limit"
}
