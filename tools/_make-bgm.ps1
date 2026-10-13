<#
  把任意音视频文件做成"能无缝循环"的背景音乐 audio/bgm.m4a

  为什么要这个脚本：
    user 给的是一段 16 秒的视频音频。直接 <audio loop> 播的话，
    ① 头尾常常带一点静音 → 每圈都有一段空白；
    ② 结尾和开头接不上 → 每圈"啪"一下（波形不连续的爆音）。
    这个脚本把这两件事一起解决：
      1. 用 Windows 自带的 Media Foundation 解码成 WAV（不用 ffmpeg）
      2. 掐掉头尾的静音
      3. 做**交叉淡化拼接**：把结尾 F 秒和开头 F 秒叠在一起，
         拼出来的循环在接缝处本来就是连续的（数学上就是同一段素材）
      4. 再编码回 AAC/m4a

  用法：
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\_make-bgm.ps1 ^
        -In "视频.mp4" -Out "audio\bgm.m4a"

  参数：
    -FadeSec   交叉淡化的长度，默认 0.6 秒（太长会听出两遍，太短会听出接缝）
    -SilenceDb 判定静音的阈值，默认 -52 dBFS
    -Bitrate   AAC 码率，默认 160000

  ★ 写法上的坑（踩过）：转码那几步**故意不封成函数**，平铺写在主流程里。
    封成 Transcode 函数之后同样几句就会卡住不返回，而平铺写一次就过。
    宁可重复几行。
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$In,
  [string]$Out = 'audio\bgm.m4a',
  [double]$FadeSec = 0.6,
  [double]$SilenceDb = -52,
  [int]$Bitrate = 160000
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime

# ---------------------------------------------------------------- C# 处理器
# PowerShell 逐样本循环 100 万个点要几分钟，所以编译一段 C# 来算。
$cs = @'
using System;
using System.Text;

