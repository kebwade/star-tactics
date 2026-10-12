/* ============================================================
 * 科币战争 — 装备数据表
 *
 * MVP 重要决定：装备是「固定成品」，不做两两合成。
 * 合成会让数值调试复杂度直接翻十倍，留到内容稳定之后再加。
 *
 * mods 的键与 traits.js 完全一致，装备和羁绊走同一条结算路径。
 * ============================================================ */
(function () {
  'use strict';

  var ST = (window.ST = window.ST || {});

  ST.ITEMS = [
    /* ★ 对位循环赛实测它是 85.5% 的「必抢」装备，越过了 balancetest 的 85% 红线。
       ★ 试过把它从 +25% 削到 +20%：只从 85.7% 掉到 85.5%，几乎没变 ——
         说明问题不在"这一件给多了"，而在**测试的设计**：
         对位赛是"主 C 身上只换这一件"，所以任何**输出属性**的装备
         天然会赢过防御属性的装备（榜单前三名 巨力之刃 / 秘法之书 / 和成天下5000精品大果
         全都是输出属性）。要真正解决得改那套对位赛的比法，不是改这一行。
         所以先把数值留着不动，等做平衡那一轮一起处理。 */
    { id: 'giantblade', name: '巨力之刃', emoji: '🗡️', mods: { adPct: 0.25 }, desc: '+25% 攻击力' },
    /* ★ 原名「疾风之靴」（纯 +22% 攻速）。
     *
     *   2026-10 改成「和成天下5000精品大果」，并把它变成
     *   **全游戏第一件"有行为"的装备** —— 之前 12 件装备全都是纯面板。
     *
     *     · 攻速 +30%（原来是 +22%）
     *     · 普攻给敌人叠「寒冰」层数（和张雪峰的「巧乐兹」同一套机制）
     *     · **每秒失去 6% 生命上限** —— 这是代价
     *
     *   ★★ 为什么行为写在 `grants` 里，不塞进 `mods`：
     *     mods 会被 `addMods` **逐键相加**、再写进 `resolveStats` 算出的面板。
     *     而"攻击挂寒冰"和"每秒自燃"根本不是面板数字 ——
     *     塞进 mods 会让 `resolveStats` 多出两个没人用的键，
     *     更糟的是它会把"界面看到的数字 = 打出来的数字"这条不变式搅浑。
     *     所以 mods 只管数值，grants 只管行为，两边互不越界。
     *
     *   ★ 每秒 6% 上限 = **固定 16.7 秒后必定死**（和血量多少无关）。
     *     这是一颗"定时炸弹"：给谁装、什么时候装，变成一个真的决策 ——
     *     和「超频自毁」的 44% **当前**生命（指数衰减、越掉越慢）是两种节奏，
     *     代码里也是两条独立规则，故意没有合并（见 battle.js 的 itemBurnTick）。
     *
     *   mods 的键仍然是 asPct —— 字段名是内部实现，不跟着显示名字改
     *   （改了要动 traits.js 的合并、balancetest 的断言，纯 churn 没有收益）。
     */
    { id: 'swiftboots', name: '和成天下5000精品大果', emoji: '🌰',
      mods: { asPct: 0.30 },
      grants: {
        chill: { perHit: 1, perStack: 0.05, max: 10, freezeDur: 3 },
        burnMaxPct: 0.06
      },
      desc: '+30% 攻速。普攻会给敌人叠「寒冰」：每层 -5% 攻速移速，' +
            '满 10 层冰冻 3 秒并清空。但带着它的人**每秒失去 6% 生命上限**' },
    { id: 'spellbook', name: '秘法之书', emoji: '📖', mods: { apPct: 0.30 }, desc: '+30% 法术强度' },
    { id: 'dragonscale', name: '龙鳞甲', emoji: '🐲', mods: { armor: 45 }, desc: '+45 护甲' },
    { id: 'voidcloak', name: '虚空斗篷', emoji: '🧿', mods: { mr: 45 }, desc: '+45 魔抗' },
    { id: 'belt', name: '巨人腰带', emoji: '🎗️', mods: { hp: 280 }, desc: '+280 生命' },
    { id: 'sapphire', name: '蓝水晶', emoji: '💎', mods: { manaStart: 35 }, desc: '开局 +35 法力' },
    { id: 'huntereye', name: '猎手之眼', emoji: '👁️', mods: { critChance: 0.30 }, desc: '+30% 暴击率' },
    { id: 'infinity', name: '无尽之刃', emoji: '⚔️', mods: { critMult: 0.50 }, desc: '+50% 暴击伤害' },
    { id: 'bloodthirst', name: '血饮剑', emoji: '🩸', mods: { lifesteal: 0.20 }, desc: '攻击回复造成伤害的 20%' },
    /* ★ 原名「荆棘之甲」，改名「讲话石」并把反弹改成**范围**效果。
     *
     *   mods 的键还叫 thornPct —— 字段名是内部实现，不跟着显示名字改
     *   （改了要动 units.js 的 resolveItems、battle.js 的 afterDamage、
     *     balancetest 的断言，纯churn 没有收益）。它现在的含义是
     *     「反弹受到伤害的百分比」。
     *
     *   图标是图片：art/items/thornmail.png（文件名跟 id 走，不跟名字走）。
     *
     *   skill.name = 技能名（界面上和棋子技能一个待遇），
     *   desc 仍然只是数值说明 —— 两句分开写，改数值时不用动技能名。
     *   特效在 arena.js：reason === 'thorn' 时走 addRiver（水流）+ addRipple（水波）。
     */
    { id: 'thornmail', name: '讲话石', emoji: '🗣️', mods: { thornPct: 0.32 },
      skill: { name: '飞入寻常百姓家' },
      desc: '受到伤害时，对 3×3 范围内所有敌人反弹该伤害的 32%' },
    { id: 'holygrail', name: '圣杯', emoji: '🏆', mods: { shieldPct: 0.30 }, desc: '+30% 治疗与护盾效果' }
  ];

  ST.ITEM_BY_ID = {};
  for (var i = 0; i < ST.ITEMS.length; i++) {
    ST.ITEM_BY_ID[ST.ITEMS[i].id] = ST.ITEMS[i];
  }

  /** 一个棋子最多带几件装备 */
  ST.MAX_ITEMS = 3;

  /** 把一组装备 id 合并成一份 mods */
  ST.resolveItems = function (itemIds) {
    var mods = {};
    if (!itemIds) return mods;
    for (var i = 0; i < itemIds.length; i++) {
      var item = ST.ITEM_BY_ID[itemIds[i]];
      if (!item) continue;
      ST.U.addMods(mods, item.mods, 1);
    }
    return mods;
  };

  /**
   * 把一组装备的**行为**（grants）合并出来 —— 和 resolveItems 分开走。
   *
   * ★ 为什么不并进 resolveItems：那一份是"面板数值"，会被 addMods 逐键相加。
   *   行为（挂寒冰、每秒自燃）不是数字，相加没有意义。
   *
   * ★ 多件装备都给同一个行为时**取强不叠加**：
   *   现在只有这一件果子给寒冰，但万一以后再加一件，
   *   "两件果子 = 每击 2 层"会让控制类效果爆炸（每 5 次普攻冻一次）。
   *   和「巧乐兹」之间也是取强 —— 一个又带巧乐兹又带果子的张雪峰
   *   不该被冻成冰雕（见 battle.js 里那段初始化）。
   */
  ST.resolveItemGrants = function (itemIds) {
    var out = { chill: null, burnMaxPct: 0 };
    if (!itemIds) return out;
    for (var i = 0; i < itemIds.length; i++) {
      var item = ST.ITEM_BY_ID[itemIds[i]];
      var g = item && item.grants;
      if (!g) continue;
      if (g.burnMaxPct > out.burnMaxPct) out.burnMaxPct = g.burnMaxPct;
      if (g.chill) {
        if (!out.chill) {
          out.chill = { perHit: g.chill.perHit, perStack: g.chill.perStack,
                        max: g.chill.max, freezeDur: g.chill.freezeDur };
        } else {
          out.chill.perHit = Math.max(out.chill.perHit, g.chill.perHit);
          out.chill.perStack = Math.max(out.chill.perStack, g.chill.perStack);
          out.chill.max = Math.max(out.chill.max, g.chill.max);
          out.chill.freezeDur = Math.max(out.chill.freezeDur, g.chill.freezeDur);
        }
      }
    }
    return out;
  };
})();
