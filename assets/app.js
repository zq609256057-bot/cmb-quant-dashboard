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
 *   history chart     <- SOURCE_V6_ACTUAL_IMPLEMENTATION
 *                        (V6 components.jsx ScoreHistoryChart: dual canvas,
 *                         crosshair overlay, nearest-point locate, tooltip,
 *                         mouse + touch + ArrowLeft/Right, HiDPI, ResizeObserver)
 *   watermark         <- SOURCE_V6_ACTUAL_IMPLEMENTATION (V6 styles.css
 *                        .card::after / .score-hero::after)
 * Boundary vocabulary (V6): the browser may only READ the published
 * artifacts — READ -> FILTER -> FORMAT -> RENDER.  It MUST NOT compute a score.
 * ===================================================================== */
(function () {
  "use strict";

  var GLYPH = "—";
  var SCORE_DECIMALS = 2;   // canonical score decimals (V6/V1 parity)
  var REGISTRY = "data/bank_registry.json";
  var HERO_TITLE = "综合值博率基础评分";
  var NO_HISTORICAL_DETAIL = "NO_HISTORICAL_DETAIL";

  var state = {
    registry: null,           // bank registry
    bank: null,               // active bank entry
    meta: null,               // assets/meta.json
    current: null,            // current.json
    days: [],                 // selectable trading days (READ_ONLY historical artifact)
    dayIndex: null,           // history/days/index.json
    dayChunks: {},            // year -> compact columnar payload (lazy, cached)
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
    thresholdMetric: null,
    histWindow: null,         // [{date, fixed, shadow, price}] for the drawn range
    cursor: null              // crosshair index inside histWindow
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

  /* ---------------- Chinese status labels (Fix 05) ---------------- */
  var STATUS_CN = {
    "FULLY_AVAILABLE": "完整可用", "AVAILABLE": "可用", "SUCCESS": "成功",
    "NOT_FULLY_AVAILABLE": "不完整", "DEGRADED": "降级", "PARTIAL": "部分可用",
    "DEGRADED_OVERLAY_UNAVAILABLE": "不完整", "LOCAL_VALIDATION_PASS": "本地校验通过",
    "PIT_OK": "可用", "FAILED": "失败", "BLOCKED": "阻断",
    "REJECT_STALE": "已过期", "REJECT_FUTURE": "未来日", "ERROR": "错误"
  };
  function statusPill(status) {
    if (!status) return '<span class="pill pill-neutral">' + GLYPH + "</span>";
    var s = String(status), cls = "pill-neutral";
    if (s === "FULLY_AVAILABLE" || s === "SUCCESS" || s === "LOCAL_VALIDATION_PASS" ||
        s === "AVAILABLE" || s === "PIT_OK") cls = "pill-ok";
    else if (s === "NOT_FULLY_AVAILABLE" || s === "DEGRADED" || s === "PARTIAL" ||
             s === "DEGRADED_OVERLAY_UNAVAILABLE") cls = "pill-warn";
    else if (s === "FAILED" || s === "BLOCKED" || s === "REJECT_STALE" ||
             s === "REJECT_FUTURE" || s === "ERROR") cls = "pill-err";
    return '<span class="pill ' + cls + '">' + esc(STATUS_CN[s] || s) + "</span>";
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
    el("top-bank").textContent = (c.bank_name || GLYPH) + " " + (c.bank_code || GLYPH);
    el("top-date").textContent = "评分日 " + (c.score_date || GLYPH);
    el("top-updated").textContent = "数据截至 " + (c.data_asof || GLYPH);
  }

  /* ---------------- B. bank selector ---------------- */
  function renderBankSelector() {
    var reg = state.registry || { banks: [] };
    var sel = el("bank-select");
    sel.innerHTML = (reg.banks || []).map(function (b) {
      var disabled = b.status !== "ACTIVE";
      return '<option value="' + esc(b.bank_id) + '"' + (disabled ? " disabled" : "") + ">" +
        esc(b.name_cn) + " · " + esc(b.bank_id) +
        (disabled ? "（未接入）" : "") + "</option>";
    }).join("");
    var active = (reg.banks || []).filter(function (b) { return b.status === "ACTIVE"; });
    sel.value = active.length ? active[0].bank_id : ((reg.banks || [])[0] || {}).bank_id;
    el("bank-status").textContent =
      "当前已正式接入 " + (reg.active_count === undefined ? active.length : reg.active_count) + " 家银行";
    el("bank-current").textContent = active.length
      ? "当前：" + active[0].name_cn + " · " + active[0].bank_id
      : "当前：无正式接入银行";
    return active.length ? active[0] : null;
  }

  /* ---------------- C. day selector (Fix 02) ---------------- */
  function renderDaySelector(c) {
    var days = (c && c.published_days) || [];
    if (!days.length && c && c.score_date) days = [c.score_date];
    state.days = days.slice().sort();
    var sel = el("day-select");
    // Newest first; only the newest day carries the 「最新」 suffix.
    sel.innerHTML = state.days.slice().reverse().map(function (d) {
      return '<option value="' + esc(d) + '">' + esc(d) +
        (d === c.score_date ? "（最新）" : "") + "</option>";
    }).join("");
    sel.value = c.score_date || state.days[state.days.length - 1];
    el("day-status").textContent = "可查询交易日 " + state.days.length + " 个 · 起始 " +
      (state.days[0] || GLYPH) + " · 截止 " + (state.days[state.days.length - 1] || GLYPH);
    el("day-current").textContent = "缺失的交易日不显示评分，不使用其他日期代替";
  }

  /* ---------------- D. hero (Fix 01 / 03 / 04) ---------------- */
  function renderHero(c) {
    var tone = toneOf(c.base_score, c.base_score_max === undefined ? 100 : c.base_score_max,
                      c.base_score_status);
    var hero = el("hero");
    hero.className = "score-hero score-tone-" + tone;

    // Fix 01: bank name / code / score date above the big score; every field is
    // read from the published artifact and follows the selected trading day.
    el("hero-bank").textContent = c.bank_name || GLYPH;
    el("hero-code").textContent = c.bank_code || GLYPH;
    el("hero-date").textContent = c.score_date || GLYPH;
    el("hero-title").textContent = HERO_TITLE;

    var s = el("hero-score");
    s.className = "score-big " + toneTextCls(tone) + " hero-tone-" + tone;
    s.textContent = (c.base_score === null || c.base_score === undefined)
      ? GLYPH : fmt(c.base_score, SCORE_DECIMALS);
    var sd = (c.signal_resonance && c.signal_resonance.base_signal) || {};
    el("hero-verdict").textContent = (c.base_score === null || c.base_score === undefined)
      ? "暂无评分状态" : (sd.label || GLYPH);
    el("hero-fill").style.width = barWidth(c.base_score, 100).toFixed(2) + "%";

    // Fix 04: three statistics.  A missing Overlay / Final is rendered as the
    // em dash — never as 0, and never derived in the browser.
    var overlayText = (c.overlay_status === "FULLY_AVAILABLE" && c.overlay_score !== null &&
                       c.overlay_score !== undefined)
      ? fmt(c.overlay_score, SCORE_DECIMALS) : GLYPH;
    var finalText = (c.final_score_status === "FULLY_AVAILABLE" && c.final_score !== null &&
                     c.final_score !== undefined)
      ? fmt(c.final_score, SCORE_DECIMALS) : GLYPH;
    el("hero-stats").innerHTML =
      statBox("基础评分的得分", fmt(c.base_score, SCORE_DECIMALS), tone) +
      statBox("Risk Overlay 的得分", overlayText, "unavailable") +
      statBox("实际得分", finalText, "unavailable");
  }
  function statBox(k, v, tone) {
    return '<div><span class="k">' + esc(k) + '</span><span class="v ' +
      toneTextCls(tone) + '">' + esc(v) + "</span></div>";
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
          "</span></div>";
    }).join("");

    el("decomp").innerHTML = dims.map(function (d) {
      var tone = toneOf(d.score, d.max_score, d.status);
      return '<div class="score-row">' +
        '<div class="score-row-head"><span class="score-row-label">' + esc(d.name) +
          '</span><span class="score-row-score ' + toneTextCls(tone) + '">' +
          fmt(d.score, 2) + " / " + fmt(d.max_score, 0) + "</span></div>" +
        '<div class="score-bar-wrap"><i class="score-bar-fill" style="width:' +
          barWidth(d.score, d.max_score).toFixed(2) + '%"></i></div>' +
        '<div class="score-row-meta"><span>得分率 ' + pct(d.score_ratio) +
          "</span><span>" + statusPill(d.status) + "</span></div></div>";
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
      var body = rows.length
        ? rows.map(metricRow).join("")
        : '<div class="hint" style="padding:10px">' + NO_HISTORICAL_DETAIL +
          "：该交易日没有可用的指标明细，页面不以任何方式估算或填充。</div>";
      return '<section class="card dim-card score-tone-' + tone + '">' +
        '<div class="dim-head"><div><span class="dim-name">' + esc(ORD[d.dimension_id] || "") +
          " " + esc(d.name) + '</span><div class="hint">' + rows.length +
          ' 项指标</div></div>' +
          '<div><span class="dim-score ' + toneTextCls(tone) + '">' + fmt(d.score, 2) +
          '</span><span class="dim-max"> / ' + fmt(d.max_score, 0) + "</span></div></div>" +
        '<div class="score-bar-wrap"><i class="score-bar-fill" style="width:' +
          barWidth(d.score, d.max_score).toFixed(2) + '%"></i></div>' +
        '<div style="margin-top:10px">' + body + "</div></section>";
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
    return '<span class="thr-chip">阈值区间 ' + esc(fmt(z, 4)) + " → " + esc(fmt(f, 4)) +
      ' <b>' + esc(pos) + "</b></span>";
  }
  function metricRow(m) {
    var tone = toneOf(m.score, m.max_score, m.status);
    return '<div class="score-row">' +
      '<div class="score-row-head"><span class="score-row-label">' + esc(m.name) + "</span>" +
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

  /* ---------------- L. ⑦ 综合研判 (Fix 06: no engineering trace) -------- */
  function renderJudgement(c) {
    var j = c.comprehensive_judgement;
    if (!j) { el("judgement").innerHTML = '<div class="hint">暂无研判数据。</div>'; return; }
    function items(list) {
      if (!list || !list.length) {
        return '<li><i class="factor-dot"></i>无符合条件的项目。</li>';
      }
      return list.map(function (f) {
        return '<li><i class="factor-dot"></i><span>' + esc(f.text || "") + "</span></li>";
      }).join("");
    }
    el("judgement").innerHTML =
      '<div class="judgement-zone positive"><h3>A · 主要正向因素</h3><ul>' +
        items(j.positive) + "</ul></div>" +
      '<div class="judgement-zone negative"><h3>B · 主要风险因素</h3><ul>' +
        items(j.risk) + "</ul></div>" +
      '<div class="judgement-zone conclusion"><h3>C · 综合研判</h3><ul><li>' +
        '<i class="factor-dot"></i><span>' + esc(j.conclusion_text || GLYPH) + "</span></li></ul>" +
        '<p class="interpretation-boundary">' + esc(j.advice_disclaimer || j.boundary_note || "") + "</p></div>";
  }

  /* ---------------- M. ⑧ 评分信号共振 (Fix 07) ---------------- */
  function renderResonance(c) {
    var r = c.signal_resonance;
    if (!r) { el("resonance").innerHTML = '<div class="hint">暂无共振数据。</div>'; return; }
    var dims = r.dimensions || [];
    var counts = r.counts || {};
    var intervals = r.intervals || [];
    var cur = r.current_interval || null;

    // Fix 07 / §19: the six generic 0-100 bands with an explicit current
    // position marker (V6 SignalDisplayCard: tr.is-current + .current-badge).
    // `is_current` is decided by the LOCAL builder, never here.
    var bandTable = intervals.length
      ? '<div style="overflow-x:auto"><table class="signal-table">' +
          "<colgroup><col><col><col></colgroup>" +
          "<thead><tr><th>评分区间</th><th>评分信号</th><th>展示参考</th></tr></thead><tbody>" +
          intervals.map(function (iv) {
            return '<tr class="' + (iv.is_current ? "is-current" : "") + '">' +
              '<td><i class="dot ' + esc(stateColor(iv.state)) + '"></i>' + esc(iv.score_range) +
              (iv.is_current ? '<span class="current-badge">当前</span>' : "") + "</td>" +
              "<td>" + esc(iv.label) + "</td>" +
              "<td>" + esc(iv.display_reference || "") + "</td></tr>";
          }).join("") + "</tbody></table></div>"
      : "";

    el("resonance").innerHTML =
      '<div class="signal-toolbar"><span>六档评分区间 · 当前位置标记</span><span>' +
        esc(cur ? ("当前 " + fmt(r.current_score, SCORE_DECIMALS) + " · " + cur.score_range +
                   " · " + cur.label) : "当前不可用") + "</span></div>" +
      bandTable +
      '<div style="margin-top:12px;overflow-x:auto"><table class="signal-table">' +
        "<colgroup><col><col><col><col></colgroup>" +
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
        cnt("c-positive", "正向", counts.positive) +
        cnt("c-neutral", "中性", counts.neutral) +
        cnt("c-weak", "偏弱", counts.weak) +
        cnt("c-risk", "风险", counts.risk) +
      "</div>" +
      '<p class="score-signal-explanation"><strong>综合评分状态：' +
        esc((r.base_signal || {}).label || GLYPH) + "（得分率 " +
        pct((r.base_signal || {}).score_ratio) + "）</strong>" +
        "<span>评分信号 = 评分状态（Score State），不是交易信号；本表只提供展示参考，不产生任何买卖指令。</span></p>";
  }
  function stateColor(s) {
    var u = String(s || "").toUpperCase();
    if (u === "POSITIVE") return "green";
    if (u === "NEUTRAL") return "amber";
    if (u === "WEAK") return "amber";
    if (u === "RISK") return "red";
    return "purple";
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

  /* ---------------- N. ⑨ 历史评分回测 (New 11) ---------------- */
  var MODE_LABEL = { FIXED: "正式评分", SHADOW: "研究用动态口径（非生产）",
                     COMPARE: "正式 + 研究口径" };

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
          ["FIXED", "SHADOW", "COMPARE"].map(function (m) {
            return '<button data-mode="' + m + '"' + (m === state.histMode ? ' class="active"' : "") +
              ">" + MODE_LABEL[m] + "</button>";
          }).join("") + "</div>" +
      "</div>" +
      '<div class="toggle-row"><label><input type="checkbox" id="hist-price"' +
        (state.showPrice ? " checked" : "") + "> 叠加招商银行股价（右轴对照，仅观察 Score vs Price）</label>" +
        '<span id="hist-note" class="hint"></span></div>' +
      '<div class="chart-scroll"><div class="chart-shell" id="hist-shell">' +
        '<canvas id="hist-canvas" class="score-canvas" tabindex="0" role="img" ' +
          'aria-label="招商银行历史评分曲线" aria-describedby="hist-tip"></canvas>' +
        '<canvas id="hist-cross" class="chart-crosshair" aria-hidden="true"></canvas>' +
        '<div id="hist-tip" class="chart-tooltip" hidden></div>' +
      "</div></div>" +
      '<div class="chart-legend"><span><i class="lg-fixed"></i>正式评分</span>' +
        '<span><i class="lg-shadow"></i>研究用动态口径（非生产）</span>' +
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
    // V6 ScoreHistoryChart interaction parity (New 11).
    var canvas = el("hist-canvas");
    canvas.addEventListener("mousemove", function (e) { locate(e.clientX); });
    canvas.addEventListener("click", function (e) { locate(e.clientX); });
    canvas.addEventListener("mouseleave", function () { setCursor(null); });
    canvas.addEventListener("blur", function () { setCursor(null); });
    canvas.addEventListener("touchstart", function (e) {
      if (e.touches && e.touches[0]) locate(e.touches[0].clientX);
    }, { passive: true });
    canvas.addEventListener("touchmove", function (e) {
      if (e.touches && e.touches[0]) locate(e.touches[0].clientX);
    }, { passive: true });
    canvas.addEventListener("touchend", function () { setCursor(null); });
    canvas.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      var n = (state.histWindow || []).length;
      if (!n) return;
      var cur = state.cursor === null ? n - 1 : state.cursor;
      setCursor(Math.max(0, Math.min(n - 1, cur + (e.key === "ArrowLeft" ? -1 : 1))));
    });
    if (typeof ResizeObserver !== "undefined") {
      var ro = new ResizeObserver(function () {
        if (state.fixed) drawHistory();
      });
      ro.observe(el("hist-shell"));
    }
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
    var win = idx.map(function (i) {
      return { date: f.dates[i], fixed: f.base_score[i] };
    });
    if (sh && sh.dates) {
      var map = {};
      for (var k = 0; k < sh.dates.length; k++) map[sh.dates[k]] = sh.shadow_score[k];
      win.forEach(function (p) {
        p.shadow = map[p.date] === undefined ? null : map[p.date];
      });
    }
    if (state.showPrice && pr && pr.dates) {
      var pmap = {};
      for (var q = 0; q < pr.dates.length; q++) pmap[pr.dates[q]] = pr.close[q];
      win.forEach(function (p) {
        p.price = pmap[p.date] === undefined ? null : pmap[p.date];
      });
    }
    state.histWindow = win;
    state.cursor = null;

    var showFixed = state.histMode !== "SHADOW";
    var showAlt = state.histMode !== "FIXED";

    el("hist-note").textContent =
      "区间 " + win[0].date + " → " + win[win.length - 1].date + " · " + win.length +
      " 个交易日 · 起始日为最早完整可用日，截止日随每日生产自动延伸";

    var minS = Infinity, maxS = -Infinity;
    function acc(v) { if (v !== null && v !== undefined && isFinite(v)) { if (v < minS) minS = v; if (v > maxS) maxS = v; } }
    if (showFixed) win.forEach(function (p) { acc(p.fixed); });
    if (showAlt) win.forEach(function (p) { acc(p.shadow); });
    if (!isFinite(minS)) { minS = 0; maxS = 100; }
    var pad = Math.max(0.6, (maxS - minS) * 0.12);
    minS -= pad; maxS += pad;

    drawSeries("hist-canvas", win.map(function (p) { return p.date; }), [
      { data: showFixed ? win.map(function (p) { return p.fixed; }) : null,
        color: "#7c3aed", width: 2, dash: null },
      { data: showAlt ? win.map(function (p) { return p.shadow; }) : null,
        color: "#2563eb", width: 2, dash: [6, 4] }
    ], state.showPrice ? win.map(function (p) { return p.price; }) : null, minS, maxS);

    var lastF = win[win.length - 1].fixed;
    var lastS = win[win.length - 1].shadow;
    var firstF = win[0].fixed;
    el("hist-summary").innerHTML =
      sumRow("区间起始 正式评分", fmt(firstF, 2)) +
      sumRow("区间最新 正式评分", fmt(lastF, 2)) +
      sumRow("区间变动", (isFinite(lastF) && isFinite(firstF)) ? fmt(lastF - firstF, 2) : GLYPH) +
      sumRow("研究用动态口径最新", state.histMode === "FIXED" ? "未开启" : fmt(lastS, 2));
    drawCrosshair();
  }
  function sumRow(k, v) {
    return '<div><small>' + esc(k) + "</small><strong>" + esc(v) + "</strong></div>";
  }

  /* ---------------- canvas engine (V6 dual-canvas parity) ---------------- */
  function prepCanvas(canvas, w, h) {
    if (!canvas) return null;
    var ctx;
    try { ctx = canvas.getContext("2d"); } catch (e) { return null; }
    if (!ctx) return null;
    var ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
    canvas.style.height = h + "px";
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return ctx;
  }

  function drawSeries(canvasId, labels, series, rightSeries, minV, maxV) {
    var cv = el(canvasId);
    if (!cv) return;
    var shell = cv.parentNode;
    var w = Math.max(320, Math.floor((shell ? shell.clientWidth : 900) - 16));
    var h = 240;
    var g = prepCanvas(cv, w, h);
    if (!g) return;

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
          if (pv === null || pv === undefined || !isFinite(pv)) continue;
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
    // Geometry cache shared with the crosshair overlay (V6 parity).
    cv._geom = { w: w, h: h, ml: ml, mr: mr, mt: mt, mb: mb,
                 pw: pw, ph: ph, n: n, X: X, Y: Y, minV: minV, maxV: maxV };
  }

  /* V6 ScoreHistoryChart.locate(): nearest trading day snap. */
  function locate(clientX) {
    var cv = el("hist-canvas");
    if (!cv || !cv._geom || !state.histWindow || !state.histWindow.length) return;
    var g = cv._geom;
    var rect = cv.getBoundingClientRect();
    var rel = clientX - rect.left - g.ml;
    rel = Math.max(0, Math.min(g.pw, rel));
    var i = Math.round((rel / (g.pw || 1)) * (g.n - 1));
    setCursor(i);
  }

  function setCursor(i) {
    state.cursor = i;
    drawCrosshair();
  }

  function drawCrosshair() {
    var cv = el("hist-canvas"), cross = el("hist-cross"), tip = el("hist-tip");
    if (!cross || !cv || !cv._geom) return;
    var g = cv._geom;
    var ctx = prepCanvas(cross, g.w, g.h);
    if (!ctx) return;
    var i = state.cursor;
    var p = (i === null || i === undefined) ? null : (state.histWindow || [])[i];
    if (!p) { tip.hidden = true; return; }
    var x = g.X(i);
    ctx.strokeStyle = "#999999"; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(x, g.mt); ctx.lineTo(x, g.mt + g.ph); ctx.stroke();
    ctx.setLineDash([]);
    var showFixed = state.histMode !== "SHADOW";
    var showAlt = state.histMode !== "FIXED";
    if (showFixed && p.fixed !== null && p.fixed !== undefined) {
      ctx.beginPath(); ctx.arc(x, g.Y(p.fixed), 4, 0, Math.PI * 2);
      ctx.fillStyle = "#7c3aed"; ctx.fill();
    }
    if (showAlt && p.shadow !== null && p.shadow !== undefined) {
      ctx.beginPath(); ctx.arc(x, g.Y(p.shadow), 3.5, 0, Math.PI * 2);
      ctx.fillStyle = "#2563eb"; ctx.fill();
    }
    tip.hidden = false;
    tip.innerHTML = "<strong>" + esc(p.date) + "</strong>" +
      "<span>正式评分 " + esc(fmt(p.fixed, SCORE_DECIMALS)) + " / 100</span>" +
      (showAlt ? "<span>研究用动态口径 " + esc(fmt(p.shadow, SCORE_DECIMALS)) + "</span>" : "") +
      (state.showPrice ? "<span>股价 " + esc(fmt(p.price, SCORE_DECIMALS)) + "</span>" : "");
  }

  /* ---------------- O. ⑩ 动态阈值研究 ---------------- */
  function renderThresholdShell(metrics) {
    state.thresholdMetric = state.thresholdMetric || (metrics[0] && metrics[0].metric_id);
    el("threshold").innerHTML =
      '<div class="historical-toolbar"><div><div class="hint">指标选择</div>' +
        '<div class="index-tabs" id="th-tabs" style="min-width:320px">' +
        metrics.map(function (m, i) {
          /* The engineering metric_id is a data key only — the DOM carries a
             positional index so no engineering ID reaches the page source. */
          return '<button data-idx="' + i + '"' +
            (m.metric_id === state.thresholdMetric ? ' class="active"' : "") + ">" +
            esc(m.name || "") + "</button>";
        }).join("") + "</div></div>" +
        '<div class="hint" id="th-note"></div></div>' +
      '<div class="threshold-panel"><div class="threshold-heading">' +
        '<div><strong id="th-title">—</strong><br><span id="th-sub">—</span></div>' +
        '<span class="badge">仅研究用途</span></div>' +
        '<div class="chart-scroll"><div class="chart-shell">' +
          '<canvas id="th-canvas" class="score-canvas"></canvas></div></div>' +
        '<div class="chart-legend" id="th-legend"></div>' +
        '<div class="threshold-grid" id="th-grid"></div>' +
        '<div id="th-status"></div></div>';
    el("th-tabs").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-idx]");
      if (!b) return;
      var i = parseInt(b.getAttribute("data-idx"), 10);
      var ms = (state.bank && state.bank.threshold_metrics) || [];
      if (!ms[i]) return;
      state.thresholdMetric = ms[i].metric_id;
      Array.prototype.forEach.call(el("th-tabs").querySelectorAll("button"), function (x) {
        x.className = x.getAttribute("data-idx") === String(i) ? "active" : "";
      });
      renderThreshold();
    });
  }

  function renderThreshold() {
    var mid = state.thresholdMetric;
    function go() {
      var t = state.thresholds[mid];
      if (!t) { el("th-title").textContent = "无数据"; return; }
      el("th-title").textContent = t.name || GLYPH;
      el("th-sub").textContent = "研究区间 " + (t.window_start || GLYPH) +
        " → " + (t.window_end || GLYPH);
      /* Threshold-evolution view only: Fixed anchors (dashed) vs research
         dynamic band (solid).  The raw metric series is NOT published. */
      el("th-legend").innerHTML =
        '<span><i style="background:#dc2626"></i>固定阈值下锚</span>' +
        '<span><i style="background:#059669"></i>固定阈值上锚</span>' +
        '<span><i style="background:#7c3aed"></i>研究动态下界</span>' +
        '<span><i style="background:#2563eb"></i>研究动态上界</span>';
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
      drawSeries("th-canvas", labels, series, null, mn - pd, mx + pd);
      el("th-grid").innerHTML =
        sumRow("固定阈值下锚", fmt(t.fixed_lower, 4)) +
        sumRow("固定阈值上锚", fmt(t.fixed_upper, 4)) +
        sumRow("最新研究动态下界", fmt(t.latest_dynamic_lower, 4)) +
        sumRow("最新研究动态上界", fmt(t.latest_dynamic_upper, 4));
      el("th-status").innerHTML = (t.note || "") +
        '<div class="status-note"><strong>逐步推进验证</strong><span>' +
        "每个历史时点只使用该时点之前已经合法可用的数据，不使用全样本阈值回套历史，" +
        "不存在未来数据泄漏；低频指标按真实披露次数计数。</span></div>";
    }
    if (state.thresholds[mid]) { go(); return; }
    loadJson("data/banks/" + bankDir() + "/history/thresholds/" + mid + ".json")
      .then(function (t) { state.thresholds[mid] = t; go(); })
      .catch(function () { el("th-note").textContent = "该指标阈值数据不可用。"; });
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

  /* ---------------- READ_ONLY historical day artifact (Fix 02) ---------- */
  function dayIndexPath() {
    if (state.current && state.current.days_index_path) return state.current.days_index_path;
    return "data/banks/" + bankDir() + "/history/days/index.json";
  }
  function dayChunk(day) {
    var year = String(day).slice(0, 4);
    if (state.dayChunks[year]) return Promise.resolve(state.dayChunks[year]);
    return loadJson("data/banks/" + bankDir() + "/history/days/" + year + ".json")
      .then(function (c) { state.dayChunks[year] = c; return c; });
  }
  function loadDayIndex() {
    return loadJson(dayIndexPath()).then(function (idx) {
      state.dayIndex = idx;
      return idx;
    }).catch(function () { return null; });
  }

  function renderAll(c) {
    state.current = c;
    renderTop(c);
    renderHero(c);
    renderDimensions(c);
    renderMetricSections(c);
    renderJudgement(c);
    renderResonance(c);
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
    return finishDay(a.score_date, base, dims, metrics, j, a, meta);
  }

  /* The READ_ONLY_HISTORICAL_FRONTEND_ARTIFACT variant: the same view model,
     but the numbers come from the compact per-year columnar payload.  This is
     READ + FILTER (take one column index) + FORMAT + RENDER — nothing else.
     A day whose 24-metric detail is not complete is rendered as
     NO_HISTORICAL_DETAIL; it is never estimated or back-filled. */
  function chunkToV2(chunk, i, meta) {
    var dimMeta = (meta && meta.dimensions) || {};
    var mMeta = (meta && meta.metrics) || {};
    var dims = Object.keys(dimMeta).sort().map(function (did) {
      var d = dimMeta[did] || {};
      var col = (chunk.dimensions || {})[did] || [];
      var sc = col[i] === undefined ? null : col[i];
      var mx = d.max_score;
      return {
        dimension_id: did, name: d.name, en: d.en, max_score: mx,
        score: sc, score_ratio: (sc === null || !mx) ? null : sc / mx,
        status: sc === null ? "NOT_FULLY_AVAILABLE" : "FULLY_AVAILABLE",
        metric_ids: d.metrics || []
      };
    });
    var detail = (chunk.detail_status || [])[i];
    var metrics = [];
    if (detail === "FULL") {
      metrics = Object.keys(mMeta).sort().map(function (mid) {
        var m = mMeta[mid] || {};
        var col = (chunk.metrics || {})[mid] || [];
        var sc = col[i] === undefined ? null : col[i];
        var mx = m.max_score;
        return {
          metric_id: mid, name: m.name, abbr: m.abbr, dimension_id: m.dimension,
          max_score: mx, score: sc, score_ratio: (sc === null || !mx) ? null : sc / mx,
          fixed_zero: m.fixed_zero_anchor === undefined ? null : m.fixed_zero_anchor,
          fixed_full: m.fixed_full_anchor === undefined ? null : m.fixed_full_anchor,
          threshold_origin_type: m.threshold_origin_type || null, unit: m.unit,
          status: sc === null ? "NOT_FULLY_AVAILABLE" : "FULLY_AVAILABLE",
          source_date: chunk.dates[i], data_asof: chunk.dates[i]
        };
      });
    }
    var base = (chunk.base_score || [])[i];
    if (base === undefined) base = null;
    var j = pregeneratedJudgement(chunk.dates[i], dims, metrics, base);
    var view = finishDay(chunk.dates[i], base, dims, metrics, j,
                         { data_asof: chunk.dates[i],
                           available_weight: (chunk.available_weight || [])[i],
                           model_id: "CMB_SCORE_MODEL_V1_1", model_version: "V1_1" },
                         meta);
    view.historical = true;
    view.no_historical_detail = (detail !== "FULL");
    return view;
  }

  function finishDay(day, base, dims, metrics, j, src, meta) {
    return {
      artifact: "CMB_BANK_DAY_VIEW_V2",
      frontend_version: (meta && meta.frontend_version) || "CMB_FRONTEND_V2",
      bank_code: "600036.SH", bank_name: "招商银行",
      model_id: src.model_id, model_version: src.model_version,
      model_profile: "CMB_PROFILE",
      score_date: day, data_asof: src.data_asof,
      base_score: base, base_score_max: (meta && meta.total_score) || 100,
      base_score_status: base === null ? "NOT_FULLY_AVAILABLE" : "FULLY_AVAILABLE",
      overlay_score: null,
      overlay_status: "NOT_FULLY_AVAILABLE",
      final_score: null,
      final_score_status: "NOT_FULLY_AVAILABLE",
      available_weight: src.available_weight === undefined ? null : src.available_weight,
      missing_metric_ids: [],
      dimensions: dims, metrics: metrics,
      signal_resonance: j.resonance, comprehensive_judgement: j.judgement,
      published_days: state.days
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
        var src = null;
        for (var i = 0; i < metrics.length; i++) {
          if (metrics[i].metric_id === mid) { src = metrics[i].source_date; break; }
        }
        var mm = (state.meta && state.meta.metrics && state.meta.metrics[mid]) || {};
        return {
          metric_id: mid, name: mm.name || mid,
          dimension_id: (mm || {}).dimension, score: sc, max_score: mx,
          score_ratio: ratio, unit: mm.unit,
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
          intervals: [], current_interval: null, current_score: base,
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
    var band = bandOf(BaseRatio(rec.base_score));
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
        intervals: localIntervals(band),
        current_interval: band ? { score_range: rangeOf(band), label: band[3],
          state: band[2], color: colorOfState(band[2]) } : null,
        current_score: rec.base_score,
        dimensions: dimStates, counts: rec.counts,
        boundary: "评分信号 = 评分状态（Score State），不是交易信号。" }
    };
  }
  function BaseRatio(v) { return (v === null || v === undefined) ? null : v / 100; }
  var BANDS = [
    [85, 101, "POSITIVE", "高位共振", "多维评分整体处于高位，作为重点研究样本持续跟踪。"],
    [70, 85, "POSITIVE", "积极研究", "多维支撑较强，适合纳入重点观察范围。"],
    [60, 70, "NEUTRAL", "偏积极", "评分结构略偏积极，结合分项状态继续观察。"],
    [45, 60, "NEUTRAL", "中性观察", "多维结构相对均衡或存在分歧，保持持续观察。"],
    [30, 45, "WEAK", "偏谨慎", "支持因素有限，重点识别风险变化。"],
    [0, 30, "RISK", "谨慎研究", "综合评分处于低位，仅作为风险研究样本。"]
  ];
  function bandOf(ratio) {
    if (ratio === null || ratio === undefined) return null;
    var p = ratio * 100;
    for (var i = 0; i < BANDS.length; i++) {
      if (p >= BANDS[i][0] && p < BANDS[i][1]) return BANDS[i];
    }
    return BANDS[BANDS.length - 1];
  }
  function rangeOf(b) { return b[0] + " – " + (b[1] > 100 ? 100 : b[1]); }
  function colorOfState(s) {
    if (s === "POSITIVE") return "GREEN";
    if (s === "NEUTRAL") return "AMBER";
    if (s === "WEAK") return "RED";
    return "RED";
  }
  /* The six bands are a frozen constant of the display contract; is_current is
     the ONLY thing derived here, and it is a pure comparison against the
     already-published score — never a score computation. */
  function localIntervals(band) {
    return BANDS.map(function (b) {
      return { score_range: rangeOf(b), minimum: b[0],
               maximum: b[1] > 100 ? 100 : b[1],
               label: b[3], state: b[2], color: colorOfState(b[2]),
               display_reference: b[4],
               is_current: !!band && band[3] === b[3] };
    });
  }
  function bandState(r) { var b = bandOf(r); return b ? b[2] : "UNAVAILABLE"; }
  function bandLabel(r) { var b = bandOf(r); return b ? b[3] : "不可用"; }

  function loadDay(day) {
    return dayChunk(day).then(function (chunk) {
      var i = (chunk.dates || []).indexOf(day);
      if (i < 0) throw new Error("NO_SNAPSHOT");
      return chunkToV2(chunk, i, state.meta);
    });
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
      return loadDayIndex().then(function (idx) {
        // Fix 02: if the production current.json predates the read-only
        // historical artifact, extend the selector with the validated days.
        if (idx && idx.days && idx.days.length > (c.published_days || []).length) {
          c.published_days = idx.days.slice().sort();
        }
        renderDaySelector(c);
        renderAll(c);
        var ms = (state.bank && state.bank.threshold_metrics) || [];
        if (ms.length) { renderThresholdShell(ms); renderThreshold(); }
        else { el("threshold").innerHTML = '<div class="hint">无已冻结动态阈值指标。</div>'; }
        return loadHistory();
      });
    }).catch(function (e) {
      showError("EMPTY / ERROR：无法加载公开产物（" + e.message + "）。");
    });

    el("bank-select").addEventListener("change", function () {
      var id = el("bank-select").value;
      state.bank = (state.registry.banks || []).filter(function (b) { return b.bank_id === id; })[0];
      if (!state.bank) return;
      loadJson(state.bank.current_data_path).then(function (c) {
        return loadDayIndex().then(function () { return c; });
      }).then(function (c) {
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
        renderAll(x);
      }).catch(function () {
        showError("所选交易日 " + d + " 没有可用快照；页面不使用其他日期代替。", "banner-neutral");
      });
    });

    window.addEventListener("resize", function () {
      if (state.fixed) drawHistory();
      if (state.thresholds[state.thresholdMetric]) renderThreshold();
    });
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
