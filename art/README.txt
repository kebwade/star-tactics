棋子立绘放这里（art/）
========================================

文件名 = 棋子的 id（不是显示名）。把 PNG 丢进这个目录、刷新页面就自动换上，
一个字都不用改代码。找不到图片也不会破图：会退回「按棋子主色生成的渐变 + emoji」。

规格建议：
  · PNG，透明背景
  · 正方形 512×512，内容尽量铺满画面
  · 卡面显示尺寸最大约 304px（手机上按 2 倍屏算 ≈608px），
    所以 1024 的图在游戏里看不出区别，代价却是 4 倍体积和 4 倍解码内存 ——
    统一按 512 出图就行。
  · 战斗画面上，敌方一侧的立绘会**水平镜像**（两边面对面），
    所以画面里不要有文字；有字的话会被镜像成反的。

全部 24 个棋子的文件名对照
----------------------------------------

【1 费】
  acolyte.png       豆包 🥟
  bowman.png        荣誉 🏹
  dagger.png        愤怒的普通人 😠
  pyromancer.png    羊帆 🐑
  spearman.png      电棍 ⚡
  stoneguard.png    奶龙 🐲
  vine.png          嘉豪 🕶️
  wolfrider.png     狼王 🐺

【2 费】
  falconer.png      丁真 🐆（原「猎鹰手」）
  frostmage.png     冰冰冰 🧊🧊🧊
  ironwall.png      100元的鸭子 🦆
  templar.png       东北雨姐 🍠
  twinblade.png     鹰佐 🌀（原「双刃舞者」）

【3 费】
  alchemist.png     美团袋鼠 🦘
  brute.png         牢大 🐂
  crossbow.png      陈兴裕 🔪（原「弩手」，已从 2 费升到 3 费）
  medic.png         老牧师 🙏
  windcaller.png    楚生疑犯 🌧️

【4 费】
  abyss.png         祖国人 🦸（原「深渊祭司」）
  butcher.png       孙笑川 🪓
  deadeye.png       Dank1ng 🎯
  earthwarden.png   蓝色大肥鱼 🐟（原「大地守护」）

【5 费】
  blademaster.png   张雪峰 ❄️
  titan.png         钟离 🪨（原「山岳」）
  zmjjkk.png        ZMJJKK 🔫（2026-10 新增）
  liuhaowen.png     刘浩文 📱（2026-10 新增）

★ 改名不改 id：上面那些「原「XXX」」都是**只改显示名**，
  文件名仍然是老 id —— levels.js 的阵容、自检的场景、以及这里全部按 id 索引。

装备图标放 art/items/
----------------------------------------

装备图标和棋子立绘是**同一套逻辑**，但放在子目录里（免得万一和棋子同名互相覆盖）：

  art/items/<装备id>.png

文件名同样跟 **id** 走、不跟显示名走。规格建议 256×256（图标显示得很小），
没图就退回装备自己的 emoji。现有的三张：

  art/items/belt.png        剧毒火龙果 🐉（原「巨人腰带」，id 仍是 belt）
  art/items/swiftboots.png  和成天下5000精品大果 🌰
  art/items/thornmail.png   讲话石 🗣️（原「荆棘之甲」，id 仍是 thornmail）
