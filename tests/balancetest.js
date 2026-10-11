/* ============================================================
 * 科币战争 — 平衡实验室
 *
 * 这个页面的意义：把「平衡」从手感玄学变成可以看的数据。
 * 别人做自走棋最容易死在「凭感觉调数值」，而这里跑一次就有：
 *   · 每个棋子的面板与性价比
 *   · 1v1 擂台胜率榜（谁是数值怪，谁是废物）
 *   · 每件装备、每个羁绊的实测收益
 *   · 对局时长分布与先手偏斜
 *
 * 所有结论都基于 battle.js 的确定性模拟：换台机器、换个时间，
 * 同样的种子必然跑出同样的数字。
 * ============================================================ */
(function () {
  'use strict';

  var ST = window.ST;
  var TH = window.TH;
  var U = ST.U;

  var t0 = Date.now();

  /* ============================================================
   * 小工具
   * ============================================================ */
  function el(id) { return document.getElementById(id); }

  function table(containerId, headers, rows, opts) {
    opts = opts || {};
    var host = el(containerId);
    if (!host) return;
    var html = '<table><thead><tr>';
    for (var i = 0; i < headers.length; i++) html += '<th>' + headers[i] + '</th>';
    html += '</tr></thead><tbody>';
    for (var r = 0; r < rows.length; r++) {
      html += '<tr>';
      for (var c = 0; c < rows[r].length; c++) {
        var cell = rows[r][c];
        var cls = '';
        if (cell && typeof cell === 'object') { cls = cell.cls || ''; cell = cell.text; }
        html += '<td' + (cls ? (' class="' + cls + '"') : '') + '>' + cell + '</td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    host.innerHTML = html;
  }

  function pct(v) { return (v * 100).toFixed(1) + '%'; }
  function signed(v) { return (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%'; }

  function bar(v, scale) {
    var w = Math.max(1, Math.min(100, Math.round(v / (scale || 1) * 100)));
    return '<span class="bar" style="width:' + w + 'px"></span>';
  }

  /** 跑 n 个种子的对局，返回 A 方胜率（平局算半分） */
  function winRate(compA, compB, seeds, opts) {
    var a = 0, b = 0, d = 0, ticks = 0, timeouts = 0;
    // 把 noTraits / statScale 这类实验开关原样透传给模拟器 ——
    // 漏传过一次 statScale，结果让子实验全程在「不让子」上跑，8 个羁绊全报 100%。
    var battleOpts = { recordLog: false };
    if (opts) {
      if (opts.noTraits) battleOpts.noTraits = opts.noTraits;
      if (opts.statScale) battleOpts.statScale = opts.statScale;
    }
    for (var i = 0; i < seeds; i++) {
      var r = ST.Battle.battle({ a: compA, b: compB }, 70000 + i * 131, battleOpts);
      if (r.winner === 'a') a++; else if (r.winner === 'b') b++; else d++;
      ticks += r.ticks;
      if (r.timedOut) timeouts++;
    }
    return {
      a: a, b: b, d: d, n: seeds,
      rate: (a + d * 0.5) / seeds,
      avgTicks: ticks / seeds,
      timeouts: timeouts
    };
  }

  /* ============================================================
   * A. 属性总览
   * ============================================================ */
  TH.section('属性总览');

  var statRows = [];
  var EMPTY = {};
  for (var i = 0; i < ST.UNITS.length; i++) {
    var u = ST.UNITS[i];
    for (var star = 1; star <= 3; star++) {
      var s = ST.resolveStats(u, star, [], EMPTY);
      statRows.push({
        u: u, star: star, s: s,
        dps: ST.rawDps(u, star, [], EMPTY),
        ehp: ST.rawEhp(u, star, [], EMPTY)
      });
    }
  }

  table('tbl-stats',
    ['棋子', '费', '羁绊', '星', '生命', '攻击', '攻速', '护甲', '魔抗', '射程', '技能', 'DPS', '有效生命'],
    statRows.map(function (r) {
      return [
        r.u.emoji + ' ' + r.u.name,
        r.u.cost,
        r.u.traits.map(function (t) { return ST.TRAIT_BY_ID[t].name; }).join('/'),
        r.star + '★',
        U.fmt(r.s.maxHp), U.fmt(r.s.ad), r.s.as.toFixed(2),
        r.s.armor, r.s.mr, r.s.range,
        r.u.skill.name,
        r.dps, U.fmt(r.ehp)
      ];
    }));

  TH.note('棋子 ' + ST.UNITS.length + ' 个，星级面板共 ' + statRows.length + ' 行');

  /* ============================================================
   * B. 费用性价比
   *
   * 先说清楚一个容易搞反的事：自走棋里「每金币的数值」本来就是低费更高
   * （云顶也是这样：1 费 550 血/金，5 费只有 220 血/金）。
   * 高费的价值不在每金性价比，而在于「同样一个上场格子，它更强」，
   * 以及技能效果差距。所以你真正要盯的不是每金效率，
   * 而是「同一个费用档里，谁明显超模、谁明显偏弱」。
   * ============================================================ */
  TH.section('费用性价比');

  var EMPTY = {};
  // 费用档数从数据里取，别写死 —— 加一个费用档这里就得跟着改，很容易忘
  var TIERS = [];
  for (var cz = 1; cz <= ST.COST_TIERS; cz++) TIERS.push(cz);
  var tierAgg = {};
  for (i = 0; i < TIERS.length; i++) tierAgg[TIERS[i]] = { dps: 0, ehp: 0, n: 0 };
  for (i = 0; i < ST.UNITS.length; i++) {
    var u0 = ST.UNITS[i];
    tierAgg[u0.cost].dps += ST.rawDps(u0, 1, [], EMPTY);
    tierAgg[u0.cost].ehp += ST.rawEhp(u0, 1, [], EMPTY);
    tierAgg[u0.cost].n++;
  }
  for (var tk in tierAgg) { tierAgg[tk].dps /= tierAgg[tk].n; tierAgg[tk].ehp /= tierAgg[tk].n; }

  var effRows = [];
  for (i = 0; i < ST.UNITS.length; i++) {
    var uu = ST.UNITS[i];
    var a1 = tierAgg[uu.cost];
    var d1r = ST.rawDps(uu, 1, [], EMPTY) / a1.dps;
    var e1r = ST.rawEhp(uu, 1, [], EMPTY) / a1.ehp;
    var d2r = ST.rawDps(uu, 2, [], EMPTY) / (a1.dps * 1.8);
    var e2r = ST.rawEhp(uu, 2, [], EMPTY) / (a1.ehp * 1.8);
    effRows.push({
      u: uu,
      dps1: ST.rawDps(uu, 1, [], EMPTY), ehp1: ST.rawEhp(uu, 1, [], EMPTY),
      dpsPerGold: ST.rawDps(uu, 1, [], EMPTY) / uu.cost,
      ehpPerGold: ST.rawEhp(uu, 1, [], EMPTY) / uu.cost,
      // 同费档内的相对强度：攻和肉各占一半，坦克不会因为「攻低」被误判
      score1: (d1r + e1r) / 2,
      score2: (d2r + e2r) / 2
    });
  }
  effRows.sort(function (a, b) { return b.score1 - a.score1; });

  table('tbl-efficiency',
    ['棋子', '费', '1★ DPS', '1★ 有效生命', 'DPS/金', '有效生命/金',
     '同费强度 1★', '同费强度 2★', '判定'],
    effRows.map(function (r) {
      var cls = r.score1 > 1.2 ? 'neg' : (r.score1 < 0.8 ? 'pos' : '');
      var verdict = r.score1 > 1.2 ? '偏强' : (r.score1 < 0.8 ? '偏弱' : '正常');
      return [
        r.u.emoji + ' ' + r.u.name, r.u.cost,
        r.dps1, U.fmt(r.ehp1),
        r.dpsPerGold.toFixed(1), U.fmt(Math.round(r.ehpPerGold)),
        r.score1.toFixed(2) + '×', r.score2.toFixed(2) + '×',
        { text: verdict, cls: cls }
      ];
    }));

  TH.note('「同费强度」= (DPS ÷ 同费平均 DPS + 有效生命 ÷ 同费平均有效生命) ÷ 2。' +
    '1.00 就是这个费用档的平均水平。攻击高但脆的刺客和肉但没输出的坦克都会落在 1.0 附近，' +
    '所以这个指标能把「真的偏强」和「只是定位不同」区分开。');
  TH.note('注意「DPS/金」列会随费用递减，这是正常的、也是刻意的：' +
    '低费卡每金币更划算，高费卡的卖点是「同样一个上场格子更强」。');

  var overTuned = effRows.filter(function (r) { return r.score1 > 1.25; });
  var underTuned = effRows.filter(function (r) { return r.score1 < 0.78; });
  TH.note('⚠ 同费明显偏强（>1.25×）：' + (overTuned.length ? overTuned.map(function (r) { return r.u.name + ' ' + r.score1.toFixed(2) + '×'; }).join('、') : '无'));
  TH.note('⚠ 同费明显偏弱（<0.78×）：' + (underTuned.length ? underTuned.map(function (r) { return r.u.name + ' ' + r.score1.toFixed(2) + '×'; }).join('、') : '无'));

  /* ============================================================
   * C. 1v1 擂台赛
   *
   * 分两张榜，因为它们的用途完全不同：
   *   总榜   —— 同一星级下高费吊打低费，这是应该的。榜单主要用来确认
   *             「费用曲线没写反」，不是用来判断单个卡强不强的。
   *   同费榜 —— 这才是真正的平衡信号：同一个费用档里谁超模、谁没用。
   * ============================================================ */
  TH.section('1v1 擂台赛');

  var DUEL_SEEDS = 5;
  var duel = {};
  for (i = 0; i < ST.UNITS.length; i++) {
    duel[ST.UNITS[i].id] = { w: 0, l: 0, d: 0, name: ST.UNITS[i].name, u: ST.UNITS[i] };
  }

  var duelCount = 0;
  for (i = 0; i < ST.UNITS.length; i++) {
    for (var j = i + 1; j < ST.UNITS.length; j++) {
      var uA = ST.UNITS[i], uB = ST.UNITS[j];
      var cA = ST.Battle.makeComp('a', [{ id: uA.id, star: 1 }]);
      var cB = ST.Battle.makeComp('b', [{ id: uB.id, star: 1 }]);
      for (var k = 0; k < DUEL_SEEDS; k++) {
        var rD = ST.Battle.battle({ a: cA, b: cB }, 80000 + duelCount * 17 + k, { recordLog: false });
        duelCount++;
        if (rD.winner === 'a') { duel[uA.id].w++; duel[uB.id].l++; }
        else if (rD.winner === 'b') { duel[uB.id].w++; duel[uA.id].l++; }
        else { duel[uA.id].d++; duel[uB.id].d++; }
      }
    }
  }

  var duelRows = [];
  for (var did in duel) {
    var e = duel[did];
    var total = e.w + e.l + e.d;
    duelRows.push({ id: did, e: e, total: total, rate: total ? (e.w + e.d * 0.5) / total : 0 });
  }
  duelRows.sort(function (a, b) { return b.rate - a.rate; });

  table('tbl-duel',
    ['排名', '棋子', '费', '定位', '胜', '负', '平', '胜率', ''],
    duelRows.map(function (r, idx) {
      return [
        idx + 1,
        r.e.u.emoji + ' ' + r.e.name,
        r.e.u.cost, r.e.u.role,
        r.e.w, r.e.l, r.e.d,
        { text: pct(r.rate) },
        bar(r.rate, 1)
      ];
    }));

  // 同费榜：只在同一个费用档内部排名，这才是能指导改数值的信号
  var sameCost = {};
  for (i = 0; i < TIERS.length; i++) sameCost[TIERS[i]] = [];
  for (i = 0; i < duelRows.length; i++) sameCost[duelRows[i].e.u.cost].push(duelRows[i]);

  var sameCostExtremes = [];
  var scRows = [];
  for (var ci2 = 0; ci2 < TIERS.length; ci2++) {
    var costK = TIERS[ci2];
    var group = sameCost[costK].slice().sort(function (a, b) { return b.rate - a.rate; });
    for (var g = 0; g < group.length; g++) {
      var gr = group[g];
      var cls = gr.rate >= 0.72 ? 'neg' : (gr.rate <= 0.28 ? 'pos' : '');
      scRows.push([
        costK + ' 费', (g + 1) + '/' + group.length,
        gr.e.u.emoji + ' ' + gr.e.name, gr.e.u.role,
        { text: pct(gr.rate), cls: cls },
        bar(gr.rate, 1)
      ]);
    }
    if (group.length >= 3) {
      sameCostExtremes.push({ cost: costK, top: group[0], bottom: group[group.length - 1] });
    }
  }
  table('tbl-duel-same-cost', ['费用档', '档内排名', '棋子', '定位', '档内胜率', ''], scRows);

  TH.note('1v1 擂台共 ' + duelCount + ' 场（每对打 ' + DUEL_SEEDS + ' 个种子）。');
  TH.note('总榜第一是 ' + duelRows[0].e.name + '（' + duelRows[0].e.u.cost + ' 费，' + pct(duelRows[0].rate) + '），' +
    '最后是 ' + duelRows[duelRows.length - 1].e.name + '（' + duelRows[duelRows.length - 1].e.u.cost + ' 费，' +
    pct(duelRows[duelRows.length - 1].rate) + '）。同星级下高费碾压低费是正常的，' +
    '所以判断单个卡强弱请看「档内胜率」，别看总榜。');
  TH.note('1v1 只反映单卡数值，忽略了站位、羁绊协同和技能配合。' +
    '它的用途是「找出明显超模或明显废的卡」，不是给最终强度下结论。');

  for (i = 0; i < sameCostExtremes.length; i++) {
    var ext = sameCostExtremes[i];
    TH.note('⚠ ' + ext.cost + ' 费档内：最强 ' + ext.top.e.name + ' ' + pct(ext.top.rate) +
      '，最弱 ' + ext.bottom.e.name + ' ' + pct(ext.bottom.rate));
  }
  var scBad = [];
  // 只检查「至少 3 个棋子」的费用档 —— 只有 2 个棋子的档位必然是一胜一负，
  // 那是数学必然，不是失衡信号。
  for (i = 0; i < scRows.length; i++) {
    var grpSize = parseInt(String(scRows[i][1]).split('/')[1], 10);
    if (!(grpSize >= 3)) continue;
    var rowRate = parseFloat(scRows[i][4].text) / 100;
    if (rowRate >= 0.95 || rowRate <= 0.05) scBad.push(scRows[i][2] + ' ' + scRows[i][4].text);
  }
  TH.note('⚠ 档内极端值（>=95% 或 <=5%）：' + (scBad.length ? scBad.join('、') : '无'));
  TH.note('⚠ 但要注意 1v1 有个固有偏见：靠「范围 / 地形 / 辅助」吃饭的技能' +
    '（楚生疑犯的阴暗领域、血月屠夫的范围伤害、战地医师的治疗）' +
    '在单挑里被浪费掉了，它们在这张榜上天然偏低，不代表在真实对局里弱。' +
    '像「某个辅助档内垫底」这种结论，要用阵容级实验（下面的预设阵容对战）去复核。');
  TH.ok('档内榜能排出名次（不是所有人打平）',
    sameCostExtremes.length >= 2, '有效费用档 ' + sameCostExtremes.length + ' 个');

  /* ============================================================
   * D. 装备收益
   *
   * 除了主 C 身上那一件装备，两边阵容完全一样。
   * 因为装备不影响羁绊，A/B 的羁绊配置在基准组和实验组之间是相同的，
   * 所以胜率差值就是这一件装备的净贡献。
   *
   * 三个主 C 分别代表三种收益路径：物理输出、法术输出、治疗护盾。
   * 只测物理 C 的话，「圣杯」会被误判成废装备 —— 它本来就只对治疗护盾有用。
   * ============================================================ */
  TH.section('装备收益');

  var ITEM_SEEDS = 40;
  var CARRIES = [
    { id: 'falconer', label: '猎鹰手', kind: '物理/攻速' },
    { id: 'abyss', label: '深渊祭司', kind: '法术/技能' },
    { id: 'earthwarden', label: '大地守护', kind: '治疗/护盾' }
  ];

  function itemComp(side, carryId, itemId) {
    return ST.Battle.makeComp(side, [
      { id: carryId, star: 2, items: itemId ? [itemId] : [] },
      { id: 'ironwall', star: 2 }, { id: 'twinblade', star: 2 },
      { id: 'deadeye', star: 2 }, { id: 'medic', star: 2 }, { id: 'butcher', star: 2 }
    ]);
  }

  /**
   * ★ 装备强弱要用**对位循环赛**来排，不能用让子标定。
   *
   * 两条弯路都走过了，记在这里免得再走：
   *
   * 1. 直接比胜率：两组镜像阵容、只给一边多一件装备 → 那一边必然 100% 赢。
   *    所有装备的胜率差都是同样的 50 个百分点，疾风之靴和蓝水晶看不出区别。
   *
   * 2. 让子标定（在羁绊那边很好用）：给带装备的一方逐级加让子找打平点。
   *    实测在**这个 6 人高协同阵容上根本行不通** —— 面板只要差 6%，
   *    胜率就直接从 100% 掉到 0%（无装备的纯镜像，缩到 0.94 也是 0%）。
   *    断崖比任何一件装备的价值都窄，于是所有装备都被算成「超出量程」。
   *
   * 所以改成让**两件不同的装备直接对打**：一组只带装备 i、另一组只带装备 j，
   * 其余完全一样。基线是真正的 50%，而「谁赢」这件事是有分辨力的 ——
   * 每件装备的得分 = 它对上所有其它装备的平均胜率。
   */
  function itemScore(carryId, itemIndex, pairs) {
    var win = 0, n = 0;
    for (var p = 0; p < pairs.length; p++) {
      var pair = pairs[p];
      if (pair[0] !== itemIndex && pair[1] !== itemIndex) continue;
      var iAmA = pair[0] === itemIndex;
      var mine = iAmA ? pair[0] : pair[1];
      var theirs = iAmA ? pair[1] : pair[0];
      var rr = winRate(
        itemComp('a', carryId, ST.ITEMS[mine].id),
        itemComp('b', carryId, ST.ITEMS[theirs].id),
        ITEM_SEEDS
      );
      // 我是 A 就用 A 的胜率，我是 B 就用 B 的
      win += iAmA ? rr.rate : (1 - rr.rate);
      n++;
    }
    return n ? win / n : 0.5;
  }

  // 全部无序对：12 件装备 → 66 组
  var itemPairs = [];
  for (i = 0; i < ST.ITEMS.length; i++) {
    for (var j2 = i + 1; j2 < ST.ITEMS.length; j2++) itemPairs.push([i, j2]);
  }

  var itemRows = [];
  var itemWeak = [];
  for (i = 0; i < ST.ITEMS.length; i++) {
    var item = ST.ITEMS[i];
    var scores = [];
    for (var ci = 0; ci < CARRIES.length; ci++) {
      scores.push(itemScore(CARRIES[ci].id, i, itemPairs));
    }
    var best = Math.max.apply(null, scores);
    if (best <= 0.50) itemWeak.push(item.name);   // 低于五五开才算真的废
    itemRows.push({ item: item, scores: scores, best: best });
  }
  itemRows.sort(function (a, b) { return b.best - a.best; });

  function scoreCell(v) {
    return {
      text: pct(v),
      cls: v >= 0.62 ? 'neg' : (v <= 0.40 ? 'pos' : '')
    };
  }

  table('tbl-items',
    ['装备', '效果'].concat(CARRIES.map(function (c) { return '给' + c.label + '（' + c.kind + '）'; })).concat(['最好的一路', '']),
    itemRows.map(function (r) {
      return [
        r.item.emoji + ' ' + r.item.name,
        r.item.desc
      ].concat(r.scores.map(scoreCell)).concat([
        scoreCell(r.best),
        bar(Math.max(0, r.best - 0.5), 0.5)
      ]);
    }));

  TH.note('怎么读：每件装备和**其它每一件**装备都打一轮（两边阵容完全一样，' +
    '只有主 C 身上那一件装备不同），格子里的百分比是它的平均对位胜率。' +
    '50% = 一件普通装备；明显高于 60% = 太强，会变成「必抢」；低于 40% = 没人愿意选。');
  TH.note('为什么用对位循环赛而不是让子标定：这个战斗系统对面板差极其敏感 ——' +
    '实测两组纯镜像阵容，只要把一边整体缩到 94%，胜率就直接从 100% 掉到 0%。' +
    '断崖比任何一件装备的价值都窄，让子标定在这里没有分辨力；' +
    '而「两件不同装备对打谁赢」是真的有分辨力的。' +
    '（羁绊那边用的是 4 人小阵容，断崖宽得多，所以让子标定在那边很好用。）');
  TH.note('⚠ 装备对位排名：' + itemRows.map(function (r) {
    return r.item.name + ' ' + pct(r.best);
  }).join('　'));
  TH.note('⚠ 参考区间：平均对位胜率 40% ~ 60% 算健康。' +
    '同一件装备给不同主 C 的收益本来就该不一样（秘法之书给物理主 C 当然没用），' +
    '所以看「最好的一路」—— 一件装备如果在三路都赢不过别人，它才是真的废。');

  // 「每件装备都必须 >= 50%」这个判据本身不成立：循环赛是零和的，必然有一件垫底。
  // 真正该守的是「垫底那件不能差太远」和「整体强弱差距别太离谱」。
  var worstItem = itemRows[itemRows.length - 1];
  var itemSpread = itemRows[0].best - worstItem.best;
  TH.ok('没有一件装备在各路都明显偏弱（最低的对位胜率 >= 40%）',
    worstItem.best >= 0.40, '最弱的是 ' + worstItem.item.name + ' = ' + pct(worstItem.best));
  TH.ok('装备强弱差距不至于让选择失去意义（跨度 < 30%）',
    itemSpread < 0.30, '最强 ' + pct(itemRows[0].best) + ' − 最弱 ' + pct(worstItem.best) +
    ' = ' + pct(itemSpread));
  TH.ok('存在明显强势的装备（否则装备系统没有取舍）',
    itemRows[0].best > 0.55, itemRows[0].item.name + ' 对位胜率 ' + pct(itemRows[0].best));
  TH.ok('没有一件装备强到无脑必抢（对位胜率 < 85%）',
    itemRows[0].best < 0.85, '最强的 ' + itemRows[0].item.name + ' = ' + pct(itemRows[0].best));
  /* ★ 这句注解以前是写死的（专门说荆棘之甲「只有挨物理打才有价值」）——
     结果讲话石改成范围反弹之后垫底的换了装备，那句注解就成了假信息。
     现在只报事实，不替某一件装备下结论。 */
  TH.note('垫底的是 ' + worstItem.item.name + '（' + pct(worstItem.best) + '）。' +
    '垫底不等于该加强：先看它的收益面是不是本身就窄' +
    '（比如只在特定伤害类型下才生效），再决定改数值还是改机制。');

  /* ============================================================
   * E. 羁绊收益（让子标定）
   *
   * 先说一个必须绕开的陷阱：**镜像对局里任何优势都会变成必胜**。
   * 第一版我直接拿「同一套棋子，一边开羁绊一边关」比胜率，结果 8 个羁绊
   * 全是 100% —— 数字很整齐，但完全没有分辨力，分不出 +20% 生命和
   * +75% 法术强度的差别。
   *
   * 正确做法是「让子标定」：给没羁绊的一方逐级加全属性，
   * 找到双方打平的那个点。于是每个羁绊都能换算成一句人话：
   *   「铁卫 4 档 ≈ 白送对面 +35% 全属性」
   * ============================================================ */
  TH.section('羁绊收益');

  var GRID = [1.00, 1.05, 1.10, 1.15, 1.20, 1.30, 1.40, 1.55, 1.75, 2.00];
  var TRAIT_SEEDS = 40;

  function traitComp(members, side) {
    return ST.Battle.makeComp(side, members.map(function (x) { return { id: x.id, star: 2 }; }));
  }

  /** 返回 A 方（开羁绊）对「加了 handicap 全属性的 B 方」的胜率 */
  function handicapRate(members, handicap) {
    var a = traitComp(members, 'a');
    var b = traitComp(members, 'b');
    var opts = { recordLog: false, noTraits: ['b'] };
    if (handicap > 1) opts.statScale = { b: handicap };
    return winRate(a, b, TRAIT_SEEDS, opts).rate;
  }

  var traitRows = [];
  for (i = 0; i < ST.TRAITS.length; i++) {
    var tr = ST.TRAITS[i];
    var members = ST.UNITS.filter(function (x) { return x.traits.indexOf(tr.id) >= 0; });
    // 取最强的 4 个（费用高的优先，同费保持表内顺序，保证确定性）
    members = members.slice().sort(function (a, b) {
      if (a.cost !== b.cost) return b.cost - a.cost;
      return ST.UNITS.indexOf(a) - ST.UNITS.indexOf(b);
    }).slice(0, 4);

    // 逐级让子，找到胜率跌破 50% 的那一档，线性插值出等效值
    var rates = [];
    for (var g = 0; g < GRID.length; g++) rates.push(handicapRate(members, GRID[g]));

    var equiv = GRID[GRID.length - 1];   // 一直赢到最后就记上限
    for (var g2 = 1; g2 < GRID.length; g2++) {
      if (rates[g2] <= 0.5) {
        var lo = GRID[g2 - 1], hi = GRID[g2];
        var rlo = rates[g2 - 1], rhi = rates[g2];
        var f = (rlo - 0.5) / Math.max(1e-6, (rlo - rhi));
        equiv = lo + f * (hi - lo);
        break;
      }
    }

    var act = ST.resolveTraits(members).active.filter(function (a) { return a.tier >= 0; });
    var bonusText = act.length && act[0].mods
      ? Object.keys(act[0].mods).map(function (kk) {
          var vv = act[0].mods[kk];
          return kk + ' ' + (Math.abs(vv) < 1 ? ('+' + Math.round(vv * 100) + '%') : ('+' + vv));
        }).join('、')
      : '—';

    traitRows.push({
      trait: tr, members: members, equiv: equiv - 1, rawRate: rates[0],
      rates: rates, tierText: act.length ? (act[0].tier + 1) + ' 档（' + act[0].count + ' 个）' : '未激活',
      bonusText: bonusText
    });
  }
  traitRows.sort(function (a, b) { return b.equiv - a.equiv; });

  // 让子曲线：把每个羁绊的胜率随让子下降的过程画成一行数字
  var curveHeaders = ['羁绊', '激活档位'].concat(GRID.map(function (x) { return '让' + Math.round((x - 1) * 100) + '%'; }));
  table('tbl-trait-curve', curveHeaders,
    traitRows.map(function (r) {
      return [r.trait.emoji + ' ' + r.trait.name, r.tierText].concat(r.rates.map(function (x) {
        return { text: Math.round(x * 100) + '%', cls: x > 0.75 ? 'neg' : (x < 0.35 ? 'pos' : '') };
      }));
    }));

  table('tbl-traits',
    ['羁绊', '测试阵容（2★）', '激活档位', '这一档给全队的加成', '等效全属性优势', '不递减时胜率', ''],
    traitRows.map(function (r) {
      var cls = r.equiv >= 0.5 ? 'neg' : (r.equiv <= 0.12 ? 'pos' : '');
      return [
        r.trait.emoji + ' ' + r.trait.name,
        r.members.map(function (x) { return x.name; }).join('、'),
        r.tierText,
        r.bonusText,
        { text: '+' + Math.round(r.equiv * 100) + '%', cls: cls },
        pct(r.rawRate),
        bar(r.equiv, 0.8)
      ];
    }));

  TH.note('怎么读这张表：给「没羁绊的一方」逐级加全属性，直到双方打平。' +
    '打平所需的让子幅度，就是这个羁绊的等效价值。' +
    '例：+35% 的意思是「铁卫 4 档 ≈ 白送整个阵容 +35% 全属性」。');
  TH.note('为什么不直接比胜率：镜像对局里任何系统性优势都会放大成 100% 胜率，' +
    '8 个羁绊会得到 8 个一模一样的 100%，完全分不出强弱。' +
    '「不递减时胜率」那一列就是原始胜率，你可以看到它确实没什么分辨力。');
  TH.note('⚠ 等效优势排名：' + traitRows.map(function (r) {
    return r.trait.name + ' +' + Math.round(r.equiv * 100) + '%';
  }).join('　'));
  TH.note('⚠ 参考区间：一档羁绊换算成 +15% ~ +40% 全属性比较健康。' +
    '低于 10% 说明这个羁绊不值得为它牺牲单卡质量；高于 50% 说明凑齐它就赢了一半，' +
    '其他阵容没得玩。');

  TH.ok('每个羁绊都能组出 4 个棋子来测', traitRows.length === ST.TRAITS.length,
    traitRows.length + '/' + ST.TRAITS.length);
  TH.ok('没有羁绊的等效价值失控（都低于 +100% 全属性）',
    traitRows[0].equiv < 1.0,
    traitRows[0].trait.name + ' +' + Math.round(traitRows[0].equiv * 100) + '%');

  /* ============================================================
   * F. 随机对局统计
   * ============================================================ */
  TH.section('随机对局统计');

  var BULK = 400;
  var rngB = ST.makeRng(20260101);
  var durations = [];
  var timeoutCount = 0, aWinsBulk = 0, bWinsBulk = 0, drawsBulk = 0;
  var bulkStart = Date.now();

  for (i = 0; i < BULK; i++) {
    var cA2 = ST.Battle.randomComp('a', rngB, {});
    var cB2 = ST.Battle.randomComp('b', rngB, {});
    var rB2 = ST.Battle.battle({ a: cA2, b: cB2 }, 500000 + i * 977, { recordLog: false });
    durations.push(rB2.time);
    if (rB2.timedOut) timeoutCount++;
    if (rB2.winner === 'a') aWinsBulk++; else if (rB2.winner === 'b') bWinsBulk++; else drawsBulk++;
  }
  var bulkMs = Date.now() - bulkStart;

  durations.sort(function (x, y) { return x - y; });
  function quantile(q) { return durations[Math.min(durations.length - 1, Math.floor(q * durations.length))]; }

  var avgDur = 0;
  for (i = 0; i < durations.length; i++) avgDur += durations[i];
  avgDur /= durations.length;

  var rateA = (aWinsBulk + drawsBulk * 0.5) / BULK;
  TH.ok('随机阵容下先手偏斜在 40%~60%', rateA >= 0.40 && rateA <= 0.60,
    'A ' + aWinsBulk + ' / B ' + bWinsBulk + ' / 平 ' + drawsBulk + '　A 胜率 ' + pct(rateA));
  /* ★ 2026-10：阈值从 15% 放宽到 20%。
     原因是「坠机 / 复活」—— 牢大阵亡后要先等 1 秒直升机落地、还可能站起来再打一轮，
     对局天然变长（实测 15.8%）。这一条守的是「不要有大量僵局」，
     20% 依然能守住这个意思；等做平衡那一轮再决定要不要收回来。 */
  TH.ok('超时率低于 20%', timeoutCount / BULK < 0.20,
    timeoutCount + '/' + BULK + ' 场超时（' + pct(timeoutCount / BULK) + '）');
  TH.ok('平均对局时长在 8~28 秒之间', avgDur >= 8 && avgDur <= 28, avgDur.toFixed(1) + ' 秒');
  TH.ok('批量模拟够快（400 场 < 3 秒）', bulkMs < 3000, bulkMs + ' ms / ' + BULK + ' 场');

  var histRows = [];
  for (var bucket = 0; bucket < 30; bucket += 3) {
    var lo = bucket, hi = bucket + 3;
    var n = 0;
    for (i = 0; i < durations.length; i++) if (durations[i] >= lo && durations[i] < hi) n++;
    histRows.push([lo + '~' + hi + 's', n, pct(n / durations.length), bar(n / durations.length, 0.35)]);
  }
  table('tbl-duration', ['时长区间', '场次', '占比', ''], histRows);

  TH.note('时长分布：最短 ' + durations[0].toFixed(1) + 's　25% ' + quantile(0.25).toFixed(1) +
    's　中位 ' + quantile(0.5).toFixed(1) + 's　75% ' + quantile(0.75).toFixed(1) +
    's　最长 ' + durations[durations.length - 1].toFixed(1) + 's');
  TH.note('设计目标是「一场 15~25 秒」。如果大量场次堆在 ' + ST.BATTLE_CFG.MAX_SECONDS +
    's 上限附近，说明输出太低、或者 MAX_SECONDS 该调大；如果都挤在 5 秒以内，说明爆发太高、' +
    '技能根本没机会放第二次。改的旋钮在 js/units.js（血量/攻击）和 js/battle.js 的 CFG。');
  TH.note('批量模拟性能：' + BULK + ' 场耗时 ' + bulkMs + ' ms（' + (bulkMs / BULK).toFixed(2) + ' ms/场）。' +
    '这个数字决定了你能多频繁地重跑整套平衡实验。');

  /* ============================================================
   * G. 阵容样本对战
   * ============================================================ */
  TH.section('预设阵容对战');

  var presets = ST.Battle.presetComps();
  var pNames = Object.keys(presets);
  var matrixRows = [];
  var presetRates = {};
  for (i = 0; i < pNames.length; i++) presetRates[pNames[i]] = { w: 0, n: 0 };

  for (i = 0; i < pNames.length; i++) {
    var row = [pNames[i]];
    for (var j2 = 0; j2 < pNames.length; j2++) {
      if (i === j2) { row.push('—'); continue; }
      var rr = winRate(presets[pNames[i]], presets[pNames[j2]], 40);
      presetRates[pNames[i]].w += rr.a;
      presetRates[pNames[i]].n += rr.n;
      var cls3 = rr.rate >= 0.65 ? 'pos' : (rr.rate <= 0.35 ? 'neg' : '');
      row.push({ text: pct(rr.rate), cls: cls3 });
    }
    matrixRows.push(row);
  }
  table('tbl-presets', ['攻方 ＼ 守方'].concat(pNames), matrixRows);

  TH.note('行 = A 方（先手半场），列 = B 方。每格是 A 方的胜率，各 40 个种子。' +
    '对角线是同阵容自我对战，等于先手公平性的另一种检验。');

  var presetRows = pNames.map(function (n) {
    var p = presetRates[n];
    return [n, pct(p.w / p.n), bar(p.w / p.n, 1)];
  }).sort(function (a, b) { return parseFloat(b[1]) - parseFloat(a[1]); });
  table('tbl-preset-rank', ['阵容', '总胜率', ''], presetRows);

  var presetSpread = parseFloat(presetRows[0][1]) - parseFloat(presetRows[presetRows.length - 1][1]);
  TH.note('⚠ 预设阵容强弱跨度 ' + presetSpread.toFixed(1) + '%（最强 ' + presetRows[0][0] +
    '，最弱 ' + presetRows[presetRows.length - 1][0] + '）。' +
    '四套阵容的总星级都是 10★、各 2 件装备，所以这个跨度就是「体系强度差」。' +
    '理想区间是 10%~35%：太小说明体系选择没意义，太大说明有一套能无脑滚。');
  TH.ok('预设阵容之间确实有强弱差（不是所有人打平）', presetSpread > 3,
    '跨度 ' + presetSpread.toFixed(1) + '%');

  /* ============================================================
   * 收尾
   * ============================================================ */
  TH.section('总结');
  TH.note('全部耗时 ' + (Date.now() - t0) + ' ms');
  TH.note('这一页不是「测试有没有 bug」（那是 simtest.html 的活），' +
    '而是「把数值摊开看一眼」。调完 js/units.js 之后重跑这一页，' +
    '重点看三处：费用性价比有没有冒出 1.25× 以上的超模卡、1v1 胜率榜的极值、' +
    '以及时长分布有没有塌到两端。');

  TH.render('report');
  TH.writeVerdict();

  var el2 = el('verdict');
  if (el2) {
    var c = TH.counts();
    el2.className = 'verdict ' + (c.fail === 0 ? 'pass' : 'fail');
    el2.textContent = c.fail === 0
      ? ('数值体检通过 — ' + c.pass + ' 项检查')
      : ('有 ' + c.fail + ' 项数值预警 — 见下方报告');
  }
})();
