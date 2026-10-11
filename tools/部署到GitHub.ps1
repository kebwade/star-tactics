# ============================================================
# 把整个项目发到 GitHub Pages（**不需要装 git**）
#
#   ★★ 这个文件必须保存成 **UTF-8 带 BOM**。
#      Windows PowerShell 5.1 读 .ps1 时靠 BOM 判断编码：没有 BOM 就按本地
#      代码页（这里 GBK）解，中文全变乱码，而且乱码里的引号错位会让整个
#      脚本报 "Unexpected token" —— 看起来像语法错误，其实是编码问题。
#      （用编辑器改完发现跑不了，先检查这一点。）
#
#   用的是 GitHub 的 REST API：建仓库 → 逐个文件上传 → 打开 Pages。
#   这台机器上没有 git，也没有 gh，所以走 API 是最省事的路子。
#
#   用法（双击 一键部署到网上.bat 也行，它就是在调这个脚本）：
#
#     powershell -ExecutionPolicy Bypass -File tools\部署到GitHub.ps1
#     powershell -ExecutionPolicy Bypass -File tools\部署到GitHub.ps1 -Repo 我的游戏
#
#   第一次要准备的：一个 GitHub Token
#     ① 打开 https://github.com/settings/tokens/new
#     ② Note 随便填（比如 star-tactics），Expiration 选 90 天或不过期
#     ③ 勾上 **repo** 这一整项（它包含建仓库 + 开 Pages 的权限）
#     ④ 生成之后把那串 ghp_... 复制下来 —— 它只显示一次
#   脚本会把 Token 存进 %USERPROFILE%\.star-tactics-token，下次直接回车复用。
#
#   ★ Token 等同于你的账号密码（至少对这个账号的仓库是）。
#     它不会离开这台机器，也不会被写进项目里（那个文件在项目目录之外）。
# ============================================================
[CmdletBinding()]
param(
  [string]$Token = '',
  [string]$Repo = 'star-tactics',
  [string]$Owner = '',
  [string]$Message = '',
  [switch]$Private,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$Api = 'https://api.github.com'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$TokenFile = Join-Path $env:USERPROFILE '.star-tactics-token'

# ---------- 哪些东西不上传 ----------
# 都是"本机产生的、不该进公开仓库"的东西。改这里就能调整上传范围。
$SkipDirs = @('.git', '.github', 'node_modules', '.vscode')
$SkipGlobs = @('*.bak', '*.tmp', '*.log', '~$*', '.DS_Store', 'Thumbs.db')

function Say($msg, $color) {
  if ($color) { Write-Host $msg -ForegroundColor $color } else { Write-Host $msg }
}

# 问用户要一行输入。
#
# ★★ 为什么不用 Read-Host：它的提示语**不会显示**。
#    实测（把输出重定向到文件再看）：
#      Read-Host '提示语'                  → 输出里根本没有"提示语"
#      Read-Host '提示语' -AsSecureString  → 没有提示语，而且直接卡死，
#                                            永远等一个看不见的输入，只能杀进程。
#    也就是说用 Read-Host 的话，用户看到一个黑窗口停在半空，
#    连"该在这里粘贴"这几个字都看不到 —— 这是最坑的一种坏法。
#    所以改成：自己用 Write-Host 打印提示（这个实测一定显示），
#    再用 [Console]::ReadLine() 读一行。
#    ReadLine 在真正的控制台里会正常回显用户敲的字，用户看得见自己在干什么。
function Ask($prompt) {
  Write-Host $prompt -NoNewline -ForegroundColor Cyan
  $line = [Console]::ReadLine()
  if ($null -eq $line) { return '' }
  return $line.Trim()
}

# ---------- Token ----------
if (-not $Token) { $Token = $env:GITHUB_TOKEN }
if (-not $Token -and (Test-Path $TokenFile)) {
  $Token = (Get-Content $TokenFile -Raw).Trim()
  if ($Token) { Say "（用上次存下的 Token：$($Token.Substring(0, [Math]::Min(7, $Token.Length)))…）" 'DarkGray' }
}
if (-not $Token) {
  if ($DryRun) { Say '（试运行，不需要 Token）' 'DarkGray' }
  else {
    <#
      ★★ 先说剪贴板。

      "往黑窗口里粘 Token"是整条流程里最容易卡住的一步 ——
      在 PowerShell 里粘进去**屏幕上什么都不会显示**（连星号都没有），
      很多人以为没粘上，于是反复粘、反复回车，最后以为坏了。
      而用户刚在 GitHub 上点过「复制」，那串 Token 就躺在剪贴板里 ——
      所以这里直接把它读出来，用户只需要按一个回车。

      ★★ 这段注释本身还踩过一个坑（记在这里免得再犯）：
         我一开始用的是 C 风格的行内块注释（斜杠加星号那种）。
         PowerShell **不认**那种写法，它会把那两个字符合起来当成命令名，报
         "The term is not recognized as the name of a cmdlet"；
         而脚本开头有 $ErrorActionPreference = 'Stop'，
         于是**整个脚本当场中止** —— 双击 .bat 之后黑窗口只打印了标题
         和一行红字就没了，看起来像"脚本坏了"，其实是注释语法写错。

      ★ 还有一个同类的坑：PowerShell 的块注释**不能嵌套**。
        在块注释里写出"井号紧跟着大于号"这两个字符，就会当场把注释关掉，
        后面的中文全被当成代码解析，报一个莫名其妙的 Unexpected token。
    #>
    $clip = ''
    try {
      $raw = Get-Clipboard -Raw -ErrorAction Stop
      if ($raw) { $clip = $raw.Trim() }
    } catch {}
    if ($clip -match '^(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})$') {
      Say ''
      Say ('剪贴板里正好有一串 Token：' + $clip.Substring(0, 7) + '…' +
           $clip.Substring($clip.Length - 4)) 'Green'
      $ans = Ask '直接用它吗？（直接回车 = 用；输入 n 再回车 = 我自己粘）> '
      if ($ans -ne 'n' -and $ans -ne 'N') { $Token = $clip }
    }
    if (-not $Token) {
      Say ''
      Say '需要一个 GitHub Token（只问这一次，之后会记在本机）：' 'Yellow'
      Say '  1. 打开 https://github.com/settings/tokens/new'
      Say '  2. 勾上 repo 这一整项'
      Say '  3. 生成后点那串 ghp_... 后面的「复制」按钮'
      Say ''
      Say '★ 回到**这个黑窗口**（不是粘到网页上）：先用鼠标点一下窗口里面，' 'Cyan'
      Say '  然后右键，或者按 Ctrl+V，最后按回车。' 'Cyan'
      Say '★ 粘进去会显示出一长串字符，这是正常的；按回车就行。' 'Cyan'
      Say '★ 如果实在粘不进来：把 Token 存成一个文件，路径是' 'DarkGray'
      Say "  $TokenFile" 'DarkGray'
      Say '  再双击一次就行了（脚本会自己读它）。' 'DarkGray'
      Say ''
      Say '----------------------------------------' 'Cyan'
      $Token = Ask '把 Token 粘到这一行的箭头后面，然后回车 > '
      $Token = $Token.Trim().Trim('"').Trim("'")
      if ($Token -like 'Bearer *') { $Token = $Token.Substring(7).Trim() }
    }
    if (-not $Token) { Say '没拿到 Token，退出。' 'Red'; exit 1 }
  }
}

# ---------- HTTP 小工具 ----------
# ★ Body 一律转成 UTF-8 字节再发：PowerShell 5.1 直接发字符串时
#   中文（提交信息、仓库描述）会按本地代码页编码，GitHub 那边就是乱码。
function CallApi {
  param([string]$Method, [string]$Path, $Body)
  $headers = @{
    'User-Agent' = 'star-tactics-deploy'
    'Accept'     = 'application/vnd.github+json'
  }
  if ($Token) { $headers['Authorization'] = "Bearer $Token" }
  $params = @{ Method = $Method; Uri = ($Api + $Path); Headers = $headers; TimeoutSec = 90 }
  if ($null -ne $Body) {
    $json = $Body | ConvertTo-Json -Depth 8 -Compress
    $params['Body'] = [System.Text.Encoding]::UTF8.GetBytes($json)
    $params['ContentType'] = 'application/json; charset=utf-8'
  }
  Invoke-RestMethod @params
}

function TryApi {
  param([string]$Method, [string]$Path, $Body)
  try { return @{ ok = $true; data = (CallApi -Method $Method -Path $Path -Body $Body) } }
  catch {
    $code = 0
    try { $code = [int]$_.Exception.Response.StatusCode } catch {}
    return @{ ok = $false; code = $code; msg = $_.Exception.Message }
  }
}

# ---------- 收集要上传的文件 ----------
Say ''
Say '=== 科币战争 · 一键部署到 GitHub Pages ===' 'Cyan'
Say "项目目录：$Root" 'DarkGray'

$files = @()
foreach ($f in (Get-ChildItem -Path $Root -Recurse -File -Force)) {
  $rel = $f.FullName.Substring($Root.Length + 1).Replace('\', '/')
  $parts = $rel.Split('/')
  $skip = $false
  foreach ($d in $SkipDirs) { if ($parts -contains $d) { $skip = $true } }
  foreach ($g in $SkipGlobs) { if ($f.Name -like $g) { $skip = $true } }
  if ($skip) { continue }
  $files += @{ rel = $rel; full = $f.FullName; size = $f.Length }
}
$totalKB = [int](($files | ForEach-Object { $_.size } | Measure-Object -Sum).Sum / 1KB)
Say ("要上传 {0} 个文件，共 {1} KB" -f $files.Count, $totalKB) 'DarkGray'

if ($DryRun) {
  $files | Sort-Object { $_.rel } | ForEach-Object {
    Say ("  {0,-46} {1,8} KB" -f $_.rel, [int]($_.size / 1KB))
  }
  Say ''
  Say '（试运行结束，什么都没上传。去掉 -DryRun 就真的发。）' 'Yellow'
  exit 0
}

# ---------- 我是谁 ----------
$me = TryApi 'GET' '/user'
if (-not $me.ok) {
  Say ''
  Say "Token 用不了：$($me.msg)" 'Red'
  Say '常见原因：拼错了 / 过期了 / 没勾 repo 权限。' 'Red'
  exit 1
}
if (-not $Owner) { $Owner = $me.data.login }
Say "登录身份：$($me.data.login)　目标仓库：$Owner/$Repo" 'Green'

# ---------- 建仓库（已经有了就跳过） ----------
$repoPath = "/repos/$Owner/$Repo"
$exists = TryApi 'GET' $repoPath
if (-not $exists.ok) {
  Say "仓库不存在，正在创建 $Owner/$Repo …" 'Yellow'
  $create = TryApi 'POST' '/user/repos' @{
    name        = $Repo
    private     = [bool]$Private
    description = '科币战争 —— 巴巴博弈：纯前端自走棋（零依赖、零构建）'
    has_issues  = $false
    has_wiki    = $false
    auto_init   = $false
  }
  if (-not $create.ok) {
    Say "创建失败（HTTP $($create.code)）：$($create.msg)" 'Red'
    if ($create.code -eq 403) { Say '（多半是 Token 没勾 repo 权限，或者免费账号建不了私有 Pages）' 'Red' }
    exit 1
  }
  Say '仓库建好了。' 'Green'
} else {
  Say '仓库已存在，这次是**更新**（同名文件会被覆盖）。' 'Green'
  if ($exists.data.private -and -not $Private) {
    Say '（注意：这个仓库是私有的。私有仓库要 GitHub 付费账号才能开 Pages。）' 'Yellow'
  }
}
$repoInfo = TryApi 'GET' $repoPath
$branch = if ($repoInfo.ok -and $repoInfo.data.default_branch) { $repoInfo.data.default_branch } else { 'main' }
Say "默认分支：$branch" 'DarkGray'

# ---------- 逐个文件上传 ----------
if (-not $Message) {
  $Message = '更新游戏内容（' + (Get-Date -Format 'yyyy-MM-dd HH:mm') + '）'
}
Say ''
Say "开始上传（每个文件一次请求，大约要几十秒）…" 'Cyan'
$done = 0
$failed = @()
foreach ($f in $files) {
  $done++
  # ★ 路径要按**每一段**分别转义：EscapeDataString 会把 / 也转成 %2F，
  #   那 GitHub 就找不到这个文件了（中文文件名同样要吃这一步）。
  $encPath = (($f.rel.Split('/')) | ForEach-Object { [uri]::EscapeDataString($_) }) -join '/'
  $contentPath = "$repoPath/contents/$encPath"

  $sha = $null
  $cur = TryApi 'GET' $contentPath
  if ($cur.ok -and $cur.data.sha) { $sha = $cur.data.sha }

  $body = @{
    message = $Message
    content = [Convert]::ToBase64String([IO.File]::ReadAllBytes($f.full))
  }
  # ★ 空文件 base64 之后是空串，GitHub 会当成"没带内容"报错。
  #   塞一个换行进去最省事：这类文件（.nojekyll）的存在本身就是全部意义。
  if ($body['content'] -eq '') {
    $body['content'] = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("`n"))
  }
  if ($sha) { $body['sha'] = $sha }

  $put = TryApi 'PUT' $contentPath $body
  if (-not $put.ok) {
    $failed += "$($f.rel) → HTTP $($put.code)"
    Say ("  [{0}/{1}] 失败 {2}（HTTP {3}）" -f $done, $files.Count, $f.rel, $put.code) 'Red'
  } elseif ($done % 10 -eq 0 -or $done -eq $files.Count) {
    Say ("  [{0}/{1}] …" -f $done, $files.Count) 'DarkGray'
  }
}
if ($failed.Count) {
  Say ''
  Say "有 $($failed.Count) 个文件没传上去：" 'Red'
  $failed | ForEach-Object { Say "  $_" 'Red' }
  Say '（重跑一次这个脚本会只补失败的那些，已传的会走更新。）' 'Yellow'
} else {
  Say "全部 $($files.Count) 个文件上传完成。" 'Green'
}

# ---------- 打开 Pages ----------
Say ''
Say '正在打开 GitHub Pages …' 'Cyan'
$pagesBody = @{ source = @{ branch = $branch; path = '/' } }
$pages = TryApi 'POST' "$repoPath/pages" $pagesBody
if (-not $pages.ok) {
  # 409 = 已经开过了；这时 PUT 一下让它重新构建一次
  $pages2 = TryApi 'PUT' "$repoPath/pages" $pagesBody
  if ($pages2.ok) { Say 'Pages 已经在跑，已触发一次重新构建。' 'Green' }
  elseif ($pages.ok -eq $false -and $pages.code -eq 404) {
    Say '开 Pages 失败（HTTP 404）—— 多半是 Token 缺权限，或者这个账号不支持。' 'Red'
    Say '可以手动开：仓库 → Settings → Pages → Source 选 "Deploy from a branch" → 选分支 → / (root) → Save' 'Yellow'
  } else {
    Say "开 Pages 返回 HTTP $($pages.code)：$($pages.msg)" 'Yellow'
    Say '（如果仓库设置里 Pages 已经是开的，这一条可以忽略。）' 'DarkGray'
  }
} else {
  Say 'Pages 已开启。' 'Green'
}

# ---------- 收尾 ----------
if (-not $env:GITHUB_TOKEN -and $Token) {
  try { Set-Content -Path $TokenFile -Value $Token -NoNewline -Encoding ASCII } catch {}
}

$site = if ($Repo -ieq "$Owner.github.io") { "https://$Owner.github.io/" }
        else { "https://$Owner.github.io/$Repo/" }

# ---------- 等它上线，并真的把几个关键文件下载一遍 ----------
# ★★ 为什么要等：文件传完了 ≠ 网站能打开。
#   GitHub Pages 拿到新提交之后要**重新构建**（第一次要 1~2 分钟），
#   构建期间访问这个网址是 404 —— 这是"发链接给别人时最常见的一次误会"。
#   所以脚本自己轮询到 200 为止，省得你反复刷。
$probe = @('index.html', 'js/units.js', 'game.css', 'art/deadeye.png', 'manifest.webmanifest')
$ready = $false
if (-not $DryRun) {
  Say ''
  Say '等 GitHub 把站点构建出来（第一次一般 1~2 分钟，最多等 4 分钟）…' 'Cyan'
  $deadline = (Get-Date).AddMinutes(4)
  $try = 0
  while ((Get-Date) -lt $deadline) {
    $try++
    $code = 0
    try {
      $r = Invoke-WebRequest -Uri ($site + 'index.html') -UseBasicParsing -TimeoutSec 20
      $code = [int]$r.StatusCode
    } catch {
      try { $code = [int]$_.Exception.Response.StatusCode } catch { $code = 0 }
    }
    if ($code -eq 200) { $ready = $true; break }
    $left = [int]($deadline - (Get-Date)).TotalSeconds
    Say ("  第 {0} 次：HTTP {1}（还没构建好）　还剩约 {2} 秒" -f $try, $code, $left) 'DarkGray'
    Start-Sleep -Seconds 12
  }
}

Say ''
Say '==================================================' 'Cyan'
Say "  你的游戏地址：$site" 'Green'
Say '==================================================' 'Cyan'
Say ''
if ($ready) {
  Say '✅ 已经上线了，我刚刚成功下载了首页。' 'Green'
  $missing = @()
  foreach ($rel in $probe) {
    try {
      $r = Invoke-WebRequest -Uri ($site + $rel) -UseBasicParsing -TimeoutSec 20
      if ([int]$r.StatusCode -ne 200) { $missing += "$rel → HTTP $($r.StatusCode)" }
    } catch { $missing += "$rel → $($_.Exception.Message)" }
  }
  if ($missing.Count) {
    Say '⚠ 但下面这几个文件没取到（多半还在构建，等一分钟再刷）：' 'Yellow'
    $missing | ForEach-Object { Say "   $_" 'Yellow' }
  } else {
    Say ("✅ 顺手验了 {0} 个关键文件（首页 / 脚本 / 样式 / 立绘 / manifest），全都是 200。" -f ($probe.Count + 1)) 'Green'
  }
} else {
  Say '⏳ 还没构建好 —— 这**不是**出错，GitHub 第一次建站就是慢。' 'Yellow'
  Say '   过一两分钟直接打开上面那个地址刷新一下就行。' 'Yellow'
  Say '   （想盯着构建进度：仓库 → Actions，或者 Settings → Pages。）' 'DarkGray'
}

Say ''
# ★ 顺手复制到剪贴板 —— 这个脚本的全部产出就是这一行地址，
#   而"复制一下再粘到微信里"正是拿到之后马上要做的事。
$copied = $false
try { Set-Clipboard -Value $site; $copied = $true } catch {}
if ($copied) { Say '地址已经复制到剪贴板，直接粘到微信 / QQ 发出去就行。' 'Green' }
else { Say '（剪贴板没复制成功，手动选中上面那行复制即可。）' 'DarkGray' }
Say ''
Say "发给别人的话，可以直接发这一行：" 'DarkGray'
Say "  来玩个游戏：$site" 'DarkGray'
Say ''
Say '★ 以后再更新：再双击一次这个 .bat 就行，**网址不变**，构建完大家刷新就是新版。' 'DarkGray'
Say '★ 手机上直接打开这个地址就能玩：布局会自动折成竖屏的一列。' 'DarkGray'
Say '★ 仓库地址（改说明、看构建状态）：' 'DarkGray'
Say "  https://github.com/$Owner/$Repo" 'DarkGray'
Say ''
