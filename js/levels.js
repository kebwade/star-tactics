/* ============================================================
 * 科币战争 — 关卡数据（人机模式 · 10 关）
 *
 * 这份数据有两个用途，缺一不可：
 *
 *   1. 给游戏用：10 关的对手阵容、奖励、以及**只透露一点点的情报**。
 *      对手的完整阵容在开战前是不给玩家看的 —— 和云顶一样，
 *      你只能看到「对手是谁、大概多强」，打起来才知道对面什么阵。
 *
 *   2. 给 tests/levelcurve.html 用：每关配一份「参考玩家阵容」，
 *      代表一个有在认真玩的玩家打到这一关时大概能凑出什么。
 *      参考阵容能赢 → 说明这关可过；赢率过高 → 这关太水；
 *      赢率过低 → 这关是劝退墙。
 *      有了这个，难度曲线就不是拍脑袋，而是能跑出来看的。
 * ============================================================ */
(function () {
  'use strict';

  var ST = window.ST;

  /**
   * 10 关。
   *
   * name/title/emoji/color  对手的展示形象（开战前玩家能看到的全部信息）
   * arch                    体系标签（展示用，也提醒玩家该针对什么）
   * hint                    一句模糊的情报 —— 够玩家做准备，又不至于被剧透
   * threat                  威胁等级 1~5，纯展示
   * comp                    真实阵容（开战前隐藏）
   * clearGold               通关奖励金币
   * drop                    通关掉落的装备 id（可空）
   *
   * ★ 设计这两组阵容踩过的坑（第一版整条曲线是废的）：
   *   我给敌人配了成型的羁绊（比如狂战 5 → 全队 +60% 攻速），
   *   却给「参考玩家阵容」配了一堆没有协同的散卡。
   *   结果第 1 关 0% 过关率、第 6~10 关全是 0%，而第 5 关又 100%。
   *
   *   教训：**羁绊协同对战斗结果的影响，远大于面板数值。**
   *   比较两套阵容强不强，不能只看总星级，得看羁绊有没有凑起来。
   *   所以现在两边都必须是「成型的体系」，强度差靠星级和人数来控制。
   */
  var LEVELS = [
    {
      name: '见习剑士', title: '第一关 · 热身', emoji: '🗡️', color: '#8fa3b8',
      arch: '散兵', hint: '两个没怎么练过的新人，连羁绊都没凑齐。',
      threat: 1,
      comp: [
        { id: 'bowman', star: 1 }, { id: 'acolyte', star: 1 }
      ],
      clearGold: 6, drop: null
    },
    {
      name: '林间游侠', title: '第二关 · 远方来的箭', emoji: '🏹', color: '#6fbf73',
      arch: '游侠 / 医者', hint: '远程加个会回血的，前排是空的。冲上去就行。',
      threat: 1,
      comp: [
        { id: 'bowman', star: 1 }, { id: 'acolyte', star: 1 }, { id: 'vine', star: 1 }
      ],
      clearGold: 7, drop: null
    },
    {
      name: '铁匠学徒', title: '第三关 · 会打铁的也扛揍', emoji: '⚒️', color: '#9db86a',
      arch: '铁卫 2 档', hint: '前排比前两关硬，护甲有加成，代价是没什么输出。',
      threat: 2,
      comp: [
        { id: 'spearman', star: 1 },
        { id: 'stoneguard', star: 1 }, { id: 'vine', star: 1 }
      ],
      clearGold: 8, drop: 'giantblade'
    },
    {
      name: '沙盗头目', title: '第四关 · 人多势众', emoji: '🐺', color: '#a8763f',
      arch: '狂战 / 影袭', hint: '四个人，攻速叠起来很难缠。',
      threat: 2,
      comp: [
        { id: 'dagger', star: 1 },
        { id: 'wolfrider', star: 1 }, { id: 'bowman', star: 1 }, { id: 'twinblade', star: 1 }
      ],
      clearGold: 9, drop: null
    },
    {
      name: '寒霜法师', title: '第五关 · 别站成一堆', emoji: '❄️', color: '#6cc6e8',
      arch: '秘术 / 医者', hint: '范围法术为主，前排也补了装。站位散开能少挨不少。',
      threat: 3,
      comp: [
        { id: 'frostmage', star: 1, items: ['spellbook'] },
        { id: 'pyromancer', star: 1, items: ['spellbook'] },
        { id: 'acolyte', star: 1, items: ['belt'] },
        { id: 'ironwall', star: 1, items: ['dragonscale'] }
      ],
      clearGold: 10, drop: 'voidcloak'
    },
    {
      name: '血月佣兵', title: '第六关 · 五个人一起冲', emoji: '🪓', color: '#c0392b',
      arch: '狂战 4 档', hint: '五个人，狂战羁绊已经凑满一档，装备也齐了。前排顶不住会被瞬间清空。',
      threat: 3,
      comp: [
        { id: 'dagger', star: 1, items: ['giantblade'] },
        { id: 'wolfrider', star: 1, items: ['belt'] },
        { id: 'twinblade', star: 1, items: ['dragonscale'] },
        { id: 'bowman', star: 1, items: ['huntereye'] },
        { id: 'brute', star: 1, items: ['belt'] }
      ],
      clearGold: 11, drop: null
    },
    {
      name: '圣殿卫队', title: '第七关 · 一堵会回血的墙', emoji: '🏛️', color: '#d8c47a',
      arch: '铁卫 / 守护', hint: '开局全队带护盾，护甲也拉满了。硬拼物理是拼不过的。',
      threat: 3,
      comp: [
        { id: 'stoneguard', star: 2, items: ['dragonscale'] },
        { id: 'templar', star: 1, items: ['belt', 'voidcloak'] },
        { id: 'spearman', star: 1 }, { id: 'crossbow', star: 1, items: ['huntereye'] },
        { id: 'acolyte', star: 1 }
      ],
      clearGold: 12, drop: 'huntereye'
    },
    {
      name: '深渊教团', title: '第八关 · 法术强度拉满', emoji: '🕳️', color: '#8a6fd0',
      arch: '秘术 4 档', hint: '秘术凑满一档，全队法术强度 +75%。魔抗装该拿出来了。',
      threat: 4,
      comp: [
        { id: 'abyss', star: 1, items: ['spellbook', 'sapphire', 'belt'] },
        { id: 'frostmage', star: 2, items: ['spellbook'] },
        { id: 'windcaller', star: 1, items: ['spellbook'] },
        { id: 'acolyte', star: 1, items: ['belt'] },
        { id: 'alchemist', star: 1, items: ['holygrail'] },
        { id: 'ironwall', star: 1, items: ['dragonscale', 'voidcloak', 'belt'] }
      ],
      clearGold: 13, drop: 'voidcloak'
    },
    {
      name: '巨兽领主', title: '第九关 · 血厚得离谱', emoji: '🐘', color: '#6e7b88',
      arch: '巨兽 4 档', hint: '全员加最大生命，前排是两个巨型单位。磨不动就别硬磨。',
      threat: 4,
      comp: [
        { id: 'titan', star: 2, items: ['belt'] },
        { id: 'brute', star: 1, items: ['giantblade'] },
        { id: 'butcher', star: 1, items: ['belt'] },
        { id: 'wolfrider', star: 1, items: ['swiftboots'] },
        { id: 'stoneguard', star: 1, items: ['dragonscale', 'voidcloak'] },
        { id: 'vine', star: 1, items: ['holygrail'] }
      ],
      clearGold: 15, drop: 'bloodthirst'
    },
    {
      name: '山岳之主', title: '第十关 · 最终试炼', emoji: '🗿', color: '#d8b45f',
      arch: 'BOSS · 铁卫 / 巨兽', hint: '山岳亲自坐镇。前面所有的准备都是为了这一关。',
      threat: 4,
      // 注意：山岳现在是 5 费、1 星就有 1800 血。
      // 这里刻意只给 2 星、而且不带装备 —— 3 星是 5832 血 + 115 护甲，
      // 实测难度余量会掉到 −32%（劝退墙）；2 星带两件装也还是 −15%。
      // 5 费棋子的「稀有」体现在数值上就是这么猛，配关卡时必须留出余量。
      //
      // ★ 走位改成 0.3 秒一格之后，这一关从 +2% 掉到 −5%（打不过），
      //   所以又撤掉了血月屠夫。原因很直接：**慢速走位对「站桩肉墙」有利** ——
      //   进攻方要多走 1 秒才能贴上来，这段时间墙上的人白打。
      //   这关的定位本来就是「一堵墙」，所以削它的输出来换平衡，而不是削血量。
      comp: [
        { id: 'titan', star: 2 },
        { id: 'ironwall', star: 1 },
        { id: 'stoneguard', star: 1 },
        { id: 'templar', star: 1 },
        { id: 'butcher', star: 1 }
      ],
      clearGold: 20, drop: 'infinity'
    },

    /* ------------------------------------------------------------
     * 11 ~ 24 关：后半程。
     *
     * 难度旋钮只用三样：人数（6 → 8）、星级、装备件数。
     * 刻意**不动**羁绊强度 —— 双方都必须是成型的体系，
     * 否则比出来的就是「谁羁绊凑齐了」而不是「这关难不难」。
     *
     * 4 费从第 11 关开始成规模出现，5 费在第 15 关之后成为常客；
     * 第 24 关是八人满编、双 5 费核心，也是无尽模式的起点。
     *
     * ★ 5 费刻意不给 3 星：山岳 3 星是 5832 血 + 115 护甲，
     *   实测难度余量会直接掉到负数（劝退墙）。「稀有」体现在数值上就是这么猛，
     *   配关卡时必须留出余量 —— 这条注释是从第 10 关那一版抄过来的教训。
     * ------------------------------------------------------------ */
    {
      name: '独眼巨魔', title: '第十一关 · 四费登场', emoji: '👹', color: '#a8763f',
      arch: '狂战 / 巨兽', hint: '第一个四费核心。血厚、还带范围伤害，别站成一排。',
      threat: 4,
      comp: [
        { id: 'butcher', star: 2, items: ['belt', 'giantblade'] },
        { id: 'brute', star: 1, items: ['dragonscale'] },
        { id: 'wolfrider', star: 2 },
        { id: 'pyromancer', star: 2 }, { id: 'dagger', star: 1 }, { id: 'twinblade', star: 1 }
      ],
      clearGold: 16, drop: 'belt'
    },
    {
      name: '沙漠商队', title: '第十二关 · 箭如雨下', emoji: '🏜️', color: '#d8b45f',
      arch: '游侠 4 档', hint: '清一色远程，攻击力叠满。前排只有一层，冲进去就散。',
      threat: 4,
      comp: [
        { id: 'deadeye', star: 2, items: ['giantblade', 'huntereye'] },
        { id: 'bowman', star: 3, items: ['huntereye'] }, { id: 'crossbow', star: 2 },
        { id: 'falconer', star: 2 }, { id: 'spearman', star: 2, items: ['dragonscale'] },
        { id: 'windcaller', star: 2 }
      ],
      clearGold: 17, drop: null
    },
    {
      name: '秘境学者', title: '第十三关 · 法术强度拉满', emoji: '🔮', color: '#8a6fd0',
      arch: '秘术 4 档', hint: '技能伤害翻倍，一轮齐射能秒掉你的后排。',
      threat: 4,
      comp: [
        { id: 'abyss', star: 2, items: ['spellbook', 'sapphire'] },
        { id: 'frostmage', star: 2, items: ['spellbook'] },
        { id: 'alchemist', star: 2 }, { id: 'windcaller', star: 2 },
        { id: 'acolyte', star: 3 }, { id: 'ironwall', star: 2, items: ['dragonscale', 'voidcloak'] },
        { id: 'medic', star: 2, items: ['holygrail'] }
      ],
      clearGold: 18, drop: 'spellbook'
    },
    {
      name: '铁卫军团', title: '第十四关 · 打不穿', emoji: '🏯', color: '#8d9aa8',
      arch: '铁卫 4 档', hint: '全队 +100 护甲。物理输出在这关几乎打不动人。',
      threat: 4,
      comp: [
        { id: 'titan', star: 2, items: ['dragonscale', 'voidcloak', 'belt'] },
        { id: 'stoneguard', star: 3, items: ['belt'] },
        { id: 'ironwall', star: 2 }, { id: 'templar', star: 2 },
        { id: 'spearman', star: 3 }, { id: 'medic', star: 2, items: ['holygrail'] },
        { id: 'earthwarden', star: 2, items: ['dragonscale'] }
      ],
      clearGold: 18, drop: 'thornmail'
    },
    {
      name: '双生刺客', title: '第十五关 · 暴击流', emoji: '🗡️', color: '#e06a6a',
      arch: '影袭 4 档', hint: '全队 +55% 暴击率。输出看运气，但运气好的时候一下就没了。',
      threat: 5,
      comp: [
        { id: 'blademaster', star: 2, items: ['giantblade', 'huntereye', 'infinity'] },
        { id: 'dagger', star: 3, items: ['giantblade'] },
        { id: 'twinblade', star: 3 }, { id: 'falconer', star: 2 },
        { id: 'bowman', star: 2 }, { id: 'abyss', star: 2, items: ['spellbook'] },
        { id: 'wolfrider', star: 2, items: ['swiftboots'] }
      ],
      clearGold: 19, drop: 'infinity'
    },
    {
      name: '兽群之王', title: '第十六关 · 七人围猎', emoji: '🐗', color: '#6fae5e',
      arch: '巨兽 3 档', hint: '七个人，全队生命 +45%。想赢就得先扛住第一轮。',
      threat: 5,
      comp: [
        { id: 'titan', star: 2, items: ['dragonscale', 'belt'] },
        { id: 'butcher', star: 2, items: ['giantblade', 'belt'] },
        { id: 'brute', star: 3 }, { id: 'wolfrider', star: 2 },
        { id: 'vine', star: 2, items: ['holygrail'] }, { id: 'earthwarden', star: 2, items: ['holygrail'] },
        { id: 'medic', star: 2 }
      ],
      clearGold: 20, drop: 'bloodthirst'
    },
    {
      name: '苍穹射手', title: '第十七关 · 贯穿之矢', emoji: '🏹', color: '#5fb3a1',
      arch: '游侠 4 / 秘术', hint: '四费神射手的贯穿箭打一整条线，站成直线就是白送。',
      threat: 5,
      comp: [
        { id: 'deadeye', star: 3, items: ['giantblade', 'huntereye', 'infinity'] },
        { id: 'windcaller', star: 2, items: ['spellbook'] },
        { id: 'crossbow', star: 3, items: ['swiftboots'] },
        { id: 'falconer', star: 2 }, { id: 'bowman', star: 3, items: ['huntereye'] },
        { id: 'spearman', star: 2, items: ['dragonscale'] }, { id: 'medic', star: 2, items: ['holygrail'] },
        { id: 'stoneguard', star: 2, items: ['dragonscale'] }
      ],
      clearGold: 21, drop: 'huntereye'
    },
    {
      name: '深渊回响', title: '第十八关 · 范围轰炸', emoji: '🕳️', color: '#6b5fa8',
      arch: '秘术 4 / 医者', hint: '三个范围技能叠在一起，站位稍微密一点就团灭。',
      threat: 5,
      comp: [
        { id: 'abyss', star: 3, items: ['spellbook', 'sapphire'] },
        { id: 'windcaller', star: 2, items: ['spellbook'] },
        { id: 'frostmage', star: 2, items: ['sapphire'] },
        { id: 'alchemist', star: 2 }, { id: 'acolyte', star: 3 },
        { id: 'medic', star: 2, items: ['holygrail'] },
        { id: 'earthwarden', star: 2, items: ['dragonscale'] },
        { id: 'ironwall', star: 2, items: ['dragonscale', 'voidcloak'] }
      ],
      clearGold: 22, drop: 'voidcloak'
    },
    {
      name: '钢铁洪流', title: '第十九关 · 山岳坐镇', emoji: '⛰️', color: '#7a8794',
      arch: '铁卫 4 / 巨兽 3', hint: '五费山岳带满护甲魔抗，后面还跟着两个奶。',
      threat: 5,
      comp: [
        { id: 'titan', star: 2, items: ['dragonscale', 'voidcloak', 'belt'] },
        { id: 'stoneguard', star: 3, items: ['belt'] }, { id: 'ironwall', star: 2 },
        { id: 'templar', star: 2 }, { id: 'spearman', star: 3 },
        { id: 'medic', star: 2, items: ['holygrail'] },
        { id: 'earthwarden', star: 2, items: ['belt'] },
        { id: 'crossbow', star: 2, items: ['huntereye'] }
      ],
      clearGold: 23, drop: 'dragonscale'
    },
    {
      name: '血月军团', title: '第二十关 · 八人满编', emoji: '🌑', color: '#c0392b',
      arch: '狂战 4 / 影袭 4', hint: '八个成型棋子，攻速和暴击双满档。这是后半程的分水岭。',
      threat: 5,
      comp: [
        { id: 'blademaster', star: 2, items: ['swiftboots', 'giantblade', 'huntereye'] },
        { id: 'butcher', star: 3, items: ['belt'] },
        { id: 'dagger', star: 3 }, { id: 'twinblade', star: 3, items: ['huntereye'] },
        { id: 'wolfrider', star: 2 }, { id: 'brute', star: 2 },
        { id: 'falconer', star: 2 }, { id: 'pyromancer', star: 2 }
      ],
      clearGold: 24, drop: 'swiftboots'
    },
    {
      name: '山岳近卫', title: '第二十一关 · 不动如山', emoji: '🗿', color: '#6e7b88',
      arch: '铁卫 4 / 医者 3', hint: '山岳配三个奶。伤害不够的阵容会在这里被活活耗死。',
      threat: 5,
      comp: [
        { id: 'titan', star: 2, items: ['dragonscale', 'voidcloak', 'belt'] },
        { id: 'earthwarden', star: 3, items: ['holygrail'] },
        { id: 'stoneguard', star: 3, items: ['belt'] }, { id: 'ironwall', star: 3 },
        { id: 'templar', star: 2 }, { id: 'medic', star: 3, items: ['sapphire'] },
        { id: 'spearman', star: 3 }, { id: 'acolyte', star: 2 }
      ],
      clearGold: 25, drop: 'holygrail'
    },
    {
      name: '万剑之影', title: '第二十二关 · 雪峰降临', emoji: '⚔️', color: '#b06fa8',
      arch: '狂战 5 / 影袭 5', hint: '五费张雪峰带队，万剑归宗是范围技能。他一个人能清掉你半队。',
      threat: 5,
      comp: [
        { id: 'blademaster', star: 3, items: ['giantblade', 'huntereye', 'infinity'] },
        { id: 'abyss', star: 3, items: ['spellbook', 'sapphire'] },
        { id: 'dagger', star: 3, items: ['swiftboots'] },
        { id: 'twinblade', star: 3 }, { id: 'falconer', star: 3 },
        { id: 'butcher', star: 3, items: ['belt', 'giantblade'] }, { id: 'brute', star: 3 },
        { id: 'bowman', star: 3, items: ['huntereye'] }
      ],
      clearGold: 26, drop: 'infinity'
    },
    {
      name: '无冕之王', title: '第二十三关 · 双五费', emoji: '👑', color: '#d8b45f',
      arch: '全体系混编', hint: '山岳和张雪峰同时在对面。这是无尽模式之前的最后一道筛子。',
      threat: 5,
      comp: [
        { id: 'titan', star: 2, items: ['dragonscale', 'voidcloak'] },
        { id: 'blademaster', star: 2, items: ['giantblade', 'huntereye'] },
        { id: 'deadeye', star: 2, items: ['swiftboots'] },
        { id: 'abyss', star: 2, items: ['spellbook'] },
        { id: 'butcher', star: 2, items: ['belt'] },
        { id: 'earthwarden', star: 2, items: ['holygrail'] },
        { id: 'medic', star: 2 }, { id: 'falconer', star: 2 }
      ],
      clearGold: 28, drop: 'thornmail'
    },
    {
      name: '巴巴博弈', title: '第二十四关 · 最终试炼', emoji: '🎲', color: '#e06a6a',
      arch: 'BOSS · 满编精英', hint: '八人满编、八费神装、三个五费核心。打穿这一关，无尽模式就开了。',
      threat: 5,
      comp: [
        { id: 'titan', star: 2, items: ['dragonscale', 'voidcloak', 'belt'] },
        { id: 'blademaster', star: 2, items: ['giantblade', 'huntereye', 'infinity'] },
        { id: 'abyss', star: 2, items: ['spellbook', 'sapphire'] },
        { id: 'deadeye', star: 2, items: ['swiftboots'] },
        { id: 'butcher', star: 2, items: ['bloodthirst'] },
        { id: 'earthwarden', star: 2, items: ['holygrail'] },
        { id: 'medic', star: 2, items: ['belt'] }, { id: 'windcaller', star: 2 }
      ],
      clearGold: 40, drop: 'infinity'
    }
  ];

  /**
   * 参考玩家阵容：一个有在认真玩的玩家，打到这一关时大概能凑出什么。
   *
   * 刻意做成**一条连贯的成型路线**（便宜的狂战影袭开局，一路补强），
   * 而不是「每一关随便挑几个强卡」—— 后者跑出来的难度曲线没有参考价值，
   * 因为真实玩家不会那么配队。
   *
   * 用来卡难度曲线，而不是用来证明游戏简单。
   */
  var REFERENCE = [
    // L1：刚开局，两个 1 费，凑出狂战 2 档
    [{ id: 'dagger', star: 1 }, { id: 'wolfrider', star: 1 }],

    // L2：第三个棋子，狂战 + 影袭双 2 档
    [{ id: 'dagger', star: 1 }, { id: 'wolfrider', star: 1 }, { id: 'bowman', star: 1 }],

    // L3：第一个 2 星 + 第一件装备
    [{ id: 'dagger', star: 2, items: ['giantblade'] },
     { id: 'wolfrider', star: 1 }, { id: 'bowman', star: 1 }],

    // L4：铺到 4 人口，狂战影袭各 3 档
    [{ id: 'dagger', star: 2, items: ['giantblade'] }, { id: 'wolfrider', star: 2 },
     { id: 'bowman', star: 1 }, { id: 'twinblade', star: 1 }],

    // L5：主力第二个 2 星，两件装备
    [{ id: 'dagger', star: 2, items: ['giantblade'] },
     { id: 'wolfrider', star: 2, items: ['swiftboots'] },
     { id: 'bowman', star: 2 }, { id: 'twinblade', star: 1 }],

    // L6：第五个人，狂战凑到 4 档（全队 +60% 攻速）
    [{ id: 'dagger', star: 2, items: ['giantblade'] },
     { id: 'wolfrider', star: 2, items: ['swiftboots'] },
     { id: 'bowman', star: 2 }, { id: 'twinblade', star: 1 }, { id: 'brute', star: 1 }],

    // L7：三件装备，影袭也凑到 4 档（全队 +55% 暴击）
    [{ id: 'dagger', star: 2, items: ['giantblade', 'huntereye'] },
     { id: 'wolfrider', star: 2, items: ['swiftboots'] },
     { id: 'bowman', star: 2 }, { id: 'twinblade', star: 2 }, { id: 'brute', star: 1 }],

    // L8：6 人口满编，上三费核心
    [{ id: 'blademaster', star: 1, items: ['giantblade', 'huntereye'] },
     { id: 'dagger', star: 2 }, { id: 'wolfrider', star: 2, items: ['swiftboots'] },
     { id: 'bowman', star: 2 }, { id: 'twinblade', star: 2 }, { id: 'brute', star: 1 }],

    // L9：核心升 2 星，四件装备
    [{ id: 'blademaster', star: 2, items: ['giantblade', 'huntereye'] },
     { id: 'dagger', star: 2, items: ['swiftboots'] },
     { id: 'wolfrider', star: 2 }, { id: 'bowman', star: 2 },
     { id: 'twinblade', star: 2 }, { id: 'brute', star: 1 }],

    // L10：全力一搏，核心三件神装
    [{ id: 'blademaster', star: 2, items: ['giantblade', 'huntereye', 'infinity'] },
     { id: 'dagger', star: 2, items: ['swiftboots', 'bloodthirst'] },
     { id: 'wolfrider', star: 2 }, { id: 'bowman', star: 2 },
     { id: 'twinblade', star: 2 }, { id: 'brute', star: 1 }],

    /* ------------------------------------------------------------
     * L11 ~ L24：同一套「狂战影袭」核心一路补强到八人满编。
     *
     * ★ 为什么坚持用**同一条**成长线，而不是每关换一套：
     *   参考阵容代表「一个有在认真玩的玩家」，他打到第 20 关时手里
     *   就是从第 1 关那套牌一路滚出来的。每关随便挑几个强卡，
     *   跑出来的难度曲线没有参考价值 —— 真实玩家不会那么配队。
     *
     *   人数按等级上限走：6 人（L10）→ 7 人（L11）→ 8 人（L14）。
     *   星级和装备则一路往上堆，第 24 关是「能练到的极限」。
     *
     *   强度是单调的（levelcurve 有断言守着）：
     *   星级 + 装备件数 × 0.6 必须逐关不减。
     * ------------------------------------------------------------ */
    // L11：七人口，补上游侠系的猎鹰手
    [{ id: 'blademaster', star: 2, items: ['giantblade', 'huntereye', 'infinity'] },
     { id: 'dagger', star: 2, items: ['swiftboots', 'bloodthirst'] },
     { id: 'wolfrider', star: 2 }, { id: 'bowman', star: 2 }, { id: 'twinblade', star: 2 },
     { id: 'brute', star: 1 }, { id: 'falconer', star: 1, items: ['huntereye'] }],

    // L12：双刃舞者带上装备
    [{ id: 'blademaster', star: 2, items: ['giantblade', 'huntereye', 'infinity'] },
     { id: 'dagger', star: 2, items: ['swiftboots', 'bloodthirst'] },
     { id: 'wolfrider', star: 2 }, { id: 'bowman', star: 2 },
     { id: 'twinblade', star: 2, items: ['giantblade'] },
     { id: 'brute', star: 1 }, { id: 'falconer', star: 1, items: ['huntereye'] }],

    // L13：第一个 3 星（愤怒的普通人，1 费最容易成）
    [{ id: 'blademaster', star: 2, items: ['giantblade', 'huntereye', 'infinity'] },
     { id: 'dagger', star: 3, items: ['swiftboots', 'bloodthirst'] },
     { id: 'wolfrider', star: 2 }, { id: 'bowman', star: 2 },
     { id: 'twinblade', star: 2, items: ['giantblade'] },
     { id: 'brute', star: 1 }, { id: 'falconer', star: 1, items: ['huntereye'] }],

    // L14：八人口满编，上五费山岳当前排
    [{ id: 'blademaster', star: 2, items: ['giantblade', 'huntereye', 'infinity'] },
     { id: 'dagger', star: 3, items: ['swiftboots', 'bloodthirst'] },
     { id: 'titan', star: 1, items: ['dragonscale', 'voidcloak'] },
     { id: 'wolfrider', star: 2 }, { id: 'bowman', star: 2 },
     { id: 'twinblade', star: 2, items: ['giantblade'] },
     { id: 'brute', star: 1 }, { id: 'falconer', star: 1, items: ['huntereye'] }],

    // L15：狼王 3 星
    [{ id: 'blademaster', star: 2, items: ['giantblade', 'huntereye', 'infinity'] },
     { id: 'dagger', star: 3, items: ['swiftboots', 'bloodthirst'] },
     { id: 'titan', star: 1, items: ['dragonscale', 'voidcloak'] },
     { id: 'wolfrider', star: 3 }, { id: 'bowman', star: 2 },
     { id: 'twinblade', star: 2, items: ['giantblade'] },
     { id: 'brute', star: 1 }, { id: 'falconer', star: 1, items: ['huntereye'] }],

    // L16：荣誉 3 星
    [{ id: 'blademaster', star: 2, items: ['giantblade', 'huntereye', 'infinity'] },
     { id: 'dagger', star: 3, items: ['swiftboots', 'bloodthirst'] },
     { id: 'titan', star: 1, items: ['dragonscale', 'voidcloak'] },
     { id: 'wolfrider', star: 3 }, { id: 'bowman', star: 3 },
     { id: 'twinblade', star: 2, items: ['giantblade'] },
     { id: 'brute', star: 1 }, { id: 'falconer', star: 1, items: ['huntereye'] }],

    // L17：双刃舞者 3 星
    [{ id: 'blademaster', star: 2, items: ['giantblade', 'huntereye', 'infinity'] },
     { id: 'dagger', star: 3, items: ['swiftboots', 'bloodthirst'] },
     { id: 'titan', star: 1, items: ['dragonscale', 'voidcloak'] },
     { id: 'wolfrider', star: 3 }, { id: 'bowman', star: 3 },
     { id: 'twinblade', star: 3, items: ['giantblade'] },
     { id: 'brute', star: 1 }, { id: 'falconer', star: 1, items: ['huntereye'] }],

    // L18：猎鹰手 2 星
    [{ id: 'blademaster', star: 2, items: ['giantblade', 'huntereye', 'infinity'] },
     { id: 'dagger', star: 3, items: ['swiftboots', 'bloodthirst'] },
     { id: 'titan', star: 1, items: ['dragonscale', 'voidcloak'] },
     { id: 'wolfrider', star: 3 }, { id: 'bowman', star: 3 },
     { id: 'twinblade', star: 3, items: ['giantblade'] },
     { id: 'brute', star: 1 }, { id: 'falconer', star: 2, items: ['huntereye'] }],

    // L19：牢大 2 星
    [{ id: 'blademaster', star: 2, items: ['giantblade', 'huntereye', 'infinity'] },
     { id: 'dagger', star: 3, items: ['swiftboots', 'bloodthirst'] },
     { id: 'titan', star: 1, items: ['dragonscale', 'voidcloak'] },
     { id: 'wolfrider', star: 3 }, { id: 'bowman', star: 3 },
     { id: 'twinblade', star: 3, items: ['giantblade'] },
     { id: 'brute', star: 2 }, { id: 'falconer', star: 2, items: ['huntereye'] }],

    // L20：山岳 2 星
    [{ id: 'blademaster', star: 2, items: ['giantblade', 'huntereye', 'infinity'] },
     { id: 'dagger', star: 3, items: ['swiftboots', 'bloodthirst'] },
     { id: 'titan', star: 2, items: ['dragonscale', 'voidcloak'] },
     { id: 'wolfrider', star: 3 }, { id: 'bowman', star: 3 },
     { id: 'twinblade', star: 3, items: ['giantblade'] },
     { id: 'brute', star: 2 }, { id: 'falconer', star: 2, items: ['huntereye'] }],

    // L21：猎鹰手 3 星，八人全部 3 星（除了两个前排）
    [{ id: 'blademaster', star: 2, items: ['giantblade', 'huntereye', 'infinity'] },
     { id: 'dagger', star: 3, items: ['swiftboots', 'bloodthirst'] },
     { id: 'titan', star: 2, items: ['dragonscale', 'voidcloak'] },
     { id: 'wolfrider', star: 3 }, { id: 'bowman', star: 3 },
     { id: 'twinblade', star: 3, items: ['giantblade'] },
     { id: 'brute', star: 2 }, { id: 'falconer', star: 3, items: ['huntereye'] }],

    // ★ L22 才等到第一个 3 星五费。
    //   前面几关特意不给 —— 3 星五费要 8 张同名五费，
    //   真实玩家在第 15 关根本凑不出来。参考阵容一旦不真实，
    //   整条难度曲线就失去意义（中段会被量成「太水」）。
    [{ id: 'blademaster', star: 3, items: ['giantblade', 'huntereye', 'infinity'] },
     { id: 'dagger', star: 3, items: ['swiftboots', 'bloodthirst'] },
     { id: 'titan', star: 2, items: ['dragonscale', 'voidcloak'] },
     { id: 'wolfrider', star: 3 }, { id: 'bowman', star: 3 },
     { id: 'twinblade', star: 3, items: ['giantblade'] },
     { id: 'brute', star: 2 }, { id: 'falconer', star: 3, items: ['huntereye'] }],

    // L23：牢大 3 星，山岳补第三件
    [{ id: 'blademaster', star: 3, items: ['giantblade', 'huntereye', 'infinity'] },
     { id: 'dagger', star: 3, items: ['swiftboots', 'bloodthirst'] },
     { id: 'titan', star: 2, items: ['dragonscale', 'voidcloak', 'belt'] },
     { id: 'wolfrider', star: 3 }, { id: 'bowman', star: 3 },
     { id: 'twinblade', star: 3, items: ['giantblade'] },
     { id: 'brute', star: 3, items: ['belt'] }, { id: 'falconer', star: 3, items: ['huntereye'] }],

    // L24：极限 —— 八人里七个 3 星、十三件装备
    [{ id: 'blademaster', star: 3, items: ['giantblade', 'huntereye', 'infinity'] },
     { id: 'dagger', star: 3, items: ['swiftboots', 'bloodthirst'] },
     { id: 'titan', star: 2, items: ['dragonscale', 'voidcloak', 'belt'] },
     { id: 'wolfrider', star: 3, items: ['swiftboots'] },
     { id: 'bowman', star: 3, items: ['huntereye'] },
     { id: 'twinblade', star: 3, items: ['giantblade'] },
     { id: 'brute', star: 3, items: ['belt'] },
     { id: 'falconer', star: 3, items: ['huntereye'] }]
  ];

  ST.LEVELS = LEVELS;
  ST.LEVEL_REFERENCE = REFERENCE;

  /**
   * 人口等级表：等级 → 能上几个、升下一级要多少经验、抽卡概率
   *
   * 概率数组的长度必须等于 ST.COST_TIERS（现在是 5），每一行加起来要是 1。
   * 4 费从 5 级开始有 11%，5 费只有 6 级才有 6% —— 这就是「稀有」的含义：
   * 不是抽不到，而是你得先花钱升到 6 级、还得刷好几轮才见得到一张。
   * （simtest.html 里有断言守着「每行和为 1、长度对得上」，
   *   改这张表不用怕手滑写错。）
   *
   * ★ 7 / 8 级是配 24 关加的：后半程敌人满编 8 人，
   *   玩家如果还卡在 6 人口，就只能靠星级硬顶，那体验是残缺的。
   *   代价是 7→8 级要 26 点经验（≈7 次买经验 / 26 金），
   *   相当于逼玩家在「升人口」和「刷牌升星」之间真的做一次取舍。
   *   field 的最大值必须 <= ST.MAX_DEPLOY（simtest 有断言守着）。
   */
  ST.LEVEL_TABLE = [
    null,
    { field: 1, xpToNext: 2, odds: [1.00, 0.00, 0.00, 0.00, 0.00] },
    { field: 2, xpToNext: 2, odds: [1.00, 0.00, 0.00, 0.00, 0.00] },
    { field: 3, xpToNext: 6, odds: [0.75, 0.25, 0.00, 0.00, 0.00] },
    { field: 4, xpToNext: 10, odds: [0.55, 0.33, 0.12, 0.00, 0.00] },
    { field: 5, xpToNext: 18, odds: [0.32, 0.32, 0.25, 0.11, 0.00] },
    /* ★ 2026-10：5 费概率整体下调约 25%，让出来的份额全给 4 费。
       原来是 6/7/8 级 = 6% / 12% / 20%，现在 4% / 9% / 15%。
       理由：5 费棋子现在有山岳和张雪峰两个"一张就能定胜负"的角色，
       再维持 20% 的话，满级刷牌会退化成"谁先刷到五费谁赢"，
       把其它所有决策都盖过去。
       下调的份额**转给 4 费**（而不是补回低费档）——
       4 费是当前内容最厚、也最需要凑 3 星的一档，转给它比稀释到 1~3 费更有意义。
       每行相加必须仍然是 1（simtest 有断言守着）。 */
    { field: 6, xpToNext: 22, odds: [0.18, 0.26, 0.32, 0.20, 0.04] },
    { field: 7, xpToNext: 26, odds: [0.12, 0.20, 0.30, 0.29, 0.09] },
    { field: 8, xpToNext: null, odds: [0.06, 0.14, 0.26, 0.39, 0.15] }
  ];

  /**
   * 无尽模式：第 wave 波的随机对手。
   *
   * 设计目标只有一个词：**飙升**。
   * 所以难度不靠「手写 24 关之后再来 100 关」，而是三个旋钮一起往上走：
   *
   *   ① 规模    3 → 8 人（封顶在 ST.MAX_DEPLOY）
   *   ② 星级    2 星的起始概率从 0.62 一路升到 0.98，3 星从 0.18 升到 0.55
   *   ③ 面板    statScale 每波 +7%，**复利**。这是唯一能突破「全员 3 星」
   *             这个天花板的东西 —— 到了第 40 波敌人可能全是 3 星，
   *             但仍然每波再强 7%，玩家迟早会被推平，无尽自然有尽头。
   *
   *   ①② 只在前 12 波起作用，之后全靠 ③ 拉开差距。
   *   一个纯粹的「+7% 面板」比起重写阵容表更可控：
   *   它连续、单调、可预测，而且不需要为每一波写名字和台词。
   */
  var ENDLESS = {
    FIRST_WAVE: 1,
    BASE_SCALE: 1.15,         // 第 1 波就比第 24 关硬一截
    SCALE_PER_WAVE: 0.07,     // 之后每波再复利 +7%
    SCALE_CAP: 40,            // 面板倍率封顶，避免数值溢出成无穷大
    name: '无尽兽潮'
  };

  /**
   * 生成第 wave 波的对手（返回结构和 LEVELS 的每一项一致）。
   *
   * ★ 起点必须接得住第 24 关。
   *   第一版从「3 人 / 最高 2 费 / 无加成」起步，结果刚打完最难的 BOSS，
   *   第 1 波反而变轻松了 —— 一个模式的开头比它前面那一关还弱，
   *   玩家只会觉得这是「通关奖励」，不是「难度飙升」。
   *   现在第 1 波就是 7 人、直接抽 4/5 费、面板 ×1.15，之后一路往上。
   *
   * 用 ST.makeRng(wave * 常数) 而不是 Math.random：
   * 同一波必须每次生成同一份阵容 —— 玩家重试同一波时，
   * 面对的不该是另一个随机的对手，否则「重试」就成了抽奖。
   */
  ST.endlessWave = function (wave) {
    var rng = ST.makeRng(0x9e37 + wave * 7919);
    var w = Math.max(1, wave | 0);

    // ① 规模：7 人起步，每 3 波 +1，封顶 MAX_DEPLOY
    var size = Math.min(ST.MAX_DEPLOY, 6 + Math.ceil(w / 3));

    // ② 星级偏置：起步就有一半以上是 2 星，第 10 波之后几乎全员 2 星、过半 3 星
    var p3 = Math.min(0.60, 0.34 + w * 0.028);
    var p2 = Math.min(0.98, 0.80 + w * 0.018);

    var comp = ST.Battle.randomComp('a', rng, {
      size: size, maxCost: 5, star3: p3, star2: p2,
      itemChance: Math.min(0.95, 0.55 + w * 0.02)
    });

    // ③ 面板复利 —— 唯一能突破「全员 3 星」这个天花板的东西
    var scale = Math.min(ENDLESS.SCALE_CAP,
      ENDLESS.BASE_SCALE * Math.pow(1 + ENDLESS.SCALE_PER_WAVE, w - 1));

    var stars = comp.reduce(function (a, x) { return a + (x.star || 1); }, 0);
    return {
      endless: true,
      wave: w,
      name: ENDLESS.name + ' · 第 ' + w + ' 波',
      title: '无尽 · 第 ' + w + ' 波',
      emoji: ['🐺', '🦂', '🐉', '👹', '💀', '🔥', '🌪️', '🕷️'][w % 8],
      color: '#c0392b',
      arch: '随机兽潮 · ' + size + ' 人 / ' + stars + '★ / 面板 ×' + scale.toFixed(2),
      hint: '阵容完全随机，而且每波面板再复利 +7% —— 到这里就没有「背板」可言了。',
      threat: 5,
      comp: comp,
      statScale: scale,
      clearGold: 10 + Math.floor(w * 1.8),
      drop: w % 2 === 0 ? ST.ITEMS[w % ST.ITEMS.length].id : null
    };
  };

  ST.ENDLESS = ENDLESS;

  ST.GAME_RULES = {
    MAX_HP: 100,
    START_HP: 100,
    START_GOLD: 10,
    START_LEVEL: 2,
    BENCH_SIZE: 9,
    SHOP_SIZE: 5,
    REROLL_COST: 2,
    XP_COST: 4,          // 花多少金
    XP_PER_BUY: 4,       // 换多少经验
    BASE_INCOME: 5,      // 每回合基础收入
    INTEREST_PER: 10,    // 每 10 金 1 金利息
    INTEREST_MAX: 5,
    WIN_BONUS: 1,        // 赢了多给 1 金
    STREAK_MAX: 3,       // 连胜/连败最多额外 3 金
    COMBINE_COUNT: 3,    // 几个同名同星合成一个高一星
    SELL_REFUND: { 1: 1, 2: 2, 3: 3 }   // 出售价（按费用）
  };
})();
