/* ============================================================
 * 科币战争 — 人机模式主循环
 *
 * 这一层管的是「一局游戏」：
 *   商店 → 经济 → 人口 → 升星 → 装备 → 摆站位 → 开战 → 结算 → 下一关
 *
 * 它**完全不碰战斗规则**。开战时它只做两件事：
 *   1. 把自己摆好的棋盘和本关对手的阵容交给 ST.Battle.battle()
 *   2. 把拿到的 result 丢给 Arena 去播
 * 战斗怎么打、谁赢，全部由 battle.js 决定，这一层不参与。
 *
 * 玩家在下方半场（side 'b'），对手在上方（side 'a'）。
 * 准备阶段只看得到自己的半场，对手那半边是黑的 —— 和云顶一样，
 * 打起来才知道对面什么阵。
 * ============================================================ */
(function () {
  'use strict';

  var ST = window.ST;
  var UI = window.UI;
  var Arena = window.Arena;
  var Settings = window.Settings;

  var R = ST.GAME_RULES;
  var SIDE = 'b';                 // 玩家在下方半场
  /* 玩家在下方半场。行号从模拟器的棋盘配置**推出来**，不要手写 [4,5,6,7]：
   * 一旦 CFG.ROWS_PER_SIDE 变了，手写的常量会把玩家的棋子放到敌人的半场去，
   * 而且从界面上完全看不出来（格子照样能点、棋子照样能摆）。
   * 显示的从上到下 = 从最前排到最后一排，所以下标 0 就是贴着中线的那一行。 */
  var HALF = ST.BATTLE_CFG.ROWS_PER_SIDE;
  var PLAYER_ROWS = [];
  for (var _pr = 0; _pr < HALF; _pr++) PLAYER_ROWS.push(HALF + _pr);
  var FRONT_ROW = PLAYER_ROWS[0];       // 我方最前排（贴着中线）
  var COLS = ST.BATTLE_CFG.COLS;  // 棋盘宽度从模拟器那边取，别在这里再写死一份
  // 列分配顺序也从棋盘配置取（从中间往两边），和自动站位保证一致
  var COL_ORDER = ST.BOARD.colOrder();

  var G = null;
  /* 讲话石技能名一局只播报一次（每次受击最多弹 9 个目标，每条都写会刷屏） */
  var thornAnnounced = false;
  /* 豆包「幻觉 / 开智」：同一个结果连着来就闭嘴，只在**结果翻转**时播报。
     每次治疗都写一条的话，一个奶妈一局能刷几十行 ——
     而玩家真正想知道的是「这一口奶把她坑了」，也就是结果变了的那一下。
     lastGiftGood 用 null 表示「还没播报过」。 */
  var lastGiftGood = null;
  /* 美团袋鼠 3 星「好评如潮」：普攻送外卖，一局能送出上百单
     （0.7 次/秒 × 圈里好几个队友）。**一局只播报第一次** ——
     后面每一次在画布上都有一串绿色数字 + 橙色环，文字再写一遍只是刷屏。
     和讲话石那条是同一个道理。 */
  var deliveryAnnounced = false;
  /* 东北雨姐 3 星「雨姐的关照」：同上，一局只播报第一次。 */
  var noodleAnnounced = false;
  var Game = (window.Game = {});

  function $(id) { return document.getElementById(id); }
  function def(id) { return ST.UNIT_BY_ID[id]; }
  function key(r, c) { return r + ',' + c; }

  /* ============================================================
   * 一、状态
   * ============================================================ */
  function newState() {
    return {
      hp: R.START_HP,
      gold: R.START_GOLD,
      xp: 0,
      lvl: R.START_LEVEL,
      streak: 0,
      round: 0,
      level: 1,                        // 关卡序号；进无尽以后继续往上涨
      endless: 0,                      // 0 = 主线；>0 = 无尽模式第几波
      board: {},                       // "r,c" -> unit
      bench: new Array(R.BENCH_SIZE),  // unit | null
      shop: new Array(R.SHOP_SIZE),    // defId | null
      bag: [],                         // 还没装上去的装备 id
      sel: null,                       // 当前选中
      enemy: null,
      result: null,
      locked: false,                   // 商店锁定：回合开始不自动刷新
      uid: 0,
      log: []
    };
  }

  function mkUnit(defId, star, items) {
    return { uid: 'u' + (++G.uid), defId: defId, star: star || 1, items: (items || []).slice() };
  }

  Game.state = function () { return G; };
  Game.newState = newState;

  /* ------------------------------------------------------------
   * 公开的控制器 API。
   *
   * 界面上的按钮和格子最终都是调下面这几个函数 —— 把它们暴露出来不是为了
   * 「给外部用」，而是为了**让自动化测试能走真实的游戏链路**：
   * tests/gametest.html 会真的去买棋子、上场、开战，
   * 而不是绕过规则去改状态。
   * ------------------------------------------------------------ */
  Game.refresh = function () { if (G) renderAll(); };
  Game.buy = function (idx) { buyFromShop(idx); };
  Game.sell = function (uid) { sellUnit(uid); };
  Game.reroll = function () { reroll(); };
  Game.buyXp = function () { buyXp(); };
  Game.equip = function (bagIdx, uid) { equipItem(bagIdx, uid); };
  Game.placeFromBench = function (benchIdx, r, c) { benchToBoard(benchIdx, r, c); };
  Game.fight = function () { startFight(); };
  Game.retry = function () { retryLevel(); };
  Game.next = function () { nextLevel(); };
  Game.toggleLock = function () { toggleLock(); };
  Game.owned = owned;
  Game.playerSetup = playerSetup;
  // 无尽模式：暴露出来是为了让集成测试能真的走一遍「通关 → 进无尽 → 下一波」
  Game.enterEndless = function () { enterEndless(); };
  Game.nextWave = function () { nextWave(); };
  Game.inEndless = function () { return inEndless(); };

  /* ============================================================
   * 二、查询小工具
   * ============================================================ */
  function fieldLimit() { return ST.LEVEL_TABLE[G.lvl].field; }

  /* ============================================================
   * 无尽模式
   *
   * 24 关打完以后进入。两种模式的差别只有两处：
   *   ① 对手不是从 ST.LEVELS 里取的，而是 ST.endlessWave(波次) 现生成的
   *   ② 显示文案从「第 N / 24 关」变成「无尽 · 第 N 波」
   * 其余（经济、商店、备战席、升星、结算、掉血）全部复用，
   * 所以无尽模式不需要另写一套循环 —— 这也让它的平衡和主线完全一致。
   * ============================================================ */
  function inEndless() { return G.endless > 0; }

  function stageSub() {
    if (inEndless()) {
      return '无尽模式 · 第 ' + G.endless + ' 波　（每波敌人强 7%，越往后越离谱）';
    }
    return '第 ' + G.level + ' / ' + ST.LEVELS.length + ' 关';
  }

  function enterEndless() {
    G.endless = 1;
    G.level = ST.LEVELS.length + 1;   // 关卡序号继续涨，存档里的「最远」才有意义
    var p = Cover.loadProgress();
    Cover.saveProgress({ bestLevel: Math.max(p.bestLevel || 0, G.level) });
    pushLog('======= 进入无尽模式 =======', 'star');
    UI.transition(function () {
      $('result-overlay').classList.remove('on');
      beginRound();
      UI.show('scene-game');
    }, { label: '无尽模式 · 第 1 波', hold: 520 });
  }

  function boardCount() {
    var n = 0;
    for (var k in G.board) if (G.board[k]) n++;
    return n;
  }

  /** 遍历所有自己拥有的棋子（棋盘 + 备战席） */
  function owned() {
    var out = [];
    for (var k in G.board) {
      if (G.board[k]) out.push({ loc: 'board', key: k, unit: G.board[k] });
    }
    for (var i = 0; i < G.bench.length; i++) {
      if (G.bench[i]) out.push({ loc: 'bench', index: i, unit: G.bench[i] });
    }
    return out;
  }

  function findUnit(uid) {
    var all = owned();
    for (var i = 0; i < all.length; i++) if (all[i].unit.uid === uid) return all[i];
    return null;
  }

  function firstFreeBench() {
    for (var i = 0; i < G.bench.length; i++) if (!G.bench[i]) return i;
    return -1;
  }

  function playerSetup() {
    var list = [];
    for (var k in G.board) {
      var u = G.board[k];
      if (!u) continue;
      var p = k.split(',');
      list.push({
        id: u.defId, star: u.star, items: u.items.slice(),
        r: parseInt(p[0], 10), c: parseInt(p[1], 10)
      });
    }
    // 固定顺序，保证同一个棋盘每次跑出的战斗完全一样
    list.sort(function (a, b) { return (a.r - b.r) || (a.c - b.c); });
    return list;
  }

  function ownedDefs() {
    return owned().map(function (e) { return def(e.unit.defId); });
  }

  /* ============================================================
   * 三、回合记录
   * ============================================================ */
  function pushLog(text, kind) {
    G.log.push({ text: text, kind: kind || '' });
    if (G.log.length > 60) G.log.shift();
    renderMiniLog();
  }

  function renderMiniLog() {
    var host = $('mini-log');
    if (!host) return;
    host.innerHTML = '';
    for (var i = Math.max(0, G.log.length - 40); i < G.log.length; i++) {
      var e = G.log[i];
      host.appendChild(UI.el('div', 'log-line ' + e.kind, e.text));
    }
    host.scrollTop = host.scrollHeight;
  }

  /* ============================================================
   * 羁绊小条 + 触发反馈
   *
   * ★★ 为什么要有这一条：羁绊是这个游戏**最主要的变强手段**，而原来它只在
   *   「选中 / 羁绊」那块面板里露一半（选中棋子时就看不到了），
   *   玩家凑够第二档往往**完全没注意到**—— 变强了却没有任何反馈。
   *
   * ★ 位置选在商店标题那一行：那里本来就有一整条空白（手机上概率条是隐藏的），
   *   而且"买棋子 → 羁绊变化"这两件事在视线里是挨着的。
   *
   * ★ 反馈分两种：
   *     · 常驻：每个羁绊一枚小 chip，生效的亮绿、没生效的灰着并写还差几个
   *     · 一次性：**新档位刚触发**时弹一条 toast —— 只在新档位出现时弹，
   *       所以不会每买一个棋子就刷一次屏。
   * ============================================================ */
  var lastTraitSig = '';
  function renderTraitBar() {
    var host = $('trait-mini');
    if (!host) return;
    var res = ST.resolveTraits(ownedDefs());
    host.innerHTML = '';

    if (!res.active.length) {
      host.appendChild(UI.el('span', 'tm-empty', '羁绊'));
      lastTraitSig = '';
      return;
    }

    var sig = [];
    for (var i = 0; i < res.active.length; i++) {
      var e = res.active[i];
      var tx = ST.Help.traitText(e);
      var chip = UI.el('span', 'tm-chip' + (tx.on ? ' on' : ''));
      chip.textContent = tx.short + (tx.on ? '' : ('/' + e.need));
      chip.title = tx.full + (tx.next ? ('　' + tx.next) : '');
      host.appendChild(chip);
      sig.push(e.trait.id + ':' + e.count + ':' + e.tier);
    }

    /* ★ 触发反馈：比较"这一刻的羁绊签名"和上一次。
       只有**档位**变了才提示（人数变了但档位没变不提示）——
       否则每买一个棋子都炸一次屏，两下就被当成噪音。 */
    var sigStr = sig.join('|');
    if (lastTraitSig !== '') {
      var before = {};
      var oldList = lastTraitSig.split('|');
      for (i = 0; i < oldList.length; i++) {
        var parts = oldList[i].split(':');
        before[parts[0]] = parseInt(parts[2], 10);
      }
      for (i = 0; i < res.active.length; i++) {
        var now = res.active[i];
        var was = before[now.trait.id];
        if (now.tier < 0) continue;
        if (was === undefined || was < now.tier) {
          /* ★★ 屏幕中央的张力提示（用户要求）：
             凑齐羁绊是这一局最爽的一刻，值得打断注意力。
             小 toast 只留给"顺便一提"的信息，这里走大提示。 */
          bangTrait(now);
        }
      }
    }
    lastTraitSig = sigStr;
  }

  /* ============================================================
   * 羁绊触发：屏幕中央的大提示（带**队列**）
   *
   * ★★ 为什么要排队：一次买棋子可能同时点亮两条羁绊
   *   （比如补上一个 ZMJJKK 会同时凑齐 cnfps 和 康神开播了），
   *   两个大字叠在一起只会互相糊住 —— 一条播完再播下一条。
   * ★ 元素是**全局唯一**的一个（惰性创建、挂在 body 上）：
   *   每次都新建的话，连着触发三次就会在 DOM 里留三个动画中的浮层。
   * ★ 它 pointer-events: none、position: fixed：
   *   不挡任何按钮、也不占任何排版（这条在 CSS 注释里写清了原因）。
   * ============================================================ */
  var bangHost = null, bangQueue = [], bangPlaying = false;

  function bangTrait(entry) {
    bangQueue.push(entry);
    if (!bangPlaying) playNextBang();
  }

  function playNextBang() {
    if (!bangQueue.length) { bangPlaying = false; return; }
    bangPlaying = true;
    var e = bangQueue.shift();
    if (!bangHost) {
      bangHost = UI.el('div', 'trait-bang');
      bangHost.innerHTML =
        '<div class="tb-dim"></div>' +
        '<div class="tb-box">' +
          '<div class="tb-halo"></div>' +
          '<div class="tb-sweep"></div>' +
          '<span class="tb-tag">羁 绊 触 发</span>' +
          '<span class="tb-name"><span class="em"></span><span class="nm"></span></span>' +
          '<span class="tb-eff"></span>' +
          '<span class="tb-count"></span>' +
        '</div>';
      document.body.appendChild(bangHost);
    }
    bangHost.querySelector('.tb-name .em').textContent = e.trait.emoji;
    bangHost.querySelector('.tb-name .nm').textContent = e.trait.name;
    bangHost.querySelector('.tb-eff').textContent = ST.Help.modsText(e.mods);
    bangHost.querySelector('.tb-count').textContent =
      (e.tier + 1) + ' 档 · ' + e.count + ' 个' + e.trait.name +
      (e.nextNeed ? ('（再上 ' + (e.nextNeed - e.count) + ' 个到下一档）') : '（已满档）');
    bangHost.classList.remove('on');
    void bangHost.offsetWidth;              // 强制重排，让动画能重播
    bangHost.classList.add('on');
    /* ★ 停留 1.15 秒：够看清名字和加成，又不至于挡着操作太久。
       排队时两条之间留 0.18 秒空档，读起来是"一条一条"而不是连成一串。 */
    setTimeout(function () {
      if (bangHost) bangHost.classList.remove('on');
      setTimeout(playNextBang, 220);
    }, 1150);
  }

  /* ============================================================
   * 新手指引 / 阵容详解（都用通用弹窗，不新增浮层元素）
   * ============================================================ */
  var GUIDE_KEY = 'st_guide_seen';

  function guideBody(idx) {
    var steps = ST.Help.steps();
    var s = steps[idx];
    var box = UI.el('div', 'guide-box');
    var head = UI.el('div', 'guide-head');
    head.appendChild(UI.el('span', 'guide-icon', s.icon));
    head.appendChild(UI.el('span', 'guide-title', s.title));
    box.appendChild(head);
    var ul = UI.el('ul', 'guide-list');
    for (var i = 0; i < s.points.length; i++) {
      ul.appendChild(UI.el('li', '', s.points[i]));
    }
    box.appendChild(ul);
    /* 页码点：让玩家知道"还有几页"，也方便看进度 */
    var dots = UI.el('div', 'guide-dots');
    for (i = 0; i < steps.length; i++) {
      dots.appendChild(UI.el('span', 'guide-dot' + (i === idx ? ' on' : '')));
    }
    box.appendChild(dots);
    return box;
  }

  function openGuide(idx) {
    idx = idx || 0;
    var steps = ST.Help.steps();
    var last = idx >= steps.length - 1;
    var acts = [];
    if (idx > 0) {
      acts.push({ label: '‹ 上一页', keepOpen: true,
                  onClick: function () { UI.closeModal(); openGuide(idx - 1); } });
    }
    if (last) {
      acts.push({ label: '开始玩', kind: 'primary',
                  onClick: function () { rememberGuide(); } });
    } else {
      acts.push({ label: '下一页 ›', kind: 'primary', keepOpen: true,
                  onClick: function () { UI.closeModal(); openGuide(idx + 1); } });
      acts.push({ label: '跳过', onClick: function () { rememberGuide(); } });
    }
    UI.modal({
      title: '怎么玩（第 ' + (idx + 1) + ' / ' + steps.length + ' 页）',
      wide: true, body: guideBody(idx), actions: acts
    });
  }

  function rememberGuide() {
    try { window.localStorage.setItem(GUIDE_KEY, '1'); } catch (e) { /* 隐私模式：无所谓 */ }
  }

  function guideSeen() {
    try { return window.localStorage.getItem(GUIDE_KEY) === '1'; } catch (e) { return true; }
  }

  /** 阵容详解：上阵情况 + 每条羁绊的档位和下一档 + 几条能立刻照做的建议 */
  function openComp() {
    var defs = ownedDefs();
    var boardDefs = [];
    var units = [];
    var i;
    /* ★★ G.board 是**对象**（"r,c" → unit），不是数组 ——
       写成 `for (i = 0; i < G.board.length; i++)` 会一行都不跑，
       弹窗里永远是"棋盘上还没有棋子"。用 for-in 才是对的。 */
    for (var key in G.board) {
      var u = G.board[key];
      if (!u) continue;
      var d = def(u.defId);
      boardDefs.push(d);
      units.push({ name: d.name, emoji: d.emoji, star: u.star, cost: d.cost,
                   role: d.role, items: u.items || [] });
    }
    var rep = ST.Help.compReport({
      defs: boardDefs, owned: defs, units: units,
      cap: fieldLimit(), items: G.bag
    });

    var box = UI.el('div', 'comp-box');
    if (rep.units.length) {
      box.appendChild(UI.el('div', 'comp-h', '上阵 ' + rep.count +
        (rep.cap ? '/' + rep.cap : '') + ' 人'));
      var row = UI.el('div', 'comp-units');
      for (i = 0; i < rep.units.length; i++) {
        var cu = rep.units[i];
        var chip = UI.el('span', 'cu-chip');
        chip.appendChild(UI.el('b', '', cu.emoji + ' ' + cu.name));
        chip.appendChild(UI.el('i', '', cu.star + '★'));
        if (cu.role) chip.appendChild(UI.el('em', '', cu.role));
        chip.title = cu.cost + ' 费' + (cu.items.length
          ? ('　装备：' + cu.items.map(function (x) {
              return ST.ITEM_BY_ID[x] ? ST.ITEM_BY_ID[x].name : x;
            }).join('、'))
          : '　没戴装备');
        row.appendChild(chip);
      }
      box.appendChild(row);
    } else {
      box.appendChild(UI.el('div', 'comp-empty',
        '棋盘上还没有棋子 —— 先在商店买一个，再点棋盘上的空格放上去。'));
    }

    if (rep.traits.length) {
      box.appendChild(UI.el('div', 'comp-h', '羁绊'));
      var tl = UI.el('div', 'comp-traits');
      for (i = 0; i < rep.traits.length; i++) {
        var t = rep.traits[i];
        var line = UI.el('div', 'ct-line' + (t.on ? ' on' : ''));
        line.appendChild(UI.el('span', 'ct-head', t.emoji + ' ' + t.name +
          ' ' + t.count + (t.on ? ('（' + (t.tier + 1) + ' 档）')
                               : ('（还差 ' + (t.need - t.count) + ' 个）'))));
        line.appendChild(UI.el('span', 'ct-ef', t.on ? t.effect : (t.desc || '')));
        if (t.next) line.appendChild(UI.el('span', 'ct-next', '下一档：' + t.next));
        tl.appendChild(line);
      }
      box.appendChild(tl);
    }

    if (rep.advice.length) {
      box.appendChild(UI.el('div', 'comp-h', '可以改进的地方'));
      var al = UI.el('ul', 'comp-advice');
      for (i = 0; i < rep.advice.length; i++) {
        al.appendChild(UI.el('li', '', rep.advice[i]));
      }
      box.appendChild(al);
    }

    UI.modal({
      title: '阵容详解', wide: true, body: box,
      actions: [{ label: '知道了', kind: 'primary' }]
    });
  }

  /** 开战时闪一下的羁绊条：双方各自激活了哪些羁绊（绝对定位，不占画布高度） */
  function showTraitFlash(result) {
    var host = $('trait-flash');
    if (!host || !result || !result.traits) return;
    host.innerHTML = '';
    function side(label, list, cls) {
      var line = UI.el('div', 'tf-line ' + cls);
      line.appendChild(UI.el('span', 'tf-who', label));
      if (!list || !list.length) {
        line.appendChild(UI.el('span', 'tf-tag', '无羁绊'));
      } else {
        for (var i = 0; i < list.length; i++) {
          var t = list[i];
          var trait = ST.TRAIT_BY_ID[t.id] || ST.TRAIT_BY_ID[t.trait];
          var nm = t.name || (trait && trait.name) || t.id;
          var em = t.emoji || (trait && trait.emoji) || '·';
          line.appendChild(UI.el('span', 'tf-tag', em + ' ' + nm +
            (t.count ? (' ' + t.count) : '')));
        }
      }
      host.appendChild(line);
    }
    side('我方', result.traits.b, 'mine');
    side('对面', result.traits.a, 'foe');
    host.classList.remove('on');
    void host.offsetWidth;
    host.classList.add('on');
    setTimeout(function () { host.classList.remove('on'); }, 2600);
  }

  /* ============================================================
   * 四、经济与人口
   * ============================================================ */
  function grantIncome() {
    var interest = Math.min(R.INTEREST_MAX, Math.floor(G.gold / R.INTEREST_PER));
    var streakBonus = Math.min(R.STREAK_MAX, Math.floor(Math.abs(G.streak) / 2));
    var total = R.BASE_INCOME + interest + streakBonus;
    G.gold += total;
    return { base: R.BASE_INCOME, interest: interest, streak: streakBonus, total: total };
  }

  function buyXp() {
    if (G.lvl >= ST.LEVEL_TABLE.length - 1) { deny('已经是最高等级'); return; }
    if (G.gold < R.XP_COST) { deny('金币不够'); return; }
    G.gold -= R.XP_COST;
    G.xp += R.XP_PER_BUY;
    UI.sound.buy();
    checkLevelUp();
    renderAll();
  }

  function checkLevelUp() {
    var leveled = false;
    while (G.lvl < ST.LEVEL_TABLE.length - 1) {
      var need = ST.LEVEL_TABLE[G.lvl].xpToNext;
      if (!need || G.xp < need) break;
      G.xp -= need;
      G.lvl++;
      leveled = true;
      pushLog('等级提升到 ' + G.lvl + '（可上场 ' + fieldLimit() + ' 个）', 'star');
      UI.sound.levelup();
      UI.toast('等级 ' + G.lvl + ' · 可上场 ' + fieldLimit() + ' 个棋子', 'good');
    }
    if (leveled) renderHud();
    return leveled;
  }

  function xpNeeded() {
    var need = ST.LEVEL_TABLE[G.lvl] ? ST.LEVEL_TABLE[G.lvl].xpToNext : null;
    return need;
  }

  /* ============================================================
   * 五、商店
   * ============================================================ */
  function rollOne() {
    var odds = ST.LEVEL_TABLE[G.lvl].odds;
    var r = Math.random(), acc = 0;
    for (var i = 0; i < odds.length; i++) {
      acc += odds[i];
      if (r < acc) {
        var pool = ST.UNITS_BY_COST[i + 1];
        if (pool && pool.length) return pool[Math.floor(Math.random() * pool.length)].id;
      }
    }
    var last = ST.UNITS_BY_COST[1];
    return last[Math.floor(Math.random() * last.length)].id;
  }

  function rollShop() {
    for (var i = 0; i < G.shop.length; i++) G.shop[i] = rollOne();
  }

  function reroll() {
    if (G.gold < R.REROLL_COST) { deny('金币不够刷新'); return; }
    G.gold -= R.REROLL_COST;
    rollShop();
    UI.sound.buy();
    renderAll();
  }

  function buyFromShop(idx) {
    var defId = G.shop[idx];
    if (!defId) return;
    var d = def(defId);
    if (G.gold < d.cost) { deny('金币不够（需要 ' + d.cost + '）'); return; }
    var slot = firstFreeBench();
    if (slot < 0) { deny('备战席满了，先卖掉或上场'); return; }

    G.gold -= d.cost;
    G.bench[slot] = mkUnit(defId, 1, []);
    G.shop[idx] = null;
    UI.sound.buy();
    pushLog('买入 ' + d.emoji + d.name + ' −' + d.cost + '🪙');

    tryCombine();
    if (G.sel && G.sel.kind === 'shop' && G.sel.idx === idx) G.sel = null;
    renderAll();
  }

  /* ============================================================
   * 六、升星合成
   *
   * 3 个同名同星 → 1 个高一星。装备会在合成时汇总，不会凭空消失。
   * ============================================================ */
  function tryCombine() {
    var guard = 0, combined = false;
    while (guard++ < 30) {
      var groups = {};
      var all = owned();
      for (var i = 0; i < all.length; i++) {
        var u = all[i].unit;
        var gk = u.defId + '@' + u.star;
        if (!groups[gk]) groups[gk] = [];
        groups[gk].push(all[i]);
      }

      var did = false;
      for (var k in groups) {
        var list = groups[k];
        if (list.length < R.COMBINE_COUNT) continue;
        if (list[0].unit.star >= ST.MAX_STAR) continue;

        // 优先让合成结果留在棋盘上，其次保留装备最多的那个位置的装备
        list.sort(function (a, b) {
          var ab = a.loc === 'board' ? 0 : 1, bb = b.loc === 'board' ? 0 : 1;
          if (ab !== bb) return ab - bb;
          return b.unit.items.length - a.unit.items.length;
        });
        var take = list.slice(0, R.COMBINE_COUNT);
        var keep = take[0];

        var items = [];
        for (var t = 0; t < take.length; t++) {
          for (var j = 0; j < take[t].unit.items.length; j++) {
            if (items.length >= ST.MAX_ITEMS) break;
            items.push(take[t].unit.items[j]);
          }
        }

        var star = keep.unit.star + 1;
        var merged = mkUnit(keep.unit.defId, star, items);

        for (var m = 0; m < take.length; m++) removeAt(take[m]);
        placeAt(keep, merged);

        var d = def(merged.defId);
        pushLog('★ ' + d.emoji + d.name + ' 合成 ' + star + ' 星', 'star');
        UI.toast(d.emoji + ' ' + d.name + ' 升到 ' + star + ' 星！', 'star');
        UI.sound.star();
        if (G.sel && findUnit(G.sel.uid) === null) G.sel = null;
        did = true;
        combined = true;
        break;                      // 重新扫描，可能连锁合成
      }
      if (!did) break;
    }
    return combined;
  }

  function removeAt(entry) {
    if (entry.loc === 'board') delete G.board[entry.key];
    else G.bench[entry.index] = null;
  }

  function placeAt(entry, unit) {
    if (entry.loc === 'board') G.board[entry.key] = unit;
    else G.bench[entry.index] = unit;
  }

  /* ============================================================
   * 七、摆放与出售
   * ============================================================ */
  function selectUnit(uid) {
    var e = findUnit(uid);
    G.sel = e ? { kind: e.loc, uid: uid, loc: e } : null;
    renderBoard(); renderBench(); renderSelBar();
  }

  function deselect() {
    G.sel = null;
    renderBoard(); renderBench(); renderSelBar();
  }

  /** 从备战席上场到某个格子；如果那格有人就交换 */
  function benchToBoard(bi, r, c) {
    var u = G.bench[bi];
    if (!u) return;
    var k = key(r, c);
    var occupant = G.board[k];
    if (!occupant && boardCount() >= fieldLimit()) {
      deny('上场数已满（' + fieldLimit() + '）。买经验升级，或先撤下一个。');
      return;
    }
    G.board[k] = u;
    G.bench[bi] = occupant || null;
    UI.sound.place();
    renderAll();
  }

  /** 棋盘内部换位 */
  function boardToBoard(fromKey, toKey) {
    if (fromKey === toKey) { deselect(); return; }
    var a = G.board[fromKey];
    var b = G.board[toKey];
    G.board[toKey] = a;
    if (b) G.board[fromKey] = b; else delete G.board[fromKey];
    UI.sound.place();
    renderAll();
  }

  /** 棋盘 → 备战席 */
  function boardToBench(bKey) {
    var slot = firstFreeBench();
    if (slot < 0) { deny('备战席没有空位'); return; }
    G.bench[slot] = G.board[bKey];
    delete G.board[bKey];
    UI.sound.place();
    renderAll();
  }

  function sellRefund(u) {
    var d = def(u.defId);
    /* ★ 星级每高一档，价值 ×3（因为合成要 3 个）——
       1★→1、2★→3、3★→9、4★→27。写成 pow 而不是三元链：
       加 4 星的时候，`u.star === 1 ? 1 : (u.star === 2 ? 3 : 9)` 会**静默地**
       把 4 星也当成 9 倍，玩家卖掉一个 4 星只拿回三分之一。 */
    var mult = Math.pow(R.COMBINE_COUNT, u.star - 1);
    return Math.max(1, d.cost * mult);
  }

  function sellUnit(uid) {
    var e = findUnit(uid);
    if (!e) return;
    var u = e.unit, d = def(u.defId);
    var refund = sellRefund(u);
    G.gold += refund;
    for (var i = 0; i < u.items.length; i++) G.bag.push(u.items[i]);
    removeAt(e);
    UI.sound.sell();
    pushLog('卖出 ' + d.emoji + d.name + '（' + u.star + '★） +' + refund + '🪙');
    deselect();
    renderAll();
  }

  /* ============================================================
   * 八、装备
   * ============================================================ */
  function equipItem(bagIdx, uid) {
    var e = findUnit(uid);
    if (!e) return;
    if (e.unit.items.length >= ST.MAX_ITEMS) { deny('这个棋子装备已经满了'); return; }
    var itemId = G.bag[bagIdx];
    if (!itemId) return;
    e.unit.items.push(itemId);
    G.bag.splice(bagIdx, 1);
    var it = ST.ITEM_BY_ID[itemId];
    pushLog('装备 ' + it.emoji + it.name + ' → ' + def(e.unit.defId).name);
    UI.sound.buy();
    G.sel = { kind: e.loc, uid: uid, loc: e };
    renderAll();
  }

  function deny(msg) {
    UI.sound.deny();
    UI.toast(msg, 'warn');
  }

  /* ============================================================
   * 九、渲染
   * ============================================================ */
  function renderAll() {
    renderHud();
    renderEnemy();
    renderBoard();
    renderBench();
    renderShop();
    renderItems();
    renderSelBar();
    renderMiniLog();
    renderTraitBar();          // ★ 羁绊小条（顺便做"触发反馈"）
  }

  function renderHud() {
    var L = G.enemy || ST.LEVELS[G.level - 1];
    $('hud-stage').textContent = L.title;
    $('hud-stage-sub').textContent = stageSub();
    $('hud-hp').textContent = Math.max(0, G.hp);
    $('hud-hp-fill').style.width = Math.max(0, G.hp / R.MAX_HP * 100) + '%';
    $('hud-gold').textContent = G.gold;
    $('hud-lvl').textContent = G.lvl;

    var need = xpNeeded();
    $('hud-xp-text').textContent = need ? (G.xp + '/' + need) : '满级';
    $('hud-xp-fill').style.width = need ? Math.min(100, G.xp / need * 100) + '%' : '100%';
    $('hud-field').textContent = boardCount() + '/' + fieldLimit();

    var sw = $('hud-streak-wrap');
    if (G.streak > 0) {
      sw.className = 'hud-stat streak-win';
      $('hud-streak-icon').textContent = '🔥';
      $('hud-streak').textContent = '连胜 ' + G.streak;
    } else if (G.streak < 0) {
      sw.className = 'hud-stat streak-lose';
      $('hud-streak-icon').textContent = '💧';
      $('hud-streak').textContent = '连败 ' + (-G.streak);
    } else {
      sw.className = 'hud-stat';
      $('hud-streak-icon').textContent = '·';
      $('hud-streak').textContent = '—';
    }

    $('shop-odds').textContent = '';
    renderShopHead();

    // 开战按钮：没上人就禁用
    var fight = $('btn-fight');
    var can = boardCount() > 0;
    fight.classList.toggle('disabled', !can);
    fight.textContent = can ? '⚔️ 开战' : '先上场棋子';
  }

  function renderEnemy() {
    var L = G.enemy;
    if (!L) return;
    $('enemy-emoji').textContent = L.emoji;
    $('enemy-name').textContent = L.name;
    $('enemy-threat').textContent = '★'.repeat(L.threat) + '☆'.repeat(5 - L.threat);
    $('enemy-arch').textContent = '体系推测：' + L.arch;
    $('enemy-hint').textContent = L.hint;
  }

  function cellClasses(kind) {
    return 'cell' + (kind === 'enemy' ? ' enemy' : '');
  }

  function renderBoard() {
    var mine = $('player-half');
    if (!mine) return;

    // 准备阶段只画自己这半边 —— 对面那半边在这个界面里根本不存在。
    // （需求明确要求「选卡界面不要有对面的阵容」，所以连空位都不摆。）
    if (!mine.dataset.built) {
      mine.innerHTML = '';
      for (var r = 0; r < 4; r++) {
        for (var c = 0; c < COLS; c++) {
          var cell = UI.el('div', 'cell');
          cell.dataset.r = String(PLAYER_ROWS[r]);
          cell.dataset.c = String(c);
          if (r === 0) cell.classList.add('front-row');   // DOM 第一行 = 最前排
          mine.appendChild(cell);
        }
      }
      mine.dataset.built = '1';
    }

    var cells = mine.children;
    for (var i = 0; i < cells.length; i++) {
      var cell2 = cells[i];
      var rr = parseInt(cell2.dataset.r, 10);
      var cc = parseInt(cell2.dataset.c, 10);
      var u = G.board[key(rr, cc)];
      cell2.innerHTML = '';
      cell2.className = 'cell' + (rr === FRONT_ROW ? ' front-row' : '');
      if (u) {
        cell2.appendChild(unitChip(u));
        if (G.sel && G.sel.uid === u.uid) cell2.classList.add('sel');
      } else {
        cell2.classList.add('empty');
      }
    }
  }

  /**
   * emoji 图标的类名：**一个棋子可以挂多个 emoji**（冰冰冰 = 🧊🧊🧊），
   * 三个图形横着排会冲出卡片，所以按图形个数加一个 `-xN` 的类，
   * 由 CSS 缩一档。
   *
   * ★ 数的是"图形个数"（`ST.U.emojiCount`），不是 `.length` ——
   *   `'❄️'.length` 是 2（雪花 + 变体选择符），照 length 判会把单个 emoji
   *   也当成两个、白白缩小一档。
   * ★ 超过 3 个就按 3 档处理（现在最多就是 3 个，写个上限免得以后出现
   *   没人写样式的 `-x7` 类名）。
   */
  function emojiCls(base, emoji) {
    var n = ST.U.emojiCount(emoji);
    if (n <= 1) return base;
    return base + ' ' + base + '-x' + Math.min(n, 3);
  }

  /**
   * 给一张立绘 `<img>` 接上「失败就重试」。
   *
   * ★★ 这是「手机上有概率加载不出图片」的第二半（第一半在 art.js 的重试里）。
   *
   *   这些卡片上的 `<img>` **不走 ART 的缓存**（它们是每次渲染新生成的元素，
   *   靠浏览器自己的 HTTP 缓存）。原来的写法是 `onerror → 直接 removeChild`：
   *   一次失败就把这张图从这张卡上彻底删掉，只能等下一次渲染重建元素时
   *   碰运气再拉一次。手机上恰好最容易失败（切后台、锁屏、弱网），
   *   于是玩家看到的就是"某几张卡没图"。
   *
   *   现在：失败先**退避重试两次**（换一个带 ?r=N 的 URL，绕开浏览器里
   *   那条坏掉的缓存记录），两次都不行才退回 emoji。
   *   ★ 重试是有延迟的：网络刚断时连续三次立刻失败没有意义。
   */
  function wireArtImg(img, baseUrl) {
    var tries = 0;
    img.onerror = function () {
      if (tries < ART_RETRY_MS.length) {
        var wait = ART_RETRY_MS[tries];
        tries++;
        setTimeout(function () {
          if (!img.parentNode) return;          // 这张卡已经被重画掉了
          img.src = baseUrl + (baseUrl.indexOf('?') >= 0 ? '&' : '?') + 'r=' + tries;
        }, wait);
        return;
      }
      /* ★ 真的拿不到（文件不存在 / 三次都失败）→ 露出下面的主色渐变 + emoji。
         注意这里**只删自己**，不碰 fallback：素材可以一张一张慢慢补。 */
      if (img.parentNode) img.parentNode.removeChild(img);
    };
  }
  /** 卡片立绘的重试等待（比 ART 那套短一点：卡片是玩家正在盯着看的东西） */
  var ART_RETRY_MS = [500, 1500];

  /**
   * 画一个棋子方块（棋盘和备战池共用）。
   *
   * 结构上刻意留了 .u-art 插槽：把立绘丢进 art/ 就自动换上，
   * 图片三次都拉不到时把自己删掉，露出下面的 主色渐变 + emoji。
   * 所以素材可以一张一张慢慢补，任何时候都不会出现破图。
   */
  function unitChip(u) {
    var d = def(u.defId);
    var box = UI.el('div', 'u');
    box.style.background = UI.cardGradient(d.color);
    box.dataset.uid = u.uid;
    // 棋子卡本身也不是可拖拽元素（里面的 <img> 同理，见下面）
    box.draggable = false;

    var fb = UI.el('div', 'u-fallback');
    fb.appendChild(UI.el('span', emojiCls('u-emoji', d.emoji), d.emoji));
    fb.appendChild(UI.el('span', 'u-name', d.name));
    box.appendChild(fb);

    var art = UI.el('div', 'u-art');
    var img = document.createElement('img');
    wireArtImg(img, window.ART.url(d.id));
    img.src = window.ART.url(d.id);
    img.alt = '';
    /* ★★ 这一行是「有立绘的棋子拖不动」的修复。
     *
     *   浏览器对 <img> 有**原生拖拽**：在图片上按下再移动，
     *   它会启动 HTML5 drag-and-drop，并且**取消整个指针序列**
     *   （pointercancel）—— 于是拖拽刚开始就被自己的 pointercancel 收掉了。
     *
     *   所以症状很怪：**没有立绘的棋子（emoji 图标）能拖，有立绘的拖不动**，
     *   而两者的拖拽代码完全一样。差别只在于前者根本没有 <img> 元素。
     *
     *   draggable=false + CSS 里的 -webkit-user-drag:none 一起上，
     *   两个都是必需的：draggable 管标准路径，-webkit-user-drag 管老 WebKit。
     *   另外在 document 上还兜了一层 dragstart 拦截，见 onDragStartGuard。 */
    img.draggable = false;
    /* ★ 原来这里是 `img.onerror = removeChild`（一次失败就永久没了）——
       改成 wireArtImg 的重试逻辑，见上面的注释。 */
    wireArtImg(img, window.ART.url(d.id));
    art.appendChild(img);
    box.appendChild(art);

    /* ★ 1 星不画星（画了反而显得像"有星"），2 星起画对应颗数。
       用 repeat 而不是三元链：加 4 星时 `star === 2 ? '★★' : '★★★'`
       会把 4 星画成 3 颗 —— 玩家看到一个"三星"其实是四星。 */
    box.appendChild(UI.el('span', 'u-stars',
      u.star <= 1 ? '' : new Array(u.star + 1).join('★')));
    box.appendChild(UI.el('span', 'u-cost', String(d.cost)));
    if (u.items.length) {
      /* 棋子卡上的装备角标：有图用图、没图用 emoji。
         这里尺寸很小（约 12px），所以图片和文字混排时统一按同样高度对齐。 */
      var badges = UI.el('span', 'u-items');
      u.items.forEach(function (x) {
        var it = ST.ITEM_BY_ID[x];
        if (!it) return;
        var img = window.ART ? window.ART.itemGet(x) : null;
        if (img) {
          var bi = UI.el('img', 'u-itembadge');
          bi.src = window.ART.itemUrl(x);
          bi.alt = '';
          bi.title = it.name;
          /* ★ 这里能进来说明 itemGet 已经是 'ok'（图已经在缓存里了），
             所以 onerror 基本只会在"缓存被清掉"这种极端情况下发生 ——
             仍然接上同一套重试，免得它变成唯一一处"一次失败就没了"。 */
          wireArtImg(bi, window.ART.itemUrl(x));
          badges.appendChild(bi);
        } else {
          badges.appendChild(UI.el('i', 'u-itembadge-emoji', it.emoji));
        }
      });
      box.appendChild(badges);
    }
    box.title = d.name + ' ' + u.star + '★　' + d.skill.name + '：' + d.skill.desc;

    // 右键出售，快捷
    box.oncontextmenu = function (ev) {
      ev.preventDefault();
      sellUnit(u.uid);
      return false;
    };
    return box;
  }

  function renderBench() {
    var host = $('bench');
    if (!host) return;
    if (!host.dataset.built) {
      host.innerHTML = '';
      for (var i = 0; i < G.bench.length; i++) {
        var slot = UI.el('div', 'bench-cell empty');
        slot.dataset.i = String(i);
        host.appendChild(slot);
      }
      host.dataset.built = '1';
    }
    for (var j = 0; j < host.children.length; j++) {
      var cell = host.children[j];
      var u = G.bench[j];
      cell.innerHTML = '';
      cell.className = 'bench-cell' + (u ? '' : ' empty');
      if (u) {
        cell.appendChild(unitChip(u));
        if (G.sel && G.sel.uid === u.uid) cell.classList.add('sel');
      }
    }
  }

  function renderShop() {
    var host = $('shop-row');
    if (!host) return;
    host.innerHTML = '';
    for (var i = 0; i < G.shop.length; i++) {
      (function (idx) {
        var defId = G.shop[idx];
        if (!defId) {
          var empty = UI.el('div', 'shop-card sold');
          empty.appendChild(UI.el('span', 'sc-empty', '已买走'));
          host.appendChild(empty);
          return;
        }
        var d = def(defId);

        // 结构对齐金铲铲的商店卡：立绘铺满整张卡，费用徽章在左上，
        // 名字压在卡底部的暗色带里，羁绊小字在名字下面。
        var card = UI.el('div', 'shop-card cost' + d.cost);

        var art = UI.el('div', 'sc-art');
        art.appendChild(UI.el('div', emojiCls('sc-fallback', d.emoji), d.emoji));
        var img = document.createElement('img');
        img.className = 'sc-artimg';
        wireArtImg(img, window.ART.url(d.id));
        img.src = window.ART.url(d.id);
        img.alt = '';
        art.appendChild(img);
        card.appendChild(art);

        card.appendChild(UI.el('span', 'sc-badge', String(d.cost)));
        card.appendChild(UI.el('span', 'sc-price', d.cost + ' 🪙'));

        var band = UI.el('div', 'sc-nameband');
        band.appendChild(UI.el('div', 'sc-name', d.name));
        band.appendChild(UI.el('div', 'sc-traits', d.traits.map(function (t) {
          return ST.TRAIT_BY_ID[t].name;
        }).join(' · ')));
        card.appendChild(band);

        var afford = G.gold >= d.cost && firstFreeBench() >= 0;
        if (!afford) card.classList.add('no-afford');
        card.title = d.name + '（' + d.cost + ' 费）　' + d.skill.name + '：' + d.skill.desc +
          '\n生命 ' + d.hp + '　攻击 ' + d.ad + '　攻速 ' + d.as + '　射程 ' + d.range;
        card.onclick = function () { buyFromShop(idx); };
        host.appendChild(card);
      })(i);
    }
  }

  /**
   * 商店概率条 + 锁定 + 两个大按钮的状态。
   *
   * 概率条让你知道「这个等级能不能刷出高费卡」；
   * 锁定让你在关键回合理直气壮地留住一张好牌；
   * 买经验按钮上直接写「还差多少升级」，省得玩家自己去 HUD 上算。
   */
  function renderShopHead() {
    var box = $('shop-odds');
    if (box) {
      var odds = ST.LEVEL_TABLE[G.lvl].odds;
      box.innerHTML = '';
      for (var i = 0; i < odds.length; i++) {
        if (odds[i] <= 0) continue;
        var o = UI.el('span', 'odd o' + (i + 1));
        var bar = UI.el('span', 'od-bar');
        var fill = UI.el('i');
        fill.style.width = Math.round(odds[i] * 100) + '%';
        bar.appendChild(fill);
        o.appendChild(bar);
        o.appendChild(UI.el('b', '', (i + 1) + '费'));
        o.appendChild(UI.el('em', '', Math.round(odds[i] * 100) + '%'));
        box.appendChild(o);
      }
    }

    var lock = $('btn-lock');
    if (lock) {
      lock.textContent = G.locked ? '🔒 已锁定' : '🔓 锁定';
      lock.classList.toggle('locked-on', !!G.locked);
      lock.title = G.locked ? '回合开始时不刷新商店（点一下解锁）' : '锁定后回合开始不会刷新商店';
    }

    var rerollBtn = $('btn-reroll');
    if (rerollBtn) rerollBtn.classList.toggle('poor', G.gold < R.REROLL_COST);

    var need = xpNeeded();
    var xpBtn = $('btn-xp');
    if (xpBtn) {
      var maxed = !need;
      xpBtn.classList.toggle('maxed', maxed);
      xpBtn.classList.toggle('poor', !maxed && G.gold < R.XP_COST);
      var hint = $('xp-hint');
      if (hint) {
        hint.textContent = maxed
          ? '已经是最高等级'
          : ('升到 ' + (G.lvl + 1) + ' 级还差 ' + Math.max(0, need - G.xp));
      }
      var bar2 = $('xp-bar-fill');
      if (bar2) {
        bar2.style.width = maxed ? '100%'
          : (need ? Math.min(100, G.xp / need * 100).toFixed(0) + '%' : '100%');
      }
    }
  }

  function toggleLock() {
    G.locked = !G.locked;
    pushLog(G.locked ? '商店已锁定，回合开始不会刷新' : '商店已解锁', 'sys');
    renderShopHead();
  }

  function renderItems() {
    var host = $('item-row');
    if (!host) return;
    host.innerHTML = '';
    if (!G.bag.length) {
      host.appendChild(UI.el('span', 'note', '还没有装备。通关某些关卡会掉落。'));
      return;
    }
    for (var i = 0; i < G.bag.length; i++) {
      (function (idx) {
        var it = ST.ITEM_BY_ID[G.bag[idx]];
        var chip = UI.el('div', 'item-chip');
        /* 装备图标：art/items/<id>.png 有图就用图，没图退回 emoji。
           和棋子立绘同一套「缺了也不会破」的思路。 */
        var art = window.ART ? window.ART.itemGet(it.id) : null;
        if (art) {
          var img = UI.el('img', 'item-artimg');
          wireArtImg(img, window.ART.itemUrl(it.id));
          img.src = window.ART.itemUrl(it.id);
          img.alt = '';
          chip.appendChild(img);
        } else {
          chip.appendChild(document.createTextNode(it.emoji));
        }
        chip.title = itTitle(it) + '（点一下选中，再点棋子装上）';
        if (G.sel && G.sel.kind === 'item' && G.sel.idx === idx) chip.classList.add('sel');
        chip.onclick = function () {
          G.sel = { kind: 'item', idx: idx };
          UI.sound.click();
          renderItems(); renderBoard(); renderBench(); renderSelBar();
        };
        host.appendChild(chip);
      })(i);
    }
  }

  /**
   * 星级被动的展示文案。按 kind 分派：
   *   frenzy    每次攻击叠攻速（有上限）
   *   hurtHeal  每次受伤回血（不叠层）
   *   healGift  每次治疗给被治疗者挂一个伤害改动（2 星掷骰子，3 星必定增伤）
   * 加新 kind 时这里要一起加，否则界面上会出现一句看不懂的话。
   */
  /** 装备的一句话标题：名字 + 技能名 + 数值说明 */
  function itTitle(it) {
    return it.name + (it.skill && it.skill.name ? ('【' + it.skill.name + '】') : '') +
      '：' + it.desc;
  }

  /**
   * 从被动名字表里取某个星级的**显示名字**。
   *
   * ★★ 为什么必须走这一个函数：`passive.names` 里同一个星级的名字写法不统一 ——
   *    有的是字符串（`2: '巧乐兹'`），有的是**累积数组**
   *    （`2: ['你快不过我你信吗', '巧乐兹']`，3 星就是三个名字叠在一起）。
   *    直接塞进字符串拼接里，数组会被 `toString()` 成「你快不过我你信吗,巧乐兹」，
   *    玩家看到的就是一串带逗号的名字链 —— **12 个被动里有 7 个是数组写法**，
   *    所以这不是个别失误，是这一类写法的默认坑。
   *    统一取数组的**最后一个**（= 这个星级新解锁的那一层）。
   */
  function wan(v, fb) {
    return (v instanceof Array) ? (v[v.length - 1] || fb) : (v || fb);
  }

  /**
   * 按星级查一张「数字表」（比如电棍的 `maxAtOnce`：1/2 星 1 条、3 星 3 条）。
   *
   * ★★ 为什么要单独写一个：**4 星不在任何表里**。
   *    直接 `map[star]` 取到 undefined 会掉进兜底值，文案就变成
   *    「每个电棍同时只能挂 1 条」—— 而 4 星电棍在战斗里是 3 条。
   *    规则要和战斗引擎**完全一致**：查不到就往**低**的档位取最大值
   *    （4 星 = 3 星融合出来的，能力停在 3 星那一档）。
   *    `battle.js` 里的 `starLookup` 就是这个规则，只是它是模块私有的，
   *    文案层够不着，所以这里用同一套逻辑再写一遍。
   */
  function starNum(map, star, fb) {
    var base = (fb === undefined) ? 0 : fb;
    if (!map) return base;
    if (typeof map[star] === 'number') return map[star];
    var best = base;
    for (var kk in map) {
      var kn = parseInt(kk, 10);
      if (!isNaN(kn) && kn <= star && typeof map[kk] === 'number' && map[kk] > best) {
        best = map[kk];
      }
    }
    return best;
  }

  function passiveLine(d, star) {
    var name = ST.passiveName(d, star);
    if (!name) return null;
    var kind = ST.passiveKind(d);
    var step = Math.round(ST.passiveStep(d, star) * 100);
    if (kind === 'frenzy') {
      var cap = Math.round(ST.passiveCap(d) * 100);
      return '⚡ ' + name + '：每次攻击攻速 +' + step + '%，本局内叠加、上限 +' + cap + '%';
    }
    if (kind === 'hurtHeal') {
      return '🐺 ' + name + '：每次受到伤害回复最大生命的 ' + step + '%';
    }
    if (kind === 'healGift') {
      /* ★ 2 星和 3 星的差别不是数值，是「还要不要掷骰子」——
         所以这一行的措辞必须跟着星级变。写成一句通用说明的话，
         玩家看不出升到 3 星到底改变了什么。 */
      if (star >= 3) {
        return '💡 ' + name + '：每次治疗必定让被治疗者增伤 ' + step + '%（4 秒，可刷新）';
      }
      return '🌀 ' + name + '：每次治疗有 50% 概率让被治疗者增伤 ' + step +
        '%，另外 50% 让ta减伤 ' + step + '%（4 秒，可刷新）';
    }
    if (kind === 'snipeSure') {
      /* ★★ 这里千万不能像别的 kind 那样 ×100！
         snipeSure 的 passiveStep 是**次数**（2 星 1 次、3 星 2 次），
         照抄上面那几行的写法会显示成「必定命中 100 次」。 */
      var n = ST.passiveStep(d, star);
      return '🎯 ' + name + '：每局前 ' + n + ' 次狙击必定命中';
    }
    if (kind === 'clawGuard') {
      /* ★★ 和 snipeSure 一样，passiveStep 是**次数**而不是百分比 ——
         照抄上面几行那种 ×100 的写法会显示成「能挡 2000 次」。 */
      var g2 = ST.passiveStep(d, star);
      var gmax = ST.passiveStep(d, 3);
      return '🛡 ' + name + '：敌人前 ' + g2 + ' 次攻击无法对它造成伤害' +
        (g2 >= gmax ? '（已满档）' : ('（3 星可以到 ' + gmax + ' 次）'));
    }
    if (kind === 'overclock') {
      /* ★ 张雪峰的三层也是**叠加**的（3 星 = 1 星 + 2 星 + 雪毙），
         所以这一行要说清"已经解锁到哪一层"。数值全部从数据取。 */
      var po = d.passive || {};
      var pn = po.names || {};
      /* ★ 数值全部从数据取，一个都不写死 —— 2026-10 削弱过一版
         （开局 100%→60%、狂暴线 200%→100%、新加 200% 上限），
         写死的地方全都变成了假信息。 */
      var zhStep = (po.ocPerHit || 0) * (po.ocBerserkMul > 0 ? po.ocBerserkMul : 1);
      var zhName = po.ocBerserkName || '狂暴';
      var seg = ['⚡ ' + (pn[1] || '超频') + '：开局攻速 +' +
                 Math.round((po.ocAsStart || 0) * 100) + '%、移速 +' +
                 Math.round((po.ocMoveStart || 0) * 100) + '%，每次普攻再 +' +
                 Math.round((po.ocPerHit || 0) * 100) + '%；攻速加成到 +' +
                 Math.round((po.ocThreshold || 0) * 100) + '% 进入「' + zhName +
                 '」—— 每秒失去当前生命的 ' + Math.round((po.ocBurnPct || 0) * 100) +
                 '%，但每次普攻叠的攻速翻倍到 +' + Math.round(zhStep * 100) + '%' +
                 // ★ 上限是 2026-10 新加的：没有上限时这一句不该出现
                 (po.ocMaxAs > 0
                   ? ('（加成上限 +' + Math.round(po.ocMaxAs * 100) + '%）')
                   : '') +
                 '；' +
                 // ★ 范围是 3 星才有的，1/2 星写「单体」—— 写错就是假信息
                 ((po.ocAoeAt && star >= po.ocAoeAt)
                   ? ('普攻变 ' + ((po.ocAoeRadius || 0) * 2 + 1) + '×' +
                      ((po.ocAoeRadius || 0) * 2 + 1) + ' 范围')
                   : '普攻是单体')];
      if (po.chillAt && star >= po.chillAt) {
        seg.push('🧊 ' + wan(pn[2], '巧乐兹') + '：每次普攻给敌人 +' + (po.chillPerHit || 1) +
          ' 层冰棍（每层 -' + Math.round((po.chillPerStack || 0) * 100) +
          '% 攻速移速），满 ' + po.chillMax + ' 层冰冻 ' + po.freezeDur + ' 秒');
      }
      if (po.ocAdAt && star >= po.ocAdAt) {
        var pn3 = (pn[3] instanceof Array) ? pn[3][pn[3].length - 1] : '雪毙';
        seg.push('❄ ' + pn3 + '：进入「' + zhName + '」之后攻击力 +' +
          Math.round((po.ocAdPct || 0) * 100) +
          '%，普攻升级成 ' + ((po.ocAoeRadius || 0) * 2 + 1) + '×' +
          ((po.ocAoeRadius || 0) * 2 + 1) + ' 范围');
      }
      return seg.join('　');
    }
    if (kind === 'current') {
      /* ★ 电棍也是**1 星就有被动**的（导电），所以这一行要自带"还差什么"。
         ★ 「同时存在几条」是按星级变的（1/2 星 1 条、3 星 3 条），
           所以这句话里的数字必须**从数据取**。 */
      var pc = d.passive || {};
      var pcn = pc.names || {};
      var r3 = (pc.radius || 0) * 2 + 1;
      /* ★ 「同时几条」是按星级的表（1/2 星 1 条、3 星 3 条），
         不能走 `wan()`（那是给"名字可能是数组"用的）。
         ★ 4 星不在表里 —— 走 starNum 往低档取，和战斗引擎同一套规则。 */
      var cmaxAt = starNum(pc.maxAtOnce, star, 1);
      /* ★ "这一星级把同时存在数放宽了吗" —— 用它决定要不要列出「三相电」那一层。
         比的是**1 星那一档**（基准），不是前一档：比前一档的话 4 星会算出
         「3 > 3 = 假」，同一张卡在 3 星写着「三相电」、升到 4 星反而消失了。
         比基准仍然是从数据里推出来的，改表时文案自动跟着走。 */
      var cmaxBase = starNum(pc.maxAtOnce, 1, 1);
      var seg = ['⚡ ' + wan(pcn[1], '导电') + '：普攻和技能会留下电流，' +
                 (pc.delay || 0.5) + ' 秒后向 ' + r3 + '×' + r3 + ' 内的敌人弹射，' +
                 '每次 ' + Math.round((pc.bouncePct || 0) * 100) + '% 攻击力，最多 ' +
                 (pc.maxBounces || 0) + ' 次（每个电棍同时只能挂 ' + cmaxAt + ' 条）'];
      if (pc.stunAt && star >= pc.stunAt) {
        seg.push('💫 ' + wan(pcn[2], '麻痹') + '：每次弹射额外击晕 ' +
          (pc.stunDur || 0) + ' 秒');
      }
      if (cmaxAt > cmaxBase) {
        seg.push('🔌 ' + wan(pcn[3], '三相电') + '：同时能挂 ' + cmaxAt + ' 条电流');
      }
      if (star < 3) {
        seg.push('☆ 还差：' + (star < 2
          ? ('2 星「' + wan(pcn[2], '麻痹') + '」弹射带 ' + (pc.stunDur || 0) + ' 秒眩晕、')
          : '') +
          '3 星「' + wan(pcn[3], '三相电') + '」同时能挂 ' +
          ((pc.maxAtOnce && pc.maxAtOnce[3]) || 3) + ' 条电流');
      }
      return seg.join('　');
    }
    if (kind === 'frost') {
      /* ★★ 冰冰冰的两层改的都是**技能本身**（加冰冻 / 改成打全场），
         所以这一行必须把技能名和数字一起报出来 —— 只写「冻手冻脚」的话，
         玩家不知道"冻多久"，也不知道 3 星那句"千里冰封"到底改了什么。
         ★ `passiveStep` 在这个 kind 上只是"这一星级有没有被动"的开关（1/1），
           真数字在 freezeDur / freezeAt / allAt 里，**别拿 step 去 ×100**
           （snipeSure / clawGuard / domain / field 都踩过这个坑）。
         ★ 1 星没有被动 —— 界面走的是 passiveTeaser，
           但引擎里 1 星确实没有任何加成（frostFreezeDur = 0、frostAll = false）。 */
      var pfz = d.passive || {};
      var pzn = pfz.names || {};
      var skz = d.skill || {};
      var rad = (skz.radius || 0) * 2 + 1;
      var segZ = ['🧊 ' + (skz.name || '寒霜新星') + '：在目标格炸开，' +
                  rad + '×' + rad + ' 范围内的敌人吃 ' + (skz.damage || 0) + ' 点法术伤害'];
      if (pfz.freezeAt && star >= pfz.freezeAt) {
        segZ.push('❄ ' + wan(pzn[2], '冻手冻脚') + '：被技能打中的敌人额外冰冻 ' +
                  (pfz.freezeDur || 0) + ' 秒');
      }
      if (pfz.allAt && star >= pfz.allAt) {
        segZ.push('🌨 ' + wan(pzn[3], '千里冰封') + '：技能改成攻击全体敌人' +
                  '（不再只看目标格附近）');
      }
      if (star < 3) {
        segZ.push('☆ 还差：' + (star < 2
          ? ('2 星「' + wan(pzn[2], '冻手冻脚') + '」技能附带 ' +
             (pfz.freezeDur || 0) + ' 秒冰冻、')
          : '') +
          '3 星「' + wan(pzn[3], '千里冰封') + '」技能打全体');
      }
      return segZ.join('　');
    }
    if (kind === 'delivery') {
      /* ★★ 美团袋鼠的两层都是**围绕外卖**做的，所以这一行必须把
         "外卖是什么"（技能本身）和"升星之后外卖多了什么"一起说清楚 ——
         只写「准时送达」的话，玩家不知道是给谁加速、加多少、几秒。
         ★ `passiveStep` 在这个 kind 上只是"这一星级有没有被动"的开关（1/1），
           真数字在 asBuffPct / healPct / radius 里，**别拿 step 去 ×100**。
         ★ 局部变量统一带 `dl` 后缀：这一整个函数里 `var` 是**函数级**的，
           和上面 domain 分支的 pd / segD 撞名不会报错、但会让下一个人改错行。 */
      var pdl = d.passive || {};
      var pdnl = pdl.names || {};
      var skdl = d.skill || {};
      var dRadL = ((pdl.radius || 0) * 2 + 1);
      var segDL = ['🛵 ' + (skdl.name || '治疗外卖') + '：投掷一个外卖，治疗血量百分比最低的队友'];
      if (pdl.asBuffAt && star >= pdl.asBuffAt) {
        segDL.push('⚡ ' + wan(pdnl[2], '准时送达') + '：收到外卖的队友攻速 +' +
          Math.round((pdl.asBuffPct || 0) * 100) + '%，持续 ' +
          (pdl.asBuffDur || 0) + ' 秒');
      }
      if (pdl.healAt && star >= pdl.healAt) {
        segDL.push('🍱 ' + wan(pdnl[3], '好评如潮') + '：普通攻击会治疗被攻击敌人 ' +
          dRadL + '×' + dRadL + ' 范围内的友方单位（每人 ' +
          Math.round((pdl.healPct || 0) * 100) + '% 最大生命）');
      }
      if (star < 3) {
        segDL.push('☆ 还差：' + (star < 2
          ? ('2 星「' + wan(pdnl[2], '准时送达') + '」外卖顺带 +' +
             Math.round((pdl.asBuffPct || 0) * 100) + '% 攻速、')
          : '') +
          '3 星「' + wan(pdnl[3], '好评如潮') + '」普攻治疗被攻击者周围 ' +
          dRadL + '×' + dRadL + ' 内的队友');
      }
      return segDL.join('　');
    }
    if (kind === 'noodle') {
      /* ★★ 东北雨姐的两层都挂在"技能那一下"和"打谁"上，所以这一行必须把
         **技能本身在干什么**（套盾）一起说清楚 —— 只写「红薯粉丝」的话，
         玩家不知道她放的是什么技能、也不知道"捆住"是哪来的。
         ★ `passiveStep` 在这个 kind 上只是"这一星级有没有被动"的开关（1/1），
           真数字在 bindDur / bindRadius / hitHealPct 里，**别拿 step 去 ×100**。
         ★ 局部变量带 `nd` 后缀（函数级 var，和上面几个分支的重名不会报错，
           但会让下一个人改错行）。 */
      var pnd = d.passive || {};
      var pndn = pnd.names || {};
      var skn = d.skill || {};
      var nRad = ((pnd.bindRadius || 0) * 2 + 1);
      var segND = ['🛡 ' + (skn.name || '圣盾术') + '：给血量百分比最低的队友套 ' +
        (skn.amount || 0) + ' 点护盾'];
      if (pnd.bindAt && star >= pnd.bindAt) {
        segND.push('🍜 ' + wan(pndn[2], '红薯粉丝') + '：放技能的同时把身边 ' +
          nRad + '×' + nRad + ' 内的敌人捆住 ' + (pnd.bindDur || 0) +
          ' 秒（钉在原地，但还能还手）');
      }
      if (pnd.healAt && star >= pnd.healAt) {
        segND.push('🍠 ' + wan(pndn[3], '雨姐的关照') + '：攻击被捆住的敌人时，' +
          '给血量百分比最低的队友回 ' + Math.round((pnd.hitHealPct || 0) * 100) +
          '% 最大生命');
      }
      if (star < 3) {
        segND.push('☆ 还差：' + (star < 2
          ? ('2 星「' + wan(pndn[2], '红薯粉丝') + '」放技能捆住身边 ' + nRad + '×' +
             nRad + ' 内的敌人 ' + (pnd.bindDur || 0) + ' 秒、')
          : '') +
          '3 星「' + wan(pndn[3], '雨姐的关照') + '」打被捆住的敌人给最低血队友回 ' +
          Math.round((pnd.hitHealPct || 0) * 100) + '% 最大生命');
      }
      return segND.join('　');
    }
    if (kind === 'mikado') {
      /* ★ 孙笑川是**1 星就有被动**的（天皇），所以这一行既要写清
         "已经解锁了什么"，也要写"还差什么" —— 不能像豆包那样只给升星预告
         （它 1 星没被动），也不能像张雪峰那样默认第一层就是起点就不提后续。 */
      var pm = d.passive || {};
      var pmn = pm.names || {};
      var mir = (pm.auraRadius || 0) * 2 + 1;
      var seg = ['👑 ' + wan(pmn[1], '天皇') + '：自身 ' + mir + '×' + mir +
                 ' 内的队友 +' + Math.round((pm.auraLifesteal || 0) * 100) + '% 吸血'];
      if (pm.skillHealAt && star >= pm.skillHealAt) {
        seg.push('🩸 ' + wan(pmn[2], '儒雅随和') + '：技能造成的伤害 ' +
          Math.round((pm.skillHealPct || 0) * 100) + '% 转化为自己的治疗');
      }
      if (pm.convertAt && star >= pm.convertAt) {
        seg.push('🏳 ' + wan(pmn[3], '安排上了') + '：被自己击败的敌人以 ' +
          Math.round((pm.convertHpPct || 0) * 100) +
          '% 生命倒戈成我方单位（对有复活能力的无效）');
      }
      if (star < 3) {
        seg.push('☆ 还差：' + (star < 2
          ? ('2 星「' + wan(pmn[2], '儒雅随和') + '」技能伤害全额回血、')
          : '') +
          '3 星「' + wan(pmn[3], '安排上了') + '」击败的敌人以 ' +
          Math.round((pm.convertHpPct || 0) * 100) + '% 生命倒戈');
      }
      return seg.join('　');
    }
    if (kind === 'lastRites') {
      /* ★ 老牧师 1 星没有被动（names 从 2 开始写），所以这里只可能被 2/3 星调到；
         代码仍然按"已经解锁到哪一层"写，和别的 kind 保持一致。
         ★ 这一条**不能写"每 X 秒"或"每次"** —— 它是**每场战斗一次**的
           一次性资源，写含糊了玩家会以为能反复救人。 */
      var pr = d.passive || {};
      var prn = pr.names || {};
      var seg = ['🙏 ' + wan(prn[2], '还能抢救一下') + '：每场战斗一次 —— 第一个阵亡的' +
                 '队友会在 ' + (pr.reviveDelay || 1) + ' 秒祷告后' +
                 (Math.round((pr.reviveHpPct || 1) * 100) >= 100
                   ? '满血站起来' : ('以 ' + Math.round((pr.reviveHpPct || 1) * 100) +
                                     '% 的血站起来')) +
                 '（原地，原格被占就落到最近的空格；老牧师救不了自己）'];
      if (pr.adBuffAt && star >= pr.adBuffAt) {
        seg.push('✨ ' + wan(prn[3], '圣光赐福') + '：复活的那一刻，老牧师和被救的人' +
          '攻击力都 +' + Math.round((pr.adBuffPct || 0) * 100) + '%（本局有效）');
      }
      return seg.join('　');
    }
    if (kind === 'laugh') {
      /* ★ 奶龙的三层改的是**同一个状态**（大笑），而且技能本身就带
         减伤和回血，所以这里不像牢大/张雪峰那样逐层列数值，
         只说清"这一星级解锁了什么"，而且只列已经解锁的
         （还差什么交给下面的 passiveTeaser）。 */
      var pk = d.passive || {};
      var pkn = pk.names || {};
      var sk = d.skill || {};
      var lN2 = (pkn[2] instanceof Array) ? pkn[2][pkn[2].length - 1] : (pkn[2] || '边走边笑');
      var lN3 = (pkn[3] instanceof Array) ? pkn[3][pkn[3].length - 1] : (pkn[3] || '笑传四方');
      var lRad = (pk.healRadius || 0) * 2 + 1;
      var seg = ['😂 ' + (pkn[1] || '笑气护体') + '：大笑 ' + (sk.dur || 0) +
                 ' 秒，期间受到的伤害 -' + Math.round((sk.dmgCut || 0) * 100) +
                 '%、每秒回复 ' + Math.round((sk.healPct || 0) * 100) + '% 最大生命'];
      if (pk.moveAt && star >= pk.moveAt) {
        seg.push('🚶 ' + lN2 + '：大笑时可以移动（仍然不能攻击）');
      }
      if (pk.healAt && star >= pk.healAt) {
        seg.push('💚 ' + lN3 + '：大笑时同时治疗 ' + lRad + '×' + lRad + ' 范围内的队友');
      }
      return seg.join('　');
    }
    if (kind === 'domain') {
      /* ★ 嘉豪的被动改的是**技能本身的参数**（一次控几个、控多久），
         所以这一行必须把技能数值一起报出来 ——
         只写「两个男人」的话，玩家不知道"两个"是几个、
         更不知道 3 星还多了一个时长翻倍。
         ★ `passiveStep` 在这个 kind 上只是个"这一星级有没有被动"的开关（0/1），
           真正的数字在 targets / durMul 里，**别拿 step 去 ×100**。 */
      var pd = d.passive || {};
      var pdn = pd.names || {};
      var skd = d.skill || {};
      var t2 = (pd.targets && pd.targets[2] > 0) ? pd.targets[2] : 2;
      var t3 = (pd.targets && pd.targets[3] > 0) ? pd.targets[3] : 3;
      var m3 = (pd.durMul && pd.durMul[3] > 0) ? pd.durMul[3] : 1;
      var n2d = (pdn[2] instanceof Array) ? pdn[2][pdn[2].length - 1] : (pdn[2] || '两个男人');
      var n3d = (pdn[3] instanceof Array) ? pdn[3][pdn[3].length - 1] : (pdn[3] || '三个男人');
      var r2 = function (x) { return Math.round(x * 100) / 100; };
      var segD = ['🕶️ ' + n2d + '：一次同时控制 ' + t2 + ' 个人（各眩晕 ' + skd.dur + ' 秒）'];
      if (star >= 3) {
        segD.push('⏳ ' + n3d + '：控制人数到 ' + t3 + ' 个，眩晕时间 ×' + m3 +
                  '（' + skd.dur + ' → ' + r2(skd.dur * m3) + ' 秒）');
      } else {
        segD.push('☆ ' + n3d + '（3 星）：控 ' + t3 + ' 个，眩晕翻倍到 ' +
                  r2(skd.dur * m3) + ' 秒');
      }
      return segD.join('　');
    }
    if (kind === 'peak') {
      /* ★ 羊帆的两层是**互相独立**的两件事（2 星改的是"打出去之后"、
         3 星改的是"它自己死的时候"），所以分开列，各自说清门槛。
         ★ `passiveStep` 在这里只是"这一星级有没有被动"的开关（0/1），
           真正的数字在 stunDur / boomAdMult 里，别拿 step 去 ×100。 */
      var pp = d.passive || {};
      var ppn = pp.names || {};
      var skp = d.skill || {};
      var pNm2 = (ppn[2] instanceof Array) ? ppn[2][ppn[2].length - 1] : (ppn[2] || '笑上巅峰');
      var pNm3 = (ppn[3] instanceof Array) ? ppn[3][ppn[3].length - 1] : (ppn[3] || '巅峰谢幕');
      var segP = [];
      if (pp.stunAt && star >= pp.stunAt) {
        segP.push('😵 ' + pNm2 + '：巅峰一击（×' + (skp.mult || 20) + '）把目标震晕 ' +
                  (pp.stunDur || 3) + ' 秒，并让它笑到停不下来');
      }
      if (pp.boomAt && star >= pp.boomAt) {
        segP.push('💥 ' + pNm3 + '：阵亡 1 秒后原地自爆，3×3 范围受到攻击力 ×' +
                  (pp.boomAdMult || 20) + ' 的物理伤害，活下来的还要被震晕 ' +
                  (pp.stunDur || 3) + ' 秒');
      }
      if (!segP.length) segP.push('🐑 ' + ST.passiveName(d, star));
      return segP.join('　');
    }
    if (kind === 'field') {
      /* ★ 楚生疑犯：2 星和 3 星是**两件不相干的事**（一件给队友、一件给自己），
         所以分开列，而且都要把数字从数据里取出来 ——
         `passiveStep` 在这里只是"这一星级有没有被动"的开关（0/1），
         真数字在 allyCut / shadowAsCut / shadowDmgMul 里，别拿去 ×100。 */
      var pf = d.passive || {};
      var pfn = pf.names || {};
      var skf = d.skill || {};
      var fNm2 = (pfn[2] instanceof Array) ? pfn[2][pfn[2].length - 1] : (pfn[2] || '同伙掩护');
      var fNm3 = (pfn[3] instanceof Array) ? pfn[3][pfn[3].length - 1] : (pfn[3] || '遁入暗影');
      var segF = ['🌧️ ' + (skf.name || '阴暗领域') + '：' +
                  ((skf.radius || 0) * 2 + 1) + '×' + ((skf.radius || 0) * 2 + 1) +
                  ' 范围内敌人的攻速移速减半（' + (skf.dur || 0) + ' 秒）'];
      if (pf.allyCutAt && star >= pf.allyCutAt) {
        segF.push('☂ ' + fNm2 + '：领域里的队友少受 ' +
                  Math.round((pf.allyCut || 0) * 100) + '% 的敌人伤害');
      }
      if (pf.shadowAt && star >= pf.shadowAt) {
        segF.push('🌑 ' + fNm3 + '：每次放完技能遁入暗影 —— 攻速 ×' +
                  (1 - (pf.shadowAsCut || 0)) + '、伤害 ×' + (pf.shadowDmgMul || 2) +
                  '，免疫一切伤害也不会被索敌，直到队友全部阵亡');
      }
      if (!segF.length) segF.push('🌧️ ' + ST.passiveName(d, star));
      return segF.join('　');
    }
    if (kind === 'loneWolf') {
      /* ★★ Dank1ng **1 星就有被动**（空悲切），所以界面在这里走的是
         passiveLine 而不是 passiveTeaser —— 也就是说 1 星那一行
         必须**自己**把"已经有的"和"还差什么"都写出来。
         （牢大 / 张雪峰也是 1 星有被动，处理方式一样。）
         ★ 三个数字（能量回复 ×2）从数据取；`passiveStep` 在这条上只是
           "这一星级有没有被动"的开关（0/1），拿去 ×100 会写成「×200」。 */
      var pl = d.passive || {};
      var pln = pl.names || {};
      var segL = [];
      segL.push('♾️ ' + (pln[1] || '空悲切') + '：队友全部阵亡后能量无限（法力永远满格）');
      if (pl.startFullAt && star >= pl.startFullAt) {
        segL.push('⚡ ' + wan(pln[2], '老男孩') + '：开局满能量');
      }
      if (pl.regenMulAt && star >= pl.regenMulAt) {
        segL.push('🎯 ' + wan(pln[3], '锁头') + '：能量回复 ×' + (pl.regenMul || 2) +
                  '，每次击杀都把能量回满');
      }
      if (star < 3) {
        segL.push('☆ 还差：' + (star < 2 ? ('2 星「' + wan(pln[2], '老男孩') + '」开局满能量、') : '') +
                  '3 星「' + wan(pln[3], '锁头') + '」能量回复 ×' + (pl.regenMul || 2) +
                  ' 且击杀回满');
      }
      return segL.join('　');
    }
    if (kind === 'crash') {
      /* ★ 牢大的三个效果是**叠加**的（3 星 = 1 星 + 2 星 + 自己的那一条），
         所以这一行必须把「已经解锁到哪一层」说清楚，
         写成一句通用说明的话，玩家看不出升到 2 星到底多拿到了什么。
         名字和数值全部从 passive 数据里取，改数值不用回来改文案。 */
      var pa = d.passive || {};
      var pn = pa.names || {};
      var pn3 = (pn[3] instanceof Array) ? pn[3][pn[3].length - 1] : '曼巴精神';
      var seg = ['🚁 ' + (pn[1] || '坠机') + '：阵亡 1 秒后直升机坠毁，对 3×3 范围敌人造成 ' +
                 (pa.crashDamage || 0) + ' 点真实伤害'];
      if (pa.reviveAt && star >= pa.reviveAt) {
        seg.push('✨ ' + (pn[2] || '复活') + '：坠毁后原地复活（' +
                 Math.round((pa.reviveHpPct || 0.5) * 100) + '% 血）');
      }
      if (pa.cdCutAt && star >= pa.cdCutAt) {
        seg.push('🔥 ' + pn3 + '：复活后技能所需法力减半');
      }
      return seg.join('　');
    }
    if (kind === 'bedrock') {
      /* ★ 钟离 2 星和 3 星是**两件不相干的事**（一件罩队友、一件砸敌人），
         所以分开列。`passiveStep` 在这条上只是"这一星级有没有被动"的开关（0/1），
         真数字在 wardCut / meteorAdMul / meteorDur 里，别拿去 ×100。 */
      var pbd = d.passive || {};
      var pbdn = pbd.names || {};
      var skd = d.skill || {};
      var wNm = (pbdn[2] instanceof Array) ? pbdn[2][pbdn[2].length - 1] : (pbdn[2] || '玉璋护盾');
      var mNm = (pbdn[3] instanceof Array) ? pbdn[3][pbdn[3].length - 1] : (pbdn[3] || '天星');
      var segD = [];
      if (pbd.wardAt && star >= pbd.wardAt) {
        segD.push('💠 ' + wNm + '：技能「' + (skd.name || '不动如山') +
          '」罩住的**队友**免疫控制（眩晕/冰冻/石化/捆住/击退）、少受 ' +
          Math.round((pbd.wardCut || 0) * 100) + '% 伤害（护盾还在就一直有效）');
      }
      if (pbd.meteorAt && star >= pbd.meteorAt) {
        var mdRad = (pbd.meteorRadius || 1) * 2 + 1;
        segD.push('🪨 ' + mNm + '：每次放技能额外召来陨石，砸敌人最密的 ' +
          mdRad + '×' + mdRad + '，造成 ' + (pbd.meteorAdMul || 5) +
          ' 倍攻击力的伤害，活下来的石化 ' + (pbd.meteorDur || 3) +
          ' 秒；放技能时喊「' + (pbd.meteorShout || '天动万象') + '」');
      }
      if (!segD.length) segD.push('💠 ' + name);
      return segD.join('　');
    }
    if (kind === 'flight') {
      /* ★ 祖国人 1 星就有被动（飞行），所以界面走的是 passiveLine ——
         这一行必须把"已经有的"和"还差什么"都写出来
         （张雪峰 / 牢大 / Dank1ng 也是 1 星有被动，处理方式一样）。
         ★ `passiveStep` 在这条上只是"这一星级有没有被动"的开关（0/1），
           拿去 ×100 会写成「移速 +100%」—— 真正的数字在 flyMovePct 里。 */
      var pfl = d.passive || {};
      var pfln = pfl.names || {};
      var segFl = ['🦸 ' + (pfln[1] || '飞行') + '：移速 +' +
        Math.round((pfl.flyMovePct || 0) * 100) + '%，而且能**从单位上方飞过去**'];
      if (pfl.burnAt && star >= pfl.burnAt) {
        segFl.push('🔥 ' + wan(pfln[2], '灼烧') + '：激光命中后每秒失去 ' +
          Math.round((pfl.burnPct || 0) * 100) + '% 当前生命、持续 ' +
          (pfl.burnDur || 0) + ' 秒（被烧的人**免疫冰冻**）');
      }
      if (pfl.shotsAt && star >= pfl.shotsAt) {
        segFl.push('🔺 ' + wan(pfln[3], '三连激光') + '：一道激光变成连射 ' +
          (pfl.shots || 3) + ' 发，每发 ' + Math.round((pfl.shotMul || 1) * 100) + '% 伤害');
      }
      if (star < 3) {
        segFl.push('☆ 还差：' + (star < 2
          ? ('2 星「' + wan(pfln[2], '灼烧') + '」激光附带灼烧、')
          : '') +
          '3 星「' + wan(pfln[3], '三连激光') + '」连射 ' + (pfl.shots || 3) + ' 发');
      }
      return segFl.join('　');
    }
    if (kind === 'jett') {
      /* ★ 陈兴裕 1 星就有被动（暴力点 / 收到！），所以界面走的是 passiveLine ——
         这一行要把"已经有的"和"还差什么"都写出来。
         ★ `passiveStep` 在这条上只是"这一星级有没有被动"的开关（0/1），
           拿去 ×100 会写成「攻速 +100%」—— 真数字在 asPct / dmgOutPct 里。 */
      var pj = d.passive || {};
      var pjn = pj.names || {};
      var segJ = ['💥 ' + wan(pjn[1], '暴力点') + '：攻速 +' +
        Math.round((pj.asPct || 0) * 100) + '%，造成与受到的伤害都 +' +
        Math.round((pj.dmgOutPct || 0) * 100) + '%'];
      if (pj.startFullAt && star >= pj.startFullAt) {
        segJ.push('⚡ ' + wan(pjn[2], '开局满充能') + '：开局法力就是满的');
      }
      if (pj.tomeAt && star >= pj.tomeAt) {
        segJ.push('📖 ' + wan(pjn[3], '感谢抗渗送的魔法书') +
          '：友方被**远程攻击**打死时，立刻恢复所有弹药（法力回满）');
      }
      if (star < 3) {
        segJ.push('☆ 还差：' + (star < 2
          ? '2 星「' + wan(pjn[2], '开局满充能') + '」开局法力满格、'
          : '') + '3 星「' + wan(pjn[3], '感谢抗渗送的魔法书') + '」队友被远程打死时回满弹药');
      }
      return segJ.join('　');
    }
    if (kind === 'dingzhen') {
      /* ★ 丁真 2 星和 3 星是**两件不相干的事**（一件挂在敌人身上、一件给自己），
         所以分开列。`passiveStep` 在这条上只是"这一星级有没有被动"的开关（0/1），
         真数字在 slowCut / ponyHpPct / ponyManaPct 里，别拿去 ×100。 */
      var pdz = d.passive || {};
      var pdzn = pdz.names || {};
      var skdz = d.skill || {};
      var segDz = [];
      if (pdz.slowAt && star >= pdz.slowAt) {
        segDz.push('🐆 ' + wan(pdzn[2], '芝士雪豹') + '：技能「' +
          (skdz.name || '雪豹撕咬') + '」咬中的人**攻速和移速一起 -' +
          Math.round((pdz.slowCut || 0) * 100) + '%**，持续 ' + (pdz.slowDur || 0) + ' 秒');
      }
      if (pdz.ponyAt && star >= pdz.ponyAt) {
        segDz.push('🐴 ' + wan(pdzn[3], '小马珍珠') + '：骑着小马进场，获得一层等于' +
          '自身生命上限 ' + Math.round((pdz.ponyHpPct || 0) * 100) +
          '% 的护盾；小马被打死时大喊「' + (pdz.ponyShout || '珍珠死了') +
          '」并狂暴（魔力获取 +' + Math.round((pdz.ponyManaPct || 0) * 100) + '%）');
      }
      if (!segDz.length) segDz.push('🐆 ' + name);
      return segDz.join('　');
    }
    if (kind === 'amaterasu') {
      /* ★ 鹰佐 2 星和 3 星是**两件不相干的事**（一件解控、一件点火），
         所以分开列。`passiveStep` 在这条上只是"这一星级有没有被动"的开关（0/1），
         真数字在 batiCd / batiImmuneDur / amaterasuAdMul 里，别拿去 ×100。 */
      var pam = d.passive || {};
      var pamn = pam.names || {};
      var segAm = [];
      if (pam.batiAt && star >= pam.batiAt) {
        segAm.push('🛡 ' + wan(pamn[2], '霸体') + '：受到控制时（金色特效）' +
          '立刻解控并**免控 ' + (pam.batiImmuneDur || 5) + ' 秒**，冷却 ' +
          (pam.batiCd || 25) + ' 秒');
      }
      if (pam.amaterasuAt && star >= pam.amaterasuAt) {
        var amRad = (pam.amaterasuRadius || 1) * 2 + 1;
        segAm.push('🖤 ' + wan(pamn[3], '天照') + '：放完技能在 ' + amRad + '×' + amRad +
          ' 范围点起黑火，造成 ' + (pam.amaterasuAdMul || 2) + ' 倍攻击力的伤害，' +
          '并让敌人被天照灼烧（每秒失去 ' + Math.round((pam.amaterasuPct || 0.05) * 100) +
          '% 当前生命、无视冰冻、**无限时间**）');
      }
      if (!segAm.length) segAm.push('🌀 ' + name);
      return segAm.join('　');
    }
    if (kind === 'eatrice') {
      /* ★ 大肥鱼 2 星和 3 星是**两件不相干的事**（一件回血、一件回蓝），
         所以分开列。技能本身（吃白饭）在它自己那一行里已经写过了。
         ★ `passiveStep` 在这条上只是"这一星级有没有被动"的开关（0/1），
           真数字在 eatHealPct / tokenManaPct 里，别拿去 ×100。 */
      var pe = d.passive || {};
      var pen = pe.names || {};
      var ske = d.skill || {};
      var segE = [];
      if (pe.eatHealAt && star >= pe.eatHealAt) {
        segE.push('🍽 ' + wan(pen[2], '吃撑了') + '：吃掉敌人后恢复 ' +
          Math.round((pe.eatHealPct || 0) * 100) + '% 最大生命');
      }
      if (pe.tokenManaAt && star >= pe.tokenManaAt) {
        segE.push('🍚 ' + wan(pen[3], '蹭饭') + '：**队友每消耗一层 TOKEN**，' +
          '自己获得 ' + Math.round((pe.tokenManaPct || 0) * 100) + '% 魔力');
      }
      if (!segE.length) segE.push('🐟 ' + name);
      return segE.join('　');
    }
    if (kind === 'shiai') {
      /* ★ ZMJJKK 是**1 星就有被动**的（世一决），所以界面走 passiveLine ——
         这一行要把"已经有的"和"还差什么"都写出来
         （张雪峰 / 牢大 / Dank1ng / 丁真也是 1 星有被动，处理方式一样）。
         ★ `passiveStep` 在这条上只是"这一星级有没有被动"的开关（0/1），
           真数字在 dmgPerDeath / ballStun / kingMul 里，别拿去 ×100。 */
      var ps = d.passive || {};
      var psn = ps.names || {};
      var sks = d.skill || {};
      var segS = ['🏆 ' + (psn[1] || '世一决') + '：**开局满充能**；' +
        '队内每阵亡一个角色，自己获得 +' +
        Math.round((ps.dmgPerDeath || 0) * 100) + '% 增伤'];
      if (ps.ballAt && star >= ps.ballAt) {
        segS.push('⚡ ' + wan(psn[2], '闪电乒乓') + '：开技能的同时扔出闪电球，' +
          '眩晕 ' + ((ps.ballRadius || 1) * 2 + 1) + '×' +
          ((ps.ballRadius || 1) * 2 + 1) + ' 内的敌人 ' + (ps.ballStun || 0) +
          ' 秒（**内置冷却 ' + (ps.ballCd || 20) + ' 秒**）');
      }
      if (ps.kingAt && star >= ps.kingAt) {
        segS.push('👑 ' + wan(psn[3], '你们的王回来了！') + '：技能伤害 ×' +
          (ps.kingMul || 2) + '（激光每发从 ' +
          Math.round((sks.dmgPct || 0.5) * 100) + '% 攻击力变成 ' +
          Math.round((sks.dmgPct || 0.5) * (ps.kingMul || 2) * 100) + '%），' +
          '开大时喊出这句话');
      }
      if (star < 3) {
        segS.push('☆ 还差：' + (star < 2
          ? '2 星「' + wan(psn[2], '闪电乒乓') + '」闪电球群体眩晕、'
          : '') + '3 星「' + wan(psn[3], '你们的王回来了！') + '」伤害 ×' +
          (ps.kingMul || 2));
      }
      return segS.join('　');
    }
    if (kind === 'haowen') {
      /* ★ 刘浩文 1 星就有被动（世界第一帅），所以界面走 passiveLine ——
         这一行要把"已经有的"和"还差什么"都写出来。
         ★ `passiveStep` 在这条上只是"这一星级有没有被动"的开关（0/1），
           真数字在 drPerHpPct / stealPct / boomPct 里，别拿去 ×100
           （drPerHpPct = 1.0 表示"少 1% 血少受 1% 伤"，写成 100% 就成假信息了）。 */
      var ph2 = d.passive || {};
      var phn = ph2.names || {};
      var skh = d.skill || {};
      var segH = ['😎 ' + (phn[1] || '世界第一帅') + '：**不受任何别的受伤减免影响**；' +
        '血量每减少 1%，受到的伤害就 -' + Math.round((ph2.drPerHpPct || 1) * 100) + '%'];
      if (ph2.stealAt && star >= ph2.stealAt) {
        segH.push('🩸 ' + wan(phn[2], '流血流汗') + '：获得 ' +
          Math.round((ph2.stealPct || 0) * 100) + '% 吸血');
      }
      if (ph2.boomAt && star >= ph2.boomAt) {
        var bR = (skh.boomRadius || 1) * 2 + 1;
        segH.push('💥 ' + wan(phn[3], '三星手机') + '：扔出的是三星手机 —— ' +
          '每部命中后爆炸，对 ' + bR + '×' + bR + ' 内所有敌人再造成 ' +
          Math.round((skh.boomPct || 0.25) * 100) + '% 攻击力的伤害');
      }
      if (star < 3) {
        segH.push('☆ 还差：' + (star < 2
          ? '2 星「' + wan(phn[2], '流血流汗') + '」' +
            Math.round((ph2.stealPct || 0) * 100) + '% 吸血、'
          : '') + '3 星「' + wan(phn[3], '三星手机') + '」手机命中后爆炸');
      }
      return segH.join('　');
    }
    return '⚡ ' + name;
  }

  /** 1 星时给的「升星会解锁什么」预告；没有被动就返回 null */
  function passiveTeaser(d) {
    var n2 = ST.passiveName(d, 2), n3 = ST.passiveName(d, 3);
    if (!n3) return null;
    var kind = ST.passiveKind(d);
    var a = Math.round(ST.passiveStep(d, 2) * 100), b = Math.round(ST.passiveStep(d, 3) * 100);
    if (kind === 'frenzy') {
      return '☆ 被动预览：2 星「' + n2 + '」每次攻击 +' + a + '% 攻速，3 星「' + n3 + '」+' + b + '%';
    }
    if (kind === 'hurtHeal') {
      return '☆ 被动预览：2 星「' + n2 + '」受伤回血 ' + a + '%，3 星「' + n3 + '」回血 ' + b + '%';
    }
    if (kind === 'healGift') {
      return '☆ 被动预览：2 星「' + n2 + '」治疗时掷骰子，增伤或减伤 ' + a +
        '%；3 星「' + n3 + '」必定增伤 ' + b + '%';
    }
    if (kind === 'snipeSure') {
      /* 同样是次数，不能 ×100 */
      var c2 = ST.passiveStep(d, 2), c3 = ST.passiveStep(d, 3);
      return '☆ 被动预览：2 星「' + n2 + '」每局第 ' + c2 + ' 次狙击必定命中，3 星「' +
        n3 + '」前 ' + c3 + ' 次必定命中';
    }
    if (kind === 'clawGuard') {
      /* 同样是次数，不能 ×100 */
      return '☆ 被动预览：2 星「' + n2 + '」能挡 ' + ST.passiveStep(d, 2) +
        ' 次，3 星「' + n3 + '」能挡 ' + ST.passiveStep(d, 3) + ' 次';
    }
    if (kind === 'overclock') {
      /* 张雪峰 1 星就有被动，所以预告要说的是**还差什么** */
      var po2 = d.passive || {};
      var pn2 = po2.names || {};
      var pn3b = (pn2[3] instanceof Array) ? pn2[3][pn2[3].length - 1] : '雪毙';
      var zhB2 = po2.ocBerserkName || '狂暴';
      return '☆ 已解锁「' + (pn2[1] || '超频') + '」：开局攻速 +' +
        Math.round((po2.ocAsStart || 0) * 100) + '%、每次普攻 +' +
        Math.round((po2.ocPerHit || 0) * 100) + '%，到 +' +
        Math.round((po2.ocThreshold || 0) * 100) + '% 进「' + zhB2 +
        '」（每秒烧 44% 血、之后每次叠的攻速翻倍）；2 星「' + wan(pn2[2], '巧乐兹') +
        '」普攻叠冰棍、满 ' + (po2.chillMax || 10) + ' 层冰冻，3 星「' + pn3b +
        '」进狂暴后攻击力 +' + Math.round((po2.ocAdPct || 0) * 100) +
        '%、普攻升级成 ' + ((po2.ocAoeRadius || 0) * 2 + 1) + '×' +
        ((po2.ocAoeRadius || 0) * 2 + 1) + ' 范围';
    }
    if (kind === 'lastRites') {
      /* ★ 老牧师 1 星**没有任何被动**，所以这一行要说的是"升星能得到什么"，
         而不是"已经解锁了什么" —— 和豆包的写法对齐（它也是 1 星没被动）。 */
      var pr2 = d.passive || {};
      var prn2 = pr2.names || {};
      return '☆ 被动预览：2 星「' + wan(prn2[2], '还能抢救一下') +
        '」每场战斗一次，第一个阵亡的队友会在 ' + (pr2.reviveDelay || 1) +
        ' 秒祷告后满血站起来；3 星「' + wan(prn2[3], '圣光赐福') +
        '」复活时老牧师和被救的人攻击力都 +' +
        Math.round((pr2.adBuffPct || 0) * 100) + '%';
    }
    if (kind === 'laugh') {
      /* ★ 奶龙 1 星就有被动（笑气护体），所以这里的「预告」说的是**还差什么**，
         而且要把「大笑本身给了什么」一起带上 —— 不然玩家只看到两个解锁项，
         不知道这个被动到底在干什么。 */
      var pk2 = d.passive || {};
      var pn2b = pk2.names || {};
      var sk2 = d.skill || {};
      var l2b = (pn2b[2] instanceof Array) ? pn2b[2][pn2b[2].length - 1] : (pn2b[2] || '边走边笑');
      var l3b = (pn2b[3] instanceof Array) ? pn2b[3][pn2b[3].length - 1] : (pn2b[3] || '笑传四方');
      var r2b = (pk2.healRadius || 0) * 2 + 1;
      return '☆ 已解锁「' + (pn2b[1] || '笑气护体') + '」：大笑 ' + (sk2.dur || 0) +
        ' 秒内受到的伤害 -' + Math.round((sk2.dmgCut || 0) * 100) + '%、每秒回 ' +
        Math.round((sk2.healPct || 0) * 100) + '% 最大生命；2 星「' + l2b +
        '」大笑时还能移动，3 星「' + l3b + '」大笑时治疗 ' + r2b + '×' + r2b + ' 范围的队友';
    }
    if (kind === 'domain') {
      /* ★ 嘉豪 1 星没有被动（技能就是原来的"缠绕"），
         所以这一行是**纯预告**：升到 2 星、3 星各多拿到什么。 */
      var pd2 = d.passive || {};
      var pn2d = pd2.names || {};
      var sk2d = d.skill || {};
      var t2b = (pd2.targets && pd2.targets[2] > 0) ? pd2.targets[2] : 2;
      var t3b = (pd2.targets && pd2.targets[3] > 0) ? pd2.targets[3] : 3;
      var m3b = (pd2.durMul && pd2.durMul[3] > 0) ? pd2.durMul[3] : 1;
      var n2c = (pn2d[2] instanceof Array) ? pn2d[2][pn2d[2].length - 1] : (pn2d[2] || '两个男人');
      var n3c = (pn2d[3] instanceof Array) ? pn2d[3][pn2d[3].length - 1] : (pn2d[3] || '三个男人');
      return '☆ 被动预览：2 星「' + n2c + '」一次同时控制 ' + t2b +
        ' 个人，3 星「' + n3c + '」控 ' + t3b + ' 个人并且眩晕时间 ×' + m3b +
        '（' + sk2d.dur + ' → ' + (Math.round(sk2d.dur * m3b * 100) / 100) + ' 秒）';
    }
    if (kind === 'peak') {
      /* ★ 羊帆 1 星没有被动，所以这里是**纯预告**：
         把"还差什么"和"技能本身在干什么"一起写清楚。
         （不写清技能的话，玩家只看到两个解锁项，不知道这个角色靠什么吃饭。） */
      var pp2 = d.passive || {};
      var ppn2 = pp2.names || {};
      var skp2 = d.skill || {};
      var qNm2 = (ppn2[2] instanceof Array) ? ppn2[2][ppn2[2].length - 1] : (ppn2[2] || '笑上巅峰');
      var qNm3 = (ppn2[3] instanceof Array) ? ppn2[3][ppn2[3].length - 1] : (ppn2[3] || '巅峰谢幕');
      return '☆ 被动预览：技能「' + (skp2.name || '羊巅峰') + '」蓄势后下一次普攻 ×' +
        (skp2.mult || 20) + '；2 星「' + qNm2 + '」那一击震晕 ' + (pp2.stunDur || 3) +
        ' 秒，3 星「' + qNm3 + '」阵亡时自爆，3×3 范围吃攻击力 ×' +
        (pp2.boomAdMult || 20) + ' 的伤害';
    }
    if (kind === 'frost') {
      /* ★ 冰冰冰 1 星没有被动（技能就是原来的寒霜新星），
         所以这里是**纯预告**：技能本身在干什么 + 升星各多拿到什么。
         ★ 不说清"技能现在就打 3×3"的话，玩家看到 3 星的"打全体"
           也不知道是从哪儿变到哪儿的。 */
      var pf3 = d.passive || {};
      var pfn3 = pf3.names || {};
      var skf3 = d.skill || {};
      var rad3 = (skf3.radius || 0) * 2 + 1;
      return '☆ 被动预览：技能「' + (skf3.name || '寒霜新星') + '」在目标格炸开，' +
        rad3 + '×' + rad3 + ' 范围内的敌人吃 ' + (skf3.damage || 0) +
        ' 点法术伤害；2 星「' + wan(pfn3[2], '冻手冻脚') + '」被打中的敌人额外冰冻 ' +
        (pf3.freezeDur || 0) + ' 秒，3 星「' + wan(pfn3[3], '千里冰封') + '」技能改成打全体敌人';
    }
    if (kind === 'delivery') {
      /* ★ 美团袋鼠 1 星没有被动（就是原来那个"治疗血最少的队友"），
         所以这里是**纯预告**：把外卖本身在干什么 + 升星各多拿什么说清楚。 */
      var pdt = d.passive || {};
      var pdnt = pdt.names || {};
      var skdt = d.skill || {};
      var dRadT = ((pdt.radius || 0) * 2 + 1);
      return '☆ 被动预览：技能「' + (skdt.name || '治疗外卖') + '」' +
        (skdt.desc || '治疗血量百分比最低的队友') + '；2 星「' +
        wan(pdnt[2], '准时送达') + '」收到外卖的队友攻速 +' +
        Math.round((pdt.asBuffPct || 0) * 100) + '% 持续 ' + (pdt.asBuffDur || 0) +
        ' 秒，3 星「' + wan(pdnt[3], '好评如潮') + '」普通攻击会治疗被攻击敌人 ' +
        dRadT + '×' + dRadT + ' 内的友方单位';
    }
    if (kind === 'noodle') {
      /* ★ 东北雨姐 1 星没有被动（就是原来那个套盾的骑士），
         所以这里是**纯预告**：技能本身 + 升星各多拿什么。 */
      var pnd2 = d.passive || {};
      var pndn2 = pnd2.names || {};
      var skn2 = d.skill || {};
      var nRad2 = ((pnd2.bindRadius || 0) * 2 + 1);
      return '☆ 被动预览：技能「' + (skn2.name || '圣盾术') + '」' +
        (skn2.desc || '给血量百分比最低的队友套护盾') + '；2 星「' +
        wan(pndn2[2], '红薯粉丝') + '」放技能的同时捆住身边 ' + nRad2 + '×' + nRad2 +
        ' 内的敌人 ' + (pnd2.bindDur || 0) + ' 秒，3 星「' +
        wan(pndn2[3], '雨姐的关照') + '」攻击被捆住的敌人会给血量最低的队友回 ' +
        Math.round((pnd2.hitHealPct || 0) * 100) + '% 最大生命';
    }
    if (kind === 'field') {
      /* ★ 楚生疑犯 1 星没有被动，所以这里是**纯预告**：
         把"技能本身在干什么"和"还差什么"一起说清楚。 */
      var pf2 = d.passive || {};
      var pfn2 = pf2.names || {};
      var skf2 = d.skill || {};
      var gNm2 = (pfn2[2] instanceof Array) ? pfn2[2][pfn2[2].length - 1] : (pfn2[2] || '同伙掩护');
      var gNm3 = (pfn2[3] instanceof Array) ? pfn2[3][pfn2[3].length - 1] : (pfn2[3] || '遁入暗影');
      return '☆ 被动预览：技能「' + (skf2.name || '阴暗领域') + '」在 ' +
        ((skf2.radius || 0) * 2 + 1) + '×' + ((skf2.radius || 0) * 2 + 1) +
        ' 范围内变黑下雨、敌人攻速移速减半；2 星「' + gNm2 + '」让领域里的队友少受 ' +
        Math.round((pf2.allyCut || 0) * 100) + '% 的伤害，3 星「' + gNm3 +
        '」放完技能遁入暗影（免疫一切伤害、不会被索敌），直到队友全部阵亡';
    }
    if (kind === 'loneWolf') {
      /* ★ Dank1ng **1 星就有被动**（空悲切），所以这里的"预告"不能照抄
         "2 星解锁什么"的写法 —— 1 星不是"什么都没有"，
         而是"已经拿到了绝境被动"。这里说清已经有的 + 还差什么。 */
      var pl2 = d.passive || {};
      var pn3 = pl2.names || {};
      var sk2 = d.skill || {};
      var nOld = (pn3[2] instanceof Array) ? pn3[2][pn3[2].length - 1] : (pn3[2] || '老男孩');
      var nLock = (pn3[3] instanceof Array) ? pn3[3][pn3[3].length - 1] : (pn3[3] || '锁头');
      return '☆ 已解锁「' + (pn3[1] || '空悲切') + '」：队友全部阵亡后能量无限；' +
        '2 星「' + nOld + '」开局满能量，3 星「' + nLock + '」能量回复 ×' +
        (pl2.regenMul || 2) + ' 且击杀回满能量';
    }
    if (kind === 'crash') {
      /* ★ 牢大 1 星就有被动（坠机），所以它的「预告」不能照抄别人的写法：
         1 星不是「什么都没有」，而是「只有第一层」。
         这里要说的是**还差什么**。 */
      var pa2 = d.passive || {};
      var pn2 = pa2.names || {};
      var pn3b = (pn2[3] instanceof Array) ? pn2[3][pn2[3].length - 1] : '曼巴精神';
      return '☆ 已解锁「' + (pn2[1] || '坠机') + '」；2 星「' + (pn2[2] || '复活') +
        '」坠毁后复活，3 星「' + pn3b + '」复活后技能所需法力减半';
    }
    if (kind === 'bedrock') {
      /* ★ 钟离 1 星没有被动（就是原来那个"给全队套盾"的 5 费前排），
         所以这里是**纯预告**：技能本身在干什么 + 升星各多拿到什么。
         不写技能的话，玩家看到两行解锁项也不知道这个角色靠什么吃饭。 */
      var pbt = d.passive || {};
      var pbnt = pbt.names || {};
      var skt = d.skill || {};
      var bRad = (pbt.meteorRadius || 1) * 2 + 1;
      return '☆ 被动预览：技能「' + (skt.name || '不动如山') + '」' +
        (skt.desc || '给全队每个队友都套上一层护盾') + '；2 星「' +
        wan(pbnt[2], '玉璋护盾') + '」被它罩住的队友免疫控制并少受 ' +
        Math.round((pbt.wardCut || 0) * 100) + '% 伤害，3 星「' +
        wan(pbnt[3], '天星') + '」每次放技能召来陨石，' + bRad + '×' + bRad +
        ' 内的敌人吃 ' + (pbt.meteorAdMul || 5) + ' 倍攻击力的伤害并被石化 ' +
        (pbt.meteorDur || 3) + ' 秒';
    }
    if (kind === 'flight') {
      /* ★ 祖国人 1 星就有被动，所以这里的"预告"不能照抄
         "2 星解锁什么"的写法 —— 1 星不是"什么都没有"，而是"已经会飞了"。
         这里说清已经有的 + 还差什么。 */
      var pft = d.passive || {};
      var pftn = pft.names || {};
      var skt2 = d.skill || {};
      return '☆ 已解锁「' + (pftn[1] || '飞行') + '」：移速 +' +
        Math.round((pft.flyMovePct || 0) * 100) + '%、能飞越单位；技能「' +
        (skt2.name || '耀眼红光') + '」' + (skt2.desc || '') +
        '2 星「' + wan(pftn[2], '灼烧') + '」激光命中后每秒失去 ' +
        Math.round((pft.burnPct || 0) * 100) + '% 当前生命、持续 ' + (pft.burnDur || 0) +
        ' 秒（免疫冰冻），3 星「' + wan(pftn[3], '三连激光') + '」连射 ' +
        (pft.shots || 3) + ' 发、每发 ' + Math.round((pft.shotMul || 1) * 100) + '%';
    }
    if (kind === 'jett') {
      /* ★ 陈兴裕 1 星就有被动，所以这里的"预告"不能照抄
         "2 星解锁什么"的写法 —— 1 星不是"什么都没有"，而是"已经很暴力了"。 */
      var pjt = d.passive || {};
      var pjtn = pjt.names || {};
      var skj = d.skill || {};
      return '☆ 已解锁「' + wan(pjtn[1], '暴力点') + '」：攻速 +' +
        Math.round((pjt.asPct || 0) * 100) + '%、造成与受到的伤害都 +' +
        Math.round((pjt.dmgOutPct || 0) * 100) + '%；技能「' + (skj.name || '顶赋Jett') +
        '」召唤 ' + (skj.knives || 5) + ' 把飞刀、每把 ' +
        Math.round((skj.knifePct || 0) * 100) + '% 攻击力，' +
        Math.round((skj.hitChance || 0.8) * 100) + '% 概率全部命中；' +
        '2 星「' + wan(pjtn[2], '开局满充能') + '」开局法力满格，3 星「' +
        wan(pjtn[3], '感谢抗渗送的魔法书') + '」友方被远程攻击打死时回满弹药';
    }
    if (kind === 'dingzhen') {
      /* ★ 丁真 1 星没有被动（就是原来那个"咬一口"的远程），
         所以这里是**纯预告**：技能本身在干什么 + 升星各多拿到什么。 */
      var pdz2 = d.passive || {};
      var pdzn2 = pdz2.names || {};
      var skdz2 = d.skill || {};
      return '☆ 被动预览：技能「' + (skdz2.name || '雪豹撕咬') + '」' +
        (skdz2.desc || '让雪豹咬敌人一口') + '；2 星「' +
        wan(pdzn2[2], '芝士雪豹') + '」咬中的人攻速移速 -' +
        Math.round((pdz2.slowCut || 0) * 100) + '% 持续 ' + (pdz2.slowDur || 0) +
        ' 秒，3 星「' + wan(pdzn2[3], '小马珍珠') + '」骑着小马进场（一层 ' +
        Math.round((pdz2.ponyHpPct || 0) * 100) + '% 生命上限的护盾），小马死了就狂暴';
    }
    if (kind === 'amaterasu') {
      /* ★ 鹰佐 1 星没有被动（就是原来那个"自己加速"的双刃舞者），
         所以这里是**纯预告**：技能本身在干什么 + 升星各多拿到什么。 */
      var pam2 = d.passive || {};
      var pamn2 = pam2.names || {};
      var skam2 = d.skill || {};
      return '☆ 被动预览：技能「' + (skam2.name || '疾风连斩') + '」' +
        (skam2.desc || '短时间内大幅提升自身攻速') + '；2 星「' +
        wan(pamn2[2], '霸体') + '」受到控制时立刻解控并免控 ' +
        (pam2.batiImmuneDur || 5) + ' 秒（冷却 ' + (pam2.batiCd || 25) +
        ' 秒），3 星「' + wan(pamn2[3], '天照') + '」放完技能点起黑火：' +
        (pam2.amaterasuAdMul || 2) + ' 倍攻击力伤害 + 无限时间的灼烧' +
        '（每秒 ' + Math.round((pam2.amaterasuPct || 0.05) * 100) + '% 当前生命）';
    }
    if (kind === 'eatrice') {
      /* ★ 大肥鱼 1 星没有被动（技能本身那一套"翻倍 + 吃掉 + TOKEN"已经全在了），
         所以这里是**纯预告**：技能在干什么 + 升星各多拿到什么。 */
      var pe2 = d.passive || {};
      var pen2 = pe2.names || {};
      var ske2 = d.skill || {};
      return '☆ 被动预览：技能「' + (ske2.name || '吃白饭') + '」' +
        (ske2.desc || '下一口伤害翻倍并吃掉残血敌人') + '2 星「' +
        wan(pen2[2], '吃撑了') + '」吃掉敌人后恢复 ' +
        Math.round((pe2.eatHealPct || 0) * 100) + '% 最大生命，3 星「' +
        wan(pen2[3], '蹭饭') + '」队友每消耗一层 TOKEN 自己获得 ' +
        Math.round((pe2.tokenManaPct || 0) * 100) + '% 魔力';
    }
    if (kind === 'shiai') {
      /* ★ ZMJJKK 1 星就有被动，所以这里的"预告"不能照抄
         "2 星解锁什么"的写法 —— 1 星不是"什么都没有"，而是"已经会开局开大了"。 */
      var ps2 = d.passive || {};
      var psn2 = ps2.names || {};
      var sks2 = d.skill || {};
      return '☆ 已解锁「' + (psn2[1] || '世一决') + '」：开局满充能，' +
        '队内每阵亡一个角色自己 +' + Math.round((ps2.dmgPerDeath || 0) * 100) +
        '% 增伤；技能「' + (sks2.name || '霓虹激光') + '」' +
        (sks2.desc || '') + '2 星「' + wan(psn2[2], '闪电乒乓') + '」开技能顺带' +
        '眩晕 ' + ((ps2.ballRadius || 1) * 2 + 1) + '×' +
        ((ps2.ballRadius || 1) * 2 + 1) + ' 的敌人 ' + (ps2.ballStun || 0) +
        ' 秒，3 星「' + wan(psn2[3], '你们的王回来了！') + '」伤害 ×' +
        (ps2.kingMul || 2);
    }
    if (kind === 'haowen') {
      /* ★ 刘浩文 1 星就有被动，所以这里的"预告"是"已经有的 + 还差什么"。 */
      var ph3 = d.passive || {};
      var phn3 = ph3.names || {};
      var skh3 = d.skill || {};
      var hR = (skh3.boomRadius || 1) * 2 + 1;
      return '☆ 已解锁「' + (phn3[1] || '世界第一帅') + '」：不受任何别的受伤减免影响，' +
        '血量每减少 1% 少受 1% 伤害；技能「' + (skh3.name || '手机大王') + '」' +
        (skh3.desc || '') + '2 星「' + wan(phn3[2], '流血流汗') + '」' +
        Math.round((ph3.stealPct || 0) * 100) + '% 吸血，3 星「' +
        wan(phn3[3], '三星手机') + '」每部手机命中后爆炸（' + hR + '×' + hR + ' 内再吃 ' +
        Math.round((skh3.boomPct || 0.25) * 100) + '% 攻击力）';
    }
    return '☆ 被动预览：2 星「' + n2 + '」，3 星「' + n3 + '」';
  }

  function renderSelBar() {
    var host = $('sel-bar');
    if (!host) return;
    host.innerHTML = '';

    // 选中了装备 → 提示去点棋子
    if (G.sel && G.sel.kind === 'item') {
      var it = ST.ITEM_BY_ID[G.bag[G.sel.idx]];
      if (it) {
        host.appendChild(UI.el('span', 'sb-title', it.emoji + ' ' + it.name));
        if (it.skill && it.skill.name) {
          host.appendChild(UI.el('span', 'sb-skill', '【' + it.skill.name + '】'));
        }
        host.appendChild(UI.el('span', 'note', it.desc + '　→ 现在点一个棋子装上它'));
        var cancel = UI.el('button', 'btn btn-ghost btn-sm', '取消');
        cancel.onclick = function () { G.sel = null; renderAll(); };
        host.appendChild(cancel);
        return;
      }
      G.sel = null;
    }

    // 选中了棋子 → 面板 + 出售
    if (G.sel && G.sel.uid) {
      var e = findUnit(G.sel.uid);
      if (!e) { G.sel = null; }
      else {
        var u = e.unit, d = def(u.defId);
        var res = ST.resolveTraits(ownedDefs());
        var s = ST.resolveStats(d, u.star, u.items, res.mods);
        host.appendChild(UI.el('span', 'sb-title', d.emoji + ' ' + d.name + ' ' + u.star + '★'));
        host.appendChild(UI.el('span', 'sb-stat', '生命 ' + s.maxHp));
        host.appendChild(UI.el('span', 'sb-stat', '攻击 ' + s.ad));
        host.appendChild(UI.el('span', 'sb-stat', '攻速 ' + s.as));
        host.appendChild(UI.el('span', 'sb-stat', '护甲 ' + s.armor + ' / 魔抗 ' + s.mr));
        host.appendChild(UI.el('span', 'sb-stat', '射程 ' + s.range));
        if (u.items.length) {
          host.appendChild(UI.el('span', 'sb-stat', '装备 ' + u.items.map(function (x) {
            var itd = ST.ITEM_BY_ID[x];
            return itd ? (itd.emoji + itd.name) : '';
          }).join('　')));
          /* 装备自带的技能名也写出来 —— 玩家要知道身上这块石头会还手 */
          u.items.forEach(function (x) {
            var itd = ST.ITEM_BY_ID[x];
            if (itd && itd.skill && itd.skill.name) {
              host.appendChild(UI.el('span', 'sb-skill',
                '【' + itd.skill.name + '】' + itd.desc));
            }
          });
        }
        var sell = UI.el('button', 'btn btn-ghost btn-sm', '出售 +' + sellRefund(u) + '🪙');
        sell.onclick = function () { sellUnit(u.uid); };
        host.appendChild(sell);
        if (e.loc === 'board') {
          var down = UI.el('button', 'btn btn-ghost btn-sm', '下场');
          down.onclick = function () { boardToBench(e.key); };
          host.appendChild(down);
        }

        /* 星级被动：只有到对应星级才有，1 星不显示生效行。
         * ★ 文案按**被动类型**分派 —— 「越打越快」和「受伤回血」是两回事，
         *   写死一句话会在加第二种被动时变成假信息。
         *   而且必须按**当前星级**取名字和数值：2 星「更加愤怒」(+5%)、
         *   3 星「极度愤怒」(+10%)，玩家要能一眼看出「再升一星会变成什么」。 */
        var paName = ST.passiveName(d, u.star);
        if (paName) {
          host.appendChild(UI.el('span', 'sb-passive', passiveLine(d, u.star)));
        } else {
          var teaser = passiveTeaser(d);
          if (teaser) host.appendChild(UI.el('span', 'sb-teaser', teaser));
        }
        return;
      }
    }

    // 什么都没选 → 显示羁绊面板
    var res2 = ST.resolveTraits(ownedDefs());
    if (!res2.active.length) {
      host.appendChild(UI.el('span', 'note', '点棋盘上的棋子选中它；点空格子，再点备战席的棋子就能上场。'));
      return;
    }
    host.appendChild(UI.el('span', 'sb-label', '羁绊'));
    for (var i = 0; i < res2.active.length; i++) {
      var a = res2.active[i];
      var chip = UI.el('span', 'trait-chip' + (a.tier >= 0 ? (a.tier === 1 ? ' on2' : ' on') : ' off'));
      chip.appendChild(UI.el('span', '', a.trait.emoji + ' ' + a.trait.name));
      chip.appendChild(UI.el('b', '', a.count + '/' + a.need));
      chip.title = a.trait.desc;
      host.appendChild(chip);
    }
  }

  /* ============================================================
   * 十、开战
   * ============================================================ */
  function startFight() {
    if (boardCount() === 0) { deny('至少上场一个棋子'); return; }

    var L = G.enemy;
    var setup = {
      a: ST.Battle.makeComp('a', L.comp),
      b: playerSetup()
    };
    /* ★ 先把「摆上去的人」和「进战斗的人」对齐一次。
     *   battle.js 里有一句 slice(0, ST.MAX_DEPLOY)：超出上限的棋子会被静默丢掉，
     *   界面上看不出来。正常玩不会触发（fieldLimit 有上限），
     *   但只要哪天等级表的上限调到超过 MAX_DEPLOY，玩家就会遇到
     *   「明明摆了 8 个、打起来只有 6 个」。这里直接拦住并说清楚。 */
    if (setup.b.length > ST.MAX_DEPLOY) {
      deny('最多只能上场 ' + ST.MAX_DEPLOY + ' 个棋子');
      return;
    }

    thornAnnounced = false;   // 每场重新允许播报一次讲话石技能名
    lastGiftGood = null;      // 每场重新播报第一次「幻觉 / 开智」
    deliveryAnnounced = false; // 每场重新播报第一次「好评如潮」
    noodleAnnounced = false;   // 每场重新播报第一次「雨姐的关照」
    var seed = (Math.random() * 0xffffffff) >>> 0;
    // 无尽模式的难度旋钮：整队面板复利上浮（把对手那一方乘一个系数）
    var opts = L.statScale ? { statScale: { a: L.statScale } } : undefined;
    G.result = ST.Battle.battle(setup, seed, opts);

    UI.sound.reveal();
    UI.transition(function () {
      $('result-overlay').classList.remove('on');
      UI.show('scene-combat');
      renderCombatHud();
      $('ticker').innerHTML = '';
      $('vs-enemy').textContent = L.emoji + ' ' + L.name;
      $('vs-me').textContent = '我方（' + boardCount() + ' 人）';
      /* ★ 羁绊触发反馈（战斗侧）：开战时把双方激活的羁绊闪一下。
         它是绝对定位的一条，不占画布高度；2.6 秒后自己淡出。 */
      showTraitFlash(G.result);
      $('chud-stage').textContent = L.title;
      $('chud-sub').textContent = inEndless()
        ? ('无尽 · 第 ' + G.endless + ' 波　面板 ×' + (L.statScale || 1).toFixed(2))
        : ('第 ' + G.level + ' / ' + ST.LEVELS.length + ' 关（点错也来得及，右上角可以调设置）');
      Arena.setSpeed(1);
      setSpeedButtons(1);
      Arena.play(G.result, { onEvent: onBattleEvent }, onBattleEnd);
      Arena.onFrame = onArenaFrame;
    }, { label: '揭晓对手阵容…', hold: 400 });
  }

  function renderCombatHud() {
    $('chud-hp').textContent = Math.max(0, G.hp);
    $('chud-gold').textContent = G.gold;
    $('chud-lvl').textContent = G.lvl;
  }

  function onBattleEvent(e) {
    // 音效：打击声、技能声
    if (e.type === 'attack') UI.sound.hit(!!e.crit);
    else if (e.type === 'skill') UI.sound.hit(true);

    // 回放条
    var text = describeEvent(e);
    if (!text) return;
    var host = $('ticker');
    if (!host) return;
    // 豆包的赠礼额外按好坏分色，和画布上徽章的金 / 紫对应
    var cls = 'tick-line t-' + e.type +
      (e.type === 'gift' ? (e.good ? ' t-gift-good' : ' t-gift-bad') : '');
    var line = UI.el('div', cls, text);
    host.appendChild(line);
    while (host.children.length > 60) host.removeChild(host.firstChild);
    host.scrollTop = host.scrollHeight;
  }

  function describeEvent(e) {
    var names = {};
    var us = G.result.initial.units;
    for (var i = 0; i < us.length; i++) names[us[i].uid] = us[i];
    function nm(uid) {
      var u = names[uid];
      return u ? (u.emoji + u.name) : uid;
    }
    switch (e.type) {
      case 'attack':
        /* ★ 羊帆「羊巅峰」的 20 倍一击要单独标出来。
           不标的话战报里就是一行普通普攻 + 一个特别大的数字 ——
           读者会以为伤害算错了，而不是"这一下是蓄过的"。 */
        return nm(e.from) + ' → ' + nm(e.to) + (e.peak ? ' 🐑巅峰一击 ' : ' 普攻 ') +
          Math.round(e.dmg) + (e.peak ? '（×' + e.peakMult + '）' : '') +
          (e.crit ? ' ✦暴击' : '');
      case 'skill':
        if (!e.skill) return nm(e.from) + ' → ' + nm(e.to) + ' ' + Math.round(e.dmg);
        return nm(e.from) + ' 的【' + e.skill + '】命中 ' + nm(e.to) + ' ' + Math.round(e.dmg);
      case 'cast':
        /* 技能自带喊话（牢大的「肘击」→ Man！）时把台词一起写进回放，
           免得画面上喊了一句、回放里却什么都没有。 */
        return nm(e.from) + ' 释放【' + e.skill + '】' + (e.callout ? ('「' + e.callout + '」') : '');
      /* 荣誉的蓄力：眼睛喷金色激光的那半秒。
         这一段在画面上是一条很亮的金色激光，文字只是给回放留一个锚点。 */
      case 'charge':
        return '👁️ ' + nm(e.who) + ' 的双眼射出金色激光…';
      /* 牢大「肘击」的击退。一次把谁推走、推了几格，回放里必须能读出来 ——
         不然玩家只会看到「敌人莫名其妙往回走了」。 */
      case 'knockback':
        return '💥 ' + nm(e.from) + ' 把 ' + nm(e.to) + ' 击退 ' + e.cells + ' 格';
      /* ★ 「抓娃娃」挡伤害。只在**剩得不多了**或者**刚好挡完**的时候写一行：
         一局能挡 20~40 次，每次都写会把回放刷爆。
         玩家真正需要知道的是"还剩几次"和"挡不住了"这两个时刻。 */
      case 'block':
        if (e.left === 0) {
          return '🛡 ' + nm(e.who) + ' 的「抓娃娃」次数用完了 —— 最后一下挡住了，接下来它只有 95 血';
        }
        if (e.left === 5 || e.left === 10) {
          return '🛡 ' + nm(e.who) + ' 的「抓娃娃」还剩 ' + e.left + ' 次';
        }
        return null;
      /* ★ 张雪峰的超频。平时不写（一局能叠几十次，会刷屏），
         只在**越过阈值**和**每掉到一半血**这两个时刻各写一条。 */
      case 'ocas': {
        var zsnap = names[e.who] || {};
        if (e.justOver) {
          /* ★ 这里说的事情有三件，缺一件玩家就理解不了自己在看什么：
               ① 状态换了个名字（狂暴）；② 从现在起每秒掉血；
               ③ 但叠攻速的速度翻倍了 —— 这是"狂暴"唯一的正面收益。
             数值全部从开局快照里取，不写死：削弱那天 44%/4%/100% 都会变。 */
          return '🔥『你快不过我你信吗』' + nm(e.who) + ' 的攻速冲到了 +' +
            Math.round(e.pct * 100) + '% —— 进入「' + (zsnap.ocBerserkName || '狂暴') +
            '」：从现在起每秒烧掉自己 ' +
            Math.round((zsnap.ocBurnPct || 0.44) * 100) + '% 的血，' +
            '但每次普攻叠的攻速也翻倍到 +' +
            Math.round((zsnap.ocPerHitBerserk || 0.04) * 100) + '%' +
            (e.adBonus > 0 ? ('，攻击力 +' + Math.round(e.adBonus * 100) + '%') : '');
        }
        if (e.capped) {
          return '⚡ ' + nm(e.who) + ' 的攻速加成顶到 +' +
            Math.round(e.pct * 100) + '% 上限了';
        }
        return null;
      }
      case 'selfburn':
        /* 只在血量跌破一半的那一下写一条，不然每秒一行也会刷屏 */
        if (e.hpAfter <= e.hpMax * 0.5 && e.hpAfter + e.amount > e.hpMax * 0.5) {
          /* ★ 两种自燃的**原因不一样**，文案要分开：
               超频是"他自己在烧"，果子是"那颗果子的劲儿上来了"。
               写成同一句话，玩家会以为是同一个机制、或者以为是 bug。 */
          return e.reason === 'item'
            ? '🌰 ' + nm(e.who) + ' 的大果劲儿上来了，烧掉了一半血（剩 ' +
              Math.round(e.hpAfter) + '）'
            : '🔥 ' + nm(e.who) + ' 烧掉了一半血（剩 ' + Math.round(e.hpAfter) + '）';
        }
        return null;

      /* ★ 老牧师「临终祷告」。两个事件合成一个故事：
           lastRites  有队友倒下了，牧师开始祷告（**还没救活**）
           reviveAlly 1 秒之后，人站起来了；3 星的话双方一起拿到 +20% 攻击力
         ★ 两件事都要写：只写"复活了"的话，玩家看不到那 1 秒里发生了什么；
           只写"开始祷告"的话，会以为必救 —— 而自己半场站满时是真救不回来的。 */
      case 'lastRites':
        /* ★ 这里**不能用 U.round2** —— game.js 里没有 U 这个别名（只有 util.js 的
           ST.U），写了会在真的有牧师上场的对局里抛 ReferenceError。
           要保留一位小数就自己算。 */
        return '🙏 ' + nm(e.from) + ' 开始给 ' + nm(e.to) + ' 做临终祷告（' +
          (Math.round(e.delay * 10) / 10) + ' 秒）' +
          (e.adPct > 0 ? ('——救回来之后两人的攻击力都会 +' +
            Math.round(e.adPct * 100) + '%') : '');
      case 'reviveAlly': {
        if (!e.ok) {
          /* ★ 失败也要有一条。这是**唯一**一条"牧师用掉了被动、人却没起来"
             的线索，不写出来在日志里就是凭空少了一次复活。 */
          return '⚠️ ' + nm(e.from) + ' 的祷告没能救回 ' + nm(e.who) +
            '（自己半场没有空格了）';
        }
        var full = e.hp >= e.hpMax - 0.01;
        var rvLine = '✨ ' + nm(e.from) + ' 把 ' + nm(e.who) + ' 拉了回来（' +
          (full ? '满血 ' : '') + Math.round(e.hp) + '/' + Math.round(e.hpMax) + '）';
        if (e.adPct > 0) {
          /* ★ 只报**真的加上了 buff 的人**（blessed），不按"应该给两个人"写 ——
             牧师在这一秒里被打死时只有被救的人拿到，写成两个就是假信息。 */
          var both = e.blessed && e.blessed.length >= 2;
          rvLine += '，' + (both ? '两人' : nm(e.blessed && e.blessed[0] ? e.blessed[0] : e.who)) +
            '攻击力 +' + Math.round(e.adPct * 100) + '%' +
            (both ? '' : '（牧师已经阵亡，没拿到）');
        }
        return rvLine;
      }
      /* ★ 冰棍。每条都写太碎，只在**攒满冰冻**那一刻由上面的 stun 写。
         这里只报「层数过半」这一个里程碑，让玩家知道快冻上了。 */
      /* ★ 电棍「导电」：电流弹射的一跳。
         ★ 只写"跳到谁身上"是不够的 —— 玩家要看出这是**连锁**：
           所以带上"还剩几次"和后撤箭头。 */
      case 'current':
        if (e.born) return null;              // 出生不写（一跳一写会刷屏）
        if (e.fizzle) return null;            // 消散也不写（同上）
        return '⚡ ' + nm(e.from) + ' 的电流弹到 ' + nm(e.to) + '（-' +
          Math.round(e.dmg) + '）' +
          (e.stunned ? '　💫 眩晕' : '') +
          (e.left > 0 ? '　还剩 ' + e.left + ' 跳' : '　最后一次');

      case 'chill':
        if (e.max > 0 && e.stacks === Math.ceil(e.max / 2)) {
          return '❄ ' + nm(e.to) + ' 身上的冰棍攒到 ' + e.stacks + ' 层了（攻速移速 -' +
            Math.round(e.asCut * 100) + '%）';
        }
        return null;

      /* ★ 孙笑川 3 星「安排上了」：被打死的敌人倒戈成我方单位。
         ★ 这一条**必须写**：它是全场唯一一个"阵营会变"的事件，
           不写的话回放里就是"X 阵亡了"然后 X 又站起来打自己人 ——
           看起来像 bug。 */
      case 'convert':
        return '🏳 ' + nm(e.from) + ' 把 ' + nm(e.who) + ' 安排上了 —— 它以 ' +
          Math.round(e.hp) + '/' + Math.round(e.hpMax) +
          ' 血倒戈成我方单位（卡面变灰）';
      /* ★★ 东北雨姐 2 星「红薯粉丝」：被捆住的敌人**钉在原地但还能打** ——
       *   这句话必须写出来。只说"捆住 3 秒"，玩家会以为是眩晕，
       *   然后看到对面照样还手就以为出了 bug。
       *   ★ 和 stun 是**两个事件类型**（不是同一个类型换 reason）：
       *     机制不一样（只挡走位 vs 全挡），塞在一起迟早有人按眩晕去验。
       *   ★ 一次施法可能捆到好几个人，所以每个人各写一行（和羊巅峰那条一样）——
       *     它是低频的（一次施法最多一圈），而且"捆住了谁"正是这一下的价值。 */
      case 'root':
        return '🍜【红薯粉丝】' + nm(e.from) + ' 用粉丝捆住了 ' + nm(e.to) +
          ' ' + e.dur + ' 秒（钉在原地，但还能还手）';
      case 'stun':
        if (e.reason === 'freeze') {
          return '🧊【巧乐兹】' + nm(e.to) + ' 被冻住了 ' + e.dur + ' 秒';
        }
        /* ★ 冰冰冰 2 星「冻手冻脚」：技能附带的冰冻。
           ★★ 它**必须**排在下面嘉豪那条之前 —— 那条的兜底文案是
              "拖进了领域"，reason='frost' 没有 `targets` 名单，
              一路走下去会写成「【男人领域】把 X 拖进了领域：眩晕 1.5 秒」，
              一件冰系的事被说成嘉豪的技能。这条坑和上面 current 那条一模一样。 */
        if (e.reason === 'frost') {
          return '🧊【寒霜新星】' + nm(e.to) + ' 被冻住了 ' + e.dur + ' 秒';
        }
        /* ★ 羊帆「羊巅峰」：巅峰一击 / 自爆 附带的眩晕。
           和嘉豪那边不一样，这里**每个受害者都单独写一行** ——
           它天然是低频的（一次施法最多一个人），而且"被那一下震晕了"
           正是这一击的分量所在，省掉就只剩一个伤害数字。 */
        if (e.reason === 'peak') {
          return '😵 ' + nm(e.to) + ' 被' +
            (e.skill === '巅峰谢幕' ? '自爆震飞' : '巅峰一击震晕') + ' ' + e.dur +
            ' 秒 —— 笑得上气不接下气';
        }
        /* ★ 电棍「导电」：弹射带的那 0.5 秒眩晕**已经在电流那一行里写了**
           （"⚡ 电流弹到 X（-N）　💫 眩晕"），这里返回 null，免得同一件事写两遍。
           ★★ 而且它**必须**在下面嘉豪那条之前返回 ——
              否则会一路走到"拖进了领域"的文案，凭空冒出一个"导电领域"。 */
        if (e.reason === 'current') return null;
        /* ★ 嘉豪「男人领域」。★ 实际发出的事件是**一条一个人**
           （每个受害者都要有自己的眩晕和特效），但回放只在名单里第一个人身上
           写一行摘要 —— 否则 3 星一次控三个人会在战报里刷三行一样的话。
           靠 `targets[0]` 判断"这是不是本次施法的第一条"。 */
        if (e.targets && e.to !== e.targets[0]) return null;
        return '🕶️【' + (e.skill || '男人领域') + '】' + nm(e.from) + ' 把 ' +
          ((e.targets || [e.to]).map(nm).join('、')) +
          ' 拖进了领域：眩晕 ' + e.dur + ' 秒';
      /* ★ 楚生疑犯「阴暗领域」：一片留在场上的地形，每次施法都要写 ——
         它是"这一片地方接下来 6 秒会怎样"的**唯一**说明，
         不写的话回放里只看到敌人莫名变慢、队友莫名少掉血。 */
      case 'field':
        return '🌧️【' + (e.skill || '阴暗领域') + '】' + nm(e.from) +
          ' 撑起一片阴暗领域：' + ((e.radius * 2 + 1) + '×' + (e.radius * 2 + 1)) +
          ' 范围内变黑下雨，'+ e.dur + ' 秒内里面的敌人攻速移速减半' +
          (e.allyCut > 0
            ? '，队友少受 ' + Math.round(e.allyCut * 100) + '% 的伤害'
            : '');
      /* ★ 楚生疑犯 3 星「遁入暗影」的开 / 关。
         两个时刻都要写 —— 一个"打不死也找不到"的幽影如果不说清楚，
         回放读起来就是"对面集体发呆 + 我方有个单位不掉血"。 */
      case 'shadow':
        if (e.on) {
          return '🌑【遁入暗影】' + nm(e.who) + ' 消失在了阴影里：' +
            '攻速 -' + Math.round(e.asCut * 100) + '%、伤害 ×' + e.dmgMul +
            '，免疫一切伤害、也不会被索敌（队友还剩 ' + e.mates + ' 个）';
        }
        return '🌒 ' + nm(e.who) + ' 从阴影里现形了 —— 队友都倒下了，该它出来了';
      /* ★★ Dank1ng「先过中门再谈未来」的三条。
         骷髅和耍刀是同一件事的两半（杀了人 → 留在原地 + 自己耍刀 3 秒），
         所以两条都写、而且要连着读得通；「空悲切」是绝境翻盘点名的时刻，
         更要写 —— 不写的话回放里只会看到"它突然一秒一发"。 */
      case 'skull':
        return '💀 ' + nm(e.who) + ' 的「' + (e.skill || '先过中门再谈未来') +
          '」击杀 ' + nm(e.to) + '，在原地留下了一个骷髅';
      case 'knife':
        return '🔪 ' + nm(e.who) + ' 收刀入鞘 —— 接下来 ' + e.dur +
          ' 秒它忙着耍折叠刀，不会再攻击';
      case 'endless':
        if (e.on) {
          return '♾️【空悲切】队友全部阵亡，' + nm(e.who) +
            ' 的能量从此**无限**（法力永远满格）';
        }
        return '♾️ ' + nm(e.who) + ' 的「空悲切」停了 —— 队友又站起来了';
      case 'refill':
        /* ★ 两种"能量瞬间回满"要分开写：
             锁头是**自己杀了人**，魔法书是**队友被远程打死了**（陈兴裕 3 星）。 */
        if (e.reason === 'tome') {
          return '📖【魔法书】队友 ' + nm(e.to) + ' 被远程打死，' +
            nm(e.who) + ' 的弹药瞬间回满';
        }
        return '🎯【锁头】' + nm(e.who) + ' 击杀 ' + nm(e.to) + '，能量瞬间回满';
      /* ★ 陈兴裕「顶赋Jett」：五把飞刀 —— 中没中是这一条技能的全部信息，
         所以两种结果各写一行，而且"全空"那条要把那句台词也带上。 */
      case 'jett':
        if (e.hit) {
          return '🔪【顶赋Jett】' + nm(e.from) + ' 五把飞刀全部命中 ' + nm(e.to);
        }
        return '🔪【顶赋Jett】' + nm(e.from) + ' 五把飞刀全部落空' +
          (e.shout ? ' —— 「' + e.shout + '」' : '');
      /* ★ 「剧毒火龙果」的范围毒：每秒一跳，战报里全写会刷屏，
         所以只在"这一跳里有人被打掉超过 10% 血"时才记一条。 */
      case 'poison':
        return '🐉 ' + nm(e.who) + ' 的火龙果毒雾散开（' +
          ((e.radius || 1) * 2 + 1) + '×' + ((e.radius || 1) * 2 + 1) + ' 内 ' +
          (e.targets ? e.targets.length : 0) + ' 个单位，每个 ' +
          Math.round(e.dmg) + ' 点）';
      /* ★ 刘浩文「手机大王」2026-10 改成**5 秒连扔 40 部**：
         开场记一行（几部、扔多久），之后每一部手机一个事件，
         但**只在每 8 部记一行**（每秒一行）—— 40 行会刷屏。 */
      case 'phoneStart':
        return '📱【手机大王】' + nm(e.from) + ' 开始连扔：' + e.count +
          ' 部手机 / ' + e.dur + ' 秒（每秒 ' + e.perSec + ' 部）' +
          (e.boom ? ' —— **三星手机**，每部命中都会爆炸' : '');
      case 'phoneThrow':
        if (e.left % 8 !== 0) return null;
        return '📱 ' + nm(e.from) + ' 还在扔手机……还剩 ' + e.left + ' 部';
      case 'phoneBoom':
        return '💥 ' + nm(e.from) + ' 的手机炸了 —— ' +
          ((e.radius || 1) * 2 + 1) + '×' + ((e.radius || 1) * 2 + 1) + ' 内 ' +
          (e.targets ? e.targets.length : 0) + ' 人再吃 ' + Math.round(e.dmg) + ' 点';
      /* ★ ZMJJKK 的四条：开大 / 闪电球 / 击杀续命（带台词）/ 队友阵亡增伤。 */
      case 'neon':
        return '🔫【' + (e.shout || '霓虹激光') + '】' + nm(e.who) +
          ' 进入激光状态：攻速 ×' + e.asMul + '、每发 ' +
          Math.round(e.dmgPct * 100) + '% 攻击力、移速 +' +
          Math.round(e.movePct * 100) + '%';
      case 'pingpong':
        return '⚡【闪电乒乓】' + nm(e.from) + ' 的闪电球砸在 ' + e.r + ',' + e.c +
          '，' + (e.targets ? e.targets.length : 0) + ' 个敌人被眩晕 ' + e.dur +
          ' 秒（内置冷却 ' + e.cd + ' 秒）';
      case 'neonKill':
        return '🔫 ' + nm(e.who) + ' 在激光期间击杀 ' + nm(e.to) +
          '（' + e.victimStar + '★）—— 激光时间重置回 4 秒' +
          (e.shout ? '　「' + e.shout + '」' : '');
      case 'shiai':
        return '🏆【世一决】队友 ' + nm(e.to) + ' 阵亡，' + nm(e.who) +
          ' 增伤 +' + Math.round(e.bonus * 100) + '%';
      /* ★ 蓝色大肥鱼「吃白饭 / TOKEN」四连：
           起手翻倍 → 一口吞掉 → 全队发牌 → 谁花掉谁得利（大肥鱼还能回蓝）。 */
      case 'chargeUp':
        return '🍽【吃白饭】' + nm(e.who) + ' 下一口造成的伤害 ×' + e.mul;
      case 'eat':
        return '🐟 ' + nm(e.from) + ' 一口吞掉了 ' + nm(e.to) +
          '（剩 ' + Math.round(e.hpBefore) + ' 血，' +
          Math.round(e.pct * 100) + '% 上限）';
      case 'token':
        return '🍚 全队获得一层 TOKEN —— 下一次造成的伤害 ×' + e.mul;
      case 'tokenUsed':
        return '🍚 ' + nm(e.who) + ' 花掉一层 TOKEN，这一下 ×' + e.mul +
          '（还剩 ' + e.left + ' 层）';
      case 'tokenMana':
        return '🐟【蹭饭】队友花掉 TOKEN，' + nm(e.who) + ' 获得 ' +
          Math.round(e.mana) + ' 点魔力';
      case 'consume':
        /* 吃白饭那一下的兑现：和上面的 tokenUsed 是同一件事的两种来源，
           只写一条就够（不然一次攻击会刷两行）。 */
        if (e.what !== 'eat') return null;
        return '🍽【吃白饭】这一口 ×' + e.mul + ' 打在 ' + nm(e.to) + ' 身上';
      /* ★ 鹰佐的两条：霸体（解控）和天照（黑火落地）。 */
      case 'bati':
        /* `passive: true` 是"免控窗口里又挨了一下控制" —— 那是同一件事的重复，
           战报里不写第二遍，免得一次团战刷出十几行"霸体"。 */
        if (e.passive) return null;
        return '🛡【霸体】' + nm(e.who) + ' 挨了控制立刻解控 —— 免控 ' +
          e.dur + ' 秒（冷却 ' + e.cd + ' 秒）';
      case 'amaterasu':
        return '🖤【天照】' + nm(e.from) + ' 在 ' +
          ((e.radius || 1) * 2 + 1) + '×' + ((e.radius || 1) * 2 + 1) +
          ' 点起黑火，' + (e.targets ? e.targets.length : 0) + ' 人吃 ' +
          Math.round(e.dmg) + ' 点伤害并被天照缠上';
      /* ★ 丁真「雪豹撕咬」：那一口本身是技能伤害（skill 事件里已经有名字），
         这里补的是"附带的减速"和"小马"这两件只属于他的事。 */
      case 'bite':
        return '🐆 ' + nm(e.from) + ' 的雪豹咬住了 ' + nm(e.to) +
          ' —— 攻速移速 -' + Math.round(e.cut * 100) + '%，持续 ' + e.dur + ' 秒';
      case 'pony':
        return '🐴 ' + nm(e.who) + ' 骑着小马进场（护盾 ' + Math.round(e.shield) + '）';
      case 'ponyDead':
        /* ★ 这里不能用 U.round2 —— game.js 里没有 U 这个别名
           （只有 util.js 的 ST.U），上一行那个教训就在 1935 行附近。 */
        return '💔 ' + nm(e.who) + (e.shout ? ' 大喊「' + e.shout + '」' : '') +
          '，小马倒下了 —— 他狂暴了（魔力获取 ×' +
          (Math.round(e.manaMul * 100) / 100) + '）';
      /* ★ 祖国人 2 星「灼烧」：起火写一条，之后每秒那一跳太密，只写第一条
         （和大果的自燃同一条约定：跌破半血那一下才值得写进战报）。 */
      case 'ignite':
        return '🔥 ' + nm(e.to) + ' 被激光点着了 —— 每秒失去 ' +
          Math.round(e.pct * 100) + '% 当前生命，持续 ' + e.dur + ' 秒';
      case 'immune':
        if (e.what === 'freeze') {
          return '🔥 ' + nm(e.who) + ' 正在燃烧，冰冻对它无效';
        }
        return null;
      /* ★ 钟离「天星」：一颗陨石砸下来 —— 这一发是 5 费的大场面，
         必须单独写一行（范围、伤害、石化时长都在里面）。 */
      case 'meteor':
        return '🪨【天星】' + nm(e.from) + ' 召来陨石砸在 ' + e.r + ',' + e.c +
          '，' + ((e.radius || 1) * 2 + 1) + '×' + ((e.radius || 1) * 2 + 1) +
          ' 内 ' + (e.targets ? e.targets.length : 0) + ' 人吃 ' + Math.round(e.dmg) +
          ' 伤害，活下来的石化 ' + e.dur + ' 秒';
      /* ★ 钟离 2 星「玉璋护盾」：挂上守护 / 挡下一次控制。
         `grant` 每次都写太吵（一次技能就是全队四行），所以只在**挡下**时写。 */
      case 'ward':
        if (e.what === 'grant') return null;
        {
          var wardWhat = { stun: '眩晕', freeze: '冰冻', petrify: '石化',
                           root: '捆住', knockback: '击退' }[e.what] || '控制';
          return '💠【玉璋护盾】' + nm(e.who) + ' 免疫了' + wardWhat;
        }
      /* ★ 牢大的坠机三段。它们天然是低频事件（一局最多各一次），
         全部写进回放，而且写得足够"响"——这是这套被动唯一的表达机会。
         ★ 羊帆 3 星的「巅峰谢幕」共用同一条事件，靠 `boom` 分出两种写法：
           一边是天上有直升机掉下来，一边是它自己原地炸了。 */
      case 'down':
        if (e.boom) {
          return '💀 ' + nm(e.who) + ' 倒下了…（身上有什么东西正在亮起来）';
        }
        return '💀 ' + nm(e.who) + ' 倒下了…（1 秒后有什么东西正在落下来）';
      case 'crash':
        if (e.boom) {
          return '💥【巅峰谢幕】' + nm(e.who) + ' 自爆！3×3 范围受到 ' +
            Math.round(e.dmg) + ' 点物理伤害' +
            (e.stun > 0 ? '，活下来的还会被震晕 ' + e.stun + ' 秒' : '');
        }
        return '🚁 直升机坠毁！' + nm(e.who) + ' 的残骸砸中 3×3 范围，造成 ' +
          Math.round(e.dmg) + ' 点物理伤害';
      case 'revive':
        return '✨【' + (e.cdCut ? '孩子们我回来了 + 曼巴精神' : '孩子们我回来了') + '】' +
          nm(e.who) + ' 回来了（' + Math.round(e.hp) + ' 血）' +
          (e.cdCut ? '，技能冷却减半' : '');
      case 'snipe':
        /* 荣誉的「狙击1」。这一条**每次都要写** —— 它不是一个会被刷屏的
           高频事件（攻速砍半 + 法力 60，一局也就放得出 1~2 次），
           而且「中了还是没中」正是这个角色的全部看点，省掉就没信息了。
           保底命中（运 / edg希望）单独标出来，让玩家知道这次不是运气。 */
        if (e.hit) {
          return '🎯【' + e.skill + '】' + nm(e.from) + ' 命中 ' + nm(e.to) +
            '！Vamos' + (e.sure ? '（必定命中）' : '');
        }
        return '🎯【' + e.skill + '】' + nm(e.from) + ' 打偏了… Kale';
      case 'heal':
        /* ★ 大笑期间的持续回血（自己 + 3×3 队友）不进回放。
           一次大笑能刷出 3 条自己的 + 最多 24 条队友的，
           而且"回了多少"根本没法和伤害流对上 ——
           这些数字全部由上面那条 laugh 一行讲完。 */
        if (e.reason === 'laugh' || e.reason === 'laughAura') return null;
        /* ★ 美团袋鼠 3 星「好评如潮」：外卖那一口只在**第一次**写一行，
           之后都靠画布上的绿字和橙环（一局上百单，全写会把回放刷爆）。
           ★ 但它必须排在下面那条通用分支**之前** —— 不然每单都会写成
             "美团袋鼠 → 某某 +42"，一局几百行。 */
        if (e.reason === 'delivery') {
          if (deliveryAnnounced) return null;
          deliveryAnnounced = true;
          return '🍱【好评如潮】' + nm(e.from) +
            ' 开始给前线送外卖：每一下普攻都治疗被攻击敌人周围的队友';
        }
        /* ★ 东北雨姐 3 星「雨姐的关照」：同样一局能触发几十上百次
           （她 0.62 攻速，只要对面被捆着就每一下都触发），所以也只在**第一次**写一行。 */
        if (e.reason === 'noodle') {
          if (noodleAnnounced) return null;
          noodleAnnounced = true;
          return '🍠【雨姐的关照】' + nm(e.from) +
            ' 开始照顾队友：每一下打在**被捆住**的敌人身上，就给最低血的队友回一大口';
        }
        return (e.from === null ? '持续回血' : nm(e.from)) + ' → ' + nm(e.to) + ' +' + Math.round(e.amount);
      /* ★★ 攻速增益：双刃舞者的「疾风连斩」（自己开）和
       *   美团袋鼠 2 星「准时送达」（别人送来）。
       *   频率很低（一次施法才一条），所以**每次都写**。
       *   ★ 这个 case 以前根本不存在 —— 「疾风连斩」在战报里从来没出现过。 */
      case 'buff':
        return (e.reason === 'delivery' && e.from && e.from !== e.who)
          ? ('🛵【准时送达】' + nm(e.from) + ' 的外卖送到了 ' + nm(e.who) +
             '：攻速 +' + Math.round(e.amount * 100) + '%（' + e.dur + ' 秒）')
          : ('💨 ' + nm(e.who) + ' 攻速 +' + Math.round(e.amount * 100) +
             '%（' + e.dur + ' 秒）');
      /* ★ 奶龙的「捧腹大笑」。每次都要写 ——
         冷却 13 秒，一局也就放得出两三次，这几次是这张卡的全部存在感。
         减伤、回血、星级门槛全部塞进同一行，回放里读一句就够。 */
      case 'laugh':
        return '😂【捧腹大笑】' + nm(e.who) + ' 笑得停不下来 ' + e.dur + ' 秒：' +
          '受到的伤害 -' + Math.round(e.cut * 100) + '%、每秒回 ' +
          Math.round(e.healPct * 100) + '% 最大生命' +
          (e.allyHeal ? '，还把身边 3×3 的队友一起逗笑' : '') +
          (e.move ? '（边走边笑）' : '（这 ' + e.dur + ' 秒里它动不了，也打不了）');
      case 'death':
        return '☠ ' + nm(e.who) + ' 阵亡';
      case 'damage':
        /* 讲话石「飞入寻常百姓家」：一局只播报一次技能名。
           后面每一次反弹都有水带特效（画布上看得见），不需要文字再喊一遍。 */
        if (e.reason === 'thorn' && !thornAnnounced) {
          thornAnnounced = true;
          return '🌊【飞入寻常百姓家】' + nm(e.from) + ' 的讲话石开始还手';
        }
        return null;
      case 'frenzy':
        /* 星级被动只在**封顶**这个里程碑写一行回放。
         * 每叠一层都写（每次普攻一条）会把战斗回放刷屏，
         * 而「攻速叠满了」是玩家真正想知道的信息。 */
        return e.capped
          ? ('⚡ ' + nm(e.who) + ' 越打越快，攻速叠满 +' + Math.round(e.pct * 100) + '%')
          : null;
      case 'gift': {
        /* 豆包「幻觉 / 开智」。播报规则见 lastGiftGood 的注释：
           第一次一定写（让玩家知道这个被动存在），之后只在结果翻转时写。 */
        if (lastGiftGood === e.good) return null;
        lastGiftGood = e.good;
        var mag = Math.round(Math.abs(e.mul - 1) * 100);
        if (e.good) {
          return '💡【' + e.skill + '】' + nm(e.to) + ' 获得增伤 ' + mag + '%';
        }
        return '🌀【' + e.skill + '】' + nm(e.from) + ' 的幻觉误导了 ' +
          nm(e.to) + '，伤害降低 ' + mag + '%';
      }
      default:
        return null;
    }
  }

  var lastFramePaint = 0;
  function onArenaFrame(pb) {
    var now = Date.now();
    if (now - lastFramePaint < 90) return;
    lastFramePaint = now;
    var fill = $('play-fill');
    var time = $('play-time');
    if (fill) fill.style.width = (pb.total > 0 ? (pb.t / pb.total * 100) : 0) + '%';
    if (time) time.textContent = pb.t.toFixed(1) + 's / ' + pb.total.toFixed(1) + 's';
  }

  /* ============================================================
   * 十一、结算
   * ============================================================ */
  function onBattleEnd() {
    Arena.onFrame = null;
    var r = G.result;
    var win = r.winner === 'b';
    var draw = r.winner === 'draw';
    var overlay = $('result-overlay');
    var box = $('result-box');
    var badge = $('result-badge');
    var title = $('result-title');
    var sub = $('result-sub');
    var body = $('result-body');
    var acts = $('result-acts');

    box.className = 'result-box ' + (win ? 'win' : (draw ? 'draw' : 'lose'));
    badge.textContent = win ? '✓' : (draw ? '＝' : '✕');
    body.innerHTML = '';
    acts.innerHTML = '';
    sub.textContent = '用时 ' + r.time + 's　存活 我方 ' + r.survivors.b + ' / 对手 ' + r.survivors.a +
      '　剩余血量 我方 ' + Math.round(r.remainPct.b * 100) + '% / 对手 ' + Math.round(r.remainPct.a * 100) + '%';

    var L = G.enemy;

    if (win) {
      G.streak = G.streak > 0 ? G.streak + 1 : 1;
      var gold = L.clearGold;
      G.gold += gold;
      var lines = ['通关奖励 <b>+' + gold + ' 🪙</b>'];
      if (L.drop && ST.ITEM_BY_ID[L.drop]) {
        G.bag.push(L.drop);
        var it = ST.ITEM_BY_ID[L.drop];
        lines.push('掉落装备 <b>' + it.emoji + ' ' + it.name + '</b>' +
          (it.skill && it.skill.name ? '【' + it.skill.name + '】' : '') + '（' + it.desc + '）');
        pushLog('通关掉落 ' + it.emoji + it.name, 'gold');
      }
      lines.push('连胜 <b>' + G.streak + '</b>');

      if (inEndless()) {
        /* 无尽模式：没有终点，只有下一波。
         * 这里刻意不显示「全部通关」—— 无尽的意义就是它不会结束。 */
        pushLog('无尽第 ' + G.endless + ' 波通过（' + L.name + '） +' + gold + '🪙', 'good');
        title.textContent = '第 ' + G.endless + ' 波 通过';
        badge.textContent = '♾️';
        box.className = 'result-box win';
        body.appendChild(noteHtml(lines.join('<br>')));
        body.appendChild(noteHtml('下一波对手面板 <b>×' +
          Math.min(ST.ENDLESS.SCALE_CAP,
            Math.pow(1 + ST.ENDLESS.SCALE_PER_WAVE, G.endless)).toFixed(2) +
          '</b>，阵容重新随机 —— 没有背板可言了。'));
        addAct(acts, '下一波 ›', 'primary', nextWave);
        addAct(acts, '回到封面', '', backToCover);
        UI.sound.win();
      } else if (G.level >= ST.LEVELS.length) {
        pushLog('第 ' + G.level + ' 关通过（' + L.name + '） +' + gold + '🪙', 'good');
        title.textContent = '全部 24 关通关！';
        badge.textContent = '🏆';
        box.className = 'result-box win final';
        body.appendChild(noteHtml(lines.join('<br>')));
        body.appendChild(noteHtml('你打穿了全部 ' + ST.LEVELS.length + ' 关，最终血量 ' +
          G.hp + ' / ' + R.MAX_HP + '。'));
        body.appendChild(noteHtml('<b>还有无尽模式。</b>随机出怪、每一波敌人面板再涨 7%，' +
          '看你能撑到第几波。'));
        addAct(acts, '♾️ 进入无尽模式', 'primary', enterEndless);
        addAct(acts, '再来一局', '', function () {
          var p = Cover.loadProgress();
          Cover.saveProgress({ victories: (p.victories || 0) + 1, lastRunLevel: ST.LEVELS.length });
          Game.start();
        });
        addAct(acts, '回到封面', '', backToCover);
        UI.sound.win();
      } else {
        pushLog('第 ' + G.level + ' 关通过（' + L.name + '） +' + gold + '🪙', 'good');
        title.textContent = '本关通过';
        body.appendChild(noteHtml(lines.join('<br>')));
        addAct(acts, '进入下一关 ›', 'primary', nextLevel);
        addAct(acts, '回到封面', '', backToCover);
        UI.sound.win();
      }
    } else {
      var dmg = 0;
      if (!draw) {
        var pd = ST.Battle.playerDamage(r);
        dmg = pd.damage;
        G.hp -= dmg;
        G.streak = G.streak < 0 ? G.streak - 1 : -1;
      } else {
        G.streak = 0;
      }
      pushLog((inEndless() ? '无尽第 ' + G.endless + ' 波失败' : '第 ' + G.level + ' 关失败') +
        '（' + L.name + '）' + (dmg ? ' −' + dmg + '❤️' : ' 平局，不掉血'), 'bad');

      if (G.hp <= 0) {
        G.hp = 0;
        title.textContent = inEndless() ? '无尽之旅结束' : '挑战结束';
        badge.textContent = '💀';
        box.className = 'result-box lose final';
        body.appendChild(noteHtml(inEndless()
          ? ('你在无尽模式第 <b>' + G.endless + '</b> 波耗尽了生命 —— 那里敌人面板已经 <b>×' +
             (L.statScale || 1).toFixed(2) + '</b>。<br>最远撑到第 ' + G.endless + ' 波。')
          : ('你在第 <b>' + G.level + ' 关</b>（' + L.name + '）耗尽了生命。<br>' +
             '最远打到第 ' + G.level + ' 关。')));
        addAct(acts, '重新开始', 'primary', function () {
          Cover.saveProgress({ lastRunLevel: G.level });
          Game.start();
        });
        addAct(acts, '回到封面', '', backToCover);
        UI.sound.lose();
        Cover.saveProgress({ lastRunLevel: G.level });
      } else {
        title.textContent = draw ? '平局' : (inEndless() ? '本波失败' : '本关失败');
        body.appendChild(noteHtml((draw ? '双方都没能全灭对手，按剩余血量判平。<br>' : '') +
          (dmg ? '损失生命 <b>−' + dmg + ' ❤️</b>（剩余 ' + G.hp + '）<br>' : '') +
          (inEndless()
            ? '无尽模式里同一波可以反复重试，对手每次都是同一份 —— 先补强再来。'
            : '本关可以重来，回合收入照发 —— 先补强阵容再来。')));
        addAct(acts, inEndless() ? '重试本波' : '重新挑战', 'primary', retryLevel);
        addAct(acts, '回到封面', '', backToCover);
        UI.sound.lose();
      }
    }
    /* ★ 战后伤害占比：赢也看得，输更看得 —— 输的时候最想知道
       "到底是谁没打出伤害"。所以放在 if/else 外面，两边都有。 */
    body.appendChild(damagePanel(r));
    renderCombatHud();
    overlay.classList.add('on');
  }

  /* ============================================================
   * 拖拽放卡
   *
   * 原来只有「点一下棋子 → 再点一下格子」这一种摆法，两次点击之间
   * 手是断开的：点歪了要重来，摆一整排要来回点十几下。
   *
   * ★ 用 Pointer Events 而不是 HTML5 的 dragstart/dragover：
   *   后者在触屏上不工作，而且要写一堆 preventDefault 才肯离开原元素。
   *   Pointer Events 一套代码同时覆盖鼠标 / 触屏 / 触控笔。
   *
   * ★ 点击和拖拽必须能共存 —— 两者都绑在同一个元素上，
   *   靠「按下到松开之间有没有移动超过阈值」区分：
   *     · 没超过阈值 → 当成点击，交给原来的 onclick（选中 / 换位）
   *     · 超过阈值   → 进入拖拽，松手时按落点执行「放下去」
   *   松手之后 click 事件还会照样触发一次，所以要用 dragJustEnded
   *   把紧接着的那一下点击吞掉，否则拖完会顺手再选中一次。
   *
   * ★ 落点用 document.elementFromPoint 来判定，而不是监听各容器的
   *   pointerup：拖拽过程中指针可能在任何地方松手（包括窗口外），
   *   逐个容器绑事件一定会漏。幽灵卡片要设 pointer-events:none，
   *   否则 elementFromPoint 永远只会拿到幽灵自己。
   * ============================================================ */
  var DRAG_THRESHOLD = 6;      // 超过这么多像素才算拖拽，不是点击
  var dragState = null;
  /* 拖拽结束后浏览器还会补一个 click，那一下必须吞掉（否则拖完会顺手再选中一次）。
     ★ 用「一次性开关 + 定时兜底」而不是单纯的时间戳：
       时间戳窗口开大了会误吞用户紧接着的**真实**点击 ——
       实测 300ms 的窗口会把 120ms 后的一次正常点击吃掉。
       开关在第一次 click 时立刻清掉，所以只会吞掉紧随的那一下。 */
  var dragSwallowClick = false;
  var dragSwallowTimer = null;

  /** 指针下面是哪个可放置的位置（棋盘格 / 备战席格） */
  function dropTargetAt(x, y) {
    var el = document.elementFromPoint(x, y);
    if (!el || !el.closest) return null;
    var cell = el.closest('.cell');
    if (cell && cell.closest('#player-half')) {
      return { kind: 'board', el: cell,
               r: parseInt(cell.dataset.r, 10), c: parseInt(cell.dataset.c, 10) };
    }
    var slot = el.closest('.bench-cell');
    if (slot && slot.closest('#bench')) {
      return { kind: 'bench', el: slot, i: parseInt(slot.dataset.i, 10) };
    }
    return null;
  }

  function dragGhostFor(entry) {
    var d = def(entry.unit.defId);
    var g = UI.el('div', 'drag-ghost');
    g.appendChild(UI.el('span', 'dg-emoji', d.emoji));
    g.appendChild(UI.el('span', 'dg-name', d.name));
    return g;
  }

  function setDropHighlight(t) {
    var cells = document.querySelectorAll('.drop-ok');
    for (var i = 0; i < cells.length; i++) cells[i].classList.remove('drop-ok');
    if (t && t.el) t.el.classList.add('drop-ok');
  }

  function clearDrag() {
    if (!dragState) return;
    if (dragState.ghost && dragState.ghost.parentNode) {
      dragState.ghost.parentNode.removeChild(dragState.ghost);
    }
    setDropHighlight(null);
    if (dragState.srcEl) dragState.srcEl.classList.remove('dragging');
    dragState = null;
  }

  function onDragDown(ev) {
    if (ev.button !== undefined && ev.button !== 0) return;   // 只认左键
    var chip = ev.target.closest && ev.target.closest('.u');
    if (!chip || !chip.dataset.uid) return;
    var entry = findUnit(chip.dataset.uid);
    if (!entry) return;
    dragState = {
      uid: chip.dataset.uid, entry: entry,
      x0: ev.clientX, y0: ev.clientY,
      active: false, ghost: null, target: null, srcEl: chip
    };
  }

  /* ★ 兜底：拦掉棋子上的一切**原生拖拽**。
     只靠 img.draggable=false 在大多数浏览器够了，但 DRM/扩展/老版本
     都可能绕过去；而一旦原生拖拽启动，浏览器会发 pointercancel，
     整个指针序列就断了（这正是「有立绘的棋子拖不动」的根因）。
     这里在 document 捕获阶段直接掐掉，成本几乎为零。 */
  function onDragStartGuard(ev) {
    var t = ev.target;
    if (t && t.closest && t.closest('.u')) ev.preventDefault();
  }

  function onDragMove(ev) {
    if (!dragState) return;
    var dx = ev.clientX - dragState.x0, dy = ev.clientY - dragState.y0;
    if (!dragState.active) {
      if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
      dragState.active = true;
      dragState.ghost = dragGhostFor(dragState.entry);
      document.body.appendChild(dragState.ghost);
      dragState.srcEl.classList.add('dragging');
      UI.sound.click();
    }
    dragState.ghost.style.left = ev.clientX + 'px';
    dragState.ghost.style.top = ev.clientY + 'px';
    var t = dropTargetAt(ev.clientX, ev.clientY);
    dragState.target = t;
    setDropHighlight(t);
    ev.preventDefault();
  }

  function onDragUp(ev) {
    if (!dragState) return;
    var st = dragState;
    var wasActive = st.active;
    var t = wasActive ? (st.target || dropTargetAt(ev.clientX, ev.clientY)) : null;
    clearDrag();
    if (!wasActive) return;                 // 没移动 → 交给 onclick 走原来的点击逻辑
    dragSwallowClick = true;
    if (dragSwallowTimer) clearTimeout(dragSwallowTimer);
    // 兜底：万一浏览器没补那一发 click（比如指针在窗口外松手），
    // 开关也不能一直挂着，否则会吞掉用户的下一手
    dragSwallowTimer = setTimeout(function () { dragSwallowClick = false; }, 150);
    if (!t) return;                         // 丢在空地 → 什么都不做

    var e = findUnit(st.uid);
    if (!e) return;
    if (t.kind === 'board') {
      if (e.loc === 'board') {
        if (e.key === key(t.r, t.c)) return;
        boardToBoard(e.key, t.r + ',' + t.c);
      } else {
        // 备战席 → 上场。名额满了要给一句明确的话，不能默默不动
        if (!G.board[key(t.r, t.c)] && boardCount() >= G.field) {
          deny('最多只能上场 ' + G.field + ' 个棋子');
          return;
        }
        benchToBoard(e.index, t.r, t.c);
      }
    } else {
      if (e.loc === 'board') {
        var occupant = G.bench[t.i];
        if (occupant) {
          G.board[e.key] = occupant;
          G.bench[t.i] = e.unit;
          UI.sound.place();
          renderAll();
        } else {
          /* ★ 拖到备战席的空位时，要**放进用户指的那一格**，
             而不是像 boardToBench 那样塞进第一个空位 ——
             能指定位置正是拖拽相对"点两下"的全部价值。 */
          G.bench[t.i] = e.unit;
          delete G.board[e.key];
          UI.sound.place();
          renderAll();
        }
      } else if (e.index !== t.i) {
        var other = G.bench[t.i];
        G.bench[e.index] = other || null;
        G.bench[t.i] = e.unit;
        UI.sound.place();
        renderAll();
      }
    }
  }

  /** 拖拽刚结束的话，把紧随其后的那一次 click 吞掉（只吞一次） */
  function swallowClickAfterDrag() {
    if (!dragSwallowClick) return false;
    dragSwallowClick = false;
    return true;
  }

  function noteHtml(html) {
    var d = UI.el('div', 'result-note');
    d.innerHTML = html;
    return d;
  }

  /* ============================================================
   * 战后伤害占比
   *
   * ★ 为什么值得单独做一块：结算浮层原来只有「赢/输 + 掉了多少血」，
   *   玩家没法回答"我这局到底是谁在打伤害"。而阵容决策恰恰靠这个 ——
   *   是主 C 打满了，还是他其实在划水、伤害全是别人打的？
   *   把占比排出来，一眼就能看出"下一件装备该给谁"。
   *
   * ★ 只用**我方**的数据：对面怎么分配伤害对玩家的下一步决策没有帮助。
   * ★ 条长按「本队最高」归一化（不是按队伍总和）——
   *   这样即使全队总伤害很低，第一名也是满条，一眼看出谁最强。
   *   旁边同时给**百分比**和绝对值：只有百分比的话，
   *   一场 2000 伤害和一场 20000 伤害看起来一模一样。
   * ============================================================ */
  function damagePanel(r) {
    var units = r.initial.units.filter(function (u) { return u.side === 'b'; });
    var rows = [], total = 0, best = 0;
    units.forEach(function (u) {
      var st = r.unitStats[u.uid];
      if (!st) return;
      var d = st.dmgDealt || 0;
      total += d;
      if (d > best) best = d;
      rows.push({ u: u, st: st, dmg: d });
    });
    rows.sort(function (a, b) { return b.dmg - a.dmg; });

    var wrap = UI.el('div', 'dmg-panel');
    wrap.appendChild(UI.el('div', 'dmg-title', '伤害占比　总计 ' + Math.round(total)));

    rows.forEach(function (row) {
      var line = UI.el('div', 'dmg-row' + (row.dmg <= 0 ? ' zero' : ''));
      line.appendChild(UI.el('span', 'dmg-who', row.u.emoji + ' ' + row.u.name +
        (row.u.star > 1 ? ' ' + row.u.star + '★' : '')));
      var barWrap = UI.el('span', 'dmg-bar');
      var bar = UI.el('span', 'dmg-fill');
      bar.style.width = (best > 0 ? Math.max(row.dmg > 0 ? 3 : 0,
        Math.round(row.dmg / best * 100)) : 0) + '%';
      barWrap.appendChild(bar);
      line.appendChild(barWrap);
      var pct = total > 0 ? Math.round(row.dmg / total * 100) : 0;
      line.appendChild(UI.el('span', 'dmg-num', pct + '%　' + Math.round(row.dmg)));
      wrap.appendChild(line);
    });

    if (!rows.length || total <= 0) {
      wrap.appendChild(UI.el('div', 'dmg-empty', '这一局没有造成任何伤害。'));
    }
    return wrap;
  }

  function addAct(host, label, kind, fn) {
    var b = UI.el('button', 'btn' + (kind ? ' btn-' + kind : ''), label);
    b.onclick = function () { UI.sound.click(); fn(); };
    host.appendChild(b);  }

  function nextLevel() {
    if (inEndless()) { nextWave(); return; }
    G.level++;
    var p = Cover.loadProgress();
    Cover.saveProgress({ bestLevel: Math.max(p.bestLevel || 0, G.level) });
    UI.transition(function () {
      $('result-overlay').classList.remove('on');
      beginRound();
      UI.show('scene-game');
    }, { label: ST.LEVELS[G.level - 1].title, hold: 420 });
  }

  /** 无尽模式下一波：波次 +1，关卡序号也跟着 +1（存档里的「最远」靠它） */
  function nextWave() {
    G.endless++;
    G.level++;
    var p = Cover.loadProgress();
    Cover.saveProgress({ bestLevel: Math.max(p.bestLevel || 0, G.level) });
    var scale = Math.min(ST.ENDLESS.SCALE_CAP,
      Math.pow(1 + ST.ENDLESS.SCALE_PER_WAVE, G.endless - 1));
    UI.transition(function () {
      $('result-overlay').classList.remove('on');
      beginRound();
      UI.show('scene-game');
    }, { label: '无尽 · 第 ' + G.endless + ' 波（面板 ×' + scale.toFixed(2) + '）', hold: 420 });
  }

  function retryLevel() {
    UI.transition(function () {
      $('result-overlay').classList.remove('on');
      beginRound();
      UI.show('scene-game');
    }, { label: (inEndless() ? '重试第 ' + G.endless + ' 波 ' : '重新挑战 ') + G.enemy.name, hold: 380 });
  }

  function backToCover() {
    Arena.pause();
    UI.transition(function () {
      $('result-overlay').classList.remove('on');
      if (G && G.hp > 0) Cover.saveProgress({ lastRunLevel: G.level });
      Cover.show();
    }, { label: '', hold: 200 });
  }

  /* ============================================================
   * 十二、回合开始
   * ============================================================ */
  function beginRound() {
    G.round++;
    var inc = grantIncome();
    // 无尽模式的对手是每一波现生成的（同一个波次永远生成同一份，见 ST.endlessWave）
    G.enemy = inEndless() ? ST.endlessWave(G.endless) : ST.LEVELS[G.level - 1];
    // 锁定了就保留上一回合没买走的牌（云顶的商店锁定）
    if (!G.locked) rollShop();
    G.sel = null;
    pushLog('—— 第 ' + G.round + ' 回合 · ' + G.enemy.title + ' ——', 'sys');
    pushLog('回合收入 +' + inc.total + '🪙（基础 ' + inc.base + '，利息 ' + inc.interest + '，连胜 ' + inc.streak + '）', 'gold');
    if (G.locked) pushLog('商店已锁定，保留上一回合的牌', 'sys');
    if (inEndless() && G.enemy.statScale) {
      pushLog('本波对手面板 ×' + G.enemy.statScale.toFixed(2) + '（' + G.enemy.arch + '）', 'bad');
    }
    $('action-hint').textContent = '准备阶段：买棋子、摆站位。对手的阵容要开战才会揭晓。';
    renderAll();
  }

  /* ============================================================
   * 十三、事件绑定
   * ============================================================ */
  var bound = false;

  function bind() {
    if (bound) return;
    bound = true;

    $('btn-reroll').onclick = function () { UI.sound.click(); reroll(); };
    $('btn-lock').onclick = function () { UI.sound.click(); toggleLock(); };
    /* ★ 指引 / 阵容详解：两个入口都做成**随时可开**的通用弹窗。
       指引按钮常驻（新手翻完忘了也能再看一遍），
       羁绊小条本身也是"阵容详解"的入口（点它 = 点 📋）。 */
    if ($('btn-guide')) $('btn-guide').onclick = function () { UI.sound.click(); openGuide(0); };
    if ($('btn-comp')) $('btn-comp').onclick = function () { UI.sound.click(); openComp(); };
    if ($('trait-mini')) $('trait-mini').onclick = function () { UI.sound.click(); openComp(); };
    $('btn-xp').onclick = function () { UI.sound.click(); buyXp(); };
    $('btn-fight').onclick = function () { UI.sound.click(); startFight(); };
    $('btn-quit').onclick = function () {
      UI.sound.click();
      UI.modal({
        title: '放弃这一局？',
        body: '当前进度会保留「最远打到第几关」的记录，这一局本身会结束。',
        actions: [
          { label: '继续玩', kind: 'primary' },
          { label: '回到封面', onClick: backToCover }
        ]
      });
    };

    ['btn-settings', 'btn-settings2', 'btn-settings3'].forEach(function (id) {
      var b = $(id);
      if (b) b.onclick = function () { UI.sound.click(); Settings.openModal(); };
    });

    // 棋盘
    $('player-half').onclick = function (ev) {
      if (swallowClickAfterDrag()) return;
      var cell = ev.target.closest ? ev.target.closest('.cell') : null;
      if (!cell) return;
      var r = parseInt(cell.dataset.r, 10), c = parseInt(cell.dataset.c, 10);
      var k = key(r, c);
      var u = G.board[k];

      // 选中装备 → 装到这个格子的棋子上
      if (G.sel && G.sel.kind === 'item') {
        if (u) equipItem(G.sel.idx, u.uid);
        else deny('装备只能装在棋子上');
        return;
      }
      // 选中的是备战席 → 上场
      if (G.sel && G.sel.kind === 'bench') {
        var e = findUnit(G.sel.uid);
        if (e) benchToBoard(e.index, r, c);
        return;
      }
      // 选中的是棋盘上的另一个棋子 → 换位
      if (G.sel && G.sel.kind === 'board' && G.sel.uid) {
        var from = findUnit(G.sel.uid);
        if (from && from.loc === 'board') {
          if (from.key === k) { deselect(); return; }
          boardToBoard(from.key, k);
          return;
        }
      }
      // 什么都没选：点棋子就选中它
      if (u) { UI.sound.click(); selectUnit(u.uid); }
      else deselect();
    };

    $('player-half').oncontextmenu = function (ev) {
      var chip = ev.target.closest ? ev.target.closest('.u') : null;
      if (!chip) return;
      ev.preventDefault();
      sellUnit(chip.dataset.uid);
    };

    // 备战席
    $('bench').onclick = function (ev) {
      if (swallowClickAfterDrag()) return;
      var cell = ev.target.closest ? ev.target.closest('.bench-cell') : null;
      if (!cell) return;
      var i = parseInt(cell.dataset.i, 10);
      var u = G.bench[i];

      if (G.sel && G.sel.kind === 'item') {
        if (u) equipItem(G.sel.idx, u.uid);
        else deny('装备只能装在棋子上');
        return;
      }
      // 棋盘上的棋子 → 下场到这一格
      if (G.sel && G.sel.kind === 'board' && G.sel.uid) {
        var e = findUnit(G.sel.uid);
        if (e && e.loc === 'board') {
          if (u) {
            // 那一格有人：交换
            var slot = e.key;
            G.board[slot] = u;
            G.bench[i] = e.unit;
            UI.sound.place();
            renderAll();
          } else {
            boardToBench(e.key);
          }
          return;
        }
      }
      // 备战席内部换位
      if (G.sel && G.sel.kind === 'bench' && G.sel.uid && u && G.sel.uid !== u.uid) {
        var from = findUnit(G.sel.uid);
        if (from && from.loc === 'bench') {
          G.bench[from.index] = u;
          G.bench[i] = from.unit;
          UI.sound.place();
          renderAll();
          return;
        }
      }
      if (u) { UI.sound.click(); selectUnit(u.uid); }
      else deselect();
    };

    $('bench').oncontextmenu = function (ev) {
      var chip = ev.target.closest ? ev.target.closest('.u') : null;
      if (!chip) return;
      ev.preventDefault();
      sellUnit(chip.dataset.uid);
    };

    /* 拖拽放卡：按下 / 移动 / 松开绑在 document 上。
       ★ 移动和松开必须绑在 document 而不是棋盘上 ——
         指针拖出棋盘再松手是常事，绑在容器上会漏掉那一半操作。 */
    document.addEventListener('pointerdown', onDragDown);
    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', onDragUp);
    // ★ 捕获阶段拦原生拖拽，必须早于浏览器启动它
    document.addEventListener('dragstart', onDragStartGuard, true);
    // 指针被系统抢走（比如切窗口）时也要收干净，否则幽灵卡会留在屏幕上
    document.addEventListener('pointercancel', function () { clearDrag(); });
    window.addEventListener('blur', function () { clearDrag(); });

    // 战斗界面
    $('btn-pause').onclick = function () {
      UI.sound.click();
      if (Arena.isPlaying()) { Arena.pause(); $('btn-pause').textContent = '▶'; }
      else { Arena.resume(); $('btn-pause').textContent = '⏸'; }
    };
    $('btn-replay').onclick = function () {
      UI.sound.click();
      $('ticker').innerHTML = '';
      Arena.restart();
      $('btn-pause').textContent = '⏸';
    };
    $('btn-skip').onclick = function () { UI.sound.click(); Arena.skip(); };

    var spds = document.querySelectorAll('.spd');
    for (var i = 0; i < spds.length; i++) {
      (function (btn) {
        btn.onclick = function () {
          var s = parseFloat(btn.dataset.s);
          Arena.setSpeed(s);
          setSpeedButtons(s);
          UI.sound.click();
        };
      })(spds[i]);
    }

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { UI.closeModal(); return; }
      if (ev.target && /input|textarea/i.test(ev.target.tagName)) return;
      if (ev.code === 'Space' || ev.key === ' ') {
        if (UI.current() === 'scene-combat' && !UI.hasModal()) {
          ev.preventDefault();
          $('btn-pause').click();
        }
      }
      if (ev.key === '`' || ev.key === '~') { Arena.toggleDebug(); }
    });
  }

  function setSpeedButtons(s) {
    var spds = document.querySelectorAll('.spd');
    for (var i = 0; i < spds.length; i++) {
      spds[i].classList.toggle('on', parseFloat(spds[i].dataset.s) === s);
    }
  }

  /* ============================================================
   * 十四、开局
   * ============================================================ */
  function start() {
    G = newState();
    // 重新构建 DOM 缓存标记，保证换局时棋盘重建
    ['player-half', 'bench'].forEach(function (id) {
      var e = $(id);
      if (e) delete e.dataset.built;
    });
    $('mini-log').innerHTML = '';
    $('ticker').innerHTML = '';
    var overlay = $('result-overlay');
    if (overlay) overlay.classList.remove('on');
    $('btn-pause').textContent = '⏸';

    beginRound();
    UI.show('scene-game');
    /* ★★ 横屏提醒：进游戏**之前**就把话说清楚。
     *   横屏不是不能用（仍然沿用竖屏那套单列布局，可以上下滚），
     *   而是"准备界面天生需要纵向空间"—— 棋盘 4 行 + 备战池 + 商店卡，
     *   890px 高的竖屏刚好，390px 高的横屏永远排不下。
     *   ★ 一次会话只提醒一次（localStorage 记一笔）：玩家已经知道就别再烦他，
     *     真要每次都弹，那比横屏本身更烦。 */
    maybeWarnLandscape(function () {
      /* ★ 第一次进关自动翻一遍新手指引。
       *   ★ 等横屏提示关掉之后再弹（`after` 回调）：两个弹窗叠在一起会互相盖住，
       *     而且先看"建议竖屏"再看"怎么玩"才是对的顺序。
       *   ★ 只自动弹一次（localStorage 记一笔）；之后随时可以点
       *     商店那边的「❓ 指引」再看。
       *   ★ localStorage 读不到（隐私模式/本地文件）时 guideSeen() 返回 true，
       *     也就是宁可不弹，也不要每次进来都弹 —— 那比没有引导更烦人。 */
      if (guideSeen()) return;
      setTimeout(function () { if (!UI.hasModal()) openGuide(0); }, 280);
    });
  }

  /* ---------- 横屏提醒 ----------
   * ★ 横屏不是不能用（仍然沿用竖屏那套单列布局，可以上下滚），
   *   而是"准备界面天生需要纵向空间"：棋盘 4 行 + 备战池 + 商店卡，
   *   890px 高的竖屏刚好，390px 高的横屏永远排不下。
   * ★ 只提醒一次（localStorage），而且**只在真的要弹的时候才记账**——
   *   先记账再弹的话，一旦那次被别的弹窗挡掉，这条提示就永远不会出现了。 */
  var ROTATE_KEY = 'st_rotate_notice';

  function isLandscapePhone() {
    var w = window.innerWidth || 0, h = window.innerHeight || 0;
    return h > 0 && w > h && h <= 560;
  }

  function maybeWarnLandscape(after) {
    after = after || function () {};
    var seen = false;
    try { seen = window.localStorage.getItem(ROTATE_KEY) === '1'; } catch (e) { seen = false; }
    if (!isLandscapePhone() || seen) { after(); return; }
    setTimeout(function () {
      UI.modal({
        title: '建议竖屏游玩',
        body: '<p>本作的准备界面（<b>棋盘 + 备战池 + 商店</b>）是按竖屏排的：' +
              '棋盘要 4 行，备战池和商店各占一条，竖屏 844 高刚好放得下；' +
              '横屏只有 390 高，怎么排都会有面板需要上下滚动。</p>' +
              '<p>横屏<b>照样能玩</b>（可以上下滚），但把手机转成竖屏会舒服很多。</p>',
        actions: [{
          label: '知道了，继续玩', kind: 'primary',
          onClick: function () {
            try { window.localStorage.setItem(ROTATE_KEY, '1'); } catch (e) { /* 无所谓 */ }
            after();
          }
        }]
      });
    }, 420);
  }

  Game.start = start;

  function boot() {
    bind();
    Arena.init($('arena'));
    Arena.setDebug(false);
    // 立绘：找不到图会自动退回 emoji，所以这里可以放心全量预加载
    if (window.ART) window.ART.preloadAll();
    Cover.init({
      onPve: start,
      onPvp: function () { /* 只提示，不做别的 */ }
    });
    Settings.apply();
    /* ★ 背景音乐：**进封面就开始放**，不等玩家点第二次。
       浏览器不许自动播放有声媒体，所以 UI.sound.autoMusic 内部是
       "先试一次 + 任何交互再试 + 媒体就绪再试"三保险，
       这里不用再自己挂一次性监听了（那种写法的坑见 ui.js 的注释）。 */
    if (Settings.data.music > 0.01) UI.sound.autoMusic();
    UI.scene('scene-cover', { el: 'scene-cover' });
    UI.scene('scene-game', { el: 'scene-game' });
    UI.scene('scene-combat', { el: 'scene-combat' });
    UI.show('scene-cover', null, { force: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
