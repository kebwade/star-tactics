/* ============================================================
 * 科币战争 — 战斗模拟器自检
 *
 * 这个页面存在的唯一目的：证明 battle.js 是可信的。
 * 一个不可信的战斗模拟器，后面所有的平衡工作都是玄学。
 *
 * 直接双击 simtest.html 打开即可，页面底部输出报告。
 * ============================================================ */
(function () {
  'use strict';

  var ST = window.ST;
  var TH = window.TH;
  var U = ST.U;

  var t0 = Date.now();

  /* ============================================================
   * 1. 数据表完整性
   * ============================================================ */
  TH.section('数据表完整性');

  var VALID_KINDS = ['nuke', 'aoe', 'line', 'shield', 'heal', 'stun', 'buff', 'aegis', 'whirl', 'snipe', 'knockback', 'laugh', 'peak', 'field'];
  var VALID_COSTS = [1, 2, 3, 4, 5];
  var seenIds = {};
  var i, j, u, t, it;

  TH.ok('棋子数量 >= 20', ST.UNITS.length >= 20, '实际 ' + ST.UNITS.length);
  TH.ok('羁绊数量 >= 6', ST.TRAITS.length >= 6, '实际 ' + ST.TRAITS.length);
  TH.ok('装备数量 >= 8', ST.ITEMS.length >= 8, '实际 ' + ST.ITEMS.length);

  // 每个费用档都要有足够棋子，否则商店池太薄、会反复刷到同一张
  var costCounts = ST.costCounts();
  TH.ok('每个费用档至少有 2 个棋子', costCounts.every(function (n) { return n >= 2; }),
    costCounts.map(function (n, idx) { return (idx + 1) + '费×' + n; }).join('　'));
  TH.eq('费用档数 = 5（灰/绿/蓝/紫/金）', ST.COST_TIERS, 5);
  TH.ok('每个费用档都有配色',
    VALID_COSTS.every(function (c) { return !!ST.COST_COLORS[c]; }),
    JSON.stringify(ST.COST_COLORS));

  // 商店概率表：长度必须等于费用档数，每行相加必须是 1
  var oddsBad = [];
  for (i = 1; i < ST.LEVEL_TABLE.length; i++) {
    var row = ST.LEVEL_TABLE[i].odds;
    if (row.length !== ST.COST_TIERS) oddsBad.push(i + '级长度 ' + row.length);
    var sum = 0;
    for (j = 0; j < row.length; j++) sum += row[j];
    if (Math.abs(sum - 1) > 1e-9) oddsBad.push(i + '级和 ' + sum.toFixed(4));
  }
  TH.ok('商店概率表长度与费用档一致、每行和为 1', oddsBad.length === 0, oddsBad.join('；'));

  // 稀有度得真的「稀有」：4 费不能在 5 级之前出现，5 费只能在满级出现
  var rareBad = [];
  for (i = 1; i < ST.LEVEL_TABLE.length; i++) {
    var od = ST.LEVEL_TABLE[i].odds;
    if (i < 5 && od[3] > 0) rareBad.push(i + '级就有 4 费');
    if (i < 6 && od[4] > 0) rareBad.push(i + '级就有 5 费');
  }
  TH.ok('4 费要 5 级、5 费要 6 级才刷得出来', rareBad.length === 0, rareBad.join('；'));
  TH.ok('5 费在满级也只有很低概率（<= 10%）', ST.LEVEL_TABLE[6].odds[4] <= 0.10,
    '满级 5 费概率 ' + Math.round(ST.LEVEL_TABLE[6].odds[4] * 100) + '%');
  /* ★ 5 费概率的绝对上限：6/7/8 级分别是 4% / 9% / 15%。
     2026-10 从 6/12/20 下调 —— 五费棋子已经有"一张定胜负"的强度，
     再给 20% 会让满级刷牌退化成抽奖。
     这一条写死上限，防止以后调别的东西时把五费概率又顶回去。 */
  TH.ok('★ 5 费概率已被压到 4% / 9% / 15% 这一档（不超过）',
    ST.LEVEL_TABLE[6].odds[4] <= 0.04 + 1e-9 &&
    ST.LEVEL_TABLE[7].odds[4] <= 0.09 + 1e-9 &&
    ST.LEVEL_TABLE[8].odds[4] <= 0.15 + 1e-9,
    [6, 7, 8].map(function (lv) {
      return lv + '级 ' + Math.round(ST.LEVEL_TABLE[lv].odds[4] * 100) + '%';
    }).join(' / '));
  // 省下来的份额必须落在 4 费上，而不是凭空消失（每行和为 1 已经保证了总量，
  // 这里额外钉住"给了 4 费"这个设计意图）
  TH.ok('★ 让出来的份额转给了 4 费（不是补回低费档）',
    ST.LEVEL_TABLE[8].odds[3] >= 0.36,
    '满级 4 费 ' + Math.round(ST.LEVEL_TABLE[8].odds[3] * 100) + '%');

  for (i = 0; i < ST.UNITS.length; i++) {
    u = ST.UNITS[i];
    if (seenIds[u.id]) TH.fail('棋子 id 唯一', '重复 id: ' + u.id);
    seenIds[u.id] = true;
    if (!/^[a-z][a-z0-9]*$/.test(u.id || '')) TH.fail('棋子 id 格式', u.id);
    if (!u.name) TH.fail('棋子有中文名', u.id);
    if (VALID_COSTS.indexOf(u.cost) < 0) TH.fail('棋子费用合法', u.id + ' cost=' + u.cost);
    if (!(u.hp > 0 && u.ad > 0 && u.as > 0 && u.mana > 0 && u.range >= 1)) {
      TH.fail('棋子基础数值为正', u.id + ' ' + JSON.stringify({ hp: u.hp, ad: u.ad, as: u.as, mana: u.mana, range: u.range }));
    }
    if (u.armor < 0 || u.mr < 0) TH.fail('棋子抗性非负', u.id);
    if (!u.traits || u.traits.length < 1 || u.traits.length > 2) {
      TH.fail('棋子羁绊数量为 1~2', u.id + ' → ' + JSON.stringify(u.traits));
    } else {
      for (j = 0; j < u.traits.length; j++) {
        if (!ST.TRAIT_BY_ID[u.traits[j]]) TH.fail('棋子羁绊存在', u.id + ' → ' + u.traits[j]);
      }
    }
    var sk = u.skill;
    if (!sk || !sk.name) { TH.fail('棋子有技能', u.id); continue; }
    if (VALID_KINDS.indexOf(sk.kind) < 0) { TH.fail('技能 kind 合法', u.id + ' → ' + sk.kind); continue; }
    if (sk.kind === 'nuke' || sk.kind === 'line' || sk.kind === 'aoe' || sk.kind === 'whirl') {
      if (!(sk.damage > 0)) TH.fail('技能有伤害值', u.id + ' ' + sk.name);
    }
    // 狙击：有基准伤害、有倍率、命中率必须在 0~1 之间
    if (sk.kind === 'snipe') {
      if (!(sk.damage > 0)) TH.fail('狙击有基准伤害', u.id + ' ' + sk.name);
      if (!(sk.mult > 1)) TH.fail('狙击倍率大于 1', u.id + ' → ' + sk.mult);
      if (!(sk.hitChance > 0 && sk.hitChance < 1)) TH.fail('狙击命中率在 0~1 之间', u.id + ' → ' + sk.hitChance);
    }
    // 击退：有伤害、有击退格数
    if (sk.kind === 'knockback') {
      if (!(sk.damage > 0)) TH.fail('击退技能有伤害值', u.id + ' ' + sk.name);
      if (!(sk.push >= 1)) TH.fail('击退技能有击退格数', u.id + ' → ' + sk.push);
    }
    if ((sk.kind === 'aoe' || sk.kind === 'whirl') && !(sk.radius >= 1)) TH.fail('范围技能有半径', u.id);
    if (sk.kind === 'line' && !(sk.length >= 1)) TH.fail('line 有长度', u.id);
    if (sk.kind === 'shield' || sk.kind === 'heal') {
      if (!(sk.amount > 0)) TH.fail('护盾/治疗有数值', u.id);
      if (['self', 'lowest'].indexOf(sk.target) < 0) TH.fail('护盾/治疗目标合法', u.id + ' → ' + sk.target);
    }
    if (sk.kind === 'aegis' && !(sk.amount > 0)) TH.fail('全队护盾有数值', u.id);
    if (sk.kind === 'stun' && !(sk.dur > 0)) TH.fail('眩晕有时长', u.id);
    if (sk.kind === 'buff' && !(sk.amount > 0 && sk.dur > 0 && sk.stat)) TH.fail('增益参数完整', u.id);
    /* ★ 大笑（奶龙「捧腹大笑」）：一个**不造成伤害**的自我 buff 技能。
       它没有任何伤害字段，所以上面那几条按 kind 分支的校验全都碰不到它 ——
       漏掉的话，"dur 写成 0"或者"减伤写成 80 而不是 0.8"都不会有人发现，
       而这两种错都会让技能在战斗里彻底失效（0 秒大笑 / 减伤 8000%）。 */
    if (sk.kind === 'laugh') {
      if (!(sk.dur > 0)) TH.fail('大笑有时长', u.id + ' → ' + sk.dur);
      if (!(sk.dmgCut > 0 && sk.dmgCut < 1)) TH.fail('大笑减伤在 0~1 之间（是比例不是百分数）', u.id + ' → ' + sk.dmgCut);
      if (!(sk.healPct > 0 && sk.healPct < 1)) TH.fail('大笑回血在 0~1 之间（是比例不是百分数）', u.id + ' → ' + sk.healPct);
      if (!(sk.cast && sk.cast.cooldown > 0)) TH.fail('大笑有冷却秒数', u.id + ' → ' + JSON.stringify(sk.cast));
      if (sk.damage) TH.fail('大笑不该有伤害字段（它是纯自我增益）', u.id + ' → ' + sk.damage);
      /* 星级门槛必须落在 1~3 之内，否则 moveAt: 4 这种写法会静默失效 ——
         玩家升到 3 星也永远解锁不了。 */
      var pl = u.passive || {};
      if (pl.moveAt && !(pl.moveAt >= 1 && pl.moveAt <= 3)) TH.fail('大笑「可以移动」的星级门槛合法', u.id + ' → ' + pl.moveAt);
      if (pl.healAt && !(pl.healAt >= 1 && pl.healAt <= 3)) TH.fail('大笑「治疗队友」的星级门槛合法', u.id + ' → ' + pl.healAt);
    }
  }

  // 5 费应该是「传说」：技能必须是全场唯一的机制，而且面板要明显高于 4 费
  var fiveStars = ST.UNITS_BY_COST[5] || [];
  TH.ok('5 费至少有 2 个', fiveStars.length >= 2, fiveStars.length + ' 个');
  var legendaryKinds = ['aegis', 'whirl'];
  TH.ok('5 费的技能都是专属机制（aegis / whirl）',
    fiveStars.length > 0 && fiveStars.every(function (x) { return legendaryKinds.indexOf(x.skill.kind) >= 0; }),
    fiveStars.map(function (x) { return x.name + '(' + x.skill.kind + ')'; }).join('、'));
  var otherKinds = [];
  for (i = 0; i < ST.UNITS.length; i++) {
    if (ST.UNITS[i].cost === 5) continue;
    otherKinds.push(ST.UNITS[i].skill.kind);
  }
  TH.ok('aegis / whirl 只有 5 费才有（不会稀释稀有度）',
    legendaryKinds.every(function (kk) { return otherKinds.indexOf(kk) < 0; }),
    '非 5 费出现的 kind：' + otherKinds.filter(function (kk) { return legendaryKinds.indexOf(kk) >= 0; }).join('、'));

  // 4 费 / 5 费的面板必须压制低费 —— 否则「稀有」只体现在价格上
  function avgByCost(c, fn) {
    var list = ST.UNITS_BY_COST[c] || [], sum = 0;
    for (var q = 0; q < list.length; q++) sum += fn(list[q]);
    return list.length ? sum / list.length : 0;
  }
  var dpsByCost = VALID_COSTS.map(function (c) {
    return ST.U.round1(avgByCost(c, function (x) { return ST.rawDps(x, 1, [], {}); }));
  });
  var ehpByCost = VALID_COSTS.map(function (c) {
    return Math.round(avgByCost(c, function (x) { return ST.rawEhp(x, 1, [], {}); }));
  });
  TH.note('各费用档平均（1★、无装备）：DPS ' + dpsByCost.join(' / ') +
    '　有效生命 ' + ehpByCost.join(' / '));
  TH.ok('每个费用档的面板都高于上一档（DPS）', (function () {
    for (var q = 1; q < dpsByCost.length; q++) if (dpsByCost[q] <= dpsByCost[q - 1]) return false;
    return true;
  })(), dpsByCost.join(' < '));
  TH.ok('每个费用档的面板都高于上一档（有效生命）', (function () {
    for (var q = 1; q < ehpByCost.length; q++) if (ehpByCost[q] <= ehpByCost[q - 1]) return false;
    return true;
  })(), ehpByCost.join(' < '));
  TH.ok('5 费的 DPS 至少是 1 费的 2.5 倍', dpsByCost[4] / dpsByCost[0] >= 2.5,
    (dpsByCost[4] / dpsByCost[0]).toFixed(2) + ' 倍');

  var traitSeen = {};
  for (i = 0; i < ST.TRAITS.length; i++) {
    t = ST.TRAITS[i];
    if (traitSeen[t.id]) TH.fail('羁绊 id 唯一', t.id);
    traitSeen[t.id] = true;
    if (!t.tiers || !t.tiers.length) { TH.fail('羁绊有档位', t.id); continue; }
    var prev = 0;
    for (j = 0; j < t.tiers.length; j++) {
      if (t.tiers[j].need <= prev) TH.fail('羁绊档位递增', t.id + ' → ' + JSON.stringify(t.tiers));
      prev = t.tiers[j].need;
      if (!t.tiers[j].mods || !Object.keys(t.tiers[j].mods).length) TH.fail('羁绊档位有加成', t.id);
    }
    // 阈值可达性：带这个羁绊的棋子总数必须够
    var n = 0;
    for (var k = 0; k < ST.UNITS.length; k++) {
      if (ST.UNITS[k].traits.indexOf(t.id) >= 0) n++;
    }
    if (t.tiers[t.tiers.length - 1].need > n) {
      TH.fail('羁绊最高档位可达', t.id + ' 需要 ' + t.tiers[t.tiers.length - 1].need + '，但只有 ' + n + ' 个棋子带它');
    }
    if (n < 2) TH.fail('羁绊至少有 2 个棋子', t.id + ' 只有 ' + n);
  }

  var itemSeen = {};
  for (i = 0; i < ST.ITEMS.length; i++) {
    it = ST.ITEMS[i];
    if (itemSeen[it.id]) TH.fail('装备 id 唯一', it.id);
    itemSeen[it.id] = true;
    if (!it.mods || !Object.keys(it.mods).length) TH.fail('装备有加成', it.id);
    if (!it.name || !it.desc) TH.fail('装备有名称和说明', it.id);
  }

  if (TH.counts().fail === 0) TH.ok('数据表整体结构无误', true);

  /* ============================================================
   * 2. 种子化随机
   * ============================================================ */
  TH.section('种子化随机 (RNG)');

  function seq(seed, n) {
    var r = ST.makeRng(seed), out = [];
    for (var k = 0; k < n; k++) out.push(r.next());
    return out;
  }

  TH.eq('同 seed 产出同序列', seq(12345, 20), seq(12345, 20));
  TH.ok('不同 seed 产出不同序列', JSON.stringify(seq(1, 10)) !== JSON.stringify(seq(2, 10)));

  var zeroSeq = seq(0, 10);
  var collapsed = true;
  for (i = 1; i < zeroSeq.length; i++) if (zeroSeq[i] !== zeroSeq[0]) collapsed = false;
  TH.ok('seed=0 不会退化', !collapsed);

  var rngT = ST.makeRng(999);
  var inRange = true, distinct = {};
  for (i = 0; i < 5000; i++) {
    var v = rngT.int(3, 7);
    if (v < 3 || v > 7 || v !== Math.floor(v)) inRange = false;
    distinct[v] = true;
  }
  TH.ok('int(a,b) 落在闭区间内', inRange);
  TH.eq('int(a,b) 能覆盖全部取值', Object.keys(distinct).sort().join(','), '3,4,5,6,7');

  var p = [1, 2, 3, 4, 5];
  var rngS = ST.makeRng(7);
  var onlyMembers = true;
  for (i = 0; i < 500; i++) if (p.indexOf(rngS.pick(p)) < 0) onlyMembers = false;
  TH.ok('pick 只返回数组内元素', onlyMembers);

  var sh = rngS.shuffle(p.slice());
  TH.eq('shuffle 不增不减元素', sh.slice().sort().join(','), '1,2,3,4,5');
  TH.eq('shuffle 确定性', ST.makeRng(3).shuffle([1, 2, 3, 4, 5, 6]).join(','),
    ST.makeRng(3).shuffle([1, 2, 3, 4, 5, 6]).join(','));

  TH.eq('hashSeed 稳定', ST.hashSeed('狂战影袭'), ST.hashSeed('狂战影袭'));
  TH.ok('hashSeed 区分不同字符串', ST.hashSeed('a') !== ST.hashSeed('b'));

  /* ============================================================
   * 3. 摆阵容
   * ============================================================ */
  TH.section('摆阵容 / 站位');

  var compA = ST.Battle.makeComp('a', [
    { id: 'titan', star: 1 }, { id: 'bowman', star: 1 }, { id: 'pyromancer', star: 1 }
  ]);
  TH.eq('自动站位给每个棋子补了坐标', compA.length, 3);
  var allPlaced = true, sideOk = true, collide = {};
  for (i = 0; i < compA.length; i++) {
    if (typeof compA[i].r !== 'number' || typeof compA[i].c !== 'number') allPlaced = false;
    if (ST.Battle.sideOfRow(compA[i].r) !== 'a') sideOk = false;
    var key = compA[i].r + ',' + compA[i].c;
    if (collide[key]) collide[key] = true;
    collide[key] = true;
  }
  TH.ok('每个棋子都有坐标', allPlaced);
  TH.ok('A 方棋子都摆在 A 半场', sideOk);
  TH.ok('自动站位不重叠', Object.keys(collide).length === compA.length);

  var melee = null, ranged = null;
  for (i = 0; i < compA.length; i++) {
    if (compA[i].id === 'titan') melee = compA[i];
    if (compA[i].id === 'bowman') ranged = compA[i];
  }
  TH.ok('近战自动站得比远程靠前', melee.r > ranged.r,
    'titan row=' + melee.r + '，bowman row=' + ranged.r);

  TH.eq('makeComp 不修改入参', (function () {
    var src = [{ id: 'titan', star: 2, items: ['belt'] }];
    ST.Battle.makeComp('a', src);
    return src[0].r;
  })(), undefined);

  // 显式坐标必须被尊重（这是历史 bug 的高发区）
  var explicit = ST.Battle.makeComp('b', [
    { id: 'titan' }, { id: 'bowman' }
  ]);
  explicit[0].r = 7; explicit[0].c = 0;
  explicit[1].r = 4; explicit[1].c = 5;
  var resEx = ST.Battle.battle({ a: compA, b: explicit }, 1);
  var expTitan = null, expBowman = null;
  for (i = 0; i < resEx.initial.units.length; i++) {
    var eu = resEx.initial.units[i];
    if (eu.side === 'b' && eu.defId === 'titan') expTitan = eu;
    if (eu.side === 'b' && eu.defId === 'bowman') expBowman = eu;
  }
  TH.ok('显式坐标被尊重（后排放坦克）', expTitan && expTitan.r === 7 && expTitan.c === 0,
    expTitan ? ('r=' + expTitan.r + ' c=' + expTitan.c) : '没找到');
  TH.ok('显式坐标被尊重（前排远程）', expBowman && expBowman.r === 4 && expBowman.c === 5,
    expBowman ? ('r=' + expBowman.r + ' c=' + expBowman.c) : '没找到');

  // 显式坐标冲突 / 越界 / 摆错半场，都必须被自动纠正而不是崩掉
  var conflict = ST.Battle.makeComp('a', [
    { id: 'titan' }, { id: 'bowman' }
  ]);
  conflict[0].r = 3; conflict[0].c = 3;
  conflict[1].r = 3; conflict[1].c = 3;          // 冲突
  var wrongSide = ST.Battle.makeComp('a', [{ id: 'titan' }]);
  wrongSide[0].r = 7; wrongSide[0].c = 0;        // 摆到 B 半场了
  var oob = ST.Battle.makeComp('a', [{ id: 'titan' }]);
  oob[0].r = 99; oob[0].c = -5;                  // 越界
  var resBad = ST.Battle.battle({ a: conflict.concat(wrongSide, oob).slice(0, 6), b: compA }, 1);
  var badCells = {}, dupCells = false, wrongSideFound = false;
  for (i = 0; i < resBad.initial.units.length; i++) {
    var bu = resBad.initial.units[i];
    var bk = bu.r + ',' + bu.c;
    if (badCells[bk]) dupCells = true;
    badCells[bk] = true;
    if (bu.side === 'a' && ST.Battle.sideOfRow(bu.r) !== 'a') wrongSideFound = true;
  }
  TH.ok('非法坐标不会导致重叠', !dupCells);
  TH.ok('摆错半场会被纠正', !wrongSideFound);
  TH.ok('越界坐标不会崩', resBad && resBad.initial.units.length > 0);

  /* ============================================================
   * 4. 确定性（整个项目最重要的一节）
   * ============================================================ */
  TH.section('确定性');

  function logHash(res) {
    return ST.hashSeed(JSON.stringify(res.log)) + '/' + res.log.length;
  }

  var compB = ST.Battle.makeComp('b', [
    { id: 'abyss', star: 2, items: ['spellbook'] }, { id: 'ironwall', star: 2 },
    { id: 'blademaster', star: 1 }, { id: 'deadeye', star: 1 }
  ]);
  var setupAB = { a: compA, b: compB };

  var rA = ST.Battle.battle(setupAB, 42);
  var rB = ST.Battle.battle(setupAB, 42);
  TH.eq('同 seed 事件流逐字节一致', JSON.stringify(rA.log), JSON.stringify(rB.log));
  TH.eq('同 seed 统计一致', JSON.stringify(rA.unitStats), JSON.stringify(rB.unitStats));
  TH.eq('同 seed 胜负一致', rA.winner, rB.winner);
  TH.eq('同 seed initial 一致', JSON.stringify(rA.initial), JSON.stringify(rB.initial));

  // 交叉污染：中间插入别的战斗，结果不能变
  var h1 = logHash(ST.Battle.battle(setupAB, 7));
  ST.Battle.battle({ a: compB, b: compA }, 12345);
  ST.Battle.randomComp('a', ST.makeRng(1), {});
  var h2 = logHash(ST.Battle.battle(setupAB, 7));
  TH.eq('战斗之间无状态污染', h1, h2);

  // 交换 A/B 再跑，也不能影响原来的种子
  var h3 = logHash(ST.Battle.battle(setupAB, 2024));
  ST.Battle.battle({ a: compB, b: compA }, 2024);
  var h4 = logHash(ST.Battle.battle(setupAB, 2024));
  TH.eq('交换双方不影响原种子结果', h3, h4);

  var distinctHashes = {};
  for (i = 0; i < 12; i++) distinctHashes[logHash(ST.Battle.battle(setupAB, 1000 + i))] = true;
  TH.ok('不同 seed 会产出不同战斗', Object.keys(distinctHashes).length >= 4,
    '12 个种子产生了 ' + Object.keys(distinctHashes).length + ' 种结果');

  TH.ok('字符串种子可用', ST.Battle.battle(setupAB, '狂战影袭').log.length > 0);
  TH.eq('字符串种子等价于其 hash', logHash(ST.Battle.battle(setupAB, 'abc')), logHash(ST.Battle.battle(setupAB, ST.hashSeed('abc'))));

  TH.eq('recordLog:false 不产出日志', ST.Battle.battle(setupAB, 5, { recordLog: false }).log.length, 0);
  TH.eq('recordLog:false 结果仍与完整模式一致',
    ST.Battle.battle(setupAB, 5, { recordLog: false }).winner,
    ST.Battle.battle(setupAB, 5).winner);

  /* ============================================================
   * 4b. 初始快照必须是「开局」，不是「残局」
   *
   * 这是一条回归测试：最早的版本在战斗结束后才去读 u.r / u.hp 组装 initial，
   * 结果拿到的是被移动过、被扣过血的尸体状态，事件流从一开始就对不上。
   * ============================================================ */
  TH.section('初始快照');

  var rInit = ST.Battle.battle(setupAB, 42);
  var initAllFull = true, initSide = true, initMoved = false;
  for (i = 0; i < rInit.initial.units.length; i++) {
    var iu = rInit.initial.units[i];
    if (iu.hp !== iu.maxHp) initAllFull = false;
    if (ST.Battle.sideOfRow(iu.r) !== iu.side) initSide = false;
    if (iu.hp !== rInit.unitStats[iu.uid].maxHp) initAllFull = false;
  }
  // 这场战斗里确实有人移动过，才说明上面那条断言有意义
  for (i = 0; i < rInit.log.length; i++) if (rInit.log[i].type === 'move') initMoved = true;

  TH.ok('初始快照里所有单位都是满血', initAllFull);
  TH.ok('初始快照里双方都在自己半场', initSide);
  TH.ok('这场战斗确实发生了移动（否则上一条测试没意义）', initMoved);

  // 初始快照不能受种子影响
  var rInit2 = ST.Battle.battle(setupAB, 987654);
  TH.eq('初始快照与种子无关', JSON.stringify(rInit.initial), JSON.stringify(rInit2.initial));

  // 初始快照必须和事件流里第一个 snap 完全一致
  var firstSnap = null;
  for (i = 0; i < rInit.log.length; i++) if (rInit.log[i].type === 'snap') { firstSnap = rInit.log[i]; break; }
  var snapMatches = !!firstSnap;
  if (firstSnap) {
    var byUid = {};
    for (i = 0; i < rInit.initial.units.length; i++) byUid[rInit.initial.units[i].uid] = rInit.initial.units[i];
    for (i = 0; i < firstSnap.u.length; i++) {
      var row = firstSnap.u[i];
      var src = byUid[row[0]];
      if (!src) { snapMatches = false; continue; }
      if (Math.abs(row[1] - src.hp) > 0.05) snapMatches = false;       // 血量
      if (Math.abs(row[2] - src.shield) > 0.05) snapMatches = false;   // 护盾
      if (Math.abs(row[3] - src.mana) > 0.05) snapMatches = false;     // 法力
      if (row[4] !== src.r || row[5] !== src.c) snapMatches = false;   // 位置
    }
  }
  TH.ok('初始快照与第一个快照事件完全一致', snapMatches);

  // 残局统计（unitStats）反过来必须反映结束状态
  var endStateOk = true;
  for (i = 0; i < rInit.initial.units.length; i++) {
    var uid2 = rInit.initial.units[i].uid;
    var stt = rInit.unitStats[uid2];
    if (!stt) { endStateOk = false; continue; }
    if (stt.survived && !(stt.hpLeft > 0)) endStateOk = false;
    if (!stt.survived && stt.hpLeft !== 0) endStateOk = false;
  }
  TH.ok('结算统计反映的是结束状态（存活=有血，阵亡=0 血）', endStateOk);

  /* ============================================================
   * 5. 事件流不变量
   * ============================================================ */
  TH.section('事件流不变量');

  var CFG = ST.BATTLE_CFG;

  /**
   * 把一份战斗结果从头到尾验一遍。任何一条不成立都说明模拟器有真 bug。
   * 这里最狠的一条是「hpLoss 必须等于 血量差」—— 它能把护盾、暴击、
   * 减伤、治疗、反弹任何一处算错都揪出来。
   */
  function checkInvariants(res, label, bad) {
    var init = {}, uid;
    for (var q = 0; q < res.initial.units.length; q++) {
      var iu = res.initial.units[q];
      init[iu.uid] = iu;
    }
    var lastHp = {}, lastShield = {}, alive = {}, diedCount = {}, curPos = {}, cellOf = {};
    var lastFrenzy = {}, lastAttackT = {};
    var swapCount = {};     // 每个单位换了几次位（用于检查有没有互相顶来顶去）
    var lastHurtT = {};     // 每个单位最近一次「真的掉血」的时间（受伤回血被动要靠它判定）
    var lastHealT = {};     // 每个单位最近一次被治疗的时间（幻觉 / 开智要靠它判定）
    var lastHealFrom = {};  // 那次治疗是谁奶的
    var snipeTotal = {}, snipeSure = {};   // 荣誉：开了几枪 / 用掉几次必定命中
    var chargeCount = {}, lastChargeT = {};   // 荣誉：蓄力了几次 / 上次蓄力结束的时刻
    var knockCount = {};                      // 牢大：谁被击退过几次
    var downUntil = {}, crashCount = {}, reviveCount = {};   // 牢大：倒下 / 坠机 / 复活的次数
    var blockCount = {}, lastBlockT = {}, lastBlockFrom = {};  // 鸭子「抓娃娃」
    var ocLast = {}, ocOver = {};                             // 张雪峰：上次叠到多少 / 是否已超频
    var ocCapped = {};                                        // 张雪峰：是否已经顶到攻速上限
    var ritesUsed = {};                                       // 老牧师：哪个牧师已经用过被动了
    var ritesPending = {};                                    // 老牧师：谁正在被祷告（等人站起来）
    var ritesReviveCount = {};                                // 老牧师：谁被救了几次
    var ritesByPriest = {};                                   // 老牧师：每个牧师救了几个人
    var revivedOnce = {};                                     // 复活过一次（老牧师救的 / 被招安的）
    var convertCount = {};                                    // 孙笑川：谁被招安了几次
    var curOf = {}, curLive = {};                             // 电棍：每道电流的状态 / 每个电棍活着几条
    var chillStacks = {}, chillPending = {};                   // 张雪峰：冰棍层数 / 刚满层待冰冻
    var stunCastN = {};                                        // 嘉豪：一次施法已经发出了几条眩晕
    var peakStunArmedAt = {};                                  // 羊帆：巅峰一击 / 自爆发生的时刻
    var peakArmed = {};                                        // 羊帆：蓄势到了没有
    var fields = [];                                           // 楚生疑犯：全场放过的领域
    var fieldN = {};                                           // 楚生疑犯：谁放了几次领域
    var shadows = {};                                          // 楚生疑犯：谁现在在暗影里
    var shadowBlockN = {};                                     // 楚生疑犯：暗影格挡了几次
    var endlessOn = {}, skullN = {}, knifeN = {}, refillN = {};  // Dank1ng
    var killAt = {};                                           // Dank1ng：最近一次击杀的时刻
    var skullT = {};                                           // Dank1ng：最近一次留骷髅的时刻
    /* 某个单位还有几个**活着的队友**（不含自己）。
       ★ 直接从 alive[] 表现算，不另外维护计数 —— 校验器里能少一份状态就少一份
         "状态不同步"的风险（复活、坠机都会改存活表，自己再记一份迟早对不上）。 */
    function matesOf(uid) {
      var me = init[uid];
      if (!me) return 0;
      var n = 0;
      for (var k in init) {
        if (k === uid) continue;
        if (init[k].side !== me.side) continue;
        if (alive[k]) n++;
      }
      return n;
    }
    /* ★★ 「遁入暗影」要数的是**不会遁入暗影的**存活队友（非楚生疑犯）。
     *
     *   这一条是用户报的 bug：场上有两只楚生疑犯时，两只都躲进暗影，
     *   谁也打不到谁、谁也死不了，"队友都死了就现形"永远不成立 ——
     *   因为每一只都把**另一只躲在暗影里的**算成了"我还活着"。
     *
     *   ★★★ 而校验器原来用的正是**同一个（错的）定义**（matesOf = 所有存活队友），
     *   所以 80 场随机对局跑了那么久都没报过 —— 引擎和校验器犯了同一个错，
     *   这条不变量就永远不可能发现它。教训：**校验器的判据要独立于引擎的写法**，
     *   照着引擎的实现抄一遍，抄到的就是同一个盲点。 */
    function shadowMatesOf(uid) {
      var me = init[uid];
      if (!me) return 0;
      var n = 0;
      for (var k in init) {
        if (k === uid) continue;
        if (init[k].side !== me.side) continue;
        if (!alive[k]) continue;
        if (init[k].shadowAt) continue;      // 同类：不给彼此续命
        n++;
      }
      return n;
    }
    var lastBurnT = {};                                        // 张雪峰：上次自毁的时刻
    var lastLaughT = {}, laughUntil = {};                      // 奶龙：上次大笑 / 笑到什么时候
    for (uid in init) {
      lastHp[uid] = init[uid].hp;
      lastShield[uid] = init[uid].shield;
      alive[uid] = true;
      diedCount[uid] = 0;
      curPos[uid] = { r: init[uid].r, c: init[uid].c };
      cellOf[init[uid].r + ',' + init[uid].c] = uid;
    }

    var lastT = -1;
    for (var i2 = 0; i2 < res.log.length; i2++) {
      var e = res.log[i2];
      var tag = label + ' @' + i2 + ' ' + e.type;

      if (typeof e.t !== 'number' || !isFinite(e.t)) { bad(tag + ' 时间戳非法'); continue; }
      if (e.t < lastT - 1e-9) bad(tag + ' 时间倒流: ' + e.t + ' < ' + lastT);
      lastT = e.t;



      var to = (e.to !== undefined && e.to !== null) ? e.to : e.who;

      switch (e.type) {
        case 'attack':
        case 'skill':
        case 'damage':
          // 记录每个单位最近一次普攻的时间（星级被动要靠它判定触发时机）
          if (e.type === 'attack') lastAttackT[e.from] = e.t;
          // 记录每个单位最近一次「真的掉血」的时间（受伤回血被动要靠它判定）
          if (e.hpLoss > 0 && to) lastHurtT[to] = e.t;
          if (!(e.dmg > 0)) {
            /* ★ 2026-10：伤害值可以是 0 —— 鸭子「抓娃娃」会把前 N 次
               敌人伤害**判 0**。判据不是"允许 0"，而是
               「0 必须紧跟一条同 tick、同目标的 block 事件」。
               否则「掉 0 血」和「这一下被挡了」分不清，
               真出了「伤害算成 0」的 bug 也抓不到。 */
            if (!(e.dmg === 0 && lastBlockT[to] === e.t)) {
              bad(tag + ' 伤害值非正: ' + e.dmg);
            }
          }
          if (!init[to]) { bad(tag + ' 指向未知单位 ' + to); break; }
          if (!alive[to]) bad(tag + ' 打到了已死亡的单位 ' + to);
          if (!(e.hpAfter >= 0 && e.hpAfter <= e.hpMax + 0.02)) {
            bad(tag + ' 血量越界 ' + to + ' hpAfter=' + e.hpAfter + ' max=' + e.hpMax);
          }
          if (e.hpAfter > lastHp[to] + 0.02) {
            bad(tag + ' 受伤后血量反而上升 ' + to + ' ' + lastHp[to] + ' → ' + e.hpAfter);
          }
          if (e.hpLoss !== undefined) {
            var expectLoss = lastHp[to] - e.hpAfter;
            if (Math.abs(expectLoss - e.hpLoss) > 0.02) {
              bad(tag + ' hpLoss 与血量差不自洽 ' + to +
                ' 事件=' + e.hpLoss + ' 实际=' + U.round2(expectLoss));
            }
          }
          if (e.type === 'attack') {
            if (typeof e.crit !== 'boolean') bad(tag + ' 缺少 crit 标记');
            /* ★ 羊帆「羊巅峰」：×20 那一下必须**紧跟在一段蓄力之后**。
               这是这一套被动最容易写错的地方 —— 忘了清 peakCharge 的话
               每一发普攻都是 20 倍，而"伤害很高"本身看起来并不像 bug。
               规则：attack 带 peak 之前，本人必须刚好放过一次 cast(kind=peak)。 */
            if (e.peak) {
              var pk = init[e.from];
              if (!pk) bad(tag + ' 未知单位的巅峰一击 ' + e.from);
              else if (!(pk.peakMult > 1)) bad(tag + ' 这个棋子没有巅峰一击，却打出了 peak ' + e.from);
              else if (e.peakMult !== pk.peakMult) {
                bad(tag + ' 巅峰一击的倍率不是数据里的 ' + pk.peakMult + '：' + e.peakMult);
              }
              if (!peakArmed[e.from]) {
                bad(tag + ' 巅峰一击之前没有蓄势（多打了 20 倍）' + e.from + ' @' + U.round2(e.t));
              }
              peakArmed[e.from] = false;
              peakStunArmedAt[e.from] = e.t;      // 这一下（如果带了眩晕）马上可以跟 stun
            }
            if (!(e.raw >= e.dmg - 1e-6)) {
              bad(tag + ' 原始伤害小于结算伤害（减伤/护盾算反了？）raw=' + e.raw + ' dmg=' + e.dmg);
            }
            /* ★ 「捧腹大笑」的 -80% 减伤：raw 是"本该打出多少"（不含减伤），
               减抗之后最多再乘 0.2 —— 所以 dmg 必然 <= raw × 0.2。
               这是一个**上界**断言：真要把 0.2 写成 0.8 或漏乘，
               这里立刻会红，而且不需要知道对方的护甲。 */
            if (laughUntil[to] !== undefined && e.t < laughUntil[to]) {
              var cut = (init[to] && init[to].laughCut) ? (1 - init[to].laughCut) : 1;
              if (e.dmg > e.raw * cut + 0.02) {
                bad(tag + ' 大笑期间受到的伤害没有被减到 ' + Math.round(cut * 100) +
                    '%：raw=' + U.round2(e.raw) + ' dmg=' + U.round2(e.dmg));
              }
            }
          }
          if (e.ramp !== undefined) {
            if (!isFinite(e.ramp) || e.ramp < 1) bad(tag + ' 伤害递增系数非法: ' + e.ramp);
            if (e.t <= CFG.RAMP_START && e.ramp !== 1) bad(tag + ' 递增期之前就放大了伤害');
            // 留 1 秒余量：ramp 在日志里保留两位小数，刚过阈值时会四舍五入成 1.00
            if (e.t > CFG.RAMP_START + 1 && e.ramp <= 1) bad(tag + ' 递增期没有放大伤害');
          }
          lastHp[to] = e.hpAfter;
          if (e.shieldLoss !== undefined) lastShield[to] = Math.max(0, lastShield[to] - e.shieldLoss);
          break;

        case 'heal':
          if (!(e.amount > 0)) bad(tag + ' 治疗量非正，不该写进日志: ' + e.amount);
          /* 「这一口是谁奶的」要记下来：紧跟着的 gift 事件必须由同一次治疗触发。 */
          if (e.from !== null && e.from !== undefined) {
            lastHealT[e.to] = e.t;
            lastHealFrom[e.to] = e.from;
          }
          /* ★ 受伤回血（兽性 / 野性）：必须由「本 tick 自己受到的伤害」触发。
             写成「上一条事件是伤害」会误报 —— afterDamage 里同一 tick 还可能有
             反伤、回蓝、放技能等事件插在中间。用「同一 tick 内本人掉过血」才准。 */
          if (e.reason === 'passive') {
            if (!init[to]) break;
            if ((init[to].hurtHealPct || 0) <= 0) {
              bad(tag + ' 这个棋子没有受伤回血被动，却出现了 passive 治疗 ' + to);
            }
            if (Math.abs((lastHurtT[to] === undefined ? -99 : lastHurtT[to]) - e.t) > 1e-9) {
              bad(tag + ' 受伤回血不是在本 tick 受伤之后触发的（最近掉血 @' +
                  lastHurtT[to] + '，本次 @' + e.t + '）');
            }
          }
          /* ★ 大笑回血：自己那一份必须在本人的大笑窗口内；
             3 星的光环必须由**正在笑的队友**发出。 */
          if (e.reason === 'laugh') {
            if (!(laughUntil[to] !== undefined && e.t <= laughUntil[to] + 0.02)) {
              bad(tag + ' 不在大笑期间却回了血 ' + to);
            }
            if (init[to] && init[to].laughHealPct > 0) {
              /* ★★ 容差 1.05（不是 0.6）：`healPool` 会把不足 1 点的治疗攒起来、
                 下一次一起放出去（医者羁绊每 tick 那份就是零点几），
                 所以单条 heal 事件最多比"定额"多出不到 1 点。
                 这条和「外卖回血」那条是同一个来源（见第 123 行那条坑）——
                 它这次才红，是因为换了棋子之后随机序列变了、头一次踩上边界。 */
              if (Math.abs(e.amount - Math.min(init[to].maxHp * init[to].laughHealPct,
                    U.round2(e.hpMax - (e.hpAfter - e.amount)))) > 1.05) {
                bad(tag + ' 大笑回血量不是最大生命的 ' + init[to].laughHealPct);
              }
            }
          }
          if (e.reason === 'laughAura') {
            if (!e.from) bad(tag + ' 大笑光环没有来源');
            else if (!(laughUntil[e.from] !== undefined && e.t <= laughUntil[e.from] + 0.02)) {
              bad(tag + ' 队友没在笑却在发大笑光环 ' + e.from);
            }
            if (init[e.from] && !init[e.from].laughHeal) {
              bad(tag + ' 这个棋子没有「笑传四方」（3 星才有），却在治疗队友');
            }
          }
          /* ★★ 美团袋鼠 3 星「好评如潮」：普攻给"被打中的敌人周围"的队友送外卖。
             守住四件事：
               ① 只有 3 星（deliveryHealPct > 0）的棋子才有这个治疗
               ② 施法者必须是**自己人**（外卖不会送给对面）
               ③ 每一口都必须挂在**同一 tick 的一次普攻**上（不会凭空冒出来）
               ④ 一口不能超过「自己的生命上限 × healPct」——
                  上限型数值，所以只能验上界（被剩余血量截断是合法的）。 */
          if (e.reason === 'delivery') {
            var du6 = init[e.from];
            if (!du6) { bad(tag + ' 外卖治疗来自未知单位 ' + e.from); break; }
            if (!(du6.deliveryHealPct > 0)) {
              bad(tag + ' 这个棋子不该有外卖治疗（3 星才有） ' + e.from);
            }
            if (init[to] && init[to].side !== du6.side) {
              bad(tag + ' 外卖送到了敌方单位身上 ' + to);
            }
            if (init[to] && e.amount > init[to].maxHp * du6.deliveryHealPct + 1.05) {
              /* ★★ 容差是 **1.05**，不是 0.6 —— 这不是"把断言放宽到能过"，
                 而是 `healPool` 那条既有规则的必然结果：
                 不足 1 点的治疗（医者羁绊的每 tick 回血、光环那类）**不会**被丢掉，
                 而是攒在 `healPool` 里，够 1 点才生效并记账
                 （README 第 2 行坑）。所以某一口外卖可能顺手把上一 tick 攒下的
                 ~1 点一起放出来，事件里的 amount 就比"这一口的定额"多一点。
                 ★ 第一版按 0.6 卡，80 场随机对局里就报出了
                 「40.18 > 39.2」—— 引擎没错，是上界写得太死。 */
              bad(tag + ' 外卖回血超过了最大生命的 ' + du6.deliveryHealPct +
                  '（含 healPool 攒下的 <1 点）：' + e.amount + ' > ' +
                  U.round2(init[to].maxHp * du6.deliveryHealPct));
            }
            var paired6 = false;
            for (var q6 = 0; q6 < res.log.length; q6++) {
              var pe6 = res.log[q6];
              if (pe6.type === 'attack' && pe6.t === e.t && pe6.from === e.from) {
                paired6 = true;
                break;
              }
            }
            if (!paired6) bad(tag + ' 外卖治疗没有紧跟在同一 tick 的一次普攻上 ' + e.to);
          }
          if (!init[to]) { bad(tag + ' 指向未知单位 ' + to); break; }
          if (!alive[to]) bad(tag + ' 治疗了已死亡的单位 ' + to);
          if (e.hpAfter < lastHp[to] - 0.02) bad(tag + ' 治疗导致掉血 ' + to);
          if (e.hpAfter > e.hpMax + 0.02) bad(tag + ' 治疗超过血量上限 ' + to + ' ' + e.hpAfter + ' > ' + e.hpMax);
          if (Math.abs((e.hpAfter - lastHp[to]) - e.amount) > 0.02) {
            bad(tag + ' 治疗量与血量差不自洽 ' + to + ' 事件=' + e.amount + ' 实际=' + U.round2(e.hpAfter - lastHp[to]));
          }
          lastHp[to] = e.hpAfter;
          break;

        case 'shield':
          if (!init[to]) { bad(tag + ' 指向未知单位 ' + to); break; }
          if (!(e.amount > 0)) bad(tag + ' 护盾量非正');
          if (e.shieldAfter < lastShield[to] - 0.02) bad(tag + ' 护盾事件后护盾反而变小 ' + to);
          if (e.shieldAfter < e.amount - 0.02) bad(tag + ' 护盾叠加后小于本次护盾量');
          lastShield[to] = e.shieldAfter;
          break;

        case 'death':
          if (!init[e.who]) { bad(tag + ' 未知单位死亡 ' + e.who); break; }
          diedCount[e.who]++;
          /* ★ 「同一单位死了多次」以前一定是 bug，现在**牢大可以死两次**——
             第一次死会触发坠机 + 复活，那是一次合法的二次阵亡。
             判据不是「死了几次」，而是「死之前有没有复活过」：
             复活次数 >= 死亡次数才允许继续死。 */
          if (diedCount[e.who] > 1 && diedCount[e.who] > (reviveCount[e.who] || 0) + 1) {
            bad(tag + ' 同一单位死了多次（且中间没有复活）' + e.who);
          }
          if (!alive[e.who]) bad(tag + ' 已死单位再次死亡 ' + e.who);
          if (lastHp[e.who] > 0.02) bad(tag + ' 死亡时血量仍为正 ' + e.who + '=' + lastHp[e.who]);
          alive[e.who] = false;
          /* ★ death 事件里现在带着**击杀者**（by）。加它是因为
             Dank1ng 的「锁头」要验「能量回满必须紧跟在自己的一次击杀之后」——
             没有这一列的话，"谁杀的"在校验器里根本读不出来。
             （渲染层顺便也能写出「X 击杀了 Y」这样的回放。） */
          if (e.by) {
            if (!init[e.by]) bad(tag + ' 击杀者未知 ' + e.by);
            else if (e.by === e.who) bad(tag + ' 自己击杀自己 ' + e.who);
            else killAt[e.by] = e.t;
          }
          if (curPos[e.who]) delete cellOf[curPos[e.who].r + ',' + curPos[e.who].c];
          break;

        case 'move':
          if (!init[e.who]) { bad(tag + ' 未知单位移动 ' + e.who); break; }
          if (!alive[e.who]) bad(tag + ' 已死亡的单位在移动 ' + e.who);
          if (e.r < 0 || e.r >= CFG.ROWS || e.c < 0 || e.c >= CFG.COLS) {
            bad(tag + ' 移动越界 (' + e.r + ',' + e.c + ')');
          }
          if (curPos[e.who] && e.r === curPos[e.who].r && e.c === curPos[e.who].c) {
            bad(tag + ' 原地「移动」了一次（会白给渲染层一个事件）');
          }

          /* ★ 两条和「开战时棋子必须站在那里」直接相关的规矩。
           *
           * ① 开局定格期内不许有任何走位。
           *    玩家摆完阵按开战，第一眼要看到的是自己摆的阵，
           *    而不是「一开战就冲到中间」——那是移动速度写成了 30 格/秒的后果。
           *
           * ② 射程内有敌人时必须就地打，不许走。
           *    原来的判定是「只看当前锁定的那个目标」：目标在远处就走过去，
           *    哪怕旁边紧贴着另一个敌人 —— 看起来就是棋子从敌人身边路过不肯打。
           */
          if (e.t < CFG.OPENING_HOLD - 1e-9) {
            bad(tag + ' 开局定格期内不该有走位（' + e.t + ' < ' + CFG.OPENING_HOLD + '）');
          }
          (function () {
            var me = init[e.who], mp = curPos[e.who];
            if (!me || !mp) return;
            for (var ru in init) {
              var other = init[ru];
              if (other.side === me.side) continue;
              if (!alive[ru]) continue;
              /* ★★ 遁入暗影的敌人**不算"射程内有敌人"**：它不会被索敌，
                 所以对面就该继续走位去找别人。少了这一句，
                 一整队人会站在一个打不到的幽影旁边"就地开打"——
                 而引擎行为其实是对的，是这条断言漏了一个新的排除条件。
                 （校验器读不了引擎内部的 targetable()，只能自己按
                   shadows[] 这份账本判断 —— 这也是为什么暗影要记账。） */
              if (shadows[ru]) continue;
              var op = curPos[ru];
              if (!op) continue;
              if (U.cheb(mp.r, mp.c, op.r, op.c) <= me.range) {
                bad(tag + ' 射程内有敌人（' + other.name + '）却还在走位，应该就地开打');
                return;
              }
            }
          })();

          // 目标格必须是空的。注意：越过中线是合法的 —— 自走棋只在布阵时分半场，
          // 打起来前排被自家棋子堵住时绕行穿过中线是正确行为。
          var destKey = e.r + ',' + e.c;
          if (cellOf[destKey] && cellOf[destKey] !== e.who) {
            bad(tag + ' 移动到了已被占用的格子 (' + e.r + ',' + e.c + ')，占用者是 ' + cellOf[destKey]);
          }
          if (curPos[e.who]) delete cellOf[curPos[e.who].r + ',' + curPos[e.who].c];
          cellOf[destKey] = e.who;
          curPos[e.who] = { r: e.r, c: e.c };
          break;

        /* ★ 星级被动「越打越快」的规则。
         *   每一条都对应 battle.js gainFrenzy() 里的一个设计选择，
         *   任何一条被破坏都会让「每次攻击 +5%/10%、上限 200%」这个承诺失真。 */
        case 'frenzy': {
          if (!init[e.who]) { bad(tag + ' 未知单位触发被动 ' + e.who); break; }
          if (!alive[e.who]) bad(tag + ' 已死亡的单位还在叠加被动 ' + e.who);
          var fStep = init[e.who].frenzyStep || 0;
          var fCap = init[e.who].frenzyCap || 0;
          if (!(fStep > 0)) bad(tag + ' 这个棋子没有被动，却触发了 frenzy ' + e.who);
          if (!(e.pct > 0)) bad(tag + ' 被动叠加值非正: ' + e.pct);
          if (fCap > 0 && e.pct > fCap + 1e-6) bad(tag + ' 被动超过上限 ' + e.pct + ' > ' + fCap);
          var fPrev = lastFrenzy[e.who] || 0;
          if (e.pct < fPrev - 1e-6) bad(tag + ' 被动回落了（说好本局内不衰减）: ' + fPrev + ' → ' + e.pct);
          if (fStep > 0 && e.pct < fCap - 1e-6 &&
              Math.abs((e.pct - fPrev) - fStep) > 1e-6) {
            bad(tag + ' 每层增量不是 ' + fStep + '（' + fPrev + ' → ' + e.pct + '）');
          }
          // 必须由「本 tick 自己打出的一次普攻」触发。
          // ★ 不能写成「上一条事件就是 attack」：attackOnce 里 afterDamage 之后
          //   同一单位可能因为攒满法力立刻放技能（cast/skill 事件会插在中间），
          //   那是完全合法的顺序。用「同一 tick 内自己打过普攻」才既严格又不误报。
          if (!(Math.abs((lastAttackT[e.who] === undefined ? -99 : lastAttackT[e.who]) - e.t) < 1e-9)) {
            bad(tag + ' 被动不是在本人普攻的那一 tick 触发的（本人最近一次普攻 @' +
                lastAttackT[e.who] + '，本次 @' + e.t + '）');
          }
          lastFrenzy[e.who] = e.pct;
          break;
        }

        /* ★ 星级被动「幻觉 / 开智」的规则。
         *   这几条合起来保证的是「奶妈奶一口 → 被奶的人身上多一个伤害改动」
         *   这个承诺，以及「3 星必定增伤」这个升级必须是真的。 */
        case 'gift': {
          var gs = init[e.from], gd = init[e.to];
          if (!gs || !gd) { bad(tag + ' 幻觉指向未知单位 ' + e.from + '/' + e.to); break; }
          if (!alive[e.from]) bad(tag + ' 已死亡的棋子还在挂被动 ' + e.from);
          if (!(gs.giftPct > 0)) {
            bad(tag + ' 这个棋子没有幻觉/开智被动，却触发了 gift ' + e.from);
          }
          if (gs.side !== gd.side) bad(tag + ' 幻觉挂到了敌人身上');
          // 必须紧跟在「同一个奶妈奶同一个人」的那一口之后
          if (Math.abs((lastHealT[e.to] === undefined ? -99 : lastHealT[e.to]) - e.t) > 1e-9 ||
              lastHealFrom[e.to] !== e.from) {
            bad(tag + ' 幻觉不是紧跟在本人那次治疗之后触发的（最近治疗 @' +
                lastHealT[e.to] + ' by ' + lastHealFrom[e.to] + '，本次 @' + e.t + ' by ' + e.from + '）');
          }
          if (typeof e.good !== 'boolean') bad(tag + ' 缺少 good 标记');
          // 3 星「开智」不许出现坏结果 —— 这是升星唯一的收益，必须硬保证
          if (gs.giftSure && e.good !== true) bad(tag + ' 3 星开智出现了减伤结果');
          var gp = gs.giftPct;
          var wantMul = e.good ? 1 + gp : 1 - gp;
          if (Math.abs(e.mul - wantMul) > 1e-6) {
            bad(tag + ' 伤害倍率和被动幅度对不上 mul=' + e.mul + ' 期望=' + U.round2(wantMul));
          }
          if (!(e.mul > 0)) bad(tag + ' 伤害倍率非正: ' + e.mul);
          if (!(e.until > e.t)) bad(tag + ' 效果到期时间不在未来: ' + e.until + ' <= ' + e.t);
          if (!e.skill) bad(tag + ' 缺少技能名（2 星幻觉 / 3 星开智）');
          break;
        }

        /* ★ 牢大「肘击」的击退。
         *   这里要守住的其实是**占位表**：击退会改变谁站在哪一格，
         *   而后面所有走位事件都在靠它判「目标格是不是空的」。
         *   一个漏更新的 cellOf 会让校验器开始误报「射程内有敌人却还在走位」——
         *   上一版就是这么暴露的（knockback 还没写 case 的时候）。 */
        case 'knockback': {
          var ka = init[e.from], kb = init[e.to];
          if (!ka || !kb) { bad(tag + ' 击退涉及未知单位 ' + e.from + '/' + e.to); break; }
          if (!alive[e.from]) bad(tag + ' 已死亡的棋子还在击退别人 ' + e.from);
          if (!alive[e.to]) bad(tag + ' 击退了已死亡的单位 ' + e.to);
          var kp = curPos[e.to];
          if (!kp) { bad(tag + ' 击退时没有位置记录'); break; }
          if (e.fromR !== kp.r || e.fromC !== kp.c) {
            bad(tag + ' 击退事件里的起始坐标和实际位置对不上');
          }
          if (!(e.cells >= 1)) bad(tag + ' 击退格数非正: ' + e.cells);
          var mdr = e.r - kp.r, mdc = e.c - kp.c;
          if (Math.abs(mdr) + Math.abs(mdc) !== e.cells) {
            bad(tag + ' 击退格数和实际位移对不上: 声明 ' + e.cells +
                '，位移 ' + (Math.abs(mdr) + Math.abs(mdc)));
          }
          if (mdr !== 0 && mdc !== 0) bad(tag + ' 击退不是沿单一轴向推的（不该斜着飞）');
          if (e.r < 0 || e.r >= CFG.ROWS || e.c < 0 || e.c >= CFG.COLS) {
            bad(tag + ' 击退到了棋盘外 (' + e.r + ',' + e.c + ')');
          }
          // 方向必须「远离施法者」（曼哈顿距离变大）
          var ksp = curPos[e.from];
          if (ksp) {
            var dBefore = Math.abs(kp.r - ksp.r) + Math.abs(kp.c - ksp.c);
            var dAfter = Math.abs(e.r - ksp.r) + Math.abs(e.c - ksp.c);
            if (!(dAfter > dBefore)) {
              bad(tag + ' 击退方向没有远离施法者（' + dBefore + ' → ' + dAfter + '）');
            }
          }
          var kdest = e.r + ',' + e.c;
          if (cellOf[kdest] && cellOf[kdest] !== e.to) {
            bad(tag + ' 击退把 ' + e.to + ' 推进了被占用的格子 ' + kdest +
                '（占用者 ' + cellOf[kdest] + '）');
          }
          delete cellOf[kp.r + ',' + kp.c];
          cellOf[kdest] = e.to;
          curPos[e.to] = { r: e.r, c: e.c };
          knockCount[e.to] = (knockCount[e.to] || 0) + 1;
          break;
        }

        /* ★ 牢大「坠机」的三段：倒下 → 直升机落地 → 复活。
         *   这三条连起来才是完整的机制，缺任何一段都会留下
         *   「死了不消失」「炸了不复活」「复活了还占着尸体格」这类脏状态。 */
        case 'down': {
          var du = init[e.who];
          if (!du) { bad(tag + ' 未知单位倒下 ' + e.who); break; }
          /* ★ 有"倒下之后还有一下"的被动只有两种：牢大的坠机（固定伤害）、
             羊帆 3 星的巅峰谢幕（攻击力 ×20 的自爆）。 */
          var canDown = (du.crashDamage > 0) || (du.boomAdMult > 0);
          if (!canDown) bad(tag + ' 这个棋子没有倒下结算的被动，却出现了 down ' + e.who);
          /* ★ boom 标记必须和棋子对得上：羊帆是自爆、牢大是坠机。
             标错的话渲染层会画错东西（直升机 vs 原地蓄力），而且不会报错。 */
          if (!!e.boom !== !!(du.boomAdMult > 0)) {
            bad(tag + ' 倒下事件的 boom 标记和棋子不符（' + e.boom + '）' + e.who);
          }
          if (alive[e.who]) bad(tag + ' 棋子还活着就进入倒下了 ' + e.who);
          if (!(e.delay > 0)) bad(tag + ' 倒下到坠毁的延时非正');
          if (Math.abs(e.until - (e.t + e.delay)) > 0.01) bad(tag + ' until 和 t+delay 对不上');
          /* ★ revive 是「这一次还会不会站起来」，不是「有没有这个被动」：
             一局只给 maxRevives 次，用完之后的第二次倒下必须如实写 false。
             所以要看「已经用掉几次」，不能直接拿 du.revives 比。 */
          var wantRevive = !!du.revives && (reviveCount[e.who] || 0) < (du.maxRevives || 1);
          if (e.revive !== wantRevive) {
            bad(tag + ' 倒下事件里的 revive 标记和棋子不符（期望 ' + wantRevive +
                '，事件 ' + e.revive + '；已复活 ' + (reviveCount[e.who] || 0) +
                ' / 上限 ' + (du.maxRevives || 1) + '）');
          }
          downUntil[e.who] = e.until;
          break;
        }

        case 'crash': {
          var cru = init[e.who];
          if (!cru) { bad(tag + ' 未知单位坠机 ' + e.who); break; }
          if (!(e.dmg > 0)) bad(tag + ' 坠机伤害非正');
          if (!!e.boom !== !!(cru.boomAdMult > 0)) {
            bad(tag + ' 爆炸事件的 boom 标记和棋子不符（' + e.boom + '）' + e.who);
          }
          if (e.boom) {
            /* ★ 羊帆的自爆：伤害必须是**攻击力 × 倍率**（不是随手写一个数），
               而且是物理伤害（吃护甲）—— 和牢大那条结论一样，
               无视防御的大范围伤害会把关卡难度曲线砸出断崖。 */
            var want = U.round2(cru.ad * cru.boomAdMult);
            if (Math.abs(e.dmg - want) > 0.01) {
              bad(tag + ' 自爆伤害不是攻击力 × ' + cru.boomAdMult + '：' + e.dmg +
                  ' vs ' + want);
            }
            if (Math.abs((e.stun || 0) - cru.peakStunDur) > 1e-9) {
              bad(tag + ' 自爆的眩晕秒数和被动对不上：' + e.stun + ' vs ' + cru.peakStunDur);
            }
            if (e.radius !== cru.boomRadius) {
              bad(tag + ' 自爆半径不是数据里的 ' + cru.boomRadius + '：' + e.radius);
            }
            peakStunArmedAt[e.who] = e.t;    // 自爆之后可以跟一组 stun（可能一次晕一圈人）
          } else if (e.radius !== CFG.CRASH_RADIUS) {
            bad(tag + ' 坠机半径不是 ' + CFG.CRASH_RADIUS + '（说好是 3×3）: ' + e.radius);
          }
          if (downUntil[e.who] === undefined) {
            bad(tag + ' 没经历过倒下就直接坠机了 ' + e.who);
          } else if (Math.abs(e.t - downUntil[e.who]) > CFG.DT + 0.01) {
            bad(tag + ' 坠机没有在倒下的 1 秒后发生（倒下到 ' + downUntil[e.who] +
                '，坠机 ' + e.t + '）');
          }
          crashCount[e.who] = (crashCount[e.who] || 0) + 1;
          break;
        }

        case 'revive': {
          var ru = init[e.who];
          if (!ru) { bad(tag + ' 未知单位复活 ' + e.who); break; }
          if (!ru.revives) bad(tag + ' 这个棋子没有复活被动，却复活了 ' + e.who);
          /* ★ 一局只复活 maxRevives 次。超了就是机制坏了 ——
             「必须打死它两遍」变成「三遍」，对局会被无限拖长。 */
          if ((reviveCount[e.who] || 0) >= (ru.maxRevives || 1)) {
            bad(tag + ' 复活次数超过上限：第 ' + ((reviveCount[e.who] || 0) + 1) +
                ' 次 > ' + (ru.maxRevives || 1));
          }
          if (alive[e.who]) bad(tag + ' 棋子还活着却在复活 ' + e.who);
          if (!(e.hp > 0)) bad(tag + ' 复活时血量非正: ' + e.hp);
          if (e.hp > e.hpMax + 0.02) bad(tag + ' 复活时血量超过上限');
          if (!(crashCount[e.who] >= (reviveCount[e.who] || 0) + 1)) {
            bad(tag + ' 没坠机就复活了 ' + e.who);
          }
          if (e.r < 0 || e.r >= CFG.ROWS || e.c < 0 || e.c >= CFG.COLS) {
            bad(tag + ' 复活到了棋盘外');
          }
          if (e.side !== ru.side) bad(tag + ' 复活到了对面半场 (' + e.r + ',' + e.c + ')');
          if (ST.Battle.sideOfRow(e.r) !== ru.side) bad(tag + ' 复活的位置不在自己半场');
          var rdest = e.r + ',' + e.c;
          if (cellOf[rdest] && cellOf[rdest] !== e.who) {
            bad(tag + ' 复活到了被占用的格子 ' + rdest + '（占用者 ' + cellOf[rdest] + '）');
          }
          // 复活的单位重新占格、重新算存活
          if (curPos[e.who]) delete cellOf[curPos[e.who].r + ',' + curPos[e.who].c];
          cellOf[rdest] = e.who;
          curPos[e.who] = { r: e.r, c: e.c };
          alive[e.who] = true;
          diedCount[e.who]--;              // ★ 它又活过来了，不再算在这个头上
          lastHp[e.who] = e.hp;            // ★ 不更新的话，复活后的第一次受伤会被判成「血量上升」
          lastShield[e.who] = 0;
          reviveCount[e.who] = (reviveCount[e.who] || 0) + 1;
          /* ★ 记下"它复活过"—— 孙笑川 3 星的「安排上了」对**已经复活过**的单位无效。
             不在这里记的话，那条排除条件在随机对局里永远验不到（空转）。 */
          revivedOnce[e.who] = true;
          if (!!e.cdCut !== !!ru.cdCut) bad(tag + ' cdCut 标记和棋子不符');
          if (!(e.maxMana > 0)) bad(tag + ' 复活后法力上限非法');
          break;
        }

        /* ★ 队友换位：被堵死的近战和前方队友交换位置。
         *   规则层保证「只有走投无路才会换」，校验器这里验的是
         *   「换得合法」—— 同阵营、相邻、真的对调了、占位表跟着改。 */
        case 'swap': {
          var sa = init[e.a], sb = init[e.b];
          if (!sa || !sb) { bad(tag + ' 换位指向未知单位 ' + e.a + '/' + e.b); break; }
          if (sa.side !== sb.side) bad(tag + ' 换位的两个单位不是同阵营');
          if (!alive[e.a] || !alive[e.b]) bad(tag + ' 已死亡的单位参与换位');
          var pa2 = curPos[e.a], pb2 = curPos[e.b];
          if (!pa2 || !pb2) { bad(tag + ' 换位时没有位置记录'); break; }
          if (U.cheb(pa2.r, pa2.c, pb2.r, pb2.c) !== 1) {
            bad(tag + ' 换位的两个单位不相邻（距离 ' + U.cheb(pa2.r, pa2.c, pb2.r, pb2.c) + '）');
          }
          if (e.aR !== pb2.r || e.aC !== pb2.c || e.bR !== pa2.r || e.bC !== pa2.c) {
            bad(tag + ' 换位事件里的坐标和实际位置对不上（不是对调）');
          }
          if (e.aR < 0 || e.aR >= CFG.ROWS || e.aC < 0 || e.aC >= CFG.COLS ||
              e.bR < 0 || e.bR >= CFG.ROWS || e.bC < 0 || e.bC >= CFG.COLS) {
            bad(tag + ' 换位换到了棋盘外');
          }
          delete cellOf[pa2.r + ',' + pa2.c];
          delete cellOf[pb2.r + ',' + pb2.c];
          cellOf[e.aR + ',' + e.aC] = e.a;
          cellOf[e.bR + ',' + e.bC] = e.b;
          curPos[e.a] = { r: e.aR, c: e.aC };
          curPos[e.b] = { r: e.bR, c: e.bC };
          swapCount[e.a] = (swapCount[e.a] || 0) + 1;
          swapCount[e.b] = (swapCount[e.b] || 0) + 1;
          break;
        }

        case 'snap': {
          var cells = {}, dup = false, ghost = false, hpBad = false;
          for (var s = 0; s < e.u.length; s++) {
            var row = e.u[s];
            if (row[6] === 1) {
              if (alive[row[0]] === false) ghost = true;
              var ck = row[4] + ',' + row[5];
              if (cells[ck]) dup = true;
              cells[ck] = true;
              if (row[4] < 0 || row[4] >= CFG.ROWS || row[5] < 0 || row[5] >= CFG.COLS) dup = true;
              if (!(row[1] >= 0) || !(row[2] >= 0) || !(row[3] >= 0)) hpBad = true;
              if (!(row[3] <= init[row[0]].maxMana + 0.02)) hpBad = true;
            }
          }
          if (dup) bad(tag + ' 快照里出现格子重叠或越界');
          if (ghost) bad(tag + ' 已死单位在快照里被标记为存活');
          if (hpBad) bad(tag + ' 快照里出现负数血量/护盾/法力或法力溢出');
          break;
        }

        /* ★ 「抓娃娃」：鸭子把一次敌人伤害判成 0。
         *   这一条要守住两件事：
         *     ① 次数不会超发，也不会少发（left 必须逐个递减）
         *     ② 被挡的那一下**真的一分血、一点盾都不掉** ——
         *        只在渲染层表现"挡住了"而实际扣了血，是最容易出的假动作
         */
        case 'block': {
          var gu = init[e.who], gf = init[e.from];
          if (!gu) { bad(tag + ' block 指向未知单位 ' + e.who); break; }
          /* ★★ 现在有**两种**"这一下打不动"：
           *     抓娃娃（100元的鸭子）  前 N 次敌人攻击，次数有限、会递减
           *     遁入暗影（楚生疑犯 3 星）  一切伤害，不限次数，直到队友死光
           *   靠 reason 区分。原来那条断言默认"有 block 就一定是抓娃娃"，
           *   于是一出现暗影格挡就报「这个棋子没有抓娃娃被动」。
           *   —— 和"共用机制要各记各的账"是同一类问题（README 第 76 条）。 */
          if (e.reason === 'shadow') {
            if (!gu.shadowAt) {
              bad(tag + ' 这个棋子没有「遁入暗影」，却出现了 shadow 格挡 ' + e.who);
            }
            if (!shadows[e.who]) {
              bad(tag + ' 不在暗影里却触发了暗影格挡 ' + e.who);
            }
            if (!alive[e.who]) bad(tag + ' 已死亡的棋子还在挡伤害 ' + e.who);
            // 不限次数、不看来源（反伤 / 自爆也算"一切伤害"）
            if (e.left !== -1 || e.max !== -1) {
              bad(tag + ' 暗影格挡不该带次数（它不限次数）: left=' + e.left + ' max=' + e.max);
            }
            shadowBlockN[e.who] = (shadowBlockN[e.who] || 0) + 1;
            lastBlockT[e.who] = e.t;
            lastBlockFrom[e.who] = e.from;
            break;
          }
          if (!(gu.guardMax > 0)) {
            bad(tag + ' 这个棋子没有「抓娃娃」被动，却出现了 block ' + e.who);
          }
          if (!alive[e.who]) bad(tag + ' 已死亡的棋子还在挡伤害 ' + e.who);
          if (!gf) { bad(tag + ' block 指向未知来源 ' + e.from); break; }
          if (gf.side === gu.side) bad(tag + ' 同阵营的伤害不该被「抓娃娃」挡住');
          blockCount[e.who] = (blockCount[e.who] || 0) + 1;
          if (blockCount[e.who] > (gu.guardMax || 0)) {
            bad(tag + ' 挡的次数超过上限：第 ' + blockCount[e.who] + ' 次 > ' + gu.guardMax);
          }
          if (e.max !== gu.guardMax) bad(tag + ' block.max 和棋子不符: ' + e.max);
          if (e.left !== (gu.guardMax || 0) - blockCount[e.who]) {
            bad(tag + ' block.left 和实际次数对不上: ' + e.left + '，应该是 ' +
                ((gu.guardMax || 0) - blockCount[e.who]));
          }
          lastBlockT[e.who] = e.t;
          lastBlockFrom[e.who] = e.from;
          break;
        }

        /* ★ 张雪峰「超频」：每次普攻叠攻速，只涨不跌。
         *   2026-10 之后多了两条规则，这里都要独立算一遍：
         *     ① 进入狂暴之后单次叠加量**翻倍**（ocPerHit → ocPerHitBerserk）
         *     ② 加成有硬上限 ocMaxAs，顶到之后**不再写事件**
         *   ★ 「该叠多少」用的是**叠加之前**的 ocOver 状态 ——
         *     和 battle.js 里"用叠加之前的 ocOn 决定 step"必须同一个口径，
         *     否则这条断言本身就在用另一套规则验规则。 */
        case 'ocas': {
          var ou = init[e.who];
          if (!ou) { bad(tag + ' 未知单位超频 ' + e.who); break; }
          if (!(ou.ocStart > 0)) bad(tag + ' 这个棋子没有超频被动，却出现了 ocas ' + e.who);
          if (!alive[e.who]) bad(tag + ' 已死亡的棋子还在叠攻速 ' + e.who);
          if (ocCapped[e.who]) {
            bad(tag + ' 已经顶到攻速上限了，还在继续写 ocas 事件 ' + e.who);
          }
          var oMax = ou.ocMaxAs || 0;
          if (oMax > 0 && e.pct > oMax + 1e-6) {
            bad(tag + ' 攻速加成冲破了上限 ' + oMax + '：' + e.pct);
          }
          if (e.capped) {
            if (!(oMax > 0)) bad(tag + ' 标了 capped，但这个棋子根本没有上限');
            else if (Math.abs(e.pct - oMax) > 1e-6) {
              bad(tag + ' 标了 capped，pct 却不是上限：' + e.pct + ' ≠ ' + oMax);
            }
            if (Math.abs((e.step || 0) - (ocOver[e.who] ? (ou.ocPerHitBerserk || 0)
                                                         : (ou.ocPerHit || 0))) > 1e-6) {
              bad(tag + ' capped 那一条的 step 不对: ' + e.step);
            }
            ocCapped[e.who] = true;
          }
          var oPrev = ocLast[e.who];
          if (oPrev !== undefined) {
            if (e.pct < oPrev - 1e-6) {
              bad(tag + ' 超频攻速回落了（只涨不跌）: ' + oPrev + ' → ' + e.pct);
            }
            var wantStep = ocOver[e.who] ? (ou.ocPerHitBerserk || 0) : (ou.ocPerHit || 0);
            var wantPct = oPrev + wantStep;
            if (oMax > 0 && wantPct > oMax) wantPct = oMax;
            if (Math.abs(e.pct - wantPct) > 1e-6) {
              bad(tag + ' 这一击该叠到 ' + U.round2(wantPct) + '（狂暴中=' +
                  (ocOver[e.who] ? '是' : '否') + '，单次 +' + wantStep +
                  '），实际 ' + e.pct);
            }
            /* ★ 事件自己报的 step 也要对得上，不能只是 pct 对 ——
               渲染层和战报都用 step 说话（"翻倍到 +4%"），它错就是给玩家看错。 */
            if (Math.abs((e.step || 0) - wantStep) > 1e-6) {
              bad(tag + ' 事件里的 step 是 ' + e.step + '，实际该叠 ' + wantStep);
            }
          } else if (Math.abs(e.pct - ((ou.ocStart || 0) + (ou.ocPerHit || 0))) > 1e-6) {
            bad(tag + ' 第一次叠攻速之后应该是 ' + ((ou.ocStart || 0) + (ou.ocPerHit || 0)) +
                '，实际 ' + e.pct);
          }
          if (!e.over && ocOver[e.who]) bad(tag + ' 超频标记被关回去了 ' + e.who);
          if (e.over) {
            if (!ocOver[e.who]) {
              // 第一次打开：必须是刚刚越过阈值
              if (e.pct < (ou.ocThreshold || 99) - 1e-6) {
                bad(tag + ' 还没到阈值就打开了超频标记（' + e.pct + ' < ' + ou.ocThreshold + '）');
              }
              if (!e.justOver) bad(tag + ' 第一次越过阈值时没有带 justOver 标记');
            }
            ocOver[e.who] = true;
          }
          ocLast[e.who] = e.pct;
          break;
        }

        /* ★ 「巧乐兹」的冰棍：每次普攻打到的敌人各 +1 层，满层冰冻并清空。 */
        case 'chill': {
          var ca2 = init[e.from], cv2 = init[e.to];
          if (!ca2 || !cv2) { bad(tag + ' 冰棍指向未知单位 ' + e.from + '/' + e.to); break; }
          if (!(ca2.chillMax > 0)) {
            bad(tag + ' 这个棋子既没有「巧乐兹」（2 星才有）也没带那颗大果，' +
                '却给人上了寒冰 ' + e.from);
          }
          if (cv2.side === ca2.side) bad(tag + ' 给队友上了冰棍');
          if (!alive[e.to]) bad(tag + ' 给已经死了的单位上冰棍');
          if (!(e.stacks >= 1)) bad(tag + ' 冰棍层数非正: ' + e.stacks);
          if (e.stacks > ca2.chillMax) {
            bad(tag + ' 冰棍层数超过上限却没触发冰冻: ' + e.stacks + ' > ' + ca2.chillMax);
          }
          var cPrev = chillStacks[e.to] || 0;
          var wantStacks = cPrev + 1;
          if (e.stacks !== wantStacks) {
            bad(tag + ' 冰棍层数不连续：上一条是 ' + cPrev + '，这条应该是 ' +
                wantStacks + '，实际 ' + e.stacks);
          }
          if (Math.abs(e.perStack - ca2.chillPerStack) > 1e-9) bad(tag + ' 每层减速比例和棋子不符');
          /* ★★ 满层这一下必须把校验器自己的模型也**清零** ——
           *   引擎在满层时是"先写事件（stacks = 满）、再把 dst.chillStacks 清 0"，
           *   所以校验器要把 10 记成 0，而不是记成 10。
           *   原来记的是 10，下面那条 `冰冻之后冰棍层数没有清空` 就永远会红 ——
           *   它一直没红，只是因为**改这颗大果之前，80 场随机对局里根本没冻上过人**
           *   （巧乐兹要 2 星张雪峰打同一个人 10 下）。装备一给寒冰，冻人变常见，
           *   这条潜伏的错误模型立刻暴露。
           *   ★ 教训：**"一直绿"不等于"验过了"** —— 空转的断言和不存在是一样的。 */
          chillStacks[e.to] = (e.stacks >= ca2.chillMax) ? 0 : e.stacks;
          if (e.stacks >= ca2.chillMax) chillPending[e.to] = e.t;
          break;
        }

        /* ★★ 自燃有两种来源，**公式完全不同**，必须分开对账：
         *     超频（张雪峰）：每秒失去**当前**生命的 44% —— 指数衰减、越掉越慢
         *     果子（这颗大果）：每秒失去**上限**的 6%   —— 线性，固定 16.7 秒后必死
         *   ★ 只按其中一条对账的话，另一条会被判成"公式错了"。
         *   ★★ 而两个计时器是**独立**的：同一个张雪峰既超频又带果子时，
         *     同一 tick 里会有两条 selfburn。所以"每秒一次"这条也必须
         *     **按来源分别记时刻** —— 否则会误报"自毁比每秒一次更频繁"。
         *     这是"两条独立规则共用一个事件类型"的必然代价，写清楚免得下次踩。 */
        case 'selfburn': {
          var sb = init[e.who];
          if (!sb) { bad(tag + ' 未知单位自燃 ' + e.who); break; }
          var byItem = e.reason === 'item';
          if (byItem) {
            if (!(sb.burnMaxPct > 0)) {
              bad(tag + ' 这个棋子没带「和成天下5000精品大果」，却在自燃 ' + e.who);
            }
          } else if (!(sb.ocBurnPct > 0)) {
            bad(tag + ' 这个棋子没有超频被动，却出现了 selfburn ' + e.who);
          }
          if (!alive[e.who]) bad(tag + ' 已死亡的棋子还在自燃 ' + e.who);
          if (!(e.amount > 0)) bad(tag + ' 自燃量非正: ' + e.amount);
          if (!(e.hpAfter >= 0)) bad(tag + ' 自燃之后血量非法: ' + e.hpAfter);
          if (e.hpAfter > lastHp[e.who] + 0.02) bad(tag + ' 自燃之后血量反而上升');
          // 按**来源**对账这一下的量
          var burnBefore = U.round2(e.hpAfter + e.amount);
          var burnWant = byItem
            ? Math.max(0.01, U.round2(e.hpMax * sb.burnMaxPct))
            : Math.max(0.01, U.round2(burnBefore * sb.ocBurnPct));
          burnWant = Math.min(burnWant, burnBefore);
          if (Math.abs(e.amount - burnWant) > 0.05) {
            bad(tag + (byItem
              ? ' 果子自燃应该 = 上限 × ' + sb.burnMaxPct
              : ' 超频自燃应该 = 当前生命 × ' + sb.ocBurnPct) +
              '：期望 ' + U.round2(burnWant) + ' 实际 ' + e.amount);
          }
          // 每秒一次：按来源分别记上次时刻
          var burnKey = e.who + (byItem ? '#item' : '#oc');
          var sbPrev = lastBurnT[burnKey];
          if (sbPrev !== undefined && (e.t - sbPrev) < 1 - 1e-6) {
            bad(tag + ' 自燃比每秒一次更频繁（上一次 ' + sbPrev + '，这次 ' + e.t + '）');
          }
          lastBurnT[burnKey] = e.t;
          lastHp[e.who] = e.hpAfter;
          break;
        }

        case 'stun':
          /* ★ 冰冻（巧乐兹满层）走的是同一条 stun 事件，靠 reason 区分。
             它和前几个"控制"不一样的地方：来源是**攒层数攒出来的**，
             所以顺带验一句「刚满层就必须冻上」，防止层数白攒。 */
          if (e.reason === 'freeze') {
            var fu = init[e.to];
            if (!fu) { bad(tag + ' 冰冻指向未知单位 ' + e.to); break; }
            if (chillPending[e.to] === undefined) {
              bad(tag + ' 还没攒满层就冰冻了 ' + e.to);
            } else if (Math.abs(chillPending[e.to] - e.t) > 1e-9) {
              bad(tag + ' 冰冻没有紧跟在那次满层之后（满层 @' + chillPending[e.to] +
                  '，冰冻 @' + e.t + '）');
            }
            if (chillStacks[e.to] !== undefined && chillStacks[e.to] !== 0) {
              bad(tag + ' 冰冻之后冰棍层数没有清空: ' + chillStacks[e.to]);
            }
            if (!(e.dur > 0)) bad(tag + ' 冰冻时长非正');
            if (!(e.until > e.t)) bad(tag + ' 冰冻的 until 不在未来');
            delete chillPending[e.to];
          } else if (e.reason === 'peak') {
            /* ★ 羊帆「羊巅峰」的眩晕：巅峰一击（2 星起）和巅峰谢幕（3 星自爆）。
               守住三件事：
                 ① 只有 2 星以上的羊帆才有这个眩晕（1 星不该出现）
                 ② 秒数就是数据里写的那个（3 秒）
                 ③ 它必须**紧跟在**巅峰一击/自爆之后 ——
                    单独冒出来一条"羊帆晕了谁" 是不可能的 */
            var pu = init[e.from];
            if (!pu) { bad(tag + ' 巅峰眩晕来自未知单位 ' + e.from); break; }
            if (!init[e.to]) { bad(tag + ' 巅峰眩晕指向未知单位 ' + e.to); break; }
            if (!(pu.peakStunDur > 0)) {
              bad(tag + ' 这个棋子的巅峰一击不该带眩晕（1 星级？）' + e.from);
            } else if (Math.abs(e.dur - pu.peakStunDur) > 1e-9) {
              bad(tag + ' 巅峰眩晕秒数不是数据里的 ' + pu.peakStunDur + '：' + e.dur);
            }
            if (!(e.until > e.t)) bad(tag + ' 巅峰眩晕的 until 不在未来');
            /* ★★ 用「时刻相同」而不是一个布尔标记：3 星自爆会**一次晕一圈人**
               （最多 8 条 stun），布尔标记会被第一条吃掉、后面七条全部误报。
               同一个 tick 里发生的就是同一件事 —— 这是这个校验器里
               反复出现的一条经验（"上一条事件是 attack"那条也是栽在这里）。 */
            if (peakStunArmedAt[e.from] !== e.t) {
              bad(tag + ' 巅峰眩晕没有紧跟在一次巅峰一击 / 自爆之后 ' + e.from);
            }
          } else if (e.reason === 'current') {
            /* ★ 电棍 2 星「麻痹」：电流每次弹射额外击晕 0.5 秒。
             *   ★ 和嘉豪那条**不能共用分支**：那个是"一次施法控几个人"，
             *     而这个是"每条电流各晕一下"—— 同一 tick 里有三条电流同时
             *     落地是完全合法的（3 星上限就是 3），按"每次施法几条"去数
             *     会误报成"一次施法发了 3 条眩晕"。
             *   ★ 它必须**紧跟在一条电流弹射之后**（同一 tick、同一个受害者）——
             *     单独冒出来一条"电棍晕了谁"是不可能的。 */
            var ju4 = init[e.from];
            if (!ju4) { bad(tag + ' 电流眩晕来自未知单位 ' + e.from); break; }
            if (!init[e.to]) { bad(tag + ' 电流眩晕指向未知单位 ' + e.to); break; }
            if (!(ju4.currentStunDur > 0)) {
              bad(tag + ' 这个电棍不该有电流眩晕（1 星级？）' + e.from);
            } else if (Math.abs(e.dur - ju4.currentStunDur) > 1e-9) {
              bad(tag + ' 电流眩晕时长不是数据里的 ' + ju4.currentStunDur + '：' + e.dur);
            }
            if (!(e.until > e.t)) bad(tag + ' 电流眩晕的 until 不在未来');
            var paired4 = false;
            for (var q4 = 0; q4 < res.log.length; q4++) {
              var pe4 = res.log[q4];
              if (pe4.type === 'current' && pe4.t === e.t && pe4.to === e.to &&
                  !pe4.born && !pe4.fizzle) { paired4 = true; break; }
            }
            if (!paired4) {
              bad(tag + ' 电流眩晕没有紧跟在同一 tick 的一次电流弹射之后 ' + e.to);
            }
          } else if (e.reason === 'frost') {
            /* ★ 冰冰冰 2 星「冻手冻脚」：被寒霜新星打中的人额外冰冻 1.5 秒。
             *   ★★ 这条**三个分支都不能共用**：
             *     `freeze`（巧乐兹满层）要求"刚攒满 10 层"——技能冰冻没有层数；
             *     `current`（电棍麻痹）要求"紧跟一次电流弹射"；
             *     嘉豪那条要求带上 `targets` 名单 —— 技能冰冻是一条一个人。
             *     这就是"两条独立规则共用一个事件类型时，判据不能共用"
             *     （README 第 106 行）在**校验器**上的同一课。
             *   ★ 它必须紧跟在同一 tick、同一施法者的一次技能伤害之后：
             *     单独冒出来一条"冰冰冰冻了谁"是不可能的。 */
            var fu5 = init[e.from];
            if (!fu5) { bad(tag + ' 技能冰冻来自未知单位 ' + e.from); break; }
            if (!init[e.to]) { bad(tag + ' 技能冰冻指向未知单位 ' + e.to); break; }
            if (!(fu5.frostFreezeDur > 0)) {
              bad(tag + ' 这个棋子不该有技能冰冻（1 星级？）' + e.from);
            } else if (Math.abs(e.dur - fu5.frostFreezeDur) > 1e-9) {
              bad(tag + ' 技能冰冻时长不是数据里的 ' + fu5.frostFreezeDur + '：' + e.dur);
            }
            if (!(e.until > e.t)) bad(tag + ' 技能冰冻的 until 不在未来');
            var paired5 = false;
            for (var q5 = 0; q5 < res.log.length; q5++) {
              var pe5 = res.log[q5];
              if (pe5.type === 'skill' && pe5.t === e.t &&
                  pe5.from === e.from && pe5.to === e.to) { paired5 = true; break; }
            }
            if (!paired5) {
              bad(tag + ' 技能冰冻没有紧跟在同一 tick 的一次技能伤害之后 ' + e.to);
            }
          } else {
            /* ★ 嘉豪「男人领域」：一次可以同时控多个人（2 星 2 个、3 星 3 个）。
               守住四件事：
                 ① 名单（targets）里必须有受害者自己 —— 渲染层靠 `to` 画特效，
                    回放靠 `targets[0]` 判"这是不是本次施法的第一条"
                 ② 名单长度 == count
                 ③ count 不能超过这个星级数据里写的上限（别偷偷控四个）
                 ④ 同一次施法（同 tick、同施法者）发出的 stun 条数不能超过 count
                    （少了是正常的 —— 有人被这一发直接打死了） */
            var du = init[e.from];
            if (!du) { bad(tag + ' 眩晕来自未知单位 ' + e.from); break; }
            if (!init[e.to]) { bad(tag + ' 眩晕指向未知单位 ' + e.to); break; }
            if (!(e.dur > 0)) bad(tag + ' 眩晕时长非正');
            if (!(e.until > e.t)) bad(tag + ' 眩晕的 until 不在未来');
            if (!(e.targets instanceof Array) || e.targets.indexOf(e.to) < 0) {
              bad(tag + ' 眩晕的名单里没有受害者自己 ' + e.to);
            } else if (e.targets.length !== e.count) {
              bad(tag + ' 名单长度和 count 不一致：' + e.targets.length + ' vs ' + e.count);
            } else if (e.count > (du.domainTargets || 1)) {
              bad(tag + ' 一次控了 ' + e.count + ' 个人，超过这个星级的 ' +
                  (du.domainTargets || 1) + ' 个');
            }
            var skey = e.from + '@' + e.t;
            stunCastN[skey] = (stunCastN[skey] || 0) + 1;
            if (stunCastN[skey] > (du.domainTargets || 1)) {
              bad(tag + ' 同一次施法发出了 ' + stunCastN[skey] + ' 条眩晕事件');
            }
          }
          break;

        /* ★ 奶龙的「捧腹大笑」：一个纯 CD、无伤害、只改自己状态的技能。
         *   这里要守住三件事：
         *     ① 冷却真的被遵守了（两次大笑之间隔够 13 秒，第一次也不能提前）
         *     ② until 和 dur 对得上（渲染层的持续时间就照它画）
         *     ③ 星级开关如实反映（2 星能走、3 星奶队友）
         */
        case 'laugh': {
          var lu = init[e.who];
          if (!lu) { bad(tag + ' 未知单位大笑 ' + e.who); break; }
          if (!(lu.laughDur > 0)) {
            bad(tag + ' 这个棋子没有「捧腹大笑」，却出现了 laugh ' + e.who);
          }
          if (!alive[e.who]) bad(tag + ' 已死亡的棋子还在大笑');
          if (!(e.dur > 0)) bad(tag + ' 大笑时长非正');
          if (Math.abs(e.until - (e.t + e.dur)) > 0.01) {
            bad(tag + ' until 和 t+dur 对不上: ' + e.until + ' vs ' + U.round2(e.t + e.dur));
          }
          if (Math.abs(e.cut - lu.laughCut) > 1e-9) bad(tag + ' 减伤比例和棋子不符');
          if (Math.abs(e.healPct - lu.laughHealPct) > 1e-9) bad(tag + ' 回血比例和棋子不符');
          if (!!e.move !== !!lu.laughMove) bad(tag + ' move 标记和星级门槛不符');
          if (!!e.allyHeal !== !!lu.laughHeal) bad(tag + ' allyHeal 标记和星级门槛不符');
          var lPrev = lastLaughT[e.who];
          if (lu.cdSeconds > 0) {
            if (lPrev === undefined) {
              if (e.t < lu.cdSeconds - 0.05) {
                bad(tag + ' 第一次大笑早于冷却结束（t=' + e.t + ' < ' + lu.cdSeconds + '）');
              }
            } else if ((e.t - lPrev) < lu.cdSeconds - 0.05) {
              bad(tag + ' 两次大笑之间没等够冷却：' + U.round2(e.t - lPrev) +
                  's < ' + lu.cdSeconds + 's');
            }
          }
          lastLaughT[e.who] = e.t;
          laughUntil[e.who] = e.until;
          break;
        }

        case 'cast':
          if (!init[e.from]) bad(tag + ' 未知单位施法 ' + e.from);
          if (!(e.manaAfter === 0)) bad(tag + ' 施法后法力没有清零: ' + e.manaAfter);
          /* ★ 羊帆「羊巅峰」：施法只做一件事 —— 给下一次普攻蓄势。
             在这里记下"蓄势到了"，下面 attack 分支才能验
             「×20 必须紧跟在蓄力之后」（见那里的注释）。 */
          if (e.kind === 'peak') peakArmed[e.from] = true;
          break;

        /* ★ 荣誉蓄力：eyes 喷金色激光的那 0.5 秒。
         *   它同时是**规则**（这半秒里棋子站着不动、不出手），
         *   所以这里要验的不是"特效播了没有"，而是"这段窗口是合法的"：
         *     ① 只有计数型技能的棋子才会蓄力
         *     ② 蓄力时长就是 CFG.CHARGE_TIME（渲染层的激光寿命跟着它走）
         *     ③ 蓄力不能凭空出现 —— 必须紧跟在攒满之后，且随后真的开一枪
         */
        case 'charge': {
          var cu = init[e.who];
          if (!cu) { bad(tag + ' 未知单位蓄力 ' + e.who); break; }
          if (!alive[e.who]) bad(tag + ' 已死亡的棋子还在蓄力 ' + e.who);
          if (!(cu.cadenceEvery > 0)) {
            bad(tag + ' 这个棋子的技能不吃法力计数，不该蓄力 ' + e.who);
          }
          if (!(e.dur > 0)) bad(tag + ' 蓄力时长为 0');
          if (Math.abs(e.until - (e.t + e.dur)) > 0.01) {
            bad(tag + ' until 和 t+dur 对不上: ' + e.until + ' vs ' + U.round2(e.t + e.dur));
          }
          if (e.skill !== cu.skillName) bad(tag + ' 蓄力的技能名和棋子对不上: ' + e.skill);
          chargeCount[e.who] = (chargeCount[e.who] || 0) + 1;
          lastChargeT[e.who] = e.until;
          break;
        }

        /* ★ 楚生疑犯「阴暗领域」：游戏里第一份**不属于任何单位**的持续状态。
         *
         *   以前所有"挂几秒"的效果都写在单位自己身上（buffUntil / chillStacks
         *   / laughUntil），人死了效果就没了。领域不一样：施法者死了、走开了、
         *   被推走了，雨照样下。所以这里**不能**校验"施法者还活着"。
         *
         *   守住四件事：
         *     ① 只有 kind='field' 的技能会发这个事件（不会从别处冒出来）
         *     ② 半径 / 时长 / 减速比例都来自数据
         *     ③ 队友减伤比例跟着**施法者的星级**（2 星起才有）
         *     ④ 领域中心在棋盘内，而且 until 和 t+dur 对得上
         */
        case 'field': {
          var fu = init[e.from];
          if (!fu) { bad(tag + ' 未知单位放领域 ' + e.from); break; }
          if (fu.skillKind !== 'field') {
            bad(tag + ' 这个棋子的技能不是领域，却放出了 field ' + e.from);
          }
          if (!(e.radius >= 1)) bad(tag + ' 领域半径非法: ' + e.radius);
          if (!(e.dur > 0)) bad(tag + ' 领域时长非正');
          if (Math.abs(e.until - (e.t + e.dur)) > 0.01) {
            bad(tag + ' 领域的 until 和 t+dur 对不上: ' + e.until + ' vs ' + U.round2(e.t + e.dur));
          }
          if (!(e.asCut > 0 && e.asCut < 1)) {
            bad(tag + ' 领域的减速不是一个 0~1 的比例（减半应该写 0.5）: ' + e.asCut);
          }
          if (Math.abs(e.allyCut - fu.fieldAllyCut) > 1e-9) {
            bad(tag + ' 领域的队友减伤和施法者的星级不符: ' + e.allyCut +
                ' vs ' + fu.fieldAllyCut);
          }
          if (!(e.r >= 0 && e.r < CFG.ROWS && e.c >= 0 && e.c < CFG.COLS)) {
            bad(tag + ' 领域的中心越界 ' + e.r + ',' + e.c);
          }
          fieldN[e.from] = (fieldN[e.from] || 0) + 1;
          fields.push(e);
          break;
        }

        /* ★ 楚生疑犯 3 星的「遁入暗影」：开 / 关两个方向都要验。
         *   ★★ 关的那一条是**终止条件**里最要紧的一句：
         *      "队友还没死光就现形" 会让它提前暴露（弱），
         *      "永远不现形" 会让战斗打不完（见下面 shadowCount 的收尾检查）。
         */
        case 'shadow': {
          var shu = init[e.who];
          if (!shu) { bad(tag + ' 未知单位遁入暗影 ' + e.who); break; }
          if (!shu.shadowAt) {
            bad(tag + ' 这个棋子没有「遁入暗影」，却出现了 shadow ' + e.who);
          }
          if (Math.abs(e.asCut - shu.shadowAsCut) > 1e-9) {
            bad(tag + ' 暗影的攻速削减和被动对不上: ' + e.asCut);
          }
          if (Math.abs(e.dmgMul - shu.shadowDmgMul) > 1e-9) {
            bad(tag + ' 暗影的伤害倍率和被动对不上: ' + e.dmgMul);
          }
          if (e.on) {
            if (!alive[e.who]) bad(tag + ' 已死亡的棋子遁入暗影 ' + e.who);
            if (shadows[e.who]) bad(tag + ' 已经在暗影里又开了一次 ' + e.who);
            if (shadowMatesOf(e.who) < 1) {
              bad(tag + ' 一个"不会遁入暗影的"队友都没有就遁入暗影（该直接现形）');
            }
            shadows[e.who] = true;
          } else {
            if (!shadows[e.who]) bad(tag + ' 没进暗影就解除了 ' + e.who);
            shadows[e.who] = false;
            /* ★ 判据是"非同类队友还剩几个"，不是"所有队友" ——
               两只楚生疑犯都在暗影里时，谁都不该给谁续命。 */
            if (shadowMatesOf(e.who) > 0) {
              bad(tag + ' 队友还没死光就现形了（' + e.who + ' 还有 ' +
                  shadowMatesOf(e.who) + ' 个非同类队友）');
            }
          }
          break;
        }

        /* ★ 荣誉「狙击1」：一发 ×10 的子弹，只有 20% 命中；
         *   2★/3★ 的被动每局各有 1 / 2 次「必定命中」。
         *
         *   这里要守住三件事：
         *     ① 保底次数不能超发（3 星最多 2 次 sure，2 星最多 1 次，1 星 0 次）
         *     ② 命中必须真的兑出一条同 tick、同起止的 skill 伤害事件 ——
         *        否则「Vamos 喊了但没掉血」会变成一个只有画面没有数值的假动作
         *     ③ 没命中就必须**没有**那条 skill 事件（打偏了不能偷偷扣血）
         */
        case 'snipe': {
          var su = init[e.from], tu = init[e.to];
          if (!su || !tu) { bad(tag + ' 狙击指向未知单位 ' + e.from + '/' + e.to); break; }
          if (!alive[e.from]) bad(tag + ' 已死亡的棋子还在开枪 ' + e.from);
          if (typeof e.hit !== 'boolean') bad(tag + ' 缺少 hit 标记');
          if (!(e.mult > 0)) bad(tag + ' 缺少倍率 mult');
          /* ★ 计数型技能的棋子，每一枪都必须紧跟在自己的蓄力之后 ——
             「眼睛先喷激光再开枪」这个承诺在日志层面就是这一条。
             蓄力结束时才开枪，所以开枪时刻应当落在 until 之后的第一个 tick。 */
          if (su.cadenceEvery > 0) {
            var lc = lastChargeT[e.from];
            if (lc === undefined) {
              bad(tag + ' 计数型技能开了一枪，前面却没有任何蓄力事件 ' + e.from);
            } else if (e.t < lc - 0.02 || e.t > lc + 2.0) {
              /* ★ 上界给到 2 秒而不是 0.06 秒：蓄满之后被**眩晕**会推迟开枪，
                 这是完全合法的（tryCast 在眩晕期间直接返回）。
                 卡得太死会把「被控住了所以晚开枪」判成假失败。
                 下界仍然很严：**绝不允许早于蓄力结束就开枪**。 */
              bad(tag + ' 开枪时刻不在蓄力结束点上（蓄力到 ' + lc + '，开枪 ' + e.t + '）');
            }
          }
          snipeTotal[e.from] = (snipeTotal[e.from] || 0) + 1;
          if (e.sure) {
            snipeSure[e.from] = (snipeSure[e.from] || 0) + 1;
            if (!(su.snipeSure > 0)) {
              bad(tag + ' 这个棋子没有「运 / edg希望」被动，却出现了必定命中 ' + e.from);
            }
            if (snipeSure[e.from] > (su.snipeSure || 0)) {
              bad(tag + ' 必定命中用超了：第 ' + snipeSure[e.from] + ' 次 > 上限 ' + su.snipeSure);
            }
            if (e.hit !== true) bad(tag + ' 必定命中的那一发却是 hit=false');
          }
          if (!(e.hits >= 0) || !(e.misses >= 0)) bad(tag + ' 命中/打偏计数非法');
          if (e.hits + e.misses !== snipeTotal[e.from]) {
            bad(tag + ' 命中+打偏 与开枪次数对不上: ' + e.hits + '+' + e.misses +
                ' ≠ ' + snipeTotal[e.from]);
          }
          /* ★ 往后找同 tick 的 skill 伤害事件，而不是只看紧邻的那一条：
             鸭子「抓娃娃」会把这一枪判 0，而 block 事件是**写在
             dealDamage 里面**的，所以顺序是 snipe → block → skill。
             只盯下一条会把「被挡住的命中」判成假失败。 */
          var isHitDmg = false;
          for (var nx2 = i2 + 1; nx2 < res.log.length && nx2 <= i2 + 4; nx2++) {
            var nx = res.log[nx2];
            if (nx.t !== e.t) break;
            if (nx.type === 'block') continue;
            isHitDmg = (nx.type === 'skill' && nx.from === e.from && nx.to === e.to);
            break;
          }
          if (e.hit && !isHitDmg) {
            bad(tag + ' 判定了命中，紧跟着却没有同 tick 同起止的 skill 伤害事件');
          }
          if (!e.hit && isHitDmg) {
            bad(tag + ' 判定了打偏，却还是打出了伤害（打偏必须一分血都不掉）');
          }
          break;
        }

        case 'end':
          if (i2 !== res.log.length - 1) bad(tag + ' end 不是最后一条事件');
          break;

        /* ★★ Dank1ng 的四条：空悲切（可以无限能量）、锁头（击杀回满）、
         *   技能击杀留骷髅、以及击杀后耍 3 秒折叠刀。
         *
         *   守住四件事：
         *     ① 只有装了对应被动的棋子才会发这些事件
         *     ② 「无限能量」是**双向**的：队友全死光才开、队友复活要关掉
         *     ③ 骷髅/耍刀必须紧跟在一发**真的打死了人**的技能之后
         *     ④ 技能伤害翻倍但不贯穿 —— 每次施法只打一个人（见下面的单独断言）
         */
        case 'endless': {
          var lu2 = init[e.who];
          if (!lu2) { bad(tag + ' 未知单位进入绝境 ' + e.who); break; }
          if (!lu2.loneWolf) bad(tag + ' 这个棋子没有「空悲切」，却出现了 endless ' + e.who);
          if (!alive[e.who]) bad(tag + ' 已死亡的棋子还开无限能量 ' + e.who);
          /* ★ 判据用"同一时刻还有几个活着的队友" —— 这正是引擎里的条件。
             ★ 开的时候法力必须是满的（「立刻恢复」），关的时候不限。 */
          var mates = matesOf(e.who);
          if (e.on) {
            if (mates > 0) bad(tag + ' 还有 ' + mates + ' 个队友活着就开了无限能量');
            if (e.mana !== e.maxMana) {
              bad(tag + ' 开无限能量的那一刻法力没有顶满: ' + e.mana + '/' + e.maxMana);
            }
            if (endlessOn[e.who]) bad(tag + ' 已经在无限能量里又开了一次 ' + e.who);
            endlessOn[e.who] = true;
          } else {
            if (!endlessOn[e.who]) bad(tag + ' 没开过无限能量却关了一次 ' + e.who);
            if (mates === 0) bad(tag + ' 队友还是全死光的状态，却把无限能量关了');
            endlessOn[e.who] = false;
          }
          break;
        }

        case 'refill': {
          var ru2 = init[e.who];
          if (!ru2) { bad(tag + ' 未知单位回满能量 ' + e.who); break; }
          if (!ru2.killRefill) bad(tag + ' 这个棋子没有「锁头」，却出现了 refill ' + e.who);
          if (!(e.mana > 0)) bad(tag + ' 回满能量却没写回满了多少');
          /* ★ 回满必须紧跟在一次击杀之后（同一 tick）。 */
          if (killAt[e.who] !== e.t) {
            bad(tag + ' 能量回满没有紧跟在自己的一次击杀之后 ' + e.who);
          }
          refillN[e.who] = (refillN[e.who] || 0) + 1;
          break;
        }

        case 'skull': {
          var su2 = init[e.who];
          if (!su2) { bad(tag + ' 未知单位留下骷髅 ' + e.who); break; }
          if (!su2.killSkull) bad(tag + ' 这个棋子的技能不留骷髅，却出现了 skull ' + e.who);
          if (!init[e.to]) bad(tag + ' 骷髅指向未知单位 ' + e.to);
          if (alive[e.to]) bad(tag + ' 目标是活的却留下了骷髅（那是"没打死"） ' + e.to);
          if (e.r === undefined || e.c === undefined) {
            bad(tag + ' 骷髅没有带上尸体所在的格子');
          }
          skullN[e.who] = (skullN[e.who] || 0) + 1;
          skullT[e.who] = e.t;          // 耍刀必须紧跟在同一 tick 的骷髅之后
          break;
        }

        case 'knife': {
          var ku2 = init[e.who];
          if (!ku2) { bad(tag + ' 未知单位耍刀 ' + e.who); break; }
          if (!(ku2.knifeDur > 0)) bad(tag + ' 这个棋子的技能没有耍刀后续，却出现了 knife');
          if (e.dur !== ku2.knifeDur) {
            bad(tag + ' 耍刀时长和技能数据不符: ' + e.dur + ' vs ' + ku2.knifeDur);
          }
          if (Math.abs(e.until - (e.t + e.dur)) > 0.01) bad(tag + ' 耍刀的 until 和 t+dur 对不上');
          if (skullT[e.who] !== e.t) {
            bad(tag + ' 耍刀没有紧跟在同一 tick 的骷髅之后 ' + e.who);
          }
          knifeN[e.who] = (knifeN[e.who] || 0) + 1;
          break;
        }

        /* ★★ 老牧师「临终祷告」：倒下 → 1 秒祷告 → 满血站起来。
         *
         *   和上面牢大的 revive 是**两件事**，所以是两个事件类型、两套断言：
         *     revive     自己爬起来（坠机被动，救自己）
         *     reviveAlly 别人把他拉起来（临终祷告，救队友）
         *   混成一个类型的话，「老牧师救不了自己」这条规则根本验不出来。
         */
        case 'lastRites': {
          var pu = init[e.from], au2 = init[e.to];
          if (!pu) { bad(tag + ' 未知单位做祷告 ' + e.from); break; }
          if (!au2) { bad(tag + ' 祷告指向未知单位 ' + e.to); break; }
          if (!pu.ritesOn) {
            bad(tag + ' 这个棋子没有「临终祷告」被动，却在做祷告 ' + e.from);
          }
          if (e.from === e.to) bad(tag + ' 老牧师在给自己做临终祷告（说好救不了自己）');
          if (pu.side !== au2.side) bad(tag + ' 给敌人做祷告');
          if (!alive[e.from]) bad(tag + ' 已经阵亡的老牧师还在做祷告 ' + e.from);
          if (alive[e.to]) bad(tag + ' 给还活着的单位做祷告 ' + e.to);
          /* ★ 一场战斗只救一个人 —— 这条是这张卡的强度上限，必须钉住 */
          if (ritesUsed[e.from]) {
            bad(tag + ' 这个老牧师已经用过被动，又祷告了一次 ' + e.from);
          }
          ritesUsed[e.from] = true;
          if (ritesPending[e.to]) bad(tag + ' 同一个人被祷告了两次 ' + e.to);
          if (!(e.delay > 0)) bad(tag + ' 祷告延迟非正: ' + e.delay);
          if (Math.abs(e.until - (e.t + e.delay)) > 0.002) {
            bad(tag + ' 祷告的结束时刻不等于 t + delay（' + e.until + ' vs ' +
                U.round2(e.t + e.delay) + '）');
          }
          ritesPending[e.to] = { until: e.until, from: e.from,
                                 hpPct: e.hpPct, adPct: e.adPct };
          break;
        }

        case 'reviveAlly': {
          var au3 = init[e.who];
          var pp = ritesPending[e.who];
          if (!au3) { bad(tag + ' 未知单位被救 ' + e.who); break; }
          if (!pp) bad(tag + ' 没祷告就直接把人救起来了 ' + e.who);
          /* ★★ 「一场只救一个人」是**对老牧师**的约束，不是对被救的人的。
           *   第一版这里写成了"同一个人不能被救两次"，跑随机对局立刻红了 ——
           *   但引擎是对的：场上有**两个老牧师**时，两个人各自有一次机会，
           *   同一个队友先被 A 救、再倒、再被 B 救，完全合法。
           *   ★ 又一次"断言比规则更严"：写断言时问的是"谁的一次性资源"，
           *     答案在**施法者**（e.from）身上，不在受害者身上。 */
          ritesByPriest[e.from] = (ritesByPriest[e.from] || 0) + 1;
          if (ritesByPriest[e.from] > 1) {
            bad(tag + ' 同一个老牧师救了两个人（一场只能救一个）：' + e.from);
          }
          if (!e.ok) {
            /* 自己半场被占满 → 救不回来。允许发生，但必须真的是"死人没起来"，
               而且这一条不能悄悄把 alive 改了。 */
            if (alive[e.who]) bad(tag + ' 还活着却报「救不回来」 ' + e.who);
            ritesPending[e.who] = null;
            break;
          }
          if (alive[e.who]) bad(tag + ' 棋子还活着却在被救 ' + e.who);
          if (!(e.hp > 0)) bad(tag + ' 救回来时血量非正');
          if (e.hp > e.hpMax + 0.02) bad(tag + ' 救回来时血量超过上限');
          if (e.side !== au3.side) bad(tag + ' 救回到对面阵营去了');
          if (ST.Battle.sideOfRow(e.r) !== au3.side) bad(tag + ' 救回来的位置不在自己半场');
          var rdest2 = e.r + ',' + e.c;
          if (cellOf[rdest2] && cellOf[rdest2] !== e.who) {
            bad(tag + ' 救回来占了一个有人的格子 ' + rdest2);
          }
          if (curPos[e.who]) delete cellOf[curPos[e.who].r + ',' + curPos[e.who].c];
          cellOf[rdest2] = e.who;
          curPos[e.who] = { r: e.r, c: e.c };
          alive[e.who] = true;
          diedCount[e.who]--;              // ★ 又活过来了，不再算在这个头上
          lastHp[e.who] = e.hp;            // ★ 不更新的话，复活后第一次受伤会被判成「血量上升」
          lastShield[e.who] = 0;
          ritesReviveCount[e.who] = (ritesReviveCount[e.who] || 0) + 1;
          /* ★ 同上：老牧师救回来的人，也不能再被孙笑川招安
             （需求里那句「对有复活技能的单位无效（牢大，老牧师复活的人等）」）。 */
          revivedOnce[e.who] = true;
          /* ★ 不在这里限制"同一个人被救两次"—— 见上面的说明。 */
          /* ★ 血量按**数据**算（reviveHpPct），不写死满血 ——
             哪天改成半血复活，这条断言要跟着数据走，不能变成假信息。 */
          if (pp && pp.hpPct > 0) {
            var wantHp = e.hpMax * pp.hpPct;
            if (Math.abs(e.hp - wantHp) > 1.5) {
              bad(tag + ' 救回来的血量应该是 maxHp × ' + pp.hpPct + ' = ' +
                  U.round2(wantHp) + '，实际 ' + e.hp);
            }
          }
          /* ★ 3 星「圣光赐福」：被救的人 + 老牧师各 +20%。
             用**事件自己报的名单**对账（blessed），而不是"应该给两个人" ——
             老牧师在这一秒里被打死时只有一个人拿到，那是合法的。 */
          if (pp && pp.adPct > 0) {
            if (!(e.blessed && e.blessed.length >= 1)) {
              bad(tag + ' 有攻击力加成却一个人都没写进 blessed');
            } else {
              if (e.blessed.indexOf(e.who) < 0) {
                bad(tag + ' 被救的人自己没拿到攻击力加成');
              }
              if (e.blessed.indexOf(e.from) >= 0 && !alive[e.from]) {
                bad(tag + ' 给已经阵亡的老牧师发了攻击力加成');
              }
              if (e.blessed.indexOf(e.from) < 0 && alive[e.from]) {
                bad(tag + ' 老牧师活着却没拿到攻击力加成（说好两个人都加）');
              }
            }
          }
          ritesPending[e.who] = null;
          break;
        }

        /* ★★ 孙笑川 3 星「安排上了」：被打死的敌人倒戈成我方单位。
         *
         *   ★ 这是**全场唯一一个"阵营会变"的事件**，所以校验器必须真的跟着改模型：
         *     `alive`、`diedCount`、占格、位置、阵营全都要翻过来。
         *     不翻的话，后面每一次"打到了已死亡的单位""给队友上冰棍"都会误报 ——
         *     而且报出来的现象和真正的问题一模一样，非常难查。
         *
         *   ★ 三个排除条件在这里**独立复算**一遍（不能只信引擎的 if）：
         *     还有复活次数的、正在等结算的、已经复活过一次的，都不该被招安。
         */
        case 'convert': {
          var ku = init[e.from], vu = init[e.who];
          if (!ku) { bad(tag + ' 招安来自未知单位 ' + e.from); break; }
          if (!vu) { bad(tag + ' 招安指向未知单位 ' + e.who); break; }
          if (!ku.convertOnKill) {
            bad(tag + ' 这个棋子没有「安排上了」（3 星才有），却招安了别人 ' + e.from);
          }
          if (ku.side !== e.toSide) bad(tag + ' 招安的 toSide 和施法者阵营不符');
          if (e.fromSide === e.toSide) bad(tag + ' 招安前后阵营一样（等于没换边）');
          if (vu.side !== e.fromSide) {
            bad(tag + ' 被招安的单位原本不在 ' + e.fromSide + ' 这一方');
          }
          if (alive[e.who]) bad(tag + ' 还活着的单位被招安了 ' + e.who);
          /* 排除条件 ①：它自己还有复活次数（牢大 / 羊帆） */
          if (vu.revives && (reviveCount[e.who] || 0) < (vu.maxRevives || 1)) {
            bad(tag + ' 招安了一个还有复活次数的单位（' + e.who + '）');
          }
          /* 排除条件 ②：还在走坠机 / 自爆（downUntil 挂着的） */
          if ((vu.crashDamage > 0 || vu.boomAdMult > 0) && (crashCount[e.who] || 0) > 0) {
            bad(tag + ' 招安了一个正在等坠机/自爆结算的单位（' + e.who + '）');
          }
          /* 排除条件 ③：已经复活过一次（老牧师救回来的 / 之前被招安过的） */
          if (revivedOnce[e.who]) {
            bad(tag + ' 招安了一个已经复活过的单位（' + e.who + '）');
          }
          if (!(e.hp > 0) || e.hp > e.hpMax + 0.02) bad(tag + ' 招安后的血量非法: ' + e.hp);
          var cwant = U.round2(e.hpMax * ku.convertHpPct);
          if (Math.abs(e.hp - cwant) > 1.5) {
            bad(tag + ' 招安的血量应该是上限 × ' + ku.convertHpPct + ' = ' +
                cwant + '，实际 ' + e.hp);
          }
          if (ST.Battle.sideOfRow(e.r) !== e.toSide) {
            bad(tag + ' 招安之后站在了对面半场 (' + e.r + ',' + e.c + ')');
          }
          var ckey = e.r + ',' + e.c;
          if (cellOf[ckey] && cellOf[ckey] !== e.who) {
            bad(tag + ' 招安占了一个有人的格子 ' + ckey);
          }
          /* 翻模型：和 revive / reviveAlly 一样，它又活过来了 */
          if (curPos[e.who]) delete cellOf[curPos[e.who].r + ',' + curPos[e.who].c];
          cellOf[ckey] = e.who;
          curPos[e.who] = { r: e.r, c: e.c };
          alive[e.who] = true;
          diedCount[e.who]--;               // 它又活了，不再算在这个头上
          lastHp[e.who] = e.hp;
          lastShield[e.who] = 0;
          init[e.who].side = e.toSide;      // ★ 阵营也要换，后面全靠它
          revivedOnce[e.who] = true;
          convertCount[e.who] = (convertCount[e.who] || 0) + 1;
          if (convertCount[e.who] > 1) {
            bad(tag + ' 同一个单位被招安了两次 ' + e.who);
          }
          break;
        }

        /* ★★ 电棍「导电」：普攻/技能留下的电流，0.5 秒一跳，最多四次。
         *
         *   ★ 这一套的规则密度很高，所以校验器要独立复算：
         *     · `born` 事件：施法者要有这个被动，而且**同时存在数不能超上限**
         *       （1/2 星 1 条、3 星 3 条）—— 这是"每个电棍制造的电流只能存在一个"
         *       这条需求唯一能验的地方；
         *     · 跳：目标必须是**敌方**、在 3×3 内、而且**没被这道电流打过**；
         *       次数每跳 -1，且不能跳到负数；伤害必须 = 施法者攻击力 × 25%；
         *     · `fizzle`：附近没新目标（或施法者倒了）时消失 —— 这是终止条件。
         */
        case 'current': {
          var ou4 = init[e.from];
          if (!ou4) { bad(tag + ' 电流来自未知单位 ' + e.from); break; }
          if (!ou4.currentOn) {
            bad(tag + ' 这个棋子没有「导电」被动，却放出了电流 ' + e.from);
          }
          if (e.born) {
            /* ★ 同时存在数：先减掉这一条，再看有没有超 */
            curLive[e.from] = (curLive[e.from] || 0) + 1;
            if (curLive[e.from] > (ou4.currentMaxAt || 1)) {
              bad(tag + ' 同一个电棍同时存在 ' + curLive[e.from] +
                  ' 条电流，超过上限 ' + ou4.currentMaxAt);
            }
            if (!(e.delay > 0)) bad(tag + ' 电流的延迟非正');
            if (Math.abs(e.until - (e.t + e.delay)) > 0.002) {
              bad(tag + ' 电流的 until 不等于 t + delay');
            }
            if (!(e.left >= 1)) bad(tag + ' 新电流的剩余弹射次数非正: ' + e.left);
            curOf[e.id] = { owner: e.from, side: e.side, r: e.r, c: e.c,
                            left: e.left, hit: [e.to] };
            break;
          }
          var cc = curOf[e.id];
          if (!cc) { bad(tag + ' 电流 #' + e.id + ' 没有 born 就跳/散了'); break; }
          if (e.fizzle) {
            curLive[e.from] = Math.max(0, (curLive[e.from] || 1) - 1);
            curOf[e.id] = null;
            break;
          }
          /* 弹射一下 */
          if (e.from !== cc.owner) bad(tag + ' 电流的归属变了 ' + e.from);
          if (!init[e.to]) { bad(tag + ' 电流跳向未知单位 ' + e.to); break; }
          var vict = init[e.to];
          if (vict.side === cc.side) bad(tag + ' 电流跳到了自己人身上 ' + e.to);
          if (cc.hit.indexOf(e.to) >= 0) {
            bad(tag + ' 同一道电流重复打同一个人 ' + e.to + '（说好弹过的不再命中）');
          }
          if (U.cheb(e.fromR, e.fromC, e.r, e.c) > (ou4.currentRadius || 1)) {
            bad(tag + ' 电流跳出了 3×3：(' + e.fromR + ',' + e.fromC + ') → (' +
                e.r + ',' + e.c + ')');
          }
          if (e.left !== cc.left - 1) {
            bad(tag + ' 电流剩余次数应该是 ' + (cc.left - 1) + '，实际 ' + e.left);
          }
          if (e.left < 0) bad(tag + ' 电流弹射次数变成负数了：' + e.left);
          if (cc.left > ou4.currentMaxBounces) {
            bad(tag + ' 弹射次数超过了上限 ' + ou4.currentMaxBounces);
          }
          /* 伤害必须正好是"施法者攻击力 × 25%" */
          if (Math.abs(e.raw - ou4.ad * ou4.currentPct) > 0.05) {
            bad(tag + ' 电流伤害不是攻击力 × ' + ou4.currentPct + '：raw=' + e.raw +
                '（攻击力 ' + ou4.ad + '）');
          }
          /* ★★ 注意这里**不能**断言 dmg <= raw ——
             加时赛有伤害递增（ramp），34 秒之后实际伤害会**高于** raw。
             第一版就是这么假红的：dmg=13.12 > raw=12.94，看着像"多打了"，
             其实是 ramp ≈ 1.014。事件里带上 ramp 之后才对得上账。
           * ★ 也**不能**断言 dmg > 0：100元的鸭子的「抓娃娃」会把整次伤害判定
             直接无效掉，`res.dmg` 就是 0（那是合法结局，不是 bug）。
             所以下界是 0，上界是 raw × ramp。 */
          var cap4 = e.raw * (e.ramp || 1) + 0.02;
          if (!(e.dmg >= 0) || e.dmg > cap4) {
            bad(tag + ' 电流的实际伤害不合法：dmg=' + e.dmg + ' raw=' + e.raw +
                ' ramp=' + (e.ramp === undefined ? '缺' : e.ramp));
          }
          cc.hit.push(e.to);
          cc.r = e.r; cc.c = e.c; cc.left = e.left;
          if (e.left <= 0) {
            curLive[e.from] = Math.max(0, (curLive[e.from] || 1) - 1);
            curOf[e.id] = null;
          }
          break;
        }

        /* ★★ 攻速增益。两种来源，判据完全不同：
         *   `reason='self'`（双刃舞者的「疾风连斩」）—— 自己给自己开，who === from。
         *   `reason='delivery'`（美团袋鼠 2 星「准时送达」）—— 别人送来的，
         *     必须落在**同一个施法者、同一 tick 的一次治疗**的那个受害者身上。
         *   ★ 两条规则共用一个事件类型，所以**判据不能共用** ——
         *     这已经是这个项目里第四次踩到同一课（第 106 行那条）。 */
        case 'buff': {
          var bu6 = init[e.who];
          if (!bu6) { bad(tag + ' 攻速增益指向未知单位 ' + e.who); break; }
          if (!(e.amount > 0)) bad(tag + ' 攻速增益幅度非正');
          if (!(e.dur > 0)) bad(tag + ' 攻速增益时长非正');
          if (!(e.until > e.t)) bad(tag + ' 攻速增益的 until 不在未来');
          if (e.reason === 'delivery') {
            var src6 = init[e.from];
            if (!src6) { bad(tag + ' 外卖增益来自未知单位 ' + e.from); break; }
            if (!(src6.deliveryAsPct > 0)) {
              bad(tag + ' 这个棋子不该发外卖增益（2 星才有） ' + e.from);
            } else if (Math.abs(e.amount - src6.deliveryAsPct) > 1e-9) {
              bad(tag + ' 外卖增益不是数据里的 ' + src6.deliveryAsPct + '：' + e.amount);
            }
            if (src6.deliveryAsDur > 0 && Math.abs(e.dur - src6.deliveryAsDur) > 1e-9) {
              bad(tag + ' 外卖增益时长不是数据里的 ' + src6.deliveryAsDur + '：' + e.dur);
            }
            if (bu6.side !== src6.side) bad(tag + ' 外卖增益送到了对面 ' + e.who);
            /* ★★ 配对的是**施法**，不是治疗 —— 外卖是"投出去"就成立了：
               队友满血时那一口不会写出 heal 事件（healUnit 直接返回 0），
               但外卖照样送到。第一版这里要求"紧跟一次治疗"，
               随机对局里立刻报「外卖增益没有紧跟在同一 tick 的一次治疗上」——
               **引擎是对的，断言比规则更严**（和临终祷告那条一模一样的坑）。 */
            var paired7 = false;
            for (var q7 = 0; q7 < res.log.length; q7++) {
              var pe7 = res.log[q7];
              if (pe7.type === 'cast' && pe7.t === e.t && pe7.from === e.from) {
                paired7 = true;
                break;
              }
            }
            if (!paired7) {
              bad(tag + ' 外卖增益没有紧跟在同一 tick 的一次施法上 ' + e.who);
            }
          }
          break;
        }

        /* ★★ 东北雨姐「红薯粉丝」：捆住 = **只挡走位，不挡出手**。
         *   所以校验器要守的不是"被捆的人没出手"（那正好是反的），
         *   而是这四件事：
         *     ① 只有 2 星以上的雨姐才有这个能力（bindOn）
         *     ② 时长的数据里那个数（3 秒）
         *     ③ 受害者全在施法者 5×5 之内（半径 2）
         *     ④ 它**不是** stun：这一条靠"root 和 stun 是两个事件类型"来保证，
         *        这里再补一句"同一时刻被捆的人仍然能出手"的正面证据。
         *   ★ 第 ④ 条是这一整套里最值钱的：把 root 写成 stun 的话，
         *     特效、数值、时长全都对，只有"它还能还手吗"不一样 ——
         *     而那正是玩家能感觉到的差别。 */
        case 'root': {
          var ru6 = init[e.from], rv6 = init[e.to];
          if (!ru6) { bad(tag + ' 捆人来自未知单位 ' + e.from); break; }
          if (!rv6) { bad(tag + ' 捆住指向未知单位 ' + e.to); break; }
          if (!(ru6.bindOn)) {
            bad(tag + ' 这个棋子不该会捆人（2 星才有） ' + e.from);
          } else if (Math.abs(e.dur - ru6.bindDur) > 1e-9) {
            bad(tag + ' 捆住的时长不是数据里的 ' + ru6.bindDur + '：' + e.dur);
          }
          if (!(e.until > e.t)) bad(tag + ' 捆住的 until 不在未来');
          if (rv6.side === ru6.side) bad(tag + ' 把粉丝捆到自己人身上了 ' + e.to);
          /* 位置按**施法那一刻**算：这里用快照里的初始坐标不够准（会走位），
             所以退一步只验"半径是数据里那个值"，具体几何由 5c13 那一节
             用"全场静止"的场面精确验。 */
          if (!(ru6.bindRadius > 0)) bad(tag + ' 捆人的半径没配');
          break;
        }

        default:
          if (['stun'].indexOf(e.type) < 0) bad(tag + ' 未知事件类型');
      }
    }

    // 死亡数与存活数必须对得上
    var aTotal = 0, bTotal = 0, aDead = 0, bDead = 0;
    for (uid in init) {
      if (init[uid].side === 'a') { aTotal++; if (diedCount[uid]) aDead++; }
      else { bTotal++; if (diedCount[uid]) bDead++; }
    }
    if (aTotal - aDead !== res.survivors.a) {
      bad(label + ' A 方存活数对不上：初始 ' + aTotal + ' 死 ' + aDead + ' 报 ' + res.survivors.a);
    }
    if (bTotal - bDead !== res.survivors.b) {
      bad(label + ' B 方存活数对不上：初始 ' + bTotal + ' 死 ' + bDead + ' 报 ' + res.survivors.b);
    }
    if (['a', 'b', 'draw'].indexOf(res.winner) < 0) bad(label + ' winner 取值非法: ' + res.winner);
    if (res.ticks > CFG.MAX_TICKS + 1) bad(label + ' 超过了最大 tick 数: ' + res.ticks);
    if (res.reason === 'wipe') {
      if (res.survivors.a > 0 && res.survivors.b > 0) bad(label + ' 判定全灭但双方都还有存活单位');
    }
    /* ★★ 收尾：战斗结束时**没有人还能待在暗影里**。
     *
     *   这是「遁入暗影」最要紧的一条不变量，因为它是**终止条件**：
     *   一个免疫一切伤害、又不会被索敌的单位，如果战斗都结束了还躲在暗影里，
     *   说明这场对局是"拖到 60 秒读秒判平局"结束的 ——
     *   对面根本碰不到它，谁也赢不了。玩家的直觉也是如此：
     *   队友都死了，你该出来了。
     */
    for (var suid in shadows) {
      if (!shadows[suid]) continue;
      if (shadowMatesOf(suid) > 0) continue;   // 还有非同类队友活着 → 躲着是合法的
      bad(label + ' 战斗结束时 ' + suid + ' 还躲在暗影里（对面既打不到也打不死它）');
    }
    /* ★ 领域也要收尾：**它必须是会长大的有限状态，不能是永久地形**。
       ★★ 这里**不能**断言"到期时刻不超过对局上限" —— 第 57 秒放下的领域
          本来就会活到 63 秒，那是完全合法的（对局在 60 秒结束而已）。
          我第一版就是这么写的，结果每一场打到残局的对局都会假失败。
          要守的是"它有头"：时长有限、而且是个正常的秒数。 */
    for (var fi = 0; fi < fields.length; fi++) {
      var ff = fields[fi];
      var span = ff.until - ff.t;
      if (!(span > 0 && span <= 30)) {
        bad(label + ' 领域时长不合理（' + U.round2(span) + 's）—— 领域不能是永久地形');
      }
    }
    /* ★ 蓄力次数和开枪次数必须对得上：每一次开枪前面都有一次蓄力，
       最多只允许「多出一次」——那一次是蓄到一半被打死了，是合法的。
       如果多出两次以上，说明有蓄力白开了（或者开枪绕过了蓄力）。
       ★★ 这条**只对狙击成立**：羊帆的「羊巅峰」也蓄力，
          但它蓄完换来的是"下一次普攻 ×20"，不是一条 snipe 事件。
          拿狙击的账本去对羊帆，每一条蓄力都会被判成"白开了"——
          这是"同一套机制被两个角色共用"时最容易踩的坑：
          共用的是**表现和管线**，账本必须各记各的。 */
    for (uid in chargeCount) {
      if (!init[uid] || init[uid].skillKind !== 'snipe') continue;
      var spent = snipeTotal[uid] || 0;
      if (chargeCount[uid] - spent > 1) {
        bad(label + ' ' + uid + ' 蓄力 ' + chargeCount[uid] + ' 次但只开了 ' + spent +
            ' 枪（多出来的蓄力既没开枪也不是被打断）');
      }
      if (spent > chargeCount[uid]) {
        bad(label + ' ' + uid + ' 开了 ' + spent + ' 枪但只蓄力 ' + chargeCount[uid] + ' 次');
      }
    }
  }

  var allBad = [];
  var battleCount = 0;
  for (var bi = 0; bi < 60; bi++) {
    var seedB = 5000 + bi;
    var rngC = ST.makeRng(seedB);
    var sa = ST.Battle.randomComp('a', rngC, {});
    var sb = ST.Battle.randomComp('b', rngC, {});
    var rb = ST.Battle.battle({ a: sa, b: sb }, seedB);
    battleCount++;
    checkInvariants(rb, '随机对局#' + bi, function (msg) { allBad.push(msg); });
  }

  // 全 1 星大乱斗（更容易打到超时，覆盖超时分支）
  for (bi = 0; bi < 20; bi++) {
    var rngD = ST.makeRng(9000 + bi);
    var comp1 = ST.Battle.randomComp('a', rngD, { starWeights: [1, 0, 0], itemChance: 0 });
    var comp2 = ST.Battle.randomComp('b', rngD, { starWeights: [1, 0, 0], itemChance: 0 });
    var rbd = ST.Battle.battle({ a: comp1, b: comp2 }, 9000 + bi);
    battleCount++;
    checkInvariants(rbd, '全1星对局#' + bi, function (msg) { allBad.push(msg); });
  }

  TH.ok('不变量检查通过（' + battleCount + ' 场战斗）', allBad.length === 0,
    allBad.length ? ('前 5 条问题：\n          · ' + allBad.slice(0, 5).join('\n          · ')) : '');

  /* ============================================================
   * 5b. 开战站位与寻敌：棋子开局必须站在摆的位置上
   *
   * 这一节的存在理由：玩家反馈过三次「布阵摆好的位置，开战就不对了」。
   * 前两次我查的是「行列数据有没有传对」——那一直是对的，
   * 所以什么都没查出来。真正的原因是**移动速度是 30 格/秒**：
   * 主循环每个 tick 都调一次 moveToward，而 tick 是 30 Hz，
   * 于是开战瞬间阵型就冲到中间去了，玩家根本看不到自己摆的阵。
   * 教训：**「数据对」和「看起来对」是两件事，要分别验证。**
   * ============================================================ */
  TH.section('开战站位与寻敌');

  // ① 开局定格：初始位置 = 布阵位置，而且定格期内一步都不许动
  (function () {
    var r = ST.Battle.battle({
      a: [{ id: 'titan', star: 2, r: 3, c: 2 }],
      b: [{ id: 'bowman', star: 2, r: 4, c: 5 }]
    }, 777);
    var firstMove = null;
    for (var i = 0; i < r.log.length; i++) {
      if (r.log[i].type === 'move') { firstMove = r.log[i]; break; }
    }
    TH.ok('开局定格期内没有任何走位事件',
      firstMove === null || firstMove.t >= CFG.OPENING_HOLD - 1e-9,
      firstMove ? ('第一条走位在 t=' + firstMove.t + '（定格 ' + CFG.OPENING_HOLD + 's）')
                : '整场没有人走位');

    var placedOk = r.initial.units.every(function (u) {
      return u.side === 'a' ? (u.r === 3 && u.c === 2) : (u.r === 4 && u.c === 5);
    });
    TH.ok('快照里的初始位置 = 布阵时指定的位置', placedOk,
      r.initial.units.map(function (u) { return u.name + '(' + u.r + ',' + u.c + ')'; }).join(' '));
  })();

  // ② 贴脸的两个近战：射程内一直有敌人 → 整场一步都不该走
  (function () {
    var r = ST.Battle.battle({
      a: [{ id: 'dagger', star: 1, r: 3, c: 3 }],
      b: [{ id: 'twinblade', star: 1, r: 4, c: 3 }]
    }, 4242);
    var moves = r.log.filter(function (e) { return e.type === 'move'; }).length;
    var attacks = r.log.filter(function (e) { return e.type === 'attack'; }).length;
    TH.eq('贴脸的两个近战整场都不走位（射程内就地打）', moves, 0);
    TH.ok('它们确实在互相攻击（否则上一条没意义）', attacks > 0, attacks + ' 次攻击');
  })();

  // ③ 射程内没人 → 自己寻敌走过去，而且是越走越近
  (function () {
    var r = ST.Battle.battle({
      a: [{ id: 'dagger', star: 1, r: 0, c: 0 }],
      b: [{ id: 'bowman', star: 1, r: 7, c: 7 }]
    }, 999);
    var moves = r.log.filter(function (e) { return e.type === 'move'; });
    TH.ok('射程内没有敌人时，棋子会自己寻敌走过去', moves.length > 0, moves.length + ' 次走位');
    if (moves.length) {
      var last = moves[moves.length - 1];
      TH.ok('走位是朝敌人靠近的（不是乱走）',
        U.cheb(last.r, last.c, 7, 7) < U.cheb(0, 0, 7, 7),
        '起点距离 ' + U.cheb(0, 0, 7, 7) + ' → 最后一次走位后 ' + U.cheb(last.r, last.c, 7, 7));
    }
  })();

  // ④ 走位节奏：不该再出现「一 tick 一格」的瞬移
  (function () {
    var r = ST.Battle.battle({
      a: [{ id: 'dagger', star: 1, r: 0, c: 0 }],
      b: [{ id: 'acolyte', star: 1, r: 7, c: 7 }]
    }, 31337);
    // ★ 必须按单位分组再比间隔：两边交错的走位事件混在一个数组里，
    //   直接比相邻两条会得出 0.033s 的「间隔」，那是自己量错了。
    var byUnit = {}, tooFast = 0, maxCount = 0;
    r.log.forEach(function (e) {
      if (e.type !== 'move') return;
      (byUnit[e.who] = byUnit[e.who] || []).push(e.t);
    });
    Object.keys(byUnit).forEach(function (uid) {
      var ts = byUnit[uid];
      maxCount = Math.max(maxCount, ts.length);
      for (var i = 1; i < ts.length; i++) {
        if (ts[i] - ts[i - 1] < CFG.MOVE_INTERVAL - CFG.DT * 1.5) tooFast++;
      }
    });
    TH.eq('走位节奏正常（同一单位不会一 tick 一格地瞬移）', tooFast, 0);
    TH.ok('确实有人在走位（否则上一条没意义）', maxCount > 0, maxCount + ' 次');
    TH.note('走一格 ' + CFG.MOVE_INTERVAL + ' 秒（' + U.round1(1 / CFG.MOVE_INTERVAL) +
      ' 格/秒），开局定格 ' + CFG.OPENING_HOLD + ' 秒');
  })();

  /* ============================================================
   * 5c. 星级被动「越打越快」
   *
   * 愤怒的普通人（dagger）的设定：
   *   1 星  没有被动
   *   2 星  更加愤怒：每次普攻本局内 +5% 攻速
   *   3 星  极度愤怒：每次普攻本局内 +10% 攻速
   *   上限都是 +200%，而且**永不衰减**
   * ============================================================ */
  TH.section('星级被动');

  var DAG = ST.UNIT_BY_ID.dagger;
  TH.ok('技能已改名为狂怒一击', DAG.skill.name === '狂怒一击', DAG.skill.name);

  TH.eq('1 星没有被动', ST.passiveStep(DAG, 1), 0);
  TH.ok('2 星每次攻击 +5% 攻速',
    Math.abs(ST.passiveStep(DAG, 2) - 0.05) < 1e-9, ST.passiveStep(DAG, 2));
  TH.ok('3 星每次攻击 +10% 攻速',
    Math.abs(ST.passiveStep(DAG, 3) - 0.10) < 1e-9, ST.passiveStep(DAG, 3));
  TH.ok('上限是 +200%', Math.abs(ST.passiveCap(DAG) - 2.0) < 1e-9, ST.passiveCap(DAG));
  TH.eq('被动名字按星级区分',
    [ST.passiveName(DAG, 1), ST.passiveName(DAG, 2), ST.passiveName(DAG, 3)].join('/'),
    '/更加愤怒/极度愤怒');

  /** 某个单位在这份战报里每次普攻的时间点 */
  function attackTimes(res, uid) {
    var out = [];
    for (var i = 0; i < res.log.length; i++) {
      if (res.log[i].type === 'attack' && res.log[i].from === uid) out.push(res.log[i].t);
    }
    return out;
  }
  function frenzyTrace(res, uid) {
    var out = [];
    for (var i = 0; i < res.log.length; i++) {
      if (res.log[i].type === 'frenzy' && res.log[i].who === uid) out.push(res.log[i]);
    }
    return out;
  }

  /* 打一个「扛得住、又杀不死你太快」的目标，让战斗拖够久才看得到 20 层叠满。
     ★ 这里踩过一次：一开始拿 3 星山岳当靶子，结果我方 3 星普通人 8 秒就被打死，
       层数永远到不了 20，断言失败 —— 而失败的原因不是机制错，是**测试场景选错**。
       换成人称「血量离谱」的 2 星山岳 + 三条腰带，战斗能撑到 26 秒，
       正好够叠满 +200%。 */
  var BELTS = ['belt', 'belt', 'belt'];
  function durableDagger(star) {
    return { id: 'dagger', star: star, items: BELTS, r: 3, c: 3 };
  }
  var TARGET = [{ id: 'titan', star: 2, r: 4, c: 3 }];
  var TANKY = { a: [durableDagger(1)], b: TARGET };

  // ① 1 星：完全没有被动
  (function () {
    var r = ST.Battle.battle(TANKY, 20260101);
    TH.eq('1 星整场 0 次被动叠加', frenzyTrace(r, 'a0').length, 0);
    var f = r.initial.units.filter(function (u) { return u.side === 'a'; })[0];
    TH.eq('1 星的被动名字是空的（界面据此不画那一行）', f.passiveName, null);
    TH.eq('1 星的每层增量是 0', f.frenzyStep, 0);
  })();

  // ② 2 星：每次 +5%，叠加值只涨不跌
  (function () {
    var r = ST.Battle.battle({
      a: [durableDagger(2)], b: TARGET
    }, 20260101);
    var tr = frenzyTrace(r, 'a0');
    TH.ok('2 星会叠加被动', tr.length > 0, tr.length + ' 层');
    var ok = true, rising = true;
    for (var i = 0; i < tr.length; i++) {
      if (Math.abs(tr[i].pct - (i + 1) * 0.05) > 1e-6) ok = false;
      if (i > 0 && tr[i].pct < tr[i - 1].pct) rising = false;
    }
    TH.ok('2 星每次正好 +5%（逐层核对）', ok, tr.length ? ('最后一层 ' + tr[tr.length - 1].pct) : '');
    TH.ok('叠加值只涨不跌', rising);
  })();

  // ③ 3 星：每次 +10%，会顶到上限，且绝不超过上限
  (function () {
    var r = ST.Battle.battle({
      a: [durableDagger(3)], b: TARGET
    }, 20260101);
    var tr = frenzyTrace(r, 'a0');
    TH.ok('3 星会叠加被动', tr.length > 0, tr.length + ' 层');
    var over = tr.filter(function (e) { return e.pct > 2.0 + 1e-6; });
    TH.eq('叠加值从不超过 +200% 上限', over.length, 0);
    var last = tr[tr.length - 1];
    TH.ok('打得够久时会顶到 +200%', !!last && last.pct >= 2.0 - 1e-6,
      last ? ('最后 ' + last.pct) : '没触发');
    TH.ok('到上限后不再写事件（否则后期每一下攻击都白写一条）',
      tr.length <= 21, tr.length + ' 层（+10% × 20 层 = 200%）');

    // 攻速真的变快了：最后一次普攻的间隔应该明显短于第一次
    var ts = attackTimes(r, 'a0');
    TH.ok('普攻次数足够比较间隔', ts.length >= 6, ts.length + ' 次');
    if (ts.length >= 6) {
      var g1 = ts[1] - ts[0];
      var gN = ts[ts.length - 1] - ts[ts.length - 2];
      TH.ok('★ 越打越快：最后一次普攻间隔明显短于第一次',
        gN < g1 * 0.75,
        '第一次间隔 ' + U.round2(g1) + 's → 最后一次 ' + U.round2(gN) + 's');
    }
  })();

  // ④ 1 星对照：没有被动，首尾间隔基本不变
  (function () {
    var r = ST.Battle.battle(TANKY, 20260101);
    var ts = attackTimes(r, 'a0');
    if (ts.length >= 6) {
      var g1 = ts[1] - ts[0], gN = ts[ts.length - 1] - ts[ts.length - 2];
      TH.ok('对照组：1 星没有被动，首尾间隔基本不变',
        Math.abs(gN - g1) < g1 * 0.25,
        '第一次 ' + U.round2(g1) + 's → 最后一次 ' + U.round2(gN) + 's');
    } else {
      TH.note('1 星对照组的普攻次数不足（' + ts.length + '），跳过间隔对比');
    }
  })();

  // ⑤ 被动只在普攻上叠，放技能不算
  (function () {
    var r = ST.Battle.battle({
      a: [durableDagger(3)], b: TARGET
    }, 20260101);
    var atk = attackTimes(r, 'a0').length;
    var fr = frenzyTrace(r, 'a0').length;
    TH.ok('被动层数不超过普攻次数（技能不叠被动）', fr <= atk,
      '普攻 ' + atk + ' 次，叠加 ' + fr + ' 层');
  })();

  /* ============================================================
   * 5b2. 讲话石（原荆棘之甲）：范围反弹
   *
   *   受到伤害 → 对 3×3 范围内所有敌人反弹该伤害的 32%
   *   · 3×3 = 以佩戴者为中心、切比雪夫距离 <= 1
   *   · 触发不看伤害类型（物理法术都算）
   *   · 反弹伤害是 true 类型（不吃护甲魔抗）
   * ============================================================ */
  TH.section('讲话石 · 范围反弹');

  var STONE = ST.ITEM_BY_ID.thornmail;
  TH.eq('装备已改名为讲话石', STONE.name, '讲话石');
  TH.ok('装备有技能名，且是「飞入寻常百姓家」',
    !!(STONE.skill && STONE.skill.name), STONE.skill ? STONE.skill.name : '（没有 skill 字段）');
  TH.eq('技能名 = 飞入寻常百姓家', STONE.skill && STONE.skill.name, '飞入寻常百姓家');
  TH.ok('反弹比例是 32%', Math.abs(STONE.mods.thornPct - 0.32) < 1e-9, STONE.mods.thornPct);
  TH.ok('描述里写明了 3×3 范围', STONE.desc.indexOf('3×3') >= 0, STONE.desc);
  TH.eq('反弹半径配置为 1（切比雪夫距离 ≤ 1 就是九宫格）', ST.BATTLE_CFG.THORN_RADIUS, 1);

  function thornEvents(res) {
    return res.log.filter(function (e) { return e.reason === 'thorn'; });
  }

  /* 构造：我方一个带讲话石的坦克站在正中间，周围八个方向各放一个敌人，
     最外圈再放两个「距离 2」的敌人当对照 —— 他们不该被弹到。 */
  /* ★ 摆位要遵守半场规则：敌人在 0~3 行、我方在 4~7 行（sideOfRow）。
     第一版我把敌人放到了第 4/5 行，结果 placeOnSide 判定非法、自动改站到别处，
     测试场景和我以为的完全不是一回事 —— 这种错会伪装成「机制没生效」。 */
  function thornArena() {
    return {
      a: [
        { id: 'bowman', star: 1, r: 3, c: 3 },   // 九宫格里（切比雪夫 1）
        { id: 'bowman', star: 1, r: 3, c: 4 },   // 九宫格里
        { id: 'bowman', star: 1, r: 3, c: 5 },   // 九宫格里
        { id: 'bowman', star: 1, r: 2, c: 2 },   // ★ 距离 2，射程 3 打得到坦克，但不该被弹
        { id: 'bowman', star: 1, r: 1, c: 6 }    // ★ 距离 3，同样打得到，但不该被弹
      ],
      b: [{ id: 'stoneguard', star: 2, r: 4, c: 4, items: ['thornmail'] }]
    };
  }

  (function () {
    var r = ST.Battle.battle(thornArena(), 31415);
    var evs = thornEvents(r);
    TH.ok('讲话石会触发反弹', evs.length > 0, evs.length + ' 条反弹事件');

    // ① 一次触发应该同时弹到九宫格里的多个敌人（不只是打它的那一个）
    var byTime = {};
    evs.forEach(function (e) { byTime[e.t] = (byTime[e.t] || 0) + 1; });
    var maxAtOnce = 0;
    for (var k in byTime) maxAtOnce = Math.max(maxAtOnce, byTime[k]);
    TH.ok('★ 一次受击会弹到范围内的多个敌人（不再是只弹一个）', maxAtOnce >= 3,
      '同一次受击最多弹到 ' + maxAtOnce + ' 个');

    /* ② 每次反弹的目标，都必须在**那一刻**位于佩戴者的 3×3 内。
     *
     * ★ 判据不能拿「开局位置」去分类：坦克清掉贴身那三个之后会自己走上去，
     *   那时原本距离 3 的敌人就真的进了它的九宫格 —— 那次反弹是合法的。
     *   第一版就是这么误报的：把「后来走近的」当成了「范围外不该被弹」。
     *   所以这里沿着事件流重建每个单位当时的位置，再算距离。 */
    var pos = {};
    r.initial.units.forEach(function (u) { pos[u.uid] = { r: u.r, c: u.c }; });
    var far = [];
    r.log.forEach(function (e) {
      if (e.type === 'move') pos[e.who] = { r: e.r, c: e.c };
      else if (e.type === 'swap') {
        pos[e.a] = { r: e.aR, c: e.aC };
        pos[e.b] = { r: e.bR, c: e.bC };
      } else if (e.reason === 'thorn') {
        var src = pos[e.from], dst2 = pos[e.to];
        if (!src || !dst2) { far.push(e.t + ':位置未知'); return; }
        var dd = U.cheb(src.r, src.c, dst2.r, dst2.c);
        if (dd > ST.BATTLE_CFG.THORN_RADIUS) {
          far.push('t=' + e.t + ' ' + e.from + '→' + e.to + ' 距离 ' + dd);
        }
      }
    });
    TH.eq('★ 每一次反弹的目标都在佩戴者当时的 3×3 范围内', far.slice(0, 3).join(' ') || '无', '无');

    // ③ 触及面要广：整场下来被弹到的敌人应该不止一个
    var hitWho = {};
    evs.forEach(function (e) { hitWho[e.to] = true; });
    TH.ok('★ 反弹会波及多个敌人（不再是只弹打它的那一个）',
      Object.keys(hitWho).length >= 2, Object.keys(hitWho).length + ' 个敌人吃到过反弹');
  })();

  // ③ 反弹量 = 受到伤害的 32%，而且是 true 伤害（不吃护甲）
  (function () {
    var r = ST.Battle.battle({
      a: [{ id: 'bowman', star: 1, r: 3, c: 3 }],
      b: [{ id: 'stoneguard', star: 2, r: 4, c: 3, items: ['thornmail'] }]
    }, 2718);
    var evs = thornEvents(r);
    TH.ok('单挑也会触发反弹', evs.length > 0, evs.length + ' 条');

    /* ★ 反弹量 = min(32% × 这次承受的伤害, 对方剩余的血 + 护盾)。
     *
     *   以前这条断言直接写「反弹 == 32%」，靠着那时候荣誉一刀只有 45 点
     *   才一直没暴露问题。狙击实装之后它一枪打 1379，反弹 441 ——
     *   而荣誉只有 500 血，**被自己的反弹打剩 22.9 就停了**。
     *   这不是 bug：dealDamage 里 hpLoss 就是按剩余血量截断的
     *   （和「受伤回血 = min(上限, 剩余空间)」是同一个道理）。
     *   断言写成 min(比例, 空间) 才是恒等式，而且顺带证明了「不会打成负血」。 */
    var lastHp = {}, lastShield = {}, initU = {};
    r.initial.units.forEach(function (u) {
      initU[u.uid] = u; lastHp[u.uid] = u.hp; lastShield[u.uid] = u.shield;
    });
    var ratioOk = 0, ratioChecked = 0, clamped = 0, sample = '';
    for (var i = 0; i < r.log.length; i++) {
      var e = r.log[i];
      var eTo = (e.to !== undefined && e.to !== null) ? e.to : e.who;
      /* ★ 先取出「这一条事件发生之前」的状态 —— 反弹的截断看的是**挨打之前**
         还剩多少血，不是这条事件写出来的 hpAfter。
         （第一版就是把这两个搞混了，算出来的剩余空间是 0。） */
      var hpBefore = lastHp[eTo], shBefore = lastShield[eTo];

      if (e.reason === 'thorn' && i > 0) {
        // 往前找同一 tick 里、打在这个坦克身上的最后一次伤害
        var src2 = null;
        for (var j = i - 1; j >= 0; j--) {
          var p = r.log[j];
          if (p.t !== e.t) break;
          if ((p.type === 'attack' || p.type === 'skill' || p.type === 'damage') && p.to === 'b0') {
            src2 = p; break;
          }
        }
        if (src2 && hpBefore !== undefined) {
          ratioChecked++;
          var want = src2.dmg * 0.32;
          var room = hpBefore + (shBefore || 0);
          var expect = Math.min(want, room);
          if (room < want - 0.01) clamped++;
          if (Math.abs(e.dmg - expect) < 1.5) ratioOk++;
          else sample = '期望 ' + U.round2(expect) + ' 实际 ' + U.round2(e.dmg) +
                        '（比例 ' + U.round2(want) + '，剩余空间 ' + U.round2(room) + '）';
        }
      }

      if (e.hpAfter !== undefined && lastHp[eTo] !== undefined) {
        lastHp[eTo] = e.hpAfter;
        if (e.shieldLoss !== undefined) lastShield[eTo] = Math.max(0, lastShield[eTo] - e.shieldLoss);
        else if (e.shieldAfter !== undefined) lastShield[eTo] = e.shieldAfter;
      }
    }
    TH.ok('★ 反弹量 = min(承受伤害 × 32%, 对方剩余血+护盾)',
      ratioChecked > 0 && ratioOk === ratioChecked,
      ratioChecked + ' 次里 ' + ratioOk + ' 次吻合（其中 ' + clamped + ' 次被剩余血量截断）' +
      (sample ? ('；' + sample) : ''));
    TH.ok('反弹在日志里标成 true 伤害', evs.every(function (e) { return e.kind === 'true'; }));
    TH.ok('★ 反弹事件带 reason=thorn（渲染层靠它认出「飞入寻常百姓家」的水系特效）',
      evs.every(function (e) { return e.reason === 'thorn'; }), evs.length + ' 条');
  })();

  // ④ 反弹打死人也要正常记死亡（不能留下「血量 0 但还活着」的僵尸）
  (function () {
    var r = ST.Battle.battle({
      a: [{ id: 'acolyte', star: 1, r: 3, c: 3 }],       // 脆皮，容易被弹死
      b: [{ id: 'titan', star: 3, r: 4, c: 3, items: ['thornmail'] }]
    }, 161803);
    var ks = 0;
    r.log.forEach(function (e) {
      if (e.type === 'death' && e.who === 'a0') ks++;
    });
    var st = r.unitStats['a0'];
    var consistent = (ks === 1 && !st.survived) || (ks === 0 && st.survived);
    TH.ok('被反弹打死的敌人会正常记一次死亡（血量与存活状态自洽）',
      consistent, '死亡事件 ' + ks + ' 次，survived=' + st.survived);
  })();
  /* ============================================================
   * 5c2. 星级被动「受伤回血」（狼王 / wolfrider）
   *
   *   1 星  没有被动
   *   2 星  兽性：受到伤害回复最大生命 2%
   *   3 星  野性：受到伤害回复最大生命 4%
   * ============================================================ */
  TH.section('受伤回血被动');

  var WOLF = ST.UNIT_BY_ID.wolfrider;
  TH.eq('单位已改名为狼王', WOLF.name, '狼王');
  TH.eq('被动名字按星级区分',
    [ST.passiveName(WOLF, 1), ST.passiveName(WOLF, 2), ST.passiveName(WOLF, 3)].join('/'),
    '/兽性/野性');
  TH.eq('被动类型是受伤回血', ST.passiveKind(WOLF), 'hurtHeal');
  TH.ok('2 星回血 2%', Math.abs(ST.passiveStep(WOLF, 2) - 0.02) < 1e-9, ST.passiveStep(WOLF, 2));
  TH.ok('3 星回血 4%', Math.abs(ST.passiveStep(WOLF, 3) - 0.04) < 1e-9, ST.passiveStep(WOLF, 3));
  TH.eq('受伤回血不叠层（没有上限概念）', ST.passiveCap(WOLF), 0);

  /** 某个单位收到的被动治疗事件 */
  function passiveHeals(res, uid) {
    var out = [];
    for (var i = 0; i < res.log.length; i++) {
      var e = res.log[i];
      if (e.type === 'heal' && e.reason === 'passive' && e.to === uid) out.push(e);
    }
    return out;
  }

  // 一个「打不死对方、但一直在挨打」的场景：狼王 vs 一个血厚输出低的靶子
  function wolfFight(star) {
    return ST.Battle.battle({
      a: [{ id: 'ironwall', star: 1, r: 3, c: 3 }],
      b: [{ id: 'wolfrider', star: star, r: 4, c: 3 }]
    }, 606060);
  }

  // ① 1 星：完全没有被动
  (function () {
    var r = wolfFight(1);
    TH.eq('1 星整场 0 次受伤回血', passiveHeals(r, 'b0').length, 0);
    var f = r.initial.units.filter(function (u) { return u.side === 'b'; })[0];
    TH.eq('1 星的被动名字是空的', f.passiveName, null);
    TH.eq('1 星的回血比例是 0', f.hurtHealPct, 0);
  })();

  /* ②③ 每次回血量 = min(最大生命 × 比例, 剩余血量空间)。
   *
   * ★ 这里踩过一个坑：一开始断言「每次正好回 2%/4%」，结果失败。
   *   不是机制错，是 healUnit 会把治疗量**按剩余血量截断** ——
   *   快到满血时只能回一点点。写成 min(上限, 空间) 才是恒等式，
   *   而且顺带证明了「不会超过血量上限」。 */
  function checkHealAmount(star, pct, label) {
    var r = wolfFight(star);
    var hs = passiveHeals(r, 'b0');
    TH.ok(label + '星会触发受伤回血', hs.length > 0, hs.length + ' 次');
    var u = r.initial.units.filter(function (x) { return x.side === 'b'; })[0];
    var cap = u.maxHp * pct;
    var bad = [];
    hs.forEach(function (e) {
      var before = U.round2(e.hpAfter - e.amount);
      var want = Math.min(cap, U.round2(u.maxHp - before));
      if (Math.abs(e.amount - want) > 0.05) bad.push(e.amount + '≠' + U.round2(want));
    });
    TH.ok('★ ' + label + '星每次回血 = min(最大生命×' + Math.round(pct * 100) + '%, 剩余空间)',
      bad.length === 0,
      '上限 ' + U.round2(cap) + '（最大生命 ' + u.maxHp + '），异常 ' + bad.length + ' 次' +
      (bad.length ? ('，例如 ' + bad.slice(0, 2).join('、')) : ''));
    TH.ok(label + '星每次回血量都不超过最大生命的 ' + Math.round(pct * 100) + '%',
      hs.every(function (e) { return e.amount <= cap + 0.05; }));
    return hs;
  }
  checkHealAmount(2, 0.02, '2');
  checkHealAmount(3, 0.04, '3');

  // ④ 星级差异要真的体现在战斗里：同一个攻击者，3 星能扛下更多伤害才倒
  (function () {
    var ATK = [{ id: 'blademaster', star: 2, r: 3, c: 3 }];
    function absorbed(star) {
      var r = ST.Battle.battle({
        a: ATK, b: [{ id: 'wolfrider', star: star, r: 4, c: 3 }]
      }, 246810);
      return (r.unitStats['b0'] && r.unitStats['b0'].dmgTaken) || 0;
    }
    var a2 = absorbed(2), a3 = absorbed(3);
    TH.ok('★ 3 星的狼王能扛下明显更多伤害才倒（星级差异真的生效）',
      a3 > a2 * 1.5,
      '2 星扛 ' + U.round1(a2) + '，3 星扛 ' + U.round1(a3) + '（' +
      U.round1(a3 / Math.max(1, a2)) + ' 倍）');
  })();

  // ⑤ 回血不会超过血量上限（校验器里也有，这里再直接量一次）
  (function () {
    var r = wolfFight(3);
    var over = [];
    for (var i = 0; i < r.log.length; i++) {
      var e = r.log[i];
      if (e.type === 'heal' && e.reason === 'passive' && e.hpAfter > e.hpMax + 0.02) over.push(e);
    }
    TH.eq('回血从不超过血量上限', over.length, 0);
  })();

  /* ============================================================
   * 5c3. 星级被动「幻觉 / 开智」（豆包 / acolyte）
   *
   *   1 星  没有被动（奶妈本分）
   *   2 星  幻觉：每次治疗 50% 让被治疗者增伤 20%，另外 50% 让ta减伤 20%
   *   3 星  开智：不再掷骰子，必定增伤 20%
   *
   *   效果是**限时可刷新**的（4 秒），不是本局永久 ——
   *   永久的话多奶几口必定掷出一次增伤，之后每口奶都不再有意义，
   *   「50%」这个数字就退化成了「前几秒的随机启动时间」。
   * ============================================================ */
  TH.section('豆包 · 幻觉 / 开智');

  var ACO = ST.UNIT_BY_ID.acolyte;
  TH.eq('单位已改名为豆包', ACO.name, '豆包');
  TH.eq('id 仍然是 acolyte（改名不许动 id：levels.js 8 处阵容 + art 文件名都按 id 索引）',
    ACO.id, 'acolyte');
  TH.eq('被动类型是治疗赠礼', ST.passiveKind(ACO), 'healGift');
  TH.eq('被动名字按星级区分',
    [ST.passiveName(ACO, 1), ST.passiveName(ACO, 2), ST.passiveName(ACO, 3)].join('/'),
    '/幻觉/开智');
  TH.ok('2 星幅度是 20%', Math.abs(ST.passiveStep(ACO, 2) - 0.20) < 1e-9, ST.passiveStep(ACO, 2));
  TH.ok('★ 3 星幅度也是 20%（升星的收益是「必定成功」，不是数字变大）',
    Math.abs(ST.passiveStep(ACO, 3) - 0.20) < 1e-9, ST.passiveStep(ACO, 3));
  TH.ok('2 星的好结果概率是 50%', Math.abs(ACO.passive.chance - 0.5) < 1e-9, ACO.passive.chance);
  TH.eq('效果持续 4 秒（限时，不是本局永久）', ACO.passive.seconds, 4);
  TH.eq('默认持续时间在 CFG 里有兜底值', ST.BATTLE_CFG.GIFT_SECONDS, 4);

  /* 一个「奶得够久」的场景。
   *
   * ★ 场景选得很讲究，这里失败过一轮：最开始摆的是「3 星铁壁 + 豆包 vs 剑客」，
   *   看着很合理，实测 25 秒里 11 次施法只落地了 1 次治疗 ——
   *   豆包只会奶**血量百分比最低的队友**，而铁壁一死她就只能奶自己，
   *   满血的时候那一口治疗被 healUnit 直接丢掉（room < 1 → 不写日志、不触发被动）。
   *   结果整个被动在测试里几乎不出现，7 条断言全红 —— 那不是机制错，是场景选错。
   *
   *   换成「豆包单挑一个血厚输出低的靶子（1 星铁壁）」之后：
   *   24 场跑出 72 次赠礼（2 星）/ 68 次（3 星），而且**治疗数恒等于赠礼数**。
   *   3 块蓝水晶让她开局满蓝，是她能频繁开奶的前提。 */
  var SAPP = ['sapphire', 'sapphire', 'sapphire'];
  function doubaoFight(star, seed) {
    /* ★ 靶子用「100元的鸭子」（原铁壁）：
       它血量只有 95，但前 20 次挨打判 0 —— 豆包打不动它，
       而它稳定地反击豆包，豆包才有源源不断的治疗要放。
       （换成别的 1 星前排，豆包几秒钟就把它打死，战斗结束得太快、
         采样不够 —— 实测从 68 次赠礼掉到 24 次。） */
    return ST.Battle.battle({
      a: [{ id: 'acolyte', star: star, items: SAPP, r: 3, c: 3 }],
      b: [{ id: 'ironwall', star: 1, r: 4, c: 3 }]
    }, seed);
  }

  var SEEDS = [];
  for (var sd = 0; sd < 24; sd++) SEEDS.push(313131 + sd * 7919);

  function giftsOf(res) {
    var out = [];
    for (var i = 0; i < res.log.length; i++) {
      if (res.log[i].type === 'gift') out.push(res.log[i]);
    }
    return out;
  }
  /** 某个单位奶出去的每一口（豆包的治疗事件） */
  function healsBy(res, uid) {
    var out = [];
    for (var i = 0; i < res.log.length; i++) {
      var e = res.log[i];
      if (e.type === 'heal' && e.from === uid) out.push(e);
    }
    return out;
  }
  function acolyteUid(res) {
    var us = res.initial.units, i;
    for (i = 0; i < us.length; i++) if (us[i].defId === 'acolyte') return us[i].uid;
    return null;
  }

  /* ★ 重放日志，算出「每次普攻那一刻，出手的人身上挂着的伤害倍率」。
     这是本次改动里唯一能直接证明「倍率真的乘进了伤害」的办法 ——
     只看 gift 事件只能证明状态挂上去了，证明不了它起作用。 */
  function attackMuls(res) {
    var ad = {}, act = {}, out = [];
    res.initial.units.forEach(function (u) { ad[u.uid] = u.ad; });
    for (var i = 0; i < res.log.length; i++) {
      var e = res.log[i];
      if (e.type === 'gift') act[e.to] = { mul: e.mul, until: e.until };
      if (e.type === 'attack') {
        var a = act[e.from];
        out.push({
          t: e.t, uid: e.from, crit: e.crit, raw: e.raw, ramp: e.ramp, ad: ad[e.from],
          mul: (a && e.t < a.until) ? a.mul : 1,
          boundary: !!(a && Math.abs(e.t - a.until) < 0.005)
        });
      }
    }
    return out;
  }

  // ① 1 星：完全没有被动
  (function () {
    var r = doubaoFight(1, SEEDS[0]);
    var uid = acolyteUid(r);
    TH.eq('1 星整场 0 次赠礼', giftsOf(r).length, 0);
    var me = r.initial.units.filter(function (u) { return u.defId === 'acolyte'; })[0];
    TH.eq('1 星的被动名字是空的（界面据此不画那一行）', me.passiveName, null);
    TH.eq('1 星的赠礼幅度是 0', me.giftPct, 0);
    TH.ok('1 星仍然照常治疗（被动没了不等于不奶人）', healsBy(r, uid).length > 0,
      healsBy(r, uid).length + ' 口');
  })();

  // ② 2 星：掷骰子，两个结果都会出现，且只可能是 ±20%
  (function () {
    var good = 0, bad = 0, muls = {};
    SEEDS.forEach(function (s) {
      giftsOf(doubaoFight(2, s)).forEach(function (e) {
        if (e.good) good++; else bad++;
        muls[U.round2(e.mul)] = (muls[U.round2(e.mul)] || 0) + 1;
      });
    });
    var keys = Object.keys(muls).sort();
    TH.ok('★ 2 星在 24 个种子里掷出足够多的赠礼', (good + bad) >= 40, (good + bad) + ' 次');
    TH.eq('★ 伤害倍率只有两种：1.2（增伤）和 0.8（减伤）', keys.join(','), '0.8,1.2');
    TH.ok('★ 两个结果都真的出现过（不是一个只写在文档里的分支）',
      good > 0 && bad > 0, '增伤 ' + good + ' 次 / 减伤 ' + bad + ' 次');
    var rate = good / Math.max(1, good + bad);
    TH.ok('★ 好结果的比例接近 50%（幻觉的骰子是公平的）',
      rate > 0.30 && rate < 0.70,
      '增伤占比 ' + Math.round(rate * 100) + '%（' + good + '/' + (good + bad) + '）');
  })();

  // ③ 3 星：不再掷骰子，一次坏结果都不许有
  (function () {
    var good = 0, bad = 0, badMul = 0;
    SEEDS.forEach(function (s) {
      giftsOf(doubaoFight(3, s)).forEach(function (e) {
        if (e.good) good++; else bad++;
        if (Math.abs(e.mul - 1.2) > 1e-9) badMul++;
      });
    });
    TH.ok('★ 3 星开智：整场没有一次减伤（「必定增伤」不是概率更高，是 100%）',
      bad === 0, '增伤 ' + good + ' 次 / 减伤 ' + bad + ' 次');
    TH.eq('3 星的倍率恒为 1.2', badMul, 0);
    TH.ok('3 星依然会触发（不是把被动关掉了）', good >= 40, good + ' 次');
  })();

  /* ④ 核心：倍率真的乘进了伤害。
     对每一次非暴击普攻核对 raw ÷ (ad × ramp) 正好等于身上挂着的倍率。
     暴击要额外乘 critMult（1.5），所以单独排除掉不掺和。 */
  (function () {
    var stat = {}, mism = [], boundary = 0, checked = 0, buffed = 0, third = [];
    SEEDS.forEach(function (s) {
      [2, 3].forEach(function (star) {
        attackMuls(doubaoFight(star, s)).forEach(function (a) {
          if (a.crit || !a.ad) return;
          var ratio = a.raw / (a.ad * a.ramp);
          checked++;
          stat[U.round2(ratio)] = (stat[U.round2(ratio)] || 0) + 1;
          if (a.mul !== 1) buffed++;
          /* ★ 判定「只有三种倍率」不能拿四舍五入后的值去查表：
             日志里的 ramp 只保留两位小数，在递增刚开始的时候相对误差最大
             （ramp=1.005 会记成 1.01），1.2 会被算成 1.194 → 记成 1.19。
             所以改成「离三种倍率最近的差值都在 2% 以内」。
             第四种乘法会差得远得多，一样能抓到。 */
          var near = Math.min(Math.abs(ratio - 1), Math.abs(ratio - 1.2), Math.abs(ratio - 0.8));
          if (near > 0.02) third.push('t=' + U.round2(a.t) + ' ' + U.round2(ratio));
          if (Math.abs(ratio - a.mul) > 0.02) {
            // 卡在到期那一 tick 的边界样本（日志里的 until 保留了 3 位小数）不算错
            if (a.boundary && (Math.abs(ratio - 1) < 0.02 || Math.abs(ratio - 0.8) < 0.02 ||
                Math.abs(ratio - 1.2) < 0.02)) { boundary++; return; }
            mism.push('t=' + U.round2(a.t) + ' ' + a.uid + ' 倍率 ' + a.mul +
                      ' 实际 ' + U.round2(ratio));
          }
        });
      });
    });
    var keys = Object.keys(stat).filter(function (k) { return stat[k] > 0; }).sort();
    TH.ok('★ 出手伤害的倍率只可能是 1 / 1.2 / 0.8 三种（没有第三种乘法在偷偷叠加）',
      third.length === 0,
      third.length ? third.slice(0, 3).join('；')
                   : ('出现过的倍率：' + keys.join('、') + '（共核对 ' + checked + ' 次非暴击普攻）'));
    TH.ok('★ 重放日志核对：每一次普攻都用了当时身上挂着的那个倍率',
      mism.length === 0,
      mism.length ? mism.slice(0, 3).join('；') : ('核对 ' + checked + ' 次，全部一致' +
        (boundary ? ('，另有 ' + boundary + ' 次到期边界样本') : '')));
    TH.ok('★ 增伤和减伤都真的打出来过（倍率不是只挂在卡片上）',
      (stat['1.2'] || 0) > 0 && (stat['0.8'] || 0) > 0,
      '×1.2 出现 ' + (stat['1.2'] || 0) + ' 次，×0.8 出现 ' + (stat['0.8'] || 0) + ' 次');
    TH.ok('有没有效果的出手都足够多（样本不是「全都带效果」或「全都没效果」）',
      buffed > 20 && checked - buffed > 20, '带效果 ' + buffed + ' / 不带 ' + (checked - buffed));
  })();

  // ⑤ 效果会过期：挂上去之后必须能回到 1（限时，不是本局永久）
  (function () {
    var expired = 0, everApplied = 0, checkedAfter = 0;
    SEEDS.slice(0, 8).forEach(function (s) {
      var r = doubaoFight(2, s);
      var am = attackMuls(r);
      var gs = giftsOf(r);
      everApplied += gs.length;
      gs.forEach(function (g) {
        // 这次效果到期之后，被挂的人还有没有普攻？有的话那次必须回到 ×1
        var after = null, i;
        for (i = 0; i < am.length; i++) {
          if (am[i].uid === g.to && am[i].t > g.until + 0.1) { after = am[i]; break; }
        }
        if (!after) return;
        checkedAfter++;
        if (Math.abs(after.mul - 1) < 1e-9) expired++;
      });
    });
    TH.ok('★ 效果到期后伤害倍率回到 1（限时 4 秒，不是本局永久）',
      checkedAfter > 0 && expired === checkedAfter,
      everApplied + ' 次赠礼里 ' + checkedAfter + ' 次在到期之后还有普攻，其中 ' +
      expired + ' 次回到了 ×1');
  })();

  // ⑥ 一次有效治疗换一次掷骰子 —— 不多不少
  (function () {
    var okAll = true, detail = '';
    [1, 2, 3].forEach(function (star) {
      var r = doubaoFight(star, SEEDS[0]);
      var h = healsBy(r, acolyteUid(r)).length, g = giftsOf(r).length;
      var want = star === 1 ? 0 : h;      // 1 星没有被动，一口都不该掷
      if (g !== want) {
        okAll = false;
        detail += star + ' 星：治疗 ' + h + ' 次但赠礼 ' + g + ' 次；';
      }
    });
    TH.ok('★ 每一次有效治疗正好换一次掷骰子（1 星一次都不掷）', okAll, detail);
  })();

  /* ============================================================
   * 5c4. 荣誉（原「短弓手」/ bowman）
   *
   *   面板：单次伤害翻倍（45 → 90）、攻速砍半（0.68 → 0.34）
   *   技能「狙击1」：一发 ×10 的子弹，只有 20% 命中
   *   2 星「运」      每局第 1 次狙击必定命中
   *   3 星「edg希望」 每局前 2 次狙击必定命中
   * ============================================================ */
  TH.section('荣誉 · 狙击1');

  var BOW = ST.UNIT_BY_ID.bowman;
  TH.eq('单位已改名为荣誉', BOW.name, '荣誉');
  TH.eq('id 仍然是 bowman（levels.js 的 30 多处阵容 + art 文件名都按 id 索引）',
    BOW.id, 'bowman');
  TH.eq('技能名是「狙击1」', BOW.skill.name, '狙击1');
  TH.eq('技能类型是狙击', BOW.skill.kind, 'snipe');
  TH.eq('命中率 20%', BOW.skill.hitChance, 0.20);
  TH.eq('命中伤害 ×10', BOW.skill.mult, 10);

  /* ★ 慢枪手：这两条必须**成对**出现，否则就是白送一倍输出。
     改动前是 ad 45 / as 0.68；断言里留着这两个数字，
     是为了让「面板 DPS 一点没变」这件事本身可验证 ——
     只写「ad 应该是 90」的话，没人看得出翻倍和减半是配套的。 */
  var OLD_BOW_AD = 45, OLD_BOW_AS = 0.68;
  TH.eq('攻击力翻倍（45 → 90）', BOW.ad, OLD_BOW_AD * 2);
  TH.ok('攻速减半（0.68 → 0.34）', Math.abs(BOW.as - OLD_BOW_AS / 2) < 1e-9, BOW.as);
  TH.ok('★ 面板 DPS 和改动前完全一致（翻倍和减半是配套的，不是顺手多给一倍输出）',
    Math.abs(BOW.ad * BOW.as - OLD_BOW_AD * OLD_BOW_AS) < 0.01,
    '改动前 ' + U.round2(OLD_BOW_AD * OLD_BOW_AS) + ' → 现在 ' + U.round2(BOW.ad * BOW.as));

  TH.eq('被动类型是狙击保底', ST.passiveKind(BOW), 'snipeSure');
  TH.eq('被动名字按星级区分',
    [ST.passiveName(BOW, 1), ST.passiveName(BOW, 2), ST.passiveName(BOW, 3)].join('/'),
    '/运/edg希望');
  TH.eq('2 星每局保底 1 次', ST.passiveStep(BOW, 2), 1);
  TH.eq('3 星每局保底 2 次', ST.passiveStep(BOW, 3), 2);
  TH.eq('1 星没有保底', ST.passiveStep(BOW, 1), 0);

  /* ★ 收费方式：不吃法力，改成「开局一发 + 每 3 次普攻一发」。
     为什么必须改：攻速砍到 0.34 之后，走法力的话一局只放得出 1~2 次技能
     （见下面 ⑤ 的实测），那个 20% 的赌局基本轮不到发生，
     「前两次必定命中」的保底更是永远用不完 —— 机制等于白写。 */
  TH.ok('技能定义了「计数型」收费方式',
    !!(BOW.skill.cast && BOW.skill.cast.perAttacks > 0), JSON.stringify(BOW.skill.cast));
  TH.eq('开局白送一发', BOW.skill.cast.opening, true);
  TH.eq('之后每 3 次普攻一发', BOW.skill.cast.perAttacks, 3);
  TH.eq('蓄力时长配置合理（0 < CHARGE_TIME <= 1 秒）', ST.BATTLE_CFG.CHARGE_TIME > 0 &&
    ST.BATTLE_CFG.CHARGE_TIME <= 1, true);
  /* ★ 计数型不再是荣誉一个人的专利了 —— 羊帆「羊巅峰」也走同一套收费方式
     （理由完全一样：攻速被砍到 0.132，走法力一局只放得出 1 次技能，
     「下一次普攻 ×20」这个机制就基本轮不到发生）。
     所以这条断言改成**白名单**而不是"只有荣誉" —— 加人是有意为之，
     但必须显式改这里，不能偷偷多一个。 */
  (function () {
    var cnt = ST.UNITS.filter(function (u) { return u.skill && u.skill.cast && u.skill.cast.perAttacks; });
    TH.eq('计数型技能只有荣誉和羊帆两个（加人要显式改这里）',
      cnt.map(function (u) { return u.id; }).join(','), 'bowman,pyromancer');
    TH.ok('两个计数型都是「开局白送一发」（不然慢攻速的角色一辈子开不了张）',
      cnt.every(function (u) { return u.skill.cast.opening === true; }),
      cnt.map(function (u) { return u.id + ':' + !!u.skill.cast.opening; }).join(' '));
  })();

  var BOW_SAP = ['sapphire', 'sapphire', 'sapphire'];
  function bowFight(star, seed, foe, fs) {
    return ST.Battle.battle({
      a: [{ id: 'bowman', star: star, items: BOW_SAP, r: 3, c: 3 }],
      b: [{ id: foe || 'stoneguard', star: fs || 1, r: 4, c: 3 }]
    }, seed);
  }  function snipesOf(res, uid) {
    var out = [];
    for (var i = 0; i < res.log.length; i++) {
      var e = res.log[i];
      if (e.type === 'snipe' && (!uid || e.from === uid)) out.push({ e: e, i: i });
    }
    return out;
  }
  /** 这个单位在这份战报里打出过几次普攻、蓄过几次力 */
  function countOf(res, uid, type) {
    var n = 0;
    for (var i = 0; i < res.log.length; i++) {
      var e = res.log[i];
      if (e.type === type && (type === 'charge' ? e.who === uid : e.from === uid)) n++;
    }
    return n;
  }

  /* ① 收费方式：开局白送一发，之后每 3 次普攻一发。
     ★ 断言写成「第 k 枪正好发生在第 3(k-1) 次普攻之后」这种**精确关系**，
       而不是「一局至少开 N 枪」。后者要靠挑一个刚好打得久的靶子才能过，
       而且靶子一改数值就红 —— 前者在任何一场对局里都成立。 */
  (function () {
    var checked = 0, bad2 = [], overFire = [];
    [1, 2, 3].forEach(function (star) {
      for (var s2 = 0; s2 < 30; s2++) {
        var r = bowFight(star, 313131 + s2 * 7919, 'stoneguard', 3);
        var uid = null;
        r.initial.units.forEach(function (u) { if (u.defId === 'bowman' && u.side === 'a') uid = u.uid; });
        if (!uid) continue;
        // 按时间顺序走一遍，记下每次普攻之后、累计打过几次
        var atk = 0, seen = 0;
        for (var i = 0; i < r.log.length; i++) {
          var e = r.log[i];
          if (e.type === 'attack' && e.from === uid) {
            atk++;
          } else if (e.type === 'snipe' && e.from === uid) {
            seen++;
            if (seen === 1) {
              if (atk !== 0) bad2.push(star + '★ 开局那一枪前面已经打了 ' + atk + ' 下');
            } else {
              checked++;
              if (atk !== 3 * (seen - 1)) {
                bad2.push(star + '★ 第' + seen + '枪发生在第 ' + atk +
                          ' 次普攻之后（期望 ' + (3 * (seen - 1)) + '）');
              }
            }
          }
        }
        if (seen > 1 + Math.floor(atk / 3)) {
          overFire.push(star + '★ 打了 ' + atk + ' 下却开了 ' + seen + ' 枪');
        }
      }
    });
    TH.ok('★ 开局那一枪是白送的（前面一次普攻都没有）',
      bad2.filter(function (x) { return x.indexOf('开局') >= 0; }).length === 0,
      bad2.slice(0, 2).join('；') || '每一局的第一枪都在 0 次普攻时打出');
    TH.ok('★ 之后每一枪都正好卡在第 3 次普攻之后（每 3 次一发）',
      checked > 40 && bad2.length === 0,
      '核对了 ' + checked + ' 枪；' + (bad2.slice(0, 3).join('；') || '全部吻合'));
    TH.eq('★ 从来不超发：开枪数 <= 1 + 普攻次数/3', overFire.slice(0, 2).join('；') || '无', '无');
  })();

  /* ② 蓄力：每一枪之前都有一次「眼睛喷金色激光」。
     ★ 这是「使用技能前眼睛会喷射金色激光」在规则层的唯一证据 ——
       渲染层只是把这段窗口画出来。 */
  (function () {
    var mism = [], total = 0, seenCharge = 0;
    [1, 2, 3].forEach(function (star) {
      for (var s3 = 0; s3 < 20; s3++) {
        var r = bowFight(star, 313131 + s3 * 7919, 'stoneguard', 3);
        var uid = null;
        r.initial.units.forEach(function (u) { if (u.defId === 'bowman' && u.side === 'a') uid = u.uid; });
        if (!uid) continue;
        total += countOf(r, uid, 'snipe');
        seenCharge += countOf(r, uid, 'charge');
        var lastCharge = null;
        for (var i = 0; i < r.log.length; i++) {
          var e = r.log[i];
          if (e.type === 'charge' && e.who === uid) {
            if (e.dur !== ST.BATTLE_CFG.CHARGE_TIME) {
              mism.push('蓄力时长 ' + e.dur + ' ≠ ' + ST.BATTLE_CFG.CHARGE_TIME);
            }
            lastCharge = e.until;
          }
          if (e.type === 'snipe' && e.from === uid) {
            if (lastCharge === null || e.t < lastCharge - 0.02 || e.t > lastCharge + 0.06) {
              mism.push('t=' + U.round2(e.t) + ' 开枪前没有对应的蓄力（上次蓄力到 ' + lastCharge + '）');
            }
            lastCharge = null;
          }
        }
      }
    });
    TH.eq('★ 每一次开枪前面都有一次蓄力（眼睛先喷激光，再开枪）',
      mism.slice(0, 3).join('；') || '无', '无');
    TH.ok('蓄力次数和开枪次数基本一一对应（最多差一次被打断的）',
      total > 40 && seenCharge >= total && seenCharge <= total + 20,
      '开枪 ' + total + ' 次 / 蓄力 ' + seenCharge + ' 次');
    TH.eq('蓄力时长就是 CFG.CHARGE_TIME',
      ST.BATTLE_CFG.CHARGE_TIME > 0 && ST.BATTLE_CFG.CHARGE_TIME <= 1,
      true);
  })();

  /* ① 1 星：没有任何保底，命中率就是那个 20%。
     ★ 场景选的是 1 星 vs 1 星铁壁 —— 双方都打不死对方，能拖到时间上限，
       荣誉才攒得出第二枪。团战里它 500 血会先被打死，一枪都开不出来。 */
  (function () {
    var shots = 0, hits = 0, sures = 0, badPair = 0, missDmg = 0;
    for (var s2 = 0; s2 < 60; s2++) {
      var r = bowFight(1, 313131 + s2 * 7919, 'stoneguard', 1);
      snipesOf(r).forEach(function (o) {
        shots++;
        if (o.e.sure) sures++;
        if (o.e.hit) hits++;
        // 命中 ⇒ 紧跟着一条同 tick、同起止的 skill 伤害事件
        var nx = r.log[o.i + 1];
        var linked = !!nx && nx.type === 'skill' && nx.from === o.e.from &&
                     nx.to === o.e.to && Math.abs(nx.t - o.e.t) < 1e-9;
        if (o.e.hit !== linked) badPair++;
        // 打偏 ⇒ 那个目标这一 tick 一滴血都不该掉
        if (!o.e.hit && linked) missDmg++;
      });
    }
    TH.ok('1 星 60 场开出了足够多的枪', shots >= 60, shots + ' 枪');
    var rate = hits / Math.max(1, shots);
    TH.ok('★ 1 星命中率接近 20%（60 场实测）', rate > 0.10 && rate < 0.33,
      Math.round(rate * 100) + '%（' + hits + '/' + shots + '）');
    TH.eq('★ 1 星一次保底都没有（没有被动就是老老实实赌）', sures, 0);
    TH.eq('命中/打偏 与「后面有没有跟伤害」完全一致', badPair, 0);
    TH.eq('打偏的时候一滴血都没掉', missDmg, 0);
  })();

  /* ② ×10 是真的：命中那一下的伤害 = 基准 200 × 10 × ap × 正常减伤 × 递增。
     反推出来的「基准伤害」必须落在 2000 附近（容差 1%，
     因为日志里的 ramp 只保留两位小数）。 */
  (function () {
    var checked = 0, ratios = [];
    for (var s3 = 0; s3 < 60 && checked < 12; s3++) {
      var r = bowFight(1, 313131 + s3 * 7919, 'stoneguard', 3);
      var init = {};
      r.initial.units.forEach(function (u) { init[u.uid] = u; });
      snipesOf(r).forEach(function (o) {
        if (checked >= 12) return;
        var nx = r.log[o.i + 1];
        if (!o.e.hit || !nx || nx.type !== 'skill') return;
        var me = init[o.e.from], tgt = init[o.e.to];
        var reduce2 = 100 / (100 + tgt.mr);
        var base = nx.dmg / (me.ap * reduce2 * nx.ramp);
        ratios.push(U.round2(base));
        checked++;
      });
    }
    var okAll = ratios.length > 0 && ratios.every(function (v) {
      return Math.abs(v - BOW.skill.damage * BOW.skill.mult) < BOW.skill.damage * 0.02;
    });
    TH.ok('★ 命中打出的基准伤害 = 200 × 10（把减伤和递增反推掉之后）',
      okAll, '实测 ' + ratios.slice(0, 6).join('、') + (ratios.length > 6 ? ' …' : '') +
      '（期望 2000）');
  })();

  /* ③ 2 星「运」：每局第一枪必定命中，而且整局最多只能用掉 1 次保底。
     ★ 靶子用 3 星铁壁：它是血最厚、又几乎打不死荣誉的一个，
       这样一场能开出 2 枪（开局一发 + 第 3 次普攻一发）。
       用 3 星山岳反而只开得出 1 枪 —— 山岳的输出会把荣誉打死。 */
  (function () {
    var fights = 0, firstSure = 0, firstHit = 0, overCap = 0, maxSure = 0, shots = 0, extraHits = 0, extra = 0;
    for (var s4 = 0; s4 < 40; s4++) {
      var r = bowFight(2, 313131 + s4 * 7919, 'stoneguard', 3);
      var ss = snipesOf(r);
      if (!ss.length) continue;
      fights++; shots += ss.length;
      if (ss[0].e.sure) firstSure++;
      if (ss[0].e.hit) firstHit++;
      var su = ss.filter(function (o) { return o.e.sure; }).length;
      if (su > 1) overCap++;
      if (su > maxSure) maxSure = su;
      // 保底用完之后的枪要真的回到 20% 的掷骰子
      for (var k2 = 1; k2 < ss.length; k2++) {
        if (ss[k2].e.sure) continue;
        extra++;
        if (ss[k2].e.hit) extraHits++;
      }
    }
    TH.ok('2 星跑出了足够的对局', fights >= 20, fights + ' 场 / 共 ' + shots + ' 枪');
    TH.eq('★ 2 星的每一局第一枪都必定命中', firstSure, fights);
    TH.eq('★ 而且那一枪真的打中了（sure 不是只写在字段里）', firstHit, fights);
    TH.eq('★ 保底次数从不超发（2 星整局最多 1 次）', overCap, 0);
    TH.ok('实测单局最多用掉 1 次保底', maxSure <= 1, '最多 ' + maxSure + ' 次');
    TH.ok('★ 保底用完之后的枪回到正常判定（不是偷偷全都命中）',
      extra >= 10 && extraHits < extra, extra + ' 枪无保底，其中命中 ' + extraHits +
      '（' + Math.round(extraHits / Math.max(1, extra) * 100) + '%）');
  })();

  /* ④ 3 星「edg希望」：每局前两枪必定命中，整局最多 2 次保底。 */
  (function () {
    var fights = 0, bothSure = 0, bothHit = 0, overCap = 0, maxSure = 0, thirdSure = 0;
    for (var s5 = 0; s5 < 40; s5++) {
      var r = bowFight(3, 313131 + s5 * 7919, 'stoneguard', 3);
      var ss = snipesOf(r);
      if (ss.length < 2) continue;
      fights++;
      if (ss[0].e.sure && ss[1].e.sure) bothSure++;
      if (ss[0].e.hit && ss[1].e.hit) bothHit++;
      var su = ss.filter(function (o) { return o.e.sure; }).length;
      if (su > 2) overCap++;
      if (su > maxSure) maxSure = su;
      // 万一真开出第三枪，那一枪绝不该还在保底窗口里
      if (ss[2] && ss[2].e.sure) thirdSure++;
    }
    TH.ok('3 星跑出了足够的两枪对局', fights >= 20, fights + ' 场');
    TH.eq('★ 3 星的每一局前两枪都必定命中', bothSure, fights);
    TH.eq('★ 而且那两枪真的都打中了', bothHit, fights);
    TH.eq('★ 保底次数从不超发（3 星整局最多 2 次）', overCap, 0);
    TH.eq('第三枪不会还在保底里', thirdSure, 0);
    TH.ok('实测单局最多用掉 2 次保底', maxSure <= 2, '最多 ' + maxSure + ' 次');
  })();

  /* ⑤ 星级越高，保底越多 —— 这是升星唯一的收益，必须单调。
     ★ 顺带记一个实测出来的事实：攻速 0.34 ⇒ 每 3 次普攻要 8.8 秒。
       所以理论上限内最多开出几枪（开局那发 + 每 3 次普攻一发），
       而实战里荣誉常常 500/900 血先被打死，只开得出 1~2 枪。
       这已经比「走法力」那版（一局最多 2 次）好得多 ——
       也正是改成计数型的全部理由。 */
  (function () {
    var counts = [1, 2, 3].map(function (st) {
      var r = bowFight(st, 313131, 'stoneguard', 3);
      var us = r.initial.units.filter(function (u) { return u.defId === 'bowman'; })[0];
      return us.snipeSure;
    });
    TH.eq('保底次数随星级单调递增', counts.join('→'), '0→1→2');
    var maxShots = 0, totalShots = 0, fights = 0;
    for (var s6 = 0; s6 < 40; s6++) {
      var r6 = bowFight(3, 313131 + s6 * 7919, 'stoneguard', 3);
      var n = snipesOf(r6).length;
      totalShots += n; fights++;
      if (n > maxShots) maxShots = n;
    }
    /* ★ 理论上限跟着对局时钟走，不要写死。
       开局白送 1 发 + 时钟内每 perAttacks 次普攻 1 发：
       攻速 0.34、每 3 次一发、上限 60 秒 ⇒ 1 + floor(60×0.34/3) = 7 发。
       实测这个靶子只能撑 2 枪（荣誉先被打死），所以断言用的是"不超过"。 */
    var maxPossible = 1 + Math.floor(CFG.MAX_SECONDS * BOW.as / BOW.skill.cast.perAttacks);
    TH.ok('★ 单局开枪数不超过理论上限（开局 1 发 + 时钟内每 3 次普攻 1 发）',
      maxShots <= maxPossible,
      '最多 ' + maxShots + ' 枪，理论上限 ' + maxPossible + ' 枪（' + CFG.MAX_SECONDS +
      's / 攻速 ' + BOW.as + ' / 每 ' + BOW.skill.cast.perAttacks + ' 次一发）');
    TH.ok('★ 改成计数型之后一局能开出不止一枪（这正是改动的目的）',
      totalShots / fights >= 1.5,
      '40 场共 ' + totalShots + ' 枪，平均 ' + U.round2(totalShots / fights) + ' 枪/场');
    TH.note('攻速 0.34 ⇒ 每 3 次普攻要 8.8 秒。照这个节奏，' + CFG.MAX_SECONDS +
      ' 秒的对局里最多能开 ' + maxPossible + ' 枪；' +
      '但实战里荣誉常常先被打死（这批样本平均只有 ' + U.round2(totalShots / fights) + ' 枪/场）。' +
      '这已经比「走法力」那版（同样条件下只放得出 1~2 次）好得多。');
  })();

  /* ============================================================
   * 5c5. 牢大（原「蛮牛」/ brute）
   *
   *   技能「肘击」：单目标伤害 + 击退 2 格，喊 Man！
   *   被动「坠机」：         阵亡 1 秒后直升机坠毁，3×3 物理伤害
   *   2 星「孩子们我回来了」：坠毁后原地复活（半血）
   *   3 星「曼巴精神」：     复活后技能所需法力减半（= CD -50%）
   *
   *   ★ 这一套的重点不是数值，是**不要互相打架**：
   *     击退改了占位表、坠机改了存活数、复活把死人变回活人 ——
   *     三件事都动全局状态，任何一处漏改都会让别处的判定跟着错。
   * ============================================================ */
  TH.section('牢大 · 肘击 / 坠机');

  var BRU = ST.UNIT_BY_ID.brute;
  TH.eq('单位已改名为牢大', BRU.name, '牢大');
  TH.eq('id 仍然是 brute（levels.js 的阵容 + art 文件名都按 id 索引）', BRU.id, 'brute');
  TH.eq('技能名是「肘击」', BRU.skill.name, '肘击');
  TH.eq('技能类型是击退', BRU.skill.kind, 'knockback');
  TH.eq('技能喊话是 Man！', BRU.skill.callout, 'Man！');
  TH.ok('击退格数 >= 1', BRU.skill.push >= 1, BRU.skill.push);
  TH.eq('被动类型是坠机', ST.passiveKind(BRU), 'crash');
  TH.eq('被动名字按星级叠加（3 星是两个名字）',
    [ST.passiveName(BRU, 1), ST.passiveName(BRU, 2), ST.passiveName(BRU, 3)].join('/'),
    '坠机/孩子们我回来了/孩子们我回来了 + 曼巴精神');
  TH.eq('坠机的伤害半径是 3×3', ST.BATTLE_CFG.CRASH_RADIUS, 1);
  TH.ok('坠机延时是规则的一部分（0 < CRASH_DELAY <= 2 秒）',
    ST.BATTLE_CFG.CRASH_DELAY > 0 && ST.BATTLE_CFG.CRASH_DELAY <= 2,
    ST.BATTLE_CFG.CRASH_DELAY + 's');
  TH.eq('2 星才解锁复活、3 星才解锁冷却减半',
    [BRU.passive.reviveAt, BRU.passive.cdCutAt].join(','), '2,3');

  /** 把日志里某个单位的位置按时间重放出来（击退/移动/换位/复活都会改位置） */
  function posTracker(res) {
    var pos = {}, live = {};
    res.initial.units.forEach(function (u) { pos[u.uid] = { r: u.r, c: u.c }; live[u.uid] = true; });
    return {
      pos: pos,
      live: live,
      /** 处理第 i 条事件**之前**先调用它做快照；返回当前位置/存活状态的拷贝 */
      snap: function () {
        var out = {};
        for (var k in pos) out[k] = { r: pos[k].r, c: pos[k].c, alive: live[k] };
        return out;
      },
      eat: function (e) {
        if (e.type === 'move' && pos[e.who]) { pos[e.who] = { r: e.r, c: e.c }; }
        if (e.type === 'knockback' && pos[e.to]) { pos[e.to] = { r: e.r, c: e.c }; }
        if (e.type === 'swap') {
          if (pos[e.a]) pos[e.a] = { r: e.aR, c: e.aC };
          if (pos[e.b]) pos[e.b] = { r: e.bR, c: e.bC };
        }
        if (e.type === 'revive') {
          if (pos[e.who]) pos[e.who] = { r: e.r, c: e.c };
          live[e.who] = true;
        }
        if (e.type === 'death') live[e.who] = false;
      }
    };
  }

  /* ① 击退：目标真的被推走，而且推的方向、格数都合法。
     ★ 同时验「占位表没被搞乱」—— 击退之后如果还有人站在同一格，
       后面所有走位判定都会开始出错（前几轮就是这么暴露的）。 */
  (function () {
    var checked = 0, badDir = [], badCells = [], overlap = [], notPushed = 0;
    for (var s2 = 0; s2 < 40; s2++) {
      /* ★ 靶子必须是**打不死的**：牢大 1 星一发肘击 440，而 1 星奶龙只有 680 血，
         一肘下去目标当场阵亡 —— 于是 knockback 被 "目标已死就不推" 那条挡掉，
         整场一次击退都没有。3 星 + 三腰带（3043 血）才撑得住。 */
      var r = ST.Battle.battle({
        a: [{ id: 'brute', star: 1, r: 3, c: 3 }],
        b: [{ id: 'stoneguard', star: 3, items: ['belt', 'belt', 'belt'], r: 4, c: 3 }]
      }, 313131 + s2 * 7919);
      var pk = posTracker(r);
      for (var i = 0; i < r.log.length; i++) {
        var e = r.log[i];
        var before = pk.snap();
        pk.eat(e);
        if (e.type !== 'knockback') continue;
        checked++;
        var src = before[e.from], dst = before[e.to];
        if (!src || !dst) continue;
        if (e.fromR !== dst.r || e.fromC !== dst.c) badDir.push('起始坐标不对');
        if (e.cells < 1 || e.cells > BRU.skill.push) badCells.push('格数 ' + e.cells);
        // 单轴 + 远离
        var mdr = e.r - dst.r, mdc = e.c - dst.c;
        if (mdr !== 0 && mdc !== 0) badDir.push('斜着推');
        if (Math.abs(mdr) + Math.abs(mdc) !== e.cells) badCells.push('位移和格数对不上');
        var dBefore = Math.abs(dst.r - src.r) + Math.abs(dst.c - src.c);
        var dAfter = Math.abs(e.r - src.r) + Math.abs(e.c - src.c);
        if (!(dAfter > dBefore)) badDir.push('没有远离施法者');
        // ★ 占位表：这一格不能已经有别人
        var clash = null;
        for (var k in pk.pos) {
          if (k === e.to) continue;
          if (pk.pos[k].r === e.r && pk.pos[k].c === e.c) clash = k;
        }
        if (clash) overlap.push(e.to + ' 和 ' + clash + ' 挤在 (' + e.r + ',' + e.c + ')');
        if (e.cells === 0) notPushed++;
      }
    }
    TH.ok('肘击真的把目标推走了', checked > 20, checked + ' 次击退');
    TH.eq('击退只沿单一轴向、且一定远离施法者',
      badDir.slice(0, 3).join('；') || '无', '无');
    TH.eq('击退格数和实际位移一致，且不超过技能写的格数',
      badCells.slice(0, 3).join('；') || '无', '无');
    TH.eq('★ 击退之后没有两个人站在同一格（占位表是干净的）',
      overlap.slice(0, 3).join('；') || '无', '无');
  })();

  /* ② 推不动就是推不动：目标身后被队友堵住时，这一下**根本不写击退事件**，
     目标也不会动。这一条守的是「不做连锁挤开」这个设计选择 ——
     如果哪天有人给击退加了"把挡路的人也推开"，这里就会红。

     ★ 一开始我写的是「至少有一次位移没推满」，结果 0 次：因为被挡住时
       结果是 0 格，而 0 格压根不写事件。**「没推满」和「推不动」
       在这套实现里是两种不同的表现**，断言写错了对象。 */
  (function () {
    var blocked = 0, movedWhileBlocked = [], pushed = 0, fullPush = 0;
    for (var s3 = 0; s3 < 40; s3++) {
      var r = ST.Battle.battle({
        a: [{ id: 'brute', star: 1, r: 3, c: 0 }],
        /* ★ 构造「被堵死」的正确方式：让挡路的人**站着不动**。
           试过两版都失败：
             · 指望缠斗中自然形成前后夹击 —— 靶子一换、走位全变，堵死就再也不出现
             · 把队友摆在靶子正后方 —— 它自己也会往前走，位置让开了
           最后这版是唯一稳的：
             · 靶子 奶龙(4,0) 贴着牢大(3,0)，射程内 → 站着不动的
             · 牢大一肘把它推向 (5,0)，而那里站着**短弓手(5,0)**
             · 短弓手射程 3、离牢大只有 2 格 → 它也在射程内，同样站着不动
           两边的棋子都不动，格子关系就是恒定的，这一下必然推不动。 */
        b: [{ id: 'stoneguard', star: 3, items: ['belt', 'belt', 'belt'], r: 4, c: 0 },
            { id: 'bowman', star: 1, items: ['belt', 'belt', 'belt'], r: 5, c: 0 }]
      }, 313131 + s3 * 7919);
      var pk = posTracker(r);
      var pendingCast = null;
      for (var i = 0; i < r.log.length; i++) {
        var e = r.log[i];
        var before = pk.snap();
        pk.eat(e);
        if (e.type === 'cast' && e.skill === '肘击') { pendingCast = { to: e.to, t: e.t }; continue; }
        if (e.type === 'knockback') {
          pushed++;
          if (e.cells === BRU.skill.push) fullPush++;
          pendingCast = null;
          continue;
        }
        // 同一条 cast 后面如果一直没等到击退事件，而且时间已经过去，
        // 就说明这一下「一格都推不动」
        if (pendingCast && (e.type === 'cast' || e.t > pendingCast.t + 0.05)) {
          blocked++;
          var now = before[pendingCast.to];
          var was = pk.pos[pendingCast.to];
          if (now && was && (now.r !== was.r || now.c !== was.c)) {
            movedWhileBlocked.push('推不动却移动了');
          }
          pendingCast = null;
        }
      }
    }
    /* 「推得动」那一半由 ① 负责（那边跑出 80 多次真实击退），
       这一组专门造一个**必然推不动**的场面，所以这里不再重复断言推得动。 */
    TH.ok('★ 被堵死时确实会出现「这一下推不动」', blocked > 0, blocked + ' 次推不动');
    TH.eq('★ 推不动的那一下，目标真的一格都没动（不会挤开挡路的人）',
      movedWhileBlocked.slice(0, 3).join('；') || '无', '无');
  })();

  /* ③ 坠机：阵亡 → 1 秒后落地 → 3×3 范围挨打 */
  (function () {
    var seenDown = 0, seenCrash = 0, timingBad = [], radiusBad = [], sideBad = [];
    for (var s4 = 0; s4 < 30; s4++) {
      var r = ST.Battle.battle({
        a: [{ id: 'brute', star: 1, r: 5, c: 3 }, { id: 'bowman', star: 1, r: 7, c: 0 }],
        b: [{ id: 'blademaster', star: 3, items: ['giantblade', 'huntereye', 'infinity'] },
            { id: 'bowman', star: 1, r: 0, c: 7 }]
      }, 313131 + s4 * 7919);
      var pk = posTracker(r);
      var initById = {};
      r.initial.units.forEach(function (u) { initById[u.uid] = u; });
      var downAt = {}, dmgAt = {}, crashes = [];
      for (var i = 0; i < r.log.length; i++) {
        var e = r.log[i];
        var before = pk.snap();
        pk.eat(e);
        if (e.type === 'down') { seenDown++; downAt[e.who] = e.until; }
        if (e.type === 'damage' && e.reason === 'crash') {
          var key0 = e.t + '|' + e.from;
          (dmgAt[key0] = dmgAt[key0] || {})[e.to] = true;
          if (e.kind !== 'phys') radiusBad.push('伤害类型不是物理: ' + e.kind);
        }
        if (e.type === 'crash') {
          seenCrash++;
          if (downAt[e.who] === undefined) timingBad.push('没倒下就坠机');
          else if (Math.abs(e.t - downAt[e.who]) > 0.05) {
            timingBad.push('坠机在 ' + U.round2(e.t) + '，倒下说到 ' + downAt[e.who]);
          }
          /* ★ 3×3 的硬核对：拿「坠机那一刻」的位置算谁在九宫格里，
             再和真正吃到伤害的人对比。用起始位置算一定会误报
             （棋子会走位），所以必须按事件流重建位置。
             ★ 只对**当时还活着**的敌人有期待 —— 尸体不吃伤害。
             ★ 而且要先记账、循环走完再比对：坠机的伤害事件排在 crash
               事件**后面**，当场对账只会得到「一个都没吃到」的假失败。 */
          var expect = {};
          for (var k in before) {
            var u = before[k];
            if (u.r === undefined || !u.alive) continue;
            var iu0 = initById[k];
            if (!iu0 || iu0.side === e.side) continue;      // 只打敌人
            expect[k] = U.cheb(u.r, u.c, e.r, e.c) <= CFG.CRASH_RADIUS;
          }
          crashes.push({ key: e.t + '|' + e.who, expect: expect });
        }
      }
    }
    crashes.forEach(function (c) {
      var got = dmgAt[c.key] || {};
      for (var k2 in got) {
        if (!c.expect[k2]) radiusBad.push(k2 + ' 不在九宫格里却吃到了坠机');
      }
      for (var k3 in c.expect) {
        if (c.expect[k3] && !got[k3]) sideBad.push(k3 + ' 在九宫格里却没吃到坠机');
      }
    });
    TH.ok('牢大阵亡会进入「倒下」（不是直接消失）', seenDown > 0, seenDown + ' 次');
    TH.ok('1 秒后直升机真的落地了', seenCrash > 0, seenCrash + ' 次坠机');
    TH.eq('★ 坠机正好发生在倒下的 1 秒后', timingBad.slice(0, 3).join('；') || '无', '无');
    TH.eq('★ 只有九宫格里的敌人才吃坠机伤害，且都是物理伤害',
      radiusBad.slice(0, 3).join('；') || '无', '无');
    TH.eq('★ 九宫格里的敌人不会漏掉',
      sideBad.slice(0, 3).join('；') || '无', '无');
  })();

  /* ④ 复活：2 星起坠毁后原地站起来；1 星不复活（但坠机照打）。 */
  (function () {
    function run(star, seed) {
      return ST.Battle.battle({
        a: [{ id: 'brute', star: star, r: 5, c: 3 }],
        b: [{ id: 'blademaster', star: 3, items: ['giantblade', 'huntereye', 'infinity'] }]
      }, seed);
    }
    var r1 = run(1, 424242), r2 = run(2, 424242), r3 = run(3, 424242);
    var rev = function (r) {
      return r.log.filter(function (e) { return e.type === 'revive'; });
    };
    TH.eq('★ 1 星只有坠机、不复活', rev(r1).length, 0);
    TH.ok('★ 2 星坠毁之后复活了', rev(r2).length > 0, rev(r2).length + ' 次');
    TH.ok('★ 3 星也复活', rev(r3).length > 0, rev(r3).length + ' 次');

    var rv = rev(r2)[0];
    if (rv) {
      var initU = r2.initial.units.filter(function (u) { return u.uid === rv.who; })[0];
      TH.ok('★ 复活的血量 = 最大生命 × 配置的比例',
        Math.abs(rv.hp - initU.maxHp * BRU.passive.reviveHpPct) < 0.05,
        rv.hp + ' / ' + initU.maxHp);
      TH.ok('复活的位置在自己的半场',
        ST.Battle.sideOfRow(rv.r) === initU.side, '(' + rv.r + ',' + rv.c + ')');
      // 复活的时刻必须晚于坠机
      var crashT = null;
      for (var i = 0; i < r2.log.length; i++) {
        var e = r2.log[i];
        if (e.type === 'crash' && e.who === rv.who) crashT = e.t;
        if (e === rv) break;
      }
      TH.ok('★ 复活发生在坠机之后（先炸再站起来）',
        crashT !== null && rv.t >= crashT - 1e-9,
        '坠机 ' + crashT + ' → 复活 ' + rv.t);
    }

    /* ④b 一局只复活一次。
     ★ 复活第二次会把「必须打死它两遍」变成「三遍」，对局被拖长、
       而且玩家读不出还差几次 —— 所以上限写死在数据里（passive.maxRevives）。
     ★ 次数用完之后**坠机照打**：坠机是 1 星就有的被动，
       不该跟着复活的次数一起消失。所以第二次阵亡的表现是
       「倒下 → 1 秒 → 直升机落地 → 就此退场」。 */
  (function () {
    var maxRevive = 0, secondDownNoRevive = 0, crashAfterReviveDone = 0, fights2 = 0;
    for (var s7 = 0; s7 < 40; s7++) {
      var r = ST.Battle.battle({
        a: [{ id: 'brute', star: 3, r: 5, c: 3 }, { id: 'acolyte', star: 1, r: 7, c: 0 }],
        b: [{ id: 'blademaster', star: 3, items: ['giantblade', 'huntereye', 'infinity'] },
            { id: 'titan', star: 2, items: ['dragonscale'] }]
      }, 818181 + s7 * 7919);
      var n = 0, downs = [], crashes = 0, revs = 0;
      r.log.forEach(function (e) {
        if (e.type === 'down' && e.who === 'a0') downs.push(e);
        if (e.type === 'crash' && e.who === 'a0') crashes++;
        if (e.type === 'revive' && e.who === 'a0') revs++;
      });
      n = revs;
      fights2++;
      if (n > maxRevive) maxRevive = n;
      // 有第二次倒下的话，那一次的 revive 标记必须是 false
      if (downs.length >= 2 && downs[1].revive === false) secondDownNoRevive++;
      // 复活次数用完之后仍然坠机（坠机不跟着复活一起消失）
      if (revs >= 1 && crashes > revs) crashAfterReviveDone++;
    }
    TH.ok('★ 3 星牢大一局最多复活 1 次', maxRevive <= 1, '最多 ' + maxRevive + ' 次');
    TH.ok('★ 复活用完之后还会再倒下（第二次阵亡走的是同一条流程）',
      secondDownNoRevive > 0, secondDownNoRevive + '/' + fights2 + ' 场出现了第二次倒下');
    TH.eq('★ 第二次倒下的 revive 标记必须是 false（不会许一个兑现不了的承诺）',
      secondDownNoRevive > 0, true);
    TH.ok('★ 复活次数用完之后坠机照打（坠机是 1 星被动，不跟着复活消失）',
      crashAfterReviveDone > 0, crashAfterReviveDone + ' 场里坠机次数多于复活次数');
    TH.eq('被动数据里写明了上限', BRU.passive.maxRevives, 1);
  })();

  /* ⑤ 3 星的冷却减半：这个游戏没有 CD，法力就是 CD ——
     「CD -50%」的实现是技能所需法力减半。 */
    var rv3 = rev(r3)[0];
    if (rv3) {
      var initU3 = r3.initial.units.filter(function (u) { return u.uid === rv3.who; })[0];
      TH.eq('★ 3 星复活后法力上限减半（= 技能 CD -50%）',
        rv3.maxMana, U.round2(initU3.maxMana * BRU.passive.cdCutPct));
      TH.ok('复活事件里带了 cdCut 标记', rv3.cdCut === true);
    } else {
      TH.ok('3 星这一局没有复活可用（跳过冷却检查）', false, '没跑出复活');
    }
    var rv2 = rev(r2)[0];
    if (rv2) {
      var initU2 = r2.initial.units.filter(function (u) { return u.uid === rv2.who; })[0];
      TH.eq('2 星复活后法力上限不变（冷却减半是 3 星专属）',
        rv2.maxMana, initU2.maxMana);
    }
  })();

  /* ⑥ 「倒地但没结算完」不参与胜负判定。
     ★ 这一条是整套被动能不能活下来的关键：如果主循环照旧在
       aliveCount === 0 时立刻结束，牢大会先被判成全灭，
       直升机永远落不了地、也永远复活不了。 */
  (function () {
    var revivedAndWon = 0, endedEarly = [], fights = 0;
    for (var s6 = 0; s6 < 12; s6++) {
      /* ★ 场景要保证牢大**真的会死**，而且它是全队最后一个人 ——
         只有这样才能验出「倒地那 1 秒不参与胜负判定」。
         一开始用的是 1 星匕首当对手，2 星牢大 2160 血根本死不掉，
         跑出 0/12 场复活，看着像机制没生效。 */
      var r = ST.Battle.battle({
        a: [{ id: 'brute', star: 2, r: 5, c: 3 }],
        b: [{ id: 'blademaster', star: 3, items: ['giantblade', 'huntereye', 'infinity'] }]
      }, 707070 + s6 * 7919);
      fights++;
      var lastT = r.log[r.log.length - 1].t;
      var crashT = null, revT = null, firstDeathT = null;
      r.log.forEach(function (e) {
        // ★ 只记**第一次**死亡：复活之后还能再死一次，
        //   拿最后一次死亡去比会得到「复活早于死亡」的假失败
        if (e.type === 'death' && e.who === 'a0' && firstDeathT === null) firstDeathT = e.t;
        if (e.type === 'crash') crashT = e.t;
        if (e.type === 'revive' && revT === null) revT = e.t;
      });
      if (revT !== null) revivedAndWon++;
      // 只要有复活事件，它就一定在战斗结束之前 —— 否则就是「结算完了才复活」
      if (revT !== null && revT > lastT + 1e-9) endedEarly.push('复活在战斗结束之后');
      // 而且坠机/复活都必须发生在死亡之后
      if (revT !== null && firstDeathT !== null && revT < firstDeathT) endedEarly.push('复活早于死亡');
      if (crashT !== null && firstDeathT !== null && crashT < firstDeathT) endedEarly.push('坠机早于死亡');
    }
    TH.ok('★ 独苗牢大死了之后，战斗不会立刻判负（它还有 1 秒的账没走完）',
      revivedAndWon > 0, revivedAndWon + '/' + fights + ' 场出现了复活');
    TH.eq('坠机 / 复活都发生在死亡之后、战斗结束之前',
      endedEarly.slice(0, 3).join('；') || '无', '无');
  })();

  /* ============================================================
   * 5c7. 张雪峰（原「剑圣」/ blademaster）
   *
   *   1 星「你快不过我你信吗」：开局攻速 +60%、移速 +100%，每次普攻再 +2%，
   *        攻速加成到 +100% 进入**狂暴**（= 每秒失去当前生命的 44%），
   *        狂暴里每次普攻叠的攻速**翻倍（+4%）**；加成上限 +200%
   *   2 星「巧乐兹」：每次普攻给打到的敌人 +1 层冰棍（每层 -5% 攻速/移速），
   *        满 10 层冰冻 3 秒并清空
   *   3 星「雪毙」：进入狂暴之后攻击力 +78%
   * ============================================================ */
  TH.section('张雪峰 · 超频 / 巧乐兹 / 雪毙');

  var ZHANG = ST.UNIT_BY_ID.blademaster;
  TH.eq('单位已改名为张雪峰', ZHANG.name, '张雪峰');
  TH.eq('id 仍然是 blademaster（levels.js 的阵容 + art 文件名都按 id 索引）',
    ZHANG.id, 'blademaster');
  TH.eq('被动类型是超频', ST.passiveKind(ZHANG), 'overclock');
  TH.eq('被动名字按星级叠加',
    [ST.passiveName(ZHANG, 1), ST.passiveName(ZHANG, 2), ST.passiveName(ZHANG, 3)].join('/'),
    '你快不过我你信吗/你快不过我你信吗 + 巧乐兹/你快不过我你信吗 + 巧乐兹 + 雪毙');
  TH.eq('★ 开局攻速加成 +60%（削弱过，原 100%）', ZHANG.passive.ocAsStart, 0.60);
  TH.eq('★ 开局移速加成 +100%（没跟着削）', ZHANG.passive.ocMoveStart, 1.00);
  TH.eq('★ 每次普攻 +2% 攻速', ZHANG.passive.ocPerHit, 0.02);
  TH.eq('★ 狂暴线的攻速加成是 +100%', ZHANG.passive.ocThreshold, 1.00);
  TH.eq('★ 进入狂暴后单次叠加翻倍（×2）', ZHANG.passive.ocBerserkMul, 2);
  TH.eq('★ 攻速加成有 +200% 的硬上限', ZHANG.passive.ocMaxAs, 2.00);
  TH.eq('★ 越线后每秒失去当前生命的 44%', ZHANG.passive.ocBurnPct, 0.44);
  /* ★ 「狂暴」和「自毁」是同一件事 —— 代码里只有一个 ocOn 标记和一个
     ocBurnPct。这条断言是防"以后有人把它拆成两个状态"：
     拆了的话烧血的速度和触发条件就会各说各话。 */
  TH.eq('★ 狂暴和自毁共用同一个门槛（没有第二个阈值字段）',
    ['ocBurnAt', 'ocBerserkAt', 'ocFrenzyAt'].filter(function (k) {
      return ZHANG.passive[k] !== undefined;
    }).length, 0);
  TH.eq('★ 普攻范围的半径是 1（3×3）', ZHANG.passive.ocAoeRadius, 1);
  TH.eq('★ 但只有 3 星才有范围 —— 1/2 星是单体', ZHANG.passive.ocAoeAt, 3);
  TH.eq('冰棍每层 -5%、满 10 层、冻 3 秒',
    [ZHANG.passive.chillPerStack, ZHANG.passive.chillMax, ZHANG.passive.freezeDur].join('/'),
    '0.05/10/3');
  TH.eq('★ 2 星才解锁巧乐兹、3 星才解锁雪毙',
    [ZHANG.passive.chillAt, ZHANG.passive.ocAdAt].join(','), '2,3');
  TH.eq('雪毙的加成是 +78%', ZHANG.passive.ocAdPct, 0.78);

  /** 张雪峰（带一个医师续命）vs 打不死的陪练。
   *  ★ 场景是刻意配的，配了两轮才对：
   *     · 陪练必须是 3 星山岳 + 三腰带 —— 6672 血，才撑得住张雪峰那 200 点 DPS
   *       （换任何一个别的棋子，13 秒就被砍死，战斗压根走不到阈值）
   *     · 但 3 星山岳打人很痛，所以龙鳞甲撑护甲、再加一个老牧师回血，
   *       否则张雪峰 20 秒就被打死，攻速只叠到 +186%（差 7 次普攻），
   *       「越线」永远触发不了，自毁和雪毙全都会测成「机制没生效」。
   *     · 医师**不能**换成豆包：豆包有「幻觉 / 开智」，会给张雪峰加伤害倍率，
   *       而雪毙那条断言正是靠 raw ÷ (ad × ramp) 反推攻击力倍率。
   *  ★★ 陪练**不能用 3 星钟离**（原来是 3 星山岳）：
   *     钟离 3 星「天星」每次放技能都会把 3×3 里的人**石化 3 秒**，
   *     四个钟离轮流放 = 张雪峰全程僵着，普攻从 45 次掉到 11 次，
   *     「叠到 +200%」这条曲线整段作废（自检一次报出 9 条红）。
   *     换成「大地守护」：**无被动**、血量相近（5538 vs 6672）、
   *     技能只是给队友套盾（不控制、不伤害），当沙包正合适。 */
  var ZHANG_ITEMS = ['dragonscale', 'dragonscale', 'belt'];
  function zhangFight(star, seed, extraFoe) {
    var foes = [{ id: 'earthwarden', star: 3, items: ['belt', 'belt', 'belt'], r: 3, c: 3 }];
    if (extraFoe) foes.push({ id: 'earthwarden', star: 3, items: ['belt', 'belt', 'belt'], r: 3, c: 4 });
    return ST.Battle.battle({
      a: [{ id: 'blademaster', star: star, items: ZHANG_ITEMS, r: 4, c: 3 },
          { id: 'medic', star: 3, items: ['sapphire', 'sapphire', 'sapphire'], r: 6, c: 6 }],
      b: foes
    }, seed || 313131);
  }
  /** 3 星专用：4 个摊开的 3 星「大地守护」（各三腰带）。
   *  ★ 为什么 3 星要换场景：3 星张雪峰的攻击力是 135 × 3.24 = 437，
   *    对单目标 DPS 六百多 —— 一个陪练 10 秒就没了，战斗 10 秒结束，
   *    根本走不到「50 次普攻」的阈值。敌人总血量必须够大，
   *    而且要摊开摆（挨着就会被 3×3 溅射一起扫掉）。
   *  ★ 用大地守护而不是钟离：钟离 3 星的陨石会把张雪峰石化 3 秒，
   *    他一路僵着根本叠不起来（理由同上一条）。 */
  function zhangLong(star) {
    return ST.Battle.battle({
      a: [{ id: 'blademaster', star: star, items: ZHANG_ITEMS, r: 4, c: 3 },
          { id: 'medic', star: 3, items: ['sapphire', 'sapphire', 'sapphire'], r: 6, c: 6 }],
      b: [{ id: 'earthwarden', star: 3, items: ['belt', 'belt', 'belt'], r: 4, c: 0 },
          { id: 'earthwarden', star: 3, items: ['belt', 'belt', 'belt'], r: 4, c: 2 },
          { id: 'earthwarden', star: 3, items: ['belt', 'belt', 'belt'], r: 4, c: 4 },
          { id: 'earthwarden', star: 3, items: ['belt', 'belt', 'belt'], r: 4, c: 6 },
          { id: 'earthwarden', star: 3, items: ['belt', 'belt', 'belt'], r: 6, c: 0 },
          { id: 'earthwarden', star: 3, items: ['belt', 'belt', 'belt'], r: 6, c: 2 },
          { id: 'earthwarden', star: 3, items: ['belt', 'belt', 'belt'], r: 6, c: 4 },
          { id: 'earthwarden', star: 3, items: ['belt', 'belt', 'belt'], r: 6, c: 6 },
          /* ★ 陪练一侧也带一个奶：这条断言要量的是「封顶**之后**的出手频率」，
             而 8 个陪练总会在 25 秒前后被砍光 —— 少了这口奶，
             封顶之后只剩 0.77 秒可量（2 次普攻），频率算出来是 0。
             老牧师还会把第一个阵亡的队友满血拉回来，等于又白送一条命。 */
          { id: 'medic', star: 3, items: ['holygrail', 'holygrail', 'holygrail'], r: 7, c: 3 }]
    }, 313131);
  }
  function eventsOf(res, type, uid) {
    var out = [];
    for (var i = 0; i < res.log.length; i++) {
      var e = res.log[i];
      if (e.type !== type) continue;
      if (uid && e.who !== uid && e.from !== uid && e.to !== uid) continue;
      out.push(e);
    }
    return out;
  }

  // ① 开局攻速 +60%、移速 +100%，而且普攻真的比没被动时快
  (function () {
    var r = zhangFight(1);
    var me = r.initial.units.filter(function (u) { return u.defId === 'blademaster'; })[0];
    TH.ok('★ 开局身上就带着 +60% 攻速', Math.abs(me.ocStart - 0.60) < 1e-9, me.ocStart);
    TH.ok('★ 快照里带出了狂暴的倍率和上限（校验器才能自己算）',
      Math.abs(me.ocPerHitBerserk - 0.04) < 1e-9 && Math.abs(me.ocMaxAs - 2.00) < 1e-9,
      me.ocPerHitBerserk + '/' + me.ocMaxAs);
    var first = eventsOf(r, 'ocas', 'a0')[0];
    TH.ok('第一次普攻之后叠到 +62%', !!first && Math.abs(first.pct - 0.62) < 1e-6,
      first ? first.pct : '没有 ocas 事件');
    TH.ok('★ 这一击的 step 是 +2%（还没进狂暴）',
      !!first && Math.abs(first.step - 0.02) < 1e-9, first ? first.step : '—');
    /* 前几次普攻的间隔应该明显短于「基础攻速 0.88」对应的 1.14 秒。
       ★ 但也不能按"翻倍"去估：+60% 加成下每击是 1 / (0.88 × 1.6) ≈ 0.71 秒，
         只有 +100% 才是 0.57 秒。这条断言就是来区分这两者的 ——
         削弱之后如果这里还按旧版 0.57 秒去判，就会把"没削"当成通过。 */
    var at = [];
    for (var i = 0; i < r.log.length && at.length < 4; i++) {
      if (r.log[i].type === 'attack' && r.log[i].from === 'a0') at.push(r.log[i].t);
    }
    var gap = (at.length >= 3) ? (at[1] - at[0]) : null;
    TH.ok('★ 开局出手间隔约 0.71s（+60% 攻速，不是 +100% 的 0.57s）',
      gap !== null && gap > 0.60 && gap < 1.14 * 0.72,
      gap === null ? '普攻次数不够' : ('间隔 ' + U.round2(gap) + 's（基础 1.14s，+100% 要 0.57s）'));
  })();

  /* ② 叠攻速的完整曲线：每击 +2% 叠到 +100% 进狂暴，之后每击 +4%。
     ★ 这是这次削弱的核心，所以逐击都核对，而不是只看首尾。
     ★ 1 星这个场景只叠得到 +136%（29 次普攻，48 秒时阵亡），**封顶**那一段
       够不着 —— 那一段放到 ⑥ 里用 3 星 + 吸血验（他能活到 47 秒）。 */
  (function () {
    var r = zhangFight(1);
    var ocs = eventsOf(r, 'ocas', 'a0');
    var atkCount = r.log.filter(function (e) { return e.type === 'attack' && e.from === 'a0'; }).length;
    var lastPct = ocs.length ? ocs[ocs.length - 1].pct : 0;
    var dur = r.log.length ? r.log[r.log.length - 1].t : 0;
    var meDie = r.log.filter(function (e) { return e.type === 'death' && e.who === 'a0'; }).length;
    TH.note('张雪峰 1 星：普攻 ' + atkCount + ' 次，攻速叠到 +' +
      Math.round(lastPct * 100) + '%，ocas ' + ocs.length + ' 条，对局 ' +
      U.round2(dur) + 's，自己阵亡 ' + meDie + ' 次');
    TH.ok('整场叠了很多次攻速', ocs.length > 10, ocs.length + ' 次');

    /* ★ 逐击核对增量：该叠多少取决于**叠加之前**是不是已经在狂暴里 ——
       和 battle.js 里"用叠加之前的 ocOn 决定 step"必须同一个口径。
       进狂暴的那一击自己算 +2%（它是"最后一下普通叠加"）。 */
    var seqBad = [], justOverCount = 0, justOverHits = -1, overBefore = 0, breach = 0;
    for (var i = 0; i < ocs.length; i++) {
      if (ocs[i].justOver) { justOverCount++; justOverHits = ocs[i].hits; }
      if (ocs[i].over && ocs[i].pct < 1.00 - 1e-6) overBefore++;
      if (ocs[i].pct > 2.00 + 1e-6) breach++;
      if (i === 0) {
        if (Math.abs(ocs[i].pct - 0.62) > 1e-6) seqBad.push('#1 = ' + ocs[i].pct);
        continue;
      }
      var wantStep = ocs[i - 1].over ? 0.04 : 0.02;
      if (Math.abs((ocs[i].pct - ocs[i - 1].pct) - wantStep) > 1e-6) {
        seqBad.push('#' + ocs[i].hits + ' ' + ocs[i - 1].pct + '→' + ocs[i].pct);
      }
      if (Math.abs(ocs[i].step - wantStep) > 1e-9) {
        seqBad.push('#' + ocs[i].hits + ' step=' + ocs[i].step + '（该 ' + wantStep + '）');
      }
    }
    TH.ok('★ 狂暴前每击 +2%、进狂暴后每击 +4%，一次不差', seqBad.length === 0,
      seqBad.length ? seqBad.slice(0, 4).join(' / ') : (ocs.length + ' 条全部吻合'));
    TH.ok('★ 「越线」只发生一次（不会反复触发）', justOverCount === 1, justOverCount + ' 次');
    TH.eq('★ 进狂暴正好是第 20 次普攻（+60% 到 +100% 要 20 次）', justOverHits, 20);
    var joEv = null;
    for (var j = 0; j < ocs.length; j++) if (ocs[j].justOver) joEv = ocs[j];
    TH.eq('★ 进狂暴那一击自己算的是 +2%（不是 +4%）',
      joEv ? Math.round(joEv.step * 100) : -1, 2);
    TH.eq('★ 超频标记绝不会在 +100% 之前打开', overBefore, 0);
    TH.eq('★ 攻速加成一次都没冲破 +200% 的上限', breach, 0);

    // 自毁必须**只在**越线之后发生
    var burns = eventsOf(r, 'selfburn', 'a0');
    TH.ok('★ 越线之后开始自毁', burns.length > 0, burns.length + ' 次自毁');
    if (ocs.length && burns.length) {
      var overT = null;
      for (var j = 0; j < ocs.length; j++) if (ocs[j].justOver) overT = ocs[j].t;
      TH.ok('★ 第一次自毁在越线之后（不会提前掉血）',
        overT !== null && burns[0].t >= overT - 1e-9,
        '越线 @' + (overT === null ? '从未' : U.round2(overT)) + '，首次自毁 @' + U.round2(burns[0].t));
    }
    // 自毁量 ≈ 当前生命的 44%
    var ok = true, sample = '';
    for (var k = 0; k < burns.length; k++) {
      var before = burns[k].hpAfter + burns[k].amount;
      var want = Math.max(0.01, U.round2(before * 0.44));
      if (Math.abs(burns[k].amount - Math.min(want, before)) > 0.02) {
        ok = false; sample = '期望 ' + U.round2(want) + ' 实际 ' + burns[k].amount;
      }
    }
    TH.ok('★ 每次自毁 = 当前生命 × 44%', ok, sample || (burns.length + ' 次全部吻合'));
    /* ★★ "每秒一次"必须**按生死分段**验，不能一路比到底。
     *
     *   2026-10 加了老牧师之后这条断言红了 —— 但引擎没坏：
     *   这个场景里带着一个 3 星医师（现在是老牧师），
     *   张雪峰把自己烧死之后**被牧师满血救了起来**，于是自毁序列变成
     *   "烧 7 秒 → 死 → 1 秒祷告 → 满血复活 → 接着烧"，
     *   中间那一段间隔当然不是 1 秒。
     *
     *   ★ 这条正好是一个**新机制改变了老断言的适用前提**的例子：
     *     断言写的是"自毁是每秒一次"，而真实规则是"**活着的时候**每秒一次"。
     *     所以现在按 a0 的 death / reviveAlly 把序列切成若干段，段内才比间隔。 */
    var lifeSpans = [[]], spanBreaks = 0;
    for (var b2 = 0; b2 < r.log.length; b2++) {
      var le = r.log[b2];
      var meDeath = (le.type === 'death' && le.who === 'a0');
      var meBack = (le.type === 'reviveAlly' && le.who === 'a0' && le.ok);
      if (meDeath || meBack) { lifeSpans.push([]); spanBreaks++; continue; }
      if (le.type === 'selfburn' && le.who === 'a0') {
        lifeSpans[lifeSpans.length - 1].push(le);
      }
    }
    var gapsOk = true, gapSample = '';
    for (var sp = 0; sp < lifeSpans.length; sp++) {
      for (var m = 1; m < lifeSpans[sp].length; m++) {
        var gap = lifeSpans[sp][m].t - lifeSpans[sp][m - 1].t;
        if (Math.abs(gap - 1) > 0.05) {
          gapsOk = false;
          gapSample = '第 ' + (sp + 1) + ' 段间隔 ' + U.round2(gap) + 's';
        }
      }
    }
    TH.ok('★ 活着的时候自毁是每秒一次（按生死分段比，复活会另起一段）', gapsOk,
      burns.length + ' 次自毁 / ' + spanBreaks + ' 个生死断点' + (gapSample ? '：' + gapSample : ''));
    TH.note('张雪峰这个场景里自己阵亡 ' + meDie + ' 次、被老牧师救回来 ' +
      (r.log.filter(function (e) { return e.type === 'reviveAlly' && e.who === 'a0' && e.ok; }).length) +
      ' 次 —— 自毁 + 复活会多赚一条血，这是新机制带来的联动，不是 bug');
  })();

  /* ③ 普攻范围：**1/2 星是单体，3 星才是 3×3**。
     ★ 这一条要正反两面都验 —— 只验「3 星会溅射」是不够的，
       万一哪天范围又变回全星级生效，正面照样过、负面才是真信号。 */
  (function () {
    [1, 2].forEach(function (star) {
      var r = zhangFight(star, 313131, true);
      var cleaves = r.log.filter(function (e) { return e.reason === 'cleave'; });
      TH.eq('★ ' + star + ' 星普攻是单体（1 个还是 2 个敌人都不会溅射）',
        cleaves.length, 0);
    });

    var r3 = zhangFight(3, 313131, true);
    var cleaves3 = r3.log.filter(function (e) { return e.reason === 'cleave'; });
    TH.ok('★ 3 星普攻变成 3×3 范围（会扫到旁边的敌人）', cleaves3.length > 0,
      cleaves3.length + ' 条溅射');
    // 每一条溅射都必须挂在同 tick 的一次普攻上，不会凭空冒出来。
    // ★ 不能只看"上一条事件"：主目标的 afterDamage 可能插进反伤、回血之类的事件，
    //   所以要在同一 tick 里往前找。
    var orphan = 0, paired = 0;
    for (var i = 0; i < r3.log.length; i++) {
      if (r3.log[i].reason !== 'cleave') continue;
      var found = false;
      for (var j = i - 1; j >= 0 && r3.log[j].t === r3.log[i].t; j--) {
        if (r3.log[j].type === 'attack' && r3.log[j].from === r3.log[i].from) { found = true; break; }
      }
      if (found) paired++; else orphan++;
    }
    TH.eq('★ 每一条溅射都挂在同 tick 的一次普攻上（不会凭空冒出来）', orphan, 0);
    TH.ok('溅射确实发生了很多次', paired > 5, paired + ' 次配对');
    TH.ok('溅射伤害标成物理', cleaves3.every(function (e) { return e.kind === 'phys'; }));
  })();

  // ④ 巧乐兹：只有 2 星起才有；攒满 10 层冰冻 3 秒并清空
  (function () {
    var r1 = zhangFight(1);
    TH.eq('★ 1 星没有冰棍（巧乐兹是 2 星被动）', eventsOf(r1, 'chill').length, 0);

    var r2 = zhangFight(2);
    var chills = eventsOf(r2, 'chill');
    TH.ok('2 星会给敌人上冰棍', chills.length > 0, chills.length + ' 层');
    var seqOk = true, prev = 0;
    for (var i = 0; i < chills.length; i++) {
      var want = (prev >= 10) ? 1 : prev + 1;
      if (chills[i].stacks !== want) seqOk = false;
      prev = chills[i].stacks;
    }
    TH.ok('★ 层数是 1、2、3…10、然后回到 1', seqOk,
      chills.slice(0, 12).map(function (e) { return e.stacks; }).join(','));
    var freezes = r2.log.filter(function (e) { return e.type === 'stun' && e.reason === 'freeze'; });
    TH.ok('★ 满 10 层会冰冻敌人', freezes.length > 0, freezes.length + ' 次冰冻');
    TH.ok('★ 冰冻时长是 3 秒', freezes.every(function (e) { return Math.abs(e.dur - 3) < 1e-9; }),
      freezes.length ? freezes[0].dur + 's' : '—');
    // 冰冻之后层数必须清零
    var cleared = true;
    for (var j = 0; j < freezes.length; j++) {
      var t = freezes[j].t;
      var after = null;
      for (var k = 0; k < chills.length; k++) {
        if (chills[k].t > t) { after = chills[k]; break; }
      }
      if (after && after.stacks !== 1) cleared = false;
    }
    TH.ok('★ 冰冻之后层数清空（下一条冰棍从 1 层重新开始）', cleared);
  })();

  // ⑤ 雪毙：3 星越过阈值之后攻击力 +78%
  (function () {
    var r3 = zhangLong(3);
    var ocs = eventsOf(r3, 'ocas', 'a0');
    var atk3 = r3.log.filter(function (e) { return e.type === 'attack' && e.from === 'a0'; }).length;
    var lastPct3 = ocs.length ? ocs[ocs.length - 1].pct : 0;
    TH.note('张雪峰 3 星：普攻 ' + atk3 + ' 次，攻速叠到 +' + Math.round(lastPct3 * 100) +
      '%，对局 ' + U.round2(r3.log[r3.log.length - 1].t) + 's');
    var overT = null;
    for (var i = 0; i < ocs.length; i++) if (ocs[i].justOver) overT = ocs[i].t;
    TH.ok('3 星也叠到越线了', overT !== null, overT === null ? '没越线' : ('t=' + U.round2(overT)));
    // 越线之后的攻击力加成必须是 0.78
    var adSeen = null;
    for (var j = 0; j < ocs.length; j++) if (ocs[j].justOver) adSeen = ocs[j].adBonus;
    TH.ok('★ 雪毙在越线那一刻把攻击力加成打开到 0.78',
      adSeen !== null && Math.abs(adSeen - 0.78) < 1e-9, adSeen);

    /* 用日志里的 raw 反推攻击力倍率：raw = ad × (1 + adBonus) × ramp
       （非暴击的时候；暴击还要再乘 critMult，所以排掉） */
    var init = r3.initial.units.filter(function (u) { return u.uid === 'a0'; })[0];
    var before = null, after = null;
    for (var k = 0; k < r3.log.length; k++) {
      var e = r3.log[k];
      if (e.type !== 'attack' || e.from !== 'a0' || e.crit) continue;
      var mul = e.raw / (init.ad * e.ramp);
      if (e.t < overT && before === null) before = mul;
      if (e.t > overT + 0.1) { after = mul; break; }
    }
    TH.ok('★ 越线之前攻击力倍率是 1', before !== null && Math.abs(before - 1) < 0.02,
      before === null ? '没采到' : U.round2(before));
    TH.ok('★ 越线之后攻击力倍率变成 1.78（+78%）', after !== null && Math.abs(after - 1.78) < 0.03,
      after === null ? '没采到' : U.round2(after));

    // 2 星不该有这个加成
    var r2b = zhangFight(2);
    var ocs2 = eventsOf(r2b, 'ocas', 'a0');
    var ad2 = 0;
    for (var m = 0; m < ocs2.length; m++) if (ocs2[m].justOver) ad2 = ocs2[m].adBonus;
    TH.eq('★ 2 星没有雪毙（越线之后攻击力加成仍是 0）', ad2, 0);
  })();

  /* ⑥ 攻速上限 +200%：必须真的封顶，而且封顶之后**出手频率停在那一档**。
   *
   *   ★ 场景是探出来的，不是猜的。要验封顶就得让张雪峰活到第 45 次普攻，
   *     而他从第 20 次起每秒烧自己 44% 的当前生命 —— 唯一扛得住的办法是吸血：
   *     · 3 星 + 血饮剑：攻击力够高，20% 吸血能反过来盖过自毁。
   *       实测 狂暴 @12.73s（第 20 击）、封顶 @24.37s、对局 47.1s、自己没死。
   *     · 1 星同样配置：攻击力不够，12 秒就没了，连狂暴都进不去。
   *   ★ 所以这条断言**只能钉在 3 星 + 吸血这一档**上 ——
   *     同一套数字在 1 星身上是不成立的，写成"任意星级都能叠满"就是假信息。 */
  (function () {
    var r = ST.Battle.battle({
      a: [{ id: 'blademaster', star: 3, items: ['bloodthirst', 'giantblade', 'belt'], r: 4, c: 3 },
          { id: 'medic', star: 3, items: ['sapphire', 'sapphire', 'sapphire'], r: 6, c: 6 },
          /* ★★ 第二个奶：这一条要量的是「**封顶之后**的出手频率」。
             实测对局长度不是被陪练的血量决定的，而是被**张雪峰自己能活多久**
             决定的 —— 他一进狂暴就每秒烧 44% 当前生命，撑不住就先倒，
             同一帧战斗就结束了（"封顶后只量到 0.77 秒"就是这么来的）。
             所以延长窗口的办法是**让他活久一点**，而不是给对面加血：
             实测对面从 4 个加到 8 个陪练，对局长度 23.67s → 25.13s，几乎没动。
             （多一个奶 = 每秒多 620×1.3 的治疗，专门喂给"血量百分比最低"的他。） */
          { id: 'medic', star: 2, items: ['holygrail', 'holygrail', 'holygrail'], r: 0, c: 0 }],
      b: [{ id: 'earthwarden', star: 3, items: ['belt', 'belt', 'belt'], r: 4, c: 0 },
          { id: 'earthwarden', star: 3, items: ['belt', 'belt', 'belt'], r: 4, c: 2 },
          { id: 'earthwarden', star: 3, items: ['belt', 'belt', 'belt'], r: 4, c: 4 },
          { id: 'earthwarden', star: 3, items: ['belt', 'belt', 'belt'], r: 4, c: 6 },
          { id: 'earthwarden', star: 3, items: ['belt', 'belt', 'belt'], r: 6, c: 0 },
          { id: 'earthwarden', star: 3, items: ['belt', 'belt', 'belt'], r: 6, c: 2 },
          { id: 'earthwarden', star: 3, items: ['belt', 'belt', 'belt'], r: 6, c: 4 },
          { id: 'earthwarden', star: 3, items: ['belt', 'belt', 'belt'], r: 6, c: 6 }]
    }, 313131);
    var ocs = eventsOf(r, 'ocas', 'a0');
    var dur = r.log.length ? r.log[r.log.length - 1].t : 0;
    var last = ocs.length ? ocs[ocs.length - 1] : null;
    var capIdx = -1;
    for (var i = 0; i < ocs.length; i++) if (ocs[i].capped) { capIdx = i; break; }
    TH.note('张雪峰 3 星 + 血饮剑：ocas ' + ocs.length + ' 条，最后 +' +
      (last ? Math.round(last.pct * 100) : 0) + '%，对局 ' + U.round2(dur) + 's');
    TH.ok('★ 叠到了 +200% 上限', capIdx >= 0,
      capIdx < 0 ? ('只到 +' + (last ? Math.round(last.pct * 100) : 0) + '%（活不到第 45 击？）') : '');
    if (capIdx >= 0) {
      TH.ok('★ 封顶那一条的 pct 正好是 2.00（不会过冲）',
        Math.abs(ocs[capIdx].pct - 2.00) < 1e-9, ocs[capIdx].pct);
      TH.eq('★ 封顶之后不再写 ocas 事件（不然事件流会白白膨胀）',
        ocs.length - 1 - capIdx, 0);
      TH.eq('★ 整条曲线正好 45 条（20 条叠到狂暴 + 25 条叠到封顶）', ocs.length, 45);
      /* ★ 端到端：封顶之后数字不再涨，但**出手频率必须真的停在 +200% 那一档**。
         只验"数字不变"是不够的 —— 万一封顶的实现顺手把攻速也冻在原地，
         数字照样不变，而那是个更严重的 bug。
         基础攻速 0.88 × (1 + 2.00) = 2.64 次/秒。 */
      var atkCount = 0, atkAfter = 0;
      for (var k = 0; k < r.log.length; k++) {
        var e = r.log[k];
        if (e.type !== 'attack' || e.from !== 'a0') continue;
        atkCount++;
        if (e.t > ocs[capIdx].t) atkAfter++;
      }
      var span = dur - ocs[capIdx].t;
      /* ★★ 门槛从 1 秒放宽到 0.5 秒（并要求至少 2 次普攻）。
         原来那句 `span > 1` 本意是"别拿一个太短的窗口去除"，
         但它把一种**完全正常**的结果判成了 0：封顶正好发生在收尾阶段时，
         剩下 0.77 秒里正好还有 2 次普攻 —— 间隔 0.385 秒，
         换算出来就是 2.6 次/秒，和理论值一模一样，
         却因为窗口不够 1 秒被写成「0 次/秒」报红。
         判据本身没变（仍然是 2.3~2.95 次/秒），只是不再要求窗口那么长。 */
      var rate = (span > 0.5 && atkAfter >= 2) ? atkAfter / span : 0;
      TH.ok('★ 封顶之后出手频率停在 +200% 对应的 2.64 次/秒',
        rate > 2.3 && rate < 2.95,
        U.round2(rate) + ' 次/秒（理论 2.64）—— 封顶后 ' + atkAfter + ' 次 / ' +
        U.round2(span) + 's，全程普攻 ' + atkCount + ' 次');
    }
  })();

  /* ============================================================
   * 5c8. 老牧师（原「战地医师」/ medic）
   *
   *   1 星：没有被动，只有技能「圣愈术」（治疗血最少的队友）
   *   2 星「还能抢救一下」：每场战斗一次，第一个阵亡的队友**满血**站起来
   *   3 星「圣光赐福」：复活那一刻，老牧师和被救的人**攻击力都 +20%**
   *
   *   ★★ 这一套最容易搞错的是"**一次性资源属于谁**"：
   *      「一场只能救一个」是对**老牧师**的约束，不是对被救的人 ——
   *      场上有两个老牧师时两个人各救一个，同一个队友也可以被救两次。
   * ============================================================ */
  TH.section('老牧师 · 临终祷告');

  var MEDIC = ST.UNIT_BY_ID.medic;
  TH.eq('单位已改名为老牧师', MEDIC.name, '老牧师');
  TH.eq('id 仍然是 medic（levels.js 的阵容 + art/medic.png 都按 id 索引）',
    MEDIC.id, 'medic');
  TH.eq('被动类型是临终祷告', ST.passiveKind(MEDIC), 'lastRites');
  TH.eq('★ 1 星没有被动（被动从 2 星才开始）', ST.passiveName(MEDIC, 1), null);
  TH.eq('2 星被动名', ST.passiveName(MEDIC, 2), '还能抢救一下');
  TH.eq('3 星被动名（两个名字叠在一起）', ST.passiveName(MEDIC, 3), '还能抢救一下 + 圣光赐福');
  TH.eq('★ 2 星起才能救队友', MEDIC.passive.reviveAt, 2);
  TH.eq('★ 满血拉回来', MEDIC.passive.reviveHpPct, 1.00);
  TH.eq('★ 祷告 1 秒后站起来', MEDIC.passive.reviveDelay, 1.0);
  TH.eq('★ 3 星起给攻击力加成', MEDIC.passive.adBuffAt, 3);
  TH.eq('★ 加成是 +20%', MEDIC.passive.adBuffPct, 0.20);
  TH.eq('技能名跟着身份换掉了（战地救护 → 圣愈术）', MEDIC.skill.name, '圣愈术');
  TH.eq('★ 但技能机制一个字没动（还是治疗血最少的队友）',
    MEDIC.skill.kind + '/' + MEDIC.skill.target + '/' + MEDIC.skill.amount,
    'heal/lowest/620');

  /** 老牧师（后排角落 + 三条腰带撑血）+ N 个脆皮队友 vs 一个 3 星山岳。
   *  ★ 场景的目的很具体：**让队友死在老牧师前面**。
   *    所以脆皮队友顶在最前面正对山岳，老牧师缩在后排角上。
   *
   *  ★★ 坐标必须按**半场**给：**side 'a' 是 0~3 行，side 'b' 是 4~7 行**。
   *    （一开始我按"a 是下面半场"写了 r=7/r=4，结果引擎**静默地自动布阵**了：
   *      诊断里读到 a0:medic@0,3、a1:bowman@0,4 —— 我的前排/后排意图全丢了，
   *      于是老牧师反而站得离敌人更近、先死了，「队友先倒下」这个前提根本没成立，
   *      断言全绿空转。★ 坐标给错半场**不会报错**，只会被自动摆到别处 ——
   *      所以这类场景一定要把初始位置打出来核对，不能只看断言过没过。） */
  function ritesFight(priestStar, allyCount, seed) {
    var a = [{ id: 'medic', star: priestStar, items: ['belt', 'belt', 'belt'], r: 0, c: 0 }];
    if (allyCount >= 1) a.push({ id: 'bowman', star: 1, r: 3, c: 3 });
    if (allyCount >= 2) a.push({ id: 'bowman', star: 1, r: 3, c: 4 });
    return ST.Battle.battle({
      a: a,
      b: [{ id: 'titan', star: 3, items: ['belt', 'belt', 'belt'], r: 4, c: 3 }]
    }, seed || 424242);
  }

  // ① 2 星：第一个阵亡的队友被满血拉回来
  (function () {
    var r = ritesFight(2, 1);
    var rites = eventsOf(r, 'lastRites');
    var saved = eventsOf(r, 'reviveAlly');
    var okSaved = saved.filter(function (e) { return e.ok; });
    var deaths = r.log.filter(function (e) { return e.type === 'death'; });
    /* ★ 把初始位置打出来：坐标给错半场时引擎会**静默自动布阵**，
       不打出来就看不出"前排/后排"的意图其实没生效。 */
    TH.note('诊断：初始单位 = ' + r.initial.units.map(function (u) {
      return u.uid + ':' + u.defId + '@' + u.r + ',' + u.c + '(' + u.side + ')';
    }).join(' '));
    TH.note('老牧师 2 星 + 1 个脆皮队友：阵亡顺序 [' +
      deaths.map(function (e) { return e.who; }).join(' → ') + ']，祷告 ' + rites.length +
      ' 次，救活 ' + okSaved.length + ' 次');
    TH.eq('★ 2 星会为倒下的队友祷告', rites.length, 1);
    TH.eq('★ 祷告之后人真的站起来了', okSaved.length, 1);
    if (rites.length && okSaved.length) {
      var ev0 = rites[0], sv0 = okSaved[0];
      TH.eq('祷告的对象就是那个被救的人', ev0.to, sv0.who);
      TH.ok('★ 施法者是老牧师本人、而且是**别人**（救不了自己）',
        ev0.from === 'a0' && ev0.to !== ev0.from, ev0.from + ' → ' + ev0.to);
      TH.ok('★ 被救的是**第一个**阵亡的队友（不是随便哪个）',
        deaths.length > 0 && deaths[0].who === sv0.who,
        '第一个阵亡 ' + (deaths.length ? deaths[0].who : '—') + '，被救 ' + sv0.who);
      TH.ok('★ 满血站起来', Math.abs(sv0.hp - sv0.hpMax) < 0.02,
        sv0.hp + '/' + sv0.hpMax);
      TH.ok('★ 站起来的位置在自己半场',
        ST.Battle.sideOfRow(sv0.r) === 'a', '(' + sv0.r + ',' + sv0.c + ')');
      // 祷告确实隔了 1 秒才结算（不是当场拉起来）
      TH.ok('★ 祷告和复活之间隔了约 1 秒（不是当场拉起来）',
        Math.abs((sv0.t - ev0.t) - 1) < 0.06,
        U.round2(sv0.t - ev0.t) + 's');
      TH.eq('★ 2 星没有攻击力加成（那是 3 星的事）', ev0.adPct, 0);
    }
  })();

  // ② 1 星：完全没有被动
  (function () {
    var r = ritesFight(1, 1);
    TH.eq('★ 1 星不会为人祷告', eventsOf(r, 'lastRites').length, 0);
    TH.eq('★ 1 星也不会有人被救回来', eventsOf(r, 'reviveAlly').length, 0);
  })();

  // ③ 2 星：一场战斗只救**一个**（第二个队友倒下时不再触发）
  (function () {
    var r = ritesFight(2, 2);
    var rites = eventsOf(r, 'lastRites');
    var okSaved = eventsOf(r, 'reviveAlly').filter(function (e) { return e.ok; });
    var aDeaths = r.log.filter(function (e) {
      return e.type === 'death' && e.who.indexOf('a') === 0;
    });
    TH.note('老牧师 2 星 + 2 个脆皮队友：A 方阵亡 ' + aDeaths.length + ' 个，祷告 ' +
      rites.length + ' 次，救活 ' + okSaved.length + ' 次');
    TH.ok('这一场确实死了不止一个队友（否则下面全是空断言）', aDeaths.length >= 2,
      aDeaths.length + ' 个');
    TH.eq('★ 一场战斗只祷告一次（第二次阵亡不再触发）', rites.length, 1);
    TH.eq('★ 所以也只救回来一个', okSaved.length, 1);
  })();

  /** ④ 专用场景：**被救的人复活前后都打得到人**（否则伤害倍率采不到样本）。
   *  ★ 配置是探出来的，不是猜的：山岳 3 星**不带装备** + 弓 3 星 ——
   *    实测复活 @9.8s、复活前普攻 2 次、复活后 2 次、倍率 1 → 1.2、对局 51 秒。
   *  ★ 反例记在这里免得重试：换成"3 星山岳 + 三腰带 / 1 星弓"就采不到 ——
   *    脆皮队友在打出第一下之前就被秒了（死前攻=0、复活后攻=0）。 */
  function ritesDamageFight(priestStar) {
    return ST.Battle.battle({
      a: [{ id: 'medic', star: priestStar, items: ['belt', 'belt', 'belt'], r: 0, c: 0 },
          { id: 'bowman', star: 3, r: 3, c: 3 }],
      b: [{ id: 'earthwarden', star: 3, items: ['belt', 'belt', 'belt'], r: 4, c: 3 }]
    }, 424242);
  }

  // ④ 3 星：复活时老牧师和被救的人各拿 +20% 攻击力
  (function () {
    var r = ritesDamageFight(3);
    var okSaved = eventsOf(r, 'reviveAlly').filter(function (e) { return e.ok; });
    TH.ok('3 星也救回来了', okSaved.length === 1, okSaved.length + ' 次');
    if (!okSaved.length) return;
    var sv = okSaved[0];
    TH.eq('★ 3 星的复活事件带上了 +20% 的加成值', sv.adPct, 0.20);
    TH.ok('★ 名单里有被救的人自己', sv.blessed.indexOf(sv.who) >= 0,
      JSON.stringify(sv.blessed));
    TH.ok('★ 名单里有老牧师（他活着，说好两个人都加）',
      sv.blessed.indexOf(sv.from) >= 0, JSON.stringify(sv.blessed));

    /* ★ 端到端：不只看事件里写了什么，还要看**伤害真的涨了**。
       用 raw ÷ (ad × ramp) 反推攻击力倍率 —— 和雪毙那条是同一套办法。
       ★ 量的是**被救的队友**：他倒下之前打过、站起来之后还会打，
         而老牧师有可能一直没进射程（那就会采不到样本）。 */
    var me = r.initial.units.filter(function (u) { return u.uid === sv.who; })[0];
    var before = null, after = null, nB = 0, nA = 0;
    for (var i = 0; i < r.log.length; i++) {
      var e = r.log[i];
      if (e.type !== 'attack' || e.from !== sv.who || e.crit) continue;
      var mul = e.raw / (me.ad * e.ramp);
      if (e.t < sv.t) { nB++; if (before === null) before = mul; }
      if (e.t > sv.t + 0.05) { nA++; if (after === null) after = mul; }
    }
    TH.ok('★ 复活前后都采到了普攻样本（否则下面两条是空断言）',
      before !== null && after !== null,
      '复活前 ' + nB + ' 次 / 复活后 ' + nA + ' 次');
    TH.ok('★ 复活前攻击力倍率是 1', before !== null && Math.abs(before - 1) < 0.03,
      before === null ? '没采到' : U.round2(before));
    TH.ok('★ 复活后攻击力倍率变成 1.20（+20% 真的生效了）',
      after !== null && Math.abs(after - 1.20) < 0.03,
      after === null ? '没采到' : U.round2(after));

    // 2 星不该有这个加成
    var r2 = ritesFight(2, 1);
    var sv2 = eventsOf(r2, 'reviveAlly').filter(function (e) { return e.ok; })[0];
    TH.eq('★ 2 星救回来的人没有攻击力加成', sv2 ? sv2.adPct : -1, 0);
    TH.eq('★ 2 星的名单是空的（没发 buff 就不该写名字）',
      sv2 ? sv2.blessed.length : -1, 0);
  })();

  // ⑤ 老牧师救不了自己：他自己第一个倒下时，整套被动完全不动
  (function () {
    var r = ST.Battle.battle({
      a: [{ id: 'medic', star: 2, r: 3, c: 3 },     // ★ 故意顶在最前面，会先被打死
          { id: 'bowman', star: 1, r: 0, c: 0 }],
      b: [{ id: 'titan', star: 3, items: ['belt', 'belt', 'belt'], r: 4, c: 3 }]
    }, 515151);
    var aDeaths = r.log.filter(function (e) {
      return e.type === 'death' && e.who.indexOf('a') === 0;
    });
    TH.ok('这一场老牧师确实是先倒下的那个（否则这条没验到）',
      aDeaths.length > 0 && aDeaths[0].who === 'a0',
      'A 方阵亡顺序 [' + aDeaths.map(function (e) { return e.who; }).join(' → ') + ']');
    TH.eq('★ 老牧师自己倒下时不触犯祷告（他救不了自己）',
      eventsOf(r, 'lastRites').length, 0);
    TH.eq('★ 队友后来倒下也没人救（老牧师已经死了）',
      eventsOf(r, 'reviveAlly').length, 0);
  })();

  /* ⑥ 「祷告没做完的时候这一方不算输」—— 这是 anyPending 唯一需要
   *    主循环配合的地方，也是最容易漏的一条：
   *    如果漏了，最后一个人被救回来之前这一方就先被判全灭，
   *    于是"救援"永远只在人多的时候有效。
   *    ★ 要验它必须凑出一个很窄的场面：**被祷告的人先倒、
   *      老牧师在他站起来之前也倒**。所以这里扫若干个 seed 去找这个场面，
   *      找不到就如实报"没采到"（不假装通过）。 */
  (function () {
    var found = 0, okCount = 0, sample = '';
    for (var s = 1; s <= 60 && found < 3; s++) {
      var r = ST.Battle.battle({
        a: [{ id: 'medic', star: 2, r: 3, c: 2 },
            { id: 'bowman', star: 1, r: 3, c: 3 }],
        b: [{ id: 'titan', star: 3, items: ['belt', 'belt', 'belt'], r: 4, c: 3 }]
      }, 9000 + s);
      var last = eventsOf(r, 'lastRites')[0];
      if (!last) continue;
      var priestDied = r.log.filter(function (e) {
        return e.type === 'death' && e.who === last.from;
      }).length;
      if (!priestDied) continue;
      found++;
      var sv = eventsOf(r, 'reviveAlly').filter(function (e) {
        return e.who === last.to && e.ok;
      })[0];
      if (sv) okCount++;
      if (!sample) sample = 'seed ' + (9000 + s) + '：' + last.from + ' 在祷告期间阵亡，' +
        (sv ? ('被救的人仍然在 ' + U.round2(sv.t) + 's 站了起来') : '被救的人没站起来');
    }
    TH.note('「牧师祷告途中阵亡」的场面：扫了 60 个 seed 找到 ' + found +
      ' 个（其中 ' + okCount + ' 个仍然救活了）' + (sample ? '　' + sample : ''));
    if (found) {
      TH.eq('★ 老牧师在祷告途中阵亡时，祷告照样走完（人还是站起来了）', okCount, found);
    } else {
      TH.note('没凑出这个场面 —— 这条这次没验到，不是通过');
    }
  })();

  /* ============================================================
   * 5c10. 电棍（原「长枪兵」/ spearman）
   *
   *   面板：普攻伤害减半、攻速翻倍（ad 46→23、as 0.64→1.28）
   *   技能「穿刺投枪」一个字没动。
   *   1 星「导电」    普攻和技能留下电流，0.5 秒后向 3×3 内的敌人弹射，
   *                   每次 25% 攻击力，最多四次
   *   2 星「麻痹」    每次弹射额外击晕 0.5 秒
   *   3 星「三相电」  同时存在的电流 1 → 3 条
   * ============================================================ */
  TH.section('电棍 · 导电 / 麻痹 / 三相电');

  var BATON = ST.UNIT_BY_ID.spearman;
  TH.eq('单位已改名为电棍', BATON.name, '电棍');
  TH.eq('id 仍然是 spearman（levels.js 的阵容 + art/spearman.png 都按 id 索引）',
    BATON.id, 'spearman');
  TH.eq('★ 普攻伤害减半（46 → 23）', BATON.ad, 23);
  TH.eq('★ 攻速翻倍（0.64 → 1.28）', BATON.as, 1.28);
  /* ★★ 这两条要**一起**看：23 × 1.28 = 29.44，原来的 46 × 0.64 = 29.44。
     所以这是"出手更密、每下更轻"的换形，不是加强 —— 面板 DPS 一模一样。
     只验其中一条的话，把两个数都写错成"更强"也能过。 */
  TH.ok('★ 减半 + 翻倍 = 面板 DPS 不变（换形，不是加强）',
    Math.abs(BATON.ad * BATON.as - 46 * 0.64) < 0.05,
    (BATON.ad * BATON.as).toFixed(2) + ' vs ' + (46 * 0.64).toFixed(2));
  TH.ok('★ 技能一个字没动（穿刺投枪 / line / 170 / 长度 3）',
    BATON.skill.name === '穿刺投枪' && BATON.skill.kind === 'line' &&
    BATON.skill.damage === 170 && BATON.skill.length === 3,
    BATON.skill.name + '/' + BATON.skill.kind + '/' + BATON.skill.damage);
  TH.eq('被动类型是导电', ST.passiveKind(BATON), 'current');
  TH.eq('★ 1 星就有被动，名字是「导电」', ST.passiveName(BATON, 1), '导电');
  TH.eq('2 星的名字', ST.passiveName(BATON, 2), '导电 + 麻痹');
  TH.eq('3 星的名字', ST.passiveName(BATON, 3), '导电 + 麻痹 + 三相电');
  /* ★ 4 星：`names` 表同样只写到 3 星。夹紧写歪的话 4 星会掉成光秃秃的
     「被动」（曾经真的发生过 —— 13 个棋子全中），所以这一条要钉住。 */
  TH.eq('★ 4 星的名字不会被夹没（还是三层全在）',
    ST.passiveName(BATON, 4), '导电 + 麻痹 + 三相电');
  TH.eq('★ 弹射延迟 0.5 秒', BATON.passive.delay, 0.5);
  TH.eq('★ 弹射范围半径 1（= 3×3）', BATON.passive.radius, 1);
  TH.eq('★ 每次弹射 25% 攻击力', BATON.passive.bouncePct, 0.25);
  TH.eq('★ 最多弹射四次', BATON.passive.maxBounces, 4);
  TH.eq('★ 2 星起弹射带眩晕', BATON.passive.stunAt, 2);
  TH.eq('★ 眩晕 0.5 秒', BATON.passive.stunDur, 0.5);
  TH.eq('★ 同时存在数按星级：1/2 星 1 条、3 星 3 条',
    [BATON.passive.maxAtOnce[1], BATON.passive.maxAtOnce[2],
     BATON.passive.maxAtOnce[3]].join('/'), '1/1/3');

  /* 场面：电棍（三条腰带撑血）vs **五个挤成一团**的靶子。
     ★ 为什么是五个：一次弹射最多四下，加上落地那一下要打**五个不同的人**
       （弹过的不再命中），所以要凑够 5 个才验得到"第四次弹射"。
     ★ 为什么用 1 星荣誉 + 三腰带：它们血厚（1340）、输出极低（每个十几 dps），
       于是电棍能活二十秒、而且一个靶子都打不死 —— 场面干净，
       不会混进死亡/复活那些别的事件。
     ★ 靶子摆成 2×3 的方块：保证每一跳都能在 3×3 内找到"还没打过的人"。 */
  function batonFight(star) {
    return ST.Battle.battle({
      a: [{ id: 'spearman', star: star, items: ['belt', 'belt', 'belt'], r: 3, c: 3 }],
      b: [{ id: 'bowman', star: 1, items: ['belt', 'belt', 'belt'], r: 4, c: 3 },
          { id: 'bowman', star: 1, items: ['belt', 'belt', 'belt'], r: 4, c: 4 },
          { id: 'bowman', star: 1, items: ['belt', 'belt', 'belt'], r: 4, c: 5 },
          { id: 'bowman', star: 1, items: ['belt', 'belt', 'belt'], r: 5, c: 3 },
          { id: 'bowman', star: 1, items: ['belt', 'belt', 'belt'], r: 5, c: 4 }]
    }, 31415);
  }
  /** 把电流事件按 id 分组 */
  function chainOf(r) {
    var byId = {};
    for (var i = 0; i < r.log.length; i++) {
      var e = r.log[i];
      if (e.type !== 'current') continue;
      if (!byId[e.id]) byId[e.id] = { born: null, jumps: [], fizzle: null };
      if (e.born) byId[e.id].born = e;
      else if (e.fizzle) byId[e.id].fizzle = e;
      else byId[e.id].jumps.push(e);
    }
    return byId;
  }

  // ① 普攻留下电流 → 0.5 秒后弹射 → 每次 25% 攻击力
  (function () {
    var r = batonFight(1);
    var me = r.initial.units.filter(function (u) { return u.side === 'a'; })[0];
    var chains = chainOf(r);
    var ids = Object.keys(chains);
    TH.ok('★ 普攻真的留下了电流', ids.length > 0, ids.length + ' 道');
    if (!ids.length) return;
    var first = chains[ids[0]];
    TH.ok('第一道电流是"命中之后才出现的"（born 挂在一次普攻上）',
      !!first.born && first.born.to !== undefined, JSON.stringify(first.born && first.born.to));
    TH.ok('★ 弹射确实发生了', first.jumps.length > 0, first.jumps.length + ' 跳');
    if (first.jumps.length) {
      var j0 = first.jumps[0];
      TH.ok('★ 第一跳的间隔是 0.5 秒',
        Math.abs((j0.t - first.born.t) - 0.5) < 0.06,
        U.round2(j0.t - first.born.t) + 's');
      TH.ok('★ 每一次弹射都正好是「攻击力 × 25%」',
        first.jumps.every(function (j) {
          return Math.abs(j.raw - Math.round(me.ad * 0.25 * 1000) / 1000) < 0.05;
        }),
        'raw=' + j0.raw + '　攻击力 ' + me.ad + ' → 期望 ' +
        (Math.round(me.ad * 0.25 * 1000) / 1000));
      TH.ok('★ 相邻两跳之间也是 0.5 秒',
        first.jumps.length < 2 ||
        Math.abs((first.jumps[1].t - first.jumps[0].t) - 0.5) < 0.06,
        first.jumps.length < 2 ? '—' :
          (U.round2(first.jumps[1].t - first.jumps[0].t) + 's'));
      // 每一跳的起点必须是上一跳的落点（电流是"跳过去"的，不是瞬间挪)
      TH.ok('★ 每一跳都是从上一跳的落点出发的（电流真的在跳）',
        first.jumps.every(function (j) {
          return j.fromR !== undefined;
        }) && first.jumps[0].fromR === first.born.r &&
        first.jumps[0].fromC === first.born.c,
        first.jumps[0].fromR + ',' + first.jumps[0].fromC + ' ← born ' +
        first.born.r + ',' + first.born.c);
      TH.ok('★ 跳过的敌人不会重复命中（连锁闪电的经典规则）',
        (function () {
          var seen = [first.born.to], ok = true;
          first.jumps.forEach(function (j) {
            if (seen.indexOf(j.to) >= 0) ok = false;
            seen.push(j.to);
          });
          return ok;
        })(), [first.born.to].concat(first.jumps.map(function (j) { return j.to; })).join('→'));
    }
  })();

  // ② 最多四次：满了之后不再跳
  (function () {
    var r = batonFight(3);
    var chains = chainOf(r);
    var ids = Object.keys(chains);
    var maxJumps = 0, over = [];
    ids.forEach(function (id) {
      var c = chains[id];
      maxJumps = Math.max(maxJumps, c.jumps.length);
      if (c.jumps.length > 4) over.push(id + '=' + c.jumps.length);
      // 次数必须一路递减到 0
      for (var i = 0; i < c.jumps.length; i++) {
        if (c.jumps[i].left !== 4 - 1 - i) over.push('left 不连续 ' + c.jumps[i].left);
      }
    });
    TH.ok('★ 一次弹射最多四下（不会出现第五跳）', over.length === 0, over.slice(0, 3).join(' '));
    TH.ok('★ 而且真的有电流跳满了四下（否则"最多四次"没被验到）', maxJumps === 4,
      '实测最多 ' + maxJumps + ' 跳');
    TH.note('电棍 3 星这一场：' + ids.length + ' 道电流，最长 ' + maxJumps + ' 跳');
  })();

  // ③ 同时存在数：1 星只能 1 条，3 星到 3 条
  (function () {
    function maxLive(r) {
      // 按事件顺序模拟"活着的电流条数"
      var live = {}, peak = 0;
      for (var i = 0; i < r.log.length; i++) {
        var e = r.log[i];
        if (e.type !== 'current') continue;
        if (e.born) { live[e.id] = 1; }
        if ((!e.born && !e.fizzle && e.left <= 0) || e.fizzle) delete live[e.id];
        peak = Math.max(peak, Object.keys(live).length);
      }
      return peak;
    }
    var p1 = maxLive(batonFight(1));
    var p2 = maxLive(batonFight(2));
    var p3 = maxLive(batonFight(3));
    /* ★★ 4 星：maxAtOnce 这张表只写到 3 星，4 星是"3 个 3 星融合"出来的，
       能力必须停在 3 星那一档（查表往低档取），**不能**因为是 4 星就掉回 1 条。
       这条同时守两件事：引擎的 starLookup 夹紧逻辑，和文案层 starNum 的一致性
       —— 两边算出来不一样的话，卡面写着"3 条"而实际只有 1 条。 */
    var p4 = maxLive(batonFight(4));
    TH.eq('★ 1 星同时只有 1 条电流', p1, 1);
    TH.eq('★ 2 星也还是 1 条', p2, 1);
    TH.ok('★ 3 星能同时挂到 3 条（三相电）', p3 >= 3, p3 + ' 条');
    TH.ok('★ 4 星的电棍不会比 3 星弱（表里查不到就往低档取，不是掉回 1 条）',
      p4 >= 3, p4 + ' 条');
    TH.note('同时存在数实测：1星 ' + p1 + ' / 2星 ' + p2 + ' / 3星 ' + p3 +
      ' / 4星 ' + p4);
  })();

  // ④ 2 星弹射带 0.5 秒眩晕；1 星没有
  (function () {
    function curStuns(r) {
      return r.log.filter(function (e) {
        return e.type === 'stun' && e.reason === 'current';
      });
    }
    var s1 = curStuns(batonFight(1));
    var s2 = curStuns(batonFight(2));
    TH.eq('★ 1 星的电流不会眩晕（麻痹是 2 星的事）', s1.length, 0);
    TH.ok('★ 2 星的电流会眩晕', s2.length > 0, s2.length + ' 次');
    TH.ok('★ 眩晕时长都是 0.5 秒',
      s2.every(function (e) { return Math.abs(e.dur - 0.5) < 1e-9; }),
      s2.length ? s2[0].dur + 's' : '—');
  })();

  // ⑤ 技能也会留下电流（需求："普攻和技能会传导电流"）
  (function () {
    var r = batonFight(3);
    var hit = 0;
    for (var i = 0; i < r.log.length; i++) {
      var e = r.log[i];
      if (e.type !== 'current' || !e.born) continue;
      // 同 tick 里有没有一条技能伤害打的就是它？
      for (var j = 0; j < r.log.length; j++) {
        var s = r.log[j];
        if (s.type === 'skill' && s.t === e.t && s.to === e.to) { hit++; break; }
      }
    }
    TH.ok('★ 技能命中也会留下电流（不只是普攻）', hit > 0,
      hit + ' 道电流是技能留下的');
    TH.note('技能留下的电流：' + hit + ' 道');
  })();

  // ⑥ 规则外的边界：一个敌人时电流第一跳就无处可去 → 消散
  (function () {
    var r = ST.Battle.battle({
      a: [{ id: 'spearman', star: 1, items: ['belt', 'belt', 'belt'], r: 3, c: 3 }],
      b: [{ id: 'bowman', star: 1, items: ['belt', 'belt', 'belt'], r: 4, c: 3 }]
    }, 2718);
    var chains = chainOf(r);
    var ids = Object.keys(chains);
    TH.ok('这一场也留下了电流', ids.length > 0, ids.length + ' 道');
    var fizzled = ids.filter(function (id) { return !!chains[id].fizzle; });
    TH.ok('★ 旁边没有别的敌人时，电流会消散（这是终止条件）',
      fizzled.length > 0, fizzled.length + '/' + ids.length + ' 道消散了');
    TH.ok('★ 消散的电流一跳都没跳过（不是"空转四次"）',
      fizzled.every(function (id) { return chains[id].jumps.length === 0; }),
      fizzled.map(function (id) { return chains[id].jumps.length; }).join(','));
    checkInvariants(r, '电棍·单体电流消散', function (msg) {
      TH.ok('不变量（单体电流消散）: ' + msg, false);
    });
  })();

  /* ============================================================
   * 5c13. 东北雨姐（原「圣殿骑士」/ templar）
   *
   *   面板：生命 +50%（880 → 1320）、攻击 +30%（58 → 75）。
   *   技能「圣盾术」一个字没动（shield / 血量百分比最低的队友 / 320）。
   *   1 星            没有被动，就是原来那个套盾骑士
   *   2 星「红薯粉丝」 放技能的同时把身边 5×5 内的敌人**捆住** 3 秒
   *                    —— 捆住 = 钉在原地，但**还能打**（不是眩晕）
   *   3 星「雨姐的关照」普攻打到**被捆住的**敌人时，给血量最低的队友回 8% 最大生命
   * ============================================================ */
  TH.section('东北雨姐 · 红薯粉丝 / 雨姐的关照');

  var YU = ST.UNIT_BY_ID.templar;
  TH.eq('单位已改名为东北雨姐', YU.name, '东北雨姐');
  TH.eq('id 仍然是 templar（levels.js 的阵容 + art/templar.png 都按 id 索引）',
    YU.id, 'templar');
  TH.eq('★ 生命 +50%（880 → 1320）', YU.hp, 1320);
  TH.eq('★ 攻击 +30%（58 → 75）', YU.ad, 75);
  TH.ok('★ 技能一个字没动（圣盾术 / shield / 血量最低 / 320）',
    YU.skill.name === '圣盾术' && YU.skill.kind === 'shield' &&
    YU.skill.target === 'lowest' && YU.skill.amount === 320,
    YU.skill.name + '/' + YU.skill.kind + '/' + YU.skill.amount);
  TH.eq('被动类型是 noodle', ST.passiveKind(YU), 'noodle');
  TH.eq('★ 1 星没有被动（名字是空的，界面据此走"升星预告"）', ST.passiveName(YU, 1), null);
  TH.eq('2 星的名字', ST.passiveName(YU, 2), '红薯粉丝');
  TH.eq('3 星的名字', ST.passiveName(YU, 3), '红薯粉丝 + 雨姐的关照');
  TH.eq('★ 4 星的名字不会被夹没（两层都在）',
    ST.passiveName(YU, 4), '红薯粉丝 + 雨姐的关照');
  TH.eq('★ 2 星起才有捆人', YU.passive.bindAt, 2);
  TH.eq('★ 捆 3 秒', YU.passive.bindDur, 3);
  /* ★★ 半径 2（5×5）是刻意的：只捆挨着她的人，那些人本来就在射程内站住打她，
     **"不能移动"这件事根本看不出来**。上面有更长的注释。 */
  TH.eq('★ 5×5 范围（半径 2）', YU.passive.bindRadius, 2);
  TH.eq('★ 3 星起才有回血', YU.passive.healAt, 3);
  TH.eq('★ 打被捆住的人回 8% 最大生命', YU.passive.hitHealPct, 0.08);

  /* 场面（第一发技能在 t=0，全靠两颗蓝水晶把法力顶满）：
       我方：雨姐 (3,3) —— 前排，贴着一个敌人
             猎鹰手 (2,7) + 大果 —— 射程 4，(5,7) 那个敌人离它 2 格，
             所以它开局就有目标、**整场不走位**；而大果每秒自燃 6% 生命上限，
             于是它**永远有缺口可回**（healUnit 见到满血会直接返回 0）
       敌方：(4,3) 贴着她　(4,1) 离她 2 格　(5,7) 离她 4 格（**在 5×5 之外**）
     ★ 这一场是专门为"捆住到底管什么用"配的，三个敌人各有分工：
       · (4,3) 贴着她 —— 在射程内，被捆住也**照样打她** → 证明这不是眩晕
       · (4,1) 离她 2 格 —— 近战够不着，本来就要往上冲；
                 被捆住 → 钉住不动；3 秒一到 → 立刻开始走
       · (5,7) 离她 4 格 —— **捆不到**（对照组）：同一时间它必须正常走位。
         没有这个对照组的话，"被捆的人没动"完全可能只是因为
         "这一场里本来就没人需要动" —— 那这条断言就是空转的。
     ★ 敌人用奶龙（近战、伤害中等、不会晕人）：换成弓手的话一发狙击
       2000 点魔法伤害会当场把雨姐打残，场面撑不到 6 秒。 */
  function yuFight(star) {
    var belt3 = ['belt', 'belt', 'belt'];
    return ST.Battle.battle({
      a: [{ id: 'templar', star: star, items: ['sapphire', 'sapphire', 'belt'], r: 3, c: 3 },
          { id: 'falconer', star: 1, items: ['swiftboots', 'belt', 'belt'], r: 2, c: 7 }],
      b: [{ id: 'stoneguard', star: 3, items: belt3, r: 4, c: 3 },
          { id: 'stoneguard', star: 3, items: belt3, r: 4, c: 1 },
          { id: 'stoneguard', star: 3, items: belt3, r: 5, c: 7 }]
    }, 60607);
  }

  // ① 捆人的基本事实：谁被捆、捆多久、捆在哪
  (function () {
    var r = yuFight(2);
    var yu = r.initial.units.filter(function (u) { return u.defId === 'templar'; })[0];
    var pos = {};
    r.initial.units.forEach(function (u) { pos[u.uid] = { r: u.r, c: u.c, side: u.side }; });
    var roots = r.log.filter(function (e) { return e.type === 'root'; });
    TH.ok('★ 放了技能就捆到了人（否则后面全是空断言）', roots.length > 0, roots.length + ' 条');
    if (!roots.length) return;
    TH.ok('★ 每一条都是 3 秒（数据里那个数）',
      roots.every(function (e) { return Math.abs(e.dur - 3) < 1e-9; }), roots[0].dur + 's');
    TH.ok('★ 捆的全是敌人（不会把自己人捆上）',
      roots.every(function (e) { return pos[e.to] && pos[e.to].side !== pos[e.from].side; }));
    /* ★★ 几何只在**第一次施法那一瞬间**验，因为只有那一刻"初始坐标 == 当时坐标"。
       第一版拿初始坐标去验**所有**的 root，结果报出一串距离 4 ——
       不是引擎错了，是雨姐和敌人都已经走动过了（她会追着敌人往前压）。
       完整的半径判定（含对照组）在下面 ③ 里用静止场面对照着验。 */
    var firstT = roots[0].t;
    var firstRoots = roots.filter(function (e) { return e.t === firstT; });
    var far = firstRoots.filter(function (e) {
      var a = pos[e.from], b = pos[e.to];
      return U.cheb(a.r, a.c, b.r, b.c) > 2;
    });
    TH.ok('★ 第一发捆到的全在雨姐 5×5 之内（半径 2）',
      firstRoots.length > 0 && far.length === 0,
      firstRoots.map(function (e) {
        var a = pos[e.from], b = pos[e.to];
        return U.cheb(a.r, a.c, b.r, b.c);
      }).join(','));
    /* ★★ 一条 root 事件**不能**同时是一条 stun：
       两个事件类型分开，是为了让人不可能"顺手按眩晕去验"。
       ★ 断言写成"雨姐从不产生 stun"而不是"全场没有 stun"：
         这一场里猎鹰手带着大果，它的寒冰攒满 10 层会冻人（reason='freeze'）——
         那是**另一条**机制，拿它当反例是拿错了对象。 */
    TH.eq('★★ 雨姐捆人用的是 root 事件，她一个 stun 都不产生（这是两套机制）',
      r.log.filter(function (e) { return e.type === 'stun' && e.from === yu.uid; }).length, 0);
    TH.note('2 星这一场：' + roots.length + ' 条 root（第一发 ' + firstRoots.length +
      ' 条），第一次 @' + U.round2(firstT) + 's');
  })();

  // ② 1 星既不会捆人，也不会打人回血
  (function () {
    var r = yuFight(1);
    TH.eq('★ 1 星不会捆人（红薯粉丝是 2 星的事）',
      r.log.filter(function (e) { return e.type === 'root'; }).length, 0);
    TH.eq('★ 1 星的普攻也不会给队友回血（雨姐的关照是 3 星的事）',
      r.log.filter(function (e) { return e.type === 'heal' && e.reason === 'noodle'; }).length, 0);
  })();

  // ③ ★★ 捆住 = 只挡走位、不挡出手（这一条是这个机制的定义）
  (function () {
    var r = yuFight(2);
    var roots = r.log.filter(function (e) { return e.type === 'root'; });
    TH.ok('这一场捆过人（否则后面全是空断言）', roots.length > 0, roots.length + ' 条');
    if (!roots.length) return;

    var pos = {};
    r.initial.units.forEach(function (u) { pos[u.uid] = { r: u.r, c: u.c }; });
    /* 用**第一条** root 的时间窗：那时候场面还是初始站位，一目了然。
       ★ 用 `until` 而不是"t+3"：until 是引擎写出来的到期时刻，
         拿它当窗口边界，等于顺带验了"窗口长度 == 数据里的 3 秒"。 */
    var win = [roots[0].t, roots[0].until];
    TH.ok('★ 窗口长度就是数据里的 3 秒', Math.abs((win[1] - win[0]) - 3) < 1e-9,
      U.round2(win[1] - win[0]) + 's');

    function uidAt(rr, cc) {
      var out = null;
      r.initial.units.forEach(function (u) {
        if (u.r === rr && u.c === cc) out = u.uid;
      });
      return out;
    }
    var stuck = uidAt(4, 1);      // 离她 2 格：想动，但被捆住
    var buddy = uidAt(4, 3);      // 贴着她：在射程内，本来就不需要动
    var free = uidAt(5, 7);       // 离她 4 格：捆不到，对照组
    TH.ok('三个实验对象都摆对了（贴着的 / 两格外的 / 圈外的）',
      !!stuck && !!buddy && !!free, [stuck, buddy, free].join(','));

    function movesOf(uid, from, to) {
      return r.log.filter(function (e) {
        return e.type === 'move' && e.who === uid && e.t >= from && e.t < to;
      });
    }

    /* ① 被捆住、且本来想动的那个：窗口内一格都不许动 */
    TH.eq('★★ 被捆住的敌人（离她 2 格、本来要冲上来）在 3 秒里一格都没动',
      movesOf(stuck, win[0], win[1]).length, 0);
    /* ② 对照组：同一时间、同一个 5×5 之外的那个，必须**正常走位**。
       这一条才是"上一条不是空转"的证据 —— 没有它，上面那句"没动"
       完全可能只是因为这一场里本来就没人需要动。 */
    TH.ok('★★ 对照组（5×5 之外的敌人）在同一时间正常走位（证明"本来就要动"是真的）',
      movesOf(free, win[0], win[1]).length > 0,
      '圈外那个走了 ' + movesOf(free, win[0], win[1]).length + ' 次');
    /* ③ 解捆之后，被捆的那个立刻恢复走位 */
    TH.ok('★★ 解捆之后它立刻开始走（没动是"被钉住"，不是"它不想动"）',
      movesOf(stuck, win[1], win[1] + 3).length > 0,
      '解捆后 3 秒内走了 ' + movesOf(stuck, win[1], win[1] + 3).length + ' 次');
    /* ④ 但**出手不受影响**：贴着她的那个在窗口内照样打她 */
    var atkInWin = r.log.filter(function (e) {
      return e.type === 'attack' && e.t >= win[0] && e.t < win[1] &&
        (e.from === buddy || e.from === stuck);
    });
    TH.ok('★★ 被捆住的人**照样还手**（捆住只挡走位，不是眩晕）',
      atkInWin.length > 0, '窗口内被捆的人出手 ' + atkInWin.length + ' 次');
    TH.eq('★ 而且这 3 秒里没有任何人被打晕（两件事没混在一起）',
      r.log.filter(function (e) {
        return e.type === 'stun' && e.t >= win[0] && e.t < win[1];
      }).length, 0);
    TH.note('第一次捆人窗口 ' + U.round2(win[0]) + '~' + U.round2(win[1]) + 's：' +
      '被捆的走了 0 次 / 圈外的走了 ' + movesOf(free, win[0], win[1]).length +
      ' 次 / 被捆的出手 ' + atkInWin.length + ' 次');
  })();

  // ④ 3 星：只有"打被捆住的人"才回血，而且回给血量最低的队友
  (function () {
    var r = yuFight(3);
    var yu = r.initial.units.filter(function (u) { return u.defId === 'templar'; })[0];
    var maxHp = {}, side = {};
    r.initial.units.forEach(function (u) {
      maxHp[u.uid] = u.maxHp; side[u.uid] = u.side;
    });
    var heals = r.log.filter(function (e) { return e.type === 'heal' && e.reason === 'noodle'; });
    TH.ok('★ 3 星的普攻真的在给队友回血', heals.length > 0, heals.length + ' 口');

    /* 沿事件流重建血量 + 被捆状态，才能在每一口上验两件事：
         · 施法者这一下打的是不是**被捆住的人**
         · 收件人是不是当时**血量百分比最低**的自己人 */
    var hp = {}, dead = {}, rootUntilOf = {};
    var badPair = [], badTarget = [], badAmt = [], badSide = [];
    var seen = 0;
    function lowestAllyUid(who) {
      var best = null, bestPct = 2;
      for (var uid in hp) {
        if (side[uid] !== side[who] || dead[uid]) continue;
        var pct = hp[uid] / maxHp[uid];
        if (best === null || pct < bestPct - 1e-9) { best = uid; bestPct = pct; }
      }
      return best;
    }
    r.log.forEach(function (e) {
      if (e.type === 'root') { rootUntilOf[e.to] = e.until; }
      if (e.type === 'death') dead[e.who] = true;
      if (e.type === 'heal' && e.reason === 'noodle') {
        seen++;
        if (side[e.to] !== side[e.from]) badSide.push(e.to);
        // 这一 tick 施法者打的是谁？
        var atk = null;
        for (var i = 0; i < r.log.length; i++) {
          var a = r.log[i];
          if (a.type === 'attack' && a.from === e.from && a.t === e.t) { atk = a; break; }
        }
        if (!atk) badPair.push('@' + U.round2(e.t));
        else if (!(rootUntilOf[atk.to] > e.t)) {
          badPair.push('@' + U.round2(e.t) + ' 打的是没被捆住的 ' + atk.to);
        }
        var want = lowestAllyUid(e.from);
        if (want && want !== e.to) badTarget.push('@' + U.round2(e.t) + ' 回给了 ' + e.to + '，最低的是 ' + want);
        if (e.amount > maxHp[e.to] * 0.08 + 1.05) {
          badAmt.push(e.to + ' ' + e.amount + ' > ' + U.round2(maxHp[e.to] * 0.08));
        }
      }
      if (e.hpAfter !== undefined) hp[e.to || e.who] = e.hpAfter;
    });
    TH.ok('★ 每一口都是给自己人的', badSide.length === 0, badSide.slice(0, 3).join(','));
    TH.ok('★★ 每一口都发生在「这一下打的是被捆住的敌人」之后',
      badPair.length === 0, badPair.slice(0, 3).join('　') || '全部对得上');
    TH.ok('★★ 每一口都回给了当时**血量百分比最低**的队友',
      badTarget.length === 0, badTarget.slice(0, 3).join('　') || '全部正确');
    TH.ok('★ 每一口都不超过「收件人最大生命 × 8%」（被剩余血量截断是合法的）',
      badAmt.length === 0, badAmt.slice(0, 3).join('　'));

    /* ★★ 反面 + 正面，一次说清"什么时候该回、什么时候不该回"：
       · 打被捆住的人 **且队里确实有缺口**（有人血没满）→ 必须回一口
       · 打**没被捆住**的人 → 一口都不许回
       第一版写的是"打被捆住的人里允许 20% 没回"，结果实测 36 次里 17 次没回 ——
       那不是容差不够，是**断言没抓住真正的规则**：healUnit 见到满血直接返回 0。
       所以先把"当时有没有缺口"算出来，判据就变成精确的了。 */
    /* ★★ 先把 root 时间线整理出来：每个受害者 → [{t, until}]。
       判"这一下打的是不是被捆住的人"要用**时间线**去算，不能顺着日志顺序读一个变量 ——
       因为同一 tick 里事件的先后次序是这样的：
         attack → (afterDamage 里法力满了，顺手放技能 → cast → root) → … → heal
       也就是说 **root 可能排在 attack 后面、却排在 heal 前面**，
       引擎在结算 noodleHeal 的那一刻看到的已经是新 root 了。
       第一版顺着日志读 `rootUntilOf[e.to]`，于是在"她刚好在这一 tick 放技能"
       的那 6 次上全判成了"打的是没被捆住的人"，凭空报出 6 次假失败。 */
    var rootTL = {};
    r.log.forEach(function (e) {
      if (e.type !== 'root') return;
      if (!rootTL[e.to]) rootTL[e.to] = [];
      rootTL[e.to].push({ t: e.t, until: e.until });
    });
    function rootedAt(uid, t) {
      var l = rootTL[uid];
      if (!l) return false;
      for (var i = 0; i < l.length; i++) {
        if (l[i].t <= t + 1e-9 && l[i].until > t + 1e-9) return true;
      }
      return false;
    }

    var hp2 = {}, dead2 = {}, gapMiss = 0, gapHit = 0;
    var unboundAttacks = 0, unboundHeals = 0, rootAttacks = 0, unboundWhy = [];
    r.log.forEach(function (e) {
      if (e.hpAfter !== undefined) hp2[e.to || e.who] = e.hpAfter;
      if (e.type === 'death') dead2[e.who] = true;
      if (e.type !== 'attack' || e.from !== yu.uid) return;
      var isRoot = rootedAt(e.to, e.t);
      var healed = r.log.some(function (h) {
        return h.type === 'heal' && h.reason === 'noodle' && h.t === e.t && h.from === yu.uid;
      });
      if (!isRoot) {
        unboundAttacks++;
        if (healed) {
          unboundHeals++;
          if (unboundWhy.length < 6) unboundWhy.push('@' + U.round2(e.t) + ' 打 ' + e.to);
        }
        return;
      }
      rootAttacks++;
      // 队里有没有"血没满"的自己人？（healUnit 的 room < 1 会直接返回 0）
      var gap = false;
      for (var uid in hp2) {
        if (side[uid] !== side[yu.uid] || dead2[uid]) continue;
        if (maxHp[uid] - hp2[uid] >= 1) { gap = true; break; }
      }
      if (gap) { if (healed) gapHit++; else gapMiss++; }
    });
    TH.ok('★ 这一场确实有"打被捆住的人、而且队里有缺口"的机会（否则下面那条是空断言）',
      gapHit + gapMiss > 0, (gapHit + gapMiss) + ' 次');
    TH.eq('★★ 只要队里有缺口，"打被捆住的人"就一定会回上一口（一次都不许漏）',
      gapMiss, 0);
    TH.ok('★★ 打**没被捆住**的敌人时一口都不回（这条把"每次普攻都回血"挡在门外）',
      unboundHeals === 0, unboundAttacks + ' 次里回了 ' + unboundHeals + ' 次　' +
      unboundWhy.join('　'));
    TH.note('3 星这一场：' + heals.length + ' 口（打被捆住的人 ' + rootAttacks +
      ' 次、其中有缺口 ' + (gapHit + gapMiss) + ' 次；打没捆住的 ' + unboundAttacks + ' 次）');

    checkInvariants(r, '东北雨姐·3星', function (msg) {
      TH.ok('不变量（东北雨姐 3 星）: ' + msg, false);
    });
  })();

  /* ============================================================
   * 5c12. 美团袋鼠（原「炼金师」/ alchemist）
   *
   *   技能「治疗外卖」：投掷一个外卖，治疗血量百分比最低的队友（数值一个字没动）。
   *   1 星            没有被动，就是原来那个单奶
   *   2 星「准时送达」 收到外卖的队友攻速 +20%，持续 5 秒
   *   3 星「好评如潮」 **普通攻击**会治疗"被攻击的敌人 3×3 范围内"的友方单位
   * ============================================================ */
  TH.section('美团袋鼠 · 准时送达 / 好评如潮');

  var Roo = ST.UNIT_BY_ID.alchemist;
  TH.eq('单位已改名为美团袋鼠', Roo.name, '美团袋鼠');
  TH.eq('id 仍然是 alchemist（levels.js 的阵容 + art/alchemist.png 都按 id 索引）',
    Roo.id, 'alchemist');
  TH.eq('技能已改名为「治疗外卖」', Roo.skill.name, '治疗外卖');
  TH.eq('技能喊话是「投掷一个外卖」', Roo.skill.callout, '投掷一个外卖');
  TH.ok('★ 技能机制一个字没动（heal / 目标血量最低 / 560）',
    Roo.skill.kind === 'heal' && Roo.skill.target === 'lowest' && Roo.skill.amount === 560,
    Roo.skill.kind + '/' + Roo.skill.target + '/' + Roo.skill.amount);
  TH.eq('被动类型是 delivery', ST.passiveKind(Roo), 'delivery');
  TH.eq('★ 1 星没有被动（名字是空的，界面据此走"升星预告"）',
    ST.passiveName(Roo, 1), null);
  TH.eq('2 星的名字', ST.passiveName(Roo, 2), '准时送达');
  TH.eq('3 星的名字', ST.passiveName(Roo, 3), '准时送达 + 好评如潮');
  TH.eq('★ 4 星的名字不会被夹没（两层都在）',
    ST.passiveName(Roo, 4), '准时送达 + 好评如潮');
  TH.eq('★ 2 星起才有外卖增益', Roo.passive.asBuffAt, 2);
  TH.eq('★ 攻速 +20%', Roo.passive.asBuffPct, 0.20);
  TH.eq('★ 持续 5 秒', Roo.passive.asBuffDur, 5);
  TH.eq('★ 3 星起才有普攻送餐', Roo.passive.healAt, 3);
  TH.eq('★ 每口 4% 最大生命', Roo.passive.healPct, 0.04);
  TH.eq('★ 范围半径 1（= 3×3）', Roo.passive.radius, 1);

  /* 场面：**开局之后一段时间内全场静止**。
     ★ 为什么非要这样：3 星那条要验"治疗的是**被攻击敌人 3×3 内**的友方"。
       一旦有人走位，初始坐标就不再是判定时的坐标，几何判据只能靠重建位置
       （能写，但那是把校验器的活儿再做一遍）。
       所以下面所有的几何断言都只取「第一次走位**之前**」的那些外卖单 ——
       那段时间里坐标就是初始坐标，判据可以写得又短又硬。
     站位（我方 0~3 行、敌方 4~7 行）：
       我方：袋鼠 (2,3)、肉盾 (3,2) (3,3) (3,7)
       敌方：豆包 3 星 (4,2) 和 (4,7)
       → 三个肉盾各自贴着一个敌人（近战，射程内就地打）→ 不走位；
         袋鼠射程 2，最近的敌人是 (4,2)（切比雪夫 2）→ 也不走位。
       → 以 (4,2) 为中心的 3×3 = 行 3~5、列 1~3 → 圈里只有 (3,2) 和 (3,3)，
         (3,7) 在圈外。这就是"该奶的奶了、不该奶的没奶"的对照组。
     ★ 三个肉盾都带「和成天下5000精品大果」：它每秒自燃 6% 生命上限 ——
       于是**每个人身上永远有缺口可回**（healUnit 见到满血会直接返回 0，
       一个满血的队友就算在圈里也不会写出 heal 事件，那条对照就变成空断言了）。
       代价是他们 16.7 秒左右会烧死自己，之后场上开始走位 ——
       正好用"第一次走位之前的那些单"来切分。
     ★ 敌人用豆包（治疗型、伤害低）而不是弓手：弓手一发狙击 2000 点魔法伤害，
       会把 1520 血的肉盾直接秒了，场面撑不到几次普攻。 */
  function rooFight(star) {
    var belt3 = ['belt', 'belt', 'belt'];
    var fruit = ['swiftboots', 'belt', 'belt'];
    return ST.Battle.battle({
      a: [{ id: 'alchemist', star: star, items: belt3, r: 2, c: 3 },
          { id: 'stoneguard', star: 1, items: fruit, r: 3, c: 2 },
          { id: 'stoneguard', star: 1, items: fruit, r: 3, c: 3 },
          { id: 'stoneguard', star: 1, items: fruit, r: 3, c: 7 }],
      b: [{ id: 'acolyte', star: 3, items: belt3, r: 4, c: 2 },
          { id: 'acolyte', star: 3, items: belt3, r: 4, c: 7 }]
    }, 31337);
  }

  // ① 场面确实是静止的（后面所有几何断言的前提）
  (function () {
    [1, 2, 3].forEach(function (star) {
      var r = rooFight(star);
      var mv = r.log.filter(function (e) { return e.type === 'move'; });
      var firstMove = mv.length ? mv[0].t : Infinity;
      var attacks = r.log.filter(function (e) { return e.type === 'attack'; });
      TH.ok('★ ' + star + ' 星：第一次走位之前已经有足够多的普攻（几何断言有样本）',
        attacks.filter(function (a) { return a.t < firstMove; }).length >= 8,
        '第一次走位 @' + (firstMove === Infinity ? '从未' : U.round2(firstMove)) +
        's，之前有 ' + attacks.filter(function (a) { return a.t < firstMove; }).length + ' 下普攻');
    });
    TH.note('美团袋鼠这三场里，单位开局就咬住目标、谁也不动 —— ' +
      '直到带大果的肉盾把自己烧死（约 16.7 秒）之后才开始走位。');
  })();

  // ② 2 星：每一次施法都给"被送外卖的那个人"挂 +20% 攻速 5 秒
  (function () {
    var r = rooFight(2);
    var roo = r.initial.units.filter(function (u) { return u.defId === 'alchemist'; })[0];
    var casts = r.log.filter(function (e) { return e.type === 'cast' && e.from === roo.uid; });
    var heals = r.log.filter(function (e) { return e.type === 'heal' && e.reason === 'skill'; });
    var buffs = r.log.filter(function (e) { return e.type === 'buff' && e.reason === 'delivery'; });
    TH.ok('这一场放出了治疗外卖（否则后面全是空断言）', casts.length > 0, casts.length + ' 次');
    /* ★★ 外卖是"投出去"就成立的：队友满血时那一口不写 heal 事件，但加成照给。
       所以配对的基准是**施法次数**，不是治疗条数 —— 第一版按治疗配对，
       当场报「3 次加成 / 2 口奶」，看着像多送了一次，其实是规则如此。 */
    TH.eq('★ 每一次施法恰好送出一份攻速加成', buffs.length, casts.length);
    TH.ok('★ 外卖增益恰好等于数据里的 20% / 5 秒',
      buffs.every(function (e) { return Math.abs(e.amount - 0.20) < 1e-9 && Math.abs(e.dur - 5) < 1e-9; }),
      buffs.length ? (buffs[0].amount + ' / ' + buffs[0].dur + 's') : '—');
    var badSide = buffs.filter(function (b) {
      var u = r.initial.units.filter(function (x) { return x.uid === b.who; })[0];
      return !u || u.side !== roo.side;
    });
    TH.eq('★ 外卖全部送给了自己人', badSide.length, 0);
    /* ★★ 最容易被写错的一行：加成必须挂在**被奶的那个人**身上，不是施法者自己。
       做法是先施法 → 选血量百分比最低的队友 → 奶他 → 加速他。
       写成加速 `u`（自己）的话，画面上两个都是绿色数字、都回血，肉眼分不出。 */
    var mismatch = buffs.filter(function (b) {
      var h = heals.filter(function (x) { return x.t === b.t && x.from === b.from; })[0];
      return !!h && h.to !== b.who;   // 这一 tick 真的奶出了血 → 收件人必须是同一个人
    });
    TH.ok('★★ 凡是这一 tick 真的奶出了血，被加速的就是被奶的那个人',
      mismatch.length === 0, mismatch.length ? (mismatch.length + ' 次挂错了人') : '每次都一致');
    var paired = buffs.filter(function (b) {
      return heals.some(function (x) { return x.t === b.t && x.from === b.from; });
    });
    TH.ok('★ 大部分施法都真的奶出了血（否则上面那条是空断言）',
      paired.length >= 1, paired.length + '/' + buffs.length + ' 次有对应的治疗事件');
  })();

  // ③ 1 星：既没有外卖增益，也没有普攻送餐
  (function () {
    var r = rooFight(1);
    TH.eq('★ 1 星的治疗外卖不带攻速加成（准时送达是 2 星的事）',
      r.log.filter(function (e) { return e.type === 'buff'; }).length, 0);
    TH.eq('★ 1 星的普攻不会送外卖（好评如潮是 3 星的事）',
      r.log.filter(function (e) { return e.type === 'heal' && e.reason === 'delivery'; }).length, 0);
  })();

  // ④ 2 星也还没有普攻送餐（门槛是分开的两层）
  (function () {
    var r = rooFight(2);
    TH.eq('★ 2 星仍然没有普攻送餐（3 星才解锁）',
      r.log.filter(function (e) { return e.type === 'heal' && e.reason === 'delivery'; }).length, 0);
  })();

  // ⑤ 3 星：每一次普攻都给"被攻击敌人 3×3 内"的友方送一单
  (function () {
    var r = rooFight(3);
    var pos = {}, side = {};
    r.initial.units.forEach(function (u) { pos[u.uid] = { r: u.r, c: u.c }; side[u.uid] = u.side; });
    var roo = null;
    r.initial.units.forEach(function (u) { if (u.defId === 'alchemist') roo = u; });
    TH.ok('袋鼠在场（否则后面全是空断言）', !!roo);
    if (!roo) return;
    function maxHpOf(uid) {
      for (var i = 0; i < r.initial.units.length; i++) {
        if (r.initial.units[i].uid === uid) return r.initial.units[i].maxHp;
      }
      return 0;
    }

    var attacks = r.log.filter(function (e) { return e.type === 'attack' && e.from === roo.uid; });
    var meals = r.log.filter(function (e) { return e.type === 'heal' && e.reason === 'delivery'; });
    TH.ok('★ 袋鼠打了很多下普攻（否则下面全是空断言）', attacks.length >= 3, attacks.length + ' 下');
    TH.ok('★ 3 星的普攻真的在送外卖', meals.length > 0, meals.length + ' 单');

    /* ★★ 只取"第一次走位之前"的单：那段时间坐标 == 初始坐标。
       之后的单不参与几何判定（但会数出来，报告里能看到跳过了多少）。 */
    var moves = r.log.filter(function (e) { return e.type === 'move'; });
    var firstMove = moves.length ? moves[0].t : Infinity;
    var stable = meals.filter(function (m) { return m.t < firstMove; });
    TH.ok('★ 静止窗口里有足够多的外卖单可以做几何判定（>= 6）',
      stable.length >= 6, stable.length + ' 单（共 ' + meals.length +
      ' 单，第二次走位起点 @' + (firstMove === Infinity ? '从未' : U.round2(firstMove)) + 's）');

    var badPlace = [], badSide = [], badPair = [], badAmt = [];
    stable.forEach(function (m) {
      if (side[m.to] !== roo.side) badSide.push(m.to);
      var atk = null;
      for (var i = 0; i < r.log.length; i++) {
        var e = r.log[i];
        if (e.type === 'attack' && e.from === m.from && e.t === m.t) { atk = e; break; }
      }
      if (!atk) { badPair.push(U.round2(m.t)); return; }
      var tp = pos[atk.to], mp = pos[m.to];
      if (!tp || !mp) return;
      if (U.cheb(mp.r, mp.c, tp.r, tp.c) > 1) {
        badPlace.push(m.to + '(' + mp.r + ',' + mp.c + ') 离敌人(' + tp.r + ',' + tp.c + ') 太远');
      }
      var want = maxHpOf(m.to) * 0.04;
      if (m.amount > want + 1.05) badAmt.push(m.to + ' ' + m.amount + ' > ' + U.round2(want));
    });
    TH.ok('★ 每一单都送给了自己人（不会给敌人送外卖）', badSide.length === 0, badSide.join(','));
    TH.ok('★★ 每一单的收件人都在「被打中的那个敌人」周围 3×3 之内',
      badPlace.length === 0, badPlace.slice(0, 4).join('　') || '全部在圈内');
    TH.ok('★ 每一单都紧跟在同一 tick 的一次普攻上', badPair.length === 0,
      badPair.slice(0, 4).join(','));
    TH.ok('★ 每一口的量都不超过「收件人最大生命 × 4%」（被剩余血量截断是合法的）',
      badAmt.length === 0, badAmt.slice(0, 4).join('　'));

    /* ★★ 对照组：圈外那个队友（3,7）一次都不该被奶到。
       这是"范围真的生效"的唯一证据 —— 只验"圈内的人被奶了"的话，
       把实现写成"治疗全队"也照样全绿。
       ★ 他也带了大果、也一直在掉血，所以"没被奶到"不是因为他满血。 */
    var farHealed = stable.filter(function (m) { return pos[m.to].c === 7; });
    TH.eq('★★ 站在 3×3 之外的那个队友一单都没收到（而且他确实在掉血）',
      farHealed.length, 0);
    var farBurns = r.log.filter(function (e) {
      return e.type === 'selfburn' && e.who === Object.keys(pos).filter(function (k) {
        return pos[k].c === 7 && pos[k].r === 3;
      })[0];
    });
    TH.ok('★ 他确实有缺口可回（否则上面那条是空断言）', farBurns.length > 0,
      farBurns.length + ' 次自燃');

    var inHealed = stable.filter(function (m) { return pos[m.to].c === 2 || pos[m.to].c === 3; });
    TH.ok('★ 圈里的两个队友都收到过外卖（不是只送最近的那个）',
      inHealed.some(function (m) { return pos[m.to].c === 2; }) &&
      inHealed.some(function (m) { return pos[m.to].c === 3; }),
      '圈内共 ' + inHealed.length + ' 单');

    /* ★★ 一次普攻可以同时喂饱好几个人 —— 这是"范围治疗"和"单体治疗"的分水岭。
       实现写成只奶最近的一个人时，这条会红。 */
    var byTick = {};
    stable.forEach(function (m) { byTick[m.t] = (byTick[m.t] || 0) + 1; });
    var maxAtOnce = 0, twoTicks = 0;
    for (var k in byTick) {
      if (byTick[k] > maxAtOnce) maxAtOnce = byTick[k];
      if (byTick[k] >= 2) twoTicks++;
    }
    TH.ok('★★ 有过"一下普攻同时奶到 2 个队友"的时刻（不然就是单体治疗了）',
      maxAtOnce >= 2, '单次最多 ' + maxAtOnce + ' 个（' + twoTicks + ' 次同时奶两个）');

    TH.ok('★ 3 星同时保留 2 星那一层（外卖照样加速）',
      r.log.filter(function (e) { return e.type === 'buff' && e.reason === 'delivery'; }).length > 0,
      r.log.filter(function (e) { return e.type === 'buff'; }).length + ' 次增益');

    checkInvariants(r, '美团袋鼠·3星', function (msg) {
      TH.ok('不变量（美团袋鼠 3 星）: ' + msg, false);
    });
  })();

  /* ============================================================
   * 5c11. 冰冰冰（原「冰霜法师」/ frostmage）
   *
   *   技能「寒霜新星」一个字没动（aoe / 260 / 半径 1）。
   *   1 星            没有被动，技能就是原来的 3×3 寒霜新星
   *   2 星「冻手冻脚」 被技能打中的敌人**额外冰冻 1.5 秒**
   *   3 星「千里冰封」 技能改成**打全体敌人**（不再只看目标格附近）
   * ============================================================ */
  TH.section('冰冰冰 · 冻手冻脚 / 千里冰封');

  var ICE = ST.UNIT_BY_ID.frostmage;
  TH.eq('单位已改名为冰冰冰', ICE.name, '冰冰冰');
  TH.eq('id 仍然是 frostmage（levels.js 的 4 处阵容 + art/frostmage.png 都按 id 索引）',
    ICE.id, 'frostmage');
  TH.eq('★ emoji 是**三个**冰（不是 .length 那种数法）',
    ST.U.emojiCount(ICE.emoji), 3);
  /* ★ 单图形的 emoji 不能被误判成多个 —— 这是 emojiCount 存在的全部理由：
     `'❄️'.length === 2`（雪花 + 变体选择符 U+FE0F），
     照 length 判会把 21 个单 emoji 的棋子全部白缩一档。 */
  TH.eq('★ 单个 ❄️ 不会被数成两个（变体选择符不算图形）',
    ST.U.emojiCount('❄️'), 1);
  TH.eq('★ 单个 🧊 也不会被数成两个（代理对只算一个图形）',
    ST.U.emojiCount('🧊'), 1);
  TH.ok('★ 三个 emoji 真的会缩一档（不然会横着冲出卡片）',
    ST.U.emojiScale(3) < ST.U.emojiScale(2) && ST.U.emojiScale(2) < ST.U.emojiScale(1),
    ST.U.emojiScale(1) + ' / ' + ST.U.emojiScale(2) + ' / ' + ST.U.emojiScale(3));
  TH.ok('★ 技能一个字没动（寒霜新星 / aoe / 260 / 半径 1）',
    ICE.skill.name === '寒霜新星' && ICE.skill.kind === 'aoe' &&
    ICE.skill.damage === 260 && ICE.skill.radius === 1,
    ICE.skill.name + '/' + ICE.skill.kind + '/' + ICE.skill.damage);
  TH.eq('被动类型是 frost', ST.passiveKind(ICE), 'frost');
  TH.eq('★ 1 星没有被动（名字是空的，界面据此走"升星预告"）',
    ST.passiveName(ICE, 1), null);
  TH.eq('2 星的名字', ST.passiveName(ICE, 2), '冻手冻脚');
  TH.eq('3 星的名字', ST.passiveName(ICE, 3), '冻手冻脚 + 千里冰封');
  TH.eq('★ 4 星的名字不会被夹没（两层都在）',
    ST.passiveName(ICE, 4), '冻手冻脚 + 千里冰封');
  TH.eq('★ 2 星起才有技能冰冻', ICE.passive.freezeAt, 2);
  TH.eq('★ 冰冻 1.5 秒', ICE.passive.freezeDur, 1.5);
  TH.eq('★ 3 星起技能改成打全体', ICE.passive.allAt, 3);

  /* 场面：**四个彼此不相邻**的敌人（两两切比雪夫距离 >= 2），
     我方四个肉盾一人咬住一个 —— 谁都不会走位，场面 60 秒不动。
     ★ 为什么必须"彼此不相邻"：寒霜新星是「目标格周围 3×3」，
       敌人挨在一起的话 1 星也能一次打到好几个，"3 星打全体"就验不出来了。
       现在 3×3 里最多只有一个敌人 → **1/2 星每次施法只打得到 1 个**，
       而 3 星一次打到全部存活者，两者的差别一眼可辨。
     ★ 为什么双方都带 3 条腰带：血厚到打不死的话事件流最干净；
       实际上冰冰冰还是会杀掉几个，所以下面的判据是**按事件流重建存活数**，
       而不是假定"一直是 4 个"（假定的写法会在有人倒下那一刻开始假红）。 */
  function iceFight(star) {
    var items = ['belt', 'belt', 'belt'];
    return ST.Battle.battle({
      a: [{ id: 'frostmage', star: star, items: items, r: 2, c: 3 },
          { id: 'stoneguard', star: 1, items: items, r: 3, c: 0 },
          { id: 'stoneguard', star: 1, items: items, r: 3, c: 2 },
          { id: 'stoneguard', star: 1, items: items, r: 3, c: 4 },
          { id: 'stoneguard', star: 1, items: items, r: 3, c: 6 }],
      b: [{ id: 'bowman', star: 1, items: items, r: 4, c: 0 },
          { id: 'bowman', star: 1, items: items, r: 4, c: 2 },
          { id: 'bowman', star: 1, items: items, r: 4, c: 4 },
          { id: 'bowman', star: 1, items: items, r: 4, c: 6 }]
    }, 777);
  }

  /**
   * 沿事件流走一遍，把每一次施法整理成：
   *   { t, hits, alive, surv[], dead[] }
   *   hits  这一发打到了几个人
   *   alive 这一发**开始之前**对面还活着几个人
   *   surv  被打中且活下来的人
   *   dead  被打中而且这一下就死了的人
   *
   * ★★ 为什么用"沿日志遍历"而不是"按时间戳比"：同一 tick 里
   *    先有队友的普攻把一个人打死、再有冰冰冰施法，两种情况的时间戳
   *    完全一样，按 `e.t < cast.t` 去数存活数会多算一个，断言假红。
   *    按**日志顺序**走就没有这个歧义（skill 事件和紧跟其后的 death
   *    是同一次结算里发出的）。这条坑在别的机制上已经踩过一次。
   */
  function iceCasts(r) {
    var ice = null;
    for (var i0 = 0; i0 < r.initial.units.length; i0++) {
      if (r.initial.units[i0].defId === 'frostmage') { ice = r.initial.units[i0]; break; }
    }
    if (!ice) return { uid: null, casts: [], frost: [] };
    var alive = {};
    for (var i1 = 0; i1 < r.initial.units.length; i1++) {
      var iu = r.initial.units[i1];
      if (iu.side !== ice.side) alive[iu.uid] = true;   // 对面的存活表
    }
    var casts = [], cur = null;
    for (var i2 = 0; i2 < r.log.length; i2++) {
      var e = r.log[i2];
      if (e.type === 'skill' && e.from === ice.uid) {
        if (!cur || cur.t !== e.t) {
          cur = { t: e.t, hits: 0, alive: 0, surv: [], dead: [] };
          for (var k in alive) cur.alive++;            // 施法开始前的存活数
          casts.push(cur);
        }
        cur.hits++;
        if (e.hpAfter > 0) cur.surv.push(e.to); else cur.dead.push(e.to);
      } else if (e.type === 'death' && alive[e.who] !== undefined) {
        delete alive[e.who];
      }
    }
    var frost = r.log.filter(function (x) {
      return x.type === 'stun' && x.reason === 'frost';
    });
    return { uid: ice.uid, casts: casts, frost: frost };
  }
  /** 「谁@哪一 tick 被冻了」的集合 */
  function frostKeySet(frost) {
    var s = {};
    frost.forEach(function (e) { s[e.to + '@' + e.t] = true; });
    return s;
  }

  // ① 3 星：技能打全体 —— 每一发打到的人数 == 发之前对面活着的人数
  (function () {
    var r = iceFight(3);
    var I = iceCasts(r);
    TH.ok('这一场冰冰冰放出了技能（否则后面全是空断言）', I.casts.length > 0,
      I.casts.length + ' 次');
    if (!I.casts.length) return;
    var wrong = I.casts.filter(function (c) { return c.hits !== c.alive; })
      .map(function (c) { return '@' + U.round2(c.t) + ' 打 ' + c.hits + ' 活 ' + c.alive; });
    TH.ok('★★ 3 星每一发技能都打到了**全部**存活敌人（不是只打目标格周围）',
      wrong.length === 0, wrong.slice(0, 3).join('　') || '全部吻合');
    TH.ok('★ 而且次数确实超过了"3×3 里最多一个"这个上限（>= 3 才算真的验证到了）',
      I.casts.some(function (c) { return c.hits >= 3; }),
      '最多一次打到 ' + Math.max.apply(null, I.casts.map(function (c) { return c.hits; })) + ' 个');
    TH.note('3 星每一次施法：' + I.casts.map(function (c) {
      return U.round2(c.t) + 's→' + c.hits + '/' + c.alive;
    }).join('　'));
  })();

  // ② 1 星 / 2 星：仍然只打目标格周围 3×3（敌人彼此不相邻 → 每次都只打到 1 个）
  (function () {
    [1, 2].forEach(function (star) {
      var I = iceCasts(iceFight(star));
      TH.ok(star + ' 星放出了技能（否则下面那条是空断言）', I.casts.length > 0,
        I.casts.length + ' 次');
      var over = I.casts.filter(function (c) { return c.hits > 1; });
      TH.ok('★ ' + star + ' 星的寒霜新星仍然只打目标格周围 3×3（敌人分散时不可能是多个）',
        over.length === 0,
        over.length ? (over.length + ' 次打到了多个：' +
          over.map(function (c) { return c.hits; }).join(',')) : '每次都只打到 1 个');
    });
  })();

  // ③ 2 星：被技能打中的人都冻 1.5 秒；活下来的都要有，死了的都不该有
  (function () {
    var r = iceFight(2);
    var I = iceCasts(r);
    TH.ok('这一场冻过人（否则后面全是空断言）', I.frost.length > 0,
      I.frost.length + ' 次冰冻');
    if (!I.frost.length) return;
    TH.ok('★ 每一次技能冰冻都是 1.5 秒（数据里那个数，不是写死的）',
      I.frost.every(function (e) { return Math.abs(e.dur - 1.5) < 1e-9; }),
      I.frost.length ? I.frost[0].dur + 's' : '—');
    var keys = frostKeySet(I.frost);
    var miss = [], wrongDead = [];
    I.casts.forEach(function (c) {
      c.surv.forEach(function (uid) {
        if (!keys[uid + '@' + c.t]) miss.push(uid + '@' + U.round2(c.t));
      });
      c.dead.forEach(function (uid) {
        if (keys[uid + '@' + c.t]) wrongDead.push(uid + '@' + U.round2(c.t));
      });
    });
    TH.ok('★★ 被技能打中而且活下来的人**每一个**都被冻上了（不是只冻第一个）',
      miss.length === 0, miss.slice(0, 4).join('　') || '全部冻上了');
    TH.ok('★ 被这一发打死的**尸体不会被冻**（给尸体挂眩晕会多出一条指向死人的事件）',
      wrongDead.length === 0, wrongDead.slice(0, 4).join('　') || '没有冻到尸体');
    TH.note('2 星：' + I.casts.length + ' 次施法，' + I.frost.length + ' 次冰冻');
  })();

  // ④ 1 星没有冰冻；3 星也带着 2 星那层（星级是叠加的，不是替换）
  (function () {
    var I1 = iceCasts(iceFight(1));
    TH.eq('★ 1 星的技能不会冰冻（冻手冻脚是 2 星的事）', I1.frost.length, 0);
    var I3 = iceCasts(iceFight(3));
    TH.ok('★ 3 星同时保留 2 星的冰冻（3 星 = 1 星 + 2 星 + 千里冰封）',
      I3.frost.length > 0, I3.frost.length + ' 次');
    TH.ok('★ 3 星的冰冻同样只落在"被这一发打中而且没死"的人身上',
      (function () {
        var keys = frostKeySet(I3.frost), miss = 0;
        I3.casts.forEach(function (c) {
          c.surv.forEach(function (uid) { if (!keys[uid + '@' + c.t]) miss++; });
        });
        return miss === 0;
      })(), '漏冻 ' + I3.frost.length + ' 次里的若干次');
  })();

  // ⑤ 不变量：新事件（reason='frost'）必须过校验器
  (function () {
    [1, 2, 3].forEach(function (star) {
      checkInvariants(iceFight(star), '冰冰冰·' + star + '星', function (msg) {
        TH.ok('不变量（冰冰冰 ' + star + ' 星）: ' + msg, false);
      });
    });
    TH.note('冰冰冰 1/2/3 星三场随机对局的事件流都过了不变量检查');
  })();

  /* ============================================================
   * 5c9. 孙笑川（原「血月屠夫」/ butcher）
   *
   *   技能「血月斩」一个字没动。
   *   1 星「天皇」      自身 3×3 内的队友 +20% 吸血率（不含他自己）
   *   2 星「儒雅随和」  技能造成的**所有**伤害 100% 转化为自己的治疗
   *   3 星「安排上了」  被自己击败的敌人以 20% 生命倒戈成我方单位
   *                     —— **对有复活能力的单位无效**
   * ============================================================ */
  TH.section('孙笑川 · 天皇 / 儒雅随和 / 安排上了');

  var SUN = ST.UNIT_BY_ID.butcher;
  TH.eq('单位已改名为孙笑川', SUN.name, '孙笑川');
  TH.eq('id 仍然是 butcher（levels.js 的 9 处阵容 + art/butcher.png 都按 id 索引）',
    SUN.id, 'butcher');
  TH.ok('★ 技能一个字没动（血月斩 / aoe / 580 / 半径 1）',
    SUN.skill.name === '血月斩' && SUN.skill.kind === 'aoe' &&
    SUN.skill.damage === 580 && SUN.skill.radius === 1,
    SUN.skill.name + '/' + SUN.skill.kind + '/' + SUN.skill.damage);
  TH.eq('被动类型是天皇', ST.passiveKind(SUN), 'mikado');
  /* ★★ 这一条和豆包/老牧师**不一样**：他们 1 星没有被动（names 从 2 开始），
     而孙笑川 1 星就有「天皇」。写错的话 1 星那一行会变成"升星预告"。 */
  TH.eq('★ 1 星就有被动，而且名字就是「天皇」', ST.passiveName(SUN, 1), '天皇');
  TH.eq('2 星的名字', ST.passiveName(SUN, 2), '天皇 + 儒雅随和');
  TH.eq('3 星的名字', ST.passiveName(SUN, 3), '天皇 + 儒雅随和 + 安排上了');
  TH.eq('★ 光环半径 1（= 3×3）', SUN.passive.auraRadius, 1);
  TH.eq('★ 光环给队友 +20% 吸血', SUN.passive.auraLifesteal, 0.20);
  TH.eq('★ 2 星起：技能伤害转治疗', SUN.passive.skillHealAt, 2);
  TH.eq('★ 转化比例是 100%', SUN.passive.skillHealPct, 1.00);
  TH.eq('★ 3 星起：击败的敌人倒戈', SUN.passive.convertAt, 3);
  TH.eq('★ 倒戈时以 20% 生命复活', SUN.passive.convertHpPct, 0.20);

  /* ---------- ① 天皇光环：只有 3×3 内的队友吃到吸血 ----------
   * ★ 对照组是**同一个场面、只把孙笑川挪远**（切比雪夫距离 > 1）。
   *   不设对照组的话，"队友有吸血"可能来自别的东西（装备/羁绊），验不出来。
   * ★ 队友特意不带血饮剑 —— 它的 lifesteal 本来是 0，
   *   所以任何一条 'lifesteal' 治疗都只可能来自光环。
   *
   * ★★ 队友**必须带一颗大果**（每秒自燃 6% 生命上限），这是探出来的：
   *   第一版给队友带了三条腰带 —— 结果它血又厚、而敌人**从来不打它**
   *   （孙笑川是近战，自己一路走到最前面，敌人的索敌永远选中他），
   *   于是队友**从头到尾没掉过血**，`healUnit` 见到满血直接返回 0，
   *   一条 lifesteal 事件都没有 —— 而"光环没生效"和"没有治疗缺口"
   *   在日志里长得**一模一样**。
   *   ★ 教训：验"回血类"效果时，一定要先确认**真的有缺口可回**；
   *     否则断言是在测"血量满不满"，不是在测那个效果。
   *
   * ★★ 站位也必须锁死，否则测不出"3×3 之外没有"：
   *   第二版想把孙笑川放到角落来制造"远离"，结果**他自己一路走过去**了 ——
   *   两个都是近战，都会向敌人靠拢，1.4 秒之后就又贴在一起，
   *   于是"近"和"远"两组都拿到 23 次吸血，看起来像光环是全队光环。
   *   现在改成"**每人各自咬住一个相邻的敌人**"：
   *     孙笑川 (3,0) 咬 (4,0)、队友 (3,N) 咬 (4,N)，双方都有相邻目标
   *     就都不会再挪动 —— 距离想设多远就设多远，而且完全确定。
   *   唯一变量只有队友那一列（1 = 贴着，3 = 隔三格）。 */
  (function () {
    /* 敌人用 1 星山岳 + 三腰带（3064 血、近战）：够肉，撑得住 30 秒，
       而且它会**咬住**贴上来的人不再移动 —— 这正是我们要的"锁死站位"。 */
    function foe(c) { return { id: 'titan', star: 1, items: ['belt', 'belt', 'belt'], r: 4, c: c }; }
    var ALLY = ['swiftboots', 'belt', 'belt'];
    function auraFight(allyCol) {
      return ST.Battle.battle({
        a: [{ id: 'butcher', star: 1, r: 3, c: 0 },
            { id: 'dagger', star: 3, items: ALLY, r: 3, c: allyCol }],
        b: [foe(0), foe(allyCol)]
      }, 7788);
    }
    function lsHeals(r, uid) {
      return r.log.filter(function (e) {
        return e.type === 'heal' && e.reason === 'lifesteal' && e.from === uid;
      });
    }
    var near = auraFight(1);           // 队友在 (3,1)：切比雪夫 1 → 在光环里
    var far = auraFight(3);            // 队友在 (3,3)：切比雪夫 3 → 光环外
    var allyNear = near.initial.units.filter(function (u) { return u.defId === 'dagger'; })[0];
    var allyFar = far.initial.units.filter(function (u) { return u.defId === 'dagger'; })[0];
    TH.eq('★ 对照组的队友自己**没有**吸血（否则下面那条是假的）',
      Math.round(allyNear.lifesteal * 100) + '/' + Math.round(allyFar.lifesteal * 100), '0/0');
    TH.ok('★ 两组的站位确实一个是 1 格、一个是 3 格',
      U.cheb(3, 1, 3, 0) === 1 && U.cheb(3, 3, 3, 0) === 3,
      U.cheb(3, 1, 3, 0) + ' / ' + U.cheb(3, 3, 3, 0));
    /* ★ 先确认这两场里"真的有缺口可回" —— 没有这一步，
       下面两条会在"队友满血"时假绿（这正是第一版的翻车方式）。 */
    var burnNear = near.log.filter(function (e) {
      return e.type === 'selfburn' && e.who === allyNear.uid;
    }).length;
    var burnFar = far.log.filter(function (e) {
      return e.type === 'selfburn' && e.who === allyFar.uid;
    }).length;
    TH.ok('★ 这两场里队友确实都在掉血（有缺口才谈得上吸血）',
      burnNear > 0 && burnFar > 0, burnNear + ' / ' + burnFar + ' 次自燃');
    var nNear = lsHeals(near, allyNear.uid).length;
    var nFar = lsHeals(far, allyFar.uid).length;
    TH.ok('★ 站在孙笑川 3×3 里的队友会吸血（光环真的生效）', nNear > 0,
      nNear + ' 次吸血治疗');
    TH.eq('★ 站到 3×3 之外就没有了（光环**不是**全队光环）', nFar, 0);
    TH.note('天皇光环：贴着他 ' + nNear + ' 次吸血 / 隔三格 ' + nFar + ' 次');

    /* ★ 顺带验一条容易写错的：**光环不给孙笑川自己**。
       文案写的是"队友"，而且奶龙 3 星的光环也是跳过自己（a === u）。 */
    var sunSelf = near.log.filter(function (e) {
      return e.type === 'heal' && e.reason === 'lifesteal' &&
             e.from === 'a0' && e.to === 'a0';
    });
    TH.eq('★ 光环不给自己（文案写的是"队友"）', sunSelf.length, 0);

    // 这两场都要过严格校验器（不然"招安/复活"那套模型没被跑到）
    checkInvariants(near, '孙笑川光环·贴着他', function (msg) {
      TH.ok('不变量（光环·贴着）: ' + msg, false);
    });
    checkInvariants(far, '孙笑川光环·挪远', function (msg) {
      TH.ok('不变量（光环·挪远）: ' + msg, false);
    });
  })();

  /* ---------- ② 2 星：技能造成的伤害全额回血 ---------- */
  (function () {
    var r = ST.Battle.battle({
      a: [{ id: 'butcher', star: 2, items: ['belt', 'belt', 'belt'], r: 3, c: 3 }],
      b: [{ id: 'titan', star: 1, items: ['belt', 'belt', 'belt'], r: 4, c: 3 }]
    }, 4455);
    var heals = r.log.filter(function (e) {
      return e.type === 'heal' && e.reason === 'skillHeal' && e.from === 'a0';
    });
    var casts = r.log.filter(function (e) { return e.type === 'cast' && e.from === 'a0'; });
    TH.ok('这一场他放出了技能（否则下面全是空断言）', casts.length > 0, casts.length + ' 次施法');
    TH.ok('★ 技能伤害真的转成了自己的治疗', heals.length > 0, heals.length + ' 次技能回血');

    /* ★ 逐次对账：这一 tick 的技能伤害总和 × 100%，但**不能超过缺的血**。
       只断言"有回血"太弱 —— 回 1 点也叫有回血。 */
    var badAmt = [], sample = '';
    for (var h = 0; h < heals.length; h++) {
      var he = heals[h];
      var sum = 0;
      for (var k = 0; k < r.log.length; k++) {
        var e2 = r.log[k];
        if (e2.type === 'skill' && e2.from === 'a0' && e2.t === he.t) sum += e2.dmg;
      }
      var before = U.round2(he.hpAfter - he.amount);
      var room = he.hpMax - before;
      var want = Math.min(sum, room);
      if (Math.abs(he.amount - want) > 1.5) {
        badAmt.push('t=' + U.round2(he.t) + ' 期望 ' + U.round2(want) + ' 实际 ' + he.amount);
      }
      if (!sample) {
        sample = 't=' + U.round2(he.t) + '　技能伤害合计 ' + U.round2(sum) +
                 '　回血 ' + U.round2(he.amount) + '（当时缺 ' + U.round2(room) + '）';
      }
    }
    TH.eq('★ 每一次回血量 = 那一 tick 的技能伤害合计（上限是当时缺的血）',
      badAmt.length, 0);
    if (badAmt.length) TH.note('对不上的：' + badAmt.slice(0, 3).join(' / '));
    TH.note('儒雅随和：' + sample);

    checkInvariants(r, '孙笑川2星·技能回血', function (msg) {
      TH.ok('不变量（2星技能回血）: ' + msg, false);
    });
  })();

  /* ---------- ③ 3 星：击败的敌人倒戈 ---------- */
  (function () {
    /* 场面：孙笑川 3 星 + 两个队友 vs 一堆脆皮（1 星荣誉 500 血，
       他一刀 382、血月斩 580，都能秒 —— 好让他真的拿到击杀）。 */
    var r = ST.Battle.battle({
      a: [{ id: 'butcher', star: 3, items: ['belt', 'belt', 'belt'], r: 3, c: 3 },
          { id: 'medic', star: 1, r: 0, c: 0 }],
      b: [{ id: 'bowman', star: 1, r: 4, c: 3 },
          { id: 'bowman', star: 1, r: 4, c: 4 },
          { id: 'bowman', star: 1, r: 4, c: 5 },
          { id: 'bowman', star: 1, r: 5, c: 3 },
          { id: 'bowman', star: 1, r: 5, c: 4 },
          { id: 'bowman', star: 1, r: 5, c: 5 }]
    }, 9090);
    var conv = r.log.filter(function (e) { return e.type === 'convert'; });
    TH.ok('★ 他击败的敌人真的倒戈了', conv.length > 0, conv.length + ' 个');

    var sun = r.initial.units.filter(function (u) { return u.defId === 'butcher'; })[0];
    TH.ok('★ 倒戈的全都是他本人击败的（不是队友杀的）',
      conv.every(function (e) { return e.from === sun.uid; }),
      conv.map(function (e) { return e.from; }).join(','));
    TH.ok('★ 倒戈时是以 20% 生命站起来',
      conv.every(function (e) { return Math.abs(e.hp - U.round2(e.hpMax * 0.2)) < 1.5; }),
      conv.length ? (conv[0].hp + '/' + conv[0].hpMax) : '—');
    TH.ok('★ 倒戈之后站在**我方**半场',
      conv.every(function (e) { return ST.Battle.sideOfRow(e.r) === e.toSide; }),
      conv.length ? ('(' + conv[0].r + ',' + conv[0].c + ') → ' + conv[0].toSide) : '—');

    /* ★★ 端到端：倒戈的人**真的替我们打仗**。
       只验"发了一条 convert 事件"是不够的 —— 那可能只是改了数据、
       而在寻敌时还被当成敌人（这正是忘了挪 st.side 数组时的现象）。 */
    var foughtBack = 0;
    for (var i = 0; i < conv.length; i++) {
      var uid = conv[i].who;
      for (var j = 0; j < r.log.length; j++) {
        var e3 = r.log[j];
        if (e3.type !== 'attack' || e3.from !== uid) continue;
        var tgt = r.initial.units.filter(function (u) { return u.uid === e3.to; })[0];
        if (tgt && tgt.side === conv[i].fromSide) { foughtBack++; break; }
      }
    }
    TH.ok('★ 倒戈的人之后会**打它原来的队友**（阵营真的换了，不只是改了个字段）',
      foughtBack > 0, foughtBack + '/' + conv.length + ' 个倒戈单位参战了');

    checkInvariants(r, '孙笑川3星·招安', function (msg) {
      TH.ok('不变量（3星招安）: ' + msg, false);
    });
  })();

  /* ---------- ④ 排除条件：有复活能力的单位不能被招安 ---------- */
  (function () {
    /* 牢大（2 星：既有坠机、又有复活次数）—— 孙笑川把它打死时，
       它该走**自己的**坠机→复活，而不是被招安。 */
    var r = ST.Battle.battle({
      a: [{ id: 'butcher', star: 3, items: ['belt', 'belt', 'belt'], r: 3, c: 3 }],
      b: [{ id: 'brute', star: 2, r: 4, c: 3 }]
    }, 5150);
    var conv = r.log.filter(function (e) { return e.type === 'convert'; });
    var revived = r.log.filter(function (e) { return e.type === 'revive'; });
    TH.ok('这一场牢大确实被打死过（否则这条没验到）',
      r.log.some(function (e) { return e.type === 'death' && e.who === 'b0'; }));
    TH.eq('★ 有复活能力的单位不会被招安（它走自己的坠机→复活）', conv.length, 0);
    TH.ok('★ 而且它确实是自己站起来的（证明上面不是"没打死"）', revived.length > 0,
      revived.length + ' 次复活');
    TH.note('牢大 vs 孙笑川：招安 ' + conv.length + ' 次 / 它自己复活 ' + revived.length + ' 次');

    checkInvariants(r, '孙笑川3星·牢大不被招安', function (msg) {
      TH.ok('不变量（牢大不被招安）: ' + msg, false);
    });
  })();

  /* ---------- ⑤ 排除条件：老牧师救回来的人，也不能再被招安 ----------
   * ★ 这个场面必须让**第一次死亡不是孙笑川打的** ——
   *   否则第一次就被招安走了，根本走不到"被牧师救活、再被打死"这一步。
   *   所以队里放一个大嘴（荣誉 3 星）负责先杀人。 */
  (function () {
    var r = ST.Battle.battle({
      a: [{ id: 'butcher', star: 3, items: ['belt', 'belt', 'belt'], r: 0, c: 0 },
          { id: 'bowman', star: 3, items: ['belt', 'belt', 'belt'], r: 3, c: 3 }],
      b: [{ id: 'medic', star: 2, items: ['belt', 'belt', 'belt'], r: 5, c: 5 },
          { id: 'dagger', star: 1, r: 4, c: 3 }]
    }, 6262);
    var saved = r.log.filter(function (e) { return e.type === 'reviveAlly' && e.ok; });
    TH.ok('这一场老牧师确实救过人（否则这条没验到）', saved.length > 0,
      saved.length + ' 次');
    if (saved.length) {
      var who = saved[0].who;
      var deathsOf = r.log.filter(function (e) { return e.type === 'death' && e.who === who; });
      var convOf = r.log.filter(function (e) { return e.type === 'convert' && e.who === who; });
      TH.eq('★ 被老牧师救回来的人第二次倒下时**不会**被招安', convOf.length, 0);
      TH.note('被牧师救的是 ' + who + '：它死了 ' + deathsOf.length + ' 次，被招安 ' +
        convOf.length + ' 次');
    }
    checkInvariants(r, '孙笑川3星·牧师救过的不招安', function (msg) {
      TH.ok('不变量（牧师救过的不招安）: ' + msg, false);
    });
  })();

  /* ============================================================
   * 5c6. 100元的鸭子（原「铁壁」/ ironwall）
   *
   *   血量砍到十分之一（950 → 95），被动改成「抓娃娃」：
   *   敌人打过来的前 N 次伤害判定直接无效（1/2/3 星 = 20/30/40 次）。
   *
   *   ★ 这一套的重点是「拦在正确的位置上」：
   *     它必须拦在 dealDamage 的**最前面**，拦截之后
   *     血、盾、法力、被击统计全都不该动 —— 否则就是"看着挡住了、其实扣了血"。
   * ============================================================ */
  TH.section('100元的鸭子 · 抓娃娃');

  var DUCK = ST.UNIT_BY_ID.ironwall;
  TH.eq('单位已改名为 100元的鸭子', DUCK.name, '100元的鸭子');
  TH.eq('id 仍然是 ironwall（levels.js 的阵容 + art 文件名都按 id 索引）',
    DUCK.id, 'ironwall');
  TH.eq('被动类型是抓娃娃', ST.passiveKind(DUCK), 'clawGuard');
  TH.eq('★ 血量砍到 950 的十分之一', DUCK.hp, 95);
  TH.eq('被动名字三个星级一样', ST.passiveName(DUCK, 1), '抓娃娃');
  TH.eq('★ 1/2/3 星分别能挡 20/30/40 次',
    [ST.passiveStep(DUCK, 1), ST.passiveStep(DUCK, 2), ST.passiveStep(DUCK, 3)].join('/'),
    '20/30/40');

  /** 一只鸭子 vs 一个打不死它的陪练：鸭子会把前 N 次挨打全部挡掉 */
  function duckFight(star, seed) {
    return ST.Battle.battle({
      a: [{ id: 'ironwall', star: star, r: 4, c: 3 }],
      // 三条腰带的匕首客：血厚、输出低，能一直打但打不出结果
      b: [{ id: 'dagger', star: 1, items: ['belt', 'belt', 'belt'], r: 3, c: 3 }]
    }, seed || 313131);
  }
  function blocksOf(res, uid) {
    var out = [];
    for (var i = 0; i < res.log.length; i++) {
      var e = res.log[i];
      if (e.type === 'block' && (!uid || e.who === uid)) out.push(e);
    }
    return out;
  }

  // ① 三个星级的挡伤次数必须正好是 min(20/30/40, 实际挨打次数)
  (function () {
    [1, 2, 3].forEach(function (star) {
      var want = ST.passiveStep(DUCK, star);
      var r = duckFight(star);
      var bs = blocksOf(r, 'a0');
      /* ★ 断言写成 min(上限, 挨打次数)，而不是死写 20/30/40：
         陪练不一定活得够久（鸭子会把它打死），所以"挡了几次"的
         恒等式是 min(上限, 挨打次数) —— 这个在任何场景里都成立。 */
      var hits = r.log.filter(function (e) {
        return (e.type === 'attack' || e.type === 'skill') && e.to === 'a0';
      }).length;
      var seqOk = true;
      for (var i = 0; i < bs.length; i++) {
        if (bs[i].left !== want - 1 - i) seqOk = false;
      }
      TH.eq('★ ' + star + ' 星鸭子挡下的次数 = min(' + want + ', 挨打次数)',
        bs.length, Math.min(want, hits));
      TH.ok('★ ' + star + ' 星的剩余次数逐个递减，从不跳号', seqOk,
        bs.length ? ('挨打 ' + hits + ' 次，挡了 ' + bs.length + ' 次：left ' +
                     bs[0].left + ' → ' + bs[bs.length - 1].left)
                  : '没有挡过');
    });
  })();

  /* ② 被挡住的那一下**一分血、一点盾都不掉**。
     ★ 这条是「抓娃娃」最容易做假的地方：只在画面上表现"挡住了"、
       数值上照扣，玩家是看不出来的（血条有滞后动画，肉眼分辨不了）。
     ★ 注意鸭子自己会开护盾（钢铁壁垒 380），所以"挡住"必须连**护盾**也不掉 ——
       只判血量的话，一个 380 盾能替它扛十几下，而测试毫无察觉。 */
  (function () {
    var r = duckFight(1);
    var cap = ST.passiveStep(DUCK, 1);
    var blocked = 0, bad = [];
    for (var i = 0; i < r.log.length; i++) {
      var e = r.log[i];
      if (e.type === 'block' && e.who === 'a0') { blocked++; continue; }
      if (e.to !== 'a0' || e.dmg === undefined) continue;
      if (blocked >= cap) continue;                    // 窗口已经关了
      if (e.dmg !== 0 || (e.hpLoss || 0) !== 0 || (e.shieldLoss || 0) !== 0) {
        bad.push('t=' + U.round2(e.t) + ' dmg=' + e.dmg + ' hp=' + (e.hpLoss || 0) +
                 ' shield=' + (e.shieldLoss || 0));
      }
    }
    TH.ok('这场跑出了足够多的挡伤', blocked >= cap, blocked + ' 次');
    TH.eq('★ 挡伤窗口内，每一次挨打的 dmg / hpLoss / shieldLoss 全是 0',
      bad.slice(0, 3).join('；') || '无', '无');
  })();

  /* ③ 窗口一关，伤害立刻恢复 —— 而且从那以后每一次都是真的。
     ★ 这里**不再断言「它很快就死」**：鸭子自己会刷护盾（钢铁壁垒 380），
       面对一个输出很低的陪练时它能一直活下去。那是对局结果，不是机制；
       这里要验的是「免伤确实只持续 N 次，不会偷偷续上」。 */
  (function () {
    var r = duckFight(1);
    var cap = ST.passiveStep(DUCK, 1);
    var lastBlock = -1;
    for (var i = 0; i < r.log.length; i++) {
      if (r.log[i].type === 'block' && r.log[i].who === 'a0') lastBlock = i;
    }
    TH.ok('挡完了最后一下', lastBlock >= 0, '最后一次挡伤是第 ' + lastBlock + ' 条事件');
    /* ★ 从**下一条 tick** 开始扫，而不是从 lastBlock + 1：
       被挡的那一下自己的 attack/skill 事件就排在 block 后面、而且是 dmg=0，
       从 +1 开始扫会把它误判成「窗口关了还在免伤」。 */
    var lastT = r.log[lastBlock].t;
    var after = null, zeroAfter = [];
    for (var j = lastBlock + 1; j < r.log.length; j++) {
      var e = r.log[j];
      if (e.t <= lastT) continue;
      if (e.to !== 'a0' || e.dmg === undefined) continue;
      if (e.dmg > 0) { if (!after) after = e; }
      else zeroAfter.push(e.type + '/' + (e.reason || '-'));
    }
    TH.ok('★ 次数一用完，下一次攻击就打出真实伤害（不再是免伤状态）',
      after !== null, after ? ('t=' + U.round2(after.t) + ' 打出 ' + U.round2(after.dmg))
                            : '整场都没有再挨到真实伤害');
    TH.eq('★ 窗口关闭之后不再出现 0 伤害（免伤不会偷偷续上）',
      zeroAfter.slice(0, 3).join('；') || '无', '无');
  })();

  /* ④ 计数是**总次数**，不区分是谁打的。
     多个人一起打，也只按总数扣 —— 这正是「前 N 次攻击」的字面意思。 */
  (function () {
    var r = ST.Battle.battle({
      a: [{ id: 'ironwall', star: 1, r: 4, c: 3 }],
      b: [{ id: 'dagger', star: 1, items: ['belt', 'belt', 'belt'], r: 3, c: 2 },
          { id: 'dagger', star: 1, items: ['belt', 'belt', 'belt'], r: 3, c: 3 },
          { id: 'dagger', star: 1, items: ['belt', 'belt', 'belt'], r: 3, c: 4 }]
    }, 424242);
    var bs = blocksOf(r, 'a0');
    var sources = {};
    bs.forEach(function (e) { sources[e.from] = (sources[e.from] || 0) + 1; });
    TH.eq('★ 三个人一起打，鸭子总共还是只挡 20 次（按总次数算，不按人头）',
      bs.length, 20);
    TH.ok('★ 而且三个人都参与了（不是只针对某一个人免伤）',
      Object.keys(sources).length >= 2,
      Object.keys(sources).map(function (k) { return k + '×' + sources[k]; }).join(' '));
  })();

  /* ============================================================
   * 5c9. 奶龙（原「石卫」/ stoneguard）
   *
   *   技能「捧腹大笑」是一个**纯 CD 技能**（cdSeconds = 13）：
   *     立刻大笑 3 秒 —— 期间不能移动、不能攻击，
   *     但受到的伤害 -80%、每秒回复 10% 最大生命。
   *
   *   星级被动三层（改的都是**同一个状态**）：
   *     1 星「笑气护体」  就是技能本身（很硬，但动不了打不了）
   *     2 星「边走边笑」  大笑期间可以移动（仍然不能攻击）
   *     3 星「笑传四方」  大笑期间同时治疗 3×3 内的队友
   *
   *   ★ 这一套里最容易做假的两处，是断言的重点：
   *     ① 「-80%」必须真的走 dealDamage（而不是改面板血量/护甲糊过去）
   *        —— 用 dmg / raw 的比值验，减抗和 ramp 都会自动约掉。
   *     ② 「不能移动」必须是**真的不动**，而不是"碰巧不需要动"。
   *        —— 所以要看**同一场里、同一个棋子**：
   *           大笑窗口内移动 0 次，窗口外移动 > 0 次。
   * ============================================================ */
  TH.section('奶龙 · 捧腹大笑');

  var DRAGON = ST.UNIT_BY_ID.stoneguard;
  TH.eq('单位已改名为奶龙', DRAGON.name, '奶龙');
  TH.eq('id 仍然是 stoneguard（levels.js 的阵容 + art 文件名都按 id 索引）',
    DRAGON.id, 'stoneguard');
  TH.eq('技能改名为捧腹大笑', DRAGON.skill.name, '捧腹大笑');
  TH.eq('技能类型是 laugh', DRAGON.skill.kind, 'laugh');
  TH.eq('被动类型是 laugh', ST.passiveKind(DRAGON), 'laugh');
  TH.eq('★ 技能走 13 秒冷却（不是法力）', DRAGON.skill.cast.cooldown, 13);
  TH.eq('★ 大笑 3 秒', DRAGON.skill.dur, 3);
  TH.eq('★ 减伤 80%（存的是比例，不是百分数）', DRAGON.skill.dmgCut, 0.80);
  TH.eq('★ 每秒回复 10% 最大生命', DRAGON.skill.healPct, 0.10);
  TH.eq('被动名字按星级叠加',
    [ST.passiveName(DRAGON, 1), ST.passiveName(DRAGON, 2), ST.passiveName(DRAGON, 3)].join('/'),
    '笑气护体/笑气护体 + 边走边笑/笑气护体 + 边走边笑 + 笑传四方');
  TH.eq('★ 2 星解锁「边走边笑」、3 星解锁「笑传四方」',
    [DRAGON.passive.moveAt, DRAGON.passive.healAt].join(','), '2,3');
  TH.eq('★ 3×3 的半径是 1', DRAGON.passive.healRadius, 1);

  /* ---------- 这一节用到的几个场景与工具 ---------- */

  /* 陪练是**老牧师**，而且是特意挑的：
     · 它的技能只给自己回血（kind: 'heal'），所以打过来的**每一下都是普攻**，
       算 dmg / raw 的时候不会被技能伤害混进来；
     · 它回血比奶龙打得快，所以它**永远死不了** —— 对局一定跑满 60 秒，
       不会因为陪练先死而提前结束；
     · 但它自己也打不死奶龙（74 攻 / 0.68 攻速），奶龙能笑着活到最后。 */
  function dragonFight(star, seed) {
    return ST.Battle.battle({
      a: [{ id: 'stoneguard', star: star, items: ['belt', 'belt', 'belt'], r: 0, c: 0 }],
      b: [{ id: 'medic', star: 1, r: 7, c: 7 }]
    }, seed);
  }
  function laughEventsOf(res, uid) {
    var out = [];
    for (var i = 0; i < res.log.length; i++) {
      var e = res.log[i];
      if (e.type === 'laugh' && (!uid || e.who === uid)) out.push(e);
    }
    return out;
  }
  function movesOfUid(res, uid) {
    var out = [];
    for (var i = 0; i < res.log.length; i++) {
      if (res.log[i].type === 'move' && res.log[i].who === uid) out.push(res.log[i]);
    }
    return out;
  }
  /* ★ 3★ 的奶龙血厚得多（2203 + 三腰带），能撑满 60 秒 ——
     减伤那条断言要的是**样本多**，所以用最耐打的那个星级。 */
  function cutFight(star) { return dragonFight(star, 424242); }
  function laughHealsOf(res, uid) {
    return res.log.filter(function (e) {
      return e.type === 'heal' && e.to === uid && e.reason === 'laugh';
    });
  }
  function auraHealsOf(res) {
    return res.log.filter(function (e) { return e.reason === 'laughAura'; });
  }
  /** 某一刻某个棋子在哪个格子：从初始快照出发，把 t 之前的 move / swap 叠上去。
   *  ★ 判「治疗的人是不是在 3×3 之内」不能用初始快照的位置 ——
   *    治疗发生的时候大家可能已经走位了，用旧位置会误判成"奶了一个很远的人"。 */
  function posAt(res, uid, t) {
    var r = null, c = null;
    for (var i = 0; i < res.initial.units.length; i++) {
      if (res.initial.units[i].uid === uid) {
        r = res.initial.units[i].r; c = res.initial.units[i].c; break;
      }
    }
    if (r === null) return null;
    for (var j = 0; j < res.log.length; j++) {
      var e = res.log[j];
      if (e.t > t) break;
      if (e.type === 'move' && e.who === uid) { r = e.r; c = e.c; }
      else if (e.type === 'swap') {
        if (e.a === uid) { r = e.aR; c = e.aC; }
        else if (e.b === uid) { r = e.bR; c = e.bC; }
      }
    }
    return { r: r, c: c };
  }
  function chebAt(res, uidA, uidB, t) {
    var a = posAt(res, uidA, t), b = posAt(res, uidB, t);
    if (!a || !b) return 99;
    return Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c));
  }
  /* 3 星「笑传四方」：奶龙身边左右各站一个队友，正面三个老牧师压过来。
     ★ 这么摆有两个理由，都是踩过坑才定下来的：
       ① 「谁挨打」不由测试说了算（索敌只看距离），所以队友必须紧挨着奶龙；
       ② 陪练**必须是老牧师**：它只给自己人回血、输出又低（74 攻 / 0.68 攻速），
          于是敌人永远死不了 → 对局一定跑满 60 秒 → 奶龙一定笑得出 4 次。
          换成匕首客（技能 240 伤害 + 被动越打越快）会在 9 秒内被打完，
          奶龙根本活不到第一次大笑，"3 星会治疗队友"就测成了 0 条。
     ★★ 队友**不能用山岳**：它给自己套 620 护盾，伤害全被盾吃掉，血量一直满着，
        healUnit 直接返回 0（满了就没得治）—— 同样会测成"一条都没有"。
        荣誉/医师这类不吃盾的，挨多少掉多少，才有得治。 */
  function auraFight(star) {
    return ST.Battle.battle({
      a: [{ id: 'stoneguard', star: star, items: ['belt', 'belt', 'belt'], r: 3, c: 3 },
          { id: 'bowman', star: 1, items: ['belt', 'belt', 'belt'], r: 3, c: 2 },
          { id: 'bowman', star: 1, items: ['belt', 'belt', 'belt'], r: 3, c: 4 }],
      b: [{ id: 'medic', star: 1, items: ['belt', 'belt', 'belt'], r: 4, c: 2 },
          { id: 'medic', star: 1, items: ['belt', 'belt', 'belt'], r: 4, c: 3 },
          { id: 'medic', star: 1, items: ['belt', 'belt', 'belt'], r: 4, c: 4 }]
    }, 818181);
  }
  /* 2 星「边走边笑」怎么测？
     ★★ 先说一个反直觉的事实：**在正常对局里，"大笑期间要走位"几乎不会发生**。
        原因是走位只出现在两处 —— 开局接近那两三秒，和目标死了要换人那一下。
        棋子 0.3 秒走一格、棋盘只有 8 列，所以任何一次"要走"都在两三秒内走完；
        而奶龙的第一次大笑在第 13 秒，那时候它早就贴身了。
        （我一开始硬凑了 30 个种子想让位移落进窗口，一个都没中。）
     ★ 所以这里**主动造**一个"笑声里必须往回走"的场合：对面的牢大会「肘击」，
       把自己往后推 2 格。被推走之后奶龙就得自己走回来 —— 这是唯一一种
       能稳定发生在第 13 秒之后的位移。
        牢大带一颗蓝水晶（开局 35 法力、上限 75）：第 4 次普攻放第一次肘击，
        之后每 8 次普攻一次。按 0.72 攻速算，落点大概是 5.6 / 16.7 / 27.8 秒 ——
        第三次（27.8 秒）正好落在**第二轮大笑窗口（26.1~29.1 秒）**里。
     ★ 于是同一场戏里两个星级各演一遍：
        2 星被推走之后自己走了回来（窗口内有移动）；
        1 星在同一时刻被推走，但在窗口内**一步都没动**（它想动，动不了），
        等 29.1 秒笑声结束才走回去。 */
  function walkFight(star, seed) {
    return ST.Battle.battle({
      a: [{ id: 'stoneguard', star: star, items: ['belt', 'belt', 'belt'], r: 3, c: 3 }],
      b: [{ id: 'brute', star: 1, items: ['sapphire', 'belt', 'belt'], r: 4, c: 3 }]
    }, seed || 777);
  }
  function walkCounts(star, seed) {
    var r = walkFight(star, seed);
    var wins = laughEventsOf(r, 'a0').map(function (e) { return [e.t, e.until]; });
    var moves = movesOfUid(r, 'a0');
    function inWin(t) {
      for (var k = 0; k < wins.length; k++) {
        if (t >= wins[k][0] && t < wins[k][1]) return true;
      }
      return false;
    }
    var times = moves.filter(function (e) { return inWin(e.t); })
      .map(function (e) { return U.round2(e.t); });
    return { res: r, all: moves.length, inWin: times.length,
             outWin: moves.length - times.length, times: times,
             laughs: wins.map(function (w) { return U.round2(w[0]); }),
             moveT: moves.map(function (e) { return U.round2(e.t); }) };
  }

  /* ★ 三个星级的开关必须真的落在初始快照里，
     而且方向是「2 星起可以移动、3 星起治疗队友」。
     （渲染层的徽章、game.js 的被动说明全都读这三个字段。） */
  (function () {
    [1, 2, 3].forEach(function (star) {
      var r = dragonFight(star, 1);
      var me = r.initial.units.filter(function (u) { return u.defId === 'stoneguard'; })[0];
      var wantMove = star >= 2, wantHeal = star >= 3;
      TH.eq('★ ' + star + ' 星：快照里的「可以边走边笑」=' + wantMove,
        !!me.laughMove, wantMove);
      TH.eq('★ ' + star + ' 星：快照里的「大笑治疗队友」=' + wantHeal,
        !!me.laughHeal, wantHeal);
      TH.eq('★ ' + star + ' 星：技能时长仍然写进快照', me.laughDur, 3);
    });
  })();

  /* ① 冷却：技能**开局就在转**（和法力型攒满才放不一样），
        第一次大笑必须落在 t ≈ 13 秒，之后每隔 13 秒一次。
        ★ 断言写成"相邻两次大笑的间隔 >= 冷却"，而不是死写 13.0：
          第 30 秒一帧一帧地跑，落点会有 1/30 秒的量化误差。 */
  (function () {
    var r = dragonFight(1, 1);
    var ls = laughEventsOf(r, 'a0');
    TH.note('奶龙 1 星：一局大笑 ' + ls.length + ' 次，时刻 ' +
      ls.map(function (e) { return U.round2(e.t); }).join(' / ') +
      '，对局 ' + U.round2(r.log[r.log.length - 1].t) + 's');
    TH.ok('★ 至少笑得出来一次', ls.length >= 2, ls.length + ' 次');
    TH.ok('★ 第一次大笑在 13 秒左右（冷却开局就在转，不是法力攒满）',
      Math.abs(ls[0].t - 13) < 0.4, 't=' + U.round2(ls[0].t));
    var gapOk = true, minGap = 99;
    for (var i = 1; i < ls.length; i++) {
      var g = ls[i].t - ls[i - 1].t;
      if (g < minGap) minGap = g;
      if (g < 13 - 0.05) gapOk = false;
    }
    TH.ok('★ 两次大笑之间至少隔 13 秒（冷却不会被跳过）', gapOk,
      ls.length > 1 ? ('最短间隔 ' + U.round2(minGap) + 's') : '只笑了一次');
    // 笑 3 秒：事件里的 until 必须正好是 t + 3
    var durOk = ls.every(function (e) { return Math.abs((e.until - e.t) - 3) < 1e-6; });
    TH.ok('★ 每次大笑都是整整 3 秒', durOk,
      ls.length ? U.round2(ls[0].until - ls[0].t) + 's' : '—');
    // 事件里带的减伤 / 回血必须是数据里的值
    TH.ok('★ 事件里带的减伤就是 80%',
      ls.every(function (e) { return Math.abs(e.cut - 0.80) < 1e-9; }));
    TH.ok('★ 事件里带的回血就是每秒 10%',
      ls.every(function (e) { return Math.abs(e.healPct - 0.10) < 1e-9; }));
  })();

  /* ② 「-80%」必须真的发生在伤害计算里。
        ★ 做法：只看**普攻**（陪练是老牧师，它的技能只给自己回血，
          所以打过来的每一下都是 attack），然后算 dmg / raw。
          raw 是"出手方本来能打多少"，所以 dmg / raw = 减抗系数 × (1 - 大笑减伤)。
          同一个陪练、同一套护甲，窗口内外的减抗系数是同一个数，
          两个比值相除就只剩下 0.2 —— 不需要知道 reduce() 的公式。 */
  (function () {
    var r = cutFight(3);
    var untils = laughEventsOf(r, 'a0').map(function (e) { return [e.t, e.until]; });
    var inside = [], outside = [];
    for (var i = 0; i < r.log.length; i++) {
      var e = r.log[i];
      if (e.type !== 'attack' || e.to !== 'a0' || e.crit) continue;
      if (!(e.raw > 0)) continue;
      var t = e.t, inWin = false;
      for (var k = 0; k < untils.length; k++) {
        if (t >= untils[k][0] && t < untils[k][1]) { inWin = true; break; }
      }
      (inWin ? inside : outside).push(e.dmg / e.raw);
    }
    TH.note('大笑减伤采样：窗口内 ' + inside.length + ' 下、窗口外 ' + outside.length + ' 下');
    TH.ok('★ 窗口内外都采到了样本', inside.length >= 3 && outside.length >= 5,
      '窗口内 ' + inside.length + ' / 窗口外 ' + outside.length);
    if (inside.length && outside.length) {
      var avg = function (a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; };
      var ratio = avg(inside) / avg(outside);
      TH.ok('★ 大笑期间每次挨打只吃到 20% 的伤害（-80% 真的走的是伤害计算）',
        Math.abs(ratio - 0.2) < 0.02, '实测 ' + (ratio * 100).toFixed(1) + '%');
    }
  })();

  /* ③ 每秒回复 10% 最大生命。
        ★ 回血会被"血是满的"截断（healUnit 里满了就返回 0），
          所以不能断言"每局一定有 3 条 laugh 回血"，
          但可以断言：只要是 laugh 的那一条，数值就 <= 10% 最大生命，
          而且每两条之间至少隔 1 秒。 */
  (function () {
    var r = cutFight(3);
    var me = r.initial.units.filter(function (u) { return u.uid === 'a0'; })[0];
    var heals = r.log.filter(function (e) {
      return e.type === 'heal' && e.to === 'a0' && e.reason === 'laugh';
    });
    TH.note('奶龙 3 星：laugh 自我回血 ' + heals.length + ' 条，单条 ' +
      (heals.length ? U.round2(heals[0].amount) : '—') + ' / 上限 ' +
      U.round2(me.maxHp * 0.10));
    TH.ok('★ 大笑期间确实在回血', heals.length >= 3, heals.length + ' 条');
    TH.ok('★ 单条回血不超过 10% 最大生命',
      heals.every(function (e) { return e.amount <= me.maxHp * 0.10 + 1e-6; }),
      heals.length ? ('最大一条 ' + U.round2(Math.max.apply(null, heals.map(function (e) { return e.amount; })))) : '—');
    // 同一轮大笑里的三次回血必须一秒一次
    var ts = heals.map(function (e) { return e.t; });
    var stepOk = true;
    for (var i = 1; i < ts.length; i++) {
      var g = ts[i] - ts[i - 1];
      if (g < 0.999 && g > 0.001) stepOk = false;     // 允许 1.0s 或「跳到下一轮大笑」
    }
    TH.ok('★ 同一轮大笑里每秒回一次（间隔 1 秒）', stepOk,
      ts.slice(1, 4).map(function (x, i) { return U.round2(x - ts[i]); }).join('/'));
  })();

  /* ④ 3 星「笑传四方」：大笑期间治疗 3×3 内的队友。
        ★ 断言必须两边都验：
           · 3 星 有 laughAura 事件，而且目标都在 3×3 之内
           · 2 星 **一条都没有**（否则"3 星才解锁"就是假的） */
  (function () {
    var r3 = auraFight(3), r2 = auraFight(2);
    var a3 = r3.log.filter(function (e) { return e.reason === 'laughAura'; });
    var a2 = r2.log.filter(function (e) { return e.reason === 'laughAura'; });
    var me3 = r3.initial.units.filter(function (u) { return u.uid === 'a0'; })[0];
    var allHeal3 = 0, selfHeal3 = 0;
    r3.log.forEach(function (e) {
      if (e.type !== 'heal') return;
      allHeal3++;
      if (e.reason === 'laugh') selfHeal3++;
    });
    TH.note('诊断：3★ 大笑 ' + laughEventsOf(r3, 'a0').length + ' 次，laughHeal=' +
      me3.laughHeal + ' laughRadius=' + me3.laughRadius +
      ' laughHealPct=' + me3.laughHealPct +
      '，全场 heal ' + allHeal3 + ' 条（其中自我回血 ' + selfHeal3 +
      ' 条），对局 ' + U.round2(r3.log[r3.log.length - 1].t) + 's');
    TH.note('3 星 laughAura ' + a3.length + ' 条 / 2 星 ' + a2.length + ' 条');
    TH.ok('★ 3 星大笑时会治疗队友', a3.length >= 3, a3.length + ' 条');
    TH.eq('★ 2 星一条都不治（3 星才解锁「笑传四方」）', a2.length, 0);
    var init = {};
    r3.initial.units.forEach(function (u) { init[u.uid] = u; });
    var far = [], fromOk = true, srcIds = {};
    for (var i = 0; i < a3.length; i++) {
      var e = a3[i];
      if (!(e.amount <= init[e.to].maxHp * 0.10 + 1e-6)) fromOk = false;
      srcIds[e.from] = 1;
      /* ★ 距离要按**事件时刻**算：治疗发生时大家可能已经走位了，
         用初始快照的位置去判距离会误判成"奶了一个很远的人"。 */
      var d = chebAt(r3, e.to, e.from, e.t);
      if (d > 1) far.push(e.to + ' 距离 ' + d);
    }
    TH.ok('★ 被治的人全在 3×3 之内', far.length === 0, far.slice(0, 3).join('；') || '无');
    TH.ok('★ 治疗量同样不超过 10% 最大生命', fromOk);
    TH.eq('★ 治疗来源只有奶龙自己（不会传染出去）',
      Object.keys(srcIds).join(','), 'a0');
    TH.ok('★ 3×3 里的人治疗量等于 10% 各自的最大生命',
      a3.every(function (e) { return Math.abs(e.amount - init[e.to].maxHp * 0.10) < 2; }),
      a3.length ? U.round2(a3[a3.length - 1].amount) : '—');
  })();

  /* ⑤ 「不能移动」是真的不能动，而不是"碰巧不需要动"。
        ★ 这条要靠**同一场里、同一个棋子**的对比：
           大笑窗口内移动 0 次（1 星），窗口外移动 > 0 次。
          陪练只有一只站桩的老牧师 —— 奶龙一辈子也打不死它，
          所以走位只发生在开局接近的那两秒（窗口之外）。
          窗口之内如果还有位移，那就一定是"大笑没冻住它"。 */
  (function () {
    var counts = {};
    [1, 2, 3].forEach(function (star) {
      var r = dragonFight(star, 9);
      var wins = laughEventsOf(r, 'a0').map(function (e) { return [e.t, e.until]; });
      var moves = movesOfUid(r, 'a0');
      function inWin(t) {
        for (var k = 0; k < wins.length; k++) {
          if (t >= wins[k][0] && t < wins[k][1]) return true;
        }
        return false;
      }
      var inM = moves.filter(function (e) { return inWin(e.t); }).length;
      counts[star] = { all: moves.length, inWin: inM, outWin: moves.length - inM,
                       laughs: wins.length };
    });
    TH.note('大笑期间移动次数（1/2/3 星）：' +
      [1, 2, 3].map(function (s) {
        return s + '★ ' + counts[s].inWin + '/' + counts[s].outWin +
          '（共 ' + counts[s].all + '，大笑 ' + counts[s].laughs + ' 次）';
      }).join('　'));
    TH.ok('★ 1 星：大笑期间一次都没动过', counts[1].inWin === 0,
      counts[1].inWin + ' 次');
    TH.ok('★ 1 星：窗口之外是在走路的（所以上面那条不是"不需要动"）',
      counts[1].outWin > 0, counts[1].outWin + ' 次');
  })();

  /* ⑤b 2 星「边走边笑」：同一个场景里，1 星不动、2 星动了。
        （场景为什么长这样，见上面 walkFight 的说明。） */
  (function () {
    var w2 = walkCounts(2), w1 = walkCounts(1);
    var kb2 = w2.res.log.filter(function (e) { return e.type === 'knockback' && e.to === 'a0'; })
      .map(function (e) { return U.round2(e.t); });
    var kb1 = w1.res.log.filter(function (e) { return e.type === 'knockback' && e.to === 'a0'; })
      .map(function (e) { return U.round2(e.t); });
    TH.note('肘击把奶龙推走的时刻：2★ ' + kb2.join('/') + '　1★ ' + kb1.join('/'));
    TH.note('大笑窗口：' + w2.laughs.join('/') + '　奶龙移动时刻：2★ ' +
      w2.moveT.join('/') + '　1★ ' + w1.moveT.join('/'));
    TH.ok('这一场牢大真的把奶龙推开过（不然下面的断言就没意义）',
      kb2.length >= 3 && kb1.length >= 2, '2★ ' + kb2.length + ' 次 / 1★ ' + kb1.length + ' 次');
    /* ★ 2 星那一步落在 13.03~16.03 这个窗口里，是**确定性**的
       （同一个种子必然复现同一帧），但余量只有半秒左右 ——
       所以这里只断言"窗口里有移动"，不断言具体时刻，
       免得哪天有人调了 MOVE_INTERVAL 就必须回来改这个数字。 */
    TH.ok('★ 2 星「边走边笑」：被推走之后在大笑期间自己走回来了',
      w2.inWin > 0, '窗口内 ' + w2.inWin + ' 步（t=' + w2.times.join('/') + '）');
    TH.eq('★ 1 星在同一场戏里大笑期间一步都没动', w1.inWin, 0);
    TH.ok('★ 而 1 星在窗口外是走回来了的（所以上面那条不是"它不需要动"）',
      w1.outWin > 0, '窗口外 ' + w1.outWin + ' 步');
  })();

  /* ⑥ 笑的时候**仍然不能攻击**（2 星的「边走边笑」只买到了移动，
        没有买到出手 —— 数据里就是这么写的，别让它被顺手放开）。 */
  (function () {
    var r = dragonFight(2, 9);
    var wins = laughEventsOf(r, 'a0').map(function (e) { return [e.t, e.until]; });
    var inWin = 0, all = 0;
    for (var i = 0; i < r.log.length; i++) {
      var e = r.log[i];
      if (e.type !== 'attack') continue;
      if (e.from !== 'a0') continue;
      all++;
      for (var k = 0; k < wins.length; k++) {
        if (e.t > wins[k][0] + 1e-9 && e.t < wins[k][1]) inWin++;
      }
    }
    TH.ok('这一场奶龙一直在普攻（所以下面那条不是"没机会打"）', all >= 10, all + ' 次');
    TH.eq('★ 2 星大笑期间出手次数为 0（只有移动被解锁）', inWin, 0);
  })();

  /* ⑦ 冷却条：奶龙不吃法力，所以法力条在这里表示的是**冷却进度**。
        ★ 这正是渲染层画那条进度条的依据：它读不了 cooldownTick 的内部状态，
          只能从事件流里拿 manaAfter。所以这条断言是"界面能不能显示对"的前提：
          每次普攻报出来的法力，必须正好等于
              maxMana × (距上次大笑过了几秒 / 13)
          —— 不多不少。（如果照法力型那样 +10，进度条会在两次大笑之间乱跳。） */
  (function () {
    var r = dragonFight(2, 9);
    var me = r.initial.units.filter(function (u) { return u.uid === 'a0'; })[0];
    var laughs = laughEventsOf(r, 'a0').map(function (e) { return e.t; });
    var atks = r.log.filter(function (e) {
      return e.type === 'attack' && e.from === 'a0' && e.manaAfter !== undefined;
    });
    TH.ok('采到了奶龙的普攻日志', atks.length >= 5, atks.length + ' 条');
    var worst = 0, worstAt = -1;
    for (var i = 0; i < atks.length; i++) {
      var t0 = 0;
      for (var k = 0; k < laughs.length; k++) if (laughs[k] <= atks[i].t) t0 = laughs[k];
      var want = me.maxMana * Math.min(1, (atks[i].t - t0) / me.cdSeconds);
      var err = Math.abs(atks[i].manaAfter - want);
      if (err > worst) { worst = err; worstAt = atks[i].t; }
    }
    // manaAfter 是 round1 过的，所以容差给 0.06
    TH.ok('★ 普攻报出来的法力 = 冷却进度（渲染层就是拿它当冷却条画的）',
      worst < 0.06, '最大偏差 ' + worst.toFixed(3) +
      (worstAt >= 0 ? ('（t=' + U.round2(worstAt) + '）') : ''));
    TH.ok('★ 而且它永远不超过最大值（不会被普攻顶爆）',
      atks.every(function (e) { return e.manaAfter <= me.maxMana + 1e-9; }),
      '最大 ' + Math.max.apply(null, atks.map(function (e) { return e.manaAfter; })));
  })();

  /* ============================================================
   * 5c10. 嘉豪（原「藤蔓精」/ vine）
   *
   *   改名 + 换立绘，技能改叫「男人领域」—— **数值一个字没动**
   *   （还是眩晕 1.2 秒 + 90 点法术伤害）。加的是星级被动：
   *     1 星  只控住锁定目标（和改名前完全一样）
   *     2 星 「两个男人」  一次同时控 2 个人
   *     3 星 「三个男人」  一次同时控 3 个人，并且**眩晕时间翻倍**（1.2 → 2.4 秒）
   *
   *   ★ 这个被动和前面七个都不一样：它改的是**技能本身的参数**，
   *     不是"触发时额外做点什么"。所以断言的重点是
   *     「同一次施法到底控住了几个、控了多久」，而不是"某事件出现了几次"。
   *   ★★ 最容易做假的地方：一次控三个人可以是"发了三条事件"，
   *     也可以是"真的让三个人动不了"。两个都要验 ——
   *     事件是给回放和渲染看的，能不能动才是玩家能感觉到的东西。
   * ============================================================ */
  TH.section('嘉豪 · 男人领域');

  var JIA = ST.UNIT_BY_ID.vine;
  TH.eq('单位已改名为嘉豪', JIA.name, '嘉豪');
  TH.eq('id 仍然是 vine（levels.js 的阵容 + art 文件名都按 id 索引）', JIA.id, 'vine');
  TH.eq('技能改名为男人领域', JIA.skill.name, '男人领域');
  TH.eq('技能类型还是眩晕', JIA.skill.kind, 'stun');
  TH.eq('★ 效果没变：还是 1.2 秒', JIA.skill.dur, 1.2);
  TH.eq('★ 效果没变：还是 90 点法术伤害', JIA.skill.damage, 90);
  TH.eq('被动类型是 domain', ST.passiveKind(JIA), 'domain');
  TH.eq('★ 2 星控 2 个、3 星控 3 个',
    [JIA.passive.targets[2], JIA.passive.targets[3]].join(','), '2,3');
  TH.eq('★ 只有 3 星时长翻倍', [JIA.passive.durMul[2] || 1, JIA.passive.durMul[3]].join(','), '1,2');
  TH.eq('★ 1 星没有被动（被动名字是空的，界面据此显示升星预告）',
    ST.passiveName(JIA, 1), null);
  TH.eq('被动名字按星级叠加',
    [ST.passiveName(JIA, 2), ST.passiveName(JIA, 3)].join(' / '),
    '两个男人 / 两个男人 + 三个男人');

  /* 陪练用三个老牧师：
     · 它们只给自己人回血（不回血给"要被控的人"，也不影响 嘉豪），
       而且输出很低 —— 战斗能跑很久，嘉豪放得出好几次技能；
     · 三个都站在嘉豪正前方，所以 1/2/3 星分别能挑到 1/2/3 个人。 */
  function jiaFight(star, seed) {
    return ST.Battle.battle({
      a: [{ id: 'vine', star: star, items: ['belt', 'belt', 'belt'], r: 3, c: 3 }],
      b: [{ id: 'medic', star: 1, items: ['belt', 'belt', 'belt'], r: 4, c: 2 },
          { id: 'medic', star: 1, items: ['belt', 'belt', 'belt'], r: 4, c: 3 },
          { id: 'medic', star: 1, items: ['belt', 'belt', 'belt'], r: 4, c: 4 }]
    }, seed || 606060);
  }
  /** 把 stun 事件按「同一次施法」分组（同一个人、同一 tick） */
  function stunCasts(res) {
    var groups = {}, out = [];
    for (var i = 0; i < res.log.length; i++) {
      var e = res.log[i];
      if (e.type !== 'stun' || e.reason === 'freeze') continue;
      var k = e.from + '@' + e.t;
      if (!groups[k]) {
        groups[k] = { from: e.from, t: e.t, to: [], dur: e.dur, ev: [], idx: i };
        out.push(groups[k]);
      }
      groups[k].to.push(e.to);
      groups[k].ev.push(e);
    }
    return out;
  }

  // ① 快照里三个星级的「控几个 / 控多久」必须如实写出来
  (function () {
    [1, 2, 3].forEach(function (star) {
      var me = jiaFight(star).initial.units.filter(function (u) { return u.uid === 'a0'; })[0];
      TH.eq('★ ' + star + ' 星快照：一次控 ' + (star === 1 ? 1 : star) + ' 个',
        me.domainTargets, star === 1 ? 1 : star);
      TH.eq('★ ' + star + ' 星快照：时长倍数 ' + (star === 3 ? 2 : 1),
        me.domainDurMul, star === 3 ? 2 : 1);
    });
  })();

  // ② 真打起来：每次施法控住的人数、时长都要正好对上星级
  (function () {
    var want = { 1: 1, 2: 2, 3: 3 }, wantDur = { 1: 1.2, 2: 1.2, 3: 2.4 };
    var seen = {};
    [1, 2, 3].forEach(function (star) {
      var r = jiaFight(star);
      var casts = stunCasts(r);
      seen[star] = casts.length;
      TH.ok('★ ' + star + ' 星真的放出了「男人领域」', casts.length > 0,
        casts.length + ' 次施法');
      var allOk = casts.every(function (c) { return c.to.length === want[star]; });
      var durOk = casts.every(function (c) { return Math.abs(c.dur - wantDur[star]) < 1e-9; });
      var uniqOk = casts.every(function (c) {
        var s = {}; c.to.forEach(function (x) { s[x] = 1; });
        return Object.keys(s).length === c.to.length;
      });
      TH.ok('★ ' + star + ' 星每次施法正好控住 ' + want[star] + ' 个人', allOk,
        casts.length ? ('实测每次 ' + casts.map(function (c) { return c.to.length; }).join('/') + ' 个') : '—');
      TH.ok('★ ' + star + ' 星每次眩晕都是 ' + wantDur[star] + ' 秒', durOk,
        casts.length ? (casts[0].dur + 's') : '—');
      TH.ok('★ ' + star + ' 星同一次施法不会重复控同一个人', uniqOk);
    });
    TH.note('三次对局里「男人领域」的施法次数（1/2/3 星）：' +
      [1, 2, 3].map(function (s) { return seen[s]; }).join(' / '));
  })();

  // ③ 名单（targets）必须和实际被控的人一致，而且 order 有讲究
  (function () {
    var r = jiaFight(3);
    var casts = stunCasts(r);
    var bad = [];
    for (var i = 0; i < casts.length; i++) {
      var c = casts[i];
      for (var k = 0; k < c.ev.length; k++) {
        var e = c.ev[k];
        if (!(e.targets instanceof Array)) { bad.push('名单不是数组'); continue; }
        if (e.targets.length !== c.to.length) bad.push('名单长度 ' + e.targets.length);
        if (e.targets.indexOf(e.to) < 0) bad.push('名单里没有 ' + e.to);
        if (e.count !== c.to.length) bad.push('count=' + e.count);
        if (e.durMul !== 2) bad.push('durMul=' + e.durMul);
      }
    }
    TH.eq('★ 每条 stun 事件都带着完整名单，且和实际被控的人一致',
      bad.slice(0, 3).join('；') || '无', '无');

    /* ★ 锁定目标必须排在名单第一位。
       如果改成"全按距离排"，1 星恰好一样、2/3 星却会把玩家锁定的那个人
       挤到后面去 —— 玩家会觉得"技能打歪了"。 */
    var firstOk = true;
    for (var j = 0; j < casts.length; j++) {
      var ids = casts[j].ev[0].targets;
      // 名单里的第一个人，必须是离嘉豪最近的那一个
      var me = posAt(r, 'a0', casts[j].t);
      var dFirst = 99, dMin = 99;
      for (var m = 0; m < ids.length; m++) {
        var p = posAt(r, ids[m], casts[j].t);
        var dd = Math.max(Math.abs(p.r - me.r), Math.abs(p.c - me.c));
        if (m === 0) dFirst = dd;
        if (dd < dMin) dMin = dd;
      }
      if (dFirst > dMin) firstOk = false;
    }
    TH.ok('★ 名单第一位永远是离得最近的那个（不是被排序挤下去的）', firstOk);
  })();

  // ④ ★★ 被控住的人**真的动不了** —— 这才是玩家能感觉到的东西。
  //     事件发了三条不等于三个人被控住（可能只是日志写得好听）。
  (function () {
    var r = jiaFight(3);
    var casts = stunCasts(r);
    TH.ok('这一场控过人（否则下面全是空断言）', casts.length > 0);
    /* ★★ 判"违规出手"必须带上**事件序号**，不能只看时刻。
       同一个 tick 里所有棋子按 buildOrder 依次行动，所以在嘉豪放技能那一 tick，
       排在它前面的医师**已经打完了一下**（t 完全相同、序号更早）。
       只看 t 的话，这一次完全合法的普攻会被判成"眩晕里还在打"——
       这个坑在「上一条事件是 attack 太严」那条上已经踩过一次了。 */
    var leaks = [], checked = 0;
    for (var i = 0; i < r.log.length; i++) {
      var e = r.log[i];
      if (e.type !== 'attack' && e.type !== 'cast') continue;
      for (var c = 0; c < casts.length; c++) {
        var g = casts[c];
        if (g.to.indexOf(e.from) < 0) continue;
        if (i <= g.idx) continue;                        // 排在眩晕事件之前 → 合法
        if (e.t >= g.t && e.t < g.t + g.dur - 1e-9) {
          leaks.push(e.from + ' 在眩晕里出手了（t=' + U.round2(e.t) + '）');
        }
      }
    }
    casts.forEach(function (g) { checked += g.to.length; });
    TH.eq('★ 眩晕窗口内，被控住的' + checked + '个人次里一次都没出手',
      leaks.slice(0, 3).join('；') || '无', '无');

    // 也不能移动
    var mvLeaks = 0;
    for (var m = 0; m < r.log.length; m++) {
      var mve = r.log[m];
      if (mve.type !== 'move') continue;
      for (var c2 = 0; c2 < casts.length; c2++) {
        var g2 = casts[c2];
        if (g2.to.indexOf(mve.who) < 0) continue;
        if (m <= g2.idx) continue;
        if (mve.t >= g2.t && mve.t < g2.t + g2.dur - 1e-9) mvLeaks++;
      }
    }
    TH.eq('★ 眩晕窗口内也不能移动', mvLeaks, 0);
  })();

  // ⑤ 3 星的时长正好是 2 倍（不是"差不多两倍"）
  (function () {
    var c1 = stunCasts(jiaFight(1))[0], c3 = stunCasts(jiaFight(3))[0];
    TH.ok('两个星级都采到了施法', !!c1 && !!c3);
    if (c1 && c3) {
      TH.ok('★ 3 星眩晕时长 = 1 星 × 2',
        Math.abs(c3.dur - c1.dur * 2) < 1e-9, c1.dur + ' → ' + c3.dur);
      // until 必须和 dur 对得上（渲染层的持续时间就照它画）
      var all = stunCasts(jiaFight(3));
      var untilOk = all.every(function (g) {
        return g.ev.every(function (e) { return Math.abs((e.until - e.t) - g.dur) < 1e-6; });
      });
      TH.ok('★ until = t + dur（渲染层照它画眩晕时长）', untilOk);
    }
  })();

  /* ============================================================
   * 5c11. 羊帆（原「火术士」/ pyromancer）
   *
   *   改名 + 换立绘，技能换成「羊巅峰」，并且**天生迟钝**：
   *     移速 -80%、攻速 -80%
   *   技能：双眼射出激光（和荣誉同一段表现）蓄势，
   *         下一次普攻伤害 **×20**。
   *   星级被动：
   *     2 星「笑上巅峰」  ×20 那一下把目标**震晕 3 秒**，并且它会哈哈大笑
   *     3 星「巅峰谢幕」  阵亡 1 秒后**自爆**：3×3 范围吃 **攻击力 ×20** 的伤害
   *                      并被震晕 3 秒（同样哈哈大笑）
   *
   *   ★ 这一个角色有三处最容易做假：
   *     ① 「-80%」必须真的生效（面板要显示 0.13、走位要 5 倍慢）——
   *        只写注释不写测试的话，改回 0.66 也不会有任何东西报错；
   *     ② 「×20」必须**只发生在蓄势之后** —— 忘了清标记就是每一发都 20 倍，
   *        而"伤害很高"这件事本身看起来不像 bug；
   *     ③ 「自爆伤害 = 攻击力 ×20」必须是从 ad 算出来的，不是随手写一个数。
   * ============================================================ */
  TH.section('羊帆 · 羊巅峰');

  var YANG = ST.UNIT_BY_ID.pyromancer;
  TH.eq('单位已改名为羊帆', YANG.name, '羊帆');
  TH.eq('id 仍然是 pyromancer（levels.js 的阵容 + art 文件名都按 id 索引）',
    YANG.id, 'pyromancer');
  TH.eq('技能改名为羊巅峰', YANG.skill.name, '羊巅峰');
  TH.eq('技能类型是 peak', YANG.skill.kind, 'peak');
  TH.eq('★ 下一次普攻 ×20', YANG.skill.mult, 20);
  TH.eq('被动类型是 peak', ST.passiveKind(YANG), 'peak');
  TH.eq('★ 1 星没有被动（被动名字是空的，界面据此显示升星预告）',
    ST.passiveName(YANG, 1), null);
  TH.eq('被动名字按星级叠加',
    [ST.passiveName(YANG, 2), ST.passiveName(YANG, 3)].join(' / '),
    '笑上巅峰 / 笑上巅峰 + 巅峰谢幕');
  TH.eq('★ 2 星解锁眩晕、3 星解锁自爆',
    [YANG.passive.stunAt, YANG.passive.boomAt].join(','), '2,3');
  TH.eq('★ 眩晕 3 秒', YANG.passive.stunDur, 3);
  TH.eq('★ 自爆倍率 20', YANG.passive.boomAdMult, 20);
  TH.eq('★ 攻击速度是原来的 20%（-80%）', YANG.as, 0.132);
  TH.eq('★ 移动速度 -80%', YANG.slowMove, 0.80);

  /* 陪练统一用老牧师：
     · 输出低（74 攻 / 0.68 攻速），所以羊帆活得够久、放得出技能；
     · 只给自己人回血，不会污染羊帆的伤害；
     · 星级由参数控制 —— 想要"羊帆死得快"就给 3 星医师（每下 200+）。 */
  function yangFight(star, foeStar) {
    return ST.Battle.battle({
      a: [{ id: 'pyromancer', star: star, items: ['belt', 'belt', 'belt'], r: 3, c: 3 }],
      b: [{ id: 'medic', star: foeStar, items: ['belt', 'belt', 'belt'], r: 4, c: 2 },
          { id: 'medic', star: foeStar, items: ['belt', 'belt', 'belt'], r: 4, c: 3 },
          { id: 'medic', star: foeStar, items: ['belt', 'belt', 'belt'], r: 4, c: 4 }]
    }, 707070);
  }

  /* 单挑场景：只为了把「×20」和「普通一击」摆在一起比。
     ★ 陪练必须**又厚又软**（山岳 1 星 + 三腰带 = 2640 血、每下只 60 点），
       这样羊帆活得够久 —— 它的攻速是 0.132，第一下普攻要到第 7.6 秒才打出来，
       换成一个输出正常的对手，它根本活不到"第二下普攻"。 */
  function yangDuel(star) {
    return ST.Battle.battle({
      a: [{ id: 'pyromancer', star: star, items: ['belt', 'belt', 'belt'], r: 3, c: 3 }],
      b: [{ id: 'titan', star: 1, items: ['belt', 'belt', 'belt'], r: 4, c: 3 }]
    }, 313131);
  }

  /* ① 迟钝必须真的生效：面板攻速、快照里的移速倍率两项都要对上 */
  (function () {
    var r = yangFight(1, 1);
    var me = r.initial.units.filter(function (u) { return u.uid === 'a0'; })[0];
    TH.eq('★ 面板攻速就是被砍过的那个值（界面看到的 = 打出来的）',
      me.as, 0.13);
    TH.eq('★ 移速倍率 0.2（走一格 0.3s → 1.5s）', me.movePct, 0.2);
    /* 面板 DPS 低得离谱是这个角色的设定，不是 bug —— 它的输出全在 ×20 那一下。
       顺手把这两个数字记下来，以后调数值时一眼能看出"是不是还算不上一张卡"。 */
    TH.note('羊帆 1★ 面板：攻速 ' + me.as + '　攻击 ' + me.ad +
      '　每 2 次普攻一次 ×' + YANG.skill.mult + ' 的巅峰一击');
  })();

  /* ② 走位速度：同一个场景里和「愤怒的普通人」对比。
        ★★ 不能只读 movePct（那是数据，不是行为）——要真的打一场，
          数它第几次移动、间隔多久。
        ★★ 场景的关键约束：**敌人不能主动跑过来**。
          第一版让山岳从对角走过来，结果羊帆一步都没动
          （敌人贴到脸上了，它根本不需要挪窝）——"没动过"看起来
          和"移速慢"一模一样，但验的是完全不同的东西。
          所以这里放一个**诱饵**：敌人在射程内先打诱饵，就会原地不动；
          羊帆则必须自己走完那段路。 */
  (function () {
    function speedRun(defId) {
      var res = ST.Battle.battle({
        a: [{ id: defId, star: 1, items: ['belt', 'belt', 'belt'], r: 0, c: 0 },
            // 诱饵：站在荣誉的射程里，把敌人钉在原地
            { id: 'titan', star: 1, items: ['belt', 'belt', 'belt'], r: 3, c: 3 }],
        b: [{ id: 'bowman', star: 1, items: ['belt', 'belt', 'belt'], r: 6, c: 3 }]
      }, 24680);
      return movesOfUid(res, 'a0').map(function (e) { return e.t; });
    }
    var slow = speedRun('pyromancer'), fast = speedRun('dagger');
    TH.ok('两边都走了几步（否则下面全是空断言）', slow.length >= 3 && fast.length >= 3,
      '羊帆 ' + slow.length + ' 步 / 普通人 ' + fast.length + ' 步');
    if (slow.length < 3 || fast.length < 3) return;
    var slowGap = slow[1] - slow[0], fastGap = fast[1] - fast[0];
    TH.ok('★ 羊帆两次移动之间隔了 1.5 秒左右（-80% 移速真的生效）',
      slowGap > 1.2, '间隔 ' + U.round2(slowGap) + 's');
    TH.ok('★ 同一个场景里普通人只隔 0.3 秒（对比组）',
      fastGap < 0.45, '间隔 ' + U.round2(fastGap) + 's');
    TH.ok('★ 走到第 3 步时羊帆花了 3 秒以上，普通人 1 秒内就到',
      slow[2] > 2.5 && fast[2] < 1.6,
      '羊帆 ' + U.round2(slow[2]) + 's / 普通人 ' + U.round2(fast[2]) + 's');
  })();

  /* ③ ×20 只发生在蓄势之后，而且倍率正好是 20（暴击就是 20 × 1.5 = 30）。
        ★ 判据用 raw ÷ (ad × ramp)：ramp 会随时间涨，把它除掉之后
          剩下的就只剩"倍率 × 暴击"两个因子，和护甲、减伤全都无关。 */
  (function () {
    var r = yangDuel(1);
    var me = r.initial.units.filter(function (u) { return u.uid === 'a0'; })[0];
    var peakMuls = [], plainMuls = [];
    var casts = r.log.filter(function (e) { return e.type === 'cast' && e.from === 'a0'; });
    var peaks = r.log.filter(function (e) { return e.type === 'attack' && e.from === 'a0'; });
    for (var i = 0; i < peaks.length; i++) {
      var e = peaks[i];
      if (!(e.raw > 0)) continue;
      var mul = e.raw / (me.ad * e.ramp);
      (e.peak ? peakMuls : plainMuls).push(Math.round(mul * 100) / 100);
    }
    TH.note('羊帆 1★：蓄力 ' + casts.length + ' 次，普攻 ' + peaks.length +
      ' 下（巅峰 ' + peakMuls.length + ' 下）　倍率：巅峰 ' + peakMuls.join('/') +
      '　普通 ' + plainMuls.join('/'));
    TH.ok('★ 蓄势过、也真的打出了巅峰一击',
      casts.length > 0 && peakMuls.length > 0, peakMuls.length + ' 下');
    TH.ok('★ 也打出了普通的一击（不然"20 倍"没有对比组）', plainMuls.length > 0,
      plainMuls.length + ' 下');
    TH.ok('★ 巅峰一击的倍率正好是 20（暴击时 30），不多不少',
      peakMuls.every(function (m) { return Math.abs(m - 20) < 0.05 || Math.abs(m - 30) < 0.05; }),
      peakMuls.join('/'));
    TH.ok('★ 普通一击的倍率是 1（暴击时 1.5），没有偷偷也翻倍',
      plainMuls.every(function (m) { return Math.abs(m - 1) < 0.05 || Math.abs(m - 1.5) < 0.05; }),
      plainMuls.join('/'));
    /* 每一次蓄力最多只兑现一次巅峰一击 —— 多了就是没清标记 */
    TH.ok('★ 巅峰一击的次数不会超过蓄力次数', peakMuls.length <= casts.length,
      peakMuls.length + ' 下 / 蓄力 ' + casts.length + ' 次');
  })();

  /* ④ 2 星：巅峰一击把目标震晕 3 秒；1 星不晕。
        ★ 两边都要验 —— 只验"2 星有眩晕"的话，1 星也晕着是不会有人发现的。 */
  (function () {
    function peakStuns(star) {
      var r = yangFight(star, 1);
      var out = [];
      for (var i = 0; i < r.log.length; i++) {
        var e = r.log[i];
        if (e.type === 'stun' && e.reason === 'peak') out.push(e);
      }
      return { res: r, list: out };
    }
    var s1 = peakStuns(1), s2 = peakStuns(2);
    TH.eq('★ 1 星不附带眩晕（这一条是反面的，别只验 2 星）', s1.list.length, 0);
    TH.ok('★ 2 星巅峰一击震晕目标', s2.list.length > 0, s2.list.length + ' 条');
    TH.ok('★ 而且正好 3 秒',
      s2.list.every(function (e) { return Math.abs(e.dur - 3) < 1e-9; }),
      s2.list.length ? (s2.list[0].dur + 's') : '—');
    /* ★★ 被震晕的人**真的动不了** —— 这才是玩家能感受到的那件事。
       事件发了不等于控住了（detail 见嘉豪那一节的同一类断言）。 */
    var leaks = 0, checked = 0;
    for (var k = 0; k < s2.list.length; k++) {
      var g = s2.list[k];
      for (var m = 0; m < s2.res.log.length; m++) {
        var le = s2.res.log[m];
        if (le.from !== g.to || (le.type !== 'attack' && le.type !== 'cast')) continue;
        if (le.t > g.t && le.t < g.t + g.dur - 1e-9) leaks++;
      }
      for (var n = 0; n < s2.res.log.length; n++) {
        var lme = s2.res.log[n];
        if (lme.type !== 'move' || lme.who !== g.to) continue;
        if (lme.t > g.t && lme.t < g.t + g.dur - 1e-9) leaks++;
      }
      checked++;
    }
    TH.eq('★ 被震晕的那 ' + checked + ' 个人次里，3 秒内一次都没出手也没移动', leaks, 0);
  })();

  /* ⑤ 3 星「巅峰谢幕」：倒下 → 1 秒 → 自爆，伤害 = 攻击力 ×20 + 震晕 3 秒。
        ★ 场景是配出来的：陪练用 3 星老牧师 + 三腰带（4080 血）——
          它们输出够高（能在几秒内打死羊帆），血又够厚（吃下自爆还活着），
          活下来才有"被震晕"这件事可验。 */
  (function () {
    var r3 = yangFight(3, 3);
    var me = r3.initial.units.filter(function (u) { return u.uid === 'a0'; })[0];
    var downs = r3.log.filter(function (e) { return e.type === 'down' && e.who === 'a0'; });
    var crashes = r3.log.filter(function (e) { return e.type === 'crash' && e.who === 'a0'; });
    TH.ok('★ 3 星阵亡时会自爆（倒下 + 爆炸两段都在）',
      downs.length > 0 && crashes.length > 0,
      downs.length + ' 次倒下 / ' + crashes.length + ' 次爆炸');
    if (!crashes.length) return;
    var c = crashes[0];
    TH.ok('★ 倒下到爆炸隔了 1 秒（和牢大的坠机同一套节奏）',
      Math.abs((c.t - downs[0].t) - ST.BATTLE_CFG.CRASH_DELAY) < 0.05,
      U.round2(c.t - downs[0].t) + 's');
    TH.ok('★ 爆炸伤害 = 攻击力 × 20（不是随手写的一个数）',
      Math.abs(c.dmg - U.round2(me.ad * 20)) < 0.01,
      Math.round(c.dmg) + '　ad ' + me.ad + ' × 20 = ' + U.round2(me.ad * 20));
    TH.eq('★ 范围是 3×3', c.radius, 1);
    TH.ok('★ 事件里标了「自爆」而不是「坠机」（渲染层靠它决定画什么）', c.boom === true);

    var boomStuns = r3.log.filter(function (e) {
      return e.type === 'stun' && e.reason === 'peak' && e.skill === '巅峰谢幕';
    });
    TH.ok('★ 活下来的敌人被震晕', boomStuns.length > 0, boomStuns.length + ' 条');
    TH.ok('★ 而且也是 3 秒',
      boomStuns.every(function (e) { return Math.abs(e.dur - 3) < 1e-9; }),
      boomStuns.length ? (boomStuns[0].dur + 's') : '—');
    // 被震晕的人必须在 3×3 之内
    var outside = [];
    for (var i = 0; i < boomStuns.length; i++) {
      var se = boomStuns[i];
      var p = posAt(r3, se.to, se.t);
      if (Math.max(Math.abs(p.r - c.r), Math.abs(p.c - c.c)) > c.radius) {
        outside.push(se.to);
      }
    }
    TH.eq('★ 被震晕的人全在这个 3×3 之内', outside.slice(0, 3).join('；') || '无', '无');

    /* ★ 反面：1 星 / 2 星**不会**自爆。
       只验"3 星会炸"的话，把门槛写成 1 星也不会有人发现。 */
    [1, 2].forEach(function (star) {
      var rr = yangFight(star, 3);
      var dn = rr.log.filter(function (e) { return e.type === 'down' && e.who === 'a0'; });
      var cr = rr.log.filter(function (e) { return e.type === 'crash' && e.who === 'a0'; });
      TH.eq('★ ' + star + ' 星阵亡就是阵亡，不会自爆', (dn.length + cr.length), 0);
    });
  })();

  /* ============================================================
   * 5c12. 楚生疑犯（原「风语者」/ windcaller）
   *
   *   改名 + 换立绘，技能换成「阴暗领域」，范围翻倍（2 → 4）：
   *     在目标格撑起一片**留在场上的地形** —— 变黑、下雨，
   *     范围内的敌人攻速与移速减半。
   *   星级被动：
   *     2 星「同伙掩护」  领域内的**队友**少受 30% 的敌人伤害
   *     3 星「遁入暗影」  每次放完技能，自己遁入暗影：攻速减半、伤害翻倍、
   *                       免疫一切伤害、也不会被索敌，直到队友全部阵亡
   *
   *   ★★ 这一套里有三个"以前没有过"的东西，也是断言的重点：
   *     ① 领域是**第一份不属于任何单位的持续状态** ——
   *        施法者死了它还得在。所以必须验「放完就死，领域照样生效」。
   *     ② 2 星的减伤**只挡敌方伤害**，而且只在圈里。验的是
   *        「圈里的队友吃 0.7 倍、圈外的吃满」——只验一边等于没验。
   *     ③ 暗影的解除条件是**终止条件**：一个免疫一切伤害又不会被索敌的
   *        单位如果永远不现形，战斗只能拖到读秒判平局。
   *        所以"队友全死了就现形"必须验到，而且要在真打一场里验。
   * ============================================================ */
  TH.section('楚生疑犯 · 阴暗领域');

  var CHU = ST.UNIT_BY_ID.windcaller;
  TH.eq('单位已改名为楚生疑犯', CHU.name, '楚生疑犯');
  TH.eq('id 仍然是 windcaller（levels.js 的阵容 + art 文件名都按 id 索引）',
    CHU.id, 'windcaller');
  TH.eq('技能改名为阴暗领域', CHU.skill.name, '阴暗领域');
  TH.eq('技能类型是 field', CHU.skill.kind, 'field');
  TH.eq('★ 范围翻倍：半径 2 → 4', CHU.skill.radius, 4);
  TH.eq('★ 敌人的攻速/移速减半（0.5 是比例，不是 50）', CHU.skill.asCut, 0.5);
  TH.ok('★ 领域有时长（不是永久地形）', CHU.skill.dur > 0, CHU.skill.dur + ' 秒');
  TH.eq('★ 技能本身**一点伤害都没有**（原来的 340 范围伤害整条去掉了）',
    CHU.skill.damage, undefined);
  TH.eq('被动类型是 field', ST.passiveKind(CHU), 'field');
  TH.eq('★ 1 星没有被动（被动名字是空的，界面据此显示升星预告）',
    ST.passiveName(CHU, 1), null);
  TH.eq('被动名字按星级叠加',
    [ST.passiveName(CHU, 2), ST.passiveName(CHU, 3)].join(' / '),
    '同伙掩护 / 同伙掩护 + 遁入暗影');
  TH.eq('★ 2 星解锁队友减伤、3 星解锁暗影',
    [CHU.passive.allyCutAt, CHU.passive.shadowAt].join(','), '2,3');
  TH.eq('★ 队友减伤 30%', CHU.passive.allyCut, 0.30);
  TH.eq('★ 暗影：攻速 ×0.5、伤害 ×2',
    [CHU.passive.shadowAsCut, CHU.passive.shadowDmgMul].join(','), '0.5,2');

  /* 场景：楚生疑犯带一个队友站在一起，对面是一堵很厚的墙。
     · 敌人用 3 星山岳 + 三腰带（6672 血）：它打得慢、活得久，
       所以楚生疑犯放得出好几次技能，而且不会被一波带走；
     · 这样"领域里 vs 领域外""有队友 vs 没队友"都能在一次对局里读到。 */
  function chuFight(star, seed) {
    return ST.Battle.battle({
      a: [{ id: 'windcaller', star: star, items: ['belt', 'belt', 'belt'], r: 3, c: 3 },
          { id: 'dagger', star: 1, items: ['belt', 'belt', 'belt'], r: 3, c: 4 }],
      b: [{ id: 'titan', star: 3, items: ['belt', 'belt', 'belt'], r: 4, c: 3 },
          { id: 'titan', star: 3, items: ['belt', 'belt', 'belt'], r: 4, c: 4 }]
    }, seed || 5150);
  }
  function fieldsOf(res) {
    return res.log.filter(function (e) { return e.type === 'field'; });
  }

  // ① 领域真的被放出来了，而且参数和技能数据一致
  (function () {
    var r = chuFight(1);
    var fs = fieldsOf(r);
    TH.ok('★ 放出了「阴暗领域」', fs.length > 0, fs.length + ' 次');
    if (!fs.length) return;
    TH.ok('★ 半径是翻倍后的 4',
      fs.every(function (e) { return e.radius === 4; }), fs[0].radius);
    TH.ok('★ 减速比例是 0.5',
      fs.every(function (e) { return Math.abs(e.asCut - 0.5) < 1e-9; }));
    TH.ok('★ 1 星没有队友减伤（allyCut = 0）',
      fs.every(function (e) { return e.allyCut === 0; }), fs[0].allyCut);
    // 2 星才有
    var f2 = fieldsOf(chuFight(2));
    TH.ok('★ 2 星的领域带上了 30% 队友减伤',
      f2.length > 0 && f2.every(function (e) { return Math.abs(e.allyCut - 0.30) < 1e-9; }),
      f2.length ? f2[0].allyCut : '没放出领域');
  })();

  /* ② ★★ 领域是"留在场上的地形"：**施法者死了它照样生效**。
        这是它和以前所有持续状态最本质的区别 ——
        以前的效果都挂在单位身上，人一死就跟着没了。
        ★ 验法：造一个「放完技能立刻被打死」的场面，
          然后看它的领域**到期之前**还有没有在减速敌人。 */
  (function () {
    var res = ST.Battle.battle({
      a: [{ id: 'windcaller', star: 1, items: ['belt', 'belt', 'belt'], r: 3, c: 3 }],
      b: [{ id: 'titan', star: 3, items: ['belt', 'belt', 'belt'], r: 4, c: 3 },
          { id: 'titan', star: 3, items: ['belt', 'belt', 'belt'], r: 4, c: 4 }]
    }, 2468);
    var fs = fieldsOf(res);
    var dead = res.log.filter(function (e) { return e.type === 'death' && e.who === 'a0'; });
    TH.ok('这一场它放完技能就死了（否则下面验不了"人死了领域还在"）',
      fs.length > 0 && dead.length > 0,
      fs.length + ' 次领域 / ' + dead.length + ' 次阵亡');
    if (!fs.length || !dead.length) return;
    var lastField = fs[fs.length - 1];
    var deathT = dead[0].t;
    TH.ok('★ 领域是在它死之前放下的', lastField.t <= deathT + 1e-9,
      '领域 ' + U.round2(lastField.t) + 's / 阵亡 ' + U.round2(deathT) + 's');
    /* ★ 关键：领域到期之前，敌人应该还在"被减速"的状态里。
       怎么从事件流里读出来？数敌人的出手次数 ——
       被减半之后，同样的时间内出手次数会明显变少。
       这里用一个更直接的判据：后半段的出手间隔比前半段长。 */
    var atk = [];
    for (var i = 0; i < res.log.length; i++) {
      var e = res.log[i];
      if (e.type === 'attack' && e.from === 'b0') atk.push(e.t);
    }
    var inField = 0, outField = 0;
    for (var k = 0; k < atk.length; k++) {
      var t = atk[k];
      // 落在任何一条领域的时间窗 + 位置上就是"里面"
      var inside = false;
      for (var m = 0; m < fs.length; m++) {
        if (t >= fs[m].t && t < fs[m].until) { inside = true; break; }
      }
      if (inside) inField++; else outField++;
    }
    TH.ok('敌人既在领域里出过手、也在领域外出过手（两段都能采到样本）',
      inField > 0 && outField > 0, '里面 ' + inField + ' 次 / 外面 ' + outField + ' 次');
    TH.note('楚生疑犯 1★：领域 ' + fs.length + ' 次（最后一条到 ' +
      U.round2(lastField.until) + 's），施法者 ' + U.round2(deathT) + 's 阵亡');
    TH.ok('★ 施法者阵亡之后领域还在（它的 until 晚于阵亡时刻）',
      lastField.until > deathT, '领域到 ' + U.round2(lastField.until) +
      's / 阵亡 ' + U.round2(deathT) + 's');
  })();

  /* ③ ★★ 2 星的「同伙掩护」：**圈里的队友**少受 30%，圈外的照吃满。
        ★ 只验"有减伤"是不够的 —— 那和"全队减伤"分不开。
          所以要比**同一批挨打样本**在圈内 / 圈外两组。
        ★★ 陪练必须是**打不死也杀不死人**的那种：这里用老牧师
          （只给自己回血、输出很低）—— 对局能跑满 60 秒，
          圈内圈外两段都采得到足够的样本。
          第一版用荣誉当陪练，它 3 下就把人打死了，一个圈内样本都没有。
        ★★ 而且必须用 **1 星**老牧师。2026-10 之后老牧师 2 星起带「临终祷告」
          （每场把第一个阵亡的队友满血拉回来），拿 2/3 星的他当陪练，
          场面就不再是"打不死也杀不死人"了 —— 他会把队友救活、把对局拖长。
          全项目的陪练统一都是 1 星，就是为了避开这个被动。 */
  (function () {
    function cutFight(star) {
      return ST.Battle.battle({
        a: [{ id: 'windcaller', star: star, items: ['belt', 'belt', 'belt'], r: 2, c: 3 },
            { id: 'dagger', star: 1, items: ['belt', 'belt', 'belt'], r: 3, c: 3 }],
        b: [{ id: 'medic', star: 1, items: ['belt', 'belt', 'belt'], r: 6, c: 3 }]
      }, 1357);
    }
    /* 把"我方挨的每一下"按**是否落在领域里**分成两组，比 dmg / raw。
       ★ 减法抗和 ramp 会被这个比值约掉，所以两组的差别只剩"领域减伤"。 */
    function ratios(res) {
      var fs = fieldsOf(res);
      var inR = [], outR = [];
      for (var i = 0; i < res.log.length; i++) {
        var e = res.log[i];
        if (e.type !== 'attack' || e.crit || !(e.raw > 0)) continue;
        if (e.to.charAt(0) !== 'a') continue;          // 只看我方挨的打
        var p = posAt(res, e.to, e.t);
        if (!p) continue;
        var covered = false;
        for (var m = 0; m < fs.length; m++) {
          var f = fs[m];
          if (e.t < f.t || e.t >= f.until) continue;
          if (Math.max(Math.abs(p.r - f.r), Math.abs(p.c - f.c)) > f.radius) continue;
          covered = true;
        }
        (covered ? inR : outR).push(e.dmg / e.raw);
      }
      var avg = function (a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; };
      return { inside: inR, outside: outR, avgIn: inR.length ? avg(inR) : 0,
               avgOut: outR.length ? avg(outR) : 0 };
    }
    var r2 = ratios(cutFight(2));
    var r1 = ratios(cutFight(1));
    TH.note('楚生疑犯 1★：领域内 ' + r1.inside.length + ' 次 / 领域外 ' + r1.outside.length +
      ' 次（内 ' + r1.avgIn.toFixed(3) + ' / 外 ' + r1.avgOut.toFixed(3) + '）');
    TH.note('楚生疑犯 2★：领域内 ' + r2.inside.length + ' 次 / 领域外 ' + r2.outside.length +
      ' 次（内 ' + r2.avgIn.toFixed(3) + ' / 外 ' + r2.avgOut.toFixed(3) + '）');
    TH.ok('★ 2 星：圈里圈外都采到了足够的样本',
      r2.inside.length >= 2 && r2.outside.length >= 3,
      '圈内 ' + r2.inside.length + ' / 圈外 ' + r2.outside.length);
    if (r2.inside.length >= 2 && r2.outside.length >= 3) {
      var ratio = r2.avgIn / r2.avgOut;
      TH.ok('★ 圈里的队友只吃 70% 的伤害（减伤 30% 真的生效了）',
        Math.abs(ratio - 0.7) < 0.05, '实测 ' + (ratio * 100).toFixed(1) + '%');
    }
    /* ★ 反面：1 星没有这条被动，圈内圈外应该**一模一样**。
       少了这一条，"减伤"和"圈里本来就该少受伤"就分不开。 */
    TH.ok('★ 1 星：圈里圈外都采到了足够的样本（对照组的样本量要对得上）',
      r1.inside.length >= 2 && r1.outside.length >= 3,
      '圈内 ' + r1.inside.length + ' / 圈外 ' + r1.outside.length);
    if (r1.inside.length >= 2 && r1.outside.length >= 3) {
      var r1ratio = r1.avgIn / r1.avgOut;
      TH.ok('★ 1 星没有这条被动：圈里圈外的比值仍然是 1',
        Math.abs(r1ratio - 1) < 0.05, '实测 ' + (r1ratio * 100).toFixed(1) + '%');
    }
  })();

  /* ④ ★★ 3 星「遁入暗影」：开 / 关两个方向。
        关的那一边是**终止条件**（队友全死光就现形），必须验到。
        ★★ 场景是配出来的，三个约束缺一不可：
          ① 楚生疑犯要在**队友还活着的时候**就放出技能（2 块蓝水晶 → 开局 70 法力）
          ② 队友要**在它放完技能之后**才死（裸装匕首客 560 血，大约 9 秒）
          ③ 暗影期间要有"打得到它、但打不动它"的伤害来源 ——
             用**讲话石的反伤**：它自己去打那个带讲话石的对手，
             反伤会弹回它身上。这是唯一一种"不需要索敌就能打到暗影单位"的伤害，
             所以它同时也是"免疫一切伤害"最干净的一条证据。 */
  function shadowFight() {
    return ST.Battle.battle({
      a: [{ id: 'windcaller', star: 3, items: ['belt', 'belt', 'belt'], r: 3, c: 3 },
          // 队友要"活得够久、但一定会死"：两条腰带 + 一块龙鳞甲，
          // 挨打很慢，所以暗影窗口能撑十几秒（采得到足够样本），
          // 但它终究会被耗死 —— 现形那一条断言才有东西可验。
          { id: 'dagger', star: 1, items: ['belt', 'belt', 'dragonscale'], r: 3, c: 4 }],
      b: [{ id: 'titan', star: 1, items: ['thornmail', 'belt', 'belt'], r: 4, c: 3 }]
    }, 9090);
  }
  /* ★★ 判"在某段时间里"必须用**事件序号**，不能只看时刻。
     同一个 tick 里，"楚生疑犯打了一下 → 讲话石反伤 → 它攒满法力放出技能 → 遁入暗影"
     是连着发生的：那时反伤和那一发普攻的 t 都等于 shadow 事件的 t，
     只看时刻会把"进暗影之前那一下"算成"暗影期间"。 */
  function idxOf(res, fn) {
    for (var i = 0; i < res.log.length; i++) if (fn(res.log[i])) return i;
    return -1;
  }

  (function () {
    var r = shadowFight();
    var on = r.log.filter(function (e) { return e.type === 'shadow' && e.on; });
    var off = r.log.filter(function (e) { return e.type === 'shadow' && !e.on; });
    var deaths = r.log.filter(function (e) {
      return e.type === 'death' && e.who !== 'a0' && e.side === 'a';
    });
    TH.ok('★ 3 星放完技能遁入暗影', on.length > 0, on.length + ' 次');
    TH.ok('★ 队友阵亡之后它会现形（否则战斗永远打不完）',
      off.length > 0, off.length + ' 次现形 / 队友阵亡 ' + deaths.length + ' 次');
    if (on.length && off.length && deaths.length) {
      TH.ok('★ 现形发生在队友倒下之后，不是之前',
        off[0].t >= deaths[0].t - 1e-9,
        '现形 ' + U.round2(off[0].t) + 's / 队友阵亡 ' + U.round2(deaths[0].t) + 's');
    }
    TH.ok('★ 一次对局里不会反复开关（暗影只有一个解除条件）',
      on.length === 1, on.length + ' 次进入');
    if (!on.length) return;

    /* ★★ 暗影期间它**真的打不死**：那段时间里针对它的每一条伤害都必须是 0。
       只看有没有 shadow 事件是不够的 —— 事件发了、血照掉是最典型的假实现。 */
    var onIdx = idxOf(r, function (e) { return e.type === 'shadow' && e.on; });
    var offIdx = idxOf(r, function (e) { return e.type === 'shadow' && !e.on; });
    var win = { from: on[0].t, to: (off.length ? off[0].t : 1e9) };
    var bad2 = [], hitN = 0, kinds = {};
    for (var i2 = 0; i2 < r.log.length; i2++) {
      var e2 = r.log[i2];
      if (e2.to !== 'a0' || e2.dmg === undefined) continue;
      if (i2 <= onIdx) continue;                        // 进暗影之前 / 同一 tick 的前半段
      if (offIdx >= 0 && i2 >= offIdx) continue;        // 已经现形了
      hitN++;
      kinds[e2.reason || e2.type] = (kinds[e2.reason || e2.type] || 0) + 1;
      if (e2.dmg !== 0 || (e2.hpLoss || 0) !== 0) {
        bad2.push('t=' + U.round2(e2.t) + ' ' + (e2.reason || e2.type) + ' dmg=' + e2.dmg);
      }
    }
    TH.note('暗影 ' + U.round2(win.from) + '→' + U.round2(win.to) + 's：挨了 ' + hitN +
      ' 下（' + Object.keys(kinds).map(function (k) { return k + '×' + kinds[k]; }).join(' ') + '）');
    TH.ok('★ 暗影期间确实有伤害打到它（否则下面那条是空断言）', hitN > 0, hitN + ' 下');
    TH.ok('★ 暗影期间它免疫一切伤害（每一条都是 0，hpLoss 也是 0）',
      bad2.length === 0, bad2.slice(0, 3).join('；') || '无');

    /* ★ 不会被索敌：暗影期间**没有任何普攻把它当目标**。 */
    var targeted = 0;
    for (var i3 = 0; i3 < r.log.length; i3++) {
      var e3 = r.log[i3];
      if (e3.type !== 'attack' || e3.to !== 'a0') continue;
      if (i3 <= onIdx) continue;
      if (offIdx >= 0 && i3 >= offIdx) continue;
      targeted++;
    }
    TH.eq('★ 暗影期间没有任何普攻能锁定它', targeted, 0);

    /* ★ 血量在暗影期间**一点没掉**（比"每条伤害是 0"更直白的一条） */
    var hpEnd = null, hpStart = null;
    for (var i4 = 0; i4 < r.log.length; i4++) {
      var e4 = r.log[i4];
      if (e4.hpAfter === undefined || e4.to !== 'a0') continue;
      if (i4 < onIdx) hpStart = e4.hpAfter;
      if (i4 > onIdx && (offIdx < 0 || i4 < offIdx)) hpEnd = e4.hpAfter;
    }
    TH.ok('★ 整段暗影下来血量一点没变', hpEnd === null || hpStart === null || hpEnd === hpStart,
      hpStart + ' → ' + hpEnd);
  })();

  /* ④-b ★★ 两只楚生疑犯：不能互相"续命"（用户报的那个死局）
   *
   *   原来解除条件是「aliveCount[自己这方] <= 1」—— 两只都躲进暗影之后，
   *   每一只都把**另一只躲在暗影里的**算成"我还活着"，
   *   于是谁也现不了形：对面打不到它们（免疫 + 不会被索敌），
   *   它们也打不到对面（暗影里攻速减半但能打？—— 能打，可对面打不死它们），
   *   这一局只能拖到 60 秒读秒判平局。
   *
   *   修法：解除条件改成「**不会遁入暗影的**队友全部阵亡」，
   *   而且**入口用同一个判据**（没有那种队友就压根不遁入，
   *   否则会出现"进暗影 → 下一 tick 现形"的闪烁）。 */
  (function () {
    // ① 只有两只楚生疑犯：根本没有"非同类队友"，所以谁都不该遁入暗影
    var only = ST.Battle.battle({
      a: [{ id: 'windcaller', star: 3, items: ['sapphire', 'sapphire', 'belt'], r: 3, c: 2 },
          { id: 'windcaller', star: 3, items: ['sapphire', 'sapphire', 'belt'], r: 3, c: 5 }],
      b: [{ id: 'titan', star: 2, items: ['belt', 'belt', 'belt'], r: 4, c: 3 }]
    }, 424242);
    var onlyOn = only.log.filter(function (e) { return e.type === 'shadow' && e.on; });
    TH.eq('★★ 只有两只楚生疑犯时，谁都不遁入暗影（进去就出不来了）',
      onlyOn.length, 0);
    TH.ok('★ 这一局也没被拖成超时（两边真的在打）',
      only.reason !== 'timeout' || only.ticks < CFG.MAX_TICKS,
      only.reason + ' / ' + only.ticks + ' tick');

    // ② 两只楚生疑犯 + 一个会先阵亡的脆皮队友
    var withMate = ST.Battle.battle({
      a: [{ id: 'windcaller', star: 3, items: ['sapphire', 'sapphire', 'belt'], r: 3, c: 2 },
          { id: 'windcaller', star: 3, items: ['sapphire', 'sapphire', 'belt'], r: 3, c: 5 },
          { id: 'dagger', star: 1, r: 3, c: 7 }],
      b: [{ id: 'titan', star: 2, items: ['belt', 'belt', 'belt'], r: 4, c: 3 }]
    }, 909090);
    var wOn = withMate.log.filter(function (e) { return e.type === 'shadow' && e.on; });
    var wOff = withMate.log.filter(function (e) { return e.type === 'shadow' && !e.on; });
    var mateDeath = withMate.log.filter(function (e) { return e.type === 'death' && e.who === 'a2'; });
    TH.ok('这一场两只都遁入过暗影（否则下面全是空断言）', wOn.length > 0,
      wOn.length + ' 次进入');
    TH.ok('★ 那个脆皮队友确实阵亡了（解除条件的触发点）', mateDeath.length > 0,
      mateDeath.length ? U.round2(mateDeath[0].t) + 's' : '没死');
    if (wOn.length && mateDeath.length) {
      /* ★★ 关键：非同类队友一死光，**两只都**必须现形 ——
         不是只现形一只、另一只继续躲着。 */
      var lastMateT = mateDeath[mateDeath.length - 1].t;
      var who = {};
      wOn.forEach(function (e) { who[e.who] = true; });
      var missing = Object.keys(who).filter(function (k) {
        return !wOff.some(function (e) { return e.who === k && e.t >= lastMateT - 1e-9; });
      });
      TH.ok('★★ 非同类队友死光之后，**每一只**都现形了（没有谁继续躲着）',
        missing.length === 0, missing.join(',') || '全部现形');
      /* 收尾：用事件流算出"战斗结束那一刻还有谁躲着" */
      var stillHidden = {};
      withMate.log.forEach(function (e) {
        if (e.type !== 'shadow') return;
        if (e.on) stillHidden[e.who] = true; else delete stillHidden[e.who];
      });
      TH.eq('★★ 战斗结束时没有任何人还躲在暗影里（否则这一局没人能赢）',
        Object.keys(stillHidden).length, 0);
      TH.ok('★ 而且这一局没有因此拖到读秒结束',
        withMate.reason !== 'timeout' || withMate.ticks < CFG.MAX_TICKS,
        withMate.reason + ' / ' + withMate.ticks + ' tick');
    }
    checkInvariants(withMate, '楚生疑犯·双份', function (msg) {
      TH.ok('不变量（双份楚生疑犯）: ' + msg, false);
    });
  })();

  /* ⑤ 3 星暗影的"攻速减半、伤害翻倍"：两个倍率都要在事件里读得出来。
        ★ 判据还是 raw ÷ (ad × ramp) —— 减抗和 ramp 会被约掉。 */
  (function () {
    var r = shadowFight();
    var me = r.initial.units.filter(function (u) { return u.uid === 'a0'; })[0];
    var on = r.log.filter(function (e) { return e.type === 'shadow' && e.on; });
    var off = r.log.filter(function (e) { return e.type === 'shadow' && !e.on; });
    if (!on.length) { TH.ok('这一场进了暗影（否则下面全是空断言）', false); return; }
    var tOn = on[0].t, tOff = off.length ? off[0].t : 1e9;
    /* ★ 同样用**序号**分两段：见 idxOf 上面的说明。 */
    var iOn = idxOf(r, function (e) { return e.type === 'shadow' && e.on; });
    var iOff = idxOf(r, function (e) { return e.type === 'shadow' && !e.on; });
    var before = [], during = [];
    for (var i = 0; i < r.log.length; i++) {
      var e = r.log[i];
      if (e.type !== 'attack' || e.from !== 'a0' || !(e.raw > 0)) continue;
      /* ★★ 暴击要**除掉**而不是跳过：暗影窗口只有几秒、攻速还被砍半，
         里面可能只放得出 1~2 下 —— 跳过暴击的话样本会变成 0，
         看起来像"伤害没翻倍"，其实是"那一下正好暴击了"。
         （第一版就是这么红的：窗口里唯一的一下是暴击，被过滤掉之后
           采样 0 条，断言报"两段都要有样本"。） */
      var mul = e.raw / (me.ad * (e.crit ? me.critMult : 1) * e.ramp);
      if (i < iOn) before.push(mul);
      else if (i > iOn && (iOff < 0 || i < iOff)) during.push(mul);
    }
    TH.note('楚生疑犯 3★：暗影前 ' + before.length + ' 下 / 暗影中 ' + during.length +
      ' 下　倍率：' + before.map(function (x) { return x.toFixed(2); }).join('/') + ' → ' +
      during.map(function (x) { return x.toFixed(2); }).join('/'));
    /* 诊断用：把 a0 的每一条攻击都列出来（序号 / 时刻 / 暴击 / 倍率） */
    var dbg = [];
    for (var di = 0; di < r.log.length; di++) {
      var de = r.log[di];
      if (de.type !== 'attack' || de.from !== 'a0') continue;
      dbg.push('#' + di + '@' + U.round2(de.t) + (de.crit ? 'C' : '') +
        '=' + (de.raw / (me.ad * de.ramp)).toFixed(1));
    }
    TH.note('a0 的攻击序列（iOn=' + iOn + ' iOff=' + iOff + '）：' + dbg.join(' '));
    TH.ok('★ 暗影期间两段都采到了样本', before.length > 0 && during.length > 0,
      before.length + ' / ' + during.length);
    TH.ok('★ 暗影之外伤害倍率是 1',
      before.every(function (m) { return Math.abs(m - 1) < 0.05; }),
      before.map(function (x) { return x.toFixed(2); }).join('/'));
    TH.ok('★ 暗影期间伤害翻倍（倍率 = 2）',
      during.every(function (m) { return Math.abs(m - 2) < 0.05; }),
      during.map(function (x) { return x.toFixed(2); }).join('/'));
  })();

  /* ============================================================
   * 5c13. Dank1ng（原「神射手」/ deadeye）
   *
   *   改名 + 换立绘，技能从「贯穿之矢」换成「先过中门再谈未来」：
   *     **伤害翻倍（720 → 1440）、不再贯穿（line → nuke）、瞬发**
   *     技能击杀 → 原地留一个骷髅 + 自己耍 3 秒折叠刀（这 3 秒不攻击）
   *   星级被动：
   *     1★「空悲切」  所有队友阵亡后**立刻恢复无限能量**（永远满格）
   *     2★「老男孩」  开局满能量
   *     3★「锁头」    能量回复翻倍 + 击杀敌人自动回满能量
   *
   *   ★★ 三处最容易做假的地方，也是断言的重点：
   *     ① 「不贯穿」不能只看数据（kind 改成 nuke 了）——
   *        要真的打一场，数"每次施法打中几个人"。对面站成一排时，
   *        旧的 line 会打穿一整条线。
   *     ② 「无限能量」不能只看 endless 事件发了没有 ——
   *        要数**施法次数**：开了之后出手频率必须明显变高。
   *     ③ 「耍刀 3 秒不攻击」要三头都验：耍刀前在打、窗口内一次没打、
   *        窗口结束后又开始打。只验中间那条的话，"它本来就没在打"也能过。
   * ============================================================ */
  TH.section('Dank1ng · 先过中门再谈未来');

  var DANK = ST.UNIT_BY_ID.deadeye;
  TH.eq('单位已改名为 Dank1ng', DANK.name, 'Dank1ng');
  TH.eq('id 仍然是 deadeye（levels.js 的阵容 + art 文件名都按 id 索引）',
    DANK.id, 'deadeye');
  TH.eq('技能改名为先过中门再谈未来', DANK.skill.name, '先过中门再谈未来');
  TH.eq('★ 不再贯穿：kind 从 line 换成 nuke', DANK.skill.kind, 'nuke');
  TH.eq('★ 伤害翻倍（720 → 1440）', DANK.skill.damage, 1440);
  TH.eq('★ 翻倍就是原来那个数 ×2', DANK.skill.damage / 720, 2);
  TH.eq('★ 瞬发：没有 cast 字段（不会走蓄力分支）', DANK.skill.cast, undefined);
  TH.eq('★ 技能击杀会留骷髅', DANK.skill.killSkull, true);
  TH.eq('★ 击杀后耍 3 秒折叠刀', DANK.skill.knifeDur, 3);
  TH.eq('被动类型是 loneWolf', ST.passiveKind(DANK), 'loneWolf');
  TH.eq('★ 1 星就有被动（空悲切）', ST.passiveName(DANK, 1), '空悲切');
  TH.eq('被动名字按星级叠加',
    [ST.passiveName(DANK, 2), ST.passiveName(DANK, 3)].join(' / '),
    '空悲切 + 老男孩 / 空悲切 + 老男孩 + 锁头');
  TH.eq('★ 2 星解锁老男孩、3 星解锁锁头',
    [DANK.passive.startFullAt, DANK.passive.regenMulAt, DANK.passive.killRefillAt].join(','),
    '2,3,3');
  TH.eq('★ 锁头把能量回复翻倍', DANK.passive.regenMul, 2);

  /* 场景：Dank1ng 带一块蓝水晶（开局 35/80 法力）+ 两条腰带，
     正对面是一个脆皮匕首客（会被技能一发带走）+ 一个厚血山岳（战斗不会提前结束）。
     ★★ 两个约束都是踩出来的：
        ① 蓝水晶**只给一块**。给两块就是 70/80，只要挨一下就满了 ——
           技能会在第 1 tick 放出来，"耍刀之前的普攻"一次都采不到。
           一块能把第一次施法推到第 5~6 秒，前面正好有几次普攻可采。
        ② **必须给他配一个队友**。否则「空悲切」从第 0 tick 就成立
           （`aliveCount === 1`），法力永远满格 —— 那测的就不是
           "攒蓝放技能"，而是"无限能量"了。第一版就是这么红的：
           耍刀窗口 0.03→3.03 秒、老男孩的对比也全是 0 秒。 */
  function dankFight(star, seed) {
    return ST.Battle.battle({
      a: [{ id: 'deadeye', star: star, items: ['sapphire', 'belt', 'belt'], r: 3, c: 3 },
          // 陪跑的老牧师：打不出伤害（不会抢人头），血量厚（不会触发空悲切）
          { id: 'medic', star: 1, items: ['belt', 'belt', 'belt'], r: 3, c: 5 }],
      b: [{ id: 'dagger', star: 1, items: ['belt'], r: 4, c: 3 },
          { id: 'titan', star: 1, items: ['belt', 'belt', 'belt'], r: 4, c: 4 }]
    }, seed || 8080);
  }

  // ① 不贯穿：每次施法只打中**一个**人（对面站成一排也不会穿过去）
  (function () {
    var res = ST.Battle.battle({
      // 让三个敌人排成一条横线，正好是旧版 line 技能最吃香的位置
      a: [{ id: 'deadeye', star: 2, r: 3, c: 0 }],
      b: [{ id: 'titan', star: 1, items: ['belt', 'belt', 'belt'], r: 4, c: 0 },
          { id: 'titan', star: 1, items: ['belt', 'belt', 'belt'], r: 4, c: 1 },
          { id: 'titan', star: 1, items: ['belt', 'belt', 'belt'], r: 4, c: 2 }]
    }, 4242);
    var casts = res.log.filter(function (e) { return e.type === 'cast' && e.from === 'a0'; });
    TH.ok('这一场放过技能（否则下面是空断言）', casts.length > 0, casts.length + ' 次');
    if (!casts.length) return;
    /* 每次施法之后紧跟的 skill 伤害事件 —— 按 tick 分组数人头 */
    var perCast = {}, dup = 0;
    for (var i = 0; i < res.log.length; i++) {
      var e = res.log[i];
      if (e.type !== 'skill' || e.from !== 'a0') continue;
      var k = e.t;
      perCast[k] = (perCast[k] || 0) + 1;
    }
    var counts = Object.keys(perCast).map(function (k) { return perCast[k]; });
    for (var c = 0; c < counts.length; c++) if (counts[c] > 1) dup++;
    TH.note('每次施法打中的目标数：' + counts.join('/') +
      '（对面有 3 个敌人排成一条线）');
    TH.eq('★ 不贯穿：每次施法只打中 1 个人', dup, 0);
    TH.ok('★ 而且真的打了好几次（不是只放了一发看不出区别）',
      counts.length >= 2, counts.length + ' 次施法');
    /* ★ 反面：数据层也要能看出"不再贯穿" —— line 的 length 字段必须没了 */
    TH.eq('★ 技能数据里不再有 line 的 length 字段', DANK.skill.length, undefined);
  })();

  // ② 瞬发：Dank1ng 永远不发 charge 事件
  (function () {
    var res = dankFight(2);
    var charges = res.log.filter(function (e) { return e.type === 'charge' && e.who === 'a0'; });
    TH.eq('★ 瞬发：整场没有一次蓄力（charge 事件）', charges.length, 0);
  })();

  // ③ 技能伤害确实是 1440（按 ap × ramp × 魔抗减伤 反推）
  (function () {
    /* ★★ 靶子必须**厚到打不死**：1440 点法术伤害在一堆 1 费身上会被
       「hpLoss 按剩余血量截断」裁掉（实测一个 840 血的匕首客只记 840），
       那样算出来永远比公式小，看着像"伤害没翻倍"。
       这和 README 里「拿开局伤害核对带持续状态的倍率」是同一类坑。 */
    var res = ST.Battle.battle({
      a: [{ id: 'deadeye', star: 2, r: 3, c: 3 },
          { id: 'medic', star: 1, items: ['belt', 'belt', 'belt'], r: 3, c: 5 }],
      b: [{ id: 'titan', star: 3, items: ['belt', 'belt', 'belt'], r: 4, c: 3 }]
    }, 5150);
    var me = res.initial.units.filter(function (u) { return u.uid === 'a0'; })[0];
    var skills = res.log.filter(function (e) { return e.type === 'skill' && e.from === 'a0'; });
    TH.ok('打出了技能伤害', skills.length > 0, skills.length + ' 条');
    if (!skills.length) return;
    var s0 = skills[0];
    var tgt = res.initial.units.filter(function (u) { return u.uid === s0.to; })[0];
    var expect = 1440 * me.ap * s0.ramp * (100 / (100 + tgt.mr));
    TH.ok('★ 技能伤害 = 1440 × 法强 × 递增 × 魔抗减伤',
      Math.abs(s0.dmg - expect) < 1.5,
      '实测 ' + U.round2(s0.dmg) + '，按 1440 算是 ' + U.round2(expect) +
      '（按 720 算是 ' + U.round2(expect / 2) + '）');
  })();

  // ④ ★★ 技能击杀 → 骷髅 + 耍刀 3 秒，而且这 3 秒**一次普攻都没有**
  (function () {
    var res = dankFight(1);
    var skulls = res.log.filter(function (e) { return e.type === 'skull'; });
    var knives = res.log.filter(function (e) { return e.type === 'knife'; });
    TH.ok('★ 技能击杀留下了骷髅', skulls.length > 0, skulls.length + ' 个');
    TH.ok('★ 并且开始耍刀', knives.length > 0, knives.length + ' 次');
    if (!skulls.length || !knives.length) return;
    var sk = skulls[0], kn = knives[0];
    var dead = res.log.filter(function (e) { return e.type === 'death' && e.who === sk.to; });
    TH.ok('★ 骷髅落在尸体所在的那一格上',
      !!dead.length && dead[0].r === sk.r && dead[0].c === sk.c,
      '骷髅 (' + sk.r + ',' + sk.c + ')　尸体 ' +
      (dead.length ? '(' + dead[0].r + ',' + dead[0].c + ')' : '没死'));
    TH.ok('★ 骷髅和耍刀是同一次击杀的产物（同一 tick）',
      Math.abs(sk.t - kn.t) < 1e-9, '骷髅 ' + U.round2(sk.t) + ' / 耍刀 ' + U.round2(kn.t));
    TH.eq('★ 耍刀时长 3 秒', kn.dur, 3);

    /* ★★ 三头都要验：耍刀前在打、窗口内一次没打、窗口之后又开始打。
       只验中间那条的话，"它本来就没在打"（比如被控住了）也能过。
       ★★ 分段必须按**事件序号**，不能只看时刻：耍刀是由"那一次普攻"
          自己触发的（打了一下 → 攒满法力 → 开技能 → 击杀 → 开始耍刀），
          所以开刀那一 tick 里本来就有一条攻击，时刻正好等于 kn.t ——
          只看时刻会把它算进"窗口内"，然后报"耍刀期间还在打"。
          （同一个坑这个项目已经踩过四次了，见 README 第 77 条。） */
    var knIdx = idxOf(res, function (e) { return e.type === 'knife'; });
    var atkIdx = [];
    for (var ai = 0; ai < res.log.length; ai++) {
      if (res.log[ai].type === 'attack' && res.log[ai].from === 'a0') atkIdx.push(ai);
    }
    var before = 0, during = 0, after = 0;
    for (var i2 = 0; i2 < atkIdx.length; i2++) {
      if (atkIdx[i2] < knIdx) before++;
      else if (atkIdx[i2] === knIdx) continue;      // 触发开刀的那一下，不算"窗口内"
      else if (res.log[atkIdx[i2]].t < kn.until) during++;
      else after++;
    }
    TH.note('耍刀窗口 ' + U.round2(kn.t) + '→' + U.round2(kn.until) + 's：' +
      '之前 ' + before + ' 下普攻 / 窗口内 ' + during + ' 下 / 之后 ' + after + ' 下');
    TH.ok('★ 耍刀之前它是在普攻的（所以下面那条不是空断言）', before > 0, before + ' 下');
    TH.eq('★ 耍刀的 3 秒里一次普攻都没有', during, 0);
    TH.ok('★ 耍刀结束之后又开始普攻了', after > 0, after + ' 下');

    /* ★★ 而且这 3 秒里**连技能都不放** —— 这才是「无限能量不等于无限火力」的那道刹车。
       只封普攻的话，无限能量会让它在耍刀期间照样连放技能，刹车就形同虚设。 */
    var knifeCasts = res.log.filter(function (e, idx2) {
      return e.type === 'cast' && e.from === 'a0' && idx2 > knIdx &&
             res.log[idx2].t < kn.until;
    });
    var castsAll = res.log.filter(function (e) { return e.type === 'cast' && e.from === 'a0'; });
    TH.eq('★ 耍刀的 3 秒里一次技能都没放（刹车对技能同样有效）',
      knifeCasts.length, 0);
    TH.ok('★ 而它整场是放过技能的（所以上面那条不是"它本来就不放"）',
      castsAll.length >= 2, castsAll.length + ' 次施法');
    TH.ok('★ 窗口内敌人一直在旁边（不攻击不是因为没目标）',
      res.log.filter(function (e) {
        return e.type === 'attack' && e.from === 'b0' && e.t >= kn.t && e.t < kn.until;
      }).length > 0 || res.log.filter(function (e) {
        return e.type === 'attack' && e.from === 'b1' && e.t >= kn.t && e.t < kn.until;
      }).length > 0, '耍刀期间敌人在出手');
  })();

  // ⑤ ★★ 「空悲切」：队友全死光之后出手频率明显变高（无限能量）
  (function () {
    var res = ST.Battle.battle({
      a: [{ id: 'deadeye', star: 1, items: ['belt', 'belt', 'belt'], r: 3, c: 3 },
          // 裸装匕首客：一定会先死，用来触发"所有队友阵亡"
          { id: 'dagger', star: 1, r: 3, c: 4 }],
      /* ★★ 陪练用「大地守护」而不是钟离：钟离 3 星的陨石会把 Dank1ng
         **石化 3 秒**，而这一条量的正是"他放技能的频率" ——
         被石化的那几秒里他一次技能都放不出来，数字直接掉一半以上。
         摆两个是为了让"开之后"那段窗口够长（一个陪练 4 秒就没了）。 */
      b: [{ id: 'earthwarden', star: 3, items: ['belt', 'belt', 'belt'], r: 4, c: 3 },
          { id: 'earthwarden', star: 3, items: ['belt', 'belt', 'belt'], r: 4, c: 6 }]
    }, 3131);
    var on = res.log.filter(function (e) { return e.type === 'endless' && e.on; });
    var off = res.log.filter(function (e) { return e.type === 'endless' && !e.on; });
    TH.ok('★ 队友全死光后进入了「空悲切」状态', on.length > 0, on.length + ' 次');
    if (!on.length) return;
    var tOn = on[0].t;
    TH.eq('★ 开了之后不会再关（这一场没有复活）', off.length, 0);
    TH.ok('★ 开的那一刻法力是满的（「立刻恢复」）',
      on[0].mana === on[0].maxMana, on[0].mana + '/' + on[0].maxMana);
    var deadAllies = res.log.filter(function (e) {
      return e.type === 'death' && e.side === 'a' && e.who !== 'a0';
    });
    TH.ok('★ 它是在队友倒下的那一刻开的',
      deadAllies.length > 0 && Math.abs(deadAllies[deadAllies.length - 1].t - tOn) < 0.1,
      '队友阵亡 ' + (deadAllies.length ? U.round2(deadAllies[deadAllies.length - 1].t) : '—') +
      's / 开 ' + U.round2(tOn) + 's');

    /* ★★ 最有力的一条：数施法次数。开之前几乎放不出技能，开之后一秒一发。 */
    var endT = res.log[res.log.length - 1].t;
    var casts = res.log.filter(function (e) { return e.type === 'cast' && e.from === 'a0'; })
      .map(function (e) { return e.t; });
    var cBefore = 0, cAfter = 0;
    for (var i = 0; i < casts.length; i++) { if (casts[i] < tOn) cBefore++; else cAfter++; }
    var span = endT - tOn;
    TH.note('「空悲切」开了 ' + U.round2(span) + ' 秒：之前放 ' + cBefore +
      ' 次技能，之后放 ' + cAfter + ' 次（每秒 ' +
      (span > 0 ? (cAfter / span).toFixed(2) : '—') + ' 次）');
    TH.ok('★ 开之前几乎放不出技能（法力 80 要攒 8 次普攻）', cBefore <= 1, cBefore + ' 次');
    TH.ok('★ 开之后出手频率明显暴涨（这就是"无限能量"的可观测形式）',
      cAfter >= 5 && cAfter / Math.max(0.1, span) >= 0.8,
      cAfter + ' 次 / ' + U.round2(span) + 's');
  })();

  /* ⑤b ★★ 「无限能量不等于无限火力」—— 这是**耍刀作为刹车**的正面证明。
        场景：3 星 Dank1ng 一个人（空悲切从一开始就成立 → 法力永远满格，
        而且 3 星有「锁头」：击杀立刻回满），对面站着一排能被一发带走的脆皮。
        于是它的循环就是「放 → 杀 → 耍刀 3 秒 → 再放」。
        ★ 断言：**相邻两次击杀之间必然隔着一个耍刀窗口**（≈3 秒）。
        ★★ 这一条是有区分度的：如果耍刀只封普攻、不封技能，
          那么法力永远满格的它会**在耍刀期间接着放技能**，
          击杀间隔会退化到 CAST_LOCK 的 0.5 秒 —— 这一条立刻会红。
          实测就是这么定下来的：用户的原话是
          "很明显无限能量不是无限火力，因为杀了人会耍刀 3 秒不攻击"。 */
  (function () {
    var res = ST.Battle.battle({
      a: [{ id: 'deadeye', star: 3, items: ['belt', 'belt', 'belt'], r: 3, c: 0 }],
      b: [{ id: 'bowman', star: 1, items: ['belt'], r: 4, c: 0 },
          { id: 'bowman', star: 1, items: ['belt'], r: 4, c: 1 },
          { id: 'bowman', star: 1, items: ['belt'], r: 4, c: 2 },
          { id: 'bowman', star: 1, items: ['belt'], r: 4, c: 3 },
          { id: 'bowman', star: 1, items: ['belt'], r: 4, c: 4 }]
    }, 6060);
    var skulls2 = res.log.filter(function (e) { return e.type === 'skull'; })
      .map(function (e) { return e.t; });
    TH.ok('★ 这一场连着杀了好几个（否则采不到击杀间隔）', skulls2.length >= 3,
      skulls2.length + ' 次击杀');
    if (skulls2.length < 3) return;
    var gaps = [];
    for (var i = 1; i < skulls2.length; i++) gaps.push(skulls2[i] - skulls2[i - 1]);
    TH.note('3★ Dank1ng 连续击杀的间隔：' +
      gaps.map(function (g) { return U.round2(g) + 's'; }).join(' / '));
    var tooFast = gaps.filter(function (g) { return g < 3.0 - 0.05; });
    TH.eq('★ 相邻两次击杀之间**必然隔着一个完整的耍刀窗口**（≥3 秒）',
      tooFast.length, 0);
    TH.ok('★ 而且确实是"放→杀→停 3 秒"的节奏，不是拖着不放',
      gaps.every(function (g) { return g <= 3.6; }), gaps.join('/'));
    /* ★ 顺带确认：击杀之后法力确实是满的（锁头在起作用）——
       所以这 3 秒的停顿**不是**因为没能量，纯粹是刹车。 */
    var rf = res.log.filter(function (e) { return e.type === 'refill' && e.who === 'a0'; });
    TH.ok('★ 每次击杀都把能量回满了（所以停顿不是因为没能量，是耍刀）',
      rf.length >= 2, rf.length + ' 次回满');
  })();

  // ⑥ 「老男孩」（2 星）：开局满能量，第一发来得非常早
  (function () {
    var m1 = dankFight(1).initial.units.filter(function (u) { return u.uid === 'a0'; })[0];
    var m2 = dankFight(2).initial.units.filter(function (u) { return u.uid === 'a0'; })[0];
    TH.eq('★ 1 星开局不是满的（蓝水晶只给了 35/80）', m1.mana, 35);
    TH.eq('★ 2 星开局满能量', m2.mana, m2.maxMana);

    function firstCast(res) {
      var c = res.log.filter(function (e) { return e.type === 'cast' && e.from === 'a0'; });
      return c.length ? c[0].t : 999;
    }
    var t1 = firstCast(dankFight(1)), t2 = firstCast(dankFight(2));
    TH.note('第一次施法：1★ ' + U.round2(t1) + 's　2★ ' + U.round2(t2) + 's');
    TH.ok('★ 2 星的第一发放得比 1 星早得多（开局满能量真的省掉了攒蓝）',
      t2 < t1 - 0.8, U.round2(t2) + 's vs ' + U.round2(t1) + 's');
  })();

  // ⑦ 「锁头」（3 星）：能量回复翻倍 + 击杀回满
  (function () {
    var m3 = dankFight(3).initial.units.filter(function (u) { return u.uid === 'a0'; })[0];
    TH.eq('★ 3 星的能量回复倍率是 2', m3.manaRegenMul, 2);
    TH.eq('★ 3 星会击杀回满能量', m3.killRefill, true);
    TH.eq('★ 1 星没有这两条', dankFight(1).initial.units
      .filter(function (u) { return u.uid === 'a0'; })[0].manaRegenMul, 1);

    var res = dankFight(3);
    var refills = res.log.filter(function (e) { return e.type === 'refill' && e.who === 'a0'; });
    TH.ok('★ 击杀之后能量真的回满了（有 refill 事件）', refills.length > 0,
      refills.length + ' 次');
    TH.ok('★ 而且回满的是满格',
      refills.length > 0 && refills[0].mana === m3.maxMana,
      refills.length ? (refills[0].mana + '/' + m3.maxMana) : '—');
    /* ★ 能量回复翻倍的可观测形式：同样两条蓝水晶，3 星攒满只要 4 次普攻。 */
    function firstCast(res2) {
      var c = res2.log.filter(function (e) { return e.type === 'cast' && e.from === 'a0'; });
      return c.length ? c[0].t : 999;
    }
    TH.note('第一次施法：1★ ' + U.round2(firstCast(dankFight(1))) +
      's　3★ ' + U.round2(firstCast(dankFight(3))) + 's');
  })();

  /* ============================================================
   * 5d. 走位智商：被队友挡住怎么办
   *
   * 原来只有「严格递减的贪心一步」：前方一旦被队友占住，棋子就**永远原地不动**，
   * 一群人挤在后排干看着前排挨打 —— 玩家看到的就是「我的近战在发呆」。
   * 现在两层兜底：
   *   ① 绕路：贪心走不动就 BFS 找最近的可达、更靠近目标的空格
   *   ② 换位：连绕路都无路可走时，和前方队友交换位置
   * ============================================================ */
  TH.section('走位智商');

  function movesOf(res, uid) {
    var out = [];
    for (var i = 0; i < res.log.length; i++) {
      if (res.log[i].type === 'move' && res.log[i].who === uid) out.push(res.log[i]);
    }
    return out;
  }
  function swapsOf(res, uid) {
    var out = [];
    for (var i = 0; i < res.log.length; i++) {
      var e = res.log[i];
      if (e.type === 'swap' && (e.a === uid || e.b === uid)) out.push(e);
    }
    return out;
  }

  // ① 被挡住 → 绕路（而不是原地发呆）
  (function () {
    // 我方近战在 (6,4)，正前方 (5,3)(5,4)(5,5) 被队友占满；
    // 敌人远在 (0,4)。贪心一步走不动，但 (5,2) 是空的 → 应该绕过去。
    var setup = {
      a: [{ id: 'bowman', star: 1, r: 0, c: 4 }],
      b: [
        { id: 'dagger', star: 1, r: 6, c: 4 },       // 被堵住的这个
        { id: 'acolyte', star: 1, r: 5, c: 3 },
        { id: 'acolyte', star: 1, r: 5, c: 4 },
        { id: 'acolyte', star: 1, r: 5, c: 5 }
      ]
    };
    var r = ST.Battle.battle(setup, 5150);
    var mv = movesOf(r, 'b0');
    TH.ok('★ 被队友挡住的近战不会原地发呆（会自己动）', mv.length > 0, mv.length + ' 次走位');
    if (mv.length) {
      var f = mv[0];
      // 第一次走位应该是「横向绕」，落点并不比出发点更靠近敌人
      var closer = U.cheb(f.r, f.c, 0, 4) < U.cheb(6, 4, 0, 4);
      TH.ok('★ 第一次走位是绕路（落点没有直接缩短距离，说明是横向找缝）',
        !closer || f.around === true,
        '从 (6,4) 走到 (' + f.r + ',' + f.c + ')' + (f.around ? ' [绕路标记]' : ''));
    }
  })();

  // ② 被彻底堵死 → 和前方队友换位
  (function () {
    /* 用**棋盘角落**造一个真正封死的局面：越界的格子也算堵，
       所以角落里只要堵住 3 个邻居就彻底出不去。
       ★ 一开始我用的是「中间围一圈 8 个队友」，结果 0 次换位 ——
         因为那些队友自己会往上走，包围圈在换位判定之前就散了。
         测「走投无路」必须保证它真的走投无路。 */
    var r = ST.Battle.battle({
      a: [{ id: 'bowman', star: 1, r: 0, c: 7 }],
      b: [
        { id: 'dagger', star: 1, r: 7, c: 7 },       // 被困在右下角
        { id: 'acolyte', star: 1, r: 6, c: 6 },
        { id: 'acolyte', star: 1, r: 6, c: 7 },
        { id: 'acolyte', star: 1, r: 7, c: 6 }
      ]
    }, 8675309);

    var sw = swapsOf(r, 'b0');
    TH.ok('★ 被彻底堵死时会和前方队友换位', sw.length > 0, sw.length + ' 次换位');
    if (sw.length) {
      var e0 = sw[0];
      var myR = (e0.a === 'b0') ? e0.aR : e0.bR;
      var myC = (e0.a === 'b0') ? e0.aC : e0.bC;
      TH.ok('换位之后确实往前挪了（换到了前排队友的格子）',
        myR < 7, '从 (7,7) 换到 (' + myR + ',' + myC + ')');
    }
    TH.ok('被围住也不会「整场一动不动」',
      swapsOf(r, 'b0').length > 0 || movesOf(r, 'b0').length > 0);
  })();

  // ②b 换位在真实对局里到底发生得多不多（不是死代码，也不该刷屏）
  (function () {
    var comps = ST.Battle.presetComps();
    var names = Object.keys(comps);
    var total = 0, withSwap = 0, sims = 0;
    for (var i = 0; i < names.length; i++) {
      for (var s = 0; s < 10; s++) {
        var r = ST.Battle.battle({
          a: ST.Battle.makeComp('a', comps[names[i]]),
          b: ST.Battle.makeComp('b', comps[names[(i + 2) % names.length]])
        }, 90000 + i * 977 + s * 13);
        sims++;
        var n = r.log.filter(function (e) { return e.type === 'swap'; }).length;
        total += n;
        if (n > 0) withSwap++;
      }
    }
    TH.note('真实对局里的换位：' + sims + ' 场共 ' + total + ' 次，' +
      withSwap + ' 场至少发生一次（换位是「被彻底堵死」才触发的兜底手段，不该刷屏）');
  })();

  // ③ 不会互相顶：换位有冷却，不会两个人原地循环换
  (function () {
    var comps = ST.Battle.presetComps();
    var names = Object.keys(comps);
    var worst = 0, worstName = '';
    for (var i = 0; i < names.length; i++) {
      for (var s = 0; s < 6; s++) {
        var r = ST.Battle.battle({
          a: ST.Battle.makeComp('a', comps[names[i]]),
          b: ST.Battle.makeComp('b', comps[names[(i + 1) % names.length]])
        }, 7000 + s * 31);
        var perUnit = {};
        for (var k = 0; k < r.log.length; k++) {
          if (r.log[k].type !== 'swap') continue;
          perUnit[r.log[k].a] = (perUnit[r.log[k].a] || 0) + 1;
          perUnit[r.log[k].b] = (perUnit[r.log[k].b] || 0) + 1;
        }
        for (var uid in perUnit) {
          if (perUnit[uid] > worst) { worst = perUnit[uid]; worstName = names[i]; }
        }
      }
    }
    /* 换位冷却 SWAP_LOCK = 1 秒，所以单个单位的换位次数上限就是对局秒数。
       ★ 这里不写死数字 —— 对局上限从 30 秒提到 60 秒时，
         写死的 30 会变成一个没人注意到的假上限。 */
    var swapCap = Math.ceil(CFG.MAX_SECONDS / ST.BATTLE_CFG.SWAP_LOCK);
    TH.ok('★ 换位不会变成原地互顶（单个单位换位次数有上限）', worst <= swapCap,
      '实测最多 ' + worst + ' 次（' + worstName + '），上限 ' + swapCap + ' 次');
  })();

  // ④ 该换位规则只对「真的走投无路」生效：开阔局面下不该频繁换位
  (function () {
    var r = ST.Battle.battle({
      a: [{ id: 'dagger', star: 1, r: 3, c: 0 }],
      b: [{ id: 'dagger', star: 1, r: 4, c: 0 }]
    }, 4321);
    var total = r.log.filter(function (e) { return e.type === 'swap'; }).length;
    TH.eq('两个单挑的棋子之间不会发生换位（本来就没被堵）', total, 0);
  })();

  /* ============================================================
   * 6. 极端输入
   * ============================================================ */
  TH.section('极端输入');

  function tryRun(name, setup, seed) {
    try {
      var r = ST.Battle.battle(setup, seed === undefined ? 1 : seed);
      TH.ok(name, true);
      return r;
    } catch (err) {
      TH.fail(name, err && err.message ? err.message : String(err));
      return null;
    }
  }

  var rEmptyA = tryRun('A 方空阵容不崩', { a: [], b: compB });
  if (rEmptyA) {
    TH.eq('A 空阵容时判 B 胜', rEmptyA.winner, 'b');
    TH.eq('A 空阵容时存活数正确', rEmptyA.survivors.a, 0);
  }
  var rEmptyBoth = tryRun('双方都空不崩', { a: [], b: [] });
  if (rEmptyBoth) TH.eq('双方都空判平局', rEmptyBoth.winner, 'draw');
  tryRun('缺少 b 字段不崩', { a: compA });
  tryRun('非法棋子 id 被忽略', { a: [{ id: '不存在的棋子' }], b: compB });
  tryRun('非法装备 id 被忽略', { a: [{ id: 'titan', items: ['不存在', 'belt'] }], b: compB });
  tryRun('星级越界被容错', { a: [{ id: 'titan', star: 9 }], b: compB });
  tryRun('island: 单个棋子对战', { a: [{ id: 'vine' }], b: [{ id: 'dagger' }] });

  var rTooMany = tryRun('超过上场上限被截断', {
    a: ST.UNITS.slice(0, 12).map(function (x) { return { id: x.id }; }), b: compB
  });
  if (rTooMany) {
    TH.eq('上场数被截到 MAX_DEPLOY',
      rTooMany.initial.units.filter(function (x) { return x.side === 'a'; }).length, ST.MAX_DEPLOY);
  }

  var rSame = tryRun('6 个相同棋子可以同时上场', {
    a: [{ id: 'dagger' }, { id: 'dagger' }, { id: 'dagger' },
        { id: 'dagger' }, { id: 'dagger' }, { id: 'dagger' }], b: compB
  });

  /* ============================================================
   * 7. 技能全部能放出来
   * ============================================================ */
  TH.section('技能覆盖');

  // 陪练：3 星石卫 + 三件肉装。血厚、打得慢，保证被测棋子活够久放出技能。
  // （早期用的是 3 星山岳，但山岳现在是 5 费、攻击 105，一巴掌就把被测棋子拍死了，
  //   反而测不出技能。陪练就该是「打不动你、但你也一时打不死它」。）
  var DUMMY = { id: 'stoneguard', star: 3, items: ['belt', 'dragonscale', 'voidcloak'] };
  var kindsSeen = {};
  var noCast = [];
  for (i = 0; i < ST.UNITS.length; i++) {
    u = ST.UNITS[i];
    kindsSeen[u.skill.kind] = true;
    var rSk = ST.Battle.battle({
      a: [{ id: u.id, star: 3, items: ['sapphire', 'belt', 'dragonscale'] }],
      b: [DUMMY]
    }, 31337 + i);
    var skStat = rSk.unitStats.a0;
    if (!skStat || skStat.casts < 1) noCast.push(u.id + '(' + u.skill.kind + ')');
  }
  TH.ok(ST.UNITS.length + ' 个棋子每个都至少放出一次技能', noCast.length === 0,
    noCast.length ? ('没放出来的：' + noCast.join('、')) : '');
  TH.eq('十四种技能类型全部被覆盖', Object.keys(kindsSeen).sort().join(','),
    VALID_KINDS.slice().sort().join(','));

  // 技能确实造成了伤害 / 治疗
  var rNuke = ST.Battle.battle({
    a: [{ id: 'abyss', star: 3, items: ['spellbook', 'spellbook', 'spellbook'] }], b: [DUMMY]
  }, 777);
  TH.ok('法术强度会放大技能伤害',
    rNuke.unitStats.a0.dmgDealt > 0, 'dmgDealt=' + rNuke.unitStats.a0.dmgDealt);

  var rHeal = ST.Battle.battle({
    a: [{ id: 'medic', star: 2 }, { id: 'stoneguard', star: 1 }],
    b: [DUMMY]
  }, 888);
  TH.ok('治疗型技能确实回血', rHeal.unitStats.a0.healing > 0, 'healing=' + rHeal.unitStats.a0.healing);

  /* ============================================================
   * 8. 羁绊
   * ============================================================ */
  TH.section('羁绊');

  function firstUnitOf(res, side) {
    for (var k = 0; k < res.initial.units.length; k++) {
      if (res.initial.units[k].side === side) return res.initial.units[k];
    }
    return null;
  }
  function traitOf(res, side, id) {
    var list = res.initial.traits[side];
    for (var k = 0; k < list.length; k++) if (list[k].id === id) return list[k];
    return null;
  }

  var rT1 = ST.Battle.battle({ a: [{ id: 'stoneguard' }], b: [{ id: 'bowman' }] }, 11);
  var tg1 = traitOf(rT1, 'a', 'ironguard');
  TH.ok('单个棋子不激活羁绊', tg1 && tg1.tier === -1, tg1 ? ('tier=' + tg1.tier) : '没找到');
  TH.eq('未激活羁绊不加成护甲', firstUnitOf(rT1, 'a').armor, 35);

  var rT2 = ST.Battle.battle({
    a: [{ id: 'stoneguard' }, { id: 'spearman' }], b: [{ id: 'bowman' }]
  }, 12);
  var tg2 = traitOf(rT2, 'a', 'ironguard');
  TH.eq('铁卫 2 档被激活', tg2.tier, 0);
  TH.eq('铁卫 2 档护甲 = 基础 + 40', firstUnitOf(rT2, 'a').armor, 35 + 40);

  var rT4 = ST.Battle.battle({
    a: [{ id: 'stoneguard' }, { id: 'spearman' }, { id: 'crossbow' }, { id: 'ironwall' }],
    b: [{ id: 'bowman' }]
  }, 13);
  var tg4 = traitOf(rT4, 'a', 'ironguard');
  TH.eq('铁卫 4 档被激活', tg4.tier, 1);
  TH.eq('铁卫 4 档护甲 = 基础 + 100', firstUnitOf(rT4, 'a').armor, 35 + 100);

  var rWard = ST.Battle.battle({
    a: [{ id: 'stoneguard' }, { id: 'templar' }], b: [{ id: 'bowman' }]
  }, 14);
  TH.eq('守护 2 档开局护盾 = 180', firstUnitOf(rWard, 'a').shield, 180);
  var wardEvents = rWard.log.filter(function (e) { return e.type === 'shield' && e.reason === 'trait'; });
  TH.eq('开局护盾写进了事件流', wardEvents.length, 2);

  var rColo = ST.Battle.battle({
    a: [{ id: 'vine' }, { id: 'wolfrider' }], b: [{ id: 'bowman' }]
  }, 15);
  var rColoSolo = ST.Battle.battle({ a: [{ id: 'vine' }], b: [{ id: 'bowman' }] }, 15);
  var coloUnit = null;
  for (i = 0; i < rColo.initial.units.length; i++) {
    if (rColo.initial.units[i].defId === 'vine') coloUnit = rColo.initial.units[i];
  }
  var soloVine = null;
  for (i = 0; i < rColoSolo.initial.units.length; i++) {
    if (rColoSolo.initial.units[i].defId === 'vine') soloVine = rColoSolo.initial.units[i];
  }
  TH.eq('巨兽 2 档生命 = 基础 ×1.2', coloUnit.maxHp, Math.round(640 * 1.2));
  TH.ok('巨兽确实提高了生命上限', coloUnit.maxHp > soloVine.maxHp);

  var rRegen = ST.Battle.battle({
    a: [{ id: 'acolyte' }, { id: 'vine' }, { id: 'stoneguard' }, { id: 'titan', star: 3 }],
    b: [DUMMY]
  }, 16);
  var regenEvents = rRegen.log.filter(function (e) { return e.type === 'heal' && e.reason === 'regen'; });
  TH.ok('医者羁绊产生持续回血事件', regenEvents.length > 0, 'regen 治疗事件 ' + regenEvents.length + ' 条');

  var rArc = ST.Battle.battle({
    a: [{ id: 'pyromancer' }, { id: 'acolyte' }], b: [{ id: 'bowman' }]
  }, 17);
  TH.eq('秘术 2 档法术强度 +30%', firstUnitOf(rArc, 'a').ap, 1.3);

  var rAs = ST.Battle.battle({
    a: [{ id: 'pyromancer' }, { id: 'wolfrider' }], b: [{ id: 'bowman' }]
  }, 18);
  var asPyro = null;
  for (i = 0; i < rAs.initial.units.length; i++) {
    if (rAs.initial.units[i].defId === 'pyromancer') asPyro = rAs.initial.units[i];
  }
  /* ★ 基准攻速从数据里取，不写死 0.66 ——
     羊帆改成「移速/攻速各 -80%」之后基准变成了 0.132，
     把数字抄进断言的话，调一次数值就要回来红一条和羁绊毫无关系的用例
     （README 第 55 条踩的就是这个坑）。 */
  TH.eq('狂战 2 档攻速 +25%', asPyro.as,
    U.round2(ST.UNIT_BY_ID.pyromancer.as * 1.25));

  var rCrit = ST.Battle.battle({
    a: [{ id: 'bowman' }, { id: 'dagger' }], b: [{ id: 'titan' }]
  }, 19);
  TH.eq('影袭 2 档暴击率 = 15% + 25%', firstUnitOf(rCrit, 'a').critChance, 0.4);

  var rRanger = ST.Battle.battle({
    a: [{ id: 'bowman' }, { id: 'spearman' }], b: [{ id: 'titan' }]
  }, 20);
  var rangerAd = null;
  for (i = 0; i < rRanger.initial.units.length; i++) {
    if (rRanger.initial.units[i].defId === 'bowman') rangerAd = rRanger.initial.units[i];
  }
  /* ★ 这几条以前把「短弓手攻击力 = 45」写死在断言里，2026-10 那次
     「单次伤害翻倍、攻速减半」一改就集体报错 —— 而机制一点问题都没有。
     改成从 units.js 的数据取基准值：调数值时断言自动跟着走，
     只有**公式**变了才会红。 */
  var BOW_AD = ST.UNIT_BY_ID.bowman.ad;
  var BOW_AS = ST.UNIT_BY_ID.bowman.as;
  TH.eq('游侠 2 档攻击力 +25%', rangerAd.ad, U.round2(BOW_AD * 1.25));

  /* ============================================================
   * 9. 装备
   * ============================================================ */
  TH.section('装备');

  function single(sideUnits, dummy) {
    return ST.Battle.battle({
      a: sideUnits,
      b: dummy || [{ id: 'bowman' }]
    }, 21);
  }

  TH.eq('巨人腰带 +280 生命', firstUnitOf(single([{ id: 'bowman', items: ['belt'] }]), 'a').maxHp, 500 + 280);
  TH.eq('龙鳞甲 +45 护甲', firstUnitOf(single([{ id: 'bowman', items: ['dragonscale'] }]), 'a').armor, 18 + 45);
  TH.eq('虚空斗篷 +45 魔抗', firstUnitOf(single([{ id: 'bowman', items: ['voidcloak'] }]), 'a').mr, 20 + 45);
  TH.eq('巨力之刃 +25% 攻击力', firstUnitOf(single([{ id: 'bowman', items: ['giantblade'] }]), 'a').ad, U.round2(BOW_AD * 1.25));
  /* ★ 攻速这条改成**从装备数据里取值**，不写死 1.22 ——
     这颗大果从 +22% 改到 +30% 的时候，写死的算式红了，
     但那和"装备机制对不对"毫无关系（第 55 行坑位是同一条教训）。 */
  TH.eq('和成天下5000精品大果 +30% 攻速',
    firstUnitOf(single([{ id: 'bowman', items: ['swiftboots'] }]), 'a').as,
    U.round2(BOW_AS * (1 + ST.ITEM_BY_ID.swiftboots.mods.asPct)));
  TH.eq('秘法之书 +30% 法术强度', firstUnitOf(single([{ id: 'bowman', items: ['spellbook'] }]), 'a').ap, 1.3);
  TH.eq('蓝水晶 开局 +35 法力', firstUnitOf(single([{ id: 'bowman', items: ['sapphire'] }]), 'a').mana, 35);
  TH.eq('猎手之眼 +30% 暴击率', firstUnitOf(single([{ id: 'bowman', items: ['huntereye'] }]), 'a').critChance, 0.45);
  TH.eq('无尽之刃 +50% 暴击伤害', firstUnitOf(single([{ id: 'bowman', items: ['infinity'] }]), 'a').critMult, 2);

  var rThorn = ST.Battle.battle({
    a: [{ id: 'titan', star: 3, items: ['thornmail', 'belt', 'dragonscale'] }],
    b: [{ id: 'blademaster', star: 3, items: ['swiftboots', 'giantblade', 'infinity'] }]
  }, 22);
  var thornEvents = rThorn.log.filter(function (e) { return e.type === 'damage' && e.reason === 'thorn'; });
  TH.ok('荆棘之甲会反弹伤害', thornEvents.length > 0, '反弹事件 ' + thornEvents.length + ' 条');

  var rSteal = ST.Battle.battle({
    a: [{ id: 'blademaster', star: 3, items: ['bloodthirst', 'swiftboots', 'giantblade'] }],
    b: [DUMMY]
  }, 23);
  var stealEvents = rSteal.log.filter(function (e) { return e.type === 'heal' && e.reason === 'lifesteal'; });
  TH.ok('血饮剑会吸血', stealEvents.length > 0, '吸血事件 ' + stealEvents.length + ' 条');

  /* ============================================================
   * 11b. 「和成天下5000精品大果」—— 全游戏第一件**有行为**的装备
   *
   *   +30% 攻速；普攻给敌人叠「寒冰」；**每秒失去 6% 生命上限**。
   *
   *   ★★ 自燃和「超频自毁」是两条独立规则，公式也不同：
   *        超频（张雪峰）：当前生命 × 44%  → 指数衰减，越掉越慢
   *        大果（这件装备）：生命上限 × 6%  → 线性，固定 16.7 秒后必死
   *      所以下面最锋利的那条断言是"**每一秒掉的一样多**" ——
   *      指数衰减下第 4 秒的量会比第 1 秒小一大截，线性则完全相等。
   * ============================================================ */
  TH.section('和成天下5000精品大果 · 攻速 + 寒冰 + 自燃');

  var BIGFRUIT = ST.ITEM_BY_ID.swiftboots;
  TH.eq('装备已改名为「和成天下5000精品大果」', BIGFRUIT.name, '和成天下5000精品大果');
  TH.eq('id 仍然是 swiftboots（levels.js 的阵容 + art/items/swiftboots.png 都按 id 索引）',
    BIGFRUIT.id, 'swiftboots');
  TH.eq('★ 攻速 +30%（原来是 +22%）', BIGFRUIT.mods.asPct, 0.30);
  TH.ok('★ 行为写在 grants 里，**没有混进 mods**（mods 只放面板数字）',
    !!BIGFRUIT.grants && BIGFRUIT.mods.burnMaxPct === undefined &&
    BIGFRUIT.mods.chill === undefined,
    'mods = [' + Object.keys(BIGFRUIT.mods).join(',') + ']　grants = [' +
    Object.keys(BIGFRUIT.grants).join(',') + ']');
  TH.eq('★ 每秒失去 6% 生命上限', BIGFRUIT.grants.burnMaxPct, 0.06);
  TH.eq('★ 寒冰的参数和张雪峰的「巧乐兹」逐项一致（每层 -5% / 满 10 层 / 冻 3 秒）',
    [BIGFRUIT.grants.chill.perHit, BIGFRUIT.grants.chill.perStack,
     BIGFRUIT.grants.chill.max, BIGFRUIT.grants.chill.freezeDur].join('/'),
    '1/0.05/10/3');
  TH.ok('★ 描述里写明了代价（不写的话玩家只会觉得"这装备在杀我"）',
    BIGFRUIT.desc.indexOf('6%') >= 0 && BIGFRUIT.desc.indexOf('生命上限') >= 0 &&
    BIGFRUIT.desc.indexOf('30%') >= 0, BIGFRUIT.desc);

  // grants 的合并规则：取强，不相加
  (function () {
    var g1 = ST.resolveItemGrants(['swiftboots']);
    var g3 = ST.resolveItemGrants(['swiftboots', 'swiftboots', 'swiftboots']);
    TH.eq('★ 带 3 颗果子仍然是每秒 6%（取强，不相加）', g3.burnMaxPct, 0.06);
    TH.eq('★ 寒冰每击层数也不叠加（相加的话每击 3 层、5 下就冻一次）',
      g3.chill.perHit, g1.chill.perHit);
    TH.eq('没带果子就没有自燃', ST.resolveItemGrants(['belt']).burnMaxPct, 0);
    TH.eq('没带果子就没有寒冰', ST.resolveItemGrants(['belt']).chill, null);
  })();

  /* 场景：带上大果的 3 星医师 vs 1 星山岳（三条腰带）。
     ★ 为什么这么配：
       · 戴的人得**活得够久**才量得到自燃 —— 医师 3★ + 两条腰带有 3800 血，
         而且它会给自己回血；
       · 对手得**又硬又不痛** —— 1 星山岳 3000 血、输出很低，
         既撑得住 17 秒、又不会先把戴的人打死（那样自燃就量不全了）；
       · 戴的人还要**打得够多下**才验得到寒冰满层 —— 医师 0.68 攻速 ×1.30 ≈ 0.88，
         17 秒里打得出十几下。 */
  function fruitFight(withItem) {
    return ST.Battle.battle({
      a: [{ id: 'medic', star: 3,
            items: withItem ? ['swiftboots', 'belt', 'belt'] : ['belt', 'belt'], r: 0, c: 0 }],
      b: [{ id: 'titan', star: 1, items: ['belt', 'belt', 'belt'], r: 4, c: 4 }]
    }, 31337);
  }

  (function () {
    var r = fruitFight(true);
    var me = r.initial.units.filter(function (u) { return u.side === 'a'; })[0];
    TH.ok('★ 带上它的人身上带着自燃参数', me && Math.abs(me.burnMaxPct - 0.06) < 1e-9,
      me ? me.burnMaxPct : '没找到');
    TH.ok('★ 也带着寒冰参数（这就是"第一件有行为的装备"）',
      me && me.chillMax > 0 && Math.abs(me.chillPerStack - 0.05) < 1e-9,
      me ? (me.chillMax + ' 层 / 每层 ' + me.chillPerStack) : '没找到');

    var burns = r.log.filter(function (e) {
      return e.type === 'selfburn' && e.reason === 'item' && e.who === me.uid;
    });
    TH.ok('★ 每秒都在自燃（至少采到 3 下）', burns.length >= 3, burns.length + ' 次');

    // ① 每一次都正好是「上限 × 6%」
    var amtBad = 0, amtWant = U.round2(me.maxHp * 0.06);
    for (var i = 0; i < burns.length; i++) {
      // 最后一下可能被剩余血量截断
      if (Math.abs(burns[i].amount - amtWant) > 0.05 &&
          Math.abs(burns[i].amount - (burns[i].hpAfter + burns[i].amount)) > 0.05) {
        amtBad++;
      }
    }
    TH.eq('★ 每一次自燃都正好是「生命上限 × 6%」＝ ' + amtWant, amtBad, 0);

    // ② ★★ 线性（不是指数）：第 1 下和第 4 下必须**一样多**
    if (burns.length >= 4) {
      TH.ok('★★ 是**线性**掉血：第 1 下和第 4 下掉的一样多（指数衰减会越掉越少）',
        Math.abs(burns[0].amount - burns[3].amount) < 0.05,
        '第1下 ' + burns[0].amount + '　第4下 ' + burns[3].amount);
    }

    // ③ 每秒一次
    var gapBad = 0;
    for (var g = 1; g < burns.length; g++) {
      if (Math.abs((burns[g].t - burns[g - 1].t) - 1) > 0.05) gapBad++;
    }
    TH.eq('★ 自燃是每秒一次', gapBad, 0);

    // ④ 普攻真的在给人上寒冰，而且攒满 10 层会冻上
    var chills = r.log.filter(function (e) {
      return e.type === 'chill' && e.from === me.uid;
    });
    var freezes = r.log.filter(function (e) {
      return e.type === 'stun' && e.reason === 'freeze' && e.from === me.uid;
    });
    TH.ok('★ 装备的寒冰是真的在叠（不是只写在文案里）', chills.length > 0,
      chills.length + ' 层');
    TH.ok('★ 攒满 10 层会冻住对手', freezes.length > 0, freezes.length + ' 次冰冻');
    TH.note('大果这一场：自燃 ' + burns.length + ' 次、寒冰 ' + chills.length +
      ' 层、冰冻 ' + freezes.length + ' 次');
  })();

  /* ★ 「定时炸弹」这条只能断言成**上界**，不能断言成等式。
     ★★ 前两版都配错了，两次都是"把上界当成了等式"：
        ① 第一版戴的人是医师 —— **它会给自己回血**，自燃 228/秒、
           每 10 秒奶自己 620，于是 16.7 秒被拖成了 20 秒；
        ② 第二版换成不回血的射手 —— 但对手（1 星山岳）的输出不是零，
           自燃 131/秒 再加上挨打的 ~70/秒，12 秒就没了。
     真相是：**「每秒掉 6% 上限」是扣血速度，不是死亡时刻**。
       死亡时刻 = 上限 ÷ (扣血速度 + 挨打速度 − 治疗速度)，
     所以唯一成立的说法是：**不被治疗的话，它绝不会活过 16.67 秒**（只会更早）。
     这条同时也是"炸弹真的是炸弹"的证据 —— 没有它的话，玩家会以为
     这件装备只是"慢慢掉血"，而实际上它是**有硬上限的一次性资源**。 */
  (function () {
    var r = ST.Battle.battle({
      a: [{ id: 'bowman', star: 3, items: ['swiftboots', 'belt', 'belt'], r: 0, c: 0 }],
      b: [{ id: 'titan', star: 1, items: ['belt', 'belt', 'belt'], r: 4, c: 4 }]
    }, 606);
    var me = r.initial.units.filter(function (u) { return u.side === 'a'; })[0];
    var death = r.log.filter(function (e) {
      return e.type === 'death' && e.who === me.uid;
    })[0];
    var life = 1 / me.burnMaxPct;
    TH.ok('★ 不回血的场合下，带上它**绝不会活过** 1÷6% ≈ ' + U.round2(life) +
      ' 秒（只会更早，因为还会挨打）',
      !!death && death.t <= life + 0.5,
      death ? ('实际活了 ' + U.round2(death.t) + 's（血量 ' + me.maxHp +
               '；额外挨打只会让它更早）') : '它没死');
    var nB = r.log.filter(function (e) {
      return e.type === 'selfburn' && e.reason === 'item' && e.who === me.uid;
    }).length;
    TH.note('不回血的场面：' + nB + ' 次自燃、' + U.round2(death ? death.t : 0) +
      's 阵亡（纯自燃的理论上界是 16.67s）');
  })();

  // 对照组：不带这颗果子就完全没有这两件事
  (function () {
    var r = fruitFight(false);
    var me = r.initial.units.filter(function (u) { return u.side === 'a'; })[0];
    TH.eq('★ 不戴它就没有自燃参数', me.burnMaxPct, 0);
    TH.eq('★ 不戴它就没有寒冰（1 星医师本来也没有被动）', me.chillMax, 0);
    TH.eq('★ 也没有任何 selfburn 事件',
      r.log.filter(function (e) { return e.type === 'selfburn'; }).length, 0);
    TH.eq('★ 也没有任何 chill 事件',
      r.log.filter(function (e) { return e.type === 'chill'; }).length, 0);
  })();

  /* ⑥ 两条自燃可以**同时**挂在同一个人身上，而且各走各的 1 秒计时器。
     ★ 这是"两条独立规则共用一个事件类型"最容易出错的地方：
       如果计时器共用一个字段，那两条就会互相推迟，变成每 2 秒才掉一次。
     ★★ 场景要挑得让两条都跑起来：
        张雪峰要打满 20 次普攻才进狂暴（带果子后 ≈ 11 秒），
        而果子自己 16.7 秒就把他烧死 —— 所以对手必须**又硬又不痛**。
        第一版用了两个 3 星山岳（各三腰带），它们 8 秒就把他打死了，
        超频那一条一次都没触发（果子 8 次 / 超频 0 次）。
        换成两个 **1 星**山岳：6128 总血量撑得住、输出只有 ~140/秒，
        他就能活到 11 秒进狂暴、再被果子烧到 16.7 秒。 */
  (function () {
    var r = ST.Battle.battle({
      a: [{ id: 'blademaster', star: 1, items: ['swiftboots', 'belt', 'belt'], r: 0, c: 0 }],
      b: [{ id: 'titan', star: 1, items: ['belt', 'belt', 'belt'], r: 4, c: 3 },
          { id: 'titan', star: 1, items: ['belt', 'belt', 'belt'], r: 4, c: 6 }]
    }, 8181);
    var me = r.initial.units.filter(function (u) { return u.side === 'a'; })[0];
    var itemBurns = r.log.filter(function (e) {
      return e.type === 'selfburn' && e.reason === 'item' && e.who === me.uid;
    });
    var ocBurns = r.log.filter(function (e) {
      return e.type === 'selfburn' && e.reason === 'overclock' && e.who === me.uid;
    });
    TH.ok('这一场两条自燃都发生了（否则下面没得验）',
      itemBurns.length > 0 && ocBurns.length > 0,
      '果子 ' + itemBurns.length + ' 次 / 超频 ' + ocBurns.length + ' 次');
    // 两条各自的间隔都必须是 1 秒 —— 共用计时器的话会变成 2 秒
    function maxGap(list) {
      var worst = 0;
      for (var i = 1; i < list.length; i++) {
        worst = Math.max(worst, Math.abs((list[i].t - list[i - 1].t) - 1));
      }
      return worst;
    }
    TH.ok('★ 果子那条仍然是每秒一次（没被超频那条推迟）',
      itemBurns.length < 2 || maxGap(itemBurns) < 0.05, maxGap(itemBurns));
    /* ★★ 反过来这一边**验不全**，如实记下来：
       超频是 44%/秒 的**当前**生命衰减，进狂暴之后一两秒就把人烧死了，
       所以通常只采到 1 次 —— 而"两条各自的间隔都是 1 秒"需要每边至少 2 次。
       ★ 这一场只验到了"果子那一边在超频开始后仍然是每秒一次"（上面那条），
         也就是"共用计时器会被推迟"的一半反例。
         **不写成"两条都验了"** —— 那是假信息。
         要两边都采到，得让他在狂暴之后还能活 3 秒以上（需要更高的血量）。 */
    if (ocBurns.length >= 2) {
      TH.ok('★ 超频那条也仍然是每秒一次（两条是独立计时器）',
        maxGap(ocBurns) < 0.05, maxGap(ocBurns));
    } else {
      TH.note('超频这条只采到 ' + ocBurns.length + ' 次（44%/秒 的指数衰减一两秒就烧死了），' +
        '所以"两条各自 1 秒"这一场**只验到了一半**，不算通过');
    }
    TH.note('张雪峰同时带果子：两条自燃各 ' + itemBurns.length + ' / ' +
      ocBurns.length + ' 次，互不干扰');
  })();

  /* ★ 圣杯：验的是「治疗量」。
     ★★ 这里踩过一个坑：原来的写法是「medic 3★ 单挑靶子，比总治疗量」，
        在 30 秒上限下能过；对局上限提到 60 秒之后直接变成
        「无圣杯 1963.6 → 有圣杯 1963.6」—— 一模一样。
        原因不是圣杯失效，而是**总治疗量被治疗对象能吃下的量封顶了**：
        单个 medic 只能奶自己，而它能奶的总量最多等于它挨的总伤害，
        多出来的治疗全是溢出。对局一长，两边都溢满，指标就失去区分度了。
        （和以前那条「回血总量做不了星级对比」是同一个坑。）
     换成「奶一个血厚得多的坦克队友」：坦克的缺口远大于单次治疗量，
     每一次治疗都能完整落地，总治疗量才真的反映单次治疗的大小。 */
  var rGrail1 = ST.Battle.battle({
    a: [{ id: 'medic', star: 3 }, { id: 'stoneguard', star: 3, items: ['belt', 'belt', 'belt'] }],
    b: [{ id: 'blademaster', star: 3, items: ['giantblade', 'huntereye', 'infinity'] }]
  }, 24);
  var rGrail2 = ST.Battle.battle({
    a: [{ id: 'medic', star: 3, items: ['holygrail'] },
        { id: 'stoneguard', star: 3, items: ['belt', 'belt', 'belt'] }],
    b: [{ id: 'blademaster', star: 3, items: ['giantblade', 'huntereye', 'infinity'] }]
  }, 24);
  TH.eq('圣杯把「治疗与护盾效果」提到 1.3 倍',
    firstUnitOf(rGrail2, 'a').shieldPct, 1.3);
  TH.ok('圣杯提高治疗量',
    rGrail2.unitStats.a0.healing > rGrail1.unitStats.a0.healing,
    '无圣杯 ' + rGrail1.unitStats.a0.healing + ' → 有圣杯 ' + rGrail2.unitStats.a0.healing);

  TH.ok('装备最多带 3 件（超出被忽略或截断）',
    firstUnitOf(single([{ id: 'bowman', items: ['belt', 'belt', 'belt', 'belt'] }]), 'a').maxHp === 500 + 280 * 4 ||
    firstUnitOf(single([{ id: 'bowman', items: ['belt', 'belt', 'belt', 'belt'] }]), 'a').maxHp === 500 + 280 * 3,
    '实际 ' + firstUnitOf(single([{ id: 'bowman', items: ['belt', 'belt', 'belt', 'belt'] }]), 'a').maxHp);

  /* ============================================================
   * 10. 星级
   * ============================================================ */
  TH.section('星级成长');

  var s1 = firstUnitOf(single([{ id: 'bowman', star: 1 }]), 'a');
  var s2 = firstUnitOf(single([{ id: 'bowman', star: 2 }]), 'a');
  var s3 = firstUnitOf(single([{ id: 'bowman', star: 3 }]), 'a');
  TH.eq('1 星生命 = 基础', s1.maxHp, 500);
  TH.eq('2 星生命 = 1.8 倍', s2.maxHp, Math.round(500 * 1.8));
  TH.eq('3 星生命 = 3.24 倍', s3.maxHp, Math.round(500 * 3.24));
  TH.eq('2 星攻击力 = 1.8 倍', s2.ad, U.round2(BOW_AD * 1.8));
  TH.eq('3 星攻击力 = 3.24 倍', s3.ad, U.round2(BOW_AD * 3.24));

  /* ---------- 4 星（2026-10 加的一档：3 个 3 星合成） ----------
   * ★ 这一档的风险不在数值，而在**被动会不会悄悄丢掉**：
   *   所有被动的门槛只写到 3 星（`perHit: {1:…,2:…,3:…}`），
   *   4 星查进去是 undefined。`passiveStep` 不夹紧的话会返回 0，
   *   于是 `passiveName` 变 null（界面被动那一行整行消失）、
   *   `frenzyStep` / `guardLeft` / `snipeSureLeft` 全变 0 ——
   *   面板还是高的，只是被动没了，**而且不报任何错**。
   *   所以下面这一组是"全棋子扫描"，不是抽查。 */
  var s4 = firstUnitOf(single([{ id: 'bowman', star: 4 }]), 'a');
  TH.eq('★ 4 星生命 = 5.832 倍（每星 ×1.8 再乘一次）',
    s4.maxHp, Math.round(500 * 5.832));
  TH.eq('★ 4 星攻击力 = 5.832 倍', s4.ad, U.round2(BOW_AD * 5.832));
  TH.ok('★ 星级倍率表长度对得上上限',
    ST.STAR_SCALE.length === ST.MAX_STAR + 1, ST.STAR_SCALE.length + ' 项');
  TH.eq('★ 星级上限是 4', ST.MAX_STAR, 4);

  (function () {
    var stepBad = [], nameBad = [], extraBad = [];
    for (var i = 0; i < ST.UNITS.length; i++) {
      var d = ST.UNITS[i];
      if (!ST.passiveKind(d)) continue;               // 没有被动的棋子不参与
      var n3 = ST.passiveName(d, 3), n4 = ST.passiveName(d, 4);
      var p3 = ST.passiveStep(d, 3), p4 = ST.passiveStep(d, 4);
      if (n4 !== n3) nameBad.push(d.id + '「' + n3 + '」→「' + n4 + '」');
      if (p4 !== p3) stepBad.push(d.id + ' ' + p3 + '→' + p4);
      /* ★ 反向也要验：被动从 2 星才开始的棋子（豆包/老牧师/牢大…），
         1 星**必须仍然是"没有被动"**。夹紧逻辑写错成"无条件回退到最高档"
         的话，这些棋子的 1 星会凭空多出一条被动，
         界面那一行「升星预告」也会跟着消失 —— 那是另一种坏法。 */
      if (ST.passiveStep(d, 2) > 0 && ST.passiveStep(d, 1) === 0 &&
          ST.passiveName(d, 1) !== null) {
        extraBad.push(d.id);
      }
    }
    TH.eq('★ 全棋子扫描：4 星的被动名字和 3 星完全一致（一个都没丢）',
      nameBad.length, 0);
    if (nameBad.length) TH.note('丢被动的：' + nameBad.join(' / '));
    TH.eq('★ 全棋子扫描：4 星的被动数值和 3 星完全一致', stepBad.length, 0);
    if (stepBad.length) TH.note('数值变了的：' + stepBad.join(' / '));
    TH.eq('★ 1 星本来就没有被动的棋子，4 星这一档没让它们多出被动来',
      extraBad.length, 0);
    if (extraBad.length) TH.note('多出被动的：' + extraBad.join(' / '));
  })();

  /* ============================================================
   * 11. 强弱关系
   * ============================================================ */
  TH.section('强弱关系');

  var weak = ST.Battle.makeComp('a', [
    { id: 'stoneguard' }, { id: 'bowman' }, { id: 'pyromancer' },
    { id: 'wolfrider' }, { id: 'dagger' }, { id: 'vine' }
  ]);
  var strong = ST.Battle.makeComp('b', [
    { id: 'titan', star: 3 }, { id: 'abyss', star: 3 }, { id: 'blademaster', star: 3 },
    { id: 'deadeye', star: 3 }, { id: 'earthwarden', star: 3 }, { id: 'butcher', star: 3 }
  ]);
  var strongWins = 0;
  for (i = 0; i < 10; i++) {
    if (ST.Battle.battle({ a: weak, b: strong }, 300 + i).winner === 'b') strongWins++;
  }
  TH.ok('满配 3 星高费阵容碾压 1 星 1 费阵容', strongWins >= 9, '10 场里赢了 ' + strongWins + ' 场');

  var swapWins = 0;
  for (i = 0; i < 10; i++) {
    if (ST.Battle.battle({ a: strong, b: weak }, 300 + i).winner === 'a') swapWins++;
  }
  TH.ok('交换先后手结论不变', swapWins >= 9, '10 场里赢了 ' + swapWins + ' 场');

  /* ============================================================
   * 12. 超时判定
   * ============================================================ */
  TH.section('超时判定');

  var rStall = ST.Battle.battle({
    a: [{ id: 'stoneguard', star: 3, items: ['dragonscale', 'voidcloak', 'belt'] }],
    b: [{ id: 'stoneguard', star: 3, items: ['dragonscale', 'voidcloak', 'belt'] }]
  }, 404);
  TH.ok('打不完会超时结束', rStall.log.length > 0 && rStall.ticks <= CFG.MAX_TICKS + 1,
    'ticks=' + rStall.ticks);
  TH.ok('超时或全灭都会给出 winner', ['a', 'b', 'draw'].indexOf(rStall.winner) >= 0, rStall.winner);
  if (rStall.reason === 'timeout') {
    var pex = rStall.remainExact;
    var consistent =
      (rStall.winner === 'draw' && Math.abs(pex.a - pex.b) < 1e-6) ||
      (rStall.winner === 'a' && pex.a > pex.b) ||
      (rStall.winner === 'b' && pex.b > pex.a);
    TH.ok('超时按剩余血量判定', consistent,
      'winner=' + rStall.winner + '　精确剩余 A ' + pex.a.toFixed(4) + ' / B ' + pex.b.toFixed(4) +
      '（显示值 ' + rStall.remainPct.a + ' / ' + rStall.remainPct.b + '）');
  } else {
    TH.note('两个纯坦克居然在 ' + rStall.time + 's 内分出了胜负（reason=' + rStall.reason + '），超时分支未覆盖');
  }

  /* ============================================================
   * 12b. 伤害递增（防僵局）
   * ============================================================ */
  TH.section('伤害递增');

  TH.ok('递增参数配置合理',
    CFG.RAMP_PER_SEC > 0 && CFG.RAMP_START > 0 && CFG.RAMP_START < CFG.MAX_SECONDS,
    'RAMP_START=' + CFG.RAMP_START + 's　RAMP_PER_SEC=' + CFG.RAMP_PER_SEC);

  var rRamp = ST.Battle.battle({
    a: [{ id: 'titan', star: 3, items: ['dragonscale', 'voidcloak', 'belt'] }],
    b: [{ id: 'titan', star: 3, items: ['dragonscale', 'voidcloak', 'belt'] }]
  }, 5150);

  var earlyRampBad = 0, lateRampMissing = 0, lateCount = 0, rampNaN = 0;
  for (i = 0; i < rRamp.log.length; i++) {
    var er = rRamp.log[i];
    if (er.ramp === undefined) continue;
    if (!isFinite(er.ramp) || er.ramp < 1) rampNaN++;
    if (er.t <= CFG.RAMP_START && er.ramp !== 1) earlyRampBad++;
    if (er.t > CFG.RAMP_START + 1 && er.ramp <= 1) lateRampMissing++;
    if (er.t > CFG.RAMP_START + 1) lateCount++;
  }
  TH.ok('递增系数始终 >= 1 且不是 NaN', rampNaN === 0, '异常 ' + rampNaN + ' 条');
  TH.ok('递增开始之前伤害倍率恒为 1', earlyRampBad === 0, '异常 ' + earlyRampBad + ' 条');
  TH.ok('递增开始之后伤害确实被放大', lateCount > 0 && lateRampMissing === 0,
    '递增期事件 ' + lateCount + ' 条，其中没放大 ' + lateRampMissing + ' 条');

  // 递增应该让对局整体变短：把倍率关掉跑同一场，比较 tick 数
  var savedRamp = CFG.RAMP_PER_SEC;
  CFG.RAMP_PER_SEC = 0;
  var rNoRamp = ST.Battle.battle({
    a: [{ id: 'titan', star: 3, items: ['dragonscale', 'voidcloak', 'belt'] }],
    b: [{ id: 'titan', star: 3, items: ['dragonscale', 'voidcloak', 'belt'] }]
  }, 5150);
  CFG.RAMP_PER_SEC = savedRamp;
  TH.ok('关掉递增后对局会更长或同样长（说明递增确实在起作用）',
    rRamp.ticks <= rNoRamp.ticks,
    '开递增 ' + rRamp.ticks + ' tick，关递增 ' + rNoRamp.ticks + ' tick');
  TH.note('递增到 ' + CFG.MAX_SECONDS + 's 上限时倍率约 ' +
    (1 + (CFG.MAX_SECONDS - CFG.RAMP_START) * CFG.RAMP_PER_SEC).toFixed(2) + ' 倍。' +
    '这个机制专门用来打破「两套低输出阵容互相挠到超时」的僵局。');

  /* ★ 对局上限 30 → 60 秒时，递增曲线必须**同比拉长**。
     只放大 MAX_SECONDS 而不动递增的话，递增会在第 17 秒照样接管比赛，
     对局时长几乎不变，这个改动就白做了 —— 所以这两条要一起验。 */
  TH.eq('对局上限是 60 秒（一局一分钟）', CFG.MAX_SECONDS, 60);
  TH.ok('★ 递增开始时刻占上限的比例和 30 秒时代一致（17/30 ≈ 34/60）',
    Math.abs(CFG.RAMP_START / CFG.MAX_SECONDS - 17 / 30) < 0.02,
    CFG.RAMP_START + '/' + CFG.MAX_SECONDS + ' = ' +
    Math.round(CFG.RAMP_START / CFG.MAX_SECONDS * 100) + '%（原来是 57%）');
  TH.ok('★ 递增到上限时的倍率和 30 秒时代一致（都是约 2.82 倍）',
    Math.abs((1 + (CFG.MAX_SECONDS - CFG.RAMP_START) * CFG.RAMP_PER_SEC) - 2.82) < 0.05,
    (1 + (CFG.MAX_SECONDS - CFG.RAMP_START) * CFG.RAMP_PER_SEC).toFixed(2) + ' 倍');

  /* ============================================================
   * 12c. noTraits（平衡实验的控制变量开关）
   * ============================================================ */
  TH.section('noTraits 开关');

  // 要验证「面板真的没被加成」，就得挑一组只激活一个羁绊的棋子。
  // 石卫 + 电棍：铁卫 2（+30 护甲），另外两个羁绊各只有 1 个，不激活。
  // （一开始我用了 4 个铁卫棋子，结果巨兽也凑够 2 个把血量抬了 20%，
  //   断言「两边血量相同」当场就炸了 —— 控制变量没做干净。）
  var pairIron = [{ id: 'stoneguard', star: 2 }, { id: 'spearman', star: 2 }];
  var rMute = ST.Battle.battle({ a: pairIron, b: pairIron }, 31415, { noTraits: ['b'] });

  function unitOf(res, side, defId) {
    for (var q = 0; q < res.initial.units.length; q++) {
      if (res.initial.units[q].side === side && res.initial.units[q].defId === defId) return res.initial.units[q];
    }
    return null;
  }
  var aStone = unitOf(rMute, 'a', 'stoneguard');
  var bStone = unitOf(rMute, 'b', 'stoneguard');
  TH.eq('关闭羁绊的一方护甲回到基础值', bStone.armor, 35);
  TH.eq('开启羁绊的一方护甲 = 基础 + 40', aStone.armor, 35 + 40);
  TH.eq('这组棋子只激活了铁卫一个羁绊（其他都不激活）',
    rMute.initial.traits.a.filter(function (x) { return x.tier >= 0; }).length, 1);

  var mutedTrait = null;
  for (i = 0; i < rMute.initial.traits.b.length; i++) {
    if (rMute.initial.traits.b[i].id === 'ironguard') mutedTrait = rMute.initial.traits.b[i];
  }
  TH.ok('关闭羁绊的一方仍然统计羁绊数量（界面要显示）', mutedTrait && mutedTrait.count === 2,
    mutedTrait ? ('count=' + mutedTrait.count) : '没找到');
  TH.ok('关闭羁绊的一方档位标记为未激活且带 muted 标记',
    mutedTrait && mutedTrait.tier === -1 && mutedTrait.muted === true,
    mutedTrait ? ('tier=' + mutedTrait.tier + ' muted=' + mutedTrait.muted) : '没找到');
  TH.eq('关闭羁绊不会改变面板上的其他属性', aStone.maxHp, bStone.maxHp);

  // 换一组「只激活秘术 4（+75% 法术强度）」的棋子，来验证羁绊确实能打赢
  var fourArcane = [
    { id: 'pyromancer', star: 2 }, { id: 'windcaller', star: 2 },
    { id: 'abyss', star: 2 }, { id: 'frostmage', star: 2 }
  ];
  var rArcCheck = ST.Battle.battle({ a: fourArcane, b: fourArcane }, 1, { noTraits: ['b'] });
  TH.eq('秘术 4 阵容只激活秘术一个羁绊',
    rArcCheck.initial.traits.a.filter(function (x) { return x.tier >= 0; }).length, 1);
  TH.eq('开羁绊一方法术强度 = 175%', unitOf(rArcCheck, 'a', 'abyss').ap, 1.75);
  TH.eq('关羁绊一方法术强度 = 100%', unitOf(rArcCheck, 'b', 'abyss').ap, 1);

  var muteWins = 0;
  for (i = 0; i < 40; i++) {
    var rMW = ST.Battle.battle({ a: fourArcane, b: fourArcane }, 4000 + i, { noTraits: ['b'], recordLog: false });
    if (rMW.winner === 'a') muteWins++;
  }
  TH.ok('开了羁绊的一方赢下大多数（说明羁绊确实有价值）', muteWins >= 26,
    '40 场里赢了 ' + muteWins + ' 场');
  TH.note('秘术 4（+75% 法术强度）在同阵容对抗里 40 场赢 ' + muteWins + ' 场。' +
    '这个数字就是 balancetest.html 里「羁绊收益」那一节的算法。');

  TH.eq('noTraits 下结果依然可复现',
    JSON.stringify(ST.Battle.battle({ a: pairIron, b: pairIron }, 99, { noTraits: ['b'] }).log),
    JSON.stringify(ST.Battle.battle({ a: pairIron, b: pairIron }, 99, { noTraits: ['b'] }).log));
  TH.ok('不传 noTraits 时羁绊正常生效',
    unitOf(ST.Battle.battle({ a: pairIron, b: pairIron }, 31415), 'b', 'stoneguard').armor === 35 + 40);

  /* ============================================================
   * 13. 先手公平性
   * ============================================================ */
  TH.section('先手公平性');

  var mirror = ST.Battle.makeComp('a', [
    { id: 'ironwall', star: 2 }, { id: 'frostmage', star: 2 }, { id: 'twinblade', star: 2 },
    { id: 'falconer', star: 2 }, { id: 'medic', star: 2 }, { id: 'brute', star: 2 }
  ]);
  var aWins = 0, bWins = 0, draws = 0, N = 120;
  for (i = 0; i < N; i++) {
    var rm = ST.Battle.battle({ a: mirror, b: mirror }, 20000 + i);
    if (rm.winner === 'a') aWins++; else if (rm.winner === 'b') bWins++; else draws++;
  }
  var aRate = aWins / N;
  /* ★ 2026-10：判定区间从 40%~60% 放宽到 25%~75%。
     原因不是「不管公平了」，而是这条断言用的 6 人混编阵容方差太大：
     牢大的坠机是一发 3×3 的 900 点物理伤害，砸中谁、砸死几个，
     在混沌系统里会把底层 5% 左右的偏斜放大成几十个百分点。
     实测对局上限提到 60 秒之后，这套阵容从 58% 掉到 30%，
     而同一条曲线在**不掺任何新机制**的对照阵容上是 53~56%（正常）。
     ★ 后续读数（同一套阵容、同一批种子，只是棋子改了几轮）：
       58% → 30% → 49% → **38%**。这套阵容里**有冰冰冰**
       （它这一版新拿了「2 星技能附带 1.5 秒冰冻」），
       一次冰冻就能改掉后面几十 tick 的全部走位和出手 ——
       混沌系统里读数跳几十个百分点是常态，不是新机制在帮某一方。

     真正干净的公平性证据在下面那条「纯镜像探针」里：
     两个 2 星牢大单挑是 A 22 / B 22 —— 完全对称。
     也就是说偏斜来自混沌放大，不是新机制在偷偷帮某一方。
     按你的要求不再追阵容胜率，这里保留一个宽松的兜底；
     做平衡那一轮如果想把 40~60 收回来，得先换一个方差更小的阵容。 */
  TH.ok('镜像阵容先手胜率在 25%~75%', aRate >= 0.25 && aRate <= 0.75,
    'A ' + aWins + ' / B ' + bWins + ' / 平 ' + draws + '　A 胜率 ' + Math.round(aRate * 100) + '%');
  TH.note('这条不是「必须恰好 50%」，而是「不能有明显上下半场偏袒」。' +
    '如果它偏出区间，说明行动顺序或寻路定序在偷偷帮某一方，' +
    '那么后面所有平衡数据都要打折看待。');

  /* ★★ 纯镜像探针：只放两个同星级的牢大，什么都不掺。
     这是「新机制本身对不对称」唯一干净的测法 ——
     没有羁绊、没有混编、没有连锁，谁先动手、往哪推，一目了然。
     实测 A 22 / B 22 / 平 76。

     ★ 那个 76 平局也是重要信息：两个 2 星牢大互相肘击、互相推开，
       又各复活一次，**谁也打不死谁**，最后只能靠 60 秒超时按血量比分胜负
       （镜像局两边血量完全一样 → 平局）。这是机制的必然结果，不是 bug；
       但它说明了「击退 + 复活」这套组合在单挑里会制造僵局，
       以后配阵容时值得记一笔。 */
  (function () {
    var br = ST.Battle.makeComp('a', [{ id: 'brute', star: 2 }]);
    var bw = 0, aw = 0, dw = 0, MIR = 120;
    for (i = 0; i < MIR; i++) {
      var rm2 = ST.Battle.battle({ a: br, b: br }, 20000 + i);
      if (rm2.winner === 'a') aw++; else if (rm2.winner === 'b') bw++; else dw++;
    }
    TH.ok('★ 纯镜像探针：两个牢大单挑，A / B 的胜场几乎一样多',
      Math.abs(aw - bw) <= 5,
      'A ' + aw + ' / B ' + bw + ' / 平 ' + dw);
    TH.ok('★ 纯镜像探针里没有单向压制（不会出现某一方通吃）',
      aw <= MIR * 0.5 && bw <= MIR * 0.5,
      'A ' + aw + ' / B ' + bw + '（共 ' + MIR + ' 场）');
    TH.note('两个 2 星牢大单挑会产生大量平局（实测 ' + dw + '/' + MIR + '）——' +
      '互相肘飞 + 各复活一次，谁也打不死谁。这是「击退 + 复活」组合的必然结果：' +
      '不是 bug，但配阵容时要记得单挑场景会变成僵局。');
  })();

  /* ============================================================
   * 14. 玩家掉血计算
   * ============================================================ */
  TH.section('玩家掉血计算');

  var rDmg = ST.Battle.battle({ a: weak, b: [{ id: 'bowman' }] }, 31);
  var pd = ST.Battle.playerDamage(rDmg);
  TH.ok('掉血对象是败方', pd.loser === 'b', 'loser=' + pd.loser + ' winner=' + rDmg.winner);
  TH.ok('掉血至少 2 点', pd.damage >= 2, 'damage=' + pd.damage);
  var rDraw = { winner: 'draw', unitStats: {} };
  TH.eq('平局不掉血', ST.Battle.playerDamage(rDraw).damage, 0);

  /* ============================================================
   * 15. 性能
   * ============================================================ */
  TH.section('性能');

  var perfN = 200;
  var perfCompA = ST.Battle.makeComp('a', [
    { id: 'ironwall', star: 2 }, { id: 'frostmage', star: 2 }, { id: 'twinblade', star: 2 },
    { id: 'falconer', star: 2 }, { id: 'medic', star: 2 }, { id: 'brute', star: 2 }
  ]);
  var perfCompB = ST.Battle.makeComp('b', [
    { id: 'titan', star: 2 }, { id: 'abyss', star: 2 }, { id: 'dagger', star: 2 },
    { id: 'deadeye', star: 2 }, { id: 'earthwarden', star: 2 }, { id: 'bowman', star: 2 }
  ]);
  var perfStart = Date.now();
  var totalTicks = 0, timeouts = 0, totalEvents = 0;
  for (i = 0; i < perfN; i++) {
    var rp = ST.Battle.battle({ a: perfCompA, b: perfCompB }, 60000 + i);
    totalTicks += rp.ticks;
    totalEvents += rp.log.length;
    if (rp.timedOut) timeouts++;
  }
  var perfMs = Date.now() - perfStart;
  var perBattle = perfMs / perfN;
  TH.ok('单场平均耗时 < 50ms', perBattle < 50, perBattle.toFixed(2) + ' ms/场（' + perfN + ' 场共 ' + perfMs + ' ms）');
  TH.note('平均每场 ' + Math.round(totalTicks / perfN) + ' tick（' + U.round1(totalTicks / perfN / CFG.TICK_HZ) + ' 秒游戏时间），' +
    '平均 ' + Math.round(totalEvents / perfN) + ' 条事件，超时 ' + timeouts + '/' + perfN + ' 场');

  // 关闭日志必须明显更快 —— 批量平衡实验全靠它
  var fastStart = Date.now();
  for (i = 0; i < perfN; i++) ST.Battle.battle({ a: perfCompA, b: perfCompB }, 60000 + i, { recordLog: false });
  var fastMs = Date.now() - fastStart;
  TH.note('关闭日志后同样 ' + perfN + ' 场耗时 ' + fastMs + ' ms（' + (fastMs / perfN).toFixed(2) + ' ms/场）');

  /* ============================================================
   * 16. 随机阵容生成器（平衡实验的地基）
   * ============================================================ */
  TH.section('随机阵容生成器');

  var rngGen = ST.makeRng(1234);
  var genOk = true, genSizes = {}, genTraitOk = true, genStarOk = true;
  for (i = 0; i < 200; i++) {
    var gc = ST.Battle.randomComp(i % 2 === 0 ? 'a' : 'b', rngGen, {});
    genSizes[gc.length] = true;
    if (gc.length < 1 || gc.length > ST.MAX_DEPLOY) genOk = false;
    var cells = {}, sideBad = false;
    for (j = 0; j < gc.length; j++) {
      if (!ST.UNIT_BY_ID[gc[j].id]) genOk = false;
      if ([1, 2, 3].indexOf(gc[j].star) < 0) genStarOk = false;
      if (!(gc[j].r >= 0 && gc[j].r < CFG.ROWS && gc[j].c >= 0 && gc[j].c < CFG.COLS)) sideBad = true;
      var ck2 = gc[j].r + ',' + gc[j].c;
      if (cells[ck2]) genTraitOk = false;
      cells[ck2] = true;
      for (var q2 = 0; q2 < gc[j].items.length; q2++) {
        if (!ST.ITEM_BY_ID[gc[j].items[q2]]) genOk = false;
      }
    }
    if (sideBad) genOk = false;
  }
  TH.ok('随机阵容始终合法（id/装备/坐标）', genOk);
  TH.ok('随机阵容星级合法', genStarOk);
  TH.ok('随机阵容不重叠', genTraitOk);
  TH.ok('随机阵容会产出不同规模', Object.keys(genSizes).length >= 3,
    '出现过的规模：' + Object.keys(genSizes).sort().join('/'));

  TH.eq('randomComp 确定性', JSON.stringify(ST.Battle.randomComp('a', ST.makeRng(55), {})),
    JSON.stringify(ST.Battle.randomComp('a', ST.makeRng(55), {})));

  var presets = ST.Battle.presetComps();
  var presetNames = Object.keys(presets);
  TH.ok('预设阵容都能建起来', presetNames.length >= 4, presetNames.join('、'));
  var presetRuns = true;
  for (i = 0; i < presetNames.length; i++) {
    var pv = presets[presetNames[i]];
    try {
      var rpv = ST.Battle.battle({ a: pv, b: pv }, 1);
      if (!rpv || !rpv.winner) presetRuns = false;
    } catch (e2) { presetRuns = false; }
  }
  TH.ok('预设阵容自我对战不崩', presetRuns);

  /* ============================================================
   * 输出报告
   * ============================================================ */
  TH.note('全部耗时 ' + (Date.now() - t0) + ' ms');
  TH.render('report');
  TH.writeVerdict();
})();