public class LoopFix {
  static short Rd16(byte[] b, int i) { return (short)(b[i] | (b[i + 1] << 8)); }
  static int Rd32(byte[] b, int i) { return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24); }
  static void Wr32(byte[] b, int i, int v) {
    b[i] = (byte)(v & 0xFF); b[i + 1] = (byte)((v >> 8) & 0xFF);
    b[i + 2] = (byte)((v >> 16) & 0xFF); b[i + 3] = (byte)((v >> 24) & 0xFF);
  }
  static void Wr16(byte[] b, int i, short v) { b[i] = (byte)(v & 0xFF); b[i + 1] = (byte)((v >> 8) & 0xFF); }

  public static byte[] Process(byte[] wav, double silenceDb, double fadeSec, out string info) {
    int pos = 12, fmt = -1, data = -1, dataLen = 0;
    int ch = 2, bits = 16, rate = 44100;
    while (pos + 8 <= wav.Length) {
      string id = Encoding.ASCII.GetString(wav, pos, 4);
      int sz = Rd32(wav, pos + 4);
      if (id == "fmt ") { fmt = pos + 8; ch = Rd16(wav, fmt + 2); rate = Rd32(wav, fmt + 4); bits = Rd16(wav, fmt + 14); }
      else if (id == "data") { data = pos + 8; dataLen = sz; }
      if (sz <= 0) break;
      pos += 8 + sz + (sz & 1);
    }
    if (fmt < 0 || data < 0) throw new Exception("no fmt/data chunk in wav");
    if (bits != 16) throw new Exception("only 16-bit PCM supported, got " + bits);
    int frameBytes = ch * 2;
    int frames = dataLen / frameBytes;
    if (frames < rate) throw new Exception("too short");

    double[] L = new double[frames], R = new double[frames];
    for (int i = 0; i < frames; i++) {
      int so = data + i * frameBytes;
      L[i] = Rd16(wav, so) / 32768.0;
      R[i] = ch > 1 ? Rd16(wav, so + 2) / 32768.0 : L[i];
    }

    double thr = Math.Pow(10, silenceDb / 20.0);
    int start = 0;
    while (start < frames && Math.Abs(L[start]) < thr && Math.Abs(R[start]) < thr) start++;
    int end = frames - 1;
    while (end > start && Math.Abs(L[end]) < thr && Math.Abs(R[end]) < thr) end--;
    end++;
    int pad = (int)(rate * 0.012);
    if (start > pad) start -= pad;
    if (end + pad < frames) end += pad;

    int T = end - start;
    int F = (int)(rate * fadeSec);
    if (F > T / 4) F = T / 4;
    if (F < 0) F = 0;
    int outFrames = T - F;

    short[] oL = new short[outFrames], oR = new short[outFrames];
    for (int i = 0; i < outFrames; i++) {
      double l = L[start + i], r = R[start + i];
      if (i < F) {
        double w = (double)i / F;
        l = l * w + L[start + T - F + i] * (1 - w);
        r = r * w + R[start + T - F + i] * (1 - w);
      }
      oL[i] = (short)Math.Max(-32768, Math.Min(32767, Math.Round(l * 32767)));
      oR[i] = (short)Math.Max(-32768, Math.Min(32767, Math.Round(r * 32767)));
    }

    double seam = Math.Max(Math.Abs(oL[outFrames - 1] - oL[0]), Math.Abs(oR[outFrames - 1] - oR[0])) / 32768.0;
    double typ = 0; int n = 0;
    for (int i = 1; i < outFrames; i += 7) {
      typ += Math.Abs(oL[i] - oL[i - 1]) + Math.Abs(oR[i] - oR[i - 1]); n += 2;
    }
    typ = n > 0 ? typ / n : 0;
    double hardSeam = Math.Max(Math.Abs(L[end - 1] - L[start]), Math.Abs(R[end - 1] - R[start])) / 32768.0;

    int outLen = 44 + outFrames * frameBytes;
    byte[] ob = new byte[outLen];
    Encoding.ASCII.GetBytes("RIFF").CopyTo(ob, 0); Wr32(ob, 4, outLen - 8);
    Encoding.ASCII.GetBytes("WAVEfmt ").CopyTo(ob, 8); Wr32(ob, 16, 16);
    Wr16(ob, 20, (short)1); Wr16(ob, 22, (short)ch); Wr32(ob, 24, rate);
    Wr32(ob, 28, rate * frameBytes); Wr16(ob, 32, (short)frameBytes); Wr16(ob, 34, 16);
    Encoding.ASCII.GetBytes("data").CopyTo(ob, 36); Wr32(ob, 40, outFrames * frameBytes);
    for (int i = 0; i < outFrames; i++) {
      int p = 44 + i * frameBytes;
      Wr16(ob, p, oL[i]);
      if (ch > 1) Wr16(ob, p + 2, oR[i]);
    }

    info = string.Format(
      "{0}Hz {1}ch {2}bit | 原始 {3:N2}s -> 掐掉头 {4:N0}ms / 尾 {5:N0}ms -> {6:N2}s | 交叉淡化 {7:N0}ms | 输出 {8:N2}s" +
      "\n        接缝跳变 {9:N4}（硬切是 {10:N4}，素材内部平均 {11:N4}）  {12} | RATE={13}",
      rate, ch, bits,
      (double)frames / rate,
      (double)start * 1000 / rate, (double)(frames - end) * 1000 / rate, (double)T / rate,
      (double)F * 1000 / rate, (double)outFrames / rate,
      seam, hardSeam, typ,
      seam <= Math.Max(0.02, typ * 4) ? "OK 接缝看不出来" : "接缝仍偏大",
      rate);
    return ob;
  }
}
'@
Add-Type -TypeDefinition $cs -Language CSharp

# ---------------------------------------------------------------- WinRT 工具
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

# TranscodeAsync() 返回 IAsyncAction，PS 5.1 里绑不上 AsTask，只能轮询输出文件
function Wait-File($path) {
  $last = -1; $stable = 0; $waited = 0
  while ($waited -lt 120000) {
    Start-Sleep -Milliseconds 400; $waited += 400
    if (-not (Test-Path $path)) { continue }
    $sz = (Get-Item $path).Length
    if ($sz -eq $last -and $sz -gt 0) { $stable++ } else { $stable = 0 }
    $last = $sz
    if ($stable -ge 6) { return $sz }
  }
  if (Test-Path $path) { return (Get-Item $path).Length }
  return 0
}

