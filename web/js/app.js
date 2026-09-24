let D = null,
  talkSeed = 0,
  localLLMStatus = null,
  talkGenerationSeq = 0,
  talkAbort = null,
  setupDismissed = false;
const $ = (id) => document.getElementById(id);
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const fmt = (v, d = 2) => {
  const n = num(v);
  return n == null ? "—" : n.toFixed(d);
};
const pct = (v, d = 2) => {
  const n = num(v);
  return n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`;
};
const dateFmt = (s) =>
  s && String(s).length === 8
    ? `${String(s).slice(0, 4)}-${String(s).slice(4, 6)}-${String(s).slice(6)}`
    : s || "—";
const asc = (a, k) =>
  [...(a || [])].sort((x, y) =>
    String(x[k] || "").localeCompare(String(y[k] || "")),
  );
const desc = (a, k) =>
  [...(a || [])].sort((x, y) =>
    String(y[k] || "").localeCompare(String(x[k] || "")),
  );
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const median = (a) => {
  if (!a.length) return null;
  const x = [...a].sort((a, b) => a - b),
    m = Math.floor(x.length / 2);
  return x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2;
};
const stdev = (a) => {
  if (a.length < 2) return null;
  const m = avg(a);
  return Math.sqrt(avg(a.map((x) => (x - m) ** 2)));
};
const quantile = (a, v) => {
  const x = a.filter(Number.isFinite).sort((a, b) => a - b);
  if (!x.length || !Number.isFinite(v)) return null;
  return (x.filter((z) => z <= v).length / x.length) * 100;
};
const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[c],
  );
function ma(a, n, i = a.length - 1, key = "close") {
  if (i - n + 1 < 0) return null;
  return avg(
    a
      .slice(i - n + 1, i + 1)
      .map((x) => num(x[key]))
      .filter(Number.isFinite),
  );
}
function ret(a, n, i = a.length - 1) {
  if (i - n < 0) return null;
  const c = num(a[i].close),
    p = num(a[i - n].close);
  return c && p ? (c / p - 1) * 100 : null;
}
function volumeRatio(a, i = a.length - 1, n = 20) {
  if (i - n < 0) return null;
  const v = num(a[i].vol),
    base = avg(
      a
        .slice(i - n, i)
        .map((x) => num(x.vol))
        .filter(Number.isFinite),
    );
  return v != null && base ? v / base : null;
}
function rsi(a, n = 14) {
  if (a.length < n + 1) return null;
  let up = 0,
    dn = 0;
  for (let i = a.length - n; i < a.length; i++) {
    const d = num(a[i].close) - num(a[i - 1].close);
    if (d > 0) up += d;
    else dn -= d;
  }
  if (dn === 0) return 100;
  const rs = up / n / (dn / n);
  return 100 - 100 / (1 + rs);
}
function atrPct(a, n = 14) {
  if (a.length < n + 1) return null;
  let tr = [];
  for (let i = a.length - n; i < a.length; i++) {
    const h = num(a[i].high),
      l = num(a[i].low),
      pc = num(a[i - 1].close);
    if ([h, l, pc].every(Number.isFinite))
      tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const x = avg(tr),
    c = num(a.at(-1).close);
  return x && c ? (x / c) * 100 : null;
}
function maxDD(a, n = 60) {
  const x = a
    .slice(-n)
    .map((z) => num(z.close))
    .filter(Number.isFinite);
  if (x.length < 2) return null;
  let peak = x[0],
    dd = 0;
  for (const c of x) {
    peak = Math.max(peak, c);
    dd = Math.min(dd, (c / peak - 1) * 100);
  }
  return dd;
}
function calc(d) {
  const daily = asc(d.daily, "trade_date");
  const b = desc(d.daily_basic, "trade_date");
  const cur = daily.at(-1) || {},
    bl = b[0] || {};
  const fin = uniqueFina(desc(d.fina, "end_date"));
  const f = fin[0] || {};
  const money = desc(d.moneyflow, "trade_date")[0] || {};
  const pe = num(bl.pe_ttm ?? bl.pe),
    peHist = b.map((x) => num(x.pe_ttm ?? x.pe)).filter((x) => x > 0),
    pb = num(bl.pb),
    pbHist = b.map((x) => num(x.pb)).filter((x) => x > 0);
  const vr = volumeRatio(daily),
    r20 = ret(daily, 20),
    r60 = ret(daily, 60),
    m5 = ma(daily, 5),
    m20 = ma(daily, 20),
    m60 = ma(daily, 60),
    rv20 = stdev(
      daily
        .slice(-20)
        .map((x) => num(x.pct_chg))
        .filter(Number.isFinite),
    );
  const c = num(cur.close);
  const pos52 = (() => {
    const x = daily
      .slice(-240)
      .map((z) => num(z.close))
      .filter(Number.isFinite);
    if (!x.length || c == null) return null;
    const lo = Math.min(...x),
      hi = Math.max(...x);
    return hi === lo ? 50 : ((c - lo) / (hi - lo)) * 100;
  })();
  return {
    daily,
    cur,
    bl,
    fin,
    f,
    money,
    c,
    pe,
    pePct: quantile(peHist, pe),
    pb,
    pbPct: quantile(pbHist, pb),
    vr,
    r20,
    r60,
    m5,
    m20,
    m60,
    rsi: rsi(daily),
    atr: atrPct(daily),
    rv20: rv20 == null ? null : rv20 * Math.sqrt(250),
    dd60: maxDD(daily),
    pos52,
    cross: d.cross_section || {},
  };
}
function uniqueFina(arr) {
  const seen = new Set();
  return arr.filter((x) => {
    const k = String(x.end_date || "");
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
function questionInfo(q) {
  q = q || "";
  if (/公告|重组|监管函|处罚|业绩预告|减持|增持|回购/.test(q))
    return { intent: "公司事项", special: "event" };
  if (/买|卖|加仓|减仓|抄底|止损|目标价|还能不能|会不会涨|会不会跌/.test(q))
    return { intent: "交易问题", special: "trade" };
  if (/为什么|怎么跌|怎么涨|异动|大涨|大跌/.test(q))
    return { intent: "行情波动", special: "why" };
  if (/估值|pe|pb|贵不贵|便宜/.test(q))
    return { intent: "估值问题", special: "valuation" };
  if (/基本面|业绩|roe|利润|营收|财务/.test(q))
    return { intent: "基本面", special: "fund" };
  if (/风险|波动|回撤|趋势/.test(q))
    return { intent: "风险与趋势", special: "risk" };
  return { intent: "综合问题", special: "general" };
}
function oneMinute(d, m, q) {
  const qi = questionInfo(q);
  const cross = m.cross || {};
  const peerMedian = num(cross.peer_median_pct);
  const relativeReturn = num(cross.industry_adjusted_pct);
  const parts = [
    (d.stock.name || d.stock.ts_code) +
      "：最新交易日 " +
      pct(m.cur.pct_chg) +
      "，近20日 " +
      pct(m.r20) +
      "，成交量为近20日均量的 " +
      fmt(m.vr) +
      " 倍。",
  ];

  if (peerMedian != null) {
    const relativeLabel =
      relativeReturn == null
        ? ""
        : "个股相对行业中位 " +
          (relativeReturn >= 0 ? "高 " : "低 ") +
          fmt(Math.abs(relativeReturn)) +
          " 个百分点。";
    parts.push("行业当日中位 " + pct(peerMedian) + "。" + relativeLabel);
  }

  if (m.c != null && m.m20 != null) {
    parts.push("收盘价" + (m.c >= m.m20 ? "高于" : "低于") + "20日均线。");
  }

  parts.push(
    "年化20日波动 " + fmt(m.rv20) + "%，60日最大回撤 " + pct(m.dd60) + "。",
  );

  if (m.pe != null) {
    parts.push(
      "PE(TTM) " + fmt(m.pe) + "，自身历史分位 " + fmt(m.pePct, 0) + "%。",
    );
  }

  if (qi.special === "trade") {
    parts.push("这些指标不能单独得出买卖结论。");
  }

  if (qi.special === "event") {
    parts.push("公司事项请以正式披露信息为准。");
  }

  return parts.join(" ");
}
function analogs(m) {
  const a = m.daily;
  if (a.length < 70) return { rows: [], summary: null };
  const ci = a.length - 1,
    cr = num(a[ci].pct_chg) || 0,
    cvr = volumeRatio(a, ci) || 1,
    cr5 = ret(a, 5, ci) || 0;
  let cand = [];
  for (let i = 25; i <= a.length - 22; i++) {
    const r = num(a[i].pct_chg);
    if (r == null) continue;
    if (Math.abs(cr) > 0.8 && Math.sign(r) !== Math.sign(cr)) continue;
    const vr = volumeRatio(a, i) || 1,
      r5 = ret(a, 5, i) || 0;
    const dist =
      Math.abs(r - cr) / Math.max(1.1, Math.abs(cr) * 0.45 + 0.6) +
      Math.abs(Math.log((vr + 0.1) / (cvr + 0.1))) * 1.4 +
      Math.abs(r5 - cr5) / 4.5;
    const c = num(a[i].close),
      f1 = num(a[i + 1]?.close),
      f5 = num(a[i + 5]?.close),
      f20 = num(a[i + 20]?.close);
    if (!c || !f1 || !f5 || !f20) continue;
    cand.push({
      date: a[i].trade_date,
      r,
      vr,
      r5,
      sim: clamp(100 - dist * 18),
      t1: (f1 / c - 1) * 100,
      t5: (f5 / c - 1) * 100,
      t20: (f20 / c - 1) * 100,
      dist,
    });
  }
  cand.sort((x, y) => x.dist - y.dist);
  const rows = cand.slice(0, 10);
  if (!rows.length) return { rows, summary: null };
  const sm = {
    n: rows.length,
    t1: median(rows.map((x) => x.t1)),
    t5: median(rows.map((x) => x.t5)),
    t20: median(rows.map((x) => x.t20)),
    p1: (rows.filter((x) => x.t1 > 0).length / rows.length) * 100,
    p5: (rows.filter((x) => x.t5 > 0).length / rows.length) * 100,
    p20: (rows.filter((x) => x.t20 > 0).length / rows.length) * 100,
  };
  return { rows, summary: sm };
}
function abnormalDays(m) {
  const a = m.daily,
    out = [];
  for (let i = 25; i < a.length; i++) {
    const hist = a
        .slice(i - 20, i)
        .map((x) => num(x.pct_chg))
        .filter(Number.isFinite),
      sd = stdev(hist) || 1,
      rr = num(a[i].pct_chg) || 0,
      vr = volumeRatio(a, i) || 1,
      score = Math.abs(rr) / sd + Math.max(vr - 1, 0) * 0.9;
    if (score > 1.8)
      out.push({
        date: a[i].trade_date,
        r: rr,
        vr,
        score,
        next5: i + 5 < a.length ? ret(a, 5, i + 5) : null,
      });
  }
  return out.sort((x, y) => y.score - x.score).slice(0, 8);
}
function fundTrend(m) {
  return m.fin.slice(0, 5);
}
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}
function pick(arr, seed) {
  return arr[((seed % arr.length) + arr.length) % arr.length];
}
function talkVersions(d, m, q, tone, seed) {
  const qi = questionInfo(q);
  const cross = m.cross || {};
  const relativeReturn = num(cross.industry_adjusted_pct);
  const marketMedian = num(cross.market_median_pct);
  const peerMedian = num(cross.peer_median_pct);
  const base = hash((d.stock.ts_code || "") + q + tone) + seed * 37;
  const openers = {
    natural: [
      "我先把近期能确认的数据和您说明一下。",
      "我们先看看今天和近一段时间的表现。",
      "我先按目前的行情数据给您说明。",
    ],
    professional: [
      "以下内容根据近期行情和公开财务数据整理。",
      "目前可以确认的是以下行情和财务指标。",
      "我先说明数据表现及其适用范围。",
    ],
    simple: [
      "先看最近这段时间的数字。",
      "我们先看行情，再看公司数据。",
      "先了解目前能确认的情况。",
    ],
  };
  const market =
    marketMedian == null
      ? "市场对照数据暂缺。"
      : "全市场当日中位涨跌 " +
        pct(marketMedian) +
        (peerMedian == null
          ? "。"
          : "，行业中位涨跌 " + pct(peerMedian) + "。");
  const relative =
    relativeReturn == null
      ? ""
      : "个股相对行业中位" +
        (relativeReturn >= 0 ? "高 " : "低 ") +
        fmt(Math.abs(relativeReturn)) +
        " 个百分点。";
  const behavior =
    "个股当日涨跌 " +
    pct(m.cur.pct_chg) +
    "，近20日涨跌 " +
    pct(m.r20) +
    "，成交量为近20日均量的 " +
    fmt(m.vr) +
    " 倍，60日最大回撤 " +
    pct(m.dd60) +
    "。";
  const valuation =
    m.pe == null
      ? "估值数据暂缺。"
      : "市盈率（TTM） " +
        fmt(m.pe) +
        "，自身历史分位 " +
        fmt(m.pePct, 0) +
        "%。";
  const financial =
    num(m.f.netprofit_yoy) != null || num(m.f.roe ?? m.f.roe_waa) != null
      ? "ROE " +
        fmt(m.f.roe ?? m.f.roe_waa) +
        "%，净利润同比 " +
        pct(m.f.netprofit_yoy) +
        "。"
      : "财务数据暂缺。";
  const boundary =
    qi.special === "trade"
      ? "这些指标不能单独作为买卖依据。"
      : qi.special === "event"
        ? "公司公告和其他事项请以正式披露信息为准。"
        : "这些数据不能单独说明涨跌原因。";
  const next =
    qi.special === "why"
      ? "需要继续查看走势相近的历史交易日吗？"
      : qi.special === "valuation"
        ? "还可以结合盈利增速一起看估值。"
        : "您还想了解走势、估值还是财务数据？";
  const opener = pick(openers[tone] || openers.natural, base);
  const shortFacts = market + relative + behavior + boundary;
  const short = opener + shortFacts;
  const spokenFacts =
    market +
    relative +
    behavior +
    "\n\n" +
    valuation +
    financial +
    "\n\n" +
    boundary +
    next;
  const spoken =
    opener +
    "\n\n" +
    spokenFacts;
  const detailed =
    "市场与行业：" +
    market +
    relative +
    "\n个股走势：" +
    behavior +
    "\n估值与财务：" +
    valuation +
    financial +
    "\n注意：" +
    boundary +
    "\n后续：" +
    next;
  const conciseFacts = market + relative + behavior + boundary;
  const concise = "先看近期数据。" + conciseFacts;

  return [
    { title: "简短回复", text: short, modelText: shortFacts },
    { title: "口头回复", text: spoken, modelText: spokenFacts },
    { title: "完整说明", text: detailed, modelText: detailed },
    { title: "简要说明", text: concise, modelText: conciseFacts },
  ];
}
function followups(q, m) {
  const qi = questionInfo(q);
  let questions = [];

  if (qi.special === "why") {
    questions = [
      "需要查看所属行业今天的涨跌吗？",
      "要继续看近20日走势和成交量吗？",
      "需要列出走势相近的历史交易日吗？",
    ];
  } else if (qi.special === "trade") {
    questions = [
      "您关注短期波动还是长期经营？",
      "先看估值还是近期波动？",
      "需要补充财务指标吗？",
    ];
  } else if (qi.special === "valuation") {
    questions = [
      "要和公司自身历史估值对比吗？",
      "需要结合盈利增速一起看吗？",
      "要一起查看市盈率、市净率和ROE吗？",
    ];
  } else if (qi.special === "fund") {
    questions = [
      "您更关注营收还是净利润变化？",
      "要查看最近几个报告期的数据吗？",
      "需要一起看ROE和资产负债率吗？",
    ];
  } else if (qi.special === "event") {
    questions = [
      "请先核对公司正式公告。",
      "可以粘贴公告内容，再结合行情分析。",
      "需要查看公告日前后的价格变化吗？",
    ];
  } else {
    questions = [
      "您想先看趋势、估值还是财务？",
      "需要查看历史行情对照吗？",
      "需要一份简短的客户回复吗？",
    ];
  }

  return questions;
}
function complianceCheck(t) {
  const rules = [
    [/肯定|一定会|必涨|必跌|百分百|稳赚|稳稳|不会亏|保本/g, "确定性承诺"],
    [
      /抄底|赶紧买|直接买|可以买入|建议买入|卖掉|赶紧卖|建议卖出|加仓|满仓/g,
      "直接交易指令",
    ],
    [/目标价|看到\s*\d+|涨到\s*\d+|跌到\s*\d+/g, "目标价格表述"],
    [
      /主力洗盘|主力吸筹|庄家|内幕|有人控盘|机构在出货/g,
      "未经核实的交易主体判断",
    ],
    [/利好必涨|利空必跌|就是因为|肯定是因为/g, "原因判断过于确定"],
  ];
  let flags = [];
  for (const [re, n] of rules) {
    if (re.test(t)) {
      flags.push(n);
      re.lastIndex = 0;
    }
  }
  let r = t;
  r = r
    .replace(/肯定会涨|一定会涨|必涨/g, "后续表现仍存在不确定性")
    .replace(/肯定会跌|一定会跌|必跌/g, "后续仍可能存在波动")
    .replace(/稳赚|百分百|不会亏|保本/g, "不能仅据此判断未来收益")
    .replace(
      /抄底|赶紧买|直接买|可以买入|建议买入/g,
      "可以先结合投资期限、风险承受能力和公开信息进一步判断",
    )
    .replace(
      /赶紧卖|卖掉|建议卖出/g,
      "可以先结合风险承受能力和投资目标重新评估",
    )
    .replace(
      /主力洗盘|主力吸筹|庄家|有人控盘|机构在出货/g,
      "从公开数据无法确认特定交易主体意图",
    )
    .replace(/就是因为|肯定是因为/g, "可能与多种因素同时相关，不能仅归因于");
  if (/目标价/.test(t))
    r += "\n\n建议：避免使用具体目标价，可说明估值依据和相关风险。";
  return { flags: [...new Set(flags)], rewrite: r || "未输入文本" };
}
function render(d) {
  D = d;
  const m = calc(d);
  const q = d.question || $("questionInput").value;
  $("results").hidden = false;
  $("stockHead").classList.add("show");
  $("name").textContent = d.stock.name || d.stock.ts_code;
  $("code").textContent = d.stock.ts_code || "";
  $("meta").textContent =
    [d.stock.industry, d.stock.market, d.stock.area]
      .filter(Boolean)
      .join(" · ") || "公开市场数据";
  $("price").textContent = fmt(m.cur.close);
  $("price").className =
    "price " +
    (num(m.cur.pct_chg) > 0 ? "up" : num(m.cur.pct_chg) < 0 ? "down" : "flat");
  $("pct").textContent =
    "最新交易日 " + dateFmt(m.cur.trade_date) + " · " + pct(m.cur.pct_chg);
  $("ret20").textContent = pct(m.r20);
  $("trendHint").textContent =
    m.c != null && m.m20 != null
      ? "收盘价" +
        (m.c >= m.m20 ? "高于" : "低于") +
        "20日均线 " +
        pct((m.c / m.m20 - 1) * 100)
      : "均线数据不足";
  $("vr").textContent = m.vr == null ? "—" : fmt(m.vr) + " 倍";
  $("volumeHint").textContent =
    m.vr == null
      ? "成交量数据不足"
      : m.vr > 1.8
        ? "高于近期均量"
        : m.vr > 1.2
          ? "略高于近期均量"
          : m.vr < 0.75
            ? "低于近期均量"
            : "接近近期均量";
  const industryDifference = num(m.cross.industry_adjusted_pct);
  $("peerAdj").textContent =
    industryDifference == null
      ? "—"
      : (industryDifference > 0 ? "+" : industryDifference < 0 ? "−" : "") +
        fmt(Math.abs(industryDifference)) +
        " 个百分点";
  $("peerAdj").className =
    "metric-value " +
    (industryDifference > 0 ? "up" : industryDifference < 0 ? "down" : "flat");
  $("peerHint").textContent =
    num(m.cross.peer_median_pct) == null
      ? "行业数据暂缺"
      : (m.cross.industry || d.stock.industry || "行业") +
        "当日中位 " +
        pct(m.cross.peer_median_pct);
  $("pePos").textContent = m.pePct == null ? "—" : fmt(m.pePct, 0) + "%";
  $("peHint").textContent =
    m.pe == null ? "估值数据暂缺" : "PE(TTM)自身历史分位";
  $("intent").textContent = questionInfo(q).intent;
  $("oneMin").textContent = oneMinute(d, m, q);

  renderFollowups(q, m);
  renderDeep(d, m);
  renderMirror(m);
  renderTalk(d, m, q);
  renderAvailability(d);

  const sourceNames = {
    daily: "行情",
    daily_basic: "估值",
    fina: "财务",
    moneyflow: "资金流",
    market_snapshot: "市场对照",
  };
  const missing = Object.keys(d.errors || {}).map(
    (key) => sourceNames[key] || "其他数据",
  );
  if (missing.length) {
    setBanner(
      "部分数据暂不可用：" + [...new Set(missing)].join("、") + "。",
      "warn",
    );
  } else {
    setBanner("");
  }

  if ($("deep").classList.contains("active")) drawChart(m.daily);
}
function renderDeep(d, m) {
  const indicators = [
    ["MA5", fmt(m.m5), "5日均线"],
    ["MA20", fmt(m.m20), "20日均线"],
    ["MA60", fmt(m.m60), "60日均线"],
    [
      "RSI(14)",
      fmt(m.rsi, 0),
      m.rsi != null && m.rsi > 70
        ? "高于70"
        : m.rsi != null && m.rsi < 30
          ? "低于30"
          : "30至70",
    ],
    [
      "ATR占价格比例",
      m.atr == null ? "—" : fmt(m.atr) + "%",
      "14日平均真实波幅",
    ],
    [
      "20日年化波动",
      m.rv20 == null ? "—" : fmt(m.rv20) + "%",
      "根据历史日收益率估算",
    ],
    ["60日最大回撤", pct(m.dd60), "相对区间高点"],
    [
      "52周价格区间位置",
      m.pos52 == null ? "—" : fmt(m.pos52, 0) + "%",
      "相对近240个交易日高低点",
    ],
  ];

  $("quantGrid").innerHTML = indicators
    .map(
      (item) =>
        '<div class="metric-tile">' +
        '<div class="metric-tile-label">' +
        esc(item[0]) +
        '</div><div class="metric-tile-value">' +
        esc(item[1]) +
        '</div><div class="metric-tile-note">' +
        esc(item[2]) +
        "</div></div>",
    )
    .join("");

  const f = m.f;
  const financialRows = [
    ["ROE", f.roe ?? f.roe_waa, "%"],
    ["营收同比", f.or_yoy ?? f.op_income_yoy, "%"],
    ["净利润同比", f.netprofit_yoy, "%"],
    ["毛利率", f.grossprofit_margin ?? f.gross_margin, "%"],
    ["资产负债率", f.debt_to_assets, "%"],
    ["EPS", f.eps, ""],
  ];
  const hasFinancialData = financialRows.some((row) => num(row[1]) != null);
  $("fundLatest").innerHTML = hasFinancialData
    ? financialRows
        .map(
          (row) =>
            '<div class="kv"><span>' +
            esc(row[0]) +
            "</span><span>" +
            fmt(row[1]) +
            (num(row[1]) == null ? "" : row[2]) +
            "</span></div>",
        )
        .join("")
    : '<p class="empty">暂无财务数据</p>';

  const reports = fundTrend(m);
  $("fundTrend").innerHTML = reports.length
    ? reports
        .map((row, index) => {
          const profitGrowth = num(row.netprofit_yoy);
          const revenueGrowth = num(row.or_yoy ?? row.op_income_yoy);
          const previousProfitGrowth = num(reports[index + 1]?.netprofit_yoy);
          const change =
            profitGrowth != null && previousProfitGrowth != null
              ? profitGrowth > previousProfitGrowth
                ? "改善"
                : "回落"
              : "无对照";
          const changeClass =
            change === "改善" ? "f" : change === "回落" ? "a" : "";

          return (
            '<article class="item"><div class="item-top"><span class="item-title">' +
            esc(dateFmt(row.end_date)) +
            '</span><span class="pill ' +
            changeClass +
            '">' +
            change +
            '</span></div><p class="item-text">营收同比 ' +
            pct(revenueGrowth) +
            " · 净利润同比 " +
            pct(profitGrowth) +
            " · ROE " +
            fmt(row.roe ?? row.roe_waa) +
            "%</p></article>"
          );
        })
        .join("")
    : '<p class="empty">暂无财务报告数据</p>';

  const unusualDays = abnormalDays(m);
  $("abnormal").innerHTML = unusualDays.length
    ? unusualDays
        .map(
          (day) =>
            '<article class="item"><div class="item-top"><span class="item-title">' +
            esc(dateFmt(day.date)) +
            " · " +
            pct(day.r) +
            '</span></div><p class="item-text">当日成交量为此前20日均量的 ' +
            fmt(day.vr) +
            " 倍。</p></article>",
        )
        .join("")
    : '<p class="empty">暂无明显偏离近期水平的数据</p>';
}
function renderMirror(m) {
  const result = analogs(m);
  if (!result.summary) {
    $("mirrorSummary").innerHTML = '<p class="empty">暂无足够历史数据</p>';
    $("mirrorRows").innerHTML = "";
    return;
  }

  const summary = result.summary;
  $("mirrorSummary").innerHTML =
    '<div class="history-stats">' +
    '<div class="history-stat"><div class="history-stat-label">相似样本数</div><div class="history-stat-value">' +
    summary.n +
    "</div></div>" +
    '<div class="history-stat"><div class="history-stat-label">后5日中位数</div><div class="history-stat-value ' +
    (summary.t5 >= 0 ? "up" : "down") +
    '">' +
    pct(summary.t5) +
    '</div><div class="history-stat-note">上涨占比 ' +
    fmt(summary.p5, 0) +
    "%</div></div>" +
    '<div class="history-stat"><div class="history-stat-label">后20日中位数</div><div class="history-stat-value ' +
    (summary.t20 >= 0 ? "up" : "down") +
    '">' +
    pct(summary.t20) +
    '</div><div class="history-stat-note">上涨占比 ' +
    fmt(summary.p20, 0) +
    "%</div></div></div>";

  $("mirrorRows").innerHTML = result.rows
    .map(
      (row) =>
        "<tr><td>" +
        esc(dateFmt(row.date)) +
        '</td><td class="' +
        (row.r >= 0 ? "up" : "down") +
        '">' +
        pct(row.r) +
        "</td><td>" +
        fmt(row.vr) +
        '</td><td class="' +
        (row.r5 >= 0 ? "up" : "down") +
        '">' +
        pct(row.r5) +
        '</td><td aria-label="相似度 ' +
        fmt(row.sim, 0) +
        ' 百分比">' +
        fmt(row.sim, 0) +
        '%</td><td class="' +
        (row.t1 >= 0 ? "up" : "down") +
        '">' +
        pct(row.t1) +
        '</td><td class="' +
        (row.t5 >= 0 ? "up" : "down") +
        '">' +
        pct(row.t5) +
        '</td><td class="' +
        (row.t20 >= 0 ? "up" : "down") +
        '">' +
        pct(row.t20) +
        "</td></tr>",
    )
    .join("");
}
function renderTalk(d, m, q) {
  const tone = $("tone").value;
  const versions = talkVersions(d, m, q, tone, talkSeed);
  showTalkVersions(versions);

  $("talkFollowups").innerHTML = followups(q, m)
    .map((text) => '<button type="button">' + esc(text) + "</button>")
    .join("");

  document.querySelectorAll("#talkFollowups button").forEach((button) => {
    button.addEventListener("click", () => {
      $("questionInput").value = button.textContent;
      $("analysisForm").requestSubmit();
    });
  });

  requestTalkVersions(q, versions);
}

function showTalkVersions(versions) {
  $("talkGrid").innerHTML = versions
    .map(
      (version, index) =>
        '<article class="talk-card"><header><strong>' +
        esc(version.title) +
        '</strong><button class="copy" type="button" data-idx="' +
        index +
        '">复制</button></header><div class="talk-text">' +
        esc(version.text) +
        "</div></article>",
    )
    .join("");

  document.querySelectorAll(".copy").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(
          versions[Number(button.dataset.idx)].text,
        );
        button.textContent = "已复制";
        window.setTimeout(() => {
          button.textContent = "复制";
        }, 1600);
      } catch {
        setBanner("复制失败，请手动选择文字复制。", "err");
      }
    });
  });
}

async function requestTalkVersions(q, drafts) {
  talkGenerationSeq += 1;
  const generationId = talkGenerationSeq;
  if (talkAbort) talkAbort.abort();

  if (!localLLMStatus || !localLLMStatus.ready) {
    $("talkModelStatus").textContent =
      localLLMStatus && localLLMStatus.status === "failed"
        ? "本地话术助手暂不可用，当前显示基础回复建议。"
        : "本地话术助手正在配置，当前显示基础回复建议。";
    return;
  }

  const controller = new AbortController();
  talkAbort = controller;
  $("talkModelStatus").textContent = "正在本机生成回复…";
  $("refreshTalk").disabled = true;
  $("tone").disabled = true;

  try {
    const response = await fetch("/api/talk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        question: q,
        tone: $("tone").value,
        seed: talkSeed,
        drafts: drafts.map((draft) => ({
          title: draft.title,
          text: draft.modelText || draft.text,
        })),
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok || !Array.isArray(result.replies)) {
      throw new Error("generation failed");
    }
    if (generationId !== talkGenerationSeq) return;
    showTalkVersions(result.replies);
    $("talkModelStatus").textContent = "由本地话术助手生成，数据依据保持不变。";
  } catch (error) {
    if (error.name !== "AbortError" && generationId === talkGenerationSeq) {
      $("talkModelStatus").textContent =
        "本次生成未通过校验，当前显示基础回复建议。";
    }
  } finally {
    if (generationId === talkGenerationSeq) {
      $("refreshTalk").disabled = false;
      $("tone").disabled = false;
      talkAbort = null;
    }
  }
}
function renderFollowups(q, m) {
  $("followups").innerHTML = followups(q, m)
    .map((text) => '<button type="button">' + esc(text) + "</button>")
    .join("");

  document.querySelectorAll("#followups button").forEach((button) => {
    button.addEventListener("click", () => {
      $("questionInput").value = button.textContent;
      $("analysisForm").requestSubmit();
    });
  });
}
function renderAvailability(d) {
  const sources = [
    ["daily", "行情"],
    ["daily_basic", "估值与换手"],
    ["fina", "财务"],
    ["moneyflow", "资金流"],
    ["cross_section", "市场对照"],
  ];

  $("availability").innerHTML = sources
    .map(([key, label]) => {
      const available =
        key === "cross_section" ? Boolean(d[key]) : (d[key] || []).length > 0;
      const state = available ? "good" : "amber";
      const text = available ? "可用" : "不可用";

      return (
        '<div class="kv"><span>' +
        label +
        '</span><span class="' +
        state +
        '">' +
        text +
        "</span></div>"
      );
    })
    .join("");
}
function drawChart(data) {
  const canvas = $("chart");
  const context = canvas.getContext("2d");
  const bounds = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;

  if (bounds.width === 0 || bounds.height === 0) return;

  canvas.width = Math.round(bounds.width * ratio);
  canvas.height = Math.round(bounds.height * ratio);
  context.scale(ratio, ratio);
  context.clearRect(0, 0, bounds.width, bounds.height);

  const rows = data
    .slice(-120)
    .filter((row) => Number.isFinite(num(row.close)));
  if (rows.length < 2) {
    context.fillStyle = getComputedStyle(document.documentElement)
      .getPropertyValue("--chart-label")
      .trim();
    context.font = "13px sans-serif";
    context.fillText("行情数据不足", 12, 22);
    canvas.setAttribute("aria-label", "行情数据不足，无法绘制收盘价走势");
    return;
  }

  const values = rows.map((row) => num(row.close));
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padding = (high - low) * 0.08 || Math.abs(high) * 0.02 || 1;
  const minValue = low - padding;
  const maxValue = high + padding;
  const plot = {
    left: 8,
    right: bounds.width - 62,
    top: 12,
    bottom: bounds.height - 30,
  };
  const styles = getComputedStyle(document.documentElement);
  const gridColor = styles.getPropertyValue("--chart-grid").trim();
  const labelColor = styles.getPropertyValue("--chart-label").trim();
  const lineColor = styles.getPropertyValue("--chart-line").trim();

  context.font = "12px sans-serif";
  context.textAlign = "right";
  context.textBaseline = "middle";

  for (let index = 0; index <= 4; index += 1) {
    const y = plot.top + ((plot.bottom - plot.top) * index) / 4;
    const value = maxValue - ((maxValue - minValue) * index) / 4;

    context.strokeStyle = gridColor;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(plot.left, y);
    context.lineTo(plot.right, y);
    context.stroke();

    context.fillStyle = labelColor;
    context.fillText(fmt(value), bounds.width - 4, y);
  }

  context.strokeStyle = lineColor;
  context.lineWidth = 2;
  context.beginPath();
  rows.forEach((row, index) => {
    const x =
      plot.left + ((plot.right - plot.left) * index) / (rows.length - 1);
    const y =
      plot.top +
      (plot.bottom - plot.top) *
        (1 - (num(row.close) - minValue) / (maxValue - minValue));

    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();

  context.fillStyle = labelColor;
  context.textAlign = "left";
  context.textBaseline = "top";
  context.fillText(dateFmt(rows[0].trade_date), plot.left, plot.bottom + 8);
  context.textAlign = "right";
  context.fillText(
    dateFmt(rows[rows.length - 1].trade_date),
    plot.right,
    plot.bottom + 8,
  );
  canvas.setAttribute(
    "aria-label",
    "收盘价走势，" +
      dateFmt(rows[0].trade_date) +
      "至" +
      dateFmt(rows[rows.length - 1].trade_date) +
      "，最低 " +
      fmt(low) +
      " 元，最高 " +
      fmt(high) +
      " 元",
  );
}
function setBanner(message, type = "warn") {
  const banner = $("banner");
  banner.textContent = message || "";
  banner.className = message ? "banner show " + type : "banner";
}
async function health() {
  const indicator = document.querySelector(".status-indicator");

  try {
    const response = await fetch("/api/health");
    if (!response.ok) throw new Error("health request failed");
    const result = await response.json();

    if (result.token_configured) {
      $("serverStatus").textContent = "服务已连接";
      indicator.className = "status-indicator connected";
    } else {
      $("serverStatus").textContent = "数据服务未配置";
      indicator.className = "status-indicator warning";
    }
  } catch {
    $("serverStatus").textContent = "服务未连接";
    indicator.className = "status-indicator warning";
    setBanner("无法连接本地服务，请通过启动器重新打开应用。", "err");
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(2) + " GB";
  return Math.round(bytes / 1024 ** 2) + " MB";
}

function renderLocalLLMStatus(status) {
  const wasReady = Boolean(localLLMStatus && localLLMStatus.ready);
  localLLMStatus = status;
  const panel = $("llmSetup");
  const title = $("llmSetupTitle");
  const message = $("llmSetupMessage");
  const detail = $("llmSetupDetail");
  const percent = $("llmSetupPercent");
  const progress = document.querySelector(".setup-progress");
  const fill = $("llmSetupProgress");
  const actions = $("llmSetupActions");
  const appContent = $("appContent");
  const retryButton = $("retryLlmSetup");

  if (status.status === "ready") {
    appContent.hidden = false;
    if (wasReady) {
      panel.hidden = true;
      return;
    }
    title.textContent = "本地话术助手已准备好";
    message.textContent = "回复建议将在此电脑上生成。";
    detail.textContent = "模型已保存在项目内，之后启动无需重新下载。";
    percent.textContent = "100%";
    fill.style.width = "100%";
    progress.setAttribute("aria-valuenow", "100");
    actions.hidden = true;
    if (!setupDismissed) panel.hidden = false;
    if (!wasReady && D) {
      renderTalk(D, calc(D), $("questionInput").value);
    }
    if (!setupDismissed) {
      window.clearTimeout(panel.hideTimer);
      panel.hideTimer = window.setTimeout(() => {
        if (localLLMStatus && localLLMStatus.ready) panel.hidden = true;
      }, 2200);
    }
    return;
  }

  panel.hidden = setupDismissed;
  actions.hidden = status.status !== "failed";
  if (status.status === "failed") {
    const incompatible = Boolean(status.incompatible);
    title.textContent = incompatible
      ? "启动程序需要更新"
      : "本地话术助手未能启动";
    message.textContent = incompatible
      ? "当前启动程序和网页版本不匹配。"
      : "可以重试配置，也可以先继续使用基础回复建议。";
    detail.textContent = incompatible
      ? "请解压最新的完整项目包，再通过启动脚本打开。"
      : "请检查网络连接后重试。";
    percent.textContent = "";
    fill.style.width = "0%";
    progress.setAttribute("aria-valuenow", "0");
    retryButton.hidden = incompatible;
    if (D) {
      $("talkModelStatus").textContent =
        "本地话术助手暂不可用，当前显示基础回复建议。";
    }
    return;
  }

  title.textContent = "正在配置本地话术助手";
  retryButton.hidden = false;
  const phaseText = {
    checking: "正在检查本地运行环境…",
    preparing_runtime: "正在准备本地运行环境…",
    downloading_model: "正在下载中文模型…",
    verifying: "正在校验模型文件…",
    starting_model: "正在启动本地模型…",
  };
  message.textContent = phaseText[status.phase] || status.message || "正在配置…";
  if (status.phase === "downloading_model") {
    detail.textContent =
      "已下载 " +
      formatBytes(status.downloaded) +
      " / " +
      formatBytes(status.total) +
      "。模型约 1.3 GB，只需下载一次。";
    percent.textContent = status.progress + "%";
    fill.style.width = status.progress + "%";
    progress.setAttribute("aria-valuenow", String(status.progress));
  } else {
    detail.textContent = "首次配置需要一些时间，完成后话术生成将在本地运行。";
    percent.textContent = "";
    fill.style.width = "28%";
    progress.setAttribute("aria-valuenow", "0");
  }
  if (D) {
    $("talkModelStatus").textContent =
      "本地话术助手正在配置，当前显示基础回复建议。";
  }
}

async function refreshLocalLLMStatus() {
  try {
    const response = await fetch("/api/llm/status", { cache: "no-store" });
    if (response.ok) {
      renderLocalLLMStatus(await response.json());
    } else if (response.status === 404) {
      renderLocalLLMStatus({
        status: "failed",
        phase: "failed",
        ready: false,
        incompatible: true,
      });
    }
  } catch {
    // Keep the initial setup message visible while the local service starts.
  }
}

function pollLocalLLMStatus() {
  refreshLocalLLMStatus().finally(() => {
    const delay = localLLMStatus && ["ready", "failed"].includes(localLLMStatus.status)
      ? 2500
      : 600;
    window.setTimeout(pollLocalLLMStatus, delay);
  });
}

$("retryLlmSetup").addEventListener("click", async () => {
  setupDismissed = false;
  $("llmSetup").hidden = false;
  $("llmSetupTitle").textContent = "正在重新配置本地话术助手";
  $("llmSetupMessage").textContent = "正在重新连接模型下载服务…";
  $("llmSetupActions").hidden = true;
  try {
    await fetch("/api/llm/retry", { method: "POST" });
  } catch {
    $("llmSetupMessage").textContent = "无法连接本地服务，请重新启动应用。";
  }
  refreshLocalLLMStatus();
});

$("dismissLlmSetup").addEventListener("click", () => {
  setupDismissed = true;
  $("llmSetup").hidden = true;
  $("appContent").hidden = false;
});
async function query() {
  const stock = $("stockInput").value.trim();
  const question = $("questionInput").value.trim();

  if (!stock) {
    setBanner("请输入股票代码或名称。", "err");
    $("stockInput").focus();
    return;
  }

  $("go").disabled = true;
  $("go").setAttribute("aria-busy", "true");
  $("loading").classList.add("show");
  $("results").hidden = true;

  try {
    const response = await fetch(
      "/api/analyze?q=" +
        encodeURIComponent(stock) +
        "&question=" +
        encodeURIComponent(question),
    );
    const result = await response.json();

    if (!response.ok || !result.ok) {
      throw new Error(result.error || "查询失败");
    }

    render(result.data);
  } catch (error) {
    setBanner("分析失败：" + error.message, "err");
  } finally {
    $("go").disabled = false;
    $("go").removeAttribute("aria-busy");
    $("loading").classList.remove("show");
  }
}
$("analysisForm").addEventListener("submit", (event) => {
  event.preventDefault();
  query();
});

function activateTab(selectedTab) {
  document.querySelectorAll(".tab").forEach((tab) => {
    const selected = tab === selectedTab;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;

    const panel = $(tab.dataset.tab);
    panel.classList.toggle("active", selected);
    panel.hidden = !selected;
  });

  if (selectedTab.dataset.tab === "deep" && D) {
    drawChart(calc(D).daily);
  }
}

const tabs = [...document.querySelectorAll(".tab")];
tabs.forEach((tab) => {
  tab.addEventListener("click", () => activateTab(tab));
  tab.addEventListener("keydown", (event) => {
    const currentIndex = tabs.indexOf(tab);
    let nextIndex = currentIndex;

    if (event.key === "ArrowRight")
      nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === "ArrowLeft")
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else return;

    event.preventDefault();
    tabs[nextIndex].focus();
    activateTab(tabs[nextIndex]);
  });
});

$("refreshTalk").addEventListener("click", () => {
  if (!D) {
    setBanner("请先分析一只股票。", "warn");
    return;
  }

  talkSeed += 1;
  renderTalk(D, calc(D), $("questionInput").value);
});

$("tone").addEventListener("change", () => {
  if (D) renderTalk(D, calc(D), $("questionInput").value);
});

$("checkDraft").addEventListener("click", () => {
  const result = complianceCheck($("draft").value);
  $("flags").innerHTML = result.flags.length
    ? result.flags
        .map((flag) => '<span class="flag">' + esc(flag) + "</span>")
        .join("")
    : '<span class="pill f">未命中已配置规则</span>';
  $("rewrite").textContent = result.rewrite;
});

window.addEventListener("resize", () => {
  if (D && $("deep").classList.contains("active")) {
    drawChart(calc(D).daily);
  }
});

health();
pollLocalLLMStatus();
