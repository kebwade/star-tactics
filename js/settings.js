/* ============================================================
 * 科币战争 — 设置
 *
 * 三路音量 + 画面亮度，存 localStorage。
 *
 * 注意 localStorage 在 file:// 下的可用性：Chrome/Edge 允许，但某些配置会抛异常。
 * 所以每一次读写都包了 try/catch，存不上就退化成「这次有效、刷新就丢」，
 * 绝不能因为存不了设置就把游戏搞崩。
 * ============================================================ */
(function () {
  'use strict';

  var UI = window.UI;
  var KEY = 'star-tactics.settings.v1';

  var DEFAULTS = {
    master: 0.75,
    sfx: 0.85,
    music: 0.30,
    brightness: 1.00
  };

  var S = (window.Settings = {});
  S.data = {};
  S.available = true;

  for (var k in DEFAULTS) if (DEFAULTS.hasOwnProperty(k)) S.data[k] = DEFAULTS[k];

  function storageOk() {
    try {
      window.localStorage.setItem('__st_probe__', '1');
      window.localStorage.removeItem('__st_probe__');
      return true;
    } catch (e) { return false; }
  }

  S.load = function () {
    if (!storageOk()) { S.available = false; return S.data; }
    try {
      var raw = window.localStorage.getItem(KEY);
      if (!raw) return S.data;
      var o = JSON.parse(raw);
      for (var key in DEFAULTS) {
        if (!DEFAULTS.hasOwnProperty(key)) continue;
        if (typeof o[key] === 'number' && isFinite(o[key])) S.data[key] = o[key];
      }
    } catch (e) { /* 数据坏了就当没有 */ }
    return S.data;
  };

  S.save = function () {
    if (!S.available) return;
    try { window.localStorage.setItem(KEY, JSON.stringify(S.data)); } catch (e) {}
  };

  S.set = function (key, value) {
    if (!(key in DEFAULTS)) return;
    S.data[key] = value;
    S.apply();
    S.save();
  };

  S.reset = function () {
    for (var key in DEFAULTS) if (DEFAULTS.hasOwnProperty(key)) S.data[key] = DEFAULTS[key];
    S.apply();
    S.save();
  };

  /** 把设置真正作用到声音和画面上 */
  S.apply = function () {
    if (window.UI && UI.sound) {
      UI.sound.setVolume('master', S.data.master);
      UI.sound.setVolume('sfx', S.data.sfx);
      UI.sound.setVolume('music', S.data.music);
    }
    var app = document.getElementById('app');
    if (app) {
      // brightness 用 CSS filter 实现。区间 0.55~1.35，
      // 上限不放到更高是因为再亮整块深色界面就糊成一片了。
      var b = Math.max(0.55, Math.min(1.35, S.data.brightness));
      app.style.filter = b === 1 ? '' : 'brightness(' + b.toFixed(3) + ')';
    }
  };

  /* ============================================================
   * 设置面板
   * ============================================================ */
  var SLIDERS = [
    { key: 'master', label: '总音量', icon: '🔊', min: 0, max: 1 },
    { key: 'sfx', label: '音效', icon: '⚔️', min: 0, max: 1 },
    { key: 'music', label: '背景音乐', icon: '🎵', min: 0, max: 1 },
    { key: 'brightness', label: '画面亮度', icon: '☀️', min: 0.55, max: 1.35 }
  ];

  /**
   * 往容器里渲染设置面板。返回一个 refresh() 用于外部重新同步。
   */
  S.renderPanel = function (host) {
    host.innerHTML = '';
    var rows = [];

    for (var i = 0; i < SLIDERS.length; i++) {
      (function (cfg) {
        var row = UI.el('div', 'set-row');
        row.appendChild(UI.el('span', 'set-icon', cfg.icon));
        row.appendChild(UI.el('span', 'set-label', cfg.label));

        var range = document.createElement('input');
        range.type = 'range';
        range.min = String(cfg.min);
        range.max = String(cfg.max);
        range.step = '0.01';
        range.value = String(S.data[cfg.key]);
        range.className = 'set-range';

        var pct = UI.el('span', 'set-pct', '');

        function paint() {
          var v = parseFloat(range.value);
          var p = Math.round((v - cfg.min) / (cfg.max - cfg.min) * 100);
          range.style.setProperty('--fill', p + '%');
          pct.textContent = Math.round(v * 100) + '%';
        }
        paint();

        var lastSound = 0;
        range.oninput = function () {
          S.set(cfg.key, parseFloat(range.value));
          paint();
          // 拖音量条时给个反馈音，不然不知道调到哪了。拖动过程中节流。
          if (cfg.key !== 'brightness') {
            var now = Date.now();
            if (now - lastSound > 90) {
              lastSound = now;
              UI.sound.click();
            }
          }
        };

        row.appendChild(range);
        row.appendChild(pct);
        host.appendChild(row);
        rows.push({ cfg: cfg, range: range, paint: paint });
      })(SLIDERS[i]);
    }

    var foot = UI.el('div', 'set-foot');
    var reset = UI.el('button', 'btn btn-ghost', '恢复默认');
    reset.onclick = function () {
      UI.sound.click();
      S.reset();
      sync();
      UI.toast('设置已恢复默认', 'info');
    };
    foot.appendChild(reset);

    var musicBtn = UI.el('button', 'btn btn-ghost', UI.sound.musicPlaying() ? '■ 停止音乐' : '▶ 试听音乐');
    musicBtn.onclick = function () {
      UI.sound.click();
      if (UI.sound.musicPlaying()) UI.sound.musicStop();
      else UI.sound.musicStart();
      musicBtn.textContent = UI.sound.musicPlaying() ? '■ 停止音乐' : '▶ 试听音乐';
    };
    foot.appendChild(musicBtn);
    host.appendChild(foot);

    function sync() {
      for (var j = 0; j < rows.length; j++) {
        rows[j].range.value = String(S.data[rows[j].cfg.key]);
        rows[j].paint();
      }
      musicBtn.textContent = UI.sound.musicPlaying() ? '■ 停止音乐' : '▶ 试听音乐';
    }

    return { sync: sync };
  };

  /** 以弹窗形式打开设置 */
  S.openModal = function () {
    var body = UI.el('div', 'settings-panel');
    var panel = S.renderPanel(body);
    UI.modal({
      title: '设置',
      body: body,
      actions: [{ label: '完成', kind: 'primary' }]
    });
    return panel;
  };

  S.load();
})();
