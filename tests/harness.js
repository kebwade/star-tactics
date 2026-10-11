/* ============================================================
 * 科币战争 — 极简自检框架
 *
 * 为什么不用现成的测试库：这个项目零依赖、双击即玩。
 * 打开 html 就能跑，报告直接写在页面里。
 *
 * 用法：
 *   TH.section('分组名');
 *   TH.ok('某件事成立', cond, '失败时想看到的细节');
 *   TH.eq('相等', actual, expected);
 *   TH.near('近似相等', actual, expected, 容差);
 *   TH.render('report');     // 把报告写进某个元素
 *   TH.verdict();            // "PASS 42 / FAIL 0"
 * ============================================================ */
(function () {
  'use strict';

  var TH = (window.TH = {});
  var rows = [];
  var current = '';

  function push(r) { rows.push(r); return r; }

  TH.section = function (title) {
    current = title;
    push({ kind: 'section', name: title });
  };

  TH.note = function (text) {
    push({ kind: 'note', name: String(text) });
  };

  TH.ok = function (name, cond, detail) {
    return push({
      kind: 'case', section: current, name: name, pass: !!cond,
      detail: detail === undefined ? '' : String(detail)
    });
  };

  /** 自带的深比较。
   *  刻意不依赖被测代码（早期版本用了 ST.U.deepEqual，结果集成测试的页面
   *  没有加载 util.js，断言框架自己先崩了 —— 测试工具不该依赖被测对象）。 */
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
  TH.deepEqual = deepEqual;

  TH.eq = function (name, actual, expected) {
    var same = deepEqual(actual, expected);
    return push({
      kind: 'case', section: current, name: name, pass: same,
      detail: same ? '' : ('期望 ' + brief(expected) + '，实际 ' + brief(actual))
    });
  };

  TH.near = function (name, actual, expected, tol) {
    tol = tol === undefined ? 0.01 : tol;
    var good = typeof actual === 'number' && isFinite(actual) && Math.abs(actual - expected) <= tol;
    return push({
      kind: 'case', section: current, name: name, pass: good,
      detail: good ? '' : ('期望 ' + expected + '±' + tol + '，实际 ' + actual)
    });
  };

  TH.fail = function (name, detail) {
    return push({ kind: 'case', section: current, name: name, pass: false, detail: String(detail || '') });
  };

  function brief(v) {
    var s;
    try { s = JSON.stringify(v); } catch (e) { s = String(v); }
    if (s === undefined) s = String(v);
    return s.length > 160 ? s.slice(0, 160) + '…' : s;
  }
  TH.brief = brief;

  TH.results = function () { return rows; };

  TH.counts = function () {
    var pass = 0, fail = 0;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].kind !== 'case') continue;
      if (rows[i].pass) pass++; else fail++;
    }
    return { pass: pass, fail: fail, total: pass + fail };
  };

  TH.verdict = function () {
    var c = TH.counts();
    return (c.fail === 0 ? 'ALL PASS' : 'FAILED') + ' — PASS ' + c.pass + ' / FAIL ' + c.fail;
  };

  /** 把报告渲染成纯文本写进元素（方便无头浏览器 dump 出来看） */
  TH.render = function (elId) {
    var el = typeof elId === 'string' ? document.getElementById(elId) : elId;
    var lines = [];
    var c = TH.counts();
    lines.push('========================================');
    lines.push('  科币战争 自检报告');
    lines.push('========================================');
    var lastSection = null;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.kind === 'section') {
        lines.push('');
        lines.push('── ' + r.name + ' ' + repeat('─', Math.max(0, 34 - r.name.length)));
        lastSection = r.name;
      } else if (r.kind === 'note') {
        lines.push('  ·  ' + r.name);
      } else {
        lines.push((r.pass ? '  PASS  ' : '  FAIL  ') + r.name + (r.detail ? ('\n          → ' + r.detail) : ''));
      }
    }
    lines.push('');
    lines.push('----------------------------------------');
    lines.push('  合计 ' + c.total + ' 项：PASS ' + c.pass + ' / FAIL ' + c.fail);
    lines.push('  结论：' + TH.verdict());
    lines.push('----------------------------------------');
    if (el) el.textContent = lines.join('\n');
    return lines.join('\n');
  };

  function repeat(ch, n) {
    var s = '';
    for (var i = 0; i < n; i++) s += ch;
    return s;
  }

  /**
   * 无头浏览器靠这个判断成败。
   * 必须写进一个「没人会覆盖」的元素里 —— 如果在可见的 verdict 元素上写，
   * 页面末尾那段美化样式的脚本会把它冲掉，命令行就抓不到了。
   */
  TH.writeVerdict = function (elId) {
    var el = document.getElementById(elId || 'verdict-marker');
    if (el) el.textContent = '###VERDICT### ' + TH.verdict();
  };
})();
