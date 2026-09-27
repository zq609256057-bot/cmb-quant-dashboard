/* CMB_SCORE_MODEL_V1_1 — presentation layer.
 *
 * STRICT BOUNDARY (§19 / §61 / VC-K03):
 *   The frontend may only READ, FORMAT, RENDER, FILTER and SWITCH HISTORY.
 *   It MUST NOT compute the 24 metrics, the 5 dimensions, base_score,
 *   overlay_score, final_score, PIT availability, macro lag or disclosure
 *   persistence.  Every score shown here was produced locally by
 *   CMB_PRODUCTION_SCORE_ENGINE_V1 and published as a sanitized artifact.
 */
(function () {
  "use strict";

  var GLYPH = "—";            // VC-F01
  var SCORE_DECIMALS = 2;     // VC-F02
  var LATEST = "data/cmb_score_latest.json";
  var INDEX = "data/index.json";
  var HISTORY = "data/history/";
  var META = "assets/meta.json";

  var state = { meta: null, artifact: null, days: [] };

  function el(id) { return document.getElementById(id); }

  function fmtNumber(v, decimals) {
    if (v === null || v === undefined || v === "" || Number.isNaN(Number(v))) return GLYPH;
    var n = Number(v);
    var s = n.toFixed(decimals === undefined ? 2 : decimals);
    // strip trailing zeros but keep at most `decimals` places
    s = s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
    return s;
  }

  function fmtScore(v) { return fmtNumber(v, SCORE_DECIMALS); }

  function statusPill(status) {
    if (!status) return '<span class="pill pill-neutral">' + GLYPH + "</span>";
    var s = String(status);
    var cls = "pill-neutral";
    if (s === "FULLY_AVAILABLE" || s === "SUCCESS" || s === "LOCAL_VALIDATION_PASS" ||
        s === "AVAILABLE" || s === "PIT_OK") cls = "pill-ok";
    else if (s === "NOT_FULLY_AVAILABLE" || s === "DEGRADED" ||
             s === "DEGRADED_OVERLAY_UNAVAILABLE" || s === "PARTIAL") cls = "pill-warn";
    else if (s === "FAILED" || s === "BLOCKED" || s === "REJECT_STALE" ||
             s === "REJECT_FUTURE" || s === "ERROR") cls = "pill-err";
    return '<span class="pill ' + cls + '">' + s + "</span>";
  }

  // Tone bands are DISPLAY ONLY; the numeric thresholds live in the frozen
  // production spec and are never evaluated here.
  function toneClass(score, status) {
    if (score === null || score === undefined ||
        (status && status !== "FULLY_AVAILABLE")) return "hero-tone-unavailable";
    var v = Number(score);
    if (v < 50) return "hero-tone-low";
    if (v < 70) return "hero-tone-middle";
    return "hero-tone-high";
  }

  function showLoading() {
    el("hero-title").textContent = "加载中…";
    el("hero-score").innerHTML = '<span class="skeleton" style="display:inline-block;width:180px;height:72px"></span>';
  }

  function showError(msg, cls) {
    var b = el("banner");
    b.hidden = false;
    b.className = "banner " + (cls || "banner-err");
    b.textContent = msg;
  }

  function renderHero(a) {
    var baseStatus = a.base_score_status;
    var base = a.base_score;
    el("hero-title").textContent = "基础评分（Base Score）";
    el("hero-score").className = "hero-score " + toneClass(base, baseStatus);
    el("hero-score").textContent = (base === null || base === undefined) ? GLYPH : fmtScore(base);
    el("hero-badge").textContent = a.model_id;
    el("hero-date").textContent = a.score_date || GLYPH;
    el("hero-meta").innerHTML = [
      row("数据截至 data_asof", a.data_asof || GLYPH),
      row("可用权重 available_weight", fmtNumber(a.available_weight)),
      row("缺失指标 missing_metric_ids",
          (a.missing_metric_ids && a.missing_metric_ids.length)
            ? a.missing_metric_ids.join(", ") : "无")
    ].join("");
    var maxTotal = Number(state.meta && state.meta.total_score) || 100;
    var pct = (base === null || base === undefined) ? 0 : Math.max(0, Math.min(100, (Number(base) / maxTotal) * 100));
    el("hero-track").firstElementChild.style.width = pct.toFixed(2) + "%";
  }

  function row(k, v) {
    return '<div><span class="k">' + k + '</span><span class="v">' + v + "</span></div>";
  }

  function renderScores(a) {
    var cards = [
      { t: "基础评分 Base", v: a.base_score, s: a.base_score_status,
        sub: "24 项 / 5 维 / 100 分制" },
      { t: "风险叠加 Overlay", v: a.overlay_score, s: a.overlay_status,
        sub: a.overlay_status === "NOT_FULLY_AVAILABLE" ? "不可完整计算" : "范围 0 ~ -20" },
      { t: "最终评分 Final", v: a.final_score, s: a.final_score_status,
        sub: "Base + Overlay" }
    ];
    el("score-cards").innerHTML = cards.map(function (c) {
      var unavailable = c.v === null || c.v === undefined;
      var val = unavailable
        ? '<span class="glyph">' + GLYPH + "</span>"
        : '<span class="num">' + fmtScore(c.v) + "</span>";
      return '<div class="kpi-card">' +
        '<div class="kpi-name">' + c.t + "</div>" +
        '<div class="kpi-value">' + val + "</div>" +
        '<div class="kpi-max">' + statusPill(c.s) + " · " + c.sub + "</div>" +
        "</div>";
    }).join("");

    // §57: BASE is never FINAL, and a missing overlay is never zero.
    var note = el("base-final-note");
    if (a.final_score_status === "NOT_FULLY_AVAILABLE") {
      note.hidden = false;
      note.className = "banner banner-warn";
      note.innerHTML = "<strong>BASE ≠ FINAL</strong>：Overlay 无法完整计算，最终评分为 " +
        GLYPH + "（NOT_FULLY_AVAILABLE）。" +
        "<br>缺失输入（GROUP 口径）<strong>" +
        ((a.overlay_missing_fields && a.overlay_missing_fields.length)
          ? a.overlay_missing_fields.join("、") : "未点名") +
        "</strong>。缺失不等于 0，COMPANY 口径不得替代 GROUP 口径。";
    } else {
      note.hidden = true;
    }
  }

  function renderDimensions(a) {
    var meta = (state.meta && state.meta.dimensions) || {};
    var order = Object.keys(meta).sort();
    if (!order.length) order = Object.keys(a.dimension_scores || {}).sort();
    el("dim-grid").innerHTML = order.map(function (d) {
      var m = meta[d] || {};
      var v = (a.dimension_scores || {})[d];
      return '<div class="kpi-card">' +
        '<div class="kpi-name">' + (m.name || d) + "</div>" +
        '<div class="kpi-value">' + (v === null || v === undefined ? GLYPH : fmtScore(v)) + "</div>" +
        '<div class="kpi-max">满分 ' + (m.max_score === undefined ? GLYPH : m.max_score) + "</div>" +
        "</div>";
    }).join("");
  }

  function renderMetrics(a) {
    var meta = (state.meta && state.meta.metrics) || {};
    var ids = Object.keys(meta).sort();
    if (!ids.length) ids = Object.keys(a.metric_scores || {}).sort();
    var rows = ids.map(function (id) {
      var m = meta[id] || {};
      var dv = (a.metric_display_values || {})[id];
      var sc = (a.metric_scores || {})[id];
      return "<tr><td class=\"td-name\">" + (m.name || id) +
        '<br><span class="td-sub">' + id + (m.abbr ? " · " + m.abbr : "") + "</span></td>" +
        '<td class="num">' + (dv === null || dv === undefined ? GLYPH : fmtNumber(dv)) + "</td>" +
        '<td class="num">' + (sc === null || sc === undefined ? GLYPH : fmtScore(sc)) + "</td>" +
        '<td class="num muted">' + (m.max_score === undefined ? GLYPH : m.max_score) + "</td>" +
        '<td class="weak">' + ((state.meta.dimensions && m.dimension &&
          state.meta.dimensions[m.dimension]) ? state.meta.dimensions[m.dimension].name : (m.dimension || GLYPH)) +
        "</td></tr>";
    }).join("");
    el("metric-table").innerHTML =
      "<thead><tr><th>指标</th><th>展示值</th><th>得分</th><th>满分</th><th>维度</th></tr></thead>" +
      "<tbody>" + rows + "</tbody>";
  }

  function renderTriggers(a) {
    var list = a.overlay_trigger_states || [];
    if (!list.length) {
      el("trigger-table").innerHTML = "";
      el("trigger-empty").hidden = false;
      return;
    }
    el("trigger-empty").hidden = true;
    el("trigger-table").innerHTML =
      "<thead><tr><th>规则</th><th>依赖输入</th><th>输入状态</th><th>状态</th></tr></thead><tbody>" +
      list.map(function (t) {
        var cls = t.state === "INPUTS_AVAILABLE_NOT_EVALUATED" ? "pill-info" : "pill-neutral";
        return "<tr><td class=\"td-name\">" + t.rule_id + "</td>" +
          '<td class="td-name">' + (t.depends_on || []).join("、") + "</td>" +
          '<td>' + (t.inputs_available ? "可用" : "缺失") + "</td>" +
          '<td><span class="pill ' + cls + '">' + t.state + "</span></td></tr>";
      }).join("") + "</tbody>";
  }

  function renderRuntime(a) {
    var rs = a.runtime_status_summary || {};
    var ps = a.provider_status_summary || {};
    var degraded = (a.overlay_status === "NOT_FULLY_AVAILABLE");
    el("runtime-table").innerHTML = "<tbody>" + [
      ["本地计算 local_compute", rs.local_compute || GLYPH],
      ["本地快照 local_snapshot", rs.local_snapshot || GLYPH],
      ["流水线 pipeline_version", rs.pipeline_version || GLYPH],
      ["数据模式 mode", ps.mode || GLYPH],
      ["本轮 API 调用 api_calls", fmtNumber(ps.api_calls_this_run, 0)],
      ["快照哈希 snapshot_hash", (a.snapshot_hash ? a.snapshot_hash.slice(0, 16) + "…" : GLYPH)],
      ["产物哈希 artifact_hash", (a.artifact_hash ? a.artifact_hash.slice(0, 16) + "…" : GLYPH)],
      ["健康状态 health", degraded ? "DEGRADED_OVERLAY_UNAVAILABLE" : "OK"]
    ].map(function (r) { return "<tr><td class=\"td-name\">" + r[0] + '</td><td class="num">' + r[1] + "</td></tr>"; }).join("") + "</tbody>";

    var hb = el("health-banner");
    if (degraded) {
      hb.hidden = false;
      hb.className = "banner banner-warn";
      hb.textContent = "DEGRADED_OVERLAY_UNAVAILABLE：Overlay 不可完整计算，页面不呈现完整健康态。";
    } else { hb.hidden = true; }
  }

  function renderDay(a) {
    state.artifact = a;
    renderHero(a);
    renderScores(a);
    renderDimensions(a);
    renderMetrics(a);
    renderTriggers(a);
    renderRuntime(a);
    el("banner").hidden = true;
  }

  function loadJson(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
      return r.json();
    });
  }

  function loadDay(day) {
    showLoading();
    var url = (!day || day === state.latestDay) ? LATEST : HISTORY + day + ".json";
    loadJson(url).then(function (a) {
      renderDay(a);
      el("day-select").value = a.score_date || day;
    }).catch(function (e) {
      // §43: a missing day is reported as NO_SNAPSHOT — never substituted by
      // the nearest available day.
      showError("NO_SNAPSHOT：所选交易日 " + day + " 没有快照（" + e.message + "）。" +
                "历史查询不得用最近一天冒充。", "banner-neutral");
    });
  }

  function initSelector(days, latest) {
    state.days = days;
    state.latestDay = latest;
    var sel = el("day-select");
    sel.innerHTML = days.slice().reverse().map(function (d) {
      return '<option value="' + d + '">' + d + (d === latest ? "（最新）" : "") + "</option>";
    }).join("");
    sel.value = latest;
    sel.addEventListener("change", function () { loadDay(sel.value); });
  }

  function boot() {
    showLoading();
    Promise.all([loadJson(META), loadJson(INDEX), loadJson(LATEST)])
      .then(function (res) {
        state.meta = res[0];
        var idx = res[1] || {};
        initSelector(idx.published_days || [res[2].score_date], idx.latest_score_date || res[2].score_date);
        renderDay(res[2]);
      })
      .catch(function () {
        // index is optional on a first publish
        loadJson(META).then(function (meta) {
          state.meta = meta;
          return loadJson(LATEST);
        }).then(function (a) {
          initSelector([a.score_date], a.score_date);
          renderDay(a);
        }).catch(function (e) { showError("EMPTY / ERROR：无法加载公开产物（" + e.message + "）。"); });
      });
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
