# Extract the audio track of a video into an audio-only .m4a using the
# Windows Media Foundation transcoder (no ffmpeg needed).
# ASCII only, so it runs fine under Windows PowerShell 5.1 without a BOM.

param(
  [Parameter(Mandatory=$true)][string]$In,
  [Parameter(Mandatory=$true)][string]$Out,
  [int]$Bitrate = 160000
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($op, $type) {
  $m = $asTaskGeneric.MakeGenericMethod($type)
  $t = $m.Invoke($null, @($op))
  $t.Wait(-1) | Out-Null
  $t.Result
}

# touch the WinRT projection types, otherwise the COM object handed back by
# TranscodeAsync() is a bare __ComObject and cannot bind to the AsTask overload.
[Windows.Foundation.IAsyncAction, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Foundation.IAsyncOperation`1, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null

$asTaskAction = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and -not $_.IsGenericMethod -and
  $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction'
})[0]
if (-not $asTaskAction) { throw 'no AsTask(IAsyncAction) overload found' }
Write-Host ("AsTask(IAsyncAction): " + $asTaskAction.ToString())

function AwaitAction($op) {
  $t = $asTaskAction.Invoke($null, @($op))
  $t.Wait(-1) | Out-Null
}

[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.StorageFolder, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Transcoding.MediaTranscoder, Windows.Media, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.MediaProperties.MediaEncodingProfile, Windows.Media, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.MediaProperties.AudioEncodingProperties, Windows.Media, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.CreationCollisionOption, Windows.Storage, ContentType = WindowsRuntime] | Out-Null

$src = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($In)) ([Windows.Storage.StorageFile])
Write-Host ("source: " + $src.Path + "  (" + $src.DateCreated + ")")

$outDir = [System.IO.Path]::GetDirectoryName($Out)
$outName = [System.IO.Path]::GetFileName($Out)
$folder = Await ([Windows.Storage.StorageFolder]::GetFolderFromPathAsync($outDir)) ([Windows.Storage.StorageFolder])
$dst = Await ($folder.CreateFileAsync($outName, [Windows.Storage.CreationCollisionOption]::ReplaceExisting)) ([Windows.Storage.StorageFile])
Write-Host ("target: " + $dst.Path)

$profile = [Windows.Media.MediaProperties.MediaEncodingProfile]::CreateM4a([Windows.Media.MediaProperties.AudioEncodingQuality]::High)
$profile.Audio = [Windows.Media.MediaProperties.AudioEncodingProperties]::CreateAac(44100, 2, $Bitrate)
Write-Host ("profile: m4a / AAC " + $Bitrate + " bps / 44100 Hz / 2ch")

$tc = New-Object Windows.Media.Transcoding.MediaTranscoder
$prep = Await ($tc.PrepareFileTranscodeAsync($src, $dst, $profile)) ([Windows.Media.Transcoding.PrepareTranscodeResult])
if (-not $prep.CanTranscode) {
  Write-Host ("CANNOT TRANSCODE: " + $prep.FailureReason)
  exit 3
}

# ★ Await() cannot be used on TranscodeAsync(): it hands back IAsyncAction, and
#   Windows PowerShell 5.1 marshals that as a bare __ComObject that will not bind
#   to AsTask(IAsyncAction) ("cannot be converted to type IAsyncAction").
#   So: fire it, then wait for the output file to stop growing. The caller
#   verifies the result by parsing the mp4 boxes afterwards.
$null = $prep.TranscodeAsync()
Write-Host 'transcoding...'
$last = -1; $stable = 0; $waited = 0
while ($waited -lt 180000) {
  Start-Sleep -Milliseconds 400
  $waited += 400
  if (-not (Test-Path $Out)) { continue }
  $sz = (Get-Item $Out).Length
  if ($sz -eq $last -and $sz -gt 0) { $stable++ } else { $stable = 0 }
  $last = $sz
  if ($stable -ge 6) { break }
}
$info = Get-Item $Out
Write-Host ("DONE  " + $info.FullName + "  " + $info.Length + " bytes  (waited " + $waited + " ms)")
