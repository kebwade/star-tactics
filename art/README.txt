棋子立绘 + 装备图标放这里
==========================

目录结构
--------

    art/<棋子id>.png          棋子立绘（24 个）
    art/items/<装备id>.png    装备图标（12 个）

    art/bowman.png            荣誉
    art/titan.png             山岳
    art/items/thornmail.png   讲话石（装备）

★ id 是**内部编号，永远不改**。改棋子的显示名字（比如「匕首客」→「愤怒的普通人」、
  「修女」→「豆包」、「荆棘之甲」→「讲话石」）**不需要改文件名**。
  换立绘也只是把同名的 png 覆盖掉 —— 代码那边一个字都不用动。

装备图标和棋子立绘分开放（`art/items/`），避免哪天装备和棋子撞名互相覆盖。

想省事就用现成的转换工具
------------------------

双击 `tools\做个立绘.bat`，按提示把图片拖进去、填 id 就行。

命令行也可以：

    :: 列出全部棋子 id（已有的会标出来）
    powershell -ExecutionPolicy Bypass -File tools\做个立绘.ps1 -List

    :: 棋子立绘
    powershell -ExecutionPolicy Bypass -File tools\做个立绘.ps1 -Image "C:\...\图.jpg" -Id dagger

    :: 装备图标（加 -Item，写到 art\items\，默认只存 256×256）
    powershell -ExecutionPolicy Bypass -File tools\做个立绘.ps1 -Item -List
    powershell -ExecutionPolicy Bypass -File tools\做个立绘.ps1 -Image "C:\...\图.jpg" -Id thornmail -Item

为什么要用工具，而不是直接把图丢进来
------------------------------------

同一张图要在**两种比例**里显示：

    · 商店卡立绘区    152 x 204   （比例 0.745，偏竖）
    · 棋盘 / 备战池   101 x 105   （比例 0.96，接近正方形）

两处都是 object-fit: cover（等比放大铺满 + 裁掉多余）。而手机截图和微信图片
基本都是 3:4 竖版（比例 0.75）—— 直接丢进去的话：

    商店卡  几乎不裁                ✓ 完美
    棋盘卡  上下各裁掉 11%          ✗ 头顶通常正好被切掉

工具默认的「补边」模式解决这个问题：把画面**两侧用边缘像素延展补成正方形**。

    正方形图 → 放进棋盘卡（接近正方形）几乎不裁   → 整个人都在
    正方形图 → 放进商店卡（0.745）两侧补的部分被裁 → 显示的就是原图

补边用的是边缘像素的克隆，所以不会有色块接缝。

规格建议
--------
· PNG（工具会自动转）
· 棋子：正方形 1024×1024，或任意比例交给工具处理
  （原图本身较小、或只求文件小的时候可以 -Size 512，显示尺寸最多也就 304px）
· 装备图标：显示尺寸只有 38px，默认 256×256 就够
· 内容尽量铺满画面：卡面显示区是「铺满 + 裁切」，留太多空白会显得小

没有图片也不会破
----------------
找不到图片时界面会自动退回「按棋子主色生成的渐变 + emoji」（装备退回 emoji），
所以你可以一张一张慢慢补，任何时候打开都不难看。
**图片和 emoji 可以混用** —— 只有一件装备有图、其它还是 emoji，也不会不协调。

24 个棋子文件名（按费用分组）
-----------------------------

【1 费】stoneguard.png 奶龙 / bowman.png 荣誉 / pyromancer.png 羊帆
        wolfrider.png 狼王 / acolyte.png 豆包 / dagger.png 愤怒的普通人
        spearman.png 长枪兵 / vine.png 嘉豪

【2 费】crossbow.png 弩手 / ironwall.png 100元的鸭子 / frostmage.png 冰霜法师
        twinblade.png 双刃舞者 / falconer.png 猎鹰手 / templar.png 圣殿骑士

【3 费】alchemist.png 炼金师 / brute.png 牢大 / windcaller.png 楚生疑犯
        medic.png 老牧师

【4 费·稀有】abyss.png 深渊祭司 / deadeye.png Dank1ng
             butcher.png 血月屠夫 / earthwarden.png 大地守护

【5 费·传说】titan.png 山岳 / blademaster.png 张雪峰
             （这两张最值得精修 —— 5 费只有 7 级 12%、8 级 20% 才刷得到）

12 个装备图标（放 art\items\）
------------------------------

已有图标：thornmail.png 讲话石 / swiftboots.png 和成天下5000精品大果

giantblade 巨力之刃 / swiftboots 和成天下5000精品大果 / spellbook 秘法之书
dragonscale 龙鳞甲 / voidcloak 虚空斗篷 / belt 巨人腰带
sapphire 蓝水晶 / huntereye 猎手之眼 / infinity 无尽之刃
bloodthirst 血饮剑 / thornmail 讲话石 / holygrail 圣杯

放好之后刷新页面即可（这个项目零构建，改完刷新就行）。
想确认素材齐了没：打开页面按 F12，在控制台输入  ART.report()
（它会分别报「棋子立绘」和「装备图标」的进度。）
