<#
  星辉棋阵 — 无头浏览器跑自检页

  为什么要这个脚本：这台机器上没装 Node.js，自检页只能在浏览器里跑。
  用 Edge/Chrome 的 headless 模式跑一遍并把报告 dump 出来，就能在命令行里
  直接看到 PASS/FAIL，不用每次手动双击。

  用法（Windows PowerShell 默认禁止运行脚本，所以要带 -ExecutionPolicy Bypass）：
    powershell -ExecutionPolicy Bypass -File tools\run-tests.ps1
    powershell -ExecutionPolicy Bypass -File tools\run-tests.ps1 -Page tests/gametest.html
    powershell -ExecutionPolicy Bypass -File tools\run-tests.ps1 -Page all

  两个踩过的坑，写在最前面免得再犯：
    1. 匹配报告行的关键字只用 ASCII（PASS / FAIL / >>>）。
       以前在这里用非 ASCII 的箭头字符做正则，文件编码一变就解析炸了。
    2. 报告里用的符号（⚠ ★ → · 等）在 936 代码页的控制台里根本显示不出来，
       会变成一串问号。所以要先把它们换成 ASCII 近似符号再输出。
#>
[CmdletBinding()]
param(
  [string]$Page = 'tests/simtest.html',
  [string]$Root = '',
  [int]$Budget = 180000,
  [string]$WindowSize = '1440,900'
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrEmpty($Root)) {
  if ($PSScriptRoot) { $Root = Split-Path -Parent $PSScriptRoot }
  else { $Root = (Get-Location).Path }
}

$ARROW = [string][char]0x2192
$DASH  = [string][char]0x2500

# 把 GBK 控制台显示不出来的符号换成 ASCII，只为可读性，不改页面本身
function ConvertTo-ConsoleSafe([string]$s) {
  if ($null -eq $s) { return '' }
  $s = $s.Replace([string][char]0x26A0, '[!]')     # warning sign
  $s = $s.Replace([string][char]0x2605, '*')       # black star
  $s = $s.Replace([string][char]0x2606, '-')       # white star
  $s = $s.Replace([string][char]0x2713, 'v')       # check mark
  $s = $s.Replace([string][char]0x2717, 'x')       # ballot x
  $s = $s.Replace([string][char]0x2192, '->')      # rightwards arrow
  $s = $s.Replace([string][char]0x00B7, '.')       # middle dot
  $s = $s.Replace([string][char]0x2026, '...')     # ellipsis
  $s = $s.Replace([string][char]0x2014, '--')      # em dash
  # 去掉 emoji：它们都是 BMP 之外的代理对，GBK 控制台一律显示成问号
  $s = [regex]::Replace($s, '[\uD800-\uDBFF][\uDC00-\uDFFF]', '')
  return $s
}

function Find-Browser {
  $cands = @(
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
  )
  foreach ($c in $cands) { if (Test-Path $c) { return $c } }
  throw 'Cannot find Edge or Chrome. Opening the test page in a browser works too.'
}

function ConvertFrom-HtmlText([string]$s) {
  if ($null -eq $s) { return '' }
  $s = $s.Replace('&lt;', '<')
  $s = $s.Replace('&gt;', '>')
  $s = $s.Replace('&quot;', '"')
  $s = $s.Replace('&#39;', "'")
  $s = $s.Replace('&amp;', '&')
  return $s
}

