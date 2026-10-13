/* ============================================================
 * 科币战争 — 界面基础层
 *
 * 管四件事，游戏逻辑一律不碰这些：
 *   1. 场景切换（带淡入淡出，不会「啪」地跳过去）
 *   2. Toast 提示 / 通用弹窗
 *   3. 黑场过渡
 *   4. 音效引擎（WebAudio 现场合成，不需要任何音频文件）
 *
 * 为什么音效要现场合成：这个项目是零依赖、双击即玩的。
 * 一旦引入 .mp3，就得处理加载、解码、跨域、file:// 限制。
 * 用振荡器合成反而更简单也更可靠。
 * ============================================================ */
(function () {
  'use strict';

  var UI = (window.UI = {});

  /* ============================================================
   * 一、场景
   * ============================================================ */
  var scenes = {};
  var current = null;
  var busy = false;

  /**
   * 注册一个场景。
   * @param {string} id
   * @param {Object} def { el: 元素或 id, enter(data), leave() }
   */
  UI.scene = function (id, def) {
    var el = typeof def.el === 'string' ? document.getElementById(def.el) : def.el;
    scenes[id] = { id: id, el: el, enter: def.enter, leave: def.leave, data: null };
    return scenes[id];
  };

  UI.current = function () { return current ? current.id : null; };
  UI.isBusy = function () { return busy; };

  /**
   * 切到某个场景。先把旧场景淡出，再淡入新场景 ——
   * 直接 display:none / block 切换会让界面「跳」，这是最廉价也最明显的「像不像游戏」的分界。
   */
  UI.show = function (id, data, opts) {
    opts = opts || {};
    var next = scenes[id];
    if (!next) { console.warn('没有这个场景: ' + id); return; }

    var dur = opts.dur === undefined ? 220 : opts.dur;
    var prev = current;

    if (prev === next && !opts.force) {
      next.data = data;
      if (next.enter) next.enter(data);
      return;
    }

    if (prev && prev.leave) prev.leave();

    function activate() {
      for (var k in scenes) {
        if (!scenes.hasOwnProperty(k)) continue;
        scenes[k].el.classList.toggle('scene-on', scenes[k] === next);
      }
      current = next;
      next.data = data;
      if (next.enter) next.enter(data);
      // 触发淡入
      next.el.classList.remove('scene-in');
      void next.el.offsetWidth;              // 强制重排，让动画能重放
      next.el.classList.add('scene-in');
      busy = false;
    }

    busy = true;
    if (prev && dur > 0) {
      prev.el.classList.add('scene-out');
      setTimeout(function () {
        prev.el.classList.remove('scene-out');
        activate();
      }, dur);
    } else {
      activate();
    }
  };

  /** 黑场过渡：适合「进入战斗」「进入下一关」这种需要换气的地方 */
  UI.transition = function (mid, opts) {
    opts = opts || {};
    var veil = document.getElementById('veil');
    if (!veil) { if (mid) mid(); return; }
    var label = document.getElementById('veil-label');
    if (label) label.textContent = opts.label || '';

    veil.classList.add('veil-on');
    setTimeout(function () {
      if (mid) mid();
      setTimeout(function () {
        veil.classList.remove('veil-on');
      }, opts.hold === undefined ? 260 : opts.hold);
    }, opts.fade === undefined ? 280 : opts.fade);
  };

  /* ============================================================
   * 二、Toast / 弹窗
   * ============================================================ */
  var toastHost = null;

  UI.toast = function (msg, kind) {
    if (!toastHost) {
      toastHost = document.createElement('div');
      toastHost.id = 'toasts';
      document.body.appendChild(toastHost);
    }
    var t = document.createElement('div');
    t.className = 'toast' + (kind ? ' t-' + kind : '');
    t.textContent = msg;
    toastHost.appendChild(t);
    void t.offsetWidth;
    t.classList.add('toast-on');
    setTimeout(function () {
      t.classList.remove('toast-on');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320);
    }, 1800);
    // 最多同时显示 4 条
    while (toastHost.children.length > 4) toastHost.removeChild(toastHost.firstChild);
  };

  /**
   * 通用弹窗。
   * @param {Object} o { title, body(HTML字符串或元素), actions:[{label, kind, onClick}], dismissible }
   */
  UI.modal = function (o) {
    UI.closeModal();
    var wrap = document.createElement('div');
    wrap.id = 'modal-wrap';
    wrap.className = 'modal-wrap';

    var box = document.createElement('div');
    box.className = 'modal' + (o.wide ? ' modal-wide' : '');

    if (o.title) {
      var h = document.createElement('h3');
      h.className = 'modal-title';
      h.textContent = o.title;
      box.appendChild(h);
    }
    if (o.body) {
      var b = document.createElement('div');
      b.className = 'modal-body';
      if (typeof o.body === 'string') b.innerHTML = o.body;
      else b.appendChild(o.body);
      box.appendChild(b);
    }
    var acts = document.createElement('div');
    acts.className = 'modal-acts';
    var list = o.actions || [{ label: '知道了' }];
    for (var i = 0; i < list.length; i++) {
      (function (a) {
        var btn = document.createElement('button');
        btn.className = 'btn' + (a.kind ? ' btn-' + a.kind : '');
        btn.textContent = a.label;
        btn.onclick = function () {
          UI.sound.click();
          if (!a.keepOpen) UI.closeModal();
          if (a.onClick) a.onClick();
        };
        acts.appendChild(btn);
      })(list[i]);
    }
    box.appendChild(acts);

    wrap.appendChild(box);
    document.body.appendChild(wrap);
    void wrap.offsetWidth;
    wrap.classList.add('modal-on');

    if (o.dismissible !== false) {
      wrap.onclick = function (ev) { if (ev.target === wrap) UI.closeModal(); };
    }
    return box;
  };

  UI.closeModal = function () {
    var w = document.getElementById('modal-wrap');
    if (!w) return;
    w.classList.remove('modal-on');
    setTimeout(function () { if (w.parentNode) w.parentNode.removeChild(w); }, 200);
  };

  UI.hasModal = function () { return !!document.getElementById('modal-wrap'); };

  /* ============================================================
   * 三、音效引擎
   *
   * 全部现场合成。任何一步失败都不抛异常 —— 没声音顶多是不好听，
   * 绝不能因为浏览器不支持就把游戏搞崩。
   * ============================================================ */
  var S = (UI.sound = {});

  var actx = null, masterGain = null, sfxGain = null, musicGain = null;
  var vol = { master: 0.7, sfx: 0.8, music: 0.3 };
  var lastHit = 0;
  var synthTimer = 0, musicStep = 0;

  function ensure() {
    try {
      if (!actx) {
        var Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return null;
        actx = new Ctor();
        masterGain = actx.createGain();
        sfxGain = actx.createGain();
        musicGain = actx.createGain();
        sfxGain.connect(masterGain);
        musicGain.connect(masterGain);
        masterGain.connect(actx.destination);
        applyVol();
      }
      if (actx.state === 'suspended') actx.resume();
      return actx;
    } catch (e) { actx = null; return null; }
  }

  function applyVol() {
    if (!masterGain) return;
    try {
      masterGain.gain.value = vol.master;
      sfxGain.gain.value = vol.sfx;
      musicGain.gain.value = vol.music * 0.5;
    } catch (e) {}
  }

  S.setVolume = function (key, v) {
    vol[key] = Math.max(0, Math.min(1, v));
    applyVol();
    // 背景音乐走的是 <audio>，不经过 WebAudio 的 masterGain，
    // 所以音量变化要单独同步给它一次。
    if (bgmEl) bgmEl.volume = bgmVolume();
    // 拖着音乐条从 0 往上拉时，如果之前因为"音乐音量为 0"没启动过，顺手启动
    if (key === "music" && musicOn && vol.music > 0.001) bgmPlay();
  };
  S.getVolume = function (key) { return vol[key]; };

  /**
   * 弹一个音。
   * @param {Object} o {f0, f1, dur, type, vol, bus, delay}
   */
  function tone(o) {
    var a = ensure();
    if (!a) return;
    try {
      var t0 = a.currentTime + (o.delay || 0);
      var osc = a.createOscillator();
      var g = a.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(o.f0, t0);
      if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t0 + o.dur);
      var peak = Math.max(0.0002, o.vol === undefined ? 0.18 : o.vol);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.012, o.dur * 0.3));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
      osc.connect(g);
      g.connect(o.bus === 'music' ? musicGain : sfxGain);
      osc.start(t0);
      osc.stop(t0 + o.dur + 0.03);
    } catch (e) {}
  }

  /** 噪声（打击感用） */
  function noise(o) {
    var a = ensure();
    if (!a) return;
    try {
      var dur = o.dur || 0.08;
      var len = Math.max(1, Math.floor(a.sampleRate * dur));
      var buf = a.createBuffer(1, len, a.sampleRate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
      }
      var src = a.createBufferSource();
      src.buffer = buf;
      var g = a.createGain();
      g.gain.value = o.vol === undefined ? 0.14 : o.vol;
      var f = a.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = o.hz || 900;
      f.Q.value = 0.8;
      src.connect(f); f.connect(g); g.connect(sfxGain);
      src.start();
    } catch (e) {}
  }

  S.click = function () { tone({ f0: 620, f1: 880, dur: 0.055, type: 'triangle', vol: 0.13 }); };
  S.hover = function () { tone({ f0: 900, dur: 0.03, type: 'sine', vol: 0.05 }); };
  S.buy = function () {
    tone({ f0: 740, f1: 1180, dur: 0.11, type: 'triangle', vol: 0.16 });
    tone({ f0: 1180, dur: 0.09, type: 'sine', vol: 0.1, delay: 0.06 });
  };
  S.sell = function () { tone({ f0: 520, f1: 260, dur: 0.14, type: 'triangle', vol: 0.14 }); };
  S.place = function () { tone({ f0: 380, f1: 520, dur: 0.08, type: 'square', vol: 0.09 }); };
  S.deny = function () { tone({ f0: 220, f1: 150, dur: 0.16, type: 'sawtooth', vol: 0.11 }); };
  S.star = function () {
    tone({ f0: 880, dur: 0.09, type: 'triangle', vol: 0.15 });
    tone({ f0: 1180, dur: 0.09, type: 'triangle', vol: 0.15, delay: 0.08 });
    tone({ f0: 1560, dur: 0.16, type: 'triangle', vol: 0.15, delay: 0.16 });
  };
  S.levelup = function () {
    tone({ f0: 660, dur: 0.1, type: 'sine', vol: 0.16 });
    tone({ f0: 990, dur: 0.18, type: 'sine', vol: 0.16, delay: 0.1 });
  };
  S.win = function () {
    var n = [523, 659, 784, 1046];
    for (var i = 0; i < n.length; i++) {
      tone({ f0: n[i], dur: i === n.length - 1 ? 0.4 : 0.14, type: 'triangle', vol: 0.17, delay: i * 0.11 });
    }
  };
  S.lose = function () {
    var n = [440, 370, 294, 220];
    for (var i = 0; i < n.length; i++) {
      tone({ f0: n[i], dur: i === n.length - 1 ? 0.5 : 0.18, type: 'sine', vol: 0.16, delay: i * 0.15 });
    }
  };
  S.reveal = function () {
    tone({ f0: 180, f1: 700, dur: 0.35, type: 'sawtooth', vol: 0.1 });
    noise({ dur: 0.3, hz: 500, vol: 0.07 });
  };
  /** 战斗打击音。节流到每秒最多 9 次，否则会糊成一片噪音。 */
  S.hit = function (strong) {
    var now = Date.now();
    if (now - lastHit < 110) return;
    lastHit = now;
    noise({ dur: strong ? 0.1 : 0.055, hz: strong ? 420 : 1100, vol: strong ? 0.11 : 0.06 });
    if (strong) tone({ f0: 160, f1: 80, dur: 0.12, type: 'square', vol: 0.07 });
  };

  /* ============================================================
   * 背景音乐
   *
   * ★ 2026-10：从「现场合成」换成**外部音频循环** audio/bgm.m4a
   *   （user 提供的视频里那条音轨，约 16 秒，循环播放）。
   *   下面那段五声音阶琶音**保留**，但只在音频文件读不出来时兜底。
   *
   * 几个必须照顾到的点：
   *   · 不走 WebAudio 的 createMediaElementSource：本作是双击 index.html
   *     用 file:// 打开的，file:// 下的媒体会被当成跨域，接进 WebAudio 会
   *     **直接静音**（表现是"进度在动但没声"，非常难查）。所以直接播
   *     <audio>，音量用 el.volume 控制。
   *   · 浏览器不允许自动播放有声媒体：第一次点击/按键时才 play()，
   *     被拒绝也不报错，下次交互再补一次。
   *   · play() 在部分浏览器返回 Promise，被策略挡下会 reject ——
   *     必须显式 catch，否则控制台一片红。
   * ============================================================ */
  var BGM_SRC = "audio/bgm.m4a";
  var bgmEl = null;       // <audio> 元素（懒创建）
  var bgmDead = false;    // 文件确认不可用，不再重试
  var musicOn = false;    // "想要音乐"这个意图（不代表此刻真的在响）

  /**
   * 音乐音量 = 总音量 × 音乐音量。
   * 再乘 2 是因为音乐文件本身已经是成品的响度，而默认设置是
   * 总 0.75 × 音乐 0.30 —— 直接相乘只有 0.22 偏小；乘 2 之后是 0.45，
   * 正好是"听得见但不抢戏"的伴奏音量。
   */
  function bgmVolume() {
    return Math.max(0, Math.min(1, vol.master * vol.music * 2));
  }

  function bgmEnsure() {
    if (bgmEl || bgmDead) return bgmEl;
    try {
      var el = document.createElement("audio");
      el.src = BGM_SRC;
      el.loop = true;                 // ★ 循环
      el.preload = "auto";
      el.volume = bgmVolume();
      el.setAttribute("playsinline", "");
      el.style.display = "none";
      // 只有真的解码不出来才判死刑（加载慢不算）
      el.addEventListener("error", function () {
        bgmDead = true; bgmEl = null;
        if (musicOn) synthStart();    // 文件没了 → 退回合成音乐
      });
      document.body.appendChild(el);
      try { el.load(); } catch (e2) {}
      bgmEl = el;
      return el;
    } catch (e) {
      bgmDead = true; bgmEl = null;
      return null;
    }
  }

  function bgmPlay() {
    var el = bgmEnsure();
    if (!el) { synthStart(); return; }
    el.volume = bgmVolume();
    if (!el.paused) return;
    try {
      var pr = el.play();
      if (pr && pr.catch) pr.catch(function () { /* 等下一次用户交互 */ });
    } catch (e) {}
  }

  S.musicStart = function () {
    musicOn = true;
    bgmPlay();
  };

  S.musicStop = function () {
    musicOn = false;
    synthStop();
    if (bgmEl) { try { bgmEl.pause(); bgmEl.currentTime = 0; } catch (e) {} }
  };

  S.musicPlaying = function () { return musicOn; };

  /* ---------- 兜底：一段慢速五声音阶琶音，循环 ---------- */
  var SCALE = [220, 261.6, 293.7, 349.2, 392, 440, 523.3];
  var PATTERN = [0, 2, 4, 2, 5, 4, 2, 1, 0, 2, 3, 4];

  function synthStart() {
    if (synthTimer || bgmEl) return;   // 音频文件能用就不合成
    if (!ensure()) return;
    musicStep = 0;
    synthTimer = setInterval(function () {
      if (vol.music <= 0.001 || !musicGain) return;
      var n = SCALE[PATTERN[musicStep % PATTERN.length]];
      tone({ f0: n, dur: 1.6, type: "sine", vol: 0.075, bus: "music" });
      // 每 4 拍加一个低音
      if (musicStep % 4 === 0) {
        tone({ f0: n / 2, dur: 2.2, type: "triangle", vol: 0.055, bus: "music" });
      }
      musicStep++;
    }, 620);
  }

  function synthStop() {
    if (synthTimer) { clearInterval(synthTimer); synthTimer = 0; }
  }

  /* 第一次用户交互时解锁音频（浏览器自动播放策略） */
  UI.unlockAudio = function () {
    ensure();
    // 浏览器规定"先有用户交互才准出声"：第一次点击时把背景音乐补上
    if (musicOn) bgmPlay();
    document.removeEventListener("pointerdown", UI.unlockAudio);
    document.removeEventListener("keydown", UI.unlockAudio);
  };
  document.addEventListener('pointerdown', UI.unlockAudio);
  document.addEventListener('keydown', UI.unlockAudio);

  /* ============================================================
   * 四、小工具
   * ============================================================ */
  UI.el = function (tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  UI.esc = function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };

  /** 生成卡片的渐变配色（按棋子主色，做出「卡牌」的层次） */
  UI.cardGradient = function (color) {
    return 'linear-gradient(165deg, ' + color + ' 0%, ' + shade(color, -0.42) + ' 100%)';
  };

  function shade(hex, amt) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
    function f(v) { return Math.max(0, Math.min(255, Math.round(v + 255 * amt))); }
    return '#' + [f(r), f(g), f(b)].map(function (v) {
      var s = v.toString(16);
      return s.length < 2 ? '0' + s : s;
    }).join('');
  }
  UI.shade = shade;
})();
