/* ============================================================
 * 科币战争 Kebi Wars — 通用工具 / 种子化随机
 * 零依赖，最先加载。
 *
 * 关键约定：战斗模拟层（battle.js）只允许使用 ST.makeRng() 产出的
 * 随机源，绝对不要用 Math.random()。渲染层随便用 Math.random()。
 * ============================================================ */
(function () {
  'use strict';

  var ST = (window.ST = window.ST || {});
  var TAU = Math.PI * 2;

  /* ---------- 基础数学 ---------- */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function dist(ax, ay, bx, by) { var dx = bx - ax, dy = by - ay; return Math.sqrt(dx * dx + dy * dy); }
  function dist2(ax, ay, bx, by) { var dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; }

  /** 切比雪夫距离：网格上「八方向移动」的真实步数。范围判定用它。 */
  function cheb(ar, ac, br, bc) {
    var dr = ar > br ? ar - br : br - ar;
    var dc = ac > bc ? ac - bc : bc - ac;
    return dr > dc ? dr : dc;
  }
  /** 曼哈顿距离：用来给寻路做「第二关键字」，防止两个单位来回横跳。 */
  function manhattan(ar, ac, br, bc) {
    var dr = ar > br ? ar - br : br - ar;
    var dc = ac > bc ? ac - bc : bc - ac;
    return dr + dc;
  }

  function round1(v) { return Math.round(v * 10) / 10; }
  function round2(v) { return Math.round(v * 100) / 100; }
  /** 千分位，用于报告输出 */
  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function pad(s, n, ch) {
    s = String(s); ch = ch || ' ';
    while (s.length < n) s = ch + s;
    return s;
  }
  function padEnd(s, n, ch) {
    s = String(s); ch = ch || ' ';
    while (s.length < n) s += ch;
    return s;
  }

  /* ---------- 种子化随机（mulberry32） ---------- */

  /**
   * 造一个独立的随机源。同一个 seed 必然产生同一串数。
   * 这是整个项目的命门：战斗必须可复现，否则回放、批量平衡测试、
   * 未来的联机全部报废。
   *
   * @param {number} seed 32 位整数种子
   * @returns {{next:Function,int:Function,range:Function,chance:Function,pick:Function,shuffle:Function,state:Function}}
   */
  function makeRng(seed) {
    var s = (seed >>> 0) || 0x9e3779b9;

    function next() {
      s = s + 0x6d2b79f5 | 0;
      var t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }

    return {
      /** [0, 1) */
      next: next,
      /** [a, b] 闭区间整数 */
      int: function (a, b) { return a + Math.floor(next() * (b - a + 1)); },
      /** [a, b) 浮点 */
      range: function (a, b) { return a + next() * (b - a); },
      chance: function (p) { return next() < p; },
      pick: function (arr) { return arr[Math.floor(next() * arr.length)]; },
      /** 原地洗牌并返回同一个数组 */
      shuffle: function (arr) {
        for (var i = arr.length - 1; i > 0; i--) {
          var j = Math.floor(next() * (i + 1));
          var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
        }
        return arr;
      },
      /** 从数组里取 n 个不重复元素（返回新数组） */
      sample: function (arr, n) {
        var copy = arr.slice();
        for (var i = copy.length - 1; i > 0; i--) {
          var j = Math.floor(next() * (i + 1));
          var t = copy[i]; copy[i] = copy[j]; copy[j] = t;
        }
        return copy.slice(0, n);
      },
      /** 当前内部状态，可用于调试 */
      state: function () { return s; }
    };
  }

  /** 把任意字符串转成 32 位种子（FNV-1a）。想让「阵容字符串」可复现时用它。 */
  function hashSeed(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /* ---------- 无障碍的小工具 ---------- */

  /** 深拷贝纯数据（只用于配置对象，不要喂给战斗运行时状态，会很慢） */
  function clone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) {
      var arr = new Array(obj.length);
      for (var i = 0; i < obj.length; i++) arr[i] = clone(obj[i]);
      return arr;
    }
    var out = {};
    for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = clone(obj[k]);
    return out;
  }

  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a === null || b === null || typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
      return true;
    }
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (var j = 0; j < ka.length; j++) {
      if (!Object.prototype.hasOwnProperty.call(b, ka[j])) return false;
      if (!deepEqual(a[ka[j]], b[ka[j]])) return false;
    }
    return true;
  }

  /** 对象里的数字全部累加；用于合并羁绊/装备的加成 */
  function addMods(target, src, times) {
    times = times === undefined ? 1 : times;
    for (var k in src) {
      if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
      target[k] = (target[k] || 0) + src[k] * times;
    }
    return target;
  }

  ST.U = {
    TAU: TAU,
    clamp: clamp, lerp: lerp, dist: dist, dist2: dist2,
    cheb: cheb, manhattan: manhattan,
    round1: round1, round2: round2, fmt: fmt, pad: pad, padEnd: padEnd,
    clone: clone, deepEqual: deepEqual, addMods: addMods
  };
  ST.makeRng = makeRng;
  ST.hashSeed = hashSeed;
})();
