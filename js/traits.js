/* ============================================================
 * 科币战争 — 羁绊数据表（2026-10 全面重做：**按角色/梗来配**）
 *
 * ★★ 为什么推翻原来那 8 条（铁卫/狂战/秘术/游侠/守护/医者/影袭/巨兽）：
 *   它们是"按功能分类"的通用羁绊（肉/输出/法师/远程……），任何一套自走棋都能套，
 *   和这个游戏的立身之本——**角色本身**——没有任何关系。
 *   玩家长时间记不住"谁是谁的队友"，只能靠颜色和位置硬记。
 *
 * ★ 现在每条羁绊都是**角色之间的关系**（谁和谁会凑一块），名字直接来自
 *   这些角色的梗。玩家只要认得人，就记得住羁绊：
 *     「蓝色大肥鱼 + 豆包 = 人工智能」「荣誉 + ZMJJKK + Dank1ng = cnfps」
 *     「电棍 + Dank1ng + 陈兴裕 = 你觉得你是职业选手吗」
 *
 * ★ 每条羁绊：
 *   id     唯一英文 id（**不跟着中文名改**，改中文名不动 id）
 *   name   中文名（界面显示）
 *   emoji  图标
 *   desc   一句话说明：谁和谁、凑起来干什么
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
 *
 * ★ 数值仍按原来那 8 条的**量级**配（2 档 = 小加成、3~4 档 = 大加成），
 *   所以整套阵容的强度不会有数量级变化 —— 改的是"谁和谁搭"，
 *   不是"凑齐一条羁绊能变多强"。
 * ============================================================ */
