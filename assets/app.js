/* =========================================================================
 * PHASE H.2 §9 / §10 / §11 / §39 / §40 / §41 —— NEUTRAL LOADER
 *
 * The single public index.html is model-agnostic.  This loader owns exactly
 * three things and nothing else:
 *
 *   1. the BANK registry select            (VISIBLE_ALWAYS, registry-driven)
 *   2. the MODEL registry select           (V3 = DEFAULT, V2 = ALTERNATE)
 *   3. fetching the chosen model payload + its per-year detail chunks
 *
 * Rendering stays 100% inside the restored MODEL_V2_FRONTEND_V6 shell
 * (assets/shell.js).  Switching a bank or a model re-clones the shell markup
 * and re-boots it, so there is never cross-model DOM / chart / tooltip /
 * date / metric residue (§41).
 *
 * The browser still only fetches, selects, formats (by table lookup), renders
 * and charts.  It never scores, thresholds, prices, or recomputes anything.
 * ========================================================================= */
(function () {
  "use strict";

  var REGISTRY = "assets/data/banks.json";
  var LOADING = {};                       /* `${bank}/${model}/${year}` in flight */
  var LOADED = {};                        /* same key, already merged          */
  var STATE = {banks: null, bank: null, model: null, payload: null};

  function qs(name) {
    var m = new RegExp("[?&]" + name + "=([^&]*)").exec(location.search || "");
    return m ? decodeURIComponent(m[1]) : null;
  }

  function getJSON(url) {
    return fetch(url, {cache: "no-cache"}).then(function (r) {
      if (!r.ok) throw new Error(url + " -> HTTP " + r.status);
      return r.json();
    });
  }

  function fill(sel, entries, current) {
    sel.innerHTML = entries.map(function (e) {
      return '<option value="' + e.value + '">' + e.label + "</option>";
    }).join("");
    sel.value = current;
  }

  function bankEntries(reg) {
    return (reg.banks || []).map(function (b) {
      return {value: b.institution_id,
              label: (b.institution_name_zh || b.display_name_zh ||
                      b.institution_id) +
                     (b.instrument_id ? " " + b.instrument_id : "")};
    });
  }

  function modelEntries(bank) {
    return (bank.models || []).map(function (m) {
      return {value: m.model_id, label: m.model_id};
    });
  }

  function findBank(reg, id) {
    var list = reg.banks || [];
    for (var i = 0; i < list.length; i++) { if (list[i].institution_id === id) return list[i]; }
    return list[0];
  }

  function findModel(bank, id) {
    var list = bank.models || [];
    for (var i = 0; i < list.length; i++) { if (list[i].model_id === id) return list[i]; }
    for (var j = 0; j < list.length; j++) {
      if (list[j].selection_role === "DEFAULT") return list[j];
    }
    return list[0];
  }

  /* §23 —— 外壳直接挂到 <body> 下：body 的可见子节点序列与黄金页一致
     （第一个可见子节点就是 .wrap），几何清单不会产生额外的容器节点。 */
  function cloneShell() {
    var tpl = document.getElementById("shell-tpl");
    var body = document.body;
    var prev = body.querySelectorAll(":scope > .wrap");
    for (var i = 0; i < prev.length; i++) { body.removeChild(prev[i]); }
    body.appendChild(tpl.content.cloneNode(true));
  }

  function paintIdentity(model) {
    var meta = model.model_meta || {};
    var scope = document.getElementById("top-scope");
    if (scope) scope.textContent = meta.scope_label_zh || "";
    var role = document.getElementById("top-role");
    if (role) role.textContent = meta.role_label_zh || "";
    var up = document.getElementById("top-updated");
    if (up) {
      var last = (model.main_title || {}).latest_date;
      up.textContent = last ? ("最新交易日 " + last) : "—";
    }
    document.title = "招商银行量化评分 · " + (meta.model_id || "") +
                     " · " + (meta.status_label_zh || "");
  }

  /* ---------------------------------------------------------------- loading */
  function dayUrl(bank, model, year) {
    return "assets/data/" + bank + "/" + model + "/days/" + year + ".json";
  }

  function loadYear(bank, model, year, then) {
    var key = bank + "/" + model + "/" + year;
    if (LOADED[key]) { if (then) then(); return; }
    if (LOADING[key]) return;
    LOADING[key] = true;
    getJSON(dayUrl(bank, model, year)).then(function (chunk) {
      var days = STATE.payload.days = STATE.payload.days || {};
      var map = STATE.payload.display_map = STATE.payload.display_map || {};
      var pmap = STATE.payload.display_map_pct =
        STATE.payload.display_map_pct || {};
      var raw = STATE.payload.raw_precision =
        STATE.payload.raw_precision || {};
      Object.keys(chunk.days || {}).forEach(function (d) {
        days[d] = chunk.days[d];
      });
      /* §19 / §55 — the year chunk ships its own authoritative display map so
         the browser still never formats a business number itself. */
      Object.keys(chunk.display_map || {}).forEach(function (k) {
        map[k] = chunk.display_map[k];
      });
      Object.keys(chunk.display_map_pct || {}).forEach(function (k) {
        pmap[k] = chunk.display_map_pct[k];
      });
      Object.keys(chunk.raw_precision || {}).forEach(function (k) {
        raw[k] = chunk.raw_precision[k];
      });
      LOADED[key] = true;
      delete LOADING[key];
      if (then) then();
    }).catch(function () {
      LOADED[key] = true;               /* honest: no detail for that year */
      delete LOADING[key];
      if (then) then();
    });
  }

  /* The shell asks for a day it does not have yet (§26 lazy detail). */
  window.__CMB_REQUEST_DAY__ = function (date) {
    if (!STATE.payload || !STATE.payload.days_lazy) return;
    var year = String(date).slice(0, 4);
    var key = STATE.bank + "/" + STATE.model + "/" + year;
    if (LOADED[key] || LOADING[key]) return;
    loadYear(STATE.bank, STATE.model, year, function () {
      if (typeof window.__CMB_SHELL_RERENDER__ === "function") {
        window.__CMB_SHELL_RERENDER__(date);
      }
    });
  };

  function applyModel(bankId, modelId, push) {
    var bank = findBank(STATE.banks, bankId);
    var model = findModel(bank, modelId);
    STATE.bank = bank.institution_id;
    STATE.model = model.model_id;

    cloneShell();
    var bankSel = document.getElementById("bank-select");
    var modelSel = document.getElementById("model-select");
    fill(bankSel, bankEntries(STATE.banks), STATE.bank);
    fill(modelSel, modelEntries(bank), STATE.model);
    bankSel.onchange = function () { applyModel(bankSel.value, null, true); };
    modelSel.onchange = function () { applyModel(STATE.bank, modelSel.value, true); };

    var base = "assets/data/" + STATE.bank + "/" + STATE.model + "/";
    return getJSON(base + "view.json").then(function (view) {
      return getJSON(base + "index.json").then(function (ix) {
        view.days = view.days || {};
        view.days_lazy = ix.days_lazy !== false;
        view.model_meta = view.model_meta || {};
        Object.keys(ix.model_meta || {}).forEach(function (k) {
          if (view.model_meta[k] === undefined) view.model_meta[k] = ix.model_meta[k];
        });
        STATE.payload = view;
        var latest = (view.dates || [])[(view.dates || []).length - 1];
        var year = String(latest || "").slice(0, 4);
        var ready = function () {
          paintIdentity(view);
          window.__CMB_SHELL_BOOT__(view);
          if (push) {
            var url = "?bank=" + STATE.bank + "&model=" + STATE.model;
            if (location.search !== url) history.pushState({}, "", url);
          }
        };
        if (view.days_lazy && year) { loadYear(STATE.bank, STATE.model, year, ready); }
        else { ready(); }
      });
    });
  }

  function start() {
    getJSON(REGISTRY).then(function (reg) {
      STATE.banks = reg;
      var bank = qs("bank") || reg.default_institution_id ||
                 reg.default_bank_id ||
                 ((reg.banks || [])[0] || {}).institution_id;
      var model = qs("model") || null;
      applyModel(bank, model, false);
    }).catch(function (err) {
      /* 加载失败时才有这个节点；正常路径下 body 的可见子节点只有 .wrap。 */
      var box = document.createElement("div");
      box.className = "mod-partial";
      box.textContent = "公开产物加载失败：" + err.message;
      document.body.appendChild(box);
    });
  }

  window.addEventListener("popstate", function () {
    if (!STATE.banks) return;
    applyModel(qs("bank") || STATE.bank, qs("model") || STATE.model, false);
  });

  start();
})();
