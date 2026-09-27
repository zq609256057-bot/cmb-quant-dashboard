/* =====================================================================
 * CMB_FRONTEND_V2 — presentation layer
 *
 * STRICT BOUNDARY (§35 / §49 / VC-K03):
 *   The browser may only fetch, filter, sort, format, render, chart and
 *   switch date/bank/metric.  It MUST NOT compute the 24 metrics, the 5
 *   dimensions, base_score, overlay_score, final_score, PIT availability,
 *   macro lag, disclosure persistence, dynamic bands, fixed thresholds or
 *   the comprehensive judgement.  Every business result shown here was
 *   produced locally by the Frontend Artifact Builder and published as a
 *   sanitized public artifact.
 *
 * CMB_SCORE_COLOR_ENGINE_V1
 *   tone bands        <- SOURCE_V6_ACTUAL_IMPLEMENTATION
 *                        (V6 frontend/src/components.jsx scoreTone():
 *                         ratio < .45 low | < .7 middle | else high)
 *   gradient stops    <- SOURCE_V6_ACTUAL_IMPLEMENTATION
 *                        (V6 styles.css .scale-fill)
 *   text tone colours <- SOURCE_V6_ACTUAL_IMPLEMENTATION
 *                        (V6 styles.css .score-tone-text-*)
 * Boundary vocabulary (V6): the browser may only READ the published
 * artifacts — READ -> FORMAT -> RENDER.  It MUST NOT compute a score.
 * ===================================================================== */