(function () {
  'use strict';

  var ST = (window.ST = window.ST || {});

  ST.TRAITS = [
    /* ---------- 一号位：功能型（谁配谁都能打） ---------- */
    {
      id: 'ai', name: '人工智能', emoji: '🤖',
      desc: '豆包 + 蓝色大肥鱼（+ 刘浩文）：AI 算得快、技能更狠。',
      tiers: [
        { need: 2, mods: { apPct: 0.30 } },
        { need: 3, mods: { apPct: 0.75 } }
      ]
    },
    {
      id: 'healers', name: '医者仁心', emoji: '✨',
      desc: '老牧师 + 豆包 + 蓝色大肥鱼：全队持续回血，拖得越久越强。',
      tiers: [
        { need: 2, mods: { regenPct: 0.012 } },
        { need: 3, mods: { regenPct: 0.030 } }
      ]
    },
    {
      id: 'workers', name: '打工人', emoji: '💼',
      desc: '电棍 + 陈兴裕 + 美团袋鼠 + 东北雨姐：都在讨生活，血厚一点、扛得久一点。',
      tiers: [
        { need: 2, mods: { hpPct: 0.18, armor: 20 } },
        { need: 4, mods: { hpPct: 0.42, armor: 45 } }
      ]
    },
    {
      id: 'sweetpotato', name: '红薯粉丝', emoji: '🍠',
      desc: '东北雨姐 + 美团袋鼠：开局全队一层护盾，先扛住第一波。',
      tiers: [
        { need: 2, mods: { startShield: 240 } }
      ]
    },
    {
      id: 'clergy', name: '神人', emoji: '⛪',
      desc: '老牧师 + 楚生疑犯 + 祖国人 + 钟离：全是神人，魔抗极高。',
      tiers: [
        { need: 2, mods: { mr: 40 } },
        { need: 4, mods: { mr: 100, regenPct: 0.010 } }
      ]
    },

    /* ---------- 二号位：输出型（凑齐就打得很疼） ---------- */
    {
      id: 'drinkers', name: '唯有饮者留其名', emoji: '🍶',
      desc: '牢大 + 张雪峰 + 孙笑川 + 愤怒的普通人：古来圣贤皆寂寞。',
      tiers: [
        { need: 2, mods: { adPct: 0.30 } },
        { need: 4, mods: { adPct: 0.70 } }
      ]
    },
    {
      id: 'cnfps', name: 'cnfps', emoji: '🎯',
      desc: '荣誉 + ZMJJKK + Dank1ng：CN FPS 火力全开，暴击率拉满。',
      tiers: [
        { need: 2, mods: { critChance: 0.25 } },
        { need: 3, mods: { critChance: 0.55, critMult: 0.15 } }
      ]
    },
    {
      id: 'proplayer', name: '你觉得你是职业选手吗', emoji: '🎮',
      desc: '电棍 + Dank1ng + 陈兴裕：三个"职业选手"，攻击力大涨。',
      tiers: [
        { need: 2, mods: { adPct: 0.25 } },
        { need: 3, mods: { adPct: 0.60 } }
      ]
    },
    {
      id: 'kangshen', name: '康神开播了', emoji: '📺',
      desc: '陈兴裕 + ZMJJKK：开播就上头，全队攻速飙升。',
      tiers: [
        { need: 2, mods: { asPct: 0.35 } }
      ]
    },
    {
      id: 'overclock', name: '超频', emoji: '⚡',
      desc: '张雪峰 + ZMJJKK + 刘浩文：三个"越打越快"的家伙，出手密到看不清。',
      tiers: [
        { need: 2, mods: { asPct: 0.30 } },
        { need: 3, mods: { asPct: 0.65 } }
      ]
    },
    {
      id: 'mamba', name: '曼巴精神', emoji: '🐍',
      desc: '牢大 + 狼王 + 鹰佐：凌晨四点的训练，攻速与暴击一起给。',
      tiers: [
        { need: 2, mods: { asPct: 0.25 } },
        { need: 3, mods: { asPct: 0.55, critChance: 0.15 } }
      ]
    },
    {
      id: 'abstract', name: '抽象工作室', emoji: '🎭',
      desc: '孙笑川 + 嘉豪 + 愤怒的普通人：抽象三兄弟，输出全看脸（暴击）。',
      tiers: [
        { need: 2, mods: { critChance: 0.20 } },
        { need: 3, mods: { critChance: 0.45 } }
      ]
    },

    /* ---------- 三号位：特色型（绑定几个特定的角色） ---------- */
    {
      id: 'snowleopard', name: '雪豹', emoji: '🐆',
      desc: '丁真 + 狼王 + 奶龙 + 冰冰冰：一群高山雪原上的（生）物，血厚耐揍。',
      tiers: [
        { need: 2, mods: { hpPct: 0.20 } },
        { need: 4, mods: { hpPct: 0.45 } }
      ]
    },
    {
      id: 'seafood', name: '海鲜市场', emoji: '🦆',
      desc: '100元的鸭子 + 蓝色大肥鱼：水里的东西，开局各自一层护盾。',
      tiers: [
        { need: 2, mods: { startShield: 200 } }
      ]
    },
    {
      id: 'sandsculpture', name: '沙雕网友', emoji: '🐟',
      desc: '100元的鸭子 + 羊帆 + 奶龙：一群沙雕网友，血上限和护甲都加一点。',
      tiers: [
        { need: 2, mods: { hpPct: 0.20 } },
        { need: 3, mods: { hpPct: 0.40, armor: 30 } }
      ]
    },
    {
      id: 'icefire', name: '冰火两重天', emoji: '🧊',
      desc: '冰冰冰 + 羊帆：冰与火一起上，法术强度大涨。',
      tiers: [
        { need: 2, mods: { apPct: 0.35 } }
      ]
    },
    {
      id: 'domain', name: '领域展开', emoji: '🌑',
      desc: '嘉豪 + 楚生疑犯：两个开领域的，全队护甲提升。',
      tiers: [
        { need: 2, mods: { armor: 55 } }
      ]
    },
    {
      id: 'gloweye', name: '眼睛发光', emoji: '👁️',
      desc: '鹰佐 + 祖国人：一个天照、一个激光，眼睛一亮就要出事。',
      tiers: [
        { need: 2, mods: { apPct: 0.35 } }
      ]
    },
    {
      id: 'geoarchon', name: '二次元', emoji: '🪨',
      desc: '钟离 + 奶龙：两个二次元，开局护盾加护甲。',
      tiers: [
        { need: 2, mods: { armor: 45, startShield: 160 } }
      ]
    },
    {
      id: 'superhero', name: '超级英雄', emoji: '🦸',
      desc: '祖国人 + 刘浩文：一个是超级英雄，一个是世界第一帅，攻击力大涨。',
      tiers: [
        { need: 2, mods: { adPct: 0.30 } }
      ]
    },
    {
      id: 'sharpshooter', name: '百步穿杨', emoji: '🏹',
      desc: '荣誉 + 丁真 + Dank1ng：三个远程准头，攻击力提升。',
      tiers: [
        { need: 2, mods: { adPct: 0.25 } },
        { need: 3, mods: { adPct: 0.45, critChance: 0.15 } }
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
   *
   * ★ 2026-10：**同一个角色只算一次**（两个豆包不叠「人工智能」）。
   *   羁绊要的是「不同角色凑在一起」；重复上同一张牌不算数 ——
   *   否则凑羁绊就退化成"把最强的那张卡买三次"，跟角色设计没关系了。
   *   这条在三个地方同时生效（都走这个函数）：战斗结算、界面羁绊条、阵容详解。
   *
   * @param {Array} unitDefs 棋子定义数组（按 def.id 去重）
   * @returns {{mods:Object, active:Array}}
   */
  ST.resolveTraits = function (unitDefs) {
    var counts = {};
    var seen = {};                 // ★ 已经数过的角色 id
    var i, j;
    for (i = 0; i < unitDefs.length; i++) {
      var def = unitDefs[i];
      if (!def || !def.traits) continue;
      // 没有 id 的定义（理论上不会有）退化成按下标算，互相不会顶掉
      var uid = def.id || ("#" + i);
      if (seen[uid]) continue;
      seen[uid] = true;
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
      return a.trait.name < b.trait.name ? -1 : (a.trait.name > b.trait.name ? 1 : 0);
    });
    return { mods: mods, active: active, counts: counts };
  };
})();