function Invoke-TestPage([string]$rel) {
  $browser = Find-Browser
  $prof = Join-Path $env:TEMP 'star-tactics-headless'
  $outFile = Join-Path $env:TEMP 'star-tactics-out.html'
  $errFile = Join-Path $env:TEMP 'star-tactics-err.txt'
  $abs = Join-Path $Root $rel
  $url = 'file:///' + ($abs -replace '\\', '/')

  # ★ 必须显式给窗口尺寸。headless 不传 --window-size 时默认 800x600，
  #   而布局是响应式的（--cell / --shop-card / --side-w 全都由视口算出来），
  #   800x600 下地图格子只有 37px，界面断言会全部误报。
  #   1440x900 是最常见的一档，界面断言按它来算。
  $browserArgs = @(
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    ("--user-data-dir=" + $prof), '--allow-file-access-from-files',
    '--disable-extensions', '--disable-background-networking', '--mute-audio',
    ("--window-size=" + $WindowSize),
    ("--virtual-time-budget=" + $Budget), '--dump-dom', $url
  )

  $sw = [Diagnostics.Stopwatch]::StartNew()
  $p = Start-Process -FilePath $browser -ArgumentList $browserArgs -NoNewWindow -Wait -PassThru `
    -RedirectStandardOutput $outFile -RedirectStandardError $errFile
  $sw.Stop()

  $html = Get-Content $outFile -Raw -Encoding UTF8

  Write-Host ''
  Write-Host ('=' * 74) -ForegroundColor DarkGray
  Write-Host ("  " + $rel + "   (" + [int]$sw.Elapsed.TotalSeconds + " s)") -ForegroundColor Cyan
  Write-Host ('=' * 74) -ForegroundColor DarkGray

  $m = [regex]::Match($html, '(?s)<pre id="report"[^>]*>(.*?)</pre>')
  if ($m.Success) {
    $report = ConvertFrom-HtmlText $m.Groups[1].Value
    foreach ($line in ($report -split "`r?`n")) {
      $safe = ConvertTo-ConsoleSafe $line
      $t = $safe.TrimStart()
      if ($t.StartsWith('FAIL')) { Write-Host $safe -ForegroundColor Red }
      elseif ($t.StartsWith($ARROW)) { Write-Host $safe -ForegroundColor Yellow }
      elseif ($t.StartsWith('PASS')) { Write-Host $safe -ForegroundColor DarkGray }
      elseif ($safe.Contains('ALL PASS')) { Write-Host $safe -ForegroundColor Green }
      elseif ($safe.Contains('FAILED')) { Write-Host $safe -ForegroundColor Red }
      elseif ($t.StartsWith($DASH)) { Write-Host $safe -ForegroundColor Cyan }
      else { Write-Host $safe -ForegroundColor Gray }
    }
  } else {
    Write-Host 'No <pre id="report"> in the page - the JS probably threw. Raw body:' -ForegroundColor Red
    $body = [regex]::Match($html, '(?s)<body>(.*?)</body>')
    if ($body.Success) {
      $t = ConvertTo-ConsoleSafe (ConvertFrom-HtmlText $body.Groups[1].Value)
      if ($t.Length -gt 3000) { $t = $t.Substring(0, 3000) }
      Write-Host $t -ForegroundColor DarkYellow
    } else {
      Write-Host '(not even a body - the browser probably failed to start)' -ForegroundColor Red
    }
  }

  $v = [regex]::Match($html, '###VERDICT###\s*([^<]*)')
  if ($v.Success) { $verdict = (ConvertFrom-HtmlText $v.Groups[1].Value).Trim() }
  else { $verdict = 'no verdict (page did not finish?)' }
  $ok = ($v.Success -and $verdict.StartsWith('ALL PASS'))

  Write-Host ''
  if ($ok) { Write-Host (">>> " + $verdict) -ForegroundColor Green }
  else { Write-Host (">>> " + $verdict) -ForegroundColor Red }
  Write-Host ''
  return $ok
}

$SUITES = @(
  'tests/simtest.html',
  'tests/balancetest.html',
  'tests/levelcurve.html',
  'tests/gametest.html'
)

$allOk = $true
if ($Page -eq 'all') {
  foreach ($p in $SUITES) { if (-not (Invoke-TestPage $p)) { $allOk = $false } }
} else {
  $allOk = Invoke-TestPage $Page
}

if ($allOk) { exit 0 } else { exit 1 }

