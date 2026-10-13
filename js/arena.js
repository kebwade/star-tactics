/* ============================================================
 * 科币战争 — 战斗表现层
 *
 * 这里的代码**不认识规则**：不算伤害、不掷骰子、不判胜负。
 * 它只是把 battle.js 吐出来的事件流按时间轴播一遍。
 *
 * 「自动寻敌」也是模拟器里就有的（每 tick 选最近的敌人、走过去、进射程就打），
 * 这一层负责的是**让你看得见它在寻敌**：走位位移、出手突进、受击后仰。
 *
 * 打击感清单（全都是消费同一个事件流换来的，加特效完全不用碰规则）：
 *   伤害飘字 · 命中白闪 · 屏幕震动 · 命中火花 · 技能冲击环
 *   击中顿帧(hitstop) · 血色滞后条 · 攻击突进 · 受击后仰 · 阵亡碎裂
 * ============================================================ */
(function () {
  'use strict';

  var ST = window.ST;

  // 棋盘尺寸从模拟器配置取，不要在这里另写一份 —— 改了棋盘宽度却忘了改这里，
  // 会出现「画布比实际棋盘小一圈、右边两列棋子看不见」这种很难查的问题。
  var COLS = ST.BATTLE_CFG.COLS, ROWS = ST.BATTLE_CFG.ROWS;
  var CELL = 72;              // 格子大小，和准备阶段棋盘的 --cell 完全一致
  var GAP = 8;                // 格间距，和准备阶段棋盘的 --gap 完全一致
  var PITCH = 80;             // 格子 + 间距：画布的定位步长
  var HIT_FLASH = 0.18;

  var A = (window.Arena = {});

  var cv = null, ctx = null;
  var state = null;
  var raf = 0, lastFrame = 0, running = false;
  var onFinish = null;
  var speed = 1;
  var debug = false;

  var fx = [];               // 特效池
  var shakeMag = 0;          // 屏幕震动幅度
  var FX_MAX = 220;

  A.COLS = COLS;
  A.ROWS = ROWS;
  A.cell = function () { return CELL; };
  /** 卡牌的绘制尺寸（比格子大，见 drawUnit 的注释） */
  A.cardSize = function () { return { w: CELL + 6, h: CELL + 10 }; };

  /* 浅色山谷主题的配色（和 game.css 的变量对齐） */
  var C = {
    enemyHalf: '#f0f1fa',
    mineHalf: '#eef4ef',
    grid: 'rgba(38,51,43,.055)',
    center: 'rgba(168,132,47,.42)',
    enemyEdge: '#8578b8',
    mineEdge: '#3f7fa8',
    hpEnemy: '#a58fd0',
    hpMine: '#57a86f',
    hpLag: '#e0a294',
    mana: '#5b9fd8',
    shield: '#ffffff',
    barBg: 'rgba(38,51,43,.26)',
    corpse: '#b8503f'
  };

  /* ============================================================
   * 初始化 / 尺寸
   * ============================================================ */
  /**
   * 把 CSS 变量解析成真正的像素值。
   *
   * ★ 不能写成 parseFloat(getComputedStyle(root).getPropertyValue('--x'))：
   *   自定义属性的「计算值」保留的是原样的 token 流，不是算完的数。
   *   所以 --cell 一旦被写成 min(...) 这种表达式，parseFloat 得到的是 NaN，
   *   兜底分支又踩同一个坑，最后静默退回常量 —— 表现就是不管屏幕多大，
   *   画布都死死钉在同一个尺寸。
   *   把变量挂到真实元素上让浏览器排版，读回来的才是「用值」。
   */
  function varPx(name) {
    var probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;height:0;width:var(' + name + ')';
    document.body.appendChild(probe);
    var px = probe.getBoundingClientRect().width;
    document.body.removeChild(probe);
    return px;
  }

  /**
   * 格子尺寸和格间距都从 CSS 读 —— 和准备阶段的棋盘**同一个** --cell / --gap。
   *
   * ★ 这里曾经有一个很难看出来的 bug：
   *   画布把 CELL 同时当成了「格子大小」和「格子间距」，于是
   *     布阵盘第 c 列中心 = c × (格子 + 间距) + 格子/2
   *     画布  第 c 列中心 = c × 格子 + 格子/2
   *   每列差 8px，8 列累计 56px —— 玩家摆好的阵型一开战就被横向压缩了一点，
   *   行列都对不齐。这就是「布阵时怎么摆、打起来位置却不一样」的根源。
   *
   *   现在画布用 pitch = 格子 + 间距 定位，于是：
   *     · 列中心和布阵盘逐列重合
   *     · 我方那 4 行 = 布阵盘整块平移 4 个 pitch（像素级一致）
   *     · 整个战场 = 8 行 × 8 列 = 布阵盘（4 行）的两倍高
   *
   *   还有第二个坑：--cell 是 min(...) 算出来的，值通常是小数（如 85.6）。
   *   画布是位图、格子必须取整，但如果只让画布取整、布阵盘仍按 85.6 排版，
   *   两边每列又差 0.6px。所以这里取整之后再写回 --cell-r，
   *   **两边共用同一个整数**（见 A.resize）。
   */
  function readCell() {
    try {
      var n = varPx('--cell');
      // ★ 必须向下取整。8 个格子每个多 0.5px 就是 4px，
      //   窄一点的屏上画布正好因此比预算宽 4px，战斗界面会出横向滚动条。
      if (isFinite(n) && n >= 20) return Math.floor(n);
    } catch (e) {}
    return 66;
  }

  function readGap() {
    try {
      var g = varPx('--gap');
      if (isFinite(g) && g >= 0) return Math.max(0, Math.round(g));
    } catch (e) {}
    return 8;
  }

  /** 战场的总宽 / 总高：8 格 + 7 个间距 —— 和布阵盘的算法完全一样 */
  function fieldW() { return COLS * PITCH - GAP; }
  function fieldH() { return ROWS * PITCH - GAP; }

  A.init = function (canvasEl) {
    cv = canvasEl;
    A.resize();
    if (!running) { running = true; raf = requestAnimationFrame(frame); }
    window.addEventListener('resize', function () { A.resize(); });
  };

  /** 格子尺寸 / 间距都跟着 CSS 走（响应式一变，画布跟着重算） */
  A.resize = function () {
    if (!cv) return;
    CELL = readCell();
    GAP = readGap();
    PITCH = CELL + GAP;
    /* ★ 把取整后的格子写回 CSS（--cell-r），让**布阵盘和战场用同一个整数**。
     *   只让画布取整的话，布阵盘还按小数值排版，每列差零点几像素、
     *   8 列累计就是几像素的错位 —— 阵型看起来「差不多但就是不对」。
     *   注意写的是 --cell-r，不是 --cell 本身：
     *   --cell 是 min(...) 算出来的「意图值」，被覆盖掉就再也算不回来了。 */
    try {
      document.documentElement.style.setProperty('--cell-r', CELL + 'px');
    } catch (e) {}

    var dpr = window.devicePixelRatio || 1;
    var w = fieldW(), h = fieldH();
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!state) drawIdle();
  };

  /** 战场总宽（= 8 格 + 7 个间距 = 布阵盘的宽度） */
  A.fieldW = function () { return fieldW(); };
  /** 战场总高（= 布阵盘高度的两倍，因为它是 8 行对 4 行） */
  A.fieldH = function () { return fieldH(); };
  A.pitch = function () { return PITCH; };
  A.gap = function () { return GAP; };

  A.setDebug = function (v) { debug = v; };
  A.toggleDebug = function () { debug = !debug; return debug; };
  A.setSpeed = function (s) { speed = s; };
  A.getSpeed = function () { return speed; };

  /* ============================================================
   * 播放
   * ============================================================ */
  A.play = function (result, opts, done) {
    opts = opts || {};
    onFinish = done || null;
    fx.length = 0;
    shakeMag = 0;
    if (opts.onEvent) A.onEvent = opts.onEvent;

    var pb = {
      result: result,
      t: 0,
      idx: 0,
      playing: true,
      total: result.log.length ? result.log[result.log.length - 1].t : 0,
      units: {},
      names: {},
      flashes: [],
      reveal: 0,
      hitstop: 0
    };

    var init = result.initial.units;
    for (var i = 0; i < init.length; i++) {
      var u = init[i];
      var d = ST.UNIT_BY_ID[u.defId] || {};
      pb.names[u.uid] = u;
      pb.units[u.uid] = {
        uid: u.uid, side: u.side, defId: u.defId, name: u.name, emoji: u.emoji,
        color: u.color, cost: d.cost || 1, items: (u.items || []).slice(),
        maxHp: u.maxHp, hp: u.hp, hpLag: u.hp, shield: u.shield,
        mana: u.mana, maxMana: u.maxMana,
        /* ★★ Dank1ng 的「狙击型」标记：技能数据里带 killSkull 的棋子。
         *   ★ 必须**透传**到渲染层状态里 —— 快照（battle.js）里有这个字段，
         *     但这里建状态时一个字一个字地抄，漏掉一个就是"这个功能永远不生效"
         *     （实测就是：枪怎么都不出现，因为 u.killSkull 一直是 undefined）。
         *   ★ 用它来决定"充能过半时架枪"，而不是写死 defId：
         *     以后再加一个狙击型棋子，技能里写上 killSkull 就自动有这套表现。 */
        killSkull: !!u.killSkull,
        r: u.r, c: u.c, rr: u.r, cc: u.c, alive: true, star: u.star,
        lunge: 0, lungeDx: 0, lungeDy: 0,
        flinch: 0, flinchDx: 0, flinchDy: 0, flash: 0,
        // 星级被动「越打越快」的当前层数：0 = 还没叠（或这个棋子没有被动）
        frenzy: 0, frenzyFlash: 0, frenzyCapped: false,
        frenzyCap: u.frenzyCap || 0,
        /* 星级被动「幻觉 / 开智」挂在身上的伤害倍率。
           buffMul 恒等于 1 就是没有效果；buffUntil 是失效时刻，
           播放时间越过它就自动忽略 —— 渲染层不需要「到期」事件。 */
        buffMul: 1, buffUntil: -1, buffFlash: 0,
        /* 星级被动「抓娃娃」还剩几次免伤。
           卡牌上会常驻一个 🛡N 的徽章 —— 这只鸭子只有 95 血，
           全部生存能力都押在这串次数上，玩家必须能一眼看出还剩多少。 */
        guardLeft: u.guardMax || 0, guardFlash: 0,
        /* 张雪峰「超频」：攻速加成（开局 ocStart，每次普攻 +step，
           进入狂暴后叠加翻倍，封顶 ocMax）。
           ocOver 打开之后徽章变红（🔥）—— 那是"正在狂暴 / 自毁"的信号；
           每次自毁还会再闪一下（ocBurnFlash）。
           ★ ocMax === 0 表示这一版没设上限（旧数据），画徽章时要按"没上限"处理。 */
        oc: u.ocStart || 0, ocOver: false, ocFlash: 0, ocBurnFlash: 0,
        ocMax: u.ocMaxAs || 0, ocCapped: false,
        /* 攻速增益（双刃舞者的「疾风连斩」/ 美团袋鼠 2 星的「准时送达」）。
           ★ 它和「超频」是**两条不同的东西**：oc 是自己越打越快、
             永久累积；这两个是别人给的一段限时加成，到期自己失效。
             所以徽章也必须分开画（🛵 而不是 ⚡），否则玩家以为张雪峰又叠了一层。 */
        asBuffPct: 0, asBuffUntil: -1, asBuffFlash: 0,
        /* 东北雨姐「红薯粉丝」：被捆到什么时候（rootUntil）+ 一次性闪光。
           ★ rootUntil 用 -1 表示"没被捆"，和 stunUntil / asBuffUntil 同一套约定。 */
        rootUntil: -1, rootFlash: 0,
        /* 钟离「玉璋护盾 / 天星」：
             · wardCut > 0 且盾还在 → 卡面挂一枚 💠 徽章（免控 + 减伤的标志）
             · petrifyUntil → 被石化到什么时候（这 3 秒里卡面压成石灰色 + 🪨 徽章）
           ★ 和 rootUntil / buffUntil 同一套约定：用 -1 表示"没有这个状态"，
             到期靠比时间，不需要任何"结束"事件。 */
        wardCut: u.wardCut || 0, wardFlash: 0,
        petrifyUntil: -1, petrifyFlash: 0,
        /* 祖国人「飞行 / 灼烧」：
             · flyOn —— 卡面抬起来画、影子分开（"它是飞着的"）
             · burnCurUntil / burnCurPct —— 被激光点着之后卡面挂一枚 🔥 徽章
           ★ 和 rootUntil / buffUntil 同一套约定：-1 = 没有这个状态。 */
        flyOn: !!u.flyOn,
        burnCurPct: u.burnCurPct || 0, burnCurUntil: -1, burnCurFlash: 0,
        burnFreezeImmune: !!u.burnFreezeImmune,
        /* 丁真「芝士雪豹 / 小马珍珠」：
             · biteCut / biteUntil —— 被雪豹咬过的人身上挂着的减速（🐆 徽章）
             · ponyOn / ponyShield / ponyDead —— 小马在不在、还剩多少
               （卡面要画那匹马；马死掉之后换成一个"狂暴中"的徽章） */
        biteCut: u.biteCut || 0, biteUntil: -1, biteFlash: 0,
        ponyOn: !!u.ponyOn, ponyShield: (u.ponyMax > 0) ? u.ponyMax : 0,
        ponyDead: false, ponyShout: '',
        /* 鹰佐「霸体 / 天照」：
             · batiOn / immuneUntil —— 免控窗口（卡面挂 🛡免控 徽章）
             · amaterasuOn —— 3 星的黑火（用来区分两种燃烧的颜色） */
        batiOn: !!u.batiOn, batiCdUntil: -1, immuneUntil: -1, batiFlash: 0,
        amaterasuOn: !!u.amaterasuOn,
        /* 蓝色大肥鱼「吃白饭 / TOKEN」：
             · tokenStacks —— 身上还挂着几层 TOKEN（卡面挂 🍚 徽章）
             · nextDmgMul  —— 下一次伤害的倍率（>1 时挂 🍽 徽章）
             · flashEat / flashToken 是那两件事发生时的闪光 */
        tokenStacks: 0, nextDmgMul: 1,
        flashEat: 0, flashToken: 0,
        /* ZMJJKK「世一决 / 霓虹激光 / 闪电乒乓」：
             · neonUntil —— 激光打到什么时候（这段时间里画手部蓝色激光）
             · neonAsMul / neonMul —— 徽章上的 ×10 / ×2
             · deathBonus —— 队内阵亡累积的增伤（🗡+N% 徽章）
             · ballOn —— 2 星有闪电球（开技能时会扔一个） */
        neonUntil: -1, neonAsMul: 1, neonMul: 1,
        neonShout: '', neonShoutFlash: 0, neonResets: 0, neonFlash: 0,
        deathBonus: 0, deathFlash: 0, ballOn: !!u.ballOn,
        /* 刘浩文「世界第一帅」：
             · drPerHpPct —— 每少 1% 血减多少伤（徽章要按当前血量实时算）
             · noDr       —— 不吃任何别的减伤（只用于说明性徽章/调试）
           ★ 这一条必须透传：漏了它徽章永远不显示（arena 建状态是逐字段抄的）。 */
        drPerHpPct: u.drPerHpPct || 0, noDr: !!u.noDr,
        /* 刘浩文「连扔」的进度 + ZMJJKK 闪电球的冷却（卡面都要挂徽章） */
        phoneUntil: -1, phonesLeft: 0, phoneTotal: 0, phoneFlash: 0,
        ballCd: 0, ballCdUntil: -1,
        /* 「和成天下5000精品大果」的自燃：卡片上要一直挂一个 🌰 徽章 ——
           带上它的人每秒都在掉血，不标出来的话玩家只会觉得"这张卡莫名其妙在死"。 */
        burnMaxPct: u.burnMaxPct || 0, burnFlash: 0,
        /* 孙笑川 3 星「安排上了」招安过来的单位 → 卡面变灰（见 drawUnit） */
        converted: false,
        /* 电棍：现在挂着几条电流（「三相电」最多 3 条，玩家得能数出来） */
        curN: 0,
        ocBerserkName: u.ocBerserkName || '狂暴',
        ocBerserkShout: u.ocBerserkShout || '',
        ocOverFlash: 0,
        /* 「巧乐兹」的冰棍层数（挂在自己身上） */
        chill: 0, chillMax: u.chillMax || 0, chillFlash: 0,
        /* 奶龙「捧腹大笑」：笑到什么时候。播放时间越过它就自动消失 ——
           和 buffUntil 是同一个套路，不需要「结束」事件。 */
        laughUntil: -1, laughFlash: 0, laughMove: !!u.laughMove, laughAlly: !!u.laughHeal,
        /* 下一颗 😂 飘字的时刻（连续飘字用，见 updateUnitFx） */
        laughFxAt: 0,
        /* 羊帆「羊巅峰」：蓄势好了没有（卡片上常驻 🐑×20 徽章） */
        peakReady: false,
        /* 楚生疑犯「遁入暗影」：现在是不是暗影状态。
           画面上表现为半透明 + 冷色描边 + 卡片上挂一枚 🌑 徽章。 */
        shadow: false,
        /* Dank1ng：耍折叠刀到什么时候（这段时间里不攻击）、
           空悲切（无限能量）开了没有、法力条刚回满的闪光。 */
        knifeUntil: -1, knifeFlash: 0,
        endless: false, manaFlash: 0,
        /* ★ Dank1ng「端着狙击枪」：充能过半就架起来（见 drawUnit）。
           rifleUp 记的是"上一帧架着没有"，用来抓**越过一半的那一瞬**闪一下；
           rifleFlash 是那一下的高光。 */
        rifleUp: false, rifleFlash: 0,
        /* ★ 纯 CD 技能的冷却条。
           cdSeconds > 0 的棋子**不吃法力**（gainMana 直接返回），
           所以 mana 永远不会自己往上涨 —— 法力条在这里是一条冷却条，
           必须由渲染层按时间自己算：cdT 是"这次冷却是什么时候开始的"。
           起手值 0：技能开局就在转（和 game.js 的说明一致）。 */
        cdSeconds: u.cdSeconds || 0, cdT: 0
      };
    }
    /* ★★ 「阴暗领域」：和单位一样，**一局开始时是空的**。
       领域不是开局就有的东西，全靠 field 事件往里加。
       ★ 这份列表和 battle.js 的 st.fields 是**两份独立的账**：
         那边管规则（谁在里面被减速），这边管画面（在哪画多大一片黑）。
         两边都只认"事件 + 时间戳"，谁也不读对方的内部状态。 */
    pb.fields = [];
    state = pb;
    return pb;
  };

  A.isPlaying = function () { return !!(state && state.playing); };
  A.isDone = function () { return !!(state && state.t >= state.total); };
  A.progress = function () { return state ? (state.total > 0 ? state.t / state.total : 0) : 0; };
  A.time = function () { return state ? state.t : 0; };
  A.total = function () { return state ? state.total : 0; };
  A.fxCount = function () { return fx.length; };
  /* 给自检用的：把当前特效的**标量字段**列出来。
     ★ 只返回数值和字符串，不返回任何内部对象 —— 特效是每帧都在变的活数据，
       测试只需要知道「现在场上有哪些特效、字幕多大」，
       拿到引用去改反而会让测试和实现纠缠在一起。
     ★ `size` 统一报**最终画出来的像素字号**：
       字幕（callout）本来就是按像素存的，而伤害飘字（num）存的是
       「相对倍率 + 缩放」，真正的字号要到 drawFx 里才算出来。
       两边各报各的话，测试写起来就得知道"这个 type 的 size 是哪种含义"——
       那正是最容易写错的地方，所以在这里统一换算好。 */
  A.fxList = function () {
    var out = [];
    for (var i = 0; i < fx.length; i++) {
      var e = fx[i];
      var sz = e.size;
      if (e.type === 'num') {
        var ns = NUM_STYLE[e.kind] || NUM_STYLE.phys;
        sz = Math.round((CELL * 0.235) * ns.size * (e.scale || 1));
      } else if (e.type === 'mote') {
        sz = Math.round(e.size);
      }
      out.push({ type: e.type, text: e.text, kind: e.kind, size: sz, life: e.life,
                 color: e.color, x: e.x, y: e.y, age: e.age, vy: e.vy,
                 /* ★ 线段类的特效（曳光 / 光束 / 闪电）还有两端坐标。
                    以前不导出它们，于是自检**根本没法验"这条线画在哪"** ——
                    我为此白查了一轮：断言里读到的四个坐标全是 undefined，
                    看起来像"287 道闪电都画错了"，其实是字段压根没暴露。
                    ★ 只在有值的时候带上，避免给别的特效塞一堆 undefined。 */
                 x1: (e.x1 === undefined ? undefined : e.x1),
                 y1: (e.y1 === undefined ? undefined : e.y1),
                 x2: (e.x2 === undefined ? undefined : e.x2),
                 y2: (e.y2 === undefined ? undefined : e.y2) });
    }
    return out;
  };
  A.shake = function () { return shakeMag; };
  A.units = function () { return state ? state.units : null; };
  /** 当前**还没过期**的领域（给自检用：只返回标量，不返回内部对象） */
  A.fields = function () {
    if (!state || !state.fields) return [];
    var out = [];
    for (var i = 0; i < state.fields.length; i++) {
      var f = state.fields[i];
      if (f.until <= state.t) continue;
      out.push({ id: f.id, r: f.r, c: f.c, radius: f.radius,
                 until: f.until, side: f.side, asCut: f.asCut, allyCut: f.allyCut });
    }
    return out;
  };

  A.pause = function () { if (state) state.playing = false; };
  A.resume = function () {
    if (!state) return;
    if (state.t >= state.total) A.restart();
    else state.playing = true;
  };
  A.restart = function () {
    if (!state) return;
    A.play(state.result, { onEvent: A.onEvent }, onFinish);
  };
  /** 跳到结算：一次性消费完剩下的事件。逻辑完全一样，只是不等时间轴。 */
  A.skip = function () {
    if (!state) return;
    while (state.idx < state.result.log.length) {
      applyEvent(state.result.log[state.idx]);
      state.idx++;
    }
    state.t = state.total;
    state.playing = false;
    state.reveal = 1;
    fx.length = 0;
    shakeMag = 0;
    if (onFinish) { var f = onFinish; onFinish = null; f(); }
  };

  A.onEvent = null;
  A.onFrame = null;

  /* ============================================================
   * 特效
   * ============================================================ */
  function addNum(x, y, text, kind, scale) {
    if (fx.length > FX_MAX) return;
    fx.push({
      type: 'num', x: x, y: y, text: text, kind: kind || 'phys',
      age: 0, life: kind === 'crit' ? 0.95 : 0.78,
      vx: (Math.random() - 0.5) * 24, vy: kind === 'crit' ? -58 : -46,
      scale: scale || 1
    });
  }
  function addRing(x, y, color, maxR, life) {
    if (fx.length > FX_MAX) return;
    fx.push({ type: 'ring', x: x, y: y, color: color, maxR: maxR, age: 0, life: life || 0.42 });
  }

  /* ---------- 讲话石「飞入寻常百姓家」的水系特效 ----------
   *
   * 两件东西拼出「河水」的观感：
   *   addRiver   一条从佩戴者流向受害者的水带：三层粗细不同的曲线叠出水感，
   *              前端只画到「已经流到哪」，后面再跟一撮水花
   *   addRipple  地面上的一圈水波：压扁成椭圆，看着像水面而不是普通光环
   */
  function addRiver(x1, y1, x2, y2) {
    if (fx.length > FX_MAX) return;
    fx.push({ type: 'river', x1: x1, y1: y1, x2: x2, y2: y2, age: 0, life: 0.40 });
  }

  function addRipple(x, y, maxR) {
    if (fx.length > FX_MAX) return;
    fx.push({ type: 'ripple', x: x, y: y, maxR: maxR || CELL * 1.05, age: 0, life: 0.55 });
  }
  /* ---------- 荣誉「狙击1」的弹道 ----------
   *
   *   一条**极粗、极亮**的曳光弹 + 枪口闪光 + 弹头。
   *
   *   ★ 2026-10 改版：原来是一条 5px 的光带，生命 0.22 秒 —— 实测在
   *     95px 的格子上几乎看不见，玩家根本不知道这一枪打出去了。
   *     现在拆成 5 层（26px 大光晕 → 13px 光晕 → 6px 彩线 → 2.6px 白热芯 → 弹头），
   *     最粗那层有整个格子的四分之一宽。
   *
   *   ★ 生命从 0.22 拉到 0.30，而且**前 55% 完全不衰减** ——
   *     以前一出来就在淡出，等于把最亮的那几帧浪费掉了。
   *
   *   没打中的时候子弹不是消失，而是**继续飞出去**（`over` 传一段越过的距离），
   *   让「打偏了」这件事在画面上真的发生过 —— 否则 miss 和「什么都没发生」看不出区别。
   */
  function addTracer(x1, y1, x2, y2, color, over) {
    if (fx.length > FX_MAX) return;
    fx.push({
      type: 'tracer', x1: x1, y1: y1, x2: x2, y2: y2,
      over: over || 0, color: color, age: 0, life: 0.30
    });
  }

  /* ---------- 老牧师「临终祷告」的金色光束 ----------
   * ★ 和荣誉那条蓄力激光**故意画得相反**：
   *   那一条是"越蓄越粗、最后一炸"（p^1.7），因为它指向的是"马上要开枪"；
   *   这一条是"安安静静一直照着"，因为它指向的是"我在救他，还要 1 秒"。
   *   所以用**恒定粗细 + 两头淡中间实的呼吸**（sin(p·π)）。
   * ★ life 同样和规则对齐（= 祷告时长 e.delay）：
   *   光消失的那一帧，人正好站起来 —— 不是渲染层挑了个好看的时长。
   */
  function addBeam(x1, y1, x2, y2, color, life) {
    if (fx.length > FX_MAX) return;
    fx.push({
      type: 'beam', x1: x1, y1: y1, x2: x2, y2: y2,
      color: color, age: 0, life: life || 1
    });
  }

  /* ---------- 电棍的电流 ----------
   * ★★ 需求里明确写了「明显电流特效」，所以这两条都不做成"一条亮线"：
   *   真正的闪电是**折线**、而且每帧都在抖；直线看起来像激光。
   */
  /** 一道锯齿闪电（两点之间）。折线的偏移用 Math.random —— 渲染层允许随机
      （引擎层才禁止），每帧重画就自动得到"噼啪"的感觉。 */
  function addArc(x1, y1, x2, y2) {
    if (fx.length > FX_MAX) return;
    fx.push({ type: 'arc', x1: x1, y1: y1, x2: x2, y2: y2, age: 0, life: 0.26 });
  }

  /** 电流"停在某个人身上等跳"的那 0.5 秒：一团噼啪的蓝白电球。
      ★ 它必须**持续可见** —— 否则玩家只看到"啪"一下，
        读不出"0.5 秒之后还会再跳一次"。
      ★ life 直接取规则里的延迟：光球消失的那一帧，电流正好跳走。 */
  function addCurrentNode(x, y, dur) {
    if (fx.length > FX_MAX) return;
    fx.push({ type: 'cnode', x: x, y: y, age: 0, life: dur || 0.5 });
  }

  /** 枪口闪光：从枪口炸开的一圈光环，只在开枪那一瞬间出现 */
  function addMuzzle(x, y, color) {
    if (fx.length > FX_MAX) return;
    fx.push({ type: 'muzzle', x: x, y: y, color: color, age: 0, life: 0.20 });
  }

  /* ---------- 荣誉的「眼睛喷金色激光」 ----------
   *
   * 这是**蓄力**的视觉：技能攒满之后它站着不动 CHARGE_TIME（0.5 秒），
   * 两只眼睛各射出一道金色激光指向目标，越来越粗、越来越亮，
   * 时间一到才真的开枪（那条又粗又白的曳光弹）。
   *
   * ★ 它和其他特效最大的区别：**life 是和规则对齐的**（e.dur = CFG.CHARGE_TIME）。
   *   不是"随便放 0.5 秒好看一下"—— 激光消失的那一帧，子弹正好出膛。
   *   所以改这个时长要去改 CFG.CHARGE_TIME，不要在渲染层单独调。
   */
  function addEyeLaser(x1, y1, x2, y2, dur) {
    if (fx.length > FX_MAX) return;
    fx.push({
      type: 'eyelaser', x1: x1, y1: y1, x2: x2, y2: y2,
      age: 0, life: dur || 0.5
    });
  }

  /* ---------- 角色台词（字幕） ----------
   *
   * ★★ 这是**所有角色的台词**统一走的那一个入口，不是荣誉专用的。
   *    以后再加「打中了喊一句 / 放技能喊一句」的角色，一律调这个函数，
   *    字号、底板、弹出动画、停留时长就都是同一套，不会每个角色长得不一样。
   *
   * ★ 为什么必须有底板：以前只是描边的一行字，压在卡牌立绘和血条上，
   *   实测根本看不清（深色立绘 + 深色描边 ≈ 一团黑）。
   *   现在是一块半透明深色圆角底板 + 彩色描边 + 同色外发光，
   *   底下是什么画面都能读出来。
   *
   * 字号默认 CELL × 0.62：95px 的格子上约 59px，
   * 「Vamos」横过去大约 1.6 张卡牌宽 —— 就是要这么显眼，它是台词，不是数值。
   */
  /* ---------- 角色台词（字幕） ----------
   *
   * ★★ 这是**所有角色的台词**统一走的那一个入口，不是荣誉专用的。
   *    以后再加「打中了喊一句 / 放技能喊一句」的角色，一律调这个函数，
   *    字号、弹出动画、停留时长就都是同一套，不会每个角色长得不一样。
   *
   * ★ 数据侧也可以不碰渲染层：技能里写一行 `callout: 'Man！'`
   *   （见 units.js 的「肘击」），cast 事件会把它带出来，
   *   上面那个 case 就会自动弹字幕。**加台词不需要改 arena.js。**
   *
   * ★★ 2026-10 二次改版：**去掉底板和边框，只要字**。
   *    见下面 drawFx 里 callout 分支的注释。
   *
   * 字号默认 CELL × 0.62：95px 格子上约 59px，
   * 「Vamos」横过去大约 1.6 张卡牌宽 —— 就是要这么显眼，它是台词，不是数值。
   */
  var CALLOUT_SIZE = 0.62;

  /* ★★ 2026-10 手机端大修：字幕"消失"和"重叠"两个 bug 都在这里。
   *
   *   实测（手机竖屏：格子 38px、战场 360×360）：
   *     ① **消失**：后排（最上面那两行）喊话时，y 减去半个格子、再向上飘
   *        半个格子，直接就飘出画布顶边了 —— 玩家看到的是"这句字幕压根
   *        没出现"。越靠上的单位越容易中招，而敌方永远在上面。
   *     ② **消失**：fx 顶到 FX_MAX(220) 时，原来只"挤掉一颗火花"就
   *        return —— 一颗挤完还满就把台词丢了。后期混战一帧能出十几颗
   *        火花，挤一颗根本不够。
   *     ③ **重叠**：所有台词都画在"单位头顶 + 固定偏移"，相邻两个单位同时
   *        喊话就是两行字叠在一起，谁也读不出来。手机上格子只有 38px、
   *        字号 23px，一行六个字就 140px 宽，挨着喊必然重叠。
   *
   *   四条对策：贴边压回来、抢位置（往上让格）、同句刷新不叠、
   *   满员时**腾地方**而不是丢台词。
   */

  /** 台词向上飘多少：小画面（手机）上只飘一点点。
   *  飘得越远，不同年龄的两条台词之间的间距缩得越多 —— 那就是重叠的来源。 */
  function calloutDrift() {
    return -CELL * (fieldW() < 560 ? 0.16 : 0.52);
  }

  /** 台词字号：跟着格子走，但**不许超过画面宽度的 1/7.5** —— 一行字最多占满一行 */
  function calloutSize(size) {
    var s = size || Math.round(CELL * CALLOUT_SIZE);
    var cap = Math.round(fieldW() / 7.5);
    return Math.max(12, Math.min(s, cap));
  }

  /** 估一行字占多宽（中日韩按全宽，拉丁/数字按 0.56 宽近似） */
  function calloutWidth(text, size) {
    var w = 0;
    for (var i = 0; i < text.length; i++) {
      w += (text.charCodeAt(i) > 0x2E80 ? 1 : 0.56) * size;
    }
    return w;
  }

  /** 新台词的位置和已经在放的哪一条撞上了吗 */
  function calloutHits(x, y, w, h) {
    for (var i = 0; i < fx.length; i++) {
      var f = fx[i];
      if (f.type !== 'callout') continue;
      var fw = f.w || calloutWidth(f.text, f.size);
      var fh = f.size * 1.2;
      var fp = f.age / f.life;
      /* ★ 两处都要比：**现在**的位置，和**最终停住**的位置。
         飘移会在 p≈0.91 处饱和（min(1, p*1.1)），所以两条台词之间的
         纵向间距会随时间变化 —— 只看当前位置，就会出现"加的时候不撞、
         飘一会儿撞上了"。 */
      var nowY = f.y + f.vy * Math.min(1, fp * 1.1);
      var endY = f.y + f.vy;
      if (Math.abs(x - f.x) < (w + fw) / 2 + 2) {
        if (Math.abs(y - nowY) < (h + fh) / 2 + 2) return true;
        if (Math.abs((y + (-CELL * 0.52)) - endY) < (h + fh) / 2 + 2) return true;
      }
    }
    return false;
  }

  function addCallout(x, y, text, color, size) {
    var csz = calloutSize(size);
    var cw = calloutWidth(text, csz);
    var chh = csz * 1.2;
    var i, f;

    /* ★ ① 同一句话还在屏幕上（同一位置、0.6 秒内）→ 刷新它，不叠第二条。
     *     连杀喊话、连续普攻的「霸体」都是这种，原来会叠成一摞。 */
    for (i = 0; i < fx.length; i++) {
      f = fx[i];
      if (f.type !== 'callout' || f.text !== text) continue;
      if (f.age > 0.6) continue;
      if (Math.abs(f.x - x) > CELL * 0.6 || Math.abs(f.y - y) > CELL * 0.6) continue;
      f.age = 0; f.x = x; f.y = y; f.color = color; f.size = csz; f.w = cw;
      return;
    }

    /* ★ ② 不许跑出画面：太靠上就压回安全线（上面 ① 说的那个"消失"）。 */
    var minY = chh * 0.5 + 3;
    var maxY = Math.max(minY, fieldH() - chh * 0.5 - 3);
    if (y < minY) y = minY;
    if (y > maxY) y = maxY;
    if (x < cw * 0.5 + 2) x = cw * 0.5 + 2;
    if (x > fieldW() - cw * 0.5 - 2) x = fieldW() - cw * 0.5 - 2;

    /* ★ ③ 抢位置：和已在放的台词撞上就**往上让一格**（最多三格，
     *     上面没地方就往下让两格）。两句都读不出来的字幕等于没有。 */
    /* ★★ 车道分配（第三次改，终于不会叠了）
     *
     *   前两版是"和现有台词比一比，撞了就往上挪一格"——**试几个就放弃**，
     *   而且飘移会在不同时刻饱和，两条之间的间距会随时间变，加的时候不撞、
     *   飘一会儿撞上（实测最严重叠了 12.9px）。
     *
     *   现在改成**显式车道**：把画面纵向切成若干条车道（每条 = 一行字高 + 6px），
     *   每条台词记下自己占的车道号；新台词从"最想待的那条"开始左右各找一条
     *   空车道（只有水平方向真的会碰上的车道才算被占）。
     *   因为所有台词一起匀速上飘，车道间距在整段生命里都保持不变 ——
     *   只要不同车道就永远不会重叠，这是**结构上**的保证，不是"比一比"。 */
    /* ★ 车道高度必须把**飘移**算进去：两条台词年龄不同，先加的那条已经飘到
     *   顶部、后加的那条刚起步，间距会从 laneH 缩到 laneH - |漂移| ——
     *   实测就是这样叠了 12.4px。所以 laneH 至少要多留一个漂移量。 */
    var calDrift = Math.abs(calloutDrift());
    var laneH = chh + Math.max(6, calDrift * 1.15 + 3);
    var laneN = Math.max(1, Math.floor((maxY - minY) / laneH) + 1);
    var usedLane = {};
    for (i = 0; i < fx.length; i++) {
      f = fx[i];
      if (f.type !== 'callout' || f.lane === undefined) continue;
      if (Math.abs(f.x - x) < (cw + (f.w || cw)) / 2 + 2) usedLane[f.lane] = true;
    }
    var wantLane = Math.round((y - minY) / laneH);
    if (wantLane < 0) wantLane = 0;
    if (wantLane > laneN - 1) wantLane = laneN - 1;
    var lane = -1, k2, up, dn;
    for (k2 = 0; k2 < laneN; k2++) {
      up = wantLane - k2;
      dn = wantLane + k2;
      if (up >= 0 && !usedLane[up]) { lane = up; break; }
      if (k2 > 0 && dn <= laneN - 1 && !usedLane[dn]) { lane = dn; break; }
    }
    if (lane < 0) lane = wantLane;          // 车道真的占满了，只能挤在一起
    y = minY + lane * laneH;

    /* ★ ④ 满员时**腾地方**，绝不再丢台词：
     *     先挤火花 → 再挤伤害飘字 → 再挤别的非台词特效；
     *     实在只剩台词，就允许超出 FX_MAX 一点。同时最多 8 条，
     *     再多就把最老的那条挤掉 —— 屏幕上同时 8 行字本来也读不过来。 */
    var alive = 0;
    for (i = 0; i < fx.length; i++) if (fx[i].type === 'callout') alive++;
    /* ★ 同屏条数**按车道数封顶**：只有 6 条车道就最多同时 6 条，
       多出来的挤掉最老的 —— 这样"不重叠"是结构保证，不是运气。 */
    var maxLines = Math.min(8, laneN);
    if (alive >= maxLines) {
      var oldest = -1, oldestAge = -1;
      for (i = 0; i < fx.length; i++) {
        if (fx[i].type === 'callout' && fx[i].age > oldestAge) { oldestAge = fx[i].age; oldest = i; }
      }
      if (oldest >= 0) fx.splice(oldest, 1);
    }
    var guard = 0;
    while (fx.length > FX_MAX && guard++ < 80) {
      var victim = -1;
      for (i = 0; i < fx.length; i++) { if (fx[i].type === 'spark') { victim = i; break; } }
      if (victim < 0) for (i = 0; i < fx.length; i++) { if (fx[i].type === 'num') { victim = i; break; } }
      if (victim < 0) for (i = 0; i < fx.length; i++) { if (fx[i].type !== 'callout') { victim = i; break; } }
      if (victim < 0) break;
      fx.splice(victim, 1);
    }

    fx.push({
      type: 'callout', x: x, y: y, text: text, color: color,
      size: csz, w: cw, lane: lane,
      age: 0, life: 1.45, vx: 0, vy: calloutDrift()
    });
  }

  /* ---------- 牢大「坠机」的三段特效 ---------- */

  /** 落下中的直升机：一条从画面顶端砸向落点的尾迹，活到坠毁那一刻为止 */
  function addStrike(x, y, delay, revive) {
    if (fx.length > FX_MAX) return;
    fx.push({
      type: 'strike', x: x, y: y, top: 0, revive: !!revive,
      color: revive ? '#ffd66e' : '#c8703c',
      age: 0, life: Math.max(0.25, delay || 0.5)
    });
  }

  /** 爆炸：外圈冲击波 + 内圈火球，半径直接由坠机的 3×3 决定 */
  function addBlast(x, y, r1, r2) {
    if (fx.length > FX_MAX) return;
    fx.push({ type: 'blast', x: x, y: y, r1: r1, r2: r2, age: 0, life: 0.55 });
  }

  /** 复活光柱：一道从地面冲上去的金色光 */
  function addPillar(x, y) {
    if (fx.length > FX_MAX) return;
    fx.push({ type: 'pillar', x: x, y: y, age: 0, life: 0.75 });
  }

  /* ---------- 钟离「天星」的陨石 ----------
   *   和牢大的坠机（addStrike）是"同一类事"但**不能共用**：
   *   坠机的尾迹是垂直的一条线、颜色是机身的橙红；
   *   陨石要的是**斜着砸进来的火球**（拖尾 + 自转的石头 + 落点裂纹），
   *   两者的观感差得远，而且这个还要按 3×3 的大小缩放。
   *
   *   ★ 画多大多久，直接来自事件里的半径和石化时长 ——
   *     "砸下来的那一下"和"被石化 3 秒"在时间上是接得上的：
   *     陨石 fx 的寿命取石化时长的一部分，落地冲击不会拖到石化结束才演完。
   */
  function addMeteor(x, y, size, dur) {
    if (fx.length > FX_MAX) return;
    fx.push({ type: 'meteor', x: x, y: y, size: size || CELL * 3,
              age: 0, life: Math.max(0.45, Math.min(1.1, (dur || 3) * 0.22)) });
  }

  /**
   * 陈兴裕「顶赋Jett」的五把飞刀。
   *
   * ★ `hit` 决定的是**终点**，不是换个颜色：
   *   中了 → 终点就在目标身上（刀插进去，末尾一顿）；
   *   没中 → 终点从目标两侧**擦过去**（横向散开 0.9 格 + 越过 1.1 格），
   *   看起来就是"打偏了"。两种结果在画面上没有任何共同点，
   *   玩家不需要看伤害数字就知道这一发中没中。
   * ★ 五把刀的出发时间错开 0.06 秒：齐刷刷一排像弹幕，
   *   一串接一串才像"刀一把把甩出去"。
   */
  function addKnives(x1, y1, x2, y2, count, hit) {
    if (fx.length > FX_MAX) return;
    var n = count || 5;
    for (var i = 0; i < n; i++) {
      /* 每把刀一个横向偏移：中了是围着目标散开（都落在卡上），
         没中是整体偏到一侧飞过去。 */
      var lane = (i - (n - 1) / 2);
      var spread = hit ? CELL * 0.22 : CELL * 0.30;
      var side = hit ? 0 : (i % 2 ? 1 : -1);
      var dx = hit ? lane * spread * 0.55 : (lane * spread + side * CELL * 0.55);
      var dy = hit ? lane * spread * 0.35 : -CELL * 0.45 - Math.abs(lane) * CELL * 0.06;
      var tx = x2 + dx + (hit ? 0 : side * CELL * 0.9);
      var ty = y2 + dy - (hit ? 0 : CELL * 1.35);
      fx.push({
        type: 'knifeFly', x1: x1, y1: y1, x2: tx, y2: ty,
        hit: !!hit, age: -i * 0.06, life: 0.30 + i * 0.06,
        vx: 0, vy: 0
      });
    }
  }

  /**
   * **一部**手机飞出去（2026-10 "连扔 5 秒"改版之后的常规路径：
   * 每一部手机都有自己的事件，所以走这一条）。
   *
   * ★ 和下面 `addPhones` 共用同一套随机：出手点绕身随机、
   *   弧高 / 横摆 / 自转 / 大小 / 飞行时间各自随机 ——
   *   于是"连扔"的每一下都是独立的一扔，40 部不会长得像 40 个复制品。
   */
  function addOnePhone(x, y, tx, ty, boom) {
    if (fx.length > FX_MAX) return;
    var ang = Math.random() * Math.PI * 2;
    var off = CELL * (0.08 + Math.random() * 0.36);
    fx.push({
      type: 'phoneFly',
      x1: x + Math.cos(ang) * off,
      y1: y + Math.sin(ang) * off * 0.62,
      x2: tx + (Math.random() - 0.5) * CELL * 0.34,
      y2: ty + (Math.random() - 0.5) * CELL * 0.34,
      boom: !!boom,
      arc: CELL * (0.28 + Math.random() * 0.78),
      wob: (Math.random() - 0.5) * CELL * 0.62,
      spin: (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 13),
      scale: 0.7 + Math.random() * 0.75,
      age: 0,
      life: 0.16 + Math.random() * 0.20,
      vx: 0, vy: 0
    });
  }

  /**
   * 刘浩文「手机大王」的手机雨（一次撒一把，开场那一波用）。
   *
   * ★★ 要演的是"**胡乱**扔"这四个字，所以每一部手机都是**独立的一扔**：
   *     · 出手点在自己身上随机一个角度、随机远近（不是从同一个点排队飞出去）
   *     · 出发时间随机错开（0.006~0.028 秒），不是整齐的等间距
   *     · 飞行时间随机（0.16~0.36 秒）—— 于是有的手机先到、有的后到，
   *       40 部**不会**排成一条漂亮的抛物线队列
   *     · 弧度、横向甩动、旋转速度、大小全都各自随机
   *   齐刷刷的一排看起来像"机关枪扫射"，而需求要的是"一把一把乱甩出去"。
   *
   * ★ 40 部手机**不能同一帧全画出来**：一帧 40 个小方块在 95px 的格子上
   *   就是一团糊。随机错开之后，同一帧最多七八部，而且方向各不相同。
   * ★ 终点是**目标当时的位置**再加一点随机偏移：手机飞一半目标死了也不改道
   *   （改道反而像"追踪导弹"，而需求说的是"随机扔出"）。
   */
  function addPhones(x1, y1, points, boom) {
    var t0 = 0;
    for (var i = 0; i < points.length; i++) {
      if (fx.length > FX_MAX) return;
      var ang = Math.random() * Math.PI * 2;
      var off = CELL * (0.08 + Math.random() * 0.36);
      t0 += 0.006 + Math.random() * 0.022;
      fx.push({
        type: 'phoneFly',
        /* 出手点：绕自己一圈的随机位置（"从身上各处甩出去"） */
        x1: x1 + Math.cos(ang) * off,
        y1: y1 + Math.sin(ang) * off * 0.62,
        /* 落点：目标格 + 随机抖动（手扔的东西本来就不准） */
        x2: points[i].x + (Math.random() - 0.5) * CELL * 0.34,
        y2: points[i].y + (Math.random() - 0.5) * CELL * 0.34,
        boom: !!boom,
        arc: CELL * (0.28 + Math.random() * 0.78),          // 抛物线高度
        wob: (Math.random() - 0.5) * CELL * 0.62,           // 横向甩动（歪着飞）
        spin: (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 13),
        scale: 0.7 + Math.random() * 0.75,
        age: -t0,
        life: 0.16 + Math.random() * 0.20,
        vx: 0, vy: 0
      });
    }
  }

  /**
   * 爆炸的**第一下**：一块短促的亮盘。
   *
   * ★ 为什么"爆炸感"必须从这一片亮开始：冲击环、火星、碎片都是**形状**，
   *   而人眼认"炸"靠的是**一瞬间的光**。没有 flash 的话，
   *   再多的环和碎片看起来都像"一堆粒子被扔出来"。
   * ★ 寿命极短（0.14 秒）而且一开始就接近全尺寸 ——
   *   慢慢涨大的圆看起来是"泡泡"，一下就铺满的才是"炸"。
   */
  function addFlash(x, y, r, life) {
    if (fx.length > FX_MAX) return;
    fx.push({ type: 'flash', x: x, y: y, r: r, age: 0, life: life || 0.14 });
  }

  /**
   * 碎屏：几片旋转着飞出去的小方块（屏幕玻璃 + 机身碎片）。
   * ★ 单独一类而不是拿 spark 凑：spark 是**圆点**，而"手机炸了"
   *   体现在**有棱角的碎片**上 —— 圆点看起来像烟花，方块才像碎屏。
   */
  function addShards(x, y, n, gold) {
    for (var i = 0; i < n; i++) {
      if (fx.length > FX_MAX) return;
      var a = Math.random() * Math.PI * 2;
      var sp = 120 + Math.random() * 220;
      fx.push({
        type: 'shard', x: x, y: y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
        size: 3 + Math.random() * 5,
        spin: (Math.random() - 0.5) * 22,
        rot: Math.random() * 6.28,
        gold: !!gold,
        age: 0, life: 0.32 + Math.random() * 0.34
      });
    }
  }

  /* ---------- 羊帆「巅峰谢幕」的自爆蓄力 ----------
   *   牢大的坠机是"天上掉东西下来"，羊帆的自爆是"它自己要炸了"——
   *   两者都是「倒下 → 1 秒 → 3×3 爆炸」，但那 1 秒里画面上该有的是
   *   完全不同的东西：一个要画飞行轨迹，一个要画**原地涨起来的危险**。
   *
   *   ★ life 直接等于事件里的 delay（CFG.CRASH_DELAY）：
   *     不是"随便放 1 秒好看一下"—— 这个圈涨满的那一刻，爆炸正好结算。
   *     和荣誉的激光（life = CHARGE_TIME）是同一个约定。
   */
  function addCharge(x, y, dur) {
    if (fx.length > FX_MAX) return;
    fx.push({ type: 'chargeGlow', x: x, y: y, age: 0, life: Math.max(0.25, dur || 1) });
  }

  function addSparks(x, y, n, color, power) {    for (var i = 0; i < n; i++) {
      if (fx.length > FX_MAX) return;
      var a = Math.random() * Math.PI * 2;
      var s = (power || 120) * (0.5 + Math.random());
      fx.push({
        type: 'spark', x: x, y: y, color: color, age: 0,
        life: 0.22 + Math.random() * 0.22,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s - 30,
        len: 5 + Math.random() * 7
      });
    }
  }
  function addShake(mag) { shakeMag = Math.min(15, shakeMag + mag); }

  /* ---------- 「大笑」特效：往上飘的字 / emoji ----------
   *
   * ★ 这是**两个机制共用**的一套特效：
   *     奶龙「捧腹大笑」   —— 笑的人自己头顶冒 😂
   *     嘉豪「男人领域」   —— 被控住的人头顶冒「哈哈」
   *   同一套 Mote 就够了：只是文字、颜色、数量不一样。
   *
   * ★ 为什么要做成"飘上去的字"而不是再加一圈光环：
   *   光环是**一瞬间**的，而这两个机制都是**持续几秒**的状态。
   *   一帧的光环没法表达"它现在还在笑"，飘字可以 ——
   *   连续冒 3 秒，玩家一眼就知道这段时间里它一直处于那个状态。
   *   所以奶龙的飘字是**每 0.28 秒一颗、连着冒满 3 秒**（见 updateLaughFx）。
   *
   * ★ 只吃标量参数，和别的特效一样 —— 测试可以拿 fxList() 读出
   *   文本和字号，不用碰任何内部对象。
   */
  function addMote(x, y, text, color, size, life, vx, vy, rot) {
    if (fx.length > FX_MAX) return;
    fx.push({
      type: 'mote', x: x, y: y, text: text, color: color,
      size: size || Math.round(CELL * 0.30),
      vx: (vx === undefined) ? (Math.random() - 0.5) * CELL * 0.55 : vx,
      vy: (vy === undefined) ? -CELL * (0.75 + Math.random() * 0.35) : vy,
      rot: (rot === undefined) ? (Math.random() - 0.5) * 0.5 : rot,
      age: 0, life: life || 0.85
    });
  }

  /** 一撮往上飘的笑：给「大笑 / 被逗笑」用 */
  function addGiggle(x, y, n, text, color, spread) {
    for (var i = 0; i < n; i++) {
      var dx = (Math.random() - 0.5) * (spread || CELL * 0.85);
      addMote(x + dx, y + (Math.random() - 0.5) * CELL * 0.30,
        text, color, undefined, undefined, undefined, undefined, undefined);
    }
  }

  /* ---------- Dank1ng「先过中门再谈未来」的两件东西 ----------
   *
   *   ① 骷髅：技能击杀之后**留在原地**的一个记号。
   *      ★ 它和别的飘字最大的区别是**几乎不飘**（vy 只有 -2% 格子/秒）——
   *        "留在原地"是要求里明说的，飘上去就变成"数字"了。
   *      ★ 寿命也比普通飘字长得多（1.8 秒），而且带一圈慢慢扩散的暗环，
   *        这样在一堆特效里能认出"这里死过人"。
   *
   *   ② 折叠刀：击杀之后耍 3 秒的那把刀。
   *      ★ life 直接等于技能数据里的 knifeDur —— 和荣誉的激光、
   *        羊帆的自爆蓄力同一套约定：**演出时长就是规则时长**，
   *        刀收起来的那一帧，它正好可以重新攻击。
   *      ★ 画成一个绕着卡片转的短刃（一段越来越尖的弧），
   *        另外每转一圈甩出一小撮寒光。
   */
  function addSkull(x, y) {
    addMote(x, y - CELL * 0.10, '💀', '#e8f0f4', Math.round(CELL * 0.42),
      1.8, 0, -CELL * 0.02, 0);
    addRing(x, y, 'rgba(40,46,56,.75)', CELL * 0.85, 0.6);
  }

  function addKnife(x, y, dur) {
    if (fx.length > FX_MAX) return;
    fx.push({ type: 'knife', x: x, y: y, age: 0, life: Math.max(0.2, dur || 3) });
  }

  /* ★ 定位用 PITCH（格子 + 间距），不是 CELL。
   *
   *   布阵盘第 c 列中心 = c × (格子 + 间距) + 格子/2
   *   画布  第 c 列中心 = 必须和上面那一行**逐字相同**，否则玩家摆的阵型
   *   一开战就会整体缩一点、行列对不上（差 7 × 间距 = 56px）。
   *   行同理。这就是「布阵怎么摆、打起来就该在哪」的实现方式。 */
  function cellX(u) { return u.cc * PITCH + CELL / 2; }
  function cellY(u) { return u.rr * PITCH + CELL / 2; }

  /* ============================================================
   * 事件消费
   * ============================================================ */
  function applyUpTo(t) {
    var log = state.result.log;
    while (state.idx < log.length && log[state.idx].t <= t) {
      applyEvent(log[state.idx]);
      state.idx++;
    }
  }

  function dirTo(from, to) {
    var dx = cellX(to) - cellX(from);
    var dy = cellY(to) - cellY(from);
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { dx: dx / len, dy: dy / len };
  }

  function applyEvent(e) {
    var pb = state, u, tgt, src, d;
    switch (e.type) {
      case 'move':
        u = pb.units[e.who];
        if (u) { u.r = e.r; u.c = e.c; }
        break;

      case 'attack': case 'skill': case 'damage':
        tgt = pb.units[e.to];
        src = pb.units[e.from];
        if (tgt) {
          tgt.hp = e.hpAfter;
          if (e.shieldLoss) tgt.shield = Math.max(0, tgt.shield - e.shieldLoss);
          tgt.flash = 1;
          if (src) {
            d = dirTo(tgt, src);          // 被打的人往后仰（远离攻击者）
            tgt.flinch = 1;
            tgt.flinchDx = d.dx;
            tgt.flinchDy = d.dy;
          }
          var isThorn = (e.reason === 'thorn');
          /* ★ 「剧毒火龙果」的范围毒：绿色的数字 + 绿色的雾点。
             和暴击的金、技能的紫、反伤的水色一眼分得开 ——
             它是一条"每秒都在跳"的伤害，颜色必须是最不抢眼但认得出的那一种。 */
          var isPoison = (e.reason === 'poison');
          var kind = e.type === 'attack'
            ? (e.peak ? 'peak' : (e.crit ? 'crit' : 'phys'))
            : (e.type === 'skill' ? 'magic' : (isThorn ? 'thornWater' : 'thorn'));
          if (isPoison) kind = 'poison';
          /* ★★ ZMJJKK「霓虹激光」：这 4 秒里的每一发都是**手部蓝色激光**。
           *   判据是"出手者此刻还在激光状态里"（neonUntil > 播放时间），
           *   渲染层不用认识 ZMJJKK 是谁。
           *   ★ 画两道细的蓝光（左右手各一道）而不是一道粗的：
           *     10 倍攻速下一帧可能有好几发，粗光会糊成一团。 */
          var isNeon = !!(src && src.neonUntil >= 0 && state.t < src.neonUntil);
          addNum(cellX(tgt), cellY(tgt) - CELL * 0.42, String(Math.round(e.dmg)), kind,
            e.crit ? 1.35 : 1);
          /* ★★ 羊帆「羊巅峰」的 20 倍一击。
           *
           *   这一下必须"看得出来是大事"：数字本身已经放大到 1.9 倍字号，
           *   再叠一套爆发（红金双环 + 大圈火星 + 顿帧 + 震屏），
           *   混战里也能一眼认出"刚才那一下不是普通普攻"。
           *   ★ 震屏和顿帧都比暴击更重（暴击 6.5 / 0.055，这里是 9 / 0.09）——
           *     20 倍伤害如果只靠飘字表达，玩家会以为是数字显示错了。 */
          /* ★★ 祖国人「耀眼红光」：从**眼睛**里射出的一道红色激光。
           *
           *   ★ 判据走事件里的 kind（'laser'），不写死 defId ——
           *     以后再加一个"激光型"技能，改数据就有这套表现。
           *   ★ 眼睛的位置是**估**出来的（和荣誉的蓄力激光同一套系数）：
           *     立绘是一张方图，取卡面上方三分之一、左右各偏 16% 卡宽。
           *   ★ 一道光束 + 命中点的爆闪 + 一圈热浪：红的、细的、笔直的 ——
           *     和荣誉那两条金色激光的区别就在颜色和粗细上（那是"蓄力瞄准"，
           *     这是"当场灼穿"）。三连发时每一次 skill 事件都会画一道，
           *     所以看起来就是连闪三下。 */
          if (e.type === 'skill' && e.kind === 'laser' && src) {
            var ex1 = cellX(src), ey1 = cellY(src) - CELL * 0.18;
            var tx2 = cellX(tgt), ty2 = cellY(tgt);
            /* ★ 光束的 life 从 0.22 拉到 0.62（用户要求"时间长一点"）：
               0.22 秒在 30fps 下只有 6~7 帧，扫过去几乎看不见；
               0.62 秒 ≈ 19 帧，足够看清两道红光从眼睛射出去、命中点被灼穿。
               ★ 中间那道更细更亮、life 稍短一点：它先消失，外面两道
                 再撑一下，看起来就像"光衰减"，而不是整条一起"啪"地灭掉。 */
            addBeam(ex1 - CELL * 0.16, ey1, tx2, ty2, '#ff3b30', 0.62);
            addBeam(ex1 + CELL * 0.16, ey1, tx2, ty2, '#ff3b30', 0.62);
            addBeam(ex1, ey1, tx2, ty2, '#fff0f0', 0.46);
            addRing(tx2, ty2, 'rgba(255,60,48,.95)', CELL * 1.25, 0.75);
            addRing(tx2, ty2, 'rgba(255,214,214,.9)', CELL * 0.7, 0.55);
            addSparks(tx2, ty2, 20, '#ff5a4a', 260);
            addSparks(tx2, ty2, 8, '#ffe6e6', 190);
            addShake(5.5);
            pb.hitstop = 0.05;
            /* ★ 这里**不写字幕**（用户要求删掉「耀眼红光」）：
               一道红色的激光本身就是这句话的表达，再压四个字上去，
               混战里只会挡住别人。技能名字在战报和选中信息里都能看到。 */
          }
          if (e.peak && tgt) {            addRing(cellX(tgt), cellY(tgt), 'rgba(255,120,60,.95)', CELL * 1.9, 0.6);
            addRing(cellX(tgt), cellY(tgt), 'rgba(255,214,110,.95)', CELL * 1.1, 0.42);
            addSparks(cellX(tgt), cellY(tgt), 22, '#ffd24d', 300);
            addSparks(cellX(tgt), cellY(tgt), 10, '#ff7a3c', 210);
            addShake(9);
            pb.hitstop = 0.09;
            if (src) addCallout(cellX(src), cellY(src) - (CELL + 10) / 2 - CELL * 0.34,
                                '羊巅峰', '#ffd24d');
          }
          if (isThorn) {
            /* ★ 讲话石「飞入寻常百姓家」的水系特效。
             *
             *   一条水带从佩戴者流向这个受害者 + 受害者脚下一圈水波。
             *   一次受击会同时弹到九宫格里所有人（最多 9 个），
             *   所以水带必须**细、快、半透明** —— 九条粗线同时出现就成一团糊了。
             *   水花用冷色（浅蓝），和物理命中的白/暖色一眼能分开。 */
            if (src) addRiver(cellX(src), cellY(src), cellX(tgt), cellY(tgt));
            addRipple(cellX(tgt), cellY(tgt), CELL * 0.95);
            addSparks(cellX(tgt), cellY(tgt), 5, '#8fcbe8', 150);
            addShake(1.2);
          } else if (isNeon) {
            /* ★ ZMJJKK 的手部激光：从两只手各射一道细的蓝光到目标身上。
               命中点只有一点点电火花 —— 10 倍攻速下颗粒要小，
               不然一整片蓝会把别的东西全盖住。 */
            var hx = cellX(src), hy = cellY(src) + CELL * 0.10;
            addBeam(hx - CELL * 0.22, hy, cellX(tgt), cellY(tgt), '#3ac0ff', 0.18);
            addBeam(hx + CELL * 0.22, hy, cellX(tgt), cellY(tgt), '#3ac0ff', 0.18);
            addBeam(hx, hy, cellX(tgt), cellY(tgt), '#e6f7ff', 0.13);
            addSparks(cellX(tgt), cellY(tgt), 3, '#8fd8ff', 90);
            if (e.crit) addShake(2.0);
          } else {
            addSparks(cellX(tgt), cellY(tgt), e.crit ? 9 : 4,
              e.crit ? '#e6b23c' : (e.type === 'skill' ? '#8d7ad4' : '#6b7a70'),
              e.crit ? 190 : 120);
            if (e.crit) addShake(6.5);
            else if (e.type === 'skill') addShake(4.5);
            else addShake(1.5);
            if (e.crit || e.type === 'skill') pb.hitstop = 0.055;   // 顿帧
          }
        }
        if (src) {
          /* ★ 纯 CD 型棋子（奶龙）的普攻**不会**给它加蓝 ——
             battle.js 里 gainMana 对它直接返回，而 attack 事件里的
             manaAfter 是"设想法力型会加多少"，对它来说是假数据。
             照抄进渲染层的话，冷却条会在每次普攻时被顶高一截、
             又被下一帧的重算拉回去，看起来像在抖。 */
          if (e.type === 'attack' && e.manaAfter !== undefined && !(src.cdSeconds > 0)) {
            src.mana = e.manaAfter;
          }
          /* ★ 巅峰一击把"蓄势"用掉了 —— 卡片上的 🐑×20 徽章跟着消失。
             不清的话，玩家会以为下一发还是 20 倍。 */
          if (e.peak) src.peakReady = false;
          if (tgt) {
            d = dirTo(src, tgt);          // 出手的人往目标方向突一下
            src.lunge = 1;
            src.lungeDx = d.dx;
            src.lungeDy = d.dy;
          }
        }
        break;

      case 'heal':
        u = pb.units[e.to];
        if (u) {
          u.hp = e.hpAfter;
          /* 星级被动（兽性 / 野性）的挨打回血用独立的样式：
             偏暖的绿 + 小一号字体。它是「被动在生效」，
             和奶妈主动奶一口应该看得出来不是一回事。 */
          var passiveHeal = (e.reason === 'passive');
          /* ★ 美团袋鼠 3 星「好评如潮」：这一口是**外卖送到**的。
             一次普攻会同时冒出好几口（圈里每个自己人各一口），
             所以给一个暖橙色的环 —— 混战里"这几口是同一单"一眼可辨。 */
          var delivHeal = (e.reason === 'delivery');
          /* ★ 东北雨姐 3 星「雨姐的关照」：打被捆住的人换来的那一大口。
             冒一颗 🍠 上去 —— 三件装备/三条被动都在冒绿字，
             只有图标能说清"这一口是谁给的"。 */
          var noodleHeal = (e.reason === 'noodle');
          addNum(cellX(u), cellY(u) - CELL * 0.42, '+' + Math.round(e.amount),
                 passiveHeal ? 'healPassive' : 'heal', 1);
          addRing(cellX(u), cellY(u),
                  passiveHeal ? 'rgba(170,205,110,.8)'
                              : (delivHeal ? 'rgba(255,168,72,.85)'
                                           : (noodleHeal ? 'rgba(214,140,70,.9)'
                                                         : 'rgba(90,190,120,.75)')),
                  CELL * (passiveHeal ? 0.42 : 0.55), 0.5);
          if (noodleHeal) {
            addMote(cellX(u), cellY(u) - CELL * 0.5, '🍠', '#ffe0b8', CELL * 0.34, 1.1);
          }
        }
        break;

      /* ★★ 东北雨姐 2 星「红薯粉丝」：被捆住的敌人**钉在原地但还能打**。
       *
       *   ★ 这个状态必须有一个持续可见的标记：画面上它只是"站着不动"，
       *     而"站着不动"在混战里和"卡住了 / 发呆 / 没目标"长得一模一样 ——
       *     不说清楚，玩家只会以为寻路出 bug 了。
       *   ★ 表现走"粉丝"的意象：一圈琥珀色的环 + 几根垂下来的粉丝 +
       *     「捆住」两个字；另外卡片上挂一枚 🍜 徽章（带剩余秒数）。
       *   ★ 和眩晕分开画（眩晕是金色环 + 哈哈 / 冰系那套）：这是**第三类**控制。 */
      case 'root': {
        var ru = pb.units[e.to];
        if (ru) {
          ru.rootUntil = e.until;
          ru.rootFlash = 1;
          var rx2 = cellX(ru), ry2 = cellY(ru);
          addRing(rx2, ry2, 'rgba(226,166,86,.9)', CELL * 0.66, 0.5);
          addRing(rx2, ry2, 'rgba(255,224,170,.7)', CELL * 0.4, 0.35);
          addSparks(rx2, ry2, 7, '#e8b46a', 140);
          addCallout(rx2, ry2 - (CELL + 10) / 2 - CELL * 0.34, '捆住', '#e8b46a');
        }
        break;
      }

      /* ★★ 攻速增益（双刃舞者「疾风连斩」/ 美团袋鼠 2 星「准时送达」）。
       *
       *   ★ 这条事件**渲染层以前根本没有处理** —— 双刃舞者放完技能，
       *     画面上一个像素都不变，玩家只能从"它怎么突然打得快了"去猜。
       *     规则层一直在正常发事件，是表现层漏了一整个类型。
       *   ★ 效果要挂 5 秒，而这一下特效是瞬时的，所以卡片上再挂一枚
       *     常驻徽章（🛵+20%）—— 和「幻觉」那条的处理方式是同一个道理。 */
      case 'buff': {
        var bu = pb.units[e.who];
        if (bu) {
          bu.asBuffPct = e.amount;
          bu.asBuffUntil = e.until;
          bu.asBuffFlash = 1;
          var bux = cellX(bu), buy = cellY(bu);
          addRing(bux, buy, 'rgba(255,178,92,.85)', CELL * 0.62, 0.45);
          addSparks(bux, buy, 6, '#ffcf8a', 140);
        }
        break;
      }

      case 'shield':
        u = pb.units[e.to];
        if (u) {
          u.shield = e.shieldAfter;
          if (e.reason !== 'trait') addRing(cellX(u), cellY(u), 'rgba(150,190,230,.8)', CELL * 0.5, 0.45);
        }
        break;

      /* ★★ 陈兴裕「顶赋Jett」：五把飞刀。
       *
       *   两种结果长得**完全不一样**（这就是这条技能最要紧的表现）：
       *     · hit  —— 五把刀扎到目标身上：每把都有一道刀光 + 命中点的火花
       *     · miss —— 五把刀从目标**旁边**飞过去（角度散开、越过它才消失），
       *               再喊一句「为什么瞄着不中啊」
       *   ★ 全空必须画得干净利落：不能有任何命中特效、不能有 0 伤害飘字，
       *     否则玩家读到的是"打中了但没伤害"（那看起来就是 bug）。
       *   ★ 五把是一起扔出去的（同一个事件），所以靠 life 错开一点点 ——
       *     齐刷刷一排像弹幕，一串接着一串才像"刀"。 */
      case 'jett': {
        var jSrc = pb.units[e.from], jTgt = pb.units[e.to];
        if (jSrc && jTgt) {
          var jn = e.knives || 5;
          addKnives(cellX(jSrc), cellY(jSrc) - CELL * 0.12,
                    cellX(jTgt), cellY(jTgt), jn, !!e.hit);
          if (e.hit) {
            addRing(cellX(jTgt), cellY(jTgt), 'rgba(220,236,255,.9)', CELL * 0.8, 0.35);
            addShake(3.5);
          } else {
            addSparks(cellX(jTgt), cellY(jTgt), 4, '#9fb0bd', 90);
            if (e.shout) {
              addCallout(cellX(jSrc), cellY(jSrc) - (CELL + 10) / 2 - CELL * 0.34,
                         e.shout, '#8fd8f0');
            }
          }
        }
        break;
      }

      /* ★★ 「剧毒火龙果」：每秒一次的绿色毒雾从装备者身上散开。
       *   ★ 画成"一圈**持续**往外冒的绿雾"而不是一下子炸开：
       *     它是一条 100% 会一直发生的事（每秒一跳），
       *     高频特效如果画得很响，整场战斗就只剩这一件装备了。
       *   ★ 目标名单里的每个人各补一小撮绿点 —— 让"谁在毒里"看得见，
       *     尤其是**自己**（这颗果子连主人一起毒）。 */
      case 'poison': {
        var pw = pb.units[e.who];
        if (pw) {
          var pwX = cellX(pw), pwY = cellY(pw);
          addRing(pwX, pwY, 'rgba(120,220,110,.55)',
                  CELL * ((e.radius || 1) * 2 + 1) * 0.42, 0.7);
          addSparks(pwX, pwY, 6, '#8fe07a', 90);
        }
        for (var pz = 0; e.targets && pz < e.targets.length; pz++) {
          var pv2 = pb.units[e.targets[pz]];
          if (pv2) addSparks(cellX(pv2), cellY(pv2), 3, '#6fbf5a', 70);
        }
        break;
      }

      /* ★★ 刘浩文「手机大王」：40 部手机一条事件带出来，渲染层按顺序撒出去。
       *   ★ 目标位置从**当前画面状态**里读（手机飞向"它现在站的地方"）——
       *     事件里只带 uid，坐标由渲染层自己查，和别的特效一致。 */
      case 'phones': {
        var phu = pb.units[e.from];
        if (phu) {
          var pts = [];
          for (var qi = 0; qi < e.targets.length; qi++) {
            var qu = pb.units[e.targets[qi]];
            if (!qu) continue;
            pts.push({ x: cellX(qu), y: cellY(qu) });
          }
          if (pts.length) {
            addPhones(cellX(phu), cellY(phu) - CELL * 0.10, pts, !!e.boom);
            var phx = cellX(phu), phy = cellY(phu);
            addRing(phx, phy, 'rgba(216,162,74,.85)', CELL * 1.1, 0.5);
            addSparks(phx, phy, 10, '#ffe0a0', 170);
            /* ★ 「胡乱扔」的第一眼：施法瞬间在自己身上**炸开一圈小气浪**，
               每撮的方向和距离都随机 —— 手机不再是从一个点排队出来，
               而是从身上各处"炸"出来的。 */
            for (var pf = 0; pf < 6; pf++) {
              var fa = Math.random() * Math.PI * 2;
              var fd = CELL * (0.2 + Math.random() * 0.55);
              addSparks(phx + Math.cos(fa) * fd, phy + Math.sin(fa) * fd * 0.7,
                        4, '#ffd98a', 150);
            }
            addFlash(phx, phy, CELL * 0.8, 0.16);
            /* ★ 字幕已按需求移除：刘浩文不喊话 —— 开场那一下只用
               白闪 + 环 + 气浪 + 手机本体来说话。 */
            addShake(7);
          }
        }
        break;
      }

      /* ★★ 刘浩文「手机大王」2026-10 改版：**5 秒连扔 40 部**。
       *   技能只给一条开场事件（`phoneStart`），之后每一部手机都有自己的
       *   `phoneThrow` —— 所以这里是"立起连扔状态 + 开场那一下乱甩"。
       *   ★ 开场先撒 3 部（不是 40 部）：观众第一眼要看到"已经开始扔了"，
       *     但真正的节奏交给接下来 5 秒，一帧 40 部只会糊成一团。 */
      case 'phoneStart': {
        var psu = pb.units[e.from];
        if (psu) {
          psu.phoneUntil = state.t + (e.dur || 5);
          psu.phonesLeft = e.count;
          psu.phoneTotal = e.count;
          psu.phonePerSec = e.perSec || (e.count / (e.dur || 5));
          var psx = cellX(psu), psy = cellY(psu);
          addFlash(psx, psy, CELL * 0.85, 0.18);
          addRing(psx, psy, 'rgba(216,162,74,.9)', CELL * 1.25, 0.55);
          addRing(psx, psy, 'rgba(255,232,170,.85)', CELL * 0.8, 0.4);
          addSparks(psx, psy, 14, '#ffe0a0', 200);
          for (var pf = 0; pf < 8; pf++) {
            var fa = Math.random() * Math.PI * 2;
            var fd = CELL * (0.2 + Math.random() * 0.6);
            addSparks(psx + Math.cos(fa) * fd, psy + Math.sin(fa) * fd * 0.7,
                      4, '#ffd98a', 150);
          }
          /* 开场随手甩 3 部出去 —— 落点**不指向具体目标**，而是在自己周围
             随机撒：这 3 部是"起手那一下"的演出，真正的投掷在接下来 5 秒里
             （每部都有自己的 phoneThrow 事件）。 */
          var startPts = [];
          for (var si = 0; si < 3 && si < e.count; si++) {
            var sAng = Math.random() * Math.PI * 2;
            var sDis = CELL * (1.2 + Math.random() * 1.8);
            startPts.push({ x: psx + Math.cos(sAng) * sDis,
                            y: psy + Math.sin(sAng) * sDis * 0.7 });
          }
          addPhones(psx, psy - CELL * 0.10, startPts, !!e.boom);
          /* ★ 字幕已按需求移除（刘浩文不喊话）：开场只用
             白闪 + 双环 + 气浪 + 三部手机本来表达"开始了"。
             数据侧的 phoneStart 事件仍带着 count/dur，战报里看得到。 */
          addShake(7);
        }
        break;
      }

      /* ★ 连扔期间的**每一部手机**：各自一条事件、各自一扔。
       *   ★ 剩下的部数写在卡面徽章上（见 stateBadges），
       *     落点从画面状态里查 —— 事件只带 uid。
       *
       *   ★★ 2026-10 再深化：一部手机的一生现在有**四段演出**，
       *      不再是"飞出去 + 一个数字"：
       *        ① 出手：身上冒一撮金火花（"从手里甩出去"的起手）
       *        ② 飞行：手机本体 + 3 层残影（见 phoneFly 的绘制）
       *        ③ 命中：目标身上一小片白闪 + 两片碎屏（"砸到了"）
       *        ④ 爆炸（3 星）：另走 phoneBoom 的四层
       *      ★ 命中那一下**只在非 3 星**的时候画：3 星每部都会跟一发
       *        大爆炸，再补一个小白闪等于同一件事画两遍。
       *      ★ 高频特效必须"小、碎、短"：一秒 8 部，
       *        每一下都画成烟花的话，整场战斗就只剩手机了。 */
      case 'phoneThrow': {
        var ptu = pb.units[e.from], ptt = pb.units[e.to];
        if (ptu) {
          ptu.phonesLeft = e.left;
          var ptx = cellX(ptu), pty = cellY(ptu);
          if (ptt) {
            var pttx = cellX(ptt), ptty = cellY(ptt);
            addOnePhone(ptx, pty - CELL * 0.10, pttx, ptty, !!e.boom);
            /* ③ 命中反馈 */
            addSparks(pttx, ptty, 3, '#e8d8b8', 110);
            if (!e.boom) {
              addFlash(pttx, ptty, CELL * 0.22, 0.10);
              addShards(pttx, ptty, 2, false);
            }
          }
          /* ① 出手火花：每一部都从身上溅出一点点 —— 8 部/秒的密度下，
             这一点点就是"他一直在往外掏东西"的全部证据。 */
          addSparks(ptx + (Math.random() - 0.5) * CELL * 0.3,
                    pty + (Math.random() - 0.5) * CELL * 0.2, 2, '#ffd98a', 90);
          /* 每 8 部补一次"起手气浪"：不补的话连扔中段会显得越来越安静 */
          if (e.left % 8 === 0) {
            addRing(ptx, pty, 'rgba(216,162,74,.5)', CELL * 0.9, 0.35);
          }
        }
        break;
      }

      /* ★★ 3 星「三星手机」：每部手机命中后的那一下爆炸。
       *
       *   ★★ "爆炸感"是**四层叠出来的**，少一层都会塌成"一堆粒子"：
       *     ① `addFlash` —— 一瞬间的白闪（人眼认"炸"靠的是光，不是形状）
       *     ② 冲击环    —— 一圈迅速扩到 3×3 之外的透明圆环（力量的方向）
       *     ③ 火球/火星 —— 金白两层火星（能量）
       *     ④ `addShards` —— 旋转着飞出去的碎屏方块（"这是个**手机**炸了"）
       *   ★ 震屏随命中次数递增但**有上限**：40 部手机连着炸，
       *     固定 6 的话屏幕会一直抖到看不清；2 + 命中数上限 7 正好是
       *     "一下比一下猛、最后稳定在一个很响的档位"。
       *   ★ 不加顿帧（hitstop）：40 次 × 0.05 秒 = 2 秒的冻结，
       *     那是把"手机雨"变成幻灯片。 */
      case 'phoneBoom': {
        var pbu = pb.units[e.from];
        var bx3 = e.c * PITCH + CELL / 2, by3 = e.r * PITCH + CELL / 2;
        var bRad3 = CELL * ((e.radius || 1) * 2 + 1);
        var boomN = (e.seq === undefined) ? 1 : e.seq;
        addFlash(bx3, by3, bRad3 * 0.42, 0.15);
        addRing(bx3, by3, 'rgba(255,217,138,.95)', bRad3 * 0.62, 0.44);
        addRing(bx3, by3, 'rgba(255,255,255,.92)', bRad3 * 0.34, 0.3);
        addRing(bx3, by3, 'rgba(255,160,60,.7)', bRad3 * 0.5, 0.5);
        addSparks(bx3, by3, 12, '#ffd98a', 260);
        addSparks(bx3, by3, 8, '#fff2cf', 200);
        addSparks(bx3, by3, 5, '#8a8f98', 130);       // 一点机身灰
        addShards(bx3, by3, 7, true);
        if (pbu) addSparks(cellX(pbu), cellY(pbu), 3, '#ffd98a', 90);
        addShake(Math.min(7, 2 + boomN));
        break;
      }

      /* ★★ ZMJJKK「霓虹激光」：开大的那一刻。
       *
       *   蓝色的爆环 + 一层"电流罩" + 徽章「🔫×10」——
       *   这 4 秒里它射出的每一发都是手部激光（见 attack 分支里的蓝色光束），
       *   所以开场必须有一次明确的"我变了"。
       *   ★ 3 星会带 `shout`（「你们的王回来了！」），2 星则是闪电球先落地。 */
      case 'neon': {
        var nu = pb.units[e.who];
        if (nu) {
          nu.neonUntil = e.until;
          nu.neonAsMul = e.asMul;
          nu.neonMul = e.mul;
          nu.neonFlash = 1;
          var nx = cellX(nu), ny = cellY(nu);
          addRing(nx, ny, 'rgba(58,192,255,.95)', CELL * 1.6, 0.7);
          addRing(nx, ny, 'rgba(200,240,255,.9)', CELL * 1.0, 0.5);
          addSparks(nx, ny, 24, '#3ac0ff', 300);
          addSparks(nx, ny, 10, '#e6f7ff', 200);
          addShake(8);
          pb.hitstop = 0.06;
          if (e.shout) {
            addCallout(nx, ny - (CELL + 10) / 2 - CELL * 0.34, e.shout, '#3ac0ff');
          } else {
            addCallout(nx, ny - (CELL + 10) / 2 - CELL * 0.34, '霓虹激光', '#7fd8ff');
          }
        }
        break;
      }

      /* ★★ ZMJJKK 2 星「闪电乒乓」：一个电球砸下来，3×3 里的敌人一起麻 3.5 秒。 */
      case 'pingpong': {
        var ppu2 = pb.units[e.from];
        if (ppu2) { ppu2.ballCdUntil = e.cdUntil; ppu2.ballCd = e.cd; }
        var px2 = e.c * PITCH + CELL / 2, py2 = e.r * PITCH + CELL / 2;
        var pRad = CELL * ((e.radius || 1) * 2 + 1);
        addFlash(px2, py2, pRad * 0.30, 0.16);
        addRing(px2, py2, 'rgba(255,240,140,.95)', pRad * 0.6, 0.6);
        addRing(px2, py2, 'rgba(140,220,255,.95)', pRad * 0.38, 0.45);
        addSparks(px2, py2, 22, '#ffe98a', 300);
        addSparks(px2, py2, 14, '#8fd8ff', 240);
        addCallout(px2, py2 - ((CELL + 10) / 2 + CELL * 0.4), '闪电乒乓', '#ffe98a');
        addShake(9);
        pb.hitstop = 0.05;
        break;
      }

      /* ★★ ZMJJKK「霓虹激光」期间的击杀：**时间重置回 4 秒** + 一句台词。
       *   ★ 台词按双方星级分三句（低 / 高 / 同），都从事件里带过来 ——
       *     渲染层不需要认识 ZMJJKK。
       *   ★ 还要画一条"续命"的蓝色脉冲：玩家得看出"这一杀让激光又满了"。 */
      case 'neonKill': {
        var nk = pb.units[e.who];
        if (nk) {
          nk.neonUntil = e.until;
          nk.neonResets = e.resets;
          nk.neonFlash = 1;
          var nkx = cellX(nk), nky = cellY(nk);
          addRing(nkx, nky, 'rgba(58,192,255,.9)', CELL * 1.2, 0.5);
          addSparks(nkx, nky, 10, '#3ac0ff', 180);
          if (e.shout) {
            nk.neonShout = e.shout;
            nk.neonShoutFlash = 1;
            addCallout(nkx, nky - (CELL + 10) / 2 - CELL * 0.34, e.shout, '#3ac0ff');
          }
        }
        break;
      }

      /* ★ ZMJJKK「世一决」：队里又倒下一个人 → 它更狠一点（🗡+20%）。 */
      case 'shiai': {
        var su2 = pb.units[e.who];
        if (su2) {
          su2.deathBonus = e.bonus;
          su2.deathFlash = 1;
          addRing(cellX(su2), cellY(su2), 'rgba(255,120,120,.85)', CELL * 0.9, 0.45);
          addSparks(cellX(su2), cellY(su2), 8, '#ff8a8a', 150);
        }
        break;
      }

      /* ★★ 蓝色大肥鱼「吃白饭」四件套：
       *     ① eatrice  —— 技能起手：嘴里亮一下（下一口翻倍）
       *     ② eat      —— **把它吞了**：目标被整个吃掉（黑屏一样的一口）
       *     ③ token    —— 全队各加一层 TOKEN（每个人头上飘一枚 🍚）
       *     ④ tokenUsed/tokenMana —— 花掉一层 / 大肥鱼因此回蓝
       *   ★ "吃掉"必须画得比普通击杀**更狠**：它是直接处死，
       *     所以用"整张卡被吸进鱼嘴里"的演出（一圈向内收的黑环），
       *     而不是普通的死亡特效。 */
      case 'chargeUp': {
        var cu2 = pb.units[e.who];
        if (cu2) {
          cu2.nextDmgMul = e.mul;
          var cux = cellX(cu2), cuy = cellY(cu2);
          addRing(cux, cuy, 'rgba(120,200,255,.9)', CELL * 0.8, 0.5);
          addSparks(cux, cuy, 8, '#9fd8ff', 150);
          addNum(cux, cuy - CELL * 0.46, '下一口 ×' + e.mul, 'eatReady', 0.9);
        }
        break;
      }
      case 'eat': {
        var eu2 = pb.units[e.to], ef2 = pb.units[e.from];
        if (eu2) {
          eu2.alive = false;
          eu2.hp = 0;
          eu2.shield = 0;
          var eux = cellX(eu2), euy = cellY(eu2);
          addRing(eux, euy, 'rgba(8,18,30,.92)', CELL * 1.6, 0.55);
          addRing(eux, euy, 'rgba(120,200,255,.9)', CELL * 0.9, 0.45);
          addSparks(eux, euy, 24, '#1a2a3a', 300);
          addSparks(eux, euy, 10, '#9fd8ff', 200);
          addCallout(eux, euy - (CELL + 10) / 2 - CELL * 0.34, '吃掉了！', '#7fd0ff');
          addShake(10);
          pb.hitstop = 0.07;
        }
        if (ef2) {
          ef2.flashEat = 1;
          addRing(cellX(ef2), cellY(ef2), 'rgba(255,236,180,.9)', CELL * 1.2, 0.55);
        }
        break;
      }
      case 'token': {
        /* 全队一人一枚：只给**自己这边**现在还活着的人飘字 */
        for (var tk in pb.units) {
          var tu = pb.units[tk];
          if (!tu.alive || tu.side !== e.side) continue;
          tu.tokenStacks = (tu.tokenStacks || 0) + 1;
          tu.flashToken = 1;
          addSparks(cellX(tu), cellY(tu), 5, '#ffe9a8', 120);
        }
        var tou = pb.units[e.from];
        if (tou) {
          addCallout(cellX(tou), cellY(tou) - (CELL + 10) / 2 - CELL * 0.34,
                     'TOKEN ×1', '#ffd98a');
        }
        break;
      }
      case 'tokenUsed': {
        var uu2 = pb.units[e.who];
        if (uu2) {
          uu2.tokenStacks = Math.max(0, (uu2.tokenStacks || 0) - 1);
          uu2.flashToken = 1;
          addNum(cellX(uu2), cellY(uu2) - CELL * 0.46, 'TOKEN ×' + e.mul,
                 'tokenUse', 0.92);
        }
        break;
      }
      case 'tokenMana': {
        var mu3 = pb.units[e.who];
        if (mu3) {
          addSparks(cellX(mu3), cellY(mu3), 6, '#8fd0ff', 130);
        }
        break;
      }
      case 'consume': {
        var co = pb.units[e.who];
        if (co) {
          co.nextDmgMul = 1;
          co.flashEat = 1;
          addSparks(cellX(co), cellY(co), 7, '#9fd8ff', 150);
          addNum(cellX(co), cellY(co) - CELL * 0.46, '×' + e.mul, 'eatReady', 1.0);
        }
        break;
      }

      /* ★★ 鹰佐 2 星「霸体」：挨了一下控制，金色的光一闪，人立刻能动、还免控 5 秒。
       *
       *   金色是**唯一**的颜色选择：眩晕是金色环 + 哈哈、捆住是琥珀色、
       *   冰冻是冰蓝、石化是土灰 —— 只有"解控"这件事要用**亮的金**来说，
       *   因为它是"我没事"而不是"我被打中了"。
       *   ★ `passive: true` 的那一条是"免控窗口里又挨了一下控制"：
       *     同一个金色，但不重置冷却（引擎那边分的），画面上不额外弹字幕。 */
      case 'bati': {
        var ba = pb.units[e.who];
        if (ba) {
          ba.immuneUntil = e.immuneUntil;
          ba.batiCdUntil = e.cdUntil;
          ba.batiFlash = 1;
          var bax = cellX(ba), bay = cellY(ba);
          addRing(bax, bay, 'rgba(255,214,90,.95)', CELL * 1.5, 0.6);
          addRing(bax, bay, 'rgba(255,246,200,.9)', CELL * 0.9, 0.42);
          addSparks(bax, bay, 20, '#ffd24d', 240);
          addShake(6);
          if (!e.passive) {
            addCallout(bax, bay - (CELL + 10) / 2 - CELL * 0.34, '霸体', '#ffd24d');
          }
        }
        break;
      }

      /* ★★ 鹰佐 3 星「天照」：黑色的火落在 3×3 上。
       *
       *   · 落点那一格先炸一圈**黑红**的冲击（黑火是暗的，所以描边要亮一点，
       *     否则在深色地面上根本看不见）
       *   · 被点着的人身上各起一撮黑焰 —— 之后每秒一跳（laserburn 事件）
       *   ★ 黑火的颜色和数据里的"黑色火焰"对齐：不要用橙红，
       *     那是祖国人那把火，两把火必须一眼分得开。 */
      case 'amaterasu': {
        var ax2 = e.c * PITCH + CELL / 2, ay2 = e.r * PITCH + CELL / 2;
        var aRad = CELL * ((e.radius || 1) * 2 + 1);
        addRing(ax2, ay2, 'rgba(20,10,26,.85)', aRad * 0.62, 0.75);
        addRing(ax2, ay2, 'rgba(168,72,220,.95)', aRad * 0.52, 0.6);
        addRing(ax2, ay2, 'rgba(255,214,255,.85)', aRad * 0.3, 0.4);
        addSparks(ax2, ay2, 26, '#2a1030', 300);
        addSparks(ax2, ay2, 14, '#c070f0', 230);
        addCallout(ax2, ay2 - ((CELL + 10) / 2 + CELL * 0.4), '天照', '#c070f0');
        addShake(9);
        pb.hitstop = 0.06;
        for (var at = 0; e.targets && at < e.targets.length; at++) {
          var au = pb.units[e.targets[at]];
          if (au) addSparks(cellX(au), cellY(au), 10, '#1a0a20', 160);
        }
        break;
      }

      /* ★★ 丁真「芝士雪豹」：雪豹咬中的人**攻速移速一起 -40%**、持续 3 秒。
       *
       *   这条减速必须有一个**看得见的标记**：它既不改变卡面、也不掉血，
       *   只是"动得慢、打得慢" —— 而"慢"在混战里是最容易被读成
       *   "这张卡卡住了 / 我的游戏掉帧了"的一种状态。 */
      case 'bite': {
        var bi = pb.units[e.to];
        if (bi) {
          bi.biteCut = e.cut;
          bi.biteUntil = e.until;
          bi.biteFlash = 1;
          var bix = cellX(bi), biy = cellY(bi);
          addRing(bix, biy, 'rgba(150,220,190,.9)', CELL * 0.7, 0.45);
          addSparks(bix, biy, 6, '#9ce0b8', 130);
          addNum(bix, biy - CELL * 0.46, '-' + Math.round(e.cut * 100) + '%',
                 'biteSlow', 0.9);
        }
        break;
      }

      /* ★★ 丁真 3 星「小马珍珠」：小马被打死的那一瞬间。
       *
       *   两件事必须同时被看见：丁真**喊了一句**「珍珠死了」，
       *   以及他**变强了**（魔力获取 +70%）——
       *   只画一个爆环的话，玩家读到的是"他被打了"，
       *   而不是"他的马死了、他要开始报复了"。 */
      case 'ponyDead': {
        var pd = pb.units[e.who];
        if (pd) {
          pd.ponyDead = true;
          pd.ponyShield = 0;
          var pdx = cellX(pd), pdy = cellY(pd);
          addRing(pdx, pdy, 'rgba(255,90,70,.95)', CELL * 1.5, 0.7);
          addRing(pdx, pdy, 'rgba(255,214,120,.9)', CELL * 1.0, 0.5);
          addSparks(pdx, pdy, 22, '#ff7a5a', 280);
          addShake(9);
          if (e.shout) {
            addCallout(pdx, pdy - (CELL + 10) / 2 - CELL * 0.34, e.shout, '#ff6a4a');
          }
          /* ★ 「狂暴」那一行小字：它是这一整套被动的收益，
             不写出来的话"马死了"看起来纯粹是坏事。 */
          addNum(pdx, pdy + CELL * 0.30, '狂暴 魔力+' +
                 Math.round((e.manaMul - 1) * 100) + '%', 'ponyRage', 0.95);
        }
        break;
      }

      /* 小马落地：开局那一层护盾，画一圈马色的光 + 一枚 🐴 徽章。 */
      case 'pony': {
        var po = pb.units[e.who];
        if (po) {
          po.ponyOn = true;
          po.ponyShield = e.shield;
          addRing(cellX(po), cellY(po), 'rgba(255,214,140,.9)', CELL * 0.9, 0.6);
          addSparks(cellX(po), cellY(po), 12, '#ffe0a0', 170);
        }
        break;
      }

      /* ★★ 钟离 2 星「玉璋护盾」：被罩住的队友**免疫控制、少受 20% 伤害**。
       *
       *   `what` 分两种，表现完全相反：
       *     · 'grant' —— 刚把守护挂上（跟着套盾一起来）：金色的环 + ✨
       *     · 别的值（stun / freeze / petrify / root / knockback）——
       *       **挡下了一次控制**：这时如果什么都不画，玩家看到的只是
       *       "对面的技能好像没生效"，那和 bug 长得一模一样。
       *       所以弹一行「免疫」，再把守护环亮一次。
       *   ★ 卡面上那枚 💠 徽章是常驻的（见 drawUnit / stateBadges），
       *     只要盾还在就一直挂着 —— 玩家据此知道"现在还有守护"。 */
      /* ★★ 祖国人 2 星「灼烧」：激光把目标点着了。
       *
       *   着火是一个**持续 5 秒**的状态，而这一下特效是瞬时的 ——
       *   所以除了当下的火环，卡面上还会挂一枚 🔥 徽章（带剩余秒数）。
       *   没有徽章的话，玩家只会看到"它莫名其妙每秒掉一截血"。
       *   ★ 橙色而不是红色：红色已经是"暴击/重伤"的颜色，
       *     而这里要表达的是"它在烧"。 */
      case 'ignite': {
        var iu = pb.units[e.to];
        if (iu) {
          iu.burnCurPct = e.pct;
          iu.burnCurUntil = e.until;
          iu.burnFreezeImmune = !!e.freezeImmune;
          iu.burnCurFlash = 1;
          var ix = cellX(iu), iy = cellY(iu);
          /* ★ 两把火的**开场特效**也要分开画：
             · 祖国人那把是橙色（"烧起来了"）
             · 天照是黑紫 + 一圈暗环（"天照"本身就是黑火）
             否则玩家在混战里分不清身上烧的是哪一把。 */
          if (e.reason === 'amaterasu' || e.eternal) {
            addRing(ix, iy, 'rgba(20,10,26,.9)', CELL * 1.1, 0.6);
            addRing(ix, iy, 'rgba(168,72,220,.9)', CELL * 0.8, 0.5);
            addSparks(ix, iy, 16, '#2a1030', 220);
            addSparks(ix, iy, 8, '#c070f0', 170);
            addCallout(ix, iy - (CELL + 10) / 2 - CELL * 0.34, '天照', '#c070f0');
          } else {
            addRing(ix, iy, 'rgba(255,140,50,.95)', CELL * 1.05, 0.55);
            addSparks(ix, iy, 14, '#ff9a3c', 210);
            addCallout(ix, iy - (CELL + 10) / 2 - CELL * 0.34, '灼烧', '#ff8a3c');
          }
        }
        break;
      }

      /* 灼烧的每秒一跳：一小撮火苗 + 一个独立的伤害数字（reason = burn）。
         ★ 数字走 addNum 而不是弹幕：玩家要看清"每秒掉多少"，
           这 5 跳的数字本身就是"5% 当前生命"这句话的证据。 */
      case 'laserburn': {
        var lu2 = pb.units[e.who];
        if (lu2) {
          lu2.hp = e.hpAfter;
          lu2.burnCurFlash = 1;
          addSparks(cellX(lu2), cellY(lu2), 3, '#ff9a3c', 90);
          addNum(cellX(lu2), cellY(lu2) - CELL * 0.30, String(Math.round(e.amount)),
                 'burn', 0.85);
        }
        break;
      }

      /* 被灼烧的人免疫冰冻 —— 挡下来必须看得见，
         否则玩家只看到"冰冻技能没生效"，那和 bug 长得一模一样。 */
      case 'immune': {
        var mu2 = pb.units[e.who];
        if (mu2) {
          var mx2 = cellX(mu2), my2 = cellY(mu2);
          addRing(mx2, my2, 'rgba(255,150,60,.95)', CELL * 0.95, 0.42);
          addSparks(mx2, my2, 8, '#ffb066', 150);
          addCallout(mx2, my2 - (CELL + 10) / 2 - CELL * 0.34, '免疫冰冻', '#ff8a3c');
        }
        break;
      }

      case 'ward': {        var wu = pb.units[e.who];
        if (wu) {
          wu.wardFlash = 1;
          var wx = cellX(wu), wy = cellY(wu);
          if (e.what === 'grant') {
            addRing(wx, wy, 'rgba(240,196,90,.9)', CELL * 0.8, 0.5);
            addSparks(wx, wy, 10, '#ffe9a8', 170);
          } else {
            addRing(wx, wy, 'rgba(255,236,160,.95)', CELL * 0.95, 0.4);
            addSparks(wx, wy, 8, '#fff2c4', 150);
            addCallout(wx, wy - (CELL + 10) / 2 - CELL * 0.34, '免疫', '#ffd24d');
          }
        }
        break;
      }

      /* ★★ 钟离 3 星「天星」：一颗陨石砸下来。
       *
       *   三件事按时间顺序演：先在天上画一个拖着火的石头往下坠（0.35 秒），
       *   落地那一下是土黄的冲击环 + 碎渣 + 屏幕一震，最后原地留一圈裂纹。
       *   ★ 落点和半径都从事件里读（e.r / e.c / e.radius），渲染层不自己算 ——
       *     "砸哪里"是规则层的决定，画面只是把它画出来。
       *   ★ 陨石**从上方斜着砸进来**，不是凭空在格子里炸一下：
       *     那是"陨石"和"手雷"的区别。 */
      case 'meteor': {
        var mx = e.c * PITCH + CELL / 2, my = e.r * PITCH + CELL / 2;
        /* ★★ 2026-10：陨石事件自己也可能带着台词（钟离 3★ 的「天动万象」）。
         *   实测：这一句在事件流里出现了两次（一次挂在 cast、一次挂在 meteor），
         *   但屏幕上**一次都没出现** —— 因为 meteor 分支原来只画石头，
         *   完全没看 e.callout。台词是"这一刻发生了什么"的唯一解释，
         *   任何一个带台词的事件分支都不能漏。 */
        if (e.callout) addCallout(mx, my - (CELL + 10) / 2 - CELL * 0.34, e.callout, '#d8c08a');
        if (e.shout) addCallout(mx, my - (CELL + 10) / 2 - CELL * 0.34, e.shout, '#d8c08a');
        addMeteor(mx, my, CELL * (e.radius * 2 + 1), e.dur);
        addShake(14);
        addRing(mx, my, 'rgba(206,164,86,.95)', CELL * (e.radius * 2 + 1) * 0.62, 0.6);
        addRing(mx, my, 'rgba(255,226,160,.85)', CELL * (e.radius * 2 + 1) * 0.36, 0.4);
        addSparks(mx, my, 26, '#c9a86a', 260);
        addSparks(mx, my, 12, '#ffe0a0', 200);
        break;
      }

      /* ★ 荣誉的蓄力：两只眼睛喷金色激光。
       *
       *   眼睛的位置是**估**出来的 —— 立绘是一张方形照片，没有眼睛坐标。
       *   取卡面上方三分之一、左右各偏 16% 卡宽：竖版人物立绘的头基本都在那儿，
       *   对荣誉这张实测是准的。以后换立绘如果眼睛位置差得多，改这两个系数就行。
       *
       *   激光指向**目标当时的位置**（蓄力开始时锁定）。
       *   目标这 0.5 秒里走开的话激光不会跟着拐弯 —— 那反而像"锁定"的感觉，
       *   而且规则层本来也是在开枪那一刻才重新选目标的，两边行为一致。 */
      case 'charge': {
        var cu = pb.units[e.who];
        if (cu) {
          var ccx = cellX(cu), ccy = cellY(cu);
          var chh = CELL + 10, cww = CELL + 6;
          var eyeY = ccy - chh / 2 + chh * 0.34;
          var eyeDx = cww * 0.16;
          var tgt2 = e.to ? pb.units[e.to] : null;
          var ax = tgt2 ? cellX(tgt2) : ccx;
          var ay = tgt2 ? cellY(tgt2) : (ccy - CELL);
          addEyeLaser(ccx - eyeDx, eyeY, ax, ay, e.dur);
          addEyeLaser(ccx + eyeDx, eyeY, ax, ay, e.dur);
        }
        break;
      }

      /* ★ 「抓娃娃」：这一下被完全挡下来了。
       *
       *   表现上要一眼看出「打不动它」：
       *   一圈青色护盾环 + 一小撮火星 + 一个「挡」字飘出来，
       *   而且卡片上的 🛡N 会闪一下、数字 -1。
       *
       *   ★ 这里**没有任何伤害数字**，因为这一下真的一分血都没掉 ——
       *     光有特效、血照扣，是这个机制最容易出的假动作；
       *     规则层是靠「block 事件 + 0 伤害 + 血条不动」三件事一起保证的。 */
      case 'block': {
        var bu2 = pb.units[e.who];
        if (bu2) {
          bu2.guardLeft = e.left;
          bu2.guardFlash = 1;
          var bx2 = cellX(bu2), by2 = cellY(bu2);
          addRing(bx2, by2, 'rgba(126,240,216,.9)', CELL * 0.78, 0.40);
          addRing(bx2, by2, 'rgba(255,255,255,.75)', CELL * 0.46, 0.28);
          addSparks(bx2, by2, 7, '#8fd8f0', 165);
          addNum(bx2, by2 - CELL * 0.46, '挡', 'guardClang', 0.92);
        }
        break;
      }

      /* ★ 张雪峰「超频」：每次普攻叠攻速，越过阈值那一下开始自毁。
       *
       *   表现上分两段：
       *     · 平时只是卡片上的 ⚡+N% 往上跳
       *     · **越过阈值那一瞬间**弹一句台词「你快不过我你信吗」+ 一圈红环 ——
       *       这是这一整套被动里最重要的一个信号：从现在起他在烧自己的血。
       *       不喊出来的话，玩家只会看到自己的血莫名其妙往下掉。 */
      case 'ocas': {
        var ou2 = pb.units[e.who];
        if (ou2) {
          ou2.oc = e.pct;
          ou2.ocFlash = 1;
          if (e.justOver) {
            ou2.ocOver = true;
            ou2.ocOverFlash = 1;
            addRing(cellX(ou2), cellY(ou2), 'rgba(255,90,70,.95)', CELL * 1.5, 0.55);
            addSparks(cellX(ou2), cellY(ou2), 18, '#ff6a4a', 260);
            /* ★★ 喊的是**一句台词**「你跑不过我你信吗」——
               这是用户指定的（和被动名「你快不过我你信吗」故意差一个字：
               那句是名字，这句是他真的喊出来的话）。
               ★ 这一段之前喊的是状态名「狂暴！」：状态名对玩家没有信息量
                 （卡片上已经有一枚变红的 🔥 徽章在说这件事），
                 而一句台词能让人记住"是谁、什么时候开始不要命的"。 */
            addCallout(cellX(ou2), cellY(ou2) - (CELL + 10) / 2 - CELL * 0.34,
                       ou2.ocBerserkShout || '你跑不过我你信吗', '#ff6a4a');
            addShake(8);
            pb.hitstop = 0.08;
          }
          /* ★ 顶到上限：加一圈金色收束环 + 一条独立提示。
             没有这个的话玩家只会看到徽章数字"不动了"，
             会以为卡住了或者以为是 bug。 */
          if (e.capped) {
            ou2.ocCapped = true;
            addRing(cellX(ou2), cellY(ou2), 'rgba(255,214,120,.9)', CELL * 1.25, 0.4);
            addCallout(cellX(ou2), cellY(ou2) - (CELL + 10) / 2 - CELL * 0.34,
                       '攻速满 ' + Math.round(e.pct * 100) + '%', '#ffd98a');
          }
        }
        break;
      }

      /* ★ 自燃：两种来源（张雪峰的超频 / 「和成天下5000精品大果」），
         表现共用一套 —— 玩家看到的都是"血量自己在往下掉"。
         ★ 只把**颜色和火星**分开：超频是红橙（火在烧自己），
           果子是暖褐+果壳色（嘴里的东西在发作），混战中能看出不是同一件事。 */
      case 'selfburn': {
        var su3 = pb.units[e.who];
        if (su3) {
          su3.hp = e.hpAfter;
          su3.ocBurnFlash = 1;
          su3.burnFlash = 1;
          su3.flash = 0.6;
          var byItem = e.reason === 'item';
          addNum(cellX(su3), cellY(su3) - CELL * 0.42, '-' + Math.round(e.amount),
                 'selfBurn', 1.05);
          addSparks(cellX(su3), cellY(su3), byItem ? 4 : 5,
                    byItem ? '#c98a4b' : '#ff6a4a', byItem ? 90 : 120);
        }
        break;
      }

      /* ★ 「巧乐兹」的冰棍：一层一个冰蓝小环，层数记在卡片上。
         满层冰冻走的是下面那条 stun（reason='freeze'）。 */
      case 'chill': {
        var cu3 = pb.units[e.to];
        if (cu3) {
          cu3.chill = e.stacks;
          cu3.chillMax = e.max;
          cu3.chillFlash = 1;
          addRing(cellX(cu3), cellY(cu3), 'rgba(150,220,255,.85)', CELL * 0.5, 0.32);
          addSparks(cellX(cu3), cellY(cu3), 4, '#b6e6ff', 110);
        }
        break;
      }

      /* ★ 奶龙「捧腹大笑」：给自己开一段 3 秒的肉盾窗口。
       *
       *   要让人一眼看出"它现在打不动"：
       *   金色大笑环 + 台词 + 卡片上一枚 😂 徽章（常驻到笑完）；
       *   ★★ 另外还有一套**会持续 3 秒的飘字**（😂 一颗颗往上冒）——
       *      光环和台词都是"一瞬间"的，而这个状态要挂 3 秒。
       *      只放一帧特效的话，玩家看到字飘走之后仍然不知道
       *      "这 3 秒它到底在干嘛"。飘字由 updateLaughFx 每 0.28 秒补一颗，
       *      起手这里先给一撮密的，让它"砰"地开始。
       *   ★ 减伤和回血都**没有**单独的特效 ——
       *     减伤本该表现为"伤害数字变小"，回血本来就有绿色的 +N。
       *     再给它们各加一套特效，画面上就全是光了。 */
      case 'laugh': {
        var gu2 = pb.units[e.who];
        if (gu2) {
          gu2.laughUntil = e.until;
          gu2.laughFlash = 1;
          gu2.laughMove = !!e.move;
          gu2.laughAlly = !!e.allyHeal;
          /* ★ 冷却从**放技能这一刻**重新开始。
             battle.js 里 cdAcc 也是在 castSkill 里清零的，
             两边同一个锚点，条子才会和真正能再放的时间对上。 */
          gu2.cdT = state.t;
          gu2.mana = 0;
          gu2.laughFxAt = 0;              // 飘字的下一颗：立刻开始
          var lx = cellX(gu2), ly = cellY(gu2);
          addRing(lx, ly, 'rgba(255,206,86,.95)', CELL * (e.allyHeal ? 1.6 : 1.0), 0.55);
          addRing(lx, ly, 'rgba(255,240,190,.9)', CELL * 0.62, 0.34);
          addSparks(lx, ly, 12, '#ffd66e', 190);
          addGiggle(lx, ly - CELL * 0.18, 7, '😂', '#ffce56', CELL * 1.1);
          addCallout(lx, ly - (CELL + 10) / 2 - CELL * 0.34, '捧腹大笑', '#ffce56');
          if (e.allyHeal) {
            addRing(lx, ly, 'rgba(150,235,170,.9)', CELL * 2.4, 0.7);
            addSparks(lx, ly, 10, '#9cebaf', 200);
          }
          addShake(5);
        }
        break;
      }

      case 'cast':
        u = pb.units[e.from];
        if (u) {
          u.mana = 0;
          addRing(cellX(u), cellY(u), 'rgba(130,110,200,.85)', CELL * 1.15, 0.5);
          addSparks(cellX(u), cellY(u), 7, '#8d7ad4', 140);
          addShake(2.5);
          /* ★ 羊帆「羊巅峰」：技能只做一件事 —— 给下一次普攻蓄势。
             所以这里把「已蓄势」记在卡片上，会常驻显示一枚 🐑×20 徽章，
             一直到那一下真的打出去（attack 事件的 peak 标记）才消失。
             ★ 蓄势状态**必须常驻可见**：20 倍伤害是这个角色一整局的高光，
               玩家如果看不到"现在这一发是大的"，只会觉得伤害数字乱跳。 */
          if (e.kind === 'peak') {
            u.peakReady = true;
            addRing(cellX(u), cellY(u), 'rgba(255,210,90,.9)', CELL * 0.9, 0.5);
            addSparks(cellX(u), cellY(u), 10, '#ffd24d', 170);
          }
          /* ★ 技能喊话：数据里写了 callout 就弹（牢大的「Man！」、羊帆的「羊巅峰」）。
             渲染层不需要知道是哪个技能 —— 想喊什么由 units.js 决定。 */
          if (e.callout) {
            addCallout(cellX(u), cellY(u) - (CELL + 10) / 2 - CELL * 0.34,
                       e.callout, '#ffd24d');
          }
        }
        break;

      /* ★ 牢大「坠机」的三段演出。
       *
       *   ① down   倒下了，但还没落地 —— 画一个不稳定的阴影/火星，
       *             让玩家知道「这还没完」（那 1 秒里它是不参与胜负的）
       *   ② crash  直升机砸下来的那一下：一整块 3×3 的爆炸
       *   ③ revive 从残骸里站起来：金色光柱 + 扩散环
       *
       *   ★ 这三段的时间关系是**规则保证**的（CFG.CRASH_DELAY / CRASH_RADIUS），
       *     渲染层照抄事件里的 r/c/radius，不自己算范围 ——
       *     画出来的圈和真正挨打的那九格永远是同一个。 */
      case 'down': {
        var du = pb.units[e.who];
        if (du) {
          /* ★★ 这里有两种完全不同的"倒下之后还有一下"：
           *     坠机（牢大）  一架直升机从画面顶上砸下来 —— addStrike
           *     自爆（羊帆）  它**自己**在原地蓄力炸开，天上什么都没有 —— addCharge
           *   画成一样的话，玩家会以为羊帆也在召唤直升机。
           *   判据就是事件里的 `boom`，渲染层不猜。 */
          if (e.boom) {
            addRing(cellX(du), cellY(du), 'rgba(255,110,60,.9)', CELL * 0.9, 0.55);
            addSparks(cellX(du), cellY(du), 10, '#ff7a3c', 150);
            addCharge(cellX(du), cellY(du), e.delay);
          } else {
            addRing(cellX(du), cellY(du), 'rgba(210,120,60,.85)', CELL * 0.7, 0.5);
            addSparks(cellX(du), cellY(du), 8, '#c8703c', 120);
            // 落下中的直升机：一条从画面顶端落向这一格的残影
            addStrike(cellX(du), cellY(du), e.delay, !!e.revive);
          }
        }
        break;
      }

      case 'crash': {
        var cx2 = e.c * PITCH + CELL / 2, cy2 = e.r * PITCH + CELL / 2;
        addBlast(cx2, cy2, CELL * (e.radius + 0.5), CELL * (e.radius + 1.6));
        addSparks(cx2, cy2, 34, '#ffb066', 420);
        addSparks(cx2, cy2, 18, '#ffe9a8', 260);
        addSparks(cx2, cy2, 12, '#8d7f70', 180);
        if (e.boom) {
          // 自爆：金红双环代替直升机那种土色烟尘，一眼能分开两件事
          addRing(cx2, cy2, 'rgba(255,120,60,.95)', CELL * (e.radius + 1.1), 0.6);
          addRing(cx2, cy2, 'rgba(255,220,120,.9)', CELL * (e.radius + 1.5), 0.45);
          if (e.stun > 0) addCallout(cx2, cy2 - CELL * 0.9, '巅峰谢幕', '#ffd24d');
        }
        addShake(15);
        pb.hitstop = 0.16;
        break;
      }

      case 'revive': {
        var ru = pb.units[e.who];
        if (ru) {
          ru.alive = true; ru.hp = e.hp; ru.shield = 0;
          ru.r = e.r; ru.c = e.c; ru.rr = e.r; ru.cc = e.c;
          ru.flash = 1;
          addPillar(cellX(ru), cellY(ru));
          addRing(cellX(ru), cellY(ru), 'rgba(255,214,110,.95)', CELL * 1.7, 0.6);
          addSparks(cellX(ru), cellY(ru), 20, '#ffd66e', 220);
          addCallout(cellX(ru), cellY(ru) - (CELL + 10) / 2 - CELL * 0.34,
                     '我回来了', '#ffd24d');
          addShake(9);
        }
        break;
      }

      /* ★ 老牧师「临终祷告」的开始：**人还没起来**。
         ★★ 这一条必须和 reviveAlly 分开画，否则玩家看到的顺序就错了：
            先亮一圈光、1 秒后才站起来 —— 那 1 秒是"还有救"的信号，
            也是这张卡唯一一个能让对手"眼睁睁看着"的窗口。
         ★ 用的是金色，和"阵亡"的暗红、牢大坠机的土色都分得开。 */
      case 'lastRites': {
        var lu = pb.units[e.to];
        var lp = pb.units[e.from];
        if (lu) {
          /* ★ 环的 life 直接取祷告时长（e.delay）——
             "光消失的那一帧人正好站起来"是**规则对齐**的，
             不是渲染层自己挑了一个好看的时长（和荣誉的蓄力激光同一个约定）。 */
          addRing(cellX(lu), cellY(lu), 'rgba(255,226,150,.9)', CELL * 0.9, e.delay);
          addSparks(cellX(lu), cellY(lu), 12, '#ffe9a8', 90);
          addCallout(cellX(lu), cellY(lu) - (CELL + 10) / 2 - CELL * 0.34,
                     '还能抢救一下', '#ffd24d');
        }
        /* 一条从牧师连到尸体的金色光束 —— "是谁在救他"必须一眼看出来，
           不然场上两个辅助的话根本分不清被动是哪个人的。 */
        if (lu && lp) {
          addBeam(cellX(lp), cellY(lp) - CELL * 0.3, cellX(lu), cellY(lu), '#ffe2a0', e.delay);
          lp.flash = 0.8;
        }
        break;
      }

      /* ★ 老牧师「临终祷告」的结算：人站起来了（3 星的话顺手给了 buff）。
         ★ 和牢大的 revive 分开写：牢大是"坠机之后自己爬起来"（土色烟尘），
           这一条是"别人把他拉回来"（金色圣光），画面语言必须不一样。 */
      case 'reviveAlly': {
        var au = pb.units[e.who];
        if (au) {
          if (e.ok) {
            au.alive = true; au.hp = e.hp; au.shield = 0;
            au.r = e.r; au.c = e.c; au.rr = e.r; au.cc = e.c;
            au.flash = 1;
            addPillar(cellX(au), cellY(au));
            addRing(cellX(au), cellY(au), 'rgba(255,226,150,.95)', CELL * 1.8, 0.6);
            addSparks(cellX(au), cellY(au), 22, '#ffe9a8', 230);
            addCallout(cellX(au), cellY(au) - (CELL + 10) / 2 - CELL * 0.34,
                       '我回来了', '#ffd24d');
            addShake(8);
            /* 3 星「圣光赐福」：真的拿到 buff 的人身上各加一圈金环，
               顺带在牧师那边也亮一下 —— "两个人都变强了"要靠画面说清。 */
            if (e.blessed && e.blessed.length) {
              for (var bi = 0; bi < e.blessed.length; bi++) {
                var bu = pb.units[e.blessed[bi]];
                if (!bu) continue;
                addRing(cellX(bu), cellY(bu), 'rgba(255,214,120,.95)', CELL * 1.15, 0.5);
                addSparks(cellX(bu), cellY(bu), 8, '#ffe9a8', 120);
              }
              addCallout(cellX(au), cellY(au) - (CELL + 10) / 2 - CELL * 0.34 - CELL * 0.42,
                         '圣光赐福 +' + Math.round((e.adPct || 0) * 100) + '%', '#ffd24d');
            }
          } else {
            /* 救不回来：灰掉的一小圈，别让玩家以为"什么都没发生" */
            addRing(cellX(au), cellY(au), 'rgba(150,140,120,.7)', CELL * 0.8, 0.45);
            addCallout(cellX(au), cellY(au) - (CELL + 10) / 2 - CELL * 0.34,
                       '救不回来了', '#a89c86');
          }
        }
        break;
      }

      /* ★★ 孙笑川 3 星「安排上了」：被打死的敌人**倒戈**成我方单位。
       *
       *   ★ 渲染层必须跟着做三件事，少一件画面上就是错的：
       *     ① `side` 真的换掉 —— 否则它还会被当成敌人（渐显、阵营色都错）；
       *     ② `converted = true` —— 卡面变灰，一眼看出"这不是我原本的人"；
       *     ③ 一撮灰白火花 + 台词，让"它换边了"这件事被看到。
       *   ★ 位置直接读事件里的 r/c，不自己算 freeCellNear ——
       *     规则层已经决定了它站在哪，渲染层重算只会算出别的格子。 */
      case 'convert': {
        var cu = pb.units[e.who];
        if (cu) {
          cu.side = e.toSide;
          cu.converted = true;
          cu.alive = true; cu.hp = e.hp; cu.shield = 0;
          cu.r = e.r; cu.c = e.c; cu.rr = e.r; cu.cc = e.c;
          cu.flash = 1;
          cu.target = null;
          addRing(cellX(cu), cellY(cu), 'rgba(206,214,206,.95)', CELL * 1.7, 0.6);
          addSparks(cellX(cu), cellY(cu), 20, '#cfd6cf', 220);
          addPillar(cellX(cu), cellY(cu));
          addCallout(cellX(cu), cellY(cu) - (CELL + 10) / 2 - CELL * 0.34,
                     '安排上了', '#b9c4b9');
          addShake(9);
        }
        break;
      }

      /* ★★ 电棍「导电」：电流的出生 / 弹射 / 消散。
       *
       *   ★ 三种情形共用这一个事件类型，靠 born / fizzle 区分：
       *       born   在被打中的人身上放一颗电球（它要**停 0.5 秒**才跳）
       *       跳     从上一格拉一道锯齿闪电到新目标，并在新目标上再放一颗
       *       fizzle 没地方跳了 → 散掉（**不画闪电**，只抹掉计数）
       *   ★ `curN` 是"这个电棍现在挂着几条电流"，画成常驻徽章：
       *     3 星的「三相电」就是"同时最多 3 条"，玩家得能看出现在有几条。
       */
      case 'current': {
        var own = pb.units[e.from];
        if (e.born) {
          if (own) own.curN = (own.curN || 0) + 1;
          addCurrentNode(cellX(pb.units[e.to] || { r: e.r, c: e.c }),
                         cellY(pb.units[e.to] || { r: e.r, c: e.c }), e.delay);
          addSparks(cellX(pb.units[e.to] || { r: e.r, c: e.c }),
                    cellY(pb.units[e.to] || { r: e.r, c: e.c }), 6, '#8fd0ff', 90);
        } else if (e.fizzle) {
          if (own) own.curN = Math.max(0, (own.curN || 1) - 1);
        } else {
          /* 弹射：从 (fromR,fromC) 拉到 (r,c) —— 两端都用自己的格子算屏幕坐标，
             不依赖单位的当前渲染位置，所以"人刚走开"也不会把闪电画歪。 */
          var ax1 = e.fromC * PITCH + CELL / 2, ay1 = e.fromR * PITCH + CELL / 2;
          var ax2 = e.c * PITCH + CELL / 2, ay2 = e.r * PITCH + CELL / 2;
          addArc(ax1, ay1, ax2, ay2);
          addSparks(ax2, ay2, 10, '#bfe4ff', 150);
          addRing(ax2, ay2, 'rgba(150,210,255,.85)', CELL * 0.75, 0.35);
          // 还有下一跳 → 在新目标身上再放一颗电球
          if (e.left > 0) addCurrentNode(ax2, ay2, e.delay);
          else if (own) own.curN = Math.max(0, (own.curN || 1) - 1);
          if (e.stunned) addMote(ax2, ay2 - CELL * 0.34, '💫', '#ffd98a', 1, 0.6);
        }
        break;
      }

      /* 肘击的击退：被推的人沿单轴滑出去（走的是同一个 rr/cc 插值，
         所以画面上就是"被打飞一段"，不需要单独写动画）。 */
      case 'knockback': {
        var ku = pb.units[e.to];
        if (ku) {
          ku.r = e.r; ku.c = e.c;
          addSparks(cellX(ku), cellY(ku), 8, '#ffd9a8', 160);
          addRing(cellX(ku), cellY(ku), 'rgba(255,190,120,.8)', CELL * 0.6, 0.4);
        }
        break;
      }

      /* ★★ Dank1ng「先过中门再谈未来」的击杀后续：骷髅 + 耍刀。
       *
       *   两个事件是成对出现的（同一个 tick、同一个受害者），所以画在一起：
       *   骷髅钉在尸体那一格（"这里死过人"），它自己开始转刀（"这 3 秒不打了"）。
       *
       *   ★ 位置不能从 pb.units[e.to] 读 —— 目标已经阵亡，卡片只是还留在
       *     画面里（drawCorpse）；而事件里带了 r/c，直接用最准。
       */
      case 'skull': {
        var skx = e.c * PITCH + CELL / 2, sky = e.r * PITCH + CELL / 2;
        addSkull(skx, sky);
        addSparks(skx, sky, 8, '#c9d6de', 130);
        break;
      }

      case 'knife': {
        var kfe = pb.units[e.who];
        if (kfe) {
          kfe.knifeUntil = e.until;
          kfe.knifeFlash = 1;
          addKnife(cellX(kfe), cellY(kfe), e.dur);
          addRing(cellX(kfe), cellY(kfe), 'rgba(210,228,255,.9)', CELL * 1.1, 0.45);
          addShake(4);
        }
        break;
      }

      /* ★★ 「空悲切」：队友全部阵亡的那一刻，Dank1ng 的法力条永远满格。
       *   这是它的**绝境被动**，必须有一个响亮的信号 ——
       *   否则玩家只会看到"它怎么突然一秒一发了"。
       *   ★ 关的时候（队友被复活）也要给一个信号：这个状态是双向的。 */
      case 'endless': {
        var eu = pb.units[e.who];
        if (eu) {
          eu.endless = !!e.on;
          eu.mana = e.mana;
          eu.flash = 1;
          var ex2 = cellX(eu), ey2 = cellY(eu);
          if (e.on) {
            addRing(ex2, ey2, 'rgba(190,60,70,.95)', CELL * 1.8, 0.7);
            addRing(ex2, ey2, 'rgba(255,180,140,.9)', CELL * 1.0, 0.5);
            addSparks(ex2, ey2, 20, '#e0745c', 260);
            addCallout(ex2, ey2 - (CELL + 10) / 2 - CELL * 0.34, '空悲切', '#ff9a7a');
            addShake(8);
          } else {
            addRing(ex2, ey2, 'rgba(150,170,190,.75)', CELL * 1.2, 0.5);
          }
        }
        break;
      }

      /* ★ 「锁头」：击杀之后法力条瞬间回满。
         只闪一下条子 + 一小撮火星 —— 它是个高频的"续上"动作，
         做成大特效会把真正的大事（骷髅 / 空悲切）盖掉。 */
      case 'refill': {
        var rfu = pb.units[e.who];
        if (rfu) {
          rfu.mana = e.mana;
          rfu.manaFlash = 1;
          addSparks(cellX(rfu), cellY(rfu), 5, '#ffd98a', 120);
        }
        break;
      }

      /* ★★ 楚生疑犯「阴暗领域」：一片**留在场上的地形**。
       *
       *   这是渲染层第一次遇到"不属于任何单位"的持续效果 ——
       *   以前所有"挂几秒"的东西都画在单位身上（徽章、描边、光环），
       *   单位一死就跟着没了。领域反过来：施法者死了、走开了、被推走了，
       *   雨照样下，站在里面的人照样减半。
       *
       *   ★ 所以它只能记一份自己的列表（pb.fields），按 until 过期 ——
       *     和 buffUntil / laughUntil 是同一套约定：不需要"结束"事件，
       *     每帧读的时候比一次时间就行（见 step 里的过滤）。
       *   ★ 半径/时长/减速比例全部照抄事件，渲染层**不自己算范围** ——
       *     画出来的那片黑和真正被减速的格子永远是同一个。
       */
      case 'field': {
        pb.fields.push({
          id: e.id, r: e.r, c: e.c, radius: e.radius,
          until: e.until, side: e.side, asCut: e.asCut, allyCut: e.allyCut,
          born: state.t
        });
        var fx2 = e.c * PITCH + CELL / 2, fy2 = e.r * PITCH + CELL / 2;
        addRing(fx2, fy2, 'rgba(60,74,92,.95)', CELL * (e.radius + 0.6), 0.7);
        addRing(fx2, fy2, 'rgba(150,170,200,.7)', CELL * (e.radius + 1.1), 0.55);
        addSparks(fx2, fy2, 16, '#7d92b0', 220);
        addCallout(fx2, fy2 - CELL * 0.9, '阴暗领域', '#9fb6d4');
        addShake(6);
        break;
      }

      /* ★ 楚生疑犯 3 星的「遁入暗影」：开 / 关两个方向都要有表现。
       *   ★ 开的瞬间是一圈向内收的暗色环 + 台词；关的时候是一条冷色外环（现形）。
       *     这两个时刻玩家必须看得见 —— 因为暗影期间它既打不死也不会被打，
       *     状态读不出来就变成了"这个单位怎么没血条了"。 */
      case 'shadow': {
        var shu = pb.units[e.who];
        if (shu) {
          shu.shadow = !!e.on;
          shu.flash = 1;
          var sx = cellX(shu), sy = cellY(shu);
          if (e.on) {
            addRing(sx, sy, 'rgba(40,48,66,.95)', CELL * 1.5, 0.6);
            addRing(sx, sy, 'rgba(120,140,180,.8)', CELL * 0.8, 0.45);
            addSparks(sx, sy, 18, '#6c7ea0', 240);
            addCallout(sx, sy - (CELL + 10) / 2 - CELL * 0.34, '遁入暗影', '#9fb6d4');
            addShake(7);
          } else {
            addRing(sx, sy, 'rgba(200,220,255,.95)', CELL * 1.7, 0.6);
            addSparks(sx, sy, 16, '#c8dcff', 230);
            addCallout(sx, sy - (CELL + 10) / 2 - CELL * 0.34, '现形', '#c8dcff');
            addShake(7);
          }
        }
        break;
      }

      /* ★ 荣誉「狙击1」：命中喊 Vamos，没命中喊 Kale。
       *
       *   喊话挂在**开枪的人自己**的卡牌上方（这是它的台词，不是受击反馈），
       *   子弹则永远是「从自己飞向目标」——
       *   命中就在目标身上炸开，没命中就飞过去消失在画面外。
       *
       *   判定本身（20% / 星级保底）全在模拟器里，这一层只负责表达：
       *   玩家不该靠读日志才知道这一枪有没有中。
       *
       *   ★ 2026-10 加强：曳光弹加粗到 26px 光晕，另加一圈**枪口闪光**
       *     （不然混战里看不出这一枪是谁开的），命中的爆点也整体放大了一倍。 */
      case 'snipe': {
        var su = pb.units[e.from], st2 = pb.units[e.to];
        if (su) {
          var hitCol = e.hit ? (e.sure ? '#7ef0d8' : '#ffe07a') : '#9fb0bd';
          var sx = cellX(su), sy = cellY(su);
          addMuzzle(sx, sy, hitCol);
          if (st2) addTracer(sx, sy, cellX(st2), cellY(st2),
                             hitCol, e.hit ? 0 : CELL * 2.2);
          else addTracer(sx, sy, sx, sy - CELL * 2, hitCol, 0);
          /* 喊话挂在卡牌**上方**：卡牌半高 + 一个字号的高度。
             保底命中的那几发换个色（青），让「这发是运，不是运气」看得出来。 */
          addCallout(sx, sy - (CELL + 10) / 2 - CELL * 0.34,
                     e.hit ? 'Vamos' : 'Kale', hitCol);
          if (e.hit && st2) {
            addSparks(cellX(st2), cellY(st2), 22, '#ffe9a8', 300);
            addSparks(cellX(st2), cellY(st2), 10, '#ffffff', 190);
            addRing(cellX(st2), cellY(st2), 'rgba(255,233,168,.95)', CELL * 1.5, 0.42);
            addRing(cellX(st2), cellY(st2), 'rgba(255,255,255,.9)', CELL * 0.85, 0.30);
            addShake(11);
            pb.hitstop = 0.10;              // 命中就顿帧 —— 20% 的爽点必须给足
          } else if (!e.hit && st2) {
            // 打偏也要有存在感：目标旁边一小撮「擦过去」的灰白色气流
            addSparks(cellX(st2), cellY(st2), 6, '#9fb0bd', 130);
          }
        }
        break;
      }

      case 'stun':
        u = pb.units[e.to];
        if (u) {
          /* ★★ 两个来源走同一条 stun 事件，但**表现都是"冻住"**：
           *     `freeze` = 巧乐兹攒满 10 层换来的 3 秒硬控；
           *     `frost`  = 冰冰冰 2 星「冻手冻脚」技能附带的 1.5 秒。
           *   所以两者共用这一套冰系特效（冰环 + 白环 + 冰渣 + 「冰冻」字样）。
           *   ★ 但**只有满层那个清空冰棍层数** —— 技能冰冻和冰棍是两条规则，
           *     顺手清一下的话，"3 星巧乐兹 + 冰冰冰"这种组合会把层数白吃掉。 */
          var isFreeze = (e.reason === 'freeze' || e.reason === 'frost');
          var isPetrify = (e.reason === 'petrify');
          if (isPetrify) {
            /* ★★ 钟离「天星」的石化：**石头**，不是闪电也不是冰块。
             *   一套完全不同的三件套 ——
             *     ① 一圈土黄的裂纹环（砸下来的那一格）
             *     ② 灰褐色的碎渣（石头崩起来）
             *     ③ 头顶一个「石化」字样 + 卡片整体压成石灰色
             *   ★ `petrifyUntil` 记在卡片上，所以这 3 秒里**一直**是灰的 ——
             *     "现在动不了"和"刚刚被砸了一下"是两件事，
             *     只放一串粒子的话，玩家看不出它还在僵着。
             */
            u.petrifyUntil = e.until;
            u.petrifyFlash = 1;
            addRing(cellX(u), cellY(u), 'rgba(176,148,96,.95)', CELL * 1.1, 0.55);
            addSparks(cellX(u), cellY(u), 14, '#b08a52', 200);
            addCallout(cellX(u), cellY(u) - (CELL + 10) / 2 - CELL * 0.34,
                       '石化', '#c9a86a');
          } else if (isFreeze) {
            if (e.reason === 'freeze') u.chill = 0;   // 层数被清空
            addRing(cellX(u), cellY(u), 'rgba(150,220,255,.95)', CELL * 1.15, 0.55);
            addRing(cellX(u), cellY(u), 'rgba(255,255,255,.9)', CELL * 0.7, 0.4);
            addSparks(cellX(u), cellY(u), 16, '#cdeeff', 220);
            addCallout(cellX(u), cellY(u) - (CELL + 10) / 2 - CELL * 0.34,
                       '冰冻', '#8fd8f0');
            addShake(7);
          } else {
            /* ★★ 嘉豪「男人领域」：被控住的人**头顶冒「哈哈」** ——
             *   和奶龙「捧腹大笑」用的是同一套 Mote 特效（只是换字换色）。
             *   一个被"领域"控住的人正在大笑，这件事不用解释，
             *   画面上飘几声哈哈就讲明白了。
             *
             *   ★ 为什么这里连时长都不用看：眩晕的表现就是"现在动不了"，
             *     飘字是**一次性**的起手特效（一次施法冒一撮），
             *     不是持续状态 —— 和奶龙那 3 秒的连续飘字是两件事。
             *     3 星的 2.4 秒从"卡片上挂着动弹不得"本身就能看出来。
             *
             *   ★ 一次控多个人时，每个人各自走一遍这里 —— 三条 stun 事件
             *     就是三撮哈哈，谁被控住了看得一清二楚。 */
            var sx = cellX(u), sy = cellY(u);
            addRing(sx, sy, 'rgba(230,180,60,.85)', CELL * 0.72, 0.5);
            addRing(sx, sy, 'rgba(255,236,180,.75)', CELL * 0.44, 0.30);
            addSparks(sx, sy, 6, '#f0c46a', 150);
            addGiggle(sx, sy - CELL * 0.16, e.count > 1 ? 3 : 2, '哈哈', '#ffd98a',
                      CELL * 0.6);
          }
        }
        /* ★★ 这一行以前是**漏掉**的（别的 case 都有，只有 stun 没有）。
         *   后果很隐蔽：`A.onEvent` 是渲染层把事件转给外面（战报 ticker、
         *   音效、以及自检）的唯一出口 —— 少了这一步，
         *   **所有眩晕都不会出现在战报里**，而 `describeEvent` 里那几个
         *   stun 分支（巧乐兹冰冻 / 男人领域 / 羊巅峰）全成了死代码。
         *   ★ 是「冰冰冰技能冰冻」那条自检把它照出来的：
         *     规则完全正确，只是"回调一次都没被叫过"。 */
        break;

      /* ★ 星级被动「越打越快」。
       *
       *   规则不在这一层 —— 这里只是把「现在叠到多少了」记在单位身上，
       *   卡片右下角会画一个小小的 ⚡+35%，并且每叠一层闪一下。
       *
       *   为什么非要画出来：这是个**只涨不跌**的成长，
       *   但玩家如果看不到数字，只会觉得「好像打得快了一点」，
       *   完全感受不到「我把一个 1 费卡养到 3 星、它现在攻速是 3 倍」这件事。
       *   数值全在模拟器里，可见性是这一层的责任。 */
      case 'frenzy':
        u = pb.units[e.who];
        if (u) {
          u.frenzy = e.pct;
          u.frenzyFlash = 1;                       // 闪一下，表示又叠了一层
          if (e.capped && !u.frenzyCapped) {
            u.frenzyCapped = true;                   // 到上限只在第一次给个环
            addRing(cellX(u), cellY(u), 'rgba(230,150,40,.9)', CELL * 0.85, 0.5);
          }
        }
        break;

      /* ★ 星级被动「幻觉 / 开智」：豆包奶完一口，被奶的人身上多一个伤害改动。
       *
       *   正负两种结果用**冷暖两色**分开：增伤是金色，减伤是紫的。
       *   玩家不需要看懂数字，看颜色就知道这一口奶是帮了还是坑了 ——
       *   这正是「幻觉」这个被动要传达的东西。
       *
       *   卡片左上角另外有一个持续显示的 ↑+20% / ↓-20% 徽章（见 drawUnit），
       *   因为这一下的特效是瞬时的，而效果要挂 4 秒。 */
      case 'gift': {
        u = pb.units[e.to];
        if (u) {
          u.buffMul = e.mul;
          u.buffUntil = e.until;
          u.buffFlash = 1;
          var gx = cellX(u), gy = cellY(u);
          addRing(gx, gy, e.good ? 'rgba(255,214,110,.85)' : 'rgba(178,124,224,.85)',
                  CELL * 0.74, 0.45);
          addSparks(gx, gy, e.good ? 6 : 5, e.good ? '#ffd66e' : '#b27ce0', 130);
          addNum(gx, gy - CELL * 0.66, e.good ? '增伤' : '减伤',
                 e.good ? 'giftGood' : 'giftBad', 1);
        }
        break;
      }

      case 'death':
        u = pb.units[e.who];
        if (u) {
          u.alive = false; u.hp = 0; u.shield = 0;
          addRing(cellX(u), cellY(u), 'rgba(184,80,63,.85)', CELL * 1.5, 0.62);
          addSparks(cellX(u), cellY(u), 16, '#b8503f', 230);
          addSparks(cellX(u), cellY(u), 8, '#8a6a5a', 150);
          addShake(9);
          pb.hitstop = 0.075;            // 击杀顿帧，最有「重量」的一下
        }
        break;

      /* ★ 队友换位（被堵死的近战和前方队友交换位置）。
       *
       *   两个单位的 r/c 同时改掉，剩下的交给插值 ——
       *   rr/cc 是每帧朝 r/c 逼近的，所以画面上就是两张卡**互相错身滑过去**，
       *   不需要单独写动画。
       *   再各给一小撮灰蓝火花，让「他俩换了位置」这件事被注意到。 */
      case 'swap': {
        var ua = pb.units[e.a], ub = pb.units[e.b];
        if (ua) { ua.r = e.aR; ua.c = e.aC; ua.swaps = (ua.swaps || 0) + 1; }
        if (ub) { ub.r = e.bR; ub.c = e.bC; ub.swaps = (ub.swaps || 0) + 1; }
        if (ua && ub) {
          addSparks(cellX(ua), cellY(ua), 4, '#9fb4c4', 90);
          addSparks(cellX(ub), cellY(ub), 4, '#9fb4c4', 90);
        }
        break;
      }

      case 'snap':
        for (var i = 0; i < e.u.length; i++) {
          var row = e.u[i], uu = pb.units[row[0]];
          if (!uu) continue;
          uu.hp = row[1]; uu.shield = row[2]; uu.mana = row[3];
          uu.r = row[4]; uu.c = row[5]; uu.alive = !!row[6];
          /* ★ 第 8/9 位是后加的（招安：卡面变灰 + 换阵营）。
             不读它们的话，往后拖一下"灰卡"就没了、阵营也退回原来那一方。
             ★ 用 `!== undefined` 而不是直接读：万一碰到旧格式的快照，
               不能把 converted 清成 false、也不能把 side 改成 b。 */
          if (row[7] !== undefined) uu.converted = !!row[7];
          if (row[8] !== undefined) uu.side = row[8] ? 'a' : 'b';
        }
        break;

      case 'end':
        pb.playing = false;
        break;

      default:
        break;
    }

    /* ============================================================
     * ★★ 事件**统一在这里**转发给外面（战报 ticker / 音效 / 自检）。
     *
     *   原来是"哪个 case 想起来了就自己叫一次"，结果 30 个 case 里
     *   有 14 个忘了写 —— 那些事件规则全对、特效也画了，但
     *   **战报里永远不出现**，`game.js` 的 describeEvent 里对应的文案
     *   全成了死代码。而且这种漏一点都不显眼：玩家只会觉得
     *   "战报怎么这么稀"。
     *
     *   ★ 是「冰冰冰的技能冰冻」那条自检把它照出来的（它靠 onEvent
     *     回调精确对齐每一次冰冻，结果一次都没被叫到）。
     *   ★ 收成一处之后，新增事件类型**不可能**再漏 —— 除非有人
     *     特意在这里加过滤条件。
     *
     *   ★ `damage` 是唯一的例外：它和 attack / skill 是同一次结算的
     *     两个事件，两个都转发的话战报里同一件事会写两行。
     * ============================================================ */
    if (e.type !== 'damage' && A.onEvent) A.onEvent(e);
  }

  /* ============================================================
   * 主循环
   *
   * 时间推进刻意和 requestAnimationFrame 解耦：
   *   frame() 只负责「按真实时间算出 dt，然后交给 step(dt)」。
   * 这样有个很实际的好处 —— **无头浏览器不驱动 rAF**，
   * 但测试可以直接循环调 Arena.step(1/30) 把整场战斗推完，
   * 于是寻敌位移、伤害飘字、震屏这些全都能被自动验证，
   * 而不是只能靠肉眼看着「感觉差不多」。
   * ============================================================ */
  var peak = { fx: 0, shake: 0, t: 0 };
  A.peak = function () { return peak; };
  A.resetPeak = function () { peak.fx = 0; peak.shake = 0; peak.t = 0; };

  A.step = function (dt) {
    if (!state || !(dt > 0)) return false;
    var wasPlaying = state.playing;
    if (state.reveal < 1) state.reveal = Math.min(1, state.reveal + dt * 2.2);

    if (state.playing) {
      if (state.hitstop > 0) {
        state.hitstop -= dt;                 // 顿帧：时间轴暂停，画面特效照常走
      } else {
        state.t += dt * speed;
        if (state.t >= state.total) {
          state.t = state.total;
          applyUpTo(state.t);
          state.playing = false;
        } else {
          applyUpTo(state.t);
        }
      }
    }

    // 插值：让「每 tick 走一格」看起来像滑过去而不是瞬移
    var k = 1 - Math.exp(-dt * 22);
    var kLag = 1 - Math.exp(-dt * 5.5);      // 滞后条回得更慢，才看得出「刚掉了多少」
    for (var uid in state.units) {
      var u = state.units[uid];
      u.rr += (u.r - u.rr) * k;
      u.cc += (u.c - u.cc) * k;
      u.hpLag += (u.hp - u.hpLag) * kLag;
      if (u.lunge > 0) u.lunge = Math.max(0, u.lunge - dt * 6);
      if (u.flinch > 0) u.flinch = Math.max(0, u.flinch - dt * 4.5);
      if (u.flash > 0) u.flash = Math.max(0, u.flash - dt * 7);
      if (u.frenzyFlash > 0) u.frenzyFlash = Math.max(0, u.frenzyFlash - dt * 3.2);
      if (u.buffFlash > 0) u.buffFlash = Math.max(0, u.buffFlash - dt * 3.2);
      if (u.guardFlash > 0) u.guardFlash = Math.max(0, u.guardFlash - dt * 3.2);
      if (u.ocFlash > 0) u.ocFlash = Math.max(0, u.ocFlash - dt * 3.2);
      if (u.asBuffFlash > 0) u.asBuffFlash = Math.max(0, u.asBuffFlash - dt * 3.2);
      if (u.rootFlash > 0) u.rootFlash = Math.max(0, u.rootFlash - dt * 3.2);
      if (u.wardFlash > 0) u.wardFlash = Math.max(0, u.wardFlash - dt * 3.2);
      if (u.petrifyFlash > 0) u.petrifyFlash = Math.max(0, u.petrifyFlash - dt * 3.2);
      if (u.burnCurFlash > 0) u.burnCurFlash = Math.max(0, u.burnCurFlash - dt * 3.2);
      if (u.biteFlash > 0) u.biteFlash = Math.max(0, u.biteFlash - dt * 3.2);
      if (u.batiFlash > 0) u.batiFlash = Math.max(0, u.batiFlash - dt * 3.2);
      if (u.flashEat > 0) u.flashEat = Math.max(0, u.flashEat - dt * 3.2);
      if (u.flashToken > 0) u.flashToken = Math.max(0, u.flashToken - dt * 3.2);
      if (u.neonFlash > 0) u.neonFlash = Math.max(0, u.neonFlash - dt * 3.2);
      if (u.deathFlash > 0) u.deathFlash = Math.max(0, u.deathFlash - dt * 3.2);
      if (u.phoneFlash > 0) u.phoneFlash = Math.max(0, u.phoneFlash - dt * 3.2);
      if (u.ocBurnFlash > 0) u.ocBurnFlash = Math.max(0, u.ocBurnFlash - dt * 3.2);
      if (u.ocOverFlash > 0) u.ocOverFlash = Math.max(0, u.ocOverFlash - dt * 3.2);
      if (u.burnFlash > 0) u.burnFlash = Math.max(0, u.burnFlash - dt * 3.2);
      if (u.chillFlash > 0) u.chillFlash = Math.max(0, u.chillFlash - dt * 3.2);
      if (u.laughFlash > 0) u.laughFlash = Math.max(0, u.laughFlash - dt * 3.2);
      if (u.knifeFlash > 0) u.knifeFlash = Math.max(0, u.knifeFlash - dt * 3.2);
      if (u.manaFlash > 0) u.manaFlash = Math.max(0, u.manaFlash - dt * 3.2);
      // 伤害改动到期：靠时间戳自然失效，不需要事件来通知
      if (u.buffMul !== 1 && state.t >= u.buffUntil) { u.buffMul = 1; u.buffUntil = -1; }
      /* 攻速增益到期同样靠比时间戳（不需要"结束"事件）——
         和 buffUntil / laughUntil / chill 同一套约定。 */
      if (u.asBuffPct > 0 && state.t >= u.asBuffUntil) { u.asBuffPct = 0; u.asBuffUntil = -1; }
      /* 大笑也会靠时间戳自然结束。★ 不需要 laughEnd 事件 ——
         时长写在 laughUntil 里，谁都能自己算出来还剩几秒。
         事件只负责"开始笑"这一下。 */
      if (u.laughUntil >= 0 && state.t >= u.laughUntil) { u.laughUntil = -1; }
      /* ★★ 大笑期间的**连续飘字**（😂 一颗颗往上冒）。
       *
       *   「正在大笑」是一个要挂 3 秒的状态，而 laugh 事件只有一帧。
       *   这一帧的特效飘走之后，画面上就只剩一条金色描边和一枚小徽章，
       *   在十几张卡牌的混战里基本等于看不见。
       *   所以这里每 0.28 秒补一颗飘字，冒满这 3 秒 ——
       *   谁是"那个一直笑得停不下来的家伙"，一眼就能扫出来。
       *
       *   ★ 放在**每帧重算**而不是发事件：一条"还在笑"的日志
       *     每 0.28 秒写一次，一次大笑就是 10 条毫无信息量的日志。
       *     时间戳（laughUntil）已经写在事件里了，渲染层自己会数。
       *   ★ 3 星额外给旁边的队友也冒两颗：那 3×3 里的人正在被治疗，
       *     圈里飘起 😂 是最便宜的"我也在笑"的表达。 */
      if (u.laughUntil >= 0 && state.t >= u.laughFxAt) {
        u.laughFxAt = state.t + 0.28;
        addGiggle(cellX(u), cellY(u) - CELL * 0.16, 1, '😂', '#ffce56', CELL * 0.5);
        if (u.laughAlly) {
          for (var muid in state.units) {
            var mt = state.units[muid];
            if (mt.side !== u.side || mt.uid === u.uid || !mt.alive) continue;
            if (Math.max(Math.abs(mt.r - u.r), Math.abs(mt.c - u.c)) > 1) continue;
            addGiggle(cellX(mt), cellY(mt) - CELL * 0.16, 1, '😂', '#9cebaf', CELL * 0.4);
          }
        }
      }
      /* ★ 纯 CD 技能的冷却条。放在**每帧重算**而不是靠事件推进：
         battle.js 的 cooldownTick 不发事件（每 1/30 秒发一条会把事件流灌爆），
         所以这里按 cdSeconds 和 cdT 自己算 —— 事件流仍然是唯一事实来源，
         因为 cdT 只由 cast / laugh 事件写。 */
      if (u.cdSeconds > 0) {
        var cdFrac = (state.t - u.cdT) / u.cdSeconds;
        u.mana = Math.max(0, Math.min(1, cdFrac)) * u.maxMana;
      }

      /* ★★ Dank1ng「端着狙击枪」的**状态变化**要在每帧这里抓：
       *   架枪的条件（充能过半）是一个**连续量**，靠事件是抓不到的
       *   （法力每次普攻涨一点、挨打也涨，没有"刚好过半"那条事件）。
       *   ★ 所以这里只做一件事：检测"上一帧没架、这一帧架上了"，
       *     给一下高光。枪本身画在 drawUnit 里（那里才拿得到卡片坐标）。 */
      var shouldAim = !!(u.killSkull && u.maxMana > 0 && u.mana > u.maxMana * 0.5);
      if (shouldAim && !u.rifleUp) u.rifleFlash = 1;
      u.rifleUp = shouldAim;
      if (u.rifleFlash > 0) u.rifleFlash = Math.max(0, u.rifleFlash - dt * 2.2);
    }

    for (var f = state.flashes.length - 1; f >= 0; f--) {
      state.flashes[f].age += dt;
      if (state.flashes[f].age > HIT_FLASH) state.flashes.splice(f, 1);
    }

    for (var i = fx.length - 1; i >= 0; i--) {
      var e = fx[i];
      e.age += dt;
      if (e.type === 'num' || e.type === 'spark') {
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        e.vy += (e.type === 'num' ? 130 : 420) * dt;
      }
      if (e.age >= e.life) fx.splice(i, 1);
    }

    if (shakeMag > 0.05) shakeMag *= Math.exp(-dt * 7.5);
    else shakeMag = 0;

    /* ★ 过期的领域要清掉。
       ★ 放在 step 里清、而不是在 drawFields 里过滤：draw 一帧最多跑一次，
         而"领域表越来越长"这件事是每帧累积的 —— 在那里清最省。
         和 buffUntil 一样，过期**不需要任何人通知**，比一次时间就行。 */
    if (state.fields && state.fields.length) {
      for (var fi2 = state.fields.length - 1; fi2 >= 0; fi2--) {
        if (state.fields[fi2].until <= state.t) state.fields.splice(fi2, 1);
      }
    }

    if (fx.length > peak.fx) peak.fx = fx.length;
    if (shakeMag > peak.shake) peak.shake = shakeMag;
    if (state.t > peak.t) peak.t = state.t;

    draw();
    if (A.onFrame) A.onFrame(state);

    if (wasPlaying && !state.playing && onFinish) {
      var cb = onFinish;
      onFinish = null;
      setTimeout(cb, 520);
    }
    return true;
  };

  function frame(now) {
    var dt = lastFrame ? Math.min(0.06, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    if (state) A.step(dt);
    raf = requestAnimationFrame(frame);
  }

  /* ============================================================
   * 绘制
   * ============================================================ */
  function drawIdle() {
    if (!ctx) return;
    ctx.clearRect(0, 0, fieldW(), fieldH());
    drawBg();
  }

  /**
   * 战场底图。
   *
   * ★ 格子和准备阶段的棋盘画成同一种样子（同样的圆角白格、同样的间距），
   *   这样「我摆的阵」和「打起来的阵」在视觉上就是一块东西平移了一下，
   *   而不是两套看起来差不多的网格。
   */
  function drawBg() {
    var W = fieldW(), H = fieldH();
    /* 中线要画在**战场的真实中心** H/2，不能画在 ROWS*PITCH/2。
       两者差半个间距（4px）：战场高 = 8 格 + 7 个间距，比 8 个 pitch 少一个间距。
       画歪 4px 的话，「双方各占一半」看起来就是一边多一点点。 */
    var mid = H / 2;

    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#f1f2fa');
    g.addColorStop(0.5, '#f0f3f0');
    g.addColorStop(1, '#e9f1e7');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 己方半场淡淡暖一点，提示「这是我的地盘」
    ctx.fillStyle = 'rgba(120,180,140,.07)';
    ctx.fillRect(0, mid, W, H - mid);

    // 和布阵盘一样的圆角格子（前排更亮一点，和 .cell.front-row 对齐）
    var half = ST.BATTLE_CFG.ROWS_PER_SIDE;
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        // 双方各自最靠中线的那一行算「前排」，和准备阶段的 front-row 同一套规则
        var front = (r === half - 1) || (r === half);
        ctx.fillStyle = front ? 'rgba(255,255,255,.80)' : 'rgba(255,255,255,.55)';
        ctx.strokeStyle = C.grid;
        ctx.lineWidth = 1;
        roundRect(c * PITCH + .5, r * PITCH + .5, CELL - 1, CELL - 1, 10);
        ctx.fill();
        ctx.stroke();
      }
    }

    // 中线：比格线更明显
    ctx.strokeStyle = C.center;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(W, mid);
    ctx.stroke();

    /* ★ 在两个半场各写一个地面水印。
     *
     *   没有这两个字的时候，「我方的棋子到底站在哪半场」是看不出来的 ——
     *   只能靠背下来「上面是敌人」。而布阵盘只有 4 行、看起来就像一整个战场，
     *   于是「我摆在我半场、怎么跑到敌人半场去了」这种疑问非常容易产生。
     *   写在最底层（棋子画在上面），所以只是像地面上的漆字，不挡任何信息。 */
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 ' + Math.max(12, Math.round(CELL * 0.20)) +
      'px "Microsoft YaHei", "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(120,112,175,.20)';       // 敌方：淡紫
    ctx.fillText('敌方半场', W / 2, mid * 0.42);
    ctx.fillStyle = 'rgba(58,124,90,.22)';         // 我方：淡绿
    ctx.fillText('我方半场', W / 2, mid + (H - mid) * 0.42);
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** 按 object-fit: cover 的方式铺满（和 CSS 里一致） */
  function drawCover(img, dx, dy, dw, dh) {
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    var s = Math.max(dw / iw, dh / ih);
    var w = iw * s, h = ih * s;
    ctx.drawImage(img, dx + (dw - w) / 2, dy + (dh - h) / 2, w, h);
  }

  /* 卡片上画几颗星。★ 1 星不画；4 星要画 4 颗 ——
     写成 `n >= 3 ? '★★★'` 的话四星会被画成三星，玩家分不出来。 */
  function starText(n) {
    return n <= 1 ? '' : new Array(n + 1).join('★');
  }

  var NUM_STYLE = {
    phys: { fill: '#ffffff', edge: '#3c4a41', size: 1.0 },
    crit: { fill: '#ffd24d', edge: '#7a5200', size: 1.35 },
    magic: { fill: '#d9c8ff', edge: '#4a3a80', size: 1.12 },
    thorn: { fill: '#ffb3a6', edge: '#7a2a1c', size: 1.0 },
    // 讲话石反弹：水色，和普通反伤（暖红）区分开
    thornWater: { fill: '#dff2ff', edge: '#1d5f86', size: 1.02 },
    heal: { fill: '#b6f5c7', edge: '#1f6b38', size: 1.05 },
    // 星级被动的挨打回血：偏暖的绿，和奶妈的治疗区分开
    healPassive: { fill: '#d8f5a8', edge: '#3f6b18', size: 0.92 },
    // 豆包「幻觉 / 开智」：增伤是金、减伤是紫 —— 冷暖一眼分好坏
    giftGood: { fill: '#ffd66e', edge: '#7a5200', size: 0.86 },
    giftBad: { fill: '#d6b0f5', edge: '#4a2a70', size: 0.86 },
    // 抓娃娃挡下攻击：水青色，和「护盾」的观感一致
    guardClang: { fill: '#c8f6ff', edge: '#1d5f86', size: 0.88 },
    // 超频自毁：红得刺眼，和"挨打"的白/黄数字一眼分得开
    selfBurn: { fill: '#ff8a6a', edge: '#6b1d10', size: 1.05 },
    /* ★ 祖国人「灼烧」的每秒一跳：橙色、字号偏小 ——
       它是"持续掉血"的节奏音，不该盖过激光那一下的高额伤害数字。 */
    burn: { fill: '#ffb066', edge: '#7a3a08', size: 0.88 },
    /* ★ 丁真「芝士雪豹」的减速：青绿色 -40%，和灼烧的橙色分得开 */
    biteSlow: { fill: '#9ce0b8', edge: '#1d5f45', size: 0.90 },
    /* ★ 小马死后的狂暴提示：金色、比暴击还大一点（它是这一局的转折点） */
    ponyRage: { fill: '#ffd98a', edge: '#7a3a08', size: 1.05 },
    /* ★ 大肥鱼「下一口翻倍」：水蓝色 —— 和暴击的金、灼烧的橙都分得开 */
    eatReady: { fill: '#9fd8ff', edge: '#0d3a55', size: 0.95 },
    /* ★ TOKEN 被花掉：米白色（饭的颜色） */
    tokenUse: { fill: '#ffe9a8', edge: '#6b4a10', size: 0.95 },
    /* ★ 「剧毒火龙果」每秒一跳：草绿色、字号偏小（高频，不抢戏） */
    poison: { fill: '#a8e88a', edge: '#265c18', size: 0.86 },
    /* ★ 羊帆「羊巅峰」的 20 倍一击。
       ★★ 字号必须**明显大过暴击**（1.35）—— 它是这个角色一整局唯一的高光，
          和"偶尔一下打得好"完全不是一个量级。1.9 倍已经接近血条高度了。 */
    peak: { fill: '#ffd24d', edge: '#8a1f10', size: 1.9 }
  };

  function drawFx() {
    for (var i = 0; i < fx.length; i++) {
      var e = fx[i];
      var p = e.age / e.life;
      var a = 1 - p;
      if (e.type === 'num') {
        var st = NUM_STYLE[e.kind] || NUM_STYLE.phys;
        var size = Math.round((CELL * 0.235) * st.size * e.scale);
        ctx.save();
        ctx.globalAlpha = Math.min(1, a * 1.7);
        ctx.font = '900 ' + size + 'px "Segoe UI", "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = Math.max(2.5, size * 0.22);
        ctx.strokeStyle = st.edge;
        ctx.strokeText(e.text, e.x, e.y);
        ctx.fillStyle = st.fill;
        ctx.fillText(e.text, e.x, e.y);
        ctx.restore();
      } else if (e.type === 'ring') {
        var r = e.maxR * (0.25 + p * 0.75);
        ctx.save();
        ctx.globalAlpha = a * 0.9;
        ctx.strokeStyle = e.color;
        ctx.lineWidth = Math.max(2, 5 * (1 - p));
        ctx.beginPath();
        ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (e.type === 'spark') {
        ctx.save();
        ctx.globalAlpha = a;
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        var sp = Math.sqrt(e.vx * e.vx + e.vy * e.vy) || 1;
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(e.x - e.vx / sp * e.len, e.y - e.vy / sp * e.len);
        ctx.stroke();
        ctx.restore();
      } else if (e.type === 'river') {
        /* 水带：从佩戴者流向受害者。
           三层粗细/透明度不同的曲线叠在一起，单看一层都太规矩，
           叠起来才像水。前端只画到「已经流到哪」（t），像水正冲过去。 */
        var ddx = e.x2 - e.x1, ddy = e.y2 - e.y1;
        var dlen = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
        var pnx = -ddy / dlen, pny = ddx / dlen;          // 垂直方向：用来做波纹起伏
        var amp = Math.min(8, dlen * 0.12) * Math.sin(p * Math.PI);
        var t = Math.min(1, p * 1.5);
        var headX = e.x1 + ddx * t, headY = e.y1 + ddy * t;
        ctx.save();
        ctx.lineCap = 'round';
        var widths = [6.0, 3.4, 1.5], alphas = [0.26, 0.5, 0.95];
        for (var wi = 0; wi < 3; wi++) {
          var off = (wi - 1) * 2.1;
          ctx.lineWidth = widths[wi] * (1 - p * 0.45);
          ctx.globalAlpha = Math.min(1, a * alphas[wi] * 1.7);
          ctx.strokeStyle = wi === 2 ? 'rgba(236,250,255,.95)' : 'rgba(116,186,232,.95)';
          var mx = e.x1 + ddx * 0.5 + pnx * (amp + off * 1.5);
          var my = e.y1 + ddy * 0.5 + pny * (amp + off * 1.5);
          ctx.beginPath();
          ctx.moveTo(e.x1 + pnx * off, e.y1 + pny * off);
          ctx.quadraticCurveTo(mx, my, headX + pnx * off, headY + pny * off);
          ctx.stroke();
        }
        // 水流前端的水花
        ctx.globalAlpha = Math.min(1, a * 1.7);
        ctx.fillStyle = 'rgba(232,248,255,.92)';
        for (var di = 0; di < 3; di++) {
          var ang = (di / 3) * Math.PI * 2 + p * 7;
          ctx.beginPath();
          ctx.arc(headX + Math.cos(ang) * 3.4, headY + Math.sin(ang) * 3.4,
                  2.0 * (1 - p * 0.5), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      } else if (e.type === 'ripple') {
        /* 地面水波：压扁成椭圆（ry = rx * 0.40），
           圆环看着像光环，扁的才像地面上的水面。 */
        var rr = e.maxR * (0.20 + p * 0.80);
        ctx.save();
        ctx.globalAlpha = a * 0.85;
        ctx.strokeStyle = 'rgba(126,196,238,.95)';
        ctx.lineWidth = Math.max(1.5, 4.5 * (1 - p));
        ctx.beginPath();
        ctx.ellipse(e.x, e.y + CELL * 0.20, rr, rr * 0.40, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = a * 0.45;
        ctx.strokeStyle = 'rgba(226,246,255,.95)';
        ctx.beginPath();
        ctx.ellipse(e.x, e.y + CELL * 0.20, rr * 0.62, rr * 0.25, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (e.type === 'tracer') {
        /* ★ 狙击曳光弹：五层叠出来的「一道光」。
         *
         *   为什么要叠这么多层：单画一条粗线只是一个色块，
         *   叠上「大光晕 → 小光晕 → 实心彩线 → 白热芯 → 弹头」之后，
         *   才会看起来像**在发光**。最外层 26px ≈ 四分之一个格子。
         *
         *   前端跑得比尾端快得多（t = p^0.42）⇒ 画面上是「唰地冲出去」，
         *   而不是一条线慢慢伸长。
         *
         *   亮度曲线也改了：前 55% 的生命**一点都不衰减**（fade = 1）。
         *   以前是一出现就在淡出，最亮的那几帧全浪费在起手上了。
         *
         *   没命中的那一发会越过目标继续飞（over），飞出多远都照画。 */
        var tx = e.x2 - e.x1, ty = e.y2 - e.y1;
        var tl = Math.sqrt(tx * tx + ty * ty) || 1;
        var ex = e.x2 + tx / tl * e.over, ey = e.y2 + ty / tl * e.over;
        var tp = Math.pow(Math.min(1, p * 1.35), 0.42);
        var hx = e.x1 + (ex - e.x1) * tp, hy = e.y1 + (ey - e.y1) * tp;
        var tail = 0.40;                              // 拖尾长度（占全程比例）
        var bx = e.x1 + (ex - e.x1) * Math.max(0, tp - tail);
        var by = e.y1 + (ey - e.y1) * Math.max(0, tp - tail);
        var fade = p < 0.55 ? 1 : Math.max(0, 1 - (p - 0.55) / 0.45);
        var beam = Math.min(1.15, Math.max(CELL / 95, 0.7));   // 小屏幕上按格子同比缩一点
        ctx.save();
        ctx.lineCap = 'round';
        /* 五层从粗到细叠上去，越里层越不透明。
           ★ 透明度是照着「外圈是光晕、内圈是实体」调的：
             外层太实会变成一根塑料管子，太虚又看不见 —— 实测 0.14/0.30/0.60/1.0 这组
             在最亮的板面背景上也一眼能认出来。
           写成五段而不是抽个小函数：这是在 for 循环里给每一帧现算的路径，
           抽函数既不省事也更容易写错。 */
        ctx.globalAlpha = Math.min(1, fade * 0.14);   // ① 外层氛围 40px
        ctx.strokeStyle = e.color; ctx.lineWidth = 40 * beam;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(hx, hy); ctx.stroke();
        ctx.globalAlpha = Math.min(1, fade * 0.30);   // ② 大光晕 26px
        ctx.lineWidth = 26 * beam;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(hx, hy); ctx.stroke();
        ctx.globalAlpha = Math.min(1, fade * 0.60);   // ③ 中层光晕 13px
        ctx.lineWidth = 13 * beam;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(hx, hy); ctx.stroke();
        ctx.globalAlpha = Math.min(1, fade);          // ④ 实心彩线 6px
        ctx.lineWidth = 6 * beam;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(hx, hy); ctx.stroke();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.6 * beam;   // ⑤ 白热芯
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(hx, hy); ctx.stroke();
        // ⑤ 弹头：彩色光环 + 白热核心
        var hr = (5.5 + 3 * (1 - tp)) * beam;
        ctx.globalAlpha = Math.min(1, fade * 0.55);
        ctx.fillStyle = e.color;
        ctx.beginPath(); ctx.arc(hx, hy, hr * 1.9, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = fade;
        ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(hx, hy, hr * 0.55, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else if (e.type === 'muzzle') {
        /* 枪口闪光：一圈迅速扩散的白热光环 + 四道十字亮线。
           它存在的意义是**回答「这一枪是从谁那儿打出来的」** ——
           只有一条弹道的话，混战时根本看不出来源。 */
        var mp = Math.min(1, p * 1.6);
        var mr = CELL * (0.16 + 0.42 * mp);
        var mfade = 1 - p;
        ctx.save();
        ctx.globalAlpha = mfade * 0.85;
        ctx.strokeStyle = e.color;
        ctx.lineWidth = Math.max(2, 6 * (1 - p));
        ctx.beginPath(); ctx.arc(e.x, e.y, mr, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = mfade;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(2, 4 * (1 - p));
        ctx.lineCap = 'round';
        for (var mi = 0; mi < 4; mi++) {
          var mAng = mi * Math.PI / 2 + Math.PI / 4;
          var r1 = CELL * 0.10, r2 = CELL * (0.20 + 0.26 * mp);
          ctx.beginPath();
          ctx.moveTo(e.x + Math.cos(mAng) * r1, e.y + Math.sin(mAng) * r1);
          ctx.lineTo(e.x + Math.cos(mAng) * r2, e.y + Math.sin(mAng) * r2);
          ctx.stroke();
        }
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = mfade * 0.9;
        ctx.beginPath(); ctx.arc(e.x, e.y, CELL * 0.11 * (1 - p * 0.4), 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else if (e.type === 'strike') {
        /* 落下中的直升机：一条越来越近、越来越亮的尾迹 + 一个越缩越小的光点。
           ★ 它的寿命就是 CFG.CRASH_DELAY —— 尾迹消失的那一帧爆炸正好开始，
             和荣誉的蓄力激光是同一个思路：**特效的寿命跟着规则走**。 */
        var sp2 = p;
        var sx2 = e.x, sy2 = e.y - CELL * 3.2 * (1 - sp2);
        ctx.save();
        ctx.globalAlpha = 0.25 + 0.6 * sp2;
        ctx.strokeStyle = e.color;
        ctx.lineCap = 'round';
        ctx.lineWidth = (2 + 5 * sp2);
        ctx.beginPath();
        ctx.moveTo(sx2, sy2 - CELL * 1.5);
        ctx.lineTo(sx2, sy2);
        ctx.stroke();
        ctx.globalAlpha = 0.5 + 0.5 * sp2;
        ctx.strokeStyle = 'rgba(255,240,210,.9)';
        ctx.lineWidth = Math.max(1, 1.6 * sp2);
        ctx.beginPath();
        ctx.moveTo(sx2, sy2 - CELL * 1.0);
        ctx.lineTo(sx2, sy2);
        ctx.stroke();
        // 落点上的靶心，告诉玩家「要砸这里」
        ctx.globalAlpha = 0.35 + 0.5 * sp2;
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(e.x, e.y + CELL * 0.18, CELL * (1.1 - 0.5 * sp2), CELL * (0.42 - 0.2 * sp2),
                    0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (e.type === 'blast') {
        /* 坠机爆炸：两圈冲击波 + 中间一团火球。
           外圈半径直接来自事件的 3×3，所以画出来的范围和真正挨打的九格一致。 */
        var bp = Math.min(1, p * 1.25);
        var bfade = 1 - p;
        ctx.save();
        // 火球
        var fireR = e.r1 * (0.35 + 0.65 * Math.pow(bp, 0.5));
        var g2 = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, fireR);
        g2.addColorStop(0, 'rgba(255,245,200,' + (bfade * 0.95).toFixed(3) + ')');
        g2.addColorStop(0.45, 'rgba(255,150,60,' + (bfade * 0.70).toFixed(3) + ')');
        g2.addColorStop(1, 'rgba(180,60,20,0)');
        ctx.fillStyle = g2;
        ctx.beginPath(); ctx.arc(e.x, e.y, fireR, 0, Math.PI * 2); ctx.fill();
        // 冲击波：一圈迅速扩到 3×3 之外的大环
        ctx.globalAlpha = bfade * 0.9;
        ctx.strokeStyle = 'rgba(255,220,150,.95)';
        ctx.lineWidth = Math.max(2, 9 * (1 - p));
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r2 * (0.2 + 0.8 * bp), 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = bfade * 0.5;
        ctx.strokeStyle = 'rgba(255,255,255,.9)';
        ctx.lineWidth = Math.max(1.5, 4 * (1 - p));
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r1 * (0.3 + 0.9 * bp), 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      } else if (e.type === 'phoneFly') {
        /* 一部乱飞出去的手机。
           ★★ 三件事让它读起来是"被**扔**出去的"而不是"射出去的"：
             ① 残影：后面跟 3 个半透明的自己（拖影越长越像高速甩出去）
             ② 自转：整部手机跟着飞行进度转（spin 每部不同、方向也不同）
             ③ 歪着飞：路径上加一段横向摆动（wob），不是一条直线
           ★ p 夹到 0~1：后几部的 age 是负数（随机错开出发时间），
             不夹的话它们会出现在画面外或者算成 NaN。 */
        var phP = Math.max(0, Math.min(1, p));
        var phW = CELL * 0.17 * e.scale, phH = CELL * 0.28 * e.scale;
        /* ★ 4 份拷贝：3 个残影 + 本体。
           ★★ 这里刻意**不用内嵌函数**（`function phAt(q){}` 写在循环里）：
             每一帧每一部手机都会重新创建那些闭包 —— 40 部 × 30fps
             就是每秒上千个临时函数，纯属给 GC 添活。摊开成"算一遍位置"
             反而更快也更好读。 */
        for (var gh = 0; gh < 4; gh++) {
          var gq = Math.max(0, Math.min(1, phP - (3 - gh) * 0.055));
          var gAlpha = (gh === 3) ? 1 : (0.14 * (gh + 1));
          var gx = e.x1 + (e.x2 - e.x1) * gq + Math.sin(gq * Math.PI) * e.wob;
          var gy = e.y1 + (e.y2 - e.y1) * gq - Math.sin(gq * Math.PI) * e.arc;
          ctx.save();
          ctx.globalAlpha = gAlpha;
          ctx.translate(gx, gy);
          ctx.rotate(e.spin * gq);
          /* ★ 3D 翻面感：横向缩放跟着自转一起摆（|cos| 那一项）——
             只转 2D 角度看起来像"贴纸在打转"，加一点横向压扁
             才像"手机在空中翻跟头"。 */
          ctx.scale(Math.abs(Math.cos(e.spin * gq * 0.5)) * 0.55 + 0.45, 1);
          ctx.fillStyle = '#23272e';
          roundRect(-phW / 2, -phH / 2, phW, phH, 2.5);
          ctx.fill();
          ctx.strokeStyle = e.boom ? '#ffd98a' : '#93a4b8';
          ctx.lineWidth = 1.2;
          ctx.stroke();
          // 屏幕：3 星是"三星手机"，屏幕亮金色；1/2 星是普通蓝屏
          ctx.fillStyle = e.boom ? 'rgba(255,217,138,.95)' : 'rgba(140,200,255,.8)';
          roundRect(-phW * 0.34, -phH * 0.30, phW * 0.68, phH * 0.52, 1.5);
          ctx.fill();
          ctx.restore();
        }
        /* ★ 高光扫过：飞行的后半段在屏幕上打一道白 ——
           屏幕反光是"这是个亮着的手机"最强的暗示，一部一闪就够。 */
        if (phP > 0.45 && phP < 0.8) {
          var hlX = e.x1 + (e.x2 - e.x1) * phP + Math.sin(phP * Math.PI) * e.wob;
          var hlY = e.y1 + (e.y2 - e.y1) * phP - Math.sin(phP * Math.PI) * e.arc;
          ctx.save();
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(hlX + phW * 0.18, hlY - phH * 0.12, 1.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      } else if (e.type === 'flash') {
        /* 爆炸的白闪：一下就铺满、然后迅速退掉。
           ★ 用两层叠出"内核白 + 外圈暖"的感觉：
             纯白圆太大看起来像 UI 里的光斑，加一圈暖色才像爆。 */
        var flFade = 1 - p;
        var flR = e.r * (0.72 + 0.28 * p);
        var flG = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, flR);
        flG.addColorStop(0, 'rgba(255,255,255,' + (flFade * 0.95).toFixed(3) + ')');
        flG.addColorStop(0.45, 'rgba(255,232,170,' + (flFade * 0.75).toFixed(3) + ')');
        flG.addColorStop(1, 'rgba(255,180,80,0)');
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.fillStyle = flG;
        ctx.beginPath();
        ctx.arc(e.x, e.y, flR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (e.type === 'shard') {
        /* 碎屏：带重力的小方块，边飞边转，快落地时淡出。 */
        var shX = e.x + e.vx * e.age;
        var shY = e.y + e.vy * e.age + 260 * e.age * e.age;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - p);
        ctx.translate(shX, shY);
        ctx.rotate(e.rot + e.spin * e.age);
        ctx.fillStyle = e.gold ? '#ffd98a' : '#cfe6ff';
        ctx.fillRect(-e.size / 2, -e.size / 2, e.size, e.size * 0.8);
        ctx.restore();
      } else if (e.type === 'knifeFly') {
        /* 陈兴裕的五把飞刀：从出手者飞向落点的一小片刀影。
           ★ p 会被夹到 0~1 —— 后几把刀的 age 是负数（错开出发时间），
             不夹的话它们的坐标会飞到画面外面去。 */
        var knP = Math.max(0, Math.min(1, p));
        var knX = e.x1 + (e.x2 - e.x1) * knP;
        var knY = e.y1 + (e.y2 - e.y1) * knP - Math.sin(knP * Math.PI) * CELL * 0.22;
        var knAng = Math.atan2(e.y2 - e.y1, e.x2 - e.x1);
        var knLen = CELL * 0.34;
        ctx.save();
        ctx.globalAlpha = e.hit ? (1 - knP * 0.25) : (0.85 - knP * 0.45);
        ctx.translate(knX, knY);
        ctx.rotate(knAng);
        // 拖尾
        ctx.strokeStyle = e.hit ? 'rgba(220,236,255,.85)' : 'rgba(150,166,180,.7)';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(-knLen * (e.hit ? 2.4 : 1.6), 0);
        ctx.lineTo(0, 0);
        ctx.stroke();
        // 刀身（一个细长的三角）
        ctx.fillStyle = e.hit ? '#e8f2ff' : '#aab6c2';
        ctx.beginPath();
        ctx.moveTo(knLen, 0);
        ctx.lineTo(-knLen * 0.25, -knLen * 0.20);
        ctx.lineTo(-knLen * 0.25, knLen * 0.20);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (e.type === 'meteor') {
        /* 斜着砸下来的陨石：
             ① 前 55% 的时间里，石头从左上高空冲向落点（带一条火尾）
             ② 之后原地炸开：土黄的尘环 + 一圈裂纹
           ★ 石头本体画成一个**多边形的深色石块**，不是圆球 ——
             圆球看着像火球术，多边形才像"一块石头"。 */
        var mp = p;
        var landAt = 0.55;
        ctx.save();
        if (mp < landAt) {
          var lp = mp / landAt;                        // 0 → 1
          var mxx = e.x - e.size * 1.1 * (1 - lp);
          var myy = e.y - e.size * 2.2 * (1 - lp);
          var mrad = e.size * (0.10 + 0.06 * lp);
          // 火尾
          ctx.globalAlpha = 0.5 * (0.4 + 0.6 * lp);
          var tg = ctx.createLinearGradient(mxx, myy, mxx + e.size * 0.5, myy + e.size * 1.0);
          tg.addColorStop(0, 'rgba(255,196,90,.9)');
          tg.addColorStop(1, 'rgba(200,80,20,0)');
          ctx.strokeStyle = tg;
          ctx.lineCap = 'round';
          ctx.lineWidth = mrad * 1.5;
          ctx.beginPath();
          ctx.moveTo(mxx, myy);
          ctx.lineTo(mxx + e.size * 0.55, myy + e.size * 1.1);
          ctx.stroke();
          // 石头
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#6f5a44';
          ctx.beginPath();
          for (var k = 0; k < 7; k++) {
            var ang = k / 7 * Math.PI * 2 + lp * 2.4;
            var rr2 = mrad * (k % 2 ? 0.78 : 1);
            var px2 = mxx + Math.cos(ang) * rr2, py2 = myy + Math.sin(ang) * rr2;
            if (k === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
          }
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,214,140,.85)';
          ctx.lineWidth = 2;
          ctx.stroke();
        } else {
          var fadep = (mp - landAt) / (1 - landAt);    // 0 → 1
          var fadeA = 1 - fadep;
          // 尘环
          ctx.globalAlpha = fadeA * 0.75;
          ctx.strokeStyle = 'rgba(196,164,106,.95)';
          ctx.lineWidth = Math.max(2, 7 * fadeA);
          ctx.beginPath();
          ctx.ellipse(e.x, e.y + e.size * 0.10,
                      e.size * (0.30 + 0.42 * fadep), e.size * (0.12 + 0.18 * fadep),
                      0, 0, Math.PI * 2);
          ctx.stroke();
          // 裂纹
          ctx.globalAlpha = fadeA * 0.6;
          ctx.strokeStyle = 'rgba(120,92,58,.9)';
          ctx.lineWidth = 2.5;
          for (var c2 = 0; c2 < 6; c2++) {
            var a2 = c2 / 6 * Math.PI * 2 + 0.4;
            ctx.beginPath();
            ctx.moveTo(e.x + Math.cos(a2) * e.size * 0.12,
                       e.y + e.size * 0.10 + Math.sin(a2) * e.size * 0.05);
            ctx.lineTo(e.x + Math.cos(a2) * e.size * (0.34 + 0.22 * fadep),
                       e.y + e.size * 0.10 + Math.sin(a2) * e.size * (0.14 + 0.10 * fadep));
            ctx.stroke();
          }
        }
        ctx.restore();
      } else if (e.type === 'pillar') {
        /* 复活光柱：一道从地面冲上去的金色光 + 底部一圈尘环。 */
        var pp2 = Math.min(1, p * 1.5);
        var pf = 1 - p;
        ctx.save();
        var pw = CELL * (0.34 + 0.5 * pp2);
        var ph = CELL * (1.2 + 2.2 * pp2);
        var g3 = ctx.createLinearGradient(0, e.y, 0, e.y - ph);
        g3.addColorStop(0, 'rgba(255,214,110,' + (pf * 0.85).toFixed(3) + ')');
        g3.addColorStop(0.6, 'rgba(255,236,170,' + (pf * 0.45).toFixed(3) + ')');
        g3.addColorStop(1, 'rgba(255,255,240,0)');
        ctx.fillStyle = g3;
        ctx.fillRect(e.x - pw / 2, e.y - ph, pw, ph);
        // 中间那道白热芯
        ctx.globalAlpha = pf * 0.9;
        ctx.fillStyle = 'rgba(255,255,240,.9)';
        ctx.fillRect(e.x - pw * 0.14, e.y - ph * 0.85, pw * 0.28, ph * 0.85);
        // 底部的尘环
        ctx.globalAlpha = pf * 0.7;
        ctx.strokeStyle = 'rgba(255,230,180,.9)';
        ctx.lineWidth = Math.max(2, 5 * (1 - p));
        ctx.beginPath();
        ctx.ellipse(e.x, e.y + CELL * 0.2, CELL * (0.5 + 1.0 * pp2), CELL * (0.2 + 0.4 * pp2),
                    0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (e.type === 'knife') {
        /* ★ Dank1ng 的折叠刀：绕着卡片转的一把短刃。
         *
         *   走的是和 strike（直升机落下）一样的"长时间特效"路子：
         *   life = 技能数据里的 knifeDur，所以它存在多久 = 它不能攻击多久。
         *   ★ 转速刻意偏快（每 0.55 秒一圈）：3 秒要转五圈半，
         *     一眼就能看出"它现在在忙着耍刀，不是在发呆"。
         *   ★ 刃身用两段线拼：外侧细亮、内侧粗暗 —— 单根线看着像指示箭头。
         *   ★ 最后 20% 收尾：刀锋收进卡面里，暗示"收刀了，接下来要出手"。
         */
        var kp = Math.min(1, p);
        var kx = e.x, ky = e.y;
        var kR = CELL * (0.62 - 0.10 * Math.max(0, (kp - 0.8) / 0.2));
        var kAng = e.age * (Math.PI * 2 / 0.55) - Math.PI / 2;
        var kFade = kp > 0.8 ? Math.max(0, 1 - (kp - 0.8) / 0.2) : 1;
        ctx.save();
        ctx.globalAlpha = 0.85 * kFade;
        ctx.lineCap = 'round';
        for (var kb = 0; kb < 2; kb++) {
          var a0 = kAng + kb * 0.30;
          var x0 = kx + Math.cos(a0) * kR, y0 = ky + Math.sin(a0) * kR;
          var x1 = kx + Math.cos(a0) * kR * 0.45, y1 = ky + Math.sin(a0) * kR * 0.45;
          ctx.strokeStyle = kb === 0 ? 'rgba(255,255,255,.95)' : 'rgba(150,165,185,.75)';
          ctx.lineWidth = kb === 0 ? 3.2 : 2.0;
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        }
        // 刀尖那一小撮寒光
        ctx.globalAlpha = 0.7 * kFade;
        ctx.fillStyle = 'rgba(230,244,255,.9)';
        ctx.beginPath();
        ctx.arc(kx + Math.cos(kAng) * kR, ky + Math.sin(kAng) * kR, 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (e.type === 'arc') {
        /* ★ 锯齿闪电：外晕 + 白热芯两层，每帧重新生成折线。
           ★ 偏移量乘 `sin(t·π)`：两头收拢、中间最散 ——
             这样起点和终点**精确落在两个人身上**，不会"从旁边冒出来"。
           ★ 蓝色外晕 + 白热芯，和红色的自燃、金色的治疗一眼分得开。 */
        var aFade = Math.sin(Math.min(1, p) * Math.PI);
        var adx = e.x2 - e.x1, ady = e.y2 - e.y1;
        var alen = Math.sqrt(adx * adx + ady * ady) || 1;
        var anx = -ady / alen, any = adx / alen;
        var segs = 7;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (var ap = 0; ap < 2; ap++) {
          var amp = (ap === 0 ? CELL * 0.30 : CELL * 0.13);
          ctx.globalAlpha = Math.min(1, aFade * (ap === 0 ? 0.45 : 0.95));
          ctx.strokeStyle = (ap === 0 ? '#5aa6ff' : '#ffffff');
          ctx.lineWidth = (ap === 0 ? 7 : 2.6);
          ctx.beginPath();
          ctx.moveTo(e.x1, e.y1);
          for (var sg = 1; sg < segs; sg++) {
            var sgT = sg / segs;
            var off = (Math.random() - 0.5) * amp * 2 * Math.sin(sgT * Math.PI);
            ctx.lineTo(e.x1 + adx * sgT + anx * off, e.y1 + ady * sgT + any * off);
          }
          ctx.lineTo(e.x2, e.y2);
          ctx.stroke();
        }
        ctx.restore();
      } else if (e.type === 'cnode') {
        /* ★ 电流停在人身上等待的那 0.5 秒：一团高频抖动的蓝白电球。
           形状用 8 根长短不一的放射刺 —— 比一个圆点更像"电"。 */
        var cLeft = Math.max(0, 1 - p);
        var cPulse = 0.55 + 0.45 * Math.sin(e.age * 24);
        var cR = CELL * (0.16 + 0.10 * cPulse);
        ctx.save();
        ctx.globalAlpha = Math.min(1, (0.35 + 0.65 * cLeft) * cPulse);
        ctx.strokeStyle = '#8fd0ff';
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        for (var sp = 0; sp < 8; sp++) {
          var spA = sp / 8 * Math.PI * 2 + e.age * 3;
          var spL = cR * (1.5 + Math.random() * 1.5);
          ctx.beginPath();
          ctx.moveTo(e.x + Math.cos(spA) * cR, e.y + Math.sin(spA) * cR);
          ctx.lineTo(e.x + Math.cos(spA) * spL, e.y + Math.sin(spA) * spL);
          ctx.stroke();
        }
        ctx.globalAlpha = Math.min(1, 0.9 * (0.4 + 0.6 * cLeft));
        ctx.fillStyle = '#eaf6ff';
        ctx.beginPath();
        ctx.arc(e.x, e.y, cR * 0.85, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (e.type === 'beam') {
        /* ★ 祷告光束：两头淡、中间实，粗细恒定，微微呼吸。
           和上面那条蓄力激光是**刻意相反**的读法 —— 那条在"涨"，这条在"守"。
           不写成渐强的原因：渐强会被读成"要打出伤害了"，
           而这一秒里其实什么都没打，只是在等人站起来。 */
        var bAlpha = Math.sin(Math.min(1, p) * Math.PI);
        var bPulse = 0.78 + 0.22 * Math.sin(e.age * 7);
        ctx.save();
        ctx.lineCap = 'round';
        // ① 外晕
        ctx.globalAlpha = Math.min(1, bAlpha * 0.30 * bPulse);
        ctx.strokeStyle = e.color;
        ctx.lineWidth = CELL * 0.30;
        ctx.beginPath(); ctx.moveTo(e.x1, e.y1); ctx.lineTo(e.x2, e.y2); ctx.stroke();
        // ② 白热芯
        ctx.globalAlpha = Math.min(1, bAlpha * 0.85);
        ctx.strokeStyle = '#fff8e0';
        ctx.lineWidth = CELL * 0.085 * bPulse;
        ctx.beginPath(); ctx.moveTo(e.x1, e.y1); ctx.lineTo(e.x2, e.y2); ctx.stroke();
        ctx.restore();
      } else if (e.type === 'chargeGlow') {
        /* ★ 自爆蓄力：一圈**越收越紧、越涨越亮**的红环 + 中心一颗在憋的火种。
         *
         *   和爆炸特效刚好相反 —— 爆炸是"从中心炸开"，蓄力是"往中心收"。
         *   收的动作本身就是"要炸了"的通用视觉语言，不需要再加字幕解释。
         *   收满（p → 1）的那一帧，crash 事件正好结算。
         *
         *   ★ 最后一刻闪得更快：p > 0.7 之后用 sin 抖频率，
         *     这是"倒计时"的读法，比匀速扩张更容易让人感到紧迫。 */
        var gp = Math.min(1, p);
        var gAlpha = 0.35 + 0.65 * gp;
        var gRing = CELL * (1.35 - 0.85 * gp);          // 半径从 1.35 格收到 0.5 格
        var gPulse = gp > 0.7 ? (Math.sin(e.age * 40) * 0.5 + 0.5) : 1;
        ctx.save();
        ctx.globalAlpha = Math.min(1, gAlpha * (0.55 + 0.45 * gPulse));
        ctx.strokeStyle = 'rgba(255,110,60,.95)';
        ctx.lineWidth = Math.max(2.5, 3 + 6 * gp);
        ctx.beginPath();
        ctx.ellipse(e.x, e.y + CELL * 0.18, gRing, gRing * 0.62, 0, 0, Math.PI * 2);
        ctx.stroke();
        // 中心的火种：越接近爆炸越大
        var gr = CELL * (0.10 + 0.24 * gp);
        var g2 = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, gr * 2.2);
        g2.addColorStop(0, 'rgba(255,255,230,.95)');
        g2.addColorStop(0.45, 'rgba(255,190,90,.75)');
        g2.addColorStop(1, 'rgba(255,110,60,0)');
        ctx.globalAlpha = 0.75 + 0.25 * gPulse;
        ctx.fillStyle = g2;
        ctx.beginPath();
        ctx.arc(e.x, e.y, gr * 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (e.type === 'eyelaser') {
        /* ★ 蓄力激光：越蓄越粗、越蓄越亮，最后一瞬间炸一下。
         *
         *   亮度曲线用的是 p^1.7 而不是线性 —— 线性的话前半段就已经很亮了，
         *   看起来像"一直在射"，而不是"在攒"。
         *   最后 12% 补一圈闪光，作为「蓄满了」的信号：下一秒子弹就出膛。
         *
         *   金色系：#ffe07a 主体 + #ffb32e 外晕 + 白热芯。 */
        var ex1 = e.x1, ey1 = e.y1;
        var edx = e.x2 - e.x1, edy = e.y2 - e.y1;
        var elen = Math.sqrt(edx * edx + edy * edy) || 1;
        var ep = p;
        // 出膛前那 12% 先闪一下，把「蓄满了」说清楚
        var burst = ep > 0.88 ? 1 + (ep - 0.88) / 0.12 * 1.6 : 1;
        var eAlpha = Math.pow(ep, 1.7) * burst;
        var eW = (0.8 + 5.4 * ep) * burst;
        ctx.save();
        ctx.lineCap = 'round';
        // ① 外晕
        ctx.globalAlpha = Math.min(1, eAlpha * 0.30);
        ctx.strokeStyle = '#ffb32e';
        ctx.lineWidth = eW * 3.4;
        ctx.beginPath(); ctx.moveTo(ex1, ey1); ctx.lineTo(e.x2, e.y2); ctx.stroke();
        // ② 主体
        ctx.globalAlpha = Math.min(1, eAlpha * 0.92);
        ctx.strokeStyle = '#ffe07a';
        ctx.lineWidth = eW * 1.5;
        ctx.beginPath(); ctx.moveTo(ex1, ey1); ctx.lineTo(e.x2, e.y2); ctx.stroke();
        // ③ 白热芯
        ctx.globalAlpha = Math.min(1, eAlpha);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1, eW * 0.55);
        ctx.beginPath(); ctx.moveTo(ex1, ey1); ctx.lineTo(e.x2, e.y2); ctx.stroke();
        // ④ 眼睛本身：一个越来越大的金点 + 外发光
        var er = CELL * (0.035 + 0.075 * ep) * burst;
        ctx.shadowColor = '#ffd54a';
        ctx.shadowBlur = CELL * 0.22 * ep;
        ctx.globalAlpha = Math.min(1, eAlpha * 1.2);
        ctx.fillStyle = '#fff3c4';
        ctx.beginPath(); ctx.arc(ex1, ey1, er, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.restore();
      } else if (e.type === 'mote') {
        /* ★ 往上飘的笑（😂 / 哈哈）。
         *
         *   走的是和 callout 完全相反的路线：callout 是**主角台词**，
         *   有弹出、有停顿、字号半个格子；mote 是**氛围**，
         *   小、快、一气冒好几颗，看的是"这几秒它一直在笑"。
         *
         *   1. 先淡入 12%（一出来就是半透明的话，连续冒的时候会闪）
         *   2. 全程往上飘 + 左右匀速摆（sin），最后 35% 才淡出
         *   3. 稍微转一点角度（±0.25 rad）—— 完全水平的一排字很"假"
         *   4. 用 emoji 字体：😂 在 "Segoe UI Emoji" 里才有颜色，
         *      落到中文字体上会变成黑白轮廓甚至豆腐块
         */
        var mfade = Math.min(1, p / 0.12) * Math.min(1, (1 - p) / 0.35);
        ctx.save();
        ctx.globalAlpha = mfade * 0.95;
        ctx.font = Math.round(e.size) + 'px "Segoe UI Emoji", "Apple Color Emoji", ' +
                   '"Segoe UI", "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.translate(e.x + e.vx * e.age * 0.5 + Math.sin(p * 9) * CELL * 0.07,
                      e.y + e.vy * e.age * 0.5);
        ctx.rotate(e.rot * Math.sin(p * 3.4));
        /* ★ 描边只给**文字**加，emoji 不加。
         *   理由：😂 本身就是一张彩色小图，再描一圈深色边会糊成一团黑饼；
         *   而「哈哈」是纯色字，压在深色立绘上不描边根本读不出来。
         *   判据用代理对（emoji 的首个 charCode 落在 0xD800~0xDBFF），
         *   比"看文本里有几个字"可靠 —— 😂 在 UTF-16 里正好是 2 个字符，
         *   和「哈哈」一样长。 */
        if (e.text.charCodeAt(0) < 0xD800) {
          ctx.lineJoin = 'round';
          ctx.miterLimit = 2;
          ctx.lineWidth = Math.max(2, e.size * 0.18);
          ctx.strokeStyle = 'rgba(8,12,10,.45)';
          ctx.strokeText(e.text, 0, 0);
        }
        ctx.fillStyle = e.color;
        ctx.fillText(e.text, 0, 0);
        ctx.restore();
      } else if (e.type === 'callout') {
        /* ★ 角色台词（Vamos / Kale / Man！）。这是**字幕**，不是伤害飘字 ——
         *
         *   ★★ 2026-10 二次改版：**去掉底板和边框，只要字**。
         *      上一版是一块深色圆角牌子 + 彩色描边，虽然清楚，
         *      但压在一张张小卡牌上像贴了一张 UI 组件，不像"喊出来的话"。
         *      现在只靠**字本身**：厚深色描边勾出轮廓 + 亮色填充，
         *      底下是什么画面都能读出来，但看上去就是一行字。
         *
         *   1. 字号 CELL × 0.62（95px 格子上约 59px），隔老远也读得出来
         *   2. 描边要够厚（字号的 20%）—— 没有底板之后，它就是唯一的可读性保障
         *   3. 弹出用 easeOutBack（0.4 → 1.0，中途冲过一点再收回），
         *      比线性淡入"喊"得有力得多
         *   4. 停留 1.45 秒、向上飘半个格子，前端 6% 淡入、末尾 25% 淡出 ——
         *      中间那一大段是**完全不透明**的，那才是能看清的部分 */
        var csz = e.size;
        ctx.save();
        ctx.font = '900 ' + csz + 'px "Segoe UI", "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // 弹出：0 → 1，easeOutBack 会冲过 1 一点点再回来
        var et = Math.min(1, p / 0.20);
        var c1 = 1.70158, c3 = c1 + 1;
        var ease = 1 + c3 * Math.pow(et - 1, 3) + c1 * Math.pow(et - 1, 2);
        var scale = 0.40 + 0.60 * ease;

        // 不透明度：前端 6% 淡入，末尾 25% 淡出，中间整段实心
        var calpha = Math.min(1, p / 0.06) * Math.min(1, (1 - p) / 0.25);

        var rise = e.vy * Math.min(1, p * 1.1);
        /* ★★ 兜底：**贴到画布边就停住**。
         *   台词会向上飘半个格子，后排（最上面两行）的单位本来就在顶边附近，
         *   一飘就整句飞出画面 —— 用户看到的就是"这句字幕消失了"。
         *   加了 addCallout 里的安全线还不够：飘移是在绘制时发生的。 */
        var eHalfH = csz * 0.62;
        var eHalfW = (e.w || csz * 4) * 0.5;
        var drawY = e.y + rise + Math.sin(p * 20) * 1.2;
        drawY = Math.max(eHalfH + 2, Math.min(fieldH() - eHalfH - 2, drawY));
        var drawX = Math.max(eHalfW + 2, Math.min(fieldW() - eHalfW - 2, e.x));
        ctx.globalAlpha = Math.min(1, calpha);
        ctx.translate(drawX, drawY);
        ctx.rotate(Math.sin(p * 16) * 0.022);
        ctx.scale(scale, scale);

        /* 只有字：厚深色描边勾轮廓 + 亮色填充。
           ★ 描边用 lineJoin='round'，否则大字在转角处会炸出尖刺。 */
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
        ctx.lineWidth = Math.max(4, csz * 0.20);
        ctx.strokeStyle = 'rgba(8,12,10,.94)';
        ctx.strokeText(e.text, 0, csz * 0.03);
        ctx.lineWidth = Math.max(2, csz * 0.085);
        ctx.strokeStyle = 'rgba(8,12,10,.55)';
        ctx.strokeText(e.text, 0, csz * 0.03);
        ctx.fillStyle = e.color;
        ctx.fillText(e.text, 0, csz * 0.03);
        ctx.restore();
      }
    }
  }

  function draw() {
    var pb = state;
    ctx.clearRect(0, 0, fieldW(), fieldH());
    ctx.save();

    // 屏幕震动：整体平移一点，幅度很小但很有重量感
    if (shakeMag > 0.05) {
      ctx.translate((Math.random() - 0.5) * shakeMag * 2, (Math.random() - 0.5) * shakeMag * 2);
    }

    drawBg();

    /* ★★ 「阴暗领域」：压在**所有东西下面、网格线上面**的一层。
     *
     *   为什么画在这个位置（而不是和别的特效一起画在最上层）：
     *   它表达的是"这一片**地面**变黑了"，不是"天上飘了一个黑圈"。
     *   压在棋子下面 → 站在里面的棋子看起来像站在阴影里；
     *   画在上面的话，人就被一块半透明黑布盖住了，读不出谁是谁。
     *   ★ 顺序：底图 → 领域 → 网格/中线/水印 → 棋子 → 特效。
     */
    drawFields();

    // 攻势线（压在棋子下面）
    ctx.lineCap = 'round';
    for (var f = 0; f < pb.flashes.length; f++) {
      var fl = pb.flashes[f];
      var fa = 1 - fl.age / HIT_FLASH;
      if (fa <= 0) continue;
      ctx.globalAlpha = fa * 0.9;
      ctx.strokeStyle = fl.kind === 'skl' ? '#7d6cc4' : (fl.kind === 'crit' ? '#d9962f' : '#5a6b60');
      ctx.lineWidth = fl.kind === 'skl' ? 3.5 : (fl.kind === 'crit' ? 2.6 : 1.6);
      ctx.beginPath();
      ctx.moveTo(cellX(fl.from), cellY(fl.from));
      ctx.lineTo(cellX(fl.to), cellY(fl.to));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 先画阵亡的，再画活着的，活着的盖在上面
    var uid;
    for (uid in pb.units) if (!pb.units[uid].alive) drawCorpse(pb.units[uid]);
    for (uid in pb.units) {
      var u = pb.units[uid];
      if (!u.alive) continue;
      drawUnit(u, u.side === 'a' ? pb.reveal : 1);
    }

    drawFx();
    ctx.restore();
  }

  /* ============================================================
   * 「阴暗领域」的地面层
   *
   *   两件事叠在一起：**变黑** + **下雨**。
   *
   *   · 变黑：一圈径向渐变（中心最黑、边缘化开），再压一层冷色。
   *     硬边圆会看起来像一个 UI 贴图，化开才像"这一片天暗了"。
   *     ★ 透明度刻意压得比较低（中心 0.42）—— 这是**地面**，
   *       里面的棋子还得看得清是谁。
   *
   *   · 下雨：一串从上方斜着落下的短线，位置由**时间**驱动
   *     （不是随机的每帧重画）—— 随机的话雨滴会闪，看着像噪点。
   *     每滴雨用一个固定种子算出来的相位，所以它是一条条往下走的。
   *     ★ 雨滴只在圆的范围内画，用"到中心的距离"裁掉外面的。
   *     ★ 3 星/2 星的区别不用画出来：领域本身长得一样，
   *       差别在"里面的队友有没有被保护"（那是徽章和回血数字的事）。
   * ============================================================ */
  function drawFields() {
    var pb = state;
    if (!pb.fields || !pb.fields.length) return;
    for (var i = 0; i < pb.fields.length; i++) {
      var f = pb.fields[i];
      if (f.until <= state.t) continue;
      var cx = f.c * PITCH + CELL / 2, cy = f.r * PITCH + CELL / 2;
      var rad = (f.radius + 0.5) * PITCH;
      /* 出场淡入 / 退场淡出：领域是"撑起来"和"散掉"的，
         一刀切地出现和消失会让画面上像有人开关了一下灯。 */
      var age = state.t - f.born;
      var left = f.until - state.t;
      var fade = Math.min(1, age / 0.35) * Math.min(1, left / 0.5);

      ctx.save();
      /* ① 变黑：径向渐变，中心最暗、边缘化开 */
      var g = ctx.createRadialGradient(cx, cy, rad * 0.15, cx, cy, rad);
      g.addColorStop(0, 'rgba(14,18,30,' + (0.46 * fade).toFixed(3) + ')');
      g.addColorStop(0.62, 'rgba(18,24,38,' + (0.34 * fade).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(20,26,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fill();

      /* ② 下雨：一串斜线，靠时间驱动往下走 */
      ctx.strokeStyle = 'rgba(168,196,224,' + (0.34 * fade).toFixed(3) + ')';
      ctx.lineWidth = Math.max(1, CELL * 0.018);
      ctx.lineCap = 'round';
      var drops = Math.round(f.radius * f.radius * 5);   // 半径越大雨越密
      var len = CELL * 0.34, slope = CELL * 0.16;
      for (var d = 0; d < drops; d++) {
        /* ★ 位置由 d 决定（固定），纵向偏移由时间决定 ——
           所以每一滴都是**匀速往下**，而且循环回来时不会跳变
           （用 mod 把超出圆外的部分绕回上方）。 */
        var seedA = (d * 0.6180339887) % 1;              // 黄金分割铺点，比 rand 均匀
        var seedB = (d * 0.7548776662) % 1;
        var ox = (seedA * 2 - 1) * rad * 0.92;
        var span = rad * 2;
        var oy = ((seedB * span + state.t * CELL * 2.6) % span) - rad;
        if (ox * ox + oy * oy > rad * rad) continue;     // 圆的裁切
        var dx2 = cx + ox, dy2 = cy + oy;
        ctx.beginPath();
        ctx.moveTo(dx2, dy2);
        ctx.lineTo(dx2 - slope, dy2 + len);
        ctx.stroke();
      }

      /* ③ 边界：一圈冷色细线，让"领域到哪里为止"有个明确的读数
            —— 渐变边缘是化开的，光靠渐变玩家判不出到底覆盖几格。 */
      ctx.globalAlpha = 0.5 * fade;
      ctx.strokeStyle = 'rgba(120,146,186,.85)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([CELL * 0.16, CELL * 0.12]);
      ctx.beginPath();
      ctx.arc(cx, cy, rad * 0.97, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  /**
   * ★★ Dank1ng 充能过半时「端着狙击枪」的那把枪。
   *
   *   需求：充能（法力）超过一半之后，他身上要有一把端着的狙击枪。
   *
   *   ★ 为什么值得画一个形状、而不是挂一枚徽章：
   *     他 2 星起开局满能量、3 星能量回复翻倍，法力条几乎是**一直满的**——
   *     "他什么时候快开镜了"是这个角色唯一的节奏点，
   *     而法力条在混战里太小、太容易被忽略。一把枪横在卡面上，
   *     扫一眼就知道"这人已经架好了"。
   *   ★ 画法是**局部坐标 + 旋转**：先把枪按水平方向画好（枪管/机匣/枪托/
   *     瞄具/弹匣/高光），再整体转 -25°。直接算斜着的六个多边形要难读得多。
   *   ★ 颜色用冷灰 + 一道白高光：底色是花花绿绿的立绘，
   *     只有"低饱和 + 高对比"的剪影才在任何一张脸上都看得清。
   *   ★ `t` 用来做那一丁点呼吸（瞄准时的轻微晃动），静止的枪看着像贴纸。
   */
  function drawRifle(cx, cy, L, t) {
    var s = L / 100;                      // 局部坐标按"长度 100"设计
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.44);
    ctx.scale(s, s);
    /* 呼吸：±1.2 度的轻微摆动 + 0.6 的上下浮动（"端着"而不是"贴着"） */
    ctx.rotate(Math.sin(t * 2.1) * 0.021);
    ctx.translate(0, Math.sin(t * 2.6) * 0.6);

    function box(x, y, w, h, r) {
      var rr = r === undefined ? 1.5 : r;
      var x0 = x, y0 = y;
      ctx.beginPath();
      ctx.moveTo(x0 + rr, y0);
      ctx.lineTo(x0 + w - rr, y0);
      ctx.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + rr);
      ctx.lineTo(x0 + w, y0 + h - rr);
      ctx.quadraticCurveTo(x0 + w, y0 + h, x0 + w - rr, y0 + h);
      ctx.lineTo(x0 + rr, y0 + h);
      ctx.quadraticCurveTo(x0, y0 + h, x0, y0 + h - rr);
      ctx.lineTo(x0, y0 + rr);
      ctx.quadraticCurveTo(x0, y0, x0 + rr, y0);
      ctx.closePath();
      ctx.fill();
    }

    var BODY = '#3a4148', DARK = '#232a30', LITE = '#8f9aa6';

    // 枪管（细长，一直伸到画面左边）
    ctx.fillStyle = DARK;
    box(-50, -3.2, 52, 6.4, 2);
    // 枪口制退器
    ctx.fillStyle = LITE;
    box(-50, -5.4, 7, 10.8, 2);
    // 机匣（中段加厚）
    ctx.fillStyle = BODY;
    box(-4, -6, 30, 12, 2.5);
    // 弹匣
    ctx.fillStyle = DARK;
    box(6, 5, 9, 11, 2);
    // 枪托
    ctx.fillStyle = BODY;
    box(24, -7, 24, 12, 3);
    ctx.beginPath();
    ctx.moveTo(46, -7); ctx.lineTo(56, -4); ctx.lineTo(56, 3); ctx.lineTo(46, 5);
    ctx.closePath();
    ctx.fill();
    // 瞄具：一根横梁 + 两个圆环
    ctx.fillStyle = DARK;
    box(-2, -13.5, 22, 5, 2);
    ctx.strokeStyle = LITE;
    ctx.lineWidth = 2;
    var sc;
    for (sc = 0; sc < 2; sc++) {
      ctx.beginPath();
      ctx.arc(sc === 0 ? 3 : 17, -11, 3.6, 0, Math.PI * 2);
      ctx.stroke();
    }
    // 白高光：沿枪管上沿一道细线（让它在深色立绘上也浮得出来）
    ctx.strokeStyle = 'rgba(255,255,255,.62)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-49, -2.2);
    ctx.lineTo(-6, -2.2);
    ctx.stroke();
    ctx.restore();
  }

  function drawCorpse(u) {
    var x = cellX(u), y = cellY(u);
    var s = CELL * 0.30;
    ctx.save();
    ctx.globalAlpha = 0.26;
    ctx.strokeStyle = C.corpse;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - s * 0.55, y - s * 0.55); ctx.lineTo(x + s * 0.55, y + s * 0.55);
    ctx.moveTo(x + s * 0.55, y - s * 0.55); ctx.lineTo(x - s * 0.55, y + s * 0.55);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * 战斗中的单位 = 一张「卡牌」：
   * 立绘 / 阵营描边 / 费用徽章 / 星级 / 装备图标 / 名牌 / 血条(带滞后条) / 法力条
   * 外加自动寻敌的可视化：出手突进、受击后仰、命中白闪。
   *
   * ★ 卡牌**不遵循格子**：它比格子宽、比格子高，会盖到隔壁格子上。
   *   尺寸规则和准备阶段 CSS 里那套完全一致（宽 = 格子+8，高 = 格子+12），
   *   所以「棋盘 → 战斗」切换时卡牌的观感是连续的。
   */
  function drawUnit(u, alpha) {
    var cw = CELL + 6;            // 卡宽：比格子宽
    var ch = CELL + 10;           // 卡高：比格子高
    var halfW = cw / 2, halfH = ch / 2;

    // 突进 / 后仰的位移
    var ox = u.lungeDx * u.lunge * CELL * 0.10 - u.flinchDx * u.flinch * CELL * 0.07;
    var oy = u.lungeDy * u.lunge * CELL * 0.10 - u.flinchDy * u.flinch * CELL * 0.07;
    /* ★★ 祖国人「飞行」：整张卡**抬起来**画，影子留在原地。
     *   飞着这件事在 2D 俯视图里只有两个办法能表达：抬高 + 影子分开。
     *   两样都用上：卡面抬 CELL×0.16、影子缩一圈并留在格子上，
     *   于是"它悬在那一格上面"是一眼就能读出来的。 */
    var flyLift = u.flyOn ? CELL * 0.16 : 0;
    /* ★★ 丁真 3 星「小马珍珠」：他**骑着小马**打，所以整张卡也要抬起来一点，
       而且幅度比飞行小（马是贴地跑的）。小马死了之后落回地面 ——
       那一下"落地"本身就是"珍珠死了"的画面。 */
    var ponyLift = (u.ponyOn && !u.ponyDead) ? CELL * 0.09 : 0;
    var x = cellX(u) + ox;
    var y = cellY(u) + oy - flyLift - ponyLift;
    var dx = x - halfW, dy = y - halfH;

    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    /* ★★ 「遁入暗影」：整张卡片压成半透明。
     *   这是最重要的一个信号 —— 卡片还在、血条还在，但整个人淡下去了，
     *   读起来就是"它现在不在这里"。配合 🌑 徽章和"打不动"的格挡音效，
     *   玩家能立刻明白为什么对面一群人愣着不动。 */
    if (u.shadow) ctx.globalAlpha *= 0.42;
    /* ★★ 「安排上了」招安过来的单位：**卡面变灰**。
       两种手段叠着用，因为它们各有各的失效场景：
         · `ctx.filter` 是真正的"去色"，最像"灰卡"，但个别老浏览器不支持
           （不支持时会被**静默忽略**，什么都不发生）；
         · 一层半透明灰幕在哪儿都有效，但只是"蒙了灰"。
       两个一起上：最差也是"蒙了灰"，最好是真的黑白。 */
    var greyed = !!u.converted;
    if (greyed) ctx.filter = 'grayscale(1) brightness(.94)';

    // 影子贴地（不跟着突进走，也不跟着飞行抬起来）
    /* ★ 会飞的棋子影子要**小一圈**：同样的影子配上抬高的卡面，
       读起来不是"飞着"，而是"这张卡画歪了"。 */
    ctx.beginPath();
    ctx.ellipse(cellX(u), cellY(u) + halfH * 0.86,
                halfW * (u.flyOn ? 0.52 : 0.74), u.flyOn ? 2.8 : 3.8,
                0, 0, Math.PI * 2);
    ctx.fillStyle = u.flyOn ? 'rgba(38,51,43,.12)' : 'rgba(38,51,43,.17)';
    ctx.fill();

    /* ★★ 丁真的小马：骑着的这匹马得**画在卡面之前**（在卡下面），
       否则它会盖在立绘的脸上。两个马蹄 + 一个马头 + 一条尾巴，
       位置贴着卡片下沿、往右偏一点 —— 读起来就是"卡上骑着东西"。
       ★ 马死了就不画了：那一刻"马没了"本身是信息
         （配合落回地面 + 「珍珠死了」的字幕）。 */
    if (u.ponyOn && !u.ponyDead) {
      var ponyX = cellX(u) + cw * 0.20, ponyY = cellY(u) + halfH * 0.55;
      ctx.save();
      ctx.globalAlpha = 0.95;
      // 马身
      ctx.fillStyle = '#f0e2c8';
      roundRect(ponyX - cw * 0.34, ponyY - ch * 0.06, cw * 0.62, ch * 0.20, 6);
      ctx.fill();
      // 脖子 + 头
      ctx.beginPath();
      ctx.moveTo(ponyX + cw * 0.18, ponyY - ch * 0.04);
      ctx.lineTo(ponyX + cw * 0.34, ponyY - ch * 0.20);
      ctx.lineTo(ponyX + cw * 0.44, ponyY - ch * 0.14);
      ctx.lineTo(ponyX + cw * 0.26, ponyY + ch * 0.04);
      ctx.closePath();
      ctx.fill();
      // 四条腿
      ctx.fillStyle = '#dcc9a6';
      for (var pl = 0; pl < 4; pl++) {
        var lx = ponyX - cw * 0.30 + pl * cw * 0.16;
        ctx.fillRect(lx, ponyY + ch * 0.13, 2.6, ch * 0.13);
      }
      // 尾巴
      ctx.strokeStyle = '#c9b48f';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(ponyX - cw * 0.34, ponyY - ch * 0.02);
      ctx.lineTo(ponyX - cw * 0.46, ponyY + ch * 0.10);
      ctx.stroke();
      ctx.restore();
    }

    /* 星级被动「越打越快」的外发光：叠得越多、边框越亮越粗。
       画在卡面**之前**，所以它是从卡片边上透出来的一圈，
       不挡任何信息，但扫一眼就能看出「这张卡正在变强」。 */
    if (u.frenzy > 0) {
      var fp = u.frenzyCap > 0 ? Math.min(1, u.frenzy / u.frenzyCap) : 0;
      roundRect(dx - 1.5, dy - 1.5, cw + 3, ch + 3, 11);
      ctx.lineWidth = 2.5 + fp * 4;
      ctx.strokeStyle = 'rgba(240,146,26,' + (0.20 + fp * 0.55).toFixed(3) + ')';
      ctx.stroke();
    }

    /* ★ 奶龙「捧腹大笑」的金色外圈。
       大笑是一个"我很硬但我动不了"的状态，玩家必须在乱战里
       一眼扫到"这张卡现在打不动"。外圈跟着剩余时间呼吸，
       最后半秒闪起来提示"快醒了"。 */
    if (u.laughUntil >= 0 && state.t < u.laughUntil) {
      var lLeft = Math.max(0, u.laughUntil - state.t);
      var lPulse = lLeft < 0.5
        ? (Math.sin(state.t * 26) * 0.5 + 0.5)          // 快醒了：快闪
        : (Math.sin(state.t * 7) * 0.5 + 0.5);          // 平时：慢呼吸
      roundRect(dx - 2, dy - 2, cw + 4, ch + 4, 12);
      ctx.lineWidth = 3 + lPulse * 3;
      ctx.strokeStyle = (u.laughFlash > 0 ? 'rgba(255,255,255,' : 'rgba(255,206,86,')
        + (0.34 + lPulse * 0.5).toFixed(3) + ')';
      ctx.stroke();
    }

    /* ★ 张雪峰进入「狂暴」之后的红色呼吸外圈。
       狂暴是个**持续状态**（一直在烧自己的血，也一直在加速），
       光靠角落那个徽章数字不够显眼 —— 这圈描边让他在混战里一眼就能被认出来。
       每次自毁的那一瞬（ocBurnFlash）会额外亮一下，和掉血数字对上。 */
    if (u.ocOver) {
      var zhPulse = Math.sin(state.t * 9) * 0.5 + 0.5;
      roundRect(dx - 3, dy - 3, cw + 6, ch + 6, 13);
      ctx.lineWidth = 3 + zhPulse * 2.5;
      ctx.strokeStyle = (u.ocBurnFlash > 0 ? 'rgba(255,140,110,' : 'rgba(255,90,70,') +
        (0.40 + zhPulse * 0.45).toFixed(3) + ')';
      ctx.stroke();
    }

    /* ★ 楚生疑犯「遁入暗影」的冷色外圈：半透明之外再补一圈描边，
       否则在深色地面上"淡下去的卡片"和"快要阵亡的卡片"容易看混。 */
    if (u.shadow) {
      roundRect(dx - 2, dy - 2, cw + 4, ch + 4, 12);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(150,175,215,.85)';
      ctx.stroke();
    }

    /* ★ Dank1ng 耍刀期间的金白色外圈：卡片本身没什么变化（它在原地转刀），
       加一圈描边是为了让"它现在不攻击"这件事在混战里也扫得到。 */
    if (u.knifeUntil >= 0 && state.t < u.knifeUntil) {
      roundRect(dx - 1.5, dy - 1.5, cw + 3, ch + 3, 11);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(226,240,255,' +
        (0.35 + 0.35 * (Math.sin(state.t * 14) * 0.5 + 0.5)).toFixed(3) + ')';
      ctx.stroke();
    }

    // 卡面底色（没有立绘时的兜底）
    roundRect(dx, dy, cw, ch, 10);
    ctx.fillStyle = u.color;
    ctx.fill();

    var art = window.ART ? window.ART.get(u.defId) : null;
    if (art) {
      ctx.save();
      roundRect(dx, dy, cw, ch, 10);
      ctx.clip();
      drawCover(art, dx, dy, cw, ch);
      var lg = ctx.createLinearGradient(0, dy + ch * 0.54, 0, dy + ch);
      lg.addColorStop(0, 'rgba(20,28,22,0)');
      lg.addColorStop(1, 'rgba(20,28,22,.76)');
      ctx.fillStyle = lg;
      ctx.fillRect(dx, dy, cw, ch);
      ctx.restore();
    } else {
      /* ★★ 一个棋子可以挂**多个** emoji（冰冰冰 = 🧊🧊🧊）。
       *   按单字号的尺寸横着排三个，会直接冲出卡片 —— 所以按图形个数缩档。
       *   ★ 数的是"图形个数"而不是 `.length`：`'❄️'.length` 是 2，
       *     照 length 判会把单个雪花也当成两个（见 util.js 的 emojiCount）。 */
      var emN = ST.U.emojiCount(u.emoji);
      ctx.font = Math.round(ch * 0.42 * ST.U.emojiScale(emN)) +
        'px "Segoe UI Emoji", "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(u.emoji, x, y - ch * 0.09);
    }

    // 阵营描边
    roundRect(dx, dy, cw, ch, 10);
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = u.side === 'a' ? C.enemyEdge : C.mineEdge;
    ctx.stroke();

    /* ★★ 敌方卡面**略微泛红**（用户要求）。
     *
     *   混战里最难的一眼判断不是"谁快死了"，而是"这张挨打的卡是自己人还是对面"——
     *   原来只有一圈描边（我绿 / 敌红）在区分，卡面本身两边长得一模一样。
     *   现在敌方整张脸再压一层淡红 + 上沿一道更淡的红：
     *   远看是"红的一块"，近看立绘一点没被吃掉。
     *
     *   ★ 透明度只有 0.10 / 0.16：**目的是分得清，不是把立绘染色**。
     *     再重一点，敌人的立绘就认不出是谁了 —— 那是拿一个信息换另一个信息。
     *   ★ 我方**完全不染**：单向滤镜，两边的观感不会一起变调
     *     （而且"我方保持原样"本身就是一种参照）。
     *   ★ 画在**命中白闪和徽章之前**：所以被招安变灰的卡、以及各种状态徽章
     *     仍然清晰可读，红色只是底色上的一层。
     */
    if (u.side === 'a') {
      ctx.save();
      roundRect(dx, dy, cw, ch, 10);
      ctx.clip();
      ctx.fillStyle = 'rgba(196,58,46,.10)';
      ctx.fillRect(dx, dy, cw, ch);
      /* ★ 下半部分本来就有立绘的暗色渐变（名字带），只压整体的话
         "红"会被吃掉一半；上沿补一道更淡的红，远看才成立。 */
      var eg = ctx.createLinearGradient(0, dy, 0, dy + ch * 0.55);
      eg.addColorStop(0, 'rgba(214,70,56,.16)');
      eg.addColorStop(1, 'rgba(214,70,56,0)');
      ctx.fillStyle = eg;
      ctx.fillRect(dx, dy, cw, ch * 0.55);
      ctx.restore();
    }

    /* ★★ 钟离「天星」的石化：卡面压成**石灰色**（画在立绘之上、徽章之下）。
     *
     *   为什么不能只靠飘字和徽章：被石化的人站在原地不动、也打不出伤害 ——
     *   那是全场最容易被误读成"卡住了"的一类状态。
     *   整张卡蒙一层土灰，读起来就是"它现在是一块石头"。
     *   ★ 和上面那层"敌方略微泛红"同一个位置、同一个理由：
     *     血条、星级、状态徽章画在它之后，所以石化期间信息一样不少。 */
    if (u.petrifyUntil >= 0 && state.t < u.petrifyUntil) {
      ctx.save();
      roundRect(dx, dy, cw, ch, 10);
      ctx.clip();
      ctx.fillStyle = 'rgba(126,110,84,.42)';
      ctx.fillRect(dx, dy, cw, ch);
      ctx.restore();
    }

    /* ★★ Dank1ng「端着狙击枪」：充能过半就架起来。
     *   ★ 判据走数据（`killSkull` 只有他这一个技能带）而不是写死 defId ——
     *     以后再加一个"狙击型"棋子，只要技能里写 killSkull 就自动有这套表现。
     *   ★ 画在**卡面之上、徽章之下**：枪要压着立绘才像"端着"，
     *     但不能盖住费用/星级/装备那些小角标。 */
    if (u.killSkull && u.maxMana > 0 && u.mana > u.maxMana * 0.5) {
      /* 出现的那一瞬闪一下：从"空手"到"枪架好了"是一个**状态变化**，
         不提示的话玩家只会觉得"咦怎么突然多了把枪"。 */
      drawRifle(x + cw * 0.02, y + ch * 0.30, cw * 1.04, state.t);
      if (u.rifleFlash > 0) {
        ctx.save();
        ctx.globalAlpha = u.rifleFlash * 0.5;
        roundRect(dx, dy, cw, ch, 10);
        ctx.fillStyle = 'rgba(236,246,255,.5)';
        ctx.fill();
        ctx.restore();
      }
    }

    // 命中白闪
    if (u.flash > 0) {
      roundRect(dx, dy, cw, ch, 10);
      ctx.fillStyle = 'rgba(255,255,255,' + (u.flash * 0.72).toFixed(3) + ')';
      ctx.fill();
    }

    // 费用徽章（左上角）
    var bR = Math.max(7, cw * 0.135);
    var bcx = dx + bR + 2, bcy = dy + bR + 2;
    ctx.beginPath();
    ctx.arc(bcx, bcy, bR, 0, Math.PI * 2);
    ctx.fillStyle = ST.costColor(u.cost);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.stroke();
    // 4/5 费多一圈彩边，一眼看出是稀有卡
    if (u.cost >= 4) {
      ctx.beginPath();
      ctx.arc(bcx, bcy, bR + 2.5, 0, Math.PI * 2);
      ctx.strokeStyle = u.cost === 5 ? 'rgba(232,203,106,.95)' : 'rgba(164,149,224,.9)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    ctx.font = '900 ' + Math.round(bR * 1.2) + 'px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(String(u.cost), bcx, bcy + 0.5);

    // 星级（右上角）
    if (u.star > 1) {
      ctx.font = '900 ' + Math.round(cw * 0.155) + 'px "Segoe UI", sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      var sx = dx + cw - 3, sy = dy + 3;
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = 'rgba(60,45,0,.85)';
      ctx.strokeText(starText(u.star), sx, sy);
      ctx.fillStyle = '#ffd24d';
      ctx.fillText(starText(u.star), sx, sy);
    }

    // 装备图标（右下角，压在名牌上方）
    if (u.items && u.items.length) {
      /* 有图标图（art/items/<id>.png）就画图，没有才退回 emoji。
         同一张卡上两种形态可能混着出现（有的装备有图、有的还没画），
         所以两种都按同一个尺寸基准排，右边的往左依次排开。 */
      var iy2 = dy + ch - Math.round(ch * 0.24);
      var iSize = Math.round(cw * 0.19);
      var iGap = 1;
      var imgCount = 0, txt = '';
      for (var ii = 0; ii < u.items.length; ii++) {
        var iDef = ST.ITEM_BY_ID[u.items[ii]];
        if (!iDef) continue;
        if (window.ART && window.ART.itemGet(u.items[ii])) imgCount++;
        else txt += iDef.emoji;
      }
      var cursor = dx + cw - 3;
      // 先画图片（从右往左），再画 emoji 文字
      for (var ij = u.items.length - 1; ij >= 0; ij--) {
        var id2 = u.items[ij];
        var iDef2 = ST.ITEM_BY_ID[id2];
        if (!iDef2) continue;
        var iImg = window.ART ? window.ART.itemGet(id2) : null;
        if (!iImg) continue;
        ctx.drawImage(iImg, cursor - iSize, iy2 - iSize, iSize, iSize);
        ctx.strokeStyle = 'rgba(255,255,255,.9)';
        ctx.lineWidth = 1;
        ctx.strokeRect(cursor - iSize + .5, iy2 - iSize + .5, iSize - 1, iSize - 1);
        cursor -= (iSize + iGap);
      }
      if (txt) {
        ctx.font = Math.round(cw * 0.17) + 'px "Segoe UI Emoji", "Segoe UI", sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.lineWidth = 2.8;
        ctx.strokeStyle = 'rgba(20,28,22,.72)';
        ctx.strokeText(txt, cursor, iy2);
        ctx.fillStyle = '#fff';
        ctx.fillText(txt, cursor, iy2);
      }
    }

    // 名牌
    var nameH = Math.max(11, Math.round(ch * 0.20));
    var nf = Math.max(7, Math.round(cw * 0.135));
    ctx.font = '800 ' + nf + 'px "Microsoft YaHei", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, nf * 0.42);
    ctx.strokeStyle = 'rgba(20,28,22,.88)';
    ctx.strokeText(u.name, x, dy + ch - nameH / 2 - 1);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(u.name, x, dy + ch - nameH / 2 - 1);

    /* 星级被动的层数（左下角；右下角已经被装备图标占了）。
       ★ 一定要有数字。这是个「只涨不跌」的成长，但不写出来的话，
         玩家只会觉得「好像打得快了一点」，感受不到
         「我把 1 费卡养到 3 星、它现在攻速已经是 3 倍」这件事。 */
    if (u.frenzy > 0) {
      var fTxt = '⚡+' + Math.round(u.frenzy * 100) + '%';
      var fY = dy + ch - Math.round(ch * 0.24);
      ctx.font = '900 ' + Math.round(cw * 0.15) + 'px "Microsoft YaHei", "Segoe UI", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = 2.8;
      ctx.strokeStyle = 'rgba(20,28,22,.74)';
      ctx.strokeText(fTxt, dx + 3, fY);
      // 刚叠一层时闪白，到上限后固定成亮橙
      ctx.fillStyle = (u.frenzyFlash > 0)
        ? 'rgba(255,255,255,' + (0.55 + 0.45 * u.frenzyFlash).toFixed(2) + ')'
        : (u.frenzyCapped ? '#ffb037' : '#ffd98a');
      ctx.fillText(fTxt, dx + 3, fY);
    }

    /* ---------- 费用徽章正下方的一串状态徽章 ----------
     *
     * ★ 为什么每一条都必须**常驻显示**（而不是只在触发时闪一下）：
     *   这些都是「还剩多少」的资源，玩家要能随时读出来。
     *     · 抓娃娃：还能挡几次敌人攻击（鸭子全部生存能力都在这儿）
     *     · 幻觉 / 开智：这 4 秒里是被增伤还是被减伤
     *   只做瞬时特效的话，玩家看到字飘走之后根本不知道谁身上还有状态。
     *
     * ★ 两条各自占一行、从上往下叠：目前没有棋子同时有这两种，
     *   但写成叠加的就不用担心以后哪张卡两样都占。
     */
    /* ★ 招安过来的灰幕盖在**卡片正文**上（立绘 / 名字 / 血条）。
       放在徽章之前是有意的：徽章要留给玩家读（还剩几次挡、还剩几层冰棍），
       一起蒙灰会看不清。
       ★ 盖完把 filter 复原，免得把下面的徽章也一起吃掉。 */
    if (greyed) {
      ctx.filter = 'none';
      ctx.save();
      ctx.globalAlpha = (ctx.globalAlpha) * 0.24;
      ctx.fillStyle = '#5c635c';
      roundRect(dx, dy, cw, ch, 10);
      ctx.fill();
      ctx.restore();
    }

    var sbadgeY = dy + Math.round(bR * 2) + 5;
    var sbadgeFont = '900 ' + Math.round(cw * 0.145) + 'px "Segoe UI", "Microsoft YaHei", sans-serif';
    var sbadgeLine = Math.round(cw * 0.20);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 2.8;
    ctx.strokeStyle = 'rgba(20,28,22,.78)';
    function stateBadge(txt, color, flash) {
      ctx.font = sbadgeFont;
      ctx.strokeText(txt, dx + 3, sbadgeY);
      ctx.fillStyle = (flash > 0)
        ? 'rgba(255,255,255,' + (0.5 + 0.5 * flash).toFixed(2) + ')'
        : color;
      ctx.fillText(txt, dx + 3, sbadgeY);
      sbadgeY += sbadgeLine;
    }

    /* 「抓娃娃」还剩几次。★ 数字必须能看见 ——
       它是一张 95 血的鸭子，全部生存能力都押在这串次数上，
       玩家得能一眼看出"还挡得住"还是"快没了"。 */
    if (u.guardLeft > 0) {
      stateBadge('🛡' + u.guardLeft, u.guardFlash > 0 ? '#7ef0d8' : '#8fd8f0', u.guardFlash);
    }

    /* ★ 电棍的电流条数徽章：`⚡2`。
       3 星的「三相电」就是"同时最多 3 条"—— 不显示条数的话，
       玩家永远不知道自己现在挂了几条、还能不能再挂。 */
    if (u.curN > 0) {
      stateBadge('⚡' + u.curN, '#a9d8ff', 0);
    }

    /* ★ 「安排上了」招安过来的单位：常驻一个灰旗徽章。
       灰幕/filter 是"看上去灰"，但一块灰卡片也可能被读成"它快死了" ——
       挂个旗子才说得清"它现在是我方的"。 */
    if (u.converted) {
      stateBadge('🏳招安', '#cfd6cf', u.flash > 0 ? 1 : 0);
    }

    /* ★ 「和成天下5000精品大果」的自燃徽章：`🌰-6%/s`。
       带它的人每秒都在掉上限的 6%，**这是常驻状态**（不是触发一下），
       不常驻显示的话玩家只会看到一张卡的血莫名其妙一路往下掉。
       ★ 颜色跟自燃的火星对齐（暖褐），和超频那个红橙的 🔥 一眼分得开。 */
    if (u.burnMaxPct > 0) {
      stateBadge('🌰-' + Math.round(u.burnMaxPct * 100) + '%/s',
        u.burnFlash > 0 ? '#ffe0b8' : '#e0a86a', u.burnFlash);
    }

    /* ★★ ZMJJKK 2 星「闪电乒乓」的内置冷却（2026-10 加的 20 秒）：
     *   冷却期间挂一枚倒计时徽章 —— 不显示的话玩家只会以为
     *   "这球怎么有时候扔有时候不扔"，那是纯黑盒。 */
    if (u.ballCd > 0 && u.ballCdUntil >= 0 && state.t < u.ballCdUntil) {
      stateBadge('⚡球' + Math.max(0, u.ballCdUntil - state.t).toFixed(1) + 's',
        '#8fd8ff', 0);
    }

    /* ★★ 刘浩文「手机大王」：连扔期间卡面挂一枚 📱剩余N 的徽章。
     *   5 秒里到底还剩几部，是这个技能"打到哪儿了"的唯一进度提示 ——
     *   没有它，玩家只看到一堆手机在飞，不知道还要飞多久。 */
    if (u.phoneUntil >= 0 && state.t < u.phoneUntil && u.phonesLeft > 0) {
      stateBadge('📱' + u.phonesLeft, u.phoneFlash > 0 ? '#fff6d8' : '#d8a24a',
        u.phoneFlash);
    }

    /* ★★ 刘浩文「世界第一帅」：血量每少 1% 就少受 1% 伤害 ——
     *   徽章上直接写**当前**减伤百分比（跟着血量实时变）。
     *   ★ 它是这个角色最反直觉的一条（"残血反而更硬"），
     *     不写出来玩家只会觉得"对面怎么突然打不动它了"。 */
    if (u.drPerHpPct > 0 && u.maxHp > 0) {
      var drPct = Math.min(0.99, (1 - u.hp / u.maxHp) * u.drPerHpPct);
      stateBadge('🛡-' + Math.round(drPct * 100) + '%',
        drPct > 0.5 ? '#ffd98a' : '#c8d8e8', 0);
    }

    /* ★★ ZMJJKK「世一决」：队内每阵亡一人 +20% 增伤，徽章上一直写着当前总量。
     *   ★ 它是这个角色"残局更强"的唯一可见证据（不看徽章只会觉得伤害在飘）。
     *   ★ 用 🗡 而不是 ⚡：⚡ 已经是张雪峰的攻速徽章了。 */
    if (u.deathBonus > 0) {
      stateBadge('🗡+' + Math.round(u.deathBonus * 100) + '%',
        u.deathFlash > 0 ? '#ffd0d0' : '#ff8a8a', u.deathFlash);
    }

    /* ★★ ZMJJKK「霓虹激光」：这 4 秒里挂一枚 🔫×10（3 星是 ×20）徽章，
     *   让"现在的输出是平时的 5 倍"这件事有一个常驻的解释。 */
    if (u.neonUntil >= 0 && state.t < u.neonUntil) {
      stateBadge('🔫×' + Math.round(u.neonAsMul * (u.neonMul || 1)),
        u.neonFlash > 0 ? '#ffffff' : '#3ac0ff', u.neonFlash);
    }

    /* ★★ 蓝色大肥鱼「吃白饭 / TOKEN」：
     *   · 🍽×2  —— 下一口伤害翻倍（攒着的，打出去就消失）
     *   · 🍚N   —— 身上还挂着几层 TOKEN（每层换一次 ×1.5 的伤害）
     *   ★ TOKEN 的层数必须看得见：它是"什么时候该打一波"的唯一依据，
     *     不显示的话玩家只会觉得伤害忽高忽低。 */
    if (u.nextDmgMul > 1) {
      stateBadge('🍽×' + (Math.round(u.nextDmgMul * 10) / 10),
        u.flashEat > 0 ? '#d8f0ff' : '#9fd8ff', u.flashEat);
    }
    if (u.tokenStacks > 0) {
      stateBadge('🍚' + u.tokenStacks, u.flashToken > 0 ? '#fff6d8' : '#ffd98a',
        u.flashToken);
    }

    /* ★★ 鹰佐 2 星「霸体」：免控窗口里挂一枚 🛡免控 徽章（带剩余秒数）。
     *   不挂的话，玩家只会觉得"对面的控制怎么突然不好使了"。 */
    if (u.immuneUntil >= 0 && state.t < u.immuneUntil) {
      stateBadge('🛡免控' + Math.max(0, u.immuneUntil - state.t).toFixed(1) + 's',
        u.batiFlash > 0 ? '#fff6c8' : '#ffd24d', u.batiFlash);
    }

    /* ★★ 丁真「芝士雪豹」：被咬过的人 3 秒内攻速移速 -40%。
     *   徽章是"它为什么突然变慢了"的唯一解释。 */
    if (u.biteUntil >= 0 && state.t < u.biteUntil) {
      stateBadge('🐆-' + Math.round(u.biteCut * 100) + '%',
        u.biteFlash > 0 ? '#d8ffe8' : '#9ce0b8', u.biteFlash);
    }

    /* ★★ 丁真 3 星「小马珍珠」：
     *   · 小马还活着 → 一枚 🐴 徽章写着这层护盾还剩多少
     *   · 小马死了   → 换成 🔥 狂暴徽章（魔力获取 +70%）
     *   ★ 两枚互斥：马死了就不该再显示马的血量。 */
    if (u.ponyOn && !u.ponyDead) {
      stateBadge('🐴' + Math.round(u.ponyShield), '#ffd98a', 0);
    } else if (u.ponyDead) {
      stateBadge('🔥狂暴', '#ff9a6a', 0);
    }

    /* ★★ 祖国人「灼烧」：被激光点着的人**每秒掉 5% 当前生命**、连着 5 秒。
     *   徽章是"这张卡为什么一直冒火"的唯一解释，所以带剩余秒数。
     *   ★ 用 🔥 而不是 🌰：🌰 是大果那件装备的**自我**燃烧（生命上限的比例），
     *     两个都是"在烧"，但一个是挨打挨出来的、一个是被自己带的东西烧的。 */
    if (u.burnCurUntil >= 0 && state.t < u.burnCurUntil) {
      /* ★ 两把火必须一眼分得开：祖国人那把是**橙色**（有倒计时），
         鹰佐的天照是**黑紫色**（无限时间，所以不写秒数、改画 ∞）。
         混成一个颜色的话，"我被谁烧的"在画面上就读不出来。 */
      if (u.burnFreezeImmune === false && u.burnCurUntil > state.t + 1e6) {
        stateBadge('🖤天照∞', u.burnCurFlash > 0 ? '#f0d0ff' : '#c070f0',
          u.burnCurFlash);
      } else {
        stateBadge('🔥' + Math.max(0, u.burnCurUntil - state.t).toFixed(1) + 's',
          u.burnCurFlash > 0 ? '#ffd0a0' : '#ff8a3c', u.burnCurFlash);
      }
    }

    /* ★★ 钟离「玉璋护盾」：卡面上挂一枚 💠（盾还在才挂）。
     *   它同时代表**两件事**：免疫控制、少受 20% 伤害。
     *   不带徽章的话，玩家只看到"对面的眩晕怎么没生效"，
     *   而"被钟离罩着"这件事在画面上完全看不出来。
     *   ★ 判据和引擎一致（盾 > 0）—— 白条消失的那一刻徽章一起消失。 */
    if (u.wardCut > 0 && u.shield > 0) {
      stateBadge('💠免控-' + Math.round(u.wardCut * 100) + '%',
        u.wardFlash > 0 ? '#fff0c0' : '#f0c45a', u.wardFlash);
    }

    /* ★★ 钟离「天星」的石化：这 3 秒里卡片要一直写着它动不了。
     *   ★ 和眩晕的「哈哈」分开：石化是土黄的 🪨，一眼能看出是被石头封住了。 */
    if (u.petrifyUntil >= 0 && state.t < u.petrifyUntil) {
      stateBadge('🪨石化' + Math.max(0, u.petrifyUntil - state.t).toFixed(1) + 's',
        u.petrifyFlash > 0 ? '#ffe6b0' : '#c9a86a', u.petrifyFlash);
    }

    /* ★★ 东北雨姐「红薯粉丝」：被捆住的敌人**只能挨打不能跑**。
     *   这枚徽章是"它为什么站着不动"的**唯一**解释 ——
     *   不带秒数的话，玩家看到的是"这张卡发呆了三秒"。
     *   ★ 图标和眩晕那套分得开：眩晕是金色的环 + 哈哈，捆住是琥珀色的 🍜。 */
    if (u.rootUntil >= 0 && state.t < u.rootUntil) {
      stateBadge('🍜' + Math.max(0, u.rootUntil - state.t).toFixed(1) + 's',
        u.rootFlash > 0 ? '#ffe0b0' : '#e8b46a', u.rootFlash);
    }

    /* ★★ 攻速增益（双刃舞者的「疾风连斩」/ 美团袋鼠 2 星的「准时送达」）。
     *   挂 5 秒的一个状态，而"它现在打得快了"在画面上**完全看不出来** ——
     *   徽章是唯一能说明"这 5 秒里它为什么变快"的东西。
     *   ★ 图标用 🛵 而不是 ⚡：⚡ 已经是张雪峰「超频」的自增攻速了，
     *     两个都是攻速加成、都会显示百分比，混用会让玩家以为是同一件事。 */
    if (u.asBuffPct > 0 && state.t < u.asBuffUntil) {
      stateBadge('🛵+' + Math.round(u.asBuffPct * 100) + '%',
        u.asBuffFlash > 0 ? '#ffe0b0' : '#ffb45a', u.asBuffFlash);
    }

    /* ★ 张雪峰的超频攻速。越过阈值之后变成红色 ——
       那一瞬间开始他就在烧自己的血了，这个颜色是唯一的长期提示。 */
    if (u.oc > 0) {
      /* ★ 顶到上限时把「+」换成「满」，颜色改成金色。
         不这么写的话数字停在 200 不动，玩家会以为卡住了。 */
      var zhFull = (u.ocMax > 0 && u.oc >= u.ocMax - 1e-9);
      stateBadge(
        (u.ocOver ? '🔥' : '⚡') + (zhFull ? '满' : '+') + Math.round(u.oc * 100) + '%',
        zhFull ? '#ffd98a'
               : (u.ocBurnFlash > 0 ? '#ff8a6a' : (u.ocOver ? '#ff6a4a' : '#ffd98a')),
        Math.max(u.ocFlash, u.ocBurnFlash, u.ocOverFlash));
    }

    /* ★ 冰棍层数。10 层就冻住，所以玩家要能数得出来还差几层。 */
    if (u.chill > 0) {
      stateBadge('❄' + u.chill + (u.chillMax ? '/' + u.chillMax : ''),
        u.chillFlash > 0 ? '#ffffff' : '#b6e6ff', u.chillFlash);
    }

    /* ★ 奶龙「捧腹大笑」：3 秒里挨打几乎不掉血，但还不了手。
       徽章带上剩余秒数 —— 玩家要能看出"这货什么时候能醒"。 */
    if (u.laughUntil >= 0 && state.t < u.laughUntil) {
      stateBadge('😂' + Math.max(0, u.laughUntil - state.t).toFixed(1) + 's',
        u.laughFlash > 0 ? '#ffffff' : '#ffce56', u.laughFlash);
    }

    /* ★ 羊帆「羊巅峰」的蓄势徽章。
       ★★ 这一枚是**必须**有的：20 倍伤害是这个角色一整局唯一的高光，
          而"蓄势"是一段看不见的状态（它身上没有任何别的表现）。
          玩家看到伤害数字突然大 20 倍，如果事先不知道"这一发是大的"，
          只会以为数值出错了。 */
    if (u.peakReady) {
      stateBadge('🐑×20', '#ffd24d', 0);
    }

    /* ★ 楚生疑犯「遁入暗影」的徽章。
       ★★ 这个状态必须一眼看得出来：它**免疫一切伤害、也不会被索敌**，
          画面上如果什么都不说，玩家只会看到"对面一群人站着不动、
          我的这个棋子血条一直是满的" —— 那看起来像 bug。 */
    if (u.shadow) {
      stateBadge('🌑暗影', '#9fb6d4', 0);
    }

    /* ★ Dank1ng 的两枚徽章：
       🔪 耍刀中（这 3 秒它不攻击 —— 不标的话玩家会以为它卡住了）
       ♾️ 空悲切（法力永远满格，这是全队死光之后的绝境状态） */
    if (u.knifeUntil >= 0 && state.t < u.knifeUntil) {
      stateBadge('🔪耍刀', '#e2f0ff', u.knifeFlash);
    }
    if (u.endless) {
      stateBadge('♾️空悲切', '#ff9a7a', 0);
    }

    /* 「幻觉 / 开智」挂的伤害改动 */
    if (u.buffMul !== 1 && state.t < u.buffUntil) {
      var gGood = u.buffMul > 1;
      stateBadge((gGood ? '↑+' : '↓-') + Math.round(Math.abs(u.buffMul - 1) * 100) + '%',
        gGood ? '#ffd66e' : '#d6b0f5', u.buffFlash);
    }

    // ---- 血条（含护盾 + 血色滞后条）----
    if (u.maxHp > 1) {
      var bw = cw, bh = Math.max(5, Math.round(ch * 0.085));
      var bx = dx, by = dy - bh - 3;

      ctx.fillStyle = C.barBg;
      ctx.fillRect(bx, by, bw, bh);

      var hpFrac = Math.max(0, Math.min(1, u.hp / u.maxHp));
      var lagFrac = Math.max(0, Math.min(1, Math.max(u.hp, u.hpLag) / u.maxHp));
      if (lagFrac > hpFrac + 0.003) {
        ctx.fillStyle = C.hpLag;
        ctx.fillRect(bx + bw * hpFrac, by, bw * (lagFrac - hpFrac), bh);
      }
      ctx.fillStyle = u.side === 'a' ? C.hpEnemy : C.hpMine;
      ctx.fillRect(bx, by, bw * hpFrac, bh);
      if (u.shield > 0) {
        var shFrac = Math.min(1, u.shield / u.maxHp);
        ctx.fillStyle = C.shield;
        ctx.fillRect(bx + bw * hpFrac, by, Math.min(bw * (1 - hpFrac), bw * shFrac), bh);
      }
      ctx.strokeStyle = 'rgba(38,51,43,.22)';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + .5, by + .5, bw - 1, bh - 1);

      // 法力条
      var mh = 3, my = dy + ch + 3;
      ctx.fillStyle = C.barBg;
      ctx.fillRect(bx, my, bw, mh);
      ctx.fillStyle = C.mana;
      ctx.fillRect(bx, my, bw * Math.min(1, u.mana / u.maxMana), mh);
      /* ★★ Dank1ng 的法力条上多一道**半程刻度**：
       *   他的枪是在"充能过半"那一刻架起来的，不把这条线画出来，
       *   玩家只会觉得"咦怎么突然多了把枪"。一根 1px 的浅色线，
       *   就把"枪的出现"和"条子走到一半"挂上了因果关系。 */
      if (u.killSkull) {
        ctx.fillStyle = 'rgba(255,255,255,.72)';
        ctx.fillRect(bx + bw * 0.5 - 0.5, my - 1, 1, mh + 2);
      }

      if (debug) {
        var dtxt = Math.round(u.hp) + (u.shield > 0 ? '+' + Math.round(u.shield) : '');
        ctx.font = '900 10px Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(20,28,22,.8)';
        ctx.strokeText(dtxt, x, by - 7);
        ctx.fillStyle = '#fff';
        ctx.fillText(dtxt, x, by - 7);
      }
    }
    ctx.restore();
  }
})();
