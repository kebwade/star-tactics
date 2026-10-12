/* ============================================================
 * 科币战争 — 战斗模拟器 ★★★ 整个项目最核心的文件 ★★★
 *
 * 设计铁律：
 *   1. 这个文件不碰 canvas、不碰 DOM、不读全局可变状态。它是纯的。
 *   2. 随机只来自 ST.makeRng(seed)，绝不使用 Math.random()。
 *   3. 输出是「初始快照 + 事件流」。渲染层只是把事件流播成动画。
 *
 * 因为遵守了这三条，你一次性得到：战斗回放、批量平衡测试、
 * 慢放/加速/跳过、以及未来做联机与观战的可能。
 *
 * 棋盘：6 列 × 8 行（上下各 4 行）。
 *   A 方占 0~3 行，第 3 行是前排；B 方占 4~7 行，第 4 行是前排。
 * ============================================================ */
(function () {
  'use strict';

  var ST = (window.ST = window.ST || {});
  var U = ST.U;

  /* ============================================================
   * 配置
   * ============================================================ */
  var CFG = {
    COLS: 8,                 // 棋盘宽 8 格（云顶是 7 格，我们做宽一点，站位空间更大）
    ROWS_PER_SIDE: 4,
    TICK_HZ: 30,             // 每秒 30 个 tick
    /* 超时判胜，防止死循环。
       ★ 2026-10：30 → **60 秒**（一局对战的时长上限翻倍）。
         配套把伤害递增也整体拉长了一倍，见下面 RAMP_START / RAMP_PER_SEC ——
         只放大 MAX_SECONDS 而不动递增的话，递增会在第 17 秒照样接管比赛，
         对局时长几乎不变，这个改动就白做了。 */
    MAX_SECONDS: 60,

    /* ---------- 走位节奏 ----------
     *
     * ★ 这两个常量是「开战时棋子必须站在我摆的位置上」的关键。
     *
     *   原来主循环每个 tick 都调一次 moveToward，而 tick 是 30 Hz ——
     *   也就是**每秒走 30 格**。8 行的棋盘 0.27 秒就穿过去了，
     *   玩家看到的是「一开战阵型就散成一团冲到中间」，根本看不清自己摆的阵。
     *
     *   OPENING_HOLD：开局这段时间内**只打不跑**。
     *     射程内有敌人就照常出手，没有也先站着 —— 给玩家一个
     *     「这就是我摆的阵」的定格。之后才各寻各的目标走过去。
     *   MOVE_INTERVAL：走一格要多久。0.3 秒一格 = 3.3 格/秒，
     *     穿过 4 行约 1.2 秒，肉眼跟得上，也不会让战斗拖成走位表演。
     */
    OPENING_HOLD: 0.5,
    MOVE_INTERVAL: 0.3,
    /* 换位防抖：刚和某人换过位，这段时间内不许再和他换回去。
       没有它就会两个人原地互相顶、谁也上不去（见 swapWithBlocker 的注释）。 */
    SWAP_LOCK: 1.0,

    /* 讲话石（原荆棘之甲）的反弹半径：切比雪夫距离 <= 1 就是 3×3 九宫格 */
    THORN_RADIUS: 1,
    /* 豆包「幻觉 / 开智」挂上的伤害改动的默认持续时间（秒）。
       棋子自己的 passive.seconds 可以覆盖它 —— 放在这里只是为了让
       「没写 seconds 的 healGift」有个明确的兜底值，而不是 undefined。 */
    GIFT_SECONDS: 4,
    /* 「眼睛喷金色激光」的蓄力时长（秒）。
       ★ 这不是纯粹的特效时长 —— 它是**规则**：荣誉在这段时间里站着不动、
         不出手，蓄满了才开枪，所以这一枪是被预告过的。
       特效层只是把这个窗口画出来，不要为了好看去改这个数。 */
    CHARGE_TIME: 0.5,
    /* 牢大阵亡之后，直升机落地之前的那 1 秒。
       这段时间里它**不参与胜负判定**（见 anyPending）—— 否则它会先被
       判定成全灭，坠机永远打不出来。 */
    CRASH_DELAY: 1.0,
    /* 坠机的伤害半径：切比雪夫距离 <= 1 就是 3×3 九宫格（和讲话石同一套定义） */
    CRASH_RADIUS: 1,
    MANA_PER_ATTACK: 10,     // 每次普攻获得法力
    MANA_PER_DAMAGE: 25,     // 每承受 25 点伤害获得 1 法力
    /* ★★ 同一个单位**两次施法之间的最短间隔**。
     *
     *   为什么需要它：这个引擎里"法力满就放"，而法力原本是**攒**出来的
     *   （一次普攻 +10，或者挨 25 点伤害 +1）—— 这个攒的过程本身就限制了出手频率。
     *   但 Dank1ng 的「空悲切 / 锁头」会**把法力瞬间顶满**（无限能量 / 击杀回满），
     *   于是那份天然的限速就没了：tryCast 每 tick 都被调用一次，
     *   法力永远满 → 一秒 30 发核弹。那不是设计意图，是缺少节流。
     *
     *   0.5 秒是照着"一次出手"的量级定的：比攻速(0.82 → 1.2 秒/次)快一点，
     *   所以"无限能量"确实是**实打实的提速**，但不会快成连发。
     *   对现有棋子没有任何影响 —— 它们的最快施法节奏都远慢于半秒：
     *   荣誉 3 次普攻 ≈ 3.7 秒、奶龙冷却 13 秒、其余法力型 6~9 次普攻。
     */
    CAST_LOCK: 0.5,
    BASE_CRIT: 0.15,         // 基础暴击率
    BASE_CRIT_MULT: 1.5,     // 基础暴击倍率
    /* ---------- 伤害递增（打破僵局） ----------
     *
     * 没有它的话，两套低输出阵容会一直互相挠到时间上限，
     * 最后靠「谁血多谁赢」草草收场 —— 实测随机阵容里有 20% 以上的对局
     * 是这样结束的，玩家体验很差。开了之后伤害随时间放大，僵局会被强行打破。
     *
     * ★ 2026-10：对局上限从 30 秒提到 60 秒，这两个数**同比拉长了一倍**：
     *     17 → 34 秒      （占上限的比例不变：17/30 = 34/60 ≈ 57%）
     *     0.14 → 0.07     （到上限时的倍率不变：1 + 26×0.07 = 2.82，和原来一样）
     *   也就是说整条曲线只是被**拉伸**，形状和"什么时候开始收网"的手感没变，
     *   变的是把这段过程摊在了两倍的时间里。
     *
     *   把 RAMP_PER_SEC 设成 0 就可以关掉它。 */
    RAMP_START: 34,          // 秒。之后所有伤害开始随时间递增
    RAMP_PER_SEC: 0.07,      // 每秒额外 7%，到 60 秒上限时约 2.82 倍
    RESIST_K: 100,           // 减伤系数：100/(100+抗性)
    SNAP_EVERY: 15           // 每多少个 tick 打一次状态快照（给渲染层对齐用）
  };
  CFG.ROWS = CFG.ROWS_PER_SIDE * 2;
  CFG.CELLS = CFG.ROWS * CFG.COLS;
  CFG.DT = 1 / CFG.TICK_HZ;
  CFG.MAX_TICKS = CFG.MAX_SECONDS * CFG.TICK_HZ;

  ST.BATTLE_CFG = CFG;
  ST.BOARD = {
    COLS: CFG.COLS,
    ROWS: CFG.ROWS,
    ROWS_PER_SIDE: CFG.ROWS_PER_SIDE,
    /**
     * 列分配顺序：从中间往两边。
     * 自动站位和界面「找第一个空格子」都用这一份，避免两边各写一份、
     * 改了棋盘宽度之后有一边忘了改。
     */
    colOrder: function () { return colsCenterFirst(); }
  };

  function round3(v) { return Math.round(v * 1000) / 1000; }
  function reduce(resist) {
    if (resist <= 0) return 1;
    return CFG.RESIST_K / (CFG.RESIST_K + resist);
  }
  /* ============================================================
   * 星级被动
   *
   * 三个 kind，触发点各不相同：
   *   frenzy    自己打出普攻之后叠攻速（attackOnce → gainFrenzy）
   *   hurtHeal  自己受到伤害之后回血（afterDamage → gainHurtHeal）
   *   healGift  自己奶出有效治疗之后给被治疗者挂伤害改动（healUnit → giftAfterHeal）
   *
   * 做成「按 kind 分派」的小接口，加新种类只要再加一个 kind，
   * 不用动 buildSide。
   * ============================================================ */
  function passiveOf(def) {
    var pa = def && def.passive;
    return (pa && pa.kind) ? pa : null;
  }

  /**
   * 从一张"按星级索引"的表里取值：星级**超出表里写到的最高一档**时，按最高一档算。
   *
   * ★★ 4 星（2026-10 加的）让这条成为必须：`perHit` / `names` 都只写到 3 星，
   *    4 星查进去是 `undefined`。不夹紧的话有两处会静默出错：
   *      · `passiveStep` 返回 0 → `passiveName` 返回 null → **界面整行被动消失**，
   *        而且 `frenzyStep` / `guardLeft` / `snipeSureLeft` 一起变成 0；
   *      · `names` 查不到 → 名字退化成通用的「被动」，
   *        玩家看到的是光秃秃一个「被动」，数值全对但完全看不懂。
   *    两种都不报任何错，所以只能靠这条守卫 + 全棋子扫描的自检兜住。
   *
   * ★ 夹紧只对"**高于**最高一档"生效，**低于最低一档仍然返回 undefined** ——
   *   这一半同样重要：豆包 / 老牧师 / 牢大的表都是从 2 星开始写的，
   *   1 星本来就该"没有被动"。无条件回退到最高档的话，
   *   这些棋子的 1 星会凭空多出一条被动、界面那行「升星预告」也会消失。
   */
  function starLookup(map, star) {
    if (!map) return undefined;
    var v = map[star];
    if (v !== undefined && v !== null) return v;
    var maxK = 0, any = false;
    for (var kk in map) {
      var kn = parseInt(kk, 10);
      if (!isNaN(kn) && kn > maxK) { maxK = kn; any = true; }
    }
    if (any && star > maxK) return map[maxK];
    return undefined;
  }

  /** 这一星级每次触发给多少（frenzy 是攻速增量，hurtHeal 是回血比例）；没有就是 0 */
  function passiveStep(def, star) {
    var pa = passiveOf(def);
    if (!pa) return 0;
    var v = starLookup(pa.perHit, star);
    return (typeof v === 'number' && v > 0) ? v : 0;
  }

  /** 叠加总量上限（只有 frenzy 有；hurtHeal 不叠层，返回 0） */
  function passiveCap(def) {
    var pa = passiveOf(def);
    if (!pa || typeof pa.cap !== 'number' || !(pa.cap > 0)) return 0;
    return pa.cap;
  }

  /**
   * 这一星级下被动的名字（界面显示用）。
   * 1 星没有被动就返回 null —— 界面据此决定要不要画那一行。
   *
   * ★ names[star] 允许写成一个**数组**：牢大的 3 星是两个被动叠在一起
   *   （「孩子们我回来了」+「曼巴精神」），一个名字装不下。
   *   这里用 ' + ' 连起来，界面那边什么都不用改。
   */
  function passiveName(def, star) {
    var pa = passiveOf(def);
    if (!pa) return null;
    if (!passiveStep(def, star)) return null;
    // ★ names 也要走同一套"超出就按最高一档算"，不然 4 星会显示成光秃秃的「被动」
    var n = starLookup(pa.names, star);
    if (!n) return '被动';
    return (n instanceof Array) ? n.join(' + ') : n;
  }

  ST.passiveName = passiveName;
  ST.passiveStep = passiveStep;
  ST.passiveCap = passiveCap;
  /** 给界面看的「被动类型」，用来决定那一行文字怎么写 */
  ST.passiveKind = function (def) { var pa = passiveOf(def); return pa ? pa.kind : null; };

  /* ============================================================
   * 查询
   * ============================================================ */
  function inBounds(r, c) {
    return r >= 0 && r < CFG.ROWS && c >= 0 && c < CFG.COLS;
  }
  function sideOfRow(r) { return r < CFG.ROWS_PER_SIDE ? 'a' : 'b'; }
  /** 某一方的主场行，按「从前排到后排」排序 */
  function rowsFrontFirst(side) {
    var out = [];
    if (side === 'a') {
      for (var r = CFG.ROWS_PER_SIDE - 1; r >= 0; r--) out.push(r);
    } else {
      for (var r2 = CFG.ROWS_PER_SIDE; r2 < CFG.ROWS; r2++) out.push(r2);
    }
    return out;
  }
  /** 列优先顺序：先中间，再两侧 */
  function colsCenterFirst() {
    var out = [];
    var mid = (CFG.COLS - 1) / 2;
    var order = [];
    for (var c = 0; c < CFG.COLS; c++) order.push(c);
    order.sort(function (a, b) {
      var da = Math.abs(a - mid), db = Math.abs(b - mid);
      if (da !== db) return da - db;
      return a - b;
    });
    return order;
  }

  ST.Battle = {
    CFG: CFG,
    sideOfRow: sideOfRow,
    /**
     * 跑一场战斗。
     *
     * @param {Object} setup { a:[{id,star,items,r,c}], b:[...] }
     *   - id    棋子 id（ST.UNIT_BY_ID 的键）
     *   - star  1/2/3，默认 1
     *   - items 装备 id 数组，默认 []
     *   - r,c   格子坐标；不给就自动站位
     * @param {number|string} seed 种子。同一个种子 + 同一份 setup = 逐字节相同的结果
     * @param {Object} [opts]
     *   recordLog  默认 true。批量跑上万场时传 false，日志不生成，快很多
     *   noTraits   形如 ['b']，让指定一方「羁绊只统计、不给加成」。
     *              平衡实验的利器：同一套阵容打自己，唯一差别就是这个羁绊，
     *              胜率差就是羁绊的净价值，控制变量干净得没法再干净。
     *   statScale  形如 { b: 1.2 }，把某一方全队的生命/攻击/攻速/法强/抗性
     *              整体乘一个系数。这是「让子标定」用的：镜像对局里任何优势
     *              都会被放大成必胜，所以光看胜率分不出强弱；改成「给对面加多少
     *              属性才打平」，就能把一个羁绊换算成「等效 +X% 全属性」。
     *              只给平衡实验用，正常玩法不要碰。
     * @returns {Object} result
     */
    battle: function (setup, seed, opts) { return runBattle(setup, seed, opts); },
    /** 败方玩家应该掉多少血（留给外层经济循环用） */
    playerDamage: playerDamage,
    /** 把战斗结果变成一行中文摘要 */
    describe: describe,
    /** 自动站位 */
    autoPlace: autoPlace,
    /** 用紧凑写法造一份阵容并自动站位 */
    makeComp: makeComp,
    /** 随机生成一份合法阵容（平衡实验用） */
    randomComp: randomComp,
    /** 一份预设阵容（界面默认值用） */
    presetComps: presetComps
  };

  /* ============================================================
   * 阵容辅助
   * ============================================================ */

  /**
   * 把一份阵容摆到某一方的半场。
   *
   * @param {'a'|'b'} side
   * @param {Array} entries [{id, star?, items?, r?, c?}]
   *        给了合法且不冲突的 r/c 就用它，否则自动站位
   * @param {Object} [preOcc] 外部已占用的格子集合（键 "r,c"），可复用场地
   * @returns {Array} 补全了 r/c 的新数组（不修改入参）
   *
   * 站位规则：近战（range<=1）优先占前排，远程优先占后排；列从中间往两边。
   * 注意：只分配 r/c，绝不改变 entries 的顺序 —— 顺序决定 uid，
   * 而 uid 决定战斗内部的确定性，这一点不能含糊。
   */
  function placeOnSide(side, entries, preOcc) {
    var occ = preOcc || {};
    var rows = rowsFrontFirst(side);
    var cols = colsCenterFirst();
    var out = [];
    var i, j;

    for (i = 0; i < entries.length; i++) {
      var e = entries[i] || {};
      out.push({ id: e.id, star: e.star || 1, items: (e.items || []).slice(), r: null, c: null });
      if (typeof e.r === 'number' && typeof e.c === 'number' &&
          inBounds(e.r, e.c) && sideOfRow(e.r) === side && !occ[e.r + ',' + e.c]) {
        out[i].r = e.r;
        out[i].c = e.c;
        occ[e.r + ',' + e.c] = true;
      }
    }

    function take(frontFirst) {
      var rowSeq = frontFirst ? rows : rows.slice().reverse();
      for (var a = 0; a < rowSeq.length; a++) {
        for (var b = 0; b < cols.length; b++) {
          var key = rowSeq[a] + ',' + cols[b];
          if (!occ[key]) { occ[key] = true; return { r: rowSeq[a], c: cols[b] }; }
        }
      }
      return null;
    }

    // 近战先占前排，远程再占后排；同组内保持原索引顺序，保证确定性
    var order = [];
    for (i = 0; i < out.length; i++) order.push(i);
    order.sort(function (x, y) {
      var dx = ST.UNIT_BY_ID[out[x].id], dy = ST.UNIT_BY_ID[out[y].id];
      var fx = (dx && dx.range <= 1) ? 0 : 1;
      var fy = (dy && dy.range <= 1) ? 0 : 1;
      if (fx !== fy) return fx - fy;
      return x - y;
    });

    for (j = 0; j < order.length; j++) {
      var idx = order[j];
      if (out[idx].r !== null) continue;
      var def = ST.UNIT_BY_ID[out[idx].id];
      var cell = take(def && def.range <= 1);
      if (!cell) cell = take(true);
      if (!cell) cell = { r: rows[0], c: 0 };   // 场地满了，理论上到不了
      out[idx].r = cell.r;
      out[idx].c = cell.c;
    }
    return out;
  }

  function autoPlace(side, list, preOcc) { return placeOnSide(side, list, preOcc); }

  function makeComp(side, list, needPlace) {
    var withMeta = list.map(function (x) {
      return { id: x.id, star: x.star || 1, items: (x.items || []).slice() };
    });
    if (needPlace === false) return withMeta;
    return autoPlace(side, withMeta);
  }

  /**
   * 随机生成一份合法阵容。用于批量平衡实验、以及无尽模式的随机出怪。
   * opts: { size, maxCost, star3, star2, itemChance }
   *
   * star3 / star2 是「星级偏置」：随机数小于 star3 就是 3 星，小于 star2 就是
   * 2 星。默认 0.18 / 0.62 是常规局的手感；无尽模式会随着波次把它们调高，
   * 于是敌人的星级自己往上走 —— 不需要为每一波手写阵容。
   */
  function randomComp(side, rng, opts) {
    opts = opts || {};
    var size = opts.size || rng.int(3, ST.MAX_DEPLOY);
    var maxCost = opts.maxCost || 3;
    var star3 = opts.star3 === undefined ? 0.18 : opts.star3;
    var star2 = opts.star2 === undefined ? 0.62 : opts.star2;
    var pool = ST.UNITS.filter(function (u) { return u.cost <= maxCost; });

    // 先随机挑一个主羁绊，再围绕它组队 —— 比纯随机更能产出「像样的阵容」
    var pickTrait = rng.chance(0.85);
    var anchorTrait = null;
    if (pickTrait) {
      var t = rng.pick(ST.TRAITS);
      anchorTrait = t.id;
    }

    var chosen = [];
    var used = {};
    var guard = 0;
    while (chosen.length < size && guard++ < 400) {
      var cand;
      if (anchorTrait && rng.chance(0.55)) {
        var tagged = pool.filter(function (u) {
          return !used[u.id] && u.traits.indexOf(anchorTrait) >= 0;
        });
        if (tagged.length) cand = rng.pick(tagged);
      }
      if (!cand) {
        var rest = pool.filter(function (u) { return !used[u.id]; });
        if (!rest.length) break;
        cand = rng.pick(rest);
      }
      used[cand.id] = true;
      var star = 1;
      var r = rng.next();
      if (r < star3) star = 3; else if (r < star2) star = 2;
      var items = [];
      if (rng.chance(opts.itemChance === undefined ? 0.5 : opts.itemChance)) {
        var n = rng.int(1, ST.MAX_ITEMS);
        items = rng.sample(ST.ITEMS, n).map(function (it) { return it.id; });
      }
      chosen.push({ id: cand.id, star: star, items: items });
    }
    if (!chosen.length) chosen.push({ id: ST.UNITS[0].id, star: 1, items: [] });
    return autoPlace(side, chosen);
  }

  /**
   * 四套预设阵容：界面默认值、平衡实验的对照样本。
   *
   * 目标：总星级都是 10★、每套 2 件装备，且**各自带一个 4/5 费的体系核心**，
   * 这样对比出来的强弱才是「体系差」而不是「星级差」或「费用差」。
   *
   * 注意：返回的是紧凑写法（不带坐标），两边用会自动镜像站位。
   */
  function presetComps() {
    return {
      // 铁卫 4（+100 护甲）+ 巨兽 3（+45% 生命）+ 守护 2 + 医者 2
      '铁卫巨兽': [
        { id: 'titan', star: 1, items: ['dragonscale', 'belt'] },
        { id: 'ironwall', star: 2 }, { id: 'stoneguard', star: 2 },
        { id: 'crossbow', star: 2 }, { id: 'vine', star: 2 },
        { id: 'medic', star: 1, items: ['holygrail'] }
      ],
      // 秘术 4（+75% 法术强度）+ 医者 3 + 守护 2 —— 后排轰炸
      '秘术爆破': [
        { id: 'abyss', star: 1, items: ['spellbook', 'sapphire'] },
        { id: 'frostmage', star: 2 }, { id: 'windcaller', star: 2 },
        { id: 'alchemist', star: 2 }, { id: 'ironwall', star: 2 },
        { id: 'medic', star: 1, items: ['holygrail'] }
      ],
      // 狂战 5（+60% 攻速）+ 影袭 4（+55% 暴击）—— 玻璃大炮，成型最快
      '狂战影袭': [
        { id: 'blademaster', star: 1, items: ['swiftboots', 'giantblade'] },
        { id: 'twinblade', star: 2, items: ['huntereye'] },
        { id: 'dagger', star: 2 }, { id: 'brute', star: 2 },
        { id: 'bowman', star: 2 }, { id: 'wolfrider', star: 1 }
      ],
      // 游侠 4（+60% 攻击力）+ 影袭 2 + 守护 2 —— 靠一个石卫当前排
      '游侠医者': [
        { id: 'deadeye', star: 1, items: ['giantblade', 'huntereye'] },
        { id: 'falconer', star: 2, items: ['swiftboots'] },
        { id: 'bowman', star: 2 }, { id: 'crossbow', star: 2 },
        { id: 'stoneguard', star: 2 }, { id: 'earthwarden', star: 1 }
      ]
    };
  }

  /* ============================================================
   * 战斗主体
   * ============================================================ */

  function runBattle(setup, seed, opts) {
    opts = opts || {};
    var recordLog = opts.recordLog !== false;
    var noTraits = opts.noTraits || [];
    var statScale = opts.statScale || {};
    var rng = ST.makeRng(typeof seed === 'string' ? ST.hashSeed(seed) : seed);

    var st = {
      t: 0,
      tick: 0,
      log: [],
      units: [],          // 按确定顺序：a0..aN-1, b0..bM-1
      byUid: {},
      occ: new Array(CFG.CELLS),
      side: { a: [], b: [] },
      aliveCount: { a: 0, b: 0 },
      /* ★ 「阴暗领域」留下的地形。
         ★★ 这是游戏里第一份**不属于任何单位**的持续状态：
            以前所有"挂几秒"的效果都写在单位自己身上（buffUntil / chillStacks
            / laughUntil），因为它们都跟着那个单位走。领域不一样 ——
            放技能的人死了、走开了、被推走了，领域**照样在那儿下雨**。
            所以它必须单独存一份，按时间戳过期（和别的持续状态同一套约定：
            不需要任何"结束"事件，谁读谁自己比时间）。
         ★ 每条：{ r, c, radius, until, side, asCut, allyCut, id }
           side 是**施法者**的阵营：领域对"非 side"的单位减益、对 side 增益。 */
      fields: [],
      nextFieldId: 1,
      /* ★ 「电流」（电棍的被动）。和领域一样是**不属于任何单位**的持续状态，
         但有两点不同：
           · 它有**归属**（owner）："每个电棍同时只能存在 N 条"是按人算的；
           · 它自己会**动**（每 0.5 秒跳到下一个敌人身上），而领域是死的。
         ★ 每条：{ id, owner, side, r, c, until, left, hit:[uid…] }
           side 是**施法者**阵营：只弹射这个阵营的敌人。
           hit 记"这道电流打过谁" —— 弹过的不会重复命中（连锁闪电的经典规则）。 */
      currents: [],
      nextCurrentId: 1,
      finished: false
    };
    for (var i = 0; i < st.occ.length; i++) st.occ[i] = null;

    /* ---------- 事件 ---------- */
    function ev(o) {
      if (!recordLog) return o;
      o.t = round3(st.t);
      st.log.push(o);
      return o;
    }

    /* ---------- 建单位 ---------- */
    function buildSide(side) {
      var raw = (setup[side] || []).slice(0, ST.MAX_DEPLOY);
      var defs = raw.map(function (p) { return ST.UNIT_BY_ID[p.id]; }).filter(Boolean);
      var counted = ST.resolveTraits(defs);
      // noTraits：羁绊照常统计（界面还要显示），但一律不给加成。
      // 这是「同一个阵容，一个开羁绊一个不开」的控制变量实验开关。
      var muted = noTraits.indexOf(side) >= 0;
      var traitRes = muted
        ? {
            mods: {},
            counts: counted.counts,
            active: counted.active.map(function (a) {
              return {
                trait: a.trait, count: a.count, tier: -1, need: a.need,
                nextNeed: a.nextNeed, mods: null, muted: true
              };
            })
          }
        : counted;
      var startShield = Math.round(traitRes.mods.startShield || 0);

      // placeOnSide 只补 r/c，不改变顺序 —— 顺序决定 uid，uid 决定确定性
      var placed = placeOnSide(side, raw);
      var out = [];
      for (var k = 0; k < placed.length; k++) {
        var p = placed[k];
        var def = ST.UNIT_BY_ID[p.id];
        if (!def) continue;
        var stats = ST.resolveStats(def, p.star, p.items, traitRes.mods);

        // 让子标定：把整队面板乘一个系数。只用于平衡实验的「等效数值换算」。
        var mult = statScale[side];
        if (mult && mult !== 1) {
          stats.maxHp = Math.round(stats.maxHp * mult);
          stats.ad = U.round2(stats.ad * mult);
          stats.as = U.round2(stats.as * mult);
          stats.ap = U.round2(stats.ap * mult);
          stats.armor = U.round2(stats.armor * mult);
          stats.mr = U.round2(stats.mr * mult);
        }

        var uid = side + out.length;
        // 被动定义只取一次：下面几个字段都要按 kind 分派，写 4 遍 passiveOf(def) 太容易漏改
        var pv = passiveOf(def);
        var unit = {
          uid: uid, side: side, index: out.length,
          def: def, defId: def.id, name: def.name, emoji: def.emoji,
          color: def.color, star: p.star, items: p.items,
          maxHp: stats.maxHp, hp: stats.maxHp, shield: 0,
          ad: stats.ad, as: stats.as, ap: stats.ap,
          armor: stats.armor, mr: stats.mr, range: stats.range,
          critChance: stats.critChance, critMult: stats.critMult,
          lifesteal: stats.lifesteal, thornPct: stats.thornPct,
          shieldPct: stats.shieldPct, regenPct: stats.regenPct,
          maxMana: def.mana, mana: Math.min(stats.manaStart, def.mana),          manaFromDmg: 0, regenPool: 0, healPool: 0,
          r: p.r, c: p.c,
          atkTimer: 0, alive: true,
          moveTimer: 0,                    // 走位计时：攒够 MOVE_INTERVAL 才走一格
          /* 星级被动「frenzy」：每次普攻叠加的攻速，本局内永久累积。
             perHit 按星级取（1 星没有被动 → step 0 → 整段逻辑自动空转）。 */
          frenzyPct: 0,
          frenzyStep: passiveStep(def, p.star),
          frenzyCap: passiveCap(def),
          hurtHealPct: (pv && pv.kind === 'hurtHeal')
            ? passiveStep(def, p.star) : 0,
          /* 星级被动「幻觉 / 开智」：奶出有效治疗之后给被治疗者挂的伤害改动。
             giftPct 是幅度，giftSure 是「不掷骰子、必定增伤」（3 星开智）。 */
          giftPct: (pv && pv.kind === 'healGift') ? passiveStep(def, p.star) : 0,
          giftSure: !!(pv && pv.kind === 'healGift' && p.star >= 3),
          giftChance: (pv && typeof pv.chance === 'number') ? pv.chance : 0.5,
          giftDur: (pv && pv.seconds > 0) ? pv.seconds : CFG.GIFT_SECONDS,
          /* 星级被动「运 / edg希望」：每局还剩几次「狙击必定命中」。
             ★ 单位是**次数**，不是百分比 —— passiveStep 在这里返回的是次数。 */
          snipeSureLeft: (pv && pv.kind === 'snipeSure') ? passiveStep(def, p.star) : 0,
          snipeHits: 0, snipeMisses: 0,
          /* 技能的「收费方式」。0 = 法力型（默认，攒满 mana 就放）；
             > 0 = 计数型：开局白送一发 + 每 N 次普攻攒一发（荣誉的狙击1）。
             ★ 计数型棋子完全不吃法力（gainMana 直接返回），
               法力条只用来画「还差几次普攻」，满格就是要开枪了。 */
          cadenceEvery: (def.skill && def.skill.cast && def.skill.cast.perAttacks > 0)
            ? def.skill.cast.perAttacks : 0,
          skillCadence: (def.skill && def.skill.cast && def.skill.cast.perAttacks > 0 &&
                         def.skill.cast.opening) ? def.skill.cast.perAttacks : 0,
          chargeUntil: -1,
          /* 纯 CD 技能（奶龙的「捧腹大笑」）。
             ★ 冷却**从 0 开始倒数** ——「冷却 13 秒」按字面就是"要等 13 秒"。
               想让它开局立刻放，给 skill.cast 加一个 opening: true 就行。 */
          cdSeconds: (def.skill && def.skill.cast && def.skill.cast.cooldown > 0)
            ? def.skill.cast.cooldown : 0,
          cdAcc: 0,
          /* 捧腹大笑的状态。
             laughUntil = 笑到什么时候；laughMove / laughHeal 由星级门槛开关。
             ★ 用它自己的字段而不是复用 stunUntil：2 星要"能移动但依然不能攻击"，
               这和眩晕是两种不同的状态，塞进 stunUntil 就表达不出来了。 */
          laughUntil: -1, laughDur: 0, laughCut: 0, laughHealPct: 0,
          laughAcc: 0, laughMove: false, laughHeal: false, laughRadius: 0,
          laughed: 0,
          /* 星级被动「男人领域」：这一星级一次能控几个、时长乘几倍。
             ★ 和别的被动不一样的地方：它改的是**技能本身的参数**
               （同时控几个人、控多久），不是"触发时额外做点什么"。
               所以这两个值在 buildSide 里就定死，castSkill 直接读 ——
               技能那边一行 if 都不用写星级判断。 */
          domainTargets: (pv && pv.kind === 'domain' && pv.targets && pv.targets[p.star] > 0)
            ? pv.targets[p.star] : 1,
          domainDurMul: (pv && pv.kind === 'domain' && pv.durMul && pv.durMul[p.star] > 0)
            ? pv.durMul[p.star] : 1,
          /* ---------- 羊帆「羊巅峰」 ----------
             peakMult      下一次普攻翻几倍（技能数据里写着 20）
             peakCharge    蓄势好了没有（放出去那一下就清掉）
             peakStunDur   ×20 那一下附带的眩晕秒数（2 星起，0 = 不晕）
             boomAdMult    阵亡自爆的伤害倍率（3 星起，0 = 不炸）
             ★ 攻速 -80% 是直接写进 def.as 的（界面要显示真实数字），
               移速没有面板项，所以只有它走 movePct 这一条。 */
          peakMult: (def.skill && def.skill.kind === 'peak') ? (def.skill.mult || 1) : 1,
          peakCharge: false, peakHits: 0, peakEdges: 0,
          peakStunDur: (pv && pv.kind === 'peak' && pv.stunAt && p.star >= pv.stunAt)
            ? (pv.stunDur || 0) : 0,
          boomAdMult: (pv && pv.kind === 'peak' && pv.boomAt && p.star >= pv.boomAt)
            ? (pv.boomAdMult || 0) : 0,
          /* ★ 眩晕秒数只有一份（2 星的巅峰一击和 3 星的自爆用的是同一个 dur），
             但两个门槛各自判一次 —— 只点 2 星的人也该有 3 秒。 */
          boomStunDur: (pv && pv.kind === 'peak' && pv.boomAt && p.star >= pv.boomAt)
            ? (pv.stunDur || 0) : 0,
          boomRadius: CFG.CRASH_RADIUS,
          booms: 0,
          /* 「天生迟钝」：移速倍率。1 = 正常，0.2 = 走一格要 1.5 秒。
             ★ 和 ocMovePct（张雪峰的加成）分开存：一个是底子、一个是加成，
               乘在一起才不会出现"迟钝的人吃到加速就变正常"这种怪事。
             ★ 取到小数点后四位：1 - 0.8 在浮点里是 0.19999999999999996，
               原样写进快照的话，界面和校验器都要跟着用容差比。 */
          movePct: Math.round((1 - ((def.slowMove > 0) ? def.slowMove : 0)) * 10000) / 10000,
          /* ---------- 楚生疑犯「阴暗领域」 ----------
             fieldAllyCut  2 星起：领域内的队友少受多少伤害（0 = 不保护）
             shadowAt      3 星起：放完技能会不会遁入暗影
             shadow        现在是不是暗影状态（免疫一切伤害 + 不会被索敌）
             ★ shadow 的解除条件写在 shadowTick 里（只剩自己一个人时现形），
               那是**终止条件**，不是风味。 */
          fieldAllyCut: (pv && pv.kind === 'field' && pv.allyCutAt && p.star >= pv.allyCutAt)
            ? (pv.allyCut || 0) : 0,
          shadowAt: !!(pv && pv.kind === 'field' && pv.shadowAt && p.star >= pv.shadowAt),
          shadowAsCut: (pv && pv.kind === 'field') ? (pv.shadowAsCut || 0.5) : 0.5,
          shadowDmgMul: (pv && pv.kind === 'field') ? (pv.shadowDmgMul || 2) : 2,
          shadow: false, shadows: 0, shadowBlocks: 0, fieldBlocked: false,
          /* ---------- Dank1ng「空悲切 / 老男孩 / 锁头」 ----------
             loneWolf     有没有「空悲切」（1 星就有）
             endlessMana  现在是不是"无限能量"状态（队友全死光之后自动开）
             manaRegenMul 涨法力的倍率（3 星「锁头」是 2）
             killRefill   击杀敌人会不会瞬间回满（3 星「锁头」）
             castLockUntil 上一次施法 + CFG.CAST_LOCK（见 CFG 里的说明）
             knifeUntil   耍折叠刀到什么时候（这 3 秒里不攻击）
             ★ 这一组里只有 endlessMana 是"会变的状态"，其余三个都是开局定死的。 */
          loneWolf: !!(pv && pv.kind === 'loneWolf'),
          endlessMana: false,
          manaRegenMul: (pv && pv.kind === 'loneWolf' && pv.regenMulAt && p.star >= pv.regenMulAt)
            ? (pv.regenMul || 1) : 1,
          killRefill: !!(pv && pv.kind === 'loneWolf' && pv.killRefillAt && p.star >= pv.killRefillAt),
          startFullMana: !!(pv && pv.kind === 'loneWolf' && pv.startFullAt && p.star >= pv.startFullAt),
          castLockUntil: -1,
          knifeUntil: -1, knives: 0, skulls: 0, endless: 0,
          /* 星级被动「坠机」：阵亡后的延时结算。
             downUntil >= 0 表示「已经死了，但直升机还没落地」——
             这种单位既不参与行动，也**不参与胜负判定**（见 anyPending）。
             revives/cdCut 由星级门槛单独开关，因为 3 星是 2 星 + 额外一条，
             不是替换关系。 */
          crashDamage: (pv && pv.kind === 'crash') ? (pv.crashDamage || 0) : 0,
          revives: !!(pv && pv.kind === 'crash' && pv.reviveAt && p.star >= pv.reviveAt),
          /* ★ 一局最多复活几次。现在是 1 —— 复活第二次会让「必须打死它两遍」
             变成「必须打死它三遍」，对局被拖长、而且玩家很难读出还差几次。
             次数写在被动数据里（maxRevives），不是硬编码在逻辑里。 */
          maxRevives: (pv && pv.maxRevives > 0) ? pv.maxRevives : 1,
          reviveHpPct: (pv && pv.reviveHpPct > 0) ? pv.reviveHpPct : 0.5,
          cdCut: !!(pv && pv.kind === 'crash' && pv.cdCutAt && p.star >= pv.cdCutAt),
          cdCutPct: (pv && pv.cdCutPct > 0) ? pv.cdCutPct : 0,
          downUntil: -1, revivesUsed: 0,
          /* 星级被动「抓娃娃」：还剩几次「敌人打不动我」。
             guardLeft 归零之后就是一只 95 血的鸭子。 */
          guardLeft: (pv && pv.kind === 'clawGuard') ? passiveStep(def, p.star) : 0,
          guardMax: (pv && pv.kind === 'clawGuard') ? passiveStep(def, p.star) : 0,
          guarded: 0,
          /* ---------- 张雪峰「超频」 ----------
             ocAsPct  攻速加成。开局 ocAsStart，每次普攻叠 ocPerHit；
                      ★ 进入狂暴之后每次叠 ocPerHitBerserk（= ocPerHit × 倍率），
                        并且封顶 ocMaxAs（0 = 不封顶）
             ocMovePct 移速加成
             ocOn     是否已经进入狂暴（狂暴 = 开始自毁；3 星还额外加攻击力）
             adBonusPct 攻击力加成（雪毙），和 ad 分开存，
                       免得把 ad 本身改掉导致「日志里的 raw 和快照里的 ad 对不上」 */
          ocAsPct: (pv && pv.kind === 'overclock')
            ? Math.min(pv.ocAsStart || 0, (pv.ocMaxAs > 0 ? pv.ocMaxAs : Infinity)) : 0,
          ocMovePct: (pv && pv.kind === 'overclock') ? (pv.ocMoveStart || 0) : 0,
          ocPerHit: (pv && pv.kind === 'overclock') ? (pv.ocPerHit || 0) : 0,
          /* ocPerHitBerserk: 狂暴里的单次叠加量。★ 倍率在**这里**就算掉，
             不留在 overclockOnHit 的热路径里 —— 那里每次普攻都要读它，
             而倍率是开局就定死的。倍率缺失或为 0 时按 1 处理，
             免得一个笔误把叠加量变成 0（那会让狂暴永远叠不上去）。 */
          ocPerHitBerserk: (pv && pv.kind === 'overclock')
            ? (pv.ocPerHit || 0) * (pv.ocBerserkMul > 0 ? pv.ocBerserkMul : 1) : 0,
          /* ocMaxAs: 攻速加成的硬上限。0 = 不封顶（旧版的行为）。 */
          ocMaxAs: (pv && pv.kind === 'overclock' && pv.ocMaxAs > 0) ? pv.ocMaxAs : 0,
          ocBerserkName: (pv && pv.ocBerserkName) ? pv.ocBerserkName : '',
          ocThreshold: (pv && pv.kind === 'overclock') ? (pv.ocThreshold || 99) : 0,
          ocBurnPct: (pv && pv.kind === 'overclock') ? (pv.ocBurnPct || 0) : 0,
          ocAoeRadius: (pv && pv.kind === 'overclock' && pv.ocAoeAt && p.star >= pv.ocAoeAt)
            ? (pv.ocAoeRadius || 0) : 0,
          ocAdPct: (pv && pv.kind === 'overclock' && pv.ocAdAt && p.star >= pv.ocAdAt)
            ? (pv.ocAdPct || 0) : 0,
          ocOn: false, ocBurnAcc: 0, ocHits: 0, ocFlash: 0, ocBurnFlash: 0,
          adBonusPct: 0,
          /* ---------- 老牧师「临终祷告」 ----------
             前半段是**施法者**（老牧师）身上的：
               ritesOn     这一星级有没有这个被动（2 星起）
               ritesUsed   这一局是不是已经用掉了（一场只救一个人）
               ritesHpPct  拉回来时的血量比例（1 = 满血）
               ritesDelay  祷告多久之后站起来
               ritesAdPct  复活时双方各加多少攻击力（3 星起；0 = 不加）
             后半段挂在**被救的那个人**身上（倒下之后才填）：
               ritesUntil   还要等到什么时候（-1 = 没在等）
               ritesBy      谁在给他做祷告（uid，日志和校验器要看）
               ritesCarryHp / ritesCarryAd
                            ★ 把"遗嘱"一起带过去：祷告开始之后老牧师
                              可能被打死，那份该给的血量和攻击力照样要生效 ——
                              结算时再去读老牧师身上的字段就会读到 0。 */
          ritesOn: !!(pv && pv.kind === 'lastRites' && pv.reviveAt && p.star >= pv.reviveAt),
          ritesUsed: false,
          ritesHpPct: (pv && pv.reviveHpPct > 0) ? pv.reviveHpPct : 1,
          ritesDelay: (pv && pv.reviveDelay > 0) ? pv.reviveDelay : 1,
          ritesAdPct: (pv && pv.kind === 'lastRites' && pv.adBuffAt && p.star >= pv.adBuffAt)
            ? (pv.adBuffPct || 0) : 0,
          ritesUntil: -1, ritesBy: null, ritesCarryHp: 0, ritesCarryAd: 0,
          /* ---------- 孙笑川「天皇」 ---------- */
          mikadoAura: 0, mikadoLifesteal: 0,
          skillHealPct: 0, convertOnKill: false, convertHpPct: 0,
          converted: false,        // 它是"招安"过来的 → 卡面变灰
          everRevived: false,      // 复活过一次 → 不能再被招安
          /* ---------- 电棍「导电」 ---------- */
          currentOn: false, currentDelay: 0, currentRadius: 0,
          currentPct: 0, currentMaxBounces: 0, currentStunDur: 0,
          currentMaxAt: 0,
          /* ---------- 美团袋鼠「准时送达 / 好评如潮」 ---------- */
          deliveryAsPct: 0, deliveryAsDur: 0, deliveryHealPct: 0, deliveryRadius: 0,
          /* ---------- 东北雨姐「红薯粉丝 / 雨姐的关照」 ----------
             ★★ `rootUntil` 是**独立于 stunUntil 的第三种封锁**：
                · stunUntil  —— 不能动、不能打、攻速计时器也停（真晕）
                · laughUntil —— 很硬但动不了也打不了（自己给自己上的）
                · rootUntil  —— **只是钉在原地，照样能还手**（被粉丝捆住）
               塞进 stunUntil 就表达不出"被捆住但还能打"这件事
               （奶龙的"能走不能打"当初也是因为这个才另开字段）。 */
          rootUntil: -1, rooted: 0,
          bindOn: false, bindDur: 0, bindRadius: 0,
          bindHealPct: 0, bindHeals: 0,
          /* ---------- 「巧乐兹」的冰棍 ----------
             层数记在**被冻的人身上**，因为减速要作用在它身上。
             chillPerStack 也一起带过去：同一个减速效果可能来自不同星级的张雪峰，
             记在自己身上才不会串味。 */
          chillStacks: 0, chillPerStack: 0, chillMax: 0, chillOn: false,
          chillPerHit: 0, freezeDur: 0, chillFlash: 0,
          /* 身上挂着的伤害倍率。buffMul === 1 表示没有效果；
             buffUntil 是失效时刻 —— 靠时间戳自然过期，不需要每 tick 去扫。
             ★ 必须是「倍率」而不是「加成百分比」：减伤 20% 要写成 0.8，
               和增伤 1.2 用同一个字段表达，dealDamage 里只有一次乘法。 */
          buffMul: 1, buffUntil: -1,
          frenzyHits: 0, giftGood: 0, giftBad: 0,
          lastSwapT: -99, lastSwapWith: null, swaps: 0,
          stunUntil: -1, asBuffPct: 0, asBuffUntil: -1,
          target: null, _lastHitBy: null,
          casts: 0, dmgDealt: 0, dmgTaken: 0, healing: 0, shielding: 0, kills: 0
        };
        /* 「巧乐兹」只有 2 星起才有 —— 单独一段，因为上面那张字段表
           是"默认值"的集合，星级门槛放在这里判更清楚。 */
        if (pv && pv.kind === 'overclock' && pv.chillAt && p.star >= pv.chillAt) {
          unit.chillOn = true;
          unit.chillPerHit = pv.chillPerHit || 0;
          unit.chillPerStack = pv.chillPerStack || 0;
          unit.chillMax = pv.chillMax || 0;
          unit.freezeDur = pv.freezeDur || 0;
        }
        /* ---------- 装备给的行为（「和成天下5000精品大果」） ----------
         * ★ 走 `grants` 不走 `mods`：mods 是面板数字，会被逐键相加；
         *   "普攻挂寒冰"和"每秒自燃"不是数字，相加没有意义（见 items.js）。
         *
         * ★★ 和「巧乐兹」之间是**取强**，不是相加：
         *   两者都是"每层 -5%、满 10 层冻 3 秒"，取强的结果就是不亏也不叠；
         *   相加的话一个「2 星张雪峰 + 这颗果子」每击叠 2 层，
         *   5 次普攻就冻一次 —— 控制会直接滚雪球到没法玩。
         *   所以两个来源各自算完后取 max，而不是把 perHit 加起来。 */
        var itemGrants = ST.resolveItemGrants(p.items);
        if (itemGrants.chill) {
          var ic = itemGrants.chill;
          unit.chillOn = true;
          unit.chillPerHit = Math.max(unit.chillPerHit, ic.perHit);
          unit.chillPerStack = Math.max(unit.chillPerStack, ic.perStack);
          unit.chillMax = Math.max(unit.chillMax, ic.max);
          unit.freezeDur = Math.max(unit.freezeDur, ic.freezeDur);
        }
        /* 每秒失去**生命上限**的 burnMaxPct（不是当前生命 —— 那是两条规则）。
           burnAcc 是独立的计时器：带上两颗果子也只烧一次。 */
        unit.burnMaxPct = itemGrants.burnMaxPct || 0;
        unit.burnAcc = 0;
        /* ---------- 孙笑川「天皇」 ----------
           mikadoAura / mikadoLifesteal 是**给别人的**光环参数；
           skillHealPct 是技能伤害转自己治疗的比例（2 星）；
           convertOnKill / convertHpPct 是击杀倒戈（3 星）。
           everRevived：**已经被复活过一次**（老牧师救回来的 / 之前被招安过的）——
           3 星的招安对它无效，这正是需求里那句「对有复活技能的单位无效」。 */
        if (pv && pv.kind === 'mikado') {
          unit.mikadoAura = pv.auraRadius || 0;
          unit.mikadoLifesteal = pv.auraLifesteal || 0;
          unit.skillHealPct = (pv.skillHealAt && p.star >= pv.skillHealAt)
            ? (pv.skillHealPct || 0) : 0;
          unit.convertOnKill = !!(pv.convertAt && p.star >= pv.convertAt);
          unit.convertHpPct = pv.convertHpPct || 0;
        }
        /* ---------- 电棍「导电」 ----------
           ★ maxAtOnce 是**按星级**的一张表（1/2 星 1 条、3 星 3 条）——
             所以这里用 starLookup 取值，而不是一个固定的数字。 */
        if (pv && pv.kind === 'current') {
          var cStar = starLookup(pv.maxAtOnce, p.star);
          unit.currentOn = true;
          unit.currentDelay = pv.delay || 0.5;
          unit.currentRadius = (pv.radius > 0) ? pv.radius : 1;
          unit.currentPct = pv.bouncePct || 0;
          unit.currentMaxBounces = pv.maxBounces || 0;
          unit.currentStunDur = (pv.stunAt && p.star >= pv.stunAt) ? (pv.stunDur || 0) : 0;
          unit.currentMaxAt = (typeof cStar === 'number' && cStar > 0) ? cStar : 1;
        }
        /* ---------- 冰冰冰「冻手冻脚 / 千里冰封」 ----------
           两层都是"让技能变强"，所以这里只算两个开关/数字，
           真正的效果在技能结算（aoe 分支）里用：
             frostFreezeDur > 0 → 技能命中者额外冻这么久
             frostAll           → 技能改成打全场（跳过 3×3 判定） */
        if (pv && pv.kind === 'frost') {
          unit.frostFreezeDur = (pv.freezeAt && p.star >= pv.freezeAt)
            ? (pv.freezeDur || 0) : 0;
          unit.frostAll = !!(pv.allAt && p.star >= pv.allAt);
        }
        /* ---------- 美团袋鼠「准时送达 / 好评如潮」 ----------
           两层都挂在"一次送餐"上：
             deliveryAsPct / deliveryAsDur > 0 → 技能奶到的人顺带 +20% 攻速 5 秒（2 星）
             deliveryHealPct > 0               → **普攻**给被攻击敌人 3×3 内的友方各送一单（3 星） */
        if (pv && pv.kind === 'delivery') {
          unit.deliveryAsPct = (pv.asBuffAt && p.star >= pv.asBuffAt)
            ? (pv.asBuffPct || 0) : 0;
          unit.deliveryAsDur = pv.asBuffDur || 0;
          unit.deliveryHealPct = (pv.healAt && p.star >= pv.healAt)
            ? (pv.healPct || 0) : 0;
          unit.deliveryRadius = (pv.radius > 0) ? pv.radius : 1;
        }
        /* ---------- 东北雨姐「红薯粉丝 / 雨姐的关照」 ----------
           2 星：放技能的同时捆住身边的敌人（bindOn）
           3 星：普攻打到被捆住的敌人时给最低血队友回血（bindHealPct） */
        if (pv && pv.kind === 'noodle') {
          unit.bindOn = !!(pv.bindAt && p.star >= pv.bindAt);
          unit.bindDur = pv.bindDur || 0;
          unit.bindRadius = (pv.bindRadius > 0) ? pv.bindRadius : 1;
          unit.bindHealPct = (pv.healAt && p.star >= pv.healAt)
            ? (pv.hitHealPct || 0) : 0;
        }
        /* 「捧腹大笑」：技能本身（时长/减伤/回血）来自 skill，星级只开两个开关。
           数据来源分两处是刻意的 —— 前半段是"这个技能干什么"（技能表），
           后半段是"星级让它多干什么"（被动表）。 */
        if (def.skill && def.skill.kind === 'laugh') {
          unit.laughDur = def.skill.dur || 0;
          unit.laughCut = def.skill.dmgCut || 0;
          unit.laughHealPct = def.skill.healPct || 0;
          unit.laughMove = !!(pv && pv.moveAt && p.star >= pv.moveAt);
          unit.laughHeal = !!(pv && pv.healAt && p.star >= pv.healAt);
          unit.laughRadius = (pv && pv.healRadius > 0) ? pv.healRadius : 0;
        }
        st.occ[p.r * CFG.COLS + p.c] = unit;
        /* ★ 「老男孩」（2 星）：**开局满能量**。
           放在这里而不是上面那张字段表里 —— 它要读 maxMana，
           而 maxMana 就是 def.mana；写成"开局 mana = maxMana"最直白。
           ★ 和物品的「蓝水晶」(manaStart) 是**取大**而不是相加：
             一个是"开局给这么多"，一个是"开局就是满的"，
             两个都写的时候满的就是满的。 */
        if (unit.startFullMana) unit.mana = unit.maxMana;
        out.push(unit);
      }
      // 守护羁绊：开局全队护盾
      for (var s = 0; s < out.length; s++) {
        out[s].shield += startShield;
        out[s].shielding += startShield;
      }
      st.side[side] = out;
      st.aliveCount[side] = out.length;
      for (var m = 0; m < out.length; m++) {
        st.units.push(out[m]);
        st.byUid[out[m].uid] = out[m];
      }
      return { units: out, traits: traitRes, startShield: startShield };
    }

    var builtA = buildSide('a');
    var builtB = buildSide('b');

    // 开局护盾写进事件流，渲染层才知道血条旁边那截白条是哪来的
    if (recordLog) {
      var shieldSides = [builtA, builtB];
      for (var si = 0; si < shieldSides.length; si++) {
        var bs = shieldSides[si];
        if (bs.startShield <= 0) continue;
        for (var ui = 0; ui < bs.units.length; ui++) {
          var uu = bs.units[ui];
          ev({ type: 'shield', from: uu.uid, to: uu.uid, amount: bs.startShield,
               shieldAfter: uu.shield, reason: 'trait' });
        }
      }
    }

    /* ---------- 查询 ---------- */
    function enemiesOf(u) { return u.side === 'a' ? st.side.b : st.side.a; }
    function alliesOf(u) { return u.side === 'a' ? st.side.a : st.side.b; }

    function occupiedAt(r, c) {
      if (!inBounds(r, c)) return true;
      return st.occ[r * CFG.COLS + c] !== null;
    }

    /** 确定性选目标：最近 → 血最少 → uid 字典序
     *  ★ 遁入暗影的单位**不会被索敌**（targetable 会把它过滤掉）——
     *    这就是「暗影」最值钱的地方：对面一群人会站在原地找不到人打。
     *    它自己照样能出手。 */
    function acquireTarget(u) {
      var list = enemiesOf(u);
      var best = null, bestD = 0, bestHp = 0;
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (!targetable(e)) continue;
        var d = U.cheb(u.r, u.c, e.r, e.c);
        if (best === null || d < bestD || (d === bestD && e.hp < bestHp) ||
            (d === bestD && e.hp === bestHp && e.uid < best.uid)) {
          best = e; bestD = d; bestHp = e.hp;
        }
      }
      return best;
    }

    /** 血量百分比最低的队友（含自己），并列取 index 小的 */
    function lowestAlly(u) {
      var list = alliesOf(u);
      var best = null, bestPct = 2;
      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        if (!a.alive) continue;
        var pct = (a.hp + a.shield) / a.maxHp;
        if (best === null || pct < bestPct) { best = a; bestPct = pct; }
      }
      return best || u;
    }

    /* ---------- 伤害管线 ---------- */

    /**
     * 伤害递增（云顶里叫「加时赛」）。
     *
     * 没有它的话，两套低输出阵容会一直互相挠到时间上限，最后靠
     * 「谁血多谁赢」草草收场 —— 实测随机阵容里有 20% 以上的对局是这样结束的，
     * 玩家体验很差。开了之后伤害随时间放大，僵局会被强行打破。
     *
     * 参数在 CFG 顶部，注释里写了「为什么提到 60 秒时要同比拉长一倍」。
     * 把 RAMP_PER_SEC 设成 0 就可以关掉它。
     */
    function damageRamp() {
      if (CFG.RAMP_PER_SEC <= 0 || st.t <= CFG.RAMP_START) return 1;
      return 1 + (st.t - CFG.RAMP_START) * CFG.RAMP_PER_SEC;
    }

    /**
     * 只改数值 + 统计，不写日志。日志由调用方在合适的位置写，
     * 这样「出手」和「结算」的顺序在事件流里是可读的。
     *
     * 返回值里的 effective 是「计入递增之后的原始伤害」，
     * 日志里的 raw 字段用的就是它 —— 这样自检的
     * 「原始伤害必须 >= 结算伤害」才能成立。
     */
    function dealDamage(src, dst, raw, kind) {
      var ramp = damageRamp();
      /* ★ 豆包「幻觉 / 开智」挂上的伤害改动。
       *
       *   乘在**自己的原始伤害**上，而不是去改对方的护甲 ——
       *   改护甲会被「真实伤害无视护甲」这类规则绕过去，
       *   而「我这一下打得重还是轻」本来就该由出手方决定。
       *
       *   讲话石的反弹也是走这条路（src 就是佩戴者），
       *   所以「被幻觉误导的人连反弹都变弱」是自洽的，不需要额外特判。
       *
       *   ★ 判定写成 st.t < buffUntil：过期不需要任何人来清，
       *     旧的 buffMul 留在对象上也永远不会被读到。 */
      var boost = (src && st.t < src.buffUntil) ? src.buffMul : 1;
      var effective = raw * boost * ramp;

      /* ★★ 「遁入暗影」（楚生疑犯 3 星）：免疫**一切**伤害。
       *
       *   ★ 位置和「抓娃娃」一样，拦在所有计算之前、扣血扣盾之前 ——
       *     理由也一样：放到后面就得"先扣再补回来"，
       *     「hpLoss 必须等于血量差」那条自检立刻会炸。
       *   ★ 和抓娃娃的区别是它**不限次数、也不看来源**：
       *     抓娃娃是"敌人的前 N 次攻击"，暗影是"一切伤害，直到队友全死光"。
       *     所以这里不要求 src，也不递减任何计数器。
       *     （反伤、自爆、AOE 全都打不动它 —— 那正是"遁入暗影"的字面意思。）
       *   ★ 依然要写事件：不然玩家会看到"打中了但没掉血"却找不到解释。
       *     用独立的 reason，和抓娃娃的格挡在回放里区分得开。 */
      if (dst.shadow) {
        dst.shadowBlocks++;
        ev({ type: 'block', who: dst.uid, from: src ? src.uid : null,
             left: -1, max: -1, kind: kind, reason: 'shadow' });
        return { dmg: 0, shieldLoss: 0, hpLoss: 0, effective: effective,
                 ramp: ramp, blocked: true };
      }

      if (dst.guardLeft > 0 && src && src.side !== dst.side) {
        dst.guardLeft--;
        dst.guarded++;
        ev({ type: 'block', who: dst.uid, from: src.uid,
             left: dst.guardLeft, max: dst.guardMax, kind: kind });
        return { dmg: 0, shieldLoss: 0, hpLoss: 0, effective: effective,
                 ramp: ramp, blocked: true };
      }

      var resist = kind === 'phys' ? dst.armor : (kind === 'true' ? 0 : dst.mr);
      var mitigated = effective * reduce(resist);
      /* ★ 「捧腹大笑」的减伤：-80% 乘在**减抗之后**。
         放在这里而不是 effective 上，是为了让日志里的 raw 保持
         "出手方本来能打多少"的含义 —— 自检的「raw >= dmg」和
         「倍率 = 1 / 1.2 / 0.8」两条都还成立。
         和 buffUntil 一样：到期靠比时间，不需要任何人清理。 */
      if (dst.laughUntil >= 0 && st.t < dst.laughUntil && dst.laughCut > 0) {
        mitigated *= (1 - dst.laughCut);
      }
      /* ★ 「同伙掩护」（楚生疑犯 2 星）：站在**己方**领域的队友少受 30% 伤害。
         ★ 只挡**敌方的**伤害（src 必须存在且是敌人）——
           不然自爆/反伤之类的自家伤害也会被领域吃掉，那就不是"掩护"了。
         ★ 和上面几条一样放在减抗之后：raw 保持"本来能打多少"的含义。 */
      if (src && src.side !== dst.side) {
        var fcut = fieldAllyCutAt(dst.r, dst.c, dst.side);
        if (fcut > 0) {
          mitigated *= (1 - fcut);
          dst.fieldBlocked = true;
        }
      }
      var shieldLoss = Math.min(dst.shield, mitigated);
      dst.shield -= shieldLoss;
      var hpLoss = mitigated - shieldLoss;
      if (hpLoss > dst.hp) hpLoss = dst.hp;
      if (hpLoss < 0) hpLoss = 0;
      dst.hp = U.round2(dst.hp - hpLoss);
      if (dst.hp < 0) dst.hp = 0;
      var total = shieldLoss + hpLoss;
      dst.dmgTaken += total;
      if (src) src.dmgDealt += total;
      return { dmg: total, shieldLoss: shieldLoss, hpLoss: hpLoss, effective: effective, ramp: ramp };
    }

    function gainMana(u, amount) {
      if (!u.alive) return;
      // ★ 不吃法力的两种棋子：计数型（荣誉，法力条画"还差几次普攻"）
      //   和纯 CD 型（奶龙，法力条画"冷却进度"）
      if (u.cadenceEvery > 0 || u.cdSeconds > 0) return;
      /* ★★ 「空悲切」的无限能量：队友全死光之后，**只要涨法力就直接顶满**。
       *   ★ 为什么不是"每 tick 回满"：tryCast 每个 tick 都会被调用一次，
       *     法力永远满 = 一秒 30 发核弹。顶在 gainMana 上就不一样了 ——
       *     涨法力只发生在"自己打了一下"或"自己挨了一下"，
       *     所以出手频率被这两件事天然限住，再叠加 CFG.CAST_LOCK 兜底。 */
      if (u.endlessMana) { u.mana = u.maxMana; return; }
      // ★ 「锁头」（3 星）：能量回复翻倍
      u.mana = Math.min(u.maxMana, U.round2(u.mana + amount * u.manaRegenMul));
    }

    /**
     * 纯 CD 技能的冷却推进。
     *
     * ★ 放在主循环里按 tick 走，而不是塞进 updateUnit ——
     *   updateUnit 会被眩晕 / 大笑提前 return，而**冷却不该因为被控就停**。
     *   （真停了的话，一个被冻住的奶龙会永远放不出技能，那是另一套设计。）
     *
     * ★ 顺带把冷却进度写进 mana：渲染层原本就有一条法力条，
     *   于是它自动变成一条"冷却条"，不用为一个新机制再动界面。
     */
    function cooldownTick() {
      for (var i = 0; i < st.units.length; i++) {
        var u = st.units[i];
        if (!u.alive || !(u.cdSeconds > 0)) continue;
        if (u.cdAcc >= u.cdSeconds) continue;
        u.cdAcc = Math.min(u.cdSeconds, u.cdAcc + CFG.DT);
        u.mana = U.round2(u.maxMana * u.cdAcc / u.cdSeconds);
      }
    }

    /**
     * 放技能的**唯一入口**，两种收费方式在这里分岔：
     *
     *   法力型（默认）   mana 攒满 → 立刻放
     *   计数型（荣誉）   开局白送一发 + 每 N 次普攻攒一发，攒满后先**蓄力**再放
     *
     * ★ 返回值 = 「这个棋子这一 tick 已经被技能占用了」。
     *   调用方（updateUnit）据此让它停下来 —— 蓄力期间不出手也不走位，
     *   这样「眼睛喷激光」才是一个真正的预告，而不是一边打一边闪。
     */
    function tryCast(u) {
      if (!u.alive) return false;
      if (st.t < u.stunUntil) return false;
      /* ★★ 耍折叠刀的 3 秒里**一次技能都不放**。
       *
       *   ★ 这条必须写在 tryCast 里，不能只写在 updateUnit 开头：
       *     tryCast 有**三个调用点** —— updateUnit（自己回合）、
       *     afterDamage 里的 `tryCast(src)`（打完人之后）、
       *     以及 `tryCast(dst)`（挨完打之后）。
       *     只在 updateUnit 里挡的话，"挨了一下 → 法力被顶满 → 立刻反手一发"
       *     会从另外两个口子漏进来 —— 实测就是这样：耍刀期间的击杀间隔
       *     退化到了 CAST_LOCK 的 0.5 秒，那条"必然隔着一个耍刀窗口"的断言
       *     直接红了。
       *   ★ 教训和 CFG.CAST_LOCK 一样：**节流写在唯一入口里**，
       *     散在各个调用点迟早漏一个。 */
      if (u.knifeUntil >= 0 && st.t < u.knifeUntil) return false;
      /* ★ 两次施法之间的间隔下限（见 CFG.CAST_LOCK 的说明）。
         它挡在**所有收费方式**前面：法力型、计数型、纯 CD 型都受它约束。
         现有棋子的最快节奏都远慢于半秒，所以这条对它们是空操作；
         真正需要它的是 Dank1ng 那种"法力瞬间顶满"的机制。 */
      if (st.t < u.castLockUntil) return false;

      /* ★ 纯 CD 技能（奶龙的「捧腹大笑」）：和计数型一样绕开法力，
         区别只是把"攒普攻次数"换成"攒时间"。
         冷却进度写进 mana —— 渲染层原本就有一条法力条，
         于是它自动变成一条"冷却条"，不用为一个新机制再动界面。 */
      if (u.cdSeconds > 0) {
        if (u.cdAcc < u.cdSeconds) return false;
        u.cdAcc = 0;
        u.mana = 0;
        castSkill(u);
        return true;
      }

      if (u.cadenceEvery <= 0) {
        if (u.mana < u.maxMana) return false;
        castSkill(u);
        return true;
      }

      if (u.skillCadence < u.cadenceEvery) return false;

      /* ★ 蓄力：眼睛先喷金色激光，CHARGE_TIME 秒后才真的开枪。
         这段时间里棋子站着不动 —— 把「我要打了」明明白白写在画面上。 */
      if (u.chargeUntil < 0) {
        var tgt = (u.target && u.target.alive) ? u.target : acquireTarget(u);
        u.chargeUntil = st.t + CFG.CHARGE_TIME;
        ev({ type: 'charge', who: u.uid, to: tgt ? tgt.uid : null,
             dur: CFG.CHARGE_TIME, until: round3(u.chargeUntil),
             skill: u.def.skill.name });
        return true;
      }
      if (st.t < u.chargeUntil) return true;      // 还在蓄力

      u.chargeUntil = -1;
      u.skillCadence = 0;
      u.mana = 0;
      castSkill(u);
      return true;
    }

    /**
     * 计数型技能的充能：每次普攻之后 +1。
     *
     * ★ 顺带把「还差几次」写进 mana —— 渲染层原本就有一条法力条，
     *   直接复用它当「狙击充能条」，不用为了一个新机制再动一次界面。
     *   （法力条满 = 蓄力即将开始。）
     */
    function tickCadence(u) {
      if (u.cadenceEvery <= 0 || !u.alive) return;
      u.skillCadence++;
      u.mana = U.round2(Math.min(u.maxMana, u.maxMana * u.skillCadence / u.cadenceEvery));
    }

    /**
     * 治疗。
     *
     * 这里有个很容易踩、而且很久以后才会发现的坑：
     * 如果「回复 0.4 点血」这种不足 1 点的收益直接改了血量却不写日志，
     * 事件流就和真实血量悄悄对不上了。回放、血条同步、批量校验都会慢慢漂移。
     * 所以先攒进 healPool，攒够 1 点才真正生效并记账。
     *
     * 推论：日志里任何一次治疗，amount 都必然 > 0 —— 校验程序可以放心断言这一点。
     */
    /**
     * 「天皇」的随身光环：孙笑川 3×3 内的**队友**（不含他自己）+20% 吸血率。
     *
     * ★ 按需计算，不每 tick 写进别人身上：走位随时改变谁在圈里，
     *   写字段就得每 tick 维护"谁进谁出"，还要处理两个孙笑川的光环重叠。
     *   按需算 = 永远不会不一致（moveMul / slowMul 也是这个套路）。
     * ★ 取**最大值**不叠加：圈里站两个孙笑川也只给 +20%。
     * ★ 不含自己：和奶龙 3 星的「笑传四方」同一个约定（`a === u` 跳过），
     *   因为文案写的是"队友"。
     */
    function mikadoBonus(dst) {
      var mates = alliesOf(dst);
      for (var i = 0; i < mates.length; i++) {
        var m = mates[i];
        if (!m.alive || m === dst || !(m.mikadoLifesteal > 0)) continue;
        if (U.cheb(m.r, m.c, dst.r, dst.c) > m.mikadoAura) continue;
        return m.mikadoLifesteal;
      }
      return 0;
    }

    /**
     * 这个单位实际吃到的吸血率（装备 + 天皇光环）。
     * ★ 封顶 100%：不然"吸血 ≥ 伤害"会让一个单位变成永动机
     *   （血饮剑 20% + 光环 20% 只有 40%，远没到，但把盖子写在这儿最省心）。
     */
    function lifestealOf(u) {
      var v = u.lifesteal + mikadoBonus(u);
      return v > 1 ? 1 : v;
    }

    function healUnit(src, dst, amount, reason) {
      if (!dst.alive || !(amount > 0)) return 0;
      var room = dst.maxHp - dst.hp;
      if (room < 1) { dst.healPool = 0; return 0; }   // 基本满血，别攒着，免得以后一次性放个大数字

      dst.healPool += amount;
      if (dst.healPool < 1) return 0;

      var give = dst.healPool < room ? dst.healPool : room;
      var before = dst.hp;
      dst.hp = U.round2(dst.hp + give);
      dst.healPool = 0;
      var real = U.round2(dst.hp - before);
      if (src) src.healing += real;
      if (real > 0) {
        ev({ type: 'heal', from: src ? src.uid : null, to: dst.uid,
             amount: real, hpAfter: dst.hp, hpMax: dst.maxHp, reason: reason || 'skill' });
        /* ★ 星级被动「幻觉 / 开智」的触发点。
         *
         *   放在**写出 heal 事件之后**，事件流里就是 heal → gift 的顺序，
         *   回放看得懂，校验器也能直接要求「gift 必须紧跟同一 tick 的一次治疗」。
         *
         *   条件是 real > 0（真的回了血）而不是 amount > 0：
         *   一口被 healPool 攒住的奶（不足 1 点）或者奶在满血的人身上，
         *   实际上什么都没发生，不该白送一次被动。 */
        giftAfterHeal(src, dst);
      }
      return real;
    }

    /**
     * 星级被动「幻觉 / 开智」：奶完一口，给被治疗的人挂一个伤害改动。
     *
     *   2 星「幻觉」 rng.chance(0.5)：好结果增伤 20%，坏结果减伤 20%
     *   3 星「开智」 不掷骰子，必定增伤 20%
     *
     * ★ 只对**同阵营**生效（"使队友"）。野性回血之类 src 为 null 的不会被触发；
     *   吸血把 src 和 dst 都指向自己时也算同阵营 —— 那是玩家自己给她配的装备，
     *   属于合理的联动，不是漏洞。
     */
    function giftAfterHeal(src, dst) {
      if (!src || !dst || !src.alive) return;
      if (!(src.giftPct > 0)) return;
      if (dst.side !== src.side) return;

      var good = src.giftSure || rng.chance(src.giftChance);
      var mul = good ? (1 + src.giftPct) : (1 - src.giftPct);
      // ★ 存进去的和写进日志的必须是同一个数，否则「日志 = 真相」这条根基就断了
      mul = U.round2(mul);
      dst.buffMul = mul;
      dst.buffUntil = st.t + src.giftDur;
      if (good) src.giftGood++; else src.giftBad++;
      ev({ type: 'gift', from: src.uid, to: dst.uid, good: good,
           mul: mul, skill: passiveName(src.def, src.star),
           until: round3(dst.buffUntil) });
    }

    function addShield(src, dst, amount) {
      if (!dst.alive) return;
      var real = Math.round(amount);
      dst.shield = U.round2(dst.shield + real);
      if (src) src.shielding += real;
      ev({ type: 'shield', from: src ? src.uid : null, to: dst.uid,
           amount: real, shieldAfter: dst.shield, reason: 'skill' });
    }

    function checkDeath(u) {
      if (!u.alive || u.hp > 0) return false;
      u.alive = false;
      u.hp = 0;
      u.shield = 0;
      st.occ[u.r * CFG.COLS + u.c] = null;
      st.aliveCount[u.side]--;
      // 击杀统计：最后打它的人
      if (u._lastHitBy && u._lastHitBy.alive) {
        u._lastHitBy.kills++;
        /* ★ 「锁头」（Dank1ng 3 星）：击杀敌人**自动回满能量**。
           ★ 放在击杀统计这里，而不是塞进技能分支 —— 「击杀」不等于"被技能打死"：
             普攻打死的、反伤弹死的、坠机砸死的都算。挂在 checkDeath 上，
             所有死法一视同仁。
           ★ 顺带写事件：法力条瞬间回满这件事玩家必须看得见，
             否则"怎么又放了一发"会变成一个读不出来的现象。 */
        if (u._lastHitBy.killRefill) {
          u._lastHitBy.mana = u._lastHitBy.maxMana;
          ev({ type: 'refill', who: u._lastHitBy.uid, to: u.uid,
               mana: u._lastHitBy.maxMana, reason: 'kill' });
        }
      }
      ev({ type: 'death', who: u.uid, side: u.side, r: u.r, c: u.c,
           /* ★ 带上击杀者。加它是因为 Dank1ng 的「锁头」要验
              "能量回满必须紧跟在自己的一次击杀之后" —— 没有这一列，
              "谁杀的"在事件流里根本读不出来（回放也只能写"X 阵亡了"）。 */
           by: (u._lastHitBy && u._lastHitBy.alive) ? u._lastHitBy.uid : null });
      /* ★ 星级被动「坠机」：牢大不会就这么算了。
         阵亡的这一刻只是**开始计时**，1 秒后直升机才落地。
         注意这里不能改 aliveCount 的最终结果 —— 它在倒下的瞬间就已经 -1 了，
         胜负判定那边靠 anyPending() 把这一秒的账挂起来（见主循环）。
         ★ 羊帆 3 星的「巅峰谢幕」走的是**同一条管线**（倒下 → 1 秒 → 3×3 爆炸），
           所以触发条件是两个字段之一，不是只认 crashDamage。 */
      if (u.crashDamage > 0 || u.boomAdMult > 0) {
        u.downUntil = st.t + CFG.CRASH_DELAY;
        u.crashR = u.r; u.crashC = u.c;
        ev({ type: 'down', who: u.uid, r: u.r, c: u.c,
             delay: CFG.CRASH_DELAY, until: round3(u.downUntil),
             /* ★ 是"自爆"还是"坠机"要分清楚：
                两者的规则完全一样，但画面上一个是直升机砸下来、一个是原地蓄力炸开，
                校验器也要知道该按哪一套参数去对账。 */
             boom: u.boomAdMult > 0,
             // ★ 复活次数用完了就如实写 false —— 界面靠它决定要不要画"还会站起来"的暗示
             revive: canRevive(u) });
      }
      /* ★ 老牧师「临终祷告」：这是不是**第一个**倒下的队友？
         放在坠机那一段之后 —— 两者不冲突：牢大既可能自己站起来，
         也可能被老牧师拉回来，各走各的事件。 */
      /* ★ 孙笑川「安排上了」：被他击败的敌人**倒戈**过来。
       *
       * ★★ 必须排在 lastRitesOnDeath **之前**，这是一个真实的冲突：
       *   招安是**立刻**把人变成我方单位，而临终祷告是 1 秒后才结算。
       *   先让牧师开始祷告、再招安的话，1 秒后那次祷告会把一个
       *   **已经活着、而且已经在我方阵营**的单位再"救"一次 ——
       *   复活到一个已经不是它阵营的半场，aliveCount 也会被 +1 两次。
       *   所以顺序是：能招安就招安，招安了就不再有"临终"这回事。 */
      if (mikadoConvert(u)) return true;
      lastRitesOnDeath(u);
      return true;
    }

    /**
     * 孙笑川 3 星「安排上了」：把刚被自己打死的敌人变成我方单位。
     *
     * 三个排除条件（需求里的"对有复活技能的单位无效"），缺一个都会出怪事：
     *   ① `canRevive`：它自己还有复活次数（牢大 / 羊帆）——
     *      招安它等于把它从"自己的复活"里抢走，而且事件流上两边会打架；
     *   ② `downUntil >= 0`：已经倒在地上等结算（正在走坠机 / 自爆）——
     *      同上，它 1 秒后还有自己的事要做；
     *   ③ `everRevived`：**已经复活过一次的**（老牧师救回来的、或之前被招安过的）——
     *      没有这一条，一个被牧师救活的人可以被无限招安，变成永动机。
     *
     * ★ 另外两层"能不能"：击杀者必须是**孙笑川本人**（`_lastHitBy`），
     *   而且我方半场要**有空位**（招安是"把它拉到我这边站好"，
     *   没地方站就只能作罢 —— 和牢大复活、临终祷告用的是同一个 freeCellNear）。
     */
    function mikadoConvert(dying) {
      var killer = dying._lastHitBy;
      if (!killer || !killer.alive || !killer.convertOnKill) return false;
      if (dying.everRevived) return false;
      if (dying.downUntil >= 0) return false;
      if (canRevive(dying)) return false;
      if (killer.side === dying.side) return false;      // 理论上不可能，防一手
      var cell = freeCellNear(dying.r, dying.c, killer.side);
      if (!cell) return false;

      var fromSide = dying.side;
      /* ★★ 换阵营不只是改一个字段：`alliesOf` / `enemiesOf` / `buildOrder`
       *   读的都是 `st.side[side]` 这两个**数组**。
       *   只改 u.side 不挪数组的话，这个单位的"队友"会变成它原来的队友，
       *   下个 tick 的行动顺序也会错位 —— 而且不会有任何报错。 */
      var arr = st.side[fromSide];
      var at = arr.indexOf(dying);
      if (at >= 0) arr.splice(at, 1);
      st.side[killer.side].push(dying);

      dying.side = killer.side;
      dying.alive = true;
      dying.hp = U.round2(dying.maxHp * (killer.convertHpPct || 0.2));
      dying.shield = 0;
      dying.mana = 0; dying.manaFromDmg = 0; dying.healPool = 0;
      dying.atkTimer = 0; dying.moveTimer = 0;
      dying.stunUntil = -1; dying.asBuffPct = 0; dying.asBuffUntil = -1;
      dying.rootUntil = -1;
      dying.buffMul = 1; dying.buffUntil = -1;
      dying.chillStacks = 0;
      dying.ritesUntil = -1; dying.ritesBy = null;
      dying.target = null;
      dying._lastHitBy = null;
      dying.converted = true;      // 卡面变灰（渲染层靠这个）
      dying.everRevived = true;    // 招安过的不能再被招安
      dying.r = cell.r; dying.c = cell.c;
      st.occ[cell.r * CFG.COLS + cell.c] = dying;
      st.aliveCount[killer.side]++;   // 另一方在 checkDeath 里已经 -1 过了

      ev({ type: 'convert', from: killer.uid, who: dying.uid,
           fromSide: fromSide, toSide: killer.side,
           r: dying.r, c: dying.c, hp: dying.hp, hpMax: dying.maxHp,
           defId: dying.defId, name: dying.name });
      return true;
    }

    /**
     * 有队友倒下了 —— 找一个还活着、这一局还没用过的老牧师。
     *
     * ★ 施法者必须是**别人**（`p !== u`）：老牧师救不了自己。
     *   所以他自己第一个倒下时这个被动就白瞎了 —— 这是有意保留的，
     *   不然"先送谁"这个决策点就没了。
     * ★ 同一方有多个老牧师时按 st.units 的固定顺序取第一个，**不用随机** ——
     *   引擎里除了 makeRng 不许有别的随机源（那是"同 seed 必然同结果"的前提）。
     * ★ 这里只**开始计时**，不立刻把人拉起来：真正的复活在 lastRitesTick 里，
     *   和牢大"倒下 → 1 秒 → 落地"是同一套节奏。
     */
    function lastRitesOnDeath(u) {
      if (u.ritesUntil >= 0) return;
      var priest = null;
      for (var i = 0; i < st.units.length; i++) {
        var p = st.units[i];
        if (p === u || !p.alive) continue;
        if (p.side !== u.side) continue;
        if (!p.ritesOn || p.ritesUsed) continue;
        priest = p;
        break;
      }
      if (!priest) return;
      priest.ritesUsed = true;
      u.ritesUntil = st.t + priest.ritesDelay;
      u.ritesBy = priest.uid;
      u.ritesCarryHp = priest.ritesHpPct;
      u.ritesCarryAd = priest.ritesAdPct;
      ev({ type: 'lastRites', from: priest.uid, to: u.uid, side: u.side,
           r: u.r, c: u.c, delay: priest.ritesDelay,
           until: round3(u.ritesUntil), hpPct: u.ritesCarryHp,
           adPct: u.ritesCarryAd });
    }

    /**
     * 祷告结算：到点了就把人拉起来。
     *
     * ★ 和牢大的坠机复活**共用 freeCellNear** —— 于是"原地站起来"是免费得到的：
     *   freeCellNear 首先就返回原格（只要它还空着、还在自己半场）。
     *   而"必须在自己半场"这条规则在这里同样必要：队友很可能死在对面半场。
     * ★ 自己半场被占满时救不回来。**这一条必须写进事件**（ok:false）：
     *   不写的话，"牧师用掉了被动、队友却没起来"在日志里完全读不出来。
     */
    function lastRitesTick() {
      for (var i = 0; i < st.units.length; i++) {
        var u = st.units[i];
        if (u.ritesUntil < 0 || st.t < u.ritesUntil) continue;
        u.ritesUntil = -1;
        var hpPct = u.ritesCarryHp > 0 ? u.ritesCarryHp : 1;
        var adPct = u.ritesCarryAd || 0;
        var cell = freeCellNear(u.r, u.c, u.side);
        if (!cell) {
          ev({ type: 'reviveAlly', from: u.ritesBy, who: u.uid, side: u.side,
               r: u.r, c: u.c, hp: 0, hpMax: u.maxHp, ok: false,
               adPct: adPct, blessed: [] });
          continue;
        }
        u.alive = true;
        u.hp = U.round2(u.maxHp * hpPct);
        u.shield = 0;
        u.mana = 0; u.manaFromDmg = 0; u.healPool = 0;
        u.atkTimer = 0; u.moveTimer = 0;
        u.stunUntil = -1; u.asBuffPct = 0; u.asBuffUntil = -1;
        u.rootUntil = -1;      // 重新站起来的人不该还捆着粉丝
        u.buffMul = 1; u.buffUntil = -1;
        /* ★ 记下"它被复活过"—— 孙笑川 3 星的招安对**已经复活过**的单位无效
           （需求里那句"老牧师复活的人"就是这么落地的）。 */
        u.everRevived = true;
        u.r = cell.r; u.c = cell.c;
        st.occ[cell.r * CFG.COLS + cell.c] = u;
        st.aliveCount[u.side]++;

        /* ★ 3 星「圣光赐福」：被救的人 + 老牧师，攻击力一起 +20%。
           ★ 老牧师在这一秒里被打死了就**不给他加** —— 给死人加攻击力是假的，
             而且事件里要如实写清"这个 buff 到底落在谁身上"（blessed 只列真加上的）。
           ★ 复活不清空 adBonusPct：它和 buffMul 那种"限时倍率"不一样，
             是**本局永久**的加成，站起来应该还在。 */
        var blessed = [];
        if (adPct > 0) {
          u.adBonusPct = U.round2(u.adBonusPct + adPct);
          blessed.push(u.uid);
          var p = null;
          for (var k = 0; k < st.units.length; k++) {
            if (st.units[k].uid === u.ritesBy) { p = st.units[k]; break; }
          }
          if (p && p.alive) {
            p.adBonusPct = U.round2(p.adBonusPct + adPct);
            blessed.push(p.uid);
          }
        }
        ev({ type: 'reviveAlly', from: u.ritesBy, who: u.uid, side: u.side,
             r: u.r, c: u.c, hp: u.hp, hpMax: u.maxHp, ok: true,
             adPct: adPct, blessed: blessed });
      }
    }

    /**
     * 暗影的解除：**只剩自己一个人的时候必须现形**。
     *
     * ★★ 这不是风味，是**终止条件**。
     *   一个"免疫一切伤害 + 不会被索敌"的单位如果永远不现形，
     *   对面的棋子既打不到它、也打不死它 —— 这场战斗就只能拖到
     *   60 秒读秒判平局。而玩家的直觉是"队友都死了，你该出来了"，
     *   所以这条规则同时满足了两边。
     *
     * ★ 判定用 aliveCount[自己的阵营] <= 1：它自己算一个，
     *   所以"<= 1"就是"没有活着的队友了"。
     */
    function shadowTick() {
      for (var i = 0; i < st.units.length; i++) {
        var u = st.units[i];
        if (!u.shadow) continue;
        if (st.aliveCount[u.side] > 1) continue;
        u.shadow = false;
        u.flash = 1;
        ev({ type: 'shadow', who: u.uid, on: false, side: u.side,
             asCut: u.shadowAsCut, dmgMul: u.shadowDmgMul,
             mates: 0 });
      }
    }

    /**
     * 「空悲切」（Dank1ng 1 星）：**所有队友阵亡之后立刻恢复无限能量**。
     *
     * ★ 判定条件就是 `aliveCount[自己这方] <= 1`（自己算一个）。
     * ★ 它是**双向**的：队友全死光 → 开；如果队友又活过来（牢大 2 星起会复活），
     *   → 关。只开不关的话，"队友全死光"这个前提就变成一个永久 buff 了，
     *   而它本来是一句**绝境**被动。
     * ★ 开启的那一刻法力直接顶满（"立刻"），之后靠 gainMana 维持
     *   （见 gainMana 里的说明：不这么写就会变成一秒 30 发）。
     * ★ 放在 shadowTick 之后、胜负判定之前：它读的也是 aliveCount，
     *   而 aliveCount 刚刚才被 pendingTick 里的复活改过。
     */
    function loneWolfTick() {
      for (var i = 0; i < st.units.length; i++) {
        var u = st.units[i];
        if (!u.loneWolf || !u.alive) continue;
        var alone = (st.aliveCount[u.side] <= 1);
        if (alone === u.endlessMana) continue;
        u.endlessMana = alone;
        if (alone) {
          u.endless++;
          u.mana = u.maxMana;                 // 「立刻」
          u.flash = 1;
        }
        ev({ type: 'endless', who: u.uid, on: alone, side: u.side,
             mana: u.mana, maxMana: u.maxMana,
             mates: Math.max(0, st.aliveCount[u.side] - 1) });
      }
    }

    /** 还有没有「已经倒下、但结算没走完」的单位（坠机还没落地 / 祷告还没做完） */
    function anyPending() {
      for (var i = 0; i < st.units.length; i++) {
        var pu = st.units[i];
        /* ★ 两种"倒下但还没结算完"，都要把账挂起来：
             downUntil   牢大 / 羊帆：自己的坠机、自爆
             ritesUntil  老牧师正在给别人做临终祷告（**被救的是别人**） */
        if (pu.downUntil >= 0 || pu.ritesUntil >= 0) return true;
      }
      return false;
    }

    /**
     * 这个单位现在还能不能复活。
     * ★ 一局只有 maxRevives 次（现在是 1）——
     *   所以**坠机每次都照打，复活只给一次**：
     *   坠机是 1 星就有的被动，不该因为复活用完了就跟着消失。
     */
    function canRevive(u) {
      return !!(u.revives && u.revivesUsed < u.maxRevives);
    }

    /**
     * 在 (r,c) 附近找一个**自己半场**的空格（优先原地，其次向外扩散）；找不到返回 null。
     *
     * ★★ 这里有两个必须同时满足的条件，缺一个都会破坏先手公平性：
     *
     *   ① **半场**：牢大很可能死在对面半场（打起来之后棋子会越过中线），
     *      而复活必须回到自己这边 —— 少了这一句阵营规则就被破了。
     *   ② **平局定序要镜像**：候选格按 (切比雪夫距离, 曼哈顿距离) 排序，
     *      但两者都打平时如果按"行号小的优先"，A 方会挑到自己半场**后排**、
     *      B 方会挑到自己半场**前排**（因为 B 的半场行号大）。
     *      一个复活在后排、一个复活在前排，镜像对局的胜率立刻变成 61%:39%。
     *      所以第三关键字用 mirrorTie —— 和寻路那边定序用的是同一套规则。
     */
    function freeCellNear(r, c, side) {
      if (inBounds(r, c) && sideOfRow(r) === side && !occupiedAt(r, c)) return { r: r, c: c };
      var best = null, bestCheb = 1e9, bestMan = 1e9, bestTie = 1e9;
      for (var rr = 0; rr < CFG.ROWS; rr++) {
        if (sideOfRow(rr) !== side) continue;
        for (var cc = 0; cc < CFG.COLS; cc++) {
          if (occupiedAt(rr, cc)) continue;
          var dc = U.cheb(rr, cc, r, c);
          var dm = Math.abs(rr - r) + Math.abs(cc - c);
          var tie = mirrorTie(side, rr, cc);
          if (dc < bestCheb ||
              (dc === bestCheb && dm < bestMan) ||
              (dc === bestCheb && dm === bestMan && tie < bestTie)) {
            bestCheb = dc; bestMan = dm; bestTie = tie;
            best = { r: rr, c: cc };
          }
        }
      }
      return best;
    }

    /**
     * 坠机结算：把到点的「倒下」单位处理掉 —— 直升机落地、可选复活。
     *
     * ★ 顺序是刻意的：**先炸，再复活**。
     *   复活的牢大站在自己的坠机点上是安全的（伤害只打敌人），
     *   但如果反过来先复活、再结算伤害，它就会站在自己刚砸出来的坑里
     *   被自己的爆炸打一下 —— 那不是设计意图，是顺序问题。
     */
    function pendingTick() {
      /* ★ 按 buildOrder 的顺序处理，而不是按 st.units 的原始顺序。
         st.units 是「A 方全部，然后 B 方全部」—— 两边的牢大如果在同一 tick
         一起倒下，A 方的坠机永远先结算，先手优势会从这里漏进来。
         用交错顺序就和行动顺序是同一套对称规则了。 */
      var queue = buildOrder(st.tick);
      for (var qi = 0; qi < queue.length; qi++) {
        var u = queue[qi];
        if (u.downUntil < 0 || st.t < u.downUntil) continue;
        u.downUntil = -1;

        /* ---------- ① 直升机坠毁：3×3 物理伤害 ----------
         * ★ 伤害类型是**物理**，不是真实伤害 —— 这是量出来的结论，不是随手写的。
         *
         *   一开始用的是真实伤害（理由很顺：环境伤害不该被护甲挡住）。
         *   结果 levelcurve 直接报「20 关太水（+74%）、21 关 +36%、22 关 +52%」：
         *   900 点**无视防御**的伤害刚好卡在这些关卡敌人血量的门槛上，
         *   一砸就是一片，难度余量出现断崖。
         *   换成物理（吃护甲）之后同一条曲线变成 20 关 +12%、21 关 +19%、22 关 +35%，
         *   而且后半程重新比前半程更紧。
         *
         *   物理也**更合理**：被一架直升机砸中是实打实的撞击，该吃护甲；
         *   「无视防御」留给讲话石那种「你打我我就原样还你」的机制。
         *
         *   它只在牢大**阵亡**时发生一次，是复仇而不是常规输出 ——
         *   所以不必追求"稳定打满"，被打不动才是应该的。 */
        var cr = u.crashR, cc = u.crashC;
        /* ★ 「巅峰谢幕」（羊帆 3 星）：伤害不是固定值，而是**攻击力 × 20**。
           ★ 在爆发那一刻算，而不是在倒下那一刻算：中间那 1 秒里
             攻击力还可能被雪毙之类的加成改掉，取爆发瞬间的面板才自洽。
           ★ 和牢大一样是**物理**伤害（吃护甲），理由见下面那段长注释。 */
        var boom = u.boomAdMult > 0;
        var boomDmg = boom ? U.round2(u.ad * u.boomAdMult) : u.crashDamage;
        var radius = boom ? u.boomRadius : CFG.CRASH_RADIUS;
        ev({ type: 'crash', who: u.uid, r: cr, c: cc,
             dmg: boomDmg, radius: radius, side: u.side,
             boom: boom, stun: boom ? u.boomStunDur : 0 });
        var list = st.units.slice();
        for (var j = 0; j < list.length; j++) {
          var e = list[j];
          if (!e.alive || e.side === u.side) continue;
          if (U.cheb(e.r, e.c, cr, cc) > radius) continue;
          var res = dealDamage(u, e, boomDmg, 'phys');
          ev({ type: 'damage', from: u.uid, to: e.uid, dmg: res.dmg, kind: 'phys',
               hpAfter: e.hp, hpMax: e.maxHp, hpLoss: res.hpLoss,
               shieldLoss: res.shieldLoss, reason: 'crash' });
          checkDeath(e);
        }
        /* ★ 自爆的附赠：把九宫格里活下来的人震晕 3 秒（同样会哈哈大笑）。
           ★ 必须**炸完一圈之后**再统一结算眩晕：先在循环里晕人的话，
             某个被打死的人会先拿到一条 stun、再拿到一条 death，
             事件流顺序读起来是"先晕后死"，而真实发生的是"先死"。
           和「男人领域」那边是同一个判断（先打完再结算控制）。 */
        if (boom && u.boomStunDur > 0) {
          u.booms++;
          for (var s2 = 0; s2 < list.length; s2++) {
            var se2 = list[s2];
            if (!se2.alive || se2.side === u.side) continue;
            if (U.cheb(se2.r, se2.c, cr, cc) > radius) continue;
            se2.stunUntil = Math.max(se2.stunUntil, st.t + u.boomStunDur);
            ev({ type: 'stun', from: u.uid, to: se2.uid, dur: u.boomStunDur,
                 until: round3(se2.stunUntil), reason: 'peak',
                 targets: [se2.uid], count: 1, durMul: 1,
                 skill: '巅峰谢幕' });
          }
        }

        /* ---------- ② 复活（2 星起，一局只有 maxRevives 次） ----------
         * ★ 次数用完之后**坠机照打、只是不再站起来** ——
         *   坠机是 1 星就有的被动，不该跟着复活的次数一起消失。
         *   所以第二次阵亡的表现是：倒下 → 1 秒 → 直升机落地 → 就此退场。 */
        if (!canRevive(u)) continue;
        var cell = freeCellNear(cr, cc, u.side);
        if (!cell) continue;                 // 自己半场全被占满，这一局就真没了
        u.revivesUsed++;
        u.alive = true;
        u.hp = U.round2(u.maxHp * u.reviveHpPct);
        u.shield = 0;
        u.mana = 0; u.manaFromDmg = 0; u.healPool = 0;
        u.atkTimer = 0; u.moveTimer = 0;
        u.stunUntil = -1; u.asBuffPct = 0; u.asBuffUntil = -1;
        u.rootUntil = -1;      // 同上：被牧师救活的人不该继续被粉丝捆着
        u.buffMul = 1; u.buffUntil = -1;
        u.r = cell.r; u.c = cell.c;
        st.occ[cell.r * CFG.COLS + cell.c] = u;
        st.aliveCount[u.side]++;

        /* ---------- ③ 复活后技能冷却减半（3 星） ----------
         * 这个游戏没有「冷却」，法力就是冷却 ——
         * 所以「CD -50%」在这里的实现是**技能所需法力减半**，
         * 也就是出手频率翻倍。写进事件里让界面能显示出来。 */
        var need = u.maxMana;
        if (u.cdCut) {
          u.maxMana = U.round2(u.maxMana * (1 - u.cdCutPct));
          need = u.maxMana;
        }
        ev({ type: 'revive', who: u.uid, r: u.r, c: u.c,
             hp: u.hp, hpMax: u.maxHp, side: u.side,
             cdCut: u.cdCut, maxMana: u.maxMana });
      }
    }

    /** 一次伤害之后的所有连锁反应 */
    function afterDamage(src, dst, res, kind, attackerGetsMana) {
      // 受击回蓝
      dst.manaFromDmg += res.dmg;
      while (dst.manaFromDmg >= CFG.MANA_PER_DAMAGE && dst.alive) {
        dst.manaFromDmg -= CFG.MANA_PER_DAMAGE;
        gainMana(dst, 1);
      }
      if (attackerGetsMana && src && src.alive) gainMana(src, CFG.MANA_PER_ATTACK);

      // 吸血（只对普攻生效，避免技能吸血滚雪球）
      /* ★ 走 lifestealOf 而不是直接读 src.lifesteal ——
         孙笑川「天皇」的光环是按位置**实时**算的，不能等到这里才去写字段。
         ★ 仍然只对普攻（kind === 'phys'）生效：技能吸血是孙笑川 2 星的
           专属效果，走的是另一条路（skillDamage 里的 'skillHeal'），
           不能让所有法师都跟着吸。 */
      var lsPct = src ? lifestealOf(src) : 0;
      if (src && src.alive && lsPct > 0 && kind === 'phys' && res.dmg > 0) {
        healUnit(src, src, res.dmg * lsPct, 'lifesteal');
      }
      /* ---------- 讲话石（原荆棘之甲）：范围反弹 ----------
       *
       * ★ 从「只反弹给打它的那一个」改成「对 3×3 范围内的所有敌人反弹」：
       *   · 3×3 = 以佩戴者为中心、切比雪夫距离 <= 1 的九宫格
       *   · 触发条件从「只算物理」放宽到「受到任何伤害」
       *     （「受到伤害」本来就不该分物理法术；而且只反弹物理的话，
       *      对面一套法术阵容就能让这件装备完全失效 —— 这正是它一直垫底的原因）
       *   · 伤害类型是 'true'（不吃护甲魔抗）—— 反弹不该被对面的防御属性再削一次
       *
       *   注意它**不会再触发一次 afterDamage**：反弹本身不引发连锁反弹，
       *   所以两个人各带一块讲话石也不会互相弹到天荒地老。
       */
      if (dst.thornPct > 0 && res.dmg > 0) {
        var near = enemiesOf(dst);
        for (var ti = 0; ti < near.length; ti++) {
          var tv = near[ti];
          if (!tv.alive) continue;
          if (U.cheb(tv.r, tv.c, dst.r, dst.c) > CFG.THORN_RADIUS) continue;
          var back = dealDamage(dst, tv, res.dmg * dst.thornPct, 'true');
          tv._lastHitBy = dst;
          /* ★ 这里必须把 shieldLoss / hpLoss 一起写出来：
             少了这两个字段，校验器就不知道这次反弹吃掉了多少护盾，
             之后那个人身上再出现护盾事件时，会看到「护盾反而变小」，
             被误判成 bug。（护盾厚的棋子一多就容易踩到，比如 380 盾的鸭子。） */
          ev({ type: 'damage', from: dst.uid, to: tv.uid, dmg: back.dmg,
               kind: 'true', shieldLoss: back.shieldLoss, hpLoss: back.hpLoss,
               hpAfter: tv.hp, hpMax: tv.maxHp, reason: 'thorn' });
          // ★ 反弹可能直接打死人，必须自己判一次死亡：
          //   原来只反弹给攻击者，那次死亡由下面统一的 checkDeath(src) 兜住了；
          //   现在受害者可能不是攻击者，漏掉就会留下「血量 0 但还活着」的僵尸。
          checkDeath(tv);
        }
      }

      if (dst.alive && res.dmg > 0) dst._lastHitBy = src || null;

      checkDeath(dst);
      if (src) checkDeath(src);

      /* ★ 星级被动「兽性 / 野性」：受伤之后回血。
       *
       *   放在这里（而不是 dealDamage 里面）有两个硬理由：
       *   ① 日志自洽：attackOnce 是在 dealDamage 之后才读 target.hp 写进
       *      「hpAfter」的。如果在 dealDamage 里回血，写出来的 hpAfter 就含了
       *      这次回血、而同一事件的 hpLoss 不含 —— 那条最有力的自检
       *      「hpLoss 必须等于血量差」立刻会炸。
       *   ② 阵亡的棋子不该被这一下「救回来」：checkDeath 已经跑完，
       *      healUnit 开头就会因为 !dst.alive 直接返回。
       */
      if (dst.alive && dst.hurtHealPct > 0 && res.hpLoss > 0) {
        healUnit(null, dst, dst.maxHp * dst.hurtHealPct, 'passive');
      }

      tryCast(dst);
      if (src) tryCast(src);
    }

    /* ---------- 普攻 ---------- */
    function attackOnce(u, target) {
      var crit = rng.chance(u.critChance);
      // ★ 攻击力加成（雪毙）单独存，不改 u.ad ——
      //   改了的话日志里的 raw 就和初始快照里的 ad 对不上了
      var raw = u.ad * (1 + u.adBonusPct) * (crit ? u.critMult : 1);
      /* ★★ 「羊巅峰」：蓄势好的那一下翻 20 倍。
       *
       *   ★ 它乘在 **raw** 上（也就是"本该打出多少"），而不是直接改 dmg。
       *     这样日志里 raw/dmg 的关系、以及「raw >= dmg」那条自检全都继续成立，
       *     而玩家在飘字里看到的 dmg 会自然变成 20 倍（减伤照常吃）。
       *   ★ 放在暴击**之后**：两个倍率连乘，所以巅峰一击暴击就是 30 倍。
       *     顺序不影响数值，但写在后面读起来就是"先算这一下、再看它是不是巅峰"。
       *   ★ 消耗在**出手那一刻**，不是命中那一刻 —— 打空（目标已经死了）也会被
       *     吃掉，和"自动寻敌不会浪费普攻"是同一个原则：一次蓄力换一次出手。 */
      var peak = false;
      if (u.peakCharge) {
        u.peakCharge = false;
        u.peakHits++;
        peak = true;
        raw *= u.peakMult;
      }
      /* ★ 「遁入暗影」（楚生疑犯 3 星）：暗影期间伤害翻倍。
         ★ 和巅峰一击一样乘在 raw 上（"本该打出多少"），
           raw/dmg 的关系和「raw >= dmg」那条自检都继续成立。
         ★ 只作用于**普攻**：这个技能本身一点伤害都没有（它是地形），
           所以"伤害翻倍"只能在这里兑现。 */
      if (u.shadow) raw *= u.shadowDmgMul;
      // ★ 范围普攻要按**出手那一刻**的目标位置算，所以先记下来：
      //   后面的 afterDamage 里目标可能被反伤打死，位置虽然不会变，
      //   但把"圆心"定死在出手瞬间更不容易出意外。
      var cR = target.r, cC = target.c;
      var res = dealDamage(u, target, raw, 'phys');
      /* ★ 计数型技能的充能放在写日志**之前**：这样 attack 事件里的 manaAfter
         就是玩家这一帧在法力条上真正看到的那个值（不写事件，只改状态，
         所以不影响事件流的顺序）。 */
      tickCadence(u);
      // 日志里的血量/伤害一律写精确值，不做四舍五入 ——
      // 取整会让「hpLoss 必须等于血量差」这条最有力的自检失效。
      // 要好看是渲染层的事（Math.round 一下就行）。
      ev({ type: 'attack', from: u.uid, to: target.uid,
           dmg: res.dmg, raw: res.effective, crit: crit, ramp: U.round2(res.ramp),
           /* ★ 巅峰一击单独标出来（和 crit 一样是"这一下不一样"的标记）。
              校验器靠它验「×20 必须紧跟在一次蓄力之后」，
              渲染层靠它画那一下的爆发特效。 */
           peak: peak, peakMult: peak ? u.peakMult : 1,
           shieldLoss: res.shieldLoss, hpLoss: res.hpLoss,
           hpAfter: target.hp, hpMax: target.maxHp,
           /* ★ 法力条的三个含义：法力型 = 攒了多少蓝；
              计数型 = 还差几次普攻；纯 CD 型 = 冷却进度。
              后两种普攻都**不加蓝**（gainMana 直接返回），
              所以这里必须原样报 u.mana —— 报一个"设想法力型会加多少"
              会让回放里的冷却条每次普攻都往上跳一格。 */
           manaAfter: U.round1(u.cadenceEvery > 0 || u.cdSeconds > 0
             ? u.mana
             : Math.min(u.maxMana, u.mana + CFG.MANA_PER_ATTACK)) });
      afterDamage(u, target, res, 'phys', true);
      applyChill(u, target);
      /* ★ 电棍「导电」：普攻命中也留一道电流（技能那条在 skillDamage 里）。
         ★ 放在 afterDamage **之后**：那里才判完死亡，
           往一个刚被打死的目标身上挂电流是没意义的。 */
      spawnCurrent(u, target);

      /* ★★ 美团袋鼠 3 星「好评如潮」：**每一次普攻**都往"被打中的那个敌人
       *   周围 3×3"送一单，给自己人各回 4% 最大生命。
       *   ★ 放在 afterDamage **之后**：那里才判完死亡，也才走完反伤 ——
       *     圆心用的是出手那一刻记下的 cR/cC，所以目标死了也照样送。
       *   ★ 只挂在 attackOnce（**普攻**）上，不挂 skillDamage：
       *     需求写的是"普通攻击会治疗"，技能那条线上不该白送一次治疗。
       *     （电棍的电流是"普攻和技能都留"，所以它挂在 skillDamage 里 ——
       *      两条需求不一样，别照抄。） */
      if (u.deliveryHealPct > 0) deliveryHeal(u, cR, cC);
      /* ★★ 东北雨姐 3 星「雨姐的关照」：这一下打的是不是**被捆住的**人？
       *   是的话，顺手给血量最低的队友灌一大口。
       *   ★ 放在 deliveryHeal 之后、和它并列 —— 两条被动都是"普攻附带一件事"，
       *     谁先谁后不影响结果（回血对象不同、也不共享任何状态）。
       *   ★ 用 `target`（不是 cR/cC）：这条判据是"打的是谁"，
       *     而 target 就是这个对象；它的 rootUntil 是打之前的状态。
       *     注意这里要判 target.alive —— 这一下可能已经把它打死了，
       *     打死了就不算"打到了被捆住的人"（尸体的 rootUntil 没人读）。 */
      noodleHeal(u, target);

      /* ★★ 「笑上巅峰」（2 星起）：巅峰一击把目标打晕 3 秒。
       *
       *   ★ 放在 afterDamage **之后**：那里才判完死亡。
       *     被 20 倍打死的目标不该再吃一次眩晕 —— 尸体的 stunUntil 没人读，
       *     但会在事件流里留下一条指向死人的 stun，那是最容易骗过校验器的一种脏数据。
       *   ★ reason 写 'peak'：渲染层看到它就会冒「哈哈」，
       *     和嘉豪「男人领域」用的是同一套表现（见 arena.js 的 stun 分支）。 */
      if (peak && u.peakStunDur > 0 && target.alive) {
        target.stunUntil = Math.max(target.stunUntil, st.t + u.peakStunDur);
        ev({ type: 'stun', from: u.uid, to: target.uid, dur: u.peakStunDur,
             until: round3(target.stunUntil), reason: 'peak',
             targets: [target.uid], count: 1, durMul: 1, skill: u.def.skill.name });
      }

      /* ★ 「普通攻击改成 3×3 的 AoE」。
       *
       *   · 主目标照常走上面那条 attack 事件（它是"这一下打的是谁"）
       *   · 周围被扫到的敌人走 damage 事件，标 reason:'cleave'
       *   · 溅射**不给攻击者回蓝**（attackerGetsMana = false）——
       *     否则一发打三个人等于三倍回蓝，技能会滚雪球
       *   · 溅射会正常触发反伤 / 死亡 / 受击回蓝，所以必须走完整的 afterDamage */
      if (u.ocAoeRadius > 0) {
        var list = enemiesOf(u).slice();
        for (var i = 0; i < list.length; i++) {
          var e = list[i];
          if (e === target || !e.alive || !e.uid) continue;
          if (U.cheb(e.r, e.c, cR, cC) > u.ocAoeRadius) continue;
          var res2 = dealDamage(u, e, raw, 'phys');
          ev({ type: 'damage', from: u.uid, to: e.uid, dmg: res2.dmg, kind: 'phys',
               crit: crit, shieldLoss: res2.shieldLoss, hpLoss: res2.hpLoss,
               hpAfter: e.hp, hpMax: e.maxHp, reason: 'cleave' });
          afterDamage(u, e, res2, 'phys', false);
          applyChill(u, e);
        }
      }

      gainFrenzy(u);
      overclockOnHit(u);
    }

    /**
     * 冰冻一个人：`stunUntil` 往后推 + 发一条 stun 事件。
     *
     * ★★ 这是**所有冰冻的唯一出口**（巧乐兹攒满层 / 冰冰冰的技能）。
     *   两个来源都写一遍的话，"取 max 而不是覆盖""until 落在未来"
     *   这类细节迟早对不上 —— 而且冰冻这条路上踩过一次同类的坑
     *   （见 README 第 106 行：两条独立规则共用一个事件类型时，计时器不能共用）。
     *
     * ★ `reason` 必须分开（'freeze' / 'frost'）：校验器判"满层才冻"靠的是
     *   reason === 'freeze'，拿它去套技能冰冻就会报"还没攒满层就冰冻了"。
     *   事件类型仍然是同一个 —— 玩家看到的都是"被冻住"。
     */
    function freezeUnit(src, dst, dur, reason) {
      if (!dst || !dst.alive || !(dur > 0)) return false;
      /* ★ 取 max 不是覆盖：一个已经冻到第 3 秒的人，再吃一发 1.5 秒的
         不应该**缩短**他的冰冻时间。 */
      dst.stunUntil = Math.max(dst.stunUntil, st.t + dur);
      ev({ type: 'stun', from: src.uid, to: dst.uid, dur: dur,
           until: round3(dst.stunUntil), reason: reason });
      return true;
    }

    /**
     * 给一个单位挂一段**攻速加成**（到期自动失效，靠时间戳，不需要结束事件）。
     *
     * ★★ 这是所有攻速增益的唯一出口：双刃舞者的「疾风连斩」和
     *   美团袋鼠 2 星的「准时送达」都走它。
     *   ★ 百分比和到期时刻**各自取 max**，不是整体覆盖 —— 一个还剩 1 秒的
     *     +90% 不该被一个 +20% 顶掉，也不该把它的剩余时间清零。
     *     （和 `stunUntil` / `asBuffUntil` 那一套是同一个约定。）
     *   `srcUid` / `reason` 只进事件：回放和校验器要能分清
     *   "这是他自己开的技能"还是"这是别人送来的外卖"。
     */
    function grantAsBuff(dst, pct, dur, srcUid, reason) {
      if (!dst || !dst.alive || !(pct > 0) || !(dur > 0)) return false;
      dst.asBuffPct = Math.max(dst.asBuffPct, pct);
      dst.asBuffUntil = Math.max(dst.asBuffUntil, st.t + dur);
      ev({ type: 'buff', who: dst.uid, stat: 'asPct', amount: pct, dur: dur,
           until: round3(dst.asBuffUntil),
           from: srcUid || null, reason: reason || 'skill' });
      return true;
    }

    /**
     * 美团袋鼠 3 星「好评如潮」：普攻打中一个敌人 = 往那儿送一单外卖。
     *
     * ★★ 治的是**友方单位**（自己人），圆心是**被打中的那个敌人**的格子。
     *   所以这是一个"往前线投喂"的机制：越往敌人堆里打，
     *   越多的自己人吃得到；站得远的后排一口都分不到。
     *
     * ★ 圆心由调用方传进来（`attackOnce` 里出手那一刻就记下的 cR/cC），
     *   而不是现场读 `target.r/target.c` —— 目标可能已经被这一下打死了，
     *   甚至这条线以后会被击退改位置。**用出手瞬间的坐标**才和玩家的观感一致。
     * ★ 每个吃到的人各按**自己的生命上限**算 4%：一口固定值对坦克是毛毛雨、
     *   对脆皮是回满，按百分比才"送到谁身上都合适"。
     * ★ 走 `healUnit` 这条漏斗：截断、healPool、"不足 1 点不写日志"全都一致。
     *   reason 用 'delivery'：回放里要能看出这一口是外卖送的，不是奶妈奶的。
     */
    function deliveryHeal(src, r, c) {
      var mates = alliesOf(src);
      for (var i = 0; i < mates.length; i++) {
        var m = mates[i];
        if (!m.alive) continue;
        if (U.cheb(m.r, m.c, r, c) > src.deliveryRadius) continue;
        healUnit(src, m, m.maxHp * src.deliveryHealPct, 'delivery');
      }
    }

    /**
     * 东北雨姐 2 星「红薯粉丝」：放技能的同时，把**身边 3×3 的敌人**捆住 3 秒。
     *
     * ★★ 「捆住」和「眩晕」是两件事，所以是两套字段：
     *   `rootUntil` 只挡**走位**，被捆住的人照样出手、照样放技能。
     *   玩家看到的是"它钉在原地挨打"，而不是"它晕了" ——
     *   如果直接复用 stunUntil，这个角色就变成了"每 10 秒白拿 3 秒无敌控制"，
     *   和嘉豪/冰冰冰那几条控场也没了区别。
     *
     * ★ 圆心是**她自己**（不是目标格）：技能的目标是队友，
     *   而"捆住"发生在雨姐身边 —— 她是个近战前排，站位本身就决定了
     *   这一下能捆到谁，这就是这个角色的操作点：**站得越靠前捆得越多**。
     * ★ 取 max 而不是覆盖（和 stunUntil / asBuffUntil 同一套约定）：
     *   刚放过技能又被另一个雨姐捆一下，不该把剩余时间清零。
     */
    function bindEnemies(src) {
      var list = enemiesOf(src).slice();
      var n = 0;
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (!e.alive) continue;
        if (U.cheb(e.r, e.c, src.r, src.c) > src.bindRadius) continue;
        e.rootUntil = Math.max(e.rootUntil, st.t + src.bindDur);
        e.rooted++;
        ev({ type: 'root', from: src.uid, to: e.uid, dur: src.bindDur,
             until: round3(e.rootUntil), skill: src.def.skill.name });
        n++;
      }
      return n;
    }

    /**
     * 东北雨姐 3 星「雨姐的关照」：普攻打到**被捆住的**敌人时，
     * 给血量百分比最低的队友大量回血。
     *
     * ★ 收件人走 `lowestAlly()`（和奶技能同一个选择函数），
     *   回血量按**收件人自己的生命上限 × 8%** —— 和外卖那条一样，
     *   按百分比才"送给谁都合适"。
     * ★ 只认**被打中的那个目标**是不是被捆住的（不是"场上有没有人被捆"）：
     *   需求写的是"攻击被捆住的敌人会…"，所以是一次"打谁"的判定。
     *   ★ 这一下**把人打死了也算数**：判据是"这一刀砍的是被捆住的人"，
     *     而不是"受害者还活着"。收件人本来就是自己的队友，
     *     和"给尸体挂眩晕"那种脏数据不是一回事。
     * ★ reason 用 'noodle'：回放里要能看出这一口是雨姐的关照，
     *   不是奶妈奶的、也不是外卖送的。
     */
    function noodleHeal(src, target) {
      if (!(src.bindHealPct > 0)) return 0;
      if (!target) return 0;
      if (!(st.t < target.rootUntil)) return 0;      // 打的是没被捆住的人 → 不触发
      var dst = lowestAlly(src);
      if (!dst) return 0;
      var real = healUnit(src, dst, dst.maxHp * src.bindHealPct, 'noodle');
      if (real > 0) src.bindHeals++;
      return real;
    }

    /**
     * 星级被动「巧乐兹」：每次普攻打到的敌人各 +1 层冰棍。
     *
     * 满 chillMax 层 → 冰冻 freezeDur 秒 + **清空层数**。
     * ★ 「清空」是必须的：不清的话 10 层之后就永久冻着了，
     *   而这个冰冻是"攒出来的控制"，不是"叠满就永久生效的光环"。
     */
    function applyChill(src, dst) {
      if (!src.chillOn || !dst || !dst.alive || !(src.chillPerHit > 0)) return;
      dst.chillStacks += src.chillPerHit;
      dst.chillPerStack = src.chillPerStack;
      dst.chillMax = src.chillMax;
      dst.chillFlash = 1;
      ev({ type: 'chill', from: src.uid, to: dst.uid, stacks: dst.chillStacks,
           max: src.chillMax, perStack: src.chillPerStack,
           asCut: round3(dst.chillStacks * src.chillPerStack) });
      if (dst.chillStacks >= src.chillMax) {
        dst.chillStacks = 0;
        freezeUnit(src, dst, src.freezeDur, 'freeze');
      }
    }

    /**
     * 星级被动「你快不过我你信吗」：每次普攻叠攻速，封顶 ocMaxAs（+200%）。
     *
     * ★★ 叠多少取决于是不是已经在狂暴里：
     *      平时 ocPerHit（+2%），狂暴里 ocPerHitBerserk（+4%，"效率翻倍"）。
     *    判定用的是**叠加之前**的 u.ocOn，也就是：
     *      把攻速顶进狂暴的那一次普攻，算的还是 +2%；
     *      从**下一次**普攻起才是 +4%。
     *    反过来写（本击就按 +4% 算）会让「进入狂暴」那条事件自相矛盾 ——
     *    它一边宣布"从现在起每次 +4%"，一边自己按 +4% 结算。
     *
     * ★ 越过阈值（+100%）的那一刻只做三件事，而且只做一次：
     *     ocOn = true（进入狂暴 = 开始自毁）、3 星的话把攻击力加成打开、写一条事件。
     *   之后每次普攻继续叠，事件里带 over 标记。
     *
     * ★ 顶到上限之后**不再写事件**：继续写的话每 tick 一条一模一样的，
     *   60 秒的对局能白写几千条。只在"这一次刚好顶到"时写一条 capped 收尾。
     */
    function overclockOnHit(u) {
      if (!u.alive || !(u.ocPerHit > 0)) return;
      var step = u.ocOn ? u.ocPerHitBerserk : u.ocPerHit;
      if (!(step > 0)) return;
      var next = U.round2(u.ocAsPct + step);
      var capped = false;
      if (u.ocMaxAs > 0 && next >= u.ocMaxAs) {
        next = u.ocMaxAs;
        capped = u.ocAsPct < u.ocMaxAs;   // 只有"这一次刚好顶到"才写收尾事件
      }
      if (!capped && next <= u.ocAsPct + 1e-9) return;   // 早就满了，静默
      u.ocAsPct = next;
      u.ocHits++;                          // 只数"真的叠上去了"的那些普攻
      var justOver = false;
      if (!u.ocOn && u.ocAsPct >= u.ocThreshold) {
        u.ocOn = true;
        justOver = true;
        u.ocFlash = 1;
        // 3 星「雪毙」：进入狂暴之后攻击力 +78%
        if (u.ocAdPct > 0) u.adBonusPct = u.ocAdPct;
      }
      ev({ type: 'ocas', who: u.uid, pct: round3(u.ocAsPct), hits: u.ocHits,
           step: round3(step), over: u.ocOn, justOver: justOver,
           capped: capped, adBonus: round3(u.adBonusPct) });
    }

    /**
     * 超频自毁（= 狂暴的代价）：进入狂暴之后，每秒失去**当前生命**的 ocBurnPct。
     *
     * ★ 用「当前生命」而不是最大生命：写成最大生命的话它是固定秒数
     *   （1750 × 44% = 770/秒 → 2.3 秒必死），而当前生命是指数衰减，
     *   越到后面掉得越慢 —— 配上"马上要被对面打死"的处境才是对的节奏。
     *
     * ★ 这是**失去生命**，不是受到伤害：不过护盾、不触发反伤、
     *   也不会被鸭子的「抓娃娃」挡掉（那不是"敌人攻击"）。
     *   所以这里直接改 hp 并自己 checkDeath，不经过 dealDamage。
     *
     * ★ loss 有 0.01 的下限：不留下限的话血量会停在 0.01 永远死不了
     *   （round2 把 0.0044 变成 0），玩家会看到一个血皮不死的怪物。
     */
    function overclockTick() {
      for (var i = 0; i < st.units.length; i++) {
        var u = st.units[i];
        if (!u.alive || !u.ocOn || !(u.ocBurnPct > 0)) continue;
        u.ocBurnAcc += CFG.DT;
        if (u.ocBurnAcc < 1) continue;
        u.ocBurnAcc -= 1;
        var loss = Math.max(0.01, U.round2(u.hp * u.ocBurnPct));
        if (loss > u.hp) loss = u.hp;
        u.hp = U.round2(u.hp - loss);
        if (u.hp < 0) u.hp = 0;
        u.ocBurnFlash = 1;
        ev({ type: 'selfburn', who: u.uid, amount: U.round2(loss),
             hpAfter: u.hp, hpMax: u.maxHp, pct: u.ocBurnPct,
             reason: 'overclock' });
        checkDeath(u);
      }
    }

    /**
     * 装备的自燃：带上「和成天下5000精品大果」的人**每秒失去 6% 生命上限**。
     *
     * ★★ 和上面那条「超频自毁」是**两条独立的规则**，故意没有合并成一个函数：
     *     张雪峰：每秒失去**当前**生命的 44% —— 指数衰减，越到后面掉得越慢；
     *     这颗果子：每秒失去**上限**的 6% —— 线性，固定 16.7 秒后必定死。
     *   一个是"慢慢烧死自己"，一个是"定时炸弹"。用参数分支写成一个函数的话，
     *   以后调其中一条就会误伤另一条 —— 而它们的节奏差别正是这两件东西的性格。
     *
     * ★ 同样是"失去生命"而不是"受到伤害"：不过护盾、不触发反伤、
     *   也不会被鸭子的「抓娃娃」挡掉（那不是"敌人攻击"）。
     *   所以直接改 hp 并自己 checkDeath，不经过 dealDamage。
     *
     * ★ 事件仍然用 `selfburn`（玩家看到的是同一件事：血量在自己往下掉），
     *   但多带一列 `reason` —— 校验器要靠它决定"该按哪条公式对账"。
     */
    function itemBurnTick() {
      for (var i = 0; i < st.units.length; i++) {
        var u = st.units[i];
        if (!u.alive || !(u.burnMaxPct > 0)) continue;
        u.burnAcc += CFG.DT;
        if (u.burnAcc < 1) continue;
        u.burnAcc -= 1;
        var loss = Math.max(0.01, U.round2(u.maxHp * u.burnMaxPct));
        if (loss > u.hp) loss = u.hp;
        u.hp = U.round2(u.hp - loss);
        if (u.hp < 0) u.hp = 0;
        u.burnFlash = 1;
        ev({ type: 'selfburn', who: u.uid, amount: U.round2(loss),
             hpAfter: u.hp, hpMax: u.maxHp, pct: u.burnMaxPct,
             reason: 'item' });
        checkDeath(u);
      }
    }

    /**
     * 电棍「导电」：在刚被打中的敌人身上留下一道电流。
     *
     * ★★ 「每个电棍制造的电流只能存在一个」是**按人算**的 ——
     *   所以先数一下这个 owner 现在有几条活着，够了就不再生成。
     *   1/2 星上限 1 条、3 星 3 条（`maxAtOnce` 是一张按星级的表）。
     *   ★ 这条限制同时解决了一个手感问题：电棍攻速是翻倍的（1.28），
     *     不限制的话他会瞬间铺满一屏幕电流，技能那一条也白设计了。
     *
     * ★ 普攻和技能**共用**这一个入口（调用点在 attackOnce 和 skillDamage）——
     *   两处各写一遍的话，"上限/延迟/伤害比例"迟早对不上。
     */
    function spawnCurrent(src, dst) {
      if (!src || !src.currentOn || !dst || !dst.alive) return;
      if (!(src.currentPct > 0) || !(src.currentMaxBounces > 0)) return;
      // 这个 owner 已经挂着几条了？
      var mine = 0;
      for (var i = 0; i < st.currents.length; i++) {
        if (st.currents[i].owner === src.uid) mine++;
      }
      if (mine >= src.currentMaxAt) return;
      var cur = {
        id: st.nextCurrentId++,
        owner: src.uid, side: src.side,
        r: dst.r, c: dst.c,
        until: st.t + src.currentDelay,
        left: src.currentMaxBounces,
        hit: [dst.uid]
      };
      st.currents.push(cur);
      ev({ type: 'current', born: true, id: cur.id, from: src.uid, side: src.side,
           r: cur.r, c: cur.c, to: dst.uid, left: cur.left,
           delay: src.currentDelay, until: round3(cur.until),
           pct: src.currentPct, stunDur: src.currentStunDur });
    }

    /**
     * 电流结算：到点了就往 3×3 内**还没被这道电流打过**的敌人身上弹一下。
     *
     * ★ 目标选法沿用全项目那一套（切比雪夫 → 曼哈顿 → 镜像定序，见 domainPick）：
     *   随便挑一个的话，A/B 镜像局面会挑到不同的敌人，先手公平性就破了。
     * ★ 找不到新目标（附近都打过了、或者死光了）→ 这道电流就地消失。
     *   这是**必须的终止条件**：不然它会在原地每 0.5 秒空转，
     *   而"最多四次"就变成了"永远在跳"。
     * ★ 伤害走 dealDamage + afterDamage，和别的伤害同一条管线 ——
     *   所以护盾、反伤、死亡、受击回蓝全都照常生效。
     *   `attackerGetsMana = false`：一道四连跳不该给电棍回四次法力。
     */
    function currentTick() {
      for (var i = st.currents.length - 1; i >= 0; i--) {
        var cur = st.currents[i];
        if (st.t < cur.until) continue;
        var owner = st.byUid[cur.owner];
        /* ★ 电棍死了，他挂出去的电流也跟着散掉。
           两种做法都说得通（"已经出手了" vs "源头没了"），这里选后者是因为
           它**更好读**：电流的伤害是用施法者**当前**攻击力算的，
           一个死掉的施法者没有"当前攻击力"，硬算就得去翻快照。
           而且写进事件里（ownerGone）之后，回放能清楚地说"他没打完就倒了"。 */
        if (!owner || !owner.alive) {
          st.currents.splice(i, 1);
          ev({ type: 'current', id: cur.id, from: cur.owner, side: cur.side,
               fizzle: true, ownerGone: true, r: cur.r, c: cur.c, left: cur.left });
          continue;
        }
        // 候选：敌方、活着、在 3×3 内、这道电流还没打过
        var pool = [];
        var list = st.side[cur.side === 'a' ? 'b' : 'a'];
        for (var j = 0; j < list.length; j++) {
          var e = list[j];
          if (!e.alive || !e.uid) continue;
          if (cur.hit.indexOf(e.uid) >= 0) continue;
          if (U.cheb(e.r, e.c, cur.r, cur.c) > owner.currentRadius) continue;
          pool.push(e);
        }
        if (!pool.length) {
          st.currents.splice(i, 1);
          ev({ type: 'current', id: cur.id, from: cur.owner, side: cur.side,
               fizzle: true, r: cur.r, c: cur.c, left: cur.left });
          continue;
        }
        pool.sort(function (x, y) {
          var xc = U.cheb(x.r, x.c, cur.r, cur.c), yc = U.cheb(y.r, y.c, cur.r, cur.c);
          if (xc !== yc) return xc - yc;
          var xm = U.manhattan(x.r, x.c, cur.r, cur.c), ym = U.manhattan(y.r, y.c, cur.r, cur.c);
          if (xm !== ym) return xm - ym;
          return mirrorTie(x.side, x.r, x.c) - mirrorTie(y.side, y.r, y.c);
        });
        var tgt = pool[0];
        var fromR = cur.r, fromC = cur.c;
        cur.left--;
        cur.hit.push(tgt.uid);

        /* 伤害 = 施法者**当前**攻击力 × 25%。
           ★ 用当前攻击力而不是开局快照：电棍的攻击力会被装备/羁绊改变，
             而"25% 攻击力"是玩家按面板理解的那一个数。
           ★ 事件里同时带上 raw（本该打出多少）—— 校验器要能独立对账
             "这一下就是 25% 攻击力"，只看 dmg 是不够的（dmg 被减伤削过）。 */
        var raw = owner.ad * owner.currentPct;
        var res = dealDamage(owner, tgt, raw, 'magic');
        ev({ type: 'damage', from: cur.owner, to: tgt.uid, dmg: res.dmg, kind: 'magic',
             crit: false, shieldLoss: res.shieldLoss, hpLoss: res.hpLoss,
             hpAfter: tgt.hp, hpMax: tgt.maxHp, reason: 'current' });
        afterDamage(owner, tgt, res, 'magic', false);
        var stunned = false;
        if (owner.currentStunDur > 0 && tgt.alive) {
          tgt.stunUntil = Math.max(tgt.stunUntil, st.t + owner.currentStunDur);
          stunned = true;
          ev({ type: 'stun', from: cur.owner, to: tgt.uid, dur: owner.currentStunDur,
               until: round3(tgt.stunUntil), reason: 'current',
               targets: [tgt.uid], count: 1, durMul: 1, skill: '导电' });
        }
        cur.r = tgt.r; cur.c = tgt.c;
        cur.until = st.t + owner.currentDelay;
        ev({ type: 'current', id: cur.id, from: cur.owner, side: cur.side,
             to: tgt.uid, fromR: fromR, fromC: fromC, r: cur.r, c: cur.c,
             left: cur.left, dmg: res.dmg, raw: round3(raw), stunned: stunned,
             /* ★ ramp 必须带出去：加时赛的伤害递增会让 dmg **高于** raw，
                校验器没有这一列就只能瞎猜"是不是多打了"（第一版就是这么假红的）。 */
             ramp: U.round2(res.ramp), pct: owner.currentPct, delay: owner.currentDelay });
        // 次数用完了 —— 这一跳是最后一次
        if (cur.left <= 0) st.currents.splice(i, 1);
      }
    }

    /**
     * 星级被动：打完一次普攻，本局内攻速永久 +step（上限 cap）。
     *
     * ★ 三个刻意的设计选择：
     *   1. 加在**伤害结算之后** —— 第 N 次攻击吃的是第 N-1 层的加成，
     *      不存在「打出去的那一下同时被自己的触发加强」这种循环。
     *   2. 永不衰减、不因换目标或眩晕清零。玩家看到的是一条只涨不跌的曲线，
     *      不需要去猜「什么时候会掉」。
     *   3. 到上限就不再加，也不写日志 —— 否则后期每一下攻击都白写一条事件。
     */
    function gainFrenzy(u) {
      // ★ attackOnce 里可能被反伤打死（荆棘之甲），阵亡的棋子不该再叠层
      if (!u.alive) return;
      if (u.frenzyStep <= 0 || u.frenzyCap <= 0) return;
      if (u.frenzyPct >= u.frenzyCap - 1e-9) return;
      u.frenzyPct = Math.min(u.frenzyCap, u.frenzyPct + u.frenzyStep);
      u.frenzyHits++;
      ev({ type: 'frenzy', who: u.uid, pct: round3(u.frenzyPct),
           hits: u.frenzyHits, capped: u.frenzyPct >= u.frenzyCap - 1e-9 });
    }

    /* ---------- 技能 ---------- */
    function skillDamage(src, dst, amount) {
      var res = dealDamage(src, dst, amount * src.ap, 'magic');
      ev({ type: 'skill', from: src.uid, skill: src.def.skill.name, kind: src.def.skill.kind,
           to: dst.uid, dmg: res.dmg, ramp: U.round2(res.ramp),
           shieldLoss: res.shieldLoss, hpLoss: res.hpLoss,
           hpAfter: dst.hp, hpMax: dst.maxHp });
      afterDamage(src, dst, res, 'magic', false);
      /* ★★ 孙笑川 2 星「儒雅随和」：技能造成的**所有**伤害 100% 转化为自己的治疗。
       *
       *   ★ 挂在这里是因为 `skillDamage` 是**全部技能伤害的唯一出口** ——
       *     写在每个技能分支里（aoe / nuke / whirl / line…）迟早漏掉一个，
       *     而且以后加新技能也不会有人记得补。这一条和张雪峰的「狂暴」、
       *     鸭子的「抓娃娃」是同一个思路：**找那个所有路径都必经的函数**。
       *   ★ reason 用 'skillHeal' 而不是 'lifesteal'：回放里要能一眼分出
       *     "这是技能回的血"还是"这是装备/光环吸血"。
       *   ★ 放在 afterDamage **之后**：那里才判完死亡、扣完血，
       *     而且 res.dmg 已经定下来了（吸血用的也是它）。
       *   ★ 打几个敌人就回几次血 —— 血月斩是范围技能，这是刻意的联动。 */
      if (src.alive && src.skillHealPct > 0 && res.dmg > 0) {
        healUnit(src, src, res.dmg * src.skillHealPct, 'skillHeal');
      }
      /* ★ 电棍「导电」：**技能**命中也留一道电流。
         ★ 挂在这里的理由和上面那条一样：skillDamage 是全部技能伤害的唯一出口。
         ★ 一次技能打中三个人只会留下一道 —— 不是漏了，是"每个电棍同时只能
           存在 N 条"这条上限在 spawnCurrent 里拦住了（这也正是那条上限的意义：
           不然一个直线技能瞬间就能铺出三道电流）。 */
      spawnCurrent(src, dst);
      return res;
    }

    /**
     * 击退：把 dst 沿着「远离 src」的方向推 n 格。
     *
     * ★ 方向只取**一个主轴**（差值大的那一边），不是斜着推。
     *   斜推两格在切比雪夫距离上是 2、在曼哈顿距离上是 4，
     *   玩家会觉得「怎么飞出去这么远」；单轴推进看得懂也数得清。
     *
     * ★ 撞到棋盘边缘或者任何人（不分敌我）就停下 —— 推不动就是推不动，
     *   不做「挤开别人」这种连锁。这样占位表永远不需要处理重叠。
     *   被推的人 moveTimer 归零，让它重新开始走位计时，不会因为
     *   「攒了一半的走位进度」而立刻弹回来。
     */
    function knockback(src, dst, n) {
      if (!src || !dst || !dst.alive || !(n > 0)) return 0;
      var dr = dst.r - src.r, dc = dst.c - src.c;
      var sr = 0, sc = 0;
      if (Math.abs(dr) >= Math.abs(dc) && dr !== 0) sr = dr > 0 ? 1 : -1;
      else if (dc !== 0) sc = dc > 0 ? 1 : -1;
      if (sr === 0 && sc === 0) return 0;      // 站在同一格，理论上到不了

      var fromR = dst.r, fromC = dst.c, moved = 0;
      for (var k = 0; k < n; k++) {
        var nr = dst.r + sr, nc = dst.c + sc;
        if (!inBounds(nr, nc)) break;
        if (occupiedAt(nr, nc)) break;
        st.occ[dst.r * CFG.COLS + dst.c] = null;
        dst.r = nr; dst.c = nc;
        st.occ[nr * CFG.COLS + nc] = dst;
        moved++;
      }
      if (moved > 0) {
        dst.moveTimer = 0;
        ev({ type: 'knockback', from: src.uid, to: dst.uid,
             fromR: fromR, fromC: fromC, r: dst.r, c: dst.c, cells: moved });
      }
      return moved;
    }

    /**
     * 奶龙的「捧腹大笑」：把自己变成一个 3 秒的肉盾。
     *
     * ★ 状态只记在 laughUntil 上，不动 stunUntil ——
     *   2 星要的是"能移动但依然不能攻击"，这和眩晕不是一回事。
     *   减伤和回血分别在 dealDamage 与 laughTick 里读这个时间戳，
     *   和豆包的 buffUntil 一样：**到期靠比时间，不需要任何人来清理**。
     */
    function startLaugh(u, sk) {
      u.laughUntil = st.t + (sk.dur || 0);
      u.laughAcc = 0;
      u.laughed++;
      ev({ type: 'laugh', who: u.uid, dur: sk.dur, until: round3(u.laughUntil),
           cut: sk.dmgCut, healPct: sk.healPct, times: u.laughed,
           move: u.laughMove, allyHeal: u.laughHeal });
    }

    /**
     * 大笑期间每秒回血；3 星还会顺手治疗 3×3 范围内的队友。
     *
     * ★ 用 healUnit 而不是直接改 hp：治疗量、溢出截断、日志记账
     *   全都由它统一处理，自检里「hpLoss 必须等于血量差」那条才继续成立。
     */
    function laughTick() {
      for (var i = 0; i < st.units.length; i++) {
        var u = st.units[i];
        if (!u.alive || u.laughUntil < 0 || st.t >= u.laughUntil) continue;
        u.laughAcc += CFG.DT;
        if (u.laughAcc < 1) continue;
        u.laughAcc -= 1;
        if (u.laughHealPct > 0) {
          healUnit(null, u, u.maxHp * u.laughHealPct, 'laugh');
        }
        if (u.laughHeal && u.laughRadius > 0) {
          var mates = alliesOf(u).slice();
          for (var j = 0; j < mates.length; j++) {
            var a = mates[j];
            if (!a.alive || a === u || !a.uid) continue;
            if (U.cheb(a.r, a.c, u.r, u.c) > u.laughRadius) continue;
            healUnit(u, a, a.maxHp * u.laughHealPct, 'laughAura');
          }
        }
      }
    }

    function castSkill(u) {
      var sk = u.def.skill;
      /* ★ 施法的**唯一入口**里记一次锁：这样不管走的是哪条收费分支
         （法力 / 计数 / 纯 CD），锁都一定生效 —— 写在 tryCast 的各个分支里
         迟早会漏掉一个。 */
      u.castLockUntil = st.t + CFG.CAST_LOCK;
      u.mana = 0;
      u.manaFromDmg = 0;
      u.casts++;
      var target = targetable(u.target) ? u.target : acquireTarget(u);
      ev({ type: 'cast', from: u.uid, skill: sk.name, kind: sk.kind,
           to: target ? target.uid : null, manaAfter: 0,
           // ★ 技能喊话原样带出去：渲染层不需要知道「肘击」是谁的技能，
           //   谁想喊什么由数据决定
           callout: sk.callout || null });

      var i, list, e;
      switch (sk.kind) {
        /**
         * 单体法术伤害。
         *
         * ★★ 「先过中门再谈未来」（Dank1ng）在这上面挂了两件**击杀后续**：
         *     · 原地留下一个骷髅（纯表现，但要写事件 —— 渲染层只能靠事件知道）
         *     · 自己开始耍 3 秒折叠刀，这 3 秒里**不攻击**
         *
         *   ★ 判"是不是被这一发打死的"用的是「打之前活着、打之后不活了」，
         *     而不是"看 hp 是不是 0"：牢大的「坠机」会让尸体继续挂在场上
         *     （downUntil），只看 hp 会漏判；而 hp<=0 的活体是不存在的。
         *   ★ 事件里带上 r/c —— 渲染层的骷髅要画在**尸体那一格**，
         *     而死亡之后单位已经不在 st.occ 里了，位置只能由事件带过去。
         *   ★ 只有写了 killSkull 的技能才有这套后续：深渊祭司 / 弩手 / 匕首客
         *     用的也是 nuke，它们的行为一个字都没变。
         */
        case 'nuke': {
          if (!target) break;
          var nukeWasAlive = target.alive;
          skillDamage(u, target, sk.damage);
          if (sk.killSkull && nukeWasAlive && !target.alive) {
            u.skulls++;
            ev({ type: 'skull', who: u.uid, to: target.uid,
                 r: target.r, c: target.c, skill: sk.name });
            u.knifeUntil = st.t + (sk.knifeDur || 0);
            ev({ type: 'knife', who: u.uid, to: target.uid, dur: sk.knifeDur || 0,
                 until: round3(u.knifeUntil), skill: sk.name });
          }
          break;
        }

        /* ★ 奶龙的「捧腹大笑」：不造成任何伤害，纯粹是给自己开一段"肉盾窗口"。 */
        case 'laugh':
          startLaugh(u, sk);
          break;

        /**
         * ★★ 羊帆「羊巅峰」：不造成任何伤害，只是**给下一次普攻蓄势**。
         *
         *   技能本身只做一件事：把 `peakCharge` 立起来，
         *   后面 attackOnce 出手时看到它就翻 20 倍（见那里的注释）。
         *
         *   ★ 为什么不做成"立刻打一发 20 倍伤害"：
         *     那样它就是荣誉的狙击换了个皮（远程一发核弹）。
         *     做成"下一次普攻"之后，玩家看到的是**激光先扫、然后那一下特别重** ——
         *     蓄力和结算分在两个时间点上，蓄力期间对手有 0.5 秒能反应（打断不了，
         *     但能看到），这就是"巅峰"该有的分量感。
         *
         *   ★ 重复放不会叠成 40 倍：蓄势只有"有/没有"两种状态。
         *     计数型技能一局只放得出几次，硬要叠倍率只会让数值失控。
         */
        case 'peak':
          if (u.peakCharge) u.peakEdges++;      // 只为统计（蓄了但没用掉又被续上）
          u.peakCharge = true;
          break;

        /* ★ 牢大的「肘击」：一发伤害 + 把目标推开。
         *
         *   ★ 顺序是先结算伤害、再击退。反过来的话，
         *     目标可能在被打飞的路上就死了，而那一下伤害还要去找它的位置 ——
         *     先打后推，两个动作的对象永远是同一个格子。
         *   ★ 只在目标还活着的时候推：尸体不占格，推它没有意义，
         *     而且会在事件流里留下一条指向死人的 knockback。 */
        case 'knockback': {
          if (!target) break;
          skillDamage(u, target, sk.damage);
          /* ★ u.alive 这一条是必须的：skillDamage 里会走 afterDamage，
             讲话石的反伤完全可能在肘击命中的同一瞬间把牢大弹死。
             死了就没有「推」这个动作了（和 gainFrenzy 开头那句是同一个道理）。 */
          if (u.alive && target.alive) knockback(u, target, sk.push || 1);
          break;
        }

        /* ★ 荣誉的「狙击1」：一发 ×10 的子弹，但只有 20% 命中。
         *
         *   事件顺序是刻意排的：cast → snipe →（命中才有的）skill。
         *   把 snipe 写在伤害**前面**，回放才是「先喊 Vamos / Kale，
         *   再看到伤害数字」—— 反过来就成了先掉血再喊，很怪。
         *   代价是 snipe 事件里没有 dmg 字段；命中的伤害在紧跟的 skill 事件里，
         *   校验器就是靠「hit=true 后面必须紧跟一条同 tick 同起止的 skill」来验的。
         *
         *   ★ 星级被动「运 / edg希望」就挡在掷骰子前面：
         *     还有「必定命中」次数就直接命中并扣一次，不消耗随机数。
         *     —— 这一点对确定性很重要：3 星和 1 星在同一颗种子上会走出不同的
         *     RNG 序列，这是**正确**的（它们本来就是不同的棋子状态），
         *     但意味着「给某关敌人换个星级」会让该关整段回放重排。 */
        case 'snipe': {
          if (!target) break;
          var sure = false;
          if (u.snipeSureLeft > 0) { u.snipeSureLeft--; sure = true; }
          var hit = sure || rng.chance(sk.hitChance);
          if (hit) u.snipeHits++; else u.snipeMisses++;
          ev({ type: 'snipe', from: u.uid, to: target.uid, hit: hit, sure: sure,
               skill: sk.name, mult: sk.mult,
               hits: u.snipeHits, misses: u.snipeMisses,
               sureLeft: u.snipeSureLeft });
          if (hit) skillDamage(u, target, sk.damage * (sk.mult || 1));
          break;
        }

        /**
         * 范围技能：在**目标格**炸开，波及切比雪夫距离 <= radius 的敌人。
         *
         * ★★ 冰冰冰 3 星「千里冰封」把这条技能改成**打全场**：
         *   跳过半径判定，直接打所有活着的敌人（`frostAll` 来自被动 allAt）。
         *   写在**同一个分支**里而不是新开一个 kind，是因为除了"选谁"之外
         *   其余一切（伤害、后续的冰冻、事件的形状）都完全一样 ——
         *   分成两个 kind 就等于把同一条技能抄了两遍，以后改一处必漏一处。
         */
        case 'aoe': {
          var center = target ? { r: target.r, c: target.c } : { r: u.r, c: u.c };
          var hitAll = !!u.frostAll;
          list = enemiesOf(u).slice();
          for (i = 0; i < list.length; i++) {
            e = list[i];
            if (!e.alive) continue;
            if (!hitAll && U.cheb(e.r, e.c, center.r, center.c) > sk.radius) continue;
            skillDamage(u, e, sk.damage);
            /* ★ 2 星「冻手冻脚」：被打中的人额外冻 1.5 秒。
               ★ 判 `e.alive`：伤害可能已经把它打死了 —— 给尸体挂眩晕
                 会多出一条指向死人的 stun 事件，校验器一读就假红。
               ★ 放在 skillDamage **之后**：先扣血再冻（顺序在日志里看得出，
                 反过来会让"最后一次伤害"排在自己的眩晕后面）。 */
            if (u.frostFreezeDur > 0) freezeUnit(u, e, u.frostFreezeDur, 'frost');
          }
          break;
        }

        /**
         * ★★ 「阴暗领域」（楚生疑犯）：在目标格撑起一片**留在场上的地形**。
         *
         *   这是游戏里第一个"不属于任何单位"的技能效果 ——
         *   以前所有持续状态都挂在单位身上（buffUntil / chillStacks / laughUntil），
         *   人死了效果就没了。领域反过来：施法者死了、走开了、被推走了，
         *   雨照样下，站在里面的人照样减半。
         *
         *   ★ 中心取**目标格**（和 aoe 同一个约定），没人可打时落在自己脚下。
         *   ★ 伤害：这条技能**一点伤害都没有** —— 它是纯地形/辅助。
         *     （原来的「飓风领域」是 340 点范围伤害，这一版整条去掉了。）
         *   ★ 领域不用清理：过期靠比时间戳（fieldAt / fieldAtAlly 自己会跳过），
         *     所以不需要任何"领域结束"事件，也不需要每 tick 扫一遍删。
         *     数组会一直变长 —— 但一局最多也就几十条，而且每个查询都会
         *     先比一次 until 直接跳过，代价可以忽略。
         */
        case 'field': {
          var fcenter = target ? { r: target.r, c: target.c } : { r: u.r, c: u.c };
          var fld = {
            id: st.nextFieldId++,
            r: fcenter.r, c: fcenter.c,
            radius: sk.radius || 1,
            until: st.t + (sk.dur || 0),
            side: u.side,                    // 施法者的阵营：对另一方减益
            asCut: sk.asCut || 1,            // 领域内敌人的攻速/移速倍率
            allyCut: u.fieldAllyCut || 0     // 领域内队友的伤害减免（2 星起）
          };
          st.fields.push(fld);
          ev({ type: 'field', from: u.uid, id: fld.id, r: fld.r, c: fld.c,
               radius: fld.radius, dur: sk.dur, until: round3(fld.until),
               side: fld.side, asCut: fld.asCut, allyCut: fld.allyCut,
               skill: sk.name });
          /* ★ 3 星「遁入暗影」：**放完技能之后**才进暗影（这一次施法本身
             照常结算）。已经在暗影里就什么都不做 —— 暗影不是"每放一次刷新一次"，
             它只有一个解除条件：队友全死光。 */
          if (u.shadowAt && !u.shadow && st.aliveCount[u.side] > 1) {
            u.shadow = true;
            u.shadows++;
            u.flash = 1;
            ev({ type: 'shadow', who: u.uid, on: true, side: u.side,
                 asCut: u.shadowAsCut, dmgMul: u.shadowDmgMul,
                 mates: st.aliveCount[u.side] - 1 });
          }
          break;
        }

        case 'line': {
          if (!target) break;
          var dr = target.r - u.r, dc = target.c - u.c;
          var sr = 0, sc = 0;
          if (Math.abs(dr) >= Math.abs(dc) && dr !== 0) sr = dr > 0 ? 1 : -1;
          else if (dc !== 0) sc = dc > 0 ? 1 : -1;
          else sr = u.side === 'a' ? 1 : -1;   // 理论上到不了
          list = enemiesOf(u).slice();
          for (var k = 1; k <= sk.length; k++) {
            var rr = u.r + sr * k, cc = u.c + sc * k;
            if (!inBounds(rr, cc)) break;
            for (i = 0; i < list.length; i++) {
              e = list[i];
              if (!e.alive) continue;
              if (e.r === rr && e.c === cc) skillDamage(u, e, sk.damage);
            }
          }
          break;
        }

        case 'shield': {
          var starget = sk.target === 'self' ? u : lowestAlly(u);
          addShield(u, starget, sk.amount * u.ap * u.shieldPct);
          break;
        }

        case 'heal': {
          var htarget = sk.target === 'self' ? u : lowestAlly(u);
          healUnit(u, htarget, sk.amount * u.ap * u.shieldPct, 'skill');
          /* ★★ 美团袋鼠 2 星「准时送达」：外卖送到的人**趁热吃** —— 攻速 +20% 5 秒。
           *   ★ 挂在**被治疗的那个人**身上（外卖是投给他的），所以用的是
           *     `htarget` 而不是 `u` —— 写成 u 就变成"奶妈给自己加速"了，
           *     而这一步在画面上完全看不出来（两个都是绿色数字）。
           *   ★ 不看有没有真的奶到血：满血的队友照样收得到外卖。
           *     "送没送到"和"吃没吃饱"是两件事。 */
          if (htarget && u.deliveryAsPct > 0) {
            grantAsBuff(htarget, u.deliveryAsPct, u.deliveryAsDur, u.uid, 'delivery');
          }
          break;
        }

        /**
         * 全队护盾（5 费专属）。
         * 不复用「以目标格为中心」那套 —— 它就是给每个活着的队友都套一层，
         * 所以哪怕队友散得再开也吃得到。这是「一个人就是一道防线」的机制表达。
         */
        case 'aegis': {
          list = alliesOf(u).slice();
          for (i = 0; i < list.length; i++) {
            e = list[i];
            if (!e.alive) continue;
            addShield(u, e, sk.amount * u.ap * u.shieldPct);
          }
          break;
        }

        /**
         * 以自身为中心的范围伤害（5 费专属）。
         * 和 'aoe' 的区别：aoe 打的是「目标格周围」，whirl 打的是「自己周围」，
         * 所以哪怕被围住、哪怕没锁定到人，也能清一圈。
         */
        case 'whirl': {
          list = enemiesOf(u).slice();
          for (i = 0; i < list.length; i++) {
            e = list[i];
            if (!e.alive) continue;
            if (U.cheb(e.r, e.c, u.r, u.c) <= sk.radius) skillDamage(u, e, sk.damage);
          }
          break;
        }

        /**
         * 眩晕（嘉豪「男人领域」）。
         *
         * ★ 星级被动改的是**技能本身的参数**，不是"多触发一次什么"：
         *   2 星一次控 2 个人、3 星控 3 个人并且时长翻倍。
         *   所以这里读的是 `domainTargets` / `domainDurMul`
         *   （buildSide 按星级算好写进单位身上的），技能代码里
         *   一句星级判断都没有。
         *
         * ★ 顺序是「先把这一圈全打完，再统一结算眩晕」。
         *   反过来的话，第一个被控住的人身上会带着 stun 事件、
         *   而后面的人还没挨打 —— 回放读起来像打了两次。
         *   （1 星只有一个目标，两种顺序的事件序列完全一样，
         *     所以改这个不会动到老行为。）
         */
        case 'stun': {
          var picked = domainPick(u, target, u.domainTargets);
          var dur = sk.dur * u.domainDurMul;
          /* ★ 名单挂在**每一条** stun 事件上：渲染层只需要读 `to` 画特效，
             而回放靠 `targets[0]` 判断"这一条是不是本次施法的第一条" ——
             一次三控只写一行摘要，不是三行一样的话。 */
          var ids = [];
          for (i = 0; i < picked.length; i++) ids.push(picked[i].uid);
          for (i = 0; i < picked.length; i++) {
            skillDamage(u, picked[i], sk.damage);
          }
          for (i = 0; i < picked.length; i++) {
            var se = picked[i];
            if (!se.alive) continue;          // 被这一发打死的就不再眩晕
            se.stunUntil = Math.max(se.stunUntil, st.t + dur);
            ev({ type: 'stun', from: u.uid, to: se.uid, dur: dur,
                 until: round3(se.stunUntil), count: picked.length,
                 durMul: u.domainDurMul, targets: ids, skill: sk.name });
          }
          break;
        }

        case 'buff': {
          /* ★ 改成走 grantAsBuff（唯一出口）—— 行为和原来逐字一致，
             只是多带了 from / reason 两列，渲染层和校验器才分得清是谁给的。 */
          grantAsBuff(u, sk.amount, sk.dur, u.uid, 'self');
          break;
        }

        default:
          break;
      }

      /* ★★ 东北雨姐「红薯粉丝」：**放技能的同时**捆住身边的敌人。
       *
       *   写在 switch **外面**是有意的 —— 需求说的是"使用技能的同时"，
       *   和"她放的是哪个技能"无关。挂在 `shield` 分支里的话，
       *   以后她的技能一换（或者被别的机制改掉），这条被动会**静默失效**：
       *   不报错、不为 0、只是再也不捆人了。
       *   这和孙笑川把回血挂在 `skillDamage`（全部技能伤害的唯一出口）、
       *   电棍把电流挂在同一个出口，是同一个思路：**找必经之地**。
       */
      if (u.bindOn) bindEnemies(u);
    }

    /* ---------- 移动 ---------- */
    /**
     * 当前攻速 = 基础攻速 ×（1 + 临时 buff + 星级被动累积）。
     *
     * 三样是**加法**叠在一起的，不是连乘 —— 连乘会让「+90% 的疾风连斩」
     * 和「+200% 的愤怒」互相放大到离谱。加法也更好解释给玩家听。
     *
     * ★ 唯一的例外是**冰棍**：它是"减速"，乘在**最后**而不是加进加成里。
     *   理由是它作用在"对手现在的出手速度"上 —— 对面叠了多少攻速都该被砍掉
     *   一半（10 层 = ×0.5），加进加成里的话，对面加成越高这个减速越像没发生。
     *   下限保到 0.1 倍，避免叠满 + 其它减速时算出 0 攻速卡死。
     */
    function effAsMul(u) {
      if (u.chillStacks <= 0) return 1;
      return Math.max(0.1, 1 - u.chillStacks * u.chillPerStack);
    }

    /* ---------- 「阴暗领域」的查询 ----------
     *
     * ★ 领域按**位置**生效，不按"谁放的"：谁站在里面谁受影响。
     *   所以查询只需要 (r, c) 和阵营 —— 不需要传单位。
     *
     * ★ 过期全靠比时间戳，和 buffUntil / laughUntil / chill 同一套约定：
     *   不需要任何"领域结束"事件，渲染层也是自己算（见 arena.js）。
     *   多放几次会留下好几条重叠的领域，各有各的 until，互不干扰。
     */
    function fieldAt(r, c, side, prop) {
      var out = 1;                       // 默认"没有影响"
      for (var i = 0; i < st.fields.length; i++) {
        var f = st.fields[i];
        if (f.until <= st.t) continue;                 // 已经过期
        if (f.side === side) continue;                 // 这不是"针对你"的领域
        if (U.cheb(r, c, f.r, f.c) > f.radius) continue;
        var v = f[prop];
        if (v > 0 && v < out) out = v;                 // 取最强的那个（不叠乘）
      }
      return out;
    }

    /** 站在**敌方**领域里：攻速/移速按比例打折（和冰棍同一层，乘在最后） */
    function fieldSlowMul(u) {
      if (!st.fields.length) return 1;
      return fieldAt(u.r, u.c, u.side, 'asCut');
    }

    /** 站在**己方**领域里：少受多少伤害（2 星起，0 = 不保护） */
    function fieldAllyCutAt(r, c, side) {
      var best = 0;
      for (var i = 0; i < st.fields.length; i++) {
        var f = st.fields[i];
        if (f.until <= st.t) continue;
        if (f.side !== side) continue;
        if (U.cheb(r, c, f.r, f.c) > f.radius) continue;
        if (f.allyCut > best) best = f.allyCut;
      }
      return best;
    }

    /**
     * 所有「按比例减速」乘在一起：冰棍 × 阴暗领域。
     *
     * ★ 为什么是**乘**而不是加：这两样都是"把你现在的速度砍掉一半"，
     *   作用的对象是"你现在的出手速度"。并进攻速加成里的话，
     *   一个叠满攻速的单位在领域里几乎不受影响 —— 那不是设计意图。
     * ★ 下限保到 0.1：三层减速叠起来也不会算出 0 攻速把人卡死。
     */
    function slowMul(u) {
      return Math.max(0.1, effAsMul(u) * fieldSlowMul(u));
    }

    /** 这个单位能不能被索敌：活着，而且没有遁入暗影 */
    function targetable(e) {
      return !!e && e.alive && !e.shadow;
    }

    function effectiveAs(u) {
      var bonus = (st.t < u.asBuffUntil) ? u.asBuffPct : 0;
      // ★ 暗影期间攻速减半（和领域/冰棍一样是"乘在最后"的减速）
      var shadowCut = u.shadow ? (1 - u.shadowAsCut) : 1;
      return u.as * (1 + bonus + u.frenzyPct + u.ocAsPct) * slowMul(u) *
        Math.max(0.1, shadowCut);
    }

    /**
     * 走位速度倍率：走一格要多久 = MOVE_INTERVAL / moveMul(u)。
     * ★ 这是这个游戏里第一个会变的单位属性（原来所有棋子都是 0.3 秒一格）。
     *   实现方式是给走位计时器乘一个倍率，不改 MOVE_INTERVAL 本身 ——
     *   常量保持全局唯一，谁慢谁快都从自己身上读。
     *
     * ★ 三样东西连乘，顺序就是它们的语义：
     *     u.movePct      这个棋子**天生**多快（羊帆 0.2 = 迟钝）
     *     1 + ocMovePct  技能/被动给的临时加成（张雪峰 +100%）
     *     slowMul(u)     按比例减速：冰棍 + 阴暗领域（作用在"现在的速度"上）
     *   把 movePct 并进 ocMovePct 的话，一个迟钝 80% 的棋子吃到 +100% 会变成
     *   完全正常 —— 那不是"被加速了"，是"迟钝被治好了"。
     * ★ 暗影期间的攻速减半**不**作用于移速：设定是"攻速减半、伤害翻倍"，
     *   没提走位。移速跟着一起砍的话，一个要来去自如的幽影会变得笨重。
     */
    function moveMul(u) {
      return Math.max(0.1, u.movePct * (1 + u.ocMovePct) * slowMul(u));
    }

    /**
     * 朝目标走一格（贪心一步）。
     *
     * 两条规矩，都是为了让战斗结果「可解释」且「不偏袒上下半场」：
     *
     * 1. 只接受 (切比雪夫距离, 曼哈顿距离) 字典序严格变小的格子。
     *    潜力函数每步严格下降 ⇒ 不会来回横跳，也不可能死循环。
     *
     * 2. 打平时不看遍历顺序，而是按「镜像坐标」定序：A 方取 r 小的，
     *    B 方取 (ROWS-1-r) 小的 —— 正好是 A 方规则的镜像。
     *    否则上下半场的单位在平局时会往同一个方向蹭，凭空制造先手优势。
     *
     * ★ 这一步失败 ≠ 走不了。被队友挤住时它会返回 false，
     *   由下面的 roundaboutStep / swapWithBlocker 接手。
     */
    function moveToward(u, target) {
      var curC = U.cheb(u.r, u.c, target.r, target.c);
      var curM = U.manhattan(u.r, u.c, target.r, target.c);
      var bestR = -1, bestC = -1, bestKeyC = 0, bestKeyM = 0, bestTie = 0;
      var isA = (u.side === 'a');

      for (var dr = -1; dr <= 1; dr++) {
        for (var dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          var nr = u.r + dr, nc = u.c + dc;
          if (!inBounds(nr, nc)) continue;
          if (occupiedAt(nr, nc)) continue;
          var kc = U.cheb(nr, nc, target.r, target.c);
          var km = U.manhattan(nr, nc, target.r, target.c);
          if (kc > curC) continue;
          if (kc === curC && km >= curM) continue;

          // 镜像坐标：A 用 r，B 用 ROWS-1-r
          var tie = (isA ? nr : (CFG.ROWS - 1 - nr)) * CFG.COLS + nc;
          var better = false;
          if (bestR < 0) better = true;
          else if (kc < bestKeyC) better = true;
          else if (kc === bestKeyC && km < bestKeyM) better = true;
          else if (kc === bestKeyC && km === bestKeyM && tie < bestTie) better = true;

          if (better) { bestR = nr; bestC = nc; bestKeyC = kc; bestKeyM = km; bestTie = tie; }
        }
      }
      if (bestR < 0) return false;

      st.occ[u.r * CFG.COLS + u.c] = null;
      u.r = bestR; u.c = bestC;
      st.occ[bestR * CFG.COLS + bestC] = u;
      ev({ type: 'move', who: u.uid, r: bestR, c: bestC });
      return true;
    }

    /* ============================================================
     * 绕路 与 换位 —— 近战被队友挡住时的两条出路
     *
     * 原来只有上面那个贪心一步：**前方一旦被队友占住，棋子就永远原地不动**，
     * 一群人挤在后排干看着前排挨打。真实情况是玩家看到「我的近战在发呆」。
     *
     * 现在补两条：
     *   ① 绕路：贪心走不动时，做一次 BFS 找**最近的可达、且更靠近目标的空格**，
     *      照着路走第一步。这就是「被挡住就绕过去」。
     *   ② 换位：连绕路都无路可走（被彻底堵死）时，和**前方那个队友**交换位置，
     *      让真正想上去打的人顶到前面。这是最后的兜底，也是玩家最想要的行为。
     *
     * ★ 两条都必须保持镜像对称（A 方和 B 方在镜像局面下做出镜像的选择），
     *   否则会凭空制造上下半场的先手优势 —— 那正是 moveToward 里
     *   那套 tie-break 存在的理由，新代码一律沿用同一套。
     * ============================================================ */

    /** 镜像 tie-break：A 用 r，B 用 ROWS-1-r，越小越优先 */
    function mirrorTie(side, r, c) {
      return ((side === 'a') ? r : (CFG.ROWS - 1 - r)) * CFG.COLS + c;
    }

    /**
     * 「男人领域」一次控几个人：锁定目标排第一，其余的按由近到远补。
     *
     * ★ 第 0 位**不参与排序**，永远是引擎锁定的那个目标。
     *   全部按距离排的话，「缠绕」就变成了「缠最近的那个」——
     *   1 星只有一个目标时结果恰好一样，但 2/3 星会连带把
     *   原本锁定的那个挤到后面去，玩家看到的就是"技能打歪了"。
     * ★ 由近到远的排序沿用寻路/复活那一套：
     *   先切比雪夫、再曼哈顿、最后镜像定序 —— 保证 A/B 镜像局面下
     *   挑出来的是镜像的那几个人，不会凭空给某一方先手优势。
     */
    function domainPick(u, first, n) {
      var pool = [];
      if (first && first.alive) pool.push(first);
      var list = enemiesOf(u);
      for (var i = 0; i < list.length; i++) {
        if (list[i].alive && pool.indexOf(list[i]) < 0) pool.push(list[i]);
      }
      var rest = pool.slice(1);
      rest.sort(function (x, y) {
        var xc = U.cheb(u.r, u.c, x.r, x.c), yc = U.cheb(u.r, u.c, y.r, y.c);
        if (xc !== yc) return xc - yc;
        var xm = U.manhattan(u.r, u.c, x.r, x.c), ym = U.manhattan(u.r, u.c, y.r, y.c);
        if (xm !== ym) return xm - ym;
        return mirrorTie(x.side, x.r, x.c) - mirrorTie(y.side, y.r, y.c);
      });
      return pool.slice(0, 1).concat(rest).slice(0, n);
    }

    /** (切比雪夫, 曼哈顿) 是不是严格更靠近目标 */
    function strictlyCloser(r1, c1, r2, c2, target) {
      var c1v = U.cheb(r1, c1, target.r, target.c);
      var c2v = U.cheb(r2, c2, target.r, target.c);
      if (c1v !== c2v) return c1v < c2v;
      return U.manhattan(r1, c1, target.r, target.c) <
             U.manhattan(r2, c2, target.r, target.c);
    }

    /**
     * 绕路：BFS 找最近的一个可达格子，返回「朝它走的第一步」。
     *
     * ★ 区分两种目标，顺序不能反：
     *   ① attack —— 站上去**就能打到目标**的格子（切比雪夫距离 <= 射程）
     *   ② closer —— 单纯「更靠近目标」的格子
     *
     *   一开始只找 ②，结果出现一个很蠢的现象：**棋子会一直贴着人墙往里蹭，
     *   却永远进不了射程** —— 因为「更近」不等于「打得到」。
     *   当所有能打到敌人的格子都被队友占着时，它满足于「离得更近了一点」，
     *   一路绕到边上还是不出手。现在优先找 ①，找不到才退回 ②。
     *
     * 只在贪心一步失败时调用。棋盘只有 8×8 = 64 格，BFS 的代价可以忽略。
     */
    function bfsToward(u, target) {
      var startKey = u.r + ',' + u.c;
      var seen = {};
      seen[startKey] = -1;                       // 值 = 从哪个格子来的
      var queue = [{ r: u.r, c: u.c }];
      var dirs = [];
      for (var dr = -1; dr <= 1; dr++) {
        for (var dc = -1; dc <= 1; dc++) {
          if (dr || dc) dirs.push([dr, dc]);
        }
      }

      var bestAtk = null, bestAtkK = 0, bestAtkM = 0, bestAtkT = 0;
      var bestClo = null, bestCloK = 0, bestCloM = 0, bestCloT = 0;
      var head = 0;

      while (head < queue.length) {
        var layerEnd = queue.length;
        bestAtk = null; bestClo = null;
        for (; head < layerEnd; head++) {
          var cur = queue[head];
          for (var d = 0; d < dirs.length; d++) {
            var nr = cur.r + dirs[d][0], nc = cur.c + dirs[d][1];
            if (!inBounds(nr, nc)) continue;
            var key = nr + ',' + nc;
            if (seen[key] !== undefined) continue;
            if (occupiedAt(nr, nc)) continue;     // 队友和敌人都挡路
            seen[key] = cur.r + ',' + cur.c;      // 记下来路，用于回溯
            queue.push({ r: nr, c: nc });

            var kc = U.cheb(nr, nc, target.r, target.c);
            var km = U.manhattan(nr, nc, target.r, target.c);
            var tie = mirrorTie(u.side, nr, nc);

            if (kc <= u.range) {                  // ① 站这儿就能打到
              if (bestAtk === null || kc < bestAtkK ||
                  (kc === bestAtkK && km < bestAtkM) ||
                  (kc === bestAtkK && km === bestAtkM && tie < bestAtkT)) {
                bestAtk = { r: nr, c: nc }; bestAtkK = kc; bestAtkM = km; bestAtkT = tie;
              }
            } else if (strictlyCloser(nr, nc, u.r, u.c, target)) {   // ② 至少更近一点
              if (bestClo === null || kc < bestCloK ||
                  (kc === bestCloK && km < bestCloM) ||
                  (kc === bestCloK && km === bestCloM && tie < bestCloT)) {
                bestClo = { r: nr, c: nc }; bestCloK = kc; bestCloM = km; bestCloT = tie;
              }
            }
          }
        }
        if (bestAtk || bestClo) break;            // BFS 保证这是最近的一层
      }

      return {
        attack: bestAtk ? firstStepOf(seen, startKey, bestAtk) : null,
        closer: bestClo ? firstStepOf(seen, startKey, bestClo) : null
      };
    }

    /** 从回溯表里找出「朝 cell 走的第一步」 */
    function firstStepOf(seen, startKey, cell) {
      var path = cell.r + ',' + cell.c;
      var guard = 0;
      while (guard++ < 200) {
        var from = seen[path];
        if (from === -1 || from === undefined) return null;
        if (from === startKey) break;
        path = from;
      }
      var p = path.split(',');
      return { r: parseInt(p[0], 10), c: parseInt(p[1], 10) };
    }

    /**
     * 换位：被彻底堵死时，和「前方那个队友」交换位置。
     *
     * 三道闸门，缺一不可：
     *   ① 换过去必须让自己**真的更靠近目标**（否则是白折腾）
     *   ② 不打扰正在交战的队友 —— 前方那个如果射程内已经有敌人，
     *      说明他正在输出，把他换到后面等于帮倒忙
     *   ③ 防抖锁：刚和某人换过位，LOCK 秒内不许再和他换回去。
     *      没有这条会死循环 —— 甲换到前面、乙下一 tick 又想换回来，
     *      两个人原地互相顶，谁也上不去。
     */
    function swapWithBlocker(u, target, requireInRange) {
      /* 全局冷却：换过一次位之后 SWAP_LOCK 秒内任何换位都免谈。
         光有「同一对不许来回换」还不够：甲和乙换完、甲再和丙换、
         于是甲又能和乙换了，一群人会在原地循环换位，谁也上不去。 */
      if (st.t - u.lastSwapT < CFG.SWAP_LOCK) return false;

      var best = null, bestC = 0, bestM = 0, bestTie = 0;   // 优先：没在交战的队友
      var fb = null, fbC = 0, fbM = 0, fbTie = 0;           // 次选：正在交战的队友
      for (var dr = -1; dr <= 1; dr++) {
        for (var dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          var nr = u.r + dr, nc = u.c + dc;
          if (!inBounds(nr, nc)) continue;
          var v = st.occ[nr * CFG.COLS + nc];
          if (!v || !v.alive) continue;
          if (v.side !== u.side) continue;                  // 只和队友换
          if (!strictlyCloser(nr, nc, u.r, u.c, target)) continue;   // 闸门①

          var kc = U.cheb(nr, nc, target.r, target.c);
          if (requireInRange && kc > u.range) continue;      // 换过去也得打得到
          var km = U.manhattan(nr, nc, target.r, target.c);
          var tie = mirrorTie(u.side, nr, nc);
          if (nearestEnemyInRange(v)) {                      // 闸门②：他在交战，先避开
            if (fb === null || kc < fbC || (kc === fbC && km < fbM) ||
                (kc === fbC && km === fbM && tie < fbTie)) {
              fb = v; fbC = kc; fbM = km; fbTie = tie;
            }
          } else if (best === null || kc < bestC || (kc === bestC && km < bestM) ||
                     (kc === bestC && km === bestM && tie < bestTie)) {
            best = v; bestC = kc; bestM = km; bestTie = tie;
          }
        }
      }
      var pick = best || fb;
      if (!pick) return false;

      var v2 = pick;
      var ur = u.r, uc = u.c;
      st.occ[ur * CFG.COLS + uc] = v2;
      st.occ[v2.r * CFG.COLS + v2.c] = u;
      u.r = v2.r; u.c = v2.c;
      v2.r = ur; v2.c = uc;

      u.lastSwapT = st.t; u.lastSwapWith = v2.uid;
      v2.lastSwapT = st.t; v2.lastSwapWith = u.uid;
      u.swaps++; v2.swaps++;

      ev({ type: 'swap', a: u.uid, b: v2.uid,
           aR: u.r, aC: u.c, bR: v2.r, bC: v2.c });
      return true;
    }

    /** 落到指定格子（绕路用；标 around 便于测试区分「绕路」和「贪心一步」） */
    function takeStep(u, cell) {
      if (occupiedAt(cell.r, cell.c)) return false;
      st.occ[u.r * CFG.COLS + u.c] = null;
      u.r = cell.r; u.c = cell.c;
      st.occ[cell.r * CFG.COLS + cell.c] = u;
      ev({ type: 'move', who: u.uid, r: cell.r, c: cell.c, around: true });
      return true;
    }

    /**
     * 走位总入口：贪心 → 绕路 → 换位
     *
     * ★ 第 ② 步是「增加走位智商」的核心：
     *   绕不到出手位、但**换位能立刻进射程**时，就换上去。
     *   前面那位堵着唯一的出手位，绕到天荒地老也打不到 —— 只能换。
     */
    function advanceToward(u, target) {
      if (moveToward(u, target)) return true;

      var step = bfsToward(u, target);
      if (step.attack) return takeStep(u, step.attack);      // ① 站上去就能打
      if (swapWithBlocker(u, target, true)) return true;     // ② 换上去就能打
      if (step.closer) return takeStep(u, step.closer);      // ③ 至少更近一点
      return swapWithBlocker(u, target, false);              // ④ 彻底围死：往前挪一格
    }

    /* ---------- 单个单位的每 tick 更新 ---------- */
    /**
     * 射程内最近的敌人；没有就返回 null。
     * 判定和 acquireTarget 同一套 tie-break（距离 → 血少 → uid），保证确定性。
     */
    function nearestEnemyInRange(u) {
      var list = enemiesOf(u);
      var best = null, bestD = 0, bestHp = 0;
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (!targetable(e)) continue;          // 暗影单位打不到（见 acquireTarget）
        var d = U.cheb(u.r, u.c, e.r, e.c);
        if (d > u.range) continue;
        if (best === null || d < bestD || (d === bestD && e.hp < bestHp) ||
            (d === bestD && e.hp === bestHp && e.uid < best.uid)) {
          best = e; bestD = d; bestHp = e.hp;
        }
      }
      return best;
    }

    /**
     * ★ 出手优先级：**射程内有敌人就一定就地打**，只有射程内一个人都没有时，
     *   才自己寻敌走过去。
     *
     *   原来是「先锁定一个目标，只要那个目标不在射程内就走过去」——
     *   结果是棋子会**从紧贴着它的敌人身边走过去**，
     *   因为它的目标在远处。看起来就是「棋子乱跑、不肯打眼前的敌人」。
     */
    function updateUnit(u) {
      if (!u.alive) return;

      // 眩晕：不能动、不能攻击、攻速计时器也停
      if (st.t < u.stunUntil) return;

      /* ★★ 「先过中门再谈未来」的击杀后续：耍折叠刀的那 3 秒里**什么都不做** ——
       *   不出手、不放技能、也不走位，就在原地把那把刀转完。
       *
       *   ★★ 这 3 秒同时是「空悲切 / 锁头」的**刹车**，这一点必须说清楚：
       *      无限能量 = 法力永远满格，所以只要它还能出手，就会立刻接着放下一发。
       *      真正的节奏是「放 → 杀 → 停 3 秒 → 再放」——
       *      一次击杀换 3 秒安静，而不是一秒三十发核弹。
       *      （换句话说：**无限能量不等于无限火力**，耍刀就是那个限速器。）
       *
       *   ★ 放在 tryCast **之前**：放在后面的话，它只是"不普攻"，
       *     照样能在耍刀期间连放技能 —— 那这条刹车就形同虚设。
       *   ★ 和「大笑」是两种不同的封锁，所以是两个字段：
       *     大笑是"很硬但动不了也打不了"，耍刀是"忙着耍刀，连技能都顾不上"。 */
      if (u.knifeUntil >= 0 && st.t < u.knifeUntil) return;

      // 法力已满就立刻开技能（比如刚被围殴攒满的），不要等到下次普攻。
      // ★ 计数型（荣誉）也走这里：tryCast 会替它开一段蓄力并返回 true，
      //   于是蓄力期间它站着不动、不出手 —— 那半秒就是「眼睛喷激光」的画面。
      if (tryCast(u)) return;

      /* ★ 「捧腹大笑」期间。
       *   1 星：动不了也打不了（等于自己给自己一个 3 秒眩晕，换来 80% 减伤）
       *   2 星：能走动，但**依然不能攻击** —— 所以这里不能直接 return，
       *         要跳过攻击分支、走到下面的走位逻辑去。
       *   ★ 放在 tryCast 之后：笑的时候不该再放技能（冷却本来也还没好）。 */
      var laughing = (u.laughUntil >= 0 && st.t < u.laughUntil);
      if (laughing && !u.laughMove) return;

      var as = effectiveAs(u);

      // ① 射程内有敌人 → 站住打，谁近打谁
      var near = nearestEnemyInRange(u);
      if (near) {
        u.target = near;
        u.moveTimer = 0;                 // 站定了，走位计时清零
        if (laughing) return;            // 笑着打不了，就地站着
        u.atkTimer += as * CFG.DT;
        while (u.atkTimer >= 1 && u.alive && near.alive) {
          u.atkTimer -= 1;
          attackOnce(u, near);
        }
        if (u.atkTimer > 1) u.atkTimer = 0;
        return;
      }

      // ② 射程内没敌人 → 自己寻敌走过去
      /* ★ 锁定过的目标也可能中途遁入暗影，所以判据是 targetable 而不是 alive ——
         只判 alive 的话，一整队人会追着一个打不到的幽影满地图跑。 */
      var target = targetable(u.target) ? u.target : null;
      if (!target) {
        target = acquireTarget(u);
        u.target = target;
      }
      if (!target) return;

      u.atkTimer += as * CFG.DT;
      if (u.atkTimer > 1) u.atkTimer = 1;   // 到位后立刻能出手，最多攒一发

      // 开局定格：先让玩家看清阵型，这段时间只打不跑
      if (st.t < CFG.OPENING_HOLD) return;

      /* ★★ 被红薯粉丝捆住：**钉在原地**，但上面那一整套"射程内就地打"
       *   已经跑过了 —— 也就是说捆住只挡走位，不挡出手。
       *   （和 stunUntil 那条 `return` 的区别就在这里：那个连攻击一起挡。）
       *   ★ 位置放在 moveTimer 累加**之前**：不然被捆住的 3 秒里走位进度
       *     还在偷偷攒，一解绑就立刻窜一格 —— 看起来像"粉丝一松它就弹出去"。 */
      if (st.t < u.rootUntil) return;

      u.moveTimer += CFG.DT * moveMul(u);
      if (u.moveTimer >= CFG.MOVE_INTERVAL) {
        u.moveTimer = Math.min(u.moveTimer - CFG.MOVE_INTERVAL, CFG.MOVE_INTERVAL);
        advanceToward(u, target);   // 贪心 → 绕路 → 换位
      }
    }

    /* ---------- 医者羁绊：持续回血 ---------- */
    function regenTick() {
      for (var i = 0; i < st.units.length; i++) {
        var u = st.units[i];
        if (!u.alive || u.regenPct <= 0) continue;
        // 攒到 1 点才真正生效，由 healUnit 统一记账，避免「改了血却没写日志」
        healUnit(null, u, u.maxHp * u.regenPct * CFG.DT, 'regen');
      }
    }

    /* ---------- 状态快照（给渲染层对齐用） ---------- */
    function snapshot() {
      if (!recordLog) return;
      var arr = [];
      for (var i = 0; i < st.units.length; i++) {
        var u = st.units[i];
        /* ★★ 第 8/9 位是后加的，为了"拖动进度条跳着看"时不丢状态：
         *   · converted —— 不带上它的话，往后拖一下灰色卡面就没了；
         *   · side —— 招安会换阵营。不带上它的话，往后拖过招安那一刻，
         *     单位还算在原来那一方（影响的是开场 0.45 秒的渐显和灰卡判断）。
         *   ★ 加在**末尾**是有意的：前 7 位不动，旧代码读 row[0..6] 照样能跑。 */
        arr.push([u.uid, U.round1(u.hp), U.round1(u.shield), U.round1(u.mana),
                  u.r, u.c, u.alive ? 1 : 0,
                  u.converted ? 1 : 0, u.side === 'a' ? 1 : 0]);
      }
      ev({ type: 'snap', t: round3(st.t), u: arr });
    }

    /* ---------- 胜负 ---------- */
    function remainingPct(side) {
      var list = st.side[side], hp = 0, max = 0;
      for (var i = 0; i < list.length; i++) {
        max += list[i].maxHp;
        if (list[i].alive) hp += list[i].hp + list[i].shield;
      }
      return max > 0 ? hp / max : 0;
    }

    function finish(reason) {
      if (st.finished) return;
      st.finished = true;
      var winner;
      if (reason === 'wipe') {
        if (st.aliveCount.a > 0 && st.aliveCount.b === 0) winner = 'a';
        else if (st.aliveCount.b > 0 && st.aliveCount.a === 0) winner = 'b';
        else winner = 'draw';
      } else {
        var pa = remainingPct('a'), pb = remainingPct('b');
        if (Math.abs(pa - pb) < 1e-6) winner = 'draw';
        else winner = pa > pb ? 'a' : 'b';
      }
      st.winner = winner;
      st.reason = reason;
      ev({ type: 'end', winner: winner, reason: reason,
           remainA: U.round2(remainingPct('a')), remainB: U.round2(remainingPct('b')) });
    }

    /* ---------- 行动顺序 ----------
     * 不能让「整块 A 行动完再整块 B 行动」：那样每个 tick 里先动手的一方
     * 可以抢在对方行动前把人打死，先手优势会被放大到十几个百分点，
     * 后面所有平衡数据都不可信。
     *
     * 改成按序号交错 a0 b0 a1 b1 …，并且每个 tick 交换起始方。
     * 这样第 k 个棋子在两边处于完全对称的位置。
     */
    function buildOrder(tick) {
      var A = st.side.a, B = st.side.b;
      var n = A.length > B.length ? A.length : B.length;
      var out = [];
      var aFirst = (tick % 2 === 0);
      for (var i = 0; i < n; i++) {
        if (aFirst) {
          if (i < A.length) out.push(A[i]);
          if (i < B.length) out.push(B[i]);
        } else {
          if (i < B.length) out.push(B[i]);
          if (i < A.length) out.push(A[i]);
        }
      }
      return out;
    }

    /* ---------- 主循环 ---------- */
    // ★ 初始快照必须在开打之前抓。战斗过程中单位会被移动、扣血、加护盾，
    //   如果等打完了再去读 u.r / u.hp，读到的是尸体和残局，整个事件流就废了。
    var initial = {
      units: st.units.map(function (u) {
        return {
          uid: u.uid, side: u.side, defId: u.defId, name: u.name, emoji: u.emoji,
          color: u.color, star: u.star, items: u.items.slice(),
          maxHp: u.maxHp, hp: u.hp, shield: u.shield, mana: u.mana, maxMana: u.maxMana,
          ad: u.ad, as: U.round2(u.as), ap: u.ap, armor: u.armor, mr: u.mr,
          range: u.range, critChance: u.critChance, critMult: u.critMult,
          lifesteal: u.lifesteal, thornPct: u.thornPct, shieldPct: u.shieldPct,
          regenPct: u.regenPct,
          r: u.r, c: u.c,
          skillName: u.def.skill.name, skillKind: u.def.skill.kind,
          // 星级被动：渲染层靠这几个值决定要不要画「越打越快」/「增伤减伤」的提示
          frenzyStep: u.frenzyStep, frenzyCap: u.frenzyCap,
          hurtHealPct: u.hurtHealPct,
          giftPct: u.giftPct, giftSure: u.giftSure,
          // 「运 / edg希望」：本局允许的必定命中次数（渲染层和校验器都要用）
          snipeSure: u.snipeSureLeft,
          // 技能的收费方式：0 = 法力型，> 0 = 每 N 次普攻一发（校验器靠它认 charge 事件）
          cadenceEvery: u.cadenceEvery,
          // 纯 CD 技能：冷却秒数（校验器靠它认 laugh 事件、检查冷却间隔）
          cdSeconds: u.cdSeconds,
          // 捧腹大笑：减伤比例、每秒回血比例、能否边笑边走、是否治疗队友
          laughDur: u.laughDur, laughCut: u.laughCut, laughHealPct: u.laughHealPct,
          laughMove: u.laughMove, laughHeal: u.laughHeal, laughRadius: u.laughRadius,
          // 坠机：伤害、能不能复活、复活次数上限、复活后冷却是否减半
          crashDamage: u.crashDamage, revives: u.revives, cdCut: u.cdCut,
          maxRevives: u.maxRevives,
          // 抓娃娃：还能挡几次（渲染层要画徽章，校验器要靠它判 block 事件合法性）
          guardMax: u.guardMax,
          // 男人领域：这一星级一次能控几个、时长乘几倍（校验器靠它判 stun 事件合法性）
          domainTargets: u.domainTargets, domainDurMul: u.domainDurMul,
          // 羊巅峰：蓄势翻几倍 / ×20 那一下附带几秒眩晕 / 自爆的伤害倍率
          peakMult: u.peakMult, peakStunDur: u.peakStunDur,
          boomAdMult: u.boomAdMult, boomRadius: u.boomRadius,
          /* 天生迟钝：移速倍率。
             ★ 只给校验器和界面读 —— 走位插值对所有棋子都是同一个速率
               （张雪峰的 +100% 也没进插值），所以画面上"迟钝"体现在
               **每次挪动的间隔**上，而不是单次滑动的快慢。 */
          movePct: u.movePct,
          /* 阴暗领域：2 星起领域内队友的减伤比例；暗影状态与它的参数 */
          fieldAllyCut: u.fieldAllyCut, shadowAt: u.shadowAt,
          shadowAsCut: u.shadowAsCut, shadowDmgMul: u.shadowDmgMul,
          /* Dank1ng：有没有「空悲切」、能量回复倍率、击杀回满、耍刀时长。
             校验器要靠这几个值判 endless / refill / knife 事件合不合法。 */
          loneWolf: u.loneWolf, manaRegenMul: u.manaRegenMul,
          killRefill: u.killRefill,
          killSkull: !!(u.def.skill && u.def.skill.killSkull),
          knifeDur: (u.def.skill && u.def.skill.knifeDur) || 0,
          // 超频 / 冰棍：渲染层要画「⚡+N%」和「❄N」两个徽章，校验器要判事件
          ocStart: u.ocAsPct, ocThreshold: u.ocThreshold, ocAoeRadius: u.ocAoeRadius,
          ocBurnPct: u.ocBurnPct, ocPerHit: u.ocPerHit,
          /* ★ 狂暴那一套也要进快照，校验器才能独立算出"这一击该叠多少"：
               ocPerHitBerserk 狂暴里的单次叠加量、ocMaxAs 上限（0 = 不封顶）。
               不导出的话校验器只能自己再乘一遍倍率，那是把规则抄成两份。 */
          ocPerHitBerserk: u.ocPerHitBerserk, ocMaxAs: u.ocMaxAs,
          ocBerserkName: u.ocBerserkName,
          /* 老牧师「临终祷告」：校验器要独立判两件事 ——
             「一场只能救一个人」（ritesUsed）和「+20% 到底加没加」（adBonusPct）。
             adBonusPct 也顺便导出：它是雪毙和圣光赐福共用的那个攻击力加成，
             以前只有事件里带，校验器没法从快照反推。 */
          ritesOn: u.ritesOn, ritesUsed: u.ritesUsed, ritesAdPct: u.ritesAdPct,
          ritesHpPct: u.ritesHpPct, ritesDelay: u.ritesDelay,
          adBonusPct: u.adBonusPct,
          /* 装备的自燃：校验器要按"上限的 6%"独立对账，所以得从快照里读到它 */
          burnMaxPct: u.burnMaxPct,
          /* 孙笑川「天皇」：校验器要判"光环只给 3×3 内的队友"和"招安的条件" */
          mikadoAura: u.mikadoAura, mikadoLifesteal: u.mikadoLifesteal,
          skillHealPct: u.skillHealPct, convertOnKill: u.convertOnKill,
          convertHpPct: u.convertHpPct,
          /* 电棍「导电」：校验器要判"每次弹射 25% 攻击力""最多四次""上限按星级" */
          currentOn: u.currentOn, currentPct: u.currentPct,
          currentMaxBounces: u.currentMaxBounces, currentStunDur: u.currentStunDur,
          currentMaxAt: u.currentMaxAt, currentRadius: u.currentRadius,
          currentDelay: u.currentDelay,
          /* 冰冰冰「冻手冻脚 / 千里冰封」：校验器要判
             "技能冰冻的时长就是数据里那个""3 星才打全场" */
          frostFreezeDur: u.frostFreezeDur, frostAll: u.frostAll,
          /* 美团袋鼠「准时送达 / 好评如潮」：校验器要判
             "外卖的攻速加成是 20%/5 秒""普攻治疗只落在 3×3 内的自己人身上" */
          deliveryAsPct: u.deliveryAsPct, deliveryAsDur: u.deliveryAsDur,
          deliveryHealPct: u.deliveryHealPct, deliveryRadius: u.deliveryRadius,
          /* 东北雨姐「红薯粉丝 / 雨姐的关照」：校验器要判
             "捆住的是 3×3 内的敌人""只有打被捆住的人才会回血" */
          bindOn: u.bindOn, bindDur: u.bindDur, bindRadius: u.bindRadius,
          bindHealPct: u.bindHealPct,
          chillMax: u.chillMax, chillPerStack: u.chillPerStack,
          passiveName: passiveName(u.def, u.star),
          passiveKind: passiveOf(u.def) ? passiveOf(u.def).kind : null
        };
      }),
      traits: {
        a: builtA.traits.active.map(pubTrait),
        b: builtB.traits.active.map(pubTrait)
      }
    };

    snapshot();
    if (st.side.a.length === 0 || st.side.b.length === 0) {
      finish('wipe');
    } else {
      for (var tick = 0; tick < CFG.MAX_TICKS; tick++) {
        st.tick = tick;
        st.t = tick * CFG.DT;

        // 偶数 tick A 先手，奇数 tick B 先手，且按序号交错 —— 抵消先手优势
        var order = buildOrder(tick);

        for (var i = 0; i < order.length; i++) updateUnit(order[i]);

        regenTick();
        /* ★ 超频自毁也要按 tick 走一遍：放在 regenTick 后面、胜负判定前面。
           （张雪峰会自己把自己烧死，那也是一次合法的阵亡。） */
        overclockTick();
        /* ★ 装备的自燃（「和成天下5000精品大果」）同样按 tick 走。
           放在超频之后：同一 tick 里两个都烧的话，顺序只影响先扣谁的，
           而这两个计时器是独立的、各扣各的。 */
        itemBurnTick();
        /* ★ 电棍的电流也要按 tick 走（0.5 秒一跳）。
           放在胜负判定之前：最后一跳可能正好打死对面最后一个人。 */
        currentTick();
        /* ★ 奶龙大笑期间的回血（含 3 星的队友光环）同样按 tick 走。 */
        laughTick();
        /* ★ 纯 CD 技能的冷却也按 tick 走（被控住也照常倒数）。 */
        cooldownTick();
        /* ★ 坠机结算必须在**胜负判定之前**：牢大倒下的那一秒里
           aliveCount 已经 -1 了，如果这里不先把它的账走完，
           它会先被判定成全灭，直升机永远落不了地、也永远复活不了。 */
        pendingTick();
        /* ★ 「临终祷告」也必须排在胜负判定之前 —— 和坠机同一个道理：
           被救的人倒下的那一刻 aliveCount 已经 -1 了，
           如果这一秒里先把这一方判成全灭，人就永远救不回来了。
           ★ 它同时要在 shadowTick / loneWolfTick **之前**：
             那两个读的是 aliveCount，而这里刚把它 +1 回去。
             （否则"最后一个队友被救活"会让疑犯/Dank1ng 晚一 tick 才收起绝境状态。） */
        lastRitesTick();
        /* ★ 暗影的解除也要在胜负判定之前 —— 它读的是 aliveCount，
           而 aliveCount 刚刚才被 pendingTick 里的复活改过。
           放在后面的话，一个"队友刚死光"的疑犯会多躲一 tick。 */
        shadowTick();
        /* ★ 「空悲切」同样读 aliveCount，同样要排在 pendingTick 之后。 */
        loneWolfTick();

        if ((tick + 1) % CFG.SNAP_EVERY === 0) snapshot();

        /* ★ 胜负判定的例外：只要还有「倒下了但结算没走完」的单位，
           这一方就还没输。这也是「坠机 / 复活」唯一需要主循环配合的地方。 */
        var aOut = (st.aliveCount.a === 0 && !anyPending());
        var bOut = (st.aliveCount.b === 0 && !anyPending());
        if (aOut || bOut) {
          finish('wipe');
          break;
        }
      }
      if (!st.finished) {
        snapshot();
        finish('timeout');
      }
    }

    /* ---------- 汇总 ---------- */
    var unitStats = {};
    for (var n = 0; n < st.units.length; n++) {
      var unit = st.units[n];
      unitStats[unit.uid] = {
        uid: unit.uid, side: unit.side, index: unit.index,
        defId: unit.defId, name: unit.name, star: unit.star,
        survived: unit.alive, hpLeft: U.round2(unit.hp), maxHp: unit.maxHp,
        dmgDealt: U.round1(unit.dmgDealt), dmgTaken: U.round1(unit.dmgTaken),
        healing: U.round1(unit.healing), shielding: U.round1(unit.shielding),
        casts: unit.casts, kills: unit.kills
      };
    }

    function pubTrait(a) {
      return {
        id: a.trait.id, name: a.trait.name, emoji: a.trait.emoji,
        count: a.count, tier: a.tier, need: a.need,
        nextNeed: a.nextNeed === undefined ? null : a.nextNeed,
        desc: a.trait.desc,
        muted: !!a.muted
      };
    }

    var survivors = { a: 0, b: 0 };
    for (var q = 0; q < st.units.length; q++) {
      if (st.units[q].alive) survivors[st.units[q].side]++;
    }

    return {
      seed: typeof seed === 'string' ? ST.hashSeed(seed) : (seed >>> 0),
      seedInput: seed,
      winner: st.winner || 'draw',
      reason: st.reason || 'unknown',
      timedOut: st.reason === 'timeout',
      ticks: st.tick + 1,
      time: U.round2((st.tick + 1) * CFG.DT),
      remainPct: { a: U.round2(remainingPct('a')), b: U.round2(remainingPct('b')) },
      // 未取整的剩余血量比例。超时判胜用的是它，所以自检要拿它来验算，
      // 用取整后的 remainPct 去验会因为 0.004 的差被四舍五入掉而误判。
      remainExact: { a: remainingPct('a'), b: remainingPct('b') },
      survivors: survivors,
      initial: initial,
      log: recordLog ? st.log : [],
      unitStats: unitStats,
      units: st.units   // 运行时对象，只给调试用；不要序列化它
    };
  }

  /* ============================================================
   * 结果辅助
   * ============================================================ */

  /** 败方玩家应该掉多少血：基础 2 点 + 每个存活敌人按星级加 */
  function playerDamage(result) {
    if (!result || result.winner === 'draw') return { loser: null, damage: 0 };
    var loser = result.winner === 'a' ? 'b' : 'a';
    var dmg = 2;
    for (var uid in result.unitStats) {
      var s = result.unitStats[uid];
      if (s.side !== result.winner) continue;
      if (s.survived) dmg += s.star;
    }
    return { loser: loser, damage: dmg };
  }

  function describe(result) {
    var w = result.winner === 'a' ? 'A 方获胜' : (result.winner === 'b' ? 'B 方获胜' : '平局');
    var why = result.reason === 'timeout' ? '（超时按剩余血量判定）' : '（一方全灭）';
    return w + why + '　用时 ' + result.time + 's　存活 A' + result.survivors.a + ' / B' + result.survivors.b +
      '　剩余血量 A ' + Math.round(result.remainPct.a * 100) + '% / B ' + Math.round(result.remainPct.b * 100) + '%';
  }
})();
