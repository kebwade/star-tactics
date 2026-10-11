<#
  做个立绘 —— 把一张图片转成游戏能用的 art/<棋子id>.png

  为什么需要它：art/ 里的图会被 object-fit: cover 等比裁切。
  商店卡是 152x204（约 3:4），棋盘小卡约 101x105（接近正方形）——
  同一张图要在两种比例里都好看。而手机/微信保存的图基本都是 3:4 竖版，
  直接丢进去的话，棋盘小卡会上下各切掉 11%，**头顶通常就被切掉了**。

  所以默认用「补边」：把画面两侧用边缘像素延展补成正方形。
    · 正方形图放进接近正方形的棋盘小卡 → 几乎不裁，整个人都在
    · 放进 3:4 的商店卡 → 两侧补出来的部分正好被裁掉 → 显示的就是原图

  用法：
    powershell -ExecutionPolicy Bypass -File tools\做个立绘.ps1 -Image "C:\...\图.jpg" -Id dagger
    powershell -ExecutionPolicy Bypass -File tools\做个立绘.ps1 -Image "..." -Id dagger -Mode crop
    加 -List 可以列出全部 24 个 id
#>
[CmdletBinding()]
param(
  [string]$Image = '',
  [string]$Id = '',
  [ValidateSet('pad','crop')][string]$Mode = 'pad',
  [int]$Size = 0,       # 0 = 按类型给默认值（棋子 1024 / 装备 256）
  [switch]$Item,        # 装备图标（放 art\items\）而不是棋子立绘
  [switch]$List
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$Root = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Get-Location).Path }
$artDir = Join-Path $Root 'art'
$itemDir = Join-Path $artDir 'items'

# 从 units.js 里抓出全部棋子 id 和名字（不依赖浏览器）
function Get-UnitIds {
  $f = Join-Path $Root 'js\units.js'
  $txt = [System.IO.File]::ReadAllText($f, [System.Text.Encoding]::UTF8)
  $out = @()
  foreach ($m in [regex]::Matches($txt, "id:\s*'([a-z]+)',\s*name:\s*'([^']+)'")) {
    $out += [pscustomobject]@{ Id = $m.Groups[1].Value; Name = $m.Groups[2].Value }
  }
  return $out
}

# 装备：id 和名字，从 items.js 里抓
function Get-ItemIds {
  $f = Join-Path $Root 'js\items.js'
  $txt = [System.IO.File]::ReadAllText($f, [System.Text.Encoding]::UTF8)
  $out = @()
  foreach ($m in [regex]::Matches($txt, "id:\s*'([a-z]+)',\s*name:\s*'([^']+)'")) {
    $out += [pscustomobject]@{ Id = $m.Groups[1].Value; Name = $m.Groups[2].Value }
  }
  return $out
}

$units = if ($Item) { Get-ItemIds } else { Get-UnitIds }
$targetDir = if ($Item) { $itemDir } else { $artDir }
# ★ 装备图标显示尺寸只有 38px（2 倍屏 76px），没必要存 1024×1024 的照片 ——
#   那会让一张图标就有 2.7MB。默认给 256 足够清楚。
if ($Size -le 0) { $Size = if ($Item) { 256 } else { 1024 } }
$kindName = if ($Item) { '装备' } else { '棋子' }

if ($List -or [string]::IsNullOrEmpty($Image) -or [string]::IsNullOrEmpty($Id)) {
  Write-Host ''
  Write-Host ("  全部{0} id（-Id 后面填这个）：" -f $kindName) -ForegroundColor Cyan
  foreach ($u in $units) {
    $has = Test-Path (Join-Path $targetDir ($u.Id + '.png'))
    $mark = if ($has) { '[已有]' } else { '      ' }
    Write-Host ("    {0} {1,-16} {2}" -f $mark, $u.Id, $u.Name)
  }
  Write-Host ''
  Write-Host '  用法: -Image "图片路径" -Id <上面的 id> [-Item] [-Mode pad|crop] [-Size 1024]' -ForegroundColor Yellow
  Write-Host '        -Item = 装备图标（写到 art\items\）' -ForegroundColor DarkGray
  return
}

if (-not (Test-Path $Image)) { throw "找不到图片: $Image" }
$match = $units | Where-Object { $_.Id -eq $Id }
if (-not $match) { throw "没有这个${kindName} id: $Id（加 -List 看全部）" }

$src = [System.Drawing.Bitmap]::FromFile((Resolve-Path $Image).Path)
$W = $src.Width; $H = $src.Height
$side = [Math]::Max($W, $H)

$canvas = New-Object System.Drawing.Bitmap($side, $side)
$g = [System.Drawing.Graphics]::FromImage($canvas)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$unit = [System.Drawing.GraphicsUnit]::Pixel

if ($Mode -eq 'pad') {
  if ($W -ge $H) {
    # 横图：上下补
    $pad = [int](($side - $H) / 2)
    $g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $side, $pad)),
                       (New-Object System.Drawing.Rectangle(0, 0, $W, 1)), $unit)
    $g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, ($pad + $H), $side, ($side - $pad - $H))),
                       (New-Object System.Drawing.Rectangle(0, ($H - 1), $W, 1)), $unit)
    $g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, $pad, $W, $H)),
                       (New-Object System.Drawing.Rectangle(0, 0, $W, $H)), $unit)
  } else {
    # 竖图：左右补（最常见的手机截图 / 微信图片）
    $pad = [int](($side - $W) / 2)
    $g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $pad, $side)),
                       (New-Object System.Drawing.Rectangle(0, 0, 1, $H)), $unit)
    $g.DrawImage($src, (New-Object System.Drawing.Rectangle(($pad + $W), 0, ($side - $pad - $W), $side)),
                       (New-Object System.Drawing.Rectangle(($W - 1), 0, 1, $H)), $unit)
    $g.DrawImage($src, (New-Object System.Drawing.Rectangle($pad, 0, $W, $H)),
                       (New-Object System.Drawing.Rectangle(0, 0, $W, $H)), $unit)
  }
} else {
  # crop：中心方形裁切（内容铺满，但会切掉边上）
  $x = [int](($W - $side) / 2); $y = [int](($H - $side) / 2)
  $g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $side, $side)),
                     (New-Object System.Drawing.Rectangle($x, $y, $side, $side)), $unit)
}
$g.Dispose()

$final = New-Object System.Drawing.Bitmap($Size, $Size)
$g2 = [System.Drawing.Graphics]::FromImage($final)
$g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g2.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g2.DrawImage($canvas, 0, 0, $Size, $Size)
$g2.Dispose()

if (-not (Test-Path $targetDir)) { New-Item -ItemType Directory -Path $targetDir -Force | Out-Null }
$dst = Join-Path $targetDir ($Id + '.png')
$final.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
$final.Dispose(); $canvas.Dispose(); $src.Dispose()

$kb = [Math]::Round((Get-Item $dst).Length / 1KB, 1)
Write-Host ''
Write-Host "  完成: $($dst.Substring($Root.Length + 1))  ($kb KB)" -ForegroundColor Green
Write-Host "  $($match.Name)  原图 ${W}x${H}  模式 $Mode  →  ${Size}x${Size}"
Write-Host '  刷新页面就能看到（零构建）。' -ForegroundColor Gray