$tmpWav = Join-Path $env:TEMP 'st-bgm-raw.wav'
$tmpWav2 = Join-Path $env:TEMP 'st-bgm-loop.wav'

# ---------------------------------------------------------------- 第 1 步：解码成 WAV
Write-Host ('[1/3] 解码 -> ' + $tmpWav)
if (Test-Path $tmpWav) { Remove-Item $tmpWav -Force }
$wavProfile = [Windows.Media.MediaProperties.MediaEncodingProfile]::CreateWav([Windows.Media.MediaProperties.AudioEncodingQuality]::High)
$srcFile = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($In)) ([Windows.Storage.StorageFile])
$tmpFolder = Await ([Windows.Storage.StorageFolder]::GetFolderFromPathAsync($env:TEMP)) ([Windows.Storage.StorageFolder])
$wavFile = Await ($tmpFolder.CreateFileAsync('st-bgm-raw.wav', [Windows.Storage.CreationCollisionOption]::ReplaceExisting)) ([Windows.Storage.StorageFile])
$tc1 = New-Object Windows.Media.Transcoding.MediaTranscoder
$prep1 = Await ($tc1.PrepareFileTranscodeAsync($srcFile, $wavFile, $wavProfile)) ([Windows.Media.Transcoding.PrepareTranscodeResult])
if (-not $prep1.CanTranscode) { throw ('cannot decode: ' + $prep1.FailureReason) }
$null = $prep1.TranscodeAsync()
$n1 = Wait-File $tmpWav
Write-Host ("      $n1 bytes")

# ---------------------------------------------------------------- 第 2 步：掐静音 + 交叉淡化
Write-Host '[2/3] 掐静音 + 交叉淡化拼接'
$bytes = [System.IO.File]::ReadAllBytes($tmpWav)
$info = ''
$outBytes = [LoopFix]::Process($bytes, $SilenceDb, $FadeSec, [ref]$info)
[System.IO.File]::WriteAllBytes($tmpWav2, $outBytes)
$rate = 44100
if ($info -match 'RATE=(\d+)') { $rate = [int]$Matches[1] }
Write-Host ('      ' + $info)
Write-Host ('      ' + (Get-Item $tmpWav2).Length + ' bytes')

# ---------------------------------------------------------------- 第 3 步：编码回 m4a
$outAbs = [System.IO.Path]::GetFullPath($Out)
$outDir = [System.IO.Path]::GetDirectoryName($outAbs)
$outName = [System.IO.Path]::GetFileName($outAbs)
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
Write-Host ('[3/3] 编码 -> ' + $outAbs + '   (' + $rate + 'Hz AAC ' + $Bitrate + ')')
if (Test-Path $outAbs) { Remove-Item $outAbs -Force }
$m4aProfile = [Windows.Media.MediaProperties.MediaEncodingProfile]::CreateM4a([Windows.Media.MediaProperties.AudioEncodingQuality]::High)
$m4aProfile.Audio = [Windows.Media.MediaProperties.AudioEncodingProperties]::CreateAac($rate, 2, $Bitrate)
$loopFile = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($tmpWav2)) ([Windows.Storage.StorageFile])
$outFolder = Await ([Windows.Storage.StorageFolder]::GetFolderFromPathAsync($outDir)) ([Windows.Storage.StorageFolder])
$outFile = Await ($outFolder.CreateFileAsync($outName, [Windows.Storage.CreationCollisionOption]::ReplaceExisting)) ([Windows.Storage.StorageFile])
$tc2 = New-Object Windows.Media.Transcoding.MediaTranscoder
$prep2 = Await ($tc2.PrepareFileTranscodeAsync($loopFile, $outFile, $m4aProfile)) ([Windows.Media.Transcoding.PrepareTranscodeResult])
if (-not $prep2.CanTranscode) { throw ('cannot encode: ' + $prep2.FailureReason) }
$null = $prep2.TranscodeAsync()
$n3 = Wait-File $outAbs
Write-Host ("      $n3 bytes")

Remove-Item $tmpWav, $tmpWav2 -Force -ErrorAction SilentlyContinue
Write-Host 'DONE'
