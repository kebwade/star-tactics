# 诊断：Media Foundation 转 WAV 到底卡在哪一步（每一步都打时间戳）
param(
  [Parameter(Mandatory = $true)][string]$In,
  [Parameter(Mandatory = $true)][string]$Out
)
$ErrorActionPreference = 'Stop'
$sw = [Diagnostics.Stopwatch]::StartNew()
function Mark($m) { Write-Host ("[{0,6:N0} ms] {1}" -f $sw.Elapsed.TotalMilliseconds, $m) }

Add-Type -AssemblyName System.Runtime.WindowsRuntime
Mark 'assembly loaded'

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($op, $type) {
  $m = $asTaskGeneric.MakeGenericMethod($type)
  $t = $m.Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result
}
[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.StorageFolder, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Transcoding.MediaTranscoder, Windows.Media, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.MediaProperties.MediaEncodingProfile, Windows.Media, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.MediaProperties.AudioEncodingProperties, Windows.Media, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.CreationCollisionOption, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Foundation.IAsyncAction, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
Mark 'winrt types loaded'

$wavProfile = [Windows.Media.MediaProperties.MediaEncodingProfile]::CreateWav([Windows.Media.MediaProperties.AudioEncodingQuality]::High)
Mark ('CreateWav -> ' + $wavProfile.Audio.Subtype + ' ' + $wavProfile.Audio.SampleRate + 'Hz ' + $wavProfile.Audio.Channels + 'ch ' + $wavProfile.Audio.BitsPerSample + 'bit')

$pcm = [Windows.Media.MediaProperties.AudioEncodingProperties]::CreatePcm(44100, 2, 16)
Mark ('CreatePcm -> ' + $pcm.Subtype + ' ' + $pcm.SampleRate + 'Hz ' + $pcm.Channels + 'ch ' + $pcm.BitsPerSample + 'bit')

if (Test-Path $Out) { Remove-Item $Out -Force }
$src = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($In)) ([Windows.Storage.StorageFile])
Mark ('source opened: ' + $src.Name + ' ' + $src.DateCreated)

$outDir = [System.IO.Path]::GetDirectoryName($Out)
$outName = [System.IO.Path]::GetFileName($Out)
$folder = Await ([Windows.Storage.StorageFolder]::GetFolderFromPathAsync($outDir)) ([Windows.Storage.StorageFolder])
Mark ('folder: ' + $folder.Path)

$dst = Await ($folder.CreateFileAsync($outName, [Windows.Storage.CreationCollisionOption]::ReplaceExisting)) ([Windows.Storage.StorageFile])
Mark ('target created: ' + $dst.Path)

$tc = New-Object Windows.Media.Transcoding.MediaTranscoder
Mark 'transcoder created'

$prep = Await ($tc.PrepareFileTranscodeAsync($src, $dst, $wavProfile)) ([Windows.Media.Transcoding.PrepareTranscodeResult])
Mark ('prepared: CanTranscode=' + $prep.CanTranscode + ' reason=' + $prep.FailureReason)

$null = $prep.TranscodeAsync()
Mark 'transcode kicked off'
$last = -1; $stable = 0; $waited = 0
while ($waited -lt 60000) {
  Start-Sleep -Milliseconds 400; $waited += 400
  if (-not (Test-Path $Out)) { continue }
  $sz = (Get-Item $Out).Length
  if ($sz -eq $last -and $sz -gt 0) { $stable++ } else { $stable = 0 }
  $last = $sz
  Mark ('poll: ' + $sz + ' bytes, stable=' + $stable)
  if ($stable -ge 6) { break }
}
Mark ('final: ' + (Get-Item $Out).Length + ' bytes')
