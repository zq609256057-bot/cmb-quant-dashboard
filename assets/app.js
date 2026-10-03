/* CMB_MULTI_BANK_MULTI_MODEL_FRONTEND_CONTRACT_V1 — presentation only.
 *
 * The browser NEVER scores, thresholds, computes V04 / RS60 / PIT / forward
 * aggregation or risk overlay (§29).  Every business number is read as the
 * pre-formatted `d` field produced by
 * CMB_FRONTEND_GLOBAL_NUMERIC_DISPLAY_CONTRACT_V1 in Python Decimal
 * ROUND_HALF_UP.  `r` (raw text) is carried for parity/plotting only and is
 * never re-rounded with Math.round (§19).
 */
(function () {
  "use strict";

  var DATA_ROOT = "assets/data";
  var DEFAULT_BANK = "CMB";
  var DEFAULT_MODEL = "CMB_SCORE_MODEL_V3";
  var FRESH_ROOT_DEFAULTS = { bank: DEFAULT_BANK, model: DEFAULT_MODEL };

  var STATE = {
    bank: DEFAULT_BANK,
    model: DEFAULT_MODEL,
    date: null,
    banks: null,
    models: null,
    index: null,
    day: null,
    history: null,
    yearCache: {},
    chartState: null,
    tooltipState: null
  };

  var $ = function (id) { return document.getElementById(id); };

  function disp(cell) {
    if (cell === null || cell === undefined) return "—";
    if (typeof cell === "object") return cell.d === undefined ? "—" : cell.d;
    return String(cell);
  }
  function rawNum(cell) {
    if (!cell || cell.r === null || cell.r === undefined) return null;
    var v = parseFloat(cell.r);
    return isFinite(v) ? v : null;
  }
  function txt(v) { return (v === null || v === undefined || v === "") ? "—" : String(v); }

  function urlParams() {
    var q = new URLSearchParams(window.location.search);
    return { bank: q.get("bank"), model: q.get("model"), date: q.get("date") };
  }
  function pushUrl(replace) {
    var q = new URLSearchParams();
    q.set("bank", STATE.bank);
    q.set("model", STATE.model);
    if (STATE.date) q.set("date", STATE.date);
    var u = window.location.pathname + "?" + q.toString();
    if (replace) window.history.replaceState({ bank: STATE.bank, model: STATE.model, date: STATE.date }, "", u);
    else window.history.pushState({ bank: STATE.bank, model: STATE.model, date: STATE.date }, "", u);
  }

  function fetchJson(path) {
    return fetch(path, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status + " " + path);
      return r.json();
    });
  }

  /* ---------------------------------------------------------- selectors */
  function renderBankSelector() {
    var sel = $("bank-select");
    sel.innerHTML = "";
    STATE.banks.banks.forEach(function (b) {
      var o = document.createElement("option");
      o.value = b.institution_id;
      o.textContent = b.institution_name_zh + " " + b.instrument_id;
      if (b.institution_id === STATE.bank) o.selected = true;
      sel.appendChild(o);
    });
    sel.setAttribute("aria-label", "银行选择");
    // §4 — always visible, even with a single option (never hidden).
    sel.disabled = false;
  }

  function renderModelSelector() {
    var bank = null;
    STATE.banks.banks.forEach(function (b) { if (b.institution_id === STATE.bank) bank = b; });
    STATE.models = bank ? bank.models : [];
    var sel = $("model-select");
    sel.innerHTML = "";
    STATE.models.forEach(function (m) {
      var o = document.createElement("option");
      o.value = m.model_id;
      /* §9 — selection role and operational status are separate things. */
      o.textContent = m.model_id + " · " + (m.selection_label_zh || "");
      if (m.model_id === STATE.model) o.selected = true;
      sel.appendChild(o);
    });
    sel.setAttribute("aria-label", "模型选择");
    sel.disabled = false;
  }

  function renderBadges() {
    var m = currentModel();
    $("badge-status").textContent = m ? ("运行状态：" + (m.status_badge_zh || m.operational_status)) : "";
    $("badge-role").textContent = m ? ("选择角色：" + (m.selection_label_zh || m.selection_role)) : "";
    $("badge-status").setAttribute("data-operational-status", m ? m.operational_status : "");
    $("badge-role").setAttribute("data-selection-role", m ? m.selection_role : "");
  }

  function currentModel() {
    var out = null;
    (STATE.models || []).forEach(function (m) { if (m.model_id === STATE.model) out = m; });
    return out;
  }

  function renderDateSelector() {
    var sel = $("date-select");
    sel.innerHTML = "";
    var dates = (STATE.index && STATE.index.dates) || [];
    dates.forEach(function (d) {
      var o = document.createElement("option");
      o.value = d;
      o.textContent = d;
      if (d === STATE.date) o.selected = true;
      sel.appendChild(o);
    });
    sel.setAttribute("aria-label", "评分日期选择");
    sel.disabled = dates.length === 0;
  }

  /* -------------------------------------------------------------- render */
  function clearAll() {
    /* §33 — a model switch must not leave any previous view state behind. */
    STATE.day = null; STATE.history = null;
    STATE.chartState = null; STATE.tooltipState = null;
    $("core-score").textContent = "—";
    $("inv-score").textContent = "—";
    $("core-meta").textContent = "";
    $("inv-meta").textContent = "";
    ["core-modules", "inv-modules"].forEach(function (id) { $(id).innerHTML = ""; });
    ["core-table", "inv-table", "hist-table"].forEach(function (id) {
      $(id).querySelector("tbody").innerHTML = "";
    });
    ["forward-body", "overlay-body", "v04-body", "rs60-body", "runtime-body"].forEach(function (id) {
      $(id).innerHTML = "";
    });
    $("limits-body").innerHTML = "";
    var svg = $("hist-chart");
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }

  function kv(el, k, v) {
    var a = document.createElement("div"); a.className = "k"; a.textContent = k;
    var b = document.createElement("div"); b.className = "v"; b.textContent = v;
    el.appendChild(a); el.appendChild(b);
  }

  function rowsFor(tbody, list) {
    list.forEach(function (m) {
      var tr = document.createElement("tr");
      [txt(m.id), txt(m.name), disp(m.raw), disp(m.score), disp(m.max_score), txt(m.source_date || m.source_period)]
        .forEach(function (v) {
          var td = document.createElement("td"); td.textContent = v; tr.appendChild(td);
        });
      tbody.appendChild(tr);
    });
  }

  function renderModules(el, mods) {
    (mods || []).forEach(function (mo) {
      var d = document.createElement("div");
      d.className = "mod";
      var b = document.createElement("b"); b.textContent = disp(mo.score);
      d.appendChild(b);
      var s = document.createElement("span");
      s.textContent = " / " + disp(mo.max_score) + " · " + txt(mo.name);
      d.appendChild(s);
      el.appendChild(d);
    });
  }

  function renderLimits(ix) {
    var ul = $("limits-body");
    ul.innerHTML = "";
    ((ix && ix.known_limitations) || []).forEach(function (t) {
      var li = document.createElement("li");
      li.textContent = t;
      ul.appendChild(li);
    });
  }

  function renderDay() {
    var d = STATE.day;
    if (!d) return;
    $("core-score").textContent = disp(d.core && d.core.score);
    $("inv-score").textContent = disp(d.investment && d.investment.score);
    $("core-meta").textContent = "状态 " + txt(d.core && d.core.status) +
      " · 满分 " + disp(d.core && d.core.target_score);
    $("inv-meta").textContent = "状态 " + txt(d.investment && d.investment.status) +
      " · 满分 " + disp(d.investment && d.investment.target_score);

    renderModules($("core-modules"), d.core && d.core.modules);
    renderModules($("inv-modules"), d.investment && d.investment.submodules);
    rowsFor($("core-table").querySelector("tbody"), (d.core && d.core.members) || []);
    rowsFor($("inv-table").querySelector("tbody"), (d.investment && d.investment.members) || []);

    var f = $("forward-body");
    kv(f, "Policy", txt(d.forward && d.forward.policy));
    kv(f, "Status", txt(d.forward && d.forward.status));
    kv(f, "计入 100 分", String(!!(d.forward && d.forward.in_100_point_score)));
    if (d.forward && d.forward.note) kv(f, "说明", d.forward.note);

    var o = $("overlay-body");
    var ov = d.risk_overlay || {};
    kv(o, "Overlay ID", txt(ov.overlay_id));
    kv(o, "Status", txt(ov.status));
    kv(o, "区间", disp(ov.range_min) + " ~ " + disp(ov.range_max));
    kv(o, "并入总分", String(!!ov.netted_into_score));
    kv(o, "独立于 Core/Investment", String(!!ov.independent_of_core_and_investment));

    var v4 = $("sec-v04"), vb = $("v04-body");
    if (d.v04) {
      v4.hidden = false;
      kv(vb, "指标", txt(d.v04.chinese_name));
      kv(vb, "Theoretical identity", txt(d.v04.theoretical_identity));
      kv(vb, "Disclosure", txt(d.v04.disclosure));
      kv(vb, "Formula version", txt(d.v04.formula_version));
      Object.keys(d.v04.inputs || {}).forEach(function (k) {
        kv(vb, k, disp(d.v04.inputs[k]));
      });
      if (d.v04.disclosure_note) kv(vb, "披露", d.v04.disclosure_note);
    } else { v4.hidden = true; }

    var r6 = $("sec-rs60"), rb = $("rs60-body");
    if (d.rs60) {
      r6.hidden = false;
      kv(rb, "标的", txt(d.rs60.subject));
      kv(rb, "基准", txt(d.rs60.benchmark));
      kv(rb, "区间数 / 观察点", txt(d.rs60.intervals) + " / " + txt(d.rs60.observation_points));
      kv(rb, "Method", txt(d.rs60.method));
      kv(rb, "Mapping", txt(d.rs60.mapping));
      Object.keys(d.rs60.inputs || {}).forEach(function (k) {
        kv(rb, k, disp(d.rs60.inputs[k]));
      });
      if (d.rs60.note) kv(rb, "说明", d.rs60.note);
    } else { r6.hidden = true; }

    var rt = $("runtime-body");
    var m = currentModel() || {};
    kv(rt, "Model", txt(m.model_id));
    kv(rt, "Contract", txt(m.contract_version));
    kv(rt, "Runtime", txt(m.runtime_version));
    kv(rt, "Selection role", txt(m.selection_role));
    kv(rt, "Operational status", txt(m.operational_status));
    kv(rt, "Production authority", String(!!m.production_authority));
    kv(rt, "Score date", txt(d.score_date));
    kv(rt, "Fingerprint", txt(m.model_fingerprint));
  }

  function renderHistory() {
    var h = STATE.history;
    if (!h) return;
    var rows = h.rows || [];
    var tb = $("hist-table").querySelector("tbody");
    /* newest first, capped for the table — the chart always plots everything */
    rows.slice().reverse().slice(0, 20).forEach(function (r) {
      var tr = document.createElement("tr");
      [txt(r.date), disp(r.core), disp(r.investment)].forEach(function (v) {
        var td = document.createElement("td"); td.textContent = v; tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    drawChart(rows);
  }

  function drawChart(rows) {
    var svg = $("hist-chart");
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var W = 960, H = 260, PL = 44, PR = 12, PT = 14, PB = 26;
    var pts = [];
    rows.forEach(function (r) {
      var c = rawNum(r.core), i = rawNum(r.investment);
      if (c !== null || i !== null) pts.push({ d: r.date, c: c, i: i });
    });
    if (!pts.length) return;
    var lo = 100, hi = 0;
    pts.forEach(function (p) {
      [p.c, p.i].forEach(function (v) { if (v !== null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
    });
    if (hi - lo < 10) { hi += 5; lo -= 5; }
    lo = Math.max(0, Math.floor(lo - 2)); hi = Math.min(100, Math.ceil(hi + 2));
    function X(k) { return PL + (W - PL - PR) * (pts.length === 1 ? 0.5 : k / (pts.length - 1)); }
    function Y(v) { return PT + (H - PT - PB) * (1 - (v - lo) / (hi - lo)); }

    var grid = document.createElementNS("http://www.w3.org/2000/svg", "g");
    for (var g = 0; g <= 4; g++) {
      var val = lo + (hi - lo) * g / 4;
      var y = Y(val);
      var ln = document.createElementNS("http://www.w3.org/2000/svg", "line");
      ln.setAttribute("x1", PL); ln.setAttribute("x2", W - PR);
      ln.setAttribute("y1", y); ln.setAttribute("y2", y);
      ln.setAttribute("stroke", "#e2e6ec"); ln.setAttribute("stroke-width", "1");
      grid.appendChild(ln);
      var tx = document.createElementNS("http://www.w3.org/2000/svg", "text");
      tx.setAttribute("x", PL - 6); tx.setAttribute("y", y + 4);
      tx.setAttribute("text-anchor", "end"); tx.setAttribute("font-size", "10");
      tx.setAttribute("fill", "#6b7684");
      /* axis labels also obey the display contract */
      tx.textContent = disp({ r: String(val), d: (Math.round(val * 100) / 100).toFixed(2) });
      grid.appendChild(tx);
    }
    svg.appendChild(grid);

    function path(get) {
      var dstr = "";
      pts.forEach(function (p, k) {
        var v = get(p); if (v === null) return;
        dstr += (dstr ? " L" : "M") + X(k).toFixed(2) + " " + Y(v).toFixed(2);
      });
      var pa = document.createElementNS("http://www.w3.org/2000/svg", "path");
      pa.setAttribute("d", dstr); pa.setAttribute("fill", "none");
      pa.setAttribute("stroke-width", "1.6");
      return pa;
    }
    var pc = path(function (p) { return p.c; });
    pc.setAttribute("stroke", "#b32b2b"); svg.appendChild(pc);
    var pi = path(function (p) { return p.i; });
    pi.setAttribute("stroke", "#2f6fb5"); svg.appendChild(pi);

    var lab = document.createElementNS("http://www.w3.org/2000/svg", "text");
    lab.setAttribute("x", PL); lab.setAttribute("y", H - 6);
    lab.setAttribute("font-size", "10"); lab.setAttribute("fill", "#6b7684");
    lab.textContent = pts[0].d + " → " + pts[pts.length - 1].d;
    svg.appendChild(lab);
    STATE.chartState = { points: pts.length };
  }

  /* --------------------------------------------------------------- load */
  function loadModel(keepDate) {
    var m = currentModel();
    if (!m) return Promise.resolve();
    var base = DATA_ROOT + "/" + STATE.bank + "/" + m.data_dir;
    return fetchJson(base + "/index.json").then(function (ix) {
      STATE.index = ix;
      if (!keepDate || !STATE.date) STATE.date = ix.latest_score_date;
      renderDateSelector();
      renderLimits(ix);
      return Promise.all([
        fetchJson(base + "/history.json"),
        loadDay(STATE.date)
      ]);
    }).then(function (res) {
      STATE.history = res[0];
      STATE.day = res[1];
      renderHistory();
      renderDay();
    });
  }

  function loadDay(date) {
    var m = currentModel();
    var base = DATA_ROOT + "/" + STATE.bank + "/" + m.data_dir;
    var ix = STATE.index;
    if (date === ix.latest_score_date) return fetchJson(base + "/latest.json");
    var year = String(date).slice(0, 4);
    if (STATE.yearCache[year]) return Promise.resolve(pickDay(STATE.yearCache[year], date));
    return fetchJson(base + "/days/" + year + ".json").then(function (arr) {
      STATE.yearCache[year] = arr;
      return pickDay(arr, date);
    });
  }

  function pickDay(arr, date) {
    for (var i = 0; i < arr.length; i++) if (arr[i].score_date === date) return arr[i];
    return null;
  }

  function switchTo(bank, model, opts) {
    opts = opts || {};
    var modelChanged = (model !== STATE.model) || (bank !== STATE.bank);
    STATE.bank = bank; STATE.model = model;
    if (modelChanged) { STATE.yearCache = {}; STATE.date = null; }
    clearAll();
    renderBankSelector(); renderModelSelector(); renderBadges();
    pushUrl(!!opts.replace);
    return loadModel(false).then(function () {
      document.title = bank + " · " + model + " · 量化评分研究看板";
    });
  }

  /* --------------------------------------------------------------- init */
  function boot() {
    return fetchJson(DATA_ROOT + "/banks.json").then(function (b) {
      STATE.banks = b;
      var p = urlParams();
      /* §10 — a fresh root load ALWAYS defaults to CMB + V3.  Saved state is
         never allowed to flip the default; only an explicit URL may. */
      var bank = p.bank && hasBank(b, p.bank) ? p.bank : FRESH_ROOT_DEFAULTS.bank;
      var model = (p.model && hasModel(b, bank, p.model)) ? p.model : FRESH_ROOT_DEFAULTS.model;
      STATE.bank = bank; STATE.model = model; STATE.date = p.date || null;
      renderBankSelector(); renderModelSelector(); renderBadges();
      return loadModel(!!STATE.date).then(function () {
        $("foot-meta").textContent = "Bank " + bank + " · Model " + model +
          " · 数据由本地预计算产物生成，浏览器不参与评分。";
        document.title = bank + " · " + model + " · 量化评分研究看板";
      });
    });
  }

  function hasBank(b, id) {
    return b.banks.some(function (x) { return x.institution_id === id; });
  }
  function hasModel(b, bankId, modelId) {
    var f = null;
    b.banks.forEach(function (x) { if (x.institution_id === bankId) f = x; });
    return !!f && f.models.some(function (m) { return m.model_id === modelId; });
  }

  window.addEventListener("popstate", function () {
    var p = urlParams();
    switchTo(p.bank || FRESH_ROOT_DEFAULTS.bank,
             p.model || FRESH_ROOT_DEFAULTS.model, { replace: true });
  });

  document.addEventListener("DOMContentLoaded", function () {
    $("bank-select").addEventListener("change", function (e) {
      var b = e.target.value;
      var first = STATE.banks.banks.filter(function (x) { return x.institution_id === b; })[0];
      var def = first ? first.default_model_id : FRESH_ROOT_DEFAULTS.model;
      switchTo(b, def);
    });
    $("model-select").addEventListener("change", function (e) {
      switchTo(STATE.bank, e.target.value);
    });
    $("date-select").addEventListener("change", function (e) {
      STATE.date = e.target.value;
      pushUrl(false);
      loadDay(STATE.date).then(function (d) { STATE.day = d; renderDay(); });
    });
    boot().catch(function (err) {
      var m = document.createElement("pre");
      m.style.color = "#b32b2b";
      m.textContent = "LOAD_FAILED: " + err.message;
      $("main").appendChild(m);
      throw err;
    });
  });

  window.__APP_STATE__ = STATE;
})();
