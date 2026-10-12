# ============================================================
# 把 hosts 里**和 GitHub 有关的**行注释掉，让部署脚本能连上 api.github.com
#
#   ★ 为什么需要它：一些"GitHub / Steam 加速器"或屏蔽工具会往 hosts 里写
#     `127.0.0.1 api.github.com` 这样的行。工具开着的时候没事，
#     工具一关（或者它只是写进去就不管了），这个域名就被指到了本机 ——
#     于是部署脚本每个请求都报"无法连接到远程服务器"。
#
#   ★ 它只做两件事，而且都可逆：
#       ① 把原文件备份成 hosts.bak-<时间戳>（放在同一个目录）
#       ② 给匹配到的行**前面加 #**（注释掉，不删除）—— 想还原就把 # 去掉
#
#   ★ 只动 github 相关的行：这台机器上还有一批 steam / huggingface /
#     greasyfork / hub.docker 的条目，那些不动（部署用不到它们，
#     也不该由这个脚本来决定）。
#
#   ★★ 必须**以管理员身份**运行（hosts 在 System32 下）。
# ============================================================
$ErrorActionPreference = 'Stop'

function Say($msg, $color) {
  if ($color) { Write-Host $msg -ForegroundColor $color } else { Write-Host $msg }
}
# 提示语一律自己打印：Read-Host 的提示在有些环境下**根本不显示**（踩过）
function Ask($prompt) {
  Write-Host $prompt -NoNewline -ForegroundColor Cyan
  $line = [Console]::ReadLine()
  if ($null -eq $line) { return '' }
  return $line.Trim()
}

$hosts = Join-Path $env:WINDIR 'System32\drivers\etc\hosts'
Say ''
Say '=== 修复部署连接（注释掉 hosts 里的 GitHub 条目）===' 'Cyan'
Say "文件：$hosts" 'DarkGray'

if (-not (Test-Path $hosts)) { Say "找不到 hosts 文件，退出。" 'Red'; exit 1 }

$lines = @(Get-Content -Path $hosts -ErrorAction Stop)

# 找出"会被这个脚本动"的行：非注释、且域名里含 github
$targets = @()
for ($i = 0; $i -lt $lines.Count; $i++) {
  $l = $lines[$i]
  if ($l -match '^\s*#') { continue }
  if ($l -match '\S') {
    if ($l -match 'github') { $targets += $i }
  }
}

Say ''
if ($targets.Count -eq 0) {
  Say 'hosts 里没有 GitHub 相关的行，什么都不用改。' 'Green'
  Say '（那部署要是还连不上，就是别的原因 —— 比如代理或防火墙。）' 'DarkGray'
  exit 0
}

Say "找到 $($targets.Count) 行 GitHub 相关的条目：" 'Yellow'
foreach ($i in $targets) { Say ("  " + $lines[$i].Trim()) 'DarkGray' }
Say ''
Say '它们会在前面加一个 #（注释掉，不删除）。' 'Yellow'
Say '原文件会先备份成 hosts.bak-时间戳，随时能还原。' 'Yellow'
Say ''
$ans = Ask '确认要改吗？（输入 y 再回车 = 改；直接回车 = 取消）> '
if ($ans -ne 'y' -and $ans -ne 'Y') { Say '取消了，什么都没改。' 'DarkGray'; exit 0 }

# 备份（带时间戳，不会覆盖上一次的备份）
$bak = "$hosts.bak-" + (Get-Date -Format 'yyyyMMdd-HHmmss')
Copy-Item -Path $hosts -Destination $bak -Force
Say ''
Say "已备份：$bak" 'Green'

# 注释掉目标行
foreach ($i in $targets) { $lines[$i] = '# ' + $lines[$i] }

try {
  # hosts 是纯 ASCII，用不带 BOM 的 UTF8 写回去（带 BOM 的 hosts 有的程序会读错）
  [System.IO.File]::WriteAllLines($hosts, $lines, (New-Object System.Text.UTF8Encoding $false))
} catch {
  Say ''
  Say "写入失败：$($_.Exception.Message)" 'Red'
  Say '★ 多半是没以管理员身份运行 —— 关掉窗口，右键这个 bat / ps1' 'Yellow'
  Say '  选「以管理员身份运行」，再试一次。' 'Yellow'
  Say "（原文件没坏，备份也在：$bak）" 'DarkGray'
  exit 1
}

Say ''
Say "改完了：注释掉 $($targets.Count) 行。" 'Green'
Say '--- 验证一下域名解析 ---' 'Cyan'
Start-Sleep -Seconds 1
$ips = @()
try { $ips = [System.Net.Dns]::GetHostAddresses('api.github.com') | ForEach-Object { $_.IPAddressToString } } catch { }
if ($ips -contains '127.0.0.1') {
  Say "仍然解析到 127.0.0.1 —— 可能是 DNS 缓存，重启一次浏览器/命令行再试；" 'Yellow'
  Say '或者还有别的地方（比如另一个 hosts 或代理软件）在挡。' 'Yellow'
} elseif ($ips.Count -eq 0) {
  Say '解析不出来了（可能这台机器本来就连不上 api.github.com）。' 'Yellow'
} else {
  Say "api.github.com → $($ips -join ', ')　✓ 不再是 127.0.0.1 了" 'Green'
  Say '现在可以回去双击「一键部署到网上.bat」了。' 'Green'
}
Say ''
Say "想还原：把 $bak 覆盖回 $hosts 就行（或者手工去掉那些 #）。" 'DarkGray'
