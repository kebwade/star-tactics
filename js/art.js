/* ============================================================
 * 科币战争 · 棋子立绘接口
 *
 * 你只需要把图片按文件名丢进 art/ 目录，游戏会自动用上：
 *     art/bowman.png      对应荣誉
 *     art/titan.png       对应钟离
 *     ...
 * 文件名 = 棋子的 id（下面 ART.ids() 能打印出全部 24 个）。
 *
 * 找不到图片时**不会留空**：界面会退回「按棋子主色生成的渐变 + emoji」，
 * 所以你可以一张一张慢慢补，任何时候都不会出现破图。
 *
 * 建议规格：
 *   · PNG，透明背景
 *   · 正方形，512×512 或 768×768
 *   · 内容尽量铺满画面（卡面里显示的区域是正方形，会被等比裁切）
 * ============================================================ */
(function () {
  'use strict';

  var ST = window.ST;
  var ART = (window.ART = {});

  var DIR = 'art/';
  var ITEM_DIR = 'art/items/';
  var cache = {};      // defId -> { status:'loading'|'ok'|'missing', img:Image, waiters:[], attempt:N }
  var itemCache = {};  // 装备 id -> 同上

  /* ============================================================
   * ★★ 「手机上有概率加载不出图片」的三条修法（2026-10）
   *
   *   症状：手机上偶尔有几张立绘不显示，退回 emoji，而且**刷新才可能好**。
   *   查下去是三个叠加的问题，全在"请求失败之后怎么办"这一侧：
   *
   *   ① **失败一次 = 永久缺失。** 原来的 `onerror` 直接把状态钉成 `missing`，
   *      之后任何 `ART.load(id)` 都立刻回 null —— 战斗画布读的正是这个缓存，
   *      于是那一张脸**这一整局都不会再回来**。手机最容易触发：
   *      切出去接个电话 / 锁屏，浏览器会把在飞的图片请求直接掐掉，
   *      回来就是 onerror。
   *   ② **开局 36 张图一起轰。** `preloadAll` 一口气发 36 个请求（约 9 MB），
   *      而 iOS 每个域名只留 6 条连接、超出的一律排队 —— 排队里被掐掉的那几个
   *      正好就是"随机某几张没有"的来源。
   *   ③ **没有任何重试入口。** 网络恢复了、回到前台了，也没人去重新拉一次。
   *
   *   所以这一版做三件事：**失败要重试（带退避）**、**预加载要限流**、
   *   **回到前台 / 网络恢复时把缺的那些再拉一遍**。
   *   ★ 网络正常时行为和以前**逐字一致**：第一次请求就是普通 URL，
   *     不加重试参数、不走 queue 的额外分支。
   * ============================================================ */

  /** 重试的等待时间（毫秒）。两次都失败才认输 —— 之后还能被 retryFailed 再捞起来。
   *  ★★ 为什么只退避到 1.2 秒、而不是退避到 7 秒：
   *     24 个棋子里有 **6 个还没画立绘**（素材是一张一张补的），那几个请求
   *     本来就该 404。退避太长的话，它们会各自占着并发名额 7 秒 ——
   *     真正有图的那些排在后面，反而被拖慢。
   *     短退避的代价只是多发几个几 KB 的 404，换来的是"有图的先出来"。 */
  var RETRY_DELAYS = [400, 1200];
  /** 预加载的并发上限：一次最多几张在飞（手机浏览器每域名约 6 条连接） */
  var MAX_PARALLEL = 4;

  /** 重试时给 URL 挂一个递增值：绕开浏览器里那条"坏掉的"缓存记录 */
  function withAttempt(url, n) {
    if (n <= 1) return url;
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'r=' + n;
  }

  ART.dir = DIR;
  ART.itemDir = ITEM_DIR;
  ART.url = function (defId) { return DIR + defId + '.png'; };
  /** 装备图标：art/items/<装备id>.png */
  ART.itemUrl = function (itemId) { return ITEM_DIR + itemId + '.png'; };
  ART.retryDelays = function () { return RETRY_DELAYS.slice(); };
  ART.maxParallel = function () { return MAX_PARALLEL; };

  /* ---------- 一套加载器，棋子和装备图标共用 ----------
   * ★ 抽出来是因为这两段原先几乎是逐字复制的（连 waiters 的分发都一样），
   *   而这一版要往里面加"重试 + 退避 + 唤醒重拉" ——
   *   复制两份的话，下次改一处必漏一处。
   */
  function makeLoader(store, urlOf) {
    function finish(rec, status, img) {
      rec.status = status;
      rec.img = img;
      var ws = rec.waiters;
      rec.waiters = [];
      for (var i = 0; i < ws.length; i++) ws[i](img);
    }
    /** 真正发一次请求；失败则按 RETRY_DELAYS 退避重试 */
    function attempt(key, url, n) {
      var rec = store[key];
      if (!rec) return;                     // 期间被 forget 掉了
      rec.attempt = n;
      var img = new Image();
      img.onload = function () { finish(rec, 'ok', img); };
      img.onerror = function () {
        if (n <= RETRY_DELAYS.length) {
          /* ★ 退避重试。用 setTimeout 而不是立刻重来：
             网络刚断的时候连续三次立刻失败毫无意义，只是白烧请求。 */
          rec.timer = setTimeout(function () { attempt(key, url, n + 1); },
                                 RETRY_DELAYS[n - 1]);
        } else {
          /* 三次都失败 → 认定缺失（退回 emoji）。★ 但这不是终点：
             回到前台 / 网络恢复时 retryFailed() 会把它们清掉重来。 */
          finish(rec, 'missing', null);
        }
      };
      rec.img = img;
      img.src = withAttempt(urlOf(key), n);
    }
    return {
      store: store,
      get: function (key) {
        var rec = store[key];
        return (rec && rec.status === 'ok') ? rec.img : null;
      },
      status: function (key) {
        var rec = store[key];
        return rec ? rec.status : 'idle';
      },
      load: function (key, cb) {
        var rec = store[key];
        if (rec) {
          if (rec.status === 'loading' && cb) rec.waiters.push(cb);
          else if (cb) cb(this.get(key));
          return;
        }
        rec = store[key] = { status: 'loading', img: null, waiters: cb ? [cb] : [], attempt: 0 };
        attempt(key, urlOf(key), 1);
      },
      /** 把"缺失"的那些清掉**并立刻重新排队**（回到前台 / 网络恢复时调）
       *  ★ 自己重新 load，而不是交给 preloadAll：探针 / 非 ST.UNITS 里的 id
       *    也得能被捞回来（而且这样两个加载器各管各的，不会互相牵连）。 */
      retryFailed: function () {
        var keys = [];
        for (var k in store) if (store[k].status === 'missing') keys.push(k);
        for (var i = 0; i < keys.length; i++) {
          if (store[keys[i]].timer) { clearTimeout(store[keys[i]].timer); }
          delete store[keys[i]];
        }
        var self = this;
        for (var j = 0; j < keys.length; j++) self.load(keys[j]);
        return keys.length;
      }
    };
  }

  var unitLoader = makeLoader(cache, function (id) { return ART.url(id); });
  var itemLoader = makeLoader(itemCache, function (id) { return ART.itemUrl(id); });

  /** 拿已经加载好的图片；没加载好或不存在就返回 null（调用方自己退回 emoji） */
  ART.get = function (defId) { return unitLoader.get(defId); };
  ART.status = function (defId) { return unitLoader.status(defId); };

  /**
   * 加载一张。同一个 id 只会真正请求一次（失败会自动重试）。
   * @param {Function} cb 收到 (img | null)
   */
  ART.load = function (defId, cb) { unitLoader.load(defId, cb); };

  /* ---------- 装备图标 ----------
   *
   * 和棋子立绘同一套逻辑：有图用图，没图退回 emoji。
   * 分开放在 art/items/ 子目录，避免和棋子 id 撞名
   * （比如装备和棋子万一同名，同一个目录下会互相覆盖）。
   */
  ART.itemStatus = function (itemId) { return itemLoader.status(itemId); };
  ART.itemGet = function (itemId) { return itemLoader.get(itemId); };
  ART.loadItem = function (itemId, cb) { itemLoader.load(itemId, cb); };

  /* ---------- 预加载 ----------
   * ★★ 限流：一次最多 MAX_PARALLEL 张在飞。
   *   原来是一口气 36 个请求 —— 手机浏览器每域名只留 6 条连接，
   *   剩下的排队；切后台/锁屏时排队里的请求会被直接掐掉，
   *   于是"随机某几张立绘没了"。限流之后同时最多 4 个，
   *   每个都有明确的完成回调，失败的那几个还会自己重试。
   */
  ART.preloadAll = function () {
    var jobs = [];
    var i;
    for (i = 0; i < ST.UNITS.length; i++) jobs.push({ key: ST.UNITS[i].id, item: false });
    for (i = 0; i < ST.ITEMS.length; i++) jobs.push({ key: ST.ITEMS[i].id, item: true });
    var next = 0, running = 0;
    function pump() {
      while (running < MAX_PARALLEL && next < jobs.length) {
        var job = jobs[next++];
        running++;
        var done = (function () {
          var used = false;
          return function () {
            if (used) return;      // ★ 只记一次账：这里数错会让并发数越放越宽
            used = true;
            running--;
            pump();
          };
        })();
        if (job.item) ART.loadItem(job.key, done);
        else ART.load(job.key, done);
      }
    }
    pump();
    bindWakeUp();
  };

  /** 只预加载装备图标（不带限流）。
   *  ★ 一般不用直接调它 —— `preloadAll()` 已经把装备图标一起排进限流队列了。
   *    这个入口留着是给"只想补图标"的调试场景用的。 */
  ART.preloadItems = function () {
    for (var i = 0; i < ST.ITEMS.length; i++) ART.loadItem(ST.ITEMS[i].id);
  };

  /* ---------- 回到前台 / 网络恢复时，把缺的那些再拉一遍 ----------
   * ★★ 这一条是针对手机的主场景：切出去接电话、锁屏、切到别的 App，
   *   浏览器会把在飞的图片请求掐掉（onerror）。回到前台时网络其实好好的，
   *   但按老逻辑那些图已经被钉成"缺失"了 —— 现在会在这里被重新拉起来。
   */
  var wakeBound = false;
  function retryAll() {
    var n = unitLoader.retryFailed() + itemLoader.retryFailed();
    return n;
  }
  ART.retryFailed = retryAll;

  /**
   * 把两个缓存整个清空并重新预加载。
   *
   * ★ 自检要用它收尾：那几组断言会用**假的 Image** 去控制"第几次失败"，
   *   而被污染的记录里存的就是假对象 —— 不清掉的话，后面战斗画布
   *   `drawImage(假对象)` 会当场抛 TypeError（真发生过）。
   * ★ 顺带它也是个有用的调试入口：控制台里 `ART.reset()` 就是"立绘全部重拉"。
   */
  ART.reset = function () {
    var keys = [], k;
    for (k in cache) keys.push(k);
    for (var i = 0; i < keys.length; i++) {
      if (cache[keys[i]].timer) clearTimeout(cache[keys[i]].timer);
      delete cache[keys[i]];
    }
    var ikeys = [];
    for (k in itemCache) ikeys.push(k);
    for (var j = 0; j < ikeys.length; j++) {
      if (itemCache[ikeys[j]].timer) clearTimeout(itemCache[ikeys[j]].timer);
      delete itemCache[ikeys[j]];
    }
    ART.preloadAll();
  };

  function bindWakeUp() {
    if (wakeBound) return;
    wakeBound = true;
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) retryAll();
      });
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('online', function () { retryAll(); });
    }
  }

  /** 列出全部需要的文件名，方便你照着准备素材 */
  ART.ids = function () {
    return ST.UNITS.map(function (u) { return u.id; });
  };

  ART.filenames = function () {
    return ST.UNITS.map(function (u) { return u.id + '.png'; });
  };

  /** 统计一下素材齐了没（在控制台里打 ART.report() 看） */
  ART.report = function () {
    var have = [], miss = [], pending = [];
    for (var i = 0; i < ST.UNITS.length; i++) {
      var id = ST.UNITS[i].id, s = ART.status(id);
      if (s === 'ok') have.push(id);
      else if (s === 'missing') miss.push(id);
      else pending.push(id);
    }
    var iHave = [], iMiss = [];
    for (var j = 0; j < ST.ITEMS.length; j++) {
      var iid = ST.ITEMS[j].id;
      if (ART.itemStatus(iid) === 'ok') iHave.push(iid);
      else iMiss.push(iid);
    }
    var out = '立绘素材：已有 ' + have.length + ' / 缺失 ' + miss.length +
      ' / 未加载 ' + pending.length + '（共 ' + ST.UNITS.length + '）' +
      '　装备图标：已有 ' + iHave.length + ' / 缺失 ' + iMiss.length +
      '（共 ' + ST.ITEMS.length + '）';
    if (window.console) {
      console.log(out);
      if (miss.length) console.log('棋子缺的：' + miss.join('、'));
      if (pending.length) console.log('棋子没加载的：' + pending.join('、'));
      if (iMiss.length) console.log('装备缺的：' + iMiss.join('、'));
    }
    return { have: have, missing: miss, pending: pending,
             itemsHave: iHave, itemsMissing: iMiss, text: out };
  };
})();
