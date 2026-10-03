
(function(){
  /* ================= 数据挂载（H.2 §9 / §10） =================
   * 数据不再内联在页面里，而是由中性加载器 assets/app.js 注入。
   * 换银行 / 换模型时重新克隆模板并重新 boot()，因此不存在任何跨模型
   * 残留状态（§41）。 全部为本地 Python 离线预计算产物（公开产物只带
   * sanitized 结果，不带内部路径），浏览器只做 format / filter / render /
   * chart，绝不重算模型（§82）。 */
  var DATA = null;
  var dates = [];
  var days  = {};
  var SER   = {};
  var H     = {};
  var POL   = {};
  var GLYPH = "—";
  var MT = {}, HT = {}, BAND = {}, ASM = {}, RES = {}, SHW = {}, THR = {}, DR = {};
  var MODEL_META = {}, SCOPE = {};
  var CORE_HERO_TITLE = "基本面综合值博率";
  var INV_HERO_TITLE  = "吸引力综合值博率";
  var SHW_MAP = {};

  /* ================= §36 / §55 —— 全局数字展示契约 =================
   * display_map 由 Python 用 Decimal(ROUND_HALF_UP) 离线算好：
   *   ≤2 位小数 → 保留原始有效小数位；>2 位 → 四舍五入到 2 位。
   * 浏览器只做「精确字符串查表」，绝不 toFixed / Math.round 业务数字。
   * __CMB_FMT_MISS__ 统计查表未命中次数，门禁要求恒为 0。 */
  var DMAP = {}, DMAP_PCT = {}, RAW_META = {}, GLOBAL_BOUND = false;
  /* 查表未命中计数器：门禁要求恒为 0（>0 = 浏览器自己在格式化业务数字）。 */
  window.__CMB_FMT_MISS__ = {count:0, keys:{}};
  function fmtMiss(k){
    var m = window.__CMB_FMT_MISS__;
    m.count++; m.keys[String(k)] = 1;
  }
  function fmtKey(v){ return typeof v === 'number' ? String(v) : 's:' + String(v).trim(); }
  function fmt(v,d){
    if(v===null||v===undefined||v==='') return GLYPH;
    var s = DMAP[fmtKey(v)];
    if(s===undefined && typeof v !== 'number'){
      var n = Number(v);
      if(!isFinite(n)) return GLYPH;
      s = DMAP[String(n)];
    }
    if(s===undefined){
      fmtMiss(fmtKey(v));
      var nf = Number(v);
      return isFinite(nf) ? nf.toFixed(d==null?2:d) : GLYPH;
    }
    return s;
  }
  function pct(v){
    if(v===null||v===undefined||v==='') return GLYPH;
    var s = DMAP_PCT[fmtKey(v)];
    if(s===undefined && typeof v !== 'number'){
      var n = Number(v);
      if(!isFinite(n)) return GLYPH;
      s = DMAP_PCT[String(n)];
    }
    if(s===undefined){
      fmtMiss(fmtKey(v));
      return (Number(v)*100).toFixed(2)+'%';
    }
    return s;
  }
  /* §28 —— 模型未发布某区块时，用原视觉体系内的诚实说明占位，绝不编造内容。 */
  function scopeNote(key){
    var s = SCOPE[key];
    return s ? '<div class="mod-partial">'+esc(s)+'</div>' : '';
  }
  function bandUnavailable(side){ return !(((BAND||{})[side]||{}).levels||[]).length; }

  /* §13 / §38 —— DISPLAY_TITLE_ONLY_CHANGE = TRUE：
   * 「基本面综合值博率」实际业务字段仍是 CORE_FUNDAMENTAL_SCORE，
   * 「吸引力综合值博率」实际业务字段仍是 INVESTMENT_ATTRACTION_SCORE。
   * 不新建 VALUE_RATIO_SCORE / VALUE_ODDS_SCORE / 第三个 Score。 */
  function shadowAligned(){
    return dates.map(function(d){
      var v = SHW_MAP[d];
      return (v===undefined || v===null) ? null : v;
    });
  }

  var el = function(id){return document.getElementById(id)};
  var esc = function(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})};

  /* ================= CMB_SCORE_COLOR_ENGINE_V1（V1.1 原样） ================= */
  function scoreTone(value, maximum){
    var mx = Number(maximum), ratio = Number(value)/mx;
    if(!isFinite(ratio) || !isFinite(Number(value)) || !(mx>0)) return "unavailable";
    if(ratio < 0.45) return "low";
    if(ratio < 0.70) return "middle";
    return "high";
  }
  function toneOf(score, max, status){
    if(score===null || score===undefined) return "unavailable";
    if(status && status!=="FULLY_AVAILABLE" && status!=="AVAILABLE") return "unavailable";
    return scoreTone(score, max);
  }
  function toneTextCls(t){ return "score-tone-text-" + t; }
  function barWidth(score, max){
    var mx = Number(max);
    if(!isFinite(Number(score)) || !(mx>0)) return 0;
    return Math.max(0, Math.min(100, (Number(score)/mx)*100));
  }
  var STATUS_CN = {"FULLY_AVAILABLE":"完整可用","AVAILABLE":"可用","READY":"就绪",
    "NOT_FULLY_AVAILABLE":"非完整可用","DEGRADED":"降级","PARTIAL":"部分可用",
    "MISSING":"缺失","INVALID":"无效","NO_SNAPSHOT":"无快照"};
  function statusPill(status){
    if(!status) return '<span class="pill pill-neutral">'+GLYPH+'</span>';
    var s=String(status), cls="pill-neutral";
    if(s==="FULLY_AVAILABLE"||s==="AVAILABLE"||s==="READY") cls="pill-ok";
    else if(s==="NOT_FULLY_AVAILABLE"||s==="DEGRADED"||s==="PARTIAL"||s==="NO_SNAPSHOT") cls="pill-warn";
    else if(s==="MISSING"||s==="INVALID") cls="pill-err";
    return '<span class="pill '+cls+'">'+esc(STATUS_CN[s]||s)+'</span>';
  }
  var ST = {"IMPROVING":"改善","STABLE":"稳定","DETERIORATING":"恶化",
            "INSUFFICIENT_EVIDENCE":"证据不足","CONFLICTING_EVIDENCE":"证据冲突","STALE":"数据陈旧"};
  var CF = {"HIGH":"高","MEDIUM":"中","LOW":"低"};

  /* ================= 日期树 / 日期控件（V1.1 FIX-D 结构） ================= */
  var tree = {};
  var years = [];
  function buildTree(){
    tree = {};
    dates.forEach(function(d){
      var y=d.slice(0,4), m=d.slice(5,7);
      (tree[y] = tree[y] || {})[m] = (tree[y][m] || []).concat(d);
    });
    years = Object.keys(tree).sort();
  }
  function monthsOf(y){ return Object.keys(tree[y]||{}).sort(); }
  function daysOf(y,m){ return (tree[y]||{})[m] || []; }
  function fillSelect(sel, vals, labelFn, cur){
    if(!sel) return;
    sel.innerHTML = vals.map(function(v){
      return '<option value="'+esc(v)+'">'+esc(labelFn(v))+'</option>'; }).join('');
    if(cur && vals.indexOf(cur)>=0) sel.value = cur;
  }
  function nearestAvailable(d){
    if(dates.indexOf(d)>=0) return d;
    var best=null;
    for(var i=0;i<dates.length;i++){ if(dates[i]<=d) best=dates[i]; else break; }
    return best || dates[0];
  }
  var cur = null;

  function syncDateControls(d){
    var y=d.slice(0,4), m=d.slice(5,7);
    fillSelect(el('year-select'), years, function(v){return v+' 年';}, y);
    fillSelect(el('month-select'), monthsOf(y), function(v){return Number(v)+' 月';}, m);
    fillSelect(el('day-select'), daysOf(y,m).slice().reverse(),
               function(v){return v + (v===dates[dates.length-1]?'（最新）':'');}, d);
    var nd = el('native-date');
    if(nd){ nd.min = dates[0]||''; nd.max = dates[dates.length-1]||''; nd.value = d; }
    /* 日历面板开着时同步高亮（calRender 为函数声明，已提升） */
    var cp = el('cal-panel');
    if(cp && !cp.hidden){ calY = null; calRender(); }
  }

  /* §22：非交易日 / 无评分日 —— 回退到不晚于该日的最近可用交易日，并显式提示 */
  function notice(msg){
    var n = el('date-notice');
    if(!n) return;
    if(!msg){ n.hidden = true; n.innerHTML=''; return; }
    n.hidden = false;
    n.innerHTML = '<strong>DATE_FALLBACK</strong><span>'+esc(msg)+'</span>';
  }
  function gotoDate(d, opts){
    if(!d || !dates.length) return;
    var target = nearestAvailable(d);
    if(target !== d){
      notice('该日期无可用评分，已切换至最近上一交易日 ' + target);
    }else{
      notice('');
    }
    cur = target;
    syncDateControls(target);
    render(target);
    drawAll(target);
    if(opts && opts.scroll) { /* no-op: 保持 V1.1 平滑滚动语义 */ }
  }

  /* ================= 顶部四块 / Hero ================= */
  function heroBlock(prefix, score, status, title, verdict, statsHtml){
    var tone = toneOf(score, 100, status);
    var hero = el('hero-'+prefix);
    if(hero) hero.className = 'score-hero score-tone-' + tone;
    var s = el(prefix+'-score');
    if(s){
      s.className = 'score-big ' + toneTextCls(tone) + ' hero-tone-' + tone;
      s.textContent = (score===null||score===undefined) ? GLYPH : fmt(score,2);
    }
    var t = el(prefix+'-title'); if(t) t.textContent = title;
    var v = el(prefix+'-verdict'); if(v) v.textContent = verdict || GLYPH;
    var f = el(prefix+'-fill');
    if(f) f.style.width = barWidth(score,100).toFixed(2) + '%';
    var st = el(prefix+'-stats'); if(st) st.innerHTML = statsHtml || '';
  }
  function statBox(k,v,tone){
    return '<div><span class="k">'+esc(k)+'</span><span class="v '+
           toneTextCls(tone)+'">'+esc(v)+'</span></div>';
  }
  /* §16 ~ §19 —— Hero 评分信号专用盒：整行 NO_WRAP，内部 .sig-txt 供
   * fitSignals() 做确定性 fit-to-width（只改展示字号，绝不改文本与业务值）。 */
  function signalBox(k,v,tone){
    return '<div class="score-signal"><span class="k">'+esc(k)+'</span>'+
           '<span class="v '+toneTextCls(tone)+'"><i class="sig-txt">'+
           esc(v)+'</i></span></div>';
  }
  function fitSignals(){
    var list = document.querySelectorAll('.hero-stats .score-signal .sig-txt');
    for(var i=0;i<list.length;i++){
      var s = list[i], box = s.parentNode;
      if(!box) continue;
      s.style.fontSize = '';
      var f = parseFloat(window.getComputedStyle(s).fontSize) || 15;
      var avail = box.clientWidth;
      if(!avail) continue;
      var guard = 0;
      while(s.getBoundingClientRect().width > avail && f > 8.5 && guard++ < 40){
        f -= 0.5;
        s.style.fontSize = f + 'px';
      }
    }
  }

  /* 旧的「模块 KPI 平铺卡」已被 moduleBlocks() 取代（§6：不能继续表现为
   * 总分 → 17 项平铺表格），故不再保留 moduleCards()。 */
  function metricRows(list){
    if(!list || !list.length){
      return '<div class="score-row"><div class="score-row-meta">'+
        '该交易日不在逐项明细窗口内（只有已产生 Production Snapshot 的交易日才有逐项明细）。'+
        '</div></div>';
    }
    return list.map(function(m){
      var mx = Number(m.max);
      var has = (m.contribution!==null && m.contribution!==undefined);
      var tone = has ? toneOf(m.contribution, mx, m.status) : 'unavailable';
      return '<div class="score-row">'+
        '<div class="score-row-head"><span class="score-row-label">'+esc(m.id)+' · '+esc(m.name)+'</span>'+
          '<span class="score-row-score '+toneTextCls(tone)+'">'+
            (has?fmt(m.contribution,4):GLYPH)+' / '+fmt(mx,4)+'</span></div>'+
        '<div class="score-bar-wrap"><i class="score-bar-fill" style="width:'+
          (has?barWidth(m.contribution,mx).toFixed(2):0)+'%"></i></div>'+
        '<div class="score-row-meta">'+
          /* §36 / §37 —— 展示用 raw_display（同一套 2 位小数契约）；
             未改动的原始文本仍保留在 raw_value / raw_precision 里供审计。 */
          '<span class="raw">原始值 '+esc(m.raw_display!=null?m.raw_display:(m.raw_value==null?GLYPH:m.raw_value))+'</span>'+
          '<span>'+statusPill(m.status)+'</span>'+
          '<span>as_of '+esc(m.as_of||GLYPH)+'</span>'+
          '<span>period '+esc(m.source_period||GLYPH)+'</span></div>'+
        '</div>';
    }).join('');
  }
  /* ================= 模块小计（§6-§18） =================
   * 信息层次（用户截图语义，V1.1 / V6 同源）：
   *   模块标题条（名称 · 满分 · 项数）→ 模块合计行（范围描述  得分 / 满分）
   *   → 彩色 Progress（得分/满分真实比例）→ 该模块指标明细
   * 满分来自 Python ViewModel（Contract 精确未舍入值），浏览器绝不硬编码（§8）。 */
  function moduleBlocks(mods, metrics, partial){
    if(!mods || !mods.length){
      return '<div class="mod-partial">—</div>';
    }
    return mods.map(function(m){
      var mem = m.members || [];
      var list = (metrics||[]).filter(function(x){ return mem.indexOf(x.id) >= 0; });
      list.sort(function(a,b){ return mem.indexOf(a.id) - mem.indexOf(b.id); });
      var tone = toneOf(m.score, m.budget, 'FULLY_AVAILABLE');
      var h = [];
      h.push('<div class="mod-block" data-module="'+esc(m.id)+'">');
      /* 标题条：直接复用 V1.1 .section-label（§35 视觉继承） */
      h.push('<div class="section-label mod-title">'+
        '<span>'+esc(m.name||m.id)+'</span>'+
        '<span class="mod-max">· '+fmt(m.budget,2)+' 分</span>'+
        '<span class="mod-count">'+esc(m.range_label||'')+' · '+mem.length+' 项</span></div>');
      /* 合计行：V1.1「DID+PB 合计   14.17 / 34」语义 */
      h.push('<div class="mod-subtotal">'+
        '<span class="st-label">'+esc(m.range_label||(mem.join(',')||'')+' 合计')+'</span>'+
        '<span class="st-value '+toneTextCls(tone)+'">'+fmt(m.score,2)+' / '+fmt(m.budget,2)+
        '</span></div>');
      h.push('<div class="mod-bar"><div class="score-bar-wrap">'+
        '<i class="score-bar-fill" style="width:'+barWidth(m.score,m.budget).toFixed(2)+'%"></i>'+
        '</div></div>');
      if(partial && partial.note){
        h.push('<div class="mod-partial">'+esc(partial.note)+'</div>');
      }
      h.push('<div class="mod-metrics">'+(list.length
        ? metricRows(list)
        : '<div class="score-row"><div class="score-row-meta">'+
          '该交易日无逐项明细（模块小计不可拆分到指标）。</div></div>')+'</div>');
      h.push('</div>');
      return h.join('');
    }).join('');
  }
  /* §38 / §39 —— 历史研究日：不得把 Partial 小计冒充正式满分可比模块 */
  function histModuleNote(title, cls, cov){
    var lv = cls==='FULL' ? 'LEVEL-A 正式可比较历史'
           : cls==='PARTIAL' ? 'LEVEL-B 研究历史（非完整可比）'
           : cls==='INSUFFICIENT' ? 'LEVEL-C 历史数据不足' : '无历史数据';
    return '<div class="mod-partial">'+esc(title)+'：'+lv+' · 覆盖率 '+fmt(cov,2)+'%。'+
      '该交易日只有分数序列、没有逐项明细，因此不输出模块小计——'+
      '禁止用 0 补齐缺失指标，也禁止把 Partial 小计当作正式满分可比模块。</div>';
  }

  /* ================= ⑩ 动态阈值研究 · Research Only（§21-§36） =================
   * 曲线 / 得分 / 差异全部由本地 Python 预计算落盘（§31），浏览器只做
   * select / filter / format / render / chart。
   * 颜色语义直接取自 V1.1 app.js renderThreshold() 的实际实现：
   *   固定下锚 #dc2626（虚线） / 固定上锚 #059669（虚线） /
   *   研究动态下界 #7c3aed（实线） / 研究动态上界 #2563eb（实线）
   * 实际值使用 V1.1 .chart-legend .lg-price 的 #9ca3af。 */
  var DYN_C = {actual:'#9ca3af', fixedLower:'#dc2626', fixedUpper:'#059669',
               dynamicLower:'#7c3aed', dynamicUpper:'#2563eb'};
  function sumRow(k,v){
    return '<div><small>'+esc(k)+'</small><strong>'+esc(v)+'</strong></div>';
  }
  function dynPointAt(m, d){
    var pts = m.points || [], best = null;
    for(var i=0;i<pts.length;i++){ if(pts[i].date <= d) best = pts[i]; else break; }
    return best;
  }
  function dynSeries(m){
    var pts = m.points || [];
    return [
      {name:'实际值', color:DYN_C.actual, width:1.4,
       data:pts.map(function(p){ return p.actual; })},
      {name:'Production 固定下锚', color:DYN_C.fixedLower, width:1.6, dash:true,
       data:pts.map(function(p){ return p.fixed_lower; })},
      {name:'Production 固定上锚', color:DYN_C.fixedUpper, width:1.6, dash:true,
       data:pts.map(function(p){ return p.fixed_upper; })},
      {name:'Shadow 动态下界', color:DYN_C.dynamicLower, width:2,
       data:pts.map(function(p){ return p.dynamic_lower; })},
      {name:'Shadow 动态上界', color:DYN_C.dynamicUpper, width:2,
       data:pts.map(function(p){ return p.dynamic_upper; })}
    ];
  }
  function dynCardHtml(m){
    var pts = m.points || [];
    var labels = pts.map(function(p){ return p.date; });
    var h = [];
    h.push('<div class="dyn-card" data-metric="'+esc(m.metric_id)+'">');
    h.push('<div class="threshold-panel">');
    h.push('<div class="threshold-heading"><div><strong id="dyn-title-'+esc(m.metric_id)+'">'+
      esc(m.name)+' · '+esc(m.metric_id)+'</strong><br>'+
      '<span id="dyn-sub-'+esc(m.metric_id)+'">—</span></div>'+
      '<span class="badge">仅研究用途</span></div>');
    if(!pts.length){
      h.push('<div class="mod-partial">INSUFFICIENT_HISTORY：该指标没有已冻结的动态阈值序列，'+
        '禁止伪造动态 Band。</div>');
    }else{
      h.push('<div class="chart-scroll"><div class="chart-shell" id="dynShell-'+esc(m.metric_id)+'">'+
        '<canvas class="score-canvas"></canvas><canvas class="chart-crosshair"></canvas>'+
        '<div class="chart-tooltip"></div></div></div>');
      h.push('<div class="chart-legend">'+
        '<span><i style="background:'+DYN_C.actual+'"></i>实际值</span>'+
        '<span><i style="background:'+DYN_C.fixedLower+'"></i>Production 固定下锚</span>'+
        '<span><i style="background:'+DYN_C.fixedUpper+'"></i>Production 固定上锚</span>'+
        '<span><i style="background:'+DYN_C.dynamicLower+'"></i>Shadow 动态下界</span>'+
        '<span><i style="background:'+DYN_C.dynamicUpper+'"></i>Shadow 动态上界</span></div>');
    }
    h.push('<div class="threshold-grid" id="dynGrid-'+esc(m.metric_id)+'"></div>');
    h.push('<div id="dynStatus-'+esc(m.metric_id)+'"></div>');
    h.push('</div></div>');
    return {html:h.join(''), labels:labels};
  }
  var DYN = {};
  function renderDynamicShell(){
    var host = el('dyn-cards');
    if(!host) return;
    var ms = DR.metrics || [];
    if(!ms.length){
      host.innerHTML = scopeNote('dynamic_research') ||
        '<div class="mod-partial">无已冻结动态阈值研究产物。</div>';
      return;
    }
    var html = [], labels = {};
    ms.forEach(function(m){
      var r = dynCardHtml(m);
      html.push(r.html); labels[m.metric_id] = r.labels;
    });
    host.innerHTML = '<div class="dyn-grid">'+html.join('')+'</div>';
    ms.forEach(function(m){
      if(!(m.points||[]).length) return;
      var ch = setupChart('dynShell-'+m.metric_id);
      if(!ch) return;
      DYN[m.metric_id] = ch;
      bindCrosshair(ch, dynSeries(m), labels[m.metric_id]);
      var sub = el('dyn-sub-'+m.metric_id);
      if(sub){
        sub.textContent = '研究区间 '+(m.band_first_date||GLYPH)+' → '+(m.band_last_date||GLYPH)+
          ' · Shadow 算法 '+(m.algorithm||GLYPH);
      }
      var stt = el('dynStatus-'+m.metric_id);
      if(stt){
        stt.innerHTML =
          '<div class="status-note"><strong>RESEARCH_ONLY</strong><span>'+
          esc(m.research_verdict||'')+' · PRODUCTION_AUTHORITY = FALSE · '+
          'Production 影响 = 0 · '+(m.chart_note||'')+'</span></div>';
      }
    });
  }
  function renderDynamic(d){
    var host = el('dyn-cards');
    if(!host) return;
    var ms = DR.metrics || [];
    ms.forEach(function(m){
      var ch = DYN[m.metric_id];
      var grid = el('dynGrid-'+m.metric_id);
      var pts = m.points || [];
      if(!pts.length){ return; }
      var p = dynPointAt(m, d);
      var mi = -1;
      if(p){ mi = pts.map(function(x){return x.date;}).indexOf(p.date); }
      if(ch){
        drawSeries(ch, pts.map(function(x){return x.date;}), dynSeries(m), mi, {});
      }
      if(!grid) return;
      if(!p){
        grid.innerHTML = sumRow('研究状态','INSUFFICIENT_HISTORY')+
          sumRow('Dynamic Band 起始', m.band_first_date||GLYPH)+
          sumRow('PIT Window End', GLYPH)+
          sumRow('Production 影响','0');
        return;
      }
      grid.innerHTML =
        sumRow('实际值', fmt(p.actual,4))+
        sumRow('Fixed Lower', fmt(p.fixed_lower,4))+
        sumRow('Fixed Upper', fmt(p.fixed_upper,4))+
        sumRow('Shadow Lower', fmt(p.dynamic_lower,4))+
        sumRow('Shadow Upper', fmt(p.dynamic_upper,4))+
        sumRow('Production 得分贡献', fmt(p.fixed_score,4))+
        sumRow('Shadow 研究得分贡献', fmt(p.shadow_score,4))+
        sumRow('Score Difference', fmt(p.diff,4))+
        sumRow('研究状态', m.research_verdict||GLYPH)+
        sumRow('PIT Window End', p.window_end||GLYPH);
    });
  }
  /* ================= §6 ~ §12 —— 顶部身份行 =================
   * 左 = 证券（黑字靠左）；右 = 最新交易日（黑字靠右，字号更小）。
   * 日期永远来自 LATEST_SUCCESSFUL_SCORE_DATE（main_title.latest_date），
   * 与用户 SELECTED_SCORE_DATE（cur）严格分离；不随日期选择器变化。 */
  function renderTopIdentity(){
    var L = el('ti-left'), R = el('ti-right');
    var lt = MT.left_template || "{subject} {code}";
    var rt = MT.right_template || "最新交易日 {latest_date}";
    function fill(t){
      return String(t).replace("{subject}", MT.subject || "")
                      .replace("{code}", MT.code || "")
                      .replace("{latest_date}", MT.latest_date || GLYPH);
    }
    if(L) L.textContent = fill(lt);
    if(R) R.textContent = fill(rt);
  }

  /* ================= §14 / §36 —— Hero 评分信号 =================
   * 档位只来自冻结的 Band Contract；浏览器不做任何分位/阈值推算。
   * PARTIAL → 研究历史 · 信号不适用；INSUFFICIENT / 无分 → 历史数据不足。 */
  function bandLevels(side){
    var b = BAND[side] || {};
    return b.levels || [];
  }
  function levelOf(score, levels){
    if(score===null || score===undefined) return null;
    var v = Number(score);
    if(!isFinite(v)) return null;
    for(var i=0;i<levels.length;i++){
      var L = levels[i], lo = Number(L.lower), hi = Number(L.upper);
      var okLo = (L.lower_inclusive===false) ? (v > lo) : (v >= lo);
      var okHi = (L.upper_inclusive===false) ? (v < hi) : (v <= hi);
      if(okLo && okHi) return L;
    }
    return null;
  }
  function signalText(score, side, cls){
    var lv = levelOf(score, bandLevels(side));
    if(lv){
      return "LEVEL-" + lv.level_number + " · " + (lv.signal_label||'') +
             "（" + fmt(lv.lower,2) + " ~ " + fmt(lv.upper,2) + "）";
    }
    if(cls === "INSUFFICIENT") return "历史数据不足";
    if(score===null || score===undefined) return "历史数据不足";
    /* §28 —— 模型未发布 Band 研究时诚实说明，不编造 LEVEL 档位。 */
    if(bandUnavailable(side)) return "信号区间研究未发布";
    return "研究历史 · 信号不适用";
  }

  /* ================= §20 ~ §26 —— 综合研判 =================
   * 三段内容 100% 来自本地 Python 确定性生成（llm_used = false）。 */
  function renderAssessment(d){
    var a = ASM[d] || null;
    var pl = el('assess-pos-list'), nl = el('assess-neg-list'), ct = el('assess-concl-text');
    if(!a){
      if(pl) pl.innerHTML = '<li>—</li>';
      if(nl) nl.innerHTML = '<li>—</li>';
      if(ct) ct.textContent = SCOPE.comprehensive_assessment ||
        '该交易日没有可用的综合研判产物（非完整可比历史或当日无评分）。';
      return;
    }
    function lis(arr){
      if(!arr || !arr.length) return '<li>—</li>';
      return arr.map(function(x){ return '<li>'+esc(x)+'</li>'; }).join('');
    }
    if(pl) pl.innerHTML = lis(a.p);
    if(nl) nl.innerHTML = lis(a.n);
    if(ct) ct.textContent = a.con || GLYPH;
  }

  /* ================= §27 / §38 / §39 —— 评分信号共振 ================= */
  function resonanceTable(rows, curLevel, title, histLabel){
    var host = title === 'core' ? 'resonance-core-wrap' : 'resonance-inv-wrap';
    var box = el(host);
    if(!box) return;
    if(!rows || !rows.length){
      box.innerHTML = scopeNote('score_resonance') ||
        '<div class="mod-partial">暂无评分区间研究产物。</div>';
      return;
    }
    /* §26 ~ §30 —— 四列同时可见：不使用 .table-scroll（overflow-x:auto），
     * 改为 width:100% + table-layout:fixed + colgroup 百分比列宽。
     * 不隐藏任何一列，不省略 Signal 名称，只在窄屏合理缩小字号与 padding。 */
    box.innerHTML =
      '<div class="section-label">'+esc(histLabel)+'</div>'+
      '<table class="resonance-table"><colgroup>'+
      '<col style="width:18%"><col style="width:24%">'+
      '<col style="width:36%"><col style="width:22%">'+
      '</colgroup><thead><tr>'+
      '<th>档位</th><th>信号</th><th>评分区间</th><th>历史占比</th>'+
      '</tr></thead><tbody>'+
      rows.map(function(r){
        var isCur = (r.level_number === curLevel);
        var lo = (r.band||[])[0], hi = (r.band||[])[1];
        return '<tr class="'+(isCur?'cur':'')+'">'+
          '<td>LEVEL-'+esc(r.level_number)+'</td>'+
          '<td>'+esc(r.signal_label||GLYPH)+'</td>'+
          '<td>'+fmt(lo,2)+' ~ '+fmt(hi,2)+'</td>'+
          '<td>'+fmt(r.occupancy_pct,2)+'%</td></tr>';
      }).join('')+'</tbody></table>';
  }
  function renderResonance(d){
    var a = ASM[d] || {};
    var coreRows = RES.resonance_core || [], invRows = RES.resonance_investment || [];
    var cb = BAND.core || {}, ib = BAND.investment || {};
    resonanceTable(coreRows, a.cl==null?-1:a.cl, 'core',
      '核心基本面 · 全历史评分区间（'+esc(cb.history_start||GLYPH)+' → '+
      esc(cb.history_end||GLYPH)+' · '+esc(cb.sample_count||0)+' 个样本）');
    resonanceTable(invRows, a.il==null?-1:a.il, 'investment',
      '投资吸引力 · 全历史评分区间（'+esc(ib.history_start||GLYPH)+' → '+
      esc(ib.history_end||GLYPH)+' · '+esc(ib.sample_count||0)+' 个样本）');
    var j = el('resonance-joint');
    if(j){
      var jt = (RES.joint_text || {});
      if(!a.j){ j.textContent = '联合共振：—（该交易日无评分）'; }
      else{ j.textContent = '联合共振：' + (jt[a.j] || a.j); }
    }
  }

  /* ================= §41 ~ §43 —— 历史区间选择器 ================= */
  var RSTART = null, REND = null;
  function rangeSlice(){
    var s = (RSTART==null) ? 0 : RSTART;
    var e = (REND==null) ? (dates.length-1) : REND;
    if(s<0) s = 0;
    if(e>dates.length-1) e = dates.length-1;
    if(s>e){ var t=s; s=e; e=t; }
    return {s:s, e:e};
  }
  function rangeNote(msg){
    var n = el('hist-range-note');
    if(!n) return;
    if(!msg){ n.hidden = true; n.innerHTML = ''; return; }
    n.hidden = false;
    n.innerHTML = '<strong>HISTORY_RANGE</strong><span>'+esc(msg)+'</span>';
  }
  function rangeStatus(){
    var st = el('hist-range-status');
    if(!st) return;
    var r = rangeSlice(), n = r.e - r.s + 1;
    var cf = 0, ifu = 0;
    for(var i=r.s;i<=r.e;i++){
      if(((H.core_class||[])[i]||'NONE')==='FULL') cf++;
      if(((H.inv_class||[])[i]||'NONE')==='FULL') ifu++;
    }
    st.textContent = '区间 ' + (dates[r.s]||GLYPH) + ' ~ ' + (dates[r.e]||GLYPH) +
      ' · 交易日 ' + n + ' 个 · Core FULL ' + cf + ' 个 · Investment FULL ' + ifu + ' 个';
  }
  function applyRange(){
    var sv = el('hist-start') ? el('hist-start').value : '';
    var ev = el('hist-end') ? el('hist-end').value : '';
    if(!sv && !ev){ RSTART = null; REND = null; rangeNote(''); drawAll(cur); renderExtrema(); rangeStatus(); return; }
    var s = sv ? nearestAvailable(sv) : dates[0];
    var e = ev ? nearestAvailable(ev) : dates[dates.length-1];
    var msgs = [];
    if(sv && sv !== s) msgs.push('开始日期 '+sv+' 非交易日，已对齐至 '+s+'。');
    if(ev && ev !== e) msgs.push('结束日期 '+ev+' 非交易日，已对齐至 '+e+'。');
    if(dates.indexOf(s) > dates.indexOf(e)){
      rangeNote('开始日期（'+s+'）晚于结束日期（'+e+'），区间无效，已保持原区间。');
      return;
    }
    rangeNote(msgs.join(' '));
    RSTART = dates.indexOf(s); REND = dates.indexOf(e);
    if(el('hist-start')) el('hist-start').value = s;
    if(el('hist-end')) el('hist-end').value = e;
    drawAll(cur); renderExtrema(); rangeStatus();
  }
  function presetRange(years){
    if(!dates.length) return;
    var last = dates[dates.length-1];
    if(!years){ RSTART = null; REND = null;
      if(el('hist-start')) el('hist-start').value = dates[0];
      if(el('hist-end')) el('hist-end').value = last;
      rangeNote(''); drawAll(cur); renderExtrema(); rangeStatus(); return; }
    var ly = Number(last.slice(0,4)) - years;
    var start = last.slice(0,4) === String(Number(last.slice(0,4))) ? (ly + last.slice(4)) : last;
    REND = dates.length - 1;
    RSTART = dates.indexOf(nearestAvailable(start));
    if(el('hist-start')) el('hist-start').value = dates[RSTART];
    if(el('hist-end')) el('hist-end').value = last;
    rangeNote(''); drawAll(cur); renderExtrema(); rangeStatus();
  }

  /* ================= §41 ~ §43 —— 区间最高 / 最低 =================
   * 用 score_exact 精确值比较；并列取最早日期并标注同分日期数；
   * FULL 与 PARTIAL 严格分离；Shadow 极值标注 RESEARCH_ONLY。 */
  function extremaOf(vals, labels){
    var hi = {v:null, i:-1}, lo = {v:null, i:-1};
    for(var i=0;i<vals.length;i++){
      var v = vals[i];
      if(v===null || v===undefined) continue;
      if(hi.v===null || v > hi.v) hi = {v:v, i:i};
      if(lo.v===null || v < lo.v) lo = {v:v, i:i};
    }
    function ties(o){
      if(o.v===null) return 0;
      var c = 0;
      for(var k=0;k<vals.length;k++){ if(vals[k]===o.v) c++; }
      return c;
    }
    return {
      hi: hi, lo: lo, hiTies: ties(hi), loTies: ties(lo),
      hiDate: hi.i>=0 ? labels[hi.i] : null,
      loDate: lo.i>=0 ? labels[lo.i] : null
    };
  }
  function extCard(label, val, date, ties, research){
    return '<div class="extrema-card'+(research?' research':'')+'">'+
      '<div class="ex-label">'+esc(label)+'</div>'+
      '<div class="ex-value">'+(val===null||val===undefined?GLYPH:fmt(val,4))+'</div>'+
      '<div class="ex-date">'+esc(date||GLYPH)+
        (ties>1 ? ' · 另有 '+(ties-1)+' 个同分日期' : '')+'</div></div>';
  }
  function renderExtrema(){
    var r = rangeSlice();
    var rdates = dates.slice(r.s, r.e+1);
    var s = buildSeries();
    var showPartial = el('chk-partial') ? el('chk-partial').checked : false;
    function cut(a){ return a.slice(r.s, r.e+1); }
    var hostA = el('extrema-a'), hostB = el('extrema-b');
    if(hostA){
      var cf = extremaOf(cut(s.coreFull), rdates);
      var sh = extremaOf(cut(shadowAligned()), rdates);
      var cp = showPartial ? extremaOf(cut(s.corePart), rdates) : null;
      var h = [];
      h.push(extCard('区间最高 · 核心基本面（正式 Fixed）', cf.hi.v, cf.hiDate, cf.hiTies, false));
      h.push(extCard('区间最低 · 核心基本面（正式 Fixed）', cf.lo.v, cf.loDate, cf.loTies, false));
      h.push(extCard('区间最高 · 动态阈值研究 Shadow（RESEARCH_ONLY）', sh.hi.v, sh.hiDate, sh.hiTies, true));
      h.push(extCard('区间最低 · 动态阈值研究 Shadow（RESEARCH_ONLY）', sh.lo.v, sh.loDate, sh.loTies, true));
      if(cp) h.push(extCard('区间最高 · 扩展研究历史（RESEARCH_ONLY）', cp.hi.v, cp.hiDate, cp.hiTies, true));
      if(cp) h.push(extCard('区间最低 · 扩展研究历史（RESEARCH_ONLY）', cp.lo.v, cp.loDate, cp.loTies, true));
      hostA.innerHTML = h.join('');
    }
    if(hostB){
      var ifu = extremaOf(cut(s.invFull), rdates);
      var ip = showPartial ? extremaOf(cut(s.invPart), rdates) : null;
      var h2 = [];
      h2.push(extCard('区间最高 · 投资吸引力（LEVEL-A）', ifu.hi.v, ifu.hiDate, ifu.hiTies, false));
      h2.push(extCard('区间最低 · 投资吸引力（LEVEL-A）', ifu.lo.v, ifu.loDate, ifu.loTies, false));
      if(ip) h2.push(extCard('区间最高 · 扩展研究历史（RESEARCH_ONLY）', ip.hi.v, ip.hiDate, ip.hiTies, true));
      if(ip) h2.push(extCard('区间最低 · 扩展研究历史（RESEARCH_ONLY）', ip.lo.v, ip.loDate, ip.loTies, true));
      hostB.innerHTML = h2.join('');
    }
  }

  /* ================= §61 ~ §81 —— 评分阈值收益验证 =================
   * 全部数字由 build_threshold_return_v1.py 离线预计算；
   * 未完成（pending）样本不计入平均收益 / 胜率，只单独计数。 */
  function renderThreshold(){
    var wrap = el('thr-table-wrap'), src = el('thr-source');
    if(src){
      src.innerHTML = '<strong>信号来源：'+esc(THR.signal_source||'投资吸引力评分')+'</strong><br>'+
        '持有 '+esc(THR.holding_sessions==null?GLYPH:THR.holding_sessions)+' 交易日 · 口径 '+
        esc(THR.return_basis||GLYPH)+' · '+esc(THR.price_basis||GLYPH)+
        ' · 未完成样本不计入平均收益与胜率 · 最大回撤按 '+
        esc((THR.contract_source||'')?'PRIOR_CLOSE_SCORE_NEXT_OPEN_GATED_CURVE':'')+' 挂钩曲线口径';
    }
    if(!wrap) return;
    var rows = THR.rows || [];
    if(!rows.length){
      wrap.innerHTML = scopeNote('threshold_return') ||
        '<div class="mod-partial">暂无阈值收益验证产物。</div>';
      return;
    }
    wrap.innerHTML = '<table class="thr-table"><thead><tr>'+
      '<th>阈值</th><th>信号数</th><th>已完成样本</th><th>平均收益</th>'+
      '<th>胜率</th><th>最大回撤</th><th>最近成熟信号日</th>'+
      '</tr></thead><tbody>'+
      rows.map(function(r){
        var done = Number(r.completed_samples||0);
        var pend = Number(r.pending_samples||0);
        return '<tr><td>≥ '+esc(r.threshold)+'</td>'+
          '<td class="mono">'+esc(r.signal_count==null?GLYPH:r.signal_count)+'</td>'+
          '<td class="mono">'+esc(r.completed_samples==null?GLYPH:r.completed_samples)+
            (pend>0 ? '（未完成 '+pend+'）' : '')+'</td>'+
          '<td class="mono">'+(done>0 ? pct(r.mean_return) : GLYPH)+'</td>'+
          '<td class="mono">'+(done>0 ? pct(r.win_rate) : GLYPH)+'</td>'+
          '<td class="mono">'+(done>0 ? pct(r.maximum_drawdown) : GLYPH)+'</td>'+
          '<td class="mono">'+esc(r.last_matured_signal_date||GLYPH)+'</td></tr>';
      }).join('')+'</tbody></table>';
  }

  /* ================= §31 / §32 —— 运行态元信息区块 =================
   * V6：整段从公开 UI 移除（RUNTIME_METADATA_SECTION_USER_VISIBLE = FALSE）。
   * 只是 USER_VISIBLE = FALSE：运行态数据 / Production 状态 / Metadata /
   * Audit 字段 / Evidence / Logs / Generator 与 Publish metadata 全部仍在
   * 后台 payload 与 Evidence 中保留，不因 UI 删除而删除任何后台字段。 */

  /* ================= 主渲染 ================= */
  function render(d){
    var idx = dates.indexOf(d);
    var day = days[d] || null;
    /* §26 —— 逐项明细按年份懒加载；没有就向中性加载器要，绝不自己造数据。 */
    if(!day && typeof window.__CMB_REQUEST_DAY__ === 'function'){
      window.__CMB_REQUEST_DAY__(d);
    }
    var hc = (H.core_class||[])[idx] || 'NONE';
    var hi = (H.inv_class||[])[idx] || 'NONE';
    var hcov = (H.core_cov||[])[idx];
    var icov = (H.inv_cov||[])[idx];

    // ---- Core Hero
    var cScore=null, cStatus='NOT_FULLY_AVAILABLE', cVerdict='', cStats='';
    if(day && day.core){ cScore=day.core.score; cStatus=day.core.status; }
    else if(hc==='FULL'){ cScore=(H.core_score||[])[idx]; cStatus='FULLY_AVAILABLE'; }
    /* §14 —— Hero 只展示「评分信号」；可用性 / 数据来源保留在后台 payload，
     * 不再作为用户可见工程说明输出（删除「完整可用」「状态」「数据来源」）。 */
    var cCls = day ? 'FULL' : hc;
    var cLv = levelOf(cScore, bandLevels('core'));
    if(day && day.core){
      cVerdict = cLv ? cLv.signal_label
               : (bandUnavailable('core') ? '信号区间研究未发布' : 'LEVEL-A 正式可比较历史');
      cStats = signalBox('评分信号', signalText(cScore, 'core', cCls), 'unavailable');
    }else{
      cVerdict = (hc==='FULL') ? 'LEVEL-A 正式可比较历史'
               : (hc==='PARTIAL') ? 'LEVEL-B 研究历史（非完整可比）'
               : (hc==='INSUFFICIENT') ? 'LEVEL-C 历史数据不足' : '无历史数据';
      cStats = signalBox('评分信号', signalText(cScore, 'core', cCls), 'unavailable') +
               statBox('覆盖等级', hc, 'unavailable') +
               statBox('覆盖率', fmt(hcov,2)+'%', 'unavailable') +
               statBox(hc==='PARTIAL'?'归一化研究分':'研究分',
                       (hc==='PARTIAL'?fmt((H.core_norm||[])[idx],2):fmt((H.core_score||[])[idx],2)),
                       'unavailable');
    }
    /* §13 —— 只换展示标题；底层仍绑定 CORE_FUNDAMENTAL_SCORE */
    heroBlock('core', cScore, cStatus, CORE_HERO_TITLE, cVerdict, cStats);
    var cf = el('core-flag');
    if(cf) cf.innerHTML = (!day && (hc==='PARTIAL'||hc==='INSUFFICIENT'))
      ? '<span class="research-flag">RESEARCH_ONLY · 非完整可比</span>' : '';

    // ---- Investment Hero
    var iScore=null, iStatus='NOT_FULLY_AVAILABLE', iVerdict='', iStats='';
    if(day && day.investment){ iScore=day.investment.score; iStatus=day.investment.status; }
    else if(hi==='FULL'){ iScore=(H.inv_score||[])[idx]; iStatus='FULLY_AVAILABLE'; }
    /* §15 —— 同 Core：删除「状态」「角色 INVESTMENT_ATTRACTION」「数据来源」。 */
    var iCls = day ? 'FULL' : hi;
    var iLv = levelOf(iScore, bandLevels('investment'));
    if(day && day.investment){
      iVerdict = iLv ? iLv.signal_label
               : (bandUnavailable('investment') ? '信号区间研究未发布' : 'LEVEL-A 正式可比较历史');
      iStats = signalBox('评分信号', signalText(iScore, 'investment', iCls), 'unavailable');
    }else{
      iVerdict = (hi==='FULL') ? 'LEVEL-A 正式可比较历史'
               : (hi==='PARTIAL') ? 'LEVEL-B 研究历史（非完整可比）'
               : (hi==='INSUFFICIENT') ? 'LEVEL-C 历史数据不足' : '无历史数据';
      iStats = signalBox('评分信号', signalText(iScore, 'investment', iCls), 'unavailable') +
               statBox('覆盖等级', hi, 'unavailable') +
               statBox('覆盖率', fmt(icov,2)+'%', 'unavailable') +
               statBox(hi==='PARTIAL'?'归一化研究分':'研究分',
                       (hi==='PARTIAL'?fmt((H.inv_norm||[])[idx],2):fmt((H.inv_score||[])[idx],2)),
                       'unavailable');
    }
    /* §13 —— 只换展示标题；底层仍绑定 INVESTMENT_ATTRACTION_SCORE */
    heroBlock('inv', iScore, iStatus, INV_HERO_TITLE, iVerdict, iStats);
    var inf = el('inv-flag');
    if(inf) inf.innerHTML = (!day && (hi==='PARTIAL'||hi==='INSUFFICIENT'))
      ? '<span class="research-flag">RESEARCH_ONLY · 非完整可比</span>' : '';

    // ---- 模块小计 + 按模块归组的指标明细（§6-§18）
    // 信息层次：模块标题条（名称 · 满分）→ 模块合计行（范围  得分/满分）
    //          → 彩色 Progress（真实比例）→ 该模块指标明细
    if(day){
      var coreMetrics = (day.core||{}).metrics || [];
      var invMetrics  = (day.investment||{}).metrics || [];
      var mods = (day.core||{}).modules || [];
      var subs = (day.investment||{}).submodules || [];
      el('core-modules').innerHTML = moduleBlocks(mods, coreMetrics, null);
      el('inv-modules').innerHTML  = moduleBlocks(subs, invMetrics, null);
    }else{
      /* §38 / §39 —— 历史研究日没有逐项明细，不得输出模块小计冒充正式可比模块 */
      el('core-modules').innerHTML = histModuleNote('核心基本面', hc, hcov);
      el('inv-modules').innerHTML  = histModuleNote('投资吸引力', hi, icov);
    }

    // ---- ⑩ 动态阈值研究 · Research Only（§37：随所选交易日同步）
    renderDynamic(d);

    // ---- Forward（NO_SCORE）
    var f = (day && day.forward) || {};
    var fstate = f.overall_forward_state || 'INSUFFICIENT_EVIDENCE';
    el('fwd-card').className = 'kpi-card';
    el('fwd-state').innerHTML = '<span class="chip c-'+esc(fstate)+'">'+(ST[fstate]||esc(fstate))+'</span>';
    el('fwd-meta').innerHTML =
      '<div class="kpi-sub">置信度 '+(f.confidence?(CF[f.confidence]||f.confidence):GLYPH)+
      ' · Evidence '+esc(f.evidence_count==null?0:f.evidence_count)+' 条</div>'+
      '<div class="kpi-rate">NO_SCORE：前瞻永不输出数值分数</div>';
    var fmd = f.modules || [];
    /* §28 —— 模型未发布 Forward 证据链时给出诚实说明（不倒填、不伪造）。 */
    var fwdNote = f.scope_note ? '<div class="mod-partial">'+esc(f.scope_note)+'</div>' : '';
    el('fwd-mods').innerHTML = (fmd.length
      ? fmd.map(function(m){
          return '<div class="score-row"><div class="score-row-head">'+
            '<span class="score-row-label">'+esc(m.name||m.module_id)+'</span>'+
            '<span class="chip c-'+esc(m.direction)+'">'+(ST[m.direction]||esc(m.direction))+'</span></div>'+
            '<div class="score-row-meta"><span>置信度 '+esc(m.confidence?(CF[m.confidence]||m.confidence):GLYPH)+
            '</span><span>Evidence '+esc(m.evidence_count==null?0:m.evidence_count)+'</span>'+
            '<span>'+esc(m.reason||'')+'</span></div></div>';
        }).join('')
      : '<div class="score-row"><div class="score-row-meta">'+
        '未构建 Forward 模块状态（当日无真实 Forward Evidence → 显示「证据不足」，'+
        '绝不因为没消息就显示稳定）。</div></div>') + fwdNote;
    var ev = f.evidence_detail || [];
    el('ev-wrap').innerHTML = ev.length
      ? '<div class="ev"><table class="signal-table"><thead><tr><th>指标</th><th>方向候选</th>'+
        '<th>来源</th><th>Tier</th><th>摘要</th></tr></thead><tbody>'+
        ev.map(function(e){
          return '<tr><td class="td-name">'+esc((e.target_metric_ids||[]).join(','))+'</td>'+
            '<td>'+esc(e.direction_candidate||GLYPH)+'</td>'+
            '<td>'+esc(e.source_name||e.provider||GLYPH)+'</td>'+
            '<td>'+esc(e.source_tier||GLYPH)+'</td>'+
            '<td>'+esc(e.parsed_fact||GLYPH)+'</td></tr>';
        }).join('')+'</tbody></table></div>'
      : '<div class="warnbox">当日没有真实 Forward Evidence → 状态为「证据不足」，不是「稳定」。</div>';

    // ---- Risk Overlay（独立，不是正向评分）
    var ro = (day && day.risk_overlay) || {status:'NOT_FULLY_AVAILABLE'};
    var roNull = (ro.status !== 'FULLY_AVAILABLE');
    el('ro-card').className = 'kpi-card kpi-overlay';
    el('ro-score').textContent = roNull ? GLYPH : fmt(ro.net_score, 2);
    el('ro-meta').innerHTML =
      '<div class="kpi-sub">'+(STATUS_CN[ro.status]||ro.status)+'</div>'+
      '<div class="kpi-rate">独立风险扣分 · 不并入任何分数 · 不使用正向评分进度条</div>'+
      (ro.scope_note ? '<div class="mod-partial">'+esc(ro.scope_note)+'</div>' : '');

    // ---- 数据来源脚注
    var src = el('src-note');
    if(src){
      /* §9 —— 只保留数据来源本身，去掉「正式生产运行 / 唯一 Production Authority」
       * 一类用户可见的工程权威表述。 */
      var histSrc = '数据来源：CMB_V2 历史重建（PIT 只读解析，RESEARCH_ONLY）';
      src.textContent = day
        ? (day.source_label || (day.source==='V2_PRODUCTION_SNAPSHOT'
             ? '数据来源：V2 Production Snapshot'
             : '数据来源：Phase C 冻结研究轨迹'))
        : (MODEL_META.model_id === 'CMB_SCORE_MODEL_V2'
             ? histSrc : (MODEL_META.source_label || histSrc));
    }
    var stt = el('day-status');
    if(stt) stt.textContent = '可查询交易日 ' + dates.length + ' 个 · 起始 ' +
      (dates[0]||GLYPH) + ' · 截止 ' + (dates[dates.length-1]||GLYPH);
    var dcn = el('day-current');
    if(dcn){
      var i2 = dates.indexOf(d);
      dcn.textContent = '当前 ' + d + (i2>=0 ? ' · 第 '+(i2+1)+' / '+dates.length+' 个' : '') +
        ' · Core ' + hc + '（'+fmt(hcov,2)+'%） · Investment ' + hi + '（'+fmt(icov,2)+'%）';
    }
    if(el('day-prev')) el('day-prev').disabled = (dates.indexOf(d) <= 0);
    if(el('day-next')) el('day-next').disabled = (dates.indexOf(d) >= dates.length-1);

    // ---- §20 ~ §26 综合研判 / §27 ~ §39 评分信号共振（只读预计算产物）
    renderAssessment(d);
    renderResonance(d);
    // §16 ~ §19 —— 评分信号整行强制单行（确定性 fit-to-width，仅展示层）
    fitSignals();
  }

  /* ================= 图表（V1.1 .score-canvas + .chart-crosshair + .chart-tooltip） ================= */
  function setupChart(shellId){
    var shell = el(shellId);
    if(!shell) return null;
    var cv = shell.querySelector('canvas.score-canvas');
    var cross = shell.querySelector('canvas.chart-crosshair');
    var tip = shell.querySelector('.chart-tooltip');
    if(!cv || !cross || !tip) return null;
    var ctx = cv.getContext('2d'), cctx = cross.getContext('2d');
    if(!ctx || !cctx) return null;
    var PAD = {l:44, r:14, t:14, b:26};
    function size(canvas){
      var dpr = window.devicePixelRatio || 1;
      var w = canvas.clientWidth || 600, h = canvas.clientHeight || 240;
      canvas.width = Math.round(w*dpr); canvas.height = Math.round(h*dpr);
      var c = canvas.getContext('2d');
      c.setTransform(dpr,0,0,dpr,0,0);
      return {w:w,h:h};
    }
    function geom(canvas){
      var s = size(canvas), p = PAD;
      return {w:s.w, h:s.h, W:s.w-p.l-p.r, H:s.h-p.t-p.b, p:p};
    }
    return {shell:shell, cv:cv, cross:cross, tip:tip, ctx:ctx, cctx:cctx, geom:geom, PAD:PAD};
  }
  function drawSeries(ch, labels, series, marker, opt){
    if(!ch) return;
    var g = ch.geom(ch.cv), p = ch.PAD, ctx = ch.ctx;
    var W=g.W, H=g.H;
    ctx.clearRect(0,0,g.w,g.h);
    ctx.fillStyle='#fff'; ctx.fillRect(0,0,g.w,g.h);
    var mn = opt && opt.min!=null ? opt.min : 0, mx = opt && opt.max!=null ? opt.max : 100;
    var all=[]; series.forEach(function(se){ (se.data||[]).forEach(function(v){ if(v!=null) all.push(v); }); });
    if(!(opt && opt.min!=null) && all.length){ mn = Math.min.apply(null, all); }
    if(!(opt && opt.max!=null) && all.length){ mx = Math.max.apply(null, all); }
    if(mx-mn < 1e-9){ mx = mn + 1; }
    var pad2 = (mx-mn)*0.08; mn -= pad2; mx += pad2;
    var X = function(i){ return p.l + (labels.length<=1?0:(W*i/(labels.length-1))); };
    var Y = function(v){ return p.t + H - (H*(v-mn)/(mx-mn)); };
    // grid（V1.1/V6 网格语义）
    ctx.strokeStyle='#e5e7eb'; ctx.lineWidth=1; ctx.font='10px sans-serif'; ctx.fillStyle='#6b7280';
    for(var gi=0; gi<=4; gi++){
      var vv = mn + (mx-mn)*gi/4, y = Math.round(Y(vv))+0.5;
      ctx.beginPath(); ctx.moveTo(p.l,y); ctx.lineTo(p.l+W,y); ctx.stroke();
      ctx.textAlign='right'; ctx.fillText(vv.toFixed(1), p.l-6, y+3);
    }
    ctx.textAlign='center';
    var step = Math.max(1, Math.floor(labels.length/6));
    for(var li=0; li<labels.length; li+=step){ ctx.fillText(labels[li], X(li), g.h-8); }
    // series
    series.forEach(function(se){
      ctx.strokeStyle = se.color; ctx.lineWidth = se.width || 1.6;
      if(se.dash) ctx.setLineDash([5,4]); else ctx.setLineDash([]);
      ctx.beginPath(); var started=false;
      for(var i=0;i<(se.data||[]).length;i++){
        var v = se.data[i];
        if(v==null){ started=false; continue; }
        var x=X(i), y=Y(v);
        if(!started){ ctx.moveTo(x,y); started=true; } else { ctx.lineTo(x,y); }
      }
      ctx.stroke(); ctx.setLineDash([]);
    });
    // marker
    if(marker!=null && marker>=0 && marker<labels.length){
      var xm = X(marker);
      ctx.strokeStyle='rgba(124,58,237,.75)'; ctx.setLineDash([3,3]);
      ctx.beginPath(); ctx.moveTo(xm,p.t); ctx.lineTo(xm,p.t+H); ctx.stroke(); ctx.setLineDash([]);
      series.forEach(function(se){
        var v=(se.data||[])[marker]; if(v==null) return;
        ctx.fillStyle=se.color; ctx.beginPath(); ctx.arc(xm,Y(v),3.2,0,Math.PI*2); ctx.fill();
      });
    }
    // crosshair canvas 尺寸同步
    var cg = ch.geom(ch.cross);
    ch.cctx.clearRect(0,0,cg.w,cg.h);
    ch._X = X; ch._Y = Y; ch._mn = mn; ch._mx = mx; ch._labels = labels;
  }
  /* _series / _labels 缓存在 ch 上：区间切换后同一批监听器读取最新数据，
   * 避免重复 addEventListener。 */
  function setCrosshairSeries(ch, series, labels){
    if(!ch) return;
    ch._series = series; ch._labels = labels;
  }
  function bindCrosshair(ch, series, labels){
    if(!ch) return;
    setCrosshairSeries(ch, series, labels);
    function curLabels(){ return ch._labels || labels; }
    function curSeries(){ return ch._series || series; }
    function idxFrom(e){
      var r = ch.shell.getBoundingClientRect();
      var cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
      var p = ch.PAD, W = r.width - p.l - p.r;
      var n = curLabels().length;
      var i = Math.round((cx - p.l) / (W / Math.max(1, n-1)));
      return Math.max(0, Math.min(n-1, i));
    }
    function show(i){
      var r = ch.shell.getBoundingClientRect(), p = ch.PAD, W = r.width-p.l-p.r;
      var g = ch.geom(ch.cross);
      var ls = curLabels(), ss = curSeries();
      ch.cctx.clearRect(0,0,g.w,g.h);
      var x = p.l + (W*i/Math.max(1,ls.length-1));
      ch.cctx.strokeStyle='rgba(124,58,237,.5)'; ch.cctx.setLineDash([4,4]);
      ch.cctx.beginPath(); ch.cctx.moveTo(x,p.t); ch.cctx.lineTo(x,p.t+g.h-p.t-p.b+p.t); ch.cctx.stroke();
      ch.cctx.setLineDash([]);
      if(ch._X && ch._Y){
        ss.forEach(function(se){
          var v=(se.data||[])[i]; if(v==null) return;
          ch.cctx.fillStyle=se.color; ch.cctx.beginPath();
          ch.cctx.arc(ch._X(i), ch._Y(v), 3.2, 0, Math.PI*2); ch.cctx.fill();
        });
      }
      var rows = ss.map(function(se){
        var v = (se.data||[])[i];
        return '<span>'+esc(se.name)+'：'+(v==null?GLYPH:Number(v).toFixed(2))+'</span>';
      }).join('');
      ch.tip.innerHTML = '<strong>'+esc(ls[i])+'</strong>'+rows;
      ch.tip.style.display = 'block';
    }
    function hide(){ ch.cctx && ch.cctx.clearRect(0,0,ch.cross.width,ch.cross.height); ch.tip.style.display='none'; }
    ch.shell.addEventListener('mousemove', function(e){ show(idxFrom(e)); });
    ch.shell.addEventListener('mouseleave', hide);
    ch.shell.addEventListener('touchstart', function(e){ show(idxFrom(e)); }, {passive:true});
    ch.shell.addEventListener('touchmove', function(e){ show(idxFrom(e)); }, {passive:true});
    ch.shell.addEventListener('touchend', hide);
  }

  var CH = {};
  function buildSeries(){
    var showPartial = el('chk-partial') ? el('chk-partial').checked : false;
    var coreFull = [], corePart = [], invFull = [], invPart = [];
    for(var i=0;i<dates.length;i++){
      var hc=(H.core_class||[])[i]||'NONE', hi=(H.inv_class||[])[i]||'NONE';
      coreFull.push(hc==='FULL' ? (H.core_score||[])[i] : null);
      corePart.push(showPartial && hc==='PARTIAL' ? (H.core_norm||[])[i] : null);
      invFull.push(hi==='FULL' ? (H.inv_score||[])[i] : null);
      invPart.push(showPartial && hi==='PARTIAL' ? (H.inv_norm||[])[i] : null);
    }
    return {coreFull:coreFull, corePart:corePart, invFull:invFull, invPart:invPart};
  }
  /* §44 ~ §49 —— CHART-A 三条线：正式 Fixed（实线）/ 扩展研究历史（虚线）/
   * 动态阈值研究 Shadow（虚线，RESEARCH_ONLY）。P03 Hybrid 恒 NOT_DRAWN。 */
  function chartASeries(s){
    return [
      {name:'核心基本面评分（正式 Fixed）', color:'#7c3aed', data:s.coreFull, step:true},
      {name:'研究扩展（虚线）', color:'#9ca3af', data:s.corePart, dash:true, width:1.2},
      {name:'动态阈值研究 Shadow（RESEARCH_ONLY）', color:'#f59e0b',
       data:s.coreShadow, dash:true, width:1.4}
    ];
  }
  function chartBSeries(s){
    return [
      {name:'投资吸引力评分', color:'#2563eb', data:s.invFull},
      {name:'研究扩展（虚线）', color:'#9ca3af', data:s.invPart, dash:true, width:1.2}
    ];
  }
  function drawAll(d){
    var s = buildSeries();
    var r = rangeSlice();
    var rdates = dates.slice(r.s, r.e+1);
    var mi = dates.indexOf(d);
    if(mi>=r.s && mi<=r.e){ mi = mi - r.s; } else { mi = -1; }
    function cut(a){ return a.slice(r.s, r.e+1); }
    var sa = {coreFull:cut(s.coreFull), corePart:cut(s.corePart),
              coreShadow:cut(shadowAligned())};
    var sb = {invFull:cut(s.invFull), invPart:cut(s.invPart)};
    var seA = chartASeries(sa), seB = chartBSeries(sb);
    if(!CH.A){
      CH.A = setupChart('chartA'); CH.B = setupChart('chartB'); CH.C = setupChart('chartC');
      bindCrosshair(CH.A, seA, rdates);
      bindCrosshair(CH.B, seB, rdates);
      var ft = DATA.forward_timeline || {status:'NO_HISTORICAL_FORWARD_EVIDENCE', points:[]};
      if(ft.status!=='OK' || !ft.points.length){
        el('chartC').innerHTML = '<div class="chart-empty">NO_HISTORICAL_FORWARD_EVIDENCE：'+
          '目前没有任何真实 Forward Evidence，因此不存在 Forward 历史线；'+
          '禁止把今天的规则倒填到 2021 年。</div>';
      }else{
        bindCrosshair(CH.C, [{name:'Forward 状态', color:'#059669', data:ft.points.map(function(p){
          return {'IMPROVING':3,'STABLE':2,'DETERIORATING':1}[p.state] || 0; })}],
          ft.points.map(function(p){return p.date;}));
      }
    }else{
      setCrosshairSeries(CH.A, seA, rdates);
      setCrosshairSeries(CH.B, seB, rdates);
    }
    drawSeries(CH.A, rdates, seA, mi, {min:0,max:100});
    drawSeries(CH.B, rdates, seB, mi, {min:0,max:100});
    if(CH.C && (DATA.forward_timeline||{}).status==='OK'){
      var ft2 = DATA.forward_timeline;
      drawSeries(CH.C, ft2.points.map(function(p){return p.date;}),
        [{name:'Forward 状态', color:'#059669', data:ft2.points.map(function(p){
          return {'IMPROVING':3,'STABLE':2,'DETERIORATING':1}[p.state] || 0; }), step:true}], 0, {min:0,max:3});
    }
    // 图例说明
    var lg = el('hist-legend-note');
    if(lg){
      lg.textContent = '正式实线从 Core ' + (POL.core_full_start||GLYPH) +
        ' / Investment ' + (POL.investment_full_start||GLYPH) + ' 起；' +
        '虚线为扩展研究历史（覆盖率归一化，RESEARCH_ONLY）与动态阈值研究 Shadow（RESEARCH_ONLY）。';
    }
    /* 区间最高 / 最低 与区间统计跟随当前区间刷新 */
    renderExtrema();
    rangeStatus();
  }

  /* ================= 事件绑定（每次 boot 对新 DOM 重新绑定） ================= */
  function bindEvents(){
  if(el('year-select')) el('year-select').addEventListener('change', function(){
    var y = el('year-select').value, ms = monthsOf(y);
    if(!ms.length) return;
    var ds = daysOf(y, ms[ms.length-1]);
    gotoDate(ds[ds.length-1]);
  });
  if(el('month-select')) el('month-select').addEventListener('change', function(){
    var y = el('year-select').value, m = el('month-select').value;
    var ds = daysOf(y, m);
    if(ds.length) gotoDate(ds[ds.length-1]);
  });
  if(el('day-select')) el('day-select').addEventListener('change', function(){
    gotoDate(el('day-select').value); });
  if(el('day-prev')) el('day-prev').addEventListener('click', function(){
    var i = dates.indexOf(cur); if(i>0) gotoDate(dates[i-1]); });
  if(el('day-next')) el('day-next').addEventListener('click', function(){
    var i = dates.indexOf(cur); if(i<dates.length-1) gotoDate(dates[i+1]); });
  if(el('day-latest')) el('day-latest').addEventListener('click', function(){
    gotoDate(dates[dates.length-1]); });
  if(el('native-date')) el('native-date').addEventListener('change', function(){
    var d = el('native-date').value;
    if(!d){ notice(''); return; }          /* 清空输入时同步清掉上一次的回退提示 */
    gotoDate(d); });
  /* 逐键输入过程中控件值会短暂落在不可用日期上（Chrome 日期分段会自动补全/夹紧），
     一旦回到可用交易日就立刻撤掉回退提示，避免残留一条已经不成立的提示。 */
  if(el('native-date')) el('native-date').addEventListener('input', function(){
    var d = el('native-date').value;
    if(d && dates.indexOf(d)>=0) notice('');
  });

  /* ================= 日历面板：真正可直接用鼠标点选日期 ================= */
  var calY = null, calM = null;
  function calRender(){
    var panel = el('cal-panel');
    if(!panel) return;
    if(calY===null){
      var cur0 = cur || dates[dates.length-1] || '1970-01-01';
      calY = Number(cur0.slice(0,4)); calM = Number(cur0.slice(5,7))-1;
    }
    var first = new Date(calY, calM, 1);
    var startW = first.getDay();                 /* 0=周日 */
    var dim = new Date(calY, calM+1, 0).getDate();
    var h = [];
    h.push('<div class="cal-head">');
    h.push('<button type="button" class="btn-mini" id="cal-prev" title="上一月">‹</button>');
    h.push('<span class="cal-title">'+calY+' 年 '+(calM+1)+' 月</span>');
    h.push('<button type="button" class="btn-mini" id="cal-next" title="下一月">›</button>');
    h.push('</div>');
    h.push('<div class="cal-grid">');
    ['日','一','二','三','四','五','六'].forEach(function(w){
      h.push('<div class="cal-w">'+w+'</div>'); });
    for(var b=0;b<startW;b++) h.push('<div></div>');
    for(var dd=1; dd<=dim; dd++){
      var iso = calY+'-'+String(calM+1).padStart(2,'0')+'-'+String(dd).padStart(2,'0');
      var ok = dates.indexOf(iso)>=0;
      h.push('<button type="button" class="cal-day'+(iso===cur?' sel':'')+'"'
             + ' data-d="'+iso+'"' + (ok?'':' disabled')
             + ' aria-label="'+iso+'">' + dd + '</button>');
    }
    h.push('</div>');
    panel.innerHTML = h.join('');
    var p0 = el('cal-prev'), n0 = el('cal-next');
    if(p0) p0.addEventListener('click', function(){
      calM--; if(calM<0){calM=11;calY--;} calRender(); });
    if(n0) n0.addEventListener('click', function(){
      calM++; if(calM>11){calM=0;calY++;} calRender(); });
    Array.prototype.slice.call(panel.querySelectorAll('.cal-day')).forEach(function(b){
      b.addEventListener('click', function(){ gotoDate(b.getAttribute('data-d')); });
    });
  }
  if(el('cal-toggle')) el('cal-toggle').addEventListener('click', function(){
    var panel = el('cal-panel'); if(!panel) return;
    panel.hidden = !panel.hidden;
    el('cal-toggle').setAttribute('aria-expanded', panel.hidden?'false':'true');
    if(!panel.hidden){
      var c0 = cur || dates[dates.length-1] || '1970-01-01';
      calY = Number(c0.slice(0,4)); calM = Number(c0.slice(5,7))-1;
      calRender();
    }
  });
  if(el('chk-partial')) el('chk-partial').addEventListener('change', function(){ drawAll(cur); });

  /* §41 ~ §43 —— 历史区间控件（只改变历史图 X 轴与区间统计，不动评分） */
  if(el('hist-apply')) el('hist-apply').addEventListener('click', applyRange);
  if(el('hist-reset')) el('hist-reset').addEventListener('click', function(){ presetRange(0); });
  if(el('hist-1y')) el('hist-1y').addEventListener('click', function(){ presetRange(1); });
  if(el('hist-3y')) el('hist-3y').addEventListener('click', function(){ presetRange(3); });
  if(el('hist-5y')) el('hist-5y').addEventListener('click', function(){ presetRange(5); });
  if(el('hist-all')) el('hist-all').addEventListener('click', function(){ presetRange(0); });
  if(el('hist-start')) el('hist-start').addEventListener('change', applyRange);
  if(el('hist-end')) el('hist-end').addEventListener('change', applyRange);

  /* document / window 级监听只绑一次：boot 会随换模型重复执行，
     重复绑定会让一次按键跳转两天。 */
  if(!GLOBAL_BOUND){
    GLOBAL_BOUND = true;
    document.addEventListener('keydown', function(e){
      if(e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      var i = dates.indexOf(cur);
      if(e.key==='ArrowLeft' && i>0){ gotoDate(dates[i-1]); e.preventDefault(); }
      if(e.key==='ArrowRight' && i<dates.length-1){ gotoDate(dates[i+1]); e.preventDefault(); }
    });
    window.addEventListener('resize', function(){
      if(cur){ drawAll(cur); renderDynamic(cur); }
      fitSignals();
    });
  }
  }

  /* ================= H.2 boot —— 中性加载器注入 payload 后调用 ============= */
  function boot(payload){
    DATA = payload || {};
    MODEL_META = DATA.model_meta || {};
    /* §36 —— 展示字符串来自 Python 预计算的查找表，浏览器不自己格式化。 */
    DMAP = DATA.display_map || {};
    DMAP_PCT = DATA.display_map_pct || {};
    RAW_META = DATA.raw_precision || {};
    SCOPE = DATA.section_scope || {};
    window.__CMB_FMT_MISS__ = {count:0, keys:{}};
    dates = DATA.dates || [];
    days  = DATA.days || {};
    SER   = DATA.series || {};
    H     = DATA.hist_series || {};
    POL   = DATA.hist_policy || {};
    MT    = DATA.main_title || {};
    HT    = DATA.hero_titles || {};
    BAND  = DATA.score_signal_band || {};
    ASM   = (DATA.comprehensive_assessment || {}).assessment || {};
    RES   = DATA.score_resonance || {};
    SHW   = DATA.core_shadow_history || {};
    THR   = DATA.threshold_return || {};
    DR    = DATA.dynamic_research || {};
    CORE_HERO_TITLE = HT.core || "基本面综合值博率";
    INV_HERO_TITLE  = HT.investment || "吸引力综合值博率";
    SHW_MAP = {};
    (function(){
      var ds = SHW.dates || [], vs = SHW.core_shadow || [];
      for(var i=0;i<ds.length;i++){ if(ds[i]!=null) SHW_MAP[ds[i]] = vs[i]; }
    })();
    /* §41 —— 换模型时图表、十字线、区间、日历全部归零，零残留。 */
    DYN = {}; CH = {}; RSTART = null; REND = null; calY = null; calM = null;
    buildTree();
    cur = dates.length ? dates[dates.length-1] : null;

    bindEvents();
    /* ---- V6 初始化（全部只读渲染，不触发任何模型重算 / 外部调用） ---- */
    renderTopIdentity();
    renderThreshold();
    if(el('hist-start') && dates.length) el('hist-start').value = dates[0];
    if(el('hist-end') && dates.length) el('hist-end').value = dates[dates.length-1];
    renderDynamicShell();
    gotoDate(dates.length ? dates[dates.length-1] : null);
    fitSignals();
    window.__CMB_SHELL_READY__ = true;
  }

  /* §26 —— 懒加载的逐项明细到达后只重画当天，不重置页面状态。 */
  function rerender(d){
    if(!d) return;
    render(d); drawAll(d); fitSignals();
  }

  window.__CMB_SHELL_BOOT__ = boot;
  window.__CMB_SHELL_RERENDER__ = rerender;
  window.__CMB_SHELL_READY__ = false;
})();