(function () {
  "use strict";

  var GLYPH = "—";
  var SCORE_DECIMALS = 2;   // canonical score decimals (V6/V1 parity)
  var REGISTRY = "data/bank_registry.json";

  var state = {
    registry: null,           // bank registry
    bank: null,               // active bank entry
    current: null,            // current.json
    days: [],                 // published days
    judgement: null,          // history/judgement.json (lazy)
    fixed: null,              // history/fixed_score.json (lazy)
    shadow: null,             // history/shadow_score.json (lazy)
    price: null,              // history/price.json (lazy)
    thresholds: {},           // history/thresholds/<M>.json (lazy)
    histMode: "FIXED",        // FIXED | SHADOW | COMPARE
    histRange: "ALL",
    histStart: null,
    histEnd: null,
    showPrice: true,
    thresholdMetric: null
  };

  function el(id) { return document.getElementById(id); }

  /* ---------------- formatting ---------------- */
  function fmt(v, d) {
    if (v === null || v === undefined || v === "" || !isFinite(Number(v))) return GLYPH;
    var s = Number(v).toFixed(d === undefined ? SCORE_DECIMALS : d);
    s = s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
    return s;
  }
  function pct(v) {
    if (v === null || v === undefined || !isFinite(Number(v))) return GLYPH;
    return (Number(v) * 100).toFixed(1) + "%";
  }
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ---------------- CMB_SCORE_COLOR_ENGINE_V1 ---------------- */
  // V6 scoreTone(): ratio = value / maximum.
  function scoreTone(value, maximum) {
    var mx = Number(maximum);
    var ratio = Number(value) / mx;
    if (!isFinite(ratio) || !isFinite(Number(value)) || !(mx > 0)) return "unavailable";
    if (ratio < 0.45) return "low";
    if (ratio < 0.70) return "middle";
    return "high";
  }
  // Availability gate (§20): a missing / degraded value NEVER gets a
  // red-amber-green tone; it is rendered muted grey.
  function toneOf(score, max, status) {
    if (score === null || score === undefined) return "unavailable";
    if (status && status !== "FULLY_AVAILABLE" && status !== "AVAILABLE") return "unavailable";
    return scoreTone(score, max);
  }
  function toneTextCls(tone) { return "score-tone-text-" + tone; }
  function barWidth(score, max) {
    var mx = Number(max);
    if (!isFinite(Number(score)) || !(mx > 0)) return 0;
    return Math.max(0, Math.min(100, (Number(score) / mx) * 100));
  }
  function toneColor(tone) {
    return tone === "low" ? "#dc2626" : tone === "middle" ? "#d97706"
      : tone === "high" ? "#059669" : "#9ca3af";
  }

  function statusPill(status) {
    if (!status) return '<span class="pill pill-neutral">' + GLYPH + "</span>";
    var s = String(status), cls = "pill-neutral";
    if (s === "FULLY_AVAILABLE" || s === "SUCCESS" || s === "LOCAL_VALIDATION_PASS" ||
        s === "AVAILABLE" || s === "PIT_OK") cls = "pill-ok";
    else if (s === "NOT_FULLY_AVAILABLE" || s === "DEGRADED" || s === "PARTIAL" ||
             s === "DEGRADED_OVERLAY_UNAVAILABLE") cls = "pill-warn";
    else if (s === "FAILED" || s === "BLOCKED" || s === "REJECT_STALE" ||
             s === "REJECT_FUTURE" || s === "ERROR") cls = "pill-err";
    return '<span class="pill ' + cls + '">' + esc(s) + "</span>";
  }

  function loadJson(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
      return r.json();
    });
  }

  function showError(msg, cls) {
    var b = el("banner");
    b.hidden = false;
    b.className = "banner " + (cls || "banner-err");
    b.textContent = msg;
  }

  /* ---------------- A. topbar ---------------- */
  function renderTop(c) {
    el("top-bank").textContent = (state.bank ? state.bank.name_cn + " " + state.bank.bank_id : GLYPH);
    el("top-model").textContent = c.model_id || GLYPH;
    el("top-date").textContent = "评分日 " + (c.score_date || GLYPH);
    el("top-frontend-version").textContent = c.frontend_version || "CMB_FRONTEND_V2";
    el("top-updated").textContent = "数据截至 " + (c.data_asof || GLYPH);
    el("footer-model").textContent = c.model_id || GLYPH;
    el("footer-subject").textContent = c.bank_code || GLYPH;
    el("footer-version").textContent = (c.frontend_version || "CMB_FRONTEND_V2") +
      " · 不执行评分计算";
  }

  /* ---------------- B. bank selector ---------------- */
  function renderBankSelector() {
    var reg = state.registry || { banks: [] };
    var sel = el("bank-select");
    sel.innerHTML = reg.banks.map(function (b) {
      var disabled = b.status !== "ACTIVE";
      return '<option value="' + esc(b.bank_id) + '"' + (disabled ? " disabled" : "") + ">" +
        esc(b.name_cn) + " · " + esc(b.bank_id) +
        (disabled ? "（未接入 · " + esc(b.status) + "）" : "") + "</option>";
    }).join("");
    var active = reg.banks.filter(function (b) { return b.status === "ACTIVE"; });
    sel.value = active.length ? active[0].bank_id : (reg.banks[0] || {}).bank_id;
    el("bank-status").textContent =
      "当前已正式接入 " + (reg.active_count === undefined ? active.length : reg.active_count) +
      " 家银行 · 契约 " + (reg.contract || "CMB_BANK_FRONTEND_REGISTRY_CONTRACT_V1");
    el("bank-current").textContent = active.length
      ? "当前：" + active[0].name_cn + " · " + active[0].model_id + " · " + active[0].profile_id
      : "当前：无正式接入银行";
    return active.length ? active[0] : null;
  }

  /* ---------------- C. day selector ---------------- */
  function renderDaySelector(c) {
    var days = (c && c.published_days) || [];
    if (!days.length && c && c.score_date) days = [c.score_date];
    state.days = days.slice().sort();
    var sel = el("day-select");
    sel.innerHTML = state.days.slice().reverse().map(function (d) {
      return '<option value="' + esc(d) + '">' + esc(d) +
        (d === c.score_date ? "（最新）" : "") + "</option>";
    }).join("");
    sel.value = c.score_date || state.days[state.days.length - 1];
    el("day-status").textContent = "已发布交易日 " + state.days.length + " 个 · 起始 " +
      (state.days[0] || GLYPH) + " · 截止 " + (state.days[state.days.length - 1] || GLYPH);
    el("day-current").textContent = "缺失日显示 NO_SNAPSHOT，不使用最近一天冒充";
  }

  /* ---------------- D. hero ---------------- */
  function renderHero(c) {
    var tone = toneOf(c.base_score, c.base_score_max === undefined ? 100 : c.base_score_max,
                      c.base_score_status);
    var hero = el("hero");
    hero.className = "score-hero score-tone-" + tone;
    el("hero-badge").textContent = c.model_id || GLYPH;
    el("hero-date").textContent = c.score_date || GLYPH;
    el("hero-title").textContent = "基础评分（Base Score · 不是 Final Score）";
    var s = el("hero-score");
    s.className = "score-big " + toneTextCls(tone) + " hero-tone-" + tone;
    s.textContent = (c.base_score === null || c.base_score === undefined) ? GLYPH : fmt(c.base_score, SCORE_DECIMALS);
    var sd = (c.signal_resonance && c.signal_resonance.base_signal) || {};
    el("hero-verdict").textContent = (c.base_score === null || c.base_score === undefined)
      ? "NOT_FULLY_AVAILABLE" : (sd.label || GLYPH);
    el("hero-fill").style.width = barWidth(c.base_score, 100).toFixed(2) + "%";
    el("hero-meta").innerHTML = [
      metaRow("可用权重 available_weight", fmt(c.available_weight, 1)),
      metaRow("缺失指标 missing", (c.missing_metric_ids && c.missing_metric_ids.length)
        ? c.missing_metric_ids.join(", ") : "无"),
      metaRow("数据截至 data_asof", c.data_asof || GLYPH)
    ].join("");

    // §21 / §64 / §50: BASE is never FINAL; a missing overlay is never zero.
    var note = el("base-final-note");
    if (c.final_score_status === "NOT_FULLY_AVAILABLE" || c.overlay_status === "NOT_FULLY_AVAILABLE") {
      note.hidden = false;
      note.className = "banner banner-warn";
      note.innerHTML = "<strong>BASE ≠ FINAL</strong>：Overlay 当前 " +
        esc(c.overlay_status || GLYPH) + "，最终评分 " + GLYPH +
        "（" + esc(c.final_score_status || GLYPH) + "）。缺失不等于 0，不得用 Base 冒充 Final。";
    } else { note.hidden = true; }
  }
  function metaRow(k, v) {
    return '<div><span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + "</span></div>";
  }

  /* ---------------- E + F. dimensions ---------------- */
  function renderDimensions(c) {
    var dims = c.dimensions || [];
    el("dim-kpi").innerHTML = dims.map(function (d) {
      var tone = toneOf(d.score, d.max_score, d.status);
      return '<div class="kpi-card score-tone-' + tone + '">' +
        '<div class="kpi-label">' + esc(d.name) + "</div>" +
        '<span class="kpi-value ' + toneTextCls(tone) + '">' +
          (d.score === null || d.score === undefined ? GLYPH : fmt(d.score, 2)) + "</span>" +
        '<span class="kpi-max">/ ' + fmt(d.max_score, 0) + " · " + pct(d.score_ratio) +
          " · " + esc(tone) + "</span></div>";
    }).join("");

    el("decomp").innerHTML = dims.map(function (d) {
      var tone = toneOf(d.score, d.max_score, d.status);
      return '<div class="score-row">' +
        '<div class="score-row-head"><span class="score-row-label">' + esc(d.name) +
          ' <span class="mid">' + esc(d.dimension_id) + '</span></span>' +
          '<span class="score-row-score ' + toneTextCls(tone) + '">' +
          fmt(d.score, 2) + " / " + fmt(d.max_score, 0) + "</span></div>" +
        '<div class="score-bar-wrap"><i class="score-bar-fill" style="width:' +
          barWidth(d.score, d.max_score).toFixed(2) + '%"></i></div>' +
        '<div class="score-row-meta"><span class="raw">score_ratio ' +
          pct(d.score_ratio) + "</span><span>" + esc(d.status || "") + "</span></div></div>";
    }).join("");
  }

  /* ---------------- G~K. 5 dimension sections / 24 metrics ---------------- */
  var ORD = { DIMENSION_01: "②", DIMENSION_02: "③", DIMENSION_03: "④",
              DIMENSION_04: "⑤", DIMENSION_05: "⑥" };
  function renderMetricSections(c) {
    var dims = c.dimensions || [], metrics = c.metrics || [];
    el("dimension-sections").innerHTML = dims.map(function (d) {
      var rows = metrics.filter(function (m) { return m.dimension_id === d.dimension_id; });
      var tone = toneOf(d.score, d.max_score, d.status);
      return '<section class="card dim-card score-tone-' + tone + '" data-dimension="' +
          esc(d.dimension_id) + '">' +
        '<div class="dim-head"><div><span class="dim-name">' + esc(ORD[d.dimension_id] || "") +
          " " + esc(d.name) + '</span><div class="hint">' + esc(d.dimension_id) +
          " · " + rows.length + ' 项指标</div></div>' +
          '<div><span class="dim-score ' + toneTextCls(tone) + '">' + fmt(d.score, 2) +
          '</span><span class="dim-max"> / ' + fmt(d.max_score, 0) + "</span></div></div>" +
        '<div class="score-bar-wrap"><i class="score-bar-fill" style="width:' +
          barWidth(d.score, d.max_score).toFixed(2) + '%"></i></div>' +
        '<div style="margin-top:10px">' + rows.map(metricRow).join("") + "</div></section>";
    }).join("");
  }
  /* Frozen Fixed band + position inside it (public in meta.json). */
  function thresholdChip(m) {
    var z = m.fixed_zero, f = m.fixed_full;
    if (z === null || z === undefined || f === null || f === undefined) {
      return '<span class="thr-chip">阈值口径：' + esc(m.threshold_origin_type || GLYPH) + "</span>";
    }
    var pos = "区间内";
    if (m.score_ratio !== null && m.score_ratio !== undefined) {
      if (m.score_ratio <= 0.0001) pos = "触及下锚";
      else if (m.score_ratio >= 0.9999) pos = "达到上锚";
    }
    return '<span class="thr-chip">Fixed 阈值 ' + esc(fmt(z, 4)) + " → " + esc(fmt(f, 4)) +
      ' <b>' + esc(pos) + "</b></span>";
  }
  function metricRow(m) {
    var tone = toneOf(m.score, m.max_score, m.status);
    return '<div class="score-row" data-metric="' + esc(m.metric_id) + '">' +
      '<div class="score-row-head"><span class="score-row-label">' + esc(m.name) +
        ' <span class="mid">' + esc(m.metric_id) + (m.abbr ? " · " + esc(m.abbr) : "") +
        '</span></span>' +
        '<span class="score-row-score ' + toneTextCls(tone) + '">' +
        (m.score === null || m.score === undefined ? GLYPH : fmt(m.score, 2)) +
        " / " + fmt(m.max_score, 0) + "</span></div>" +
      '<div class="score-bar-wrap"><i class="score-bar-fill" style="width:' +
        barWidth(m.score, m.max_score).toFixed(2) + '%"></i></div>' +
      /* PUBLIC SANITIZATION (INTERNAL_FIELD rule, verify_phase4_pages_online):
         the metric raw value is licensed provider data and is NEVER published
         nor rendered.  The row shows the frozen Fixed band + the position
         inside it instead — both are already public in meta.json. */
      '<div class="score-row-meta"><span class="raw">' + thresholdChip(m) + "</span>" +
        "<span>得分率 " + pct(m.score_ratio) + "</span>" +
        "<span>数据日 " + esc(m.source_date || GLYPH) + "</span>" +
        "<span>" + statusPill(m.status) + "</span></div></div>";
  }

  /* ---------------- L. ⑦ 综合研判 ---------------- */
  function renderJudgement(c) {
    var j = c.comprehensive_judgement;
    if (!j) { el("judgement").innerHTML = '<div class="hint">暂无研判数据。</div>'; return; }
    function items(list, cls) {
      if (!list || !list.length) {
        return '<li><i class="factor-dot"></i>无符合条件的项目。</li>';
      }
      return list.map(function (f) {
        return '<li><i class="factor-dot"></i><div><span>' + esc(f.text || "") + "</span>" +
          '<span class="factor-trace">metric_id=' + esc(f.metric_id) +
          " · score=" + esc(fmt(f.score, 2)) + "/" + esc(fmt(f.max_score, 0)) +
          " · ratio=" + esc(pct(f.score_ratio)) +
          " · threshold=[" + esc(fmt(f.fixed_zero, 4)) + ", " + esc(fmt(f.fixed_full, 4)) + "] · " +
          esc(f.source_date || GLYPH) + "</span></div></li>";
      }).join("");
    }
    el("judgement").innerHTML =
      '<div class="judgement-zone positive"><h3>A · 主要正向因素</h3><ul>' +
        items(j.positive) + "</ul></div>" +
      '<div class="judgement-zone negative"><h3>B · 主要风险因素</h3><ul>' +
        items(j.risk) + "</ul></div>" +
      '<div class="judgement-zone conclusion"><h3>C · 综合研判</h3><ul><li>' +
        '<i class="factor-dot"></i><div><span>' + esc(j.conclusion_text || GLYPH) + "</span>" +
        '<span class="factor-trace">分=' + esc(fmt(j.base_score, 2)) +
        " · band=" + esc(j.band || GLYPH) +
        " · positive=" + ((j.positive || []).length) +
        " · risk=" + ((j.risk || []).length) + "</span></div></li></ul>" +
        '<p class="interpretation-boundary">' + esc(j.advice_disclaimer || j.boundary_note || "") + "</p></div>";
  }

  /* ---------------- M. ⑧ 评分信号共振 ---------------- */
  function renderResonance(c) {
    var r = c.signal_resonance;
    if (!r) { el("resonance").innerHTML = '<div class="hint">暂无共振数据。</div>'; return; }
    var dims = r.dimensions || [];
    var counts = r.counts || {};
    el("resonance").innerHTML =
      '<div class="signal-toolbar"><span>六档评分区间研究展示（CMB_SCORE_SIGNAL_DISPLAY_CONTRACT_V1）</span>' +
        '<span>' + esc(r.status || "RESEARCH_DISPLAY_ONLY") + "</span></div>" +
      '<div style="overflow-x:auto"><table class="signal-table"><colgroup><col><col><col><col></colgroup>' +
      "<thead><tr><th>维度</th><th>得分 / 满分</th><th>得分率</th><th>评分状态</th></tr></thead><tbody>" +
      dims.map(function (d) {
        var tone = toneOf(d.score, d.max_score, d.status);
        return "<tr><td>" + esc(d.name) + "</td><td>" +
          '<span class="' + toneTextCls(tone) + '">' + fmt(d.score, 2) + " / " + fmt(d.max_score, 0) +
          "</span></td><td>" + pct(d.score_ratio) + "</td><td>" +
          '<i class="dot ' + esc(dotCls(d.state)) + '"></i>' + esc(d.state_label || d.state) +
          "</td></tr>";
      }).join("") + "</tbody></table></div>" +
      '<div class="resonance-counts">' +
        cnt("c-positive", "Positive 正向", counts.positive) +
        cnt("c-neutral", "Neutral 中性", counts.neutral) +
        cnt("c-weak", "Weak 偏弱", counts.weak) +
        cnt("c-risk", "Risk 风险", counts.risk) +
      "</div>" +
      '<p class="score-signal-explanation"><strong>综合评分状态：' +
        esc((r.base_signal || {}).label || GLYPH) + "（" + esc((r.base_signal || {}).state || GLYPH) +
        " · 得分率 " + pct((r.base_signal || {}).score_ratio) + "）</strong>" +
        "<span>评分信号 = 评分状态（Score State），不是交易信号；本表只提供展示参考，不产生任何买卖指令。</span></p>";
  }
  function cnt(cls, label, v) {
    return '<div class="' + cls + '"><small>' + esc(label) + "</small><strong>" +
      esc(v === undefined || v === null ? GLYPH : v) + "</strong></div>";
  }
  function dotCls(state) {
    var s = String(state || "").toUpperCase();
    if (s === "POSITIVE") return "green";
    if (s === "NEUTRAL") return "amber";
    if (s === "WEAK") return "amber";
    if (s === "RISK") return "red";
    return "purple";
  }

  /* ---------------- N. ⑨ 历史评分回测 ---------------- */
  function renderHistoryShell() {
    el("history").innerHTML =
      '<div class="historical-toolbar">' +
        '<div><div class="hint">区间快捷选择</div><div class="index-tabs" id="hist-tabs">' +
          ["1Y", "3Y", "5Y", "ALL"].map(function (k) {
            return '<button data-range="' + k + '"' + (k === state.histRange ? ' class="active"' : "") +
              ">" + k + "</button>";
          }).join("") + "</div></div>" +
        '<div class="history-date-filter">' +
          '<label>Start Date<input type="date" id="hist-start"></label>' +
          '<label>End Date<input type="date" id="hist-end"></label>' +
        "</div>" +
        '<div class="index-tabs" id="hist-mode" style="min-width:300px">' +
          [["FIXED", "Fixed V1.1"], ["SHADOW", "动态研究口径（非生产）"], ["COMPARE", "Fixed + 研究口径"]]
            .map(function (p) {
              return '<button data-mode="' + p[0] + '"' +
                (p[0] === state.histMode ? ' class="active"' : "") + ">" + p[1] + "</button>";
            }).join("") + "</div>" +
      "</div>" +
      '<div class="toggle-row"><label><input type="checkbox" id="hist-price"' +
        (state.showPrice ? " checked" : "") + "> 叠加招商银行股价（右轴对照，仅观察 Score vs Price）</label>" +
        '<span id="hist-note" class="hint"></span></div>' +
      '<div class="chart-scroll"><div class="chart-shell"><canvas id="hist-canvas" class="score-canvas"></canvas>' +
        '<div id="hist-tip" class="hint" style="margin-top:6px"></div></div></div>' +
      '<div class="chart-legend"><span><i class="lg-fixed"></i>Fixed V1.1 正式评分</span>' +
        '<span><i class="lg-shadow"></i>研究用动态口径（SHADOW · RESEARCH ONLY · 非生产口径）</span>' +
        '<span><i class="lg-price"></i>股价（右轴）</span></div>' +
      '<div class="history-summary" id="hist-summary"></div>';
    bindHistoryControls();
  }

  function bindHistoryControls() {
    var tabs = el("hist-tabs");
    tabs.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-range]");
      if (!b) return;
      state.histRange = b.getAttribute("data-range");
      Array.prototype.forEach.call(tabs.querySelectorAll("button"), function (x) {
        x.className = x.getAttribute("data-range") === state.histRange ? "active" : "";
      });
      applyRange();
    });
    var mode = el("hist-mode");
    mode.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-mode]");
      if (!b) return;
      state.histMode = b.getAttribute("data-mode");
      Array.prototype.forEach.call(mode.querySelectorAll("button"), function (x) {
        x.className = x.getAttribute("data-mode") === state.histMode ? "active" : "";
      });
      drawHistory();
    });
    el("hist-start").addEventListener("change", function () {
      state.histStart = el("hist-start").value || null;
      state.histRange = "CUSTOM"; syncRangeButtons(); drawHistory();
    });
    el("hist-end").addEventListener("change", function () {
      state.histEnd = el("hist-end").value || null;
      state.histRange = "CUSTOM"; syncRangeButtons(); drawHistory();
    });
    el("hist-price").addEventListener("change", function () {
      state.showPrice = el("hist-price").checked; drawHistory();
    });
  }
  function syncRangeButtons() {
    Array.prototype.forEach.call(el("hist-tabs").querySelectorAll("button"), function (x) {
      x.className = x.getAttribute("data-range") === state.histRange ? "active" : "";
    });
  }
  function applyRange() {
    var dates = (state.fixed && state.fixed.dates) || [];
    if (!dates.length) return;
    var end = dates[dates.length - 1];
    var start = dates[0];
    if (state.histRange === "1Y") start = shiftYears(end, dates, 1);
    else if (state.histRange === "3Y") start = shiftYears(end, dates, 3);
    else if (state.histRange === "5Y") start = shiftYears(end, dates, 5);
    state.histStart = start; state.histEnd = end;
    el("hist-start").value = start; el("hist-end").value = end;
    drawHistory();
  }
  function shiftYears(end, dates, years) {
    var d = new Date(end + "T00:00:00Z");
    d.setUTCFullYear(d.getUTCFullYear() - years);
    var target = d.toISOString().slice(0, 10);
    for (var i = 0; i < dates.length; i++) { if (dates[i] >= target) return dates[i]; }
    return dates[0];
  }

  function histWindow() {
    var f = state.fixed || { dates: [], base_score: [] };
    var s = state.histStart || (f.dates[0] || "");
    var e = state.histEnd || (f.dates[f.dates.length - 1] || "");
    var idx = [];
    for (var i = 0; i < f.dates.length; i++) {
      if (f.dates[i] >= s && f.dates[i] <= e) idx.push(i);
    }
    return idx;
  }

  function drawHistory() {
    var f = state.fixed, sh = state.shadow, pr = state.price;
    if (!f || !f.dates || !f.dates.length) {
      el("hist-note").textContent = "历史数据尚未加载。"; return;
    }
    var idx = histWindow();
    if (!idx.length) { el("hist-note").textContent = "所选区间内无可展示数据。"; return; }
    var dates = idx.map(function (i) { return f.dates[i]; });
    var fixed = idx.map(function (i) { return f.base_score[i]; });
    var shadow = null;
    if (sh && sh.dates) {
      var map = {};
      for (var k = 0; k < sh.dates.length; k++) map[sh.dates[k]] = sh.shadow_score[k];
      shadow = dates.map(function (d) { return map[d] === undefined ? null : map[d]; });
    }
    var price = null;
    if (state.showPrice && pr && pr.dates) {
      var pmap = {};
      for (var q = 0; q < pr.dates.length; q++) pmap[pr.dates[q]] = pr.close[q];
      price = dates.map(function (d) { return pmap[d] === undefined ? null : pmap[d]; });
    }
    var showFixed = state.histMode !== "SHADOW";
    var showAlt = state.histMode !== "FIXED" && shadow;

    el("hist-note").textContent =
      "区间 " + dates[0] + " → " + dates[dates.length - 1] + " · " + dates.length +
      " 个交易日 · 起始日由 earliest_full_PIT_score_date 自动确定，截止日随每日生产自动延伸";

    var minS = Infinity, maxS = -Infinity;
    function acc(v) { if (v !== null && isFinite(v)) { if (v < minS) minS = v; if (v > maxS) maxS = v; } }
    if (showFixed) fixed.forEach(acc);
    if (showAlt) shadow.forEach(acc);
    if (!isFinite(minS)) { minS = 0; maxS = 100; }
    var pad = Math.max(0.6, (maxS - minS) * 0.12);
    minS -= pad; maxS += pad;

    drawSeries("hist-canvas", dates, [
      { data: showFixed ? fixed : null, color: "#7c3aed", width: 2, dash: null },
      { data: showAlt ? shadow : null, color: "#2563eb", width: 2, dash: [6, 4] }
    ], price, minS, maxS);

    var lastF = fixed[fixed.length - 1];
    var lastS = shadow ? shadow[shadow.length - 1] : null;
    var firstF = fixed[0];
    el("hist-summary").innerHTML =
      sumRow("区间起始 Fixed", fmt(firstF, 2)) +
      sumRow("区间最新 Fixed", fmt(lastF, 2)) +
      sumRow("区间变动", (isFinite(lastF) && isFinite(firstF)) ? fmt(lastF - firstF, 2) : GLYPH) +
      sumRow("研究用动态口径最新（SHADOW · 非生产）", state.histMode === "FIXED" ? "未开启" : fmt(lastS, 2));
  }
  function sumRow(k, v) {
    return '<div><small>' + esc(k) + "</small><strong>" + esc(v) + "</strong></div>";
  }

  /* ---------------- canvas engine ---------------- */
  function drawSeries(canvasId, labels, series, rightSeries, minV, maxV) {
    var cv = el(canvasId);
    if (!cv) return;
    var dpr = window.devicePixelRatio || 1;
    var cssW = cv.clientWidth || 900, cssH = Number(cv.getAttribute("height") ? 0 : 0) || 240;
    if (!cv._h) {
      var rect = cv.getBoundingClientRect();
      cssH = Math.round(rect.height) || 240;
    } else { cssH = cv._h; }
    var w = Math.max(320, cssW), h = 240;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cv.style.height = h + "px";
    var g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    var ml = 42, mr = rightSeries ? 46 : 14, mt = 14, mb = 26;
    var pw = w - ml - mr, ph = h - mt - mb;
    var n = labels.length;
    if (n < 2 || pw <= 0) return;
    function X(i) { return ml + (pw * i) / (n - 1); }
    function Y(v) { return mt + ph * (1 - (v - minV) / (maxV - minV || 1)); }

    // grid + y labels (left axis = score)
    g.strokeStyle = "#e5e7eb"; g.fillStyle = "#6b7280";
    g.font = "10px ui-monospace,Menlo,monospace"; g.lineWidth = 1;
    for (var t = 0; t <= 4; t++) {
      var v = minV + ((maxV - minV) * t) / 4, y = Y(v);
      g.beginPath(); g.moveTo(ml, y); g.lineTo(ml + pw, y); g.stroke();
      g.textAlign = "right"; g.textBaseline = "middle";
      g.fillText(v.toFixed(1), ml - 6, y);
    }
    // right axis = price
    if (rightSeries) {
      var vals = rightSeries.filter(function (x) { return x !== null && isFinite(x); });
      if (vals.length) {
        var pmin = Math.min.apply(null, vals), pmax = Math.max.apply(null, vals);
        var ppad = (pmax - pmin) * 0.1 || 1;
        pmin -= ppad; pmax += ppad;
        function YP(v) { return mt + ph * (1 - (v - pmin) / (pmax - pmin || 1)); }
        g.strokeStyle = "#9ca3af"; g.setLineDash([4, 4]); g.lineWidth = 1;
        g.beginPath();
        var started = false;
        for (var i = 0; i < n; i++) {
          var pv = rightSeries[i];
          if (pv === null || !isFinite(pv)) continue;
          var px = X(i), py = YP(pv);
          if (!started) { g.moveTo(px, py); started = true; } else { g.lineTo(px, py); }
        }
        g.stroke(); g.setLineDash([]);
        g.fillStyle = "#9ca3af"; g.textAlign = "left";
        for (var u = 0; u <= 2; u++) {
          var pv2 = pmin + ((pmax - pmin) * u) / 2;
          g.fillText(pv2.toFixed(1), ml + pw + 6, YP(pv2));
        }
      }
    }
    // score series
    series.forEach(function (s) {
      if (!s || !s.data) return;
      g.strokeStyle = s.color; g.lineWidth = s.width || 2;
      g.setLineDash(s.dash || []);
      g.beginPath();
      var started = false;
      for (var i = 0; i < n; i++) {
        var v = s.data[i];
        if (v === null || v === undefined || !isFinite(v)) continue;
        var x = X(i), y = Y(v);
        if (!started) { g.moveTo(x, y); started = true; } else { g.lineTo(x, y); }
      }
      g.stroke(); g.setLineDash([]);
    });
    // x labels (thinned to avoid clutter on mobile)
    g.fillStyle = "#9ca3af"; g.textAlign = "center"; g.textBaseline = "top";
    var step = Math.max(1, Math.ceil(n / (w < 560 ? 4 : 8)));
    for (var j = 0; j < n; j += step) {
      g.fillText(labels[j].slice(2), X(j), mt + ph + 6);
    }
  }

  /* ---------------- O. ⑩ 动态阈值研究 ---------------- */
  function renderThresholdShell(metrics) {
    state.thresholdMetric = state.thresholdMetric || (metrics[0] && metrics[0].metric_id);
    el("threshold").innerHTML =
      '<div class="historical-toolbar"><div><div class="hint">指标选择（仅已冻结动态研究的指标）</div>' +
        '<div class="index-tabs" id="th-tabs" style="min-width:320px">' +
        metrics.map(function (m) {
          return '<button data-metric="' + esc(m.metric_id) + '"' +
            (m.metric_id === state.thresholdMetric ? ' class="active"' : "") + ">" +
            esc(m.metric_id) + " · " + esc(m.name || "") + "</button>";
        }).join("") + "</div></div>" +
        '<div class="hint" id="th-note"></div></div>' +
      '<div class="threshold-panel"><div class="threshold-heading">' +
        '<div><strong id="th-title">—</strong><br><span id="th-sub">—</span></div>' +
        '<span class="badge">RESEARCH ONLY</span></div>' +
        '<div class="chart-scroll"><div class="chart-shell"><canvas id="th-canvas" class="score-canvas" height="240"></canvas></div></div>' +
        '<div class="chart-legend" id="th-legend"></div>' +
        '<div class="threshold-grid" id="th-grid"></div>' +
        '<div id="th-status"></div></div>';
    el("th-tabs").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-metric]");
      if (!b) return;
      state.thresholdMetric = b.getAttribute("data-metric");
      Array.prototype.forEach.call(el("th-tabs").querySelectorAll("button"), function (x) {
        x.className = x.getAttribute("data-metric") === state.thresholdMetric ? "active" : "";
      });
      renderThreshold();
    });
  }

  function renderThreshold() {
    var mid = state.thresholdMetric;
    function go() {
      var t = state.thresholds[mid];
      if (!t) { el("th-title").textContent = "无数据"; return; }
      el("th-title").textContent = t.metric_id + " · " + (t.name || "");
      el("th-sub").textContent = "算法 " + (t.algorithm || GLYPH) + " · " +
        "状态 " + (t.status || GLYPH) + " · 观测数 " + (t.observation_count === undefined ? GLYPH : t.observation_count) +
        " · 窗口 " + (t.window_start || GLYPH) + " → " + (t.window_end || GLYPH);
      /* Threshold-evolution view only: Fixed anchors (dashed) vs research
         dynamic band (solid).  The raw metric series is NOT published. */
      el("th-legend").innerHTML =
        '<span><i style="background:#dc2626"></i>Fixed Lower</span>' +
        '<span><i style="background:#059669"></i>Fixed Upper</span>' +
        '<span><i style="background:#7c3aed"></i>Dynamic Lower</span>' +
        '<span><i style="background:#2563eb"></i>Dynamic Upper</span>';
      var pts = t.points || [];
      var labels = pts.map(function (p) { return p.date; });
      var series = [
        { data: pts.map(function (p) { return p.fixed_lower; }), color: "#dc2626", width: 1.6, dash: [5, 4] },
        { data: pts.map(function (p) { return p.fixed_upper; }), color: "#059669", width: 1.6, dash: [5, 4] },
        { data: pts.map(function (p) { return p.dynamic_lower; }), color: "#7c3aed", width: 2, dash: null },
        { data: pts.map(function (p) { return p.dynamic_upper; }), color: "#2563eb", width: 2, dash: null }
      ];
      var vals = [];
      series.forEach(function (s) { s.data.forEach(function (v) { if (v !== null && isFinite(v)) vals.push(v); }); });
      if (!vals.length) { el("th-note").textContent = "该指标无可用阈值序列。"; return; }
      var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
      var pd = (mx - mn) * 0.12 || 0.5;
      var cv = el("th-canvas"); cv._h = 240;
      drawSeries("th-canvas", labels, series, null, mn - pd, mx + pd);
      el("th-grid").innerHTML =
        sumRow("Fixed Lower", fmt(t.fixed_lower, 4)) +
        sumRow("Fixed Upper", fmt(t.fixed_upper, 4)) +
        sumRow("最新 Dynamic Lower", fmt(t.latest_dynamic_lower, 4)) +
        sumRow("最新 Dynamic Upper", fmt(t.latest_dynamic_upper, 4));
      el("th-status").innerHTML = (t.note || "") +
        '<div class="status-note"><strong>PIT Walk-Forward</strong><span>' +
        "每个历史 T 只使用 T 之前合法 available 的数据；不使用 Full Sample 阈值回套历史，" +
        "不存在未来数据泄漏。低频指标按 unique source observations 计数，不把日度持久化状态当作独立样本。</span></div>";
    }
    if (state.thresholds[mid]) { go(); return; }
    loadJson("data/banks/" + bankDir() + "/history/thresholds/" + mid + ".json")
      .then(function (t) { state.thresholds[mid] = t; go(); })
      .catch(function () { el("th-note").textContent = mid + " 阈值数据不可用。"; });
  }

  /* ---------------- P. runtime ---------------- */
  function renderRuntime(c) {
    var rt = c.runtime || {};
    var rows = [
      ["本地计算 local_compute", rt.local_compute || GLYPH],
      ["本地快照 local_snapshot", rt.local_snapshot || GLYPH],
      ["流水线 pipeline_version", rt.pipeline_version || GLYPH],
      ["数据模式 mode", rt.mode || GLYPH],
      ["模型 model_id", c.model_id || GLYPH],
      ["模型版本 model_version", c.model_version || GLYPH],
      ["前端版本 frontend_version", c.frontend_version || "CMB_FRONTEND_V2"],
      ["评分引擎 score_engine", rt.score_engine || "CMB_PRODUCTION_SCORE_ENGINE_V1"]
    ];
    if (c.snapshot_hash) rows.push(["快照哈希 snapshot_hash", String(c.snapshot_hash).slice(0, 16) + "…"]);
    el("runtime-table").innerHTML = "<tbody>" + rows.map(function (r) {
      return '<tr><td class="td-name">' + esc(r[0]) + '</td><td class="num">' + esc(r[1]) + "</td></tr>";
    }).join("") + "</tbody>";
    var hb = el("health-banner");
    if (c.overlay_status === "NOT_FULLY_AVAILABLE") {
      hb.hidden = false; hb.className = "banner banner-warn";
      hb.textContent = "DEGRADED_OVERLAY_UNAVAILABLE：Overlay 不可完整计算，页面不呈现完整健康态。";
    } else { hb.hidden = true; }
  }

  /* ---------------- bank helpers ---------------- */
  function bankDir() { return (state.bank && state.bank.data_dir) || "600036"; }

  function loadHistory() {
    var base = "data/banks/" + bankDir() + "/history/";
    return Promise.all([
      loadJson(base + "fixed_score.json").catch(function () { return null; }),
      loadJson(base + "shadow_score.json").catch(function () { return null; }),
      loadJson(base + "price.json").catch(function () { return null; }),
      loadJson(base + "judgement.json").catch(function () { return null; })
    ]).then(function (r) {
      state.fixed = r[0]; state.shadow = r[1]; state.price = r[2]; state.judgement = r[3];
      renderHistoryShell();
      applyRange();
      return r;
    });
  }

  function renderAll(c) {
    state.current = c;
    renderTop(c);
    renderHero(c);
    renderDimensions(c);
    renderMetricSections(c);
    renderJudgement(c);
    renderResonance(c);
    renderRuntime(c);
    el("banner").hidden = true;
  }

  /* A published V1 daily artifact is converted to the V2 view model here.
     This is pure RESHAPING (dict -> rows) using the frozen max scores already
     published in meta.json: no metric, dimension or score is ever computed in
     the browser (§49).  Judgement / resonance for a historical day come from
     the pre-generated history/judgement.json — never generated here (§23). */
  function v1ToV2(a, meta) {
    var dimMeta = (meta && meta.dimensions) || {};
    var mMeta = (meta && meta.metrics) || {};
    var dims = Object.keys(dimMeta).sort().map(function (did) {
      var d = dimMeta[did] || {};
      var sc = (a.dimension_scores || {})[did];
      var mx = d.max_score;
      return {
        dimension_id: did, name: d.name, en: d.en, max_score: mx,
        score: sc === undefined ? null : sc,
        score_ratio: (sc === undefined || !mx) ? null : sc / mx,
        status: sc === undefined ? "NOT_FULLY_AVAILABLE" : "FULLY_AVAILABLE",
        metric_ids: d.metrics || []
      };
    });
    var metrics = Object.keys(mMeta).sort().map(function (mid) {
      var m = mMeta[mid] || {};
      var sc = (a.metric_scores || {})[mid];
      var mx = m.max_score;
      var missing = (a.missing_metric_ids || []).indexOf(mid) >= 0;
      return {
        metric_id: mid, name: m.name, abbr: m.abbr, dimension_id: m.dimension,
        max_score: mx, score: sc === undefined ? null : sc,
        score_ratio: (sc === undefined || !mx) ? null : sc / mx,
        fixed_zero: m.fixed_zero_anchor === undefined ? null : m.fixed_zero_anchor,
        fixed_full: m.fixed_full_anchor === undefined ? null : m.fixed_full_anchor,
        threshold_origin_type: m.threshold_origin_type || null, unit: m.unit,
        status: (sc === undefined || missing) ? "NOT_FULLY_AVAILABLE" : "FULLY_AVAILABLE",
        source_date: a.data_asof, data_asof: a.data_asof
      };
    });
    var base = a.base_score === undefined ? null : a.base_score;
    var j = pregeneratedJudgement(a.score_date, dims, metrics, base);
    return {
      artifact: "CMB_BANK_CURRENT_V1_FROM_PUBLISHED_DAY",
      frontend_version: (meta && meta.frontend_version) || "CMB_FRONTEND_V2",
      bank_code: "600036.SH", bank_name: "招商银行",
      model_id: a.model_id, model_version: a.model_version,
      model_profile: "CMB_PROFILE",
      score_date: a.score_date, data_asof: a.data_asof,
      base_score: base, base_score_max: (meta && meta.total_score) || 100,
      base_score_status: a.base_score_status,
      overlay_score: a.overlay_score === undefined ? null : a.overlay_score,
      overlay_status: a.overlay_status,
      final_score: a.final_score === undefined ? null : a.final_score,
      final_score_status: a.final_score_status,
      available_weight: a.available_weight, missing_metric_ids: a.missing_metric_ids || [],
      dimensions: dims, metrics: metrics,
      signal_resonance: j.resonance, comprehensive_judgement: j.judgement,
      runtime: {
        local_compute: (a.runtime_status_summary || {}).local_compute,
        local_snapshot: (a.runtime_status_summary || {}).local_snapshot,
        pipeline_version: (a.runtime_status_summary || {}).pipeline_version,
        mode: (a.provider_status_summary || {}).mode,
        score_engine: "CMB_PRODUCTION_SCORE_ENGINE_V1"
      },
      snapshot_hash: a.snapshot_hash,
      published_days: state.days,
      historical: true
    };
  }

  /* Rebuild the DISPLAY objects from the pre-generated compact record.
     The prose comes from the frozen template tables in meta.json; only the
     numbers are substituted. Nothing is generated or inferred here (§23). */
  function pregeneratedJudgement(day, dims, metrics, base) {
    var rec = state.judgement && state.judgement.days ? state.judgement.days[day] : null;
    var tpl = (state.meta && state.meta.judgement_templates) || { positive: {}, risk: {} };
    function expand(list, tpls) {
      if (!list || !list.length) return [];
      return list.map(function (it) {
        var mid = it[0], sc = it[1], mx = it[2], ratio = it[3];
        var unit = null, src = null;
        for (var i = 0; i < metrics.length; i++) {
          if (metrics[i].metric_id === mid) {
            unit = metrics[i].unit; src = metrics[i].source_date; break;
          }
        }
        var mm = (state.meta && state.meta.metrics && state.meta.metrics[mid]) || {};
        return {
          metric_id: mid, name: mm.name || mid,
          dimension_id: (mm || {}).dimension, score: sc, max_score: mx,
          score_ratio: ratio, unit: unit,
          fixed_zero: mm.fixed_zero_anchor === undefined ? null : mm.fixed_zero_anchor,
          fixed_full: mm.fixed_full_anchor === undefined ? null : mm.fixed_full_anchor,
          threshold_origin_type: mm.threshold_origin_type || null,
          source_date: src, text: tpls[mid] || (mm.name || mid)
        };
      });
    }
    // compact record -> display objects (keys: b/s/band/p/r/c/n)
    if (rec && rec.p && !rec.positive) {
      rec = {
        base_score: rec.b, band: rec.band, positive: rec.p, risk: rec.r,
        conclusion_text: rec.c,
        counts: { positive: rec.n[0], neutral: rec.n[1], weak: rec.n[2], risk: rec.n[3] },
        base_state: rec.s
      };
    }
    if (!rec) {
      return {
        judgement: { base_score: base, band: null, positive: [], risk: [],
          conclusion_text: "该历史日未预生成研判（仅正式发布日与已生成历史记录提供）。",
          boundary_note: "研判由本地 Artifact Builder 生成，浏览器不生成任何结论。" },
        resonance: { contract: "CMB_SCORE_SIGNAL_DISPLAY_CONTRACT_V1",
          status: "RESEARCH_DISPLAY_ONLY", base_signal: { score: base, score_ratio: BaseRatio(base) },
          dimensions: dims.map(function (d) {
            return { dimension_id: d.dimension_id, name: d.name, score: d.score,
              max_score: d.max_score, score_ratio: d.score_ratio, status: d.status,
              state: bandState(d.score_ratio), state_label: bandLabel(d.score_ratio) };
          }),
          counts: { positive: 0, neutral: 0, weak: 0, risk: 0 },
          boundary: "评分信号 = 评分状态（Score State），不是交易信号。" }
      };
    }
    var dimStates = dims.map(function (d) {
      return { dimension_id: d.dimension_id, name: d.name, score: d.score,
        max_score: d.max_score, score_ratio: d.score_ratio, status: d.status,
        state: bandState(d.score_ratio), state_label: bandLabel(d.score_ratio) };
    });
    return {
      judgement: {
        base_score: rec.base_score, band: rec.band,
        positive: expand(rec.positive, tpl.positive),
        risk: expand(rec.risk, tpl.risk),
        conclusion_text: rec.conclusion_text,
        boundary_note: "本研判只描述量化状态，不构成投资建议。"
      },
      resonance: { contract: "CMB_SCORE_SIGNAL_DISPLAY_CONTRACT_V1",
        status: "RESEARCH_DISPLAY_ONLY",
        base_signal: { score: rec.base_score, score_ratio: BaseRatio(rec.base_score),
          state: rec.base_state, label: bandLabel(BaseRatio(rec.base_score)) },
        dimensions: dimStates, counts: rec.counts,
        boundary: "评分信号 = 评分状态（Score State），不是交易信号。" }
    };
  }
  function BaseRatio(v) { return (v === null || v === undefined) ? null : v / 100; }
  var BANDS = [
    [85, 101, "POSITIVE", "高位共振"], [70, 85, "POSITIVE", "积极研究"],
    [60, 70, "NEUTRAL", "偏积极"], [45, 60, "NEUTRAL", "中性观察"],
    [30, 45, "WEAK", "偏谨慎"], [0, 30, "RISK", "谨慎研究"]
  ];
  function bandOf(ratio) {
    if (ratio === null || ratio === undefined) return null;
    var p = ratio * 100;
    for (var i = 0; i < BANDS.length; i++) {
      if (p >= BANDS[i][0] && p < BANDS[i][1]) return BANDS[i];
    }
    return BANDS[BANDS.length - 1];
  }
  function bandState(r) { var b = bandOf(r); return b ? b[2] : "UNAVAILABLE"; }
  function bandLabel(r) { var b = bandOf(r); return b ? b[3] : "不可用"; }

  function loadDay(day) {
    return loadJson("data/history/" + day + ".json");
  }

  function boot() {
    loadJson(REGISTRY).then(function (reg) {
      state.registry = reg;
      state.bank = renderBankSelector() || (reg.banks || [])[0];
      return Promise.all([
        loadJson("assets/meta.json").catch(function () { return null; }),
        loadJson(state.bank.current_data_path || ("data/banks/" + bankDir() + "/current.json"))
      ]);
    }).then(function (res) {
      state.meta = res[0];
      var c = res[1];
      renderDaySelector(c);
      renderAll(c);
      // threshold metric list comes from the registry entry
      var ms = (state.bank && state.bank.threshold_metrics) || [];
      if (ms.length) { renderThresholdShell(ms); renderThreshold(); }
      else { el("threshold").innerHTML = '<div class="hint">无已冻结动态阈值指标。</div>'; }
      return loadHistory();
    }).catch(function (e) {
      showError("EMPTY / ERROR：无法加载公开产物（" + e.message + "）。");
    });

    el("bank-select").addEventListener("change", function () {
      var id = el("bank-select").value;
      state.bank = (state.registry.banks || []).filter(function (b) { return b.bank_id === id; })[0];
      if (!state.bank) return;
      loadJson(state.bank.current_data_path).then(function (c) {
        renderDaySelector(c); renderAll(c);
        var ms = state.bank.threshold_metrics || [];
        state.thresholdMetric = null;
        if (ms.length) { renderThresholdShell(ms); renderThreshold(); }
        return loadHistory();
      }).catch(function (e) { showError("切换银行失败：" + e.message); });
    });

    el("day-select").addEventListener("change", function () {
      var d = el("day-select").value;
      var c = state.current;
      if (!c || d === c.score_date) { renderAll(c); return; }
      loadDay(d).then(function (x) {
        renderAll(v1ToV2(x, state.meta));
      }).catch(function () {
        showError("NO_SNAPSHOT：所选交易日 " + d + " 没有快照；历史查询不得用最近一天冒充。", "banner-neutral");
      });
    });

    window.addEventListener("resize", function () {
      if (state.fixed) drawHistory();
      if (state.thresholds[state.thresholdMetric]) renderThreshold();
    });
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
