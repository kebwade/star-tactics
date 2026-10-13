# Minimal MP4 box probe: prints the box tree and, for each trak, the handler,
# timescale/duration and (for audio) sample/chunk stats + offset sanity.
# Usage: pwsh -File tools\_probe-mp4.ps1 -Path audio\bgm.m4a

param([Parameter(Mandatory = $true)][string]$Path)

$b = [System.IO.File]::ReadAllBytes((Resolve-Path $Path))
$len = $b.Length

function ReadU32([byte[]]$buf, [int]$i) {
  return ([int64]$buf[$i] -shl 24) -bor ([int64]$buf[$i + 1] -shl 16) -bor ([int64]$buf[$i + 2] -shl 8) -bor [int64]$buf[$i + 3]
}
function ReadU64([byte[]]$buf, [int]$i) {
  $v = [int64]0
  for ($k = 0; $k -lt 8; $k++) { $v = ($v -shl 8) -bor [int64]$buf[$i + $k] }
  return $v
}
function FourCC([byte[]]$buf, [int]$i) { return [System.Text.Encoding]::ASCII.GetString($buf, $i, 4) }

# returns array of @{type,start,size,data}
function Boxes([byte[]]$buf, [int]$from, [int]$to) {
  $out = New-Object System.Collections.ArrayList
  $i = $from
  while ($i + 8 -le $to) {
    $sz = ReadU32 $buf $i
    $ty = FourCC $buf $i
    $hdr = 8
    if ($sz -eq 1) { $sz = ReadU64 $buf ($i + 8); $hdr = 16 }
    elseif ($sz -eq 0) { $sz = $to - $i }
    if ($sz -lt $hdr -or ($i + $sz) -gt $to) { break }
    [void]$out.Add(@{ type = $ty; start = $i; size = $sz; data = $i + $hdr })
    $i += $sz
  }
  return $out
}
function One([byte[]]$buf, $list, [string]$type) {
  foreach ($x in $list) { if ($x.type -eq $type) { return $x } }
  return $null
}

Write-Host ("file: " + (Resolve-Path $Path) + "   " + $len + " bytes")

$top = Boxes $b 0 $len
foreach ($x in $top) { Write-Host ("  " + $x.type.PadRight(6) + " start=" + $x.start + " size=" + $x.size) }

$moov = One $b $top 'moov'
$mdat = One $b $top 'mdat'
if (-not $moov) { Write-Host 'NO MOOV -> invalid'; exit 2 }
if ($mdat) {
  $end = $mdat.data + ($mdat.size - ($mdat.data - $mdat.start))
  Write-Host ("  mdat payload ends at " + $end + "  (file " + $len + ")  " + $(if ($end -le $len) { 'OK' } else { 'TRUNCATED!' }))
}

$mvhd = One $b (Boxes $b $moov.data ($moov.start + $moov.size)) 'mvhd'
if ($mvhd) {
  $ts = ReadU32 $b ($mvhd.data + 12); $du = ReadU32 $b ($mvhd.data + 16)
  Write-Host ("  mvhd: timescale=" + $ts + " duration=" + $du + "  => " + [Math]::Round($du / $ts, 2) + " s")
}

$traks = @()
foreach ($x in (Boxes $b $moov.data ($moov.start + $moov.size))) { if ($x.type -eq 'trak') { $traks += $x } }
Write-Host ("  traks: " + $traks.Count)
foreach ($t in $traks) {
  $mdia = One $b (Boxes $b $t.data ($t.start + $t.size)) 'mdia'
  $hdlr = One $b (Boxes $b $mdia.data ($mdia.start + $mdia.size)) 'hdlr'
  $handler = FourCC $b ($hdlr.data + 8)
  $mdhd = One $b (Boxes $b $mdia.data ($mdia.start + $mdia.size)) 'mdhd'
  $ts = ReadU32 $b ($mdhd.data + 12); $du = ReadU32 $b ($mdhd.data + 16)
  Write-Host ("    handler=" + $handler + "  timescale=" + $ts + "  duration=" + $du + " => " + [Math]::Round($du / $ts, 2) + " s")
  if ($handler -ne 'soun') { continue }

  $minf = One $b (Boxes $b $mdia.data ($mdia.start + $mdia.size)) 'minf'
  $stbl = One $b (Boxes $b $minf.data ($minf.start + $minf.size)) 'stbl'
  $kids = Boxes $b $stbl.data ($stbl.start + $stbl.size)
  $stsz = One $b $kids 'stsz'; $stco = One $b $kids 'stco'; $stsc = One $b $kids 'stsc'; $stts = One $b $kids 'stts'
  $n = [int](ReadU32 $b ($stsz.data + 8))
  $sum = [int64]0; $maxS = 0
  for ($k = 0; $k -lt $n; $k++) { $v = [int](ReadU32 $b ($stsz.data + 12 + 4 * $k)); $sum += $v; if ($v -gt $maxS) { $maxS = $v } }
  $nch = [int](ReadU32 $b ($stco.data + 4))
  $first = ReadU32 $b ($stco.data + 8); $last = ReadU32 $b ($stco.data + 8 + 4 * ($nch - 1))
  $mono = $true; $prev = -1
  for ($k = 0; $k -lt $nch; $k++) { $o = ReadU32 $b ($stco.data + 8 + 4 * $k); if ($o -le $prev) { $mono = $false }; $prev = $o }
  $secs = $du / $ts
  Write-Host ("      samples=" + $n + "  bytes=" + $sum + " (" + [Math]::Round($sum / 1KB, 1) + " KB)  chunks=" + $nch + "  maxSample=" + $maxS)
  Write-Host ("      bitrate=" + [Math]::Round($sum * 8 / $secs / 1000, 1) + " kbps   stco[0]=" + $first + " stco[last]=" + $last + " monotonic=" + $mono)
  $stscN = [int](ReadU32 $b ($stsc.data + 4))
  Write-Host ("      stsc entries=" + $stscN + "  stts entries=" + (ReadU32 $b ($stts.data + 4)))
  if ($mdat -and $last -lt $len) { Write-Host '      offsets inside file: OK' }
}
