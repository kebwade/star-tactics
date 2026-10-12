/* ============================================================
 * 科币战争 — 游戏集成测试
 *
 * 存在的理由很实际：**我没法手动玩这个游戏。**
 * 所以这里把「玩家会做的事」写成脚本，让无头浏览器真的去点：
 *   封面 → 人机模式 → 商店买棋子 → 上场 → 刷新 → 买经验
 *   → 合成升星 → 装装备 → 开战 → 结算 → 进下一关 / 重来 / 通关 / 战败
 *
 * 每一步都断言「界面上看得见的东西」和「状态里的东西」一致 ——
 * 因为这一类 bug（状态变了但界面没跟上）靠读代码是看不出来的。
 * ============================================================ */
(function () {
  'use strict';

  var TH = window.TH;
  var f = document.getElementById('game');
  var W = null, D = null;
  var errs = [];

  function $(id) { return D.getElementById(id); }
  function q(sel) { return D.querySelector(sel); }
  function qa(sel) { return Array.prototype.slice.call(D.querySelectorAll(sel)); }
  function txt(id) { var e = $(id); return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; }
  function G() { return W.Game.state(); }
  function gold() { return G().gold; }
  function boardN() { return Object.keys(G().board).length; }
  function benchN() { return G().bench.filter(Boolean).length; }

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function click(el) { if (el) el.click(); }

  /**
   * 把 CSS 变量解析成真正的像素值。
   *
   * ★ 不能写 parseFloat(getComputedStyle(root).getPropertyValue('--x'))：
   *   自定义属性的计算值保留的是原样的 token 流，不是算完的数。
   *   以前 --arena-cell 是一个字面量 84px，这么读碰巧能work；
   *   现在它写成 min(var(--arena-cap), var(--arena-w)) 来适配屏幕宽度，
   *   同一句读出来就是 NaN，断言随之误报 ——
   *   测试和被测代码犯同一个错，是最难发现的一类假失败。
   */
  function varPx(name) {
    var probe = D.createElement('div');
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;height:0;width:var(' + name + ')';
    D.body.appendChild(probe);
    var px = probe.getBoundingClientRect().width;
    D.body.removeChild(probe);
    return px;
  }

  /** 判断当前是不是浅色主题（用亮度公式，比直接比字符串稳） */
  function isLightTheme() {
    var c = D.defaultView.getComputedStyle(D.body).color;
    var m = c.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    if (!m) return false;
    var lum = 0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3];
    return lum < 128;   // 文字是深色的 → 浅色主题
  }
  function bgLum(sel) {
    var e = typeof sel === 'string' ? q(sel) : sel;
    if (!e) return -1;
    var c = D.defaultView.getComputedStyle(e).backgroundColor;
    var m = c.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    if (!m) return -1;
    return Math.round(0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]);
  }

  /* ============================================================
   * 一b、自动更新（让"页面已经开着"的人也能立刻拿到新版）
   *
   *   规则在部署脚本那一侧（盖版本戳 + 写 version.json），
   *   这里只守页面这一侧必须成立的三件事：
   *     ① 有 app-version 占位（部署脚本往里填号，uptodate.js 拿它比对）；
   *     ② 页面真的加载了 uptodate.js；
   *     ③ **每个本地 js/css 地址都是"相对路径 + .js/.css"** ——
   *        部署脚本就是靠这个形状的正则盖 `?v=` 的。
   *        哪天有人换成 CDN、改成 .mjs、或者写成绝对路径，
   *        版本戳会**静默地**盖不上，于是"改了也没人拿到新版"，
   *        而所有测试都还是绿的 —— 所以必须有这条把形状钉住。
   * ============================================================ */
  async function testAutoUpdate() {
    TH.section('自动更新');

    var meta = D.querySelector('meta[name="app-version"]');
    TH.ok('页面里有 app-version 占位（部署脚本会把版本号填进去）', !!meta,
      meta ? ('content="' + meta.getAttribute('content') + '"') : '没找到');
    /* ★ 本地副本上它必须是空的：不空的话，本地打开也会去比对线上版本、
       然后把自己刷到线上那一版 —— 开发时会被自己的部署踢走。 */
    TH.eq('★ 本地副本上的版本号是空的 → 自动更新完全静默',
      meta ? meta.getAttribute('content') : '（没有这个 meta）', '');

    var up = null;
    var allScripts = D.querySelectorAll('script[src]');
    for (var i = 0; i < allScripts.length; i++) {
      if (allScripts[i].getAttribute('src').indexOf('uptodate.js') >= 0) up = allScripts[i];
    }
    TH.ok('页面加载了 js/uptodate.js（比对 version.json，有新版本就换地址）', !!up,
      up ? up.getAttribute('src') : '没找到');
    TH.eq('★ 本地双击打开时不检查（file:// 下没有线上版本，fetch 也会被 CORS 挡）',
      W.location.protocol, 'file:');

    var badJs = [], badCss = [];
    for (var j = 0; j < allScripts.length; j++) {
      var s = allScripts[j].getAttribute('src');
      if (!/^[^:?]+\.js(\?|$)/.test(s)) badJs.push(s);
    }
    var sheets = D.querySelectorAll('link[rel="stylesheet"]');
    for (var k = 0; k < sheets.length; k++) {
      var h = sheets[k].getAttribute('href');
      if (!/^[^:?]+\.css(\?|$)/.test(h)) badCss.push(h);
    }
    TH.eq('★ 每个 <script src> 都是"相对路径 + .js"（部署脚本靠这个形状盖版本戳）',
      badJs.join(' '), '');
    TH.eq('★ 每个样式表都是"相对路径 + .css"', badCss.join(' '), '');
    TH.note('这一页共 ' + allScripts.length + ' 个脚本 / ' + sheets.length +
      ' 个样式表，全部可被版本戳覆盖');
  }

  /* ============================================================
   * 一、封面
   * ============================================================ */
  async function testCover() {
    TH.section('封面');

    TH.ok('页面没有 JS 报错', errs.length === 0, errs.join(' || '));
    TH.ok('封面场景可见', $('scene-cover').classList.contains('scene-on'));
    TH.eq('三个入口按钮', qa('.menu-btn').length, 3);

    // 名字
    var h1 = q('#scene-cover h1');
    TH.eq('游戏名是「科币战争」', h1 ? h1.textContent.trim() : '(没有 h1)', '科币战争');
    var sub = q('#scene-cover .logo-sub');
    TH.eq('副标题是「—— 巴巴博弈 ——」', sub ? sub.textContent.trim() : '(没有副标题)', '—— 巴巴博弈 ——');

    // 名字要够大
    if (h1) {
      var fs = parseFloat(D.defaultView.getComputedStyle(h1).fontSize);
      TH.ok('游戏名字号够大（>= 48px）', fs >= 48, fs + 'px');
    }

    TH.ok('背景有飘浮的棋子', qa('.float-unit').length >= 8, qa('.float-unit').length + ' 个');
    TH.ok('封面有山谷背景（SVG 远山 + 薄雾带）',
      qa('#scene-cover .valley-svg use').length >= 1 && qa('#scene-cover .mist-band').length >= 2,
      qa('#scene-cover .valley-svg use').length + ' 组远山 / ' + qa('#scene-cover .mist-band').length + ' 条雾');
    TH.ok('远山分层（至少要 3 道山脊才像山谷）', (function () {
      var g = D.querySelector('#valleyGroup');
      if (!g) return false;
      var paths = g.querySelectorAll('path');
      return paths.length >= 3;
    })(), '山脊数 = ' + (function () {
      var g = D.querySelector('#valleyGroup');
      return g ? g.querySelectorAll('path').length : 0;
    })());
    TH.ok('封面是浅色主题（背景亮度高）', isLightTheme(), 'body 背景 = ' + D.defaultView.getComputedStyle(D.body).backgroundColor);

    var pvp = $('btn-pvp');
    TH.ok('对战模式看起来是锁着的', pvp.classList.contains('locked'));
    // 关键：不能用 disabled 属性 —— 被禁用的按钮根本不会触发 click，
    // 玩家点了没反应会以为界面坏了。要用 aria + 样式表达不可用。
    TH.ok('对战模式没有用 disabled 属性（否则点击事件根本不会触发）',
      !pvp.hasAttribute('disabled'));
    TH.eq('对战模式用 aria-disabled 表达不可用', pvp.getAttribute('aria-disabled'), 'true');

    click(pvp);
    await wait(160);
    var toasts = qa('#toasts .toast').map(function (t) { return t.textContent; });
    TH.ok('点对战模式弹出「暂未开放」提示',
      toasts.join('|').indexOf('暂未开放') >= 0, toasts.join('|') || '(没有 toast)');
  }

  /* ============================================================
   * 二、设置
   * ============================================================ */
  async function testSettings() {
    TH.section('设置');

    click($('btn-settings'));
    await wait(200);
    TH.ok('设置弹窗打开了', !!q('#modal-wrap .modal'));

    var ranges = qa('.set-range');
    TH.eq('四个滑条：总音量 / 音效 / 音乐 / 亮度', ranges.length, 4);

    var labels = qa('.set-label').map(function (e) { return e.textContent; });
    TH.ok('滑条标签是声音和亮度', labels.join('/').indexOf('亮度') >= 0 && labels.join('/').indexOf('音量') >= 0,
      labels.join('、'));

    // 拖动音量滑条 → 设置值真的变了，并且作用到音频引擎上
    var before = W.Settings.data.master;
    ranges[0].value = '0.20';
    if (ranges[0].oninput) ranges[0].oninput();
    await wait(60);
    TH.ok('拖动总音量会写进设置', Math.abs(W.Settings.data.master - 0.20) < 0.001,
      before + ' → ' + W.Settings.data.master);
    TH.ok('音量真的传给了音效引擎', Math.abs(W.UI.sound.getVolume('master') - 0.20) < 0.001,
      'sound master = ' + W.UI.sound.getVolume('master'));

    // 亮度 → CSS filter
    var bRange = ranges[3];
    bRange.value = '0.70';
    if (bRange.oninput) bRange.oninput();
    await wait(60);
    var filter = $('app').style.filter;
    TH.ok('调亮度会改画面的 CSS filter', filter.indexOf('brightness') >= 0, 'filter = ' + JSON.stringify(filter));
    TH.ok('亮度设置被记住了', Math.abs(W.Settings.data.brightness - 0.70) < 0.001);

    // 恢复默认
    var resetBtn = qa('.set-foot .btn')[0];
    click(resetBtn);
    await wait(80);
    TH.ok('恢复默认能还原音量', Math.abs(W.Settings.data.master - 0.75) < 0.001,
      'master = ' + W.Settings.data.master);

    // localStorage 持久化
    TH.ok('设置会尝试写进 localStorage（file:// 下允许失败，不能崩）',
      W.Settings.available === true || W.Settings.available === false,
      'available = ' + W.Settings.available);

    W.UI.closeModal();
    await wait(260);
    TH.ok('设置弹窗能关掉', !q('#modal-wrap .modal'));
  }

  /* ============================================================
   * 三、进入人机模式
   * ============================================================ */
  async function testEnterPve() {
    TH.section('进入人机模式');

    click($('btn-pve'));
    await wait(700);

    TH.eq('切到准备阶段场景', W.UI.current(), 'scene-game');
    TH.ok('第一关的标题显示出来了', txt('hud-stage').indexOf('第一关') >= 0, txt('hud-stage'));
    TH.eq('关卡进度显示为 1/24', txt('hud-stage-sub'), '第 1 / 24 关');

    TH.ok('初始金币是 10 + 第一回合收入', gold() >= 10, gold() + ' 金');
    TH.eq('初始生命 100', G().hp, 100);
    TH.eq('初始等级 2', G().lvl, 2);

    TH.eq('商店有 5 张卡', qa('#shop-row .shop-card').length, 5);
    TH.ok('商店 5 张卡都是有内容的',
      qa('#shop-row .shop-card .sc-name').length === 5,
      qa('#shop-row .shop-card .sc-name').length + ' 张有名字');

    TH.eq('我方半场 8×4 = 32 格（地图扩到 8 列）', qa('#player-half .cell').length, 32);
    TH.eq('我方格子标了坐标', qa('#player-half .cell[data-r]').length, 32);
    TH.eq('距离中线最近的格子标了 front-row', qa('#player-half .cell.front-row').length, 8);
    TH.eq('备战池 9 格', qa('#bench .bench-cell').length, 9);

    // ★ 需求：选卡（准备）界面不要有对面的阵容。
    //   所以这里连「敌方半场」这个元素都不该存在。
    TH.eq('准备界面里没有敌方半场这个元素', qa('#enemy-half').length, 0);
    TH.eq('准备界面里没有任何敌方棋子', qa('#scene-game .enemy-cell').length, 0);
    // 全场景的棋子数 == 自己拥有的棋子数（一个都不能是敌人的）
    var myUnits = W.Game.owned().length;
    var domUnits = qa('#scene-game .u').length;
    TH.eq('准备界面上的棋子数正好等于自己拥有的数量', domUnits, myUnits);

    // 对手情报：给名字和模糊提示，但不给阵容
    TH.ok('显示了对手名字', txt('enemy-name').length > 0, txt('enemy-name'));
    TH.ok('显示了威胁等级', txt('enemy-threat').indexOf('★') >= 0, txt('enemy-threat'));
    TH.ok('显示了体系推测', txt('enemy-arch').indexOf('体系推测') >= 0, txt('enemy-arch'));
    TH.ok('给了模糊情报', txt('enemy-hint').length > 4, txt('enemy-hint'));
    var cardText = txt('enemy-card');
    var lv1 = W.ST.LEVELS[0];
    var leakedUnit = false;
    for (var i = 0; i < lv1.comp.length; i++) {
      var nm = W.ST.UNIT_BY_ID[lv1.comp[i].id].name;
      if (cardText.indexOf(nm) >= 0) leakedUnit = true;
    }
    TH.ok('对手情报卡没有泄露任何棋子名字', !leakedUnit, cardText.slice(0, 80));

    TH.ok('回合记录有内容', qa('#mini-log .log-line').length >= 2,
      qa('#mini-log .log-line').length + ' 条');
    TH.ok('开战按钮在没上人时是禁用样式', $('btn-fight').classList.contains('disabled'));
    TH.eq('上场数显示 0/2', txt('hud-field'), '0/2');
  }

  /* ============================================================
   * 三b、布局要求：商店在顶、阵容在正中、备战池在底、卡牌够大
   * ============================================================ */
  async function testLayout() {
    TH.section('布局');

    /* 量几何之前先把 CSS 动画关掉。
     *
     * 无头浏览器不驱动 rAF，场景入场动画会永久停在起始帧；
     * 只要起始帧带位移或缩放（scenePop 就是），量出来的就是「动画中途」的几何，
     * 而不是布局本身。这跟布局对不对无关，却能让几何断言随机假失败 ——
     * 所以这里显式关掉动画，只留布局规则起作用。 */
    if (D && !D.getElementById('no-anim')) {
      var noAnim = D.createElement('style');
      noAnim.id = 'no-anim';
      noAnim.textContent = '*,*::before,*::after{animation:none !important}';
      D.head.appendChild(noAnim);
    }

    var shop = q('.prep-shop'), bench = q('.prep-bench'), board = q('.board-center');
    TH.ok('商店 / 棋盘 / 备战池三个区域都在', !!shop && !!bench && !!board);
    if (!shop || !bench || !board) return;

    var rs = shop.getBoundingClientRect();
    var rb = bench.getBoundingClientRect();
    var rd = board.getBoundingClientRect();
    var vw = D.documentElement.clientWidth;

    TH.ok('商店在屏幕顶端', rs.top < rd.top,
      '商店 top=' + Math.round(rs.top) + '　棋盘 top=' + Math.round(rd.top));
    TH.ok('备战池在屏幕底端', rb.top > rd.top + rd.height - 4,
      '棋盘底=' + Math.round(rd.top + rd.height) + '　备战池 top=' + Math.round(rb.top));

    var center = rd.left + rd.width / 2;
    TH.ok('自己阵容在水平正中', Math.abs(center - vw / 2) < 26,
      '棋盘中心 ' + Math.round(center) + '　屏幕中心 ' + Math.round(vw / 2));

    /* ★ 棋盘不能压到任何邻居，也不能被裁掉。
     *
     *   这不是假想出来的检查：8 列地图把 --cell 顶到 96px 那一次，
     *   棋盘比它所在的 .prep-mid 还高，溢出以后直接盖在对手情报条和
     *   回合记录上面。而 body 是 overflow:hidden、场景是绝对定位，
     *   页面 scrollHeight 一点都不会变 —— 只看滚动条和截图都发现不了，
     *   必须真的比几何。 */
    (function () {
      var bd = q('.board-center').getBoundingClientRect();
      var hits = [];
      [['商店', '.prep-shop'], ['备战池', '.prep-bench'],
       ['左栏', '.prep-side.left'], ['右栏', '.prep-side.right'], ['HUD', '#scene-game .hud']]
        .forEach(function (n) {
          var e = q(n[1]); if (!e) return;
          var r = e.getBoundingClientRect();
          if (bd.left < r.right - 1 && r.left < bd.right - 1 &&
              bd.top < r.bottom - 1 && r.top < bd.bottom - 1) hits.push(n[0]);
        });
      TH.eq('棋盘不压商店 / 备战池 / 左右栏 / HUD', hits.join(',') || '无', '无');

      var vh = D.documentElement.clientHeight;
      var low = 0;
      qa('#scene-game .prep-shop, #scene-game .prep-main, #scene-game .prep-bench, #scene-game .hud')
        .forEach(function (e) { low = Math.max(low, e.getBoundingClientRect().bottom - vh); });
      TH.ok('准备阶段内容都在视口内（底部没被裁掉）', low <= 1,
        '最低超出 ' + Math.round(low) + 'px');

      var sr = shop.getBoundingClientRect();
      TH.ok('商店不超出视口宽度', sr.right <= vw + 1 && sr.left >= -1,
        Math.round(sr.left) + ' ~ ' + Math.round(sr.right) + '　视口 ' + vw);

      /* --cell 是由视口算出来的（不是写死的），所以地图必须真的放得下：
         既要塞进左右栏之间，也要塞进商店和备战池之间。 */
      var cw0 = q('#player-half .cell').getBoundingClientRect().width;
      var lr = q('.prep-side.left').getBoundingClientRect();
      var rr = q('.prep-side.right').getBoundingClientRect();
      var gridW = cw0 * 8 + 8 * 7;
      TH.ok('地图横向塞得进左右栏之间', gridW <= (rr.left - lr.right) + 1,
        '地图 ' + Math.round(gridW) + '　可用 ' + Math.round(rr.left - lr.right));
      var pm = q('.prep-main').getBoundingClientRect();
      var gridH = cw0 * 4 + 8 * 3;
      TH.ok('地图纵向塞得进准备区（含标签）', gridH + 40 <= pm.height + 1,
        '地图 ' + Math.round(gridH) + ' + 标签　准备区 ' + Math.round(pm.height));
    })();

    var card = q('#shop-row .shop-card');
    var cr = card.getBoundingClientRect();
    TH.ok('商店卡牌变大了（宽 >= 120px）', cr.width >= 120,
      Math.round(cr.width) + '×' + Math.round(cr.height) + ' px');
    TH.eq('商店正好 5 张卡', qa('#shop-row .shop-card').length, 5);

    var cellW = q('#player-half .cell').getBoundingClientRect().width;
    TH.ok('地图格子够大（>= 66px）', cellW >= 66, Math.round(cellW) + 'px');

    // 商店卡：立绘铺满 + 费用徽章 + 价格 + 名字带 + 羁绊小字（对齐金铲铲）
    TH.eq('每张卡都有立绘层', qa('#shop-row .sc-art').length, 5);
    TH.eq('每张卡都有费用徽章', qa('#shop-row .sc-badge').length, 5);
    TH.eq('每张卡都有价格', qa('#shop-row .sc-price').length, 5);
    TH.eq('每张卡都有名字带', qa('#shop-row .sc-nameband').length, 5);
    TH.eq('每张卡都写了羁绊', qa('#shop-row .sc-traits').length, 5);
    TH.eq('立绘加载失败时会退回 emoji（不用等图片就能看）',
      qa('#shop-row .sc-fallback').length, 5);
    TH.ok('名字带压在卡底部（覆盖在立绘上）', (function () {
      var c = q('#shop-row .shop-card'), b = q('#shop-row .sc-nameband');
      if (!c || !b) return false;
      var rc = c.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return Math.abs(rb.bottom - rc.bottom) < 3 && rb.height > 20;
    })());
    TH.ok('卡牌是竖长条（高/宽 >= 1.15）', cr.height / cr.width >= 1.15,
      Math.round(cr.width) + '×' + Math.round(cr.height) + '　比例 ' + (cr.height / cr.width).toFixed(2));

    // 商店概率条 + 锁定（云顶商店的标配）
    TH.ok('商店显示了抽卡概率', qa('#shop-odds .odd').length >= 1,
      qa('#shop-odds .odd').length + ' 档');
    TH.ok('概率条有填充宽度', (function () {
      var i = q('#shop-odds .od-bar i');
      return !!i && !!i.style.width && parseFloat(i.style.width) > 0;
    })(), (function () { var i = q('#shop-odds .od-bar i'); return i ? i.style.width : 'none'; })());
    TH.ok('商店有锁定按钮', !!$('btn-lock'));

    // ★ 刷新 / 买经验必须是「显眼的大按钮」
    var rr = $('btn-reroll'), xp = $('btn-xp');
    TH.ok('刷新和买经验都是独立的大按钮（不是缩在标题旁的小灰按钮）',
      !!rr && !!xp && rr.classList.contains('big-btn') && xp.classList.contains('big-btn'));
    if (rr && xp) {
      var rrb = rr.getBoundingClientRect(), xpb = xp.getBoundingClientRect();
      TH.ok('刷新按钮够大（>= 180×80）', rrb.width >= 180 && rrb.height >= 80,
        Math.round(rrb.width) + '×' + Math.round(rrb.height));
      TH.ok('买经验按钮够大（>= 180×80）', xpb.width >= 180 && xpb.height >= 80,
        Math.round(xpb.width) + '×' + Math.round(xpb.height));
      TH.ok('刷新按钮用高饱和渐变（蓝绿）',
        D.defaultView.getComputedStyle(rr).backgroundImage.indexOf('gradient') >= 0,
        D.defaultView.getComputedStyle(rr).backgroundImage.slice(0, 70));
      TH.ok('买经验按钮用高饱和渐变（金铜）',
        D.defaultView.getComputedStyle(xp).backgroundImage.indexOf('gradient') >= 0,
        D.defaultView.getComputedStyle(xp).backgroundImage.slice(0, 70));
      var c1 = rr.querySelector('.bb-cost'), c2 = xp.querySelector('.bb-cost');
      TH.ok('两个按钮都标了花费', !!c1 && !!c2,
        (c1 ? c1.textContent : '?') + ' / ' + (c2 ? c2.textContent : '?'));
      TH.ok('买经验按钮上直接写了「还差多少升级」',
        txt('xp-hint').indexOf('还差') >= 0 || txt('xp-hint').indexOf('最高等级') >= 0,
        JSON.stringify(txt('xp-hint')));
      TH.ok('买经验按钮上有经验进度条', !!$('xp-bar-fill'),
        '宽度 = ' + ($('xp-bar-fill') ? $('xp-bar-fill').style.width : 'n/a'));
      TH.ok('刷新/升级排在商店卡右侧一列（金铲铲的布局）', (function () {
        var row = q('.shop-row'), acts = q('.shop-actions');
        if (!row || !acts) return false;
        return acts.getBoundingClientRect().left >= row.getBoundingClientRect().right - 2;
      })());
    }

    // ★ 卡牌不遵循格子：比格子大、溢出到格外，但棋盘总尺寸不受影响
    (function () {
      // 先放一个棋子上场，否则量不到卡牌
      var st0 = W.Game.state();
      st0.board = { '4,2': { uid: 'grid1', defId: 'bowman', star: 2, items: ['belt'] } };
      W.Game.refresh();
      var chip = q('#player-half .u');
      if (!chip) { TH.fail('卡牌溢出格子的检查', '棋盘上没有卡牌可量'); return; }
      // 注意：必须拿卡牌自己所在的那个格子来比 ——
      // 用 querySelector 拿的第一个格子是第 0 列，卡牌却在第 2 列，
      // 一比就会得出「偏移 149px」这种假失败。
      var cell = chip.parentNode;
      var cr = cell.getBoundingClientRect(), ur = chip.getBoundingClientRect();
      TH.ok('卡牌比格子更宽（不遵循格子）', ur.width > cr.width + 2,
        '格子 ' + Math.round(cr.width) + 'px　卡牌 ' + Math.round(ur.width) + 'px');
      TH.ok('卡牌比格子更高（不遵循格子）', ur.height > cr.height + 4,
        '格子 ' + Math.round(cr.height) + 'px　卡牌 ' + Math.round(ur.height) + 'px');
      TH.ok('格子允许卡牌溢出（overflow: visible）',
        D.defaultView.getComputedStyle(cell).overflow === 'visible',
        D.defaultView.getComputedStyle(cell).overflow);
      TH.ok('卡牌在格子里居中（溢出左右对称）',
        Math.abs((cr.left - ur.left) - (ur.right - cr.right)) < 2,
        '左溢出 ' + Math.round(cr.left - ur.left) + 'px　右溢出 ' + Math.round(ur.right - cr.right) + 'px');
      TH.ok('卡牌竖直方向也大致居中',
        Math.abs((cr.top - ur.top) - (ur.bottom - cr.bottom)) < 4,
        '上溢出 ' + Math.round(cr.top - ur.top) + 'px　下溢出 ' + Math.round(ur.bottom - cr.bottom) + 'px');

      /* ★ 位置严谨性：整排摆满（2 行 × 8 列 16 张）时逐个量。
       *   之前只量了一张卡，量不出「相邻卡牌互相压住」这种问题；
       *   而卡牌比格子大，一旦 --gap 不够就会溢出到邻居身上。 */
      (function () {
        var st1 = W.Game.state();
        st1.board = {};
        var COLS = W.ST.BATTLE_CFG.COLS;
        [4, 7].forEach(function (r) {
          for (var c = 0; c < COLS; c++) st1.board[r + ',' + c] = { uid: 'f' + r + c, defId: 'bowman', star: 1, items: [] };
        });
        W.Game.refresh();
        var chips = qa('#player-half .u');
        TH.eq('整排摆满时 2 行 × 8 列都画出来了', chips.length, COLS * 2);
        if (chips.length !== COLS * 2) { st1.board = {}; W.Game.refresh(); return; }

        var maxDx = 0, maxDy = 0, rows = {};
        chips.forEach(function (el) {
          var ur = el.getBoundingClientRect();
          var cr2 = el.parentNode.getBoundingClientRect();
          maxDx = Math.max(maxDx, Math.abs((ur.left + ur.width / 2) - (cr2.left + cr2.width / 2)));
          maxDy = Math.max(maxDy, Math.abs((ur.top + ur.height / 2) - (cr2.top + cr2.height / 2)));
          var k = Math.round(ur.top);
          (rows[k] = rows[k] || []).push(ur);
        });
        TH.ok('每张卡的中心都和它所属格子的中心重合（偏移 <= 1px）',
          maxDx <= 1 && maxDy <= 1,
          '最大偏移 dx=' + maxDx.toFixed(1) + ' dy=' + maxDy.toFixed(1));

        var keys = Object.keys(rows).map(Number).sort(function (a, b) { return a - b; });
        TH.eq('16 张卡分成 2 排', keys.length, 2);
        var minGap = Infinity;
        keys.forEach(function (k) {
          var row = rows[k].slice().sort(function (a, b) { return a.left - b.left; });
          for (var i = 1; i < row.length; i++) minGap = Math.min(minGap, row[i].left - row[i - 1].right);
        });
        TH.ok('同排卡牌互不重叠（间隙 >= 1px）', minGap >= 1,
          '最小横向间隙 ' + (minGap === Infinity ? 'n/a' : minGap.toFixed(1)) + 'px');

        var minVGap = Infinity;
        if (keys.length === 2) {
          var A = rows[keys[0]].slice().sort(function (a, b) { return a.left - b.left; });
          var B = rows[keys[1]].slice().sort(function (a, b) { return a.left - b.left; });
          for (var j = 0; j < Math.min(A.length, B.length); j++) minVGap = Math.min(minVGap, B[j].top - A[j].bottom);
        }
        TH.ok('上下两排卡牌互不重叠（间隙 >= 1px）', minVGap >= 1,
          '最小纵向间隙 ' + (minVGap === Infinity ? 'n/a' : minVGap.toFixed(1)) + 'px');

        /* 溢出不参与排版 —— 这是「不遵循格子但布局不变」的关键。
         * 地图尺寸必须正好是 8 格 + 7 个 gap，多 1px 都说明溢出把布局撑歪了。 */
        var gEl = q('#player-half');
        var gR = gEl.getBoundingClientRect();
        var cw = q('#player-half .cell').getBoundingClientRect().width;
        var expect = cw * COLS + 8 * (COLS - 1);
        TH.ok('卡牌溢出不会撑大地图（宽度正好 = 8 格 + 7 个 gap）',
          Math.abs(gR.width - expect) <= 2,
          '实测 ' + gR.width.toFixed(1) + '　应为 ' + expect.toFixed(1));

        st1.board = {};
        W.Game.refresh();
      })();

      // 溢出不能把棋盘撑大 —— 这是「不遵循格子但布局不变」的关键
      var wrap = q('.board-wrap');
      var grid = q('#player-half');
      if (wrap && grid) {
        var wr = wrap.getBoundingClientRect();
        TH.ok('卡牌溢出不会撑大棋盘（溢出不参与排版）',
          wr.width < cr.width * 8 + 90,
          '棋盘宽 ' + Math.round(wr.width) + 'px　8 格 = ' + Math.round(cr.width * 8) + 'px');
      }

      // 备战池的格子也允许溢出
      var bCell = q('#bench .bench-cell');
      TH.ok('备战池的格子也允许溢出',
        !!bCell && D.defaultView.getComputedStyle(bCell).overflow === 'visible');

      // 战斗画布上的卡牌同样比格子大（和 CSS 同一套规则）
      var cs = W.Arena.cardSize();
      TH.ok('战斗画布的卡牌尺寸也大于格子（和 CSS 同一套规则）',
        cs.w > W.Arena.cell() && cs.h > W.Arena.cell(),
        '格子 ' + W.Arena.cell() + '　卡牌 ' + cs.w + '×' + cs.h);

      // 收尾：清掉刚塞进去的那个测试棋子
      W.Game.state().board = {};
      W.Game.refresh();
    })();

    // 背景：远山 + 薄雾 + 光柱 + 暗角
    TH.ok('背景有 SVG 远山', qa('#scene-cover .valley-svg use').length >= 1);
    TH.ok('背景有飘动的薄雾带', qa('#scene-cover .mist-band').length >= 2,
      qa('#scene-cover .mist-band').length + ' 条');
    TH.ok('背景有光柱', qa('#scene-cover .rays').length === 1);
    TH.ok('背景有暗角', qa('#scene-cover .vignette').length === 1);
    TH.ok('游戏内也铺了同一套山谷背景（压淡版）',
      qa('#scene-game .valley.subdued').length === 1);
    TH.ok('背景层在正文之下（z-index 0）', (function () {
      var v = q('#scene-game .valley');
      return !!v && D.defaultView.getComputedStyle(v).zIndex === '0';
    })());

    // 浅色主题
    TH.ok('游戏内也是浅色主题', isLightTheme(), '文字色 = ' + D.defaultView.getComputedStyle(D.body).color);
    TH.ok('面板是浅色的（背景亮度 >= 200）', bgLum('.panel') >= 200, '面板亮度 = ' + bgLum('.panel'));
  }

  /* ============================================================
   * 三c、战斗表现：卡牌化 UI + 打击感
   * ============================================================ */
  async function testCombatFeel() {
    TH.section('战斗表现');

    // 摆一套能打起来的阵容（两边都要有人，才看得到寻敌和交火）
    var st = G();
    st.board = {};
    st.gold = 99;
    var mine = [
      { id: 'blademaster', star: 2, items: ['giantblade', 'huntereye'] },
      { id: 'ironwall', star: 2, items: ['dragonscale'] },
      { id: 'abyss', star: 2, items: ['spellbook'] },
      { id: 'bowman', star: 2 }, { id: 'spearman', star: 1 }, { id: 'crossbow', star: 1 }
    ];
    var placed = W.ST.Battle.autoPlace('b', mine);
    for (var i = 0; i < placed.length; i++) {
      st.board[placed[i].r + ',' + placed[i].c] =
        { uid: 'cf' + i, defId: placed[i].id, star: placed[i].star, items: placed[i].items };
    }
    W.Game.refresh();
    await wait(120);

    click($('btn-fight'));
    await wait(1500);

    var res = G().result;
    TH.ok('战斗跑起来了', !!res);

    // 战斗单位是「卡牌」结构：有立绘、费用、星级、装备、名字、血条与法力条
    var units = W.Arena.units();
    TH.ok('战斗单位表已建立', !!units && Object.keys(units).length > 0,
      units ? Object.keys(units).length + ' 个单位' : 'null');
    var sample = null;
    for (var k in units) { sample = units[k]; break; }
    TH.ok('战斗单位带着卡牌所需的数据（费用/装备/星级）',
      sample && sample.cost >= 1 && sample.defId && typeof sample.star === 'number',
      sample ? ('cost=' + sample.cost + ' defId=' + sample.defId + ' star=' + sample.star) : '—');
    TH.ok('战斗单位有滞后血条字段（用来做血色滞后效果）',
      sample && typeof sample.hpLag === 'number');

    // 自动寻敌 + 打击感：无头浏览器不驱动 rAF，所以这里手动推进时间轴，
    // 走的是和真实播放完全一样的 A.step()。
    W.Arena.resetPeak();
    var moved = false;
    var before = {};
    for (var uk in units) before[uk] = units[uk].rr + ',' + units[uk].cc;

    for (var step = 0; step < 240; step++) {      // 240 × 1/30s = 8 秒
      W.Arena.step(1 / 30);
      if (step === 60 || step === 150) {
        for (var uk2 in units) {
          var u2 = units[uk2];
          if (u2.alive && before[uk2] !== (u2.rr + ',' + u2.cc)) moved = true;
        }
      }
    }

    var pk = W.Arena.peak();
    TH.ok('时间轴能靠 step() 推进（不依赖 rAF）', pk.t > 0.5, '推进到 ' + pk.t.toFixed(2) + 's');
    TH.ok('棋子真的会自己走向敌人（自动寻敌看得见）', moved,
      '推进过程中有单位的渲染坐标发生了变化');
    TH.ok('产生了打击特效（伤害飘字/火花/冲击环）', pk.fx > 0, '特效峰值 ' + pk.fx + ' 个');
    TH.ok('产生了屏幕震动（打击感）', pk.shake > 0.5, '震动峰值 ' + pk.shake.toFixed(2));

    // 单位在推进过程中确实移动过（用事件流验证一遍，双保险）
    var applied = 0;
    for (var q2 = 0; q2 < res.log.length; q2++) if (res.log[q2].t <= pk.t) applied++;
    TH.ok('推进过程中消费了事件流', applied > 5, applied + ' / ' + res.log.length + ' 条事件');

    click($('btn-skip'));
    await wait(900);

    var counts = {};
    for (var j = 0; j < res.log.length; j++) {
      counts[res.log[j].type] = (counts[res.log[j].type] || 0) + 1;
    }
    TH.ok('发生了走位（自动靠近敌人）', (counts.move || 0) > 0, (counts.move || 0) + ' 次移动');
    TH.ok('发生了普攻', (counts.attack || 0) > 0, (counts.attack || 0) + ' 次普攻');
    TH.ok('结算浮层弹出来了（跳到结算仍然走同一条事件流）',
      $('result-overlay').classList.contains('on'), txt('result-title'));

    // 画布真的画了东西
    var cv = $('arena');
    var img = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    var painted = 0;
    for (var p = 0; p < img.length; p += 4 * 97) {
      if (Math.abs(img[p] - 240) > 14 || Math.abs(img[p + 1] - 243) > 14 || Math.abs(img[p + 2] - 240) > 14) painted++;
    }
    TH.ok('战斗画面确实画出了东西', painted > 120, painted + ' 个非背景采样点');

    /* ---------- 战场和布阵盘必须同规格 ----------
     *
     * ★ 这一组是「布阵怎么摆、打起来就在哪」的核心保证。
     *
     *   战斗画布上的我方半场**就是**布阵盘那 4 行平移下去，所以两边必须：
     *     ① 格子一样大（同一个 --cell）
     *     ② 间距一样大（同一个 --gap）
     *     ③ 列位置逐列重合（画布定位要用 pitch = 格子 + 间距，不是格子大小）
     *     ④ 战场高度 = 布阵盘高度的两倍（8 行 vs 4 行）
     *
     *   之前画布把 CELL 同时当格子大小和间距用，每列少算 8px、
     *   8 列累计差 56px —— 玩家摆好的阵一开战就被横向压扁了一点，
     *   看起来「阵容不对」但又说不上哪不对。
     */
    var cellCss = varPx('--cell-r');   // JS 取整后写回的那个值，两边共用
    var gapCss = varPx('--gap');
    TH.ok('画布格子读的就是布阵盘的格子（同一个整数）',
      Math.abs(W.Arena.cell() - cellCss) < 0.01 && cellCss === Math.floor(cellCss),
      'Arena.cell=' + W.Arena.cell() + '　CSS --cell-r=' + cellCss);
    TH.ok('画布间距读的就是布阵盘的 --gap（同规格）',
      Math.abs(W.Arena.gap() - gapCss) < 0.01,
      'Arena.gap=' + W.Arena.gap() + '　CSS --gap=' + gapCss);
    TH.ok('画布定位步长 = 格子 + 间距（不是格子大小）',
      Math.abs(W.Arena.pitch() - (W.Arena.cell() + W.Arena.gap())) < 0.01,
      'pitch=' + W.Arena.pitch() + '　格子=' + W.Arena.cell() + '　间距=' + W.Arena.gap());

    var COLS_N = W.ST.BATTLE_CFG.COLS, ROWS_N = W.ST.BATTLE_CFG.ROWS;
    var expectW = W.Arena.cell() * COLS_N + W.Arena.gap() * (COLS_N - 1);
    TH.ok('战场宽度 = 8 格 + 7 个间距（和布阵盘的算法逐字相同）',
      Math.abs(cv.width - expectW) < 0.01 && Math.abs(W.Arena.fieldW() - expectW) < 0.01,
      '画布 ' + cv.width + '　应为 ' + expectW);
    TH.ok('战场是正方形的 8×8',
      cv.width === cv.height, cv.width + '×' + cv.height);

    // 战场高度 = 布阵盘高度的两倍（4 行 → 8 行）
    var boardH = W.Arena.cell() * 4 + W.Arena.gap() * 3;
    TH.ok('★ 战场高度 ≈ 布阵盘高度的两倍（8 行对 4 行）',
      cv.height >= boardH * 1.95 && cv.height <= boardH * 2.1,
      '战场 ' + cv.height + '　布阵盘 ' + boardH + '　倍数 ' + (cv.height / boardH).toFixed(3));

    // 列位置逐列重合：布阵盘第 c 列中心和画布第 c 列中心必须在同一个 x
    (function () {
      var gridL = q('#player-half').getBoundingClientRect().left;
      var cells = qa('#player-half .cell');
      var worst = 0;
      for (var i = 0; i < COLS_N; i++) {
        var cellRect = cells[i].getBoundingClientRect();
        var prepCenter = (cellRect.left + cellRect.right) / 2 - gridL;
        // 画布上第 i 列的中心（画布自身坐标系）
        var arenaCenter = i * W.Arena.pitch() + W.Arena.cell() / 2;
        worst = Math.max(worst, Math.abs(prepCenter - arenaCenter));
      }
      TH.ok('★ 布阵盘和战场的列中心逐列重合（阵型不会被横向压缩）',
        worst < 1,
        '最大偏差 ' + worst.toFixed(2) + 'px（8 列各比一次）');
    })();

    // 我方半场 = 布阵盘整块下移 4 个 pitch
    TH.ok('★ 我方半场是布阵盘整块下移 4 步（行位置也一致）',
      Math.abs(4 * W.Arena.pitch() - (W.Arena.cell() * 4 + W.Arena.gap() * 4)) < 0.01,
      '下移 ' + (4 * W.Arena.pitch()) + 'px　布阵盘高 ' +
      (W.Arena.cell() * 4 + W.Arena.gap() * 3) + 'px + 1 个间距');

    /* ★★ 最强的一条：把「布阵盘上这一格的中心」和「画布上这颗棋子的落点」
     *    放进**同一个坐标系**逐个比。
     *
     *    坐标系用「各自场地的左上角」—— 两个场景在屏幕上本来就不对齐
     *    （战斗界面左栏「对阵+播放」比右侧战报窄，画布整体会偏一点），
     *    拿屏幕绝对坐标去比会得出几十 px 的假偏差，那是量错了不是 bug。
     *    我方第 4 行 == 布阵盘第 0 行，所以画布坐标要减掉 4 个 pitch 才同系。 */
    (function () {
      var st0 = W.Game.state();
      var keep = st0.board;
      st0.board = {};
      var plan = [[4, 0], [4, 7], [7, 0], [7, 7], [5, 3], [6, 4]];
      for (var pi = 0; pi < plan.length; pi++) {
        st0.board[plan[pi][0] + ',' + plan[pi][1]] =
          { uid: 'fid' + pi, defId: 'bowman', star: 1, items: [] };
      }
      W.Game.refresh();

      var gridBox = q('#player-half').getBoundingClientRect();
      var chips = qa('#player-half .u');
      var cellN = W.Arena.cell(), pitchN = W.Arena.pitch();
      var halfN = W.ST.BATTLE_CFG.ROWS_PER_SIDE;
      var worstX = 0, worstY = 0, n = 0;
      for (var cj = 0; cj < chips.length; cj++) {
        var el = chips[cj], cellEl = el.parentNode;
        var uR = el.getBoundingClientRect();
        var prepX = (uR.left + uR.width / 2) - gridBox.left;      // 相对布阵盘左上角
        var prepY = (uR.top + uR.height / 2) - gridBox.top;
        var rr = parseInt(cellEl.dataset.r, 10), cc = parseInt(cellEl.dataset.c, 10);
        var arenaX = cc * pitchN + cellN / 2;                     // 相对战场左上角
        var arenaY = rr * pitchN + cellN / 2 - halfN * pitchN;    // 减掉半场才同系
        worstX = Math.max(worstX, Math.abs(arenaX - prepX));
        worstY = Math.max(worstY, Math.abs(arenaY - prepY));
        n++;
      }
      TH.ok('★★ 画布上的落点和布阵盘上的位置完全一致（列 + 行逐个比）',
        n === plan.length && worstX < 0.5 && worstY < 0.5,
        n + ' 个棋子　最大偏差 列 ' + worstX.toFixed(2) + 'px　行 ' + worstY.toFixed(2) + 'px');

      // 战场关于中线对称：第 0 行和第 7 行的中心，中点必须落在战场正中心
      var fH = W.Arena.fieldH();
      var y0 = 0 * pitchN + cellN / 2;
      var y7 = 7 * pitchN + cellN / 2;
      TH.ok('★ 战场关于中线对称（第 0 行和第 7 行到中线一样远）',
        Math.abs((y0 + y7) / 2 - fH / 2) < 0.01,
        '第0行 ' + y0 + ' / 第7行 ' + y7 + '　中点 ' + ((y0 + y7) / 2) +
        '　战场中心 ' + (fH / 2));

      st0.board = keep;
      W.Game.refresh();
    })();
  }

  /* ============================================================
   * 四、商店 / 上场 / 刷新 / 买经验
   * ============================================================ */
  async function testShopAndBoard() {
    TH.section('商店 · 摆位 · 经济');

    // 前面的战斗测试在棋盘上留了人，这里先清空，保证从干净状态测买卖
    var clean = G();
    clean.board = {};
    clean.bench = new Array(9);
    clean.gold = 30;
    W.Game.refresh();
    await wait(120);
    TH.eq('测试从这里开始是空棋盘', boardN(), 0);

    var before = gold();
    var card = qa('#shop-row .shop-card')[0];
    var costText = card.querySelector('.sc-price') ? card.querySelector('.sc-price').textContent : '1 🪙';
    var cost = parseInt(costText, 10);
    var defId = G().shop[0];

    click(card);
    await wait(160);

    TH.eq('买棋子扣了正确的金币', gold(), before - cost);
    TH.eq('棋子进了备战席', benchN(), 1);
    TH.ok('备战席上画出了棋子', qa('#bench .u').length === 1);
    TH.eq('买过的商店格变成空位', qa('#shop-row .shop-card.sold').length, 1);
    TH.ok('棋子是刚买的那个', G().bench.filter(Boolean)[0].defId === defId);

    // 选中备战席的棋子 → 点棋盘格子 → 上场
    click(q('#bench .u').parentNode);
    await wait(140);
    TH.ok('选中备战席棋子后，信息条显示了它', txt('sel-bar').indexOf(W.ST.UNIT_BY_ID[defId].name) >= 0,
      txt('sel-bar').slice(0, 60));

    var targetCell = qa('#player-half .cell')[17];   // 靠前的某格
    var tr = targetCell.dataset.r, tc = targetCell.dataset.c;
    click(targetCell);
    await wait(180);

    TH.eq('棋子上了棋盘', boardN(), 1);
    TH.eq('备战席腾空了', benchN(), 0);
    TH.ok('棋盘上画出了棋子', qa('#player-half .u').length === 1);
    TH.eq('棋子落在点的那一格', !!G().board[tr + ',' + tc], true);
    TH.eq('上场数变成 1/2', txt('hud-field'), '1/2');
    TH.ok('开战按钮解除禁用', !$('btn-fight').classList.contains('disabled'));

    // 刷新
    var g1 = gold();
    click($('btn-reroll'));
    await wait(150);
    TH.eq('刷新扣 2 金', gold(), g1 - 2);
    TH.eq('刷新后商店还是 5 张', qa('#shop-row .shop-card').length, 5);
    TH.ok('刷新后空位被补满', qa('#shop-row .shop-card.sold').length === 0);

    // 买经验
    var g2 = gold(), lv = G().lvl, xp = G().xp;
    click($('btn-xp'));
    await wait(150);
    TH.eq('买经验扣 4 金', gold(), g2 - 4);
    TH.ok('经验或等级有变化', G().xp !== xp || G().lvl !== lv,
      'Lv' + lv + '(' + xp + ') → Lv' + G().lvl + '(' + G().xp + ')');
  }

  /* ============================================================
   * 五、升星合成与装备
   * ============================================================ */
  async function testCombineAndItems() {
    TH.section('升星合成 · 装备');

    // 合成规则：3 个同名同星 → 1 个高一星。
    // 把两个 1 星同名棋子放进备战席（其中一个带装备），再走真实的买入链路
    // 买第三个 —— 这样验的是「点卡片 → 扣钱 → 进备战席 → 自动合成」整条路，
    // 而不是绕过规则直接调内部函数。
    var target = 'bowman';
    var st = G();
    st.board = {};
    st.bench = new Array(9);
    st.gold = 60;
    st.bench[0] = { uid: 't1', defId: target, star: 1, items: [] };
    st.bench[1] = { uid: 't2', defId: target, star: 1, items: ['belt'] };
    st.shop = [target, target, target, target, target];
    W.Game.refresh();
    await wait(80);
    TH.eq('备战席有 2 个同名 1 星', benchN(), 2);

    W.Game.buy(0);
    await wait(120);

    var all = [];
    for (var k in G().board) if (G().board[k]) all.push(G().board[k]);
    for (var i = 0; i < G().bench.length; i++) if (G().bench[i]) all.push(G().bench[i]);
    var bows = all.filter(function (u) { return u.defId === target; });

    TH.eq('3 个同名同星合成成 1 个', bows.length, 1);
    TH.ok('合成后是 2 星', bows.length === 1 && bows[0].star === 2,
      bows.length ? ('星级 = ' + bows[0].star) : '没找到');
    TH.ok('合成时装备没有凭空消失（保留下来了）',
      bows.length === 1 && bows[0].items.indexOf('belt') >= 0,
      bows.length ? JSON.stringify(bows[0].items) : '—');
    TH.ok('合成不会多出棋子（3 个变 1 个）', all.length === 1, all.length + ' 个');

    // 装备
    G().bag = ['giantblade', 'dragonscale'];
    W.Game.refresh();
    await wait(100);
    TH.eq('装备栏渲染出 2 件装备', qa('#item-row .item-chip').length, 2);

    click(qa('#item-row .item-chip')[0]);
    await wait(120);
    TH.ok('选中装备后信息条提示去点棋子',
      txt('sel-bar').indexOf('点一个棋子') >= 0, txt('sel-bar').slice(0, 70));

    var unitChip = q('#bench .u') || q('#player-half .u');
    TH.ok('场上有棋子可以装装备', !!unitChip);
    var uid = unitChip.dataset.uid;
    click(unitChip.parentNode);
    await wait(150);

    var holder = null;
    var all2 = [];
    for (var k2 in G().board) if (G().board[k2]) all2.push(G().board[k2]);
    for (var j = 0; j < G().bench.length; j++) if (G().bench[j]) all2.push(G().bench[j]);
    for (var m = 0; m < all2.length; m++) if (all2[m].uid === uid) holder = all2[m];

    TH.ok('装备装到了棋子上', holder && holder.items.indexOf('giantblade') >= 0,
      holder ? JSON.stringify(holder.items) : '没找到棋子');
    TH.eq('装备栏少了一件', qa('#item-row .item-chip').length, 1);
    TH.ok('装备上限是 3 件', W.ST.MAX_ITEMS === 3, 'MAX_ITEMS = ' + W.ST.MAX_ITEMS);

    /* ---------- 4 星：3 个 3 星 → 1 个 4 星（2026-10 加的一档） ----------
     * ★ 3 星我们是走真实链路（买第三张）验的；4 星走不了那条路 ——
     *   商店卖的永远是 1 星，要凑 27 张同名卡才能买出一个 4 星。
     *   所以这里直接往备战席塞 3 个 3 星，再买**任意一个别的棋子**把
     *   `tryCombine()` 触发一次 —— 合成的判定逻辑仍然是真代码在跑，
     *   只是"卡从哪来"这一步被跳过了。 */
    function ownedAll() {
      var out = [];
      for (var k in G().board) if (G().board[k]) out.push(G().board[k]);
      for (var i2 = 0; i2 < G().bench.length; i2++) if (G().bench[i2]) out.push(G().bench[i2]);
      return out;
    }
    function seedBench(list) {
      G().board = {};
      G().bench = new Array(9);
      G().gold = 60;
      for (var i3 = 0; i3 < list.length; i3++) G().bench[i3] = list[i3];
    }

    var star4Tag = 'ironwall';   // 用鸭子：1 费，合成它最贴近真实经济
    seedBench([
      { uid: 's1', defId: star4Tag, star: 3, items: ['belt'] },
      { uid: 's2', defId: star4Tag, star: 3, items: [] },
      { uid: 's3', defId: star4Tag, star: 3, items: [] }
    ]);
    G().shop = ['bowman', 'bowman', 'bowman', 'bowman', 'bowman'];
    W.Game.refresh();
    await wait(80);
    TH.eq('备战席上摆着 3 个 3 星', G().bench.filter(Boolean).length, 3);

    W.Game.buy(0);              // 买一个别的棋子，触发一次合成扫描
    await wait(140);

    var merged = ownedAll().filter(function (u) { return u.defId === star4Tag; });
    TH.eq('★ 3 个 3 星合成成了 1 个', merged.length, 1);
    TH.ok('★ 合成结果是 **4 星**', merged.length === 1 && merged[0].star === 4,
      merged.length ? ('星级 = ' + merged[0].star) : '没找到');
    TH.ok('★ 合成时装备也不会丢（3 星身上那件腰带还在）',
      merged.length === 1 && merged[0].items.indexOf('belt') >= 0,
      merged.length ? JSON.stringify(merged[0].items) : '—');

    // 卡片上必须画**四颗**星，不能还是三颗
    var starChip = q('#bench .u .u-stars') || q('#player-half .u .u-stars');
    TH.eq('★ 卡片上画的是 4 颗星', starChip ? starChip.textContent : '（没找到）', '★★★★');

    // 4 星是顶：3 个 4 星不会再合成
    seedBench([
      { uid: 'q1', defId: star4Tag, star: 4, items: [] },
      { uid: 'q2', defId: star4Tag, star: 4, items: [] },
      { uid: 'q3', defId: star4Tag, star: 4, items: [] }
    ]);
    W.Game.refresh();
    await wait(80);
    W.Game.buy(0);
    await wait(140);
    var still4 = ownedAll().filter(function (u) { return u.defId === star4Tag; });
    TH.eq('★ 4 星是星级上限：3 个 4 星不会继续合成', still4.length, 3);
    TH.ok('★ 而且它们仍然是 4 星（没有被吃掉或者降级）',
      still4.every(function (u) { return u.star === 4; }),
      still4.map(function (u) { return u.star; }).join(','));

    /* 卖出价：4 星 = 27 倍费用（3 个 3 星，每个 9 倍）。
       ★ 走真实卖出链路（Game.sell）而不是直接调内部函数 ——
         售价那条三元链写死成 9 倍的时候，只有"真的卖一个 4 星"才看得出来。 */
    var d4 = W.ST.UNIT_BY_ID[star4Tag];
    seedBench([{ uid: 'r1', defId: star4Tag, star: 4, items: [] }]);
    G().gold = 0;
    W.Game.refresh();
    await wait(80);
    W.Game.sell('r1');
    await wait(80);
    TH.eq('★ 4 星的售价是 27 倍费用（不然卖掉一个 4 星会亏掉三分之二）',
      G().gold, d4.cost * 27);

    // 收尾：把备战席清干净，免得影响后面的用例
    seedBench([]);
    G().shop = [null, null, null, null, null];
    W.Game.refresh();
    await wait(60);
  }

  /* ============================================================
   * 五b、星级被动的界面文案（豆包 · 幻觉 / 开智；荣誉 · 运 / edg希望）
   *
   *   数值在模拟器里，但玩家是**从这一行字**认识被动的。
   *   这两张卡的 2★/3★ 差别都不是「数字变大」而是「判定变了」，
   *   所以文案必须跟着星级变 —— 写死一句话就会变成假信息。
   * ============================================================ */
  async function testPassiveText() {
    TH.section('豆包 · 被动文案');

    var st = G();
    st.board = {};
    st.bench = new Array(9);
    st.gold = 60;

    /* 把一个指定棋子按指定星级摆上场并选中，返回信息条上那一行被动文字。
       ★ 必须先清掉选中态：点同一个棋子第二次是**取消选中**（切换语义），
         不清的话第二轮会点到「取消」上，信息条变成羁绊面板，
         断言看着像文案没了 —— 这个坑在豆包那一轮已经踩过一次。 */
    async function pick(defId, star) {
      st.board = { '4,2': { uid: 'u_' + defId + star, defId: defId, star: star, items: [] } };
      st.sel = null;
      W.Game.refresh();
      await wait(90);
      click(q('#player-half .u').parentNode);
      await wait(110);
      var box = q('#sel-bar .sb-passive') || q('#sel-bar .sb-teaser');
      /* ★ 顺手把两个信息条都记下来：调用方通常只关心"当前生效"那一条，
         但下面那条全量扫描要**两条都查** —— 预告里也会有被动名字。 */
      var pb2 = q('#sel-bar .sb-passive'), tb2 = q('#sel-bar .sb-teaser');
      lastTexts = [pb2 ? pb2.textContent : '', tb2 ? tb2.textContent : ''];
      return box ? box.textContent : '';
    }
    var lastTexts = [];

    var s1 = await pick('acolyte', 1);
    TH.ok('1 星豆包不显示「已生效」那一行，只给升星预告',
      s1.indexOf('被动预览') >= 0 && s1.indexOf('幻觉') >= 0 && s1.indexOf('开智') >= 0,
      s1.slice(0, 90));

    var s2 = await pick('acolyte', 2);
    TH.ok('2 星显示「幻觉」', s2.indexOf('幻觉') >= 0, s2.slice(0, 90));
    TH.ok('★ 2 星的文案写明了「50% 概率」和一个坏结果',
      s2.indexOf('50%') >= 0 && s2.indexOf('减伤 20%') >= 0, s2.slice(0, 120));
    TH.ok('2 星的文案里不出现「必定」（那是 3 星的事）',
      s2.indexOf('必定') < 0, s2.slice(0, 120));

    var s3 = await pick('acolyte', 3);
    TH.ok('3 星显示「开智」', s3.indexOf('开智') >= 0, s3.slice(0, 90));
    TH.ok('★ 3 星的文案写明了「必定增伤」，且不再提减伤',
      s3.indexOf('必定') >= 0 && s3.indexOf('增伤 20%') >= 0 && s3.indexOf('减伤') < 0,
      s3.slice(0, 120));

    /* ---------- 荣誉：运 / edg希望 ----------
     * ★★ snipeSure 的 passiveStep 是**次数**，不是百分比。
     *   文案函数如果照抄别的 kind 无脑 ×100，这里就会显示成
     *   「每局前 100 次狙击必定命中」—— 一个荒谬但很容易写出来的 bug，
     *   而它在纯数值自检里是看不出来的（数值本来就是 1 和 2）。
     *   这两条断言就是专门拦它的。 */
    TH.section('荣誉 · 被动文案');

    var b1 = await pick('bowman', 1);
    TH.ok('1 星荣誉只给升星预告，预告里带上两个被动名',
      b1.indexOf('被动预览') >= 0 && b1.indexOf('运') >= 0 && b1.indexOf('edg希望') >= 0,
      b1.slice(0, 120));
    TH.ok('★ 1 星的预告没有把次数当成百分比（不该出现「100」或「200」）',
      b1.indexOf('100') < 0 && b1.indexOf('200') < 0, b1.slice(0, 120));

    var b2 = await pick('bowman', 2);
    TH.ok('2 星显示「运」', b2.indexOf('运') >= 0, b2.slice(0, 120));
    TH.ok('★ 2 星写的是「前 1 次必定命中」，不是「前 100 次」',
      b2.indexOf('前 1 次') >= 0 && b2.indexOf('100') < 0, b2.slice(0, 120));

    var b3 = await pick('bowman', 3);
    TH.ok('3 星显示「edg希望」', b3.indexOf('edg希望') >= 0, b3.slice(0, 120));
    TH.ok('★ 3 星写的是「前 2 次必定命中」，不是「前 200 次」',
      b3.indexOf('前 2 次') >= 0 && b3.indexOf('200') < 0, b3.slice(0, 120));

    /* ---------- 100元的鸭子：抓娃娃 ----------
     * ★★ clawGuard 的 passiveStep 也是**次数**（20/30/40），
     *   同样不能无脑 ×100 —— 那会显示成「能挡 2000 次」。 */
    TH.section('100元的鸭子 · 被动文案');

    var d1 = await pick('ironwall', 1);
    TH.ok('1 星鸭子显示「抓娃娃」', d1.indexOf('抓娃娃') >= 0, d1.slice(0, 120));
    TH.ok('★ 1 星写的是「前 20 次」，不是「前 2000 次」',
      d1.indexOf('前 20 次') >= 0 && d1.indexOf('2000') < 0, d1.slice(0, 120));

    var d2 = await pick('ironwall', 2);
    TH.ok('2 星鸭子写的是「前 30 次」',
      d2.indexOf('前 30 次') >= 0 && d2.indexOf('3000') < 0, d2.slice(0, 120));

    var d3 = await pick('ironwall', 3);
    TH.ok('3 星鸭子写的是「前 40 次」',
      d3.indexOf('前 40 次') >= 0 && d3.indexOf('4000') < 0, d3.slice(0, 120));
    TH.ok('3 星标成「已满档」', d3.indexOf('已满档') >= 0, d3.slice(0, 120));

    /* ---------- 张雪峰：超频 / 巧乐兹 / 雪毙 ---------- */
    TH.section('张雪峰 · 被动文案');

    var z1 = await pick('blademaster', 1);
    TH.ok('1 星显示「你快不过我你信吗」', z1.indexOf('你快不过我你信吗') >= 0, z1.slice(0, 140));
    TH.ok('★ 1 星的文案里写明了「开局攻速 +60%」和「移速 +100%」',
      z1.indexOf('开局攻速 +60%') >= 0 && z1.indexOf('移速 +100%') >= 0, z1.slice(0, 220));
    /* ★★ 这条是防**假通过**的，不是凑数：
       削弱之前的文案是「开局攻速/移速 +100%」，而削弱之后
       「移速 +100%」还在 —— 只查 '+100%' 的话，旧文案、甚至把攻速写错，
       都会因为移速那一半而通过。所以这里钉住**旧的措辞不许再出现**。 */
    TH.ok('★ 1 星不能再出现旧文案「攻速/移速」（移速的 +100% 会伪装成通过）',
      z1.indexOf('攻速/移速') < 0, z1.slice(0, 220));
    TH.ok('★ 1 星写明「攻速加成到 +100% 进入狂暴」和「每秒失去 44%」',
      z1.indexOf('+100% 进入「狂暴」') >= 0 && z1.indexOf('44%') >= 0, z1.slice(0, 260));
    TH.ok('★ 1 星写明狂暴里叠加翻倍到 +4%、以及 +200% 的硬上限',
      z1.indexOf('翻倍到 +4%') >= 0 && z1.indexOf('加成上限 +200%') >= 0, z1.slice(0, 300));
    TH.ok('★ 1 星写明「普攻是单体」（范围是 3 星才有的，写错就是假信息）',
      z1.indexOf('普攻是单体') >= 0 && z1.indexOf('范围') < 0, z1.slice(0, 200));
    TH.ok('1 星不提巧乐兹和雪毙（那是 2/3 星的事）',
      z1.indexOf('巧乐兹') < 0 && z1.indexOf('雪毙') < 0, z1.slice(0, 200));

    var z2 = await pick('blademaster', 2);
    TH.ok('2 星多了「巧乐兹」', z2.indexOf('巧乐兹') >= 0, z2.slice(0, 220));
    TH.ok('★ 2 星的文案写明了「每层 -5%」「满 10 层冰冻 3 秒」',
      z2.indexOf('-5%') >= 0 && z2.indexOf('满 10 层') >= 0 && z2.indexOf('冰冻 3 秒') >= 0,
      z2.slice(0, 260));
    TH.ok('★ 2 星仍然写「普攻是单体」（范围要 3 星）',
      z2.indexOf('普攻是单体') >= 0, z2.slice(0, 220));
    TH.ok('2 星还没有雪毙', z2.indexOf('雪毙') < 0, z2.slice(0, 220));

    var z3 = await pick('blademaster', 3);
    TH.ok('3 星多了「雪毙」', z3.indexOf('雪毙') >= 0, z3.slice(0, 260));
    TH.ok('★ 3 星写的是「攻击力 +78%」，并且普攻升级成 3×3 范围',
      z3.indexOf('攻击力 +78%') >= 0 && z3.indexOf('普攻升级成 3×3 范围') >= 0,
      z3.slice(0, 320));
    TH.ok('★ 3 星的雪毙写的是「进入狂暴之后」而不是旧的「攻速达标后」',
      z3.indexOf('进入「狂暴」之后攻击力') >= 0 && z3.indexOf('攻速达标后') < 0,
      z3.slice(0, 320));
    TH.ok('3 星同时保留巧乐兹（三层是叠加的，不是替换）',
      z3.indexOf('巧乐兹') >= 0 && z3.indexOf('你快不过我你信吗') >= 0, z3.slice(0, 300));
    /* ★★ 这条是抓上面那个 bug 的：2 星那一段原来显示成
       「你快不过我你信吗,巧乐兹」（数组被 toString 了）。
       加完断言之后顺手做了个全量扫描，见下面「被动名字表」那一节。 */
    TH.ok('★ 2/3 星的冰棍段只显示「巧乐兹」这一个名字，不是逗号拼起来的名字链',
      z2.indexOf('巧乐兹,') < 0 && z2.indexOf(',巧乐兹') < 0 &&
      z3.indexOf('巧乐兹,') < 0 && z3.indexOf(',巧乐兹') < 0,
      z2.slice(0, 220));

    /* ---------- 所有棋子：被动名字表不能把"累积数组"直接拼进文案 ----------
     * ★★ `passive.names` 里同一个星级的名字有两种写法：
     *     字符串（`2: '巧乐兹'`）和**累积数组**（`2: ['你快不过我你信吗','巧乐兹']`）。
     *   12 个被动里有 **7 个**用的是数组写法 —— 所以这不是个别失误，是默认坑。
     *   直接塞进字符串拼接，数组会被 `toString()` 成「你快不过我你信吗,巧乐兹」，
     *   玩家看到一串带逗号的名字链。张雪峰的 2/3 星就中过这个招
     *   （`pn[2] || '巧乐兹'` 对数组来说永远取的是数组本身，兜底根本不生效）。
     * ★ 这里对**每一个用到数组名字的棋子 × 每一个星级**自动扫一遍，
     *   两条信息条（生效 + 预告）都查。以后新写的被动也不会再犯，
     *   不用靠人肉 review —— 这种"看着像文案问题、其实是数据形状问题"的 bug
     *   只靠逐个断言是守不住的。 */
    var badChains = [];
    var scanUnits = 0, scanPicks = 0, scanSample = '';
    /* ★★ 这里必须用 `Array.isArray`，**不能**用 `instanceof Array` ——
       游戏跑在 `<iframe id="game">` 里，`W` 是那个 iframe 的 window，
       所以 `W.ST.UNITS[...].passive.names[2]` 是**另一个 realm 的数组**，
       顶层测试页的 `instanceof Array` 对它一律返回 false。
       （第一版就是这么写的，扫描覆盖 0 个棋子、断言"通过"—— 一个假绿。
         game.js 自己用 instanceof 没问题，因为它和那些数组在同一个 realm 里。） */
    var isArr = Array.isArray;
    for (var di = 0; di < W.ST.UNITS.length; di++) {
      var du = W.ST.UNITS[di];
      var dn = (du.passive && du.passive.names) || {};
      var chains = [];
      for (var kk in dn) {
        if (!isArr(dn[kk]) || dn[kk].length < 2) continue;
        for (var s0 = 0; s0 < dn[kk].length; s0++) {
          for (var e0 = s0 + 1; e0 < dn[kk].length; e0++) {
            chains.push(dn[kk].slice(s0, e0 + 1).join(','));
          }
        }
      }
      if (!chains.length) continue;
      scanUnits++;
      for (var stx = 1; stx <= 3; stx++) {
        await pick(du.id, stx);
        scanPicks++;
        if (!scanSample) scanSample = du.id + stx + '[' + chains.join('|') + ']→' +
          lastTexts.join('⏸').slice(0, 120);
        for (var ci = 0; ci < chains.length; ci++) {
          for (var ti = 0; ti < lastTexts.length; ti++) {
            if (chains[ci] && lastTexts[ti].indexOf(chains[ci]) >= 0) {
              badChains.push(du.id + ' ' + stx + '星：' + chains[ci]);
            }
          }
        }
      }
    }
    TH.note('扫描覆盖：' + scanUnits + ' 个棋子用了数组名字、共取 ' + scanPicks +
      ' 次文案；样本 ' + scanSample);
    TH.eq('★ 全量扫描：没有任何棋子的被动文案里出现"逗号拼起来"的名字链',
      badChains.length, 0);
    if (badChains.length) TH.note('出问题的：' + badChains.join(' / '));

    /* ---------- 老牧师：临终祷告 / 圣光赐福 ----------
     * ★ 这个棋子的信息条有三种形态，每一种都要单独钉住：
     *     1 星  没有被动 → 只显示"升星预告"
     *     2 星  只显示"还能抢救一下"（**不能**提前写 +20%）
     *     3 星  两个都显示
     *   中间那一条最容易写错：把 3 星的效果写进 2 星的文案里，
     *   玩家会为了一条根本不生效的规则去升星。 */
    TH.section('老牧师 · 被动文案');

    var m1 = await pick('medic', 1);
    TH.ok('★ 1 星不显示"已生效"那一行，只给升星预告（他 1 星本来就没被动）',
      m1.indexOf('被动预览') >= 0, m1.slice(0, 140));
    TH.ok('★ 1 星的预告写明了「2 星能救队友」和「3 星额外给 +20%」',
      m1.indexOf('还能抢救一下') >= 0 && m1.indexOf('圣光赐福') >= 0 &&
      m1.indexOf('+20%') >= 0, m1.slice(0, 220));
    TH.ok('★ 1 星的预告说明了"每场战斗一次"（不然玩家以为能反复救）',
      m1.indexOf('每场战斗一次') >= 0, m1.slice(0, 220));

    var m2 = await pick('medic', 2);
    TH.ok('2 星显示「还能抢救一下」', m2.indexOf('还能抢救一下') >= 0, m2.slice(0, 200));
    TH.ok('★ 2 星写明「满血站起来」和「一场只救一次」',
      m2.indexOf('满血站起来') >= 0 && m2.indexOf('每场战斗一次') >= 0, m2.slice(0, 240));
    TH.ok('★ 2 星写明「老牧师救不了自己」（这是最容易被玩家误解的一条）',
      m2.indexOf('救不了自己') >= 0, m2.slice(0, 240));
    TH.ok('★★ 2 星**绝不能**提「圣光赐福」或 +20%（那是 3 星的，写了就是假信息）',
      m2.indexOf('圣光赐福') < 0 && m2.indexOf('+20%') < 0, m2.slice(0, 240));

    var m3 = await pick('medic', 3);
    TH.ok('3 星多了「圣光赐福」', m3.indexOf('圣光赐福') >= 0, m3.slice(0, 280));
    TH.ok('★ 3 星写明「老牧师和被救的人攻击力都 +20%」',
      m3.indexOf('攻击力都 +20%') >= 0, m3.slice(0, 300));
    TH.ok('3 星同时保留「还能抢救一下」（两层是叠加的，不是替换）',
      m3.indexOf('还能抢救一下') >= 0 && m3.indexOf('圣光赐福') >= 0, m3.slice(0, 300));

    /* ---------- 孙笑川：天皇 / 儒雅随和 / 安排上了 ----------
     * ★ 他 1 星**就有被动**（天皇），所以三种形态的差别是"又解锁了一层"，
     *   而不是豆包那种"1 星只给预告"。这三条要分别钉住：
     *     1 星 只有光环 + 一句"还差什么"
     *     2 星 光环 + 技能回血（**不能**提前写倒戈）
     *     3 星 三层全在
     *   ★ 2 星那条是最容易写错的：把 3 星的"倒戈"写进 2 星文案，
     *     玩家会为了一条不生效的规则去升星。 */
    TH.section('孙笑川 · 被动文案');

    var s1b = await pick('butcher', 1);
    TH.ok('1 星显示「天皇」', s1b.indexOf('天皇') >= 0, s1b.slice(0, 160));
    TH.ok('★ 1 星写明「3×3」「+20% 吸血」', s1b.indexOf('3×3') >= 0 &&
      s1b.indexOf('+20%') >= 0 && s1b.indexOf('吸血') >= 0, s1b.slice(0, 200));
    TH.ok('★ 1 星把"还差什么"写在同一行（2 星回血、3 星倒戈）',
      s1b.indexOf('还差') >= 0 && s1b.indexOf('儒雅随和') >= 0 &&
      s1b.indexOf('安排上了') >= 0, s1b.slice(0, 240));
    TH.ok('★ 1 星还没到 2 星，所以**不能**说"技能回血已经生效"',
      s1b.indexOf('转化为自己的治疗') < 0, s1b.slice(0, 240));

    var s2b = await pick('butcher', 2);
    TH.ok('2 星多了「儒雅随和」', s2b.indexOf('儒雅随和') >= 0, s2b.slice(0, 240));
    TH.ok('★ 2 星写明技能伤害 100% 转治疗',
      s2b.indexOf('100%') >= 0 && s2b.indexOf('治疗') >= 0, s2b.slice(0, 260));
    TH.ok('★★ 2 星**不能**提「安排上了」（倒戈是 3 星的，写了就是假信息）',
      s2b.indexOf('安排上了') < 0 || s2b.indexOf('还差') >= 0, s2b.slice(0, 300));
    TH.ok('2 星还保留着「天皇」（三层是叠加的）', s2b.indexOf('天皇') >= 0,
      s2b.slice(0, 160));

    var s3b = await pick('butcher', 3);
    TH.ok('3 星多了「安排上了」', s3b.indexOf('安排上了') >= 0, s3b.slice(0, 320));
    TH.ok('★ 3 星写明「以 20% 生命倒戈成我方单位」',
      s3b.indexOf('20%') >= 0 && s3b.indexOf('倒戈') >= 0 &&
      s3b.indexOf('我方') >= 0, s3b.slice(0, 320));
    TH.ok('★ 3 星写明「对有复活能力的无效」（不说的话玩家会以为能无限招安）',
      s3b.indexOf('有复活能力') >= 0, s3b.slice(0, 340));
    TH.ok('3 星三层全在（天皇 / 儒雅随和 / 安排上了）',
      s3b.indexOf('天皇') >= 0 && s3b.indexOf('儒雅随和') >= 0 &&
      s3b.indexOf('安排上了') >= 0, s3b.slice(0, 340));

    /* ---------- 电棍：导电 / 麻痹 / 三相电 ---------- */
    TH.section('电棍 · 被动文案');

    var e1 = await pick('spearman', 1);
    TH.ok('1 星显示「导电」', e1.indexOf('导电') >= 0, e1.slice(0, 160));
    TH.ok('★ 1 星写明了核心数字：0.5 秒、3×3、25%、最多四次',
      e1.indexOf('0.5 秒') >= 0 && e1.indexOf('3×3') >= 0 &&
      e1.indexOf('25%') >= 0 && e1.indexOf('4 次') >= 0, e1.slice(0, 260));
    TH.ok('★ 1 星写明"同时只能挂 1 条"（这是需求里那条限制）',
      e1.indexOf('同时只能挂 1 条') >= 0, e1.slice(0, 260));
    TH.ok('★ 1 星把"还差什么"写在同一行（2 星眩晕、3 星 3 条）',
      e1.indexOf('还差') >= 0 && e1.indexOf('麻痹') >= 0 &&
      e1.indexOf('三相电') >= 0, e1.slice(0, 300));
    TH.ok('★ 1 星还没到 2 星，**不能**说眩晕已经生效',
      e1.indexOf('额外击晕') < 0, e1.slice(0, 300));

    var e2 = await pick('spearman', 2);
    TH.ok('2 星多了「麻痹」', e2.indexOf('麻痹') >= 0, e2.slice(0, 260));
    TH.ok('★ 2 星写明「额外击晕 0.5 秒」',
      e2.indexOf('击晕') >= 0 && e2.indexOf('0.5 秒') >= 0, e2.slice(0, 300));
    TH.ok('★ 2 星的"同时几条"还是 1（三相电是 3 星的事）',
      e2.indexOf('同时只能挂 1 条') >= 0, e2.slice(0, 300));

    var e3 = await pick('spearman', 3);
    TH.ok('3 星多了「三相电」', e3.indexOf('三相电') >= 0, e3.slice(0, 320));
    TH.ok('★ 3 星的"同时几条"变成 3（按星级取的表，不是写死的）',
      e3.indexOf('同时只能挂 3 条') >= 0, e3.slice(0, 320));
    TH.ok('3 星同时保留前两层（导电 + 麻痹）',
      e3.indexOf('导电') >= 0 && e3.indexOf('麻痹') >= 0, e3.slice(0, 320));

    /* ★★ 4 星：这是刚踩过的坑，必须钉住。
     *   `maxAtOnce` 这张表只写到 3 星。文案层直接 `map[4]` 取到 undefined 后
     *   兜底成 1，于是同一张卡在 3 星写着「同时能挂 3 条」，
     *   **升到 4 星反而变成「只能挂 1 条」**，而且「三相电」那一层直接消失。
     *   战斗引擎里是往低档取的（4 星 = 3 星融合，能力停在 3 星），
     *   所以卡面和实际打起来的效果会互相矛盾 —— 纯数值自检发现不了。 */
    var e4 = await pick('spearman', 4);
    TH.ok('★ 4 星电棍的"同时几条"仍然是 3（4 星不在表里，要往低档取）',
      e4.indexOf('同时只能挂 3 条') >= 0, e4.slice(0, 320));
    TH.ok('★ 4 星不会把「三相电」那一层丢掉（升级不该让人变弱）',
      e4.indexOf('三相电') >= 0, e4.slice(0, 320));
    TH.ok('★ 4 星同时保留导电 + 麻痹（前两层也不该消失）',
      e4.indexOf('导电') >= 0 && e4.indexOf('麻痹') >= 0, e4.slice(0, 320));
    TH.ok('4 星不再有"还差"那一行（已经满了）',
      e4.indexOf('还差') < 0, e4.slice(0, 320));

    /* ---------- 冰冰冰：冻手冻脚 / 千里冰封 ----------
     * ★★ 这个 kind 的两个数字都**不是百分比**（1.5 秒、门槛 2/3 星），
     *   而 `passiveStep` 在这个 kind 上只是"这一星级有没有被动"的开关（1/1）。
     *   照抄 frenzy / healGift 那种 ×100 的写法会显示成「冰冻 150 秒」——
     *   数值全对、不报错，玩家看到的是一个荒谬的秒数。
     *   所以这里把秒数、范围、以及"1 星没有被动"三件事分别钉住。 */
    TH.section('冰冰冰 · 被动文案');

    var f1 = await pick('frostmage', 1);
    TH.ok('★ 1 星不存在"已生效"那一行，走的是升星预告',
      f1.indexOf('被动预览') >= 0, f1.slice(0, 260));
    TH.ok('★ 1 星的预告写明了技能现在打的是 3×3、以及 260 点伤害',
      f1.indexOf('3×3') >= 0 && f1.indexOf('260') >= 0, f1.slice(0, 260));
    TH.ok('★ 1 星的预告写明 2 星带 1.5 秒冰冻、3 星改成打全体',
      f1.indexOf('1.5 秒') >= 0 && f1.indexOf('全体') >= 0, f1.slice(0, 300));
    TH.ok('★ 1 星的预告里不能出现「冰冻 150」这种把秒数当百分比的写法',
      f1.indexOf('150') < 0, f1.slice(0, 300));

    var f2 = await pick('frostmage', 2);
    TH.ok('2 星显示「冻手冻脚」', f2.indexOf('冻手冻脚') >= 0, f2.slice(0, 300));
    TH.ok('★ 2 星写的是「额外冰冻 1.5 秒」，不是「150 秒」',
      f2.indexOf('1.5 秒') >= 0 && f2.indexOf('150') < 0, f2.slice(0, 300));
    TH.ok('★ 2 星仍然写着技能只打 3×3（打全体是 3 星才解锁的）',
      f2.indexOf('3×3') >= 0, f2.slice(0, 320));
    /* ★★ 「3 星会解锁什么」和「3 星已经解锁了」必须分得开。
       两句都提到「千里冰封」，所以只查名字是查不出区别的 ——
       查的是那句**只属于已解锁状态**的话（"不再只看目标格附近"）。 */
    TH.ok('★ 2 星把「千里冰封」写成"还差什么"，而不是已经生效',
      f2.indexOf('还差') >= 0 && f2.indexOf('不再只看目标格附近') < 0,
      f2.slice(0, 340));

    var f3 = await pick('frostmage', 3);
    TH.ok('3 星多了「千里冰封」', f3.indexOf('千里冰封') >= 0, f3.slice(0, 340));
    TH.ok('★ 3 星写明了「技能改成攻击全体敌人」',
      f3.indexOf('全体') >= 0 && f3.indexOf('不再只看目标格附近') >= 0, f3.slice(0, 340));
    TH.ok('★ 3 星同时保留 2 星那一层（冻手冻脚 + 1.5 秒）',
      f3.indexOf('冻手冻脚') >= 0 && f3.indexOf('1.5 秒') >= 0, f3.slice(0, 340));
    TH.ok('3 星不再有"还差"那一行', f3.indexOf('还差') < 0, f3.slice(0, 340));
    TH.ok('★ 文案里不能出现 markdown 的星号（那是文档写法，会原样显示给玩家）',
      f3.indexOf('**') < 0, f3.slice(0, 340));

    var f4 = await pick('frostmage', 4);
    TH.ok('★ 4 星不会把两层被动弄丢（升级不该让人变弱）',
      f4.indexOf('冻手冻脚') >= 0 && f4.indexOf('千里冰封') >= 0, f4.slice(0, 340));
    TH.ok('★ 4 星仍然写着 1.5 秒和打全体（文案和引擎同一套规则）',
      f4.indexOf('1.5 秒') >= 0 && f4.indexOf('全体') >= 0, f4.slice(0, 340));

    /* ★ emoji：冰冰冰挂的是**三个** 🧊。
     *   三个图形按单字号的尺寸横着排，会冲出卡片被 `overflow: hidden` 切掉
     *   （"商店卡 emoji 被切 2px"那条坑就是这么来的），所以按图形个数缩一档。
     *   ★ 这里不靠运气等商店刷出冰冰冰 —— 直接把商店和棋盘都摆成它。 */
    (function () {
      var st2 = G();
      st2.board = { '4,2': { uid: 'ice1', defId: 'frostmage', star: 1, items: [] } };
      st2.bench = new Array(9);
      st2.shop = ['frostmage', 'frostmage', 'frostmage', 'frostmage', 'frostmage'];
      W.Game.refresh();
    })();
    await wait(90);
    var sfb = q('#shop-row .shop-card .sc-fallback');
    TH.ok('商店卡的 emoji 占位还在 DOM 里（立绘是叠在它上面的）', !!sfb);
    TH.ok('★ 商店卡拿到了 sc-fallback-x3（三个冰 → CSS 缩一档）',
      !!sfb && (' ' + sfb.className + ' ').indexOf(' sc-fallback-x3 ') >= 0,
      sfb ? sfb.className : '—');
    var uem = q('#player-half .u-emoji');
    TH.ok('★ 棋盘上的棋子卡同样拿到 u-emoji-x3（用的是同一个类名助手）',
      !!uem && (' ' + uem.className + ' ').indexOf(' u-emoji-x3 ') >= 0,
      uem ? uem.className : '—');
    /* ★ 反向：单个 emoji 的棋子**不能**被加上那两级类名 ——
       照 `.length` 去数的话（'❄️'.length === 2）21 个棋子会被白缩一档。 */
    (function () {
      var st3 = G();
      st3.board = { '4,2': { uid: 'bw1', defId: 'bowman', star: 1, items: [] } };
      W.Game.refresh();
    })();
    await wait(90);
    var uem2 = q('#player-half .u-emoji');
    TH.ok('★ 单个 emoji 的棋子不会被误加多图形类名（❄️ 的 .length 是 2，不能照它判）',
      !!uem2 && uem2.className.indexOf('-x') < 0, uem2 ? uem2.className : '—');

    /* ---------- 美团袋鼠：准时送达 / 好评如潮 ----------
     * ★★ 这个 kind 的数字有三种量纲，混起来最容易出错：
     *     攻速加成是**百分比**（20% → ×100）、持续时间是**秒**（5，不能 ×100）、
     *     治疗量是**生命上限的百分比**（4% → ×100）。
     *   全都走 passiveStep 的 ×100 写法会得到「攻速 +20%、持续 500 秒」，
     *   数值全对、不报错、玩家看到的是一个荒谬的秒数。所以逐条钉住。 */
    TH.section('美团袋鼠 · 被动文案');

    var roo1 = await pick('alchemist', 1);
    TH.ok('★ 1 星走的是"升星预告"（他 1 星本来就没被动）',
      roo1.indexOf('被动预览') >= 0, roo1.slice(0, 300));
    TH.ok('★ 1 星的预告写明了技能本身：治疗外卖 / 投掷一个外卖',
      roo1.indexOf('治疗外卖') >= 0 && roo1.indexOf('投掷一个外卖') >= 0, roo1.slice(0, 320));
    TH.ok('★ 1 星的预告写明 2 星外卖加速 20%、5 秒',
      roo1.indexOf('20%') >= 0 && roo1.indexOf('5 秒') >= 0, roo1.slice(0, 340));
    TH.ok('★ 1 星的预告写明 3 星普攻治疗 3×3 内的友方',
      roo1.indexOf('3×3') >= 0 && roo1.indexOf('普通攻击') >= 0, roo1.slice(0, 360));
    TH.ok('★ 不能把秒数当百分比（不该出现「500 秒」）',
      roo1.indexOf('500') < 0, roo1.slice(0, 360));

    var roo2 = await pick('alchemist', 2);
    TH.ok('2 星显示「准时送达」', roo2.indexOf('准时送达') >= 0, roo2.slice(0, 320));
    TH.ok('★ 2 星写的是「攻速 +20%，持续 5 秒」',
      roo2.indexOf('+20%') >= 0 && roo2.indexOf('5 秒') >= 0, roo2.slice(0, 340));
    TH.ok('★ 2 星还没有「好评如潮」那一层（那是 3 星的事）',
      roo2.indexOf('还差') >= 0 && roo2.indexOf('普通攻击会治疗') < 0, roo2.slice(0, 380));

    var roo3 = await pick('alchemist', 3);
    TH.ok('3 星多了「好评如潮」', roo3.indexOf('好评如潮') >= 0, roo3.slice(0, 380));
    TH.ok('★ 3 星写明了「普通攻击会治疗被攻击敌人 3×3 内的友方」和 4% 最大生命',
      roo3.indexOf('普通攻击会治疗') >= 0 && roo3.indexOf('3×3') >= 0 &&
      roo3.indexOf('% 最大生命') >= 0, roo3.slice(0, 400));
    TH.ok('★ 3 星同时保留 2 星那一层（准时送达还在）',
      roo3.indexOf('准时送达') >= 0 && roo3.indexOf('5 秒') >= 0, roo3.slice(0, 400));
    TH.ok('3 星不再有"还差"那一行', roo3.indexOf('还差') < 0, roo3.slice(0, 400));
    TH.ok('★ 文案里不能出现 markdown 的星号', roo3.indexOf('**') < 0, roo3.slice(0, 400));

    var roo4 = await pick('alchemist', 4);
    TH.ok('★ 4 星不会把两层被动弄丢', 
      roo4.indexOf('准时送达') >= 0 && roo4.indexOf('好评如潮') >= 0, roo4.slice(0, 400));

    /* ---------- 东北雨姐：红薯粉丝 / 雨姐的关照 ----------
     * ★★ 这个 kind 有两个"说错了就是假信息"的地方：
     *   · **捆住 ≠ 眩晕**："钉在原地但还能还手"这半句不写出来，
     *     玩家看到对面被捆住还在打，只会以为出了 bug；
     *   · 8% 是**收件人的生命上限**，不是攻击力、也不是固定值。
     *   另外 1 星没有任何被动（走的是升星预告），4 星不能把两层弄丢。 */
    TH.section('东北雨姐 · 被动文案');

    var yu1 = await pick('templar', 1);
    TH.ok('★ 1 星走的是"升星预告"（他 1 星本来就没被动）',
      yu1.indexOf('被动预览') >= 0, yu1.slice(0, 300));
    TH.ok('★ 1 星的预告写明了技能本身（圣盾术 + 套护盾）',
      yu1.indexOf('圣盾术') >= 0 && yu1.indexOf('护盾') >= 0, yu1.slice(0, 320));
    TH.ok('★ 1 星的预告写明 2 星捆人 3 秒、5×5 范围',
      yu1.indexOf('3 秒') >= 0 && yu1.indexOf('5×5') >= 0, yu1.slice(0, 360));
    TH.ok('★ 1 星的预告写明 3 星"攻击被捆住的敌人"给最低血队友回 8%',
      yu1.indexOf('被捆住') >= 0 && yu1.indexOf('8%') >= 0, yu1.slice(0, 400));

    var yu2 = await pick('templar', 2);
    TH.ok('2 星显示「红薯粉丝」', yu2.indexOf('红薯粉丝') >= 0, yu2.slice(0, 340));
    TH.ok('★★ 2 星写明了「钉在原地，但还能还手」（不写玩家会以为是眩晕）',
      yu2.indexOf('钉在原地') >= 0 && yu2.indexOf('还手') >= 0, yu2.slice(0, 400));
    TH.ok('★ 2 星写的是 3 秒 / 5×5', 
      yu2.indexOf('3 秒') >= 0 && yu2.indexOf('5×5') >= 0, yu2.slice(0, 400));
    TH.ok('★ 2 星还没有「雨姐的关照」那一层（那是 3 星的事）',
      yu2.indexOf('还差') >= 0 && yu2.indexOf('打在') < 0, yu2.slice(0, 420));

    var yu3 = await pick('templar', 3);
    TH.ok('3 星多了「雨姐的关照」', yu3.indexOf('雨姐的关照') >= 0, yu3.slice(0, 420));
    TH.ok('★ 3 星写明了「攻击被捆住的敌人」+「血量百分比最低的队友」+ 8% 最大生命',
      yu3.indexOf('被捆住') >= 0 && yu3.indexOf('血量百分比最低') >= 0 &&
      yu3.indexOf('8%') >= 0, yu3.slice(0, 440));
    TH.ok('★ 3 星同时保留 2 星那一层（红薯粉丝还在）',
      yu3.indexOf('红薯粉丝') >= 0 && yu3.indexOf('钉在原地') >= 0, yu3.slice(0, 440));
    TH.ok('3 星不再有"还差"那一行', yu3.indexOf('还差') < 0, yu3.slice(0, 440));
    TH.ok('★ 文案里不能出现 markdown 的星号', yu3.indexOf('**') < 0, yu3.slice(0, 440));

    var yu4 = await pick('templar', 4);
    TH.ok('★ 4 星不会把两层被动弄丢',
      yu4.indexOf('红薯粉丝') >= 0 && yu4.indexOf('雨姐的关照') >= 0, yu4.slice(0, 440));

    /* ---------- 奶龙：捧腹大笑 / 笑气护体 / 边走边笑 / 笑传四方 ----------
     * ★★ 这一组最容易写错的地方和抓娃娃、荣誉一样：
     *   laugh 的三层**没有任何百分比数字**（门槛是 2 星能移动、3 星能治疗），
     *   而技能本身的两个百分比（-80% / 10%）是**比例**。
     *   照抄别的 kind 那种 ×100 的写法，会显示成「受到的伤害 -8000%」；
     *   反过来，把 2 星门槛当成百分比又会写出一堆假数字。
     *   所以这里逐条把数字钉住。 */
    TH.section('奶龙 · 被动文案');

    var n1 = await pick('stoneguard', 1);
    TH.ok('1 星显示「笑气护体」', n1.indexOf('笑气护体') >= 0, n1.slice(0, 140));
    TH.ok('★ 文案写明了「大笑 3 秒」', n1.indexOf('大笑 3 秒') >= 0, n1.slice(0, 200));
    TH.ok('★ 减伤写的是「-80%」，不是「-8000%」',
      n1.indexOf('-80%') >= 0 && n1.indexOf('8000') < 0, n1.slice(0, 220));
    TH.ok('★ 回血写的是「10% 最大生命」，不是「1000%」',
      n1.indexOf('10% 最大生命') >= 0 && n1.indexOf('1000') < 0, n1.slice(0, 220));
    TH.ok('1 星不提「边走边笑」和「笑传四方」（那是 2/3 星的事）',
      n1.indexOf('边走边笑') < 0 && n1.indexOf('笑传四方') < 0, n1.slice(0, 220));

    var n2 = await pick('stoneguard', 2);
    TH.ok('★ 2 星多了「边走边笑」', n2.indexOf('边走边笑') >= 0, n2.slice(0, 240));
    TH.ok('★ 2 星写明「大笑时可以移动（仍然不能攻击）」——不能只写"能移动"',
      n2.indexOf('大笑时可以移动') >= 0 && n2.indexOf('不能攻击') >= 0, n2.slice(0, 260));
    TH.ok('2 星还没有「笑传四方」', n2.indexOf('笑传四方') < 0, n2.slice(0, 240));

    var n3 = await pick('stoneguard', 3);
    TH.ok('★ 3 星多了「笑传四方」', n3.indexOf('笑传四方') >= 0, n3.slice(0, 300));
    TH.ok('★ 3 星写的是「3×3 范围内的队友」（半径 1，不是 1×1）',
      n3.indexOf('3×3 范围内的队友') >= 0, n3.slice(0, 320));
    TH.ok('★ 3 星的文案同时保留前两层（三层是叠加的）',
      n3.indexOf('笑气护体') >= 0 && n3.indexOf('边走边笑') >= 0, n3.slice(0, 300));

    /* ★ 1 星的「升星预告」也不能是空话：奶龙 1 星就有被动，
       所以预告要说的是**还差什么**，而且要把「大笑本身给了什么」带上 ——
       否则玩家只看到两个解锁项，不知道这个被动在干什么。 */
    var n1b = await pick('stoneguard', 1);
    TH.ok('★ 1 星的被动里已经说明了大笑本身的效果（减伤 + 回血）',
      n1b.indexOf('受到的伤害') >= 0 && n1b.indexOf('每秒回复') >= 0, n1b.slice(0, 240));

    /* ---------- 嘉豪：男人领域 / 两个男人 / 三个男人 ----------
     * ★★ 这个 passive 的 perHit 是 **0/1/1** —— 它只是个"这一星级有没有被动"
     *   的开关，真正的数字在 targets / durMul 里。
     *   把 step 当百分比 ×100 的话，文案会变成「一次控 100 个人」；
     *   反过来，直读 targets 却不提时长的话，玩家又不知道 3 星多拿了什么。
     *   所以两条都钉住。 */
    TH.section('嘉豪 · 被动文案');

    var v1 = await pick('vine', 1);
    TH.ok('★ 1 星是纯预告（改名前它压根没有被动）',
      v1.indexOf('被动预览') >= 0, v1.slice(0, 140));
    TH.ok('★ 1 星的预告写明了「2 星控 2 个、3 星控 3 个」',
      v1.indexOf('两个男人') >= 0 && v1.indexOf('三个男人') >= 0 &&
      v1.indexOf('控制 2 个人') >= 0 && v1.indexOf('控 3 个人') >= 0, v1.slice(0, 260));
    TH.ok('★ 1 星的预告写明了「3 星眩晕翻倍：1.2 → 2.4 秒」',
      v1.indexOf('×2') >= 0 && v1.indexOf('1.2') >= 0 && v1.indexOf('2.4') >= 0,
      v1.slice(0, 300));

    var v2 = await pick('vine', 2);
    TH.ok('2 星显示「两个男人」', v2.indexOf('两个男人') >= 0, v2.slice(0, 200));
    TH.ok('★ 2 星写的是「一次同时控制 2 个人」，不是「100 个人」',
      v2.indexOf('控制 2 个人') >= 0 && v2.indexOf('100') < 0, v2.slice(0, 240));
    TH.ok('★ 2 星写明时长还是 1.2 秒（翻倍是 3 星的事）',
      v2.indexOf('1.2 秒') >= 0, v2.slice(0, 240));
    TH.ok('★ 2 星把「3 星还会翻倍」写成预告，而不是当成已经生效',
      v2.indexOf('3 星') >= 0 && v2.indexOf('2.4') >= 0, v2.slice(0, 300));

    var v3 = await pick('vine', 3);
    TH.ok('3 星显示「三个男人」', v3.indexOf('三个男人') >= 0, v3.slice(0, 240));
    TH.ok('★ 3 星写的是「控 3 个 + 眩晕 ×2（1.2 → 2.4 秒）」',
      v3.indexOf('到 3 个') >= 0 && v3.indexOf('×2') >= 0 && v3.indexOf('2.4') >= 0,
      v3.slice(0, 320));
    TH.ok('★ 3 星的文案同时保留 2 星那一层（两层是叠加的）',
      v3.indexOf('两个男人') >= 0 && v3.indexOf('三个男人') >= 0, v3.slice(0, 300));

    /* ---------- 羊帆：羊巅峰 / 笑上巅峰 / 巅峰谢幕 ----------
     * ★★ 和嘉豪一样，这个 passive 的 perHit 也是 0/1/1（纯开关），
     *   而真正的数字是 20 / 3 / 20 三个 **次数与倍率** ——
     *   无脑 ×100 会写成「×2000」「震晕 300 秒」「攻击力 ×2000」。
     *   所以这里逐条把三个数字钉住。 */
    TH.section('羊帆 · 被动文案');

    var y1 = await pick('pyromancer', 1);
    TH.ok('★ 1 星是纯预告（改名前它压根没有被动）',
      y1.indexOf('被动预览') >= 0 && y1.indexOf('羊巅峰') >= 0, y1.slice(0, 160));
    TH.ok('★ 1 星的预告写明「下一次普攻 ×20」',
      y1.indexOf('×20') >= 0 && y1.indexOf('2000') < 0, y1.slice(0, 260));
    TH.ok('★ 1 星的预告写明 2 星震晕 3 秒、3 星自爆吃攻击力 ×20',
      y1.indexOf('震晕 3 秒') >= 0 && y1.indexOf('自爆') >= 0 &&
      y1.indexOf('×20') >= 0, y1.slice(0, 320));

    var y2 = await pick('pyromancer', 2);
    TH.ok('2 星显示「笑上巅峰」', y2.indexOf('笑上巅峰') >= 0, y2.slice(0, 240));
    TH.ok('★ 2 星写的是「巅峰一击把目标震晕 3 秒」，不是「300 秒」',
      y2.indexOf('震晕 3 秒') >= 0 && y2.indexOf('300') < 0, y2.slice(0, 300));
    TH.ok('★ 2 星还没有「巅峰谢幕」（自爆是 3 星的事）',
      y2.indexOf('巅峰谢幕') < 0, y2.slice(0, 260));

    var y3 = await pick('pyromancer', 3);
    TH.ok('3 星显示「巅峰谢幕」', y3.indexOf('巅峰谢幕') >= 0, y3.slice(0, 300));
    TH.ok('★ 3 星写的是「阵亡 1 秒后自爆，3×3 吃攻击力 ×20 的伤害」',
      y3.indexOf('自爆') >= 0 && y3.indexOf('3×3') >= 0 && y3.indexOf('攻击力 ×20') >= 0,
      y3.slice(0, 360));
    TH.ok('★ 3 星的文案同时保留 2 星那一层（两层是独立的，都要在）',
      y3.indexOf('笑上巅峰') >= 0 && y3.indexOf('巅峰谢幕') >= 0, y3.slice(0, 340));

    /* ---------- 楚生疑犯：阴暗领域 / 同伙掩护 / 遁入暗影 ----------
     * ★★ 这一组要钉住的是三个**倍率/秒数**（半径 4、减伤 30%、攻速 ×0.5、伤害 ×2）。
     *   无脑 ×100 会写成「半径 400」「减伤 3000%」「攻速 ×50」。 */
    TH.section('楚生疑犯 · 被动文案');

    var c1 = await pick('windcaller', 1);
    TH.ok('★ 1 星是纯预告（改名前它压根没有被动）',
      c1.indexOf('被动预览') >= 0 && c1.indexOf('阴暗领域') >= 0, c1.slice(0, 160));
    TH.ok('★ 1 星的预告写明了翻倍后的范围「9×9」（半径 4）',
      c1.indexOf('9×9') >= 0 && c1.indexOf('400') < 0, c1.slice(0, 260));
    TH.ok('★ 1 星的预告写明了「敌人攻速移速减半」',
      c1.indexOf('攻速移速减半') >= 0, c1.slice(0, 300));
    TH.ok('★ 1 星的预告写明 2 星减伤 30%、3 星遁入暗影',
      c1.indexOf('少受 30%') >= 0 && c1.indexOf('遁入暗影') >= 0 &&
      c1.indexOf('3000') < 0, c1.slice(0, 400));

    var c2 = await pick('windcaller', 2);
    TH.ok('2 星显示「同伙掩护」', c2.indexOf('同伙掩护') >= 0, c2.slice(0, 300));
    TH.ok('★ 2 星写的是「领域里的队友少受 30% 的伤害」',
      c2.indexOf('少受 30%') >= 0 && c2.indexOf('3000') < 0, c2.slice(0, 360));
    TH.ok('★ 2 星还没有「遁入暗影」（那是 3 星的事）',
      c2.indexOf('遁入暗影') < 0, c2.slice(0, 320));

    var c3 = await pick('windcaller', 3);
    TH.ok('3 星显示「遁入暗影」', c3.indexOf('遁入暗影') >= 0, c3.slice(0, 400));
    TH.ok('★ 3 星写的是「攻速 ×0.5、伤害 ×2、免疫一切伤害、不会被索敌」',
      c3.indexOf('攻速 ×0.5') >= 0 && c3.indexOf('伤害 ×2') >= 0 &&
      c3.indexOf('免疫一切伤害') >= 0 && c3.indexOf('不会被索敌') >= 0,
      c3.slice(0, 460));
    TH.ok('★ 3 星写明了退出条件「直到队友全部阵亡」（这是终止条件，不能漏）',
      c3.indexOf('直到队友全部阵亡') >= 0, c3.slice(0, 460));
    TH.ok('★ 3 星的文案同时保留 2 星那一层（两件事是独立的）',
      c3.indexOf('同伙掩护') >= 0 && c3.indexOf('遁入暗影') >= 0, c3.slice(0, 440));

    /* ---------- Dank1ng：空悲切 / 老男孩 / 锁头 ----------
     * ★★ 这个被动是**1 星就有**的（空悲切），所以 1 星的文案不是"预览"
     *   而是"已解锁 + 还差什么"。而且三个数字（×2 能量回复、击杀回满）
     *   都要钉住 —— perHit 在这条上只是开关，无脑 ×100 会写成「×200」。 */
    TH.section('Dank1ng · 被动文案');

    var k1 = await pick('deadeye', 1);
    TH.ok('★ 1 星显示「空悲切」（不是"预览"——它 1 星就有被动，界面走的是说明那一行）',
      k1.indexOf('空悲切') >= 0 && k1.indexOf('被动预览') < 0, k1.slice(0, 240));
    TH.ok('★ 1 星写明了「队友全部阵亡后能量无限」',
      k1.indexOf('队友全部阵亡') >= 0 && k1.indexOf('能量无限') >= 0, k1.slice(0, 300));
    TH.ok('★ 1 星把「还差什么」也写在同一行里（2 星满能量、3 星锁头）',
      k1.indexOf('还差') >= 0 && k1.indexOf('老男孩') >= 0 && k1.indexOf('锁头') >= 0,
      k1.slice(0, 400));

    var k2 = await pick('deadeye', 2);
    TH.ok('2 星显示「老男孩」', k2.indexOf('老男孩') >= 0, k2.slice(0, 300));
    TH.ok('★ 2 星写的是「开局满能量」', k2.indexOf('开局满能量') >= 0, k2.slice(0, 320));
    /* ★ 2 星**不能**已经解锁锁头 —— 但"还差什么"那段预告里本来就会提到
       「锁头」这个词，所以判据要**只看预告之前**那半句。 */
    var k2head = k2.split('还差')[0];
    TH.ok('★ 2 星还没解锁「锁头」（只出现在"还差什么"的预告里）',
      k2.indexOf('锁头') >= 0 && k2head.indexOf('锁头') < 0, k2.slice(0, 340));

    var k3 = await pick('deadeye', 3);
    TH.ok('3 星显示「锁头」', k3.indexOf('锁头') >= 0, k3.slice(0, 380));
    TH.ok('★ 3 星写的是「能量回复 ×2」+「击杀回满能量」，不是 ×200',
      k3.indexOf('能量回复 ×2') >= 0 && k3.indexOf('击杀都把能量回满') >= 0 &&
      k3.indexOf('×200') < 0, k3.slice(0, 420));
    TH.ok('★ 3 星的文案同时保留前两层（三条规则是独立的）',
      k3.indexOf('老男孩') >= 0, k3.slice(0, 400));

    // 收尾：把场上清干净，别影响后面的用例
    st.board = {};
    st.bench = new Array(9);
    W.Game.refresh();
    await wait(80);
  }

  /* ============================================================
   * 五c、狙击的视觉表现（弹道 + 字幕）
   *
   *   ★ 这一组存在的理由：上一版荣誉的弹道是 5px 光带、字幕是 CELL×0.30，
   *     在 95px 的格子上**实测看不清** —— 玩家根本不知道这一枪打出去了。
   *     那次纯数值自检全绿（数值一点没错），是肉眼反馈才发现的问题。
   *     所以把「够不够大」也变成断言：以后谁把字号改回去，这里就会红。
   * ============================================================ */
  async function testSnipeVfx() {
    TH.section('狙击 · 视觉表现');

    var SAP = ['sapphire', 'sapphire', 'sapphire'];
    var result = W.ST.Battle.battle({
      a: [{ id: 'bowman', star: 3, items: SAP, r: 4, c: 4 }],
      b: [{ id: 'titan', star: 3, r: 3, c: 3 }]
    }, 313131);

    var shots = result.log.filter(function (e) { return e.type === 'snipe'; });
    TH.ok('这一场至少开了一枪（否则后面全是空断言）', shots.length > 0, shots.length + ' 枪');

    W.Arena.play(result);
    var sawCallout = null, sawTracer = false, sawMuzzle = false;
    var sawLaser = 0, laserPeak = 0, laserLife = 0, chargeSeen = 0;
    for (var i = 0; i < 900; i++) {
      W.Arena.step(1 / 30);
      var fl = W.Arena.fxList();
      var lasersNow = 0;
      for (var k = 0; k < fl.length; k++) {
        if (fl[k].type === 'tracer') sawTracer = true;
        if (fl[k].type === 'muzzle') sawMuzzle = true;
        if (fl[k].type === 'eyelaser') {
          lasersNow++;
          if (fl[k].life > laserLife) laserLife = fl[k].life;
        }
        if (fl[k].type === 'callout' && !sawCallout) sawCallout = fl[k];
      }
      if (lasersNow > laserPeak) laserPeak = lasersNow;
      if (lasersNow > 0) sawLaser++;
      if (sawCallout && sawTracer && sawMuzzle && laserPeak > 0) break;
    }
    for (var ci = 0; ci < result.log.length; ci++) {
      if (result.log[ci].type === 'charge') chargeSeen++;
    }

    var cell = W.Arena.cell();
    TH.ok('开枪时有一道曳光弹', sawTracer);
    TH.ok('开枪时枪口有闪光（混战里才知道是谁开的枪）', sawMuzzle);
    TH.ok('开枪时弹出了字幕', !!sawCallout, sawCallout ? sawCallout.text : '没有字幕');
    /* ★ 蓄力的视觉：两只眼睛各一道金色激光，持续整个 CHARGE_TIME。
       「眼睛先喷激光、再开枪」是这次改动的一半，光验规则（simtest 里验了
       charge 事件）不够 —— 事件对了但特效没画出来，玩家一样什么都看不见。 */
    TH.eq('★ 蓄力时两只眼睛各射一道激光（峰值正好 2 条）', laserPeak, 2);
    TH.ok('★ 激光确实持续了若干帧（不是闪一帧就没了）', sawLaser >= 10,
      sawLaser + ' 帧里能看到激光');
    TH.ok('★ 激光寿命 = CFG.CHARGE_TIME（激光消失的那一帧子弹正好出膛）',
      Math.abs(laserLife - W.ST.BATTLE_CFG.CHARGE_TIME) < 0.01,
      '激光 ' + laserLife + 's　CHARGE_TIME ' + W.ST.BATTLE_CFG.CHARGE_TIME + 's');
    TH.ok('这一场确实蓄过力（否则上面几条是空断言）', chargeSeen > 0, chargeSeen + ' 次蓄力');
    if (sawCallout) {
      TH.ok('字幕内容是 Vamos 或 Kale',
        sawCallout.text === 'Vamos' || sawCallout.text === 'Kale', sawCallout.text);
      TH.ok('★ 字幕字号 >= 格子的 55%（95px 格子上约 52px，看得清）',
        sawCallout.size >= cell * 0.55,
        '字号 ' + sawCallout.size + 'px　格子 ' + cell + 'px　比例 ' +
        Math.round(sawCallout.size / cell * 100) + '%');
      TH.ok('★ 字幕停留时间 >= 1.2 秒（一闪而过等于没有）',
        sawCallout.life >= 1.2, sawCallout.life + 's');
      // 保底命中的那两枪是青色的（3 星前两枪必定命中）
      TH.ok('保底命中的字幕是青色，和「赌中的」区分开',
        sawCallout.color === '#7ef0d8', sawCallout.color);
    }

    // 画布上真的多了东西：比较开枪前后的非背景像素
    var cv = $('arena');
    function paintedCount() {
      var img = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      var n = 0;
      for (var p2 = 0; p2 < img.length; p2 += 4 * 31) {
        if (Math.abs(img[p2] - 240) > 14 || Math.abs(img[p2 + 1] - 243) > 14 ||
            Math.abs(img[p2 + 2] - 240) > 14) n++;
      }
      return n;
    }
    var withFx = paintedCount();
    TH.ok('字幕/弹道确实画到了画布上（非背景像素足够多）', withFx > 200, withFx + ' 个采样点');
  }

  /* ============================================================
   * 五d、牢大的三件事：肘击喊话 / 坠机 / 复活
   *
   *   ★ 这一组只验「画面表达了没有」—— 规则（击退、3×3、复活时机）
   *     已经在 simtest 里验过了。这里要防的是
   *     「事件都对，但玩家什么都看不见」这一类问题。
   * ============================================================ */
  async function testBruteVfx() {
    TH.section('牢大 · 肘击 / 坠机');

    /* ★ 给牢大带 3 块蓝水晶 = 开局满蓝，第一帧就放「肘击」。
       为什么必须这样：对手是张雪峰，他现在开局攻速翻倍、普攻还是 3×3 ——
       不带蓝水晶的话牢大 7 秒就被砍死，一次技能都放不出来，
       「Man！」和坠机全都测不到（这正是上一轮报的那两条失败）。 */
    var result = W.ST.Battle.battle({
      a: [{ id: 'brute', star: 2, items: ['sapphire', 'sapphire', 'sapphire'], r: 5, c: 3 }],
      b: [{ id: 'blademaster', star: 3, items: ['giantblade', 'huntereye', 'infinity'] }]
    }, 707070);

    var kinds = {};
    result.log.forEach(function (e) { kinds[e.type] = (kinds[e.type] || 0) + 1; });
    TH.ok('这一场里牢大倒了（否则后面全是空断言）', (kinds.down || 0) > 0,
      'down=' + (kinds.down || 0) + ' crash=' + (kinds.crash || 0) + ' revive=' + (kinds.revive || 0));

    W.Arena.play(result);
    var sawManCallout = null, sawStrike = false, sawBlast = false, sawPillar = false;
    var calloutShot = null;      // 趁喊话刚冒出来（还没上飘）截一张，用来量"有没有底板"
    for (var i = 0; i < 1000; i++) {
      W.Arena.step(1 / 30);
      var fl = W.Arena.fxList();
      for (var k = 0; k < fl.length; k++) {
        var f = fl[k];
        if (f.type === 'strike') sawStrike = true;
        if (f.type === 'blast') sawBlast = true;
        if (f.type === 'pillar') sawPillar = true;
        if (f.type === 'callout' && f.text === 'Man！' && !sawManCallout) sawManCallout = f;
      }
      // 喊话刚出现、位移还不到 15% 的那一帧 —— 位置基本就是 fx 上的 x/y
      if (sawManCallout && !calloutShot && sawManCallout.age * 30 <= 2) {
        calloutShot = { x: sawManCallout.x, y: sawManCallout.y, size: sawManCallout.size };
      }
    }

    TH.ok('肘击会喊出 Man！', !!sawManCallout, sawManCallout ? sawManCallout.text : '没有喊话');
    TH.ok('倒下时有一条正在落下来的残影', sawStrike);
    TH.ok('坠机时有爆炸', sawBlast);
    TH.ok('复活时有光柱', sawPillar);

    /* ★ 字幕「只要字、不要边框」的像素证据。
     *
     *   上一版是一块半透明深色圆角底板 + 彩色描边：
     *   在喊话那块矩形里，**深色像素会占到八九成**（整块板子都是暗的）。
     *   现在只有字 —— 深色只剩描边那几条细线，占比应该很低。
     *   所以拿「深色像素占矩形面积的比例」当判据：
     *   底板在的时候它接近 0.8，只有字的时候远低于一半。
     *   这一条是「不要边框」这个要求在自检里唯一的落脚点，
     *   否则哪天有人把底板加回来，除了肉眼没人会发现。 */
    if (calloutShot) {
      var cv = $('arena');
      var g2 = cv.getContext('2d');
      var w = Math.round(calloutShot.size * 3.1);
      var h = Math.round(calloutShot.size * 1.3);
      var x0 = Math.max(0, Math.round(calloutShot.x - w / 2));
      var y0 = Math.max(0, Math.round(calloutShot.y - h / 2));
      w = Math.min(cv.width - x0, w); h = Math.min(cv.height - y0, h);
      var img = g2.getImageData(x0, y0, w, h).data;
      var dark = 0, total = 0;
      for (var p = 0; p < img.length; p += 4) {
        total++;
        if (img[p] < 70 && img[p + 1] < 70 && img[p + 2] < 70) dark++;
      }
      var ratio = dark / Math.max(1, total);
      TH.ok('★ 喊话只有字、没有底板（深色像素占那块矩形的比例远低于一半）',
        ratio < 0.45,
        '深色占比 ' + Math.round(ratio * 100) + '%（有底板的那一版约 80%）　采样 ' + w + '×' + h);
    } else {
      TH.ok('截到了喊话刚出现的那一帧（用于量底板）', false, '没截到');
    }
  }

  /* ============================================================
   * 五e、鸭子的「抓娃娃」在画面上看得见
   *
   *   规则在 simtest 里验过了（挡几次、血盾不动）。这里只问一件事：
   *   **玩家能不能看出它还在免伤**。
   *   它只有 95 血，全部生存能力都押在那串次数上 ——
   *   卡片上那个 🛡N 徽章要是没画出来，玩家只会觉得"这卡莫名其妙不死"。
   * ============================================================ */
  async function testDuckVfx() {
    TH.section('100元的鸭子 · 抓娃娃');

    var result = W.ST.Battle.battle({
      a: [{ id: 'ironwall', star: 2, r: 4, c: 3 }],
      b: [{ id: 'dagger', star: 1, items: ['belt', 'belt', 'belt'], r: 3, c: 3 }]
    }, 313131);

    var blocks = result.log.filter(function (e) { return e.type === 'block'; });
    TH.ok('这一场里鸭子真的挡下了攻击', blocks.length > 0, blocks.length + ' 次');

    W.Arena.play(result);
    var startLeft = null, sawClang = false, minLeft = 999, dropped = 0;
    for (var i = 0; i < 1000; i++) {
      W.Arena.step(1 / 30);
      var fl = W.Arena.fxList();
      for (var k = 0; k < fl.length; k++) {
        // 挡伤会飘一个「挡」字出来
        if (fl[k].type === 'num' && fl[k].text === '挡') sawClang = true;
      }
      var us = W.Arena.units();
      var duck = null;
      for (var uid in us) if (us[uid].defId === 'ironwall' && us[uid].side === 'a') duck = us[uid];
      if (!duck) continue;
      if (startLeft === null) startLeft = duck.guardLeft;
      if (duck.guardLeft < minLeft) { minLeft = duck.guardLeft; dropped++; }
    }

    var wantLeft = W.ST.passiveStep(W.ST.UNIT_BY_ID.ironwall, 2);
    TH.ok('★ 开局时鸭子身上带着满格免伤次数', startLeft === wantLeft,
      '起始 ' + startLeft + ' 次（2 星应该是 ' + wantLeft + ' 次）');
    TH.ok('★ 免伤次数会随着挨打往下掉（卡片上的 🛡N 是活的）',
      minLeft < startLeft, startLeft + ' → ' + minLeft + '（掉了 ' + dropped + ' 次）');
    TH.ok('★ 挡下攻击时有「挡」字飘出来（玩家能看出这一下没打动它）', sawClang);
  }

  /* ============================================================
   * 五f、张雪峰的超频在画面上看得见
   *
   *   规则在 simtest 里验过了。这里只问一件事：
   *   **玩家能不能看出他正在自毁**。
   *   他每秒掉 44% 当前生命，如果画面上什么都不说，
   *   玩家只会觉得「我的五费怎么自己掉血」。
   * ============================================================ */
  async function testZhangVfx() {
    TH.section('张雪峰 · 超频表现');

    /* ★ 场景和 simtest 里那套一样：**3 星**张雪峰 + 四个摊开的 3 星山岳 + 一个医师。
       · 用 3 星是因为要验的台词/自毁都发生在「叠到 +200%」之后，
         而 3 星才有 3×3 普攻，出手次数才够（1/2 星是单体，砍得慢）。
       · 一个山岳不够：他 18 秒就把它砍了，攻速只叠到 +164%，
         走不到阈值（这是这一条最初报红的原因）。 */
    var result = W.ST.Battle.battle({
      a: [{ id: 'blademaster', star: 3, items: ['dragonscale', 'dragonscale', 'belt'], r: 4, c: 3 },
          { id: 'medic', star: 3, items: ['sapphire', 'sapphire', 'sapphire'], r: 6, c: 6 }],
      b: [{ id: 'titan', star: 3, items: ['belt', 'belt', 'belt'], r: 3, c: 3 },
          { id: 'titan', star: 3, items: ['belt', 'belt', 'belt'], r: 0, c: 3 },
          { id: 'titan', star: 3, items: ['belt', 'belt', 'belt'], r: 2, c: 0 },
          { id: 'titan', star: 3, items: ['belt', 'belt', 'belt'], r: 2, c: 7 }]
    }, 313131);

    var ocs = result.log.filter(function (e) { return e.type === 'ocas'; });
    var burns = result.log.filter(function (e) { return e.type === 'selfburn'; });
    TH.ok('这一场叠到了越线（否则后面全是空断言）',
      ocs.some(function (e) { return e.justOver; }),
      ocs.length + ' 次叠攻速 / ' + burns.length + ' 次自毁');

    W.Arena.play(result);
    var sawOverCallout = false, sawBurnNum = false;
    var ocRose = false, lastOc = 0, hpAtOver = null, minHpAfterOver = null;
    for (var i = 0; i < 2000; i++) {
      W.Arena.step(1 / 30);
      var fl = W.Arena.fxList();
      for (var k = 0; k < fl.length; k++) {
        /* ★ 喊的是**状态名**「狂暴」，不是被动名 ——
           进狂暴之后玩家要认的是"他现在在烧自己"，
           而且「狂暴」是这一版新引入的说法，文案和画面必须一致。 */
        if (fl[k].type === 'callout' && fl[k].text === '狂暴！') sawOverCallout = true;
        // 自毁的飘字用独立的 kind，取色也独立 —— 和"挨打"的白/黄一眼分得开
        if (fl[k].type === 'num' && fl[k].kind === 'selfBurn') sawBurnNum = true;
      }
      var us = W.Arena.units(), me = null;
      for (var uid in us) if (us[uid].defId === 'blademaster') me = us[uid];
      if (!me) continue;
      if (me.oc > lastOc) { ocRose = true; lastOc = me.oc; }
      if (me.ocOver) {
        if (hpAtOver === null) hpAtOver = me.hp;
        if (minHpAfterOver === null || me.hp < minHpAfterOver) minHpAfterOver = me.hp;
      }
    }

    TH.ok('★ 攻速加成会一路上涨（卡片上的 ⚡+N% 是活的）', ocRose,
      '最后 +' + Math.round(lastOc * 100) + '%');
    TH.ok('★ 进入狂暴时会弹出「狂暴！」的台词', sawOverCallout);
    TH.ok('★ 自毁时有独立的红色伤害数字（kind=selfBurn，和挨打的白/黄区分开）', sawBurnNum);
    /* ★ 只断言"血量比刚超频时更低" —— 不断言它没死：
       超频本身就是自毁，它死掉才是正常的，写成 hp > 0 反而是错的。 */
    TH.ok('★ 越线之后血量真的在往下掉（不只是数字好看）',
      hpAtOver !== null && minHpAfterOver !== null && minHpAfterOver < hpAtOver,
      hpAtOver === null ? '没进入超频'
        : (Math.round(hpAtOver) + ' → ' + Math.round(minHpAfterOver)));
  }

  /* ============================================================
   * 五h、老牧师的「临终祷告」在画面上看得见
   *
   *   规则在 simtest 里验过了。这里只问一件事：
   *   **那 1 秒里，玩家知不知道有人在救他。**
   *   队友倒下的瞬间卡片就灰了（阵亡态），如果这 1 秒什么都不画，
   *   玩家看到的就只是"我的棋子死了"，然后它莫名其妙又站起来了。
   *
   *   ★ 所以这条要验的是三件事，缺一件这个表现就不算做完：
   *     ① 倒下时立刻有「还能抢救一下」+ 一圈光环 + 一条连到牧师的光束
   *     ② 1 秒后真的站起来（渲染层的 alive 必须跟着变回 true）
   *     ③ 3 星时还要看得出"两个人都变强了"（+20% 的字幕和名单）
   * ============================================================ */
  async function testMedicVfx() {
    TH.section('老牧师 · 临终祷告表现');

    /* 场景取的是 simtest 里探出来的那一套（3 星山岳**不带装备** + 3 星弓）：
       它有个好性质 —— 被救的人复活前后都打得到人，而且对局跑 51 秒。
       ★ 坐标必须按半场给（a 是 0~3 行、b 是 4~7 行），
         给错半场引擎会**静默自动布阵**，前排/后排的意图就没了。 */
    var result = W.ST.Battle.battle({
      a: [{ id: 'medic', star: 3, items: ['belt', 'belt', 'belt'], r: 0, c: 0 },
          { id: 'bowman', star: 3, r: 3, c: 3 }],
      b: [{ id: 'titan', star: 3, r: 4, c: 3 }]
    }, 424242);
    var rites = result.log.filter(function (e) { return e.type === 'lastRites'; });
    var saved = result.log.filter(function (e) { return e.type === 'reviveAlly' && e.ok; });
    TH.ok('这一场确实触发了临终祷告（否则后面全是空断言）', rites.length > 0,
      rites.length + ' 次祷告 / ' + saved.length + ' 次复活');
    if (!rites.length || !saved.length) return;
    var savedUid = saved[0].who, savedT = saved[0].t;

    W.Arena.play(result);
    var sawRitesCallout = false, sawBeam = false, sawBackCallout = false, sawBlessCallout = false;
    var aliveAtRevive = null, hpBeforeRevive = null, hpAfterRevive = null;
    var steps = Math.min(2400, Math.ceil((savedT + 3) * 30));
    for (var i = 0; i < steps; i++) {
      W.Arena.step(1 / 30);
      var fl = W.Arena.fxList();
      for (var k = 0; k < fl.length; k++) {
        if (fl[k].type === 'callout') {
          if (fl[k].text === '还能抢救一下') sawRitesCallout = true;
          if (fl[k].text === '我回来了') sawBackCallout = true;
          if (String(fl[k].text).indexOf('圣光赐福') === 0) sawBlessCallout = true;
        }
        /* ★ 光束是**新加的 FX 类型**（beam），它不是"顺便复用一下激光"——
           用途完全不同：激光指向"马上要开枪"，光束指向"我在救他"。
           所以要专门断言它出现过，不然哪天把它删了也没人发现。 */
        if (fl[k].type === 'beam') sawBeam = true;
      }
      var us = W.Arena.units();
      var me = us[savedUid];
      if (!me) continue;
      // 复活那一帧之前：渲染层必须认为他是**死的**
      if (W.Arena.time() < savedT - 0.2) hpBeforeRevive = me.alive;
      if (W.Arena.time() > savedT + 0.2) {
        aliveAtRevive = me.alive;
        hpAfterRevive = me.hp;
      }
    }

    TH.ok('★ 倒下时弹出「还能抢救一下」（不画的话玩家只看到棋子死了）',
      sawRitesCallout);
    TH.ok('★ 倒下时有一束光从老牧师连到他（看得出是谁在救）', sawBeam);
    TH.ok('★ 复活那一刻弹出「我回来了」', sawBackCallout);
    TH.ok('★ 3 星还弹出「圣光赐福 +20%」的字幕（两个人变强了要说出来）',
      sawBlessCallout);
    TH.eq('★ 复活之前渲染层认为他是死的（卡片是灰的）', hpBeforeRevive, false);
    TH.eq('★ 复活之后渲染层认为他活着（不是只改了数字、卡片还是灰的）',
      aliveAtRevive, true);
    TH.ok('★ 复活之后血量真的回满了（渲染层拿的是事件里的 hp）',
      hpAfterRevive !== null && hpAfterRevive > 0,
      hpAfterRevive === null ? '没读到' : Math.round(hpAfterRevive));
  }

  /* ============================================================
   * 五i、孙笑川「安排上了」在画面上看得见
   *
   *   规则在 simtest 里验过了。这里只问一件事：
   *   **玩家能不能看出那个敌人已经变成自己人了。**
   *   一张卡片从敌人变成我方，如果画面上什么都不变，
   *   玩家会以为"它没死"是 bug —— 而需求里明确要求"复活单位卡面变灰"。
   *
   *   ★ 所以这条不只是断言"发了一条 convert 事件"，而是**真的去采像素**：
   *     同一个单位、转换前 vs 转换后，卡面的**饱和度**必须掉下来。
   *     另外拿一个**没被招安**的敌人做对照 —— 没有对照组的话，
   *     画面本来就偏灰（背景是淡绿灰）也可能让这条假绿。
   * ============================================================ */
  async function testMikadoVfx() {
    TH.section('孙笑川 · 招安表现');

    /* ★★ 对照组必须是"**按规则不可能被招安**"的那种单位 ——
       第一版我拿"没被招安到的敌人"当对照，结果这一场里孙笑川把 4 个敌**全部**招安了，
       对照根本不存在（采出来是 -1，断言假红）。
       现在放一个 2 星牢大：它有复活次数，按规则永远不会被招安 ——
       对照是**结构性存在**的，不靠运气。 */
    var result = W.ST.Battle.battle({
      a: [{ id: 'butcher', star: 3, items: ['belt', 'belt', 'belt'], r: 3, c: 3 }],
      b: [{ id: 'bowman', star: 1, r: 4, c: 3 },
          { id: 'bowman', star: 1, r: 4, c: 4 },
          { id: 'bowman', star: 1, r: 5, c: 3 },
          { id: 'bowman', star: 1, r: 5, c: 4 },
          { id: 'brute', star: 2, items: ['belt', 'belt', 'belt'], r: 5, c: 5 }]
    }, 9090);
    var conv = result.log.filter(function (e) { return e.type === 'convert'; });
    TH.ok('这一场确实招安了（否则后面全是空断言）', conv.length > 0, conv.length + ' 个');
    if (!conv.length) return;
    var first = conv[0];
    var convertedUid = first.who, convT = first.t;
    var plainUid = null;
    for (var i = 0; i < result.initial.units.length; i++) {
      var u0 = result.initial.units[i];
      if (u0.defId === 'brute') { plainUid = u0.uid; break; }
    }
    TH.ok('对照组（牢大）在场，而且它按规则不会被招安', !!plainUid, plainUid || '没找到');
    TH.ok('★ 全场没有一次招安落在牢大身上（它走自己的坠机→复活）',
      !conv.some(function (e) { return e.who === plainUid; }));

    var cv2 = $('arena');
    var CELLW = W.Arena.cell(), PITCHW = W.Arena.pitch();
    /* 采"卡面颜色有多鲜艳"：R/G/B 三通道的极差均值。
       灰卡的极差接近 0；有立绘的彩卡明显更大。
       ★ 用**相对量**（前后对比）而不是绝对阈值 ——
         背景是淡绿灰的，绝对阈值在任何一张地图上都不成立。 */
    function satAt(r, c) {
      var x = Math.round(c * PITCHW + CELLW / 2), y = Math.round(r * PITCHW + CELLW / 2);
      var s = Math.max(3, Math.round(CELLW * 0.22));
      var d = cv2.getContext('2d').getImageData(x - s, y - s, s * 2, s * 2).data;
      var sum = 0, n = 0;
      for (var q = 0; q < d.length; q += 4) {
        var mx = Math.max(d[q], d[q + 1], d[q + 2]);
        var mn = Math.min(d[q], d[q + 1], d[q + 2]);
        sum += (mx - mn); n++;
      }
      return n ? sum / n : -1;
    }

    W.Arena.play(result);
    var before = -1, after = -1, controlBefore = -1, controlAfter = -1;
    var sawCallout = false;
    for (var f5 = 0; f5 < 2200; f5++) {
      W.Arena.step(1 / 30);
      var nowT = W.Arena.time();
      var us2 = W.Arena.units();
      var me2 = us2[convertedUid], plain2 = plainUid ? us2[plainUid] : null;
      // 转换**之前**（趁它还是敌人、还站着）
      if (before < 0 && me2 && me2.alive && nowT > 0.3 && nowT < convT - 0.15) {
        before = satAt(me2.r, me2.c);
      }
      if (controlBefore < 0 && plain2 && plain2.alive && nowT > 0.3 && nowT < convT - 0.15) {
        controlBefore = satAt(plain2.r, plain2.c);
      }
      // 转换**之后**（等特效散一散再采，别把火花采进去）
      if (after < 0 && nowT > convT + 0.6 && me2 && me2.alive && me2.converted) {
        after = satAt(me2.r, me2.c);
      }
      if (controlAfter < 0 && nowT > convT + 0.6 && plain2 && plain2.alive) {
        controlAfter = satAt(plain2.r, plain2.c);
      }
      var fl2 = W.Arena.fxList();
      for (var k2 = 0; k2 < fl2.length; k2++) {
        if (fl2[k2].type === 'callout' && fl2[k2].text === '安排上了') sawCallout = true;
      }
    }

    var rr = W.Arena.units()[convertedUid];
    TH.ok('★ 渲染层把这个单位标成了"招安"', !!rr && rr.converted === true,
      rr ? String(rr.converted) : '没找到');
    TH.ok('★ 而且它的阵营真的换成了我方（不然画面上还是敌人）',
      !!rr && rr.side === first.toSide, rr ? rr.side : '—');
    TH.ok('★ 转换时弹出「安排上了」的台词', sawCallout);
    TH.note('卡面饱和度（R/G/B 极差）：被招安 ' + before.toFixed(1) + ' → ' +
      after.toFixed(1) + '　　对照（没被招安）' + controlBefore.toFixed(1) + ' → ' +
      controlAfter.toFixed(1));
    TH.ok('★ 被招安的单位卡面**变灰了**（饱和度明显下降）',
      before > 0 && after >= 0 && after < before * 0.75,
      before.toFixed(1) + ' → ' + after.toFixed(1));
    /* ★★ 对照组：没被招安的那个敌人卡面**不该**变灰。
       没有这一条的话，"所有卡片都变灰了"（比如整个画面被什么东西盖住）
       也会让上面那条通过。 */
    TH.ok('★ 对照组的敌人卡面没有变灰（证明灰的是"招安"这一个，不是整屏）',
      controlBefore > 0 && controlAfter >= 0 && controlAfter > controlBefore * 0.75,
      controlBefore.toFixed(1) + ' → ' + controlAfter.toFixed(1));
  }

  /* ============================================================
   * 五j、电棍的「导电」在画面上看得见
   *
   *   需求里明确写了「明显电流特效」，所以这一条要验的是**真的画出来了**：
   *     · 弹射那一瞬间有一道锯齿闪电（arc），而且它的两个端点
   *       **正好落在规则说的那两格中心**（不是随便找个位置画一条线）；
   *     · 电流停在人身上等跳的那 0.5 秒里有一个电球（cnode）在闪；
   *     · 卡片上有 `⚡N` 徽章反映"现在挂着几条"。
   *   ★ 只断言"事件发了"是不够的 —— 那和"画面上什么都没有"是可以共存的。
   * ============================================================ */
  async function testBatonVfx() {
    TH.section('电棍 · 电流表现');

    var result = W.ST.Battle.battle({
      a: [{ id: 'spearman', star: 3, items: ['belt', 'belt', 'belt'], r: 3, c: 3 }],
      b: [{ id: 'bowman', star: 1, items: ['belt', 'belt', 'belt'], r: 4, c: 3 },
          { id: 'bowman', star: 1, items: ['belt', 'belt', 'belt'], r: 4, c: 4 },
          { id: 'bowman', star: 1, items: ['belt', 'belt', 'belt'], r: 4, c: 5 },
          { id: 'bowman', star: 1, items: ['belt', 'belt', 'belt'], r: 5, c: 3 }]
    }, 31415);
    var jumps = result.log.filter(function (e) {
      return e.type === 'current' && !e.born && !e.fizzle;
    });
    TH.ok('这一场电流确实弹射过（否则后面全是空断言）', jumps.length > 0,
      jumps.length + ' 跳');
    if (!jumps.length) return;
    var batonUid = result.initial.units.filter(function (u) {
      return u.defId === 'spearman';
    })[0].uid;
    var target = jumps[0];

    W.Arena.play(result);
    var sawArc = false, sawNode = false, arcAtRightPlace = false, arcWrong = 0;
    var maxCurN = 0;
    var CELLW2 = W.Arena.cell(), PITCHW2 = W.Arena.pitch();
    /* ★★ 先把**所有**弹射的"起点格中心 → 终点格中心"算出来做成一张表。
       第一版我只拿第一跳去比，结果 41 跳里的其它弧全对不上 ——
       断言写成了"每一道弧都必须等于第一跳的坐标"，那当然红。
       正确的问题是：**每一道弧是不是都落在某一次真实弹射的两格中心上**。 */
    var expect = {};
    jumps.forEach(function (j) {
      var key = [j.fromC * PITCHW2 + CELLW2 / 2, j.fromR * PITCHW2 + CELLW2 / 2,
                 j.c * PITCHW2 + CELLW2 / 2, j.r * PITCHW2 + CELLW2 / 2].join(',');
      expect[key] = true;
    });
    for (var f6 = 0; f6 < 1600; f6++) {
      W.Arena.step(1 / 30);
      var fl3 = W.Arena.fxList();
      for (var k3 = 0; k3 < fl3.length; k3++) {
        if (fl3[k3].type === 'arc') {
          sawArc = true;
          var akey = [fl3[k3].x1, fl3[k3].y1, fl3[k3].x2, fl3[k3].y2].join(',');
          if (expect[akey]) arcAtRightPlace = true;
          else arcWrong++;
        }
        if (fl3[k3].type === 'cnode') sawNode = true;
      }
      var bu = W.Arena.units()[batonUid];
      if (bu && bu.curN > maxCurN) maxCurN = bu.curN;
    }

    TH.ok('★ 弹射时画出了一道锯齿闪电（arc）', sawArc);
    TH.ok('★ 每一道闪电的两端都落在某一次真实弹射的两格中心上',
      arcAtRightPlace && arcWrong === 0,
      arcWrong === 0 ? '全部对得上（共 ' + jumps.length + ' 次弹射）'
                     : (arcWrong + ' 道对不上'));
    TH.ok('★ 电流停在人身上等跳的那 0.5 秒里有电球在闪（cnode）', sawNode);
    TH.ok('★ 渲染层数得出"这个电棍现在挂着几条电流"（徽章 ⚡N 的数据源）',
      maxCurN > 0, '最多同时 ' + maxCurN + ' 条');

    /* ---------- ★★ 「明显」到底有多明显：去数像素 ----------
     *   需求里写的是「明显电流特效」，所以这里不满足于"fx 列表里有个 arc" ——
     *   那个和"画面上其实什么都看不见"是可以共存的（画成透明、画到屏幕外、
     *   被别的东西盖住，三种都能让上面几条全绿）。
     *   ★ 做法：拿**最后一次**弹射的落点那一格（它后面不再接新的电球，
     *     所以特效会干净地过期），在弹射那一瞬间和 0.7 秒后各采一次平均亮度，
     *     比一个相对值 —— 不依赖任何绝对阈值（和「阴暗领域」那条同一个套路）。
     */
    /*   ★★ 选一跳"干净"的来采样。三个坑，每一个都能让采样值变成噪声：
     *     ① 落点那一格如果 1.2 秒内又被别的电流打中，采样到的"过期后"
     *        其实是另一道还没过期的特效；
     *     ② 目标在 1.2 秒内死了，卡牌直接消失 —— 前后亮度差的是"人没了"
     *        而不是"闪电没了"；
     *     ③ 这一跳离战斗结束不足 1.2 秒：时间轴一停就不再前进，
     *        "过期后"那一帧**永远等不到**（值停在 -1，断言假红）。
     *   所以先按这三条给每一跳打分，拿分最高的那一跳。 */
    var endT = result.time;
    var deaths = result.log.filter(function (e) { return e.type === 'death'; });
    var pick = jumps[0], pickGap = -1;
    jumps.forEach(function (j) {
      var prev = 0, next = endT;
      jumps.forEach(function (k) {
        if (k === j || k.r !== j.r || k.c !== j.c) return;
        if (k.t < j.t && k.t > prev) prev = k.t;
        if (k.t > j.t && k.t < next) next = k.t;
      });
      var gap = Math.min(j.t - prev, next - j.t, endT - j.t);
      // 目标这一跳之后还活着（活得比采样窗口长）
      var diesSoon = deaths.some(function (d) {
        return d.who === j.to && d.t > j.t && d.t <= j.t + 1.2;
      });
      if (diesSoon) gap -= 10;
      if (gap > pickGap) { pickGap = gap; pick = j; }
    });
    TH.note('亮度采样挑的是第 ' + (jumps.indexOf(pick) + 1) + '/' + jumps.length +
      ' 跳（' + pick.t.toFixed(2) + ' 秒，落点 ' + pick.r + ',' + pick.c +
      '），它前后各 ' + pickGap.toFixed(2) + ' 秒没被别的事打扰');

    var cellW3 = W.Arena.cell(), pitchW3 = W.Arena.pitch();
    function brightAt3(r, c) {
      var px = Math.round(c * pitchW3 + cellW3 / 2);
      var py = Math.round(r * pitchW3 + cellW3 / 2);
      var s3 = Math.max(2, Math.round(cellW3 * 0.16));
      var dd = $('arena').getContext('2d').getImageData(px - s3, py - s3, s3 * 2, s3 * 2).data;
      var sum = 0, n = 0;
      for (var q3 = 0; q3 < dd.length; q3 += 4) { sum += dd[q3] + dd[q3 + 1] + dd[q3 + 2]; n++; }
      return n ? sum / n / 3 : -1;
    }
    W.Arena.play(result);
    var bBefore = -1, bOn = -1, bAfter = -1;
    for (var f7 = 0; f7 < 2400; f7++) {
      W.Arena.step(1 / 30);
      var nowT2 = W.Arena.time();
      if (bBefore < 0 && nowT2 >= pick.t - 0.2 && nowT2 < pick.t - 0.04) {
        bBefore = brightAt3(pick.r, pick.c);
      }
      if (bOn < 0 && nowT2 >= pick.t + 0.02 && nowT2 < pick.t + 0.2) {
        bOn = brightAt3(pick.r, pick.c);
      }
      if (bAfter < 0 && nowT2 >= pick.t + 0.75) {
        bAfter = brightAt3(pick.r, pick.c);
      }
      if (bBefore > 0 && bOn > 0 && bAfter > 0) break;
    }
    TH.note('落点那一格的平均亮度：弹射前 ' + bBefore.toFixed(1) +
      ' → 弹射瞬间 ' + bOn.toFixed(1) + ' → 过期后 ' + bAfter.toFixed(1));
    TH.ok('★ 弹射那一瞬间落点**明显变亮**（特效真的看得见，不是画了个透明的）',
      bOn > 0 && bOn > Math.max(bBefore, bAfter) + 6,
      bOn.toFixed(1) + ' vs 前 ' + bBefore.toFixed(1) + ' / 后 ' + bAfter.toFixed(1));
    TH.note('电棍这一场：' + jumps.length + ' 跳，最多同时挂 ' + maxCurN + ' 条电流');
  }

  /* ============================================================
   * 五j-2、冰冰冰的「冰冻」在画面上看得见，而且和嘉豪那条**分得开**
   *
   *   ★★ 这里要拦的是一个很具体的回归：引擎发的都是 `stun` 事件，
   *      巧乐兹满层那条的 reason 是 `freeze`，冰冰冰技能附带的这条是 `frost`。
   *      渲染层如果只认 `freeze`，技能冰冻就会掉进 `else` 分支 ——
   *      玩家看到的是**金色的「哈哈」**（嘉豪「男人领域」那套），
   *      而不是冰环 + 冰渣 + 「冰冻」两个字。
   *      规则全对、数值全对，就是**表现张冠李戴**，纯数值自检一条都不会红。
   *
   *   所以这里同时在**同一个事件回调里**问两件事：
   *     ① 有没有「冰冻」字样（而且就飘在被冻的那个人的格子上）
   *     ② 同一瞬间**有没有「哈哈」**（有就说明走错分支了）
   * ============================================================ */
  async function testFrostVfx() {
    TH.section('冰冰冰 · 冰冻表现');

    /* 场面设计的三个要求（每一个都是被"断言不够硬"逼出来的）：
       ① **要冻好几次**：只冻一次的话，"第一次对了、后面错了"这种 bug 抓不到。
          冰冰冰带两颗蓝水晶（开局满能量）+ 攻速 0.68、法力 70 ⇒ 每约 10 秒一发，
          所以只要它活到 20 秒就有 3 次。
       ② **要有人在旁边一直挂冰棍**：才能验"技能冰冻**不**清空层数"。
          张雪峰 2 星（巧乐兹）每下普攻给目标叠 1 层。
       ③ **对面不能会眩晕**：这条最容易被忽略 —— 嘉豪那种控场会撒「哈哈」飘字，
          而飘字要活一秒多，正好盖住这边"同一瞬间不许有哈哈"的断言，
          变成一条**随机假红**。所以对手用山岳：只会给自己套盾，不会晕人。
       ④ **对局要够长**：山岳 3 星血厚（还每 10 秒给自己补一层盾）、
          攻击虽然高但要打两轮才清得完我方 —— 实测我方在 24 秒左右全灭，
          冰冰冰正好放出 3 发。 */
    var result = W.ST.Battle.battle({
      a: [{ id: 'blademaster', star: 2, items: ['belt', 'belt', 'belt'], r: 4, c: 2 },
          { id: 'frostmage', star: 2, items: ['sapphire', 'sapphire', 'belt'], r: 4, c: 5 }],
      b: [{ id: 'titan', star: 3, items: ['belt', 'belt', 'belt'], r: 3, c: 3 }]
    }, 4242);
    var frosts = result.log.filter(function (e) {
      return e.type === 'stun' && e.reason === 'frost';
    });
    TH.ok('这一场技能冰冻了好几次（否则后面全是空断言）', frosts.length >= 3,
      frosts.length + ' 次');
    if (frosts.length < 1) return;
    var enemyUid = null;
    for (var ei = 0; ei < result.initial.units.length; ei++) {
      if (result.initial.units[ei].side === 'b') { enemyUid = result.initial.units[ei].uid; break; }
    }

    var CW = W.Arena.cell(), PW = W.Arena.pitch();
    var nFrost = 0, noCallout = 0, giggle = 0, offCell = 0;
    var maxOff = 0, withChill = 0, chillMatch = 0, chillBad = [];
    /* ★★ 冰棍层数的**独立模型**：只按事件流推 ——
       `chill` 事件把层数设成 stacks，满层那条 `freeze` 把它清 0，
       而 `frost`（技能冰冻）**什么都不该改**。
       拿它和渲染层此刻的 `u.chill` 对比，就能精确验出
       "技能冰冻顺手把层数清了"这个很隐蔽的 bug（顺手清是很容易写出来的，
       因为两条冰冻的处理代码长得几乎一样）。 */
    var modelChill = 0;
    W.Arena.play(result, {
      onEvent: function (e) {
        if (e.type === 'chill' && e.to === enemyUid) { modelChill = e.stacks; return; }
        if (e.type === 'stun' && e.to === enemyUid && e.reason === 'freeze') {
          modelChill = 0;
          return;
        }
        if (e.type !== 'stun' || e.reason !== 'frost') return;
        nFrost++;
        var u = W.Arena.units()[e.to];
        var fl = W.Arena.fxList();
        var co = null, gig = 0;
        for (var k = 0; k < fl.length; k++) {
          if (fl[k].type === 'callout' && fl[k].text === '冰冻') co = fl[k];
          if (fl[k].type === 'mote' && fl[k].text === '哈哈') gig++;
        }
        if (gig) giggle++;
        if (!co) { noCallout++; return; }
        /* 冻的是谁，字就该飘在谁头上。用的是渲染层自己的插值坐标
           （cellX 读的是 cc 不是 c —— 单位可能正滑在半路上）。 */
        var ex = u ? u.cc * PW + CW / 2 : -9999;
        var off = Math.abs(co.x - ex);
        if (off > maxOff) maxOff = off;
        if (off > 2) offCell++;
        if (!u) return;
        if (u.chill > 0) withChill++;
        if (u.chill === modelChill) chillMatch++;
        else chillBad.push('模型 ' + modelChill + ' vs 画面 ' + u.chill);
      }
    });
    for (var f = 0; f < 6000 && !W.Arena.isDone(); f++) W.Arena.step(1 / 30);
    TH.ok('回放跑到了时间轴结尾（没跑完的话上面几条会漏事件 —— 假绿）',
      W.Arena.isDone(), fmtT(W.Arena.time()) + ' / ' + fmtT(W.Arena.total()));

    TH.eq('渲染层的回调看到了每一次技能冰冻', nFrost, frosts.length);
    TH.ok('★★ 每一次技能冰冻都弹出了「冰冻」字样（不是掉进嘉豪那条分支）',
      noCallout === 0, noCallout ? (noCallout + ' 次没弹') : ('全部弹了（' + nFrost + ' 次）'));
    TH.ok('★★ 而且同一瞬间**没有**「哈哈」（有就说明走错了分支 —— 冰冻画成了眩晕）',
      giggle === 0, giggle ? (giggle + ' 次画成了哈哈') : '一次都没有');
    TH.ok('★ 「冰冻」两个字就飘在被冻的那个人的格子上（不是飘在别人头上）',
      offCell === 0, '最大偏差 ' + maxOff.toFixed(1) + 'px');
    TH.ok('★ 这几发里确实有"身上还挂着冰棍"的时候（否则下面那条是空断言）',
      withChill >= 1, nFrost + ' 次冰冻里有 ' + withChill + ' 次带着冰棍层数');
    TH.ok('★★ 技能冰冻**不清空**冰棍层数（层数和事件流推出来的模型逐次吻合）',
      chillBad.length === 0 && chillMatch === nFrost - noCallout,
      chillBad.length ? chillBad.join('　') : ('逐次吻合 ' + chillMatch + ' 次'));
  }

  function fmtT(x) { return Math.round(x * 100) / 100 + 's'; }

  /* ============================================================
   * 五j-3、美团袋鼠的外卖在画面上看得见
   *
   *   规则和数值在 simtest 里验过了。这里问三件事：
   *     ① 技能那一下有没有「投掷一个外卖」的台词（不然玩家只看到绿字）
   *     ② 3 星普攻送的外卖有没有画出来 —— 而且是画在**队友**身上，
   *        不是画在被打的敌人身上（圆心在敌人、收件人是队友，很容易画反）
   *     ③ 2 星那份攻速加成有没有落到**被奶的那个人**的卡片上
   *        （渲染层以前**完全没有**处理 `buff` 事件 —— 双刃舞者的
   *         「疾风连斩」放完画面上什么都不发生）
   * ============================================================ */
  async function testDeliveryVfx() {
    TH.section('美团袋鼠 · 外卖表现');

    /* 场面和 simtest 一致：三个带大果的肉盾（永远有缺口可回）+ 对面两个豆包。
       第一次走位之前全场静止，所以几何断言可以对着初始坐标来。 */
    var result = W.ST.Battle.battle({
      a: [{ id: 'alchemist', star: 3, items: ['belt', 'belt', 'belt'], r: 2, c: 3 },
          { id: 'stoneguard', star: 1, items: ['swiftboots', 'belt', 'belt'], r: 3, c: 2 },
          { id: 'stoneguard', star: 1, items: ['swiftboots', 'belt', 'belt'], r: 3, c: 3 },
          { id: 'stoneguard', star: 1, items: ['swiftboots', 'belt', 'belt'], r: 3, c: 7 }],
      b: [{ id: 'acolyte', star: 3, items: ['belt', 'belt', 'belt'], r: 4, c: 2 },
          { id: 'acolyte', star: 3, items: ['belt', 'belt', 'belt'], r: 4, c: 7 }]
    }, 31337);

    var rooUid = null, rooPos = null;
    var allyPos = {};
    result.initial.units.forEach(function (u) {
      if (u.defId === 'alchemist') { rooUid = u.uid; rooPos = { r: u.r, c: u.c }; }
      else if (u.side === 'a') allyPos[u.uid] = { r: u.r, c: u.c };
    });
    var meals = result.log.filter(function (e) {
      return e.type === 'heal' && e.reason === 'delivery';
    });
    var buffs = result.log.filter(function (e) {
      return e.type === 'buff' && e.reason === 'delivery';
    });
    var casts = result.log.filter(function (e) {
      return e.type === 'cast' && e.from === rooUid;
    });
    TH.ok('这一场既送过外卖也放过技能（否则后面全是空断言）',
      meals.length > 0 && casts.length > 0,
      meals.length + ' 单 / ' + casts.length + ' 次技能');

    var CW = W.Arena.cell(), PW = W.Arena.pitch();
    var sawCallout = false, calloutAtRoo = false;
    var healNumsOnAlly = 0, healNumsOnEnemy = 0, warmRingOnAlly = 0;
    var buffRingOnAlly = 0, buffOnRoo = 0;
    var buffTracked = [], buffTrackerWrong = 0;
    var ON_CELL = [];

    W.Arena.play(result, {
      onEvent: function (e) {
        if (e.type === 'cast' && e.callout) {
          /* 台词挂在**施法者自己**的卡牌上方（这是它的台词，不是受击反馈） */
          var us = W.Arena.units()[e.from];
          if (us) {
            var fx1 = W.Arena.fxList();
            for (var i = 0; i < fx1.length; i++) {
              if (fx1[i].type === 'callout' && fx1[i].text === e.callout) {
                sawCallout = true;
                if (Math.abs(fx1[i].x - (us.cc * PW + CW / 2)) < 2) calloutAtRoo = true;
              }
            }
          }
          return;
        }
        if (e.type === 'buff' && e.reason === 'delivery') {
          var ub = W.Arena.units()[e.who];
          /* ★ 渲染层必须真的把这段加成记下来 —— 卡片上那枚 🛵+20% 徽章
             读的就是这两个字段。不记的话徽章永远不出现。 */
          if (ub && Math.abs((ub.asBuffPct || 0) - e.amount) < 1e-9 &&
              ub.asBuffUntil >= e.until - 1e-9) {
            buffTracked.push(e.who);
          } else {
            buffTrackerWrong++;
          }
          if (e.who === rooUid) buffOnRoo++;
          return;
        }
        if (e.type !== 'heal' || e.reason !== 'delivery') return;
        var u = W.Arena.units()[e.to];
        if (!u) return;
        var ax = u.cc * PW + CW / 2, ay = u.rr * PW + CW / 2;
        var numY = ay - W.Arena.cell() * 0.42;      // 回血数字画在头顶
        var fl = W.Arena.fxList();
        for (var k = 0; k < fl.length; k++) {
          var f = fl[k];
          if (f.type === 'num' && f.kind === 'heal' && Math.abs(f.x - ax) < 2 &&
              Math.abs(f.y - numY) < 3) {
            healNumsOnAlly++;
          }
          if (f.type === 'ring' && f.color === 'rgba(255,168,72,.85)' &&
              Math.abs(f.x - ax) < 2) warmRingOnAlly++;
        }
        if (!allyPos[e.to]) healNumsOnEnemy++;
      }
    });

    /* 播到「第一次走位之前」就够了 —— 那之后几何会变，
       而我们这里不打算重建位置。 */
    var firstMoveT = Infinity;
    for (var q = 0; q < result.log.length; q++) {
      if (result.log[q].type === 'move') { firstMoveT = result.log[q].t; break; }
    }
    for (var f2 = 0; f2 < 6000; f2++) {
      W.Arena.step(1 / 30);
      if (W.Arena.time() >= firstMoveT) break;
      if (W.Arena.isDone()) break;
    }

    TH.ok('★ 放技能时弹出了「投掷一个外卖」的台词', sawCallout,
      sawCallout ? '有' : '没有');
    TH.ok('★ 而且台词是挂在美团袋鼠自己头上的', calloutAtRoo);
    TH.eq('★ 外卖没有送到敌人身上（收件人全是自己人）', healNumsOnEnemy, 0);
    TH.ok('★ 每一口外卖都在队友身上画了绿色回血数字（不是只有规则在跑）',
      healNumsOnAlly > 0, healNumsOnAlly + ' 个回血数字');
    TH.ok('★ 外卖那一口带**暖橙色**的环（和奶妈那口绿环分得开）',
      warmRingOnAlly > 0, warmRingOnAlly + ' 个橙环');
    TH.ok('★ 渲染层记下了攻速加成（卡片上那枚 🛵+20% 徽章的数据来源）',
      buffTracked.length > 0 && buffTrackerWrong === 0,
      buffTracked.length + ' 次记录正确 / ' + buffTrackerWrong + ' 次不对');
    TH.eq('★ 而且加成从来没有记到袋鼠自己头上（外卖是送给别人的）', buffOnRoo, 0);
    TH.note('美团袋鼠这一场（第一次走位前）：外卖 ' + meals.length + ' 单，' +
      '回血数字 ' + healNumsOnAlly + ' 个、橙环 ' + warmRingOnAlly + ' 个，' +
      '攻速加成 ' + buffs.length + ' 次');
  }

  /* ============================================================
   * 五j-4、东北雨姐的「红薯粉丝」在画面上看得见
   *
   *   ★★ 这一条要拦的是最误导人的那种错：把 root 画成 stun。
   *      规则层两套字段、两个事件类型，但如果渲染层把 root 丢进 stun 分支，
   *      玩家看到的就是**金色的「哈哈」**（嘉豪那套），而且"被捆住还能还手"
   *      这件事在画面上彻底消失 —— 规则全对、数值全对，就是表现张冠李戴。
   *      所以这里同时在**同一个回调里**问两件事：
   *        ① 有没有「捆住」两个字（而且就在被捆的那个人头上）
   *        ② 同一瞬间**有没有「哈哈」**（有就说明走错分支了）
   *   ★ 另外验一下渲染层真的把 rootUntil 记下来了 ——
   *     卡片上那枚 🍜Ns 徽章读的就是它（不记的话"它为什么站着不动"没人解释）。
   * ============================================================ */
  async function testNoodleVfx() {
    TH.section('东北雨姐 · 红薯粉丝表现');

    var result = W.ST.Battle.battle({
      a: [{ id: 'templar', star: 3, items: ['sapphire', 'sapphire', 'belt'], r: 3, c: 3 },
          { id: 'falconer', star: 1, items: ['swiftboots', 'belt', 'belt'], r: 2, c: 7 }],
      b: [{ id: 'stoneguard', star: 3, items: ['belt', 'belt', 'belt'], r: 4, c: 3 },
          { id: 'stoneguard', star: 3, items: ['belt', 'belt', 'belt'], r: 4, c: 1 },
          { id: 'stoneguard', star: 3, items: ['belt', 'belt', 'belt'], r: 5, c: 7 }]
    }, 60607);
    var roots = result.log.filter(function (e) { return e.type === 'root'; });
    var noodleHeals = result.log.filter(function (e) {
      return e.type === 'heal' && e.reason === 'noodle';
    });
    TH.ok('这一场既捆过人、也回上过血（否则后面全是空断言）',
      roots.length > 0 && noodleHeals.length > 0,
      roots.length + ' 条 root / ' + noodleHeals.length + ' 口回血');

    var CW = W.Arena.cell(), PW = W.Arena.pitch();
    var nRoot = 0, noCallout = 0, giggle = 0, offCell = 0, maxOff = 0;
    var tracked = 0, trackBad = 0;
    var noodleNums = 0, noodleMotes = 0;
    W.Arena.play(result, {
      onEvent: function (e) {
        if (e.type === 'root') {
          nRoot++;
          var ru = W.Arena.units()[e.to];
          var fl0 = W.Arena.fxList();
          var co0 = null, gig0 = 0;
          for (var k0 = 0; k0 < fl0.length; k0++) {
            if (fl0[k0].type === 'callout' && fl0[k0].text === '捆住') co0 = fl0[k0];
            if (fl0[k0].type === 'mote' && fl0[k0].text === '哈哈') gig0++;
          }
          if (gig0) giggle++;
          if (!co0) { noCallout++; return; }
          var ex0 = ru ? ru.cc * PW + CW / 2 : -9999;
          var off0 = Math.abs(co0.x - ex0);
          if (off0 > maxOff) maxOff = off0;
          if (off0 > 2) offCell++;
          /* ★ 渲染层必须把"捆到什么时候"记下来 —— 徽章读的就是这个字段。 */
          if (ru && Math.abs((ru.rootUntil || -1) - e.until) < 1e-9) tracked++;
          else trackBad++;
          return;
        }
        if (e.type === 'heal' && e.reason === 'noodle') {
          var hu = W.Arena.units()[e.to];
          if (!hu) return;
          var hx = hu.cc * PW + CW / 2, hy = hu.rr * PW + CW / 2;
          var fl2 = W.Arena.fxList();
          for (var k2 = 0; k2 < fl2.length; k2++) {
            var f2 = fl2[k2];
            if (f2.type === 'num' && f2.kind === 'heal' && Math.abs(f2.x - hx) < 2) noodleNums++;
            if (f2.type === 'mote' && f2.text === '🍠' && Math.abs(f2.x - hx) < 2) noodleMotes++;
          }
        }
      }
    });
    for (var q = 0; q < 6000 && !W.Arena.isDone(); q++) W.Arena.step(1 / 30);

    TH.ok('★ 回放跑到了结尾（没跑完会漏事件 —— 假绿）', W.Arena.isDone());
    TH.eq('渲染层的回调看到了每一条捆人事件', nRoot, roots.length);
    TH.ok('★★ 每一次捆人都弹出了「捆住」字样（不是掉进眩晕那条分支）',
      noCallout === 0, noCallout ? (noCallout + ' 次没弹') : ('全部弹了（' + nRoot + ' 次）'));
    TH.ok('★★ 而且同一瞬间**没有**「哈哈」（有就说明 root 被画成了 stun）',
      giggle === 0, giggle ? (giggle + ' 次画成了哈哈') : '一次都没有');
    TH.ok('★ 「捆住」两个字就飘在被捆的那个人的格子上',
      offCell === 0, '最大偏差 ' + maxOff.toFixed(1) + 'px');
    TH.ok('★ 渲染层记下了 rootUntil（卡片上 🍜Ns 徽章的数据来源）',
      tracked > 0 && trackBad === 0, tracked + ' 次记对 / ' + trackBad + ' 次不对');
    TH.ok('★ 打被捆住的人回的那口血画了绿色数字', noodleNums > 0, noodleNums + ' 个');
    TH.ok('★ 而且冒了一颗 🍠（三条被动都在冒绿字，只有图标能说清是谁给的）',
      noodleMotes > 0, noodleMotes + ' 颗');
    TH.note('东北雨姐这一场：' + roots.length + ' 条 root、' + noodleHeals.length +
      ' 口回血（画面上 ' + noodleNums + ' 个数字 / ' + noodleMotes + ' 颗 🍠）');
  }

  /* ============================================================
   * 五g、奶龙的「捧腹大笑」在画面上看得见
   *
   *   规则和数值在 simtest 里验过了。这里只问两件事：
   *     ① 玩家能不能看出**它现在笑上了**（3 秒里既不能动也不能打，
   *        画面上必须有人告诉他这 3 秒是怎么回事）；
   *     ② 那条法力条在这里是**冷却条** —— 它不吃法力，法力条上的
   *        进度必须由渲染层按 cdSeconds 自己算出来（battle.js 不发每帧事件）。
   *        算错的话玩家就永远不知道"还有几秒能再笑"。
   * ============================================================ */
  async function testLaughVfx() {
    TH.section('奶龙 · 捧腹大笑表现');

    /* 场景和 simtest 里那套一致：奶龙单挑一只打不死的老牧师 ——
       对局一定跑满 60 秒，所以第 13 秒那次大笑必然出现。 */
    var result = W.ST.Battle.battle({
      a: [{ id: 'stoneguard', star: 1, items: ['belt', 'belt', 'belt'], r: 4, c: 3 }],
      b: [{ id: 'medic', star: 1, r: 7, c: 7 }]
    }, 9);
    var laughs = result.log.filter(function (e) { return e.type === 'laugh'; });
    TH.ok('这一场确实大笑过（否则后面全是空断言）', laughs.length > 0, laughs.length + ' 次');
    if (!laughs.length) return;
    var firstLaughT = laughs[0].t;

    W.Arena.play(result);
    var sawCallout = null, sawRing = false;
    var badgeFrames = 0, maxManaBefore = 0, manaAtLaugh = null;
    /* ★★ 连续飘字：大笑是一个挂 3 秒的状态，而 laugh 事件只有一帧。
       这里数的是「😂 的颗数又变多的那些帧」—— 一颗一颗冒出来的节奏，
       光看"有没有出现过 😂"是验不出这件事的（一帧也算出现过）。 */
    var moteBursts = 0, moteFirst = -1, moteLast = -1, lastMoteN = 0;
    for (var i = 0; i < 2400; i++) {
      W.Arena.step(1 / 30);
      var t = W.Arena.time();
      var fl = W.Arena.fxList();
      var moteN = 0;
      for (var k = 0; k < fl.length; k++) {
        if (fl[k].type === 'callout' && fl[k].text === '捧腹大笑') sawCallout = fl[k];
        if (fl[k].type === 'ring') sawRing = true;
        if (fl[k].type === 'mote' && fl[k].text === '😂') moteN++;
      }
      if (moteN > lastMoteN) {
        moteBursts++;
        if (moteFirst < 0) moteFirst = t;
        moteLast = t;
      }
      lastMoteN = moteN;
      var us = W.Arena.units(), me = null;
      for (var uid in us) if (us[uid].defId === 'stoneguard') me = us[uid];
      if (!me) continue;
      /* 「笑上了」这件事必须**持续**可见：徽章和金色外圈读的都是
         laughUntil，所以这里数的是"时间戳还没到期的帧数"。 */
      if (me.laughUntil > 0 && t < me.laughUntil) badgeFrames++;
      if (t < firstLaughT) { if (me.mana > maxManaBefore) maxManaBefore = me.mana; }
      else if (manaAtLaugh === null) manaAtLaugh = me.mana;
    }

    TH.ok('★ 大笑时会弹出「捧腹大笑」的台词', !!sawCallout,
      sawCallout ? sawCallout.text : '没有字幕');
    TH.ok('大笑时有一圈扩散的金色环', sawRing);
    TH.ok('★ 「正在大笑」这个状态是持续可见的（不是闪一帧）',
      badgeFrames >= 75, badgeFrames + ' 帧（约 ' + (badgeFrames / 30).toFixed(1) + ' 秒）');
    /* ★★ 关键的一条：😂 要**冒满这 3 秒**，而不是起手冒一下就没下文。
       3 秒 / 0.28 秒 ≈ 10 撮，所以下限给 6 撮、跨度给 2.2 秒 ——
       够严（少一个数量级就会红），又不会被帧率的小抖动干扰。 */
    TH.ok('★ 大笑期间 😂 是一颗一颗持续冒出来的（不是只在起手冒一下）',
      moteBursts >= 6 && (moteLast - moteFirst) >= 2.2,
      moteBursts + ' 撮，跨度 ' + (moteLast - moteFirst).toFixed(2) + ' 秒');

    /* 冷却条：大笑之前在涨，笑出去那一刻清零。
       ★ 断言写成"接近满"而不是"等于满"：第 13 秒那一帧之前，
         条子是靠 (t - cdT) / cdSeconds 算出来的，未必正好走到 100%。 */
    TH.ok('★ 大笑之前那条法力条一路涨到接近满（13 秒的冷却进度）',
      maxManaBefore >= 50, '涨到 ' + maxManaBefore.toFixed(1));
    TH.ok('★ 笑出去的那一刻条子清零，重新开始转冷却',
      manaAtLaugh !== null && manaAtLaugh <= 3,
      manaAtLaugh === null ? '没采到' : manaAtLaugh.toFixed(1));
  }

  /* ============================================================
   * 五h、嘉豪「男人领域」在画面上看得见
   *
   *   规则在 simtest 里验过了（一次控几个、控多久）。
   *   这里只问一件事：**被控住的人，玩家看得出来他被控住了吗。**
   *   眩晕在画面上原本只有一个很淡的金色小环，三控的时候三个环
   *   长得一模一样 —— 分不清是"三个人被控住"还是"有个人一直在挨打"。
   *   现在每个受害者头顶都会冒「哈哈」，和奶龙那套飘字是同一套特效。
   * ============================================================ */
  async function testDomainVfx() {
    TH.section('嘉豪 · 男人领域表现');

    /* 三个老牧师当靶子：输出低、互相回血，所以战斗能跑够久，
       嘉豪放得出技能；三个都站在正前方，3 星正好一次控满三个。 */
    var result = W.ST.Battle.battle({
      a: [{ id: 'vine', star: 3, items: ['belt', 'belt', 'belt'], r: 3, c: 3 }],
      b: [{ id: 'medic', star: 1, items: ['belt', 'belt', 'belt'], r: 4, c: 2 },
          { id: 'medic', star: 1, items: ['belt', 'belt', 'belt'], r: 4, c: 3 },
          { id: 'medic', star: 1, items: ['belt', 'belt', 'belt'], r: 4, c: 4 }]
    }, 606060);

    var stuns = result.log.filter(function (e) {
      return e.type === 'stun' && e.reason !== 'freeze';
    });
    TH.ok('这一场控过人（否则后面全是空断言）', stuns.length > 0, stuns.length + ' 条眩晕');
    if (!stuns.length) return;
    // 同一次施法里的三条，t 和 from 都一样
    var firstT = stuns[0].t, firstFrom = stuns[0].from;
    var sameCast = stuns.filter(function (e) { return e.t === firstT && e.from === firstFrom; });
    TH.eq('★ 3 星一次施法发出 3 条眩晕（三个人各自一条）', sameCast.length, 3);

    W.Arena.play(result);
    var hahaFrames = 0, hahaPeak = 0, sawRing = false, sawCastRing = false;
    var lastHahaN = 0, hahaBursts = 0, castFrames = 0;
    for (var i = 0; i < 1200; i++) {
      W.Arena.step(1 / 30);
      var fl = W.Arena.fxList();
      var hN = 0;
      for (var k = 0; k < fl.length; k++) {
        if (fl[k].type === 'mote' && fl[k].text === '哈哈') hN++;
        if (fl[k].type === 'ring') { sawRing = true; castFrames++; }
      }
      if (hN > lastHahaN) hahaBursts++;
      lastHahaN = hN;
      if (hN > 0) hahaFrames++;
      if (hN > hahaPeak) hahaPeak = hN;
    }

    TH.ok('★ 被控住的人头顶会冒「哈哈」（不再是只有一个淡淡的小环）',
      hahaFrames >= 5, hahaFrames + ' 帧里看得到');
    /* ★ 一次控制三个人 → 同一瞬间应该同时看到多声哈哈。
       峰值只要求 >= 2（不是 3）：三个人的飘字有先后、寿命也不完全同步，
       钉死 3 会变成一个对帧序极度敏感的假断言。 */
    TH.ok('★ 一次控三个人时，同一瞬间能看到不止一声哈哈',
      hahaPeak >= 2, '峰值 ' + hahaPeak + ' 声　共 ' + hahaBursts + ' 撮');
    TH.ok('眩晕时仍然有金色环（哈哈之外还留着原来的表现）', sawRing);
    /* ★ 放技能的人自己也要有信号（不然玩家不知道这三个哈哈是谁放的）——
       走的是所有技能共用的那条 cast 表现：紫环 + 火星。 */
    TH.ok('放技能时有施法环（看得出这三声哈哈是谁放的）', castFrames >= 20,
      castFrames + ' 帧里场上有环');

    /* ★★ 最后一步：确认「哈哈」**真的画到了画布上**。
     *   前面几条读的都是 Arena.fxList() —— 那只是"生成了特效对象"，
     *   万一 drawFx 里没有对应分支（或者分支写错被 else 吃掉），
     *   这些对象会安安静静地堆在数组里，一条断言都不会红。
     *   所以这里按飘字的填充色（#ffd98a）去数画布像素。 */
    W.Arena.play(result);
    var paintedPx = 0, scans = 0;
    for (var f = 0; f < 1200 && scans < 14; f++) {
      W.Arena.step(1 / 30);
      var fl2 = W.Arena.fxList(), hasMote = false;
      for (var q = 0; q < fl2.length; q++) {
        if (fl2[q].type === 'mote' && fl2[q].text === '哈哈') hasMote = true;
      }
      if (!hasMote) continue;
      scans++;
      var cv = $('arena');
      var img = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      var n = 0;
      for (var p2 = 0; p2 < img.length; p2 += 4) {
        if (Math.abs(img[p2] - 255) <= 10 && Math.abs(img[p2 + 1] - 217) <= 10 &&
            Math.abs(img[p2 + 2] - 138) <= 10) n++;
      }
      if (n > paintedPx) paintedPx = n;
      if (paintedPx > 150) break;
    }
    TH.ok('★ 「哈哈」真的画到了画布上（不只是生成了一堆特效对象）',
      paintedPx > 60, paintedPx + ' 个像素　扫了 ' + scans + ' 帧');
  }

  /* ============================================================
   * 五i、羊帆「羊巅峰 / 巅峰谢幕」在画面上看得见
   *
   *   规则和数值在 simtest 里验过了（×20 的倍率、3 秒眩晕、自爆伤害）。
   *   这里只问三件事：
   *     ① 蓄势这一段有没有表现（眼睛射激光 —— 和荣誉共用同一条）
   *     ② 玩家能不能提前知道"这一发是大的"（卡片上的 🐑×20 徽章，
   *        而且蓄势用掉之后必须消失）
   *     ③ 自爆那 1 秒里画面在干什么（不能画成直升机）
   * ============================================================ */
  async function testYangVfx() {
    TH.section('羊帆 · 羊巅峰表现');

    var result = W.ST.Battle.battle({
      a: [{ id: 'pyromancer', star: 1, items: ['belt', 'belt', 'belt'], r: 3, c: 3 }],
      b: [{ id: 'titan', star: 1, items: ['belt', 'belt', 'belt'], r: 4, c: 3 }]
    }, 313131);
    var charges = result.log.filter(function (e) { return e.type === 'charge'; });
    var peaks = result.log.filter(function (e) { return e.type === 'attack' && e.peak; });
    TH.ok('这一场蓄过力、也打出了巅峰一击（否则后面全是空断言）',
      charges.length > 0 && peaks.length > 0,
      charges.length + ' 次蓄力 / ' + peaks.length + ' 次巅峰一击');
    if (!charges.length || !peaks.length) return;

    W.Arena.play(result);
    var sawCallout = false, laserFrames = 0, peakNum = null;
    var badgeOn = false, badgeOffAfter = false;
    for (var i = 0; i < 900; i++) {
      W.Arena.step(1 / 30);
      var fl = W.Arena.fxList();
      for (var k = 0; k < fl.length; k++) {
        if (fl[k].type === 'callout' && fl[k].text === '羊巅峰') sawCallout = true;
        if (fl[k].type === 'eyelaser') laserFrames++;
        if (fl[k].type === 'num' && fl[k].kind === 'peak' && !peakNum) peakNum = fl[k];
      }
      var us = W.Arena.units(), me = null;
      for (var uid in us) if (us[uid].defId === 'pyromancer') me = us[uid];
      if (!me) continue;
      if (me.peakReady) badgeOn = true;
      if (badgeOn && !me.peakReady) badgeOffAfter = true;
    }

    TH.ok('★ 蓄力时双眼射出激光（和荣誉同一条表现）', laserFrames >= 10,
      laserFrames + ' 帧里看得到激光');
    TH.ok('放技能时弹出「羊巅峰」的台词', sawCallout);
    /* ★★ 蓄势状态必须**可见**：这一发是 20 倍，是羊帆一整局唯一的高光。
       不挂徽章的话，玩家只会看到伤害数字突然大 20 倍、以为算错了。 */
    TH.ok('★ 蓄势期间卡片上挂着「已蓄势」的标记', badgeOn);
    TH.ok('★ 而且巅峰一击打出去之后标记就消失了（不然玩家会以为每一发都是 20 倍）',
      badgeOffAfter);
    /* ★ 伤害飘字要用独立的、明显更大的样式 —— 和暴击（1.35 倍字号）区分开。
       实测基准字号是 CELL × 0.235，量一次换算成格子比例更直观。 */
    TH.ok('★ 巅峰一击的伤害数字有独立的大字号样式',
      !!peakNum, peakNum ? ('kind=' + peakNum.kind) : '没看到');
    if (peakNum) {
      var cell = W.Arena.cell();
      TH.ok('★ 它的字号明显大于普通伤害数字（>= 格子的 40%）',
        peakNum.size >= cell * 0.40,
        peakNum.size + 'px　格子 ' + cell + 'px　比例 ' +
        Math.round(peakNum.size / cell * 100) + '%');
    }

    /* ---------- 3 星：自爆那 1 秒 ---------- */
    var boomRes = W.ST.Battle.battle({
      a: [{ id: 'pyromancer', star: 3, items: ['belt', 'belt', 'belt'], r: 3, c: 3 }],
      b: [{ id: 'medic', star: 3, items: ['belt', 'belt', 'belt'], r: 4, c: 2 },
          { id: 'medic', star: 3, items: ['belt', 'belt', 'belt'], r: 4, c: 3 },
          { id: 'medic', star: 3, items: ['belt', 'belt', 'belt'], r: 4, c: 4 }]
    }, 707070);
    var downs = boomRes.log.filter(function (e) { return e.type === 'down' && e.boom; });
    var booms = boomRes.log.filter(function (e) { return e.type === 'crash' && e.boom; });
    TH.ok('这一场真的自爆了（否则后面全是空断言）',
      downs.length > 0 && booms.length > 0, downs.length + ' 次倒下 / ' + booms.length + ' 次爆炸');
    if (!downs.length || !booms.length) return;

    W.Arena.play(boomRes);
    var glowFrames = 0, sawBoomCallout = false, sawHaha = 0, sawStrike = false;
    for (var f = 0; f < 700; f++) {
      W.Arena.step(1 / 30);
      var fl2 = W.Arena.fxList();
      for (var q = 0; q < fl2.length; q++) {
        if (fl2[q].type === 'chargeGlow') glowFrames++;
        if (fl2[q].type === 'callout' && fl2[q].text === '巅峰谢幕') sawBoomCallout = true;
        if (fl2[q].type === 'mote' && fl2[q].text === '哈哈') sawHaha++;
        if (fl2[q].type === 'strike') sawStrike = true;
      }
    }
    /* ★★ 自爆和坠机共用同一条 down 事件，但**画面必须不一样**：
       一个是天上掉直升机（strike 尾迹），一个是自己原地涨起来（chargeGlow）。
       画成一样的话，玩家会以为羊帆也在召唤直升机。 */
    TH.ok('★ 自爆前是一圈「要炸了」的原地蓄力（不是直升机砸下来）',
      glowFrames >= 10, glowFrames + ' 帧里看得到蓄力圈');
    TH.eq('★ 而且天上没有直升机（strike 尾迹一次都不该有）', sawStrike, false);
    TH.ok('★ 爆炸时弹出「巅峰谢幕」', sawBoomCallout);
    TH.ok('★ 被震晕的敌人头顶冒「哈哈」（和嘉豪共用同一套表现）',
      sawHaha > 0, sawHaha + ' 帧里看得到哈哈');
  }

  /* ============================================================
   * 五j、楚生疑犯「阴暗领域 / 遁入暗影」在画面上看得见
   *
   *   规则在 simtest 里验过了。这里只问三件事：
   *     ① 领域到底画出来没有（"变黑 + 下雨"是本轮新增的**地面层**，
   *        它是第一份不属于任何单位的持续效果，没有任何现成的表现可复用）
   *     ② 领域是不是**真的留在地上**（施法者死了还在）
   *     ③ 遁入暗影能不能一眼看出来（一个免疫一切伤害、又不会被索敌的单位，
   *        画面上不说清楚就变成了"对面集体发呆 + 我方有人不掉血"）
   * ============================================================ */
  async function testFieldVfx() {
    TH.section('楚生疑犯 · 阴暗领域表现');

    var result = W.ST.Battle.battle({
      a: [{ id: 'windcaller', star: 2, items: ['belt', 'belt', 'belt'], r: 2, c: 3 },
          { id: 'dagger', star: 1, items: ['belt', 'belt', 'belt'], r: 3, c: 3 }],
      b: [{ id: 'medic', star: 1, items: ['belt', 'belt', 'belt'], r: 6, c: 3 }]
    }, 1357);
    var fields = result.log.filter(function (e) { return e.type === 'field'; });
    TH.ok('这一场放出了领域（否则后面全是空断言）', fields.length > 0,
      fields.length + ' 次');
    if (!fields.length) return;
    var f0 = fields[0];

    W.Arena.play(result);
    var sawCallout = false, fieldFrames = 0, maxLiveFields = 0;
    for (var i = 0; i < 1500; i++) {
      W.Arena.step(1 / 30);
      var fl = W.Arena.fxList();
      for (var k = 0; k < fl.length; k++) {
        if (fl[k].type === 'callout' && fl[k].text === '阴暗领域') sawCallout = true;
      }
      var live = W.Arena.fields();
      if (live.length > 0) fieldFrames++;
      if (live.length > maxLiveFields) maxLiveFields = live.length;
    }

    TH.ok('★ 撑起领域时会弹出「阴暗领域」的台词', sawCallout);
    TH.ok('★ 领域在画面上**持续存在**（不是闪一下就没）',
      fieldFrames >= 60, fieldFrames + ' 帧（约 ' + (fieldFrames / 30).toFixed(1) + ' 秒）');
    TH.ok('★ 同一时刻场上最多只有它该有的那些领域（不会重复堆）',
      maxLiveFields >= 1 && maxLiveFields <= 3, '峰值 ' + maxLiveFields + ' 片');

    /* ★★ 到期之后必须**真的消失**（画面上那片黑要收回）。
       ★★ 这一条要在一个**打得比对局长**的场面里验：下面那个"放完就死"
          的短场面在第 7.3 秒就结束了（一方全灭），播放会停在那一刻 ——
          采样窗口（第 8 秒 / 第 12 秒）永远不会到，读出来永远是 0。
          （第一版就是这么假红的：两边都读到 0.0。）
       ★★ 而且**不能数"暗像素"**：领域中心的透明度只有 0.46，
          叠在浅绿灰底上算出来大约是 (136,140,143)，根本不是"暗" ——
          拿 <90 去数只会数到棋子立绘自己的深色像素。所以在同一个格子上
          取两次平均亮度比一比：相对量，不依赖任何绝对阈值。 */
    var liveT = (f0.t + f0.until) / 2;          // 领域正中间那一会儿
    var expiredT = f0.until + 2;                // 过期两秒之后
    var probes = [[f0.r, 0], [f0.r, 7]];        // 圈里、离那几个人远的两格
    var cv2 = $('arena');
    var CELLW = W.Arena.cell(), PITCHW = W.Arena.pitch();
    function brightAt(r, c) {
      var x = Math.round(c * PITCHW + CELLW / 2), y = Math.round(r * PITCHW + CELLW / 2);
      var s = Math.max(3, Math.round(CELLW * 0.12));
      var d = cv2.getContext('2d').getImageData(x - s, y - s, s * 2, s * 2).data;
      var sum = 0, n = 0;
      for (var q = 0; q < d.length; q += 4) { sum += d[q] + d[q + 1] + d[q + 2]; n++; }
      return n ? sum / n / 3 : -1;
    }
    function probeBright() {
      var best = -1;
      for (var pi = 0; pi < probes.length; pi++) {
        var v = brightAt(probes[pi][0], probes[pi][1]);
        if (v > 0 && (best < 0 || v < best)) best = v;   // 取更暗的那个（更可能是地面）
      }
      return best;
    }
    W.Arena.play(result);
    var brightLive = 0, brightExpired = 0;
    for (var f4 = 0; f4 < 1500; f4++) {
      W.Arena.step(1 / 30);
      var nowT = W.Arena.time();
      if (brightLive === 0 && nowT >= liveT) brightLive = probeBright();
      if (brightExpired === 0 && nowT >= expiredT) brightExpired = probeBright();
    }
    TH.note('采样格 (' + probes[0].join(',') + ') / (' + probes[1].join(',') +
      ') 的平均亮度：领域生效 ' + brightLive.toFixed(1) +
      ' → 过期之后 ' + brightExpired.toFixed(1));
    TH.ok('★ 领域生效时那一片真的变黑了（亮度明显低于原来的地面）',
      brightLive > 0 && brightExpired > 0 && brightLive < brightExpired - 20,
      brightLive.toFixed(1) + ' vs ' + brightExpired.toFixed(1));
    TH.ok('★ 领域到期之后那一片恢复原样（那片黑不会永远盖在棋盘上）',
      brightExpired > brightLive + 20,
      brightLive.toFixed(1) + ' → ' + brightExpired.toFixed(1));

    /* ★★ 领域是"留在地上的"：施法者死了、退场了，它还得在。
       渲染层有一份自己的领域表（pb.fields），这一条就是验它
       不依赖任何单位。
       ★ 场景要专门配：施法者必须**死在领域还没到期的时候**。
         上方那个"打不死我"的场面里，它 60 秒都不一定死，
         领域早在第 17 秒就散了 —— 那样验的是"领域会过期"，不是"领域不挂在人身上"。 */
    var dying = W.ST.Battle.battle({
      a: [{ id: 'windcaller', star: 1, items: ['belt', 'belt', 'belt'], r: 3, c: 3 }],
      b: [{ id: 'titan', star: 3, items: ['belt', 'belt', 'belt'], r: 4, c: 3 },
          { id: 'titan', star: 3, items: ['belt', 'belt', 'belt'], r: 4, c: 4 }]
    }, 2468);
    var dFields = dying.log.filter(function (e) { return e.type === 'field'; });
    var dDeath = dying.log.filter(function (e) { return e.type === 'death' && e.who === 'a0'; });
    TH.ok('专门配的这一场里，它是"放完领域就阵亡"（否则这条验不了）',
      dFields.length > 0 && dDeath.length > 0,
      dFields.length + ' 次领域 / ' + dDeath.length + ' 次阵亡');
    if (!dFields.length || !dDeath.length) return;

    W.Arena.play(dying);
    var aliveFieldAfterDeath = false, framesAfterDeath = 0;
    for (var f2 = 0; f2 < 1200; f2++) {
      W.Arena.step(1 / 30);
      var us = W.Arena.units(), chi = null;
      for (var uid in us) if (us[uid].defId === 'windcaller') chi = us[uid];
      if (!chi || chi.hp > 0) continue;
      framesAfterDeath++;
      if (W.Arena.fields().length > 0) aliveFieldAfterDeath = true;
    }
    TH.ok('★ 施法者阵亡之后领域仍然在场上（渲染层的领域表不挂在单位身上）',
      aliveFieldAfterDeath, '阵亡后还有 ' + framesAfterDeath + ' 帧的画面');
  }

  /* ★ 3 星「遁入暗影」的表现：半透明 + 🌑 徽章 + 台词。
     和领域分开写，因为它是"某个单位的状态"，不是"某片地的状态"。 */
  async function testShadowVfx() {
    TH.section('楚生疑犯 · 遁入暗影表现');

    var result = W.ST.Battle.battle({
      a: [{ id: 'windcaller', star: 3, items: ['belt', 'belt', 'belt'], r: 3, c: 3 },
          { id: 'dagger', star: 1, items: ['belt', 'belt', 'dragonscale'], r: 3, c: 4 }],
      b: [{ id: 'titan', star: 1, items: ['thornmail', 'belt', 'belt'], r: 4, c: 3 }]
    }, 9090);
    var ons = result.log.filter(function (e) { return e.type === 'shadow' && e.on; });
    var offs = result.log.filter(function (e) { return e.type === 'shadow' && !e.on; });
    TH.ok('这一场遁入过暗影（否则后面全是空断言）', ons.length > 0, ons.length + ' 次');
    if (!ons.length) return;

    W.Arena.play(result);
    var sawOn = false, sawOff = false, shadowFrames = 0;
    for (var i = 0; i < 1200; i++) {
      W.Arena.step(1 / 30);
      var us = W.Arena.units(), me = null;
      for (var uid in us) if (us[uid].defId === 'windcaller') me = us[uid];
      if (me && me.shadow) shadowFrames++;
      var fl = W.Arena.fxList();
      for (var k = 0; k < fl.length; k++) {
        if (fl[k].type === 'callout' && fl[k].text === '遁入暗影') sawOn = true;
        if (fl[k].type === 'callout' && fl[k].text === '现形') sawOff = true;
      }
    }
    TH.ok('★ 遁入暗影时弹出台词', sawOn);
    TH.ok('★ 现形时也有台词（两个时刻都要有信号）', sawOff);
    TH.ok('★ 暗影状态在画面上持续存在', shadowFrames >= 60,
      shadowFrames + ' 帧（约 ' + (shadowFrames / 30).toFixed(1) + ' 秒）');
  }

  /* ============================================================
   * 五k、Dank1ng「先过中门再谈未来 / 空悲切」在画面上看得见
   *
   *   规则在 simtest 里验过了。这里只问三件事：
   *     ① 技能击杀有没有真的留下骷髅（"留在原地"是本轮的新要求，
   *        它和别的飘字最大的区别是几乎不往上飘）
   *     ② 耍刀那 3 秒有没有画出来 —— 它同时是"不攻击"的窗口，
   *        画面上不说清楚就变成"这个棋子卡住了"
   *     ③ 「空悲切」开的那一刻有没有信号（一秒一发如果不解释，
   *        看起来就像数值出错了）
   * ============================================================ */
  async function testDankVfx() {
    TH.section('Dank1ng · 先过中门再谈未来表现');

    var result = W.ST.Battle.battle({
      a: [{ id: 'deadeye', star: 1, items: ['sapphire', 'belt', 'belt'], r: 3, c: 3 },
          { id: 'medic', star: 1, items: ['belt', 'belt', 'belt'], r: 3, c: 5 }],
      b: [{ id: 'dagger', star: 1, items: ['belt'], r: 4, c: 3 },
          { id: 'titan', star: 1, items: ['belt', 'belt', 'belt'], r: 4, c: 4 }]
    }, 8080);
    var skulls = result.log.filter(function (e) { return e.type === 'skull'; });
    var knives = result.log.filter(function (e) { return e.type === 'knife'; });
    TH.ok('这一场有技能击杀（否则后面全是空断言）',
      skulls.length > 0 && knives.length > 0,
      skulls.length + ' 个骷髅 / ' + knives.length + ' 次耍刀');
    if (!skulls.length || !knives.length) return;

    W.Arena.play(result);
    var skullFrames = 0, knifeFrames = 0, sawSkullMote = false;
    var knifeSeen = false, knifeEnded = false;
    for (var i = 0; i < 1200; i++) {
      W.Arena.step(1 / 30);
      var fl = W.Arena.fxList();
      for (var k = 0; k < fl.length; k++) {
        if (fl[k].type === 'mote' && fl[k].text === '💀') sawSkullMote = true;
        if (fl[k].type === 'knife') knifeFrames++;
      }
      var us = W.Arena.units(), me = null;
      for (var uid in us) if (us[uid].defId === 'deadeye') me = us[uid];
      if (!me) continue;
      if (me.knifeUntil > 0 && W.Arena.time() < me.knifeUntil) { knifeSeen = true; skullFrames++; }
      else if (knifeSeen) knifeEnded = true;
    }
    TH.ok('★ 击杀之后画面上出现了骷髅', sawSkullMote);
    TH.ok('★ 骷髅会在原地停留一段时间（不是一闪而过）', skullFrames >= 10,
      skullFrames + ' 帧');
    TH.ok('★ 耍刀的 3 秒里画面在转刀', knifeFrames >= 40,
      knifeFrames + ' 帧（约 ' + (knifeFrames / 30).toFixed(1) + ' 秒）');
    TH.ok('★ 耍刀状态会结束（收刀之后卡片恢复原样）', knifeEnded);
  }

  /* ★ 「空悲切」的表现：那张卡片必须在队友死光的那一刻给出信号。 */
  async function testEndlessVfx() {
    TH.section('Dank1ng · 空悲切表现');

    var result = W.ST.Battle.battle({
      a: [{ id: 'deadeye', star: 1, items: ['belt', 'belt', 'belt'], r: 3, c: 3 },
          { id: 'dagger', star: 1, r: 3, c: 4 }],
      b: [{ id: 'titan', star: 3, items: ['belt', 'belt', 'belt'], r: 4, c: 3 }]
    }, 3131);
    var ons = result.log.filter(function (e) { return e.type === 'endless' && e.on; });
    TH.ok('这一场触发了空悲切（否则后面全是空断言）', ons.length > 0, ons.length + ' 次');
    if (!ons.length) return;

    W.Arena.play(result);
    var sawCallout = false, endlessFrames = 0;
    for (var i = 0; i < 1200; i++) {
      W.Arena.step(1 / 30);
      var fl = W.Arena.fxList();
      for (var k = 0; k < fl.length; k++) {
        if (fl[k].type === 'callout' && fl[k].text === '空悲切') sawCallout = true;
      }
      var us = W.Arena.units(), me = null;
      for (var uid in us) if (us[uid].defId === 'deadeye') me = us[uid];
      if (me && me.endless) endlessFrames++;
    }
    TH.ok('★ 进入空悲切时弹出台词', sawCallout);
    TH.ok('★ 「空悲切」状态在画面上持续可见（一帧的信号不够）', endlessFrames >= 30,
      endlessFrames + ' 帧');
  }

  /* ============================================================
   * 五g、战后伤害占比
   *
   *   紧跟在 testCombatFeel 后面跑 —— 那时候结算浮层正好是打开的，
   *   而且里面是真的打过一场的数据。
   * ============================================================ */
  async function testDamagePanel() {
    TH.section('战后伤害占比');

    var box = $('result-body');
    var panel = box ? box.querySelector('.dmg-panel') : null;
    TH.ok('结算浮层里有伤害占比面板', !!panel);
    if (!panel) return;

    var rows = qa('#result-body .dmg-panel .dmg-row');
    TH.ok('每个上场棋子一行', rows.length > 0, rows.length + ' 行');
    TH.ok('标题里给了总伤害',
      (panel.querySelector('.dmg-title') || {}).textContent.indexOf('总计') >= 0,
      (panel.querySelector('.dmg-title') || {}).textContent);

    // 百分比必须加起来是 100（四舍五入各算各的，允许几点的误差）
    var sum = 0, widthsOk = true, sorted = true, prev = 1e9;
    for (var i = 0; i < rows.length; i++) {
      var num = rows[i].querySelector('.dmg-num').textContent;
      var pct = parseInt(num.split('%')[0], 10);
      if (!isNaN(pct)) sum += pct;
      var w = parseFloat(rows[i].querySelector('.dmg-fill').style.width) || 0;
      if (!(w >= 0 && w <= 100)) widthsOk = false;
      if (pct > prev) sorted = false;
      prev = pct;
    }
    TH.ok('★ 百分比加起来是 100%（允许四舍五入误差）', Math.abs(sum - 100) <= rows.length,
      '合计 ' + sum + '%');
    TH.ok('★ 条长都在 0~100% 之间', widthsOk);
    TH.ok('★ 按伤害从高到低排（第一名在最上面，一眼看出主 C）', sorted);

    // 伤害最高的那个人条长必须是 100%（按本队最高归一化）
    var first = parseFloat(rows[0].querySelector('.dmg-fill').style.width) || 0;
    TH.ok('★ 第一名是满条（按本队最高归一化，不是按总和）',
      first > 99, '第一行条长 ' + first + '%');

    TH.ok('面板里每行都有名字和数字',
      rows.every(function (r) {
        return r.querySelector('.dmg-who').textContent.trim().length > 0 &&
               r.querySelector('.dmg-num').textContent.trim().length > 0;
      }));
  }

  /* ============================================================
   * 五h、拖拽放卡
   * ============================================================ */
  async function testDrag() {
    TH.section('拖拽放卡');

    var st = G();
    st.board = {};
    st.bench = new Array(9);
    st.bench[0] = { uid: 'drag1', defId: 'bowman', star: 1, items: [] };
    st.gold = 60;
    /* ★ 先把结算浮层关掉：前面 testCombatFeel 打完留下的浮层还盖在屏幕上，
       它会把 elementFromPoint 全部吃掉（实测命中的是 #result-overlay），
       拖拽判定就永远拿到 null。
       前面那些用例没受影响，是因为它们用 el.click() 直接派发，
       根本不走命中判定 —— 只有拖拽依赖真实坐标，才会撞上这个。 */
    var ov = $('result-overlay');
    if (ov) ov.classList.remove('on');
    W.Game.refresh();
    await wait(90);

    var chip = q('#bench .u');
    TH.ok('备战席上有一个可以拖的棋子', !!chip);
    if (!chip) return;

    /* ★★ 专测「有立绘的棋子」。
     *
     *   之前的 bug：有立绘的棋子拖不动，没有立绘的（emoji）却能拖 ——
     *   因为浏览器对 <img> 有**原生拖拽**，一启动就发 pointercancel，
     *   把整个指针序列掐断，拖拽刚开始就被自己收掉了。
     *
     *   ★ 而合成出来的 PointerEvent **不会**触发浏览器原生拖拽，
     *     所以"真的拖一下"测不出这个 bug（第一版就是这么漏掉的）。
     *     能测的是它的**前提条件**：卡片上的 <img> 必须被明确标成不可拖拽。
     *     这几条断言看着很土，但它们是这个 bug 唯一能在自动化里落地的形式。 */
    var artImg = chip.querySelector('.u-art img');
    TH.ok('测试用的棋子确实有立绘（否则这几条测不到东西）', !!artImg,
      artImg ? ('img ' + artImg.getAttribute('src')) : '没有 <img>，用的是 emoji 兜底');
    if (artImg) {
      TH.eq('★ 立绘 <img> 被标成不可拖拽（draggable=false）', artImg.draggable, false);
    }
    TH.eq('★ 棋子卡本身不是可拖拽元素', chip.draggable, false);
    // 落在卡片上的原生 dragstart 必须被拦掉（兜底防线）
    var dsEv = new W.Event('dragstart', { bubbles: true, cancelable: true });
    var notCancelled = chip.dispatchEvent(dsEv);
    TH.eq('★ 拿原生 dragstart 去拖卡片会被拦下来（兜底防线）', notCancelled, false);

    /* ★ 事件必须建在**游戏那个 iframe 的 window** 上、派发到 **iframe 的 document**。
       这个测试页把游戏装在 <iframe id="game"> 里，外边这一层的 document
       拿到的是 iframe 本身（elementFromPoint 只会返回 IFRAME），
       指针事件也不会传进去 —— 用错一层就会出现"拖了但没反应"。 */
    var EvClass = W.PointerEvent || W.MouseEvent;
    function mkEv(type, x, y) {
      return new EvClass(type, { bubbles: true, cancelable: true,
                                 clientX: x, clientY: y, button: 0 });
    }
    function dragTo(fromEl, toEl, moveX, moveY) {
      var a = fromEl.getBoundingClientRect();
      var b = toEl.getBoundingClientRect();
      var ax = a.left + a.width / 2, ay = a.top + a.height / 2;
      var bx = b.left + b.width / 2, by = b.top + b.height / 2;
      fromEl.dispatchEvent(mkEv('pointerdown', ax, ay));
      D.dispatchEvent(mkEv('pointermove', ax + (moveX || 20), ay + (moveY || 20)));
      D.dispatchEvent(mkEv('pointermove', bx, by));
      D.dispatchEvent(mkEv('pointerup', bx, by));
      /* ★ 真实浏览器在 pointerup 之后还会补一发 click，游戏就是靠它被"吞掉"
         来区分"拖拽"和"点击"的。测试里必须补上，否则那枚一次性开关会一直挂着，
         把后面那次**真正**要验的点击也一起吞了。 */
      toEl.dispatchEvent(new EvClass('click', { bubbles: true, cancelable: true }));
    }

    var cell = qa('#player-half .cell')[16];
    // 先确认落点确实能被 elementFromPoint 命中 —— 拖拽判定全靠它，
    // 它要是拿不到格子，拖拽就会"看起来没反应"
    var cr = cell.getBoundingClientRect();
    var px = cr.left + cr.width / 2, py = cr.top + cr.height / 2;
    var hit = D.elementFromPoint(px, py);
    TH.ok('★ 落点能被 elementFromPoint 命中（拖拽判定依赖它）',
      !!(hit && hit.closest && hit.closest('.cell') === cell),
      '点(' + Math.round(px) + ',' + Math.round(py) + ') 格子rect ' +
      Math.round(cr.left) + ',' + Math.round(cr.top) + ' ' +
      Math.round(cr.width) + '×' + Math.round(cr.height) + ' → 命中 ' +
      (hit ? (hit.tagName + '#' + (hit.id || '') + '.' + (hit.className || '')) : '空'));

    dragTo(chip, cell);
    await wait(160);

    var tr = cell.dataset.r, tc = cell.dataset.c;
    TH.ok('★ 拖到棋盘格上，棋子就落在那格', !!G().board[tr + ',' + tc],
      '落点 (' + tr + ',' + tc + ') 上' + (G().board[tr + ',' + tc] ? '有棋子' : '是空的'));
    TH.ok('★ 备战席腾空了', G().bench.filter(Boolean).length === 0);

    // 拖回备战席
    var back = q('#player-half .u');
    var slot = qa('#bench .bench-cell')[3];
    TH.ok('场上有棋子可以拖回去', !!back);
    if (back) {
      dragTo(back, slot);
      await wait(160);
      TH.ok('★ 拖回备战席也生效', !!G().bench[3] && boardN() === 0,
        '备战席 3 号位' + (G().bench[3] ? '有棋子' : '是空的'));
    }

    // 拖到空白处（棋盘外）应该什么都不发生，而且不留幽灵卡
    var chip2 = q('#bench .u');
    if (chip2) {
      dragTo(chip2, q('#bench'), -200, -200);
      await wait(120);
      TH.eq('★ 丢在空地不会有幽灵卡残留', qa('.drag-ghost').length, 0);
    }

    /* ★ 不移动的「按下 → 松开」必须仍然算一次点击。
       拖拽和点击共用同一套指针事件，最容易出的问题就是
       "加了拖拽之后点不动了" —— 这一条专门盯着它。
       真实的浏览器在 pointerup 之后还会补一个 click，这里手动补上。 */
    var chip3 = q('#bench .u');
    if (chip3) {
      var r3 = chip3.getBoundingClientRect();
      var cx = r3.left + r3.width / 2, cy = r3.top + r3.height / 2;
      G().sel = null;
      chip3.dispatchEvent(mkEv('pointerdown', cx, cy));
      D.dispatchEvent(mkEv('pointerup', cx, cy));    // 没有 pointermove
      chip3.click();                                  // 浏览器补的那一下
      await wait(120);
      TH.ok('★ 不移动的按下-松开仍然算点击（拖拽没把点击吃掉）',
        !!G().sel && G().sel.uid === chip3.dataset.uid,
        G().sel ? ('选中的是 ' + G().sel.uid) : '什么都没选中');
      G().sel = null;
    }

    // 清理，别影响后面的用例
    st.board = {};
    st.bench = new Array(9);
    W.Game.refresh();
    await wait(90);
  }


  /* ============================================================
   * 六、开战与结算
   * ============================================================ */
  async function testCombat() {
    TH.section('开战 · 结算');

    // 给一个能打的阵容，确保能赢下第一关
    var st = G();
    st.board = {};
    st.bench = new Array(9);
    st.gold = 60;
    var strong = [
      { id: 'blademaster', star: 2, items: ['giantblade', 'huntereye'] },
      { id: 'titan', star: 2, items: ['dragonscale', 'belt'] },
      { id: 'abyss', star: 2, items: ['spellbook'] },
      { id: 'bowman', star: 2 }, { id: 'spearman', star: 2 }, { id: 'crossbow', star: 2 }
    ];
    var placed = W.ST.Battle.autoPlace('b', strong);
    for (var i = 0; i < placed.length; i++) {
      st.board[placed[i].r + ',' + placed[i].c] =
        { uid: 'c' + i, defId: placed[i].id, star: placed[i].star, items: placed[i].items };
    }
    W.Game.refresh();
    await wait(150);

    TH.eq('棋盘上摆了 6 个棋子', qa('#player-half .u').length, 6);

    var hpBefore = G().hp;
    click($('btn-fight'));
    await wait(1400);

    TH.eq('切到了战斗场景', W.UI.current(), 'scene-combat');
    TH.ok('战斗画布尺寸正确（8 列 × 8 行）',
      $('arena').width >= 384 && $('arena').height >= 512,
      $('arena').width + 'x' + $('arena').height);

    var res = G().result;
    TH.ok('战斗结果已经算出来了', !!res && !!res.winner, res ? res.winner : 'null');

    // 初始快照必须正好是「我方上场数 + 对手上场数」
    var myN = W.Game.playerSetup().length;
    var foeN = W.ST.LEVELS[G().level - 1].comp.length;
    TH.eq('结果里有初始快照，数量等于双方上场数之和',
      res.initial.units.length, myN + foeN);
    TH.ok('结果里有事件流', res && res.log.length > 20, res ? res.log.length + ' 条事件' : '—');
    TH.ok('我方在下方半场（r >= 4）', res.initial.units.filter(function (u) {
      return u.side === 'b';
    }).every(function (u) { return u.r >= 4; }));
    TH.ok('对手在上方半场（r <= 3）', res.initial.units.filter(function (u) {
      return u.side === 'a';
    }).every(function (u) { return u.r <= 3; }));

    // 画面真的画了东西（采样非背景像素）
    var cv = $('arena');
    var ctx = cv.getContext('2d');
    var img = ctx.getImageData(0, 0, cv.width, cv.height).data;
    var painted = 0;
    for (var p = 0; p < img.length; p += 4 * 97) {
      if (Math.abs(img[p] - 16) > 12 || Math.abs(img[p + 1] - 24) > 12 || Math.abs(img[p + 2] - 35) > 12) painted++;
    }
    TH.ok('战斗画面确实画出了东西', painted > 100, painted + ' 个非背景采样点');

    // 跳到结算（无头环境不驱动 requestAnimationFrame，所以用 skip 走完同一条事件消费路径）
    click($('btn-skip'));
    await wait(1000);

    TH.ok('结算浮层弹出来了', $('result-overlay').classList.contains('on'));
    TH.ok('结算给了胜负标题', txt('result-title').length > 0, txt('result-title'));
    TH.ok('结算给了结果摘要', txt('result-sub').indexOf('用时') >= 0, txt('result-sub'));
    TH.ok('结算有操作按钮', qa('#result-acts .btn').length >= 1,
      qa('#result-acts .btn').map(function (b) { return b.textContent; }).join(' / '));

    TH.ok('赢了的话血量不掉', G().hp === hpBefore || txt('result-title').indexOf('失败') >= 0,
      'hp ' + hpBefore + ' → ' + G().hp + '，标题「' + txt('result-title') + '」');
  }

  /* ============================================================
   * 七、进下一关 / 重来 / 通关 / 战败
   * ============================================================ */
  async function testProgression() {
    TH.section('关卡推进');

    // 刚才那套阵容应该赢了第一关
    var won = txt('result-title').indexOf('通过') >= 0 || txt('result-title').indexOf('通关') >= 0;
    var acts = qa('#result-acts .btn');

    if (won) {
      var lvBefore = G().level;
      var goldBefore = gold();
      click(acts[0]);                        // 进入下一关
      await wait(1200);
      TH.eq('关卡 +1', G().level, lvBefore + 1);
      TH.eq('回到了准备阶段', W.UI.current(), 'scene-game');
      TH.ok('打下一关会拿到通关奖励', gold() >= goldBefore,
        goldBefore + ' → ' + gold());
      TH.ok('新一关的对手换人了', txt('enemy-name').length > 0, txt('enemy-name'));
      TH.ok('结算浮层收起来了', !$('result-overlay').classList.contains('on'));
    } else {
      // 输了也应该能重来
      click(acts[0]);
      await wait(1200);
      TH.eq('失败后回到准备阶段', W.UI.current(), 'scene-game');
      TH.ok('失败会掉血', G().hp < 100, 'hp = ' + G().hp);
      TH.ok('失败后还在同一关', G().level >= 1);
    }

    // 战败流程：血量见底再输一次
    var st = G();
    st.hp = 1;
    st.board = {};
    st.bench = new Array(9);
    st.board['4,2'] = { uid: 'weak', defId: 'acolyte', star: 1, items: [] };
    W.Game.refresh();
    await wait(120);
    click($('btn-fight'));
    await wait(1400);
    click($('btn-skip'));
    await wait(1000);

    TH.eq('血量归零', G().hp, 0);
    TH.ok('触发了「挑战结束」结算', txt('result-title').indexOf('结束') >= 0, txt('result-title'));
    TH.ok('战败结算有「重新开始」', qa('#result-acts .btn').map(function (b) { return b.textContent; }).join('|')
      .indexOf('重新开始') >= 0,
      qa('#result-acts .btn').map(function (b) { return b.textContent; }).join(' / '));

    // 重新开始 → 回到第一关满血
    click(qa('#result-acts .btn')[0]);
    await wait(1200);
    TH.eq('重新开始后回到第一关', G().level, 1);
    TH.eq('重新开始后满血', G().hp, 100);
    TH.eq('重新开始后回到准备阶段', W.UI.current(), 'scene-game');
    TH.ok('重新开始后金币回到初始值以上', gold() >= 10, gold() + ' 金');
    TH.ok('重新开始后棋盘和备战席都清空了', boardN() === 0 && benchN() === 0,
      'board=' + boardN() + ' bench=' + benchN());

    /* ---------- 通关（第 24 关）→ 无尽模式 ----------
     *
     * 这一段同时守着两件很重要的事：
     *   ① 24 关打完真的能进无尽模式
     *   ② ★「摆上去的人 == 进战斗的人，而且就站在自己摆的那一格」
     *
     *   ② 不是假想出来的：battle.js 的 buildSide() 有一句
     *   slice(0, ST.MAX_DEPLOY)，超出上限的棋子会被**静默丢掉** ——
     *   玩家摆 8 个、打起来 6 个，界面上完全没有提示。
     *   所以这里逐格比对，而不是只数总人数。
     */
    var FINAL = W.ST.LEVELS.length;
    var st2 = G();
    st2.level = FINAL;
    st2.hp = 100;
    st2.gold = 99;
    st2.lvl = W.ST.LEVEL_TABLE.length - 1;          // 满级 = 8 人口
    // ★ 关键：不能只改 level 就直接开战 —— G.enemy 是在 beginRound() 里
    //   根据 level 取的。只改 level 的话，打到的还是上一关的对手，
    //   测试会「因为错误的理由通过」。所以这里走真实的回合开始流程。
    W.Game.retry();
    await wait(1000);
    TH.eq('关卡进度显示为 24 / 24', txt('hud-stage-sub'), '第 ' + FINAL + ' / ' + FINAL + ' 关');
    TH.ok('第 24 关的标题正确',
      txt('hud-stage').indexOf(W.ST.LEVELS[FINAL - 1].title) >= 0, txt('hud-stage'));
    TH.ok('对手真的换成了第 24 关的 BOSS',
      txt('enemy-name').indexOf(W.ST.LEVELS[FINAL - 1].name) >= 0,
      txt('enemy-name') + '（应为 ' + W.ST.LEVELS[FINAL - 1].name + '）');
    TH.eq('满级可以上场 8 个', txt('hud-field').split('/')[1], String(W.ST.MAX_DEPLOY));

    // 碾压阵容：8 个 3 星，顺便验证满编 8 人
    var st3 = G();
    st3.board = {};
    var boss = [
      { id: 'titan', star: 3, items: ['dragonscale', 'belt', 'thornmail'] },
      { id: 'blademaster', star: 3, items: ['giantblade', 'huntereye', 'infinity'] },
      { id: 'abyss', star: 3, items: ['spellbook', 'spellbook', 'spellbook'] },
      { id: 'deadeye', star: 3, items: ['giantblade', 'huntereye'] },
      { id: 'earthwarden', star: 3, items: ['holygrail'] },
      { id: 'butcher', star: 3, items: ['swiftboots', 'belt'] },
      { id: 'medic', star: 3, items: ['holygrail'] },
      { id: 'windcaller', star: 3, items: ['spellbook'] }
    ];
    var bp = W.ST.Battle.autoPlace('b', boss);
    var placedAt = {};
    for (var i2 = 0; i2 < bp.length; i2++) {
      st3.board[bp[i2].r + ',' + bp[i2].c] =
        { uid: 'b' + i2, defId: bp[i2].id, star: bp[i2].star, items: bp[i2].items };
      placedAt[bp[i2].r + ',' + bp[i2].c] = bp[i2].id;
    }
    W.Game.refresh();
    await wait(150);
    TH.eq('摆上了 8 个 3 星棋子（满编）', qa('#player-half .u').length, 8);
    TH.eq('备战阶段记下了 8 个格子的位置', Object.keys(placedAt).length, 8);

    click($('btn-fight'));
    await wait(1400);
    var bossRes = G().result;
    var mineUnits = bossRes.initial.units.filter(function (u) { return u.side === 'b'; });
    var foeUnits = bossRes.initial.units.filter(function (u) { return u.side === 'a'; });
    var ROWS_PER_SIDE = W.ST.BATTLE_CFG.ROWS_PER_SIDE;

    TH.eq('★ 摆上去 8 个 → 战斗里也是 8 个（没有被静默丢掉）',
      mineUnits.length, Object.keys(placedAt).length);

    var posBad = [];
    Object.keys(placedAt).forEach(function (k) {
      var hit = mineUnits.filter(function (u) { return u.r + ',' + u.c === k; });
      if (hit.length !== 1) posBad.push(k + '(' + hit.length + ')');
    });
    TH.eq('★ 每个棋子都站在准备阶段摆的那一格（行列完全一致）',
      posBad.join(',') || '无', '无');

    TH.ok('★ 我方全在下半场、敌方全在上半场（各就各位，不越界）',
      mineUnits.every(function (u) { return u.r >= ROWS_PER_SIDE && u.r < ROWS_PER_SIDE * 2; }) &&
      foeUnits.every(function (u) { return u.r >= 0 && u.r < ROWS_PER_SIDE; }),
      '我方行 ' + mineUnits.map(function (u) { return u.r; }).join(',') +
      '　敌方行 ' + foeUnits.map(function (u) { return u.r; }).join(','));

    var occ = {}, clash = [];
    bossRes.initial.units.forEach(function (u) {
      var k = u.r + ',' + u.c;
      if (occ[k]) clash.push(k);
      occ[k] = 1;
    });
    TH.eq('★ 没有两个棋子站在同一格', clash.join(',') || '无', '无');

    TH.ok('BOSS 阵容里有山岳（5 费传说棋子）',
      bossRes.initial.units.some(function (u) {
        return u.side === 'a' && u.defId === 'titan' && u.star >= 2;
      }),
      W.ST.LEVELS[FINAL - 1].comp.map(function (x) {
        return W.ST.UNIT_BY_ID[x.id].name + (x.star || 1) + '★';
      }).join('、'));

    click($('btn-skip'));
    await wait(1000);

    var finalWin = txt('result-title').indexOf('通关') >= 0;
    TH.ok('满配 8 个 3 星阵容能打穿第 24 关 BOSS', finalWin,
      '标题「' + txt('result-title') + '」　' + txt('result-sub'));
    var finalActs = qa('#result-acts .btn').map(function (b) { return b.textContent; }).join('|');
    TH.ok('通关结算出现「进入无尽模式」', finalActs.indexOf('无尽') >= 0, finalActs);

    /* ---------- 无尽模式 ---------- */
    TH.section('无尽模式');

    var endlessBtn = qa('#result-acts .btn').filter(function (b) {
      return b.textContent.indexOf('无尽') >= 0;
    })[0];
    TH.ok('找得到「进入无尽模式」按钮', !!endlessBtn);
    if (!endlessBtn) return;

    click(endlessBtn);
    await wait(1300);

    TH.ok('进入了无尽模式', W.Game.inEndless(), 'endless = ' + G().endless);
    TH.eq('无尽模式从第 1 波开始', G().endless, 1);
    TH.ok('HUD 显示的是「无尽 · 第 1 波」', txt('hud-stage').indexOf('波') >= 0, txt('hud-stage'));
    TH.ok('副标题说明每波变强', txt('hud-stage-sub').indexOf('无尽') >= 0, txt('hud-stage-sub'));
    TH.ok('对手是随机兽潮（不是 24 关里任何一个）',
      W.ST.LEVELS.every(function (L) { return L.name !== G().enemy.name; }), G().enemy.name);
    TH.ok('无尽对手带面板系数（难度飙升的旋钮）', G().enemy.statScale > 1,
      '×' + G().enemy.statScale.toFixed(2));
    TH.ok('无尽第 1 波不比第 24 关弱（人数 >= 7）', G().enemy.comp.length >= 7,
      G().enemy.comp.length + ' 人');

    // 上一波摆的 8 个棋子还在，直接开打
    var beforeWave = G().endless;
    click($('btn-fight'));
    await wait(1400);
    var wRes = G().result;
    var wMine = wRes.initial.units.filter(function (u) { return u.side === 'b'; });
    TH.eq('无尽模式里摆上去的 8 个也全部进战斗', wMine.length, Object.keys(placedAt).length);
    var wBad = [];
    Object.keys(placedAt).forEach(function (k) {
      if (wMine.filter(function (u) { return u.r + ',' + u.c === k; }).length !== 1) wBad.push(k);
    });
    TH.eq('无尽模式里站位同样严格一致', wBad.join(',') || '无', '无');
    TH.ok('无尽模式双方也各在自己半场',
      wMine.every(function (u) { return u.r >= ROWS_PER_SIDE; }) &&
      wRes.initial.units.filter(function (u) { return u.side === 'a'; })
        .every(function (u) { return u.r < ROWS_PER_SIDE; }));

    click($('btn-skip'));
    await wait(1000);
    var wActs = qa('#result-acts .btn').map(function (b) { return b.textContent; }).join('|');
    TH.ok('无尽结算有「下一波」', wActs.indexOf('下一波') >= 0, wActs);
    TH.ok('无尽结算不再显示「全部通关」（它不会结束）',
      txt('result-title').indexOf('全部') < 0, txt('result-title'));

    var nextBtn = qa('#result-acts .btn').filter(function (b) {
      return b.textContent.indexOf('下一波') >= 0;
    })[0];
    if (nextBtn) {
      click(nextBtn);
      await wait(1300);
      TH.eq('波次 +1', G().endless, beforeWave + 1);
      TH.ok('下一波的面板系数更高（难度飙升）',
        G().enemy.statScale > 1.15, '×' + G().enemy.statScale.toFixed(2));
      TH.ok('每一波的阵容是重新随机的', G().enemy.comp.length > 0);
    }

    /* ★ 画布上「开战瞬间」的位置必须严格等于行列。
     *   Arena 的插值（rr/cc）是每帧朝目标格逼近的，跑了一会儿就会离开原位 ——
     *   所以这里重放一次，在 play() 之后同步地读，量的是真正的起始帧。
     *   如果哪天渲染层的行列映射和模拟器错开一格，这条会立刻炸。 */
    var drift = [];
    var holdOk = true, walkStarted = false;
    if (bossRes) {
      W.Arena.play(bossRes, {}, function () {});
      var au0 = W.Arena.units();
      Object.keys(au0).forEach(function (k) {
        var u = au0[k];
        if (Math.abs(u.rr - u.r) > 1e-6 || Math.abs(u.cc - u.c) > 1e-6) {
          drift.push(u.name + '(' + u.rr + ',' + u.cc + '≠' + u.r + ',' + u.c + ')');
        }
      });

      /* ★ 开局定格：玩家按开战以后，第一眼看到的必须是自己摆的阵。
       *
       *   移动速度曾经是「一 tick 一格」（30 格/秒），开战 0.3 秒阵型就冲到中间，
       *   所以玩家反馈「我摆的位置开战就不对了」——数据一直是对的，
       *   不对的是「看到的」。这条断言守的就是那 0.5 秒的定格。 */
      var OPEN = W.ST.BATTLE_CFG.OPENING_HOLD;
      var base = {};
      Object.keys(au0).forEach(function (k) {
        base[k] = { r: au0[k].r, c: au0[k].c, rr: au0[k].rr, cc: au0[k].cc };
      });
      // 推进到定格结束前（多留 2 帧余量）
      var frames = Math.max(1, Math.round((OPEN - 0.07) * 30));
      for (var fi = 0; fi < frames; fi++) W.Arena.step(1 / 30);
      var au1 = W.Arena.units();
      Object.keys(base).forEach(function (k) {
        var u = au1[k];
        if (!u) return;
        if (u.r !== base[k].r || u.c !== base[k].c) holdOk = false;
      });
      // 再推 1.5 秒：该走了（否则上面那条「没人动」是废话）
      for (var fj = 0; fj < 45; fj++) W.Arena.step(1 / 30);
      var au2 = W.Arena.units();
      Object.keys(base).forEach(function (k) {
        var u = au2[k];
        if (u && (u.r !== base[k].r || u.c !== base[k].c)) walkStarted = true;
      });
      W.Arena.pause();
    }
    TH.eq('★ 画布上开战瞬间的位置 = 棋子的行列（不偏移、不镜像）',
      drift.slice(0, 3).join(' ') || '无', '无');
    TH.ok('★ 开战后的定格期内，所有棋子都停在布阵时的位置',
      holdOk, '定格 ' + W.ST.BATTLE_CFG.OPENING_HOLD + ' 秒');
    TH.ok('定格结束后棋子开始自己寻敌走位（否则上一条没意义）', walkStarted);
  }

  /* ============================================================
   * 七b、上场数上限（人口）真的被拦住了吗
   * ============================================================ */
  async function testFieldLimit() {
    TH.section('上场数上限');

    var st = G();
    st.board = {};
    st.bench = new Array(9);
    st.lvl = 3;                       // 3 级 → 只能上 3 个
    st.gold = 99;
    for (var i = 0; i < 5; i++) {
      st.bench[i] = { uid: 'f' + i, defId: 'bowman', star: 1, items: [] };
    }
    W.Game.refresh();
    await wait(120);
    TH.eq('上限显示为 3', txt('hud-field'), '0/3');

    var cols = [0, 1, 2, 3];
    // 注意：每次上场都会把那一格备战席腾空，所以不能一直取第 0 格，
    // 得每次重新找「第一个有棋子的格子」。
    function firstBenchIdx() {
      var b = G().bench;
      for (var i = 0; i < b.length; i++) if (b[i]) return i;
      return -1;
    }
    for (var j = 0; j < cols.length; j++) {
      var bi = firstBenchIdx();
      if (bi < 0) break;
      W.Game.placeFromBench(bi, 4, cols[j]);
      await wait(60);
    }
    TH.eq('只上场了 3 个（第 4 个被拦住）', boardN(), 3);
    TH.eq('被拦住的棋子还留在备战席', benchN(), 2);
    TH.ok('拦截时给了提示', qa('#toasts .toast').length > 0,
      qa('#toasts .toast').map(function (t) { return t.textContent; }).join(' | '));

    // 升级之后就能多上一个
    st.lvl = 4;
    W.Game.refresh();
    await wait(80);
    W.Game.placeFromBench(firstBenchIdx(), 4, 3);
    await wait(80);
    TH.eq('等级升到 4 之后可以上第 4 个', boardN(), 4);
  }

  /* ============================================================
   * 八、退回封面
   * ============================================================ */
  async function testBackToCover() {
    TH.section('回到封面');

    var st = G();
    st.hp = 50;
    st.level = 3;
    // 走真实的返回路径：点结算浮层里的「回到封面」
    if (!q('#result-overlay').classList.contains('on')) {
      st.board = { '4,2': { uid: 'x', defId: 'bowman', star: 1, items: [] } };
      W.Game.refresh();
      click($('btn-fight'));
      await wait(1400);
      click($('btn-skip'));
      await wait(900);
    }
    var back = qa('#result-acts .btn').filter(function (b) { return b.textContent.indexOf('封面') >= 0; })[0];
    TH.ok('结算里有「回到封面」按钮', !!back);
    if (back) {
      click(back);
      await wait(1200);
      TH.eq('回到了封面场景', W.UI.current(), 'scene-cover');
      var prog = txt('cover-progress');
      TH.ok('封面上出现了挑战记录', prog.indexOf('第') >= 0 || prog.indexOf('通关') >= 0,
        JSON.stringify(prog.slice(0, 70)));
    }
  }

  /* ============================================================
   * 七d、手机竖屏布局
   *
   *   ★★ 这一组存在的理由：游戏原来只在 ≥700px 宽的窗口里测过。
   *      390 宽的手机上，「横向剩下的空间」算出来只有 2~15px 格子，
   *      而 arena.js 有一条「小于 20px 就退回默认值」的保护 ——
   *      于是棋盘被硬撑到 583px、横向溢出 97px，什么也点不到。
   *      所以手机不是"把格子调小"，而是**换一套结构**（见 game.css 里的说明）。
   *
   *   这里把 iframe 缩到真机尺寸，量四件事：
   *     ① 横向不能溢出（溢出 = 有东西被切掉、点不到）
   *     ② 棋盘、商店、备战池都必须完整落在视口宽度里
   *     ③ 战场画布的宽度 = 布阵盘的宽度（这条不变式在手机上同样成立）
   *     ④ HUD 不能吃掉大半个屏幕
   *   ★ 量完必须把 iframe 恢复到原来的尺寸，并且重新加载 ——
   *     布局一变，棋盘位置和画布尺寸全都会变，后面的用例不能踩在上面继续跑。
   * ============================================================ */
  async function testMobileLayout() {
    TH.section('手机竖屏布局');

    var saved = { w: f.style.width, h: f.style.height };
    /* ★ 尺寸表覆盖三类真机：
         · 常见竖屏（iPhone 11/14、安卓 360~430）
         · 矮屏小机（360×640、320×568）—— 内容比视口高得多，是最难排的一档
         · 横屏手机（844×390）—— 宽而矮，和竖屏是**两种**不同的挤压
       ★ 加尺寸不是凑数：360×640 和 844×390 各暴露过一个竖屏/横屏特有的问题
         （吸底条盖住选中信息 / 盖住棋盘），只测 390×844 是发现不了的。 */
    var SIZES = [
      [390, 844, 'iPhone14 竖'],
      [414, 896, 'iPhone11 竖'],
      [360, 800, '安卓常见 竖'],
      [360, 640, '安卓小屏 竖'],
      [320, 568, 'iPhoneSE 竖'],
      [430, 932, '大屏 竖'],
      [844, 390, 'iPhone14 横']
    ];
    try {
      for (var s = 0; s < SIZES.length; s++) {
        var vw = SIZES[s][0], vh = SIZES[s][1], label = SIZES[s][2];
        f.style.width = vw + 'px';
        f.style.height = vh + 'px';
        /* ★★ 改了尺寸之后必须**重新加载** iframe，不能只改大小等它自己重排。
         *   原因：布阵盘的格子宽度读的是 `--cell-r`，而那一条是 **arena.js 写进去的
         *   整数**（它按当时的视口算一次、取整、写回 CSS）。无头浏览器不驱动 rAF，
         *   被缩放的 iframe 不一定触发一次重算 —— 于是棋盘会**沿用上一档的格子宽度**：
         *   实测同一段代码在不同轮次量到 312 / 272 / 344 三种值，
         *   而"320 宽的手机上棋盘居然 312px 宽"就是这么来的。
         *   重新加载是最省事也最可靠的"按新尺寸重算一次"。 */
        f.src = f.src;
        await wait(700);
        D = f.contentDocument; W = f.contentWindow;
        var body = D.body;
        var over = body.scrollWidth - W.innerWidth;
        TH.ok('★ ' + label + '（' + vw + '×' + vh + '）：横向不溢出',
          over <= 1, over > 1 ? ('溢出 ' + over + 'px') : ('scrollWidth ' + body.scrollWidth));

        // 进人机模式看准备阶段
        D.getElementById('btn-pve').click();
        await wait(220);
        var board = D.querySelector('.board-wrap').getBoundingClientRect();
        var shop = D.querySelector('#shop-row').getBoundingClientRect();
        var cards = D.querySelectorAll('#shop-row .shop-card');
        var bench = D.querySelector('#bench').getBoundingClientRect();
        var slots = D.querySelectorAll('#bench > *');
        var hud = D.querySelector('.hud').getBoundingClientRect();
        var cells = D.querySelectorAll('#player-half .cell');
        var cell0 = cells.length ? cells[0].getBoundingClientRect() : null;

        TH.ok('★ ' + label + '：布阵盘完整落在视口宽度里',
          board.left >= -1 && board.right <= W.innerWidth + 1,
          Math.round(board.left) + ' → ' + Math.round(board.right) +
          '（视口 ' + W.innerWidth + '）');
        TH.ok('★ ' + label + '：5 张商店卡都放得下',
          cards.length === 5 && shop.left >= -1 && shop.right <= W.innerWidth + 1,
          cards.length + ' 张，' + Math.round(shop.left) + ' → ' + Math.round(shop.right));
        TH.ok('★ ' + label + '：9 个备战池格子都放得下',
          slots.length >= 1 && bench.left >= -1 && bench.right <= W.innerWidth + 1,
          slots.length + ' 格，' + Math.round(bench.left) + ' → ' + Math.round(bench.right));
        TH.ok('★ ' + label + '：格子不会被压到 24px 以下（还点得着）',
          cell0 && cell0.width >= 24, cell0 ? (Math.round(cell0.width) + 'px') : '没找到格子');
        TH.ok('★ ' + label + '：HUD 没有吃掉大半个屏幕',
          hud.height <= 80, Math.round(hud.height) + 'px');

        /* ---------- 2026-10 补的四条：手机版真正难用的地方 ----------
         * ★★ 这一组是量出来的，不是猜的。上一版只验了"横向放得下"，
         *    而实测 390×844 的真实问题是**竖向够不着**：
         *      开战按钮 T=919、备战池 T=1026，而视口只有 844 ——
         *      玩家每回合都要先滚动 100~200px 才点得到开战、才够得着备战池。
         *    另外 HUD 里 `.hud-left` 被挤成 6px（「‹」只剩 7px 宽，
         *    关卡名被切到 16px）。所以补上"纵向够得着"和"不被别人盖住"两组。 */

        // ① 开战按钮必须在视口里（这是每回合都要按的那一个）
        var fight = D.getElementById('btn-fight');
        var fightBar = D.querySelector('.action-bar');
        var fbR = fightBar ? fightBar.getBoundingClientRect() : null;
        var btnR = fight ? fight.getBoundingClientRect() : null;
        TH.ok('★ ' + label + '：开战按钮在视口里（不用滚动就能按）',
          !!btnR && btnR.top >= -1 && btnR.bottom <= W.innerHeight + 1,
          btnR ? (Math.round(btnR.top) + ' → ' + Math.round(btnR.bottom) +
                  '（视口高 ' + W.innerHeight + '）') : '没找到开战按钮');

        /* ② 备战池也要基本在第一屏（拖拽就发生在它和棋盘之间）
         * ★ 判据是"**至少 70% 露在外面**"，不是"完整落在视口里" ——
         *   320×568 上它的下沿会超出 6px（那一档内容实在太挤），
         *   而"露 70%"既能抓住最初的 bug（那时备战池在 T=1026、视口 844，
         *   一整块都在屏幕外），也不会为了 6px 去写一个假的通过。
         * ★ 横屏手机不在这条之内：844×390 上内容总高约 800px、视口只有 390px，
         *   备战池不可能在第一屏。那里只保证「开战」够得着（上一条已验），
         *   其余靠滚动 —— 横屏本来就不是这个游戏的主要姿势。 */
        var isLandscape = vw > vh;
        if (isLandscape) {
          TH.note(label + '：横屏，内容总高远超视口，只要求「开战」够得着（已验），' +
            '备战池在 T=' + Math.round(bench.top) + '，滚一下就到');
        } else {
          TH.ok('★ ' + label + '：备战池至少 70% 在第一屏（拖拽不用先滚动）',
            bench.top >= -1 && bench.top + bench.height * 0.7 <= W.innerHeight,
            Math.round(bench.top) + ' → ' + Math.round(bench.bottom) +
            '（视口高 ' + W.innerHeight + '）');
        }

        // ③ 关键区块两两不许重叠（吸底条最容易盖住别人）
        var blocks = {
          商店: shop, 棋盘: board, 备战池: bench,
          选中信息: D.querySelector('#sel-bar') ? D.querySelector('#sel-bar').getBoundingClientRect() : null,
          装备栏: D.querySelector('#item-row') ? D.querySelector('#item-row').getBoundingClientRect() : null,
          开战条: fbR
        };
        var bk = Object.keys(blocks), hits = [];
        for (var x = 0; x < bk.length; x++) {
          for (var y = x + 1; y < bk.length; y++) {
            var A2 = blocks[bk[x]], B2 = blocks[bk[y]];
            if (!A2 || !B2) continue;
            var ox = Math.min(A2.right, B2.right) - Math.max(A2.left, B2.left);
            var oy = Math.min(A2.bottom, B2.bottom) - Math.max(A2.top, B2.top);
            if (ox > 1 && oy > 1) hits.push(bk[x] + '×' + bk[y] + '=' + Math.round(ox * oy));
          }
        }
        TH.eq('★ ' + label + '：关键区块互不遮挡（尤其是吸底的开战条）',
          hits.join(' '), '');

        // ④ 手指点得着：所有按钮的短边 >= 30px
        var smalls = [];
        var allBtns = D.querySelectorAll('button, .btn');
        for (var bi2 = 0; bi2 < allBtns.length; bi2++) {
          var br2 = allBtns[bi2].getBoundingClientRect();
          if (br2.width < 1 || br2.height < 1) continue;
          if (Math.min(br2.width, br2.height) < 30) {
            smalls.push((allBtns[bi2].id || allBtns[bi2].textContent.trim().slice(0, 5)) +
              '=' + Math.round(br2.width) + 'x' + Math.round(br2.height));
          }
        }
        TH.eq('★ ' + label + '：没有点不着的按钮（短边都 >= 30px）',
          smalls.join(' '), '');

        // ⑤ 文字不许被切（唯一允许的是 320px 上那个被省略号处理过的关卡名）
        var clipped2 = [];
        var nodes = D.querySelectorAll('*');
        for (var ni = 0; ni < nodes.length; ni++) {
          var nd = nodes[ni];
          if (nd.children.length) continue;
          var t2 = (nd.textContent || '').trim();
          if (!t2 || nd.clientWidth <= 0) continue;
          if (nd.scrollWidth > nd.clientWidth + 1) {
            clipped2.push((nd.className || nd.tagName) + '「' + t2.slice(0, 10) + '」');
          }
        }
        TH.ok('★ ' + label + '：没有被切掉的文字（320px 上允许关卡名走省略号）',
          clipped2.length === 0 ||
          (clipped2.length === 1 && clipped2[0].indexOf('hud-stage-name') === 0),
          clipped2.join(' | '));

        // 开战，量战场画布
        if (fight) { fight.click(); await wait(320); }
        var cv = D.getElementById('arena');
        var cw = cv ? cv.getBoundingClientRect().width : 0;
        TH.ok('★ ' + label + '：战场画布宽度 = 布阵盘宽度（手机上这条不变式同样成立）',
          cw > 0 && Math.abs(cw - board.width) <= 2,
          '画布 ' + Math.round(cw) + 'px　布阵盘 ' + Math.round(board.width) + 'px');
        TH.ok('★ ' + label + '：画布完整落在视口里',
          !cv || (cv.getBoundingClientRect().left >= -1 &&
                  cv.getBoundingClientRect().right <= W.innerWidth + 1),
          cv ? (Math.round(cv.getBoundingClientRect().left) + ' → ' +
                Math.round(cv.getBoundingClientRect().right)) : '没有画布');
      }
    } finally {
      // ★ 无论如何都要恢复：后面（以及下一次跑）都要按原始尺寸来
      f.style.width = saved.w;
      f.style.height = saved.h;
      await wait(200);
      f.src = f.src;            // 重新加载，让游戏回到全新状态
      await wait(700);
      D = f.contentDocument; W = f.contentWindow;
    }
  }

  /* ============================================================
   * 跑
   * ============================================================ */
  /**
   * ★★ 只允许跑一次。
   *
   *   这个脚本是靠 iframe 的 load 事件启动的，而「手机竖屏布局」那一组
   *   **会主动重新加载这个 iframe**（改尺寸之后必须让 arena.js 按新尺寸重算一次）。
   *   没有这道闸门的话，每 reload 一次就整套用例再跑一遍：
   *   实测断言总数从 394 涨到 2464（跑了 6 遍），
   *   而且后几遍是在"测试自己改过的尺寸"上跑的，全是假失败。
   */
  var booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    W = f.contentWindow;
    D = f.contentDocument;
    W.onerror = function (m, s, l) { errs.push(m + ' @' + l); };
    window.addEventListener('error', function (e) { errs.push('parent: ' + e.message); });

    (async function () {
      try {
        await wait(300);
        await testCover();
        await testAutoUpdate();
        await testSettings();
        await testEnterPve();
        await testLayout();
        await testDrag();
        await testCombatFeel();
        await testSnipeVfx();
        await testBruteVfx();
        await testDuckVfx();
        await testZhangVfx();
        await testMedicVfx();
        await testMikadoVfx();
        await testBatonVfx();
        await testFrostVfx();
        await testDeliveryVfx();
        await testNoodleVfx();
        await testLaughVfx();
        await testDomainVfx();
        await testYangVfx();
        await testFieldVfx();
        await testShadowVfx();
        await testDankVfx();
        await testEndlessVfx();
        await testDamagePanel();
        await testShopAndBoard();
        await testCombineAndItems();
        await testPassiveText();
        await testCombat();
        await testProgression();
        await testFieldLimit();
        await testBackToCover();
        await testMobileLayout();
      } catch (e) {
        TH.fail('测试脚本自身抛异常', (e && e.message ? e.message : String(e)) +
          (e && e.stack ? ' | ' + String(e.stack).split('\n')[1] : ''));
      }
      TH.section('总结');
      TH.ok('全程没有 JS 报错', errs.length === 0, errs.join(' || '));
      TH.note('无头浏览器不驱动 requestAnimationFrame，所以战斗播放用「跳到结算」走完，' +
        '它消费的是同一条事件流，覆盖的代码路径完全一样。');
      TH.render('report');
      TH.writeVerdict();
      var v = document.getElementById('verdict');
      if (v) {
        var c = TH.counts();
        v.className = 'verdict ' + (c.fail === 0 ? 'pass' : 'fail');
        v.textContent = TH.verdict();
      }
    })();
  }

  if (f.contentDocument && f.contentDocument.readyState === 'complete') {
    setTimeout(boot, 60);
  } else {
    f.addEventListener('load', function () { setTimeout(boot, 60); });
  }
})();
