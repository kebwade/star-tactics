/* ============================================================
 * 科币战争 — 羁绊数据表
 *
 * 改平衡只需要动这个文件。每条羁绊：
 *   id     唯一英文 id
 *   name   中文名（界面显示）
 *   emoji  图标
 *   desc   一句话说明
 *   tiers  档位数组，按 need 升序。need = 场上带此羁绊的棋子数
 *   tiers[].mods  达到该档位时给「全队」的加成
 *
 * mods 里可用的键（全部会按「先加百分比、再加固定值」结算）：
 *   hp        固定生命        hpPct     生命百分比
 *   adPct     攻击力百分比     asPct     攻速百分比
 *   apPct     法术强度百分比   armor     护甲
 *   mr        魔抗            critChance 暴击率
 *   critMult  暴击伤害         startShield 开局护盾
 *   regenPct  每秒回复最大生命的比例
 *   manaStart 开局法力        lifesteal 攻击吸血比例（造成伤害的百分比）
 *   thornPct  反弹承受物理伤害的比例
 *   shieldPct 治疗与护盾效果加成
 * ============================================================ */
(function () {
  'use strict';

  var ST = (window.ST = window.ST || {});

  ST.TRAITS = [
    {
      id: 'ironguard', name: '铁卫', emoji: '🛡️',
      desc: '全队获得额外护甲，硬吃物理伤害。',
      tiers: [
        // 加成从 +30/+75 提到 +40/+100：
        // 换上 4/5 费棋子之后，高费单位本身护甲就高（山岳 70、孙笑川 58），
        // 固定值加成的相对收益被摊薄，铁卫的等效优势从 +17% 掉到了 +6%。
        { need: 2, mods: { armor: 40 } },
        { need: 4, mods: { armor: 100 } }
      ]
    },
    {
      id: 'berserker', name: '狂战', emoji: '🔥',
      desc: '全队攻速大幅提升，靠出手次数碾压。',
      tiers: [
        { need: 2, mods: { asPct: 0.25 } },
        { need: 4, mods: { asPct: 0.60 } }
      ]
    },
    {
      id: 'arcane', name: '秘术', emoji: '🔮',
      desc: '全队法术强度提升，技能伤害与治疗量都更高。',
      tiers: [
        { need: 2, mods: { apPct: 0.30 } },
        { need: 4, mods: { apPct: 0.75 } }
      ]
    },
    {
      id: 'ranger', name: '游侠', emoji: '🏹',
      desc: '全队攻击力提升，远程单位收益最明显。',
      tiers: [
        { need: 2, mods: { adPct: 0.25 } },
        { need: 4, mods: { adPct: 0.60 } }
      ]
    },
    {
      id: 'warden', name: '守护', emoji: '🪨',
      desc: '开局全队获得一层护盾，用来扛住第一波爆发。',
      tiers: [
        { need: 2, mods: { startShield: 180 } },
        { need: 3, mods: { startShield: 420 } }
      ]
    },
    {
      id: 'healer', name: '医者', emoji: '✨',
      desc: '全队持续回血，战斗拖得越久越强。',
      tiers: [
        { need: 2, mods: { regenPct: 0.012 } },
        { need: 3, mods: { regenPct: 0.030 } }
      ]
    },
    {
      id: 'assassin', name: '影袭', emoji: '🗡️',
      desc: '全队暴击率提升，输出波动大但上限高。',
      tiers: [
        { need: 2, mods: { critChance: 0.25 } },
        { need: 4, mods: { critChance: 0.55 } }
      ]
    },
    {
      id: 'colossus', name: '巨兽', emoji: '🐘',
      desc: '全队最大生命提升，是最直白的肉度来源。',
      tiers: [
        { need: 2, mods: { hpPct: 0.20 } },
        { need: 3, mods: { hpPct: 0.45 } }
      ]
    }
  ];

  /* ---------- 查表索引 ---------- */

  ST.TRAIT_BY_ID = {};
  for (var i = 0; i < ST.TRAITS.length; i++) {
    ST.TRAIT_BY_ID[ST.TRAITS[i].id] = ST.TRAITS[i];
  }

  /**
   * 给定一组棋子定义，算出激活了哪些羁绊、档位和总加成。
   * @param {Array} unitDefs 棋子定义数组（可含重复；重复按数量计入羁绊）
   * @returns {{mods:Object, active:Array}}
   */
  ST.resolveTraits = function (unitDefs) {
    var counts = {};
    var i, j;
    for (i = 0; i < unitDefs.length; i++) {
      var def = unitDefs[i];
      if (!def || !def.traits) continue;
      for (j = 0; j < def.traits.length; j++) {
        var tid = def.traits[j];
        counts[tid] = (counts[tid] || 0) + 1;
      }
    }

    var mods = {};
    var active = [];
    for (i = 0; i < ST.TRAITS.length; i++) {
      var trait = ST.TRAITS[i];
      var n = counts[trait.id] || 0;
      if (n <= 0) continue;
      var tierIndex = -1;
      for (j = 0; j < trait.tiers.length; j++) {
        if (n >= trait.tiers[j].need) tierIndex = j;
      }
      if (tierIndex < 0) {
        active.push({
          trait: trait, count: n, tier: -1, need: trait.tiers[0].need,
          mods: null
        });
        continue;
      }
      var tier = trait.tiers[tierIndex];
      ST.U.addMods(mods, tier.mods, 1);
      active.push({
        trait: trait, count: n, tier: tierIndex, need: tier.need,
        nextNeed: trait.tiers[tierIndex + 1] ? trait.tiers[tierIndex + 1].need : null,
        mods: ST.U.clone(tier.mods)
      });
    }
    // 已激活的排在前面，同档位内按名称稳定排序（确定性）
    active.sort(function (a, b) {
      if (a.tier !== b.tier) return b.tier - a.tier;
      if (a.count !== b.count) return b.count - a.count;
      return a.trait.id < b.trait.id ? -1 : (a.trait.id > b.trait.id ? 1 : 0);
    });

    return { mods: mods, active: active, counts: counts };
  };
})();
