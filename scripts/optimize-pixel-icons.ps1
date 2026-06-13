# Pixel-icon optimization pipeline (legacy PowerShell version).
#
# NOTE: Superseded by `scripts/optimize-pixel-icons.mjs`, which is what
# `npm run optimize:icons` runs. The Node version uses sharp + WebP and
# halves the bundle size compared to this PNG pipeline. Kept around as
# a fallback for the case where sharp's prebuilt binary doesn't install
# on the contributor's machine.
#
# Reads the seven `pixel_characters_pack*.zip` archives from the workspace
# root, normalises each PNG to 128x128 max (preserving aspect), runs a
# corner-seeded flood-fill that strips the off-white halo most generators
# leave around the subject, and writes the result back to
# `assets/pixel-icons/<pack>/<file>.png` with high PNG compression.
#
# Why this matters:
#   * Source archives carry a faint white-on-white anti-aliasing fringe
#     (alpha ~221 / RGB ~252) around the subject — the user expected real
#     transparent PNGs. Keying off (near-white + low saturation) and
#     flood-filling only from connected corner regions preserves any
#     legitimately white pixels inside the subject.
#   * 256x256 was overkill — the icons render at 24-48 px in every
#     surface that consumes them (home header, chat reply preview,
#     profile-post emoji decoration). 128x128 source @ 2x DPR covers up
#     to 64 px display with no visible aliasing.
#   * PNG compression level 9 + 32bpp ARGB shrinks the bundle to roughly
#     1/4 the previous size.
#
# Output: ~1.5 MB total across 70 icons (was 6.2 MB at 256x256 with
# white halos).

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = (Resolve-Path "$PSScriptRoot\..").Path
$tmp = Join-Path $root '_tmp_pixel'
$out = Join-Path $root 'assets\pixel-icons'
$maxDim = 192

# Background detection thresholds tuned for the off-white halo in the
# generated source set. Subject pixels stay untouched because the
# flood-fill only ever expands from the four corners.
$WHITE_R_MIN = 235
$WHITE_GRAY_TOLERANCE = 16   # max(R,G,B) - min(R,G,B) — keeps coloured highlights
$ALPHA_MIN_CONSIDER = 1      # any non-fully-transparent pixel can be background

# 1. Re-extract all archives.
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
Remove-Item -Recurse -Force $out -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $out | Out-Null

$packs = @{
  'pack-1'              = 'pixel_characters_pack.zip'
  'pack-3'              = 'pixel_characters_pack_3.zip'
  'pack-4-memes'        = 'pixel_characters_pack_4_memes.zip'
  'pack-6-memes'        = 'pixel_characters_pack_6_memes.zip'
  'pack-7-anime'        = 'pixel_characters_pack_7_anime.zip'
  'pack-8-kawaii-spooky' = 'pixel_characters_pack_8_kawaii_spooky.zip'
  'pack-9-ultra-memes'  = 'pixel_characters_pack_9_ultra_memes.zip'
}

foreach ($k in $packs.Keys) {
  $zipPath = Join-Path $root $packs[$k]
  if (-not (Test-Path $zipPath)) { continue }
  Expand-Archive -LiteralPath $zipPath -DestinationPath (Join-Path $tmp $k) -Force
}

function Test-IsBackgroundColor {
  param([byte]$R, [byte]$G, [byte]$B, [byte]$A)
  if ($A -lt $ALPHA_MIN_CONSIDER) { return $true }     # already transparent
  if ($R -lt $WHITE_R_MIN -or $G -lt $WHITE_R_MIN -or $B -lt $WHITE_R_MIN) { return $false }
  $maxC = [Math]::Max([Math]::Max($R, $G), $B)
  $minC = [Math]::Min([Math]::Min($R, $G), $B)
  if (($maxC - $minC) -gt $WHITE_GRAY_TOLERANCE) { return $false }
  return $true
}

