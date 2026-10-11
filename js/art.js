/* ============================================================
 * 科币战争 · 棋子立绘接口
 *
 * 你只需要把图片按文件名丢进 art/ 目录，游戏会自动用上：
 *     art/bowman.png      对应荣誉
 *     art/titan.png       对应山岳
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
  var cache = {};      // defId -> { status:'loading'|'ok'|'missing', img:Image }
  var itemCache = {};  // 装备 id -> 同上

  ART.dir = DIR;
  ART.itemDir = ITEM_DIR;
  ART.url = function (defId) { return DIR + defId + '.png'; };
  /** 装备图标：art/items/<装备id>.png */
  ART.itemUrl = function (itemId) { return ITEM_DIR + itemId + '.png'; };

  /** 拿已经加载好的图片；没加载好或不存在就返回 null（调用方自己退回 emoji） */
  ART.get = function (defId) {
    var rec = cache[defId];
    return (rec && rec.status === 'ok') ? rec.img : null;
  };

  ART.status = function (defId) {
    var rec = cache[defId];
    return rec ? rec.status : 'idle';
  };

  /**
   * 加载一张。同一个 id 只会真正请求一次。
   * @param {Function} cb 收到 (img | null)
   */
  ART.load = function (defId, cb) {
    var rec = cache[defId];
    if (rec) {
      if (rec.status === 'loading' && cb) rec.waiters.push(cb);
      else if (cb) cb(ART.get(defId));
      return;
    }
    var img = new Image();
    rec = cache[defId] = { status: 'loading', img: img, waiters: cb ? [cb] : [] };
    img.onload = function () {
      rec.status = 'ok';
      var ws = rec.waiters; rec.waiters = [];
      for (var i = 0; i < ws.length; i++) ws[i](img);
    };
    img.onerror = function () {
      rec.status = 'missing';
      var ws = rec.waiters; rec.waiters = [];
      for (var i = 0; i < ws.length; i++) ws[i](null);
    };
    img.src = ART.url(defId);
  };

  /** 预加载全部棋子（开局调一次，之后画布上就能直接用图） */
  ART.preloadAll = function () {
    for (var i = 0; i < ST.UNITS.length; i++) ART.load(ST.UNITS[i].id);
    ART.preloadItems();
  };

  /* ---------- 装备图标 ----------
   *
   * 和棋子立绘同一套逻辑：有图用图，没图退回 emoji。
   * 分开放在 art/items/ 子目录，避免和棋子 id 撞名
   * （比如装备和棋子万一同名，同一个目录下会互相覆盖）。
   */
  ART.itemStatus = function (itemId) {
    var rec = itemCache[itemId];
    return rec ? rec.status : 'idle';
  };

  ART.itemGet = function (itemId) {
    var rec = itemCache[itemId];
    return (rec && rec.status === 'ok') ? rec.img : null;
  };

  ART.loadItem = function (itemId, cb) {
    var rec = itemCache[itemId];
    if (rec) {
      if (rec.status === 'loading' && cb) rec.waiters.push(cb);
      else if (cb) cb(ART.itemGet(itemId));
      return;
    }
    var img = new Image();
    rec = itemCache[itemId] = { status: 'loading', img: img, waiters: cb ? [cb] : [] };
    img.onload = function () {
      rec.status = 'ok';
      var ws = rec.waiters; rec.waiters = [];
      for (var i = 0; i < ws.length; i++) ws[i](img);
    };
    img.onerror = function () {
      rec.status = 'missing';
      var ws = rec.waiters; rec.waiters = [];
      for (var i = 0; i < ws.length; i++) ws[i](null);
    };
    img.src = ART.itemUrl(itemId);
  };

  ART.preloadItems = function () {
    for (var i = 0; i < ST.ITEMS.length; i++) ART.loadItem(ST.ITEMS[i].id);
  };

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
