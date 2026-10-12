/* ============================================================
 * 科币战争 — 开发控制台
 *
 * 这个文件在做一件很具体的事，也是整个项目的架构证明：
 *   战斗画面里的每一个像素变化，都只是「把 battle.js 吐出来的事件流播一遍」。
 *   渲染层不认识规则、不掷骰子、不算伤害 —— 它只按时间轴消费事件。
 *
 * 正因为如此，同一个 result 你可以慢放、加速、跳到结尾、重播，
 * 而战斗结果永远是同一个。
 * ============================================================ */
(function () {
  'use strict';

  var ST = window.ST;
  var U = ST.U;
  var CFG = ST.BATTLE_CFG;
  var COLS = CFG.COLS;

  var CELL = 64;
  var SIDE_ROWS = { a: [0, 1, 2, 3], b: [4, 5, 6, 7] };
  var FRONT_ROW = { a: 3, b: 4 };
  // 列分配顺序：从中间往两边，和 battle.js 的自动站位共用同一份
  var COL_ORDER = ST.BOARD.colOrder();

  var state = {
    a: [], b: [],
    seed: 20260101,
    sel: null,               // { side, idx } 或 { side, r, c }（空格子）
    result: null,
    totalT: 0,
    pb: null,
    raf: 0,
    lastFrame: 0,
    debug: false
  };

  function $(id) { return document.getElementById(id); }
  function r1(v) { return Math.round(v * 10) / 10; }
  function pct(v) { return Math.round(v * 100) + '%'; }

  function unitAt(side, r, c) {
    var list = state[side];
    for (var i = 0; i < list.length; i++) {
      if (list[i].r === r && list[i].c === c) return { idx: i, unit: list[i] };
    }
    return null;
  }

  function freeCellFor(side, def) {
    var rows = SIDE_ROWS[side].slice();
    var seq = (def.range <= 1) ? rows.slice().reverse() : rows;
    for (var i = 0; i < seq.length; i++) {
      for (var j = 0; j < COL_ORDER.length; j++) {
        if (!unitAt(side, seq[i], COL_ORDER[j])) return { r: seq[i], c: COL_ORDER[j] };
      }
    }
    return null;
  }

  /* ============================================================
   * 一、摆阵容
   * ============================================================ */
  function renderBoards() {
    renderBoard('a');
    renderBoard('b');
    renderEditor();
    renderTraits();
  }

  function renderBoard(side) {
    var host = $('board-' + side);
    if (!host) return;
    host.innerHTML = '';
    var rows = SIDE_ROWS[side];
    for (var ri = 0; ri < rows.length; ri++) {
      for (var c = 0; c < COLS; c++) {
        var r = rows[ri];
        var cell = document.createElement('div');
        cell.className = 'cell';
        if (r === FRONT_ROW[side]) cell.className += ' front';

        var hit = unitAt(side, r, c);
        if (hit) {
          var def = ST.UNIT_BY_ID[hit.unit.id];
          var box = document.createElement('div');
          box.className = 'u';
          box.style.background = def.color;
          box.innerHTML =
            '<span class="stars">' + repeat('★', hit.unit.star) + '</span>' +
            '<span class="cost">' + def.cost + '</span>' +
            '<span style="font-size:15px">' + def.emoji + '</span>' +
            '<span class="nm">' + def.name + '</span>' +
            (hit.unit.items.length ? '<span class="it">' + hit.unit.items.map(function (x) {
              return ST.ITEM_BY_ID[x] ? ST.ITEM_BY_ID[x].emoji : '';
            }).join('') + '</span>' : '');
          cell.appendChild(box);
        } else {
          cell.className += ' empty';
        }

        if (state.sel && state.sel.side === side &&
            ((hit && state.sel.idx === hit.idx) || (!hit && state.sel.r === r && state.sel.c === c))) {
          cell.className += ' sel';
        }

        (function (rr, cc, h, sd) {
          cell.onclick = function () {
            if (h) state.sel = { side: sd, idx: h.idx, r: rr, c: cc };
            else state.sel = { side: sd, r: rr, c: cc };
            renderBoards();
          };
        })(r, c, hit, side);

        host.appendChild(cell);
      }
    }
  }

  function repeat(ch, n) { var s = ''; for (var i = 0; i < n; i++) s += ch; return s; }

  function renderEditor() {
    var host = $('editor');
    host.innerHTML = '';
    if (!state.sel) {
      host.innerHTML = '<span class="note">没有选中任何棋子。点棋盘上的棋子来改星级和装备。</span>';
      return;
    }
    var side = state.sel.side;
    if (state.sel.idx === undefined || !state[side][state.sel.idx]) {
      host.innerHTML = '<span class="note">选中了一个空格子（' +
        (side === 'a' ? 'A' : 'B') + ' 方 ' + state.sel.r + ',' + state.sel.c +
        '）。从下面的棋子池点一个棋子就会放在这里。</span>';
      return;
    }
    var unit = state[side][state.sel.idx];
    var def = ST.UNIT_BY_ID[unit.id];

    var who = document.createElement('span');
    who.className = 'who';
    who.textContent = (side === 'a' ? 'A 方' : 'B 方') + ' · ' + def.emoji + ' ' + def.name +
      '（' + def.cost + ' 费 · ' + def.role + '）';
    host.appendChild(who);

    var starBox = document.createElement('span');
    starBox.className = 'stars';
    for (var s = 1; s <= ST.MAX_STAR; s++) {
      var sb = document.createElement('button');
      sb.textContent = s + '★';
      if (unit.star === s) sb.className = 'on';
      (function (sv) {
        sb.onclick = function () {
          unit.star = sv;
          renderBoards();
        };
      })(s);
      starBox.appendChild(sb);
    }
    host.appendChild(starBox);

    var itemsBox = document.createElement('span');
    itemsBox.className = 'items';
    for (var ii = 0; ii < ST.ITEMS.length; ii++) {
      var item = ST.ITEMS[ii];
      var on = unit.items.indexOf(item.id) >= 0;
      var ib = document.createElement('button');
      ib.textContent = item.emoji;
      ib.title = item.name + '：' + item.desc;
      if (on) ib.className = 'on';
      (function (iid) {
        ib.onclick = function () {
          var k = unit.items.indexOf(iid);
          if (k >= 0) unit.items.splice(k, 1);
          else if (unit.items.length < ST.MAX_ITEMS) unit.items.push(iid);
          renderBoards();
        };
      })(item.id);
      itemsBox.appendChild(ib);
    }
    host.appendChild(itemsBox);

    var rm = document.createElement('button');
    rm.className = 'warn';
    rm.textContent = '移除';
    rm.onclick = function () {
      state[side].splice(state.sel.idx, 1);
      state.sel = null;
      renderBoards();
    };
    host.appendChild(rm);

    host.appendChild(el('span', 'note', '装备最多 ' + ST.MAX_ITEMS + ' 件。' +
      '面板：生命 ' + ST.resolveStats(def, unit.star, unit.items, ST.resolveTraits(
        state[side].map(function (x) { return ST.UNIT_BY_ID[x.id]; })).mods).maxHp +
      '　攻击 ' + ST.resolveStats(def, unit.star, unit.items, ST.resolveTraits(
        state[side].map(function (x) { return ST.UNIT_BY_ID[x.id]; })).mods).ad +
      '　射程 ' + def.range + '　技能【' + def.skill.name + '】'));
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function renderTraits() {
    ['a', 'b'].forEach(function (side) {
      var host = $('traits-' + side);
      host.innerHTML = '';
      var defs = state[side].map(function (x) { return ST.UNIT_BY_ID[x.id]; });
      var res = ST.resolveTraits(defs);
      if (!defs.length) {
        host.appendChild(el('div', 'note', '还没有摆棋子。'));
        return;
      }
      for (var i = 0; i < res.active.length; i++) {
        var a = res.active[i];
        var row = el('div', 'trait');
        if (a.tier === 1) row.className += ' on2';
        else if (a.tier === 0) row.className += ' on';
        else row.className += ' off';
        row.appendChild(el('span', 'nm', a.trait.emoji + ' ' + a.trait.name));
        var bonus = '';
        if (a.tier >= 0 && a.mods) {
          bonus = Object.keys(a.mods).map(function (k) {
            var v = a.mods[k];
            return k + ' ' + (Math.abs(v) < 1 ? '+' + Math.round(v * 100) + '%' : '+' + v);
          }).join('、');
        } else {
          bonus = '还差 ' + (a.need - a.count) + ' 个激活';
        }
        row.appendChild(el('span', 'note', bonus));
        row.appendChild(el('span', 'cnt' + (a.tier >= 0 ? ' hot' : ''), a.count + '/' + a.need));
        host.appendChild(row);
      }
      // 未出现的羁绊不显示，避免刷屏
    });
  }

  function renderPool() {
    var host = $('pool');
    host.innerHTML = '';

    // 预设阵容
    var presetRow = el('div', 'poolrow');
    presetRow.appendChild(el('span', 'lbl', '预设'));
    var presets = ST.Battle.presetComps();
    Object.keys(presets).forEach(function (name) {
      var chip = el('div', 'chip', '📋 ' + name);
      chip.title = '把 A 方换成这套，B 方换成另一套（交替）';
      chip.onclick = function () {
        var names = Object.keys(presets);
        var ia = names.indexOf(name);
        loadComp('a', presets[name]);
        loadComp('b', presets[names[(ia + 1) % names.length]]);
        state.sel = null;
        renderBoards();
      };
      presetRow.appendChild(chip);
    });
    host.appendChild(presetRow);

    for (var cost = 1; cost <= ST.COST_TIERS; cost++) {
      var row = el('div', 'poolrow');
      row.appendChild(el('span', 'lbl', cost + ' 费'));
      var list = ST.UNITS_BY_COST[cost] || [];
      for (var i = 0; i < list.length; i++) {
        (function (def) {
          var chip = el('div', 'chip c' + def.cost);
          chip.appendChild(el('span', '', def.emoji));
          chip.appendChild(el('span', '', def.name));
          chip.appendChild(el('span', 't', def.traits.map(function (t) {
            return ST.TRAIT_BY_ID[t].name;
          }).join('/') + ' · 射程' + def.range));
          chip.title = def.skill.name + '：' + def.skill.desc + '\n' +
            '生命 ' + def.hp + '　攻击 ' + def.ad + '　攻速 ' + def.as + '　护甲 ' + def.armor + '　法力 ' + def.mana;
          chip.onclick = function () { addUnit(def); };
          row.appendChild(chip);
        })(list[i]);
      }
      host.appendChild(row);
    }
  }

  /** 点棋子池：优先放进选中的空格子，否则自动找一个空位 */
  function addUnit(def) {
    var side = (state.sel && state.sel.side) || 'a';
    var list = state[side];
    if (list.length >= ST.MAX_DEPLOY) {
      toast('每边最多上 ' + ST.MAX_DEPLOY + ' 个棋子');
      return;
    }
    var cell = null;
    if (state.sel && state.sel.side === side && state.sel.idx === undefined &&
        !unitAt(side, state.sel.r, state.sel.c)) {
      cell = { r: state.sel.r, c: state.sel.c };
    }
    if (!cell) cell = freeCellFor(side, def);
    if (!cell) { toast('这边没位置了'); return; }

    list.push({ id: def.id, star: 1, items: [], r: cell.r, c: cell.c });
    state.sel = { side: side, idx: list.length - 1, r: cell.r, c: cell.c };
    renderBoards();
  }

  function loadComp(side, compact) {
    state[side] = compact.map(function (x) {
      return { id: x.id, star: x.star || 1, items: (x.items || []).slice(), r: null, c: null };
    });
    var placed = ST.Battle.autoPlace(side, state[side]);
    for (var i = 0; i < placed.length; i++) {
      state[side][i].r = placed[i].r;
      state[side][i].c = placed[i].c;
    }
  }

  var toastTimer = 0;
  function toast(msg) {
    var t = $('toast');
    if (!t) {
      t = el('div', '');
      t.id = 'toast';
      t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);' +
        'background:#2a3140;border:1px solid #3c4759;padding:7px 16px;border-radius:6px;' +
        'font-size:12.5px;z-index:99;transition:opacity .2s';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.style.opacity = '0'; }, 1400);
  }

  /* ============================================================
   * 二、开战
   * ============================================================ */
  function runBattle() {
    if (!state.a.length || !state.b.length) {
      toast('两边都要至少摆一个棋子');
      return;
    }
    var seedRaw = $('seed').value;
    var seed = /^\d+$/.test(seedRaw) ? (parseInt(seedRaw, 10) >>> 0) : ST.hashSeed(String(seedRaw || '0'));
    state.seed = seed;

    var setup = { a: clone(state.a), b: clone(state.b) };
    state.result = ST.Battle.battle(setup, seed);
    state.totalT = state.result.log.length ? state.result.log[state.result.log.length - 1].t : 0;

    resetPlayback();
    renderResult();
    renderStats();
    state.pb.playing = true;
    updatePlayButton();
  }

  function clone(list) {
    return list.map(function (x) {
      return { id: x.id, star: x.star, items: x.items.slice(), r: x.r, c: x.c };
    });
  }

  function renderResult() {
    var r = state.result;
    var box = $('result');
    var who = r.winner === 'a' ? 'A 方获胜' : r.winner === 'b' ? 'B 方获胜' : '平局';
    box.className = 'result show ' + (r.winner === 'a' ? 'win-a' : r.winner === 'b' ? 'win-b' : 'draw');
    box.innerHTML = '<b>' + who + '</b>　' +
      (r.reason === 'timeout' ? '超时按剩余血量判定' : '一方全灭') +
      '<div class="meta">用时 ' + r.time + 's（' + r.ticks + ' tick）　' +
      '存活 A ' + r.survivors.a + ' / B ' + r.survivors.b + '　' +
      '剩余血量 A ' + pct(r.remainPct.a) + ' / B ' + pct(r.remainPct.b) + '　' +
      '事件 ' + r.log.length + ' 条　种子 ' + r.seed + '</div>';
  }

  function renderStats() {
    var r = state.result;
    var card = $('stats-card');
    card.className = 'card';
    var names = {};
    for (var i = 0; i < r.initial.units.length; i++) names[r.initial.units[i].uid] = r.initial.units[i];

    var uids = Object.keys(r.unitStats).sort(function (x, y) {
      var a = r.unitStats[x], b = r.unitStats[y];
      if (a.side !== b.side) return a.side === 'a' ? -1 : 1;
      return a.index - b.index;
    });

    var html = '<table><thead><tr><th>单位</th><th>星级</th><th>阵亡</th>' +
      '<th>造成伤害</th><th>承受伤害</th><th>治疗</th><th>护盾</th><th>技能次数</th><th>击杀</th>' +
      '</tr></thead><tbody>';
    for (var k = 0; k < uids.length; k++) {
      var uid = uids[k], s = r.unitStats[uid], meta = names[uid];
      var cls = s.side === 'a' ? 'side-a-c' : 'side-b-c';
      html += '<tr>' +
        '<td class="' + cls + '">' + (meta ? meta.emoji : '') + ' ' + s.name +
        ' <span class="note">' + (s.side === 'a' ? 'A' : 'B') + '</span></td>' +
        '<td>' + s.star + '★' + (meta && meta.items.length ? ' ' + meta.items.map(function (x) {
          return ST.ITEM_BY_ID[x] ? ST.ITEM_BY_ID[x].emoji : '';
        }).join('') : '') + '</td>' +
        '<td>' + (s.survived ? '—' : '☠') + '</td>' +
        '<td>' + Math.round(s.dmgDealt) + '</td>' +
        '<td>' + Math.round(s.dmgTaken) + '</td>' +
        '<td>' + Math.round(s.healing) + '</td>' +
        '<td>' + Math.round(s.shielding) + '</td>' +
        '<td>' + s.casts + '</td>' +
        '<td>' + s.kills + '</td>' +
        '</tr>';
    }
    html += '</tbody></table>';
    $('stats').innerHTML = html;
  }

  /* ============================================================
   * 三、播放事件流
   * ============================================================ */
  function resetPlayback() {
    var r = state.result;
    var names = {};
    var init = r.initial.units;
    for (var i = 0; i < init.length; i++) names[init[i].uid] = init[i];

    var units = {};
    for (var j = 0; j < init.length; j++) {
      var u = init[j];
      units[u.uid] = {
        uid: u.uid, side: u.side, name: u.name, emoji: u.emoji, color: u.color,
        maxHp: u.maxHp, hp: u.hp, shield: u.shield, mana: u.mana, maxMana: u.maxMana,
        r: u.r, c: u.c, rr: u.r, cc: u.c, alive: true, star: u.star, items: u.items
      };
    }

    state.pb = {
      t: 0, idx: 0, speed: state.pb ? state.pb.speed : 1, playing: false,
      units: units, flashes: [], lastLine: -1, names: names, lineEls: []
    };
    buildLogLines();
    highlight(0);
    draw();
    updateClock();
    $('barfill').style.width = '0%';
  }

  function buildLogLines() {
    var r = state.result;
    var host = $('log');
    host.innerHTML = '';
    var pb = state.pb;
    pb.lineEls = new Array(r.log.length);

    var frag = document.createDocumentFragment();
    var hidden = 0;
    for (var i = 0; i < r.log.length; i++) {
      var e = r.log[i];
      var text = describeEvent(e, pb.names);
      if (text === null) { hidden++; continue; }         // move / snap 不显示，太吵
      var div = el('div', 'logline ' + e.type);
      div.innerHTML = '<span class="tt">' + e.t.toFixed(2) + 's</span>' + escapeHtml(text);
      div.setAttribute('data-i', String(i));
      pb.lineEls[i] = div;
      frag.appendChild(div);
    }
    host.appendChild(frag);
    var note = el('div', 'logline sys',
      '—— 共 ' + r.log.length + ' 条事件，这里显示 ' + (r.log.length - hidden) +
      ' 条（move / snap 太吵，不显示）——');
    host.appendChild(note);
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function describeEvent(e, names) {
    function nm(uid) {
      var u = names[uid];
      return u ? (u.emoji + u.name) : uid;
    }
    switch (e.type) {
      case 'move': case 'snap': return null;
      case 'attack':
        return nm(e.from) + ' → ' + nm(e.to) + '　普攻 ' + r1(e.dmg) +
          (e.crit ? '　✦暴击' : '') + (e.ramp > 1 ? '　(加时 ×' + e.ramp.toFixed(2) + ')' : '');
      case 'skill':
        return nm(e.from) + ' → ' + nm(e.to) + '　【' + e.skill + '】' + r1(e.dmg);
      case 'cast':
        return nm(e.from) + '　释放【' + e.skill + '】';
      case 'heal':
        return (e.from === null ? '医者羁绊' : nm(e.from)) + ' → ' + nm(e.to) + '　治疗 +' + r1(e.amount) +
          (e.reason === 'regen' ? '（持续回血）' : e.reason === 'lifesteal' ? '（吸血）' : '');
      case 'shield':
        return nm(e.to) + '　获得护盾 +' + r1(e.amount) +
          (e.reason === 'trait' ? '（守护羁绊）' : '');
      case 'stun':
        return nm(e.to) + '　被眩晕 ' + r1(e.dur) + 's';
      case 'buff':
        return nm(e.who) + '　攻速 +' + Math.round(e.amount * 100) + '% 持续 ' + e.dur + 's';
      case 'damage':
        return nm(e.from) + ' → ' + nm(e.to) + '　反弹 ' + r1(e.dmg) + '（真实伤害）';
      case 'death':
        return '☠ ' + nm(e.who) + '　阵亡';
      case 'end':
        return '战斗结束：' + (e.winner === 'a' ? 'A 方获胜' : e.winner === 'b' ? 'B 方获胜' : '平局') +
          (e.reason === 'timeout' ? '（超时判定）' : '（一方全灭）');
      default:
        return e.type;
    }
  }

  function applyUpTo(t) {
    var pb = state.pb, log = state.result.log;
    while (pb.idx < log.length && log[pb.idx].t <= t) {
      applyEvent(log[pb.idx]);
      pb.idx++;
    }
    highlight(pb.idx - 1);
  }

  function applyEvent(e) {
    var pb = state.pb;
    var src, tgt, u;
    switch (e.type) {
      case 'move':
        u = pb.units[e.who];
        if (u) { u.r = e.r; u.c = e.c; }
        break;
      case 'attack': case 'skill': case 'damage':
        tgt = pb.units[e.to];
        if (tgt) {
          tgt.hp = e.hpAfter;
          if (e.shieldLoss) tgt.shield = Math.max(0, tgt.shield - e.shieldLoss);
        }
        src = pb.units[e.from];
        if (e.type === 'attack' && src && e.manaAfter !== undefined) src.mana = e.manaAfter;
        if (src && tgt) {
          pb.flashes.push({
            from: src, to: tgt, age: 0,
            kind: e.type === 'attack' ? (e.crit ? 'crit' : 'atk') : (e.type === 'skill' ? 'skl' : 'thorn')
          });
        }
        break;
      case 'heal':
        u = pb.units[e.to];
        if (u) u.hp = e.hpAfter;
        break;
      case 'shield':
        u = pb.units[e.to];
        if (u) u.shield = e.shieldAfter;
        break;
      case 'cast':
        u = pb.units[e.from];
        if (u) u.mana = 0;
        break;
      case 'death':
        u = pb.units[e.who];
        if (u) { u.alive = false; u.hp = 0; u.shield = 0; }
        break;
      case 'snap':
        for (var i = 0; i < e.u.length; i++) {
          var row = e.u[i], uu = pb.units[row[0]];
          if (!uu) continue;
          uu.hp = row[1]; uu.shield = row[2]; uu.mana = row[3];
          uu.r = row[4]; uu.c = row[5]; uu.alive = !!row[6];
        }
        break;
      case 'end':
        pb.playing = false;
        updatePlayButton();
        break;
      default:
        break;
    }
  }

  function highlight(eventIdx) {
    var pb = state.pb;
    if (!pb || !pb.lineEls) return;
    if (eventIdx === pb.lastLine) return;
    if (pb.lastLine >= 0 && pb.lineEls[pb.lastLine]) {
      pb.lineEls[pb.lastLine].classList.remove('cur');
    }
    // 往前找最近的一条可见日志（move/snap 没有对应的行）
    var i = eventIdx;
    while (i >= 0 && !pb.lineEls[i]) i--;
    if (i >= 0 && pb.lineEls[i]) {
      pb.lineEls[i].classList.add('cur');
      var host = $('log');
      var top = pb.lineEls[i].offsetTop;
      if (top < host.scrollTop || top > host.scrollTop + host.clientHeight - 24) {
        host.scrollTop = top - host.clientHeight * 0.6;
      }
    }
    pb.lastLine = eventIdx;
  }

  /* ---------- 画布 ---------- */
  function setupCanvas() {
    var cv = $('arena');
    var dpr = window.devicePixelRatio || 1;
    var w = COLS * CELL, h = CFG.ROWS * CELL;
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // 之后所有绘制都按 CSS 像素算
  }

  function draw() {
    var cv = $('arena');
    var ctx = cv.getContext('2d');
    var W = COLS * CELL, H = CFG.ROWS * CELL;
    ctx.save();
    ctx.clearRect(0, 0, W, H);

    // 半场底色
    ctx.fillStyle = '#101823';
    ctx.fillRect(0, 0, W, H / 2);
    ctx.fillStyle = '#1a1424';
    ctx.fillRect(0, H / 2, W, H / 2);

    // 网格
    ctx.strokeStyle = 'rgba(255,255,255,.045)';
    ctx.lineWidth = 1;
    for (var c = 0; c <= COLS; c++) {
      ctx.beginPath(); ctx.moveTo(c * CELL + .5, 0); ctx.lineTo(c * CELL + .5, H); ctx.stroke();
    }
    for (var r = 0; r <= CFG.ROWS; r++) {
      ctx.beginPath(); ctx.moveTo(0, r * CELL + .5); ctx.lineTo(W, r * CELL + .5); ctx.stroke();
    }
    // 中线
    ctx.strokeStyle = 'rgba(216,180,95,.35)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();

    var pb = state.pb;
    if (!pb) { ctx.restore(); return; }

    // 攻击特效（先画，压在棋子下面）
    ctx.lineCap = 'round';
    for (var f = 0; f < pb.flashes.length; f++) {
      var fl = pb.flashes[f];
      var a = 1 - fl.age / 0.18;
      if (a <= 0) continue;
      var x1 = fl.from.cc * CELL + CELL / 2, y1 = fl.from.rr * CELL + CELL / 2;
      var x2 = fl.to.cc * CELL + CELL / 2, y2 = fl.to.rr * CELL + CELL / 2;
      ctx.globalAlpha = a * 0.9;
      ctx.strokeStyle = fl.kind === 'skl' ? '#b48ef0' : (fl.kind === 'crit' ? '#ffcf5f' : '#d8dee9');
      ctx.lineWidth = fl.kind === 'skl' ? 3 : (fl.kind === 'crit' ? 2.5 : 1.5);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 棋子
    var uids = Object.keys(pb.units);
    for (var k = 0; k < uids.length; k++) {
      var u = pb.units[uids[k]];
      var x = u.cc * CELL + CELL / 2;
      var y = u.rr * CELL + CELL / 2;
      var rad = 22;

      if (!u.alive) {
        ctx.globalAlpha = 0.18;
        ctx.strokeStyle = '#ef6f6f';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, rad * 0.6, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }

      // 身体
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fillStyle = u.color;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = u.side === 'a' ? '#6cb6ff' : '#b48ef0';
      ctx.stroke();

      // emoji
      ctx.font = '17px "Segoe UI Emoji", "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(u.emoji, x, y + 1);

      // 星级
      if (u.star > 1) {
        ctx.font = 'bold 8px sans-serif';
        ctx.fillStyle = '#3a2c00';
        ctx.fillText(repeat('★', u.star), x, y + rad - 5);
      }

      // 血条（含护盾）
      var bw = CELL - 14, bh = 5, bx = x - bw / 2, by = y - rad - 11;
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(bx, by, bw, bh);
      var hpFrac = Math.max(0, u.hp / u.maxHp);
      ctx.fillStyle = u.side === 'a' ? '#5fbf75' : '#4f9fd8';
      ctx.fillRect(bx, by, bw * hpFrac, bh);
      if (u.shield > 0) {
        var shFrac = Math.min(1, u.shield / u.maxHp);
        ctx.fillStyle = '#dfe9f5';
        ctx.fillRect(bx + bw * hpFrac, by, Math.min(bw * (1 - hpFrac), bw * shFrac), bh);
      }

      // 法力条
      var mbh = 3, mby = y + rad + 6;
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(bx, mby, bw, mbh);
      ctx.fillStyle = '#6cb6ff';
      ctx.fillRect(bx, mby, bw * Math.min(1, u.mana / u.maxMana), mbh);

      // 调试数字
      if (state.debug) {
        ctx.font = '9px Consolas, monospace';
        ctx.fillStyle = '#0d1015';
        ctx.fillText(Math.round(u.hp) + (u.shield > 0 ? '+' + Math.round(u.shield) : ''), x, y - rad - 16);
        ctx.fillText(Math.round(u.mana) + '/' + u.maxMana, x, y + rad + 14);
      }
    }
    ctx.restore();
  }

  /* ---------- 播放循环 ---------- */
  function frame(now) {
    var pb = state.pb;
    var dt = state.lastFrame ? Math.min(0.06, (now - state.lastFrame) / 1000) : 0;
    state.lastFrame = now;

    if (pb) {
      if (pb.playing) {
        pb.t += dt * pb.speed;
        if (pb.t >= state.totalT) {
          pb.t = state.totalT;
          applyUpTo(pb.t);
          pb.playing = false;
          updatePlayButton();
        } else {
          applyUpTo(pb.t);
        }
      }
      var k = 1 - Math.exp(-dt * 24);
      var uids = Object.keys(pb.units);
      for (var i = 0; i < uids.length; i++) {
        var u = pb.units[uids[i]];
        u.rr += (u.r - u.rr) * k;
        u.cc += (u.c - u.cc) * k;
      }
      for (var f = pb.flashes.length - 1; f >= 0; f--) {
        pb.flashes[f].age += dt;
        if (pb.flashes[f].age > 0.18) pb.flashes.splice(f, 1);
      }
      draw();
      updateClock();
    }
    state.raf = requestAnimationFrame(frame);
  }

  function updateClock() {
    var pb = state.pb;
    if (!pb) { $('clock').textContent = '—'; return; }
    $('clock').textContent = pb.t.toFixed(2) + 's / ' + state.totalT.toFixed(2) + 's' +
      '　×' + pb.speed;
    $('barfill').style.width = (state.totalT > 0 ? (pb.t / state.totalT * 100) : 0) + '%';
  }

  function updatePlayButton() {
    var pb = state.pb;
    if (!pb) return;
    $('btn-play').textContent = pb.playing ? '⏸ 暂停' : '▶ 播放';
  }

  /* ============================================================
   * 四、事件绑定
   * ============================================================ */
  function bind() {
    $('btn-run').onclick = runBattle;

    $('btn-random').onclick = function () {
      var rng = ST.makeRng((Math.random() * 0xffffffff) >>> 0);
      loadComp('a', ST.Battle.randomComp('a', rng, {}));
      loadComp('b', ST.Battle.randomComp('b', rng, {}));
      state.sel = null;
      renderBoards();
      toast('随机生成两套阵容（星级也比较随机）');
    };

    $('btn-swap').onclick = function () {
      var t = state.a;
      // 交换后坐标要镜像，否则会落到对面半场
      state.a = state.b.map(function (x) {
        return { id: x.id, star: x.star, items: x.items.slice(), r: 7 - x.r, c: x.c };
      });
      state.b = t.map(function (x) {
        return { id: x.id, star: x.star, items: x.items.slice(), r: 7 - x.r, c: x.c };
      });
      state.sel = null;
      renderBoards();
      toast('已交换双方（位置同时镜像）');
    };

    $('btn-clear').onclick = function () {
      state.a = []; state.b = []; state.sel = null;
      renderBoards();
    };

    $('btn-play').onclick = function () {
      var pb = state.pb;
      if (!pb) { toast('先开一局'); return; }
      if (!pb.playing && pb.t >= state.totalT) { resetPlayback(); }
      pb.playing = !pb.playing;
      updatePlayButton();
    };

    $('btn-restart').onclick = function () {
      if (!state.result) { toast('先开一局'); return; }
      resetPlayback();
      state.pb.playing = true;
      updatePlayButton();
    };

    $('btn-skip').onclick = function () {
      var pb = state.pb;
      if (!pb) { toast('先开一局'); return; }
      // 快进=一次性把剩下的事件全部消费掉。逻辑完全一样，只是不等时间轴。
      while (pb.idx < state.result.log.length) { applyEvent(state.result.log[pb.idx]); pb.idx++; }
      pb.t = state.totalT;
      pb.playing = false;
      highlight(state.result.log.length - 1);
      updatePlayButton();
      updateClock();
      draw();
    };

    var spds = document.querySelectorAll('.spd');
    for (var i = 0; i < spds.length; i++) {
      (function (btn) {
        btn.onclick = function () {
          state.pb.speed = parseFloat(btn.getAttribute('data-s'));
          for (var j = 0; j < spds.length; j++) spds[j].className = 'spd';
          btn.className = 'spd on';
          updateClock();
        };
      })(spds[i]);
    }

    $('seed').onchange = function () {
      var v = $('seed').value;
      state.seed = /^\d+$/.test(v) ? (parseInt(v, 10) >>> 0) : ST.hashSeed(v);
    };

    document.addEventListener('keydown', function (ev) {
      if (ev.target && /input|textarea/i.test(ev.target.tagName)) return;
      if (ev.key === ' ' || ev.code === 'Space') {
        ev.preventDefault();
        $('btn-play').click();
      } else if (ev.key === '`' || ev.key === '~') {
        state.debug = !state.debug;
        draw();
        toast(state.debug ? '调试数字已开（显示血量/护盾/法力）' : '调试数字已关');
      } else if (ev.key === 'r' || ev.key === 'R') {
        runBattle();
      }
    });
  }

  /* ============================================================
   * 五、启动
   * ============================================================ */
  function init() {
    setupCanvas();
    renderPool();
    bind();

    // 开局给一套能打的默认阵容：狂战影袭 vs 游侠医者
    var presets = ST.Battle.presetComps();
    var names = Object.keys(presets);
    loadComp('a', presets[names[2]]);
    loadComp('b', presets[names[3]]);
    renderBoards();

    state.raf = requestAnimationFrame(frame);
    runBattle();

    if (window.console && console.log) {
      console.log('%c科币战争 开发控制台已就绪', 'color:#d8b45f;font-weight:bold');
      console.log('窗口尺寸：' + COLS + ' 列 × ' + CFG.ROWS + ' 行（上下各 ' + CFG.ROWS_PER_SIDE + ' 行）');
      console.log('按 ~ 显示调试数字，空格播放/暂停，R 重新开战');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
