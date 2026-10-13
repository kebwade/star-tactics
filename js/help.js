/* ============================================================
 * 科币战争 · 新手引导 / 羁绊文案 / 阵容详解
 *
 * ★ 这个文件**只产出内容**，不碰 DOM 结构、也不读全局游戏状态：
 *   外面（game.js）把该给的数据递进来，这里返回"要显示什么"。
 *   于是它可以在没有界面的地方被调用（自检、控制台），
 *   也不会因为"界面改版"而让文案跟着一起崩。
 *
 * 三块内容：
 *   ① H.steps()        —— 新手指引的几页（标题 + 要点）
 *   ② H.traitText()    —— 把羁绊的档位加成翻译成人话
 *   ③ H.compReport()   —— 阵容详解：上阵情况、羁绊进度、几条该改的建议
 * ============================================================ */
(function () {
  var ST = window.ST;
  var H = (ST.Help = {});

  /* ---------- ① 新手指引 ----------
   * ★ 写法上有三条讲究：
   *   1. 每一页只讲**一件事**，标题就是那件事（"怎么赢"而不是"游戏介绍"）；
   *   2. 要点里出现的按钮名和界面上**一模一样**（「开战」「买经验」），
   *      不然玩家对不上号；
   *   3. 所有数字都从数据里取（合成 3 个、星级上限 4、上场人数上限……），
   *      改数值的时候这份引导不会变成假信息。
   */
  H.steps = function () {
    var combine = (ST.GAME_RULES && ST.GAME_RULES.COMBINE_COUNT) || 3;
    var maxStar = ST.MAX_STAR || 4;
    return [
      {
        icon: '🎯',
        title: '一句话：把对面全部打倒',
        points: [
          '你只有半张棋盘（下面那 4 行），对面在另外半张。',
          '「开战」之后棋子**自己打**——你决定的是"买谁、摆哪、凑什么羁绊"。',
          '输赢看谁先被打光；打光对面就过关，你的血量扣完就重来这一关。'
        ]
      },
      {
        icon: '🛒',
        title: '第一步：在商店买棋子',
        points: [
          '点商店里的卡牌就买下来，它会先待在下面的**备战池**里。',
          '点备战池的棋子 → 再点棋盘上的空格，就上场了（也可以直接拖）。',
          '左侧「上场 0/2」是**上场人数上限**：升级才会变多。',
          '钱不够就先用完这一轮，每回合会自动发钱、自动刷一批新牌。'
        ]
      },
      {
        icon: '⭐',
        title: '变强：三个一样的合成一个',
        points: [
          combine + ' 个**同名同星**的棋子会自动合成高一星（最高 ' + maxStar + ' 星）。',
          '星级会让棋子**全面变强**（血量/攻击/技能一起涨），比多上一个划算。',
          '同名棋子**放在哪都算**：备战池里的也会参与合成，不用先摆上场。',
          '点「买经验」能升级 → 上场人数变多、商店里更容易刷到高费棋子。'
        ]
      },
      {
        icon: '🤝',
        title: '变强的另一半：凑羁绊',
        points: [
          '每个棋子带 1~2 个**羁绊**（棋子卡面上那排小字）。',
          '同类羁绊凑够人数就激活：' + H.traitSampleText() + '。',
          '商店上方那条「🏹2 🛡️2」就是**当前羁绊**，亮起来表示已经生效。',
          '点它（或商店右边的「📋 阵容」）能看到：还差几个到下一档、加成是多少。'
        ]
      },
      {
        icon: '🧩',
        title: '站位：前排顶住，后排输出',
        points: [
          '布阵盘最上面那一行贴着中线，是**前排**——把肉盾放这儿。',
          '远程/法师放后面几行，别让他们先挨打。',
          '开战时双方**就在你摆的位置**上开打，所以摆哪儿就是哪儿。',
          '射程内没有敌人时，棋子会自己走过去找敌人。'
        ]
      },
      {
        icon: '🎒',
        title: '装备：拖到棋子身上就生效',
        points: [
          '打关卡会掉装备，它们堆在左侧「装备栏」里。',
          '点装备 → 再点棋子就装备上了（最多 ' + (ST.MAX_ITEMS || 3) + ' 件）。',
          '装备是**数值和机制**（伤害、护甲、吸血、反弹……），比多买一个 1 费棋子强得多。'
        ]
      },
      {
        icon: '❓',
        title: '随时可以再问我',
        points: [
          '商店右边的「❓ 指引」按钮随时能翻回这份说明。',
          '「📋 阵容」会告诉你**现在这套阵容**缺什么、下一档羁绊还差几个。',
          '战斗中右侧「战斗回放」写的是每一秒发生了什么，看不懂伤害就看它。'
        ]
      }
    ];
  };

  /** 引导第 4 页里的一句示例（从真实羁绊数据里取两条，不写死） */
  H.traitSampleText = function () {
    var out = [];
    for (var i = 0; i < ST.TRAITS.length && out.length < 2; i++) {
      var t = ST.TRAITS[i];
      if (!t.tiers || !t.tiers.length) continue;
      out.push(t.name + ' ' + t.tiers[0].need + ' 个 → ' +
        H.modsText(t.tiers[0].mods));
    }
    return out.join('；');
  };

  /* ---------- ② 羁绊加成翻译成人话 ----------
   * ★★ 这里是一张**显式的表**，不是"把 mods 的键拼成字符串"：
   *   键名（adPct / startShield / regenPct）是给引擎看的，
   *   而玩家要看的是"全队攻击力 +25%""开局每人 180 点护盾"这种话。
   *   ★ 表里查不到的键会退回"键名 + 数字"，所以以后加一条新羁绊
   *     最多是文案难看一点，不会静默丢信息。
   */
  var MOD_TEXT = {
    adPct:      function (v) { return '全队攻击力 +' + Math.round(v * 100) + '%'; },
    asPct:      function (v) { return '全队攻速 +' + Math.round(v * 100) + '%'; },
    apPct:      function (v) { return '全队法术强度 +' + Math.round(v * 100) + '%'; },
    hpPct:      function (v) { return '全队生命上限 +' + Math.round(v * 100) + '%'; },
    critChance: function (v) { return '全队暴击率 +' + Math.round(v * 100) + '%'; },
    armor:      function (v) { return '全队护甲 +' + v; },
    mr:         function (v) { return '全队魔抗 +' + v; },
    startShield: function (v) { return '开局全队各 ' + v + ' 点护盾'; },
    regenPct:   function (v) { return '全队每秒回 ' + (v * 100).toFixed(1) + '% 生命'; }
  };

  H.modsText = function (mods) {
    if (!mods) return '—';
    var parts = [];
    for (var k in mods) {
      if (!Object.prototype.hasOwnProperty.call(mods, k)) continue;
      var fn = MOD_TEXT[k];
      parts.push(fn ? fn(mods[k]) : (k + ' ' + mods[k]));
    }
    return parts.join('，');
  };

  /**
   * 一条羁绊的完整说明（羁绊条 / 阵容详解共用）。
   * @param {Object} entry ST.resolveTraits 里的 active 项
   * @returns {{short:string, full:string, on:boolean, next:string}}
   */
  H.traitText = function (entry) {
    var t = entry.trait;
    var on = entry.tier >= 0;
    var short = t.emoji + ' ' + t.name + ' ' + entry.count;
    var full = t.emoji + ' ' + t.name + ' ' + entry.count + ' 个：' +
      (on ? H.modsText(entry.mods) : '还差 ' + (entry.need - entry.count) + ' 个才生效');
    var next = '';
    if (entry.nextNeed) {
      var nt = t.tiers[entry.tier + 1];
      next = '再上 ' + (entry.nextNeed - entry.count) + ' 个 → ' +
        H.modsText(nt ? nt.mods : null);
    } else if (on) {
      next = '已经满档';
    }
    return { short: short, full: full, on: on, next: next };
  };

  /* ---------- ③ 阵容详解 ----------
   * ★★ 这一块只做**读数据 + 生成文字**，一条规则对应一句话：
   *      · 上场人数没满 → 明说还能上几个（这是新手最常见的浪费）
   *      · 一个前排都没有 → 提醒会被切后排
   *      · 羁绊快到下一档 → 说"再上 N 个就能到 X"
   *      · 有装备没戴 → 提醒装备栏里还躺着东西
   *   规则少而准，比一屏"建议多打钱"有用得多。
   *
   * @param {Object} o
   *   o.defs     上阵棋子的定义数组（棋盘上的，不含备战池）
   *   o.units    上阵棋子的 {name, star, cost, emoji, role}
   *   o.owned    备战池 + 棋盘的**全部**定义（羁绊是按全部算的）
   *   o.cap      上场人数上限
   *   o.items    装备栏里还没用的装备 id 数组
   */
  H.compReport = function (o) {
    var defs = o.defs || [];
    var owned = o.owned || defs;
    var res = ST.resolveTraits(owned);
    var traits = [];
    for (var i = 0; i < res.active.length; i++) {
      var e = res.active[i];
      var tx = H.traitText(e);
      traits.push({ emoji: e.trait.emoji, name: e.trait.name, count: e.count,
                    tier: e.tier, need: e.need, nextNeed: e.nextNeed,
                    desc: e.trait.desc, on: tx.on,
                    effect: e.tier >= 0 ? H.modsText(e.mods) : null,
                    next: tx.next });
    }

    var advice = [];
    var cap = o.cap || 0;
    if (cap > 0 && defs.length < cap) {
      advice.push('还能再上 ' + (cap - defs.length) + ' 个棋子（现在 ' +
        defs.length + '/' + cap + '）—— 空着位置等于白让对面一件装备。');
    }
    var front = 0;
    for (i = 0; i < defs.length; i++) {
      if (defs[i] && defs[i].role === '前排') front++;
    }
    if (defs.length > 0 && front === 0) {
      advice.push('一个**前排**都没有。对面近战会直接冲到你后排脸上，' +
        '把一个血厚的（前排/巨兽羁绊）放到最上面那一行。');
    }
    for (i = 0; i < traits.length; i++) {
      if (traits[i].nextNeed && traits[i].count > 0) {
        advice.push(traits[i].emoji + ' ' + traits[i].name + ' 再上 ' +
          (traits[i].nextNeed - traits[i].count) + ' 个就能到下一档：' +
          traits[i].next + '。');
        if (advice.length >= 4) break;      // 建议最多四条，多了没人看
      }
    }
    if (o.items && o.items.length) {
      advice.push('装备栏里还有 ' + o.items.length + ' 件没戴：点它，' +
        '再点一个棋子就装上了。');
    }
    if (!advice.length && defs.length) {
      advice.push('这套阵容的上场人数和羁绊都吃满了 —— 剩下的就是把钱花在升星上。');
    }

    return {
      count: defs.length, cap: cap,
      units: o.units || [],
      traits: traits,
      advice: advice
    };
  };

  /** 阵容详解要显示的那些行（返回字符串数组，方便自检/控制台直接读） */
  H.compLines = function (rep) {
    var out = [];
    out.push('上阵 ' + rep.count + (rep.cap ? '/' + rep.cap : '') + ' 人');
    for (var i = 0; i < rep.traits.length; i++) {
      var t = rep.traits[i];
      out.push(t.emoji + ' ' + t.name + ' ' + t.count +
        (t.on ? ('（' + (t.tier + 1) + ' 档：' + t.effect + '）')
              : '（还差 ' + (t.need - t.count) + ' 个生效）'));
    }
    return out;
  };
})();
