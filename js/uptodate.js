/* ============================================================
 * 自动更新 —— 让"页面已经开着"的人也能立刻拿到最新版
 *
 * ★★ 为什么必须有它，而不是"让别人自己刷新一下"：
 *   GitHub Pages 给 HTML 的缓存默认是 **max-age=600（10 分钟）**，
 *   浏览器还会再缓存一层。部署脚本虽然给每个 js/css 都盖了 `?v=版本号`
 *   （新 URL = 新的缓存条目，新访客立刻就是新版），
 *   但**已经打开着页面的那个人**不会自己去刷新 —— 手机上尤其明显：
 *   切走再切回来，还是那个旧页面。
 *
 * ★ 做法（三步，缺一不可）：
 *   ① 部署脚本把当前版本号写进 `<meta name="app-version">`，
 *      并额外产出一个 `version.json`；
 *   ② 这个脚本定时去取 `version.json` —— **带时间戳 + no-store**，
 *      绕过 CDN 和浏览器的所有缓存；
 *   ③ 版本号变了就**导航到 `?v=新版本号`**。
 *      ★ 这一步是关键：不能只 `location.reload()` ——
 *        那样很可能又吃到那份被缓存住的 index.html（还是旧版）。
 *        换成一个没见过的 URL，才能保证拿到新的 HTML 和新的资源。
 *
 * ★ 刻意不做的两件事：
 *   · 本地双击打开（`file://`）不检查 —— 那里没有"线上版本"，
 *     而且 fetch 会被 CORS 挡掉，只会白报错；
 *   · 没盖章（meta 为空）就不检查 —— 也就是说没部署过的副本永远安静，
 *     开发的时候不会莫名其妙自己刷新。
 *
 * ★ 正在打的时候不打断：战斗中只提示，等战斗结束（场景切走）再自动更新。
 * ============================================================ */
(function () {
  'use strict';

  // 本地文件、或者没被部署脚本盖过章的副本：什么都不做
  if (location.protocol === 'file:') return;
  var meta = document.querySelector('meta[name="app-version"]');
  var mine = meta ? (meta.getAttribute('content') || '') : '';
  if (!mine) return;

  var CHECK_MS = 60000;      // 开着页面时每分钟看一次
  var pending = '';          // 检测到的新版本（战斗中先记下来）
  var notifying = false;

  function inCombat() {
    try {
      return !!(window.UI && UI.current && UI.current() === 'scene-combat');
    } catch (e) {
      return false;          // 读不到就当"没在打"，宁可更新也不要卡住
    }
  }

  function reloadTo(v) {
    /* ★ 用新 URL 而不是 reload()：见文件头的说明。 */
    var next = location.pathname + '?v=' + encodeURIComponent(v) + location.hash;
    window.location.replace(next);
  }

  function notify() {
    if (notifying) return;
    notifying = true;
    var msg = inCombat() ? '🔄 有新版本，打完这局自动更新' : '🔄 发现新版本，正在更新…';
    try {
      if (window.UI && UI.toast) UI.toast(msg, 'star');
    } catch (e) {}
    if (!inCombat()) {
      // 留一点时间让提示被看见，再换页
      setTimeout(function () { reloadTo(pending); }, 1200);
    }
  }

  function check() {
    var url = 'version.json?t=' + Date.now();
    fetch(url, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.v || j.v === mine) return;
        pending = j.v;
        notify();
      })
      .catch(function () { /* 离线 / 还没部署过 / 网络抖：安静地算了 */ });
  }

  function tick() {
    /* 战斗结束后把欠下的那次更新补上 */
    if (pending && !inCombat()) { reloadTo(pending); return; }
    check();
  }

  // 开页 1.5 秒后先查一次 —— 新访客拿到被缓存的旧 HTML 时，1.5 秒内就会自动纠正
  setTimeout(tick, 1500);
  setInterval(tick, CHECK_MS);

  /* ★ 从后台切回来立刻查一次：手机上的常态是"切走放到一边、过一会儿再切回来"，
     而 setInterval 在后台会被浏览器降频甚至冻结，所以这一条不能省。 */
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) tick();
  });
})();
