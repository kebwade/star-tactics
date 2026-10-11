/* ============================================================
 * 科币战争 — 封面 / 开始界面
 *
 * 三个入口：人机模式、对战模式（锁着）、设置。
 * 顺带把「上次打到第几关」摆出来，让玩家一进来就知道自己走到哪了。
 * ============================================================ */
(function () {
  'use strict';

  var UI = window.UI;
  var ST = window.ST;

  var Cover = (window.Cover = {});
  var handlers = {};

  var PROGRESS_KEY = 'star-tactics.progress.v1';

  function loadProgress() {
    try {
      var raw = window.localStorage.getItem(PROGRESS_KEY);
      return raw ? (JSON.parse(raw) || {}) : {};
    } catch (e) { return {}; }
  }
  Cover.loadProgress = loadProgress;

  Cover.saveProgress = function (patch) {
    var cur = loadProgress();
    for (var k in patch) if (patch.hasOwnProperty(k)) cur[k] = patch[k];
    try { window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(cur)); } catch (e) {}
    return cur;
  };

  /* ---------- 背景：飘浮的棋子，纯 CSS 动画 ---------- */
  function buildBg(host) {
    host.innerHTML = '';
    // 用固定序列而不是随机，保证每次打开封面长得一样（也方便截图比对）
    var seq = [0, 5, 12, 3, 20, 8, 15, 1, 23, 9, 17, 6, 14, 21];
    for (var i = 0; i < seq.length; i++) {
      var u = ST.UNITS[seq[i] % ST.UNITS.length];
      var s = UI.el('span', 'float-unit', u.emoji);
      var size = 20 + (i % 4) * 10;
      s.style.left = (4 + (i * 7) % 92) + '%';
      s.style.fontSize = size + 'px';
      s.style.animationDelay = (-(i * 1.7)).toFixed(1) + 's';
      s.style.animationDuration = (17 + (i % 5) * 4) + 's';
      // 浅色背景上要压得比深色更淡，否则会显得脏
      s.style.opacity = String(0.07 + (i % 3) * 0.035);
      host.appendChild(s);
    }
  }

  /* ---------- 进度 ---------- */
  /**
   * 把存档里的关卡序号翻译成人话。
   *
   * ★ 序号 > LEVELS.length 就说明那一局已经进了无尽模式。
   *   不能直接显示「第 30 关 · 巴巴博弈」—— 主线只有 24 关，
   *   那个写法会让人以为还有第 30 关的剧情。
   */
  function stageText(n, short) {
    if (n > ST.LEVELS.length) {
      return (short ? '' : '无尽模式 · ') + '第 ' + (n - ST.LEVELS.length) + ' 波';
    }
    var L = ST.LEVELS[Math.max(0, n - 1)];
    return (short ? '第 ' + n + ' 关' : '第 ' + n + ' 关 · ' + L.name);
  }

  function renderProgress() {
    var host = document.getElementById('cover-progress');
    if (!host) return;
    var p = loadProgress();
    host.innerHTML = '';

    if (!p.level && !p.victories && !p.bestLevel) {
      host.appendChild(UI.el('span', 'note', '还没有挑战记录。点「人机模式」开始第一局。'));
      return;
    }

    var chips = [];
    if (p.victories) chips.push(['🏆', '通关次数', p.victories]);
    if (p.bestLevel) chips.push(['🚩', '最远打到', stageText(p.bestLevel)]);
    if (p.lastRunLevel) chips.push(['⏱️', '上次一局', '止步' + stageText(p.lastRunLevel, true)]);

    for (var i = 0; i < chips.length; i++) {
      var c = UI.el('div', 'prog-chip');
      c.appendChild(UI.el('span', 'pc-icon', chips[i][0]));
      c.appendChild(UI.el('span', 'pc-label', chips[i][1]));
      c.appendChild(UI.el('span', 'pc-value', String(chips[i][2])));
      host.appendChild(c);
    }
  }
  Cover.renderProgress = renderProgress;

  /* ---------- 初始化 ---------- */
  Cover.init = function (opts) {
    handlers = opts || {};

    buildBg(document.getElementById('cover-bg'));
    renderProgress();

    var pve = document.getElementById('btn-pve');
    var pvp = document.getElementById('btn-pvp');
    var set = document.getElementById('btn-settings');

    if (pve) {
      pve.onclick = function () {
        UI.sound.click();
        if (handlers.onPve) handlers.onPve();
      };
    }

    // 对战模式要做成「看得见、点得动、但点了告诉你没开」。
    // 所以不能用 disabled 属性 —— 被禁用的按钮根本不会触发 click 事件，
    // 玩家会以为界面坏了。这里改用样式 + aria 表达「不可用」，点击照常处理。
    if (pvp) {
      pvp.removeAttribute('disabled');
      pvp.setAttribute('aria-disabled', 'true');
      pvp.title = '暂未开放';
      pvp.onclick = function () {
        UI.sound.deny();
        UI.toast('对战模式暂未开放', 'warn');
        if (handlers.onPvp) handlers.onPvp();
      };
    }

    if (set) {
      set.onclick = function () {
        UI.sound.click();
        window.Settings.openModal();
      };
    }
  };

  /** 从游戏里退回封面 */
  Cover.show = function () {
    UI.show('scene-cover');
    renderProgress();
  };
})();