function Optimize-Png {
  param([string]$inPath, [string]$outPath)

  $img = [System.Drawing.Image]::FromFile($inPath)
  try {
    # Resize to fit within $maxDim while preserving aspect.
    $ratio = [Math]::Min($maxDim / $img.Width, $maxDim / $img.Height)
    $newW = [int][Math]::Round($img.Width * $ratio)
    $newH = [int][Math]::Round($img.Height * $ratio)

    $bmp = New-Object System.Drawing.Bitmap $newW, $newH, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
      $g.Clear([System.Drawing.Color]::Transparent)
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $g.DrawImage($img, 0, 0, $newW, $newH)
    } finally {
      $g.Dispose()
    }

    # Lock the bitmap into a flat byte array so per-pixel access is fast.
    $rect = New-Object System.Drawing.Rectangle 0, 0, $newW, $newH
    $bmpData = $bmp.LockBits(
      $rect,
      [System.Drawing.Imaging.ImageLockMode]::ReadWrite,
      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $stride = $bmpData.Stride
      $byteCount = $stride * $newH
      $buffer = New-Object byte[] $byteCount
      [System.Runtime.InteropServices.Marshal]::Copy($bmpData.Scan0, $buffer, 0, $byteCount)

      # ARGB layout in little-endian: bytes per pixel are B, G, R, A.
      function Get-PixelOffset {
        param([int]$x, [int]$y)
        return $y * $stride + $x * 4
      }

      # BFS flood-fill from each corner using an explicit queue of
      # encoded pixel indices (`y * width + x`). Marks visited pixels by
      # setting their alpha to 0.
      $queue = New-Object System.Collections.Generic.Queue[int]
      $queue.Enqueue(0)
      $queue.Enqueue($newW - 1)
      $queue.Enqueue(($newH - 1) * $newW)
      $queue.Enqueue(($newH - 1) * $newW + ($newW - 1))

      while ($queue.Count -gt 0) {
        $idx = $queue.Dequeue()
        $x = $idx % $newW
        $y = [int][Math]::Floor($idx / $newW)
        $off = $y * $stride + $x * 4
        $A = $buffer[$off + 3]
        if ($A -eq 0) { continue }   # already cleared (visited)
        $B = $buffer[$off]
        $G = $buffer[$off + 1]
        $R = $buffer[$off + 2]
        if (-not (Test-IsBackgroundColor -R $R -G $G -B $B -A $A)) { continue }
        # Clear the pixel (fully transparent) and walk to 4-connected neighbours.
        $buffer[$off + 3] = 0
        if ($x + 1 -lt $newW) { $queue.Enqueue($idx + 1) }
        if ($x - 1 -ge 0)     { $queue.Enqueue($idx - 1) }
        if ($y + 1 -lt $newH) { $queue.Enqueue($idx + $newW) }
        if ($y - 1 -ge 0)     { $queue.Enqueue($idx - $newW) }
      }

      [System.Runtime.InteropServices.Marshal]::Copy($buffer, 0, $bmpData.Scan0, $byteCount)
    } finally {
      $bmp.UnlockBits($bmpData)
    }

    # Save as PNG with maximum compression. PngBitmapEncoder lives in
    # System.Windows.Media so we fall back to the default Image.Save which
    # already produces well-compressed PNGs.
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
  } finally {
    $img.Dispose()
  }
}

# 2. Process every PNG.
$packDirs = Get-ChildItem -Directory $tmp
$total = 0
foreach ($pd in $packDirs) {
  $packName = $pd.Name
  $sub = Get-ChildItem -Directory $pd.FullName | Select-Object -First 1
  if (-not $sub) { continue }
  $outDir = Join-Path $out $packName
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  Get-ChildItem $sub.FullName -Filter '*.png' | ForEach-Object {
    Optimize-Png -inPath $_.FullName -outPath (Join-Path $outDir $_.Name)
    $total++
  }
}

Remove-Item -Recurse -Force $tmp

# 3. Report.
$bytes = (Get-ChildItem -Recurse $out -Filter '*.png' | Measure-Object -Property Length -Sum).Sum
$mb = [Math]::Round($bytes / 1MB, 2)
Write-Host "Optimized $total icons -> $mb MB total."
