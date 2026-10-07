
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
  /* ---- §4 ~ §7 CHART-B 价格叠加（Phase H.3） ----
   * DATA  = 真实 K 线 OHLC（payload.chart_b_price，本地离线产物）
   * VISUAL = 主图叠加绘制收盘价曲线，Tooltip 在 OHLC 完整时给出开/高/低/收。
   * 价格曲线走独立右轴（§7 禁止把价格 normalize 到 0~100 与评分共轴）。
   * 颜色与投资吸引力评分曲线明确不同（§6），且只改 CHART-B（§67）。 */
  var PRICE = {};
  var PRICE_COLOR = "#d97706";   /* 与 #2563eb 评分曲线明显不同（§6） */

  /* ---- §52 CHART-B 下窗格：择时参考（Phase H.4） ----
   * Bank-level、模型中立：V2 / V3 对同一 (bank, date) 数值完全相同（§62）。
   * 只用第三种不同颜色，沿用既有绿色家族 --green #059669，不引入新设计体系。 */
  var TIMING = {};
  var TIMING_COLOR = "#059669";

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
    /* ISSUE-07 —— 全局交易日切换时，④ 的定位锚点跟着走，保证全页只有一个
       selectedTradingDate；用户在 ④ 里单独定位则只改 ④ 的锚点。 */
    if(ISV4){
      V4_SEL = target;
      if(el('v4-single-date')) el('v4-single-date').value = target;
    }
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
  /* ================= CMB_SCORE_MODEL_V4 —— 五柱独立评分渲染 =============
   * 只在 model_id = CMB_SCORE_MODEL_V4 时启用；V2 / V3 走原来的 hero / 模块 /
   * 共振 / 阈值路径，一行代码都不改（视觉母版 MODEL_V2_FRONTEND_V6）。
   * 五柱各自 0~100、同图共享 0~100 纵轴；不存在第六个综合分。
   * 展示字符串一律查 display_map（Python Decimal ROUND_HALF_UP 预计算），
   * 浏览器不格式化任何业务数字。 */
  var ISV4 = false;
  var V4P = [], V4M = {}, V4RANGE = null;
  /* 五柱曲线色板 + 价格曲线沿用本项目既有的价格色（PRICE_COLOR #d97706）。
     R2 配色决定：价格位置 = 红色 #dc2626，宏观估值环境 = 黑色 #000000，
     其余三柱保持既有色，六条线仍互不撞色。 */
  var V4_COLORS = ['#7c3aed', '#2563eb', '#dc2626', '#059669', '#000000'];
  var V4_QFQ_COLOR = '#d97706';
  var V4_SM = [];                 /* series_meta（五柱 + QFQ_CLOSE） */
  var V4_AXIS = {}, V4_EARLIEST = {}, V4_BAND = {};
  /* ISSUE-05 —— 方形复选图例的勾选状态：Fresh Page 恒为「全部未选」。
     不写 localStorage、不读 localStorage、不存 sessionStorage；
     刷新页面 / 切换模型后一律回到全未选（D06）。 */
  var V4_CHK = {};
  var V4_LG_BUILT = false;   /* 图例 DOM 只在每次 boot 构建一次（避免连点失效） */
  /* ISSUE-07 —— ④ 的唯一交易日锚点：selectedTradingDate。
     曲线、图例、十字线、Tooltip 全部围绕它取值，绝不各算一套日期索引。 */
  var V4_SEL = null;
  var V4_HOVER = null;
  /* ⑦ 样本置信度中文标签（J10）—— 只做标签翻译，不做任何数值加工。 */
  var CONF_CN = {RELATIVELY_SUFFICIENT: '样本相对充足', SUFFICIENT: '样本充足',
                 CAUTION: '样本偏少 · 谨慎参考', LIMITED: '样本有限',
                 LOW_SAMPLE: '样本不足', INSUFFICIENT: '样本不足',
                 NO_MATURE_SAMPLE: '无成熟样本'};
  /* V2 / V3 专属 section（按 data-section 标识）：V4 下整段隐藏。 */
  var V23_SECTIONS = ['D_HERO_CORE', 'F_CORE', 'E_FORWARD_OVERLAY',
                      'D_HERO_INVESTMENT', 'G_INVESTMENT', 'J_COMPREHENSIVE',
                      'K_RESONANCE', 'H_HISTORY', 'I_DYNAMIC',
                      'L_THRESHOLD_RETURN'];

  function applyModelSections(){
    Array.prototype.forEach.call(document.querySelectorAll('[data-v4]'),
      function(n){ n.hidden = !ISV4; });
    Array.prototype.forEach.call(document.querySelectorAll('[data-section]'),
      function(n){
        if(V23_SECTIONS.indexOf(n.getAttribute('data-section')) >= 0) n.hidden = ISV4;
      });
  }

  /* PART F —— 单日定位：回退到不晚于该日的最近交易日（previous-or-equal）。
     master 交易日轴是唯一真相，绝不按数组下标猜。 */
  function prevTradingDate(iso){
    if(!iso || !dates.length) return null;
    var lo = 0, hi = dates.length - 1, ans = null;
    while(lo <= hi){
      var mid = (lo + hi) >> 1;
      if(dates[mid] <= iso){ ans = dates[mid]; lo = mid + 1; }
      else { hi = mid - 1; }
    }
    return ans;
  }

  /* RC V3 / F008 —— 区间起点：next-or-equal。
     冻结规则（三条，语义各不相同，禁止互相复用）：
       Single Date : previous-or-equal
       Range Start : next-or-equal      （Resolved Start 必须 >= From）
       Range End   : previous-or-equal  （Resolved End   必须 <= To）
     例：From = 2013-07-13（周六）→ Resolved Start = 2013-07-15（周一），
     绝不能回退成 2013-07-12。 */
  function nextTradingDate(iso){
    if(!iso || !dates.length) return null;
    var lo = 0, hi = dates.length - 1, ans = null;
    while(lo <= hi){
      var mid = (lo + hi) >> 1;
      if(dates[mid] >= iso){ ans = dates[mid]; hi = mid - 1; }
      else { lo = mid + 1; }
    }
    return ans;
  }

  function v4FieldOf(key){
    if(key === 'QFQ_CLOSE') return 'qfq_close';
    for(var i = 0; i < V4P.length; i++){
      if(V4P[i].pillar === key) return V4P[i].output_field;
    }
    return null;
  }
  function v4ColorOf(key){
    if(key === 'QFQ_CLOSE') return V4_QFQ_COLOR;
    for(var i = 0; i < V4P.length; i++){
      if(V4P[i].pillar === key) return V4_COLORS[i % V4_COLORS.length];
    }
    return '#9ca3af';
  }
  /* 序列取值一律「日期键取值」：master 轴下标 -> hist_series 同一下标。
     G02 —— 绝不按数组位置对齐两条不同长度的序列。 */
  function v4ValueAt(key, date){
    var i = dates.indexOf(date);
    if(i < 0) return null;
    var f = v4FieldOf(key);
    var arr = (f && H[f]) ? H[f] : [];
    var v = arr[i];
    return (v === undefined) ? null : v;
  }

  function v4RawText(pillar, id, raw){
    if(raw === null || raw === undefined) return GLYPH;
    var meta = (V4M[pillar] || {})[id] || {};
    var u = meta.unit;
    return (u === 'pp' || u === 'ratio') ? pct(raw) : fmt(raw, 4);
  }
  function v4RawLabel(pillar, id){
    return ((V4M[pillar] || {})[id] || {}).raw_label || '原始值';
  }

  /* ================= RC V5 / PART F + PART G + PART W =================
   * Valuation / Price Location / Market Confirmation 的每个组成指标，
   * 现在与 Quality 的单项指标一样拥有自己的：
   *   Raw Value + 数据日期 / 标准化分 0~100 / 权重 / 实际得分 / 满分 / 进度条
   * 进度条复用 Quality 现有的 Visual Golden · Score Color Engine，
   * 不为这三个区域新建任何配色体系；比例 = score/100 = earned/max（Python 算好）。
   * 浏览器只渲染，绝不重算业务分（PART G）。
   * ==================================================================== */
  /* RC V10 / F004 —— freshness 状态是内部枚举，绝不直接出给用户。
     只显示简短中文用户语义；未知/空值一律不渲染，不留空芯片。 */
  var FRESHNESS_ZH = {
    'CURRENT_LATEST_ELIGIBLE': '当前可用',
    'CURRENT_BY_DISCLOSURE_CADENCE': '按披露节奏为最新',
    'STALE_NEWER_DISCLOSURE_AVAILABLE': '已有更新披露未计入',
    'NOT_AVAILABLE': '暂不可用'
  };
  function freshnessZh(s){
    var t = FRESHNESS_ZH[s];
    return (t === undefined) ? '' : t;
  }

  function v4ComponentRows(b){
    var comps = (b && b.components) || [];
    if(!comps.length) return '';
    return '<div class="mod-metrics mod-components">' + comps.map(function(c){
      var ns = c.normalized_score;
      var has = (ns !== null && ns !== undefined);
      var tone = has ? toneOf(ns, 100, 'FULLY_AVAILABLE') : 'unavailable';
      var rawTxt = (c.raw_value_display === undefined || c.raw_value_display === null)
        ? GLYPH : c.raw_value_display;
      /* PART H —— 与 Quality 一致：Raw Value 后面永远带数据所属日期 */
      var rawDate = c.raw_value_date ? (' · ' + c.raw_value_date) : '';
      return '<div class="score-row score-row-component" data-component="' +
        esc(c.component_id || '') + '">' +
        '<div class="score-row-head"><span class="score-row-label">' +
          esc(c.display_name || c.component_id || '') + '</span>' +
          '<span class="score-row-score ' + toneTextCls(tone) + '">' +
          (has ? (c.normalized_score_display || fmt(ns, 2)) : GLYPH) + ' / 100</span></div>' +
        /* PART G —— 进度条只表示标准化分（等价于 实际得分/满分），
           绝不由 Raw Value 直接生成。 */
        '<div class="score-bar-wrap"><i class="score-bar-fill" style="width:' +
          (has ? barWidth(ns, 100).toFixed(2) : 0) + '%"></i></div>' +
        '<div class="score-row-meta">' +
          '<span class="raw">原始值 ' + esc(rawTxt) + esc(rawDate) + '</span>' +
          '<span class="raw">权重 ' + esc(c.weight_display || GLYPH) + '</span>' +
        '</div>' +
        '<div class="score-row-meta">' +
          '<span class="raw">实际得分 ' + esc(c.earned_points_display || GLYPH) +
            ' / ' + esc(c.max_points_display || GLYPH) + '</span>' +
          /* F004 —— 不再输出 CURRENT_LATEST_ELIGIBLE 等工程枚举 */
          '<span>' + esc(freshnessZh(c.freshness_status)) + '</span>' +
        '</div>' +
        (c.explanation ? '<div class="mod-partial">' + esc(c.explanation) + '</div>' : '') +
        '</div>';
    }).join('') + '</div>';
  }

  /* PART H / PART AA —— Quality 每个成员在 Raw Value 后显示数据所属日期 */
  function v4QualityDateSuffix(b, id){
    var md = (b && b.member_dates) || {};
    var m = md[id];
    if(!m || !m.raw_value_date) return '';
    return ' · ' + m.raw_value_date;
  }
  /* PART H —— 内部新鲜度枚举与 canonical_source 属工程说明，不再渲染；
     Quality 成员的 Raw Value 日期（v4QualityDateSuffix）继续保留。 */

  function v4SeriesList(){
    return V4_SM.map(function(sm){
      var f = v4FieldOf(sm.key);
      var vals = (f && H[f]) ? H[f] : [];
      var right = (sm.axis === 'RIGHT');
      return {key: sm.key, name: sm.label_zh, color: v4ColorOf(sm.key),
              axis: right ? 'right' : 'left', money: right, unit: sm.unit,
              data: vals.slice()};
    });
  }
  /* D05 —— 只有勾选的序列才画；Fresh Page 全未选，因此初始不画任何曲线。 */
  function v4Shown(){
    return v4SeriesList().filter(function(s){ return V4_CHK[s.key] === true; });
  }

  /* ISSUE-05 —— 方形复选图例：<input type="checkbox"> 本身就是方形控件，
     沿用 .chart-legend 的排版与字号，不引入新的设计体系。 */
  function v4Legend(){
    var host = el('v4-chart-legend');
    if(!host) return;
    if(!V4_LG_BUILT){
      host.innerHTML = V4_SM.map(function(sm){
        var axisZh = (sm.axis === 'RIGHT') ? ('右轴 ' + sm.unit) : ('左轴 ' + sm.unit);
        return '<label class="lg-chk" data-v4k="' + esc(sm.key) + '">' +
          '<input type="checkbox" data-v4s="' + esc(sm.key) + '">' +
          '<i style="background:' + v4ColorOf(sm.key) + '"></i>' +
          '<span class="lg-name">' + esc(sm.label_zh) + '</span>' +
          '<span class="lg-axis">' + esc(axisZh) + '</span>' +
          '<span class="lg-val">' + GLYPH + '</span></label>';
      }).join('');
      Array.prototype.slice.call(host.querySelectorAll('input[data-v4s]'))
        .forEach(function(cb){
          cb.addEventListener('change', function(){
            V4_CHK[cb.getAttribute('data-v4s')] = cb.checked;
            if(cur) drawV4(cur);
          });
        });
      V4_LG_BUILT = true;
    }
    /* 只更新「当前定位交易日下的取值」与勾选态，绝不重建 DOM：
       重建会把正在被点击的 input 换掉，导致连点只生效第一个。 */
    Array.prototype.slice.call(host.querySelectorAll('.lg-chk'))
      .forEach(function(lb){
        var key = lb.getAttribute('data-v4k') || '';
        var on = V4_CHK[key] === true;
        var cb = lb.querySelector('input[type=checkbox]');
        if(cb && cb.checked !== on) cb.checked = on;
        if(on){ lb.classList.add('on'); } else { lb.classList.remove('on'); }
        var v = v4ValueAt(key, V4_SEL);
        var sv = lb.querySelector('.lg-val');
        if(sv){
          sv.textContent = (v === null || v === undefined) ? GLYPH
                         : (key === 'QFQ_CLOSE' ? ('¥ ' + fmt(v, 2)) : fmt(v, 2));
        }
      });
  }

  function v4SetNote(msg){
    var n = el('v4-range-note');
    if(!n) return;
    n.hidden = !msg;
    n.textContent = msg || '';
  }
  function v4RangeStatus(){
    var s = el('v4-range-status');
    if(!s) return;
    var rs = V4RANGE || {s: 0, e: dates.length - 1};
    var parts = ['区间 ' + (dates[rs.s] || GLYPH) + ' ~ ' + (dates[rs.e] || GLYPH) +
                 ' · ' + (rs.e - rs.s + 1) + ' 个交易日'];
    V4_SM.forEach(function(sm){
      var ek = (sm.key === 'QFQ_CLOSE') ? 'QFQ_CLOSE_EARLIEST_DATE'
                                        : (sm.key + '_EARLIEST_LEGAL_DATE');
      parts.push(sm.label_zh + ' 起 ' + (V4_EARLIEST[ek] || GLYPH));
    });
    s.textContent = parts.join(' · ');
  }
  function v4HoverStatus(){
    var hs = el('v4-hover-status');
    if(!hs) return;
    hs.textContent = '定位交易日 ' + (V4_SEL || GLYPH) +
      (V4_HOVER ? ' · 十字线交易日 ' + V4_HOVER : ' · 十字线未悬停');
  }

  /* ISSUE-06 —— 单日定位：非交易日显式回退并提示，绝不静默换日。 */
  function v4Locate(){
    var v = (el('v4-single-date') || {}).value || '';
    if(!v){ v4SetNote('请先选择要定位的日期。'); return; }
    var t = prevTradingDate(v);
    if(!t){ v4SetNote(v + ' 早于最早交易日 ' + (dates[0] || GLYPH) + '，无法定位。'); return; }
    V4_SEL = t;
    v4SetNote((t === v) ? ('已定位到交易日 ' + t + '。')
                        : (v + ' 不是交易日，已回退到不晚于该日的最近交易日 ' + t + '。'));
    if(cur) drawV4(cur);
  }
  /* ISSUE-06 —— 区间选择：from / to 各自回退；from > to 显式报错，
     绝不静默反转（G06：静默反转会把「用户填反了」这件事藏起来）。 */
  function v4ApplyRange(){
    var a = (el('v4-hist-start') || {}).value || '';
    var b = (el('v4-hist-end') || {}).value || '';
    if(!a || !b){ v4SetNote('请同时填写区间开始与区间结束。'); return; }
    /* RC V3 / F008 —— 开始 next-or-equal，结束 previous-or-equal。 */
    var ta = nextTradingDate(a), tb = prevTradingDate(b);
    if(!ta){ v4SetNote(a + ' 晚于最新交易日 ' + (dates[dates.length-1] || GLYPH) +
                       '，区间内没有任何交易日。'); return; }
    if(!tb){ v4SetNote(b + ' 早于最早交易日 ' + (dates[0] || GLYPH) + '，无法定位。'); return; }
    if(ta > tb){
      /* 空区间显式校验：绝不偷偷交换 Start / End（G06）。 */
      v4SetNote('空区间校验失败：解析后开始（' + ta + '）晚于结束（' + tb +
                '），该区间内不存在交易日。已显式报错，不做静默反转，请修正后再应用。');
      V4RANGE = null;
      if(cur) drawV4(cur);
      return;
    }
    V4RANGE = {s: dates.indexOf(ta), e: dates.indexOf(tb)};
    var msg = [];
    if(ta !== a) msg.push(a + ' → ' + ta);
    if(tb !== b) msg.push(b + ' → ' + tb);
    msg.push('区间已应用。');
    v4SetNote(msg.join('；'));
    if(cur) drawV4(cur);
  }
  function v4ResetRange(){
    V4RANGE = null;
    v4SetNote('');
    if(cur) drawV4(cur);
  }

  /* ---------- ⑥ 综合研判（I01..I10） ---------- */
  function renderV4Judgment(d){
    var jd = ((days[d] || {}).judgment) || {};
    var ul = function(arr){
      return (arr && arr.length)
        ? arr.map(function(x){ return '<li>' + esc(x) + '</li>'; }).join('')
        : '<li>' + GLYPH + '</li>';
    };
    var pe = el('v4-j-pos'), ne = el('v4-j-neg'), ce = el('v4-j-concl');
    if(pe) pe.innerHTML = ul(jd.positive);
    if(ne) ne.innerHTML = ul(jd.negative);
    if(ce) ce.textContent = jd.conclusion || GLYPH;
    /* G11 —— 「生成方式 / 运行期大模型调用 / 契约 ID / 不含买卖建议」等
       工程与治理说明不再作为 Current User-visible 文案输出。
       内部事实（LLM_RUNTIME_CALLS = 0 / OVERALL_SCORE = FORBIDDEN /
       BUY_SELL_ADVICE = 0）仍然成立，只是不再向 Public User 展示。 */
  }

  /* ---------- ⑦ 评分区间收益验证（PART A ~ PART K） ----------
   * 互斥 Score Band：两个维度完全同一套 10 个区间
   *   0-10 / 11-20 / ... / 91-100（[0,10] (10,20] ... (90,100]，完整精度）
   * 全部由 Python（rc7_band.py + rc7_payload.py）预计算落盘，
   * 浏览器只做 render，一律取 *_display 字符串，
   * 绝不自己分组、算收益 / 中位 / 胜率 / 回撤（BROWSER_BUSINESS_RECALC = 0）。 */
  function renderV4BandTable(hostId, blk){
    var host = el(hostId);
    if(!host) return;
    var rows = (blk || {}).rows || [];
    if(!rows.length){
      host.innerHTML = '<div class="mod-partial">暂无评分区间收益验证产物。</div>';
      return;
    }
    host.innerHTML = '<table class="thr-table"><thead><tr>' +
      '<th>评分区间</th><th>样本数</th><th>已完成</th><th>待成熟</th>' +
      '<th>平均收益</th><th>中位数收益</th><th>胜率</th><th>最大回撤</th>' +
      '<th>最近信号日</th><th>最近成熟日</th>' +
      '</tr></thead><tbody>' + rows.map(function(r){
        return '<tr>' +
          '<td class="mono">' + esc(r.band_label) + '</td>' +
          '<td class="mono">' + esc(r.signal_count == null ? GLYPH : r.signal_count) + '</td>' +
          '<td class="mono">' + esc(r.completed_count == null ? GLYPH : r.completed_count) + '</td>' +
          '<td class="mono">' + esc(r.pending_count == null ? GLYPH : r.pending_count) + '</td>' +
          '<td class="mono">' + esc(r.mean_return_display || GLYPH) + '</td>' +
          '<td class="mono">' + esc(r.median_return_display || GLYPH) + '</td>' +
          '<td class="mono">' + esc(r.win_rate_display || GLYPH) + '</td>' +
          '<td class="mono">' + esc(r.maximum_drawdown_display || GLYPH) + '</td>' +
          '<td class="mono">' + esc(r.last_signal_date || GLYPH) + '</td>' +
          '<td class="mono">' + esc(r.last_matured_signal_date || GLYPH) + '</td>' +
          '</tr>';
      }).join('') + '</tbody></table>';
  }
  function renderV4ScoreBand(){
    renderV4BandTable('v4-band-pl', V4_BAND.PRICE_LOCATION);
    renderV4BandTable('v4-band-mc', V4_BAND.MARKET_CONFIRMATION);
  }

  /* A18 —— P01 修订块（Pre-Phase5 R1 研究轮次解释 + 阈值口径 + PIT 工程说明）
     属于 PART H 明确清理对象，本轮从 Current User-visible DOM 移除。
     Quality 柱的 17 个成员（含 P01 净息差）与其 Raw Value / 日期照常显示。 */

  function renderV4(d){
    var day = days[d] || null;
    if(!day && typeof window.__CMB_REQUEST_DAY__ === 'function'){
      window.__CMB_REQUEST_DAY__(d);
    }
    var pl = (day && day.pillars) || {};

    /* ① 五柱总览卡 —— 只替换 V2 hero 的位置，不新增综合分 */
    el('v4-pillar-grid').innerHTML = V4P.map(function(pm){
      var b = pl[pm.pillar] || {};
      var ok = (b.status === 'FULLY_AVAILABLE' && b.score !== null && b.score !== undefined);
      var tone = ok ? scoreTone(b.score, 100) : 'unavailable';
      return '<div class="kpi-card" data-pillar="' + esc(pm.pillar) + '">' +
        '<div class="kpi-label">' + esc(pm.label_zh) + '</div>' +
        '<span class="kpi-value ' + toneTextCls(tone) + '">' +
          (ok ? fmt(b.score, 2) : GLYPH) + '</span>' +
        '<div class="kpi-sub">满分 100 · ' +
          (ok ? '完整可用' : (STATUS_CN[b.status] || '非完整可用')) + '</div>' +
        '<div class="score-bar-wrap"><i class="score-bar-fill" style="width:' +
          (ok ? barWidth(b.score, 100).toFixed(2) : 0) + '%"></i></div>' +
        '</div>';
    }).join('');

    /* ② 第二主视觉 = 前瞻状态 + Risk Overlay（都不产分数） */
    var f = (day && day.forward) || {};
    el('v4-fwd-state').innerHTML =
      '<span class="chip c-' + esc(f.state || 'INSUFFICIENT_EVIDENCE') + '">' +
      (ST[f.state] || '证据不足') + '</span>';
    el('v4-fwd-meta').innerHTML =
      '<div class="kpi-sub">置信度 ' + esc(f.confidence_display || GLYPH) + '</div>' +
      '<div class="kpi-rate">' + esc(f.note_zh || '') + '</div>' +
      (f.reason ? '<div class="mod-partial">' + esc(f.reason) + '</div>' : '');
    var ro = (day && day.risk_overlay) || {};
    el('v4-ro-score').textContent = (ro.net_score === null || ro.net_score === undefined)
      ? GLYPH : fmt(ro.net_score, 2);
    el('v4-ro-meta').innerHTML =
      '<div class="kpi-sub">' + esc(STATUS_CN[ro.status] || ro.status || GLYPH) + '</div>' +
      '<div class="kpi-rate">区间 ' + esc(ro.range || '0..-20') + ' · 不并入任何柱' +
        (ro.applied_to_pillars ? '' : ' · 未作用于柱') + '</div>' +
      '<div class="kpi-rate">缺失不补 0：' +
        (ro.zero_fill ? '是（违规）' : '否') + '</div>' +
      ((ro.missing_fields || []).length
        ? '<div class="mod-partial">缺失字段：' +
          esc((ro.missing_fields || []).join('、')) + '（缺失不补 0）</div>' : '');

    /* ③ 五柱明细 —— 每一项都可回溯到自己的输入 */
    el('v4-pillar-blocks').innerHTML = V4P.map(function(pm){
      var b = pl[pm.pillar] || {}, mm = V4M[pm.pillar] || {};
      var ok = b.status === 'FULLY_AVAILABLE';
      var h = [];
      h.push('<div class="mod-block" data-pillar="' + esc(pm.pillar) + '">');
      h.push('<div class="section-label mod-title"><span>' + esc(pm.label_zh) + '</span>' +
        '<span class="mod-max">· 100 分</span>' +
        /* PART B / PART C / D / E —— 用户可见的是「展示政策标识」。
           旧的 finalist 标识（VA0_PURE_EQUAL_3_FACTOR / PL1_..._EQUAL /
           MC1_DECOUPLED_ARITHMETIC）出现在指纹绑定的 CONTRACT V3 里，属
           Fingerprint-bound Contract Identifier：内部兼容保留，但不再下发、
           也不再渲染，避免用户看到与真实冻结权重矛盾的旧口径。 */
        '<span class="mod-count">' +
        esc(pm.display_policy_label || pm.display_policy_id || pm.finalist || '') +
        '</span></div>');
      h.push('<div class="mod-subtotal"><span class="st-label">' +
        esc(pm.formula_zh || pm.note_zh || '') + '</span>' + '</span>' +
        '<span class="st-value ' + toneTextCls(ok ? scoreTone(b.score, 100)
                                                  : 'unavailable') + '">' +
        (ok ? fmt(b.score, 2) : GLYPH) + ' / 100</span></div>');
      h.push('<div class="mod-bar"><div class="score-bar-wrap">' +
        '<i class="score-bar-fill" style="width:' +
        (ok ? barWidth(b.score, 100).toFixed(2) : 0) + '%"></i></div></div>');
      /* H01 / H02 —— 价格位置 / 市场确认的可解释性说明 */
      if(pm.explain_zh){
        h.push('<div class="research-note">' + esc(pm.explain_zh) + '</div>');
      }
      if(pm.pillar === 'MACRO' && b.cn10y){
        h.push('<div class="score-row"><div class="score-row-head">' +
          '<span class="score-row-label">10 年期国债收益率</span>' +
          '<span class="score-row-score">' + esc(b.cn10y.raw_pp_display) + '</span></div>' +
          /* F004 —— "as of / staleness" 工程英文改为中文用户文案 */
          '<div class="score-row-meta"><span class="raw">数据日期 ' +
          esc(b.cn10y.asof || GLYPH) + '</span><span>数据时效：距最新数据 ' +
          esc(b.cn10y.staleness_td === null ? GLYPH : b.cn10y.staleness_td) +
          ' 个交易日</span></div>' +
          '<div class="mod-partial">' + esc(b.cn10y.saturation_note_zh || '') +
          '</div></div>');
      }
      var mems = b.members || [];
      /* PART C / D / E —— 三柱的旧 member 行已从 payload 移除；只有当真正
         还有 member 时才画明细区，避免留下「该交易日无逐项明细」的空壳行。 */
      if(mems.length){
      h.push('<div class="mod-metrics">' + mems.map(function(m){
        var meta = mm[m.id] || {}, mx = meta.max;
        var has = (m.score !== null && m.score !== undefined);
        var tone = has ? toneOf(m.score, mx === null || mx === undefined ? 100 : mx,
                                m.status) : 'unavailable';
        /* C03 —— 有量程就画进度条（0~100 分数与标准化子分都有量程）；
           C04 —— 原始值只显示数字，绝不给它伪造进度条。 */
        return '<div class="score-row">' +
          '<div class="score-row-head"><span class="score-row-label">' + esc(m.id) +
          ' · ' + esc(meta.name || m.id) + '</span>' +
          '<span class="score-row-score ' + toneTextCls(tone) + '">' +
          (has ? fmt(m.score, 2) : GLYPH) +
          ((mx === null || mx === undefined) ? '' : ' / ' + fmt(mx, 2)) +
          '</span></div>' +
          ((mx === null || mx === undefined) ? '' :
            '<div class="score-bar-wrap"><i class="score-bar-fill" style="width:' +
            (has ? barWidth(m.score, mx).toFixed(2) : 0) + '%"></i></div>') +
          '<div class="score-row-meta"><span class="raw">' +
          esc(v4RawLabel(pm.pillar, m.id)) + ' ' +
          esc(v4RawText(pm.pillar, m.id, m.raw)) +
          /* PART H —— Quality 的 Raw Value 后面必须带数据所属日期 */
          esc(pm.pillar === 'QUALITY' ? v4QualityDateSuffix(b, m.id) : '') + '</span>' +
          '<span>' + statusPill(m.status) + '</span></div></div>';
      }).join('') + '</div>');
      }
      /* RC V5 / PART F —— 三柱的组成指标明细（与 Quality 同一套组件化结构）。
         G01 / G03 / G05 —— 内部权重政策 ID 不再作为用户可见文案输出。 */
      if(pm.pillar === 'VALUATION' || pm.pillar === 'PRICE_LOCATION' ||
         pm.pillar === 'MARKET_CONFIRMATION'){
        h.push(v4ComponentRows(b));
      }
      h.push('</div>');
      return h.join('');
    }).join('');

    el('v4-day-status').textContent = '可查询交易日 ' + dates.length + ' 个 · 起始 ' +
      (dates[0] || GLYPH) + ' · 截止 ' + (dates[dates.length - 1] || GLYPH) +
      ' · 当前 ' + d;
    /* G08 / G09 / G10 / PART H —— 数据来源 / 运行期实现 / 前复权技术说明 /
       Macro 饱和说明均属内部工程文案，不再写入用户可见 DOM。 */
    /* ⑥ —— 综合研判正文（Positive / Negative / Conclusion）继续保留。 */
    renderV4Judgment(d);
    /* RC V9 / ARCH B —— 只读质量诊断层（失败即闭门，不影响上面任何内容）。 */
    renderV4Diagnostic();
  }

  /* =========================================================================
   * RC V9 / ARCH B —— 质量诊断（READ-ONLY DIAGNOSTIC LAYER）
   *
   * PART AI —— 所有 Peer Median / Percentile / Rank / Moat / Regime /
   *            Attribution / Top Drivers 全部由 Python 预计算；本函数只做
   *            fetch 结果的 render / filter，绝不重算（recalc count = 0）。
   * PART AE —— 不产出第二个 100 分；唯一正式质量分仍在五柱总览里。
   * PART AK —— 诊断数据不可用时显示「数据暂不可用」，不得用旧数据冒充。
   * PART AG —— 不可比不是缺陷：只说「暂不横向排名」，不暴露 Provider / API /
   *            Gate 编号等工程术语。
   * ======================================================================= */
  /* PART AI —— 诊断数字同样由 Python 预计算展示串（payload.display_map_diag），
     浏览器只做「精确字符串查表」，绝不 toFixed / Math.round，
     失配计入 __CMB_DIAG_FMT_MISS__（门禁要求恒为 0）。 */
  window.__CMB_DIAG_FMT_MISS__ = {count: 0, keys: {}};
  var DIAG_DMAP = {};
  function diagLoadMap(){
    DIAG_DMAP = (DATA && DATA.quality_diagnostic_data &&
                 DATA.quality_diagnostic_data.display_map_diag) || {};
  }
  function diagNum(v, dp){
    if(v === null || v === undefined || v === '') return GLYPH;
    var d = (dp === undefined ? 2 : dp);
    var k = String(v) + '|' + d;
    var s = DIAG_DMAP[k];
    if(s === undefined){
      var m = window.__CMB_DIAG_FMT_MISS__;
      m.count++; m.keys[k] = 1;
      s = DIAG_DMAP[String(Number(v)) + '|' + d];
    }
    return (s === undefined) ? GLYPH : s;
  }
  function diagChip(label, value){
    return '<div class="kpi-card diag-chip"><div class="kpi-label">' +
      esc(label) + '</div><div class="kpi-rate">' + value + '</div></div>';
  }
  function diagRow(cells){
    return '<div class="diag-row">' + cells.map(function(c){
      return '<span>' + c + '</span>';
    }).join('') + '</div>';
  }

  /* =====================================================================
   * RC V11 / F002 —— Diagnostic Payload 全链路 Fail Closed
   *   DIAG_VALIDATE_V2 = CANONICAL_IDENTITY + STRICT_SCHEMA
   *                    + CROSS_FIELD_CONSISTENCY + FAIL_CLOSED
   *
   * 浏览器只做 VALIDATE / FETCH / RENDER / FILTER：
   *   不重算 peer median、rank、percentile、quartile、coverage、attribution
   *   （BROWSER_DIAGNOSTIC_BUSINESS_RECALC_COUNT = 0）。
   * 顶层 / nested / 预期身份 三者任意冲突 -> 整个诊断 UNAVAILABLE，
   *   不做部分展示、不做自动修正、不做降级显示。
   * 正式五柱与 Quality 17 成员不受诊断校验影响。
   * ===================================================================== */
  var DIAG_VALIDATOR_VERSION = 'DIAG_VALIDATE_V2_RC11_F002';

  /* ---- 冻结的合法枚举集合（取自 Diagnostic Contract V1，浏览器不扩展）---- */
  var DIAG_LEGAL = {
    metric_ids: ['P01','P02','P03','P04','P05','P06',
                 'A01','A02','A03','A04','A05','A06',
                 'F01','F02','F03','F04','D02'],
    coverage_status: ['SUFFICIENT','INSUFFICIENT_COVERAGE','NOT_APPLICABLE',
                      'NOT_COMPARABLE','INSUFFICIENT_COMPARABLE_PEERS'],
    comparability_status: ['COMPARABLE','NOT_APPLICABLE','NOT_COMPARABLE',
                           'NOT_COMPARABLE__METHOD_UNKNOWN',
                           'NOT_COMPARABLE__SCOPE_UNKNOWN',
                           'NOT_COMPARABLE__REQUIREMENT_UNKNOWN'],
    comparability_detail: ['SAME_DEFINITION','COMPARABLE_WITH_NORMALIZATION',
                           'COMPARABLE_WITH_METHOD_DISCLOSURE','NOT_APPLICABLE'],
    moat_status: ['MOAT_WIDENING','MOAT_STABLE','MOAT_NARROWING','UNVERIFIED'],
    evidence_strength: ['HIGH','MEDIUM','NOT_APPLICABLE','NOT_COMPARABLE'],
    direction: ['higher','lower'],
    group: ['PROFITABILITY_OPERATING','ASSET_QUALITY_RISK',
            'CAPITAL_FUNDING_MOAT','SHAREHOLDER_POLICY'],
    regime_status: ['PUBLISHED','INSUFFICIENT_COVERAGE'],
    regime_class: ['STRONG_TAILWIND','TAILWIND','NEUTRAL_MIXED',
                   'HEADWIND','STRONG_HEADWIND'],
    relative_aggregate_status: ['PUBLISHED','NOT_PUBLISHED_INSUFFICIENT_COVERAGE',
                                'SUPPRESSED','SUPPRESSED__INSUFFICIENT_COVERAGE'],
    admission_status: ['ADMITTED','NOT_ADMITTED_PRE_PUBLICATION'],
    period_keys: ['SINCE_2021_BASELINE','LAST_3_YEARS','LAST_1_YEAR'],
    unit: ['%','个百分点','政策分']
  };
  var DIAG_ABSOLUTE_QUALITY_MAX = 100;
  var DIAG_EXPECTED_METRIC_COUNT = 17;
  var DIAG_STALENESS_RULE = 'PAYLOAD_IDENTITY_MISMATCH__NOT_CALENDAR_AGE';
  var DIAG_SHA_RE = /^[0-9a-f]{64}$/;

  function _dgNum(x){ return typeof x === 'number' && isFinite(x); }
  function _dgStr(x){ return typeof x === 'string' && x.length > 0; }
  function _dgIn(v, set){ return typeof v === 'string' && set.indexOf(v) >= 0; }
  function _dgNumOrNull(x){
    return (x === null || x === undefined) ? true : _dgNum(x);
  }
  function _dgHas(x){ return x !== undefined && x !== null; }
  function _dgBad(r){
    return {ok:false, reason:r, policy:DIAG_VALIDATOR_VERSION};
  }

  function diagValidate(d, view){
    if(!d || typeof d !== 'object' || Array.isArray(d)){
      return _dgBad('EMPTY_OR_NOT_OBJECT');
    }
    var exp = (view && view.quality_diagnostic) || {};
    var id  = d.payload_identity;

    /* ---------- 1. STRICT_SCHEMA：必需字段 ---------- */
    var REQ = ['schema','payload_identity','model_id','rc_id','model_fingerprint',
               'as_of','payload_version','model_contract_version',
               'diagnostic_contract_id','diagnostic_contract_sha256',
               'diagnostic_payload_sha256','diagnostic_architecture',
               'absolute_quality','peer_metrics','banking_regime','attribution',
               'coverage_metadata','display_map_diag','relative_aggregate_gate',
               'source_freshness','industry_aggregate_trace','fail_closed',
               'unverified_metrics'];
    for(var i=0;i<REQ.length;i++){
      if(!_dgHas(d[REQ[i]])){ return _dgBad('MISSING_FIELD:' + REQ[i]); }
    }
    if(!id || typeof id !== 'object' || Array.isArray(id)){
      return _dgBad('MISSING_FIELD:payload_identity');
    }
    var REQ_ID = ['model_id','model_fingerprint','diagnostic_contract_id',
                  'schema_version','release_candidate_id','as_of','report_period',
                  'payload_version','model_contract_version','staleness_rule'];
    for(var i2=0;i2<REQ_ID.length;i2++){
      if(!_dgHas(id[REQ_ID[i2]])){
        return _dgBad('MISSING_IDENTITY_FIELD:' + REQ_ID[i2]);
      }
    }

    /* ---------- 2. CANONICAL_IDENTITY：顶层 == nested == 预期 ---------- */
    var IDENT = [
      ['model_id','model_id','model_id','expected_model_id','MODEL_ID_MISMATCH'],
      ['rc_id','rc_id','release_candidate_id','expected_release_candidate_id',
       'RELEASE_CANDIDATE_ID_MISMATCH'],
      ['model_fingerprint','model_fingerprint','model_fingerprint',
       'expected_model_fingerprint','FINGERPRINT_MISMATCH'],
      ['diagnostic_contract_id','diagnostic_contract_id','diagnostic_contract_id',
       'expected_diagnostic_contract_id','DIAGNOSTIC_CONTRACT_ID_MISMATCH'],
      ['schema_version','schema','schema_version',
       'expected_diagnostic_schema_version','SCHEMA_VERSION_MISMATCH'],
      ['as_of','as_of','as_of','expected_diagnostic_as_of',
       'STALE_IDENTITY_AS_OF_MISMATCH'],
      ['payload_version','payload_version','payload_version',
       'expected_payload_version','PAYLOAD_VERSION_MISMATCH'],
      ['model_contract_version','model_contract_version','model_contract_version',
       'expected_model_contract_version','MODEL_CONTRACT_VERSION_MISMATCH']
    ];
    for(var k=0;k<IDENT.length;k++){
      var top = d[IDENT[k][1]], nest = id[IDENT[k][2]], want = exp[IDENT[k][3]];
      var rs = IDENT[k][4];
      if(!_dgHas(top))  { return _dgBad('MISSING_TOP_LEVEL_IDENTITY:' + rs); }
      if(!_dgHas(nest)) { return _dgBad('MISSING_NESTED_IDENTITY:' + rs); }
      /* F002 核心：顶层与 nested 任意冲突 -> 整个诊断不可用 */
      if(top !== nest){ return _dgBad('TOP_LEVEL_VS_NESTED_IDENTITY_CONFLICT:' + rs); }
      if(_dgHas(want) && want !== '' && top !== want){ return _dgBad(rs); }
    }
    if(_dgStr(exp.expected_diagnostic_period) &&
       id.report_period !== exp.expected_diagnostic_period){
      return _dgBad('STALE_IDENTITY_PERIOD_MISMATCH');
    }
    if(_dgStr(exp.expected_diagnostic_architecture) &&
       d.diagnostic_architecture !== exp.expected_diagnostic_architecture){
      return _dgBad('DIAGNOSTIC_ARCHITECTURE_MISMATCH');
    }
    if(!DIAG_SHA_RE.test(String(d.diagnostic_contract_sha256))){
      return _dgBad('DIAGNOSTIC_CONTRACT_SHA_MALFORMED');
    }
    if(!DIAG_SHA_RE.test(String(d.diagnostic_payload_sha256))){
      return _dgBad('DIAGNOSTIC_PAYLOAD_SHA_MALFORMED');
    }
    /* 过期判定只比身份，绝不按自然日年龄 */
    if(id.staleness_rule !== DIAG_STALENESS_RULE){
      return _dgBad('STALENESS_RULE_MISMATCH');
    }

    /* ---------- 3. 正式绝对质量（唯一 Quality 100） ---------- */
    var aq = d.absolute_quality;
    if(!aq || typeof aq !== 'object' || Array.isArray(aq)){
      return _dgBad('ABSOLUTE_QUALITY_NOT_OBJECT');
    }
    if(!_dgNum(aq.score)){ return _dgBad('ABSOLUTE_QUALITY_NOT_NUMERIC'); }
    if(aq.score < 0 || aq.score > DIAG_ABSOLUTE_QUALITY_MAX){
      return _dgBad('ABSOLUTE_QUALITY_OUT_OF_RANGE');
    }
    if(aq.max !== DIAG_ABSOLUTE_QUALITY_MAX){
      return _dgBad('ABSOLUTE_QUALITY_MAX_MISMATCH');
    }
    if(aq.role !== 'FORMAL_ABSOLUTE_QUALITY_SCORE'){
      return _dgBad('ABSOLUTE_QUALITY_ROLE_MISMATCH');
    }

    /* ---------- 4. 诊断失败不得阻断正式得分 ---------- */
    var fc = d.fail_closed || {};
    if(fc.diagnostic_failure_blocks_formal_score !== false){
      return _dgBad('FAIL_CLOSED_CONTRACT_VIOLATION');
    }

    /* ---------- 5. coverage_metadata ---------- */
    var cm = d.coverage_metadata;
    if(!cm || typeof cm !== 'object' || Array.isArray(cm)){
      return _dgBad('COVERAGE_METADATA_NOT_OBJECT');
    }
    if(!_dgNum(cm.primary_universe_n) || cm.primary_universe_n < 1){
      return _dgBad('PRIMARY_UNIVERSE_N_INVALID');
    }
    var minP = _dgNum(cm.min_peers) ? cm.min_peers : 6;
    var minC = _dgNum(cm.min_coverage_pct) ? cm.min_coverage_pct : 70;
    if(!_dgNum(cm.peer_future_leak_count) || cm.peer_future_leak_count !== 0){
      return _dgBad('PEER_FUTURE_LEAK');
    }
    if(!_dgStr(cm.pit_rule) || !_dgStr(cm.same_period_rule)){
      return _dgBad('PIT_RULE_MISSING');
    }

    /* ---------- 6. peer_metrics：枚举 / 数值 / 交叉一致性 ---------- */
    var pm = d.peer_metrics;
    if(!Array.isArray(pm) || !pm.length){ return _dgBad('PEER_METRICS_EMPTY'); }
    if(pm.length !== DIAG_EXPECTED_METRIC_COUNT){
      return _dgBad('PEER_METRIC_COUNT_MISMATCH');
    }
    var seen = {}, asOf = id.as_of, repP = id.report_period;
    for(var a=0;a<pm.length;a++){
      var m = pm[a] || {};
      var mid = m.metric_id;
      if(!_dgIn(mid, DIAG_LEGAL.metric_ids)){
        return _dgBad('ILLEGAL_METRIC_ID:' + String(mid));
      }
      if(seen[mid]){ return _dgBad('DUPLICATE_METRIC_ID:' + mid); }
      seen[mid] = 1;
      if(!_dgIn(m.coverage_status, DIAG_LEGAL.coverage_status)){
        return _dgBad('ILLEGAL_COVERAGE_STATUS:' + mid);
      }
      if(!_dgIn(m.comparability_status, DIAG_LEGAL.comparability_status)){
        return _dgBad('ILLEGAL_COMPARABILITY_STATUS:' + mid);
      }
      if(_dgHas(m.comparability_detail) &&
         !_dgIn(m.comparability_detail, DIAG_LEGAL.comparability_detail)){
        return _dgBad('ILLEGAL_COMPARABILITY_DETAIL:' + mid);
      }
      if(!_dgIn(m.moat_status, DIAG_LEGAL.moat_status)){
        return _dgBad('ILLEGAL_MOAT_STATUS:' + mid);
      }
      if(!_dgIn(m.evidence_strength, DIAG_LEGAL.evidence_strength)){
        return _dgBad('ILLEGAL_EVIDENCE_STRENGTH:' + mid);
      }
      if(!_dgIn(m.group, DIAG_LEGAL.group)){
        return _dgBad('ILLEGAL_GROUP:' + mid);
      }
      if(_dgHas(m.direction) && !_dgIn(m.direction, DIAG_LEGAL.direction)){
        return _dgBad('ILLEGAL_DIRECTION:' + mid);
      }
      if(!_dgIn(m.unit, DIAG_LEGAL.unit)){
        return _dgBad('ILLEGAL_UNIT:' + mid);
      }
      /* 同报告期 */
      if(_dgStr(m.report_period) && m.report_period !== repP){
        return _dgBad('PEER_REPORT_PERIOD_MISMATCH:' + mid);
      }
      /* PIT：不得使用尚未公开的数据 */
      if(_dgStr(m.available_from) && m.available_from > asOf){
        return _dgBad('PEER_FUTURE_TRACE:' + mid);
      }
      if(_dgStr(m.industry_aggregate_available_from) &&
         m.industry_aggregate_available_from > asOf){
        return _dgBad('INDUSTRY_FUTURE_TRACE:' + mid);
      }
      /* 数据期不得被当成公开发布日 */
      if(_dgHas(m.industry_aggregate_data_period) &&
         _dgHas(m.industry_aggregate_official_publication_date) &&
         m.industry_aggregate_data_period ===
           m.industry_aggregate_official_publication_date){
        return _dgBad('DATA_PERIOD_REUSED_AS_PUBLICATION_DATE:' + mid);
      }
      var nv = m.n_valid, cp = m.coverage_pct;
      if(!_dgNumOrNull(nv)){ return _dgBad('N_VALID_NOT_FINITE:' + mid); }
      if(!_dgNumOrNull(cp)){ return _dgBad('COVERAGE_PCT_NOT_FINITE:' + mid); }
      if(_dgNum(nv) && (nv < 0 || nv > cm.primary_universe_n)){
        return _dgBad('N_VALID_OUT_OF_RANGE:' + mid);
      }
      if(_dgNum(cp) && (cp < 0 || cp > 100)){
        return _dgBad('COVERAGE_PCT_OUT_OF_RANGE:' + mid);
      }
      /* coverage 必须与 n_valid / 预期 universe 自洽，禁止宣称满覆盖却缺行 */
      if(_dgNum(nv) && _dgNum(cp)){
        var expCp = 100 * nv / cm.primary_universe_n;
        if(Math.abs(cp - expCp) > 0.5){
          return _dgBad('COVERAGE_PCT_INCONSISTENT_WITH_N_VALID:' + mid);
        }
      }
      if(m.coverage_status === 'SUFFICIENT'){
        if(!_dgHas(m.cmb_value) || !_dgHas(m.peer_median) ||
           !_dgHas(m.rank) || !_dgHas(m.percentile)){
          return _dgBad('PARTIAL_SUFFICIENT_METRIC:' + mid);
        }
        if(!_dgNum(m.cmb_value) || !_dgNum(m.peer_median)){
          return _dgBad('SUFFICIENT_VALUE_NOT_FINITE:' + mid);
        }
        if(!_dgNum(nv) || nv < minP){
          return _dgBad('PEER_COUNT_BELOW_GATE:' + mid);
        }
        if(!_dgNum(cp) || cp < minC){
          return _dgBad('COVERAGE_PCT_BELOW_GATE:' + mid);
        }
        if(!_dgNum(m.rank) || !_dgNum(m.percentile)){
          return _dgBad('RANK_OR_PERCENTILE_NOT_NUMERIC:' + mid);
        }
        /* rank 上界 = n_valid + 1：排序集合是「n_valid 家同行 + 招商银行」，
           渲染为「第 rank / n_valid+1」，故合法区间为 [1, n_valid+1]。
           越界（0 / 负数 / 大于排序集合人数）一律 UNAVAILABLE。 */
        if(m.rank < 1 || m.rank > nv + 1){
          return _dgBad('RANK_OUT_OF_RANGE:' + mid);
        }
        if(m.percentile < 0 || m.percentile > 100){
          return _dgBad('PERCENTILE_OUT_OF_RANGE:' + mid);
        }
        if(!_dgNumOrNull(m.peer_p25) || !_dgNumOrNull(m.peer_p75)){
          return _dgBad('QUARTILE_NOT_FINITE:' + mid);
        }
        if(_dgNum(m.peer_p25) && m.peer_p25 > m.peer_median + 1e-9){
          return _dgBad('QUARTILE_ORDER_VIOLATION_P25_GT_MEDIAN:' + mid);
        }
        if(_dgNum(m.peer_p75) && m.peer_median > m.peer_p75 + 1e-9){
          return _dgBad('QUARTILE_ORDER_VIOLATION_MEDIAN_GT_P75:' + mid);
        }
      }else{
        /* 不足覆盖 / 不可比 -> 一律不得给出排名统计 */
        if(_dgHas(m.rank)){
          return _dgBad('RANK_WITHOUT_SUFFICIENT_COVERAGE:' + mid);
        }
        if(_dgHas(m.percentile)){
          return _dgBad('PERCENTILE_WITHOUT_SUFFICIENT_COVERAGE:' + mid);
        }
      }
      /* 口径与单位必须一致：安全垫用「个百分点」，原始比率用「%」 */
      if(m.comparison_semantics === 'PUBLIC_REGULATORY_HEADROOM' &&
         m.unit !== '个百分点'){
        return _dgBad('HEADROOM_UNIT_MISMATCH:' + mid);
      }
      if(m.comparison_semantics === 'RAW_CET1' && m.unit !== '%'){
        return _dgBad('RAW_CET1_UNIT_MISMATCH:' + mid);
      }
    }
    for(var s=0;s<DIAG_LEGAL.metric_ids.length;s++){
      if(!seen[DIAG_LEGAL.metric_ids[s]]){
        return _dgBad('MISSING_PEER_METRIC_ROW:' + DIAG_LEGAL.metric_ids[s]);
      }
    }

    /* ---------- 7. relative_aggregate_gate ---------- */
    var rg = d.relative_aggregate_gate || {};
    if(!_dgIn(rg.status, DIAG_LEGAL.relative_aggregate_status)){
      return _dgBad('ILLEGAL_RELATIVE_AGGREGATE_STATUS');
    }
    if(rg.threshold_downgraded !== false){
      return _dgBad('RELATIVE_GATE_THRESHOLD_DOWNGRADED');
    }
    if(rg.status === 'PUBLISHED' && !_dgNum(rg.relative_quality_index)){
      return _dgBad('RELATIVE_INDEX_MISSING_WHILE_PUBLISHED');
    }
    if(rg.status !== 'PUBLISHED' && _dgHas(rg.relative_quality_index)){
      return _dgBad('RELATIVE_INDEX_PRESENT_WHILE_SUPPRESSED');
    }

    /* ---------- 8. banking_regime ---------- */
    var br = d.banking_regime || {};
    if(!_dgStr(br.status)){ return _dgBad('REGIME_STATUS_MISSING'); }
    if(br.is_formal_score !== false){
      return _dgBad('REGIME_MUST_NOT_BE_FORMAL_SCORE');
    }
    var rms = br.metrics;
    if(!Array.isArray(rms) || !rms.length){
      return _dgBad('REGIME_METRICS_EMPTY');
    }
    for(var b=0;b<rms.length;b++){
      var rm = rms[b] || {};
      if(!_dgIn(rm.metric_id, DIAG_LEGAL.metric_ids)){
        return _dgBad('ILLEGAL_REGIME_METRIC_ID:' + String(rm.metric_id));
      }
      if(!_dgIn(rm.status, DIAG_LEGAL.regime_status)){
        return _dgBad('ILLEGAL_REGIME_STATUS:' + rm.metric_id);
      }
      if(rm.status === 'PUBLISHED' &&
         !_dgIn(rm.regime_classification, DIAG_LEGAL.regime_class)){
        return _dgBad('ILLEGAL_REGIME_CLASSIFICATION:' + rm.metric_id);
      }
    }

    /* ---------- 9. attribution（成员合法 + 自洽） ---------- */
    var at = d.attribution || {};
    var per = at.periods || {};
    var pk = Object.keys(per);
    if(!pk.length){ return _dgBad('ATTRIBUTION_PERIODS_EMPTY'); }
    for(var c=0;c<pk.length;c++){
      if(DIAG_LEGAL.period_keys.indexOf(pk[c]) < 0){
        return _dgBad('ILLEGAL_ATTRIBUTION_PERIOD_KEY:' + pk[c]);
      }
      var pp = per[pk[c]] || {};
      if(pp.identity_pass !== true){
        return _dgBad('ATTRIBUTION_IDENTITY_FAIL:' + pk[c]);
      }
      if(!_dgNum(pp.quality_delta)){
        return _dgBad('ATTRIBUTION_DELTA_NOT_NUMERIC:' + pk[c]);
      }
      if(!_dgNum(pp.quality_from) || !_dgNum(pp.quality_to)){
        return _dgBad('ATTRIBUTION_ANCHOR_NOT_NUMERIC:' + pk[c]);
      }
      if(Math.abs((pp.quality_to - pp.quality_from) - pp.quality_delta) > 1e-6){
        return _dgBad('ATTRIBUTION_DELTA_INCONSISTENT:' + pk[c]);
      }
      if(pp.to_date !== asOf){
        return _dgBad('ATTRIBUTION_TO_DATE_MISMATCH:' + pk[c]);
      }
      var md = pp.member_delta || {};
      var mk = Object.keys(md);
      if(!mk.length){ return _dgBad('ATTRIBUTION_MEMBER_DELTA_EMPTY:' + pk[c]); }
      var msum = 0;
      for(var e=0;e<mk.length;e++){
        if(DIAG_LEGAL.metric_ids.indexOf(mk[e]) < 0){
          return _dgBad('ILLEGAL_ATTRIBUTION_MEMBER:' + mk[e]);
        }
        if(!_dgNum(md[mk[e]])){
          return _dgBad('ATTRIBUTION_MEMBER_NOT_NUMERIC:' + mk[e]);
        }
        msum += md[mk[e]];
      }
      if(Math.abs(msum - pp.quality_delta) > 1e-6){
        return _dgBad('ATTRIBUTION_MEMBER_SUM_INCONSISTENT:' + pk[c]);
      }
    }
    /* baseline_default 是描述性基准串（含基准日），不是周期键；
       只要求非空字符串，不得为空 / 非字符串。 */
    if(!_dgStr(at.baseline_default)){
      return _dgBad('ATTRIBUTION_BASELINE_DEFAULT_MISSING');
    }
    if(at.causal_claim !== false){
      return _dgBad('ATTRIBUTION_MUST_NOT_CLAIM_CAUSALITY');
    }
    var td = at.top_drivers || {};
    if(td.source !== 'PRECOMPUTED_PAYLOAD'){
      return _dgBad('ATTRIBUTION_DRIVER_SOURCE_NOT_PRECOMPUTED');
    }
    var sides = ['top_negative','top_positive'];
    for(var sd=0; sd<sides.length; sd++){
      var arr = td[sides[sd]] || [];
      for(var f=0;f<arr.length;f++){
        if(DIAG_LEGAL.metric_ids.indexOf(arr[f].metric_id) < 0){
          return _dgBad('ILLEGAL_ATTRIBUTION_DRIVER:' + String(arr[f].metric_id));
        }
        if(!_dgNum(arr[f].delta_earned_points)){
          return _dgBad('ATTRIBUTION_DRIVER_NOT_NUMERIC');
        }
      }
    }

    /* ---------- 10. industry_aggregate_trace（F006 准入） ---------- */
    var tr = d.industry_aggregate_trace;
    if(!Array.isArray(tr) || !tr.length){
      return _dgBad('INDUSTRY_TRACE_EMPTY');
    }
    for(var g=0;g<tr.length;g++){
      var t = tr[g] || {};
      if(!_dgIn(t.metric_id, DIAG_LEGAL.metric_ids)){
        return _dgBad('ILLEGAL_INDUSTRY_TRACE_METRIC:' + String(t.metric_id));
      }
      if(!_dgIn(t.admission_status, DIAG_LEGAL.admission_status)){
        return _dgBad('ILLEGAL_ADMISSION_STATUS:' + t.metric_id);
      }
      if(t.period_is_not_available_from !== true){
        return _dgBad('DATA_PERIOD_REUSED_AS_AVAILABLE_FROM:' + t.metric_id);
      }
      if(!_dgStr(t.official_publication_date) || !_dgStr(t.available_from)){
        return _dgBad('INDUSTRY_PUBLICATION_DATE_MISSING:' + t.metric_id);
      }
      if(t.available_from > asOf || t.official_publication_date > asOf){
        return _dgBad('INDUSTRY_FUTURE_PUBLICATION:' + t.metric_id);
      }
      if(t.admission_status !== 'ADMITTED' && _dgHas(t.value)){
        return _dgBad('PRE_PUBLICATION_VALUE_LEAK:' + t.metric_id);
      }
      if(t.pit_admissible === true && t.admission_status !== 'ADMITTED'){
        return _dgBad('ADMISSION_STATUS_INCONSISTENT:' + t.metric_id);
      }
    }

    /* ---------- 11. source_freshness ---------- */
    var sf = d.source_freshness || {};
    if(_dgStr(sf.peer_data_as_of) && sf.peer_data_as_of > asOf){
      return _dgBad('PEER_DATA_AS_OF_IN_FUTURE');
    }
    if(_dgStr(sf.industry_aggregate_available_from) &&
       sf.industry_aggregate_available_from > asOf){
      return _dgBad('INDUSTRY_AVAILABLE_FROM_IN_FUTURE');
    }
    if(_dgStr(sf.industry_aggregate_official_publication_date) &&
       sf.industry_aggregate_official_publication_date > asOf){
      return _dgBad('INDUSTRY_PUBLICATION_IN_FUTURE');
    }
    if(_dgHas(sf.industry_aggregate_period) &&
       sf.industry_aggregate_period === sf.industry_aggregate_available_from){
      return _dgBad('INDUSTRY_PERIOD_REUSED_AS_AVAILABLE_FROM');
    }

    /* ---------- 12. unverified_metrics / display_map_diag ---------- */
    var um = d.unverified_metrics;
    if(!Array.isArray(um)){ return _dgBad('UNVERIFIED_METRICS_NOT_ARRAY'); }
    for(var u=0;u<um.length;u++){
      if(DIAG_LEGAL.metric_ids.indexOf(um[u]) < 0){
        return _dgBad('ILLEGAL_UNVERIFIED_METRIC:' + String(um[u]));
      }
    }
    var dmp = d.display_map_diag;
    if(!dmp || typeof dmp !== 'object' || Array.isArray(dmp) ||
       !Object.keys(dmp).length){
      return _dgBad('DISPLAY_MAP_EMPTY');
    }

    return {ok:true, reason:null, policy:DIAG_VALIDATOR_VERSION};
  }
  window.__CMB_VALIDATE_DIAGNOSTIC__ = diagValidate;
  window.__CMB_DIAG_VALIDATOR_VERSION__ = DIAG_VALIDATOR_VERSION;
  window.__CMB_DIAG_LEGAL__ = DIAG_LEGAL;

  function renderV4Diagnostic(){
    var host1 = document.getElementById('v4-diag-chips');
    var host2 = document.getElementById('v4-diag-detail');
    if(!host1 || !host2) return;
    diagLoadMap();
    /* F002 —— 渲染前防御性复校（只校验，不重算） */
    var _vd = window.__CMB_VALIDATE_DIAGNOSTIC__
      ? window.__CMB_VALIDATE_DIAGNOSTIC__(DATA && DATA.quality_diagnostic_data, DATA)
      : {ok: !!(DATA && DATA.quality_diagnostic_data)};
    var qd = _vd.ok ? DATA.quality_diagnostic_data : null;

    /* ---- Fail-Closed（PART AK / PART AL / F002-G）---- */
    if(!qd){
      host1.innerHTML = diagChip('质量诊断', '数据暂不可用');
      host2.innerHTML = '';
      return;
    }

    var reg = qd.banking_regime || {};
    var moat = qd.moat_status || {};
    var attr = qd.attribution || {};
    var base = (attr.periods || {}).SINCE_2021_BASELINE || {};

    /* ---- 三枚摘要 chip ---- */
    host1.innerHTML =
      diagChip('行业环境', esc(reg.public_zh || GLYPH)) +
      diagChip('竞争优势', esc(moat.public_zh || GLYPH)) +
      diagChip('评分变化',
        (base.quality_delta === null || base.quality_delta === undefined)
          ? GLYPH
          : ('自 2021 基准 ' + (base.quality_delta > 0 ? '+' : '') +
             diagNum(base.quality_delta, 2)));

    /* ---- 展开区 ---- */
    var h = [];

    /* ① 变化归因 */
    h.push('<details class="diag-d"><summary>① 评分变化归因</summary>');
    h.push('<div class="diag-note">以下为「评分变化贡献」，不是因果关系判断。</div>');
    var td = attr.top_drivers || {};
    var neg = td.top_negative || [], pos = td.top_positive || [];
    h.push('<div class="diag-sub">主要负贡献</div>');
    h.push(neg.length ? neg.map(function(x){
      return diagRow([esc(x.metric_name_zh),
        (x.delta_earned_points > 0 ? '+' : '') + diagNum(x.delta_earned_points, 2)]);
    }).join('') : '<div class="diag-note">' + GLYPH + '</div>');
    h.push('<div class="diag-sub">主要正贡献</div>');
    h.push(pos.length ? pos.map(function(x){
      return diagRow([esc(x.metric_name_zh),
        (x.delta_earned_points > 0 ? '+' : '') + diagNum(x.delta_earned_points, 2)]);
    }).join('') : '<div class="diag-note">' + GLYPH + '</div>');
    var per = attr.periods || {};
    Object.keys(per).forEach(function(k){
      var p = per[k] || {};
      var nm = {'SINCE_2021_BASELINE': '自 2021 基准',
                'LAST_3_YEARS': '近三年', 'LAST_1_YEAR': '近一年'}[k] || k;
      h.push(diagRow([esc(nm),
        (p.quality_delta === null || p.quality_delta === undefined)
          ? GLYPH
          : ((p.quality_delta > 0 ? '+' : '') + diagNum(p.quality_delta, 2))]));
    });
    h.push('</details>');

    /* ② 同行比较 */
    h.push('<details class="diag-d"><summary>② 同行比较</summary>');
    h.push('<div class="diag-note">比较对象为 8 家全国性股份制商业银行；' +
           '招商银行不参与同行中位数计算。</div>');

    /* ---- F001-J —— F01 主口径 = 公开监管资本安全垫 -------------------- */
    var f01 = null;
    (qd.peer_metrics || []).forEach(function(m){
      if(m.metric_id === 'F01') f01 = m;
    });
    if(f01){
      var fh = f01.public_regulatory_headroom || {};
      var fr = f01.raw_cet1_secondary || {};
      /* RC V11 / F001 —— 安全垫主口径只有在「可比同行数量 + 覆盖率」都过闸
         时才发布；否则只公开说明为什么不发布，绝不退回 Raw CET1 冒充主排名，
         也绝不把 UNKNOWN 口径粉饰成 AVAILABLE。 */
      var hrOk = (f01.f01_peer_primary_status ===
                  'PUBLISHED_PUBLIC_REGULATORY_HEADROOM') &&
                 (fh.cmb_public_headroom !== null &&
                  fh.cmb_public_headroom !== undefined);
      h.push('<div class="diag-sub">公开监管资本安全垫</div>');
      if(hrOk){
        h.push('<div class="diag-note">资本安全垫 = 核心一级资本充足率 ' +
               '减 公开适用监管要求，单位为个百分点。</div>');
        h.push('<div class="diag-row diag-head" role="row">' +
          ['口径', '招商银行', '同行中位数', '同行位置'].map(function(t){
            return '<span role="columnheader">' + esc(t) + '</span>';
          }).join('') + '</div>');
        var fpos = (fh.peer_headroom_rank === null || fh.peer_headroom_rank === undefined)
          ? GLYPH : ('第 ' + diagNum(fh.peer_headroom_rank, 0) + ' / ' +
                     diagNum((fh.n_valid || 0) + 1, 0));
        h.push('<div class="diag-row" role="row">' +
          '<span>资本安全垫</span>' +
          '<span>' + diagNum(fh.cmb_public_headroom, 2) + ' 个百分点</span>' +
          '<span>' + diagNum(fh.peer_headroom_median, 2) + '</span>' +
          '<span>' + fpos + '</span></div>');
        h.push('<div class="diag-note">非公开的第二支柱要求与真实总监管要求' +
               '仍然未知，因此这里比较的是公开口径资本安全垫，' +
               '不是真实总监管安全垫。</div>');
      }else{
        h.push('<div class="diag-note">' +
               esc(fh.public_status_zh ||
                   '部分同行监管口径不可比，本期不提供同行排名') + '</div>');
        var exl = fh.excluded_peers || [];
        if(exl.length){
          h.push('<div class="diag-row diag-wrap">' + exl.map(function(x){
            return esc(x.bank_name_zh || x.bank) + '（' +
                   esc(x.reason_zh || '口径不可比') + '）';
          }).join(' · ') + '</div>');
        }
        h.push('<div class="diag-note">不做估算补齐，也不降低可比门槛；' +
               '因此本期不发布资本安全垫的同行中位数与排名。</div>');
        h.push('<div class="diag-note">需要说明：非公开的第二支柱要求与真实' +
               '总监管要求仍然未知，所以即使可比同行足够，这里比较的也只是' +
               '公开口径资本安全垫，不是真实总监管安全垫。</div>');
      }
      /* ---- 原始比率恒为次级参考，单位 %，绝不与安全垫混用同一根轴 ---- */
      h.push('<div class="diag-sub">原始核心一级资本充足率（次级参考）</div>');
      h.push('<div class="diag-note">各行计量方法不同（高级法 / 权重法），' +
             '原始比率不可直接比较，也不能替代上面的资本安全垫，仅作参考。</div>');
      h.push('<div class="diag-row" role="row">' +
        '<span>核心一级资本充足率</span>' +
        '<span>' + diagNum(fr.cmb_raw_cet1, 2) + ' %</span>' +
        '<span>' + diagNum(fr.peer_raw_cet1_median, 2) + '</span>' +
        '<span>' + ((fr.peer_raw_cet1_rank === null ||
                     fr.peer_raw_cet1_rank === undefined) ? GLYPH :
                    ('第 ' + diagNum(fr.peer_raw_cet1_rank, 0) + ' / ' +
                     diagNum((fr.n_valid || 0) + 1, 0))) + '</span></div>');
      /* ---- 行业口径：只有能建立真实可适用的行业监管要求栈时才显示安全垫；
             否则只显示官方原始比率 ---- */
      h.push('<div class="diag-sub">行业口径</div>');
      h.push(diagRow([esc(f01.industry_aggregate_label_zh || '商业银行（官方口径）'),
        (f01.industry_aggregate === null || f01.industry_aggregate === undefined)
          ? '行业数据在该日期尚未公开'
          : (diagNum(f01.industry_aggregate, 2) + ' %')]));
      h.push('<div class="diag-note">' +
             esc(f01.industry_headroom_note_zh ||
                 '行业口径只展示官方原始数据，不构造行业资本安全垫。') + '</div>');
    }

    var ok = (qd.peer_metrics || []).filter(function(m){
      return m.coverage_status === 'SUFFICIENT';
    });
    var ng = (qd.peer_metrics || []).filter(function(m){
      return m.coverage_status !== 'SUFFICIENT';
    });
    h.push('<div class="diag-table" role="table">');
    h.push('<div class="diag-row diag-head" role="row">' +
      ['指标', '招行', '同行中位数', '行业值', '同行位置', '优势变化'].map(function(t){
        return '<span role="columnheader">' + esc(t) + '</span>';
      }).join('') + '</div>');
    ok.forEach(function(m){
      var posTxt = (m.rank === null || m.rank === undefined)
        ? GLYPH : ('第 ' + diagNum(m.rank, 0) + ' / ' + diagNum((m.n_valid || 0) + 1, 0));
      h.push('<div class="diag-row" role="row">' +
        '<span>' + esc(m.metric_name_zh) + '</span>' +
        '<span>' + diagNum(m.cmb_value, 2) + esc(m.unit || '') + '</span>' +
        '<span>' + diagNum(m.peer_median, 2) + '</span>' +
        '<span>' + (m.industry_aggregate === null || m.industry_aggregate === undefined
                    ? GLYPH : diagNum(m.industry_aggregate, 2)) + '</span>' +
        '<span>' + posTxt + '</span>' +
        '<span>' + esc(m.moat_status_zh || GLYPH) + '</span></div>');
    });
    h.push('</div>');
    if(ng.length){
      h.push('<div class="diag-sub">暂不横向排名</div>');
      h.push('<div class="diag-note">' + esc(qd.unverified_public_zh ||
             '部分银行披露口径不同，当前不做横向排名。') + '</div>');
      h.push('<div class="diag-row diag-wrap">' + ng.map(function(m){
        return esc(m.metric_name_zh);
      }).join(' · ') + '</div>');
    }
    var rg = qd.relative_aggregate_gate || {};
    if(rg.status && rg.status !== 'PUBLISHED'){
      h.push('<div class="diag-note">同行综合总分：暂不发布' +
             '（可比指标权重占比不足，不做估算补齐）。</div>');
    }
    h.push('</details>');

    /* ③ 行业环境 */
    h.push('<details class="diag-d"><summary>③ 行业环境</summary>');
    h.push('<div class="diag-note">描述银行业共同经营环境，不参与评分。</div>');
    var grp = reg.groups_zh || {};
    Object.keys(grp).forEach(function(k){
      h.push(diagRow([esc(k), esc(grp[k])]));
    });
    h.push('<div class="diag-sub">分指标方向</div>');
    (reg.metrics || []).forEach(function(r){
      if(r.status !== 'PUBLISHED') return;
      h.push(diagRow([esc(r.metric_name_zh),
                      esc(r.regime_classification_zh || GLYPH)]));
    });
    h.push('<div class="diag-note">「股份行同行中位数」与「银行业整体」为两个不同口径，' +
           '不合并成一个数值。</div>');
    h.push('</details>');

    host2.innerHTML = h.join('');
  }

  /* ④ 五柱历史：五柱共享左轴 0~100，招商银行前复权收盘价走独立右轴（RMB）。
     缺失日显式断开，绝不前向填充；几何不随勾选变化（右轴留白恒定）。 */
  function v4Chart(){
    if(!CH.V4){
      CH.V4 = setupChart('chartV4', 46);
      if(CH.V4){
        /* ④ 专用：十字线与绘制共用缓存几何（ISSUE-07）。 */
        CH.V4._cachedGeom = true;
        CH.V4._onHover = function(dt){
          V4_HOVER = dt;
          window.__CMB_V4_HOVER_DATE__ = dt;
          v4HoverStatus();
        };
        bindCrosshair(CH.V4, [], []);
      }
    }
    return CH.V4;
  }
  function drawV4(d){
    if(!ISV4) return;
    var ch = v4Chart();
    if(!ch) return;
    var rs = V4RANGE || {s: 0, e: dates.length - 1};
    if(rs.s < 0) rs.s = 0;
    if(rs.e >= dates.length) rs.e = dates.length - 1;
    var rdates = dates.slice(rs.s, rs.e + 1);
    var se = v4Shown().map(function(x){
      x.data = (x.data || []).slice(rs.s, rs.e + 1);
      return x;
    });
    /* ISSUE-07 —— 定位日只从 master 交易日轴取，与曲线 / 图例 / Tooltip 同源 */
    var mi = dates.indexOf(V4_SEL);
    mi = (mi >= rs.s && mi <= rs.e) ? mi - rs.s : -1;
    setCrosshairSeries(ch, se, rdates);
    drawSeries(ch, rdates, se, mi, {min: 0, max: 100});
    v4Legend();
    v4RangeStatus();
    v4HoverStatus();
  }

  function v4Preset(n){
    V4RANGE = (!n || n >= dates.length) ? null
            : {s: dates.length - n, e: dates.length - 1};
    if(cur) drawV4(cur);
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
    /* V4 —— 五柱独立评分走独立渲染路径；V2 / V3 完全不受影响。 */
    if(ISV4){ renderV4(d); return; }
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
  /* padRight：只有存在右轴序列的图表（CHART-B）才为右轴刻度预留右侧留白；
   * 其余图表 PAD 逐位保持 V6 原值，几何与黄金页一致（§67 / P0-06）。 */
  function setupChart(shellId, padRight){
    var shell = el(shellId);
    if(!shell) return null;
    var cv = shell.querySelector('canvas.score-canvas');
    var cross = shell.querySelector('canvas.chart-crosshair');
    var tip = shell.querySelector('.chart-tooltip');
    if(!cv || !cross || !tip) return null;
    var ctx = cv.getContext('2d'), cctx = cross.getContext('2d');
    if(!ctx || !cctx) return null;
    var PAD = {l:44, r:(padRight ? padRight : 14), t:14, b:26};
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
    /* §7 真实双轴：左轴 = 评分，右轴 = 价格（RMB）。两条序列各自独立缩放，
     * 绝不把价格归一化到 0~100 与评分共轴（那会制造虚假视觉相关性）。 */
    var left=[], right=[];
    series.forEach(function(se){ (se.axis==='right'?right:left).push(se); });
    function vals(list){
      var o=[];
      list.forEach(function(se){ (se.data||[]).forEach(function(v){ if(v!=null) o.push(v); }); });
      return o;
    }
    var all=vals(left), allR=vals(right);
    /* RC V3 / F010 —— 固定域评分轴（min/max 由调用方显式钉死）绝不再加 padding：
       五柱轴必须严格 0 ~ 100，刻度上不允许出现 -8 或 108。
       只有自适应轴（未钉死域）才保留 8% 视觉留白。 */
    var fixedDomain = !!(opt && opt.min != null && opt.max != null);
    var mn = opt && opt.min != null ? opt.min : 0, mx = opt && opt.max != null ? opt.max : 100;
    if(!(opt && opt.min != null) && all.length){ mn = Math.min.apply(null, all); }
    if(!(opt && opt.max != null) && all.length){ mx = Math.max.apply(null, all); }
    if(mx-mn < 1e-9){ mx = mn + 1; }
    if(!fixedDomain){ var pad2 = (mx-mn)*0.08; mn -= pad2; mx += pad2; }
    var mnR = 0, mxR = 1, hasR = allR.length > 0;
    if(hasR){
      mnR = Math.min.apply(null, allR); mxR = Math.max.apply(null, allR);
      if(mxR-mnR < 1e-9){ mxR = mnR + 1; }
      var padR = (mxR-mnR)*0.08; mnR -= padR; mxR += padR;
    }
    var X = function(i){ return p.l + (labels.length<=1?0:(W*i/(labels.length-1))); };
    var Y = function(v){ return p.t + H - (H*(v-mn)/(mx-mn)); };
    var Y2 = function(v){ return p.t + H - (H*(v-mnR)/(mxR-mnR)); };
    function Yof(se){ return (se.axis==='right') ? Y2 : Y; }
    // grid（V1.1/V6 网格语义）
    ctx.strokeStyle='#e5e7eb'; ctx.lineWidth=1; ctx.font='10px sans-serif'; ctx.fillStyle='#6b7280';
    for(var gi=0; gi<=4; gi++){
      var vv = mn + (mx-mn)*gi/4, y = Math.round(Y(vv))+0.5;
      ctx.beginPath(); ctx.moveTo(p.l,y); ctx.lineTo(p.l+W,y); ctx.stroke();
      ctx.textAlign='right'; ctx.fillText(vv.toFixed(1), p.l-6, y+3);
    }
    /* 右轴刻度（价格 RMB）—— 只画在存在右轴序列的图表上，颜色跟随该序列自身。 */
    if(hasR){
      ctx.textAlign='left'; ctx.fillStyle=(right[0] && right[0].color) || PRICE_COLOR;
      for(var ri=0; ri<=4; ri++){
        var rv = mnR + (mxR-mnR)*ri/4, ry = Math.round(Y2(rv))+0.5;
        ctx.fillText(Number(rv).toFixed(1), p.l+W+6, ry+3);
      }
    }
    ctx.fillStyle='#6b7280';
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
        var x=X(i), y=Yof(se)(v);
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
        ctx.fillStyle=se.color; ctx.beginPath(); ctx.arc(xm,Yof(se)(v),3.2,0,Math.PI*2); ctx.fill();
      });
    }
    // crosshair canvas 尺寸同步
    var cg = ch.geom(ch.cross);
    ch.cctx.clearRect(0,0,cg.w,cg.h);
    ch._X = X; ch._Y = Y; ch._Y2 = hasR ? Y2 : null;
    ch._mn = mn; ch._mx = mx; ch._labels = labels;
    /* ISSUE-07 —— 十字线反查横坐标必须与绘制用的是同一套几何：
       绘图区宽高与 PAD 在这里一次性缓存，crosshair 只读缓存，绝不另算一份。 */
    ch._W = W; ch._H = H; ch._p = p; ch._n = labels.length;
  }
  /* §64 —— Tooltip 数值一律走全局数字展示契约（display_map 精确查表），
   * 浏览器绝不自算业务数字。 */
  function tipValue(se, i){
    var v = (se.data||[])[i];
    if(v==null) return GLYPH;
    /* 右轴人民币序列：只补币种符号，数值本身仍走 display_map 精确查表。 */
    if(se.money) return '¥ ' + fmt(v,2);
    var o = se.ohlc ? se.ohlc[i] : null;
    if(o && o.open!=null && o.high!=null && o.low!=null && o.close!=null){
      return '开 '+fmt(o.open,2)+' · 高 '+fmt(o.high,2)+' · 低 '+fmt(o.low,2)+' · 收 '+fmt(o.close,2);
    }
    return fmt(v,2);
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
      /* RC V3 / F009 —— 命中测试与绘图必须是同一套 Canvas 几何。
         旧代码用 shell 的 bounding rect 作为原点，而曲线用 canvas 的
         clientWidth 绘制：两者相差 shell 的 border/padding（实测 8.5px），
         于是 tooltip 与 crosshair 彼此一致（共用同一个已偏移 index），
         但选中的交易日并不是鼠标下真正画的那一天。
         现在：原点取 canvas 自己的 rect，绘图区宽度/边距直接复用
         drawSeries 结束时缓存的 _W / _p / _n，绝不另算一份。 */
      var rc = ch.cv.getBoundingClientRect();
      var cx = (e.touches ? e.touches[0].clientX : e.clientX) - rc.left;
      var p = (ch._p || ch.PAD);
      var W = (typeof ch._W === 'number') ? ch._W : (rc.width - p.l - p.r);
      var n = (typeof ch._n === 'number') ? ch._n : curLabels().length;
      var i = Math.round((cx - p.l) / (W / Math.max(1, n-1)));
      return Math.max(0, Math.min(Math.max(0, n-1), i));
    }
    function show(i){
      /* 竖直参考线一律走绘制缓存下来的 X(i)：线落在哪一天，点就落在哪一天。 */
      var g = ch.geom(ch.cross);
      var ls = curLabels(), ss = curSeries();
      ch.cctx.clearRect(0,0,g.w,g.h);
      var p = (ch._p || ch.PAD);
      var x = (typeof ch._X === 'function') ? ch._X(i)
            : (p.l + ((g.w - p.l - p.r) * i / Math.max(1, ls.length-1)));
      var y1 = (typeof ch._H === 'number') ? (p.t + ch._H) : (p.t + g.h - p.b);
      ch.cctx.strokeStyle='rgba(124,58,237,.5)'; ch.cctx.setLineDash([4,4]);
      ch.cctx.beginPath(); ch.cctx.moveTo(x,p.t); ch.cctx.lineTo(x,y1); ch.cctx.stroke();
      ch.cctx.setLineDash([]);
      if(ch._X && ch._Y){
        ss.forEach(function(se){
          var v=(se.data||[])[i]; if(v==null) return;
          /* §52 —— 下窗格序列（pane:'lower'）走独立 Y 轴，与上窗格共用 X。 */
          var yf = (se.pane==='lower' && ch._YL) ? ch._YL
                 : ((se.axis==='right' && ch._Y2) ? ch._Y2 : ch._Y);
          ch.cctx.fillStyle=se.color; ch.cctx.beginPath();
          ch.cctx.arc(x, yf(v), 3.2, 0, Math.PI*2); ch.cctx.fill();
        });
      }
      var rows = ss.map(function(se){
        return '<span>'+esc(se.name)+'：'+tipValue(se, i)+'</span>';
      }).join('');
      ch.tip.innerHTML = '<strong>'+esc(ls[i])+'</strong>'+rows;
      ch.tip.style.display = 'block';
      /* ISSUE-07 —— 悬停交易日对外只暴露一个：master 轴上的这一格日期。 */
      if(typeof ch._onHover === 'function') ch._onHover(ls[i], i);
    }
    function hide(){
      ch.cctx && ch.cctx.clearRect(0,0,ch.cross.width,ch.cross.height);
      ch.tip.style.display='none';
      if(typeof ch._onHover === 'function') ch._onHover(null, -1);
    }
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
    var pClose = [], pOhlc = [], tVal = [];
    var ps = (PRICE && PRICE.series) ? PRICE.series : null;
    var ts = (TIMING && TIMING.series) ? TIMING.series : null;
    for(var i=0;i<dates.length;i++){
      var hc=(H.core_class||[])[i]||'NONE', hi=(H.inv_class||[])[i]||'NONE';
      coreFull.push(hc==='FULL' ? (H.core_score||[])[i] : null);
      corePart.push(showPartial && hc==='PARTIAL' ? (H.core_norm||[])[i] : null);
      invFull.push(hi==='FULL' ? (H.inv_score||[])[i] : null);
      invPart.push(showPartial && hi==='PARTIAL' ? (H.inv_norm||[])[i] : null);
      /* §51 —— 精确交易日对齐；价格缺失显式 null，绝不前向填充。 */
      var o = ps ? ps[i] : null;
      if(o && o.close!=null){ pClose.push(o.close); pOhlc.push(o); }
      else { pClose.push(null); pOhlc.push(null); }
      /* §49 —— 择时参考按精确交易日对齐；窗口不足显式 null，绝不补 10。 */
      var tv = (ts && ts[i]!=null) ? ts[i] : null;
      tVal.push(tv);
    }
    return {coreFull:coreFull, corePart:corePart, invFull:invFull, invPart:invPart,
            priceClose:pClose, priceOhlc:pOhlc, timing:tVal};
  }
  /* §65 —— 图例点击 Show/Hide（不新增任何 Toolbar，保持 Visual Golden）。 */
  function hiddenSet(){
    return (CH.B && CH.B._hidden) ? CH.B._hidden : {};
  }
  function isShown(se){ return !hiddenSet()[se.key || '']; }
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
  /* §52 —— CHART-B 上窗格：投资吸引力评分（左轴 0~100，原色不变）
   *                        + 招商银行价格·前复权（右轴 RMB，颜色明显不同）。 */
  function chartBUpperSeries(s){
    var out = [
      {name:'投资吸引力评分', color:'#2563eb', data:s.invFull, key:'score'},
      {name:'研究扩展（虚线）', color:'#9ca3af', data:s.invPart, dash:true,
       width:1.2, key:'partial'}
    ];
    if(PRICE && PRICE.available && (PRICE.series||[]).length){
      out.push({name:(PRICE.label_zh || '招商银行价格·前复权'), color:PRICE_COLOR,
                data:s.priceClose, ohlc:s.priceOhlc, axis:'right', width:1.4,
                key:'price'});
    }
    return out.filter(isShown);
  }
  /* §52 —— CHART-B 下窗格：择时参考 0~20。银行级、模型中立、不参与任何评分，
   * 只用第三种不同的颜色（沿用既有绿色家族 --green #059669，不引入新设计体系）。 */
  function chartBLowerSeries(s){
    var out = [];
    if(TIMING && TIMING.available){
      out.push({name:(TIMING.label_zh || '择时参考（0~20）'), color:TIMING_COLOR,
                data:s.timing, pane:'lower', width:1.5, key:'timing'});
    }
    return out.filter(isShown);
  }
  /* §52 —— 上下双窗格共用同一 X 轴：上窗格右轴恒为 RMB（绝不把价格归一化到
   * 0~100），下窗格左轴恒为 0~20。 */
  function axisRange(list, opt){
    var o = [];
    list.forEach(function(se){ (se.data||[]).forEach(function(v){
      if(v!=null) o.push(v); }); });
    var mn = (opt && opt.min!=null) ? opt.min : (o.length?Math.min.apply(null,o):0);
    var mx = (opt && opt.max!=null) ? opt.max : (o.length?Math.max.apply(null,o):1);
    if(mx-mn<1e-9){ mx = mn + 1; }
    var pad = (mx-mn)*0.08; mn -= pad; mx += pad;
    return {mn:mn, mx:mx, has:o.length>0};
  }
  function drawSplit(ch, labels, up, lo, marker, optU, optL){
    if(!ch) return;
    var g = ch.geom(ch.cv), p = ch.PAD, ctx = ch.ctx, W = g.W, H = g.H;
    ctx.clearRect(0,0,g.w,g.h);
    ctx.fillStyle='#fff'; ctx.fillRect(0,0,g.w,g.h);
    var GAP = 26;
    var HU = Math.max(56, (H - GAP) * 0.70);
    var HL = Math.max(36, H - GAP - HU);
    var ltop = p.t + HU + GAP;
    var leftU=[], rightU=[];
    up.forEach(function(se){ (se.axis==='right'?rightU:leftU).push(se); });
    var ru = axisRange(leftU, optU), rr = axisRange(rightU, null);
    var rl = axisRange(lo, optL);
    var X = function(i){ return p.l + (labels.length<=1?0:(W*i/(labels.length-1))); };
    var YU = function(v){ return p.t + HU - (HU*(v-ru.mn)/(ru.mx-ru.mn)); };
    var YR = function(v){ return p.t + HU - (HU*(v-rr.mn)/(rr.mx-rr.mn)); };
    var YL = function(v){ return ltop + HL - (HL*(v-rl.mn)/(rl.mx-rl.mn)); };
    function Yof(se, v){
      if(se.pane==='lower') return YL(v);
      return (se.axis==='right') ? YR(v) : YU(v);
    }
    ctx.font='10px sans-serif'; ctx.lineWidth=1;
    /* ---- 上窗格网格 + 左轴（评分 0~100） ---- */
    ctx.strokeStyle='#e5e7eb'; ctx.fillStyle='#6b7280';
    for(var gi=0; gi<=4; gi++){
      var vv = ru.mn + (ru.mx-ru.mn)*gi/4, y = Math.round(YU(vv))+0.5;
      ctx.beginPath(); ctx.moveTo(p.l,y); ctx.lineTo(p.l+W,y); ctx.stroke();
      ctx.textAlign='right'; ctx.fillText(vv.toFixed(0), p.l-6, y+3);
    }
    /* ---- 上窗格右轴（价格 RMB）—— 颜色跟随价格曲线 ---- */
    if(rr.has){
      ctx.textAlign='left'; ctx.fillStyle=PRICE_COLOR;
      for(var ri=0; ri<=4; ri++){
        var rv = rr.mn + (rr.mx-rr.mn)*ri/4, ry = Math.round(YR(rv))+0.5;
        ctx.fillText(Number(rv).toFixed(1), p.l+W+6, ry+3);
      }
    }
    /* ---- 下窗格：区间分隔线（仅标注，非买卖建议）+ 网格 + 左轴 0~20 ---- */
    ctx.strokeStyle='#f3f4f6';
    [4,8,12,16].forEach(function(bv){
      var by = Math.round(YL(bv))+0.5;
      ctx.beginPath(); ctx.moveTo(p.l,by); ctx.lineTo(p.l+W,by); ctx.stroke();
    });
    ctx.strokeStyle='#e5e7eb'; ctx.fillStyle='#6b7280';
    for(var li2=0; li2<=4; li2++){
      var lv = rl.mn + (rl.mx-rl.mn)*li2/4, ly = Math.round(YL(lv))+0.5;
      ctx.beginPath(); ctx.moveTo(p.l,ly); ctx.lineTo(p.l+W,ly); ctx.stroke();
      ctx.textAlign='right'; ctx.fillText(lv.toFixed(0), p.l-6, ly+3);
    }
    ctx.fillStyle=TIMING_COLOR; ctx.textAlign='left';
    ctx.fillText('择时参考 0~20 · 价格区间位置 · 银行级 · 不参与评分',
                 p.l+2, ltop-7);
    /* ---- X 轴（两个窗格共用） ---- */
    ctx.fillStyle='#6b7280'; ctx.textAlign='center';
    var step = Math.max(1, Math.floor(labels.length/6));
    for(var xi=0; xi<labels.length; xi+=step){
      ctx.fillText(labels[xi], X(xi), g.h-8);
    }
    /* ---- 曲线 ---- */
    function stroke(list){
      list.forEach(function(se){
        ctx.strokeStyle = se.color; ctx.lineWidth = se.width || 1.6;
        if(se.dash) ctx.setLineDash([5,4]); else ctx.setLineDash([]);
        ctx.beginPath(); var started=false;
        for(var i=0;i<(se.data||[]).length;i++){
          var v = se.data[i];
          if(v==null){ started=false; continue; }
          var x=X(i), y=Yof(se, v);
          if(!started){ ctx.moveTo(x,y); started=true; } else { ctx.lineTo(x,y); }
        }
        ctx.stroke(); ctx.setLineDash([]);
      });
    }
    stroke(up); stroke(lo);
    /* ---- 当日标记线（上下窗格各一条） ---- */
    if(marker!=null && marker>=0 && marker<labels.length){
      var xm = X(marker);
      ctx.strokeStyle='rgba(124,58,237,.75)'; ctx.setLineDash([3,3]);
      ctx.beginPath(); ctx.moveTo(xm,p.t); ctx.lineTo(xm,p.t+HU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(xm,ltop); ctx.lineTo(xm,ltop+HL); ctx.stroke();
      ctx.setLineDash([]);
      up.concat(lo).forEach(function(se){
        var v=(se.data||[])[marker]; if(v==null) return;
        ctx.fillStyle=se.color; ctx.beginPath();
        ctx.arc(xm, Yof(se, v), 3.2, 0, Math.PI*2); ctx.fill();
      });
    }
    var cg = ch.geom(ch.cross);
    ch.cctx.clearRect(0,0,cg.w,cg.h);
    ch._X = X; ch._Y = YU; ch._Y2 = rr.has ? YR : null; ch._YL = YL;
    ch._mn = ru.mn; ch._mx = ru.mx; ch._labels = labels;
    /* §52 —— 下窗格几何按 CSS 像素显式落在 DOM 上：审计与回归都直接读真实值，
     * 不许测试端"猜"断点高度（各断点画布高度不同，硬编码必然错位）。 */
    ch.shell.setAttribute('data-split-top', String(Math.round(ltop)));
    ch.shell.setAttribute('data-split-height', String(Math.round(HL)));
  }
  function drawAll(d){
    /* V4 —— 一张五柱历史图（共享 0~100），不画 V2/V3 的任何图表。 */
    if(ISV4){ drawV4(d); return; }
    var s = buildSeries();
    var r = rangeSlice();
    var rdates = dates.slice(r.s, r.e+1);
    var mi = dates.indexOf(d);
    if(mi>=r.s && mi<=r.e){ mi = mi - r.s; } else { mi = -1; }
    function cut(a){ return a.slice(r.s, r.e+1); }
    var sa = {coreFull:cut(s.coreFull), corePart:cut(s.corePart),
              coreShadow:cut(shadowAligned())};
    var sb = {invFull:cut(s.invFull), invPart:cut(s.invPart),
              priceClose:cut(s.priceClose||[]), priceOhlc:cut(s.priceOhlc||[]),
              timing:cut(s.timing||[])};
    var seA = chartASeries(sa), seB = chartBUpperSeries(sb),
        seT = chartBLowerSeries(sb);
    if(!CH.A){
      /* §7 —— 只有 CHART-B 需要右轴留白；CHART-A / CHART-C PAD 保持 V6 原值。 */
      CH.A = setupChart('chartA');
      CH.B = setupChart('chartB', (seB.some(function(x){return x.axis==='right';}) ? 52 : 14));
      CH.C = setupChart('chartC');
      bindCrosshair(CH.A, seA, rdates);
      /* §52 —— 上下窗格共用同一批十字线序列：一个 tooltip 同时给出
       * 日期 / 投资吸引力评分 / 择时参考 / 前复权 开·高·低·收。 */
      bindCrosshair(CH.B, seB.concat(seT), rdates);
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
      setCrosshairSeries(CH.B, seB.concat(seT), rdates);
    }
    drawSeries(CH.A, rdates, seA, mi, {min:0,max:100});
    /* §52 —— CHART-B 上下双窗格：上 0~100（左）/ RMB（右），下 0~20。 */
    drawSplit(CH.B, rdates, seB, seT, mi, {min:0,max:100}, {min:0,max:20});
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
    renderCalibreNote();
    rangeStatus();
  }
  /* §53 —— 口径与 PIT 等价性必须如实披露在页面上，禁止让用户猜曲线是什么。
   * 只写在 CHART-B 卡片内部，不新增 Hero / KPI（§52）。 */
  function renderCalibreNote(){
    var cn = el('chartB-calibre-note');
    if(!cn) return;
    var parts = [];
    if(PRICE && PRICE.available){
      parts.push('价格口径：' + (PRICE.calibre_zh || '前复权')
        + '（锚点 ' + (PRICE.anchor || GLYPH)
        + '，按 Q = m·P + a 仿射重建，与 Provider 真实 fc_rights 响应逐字段误差 ≤ 5e-5）；'
        + '未复权口径保留为后台审计基线，不再是默认可视线。');
      if(PRICE.non_negative_note_zh) parts.push(PRICE.non_negative_note_zh);
    }
    if(TIMING && TIMING.available){
      parts.push('择时参考：' + (TIMING.formula_zh || '')
        + '；' + (TIMING.pit_disclosure_zh || ''));
      parts.push('区间标注：0~4 高位区 · 4~8 偏高 · 8~12 中性 · 12~16 偏低 · 16~20 低位区'
        + '（仅描述价格处在自身历史区间的什么位置，不构成买卖建议，也不参与任何评分）。');
    }
    cn.textContent = parts.join(' ');
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
  /* §65 —— CHART-B 图例点击切换显示/隐藏（评分 / 价格），不新增 Toolbar。 */
  (function(){
    var lg = el('chartB-legend');
    if(!lg) return;
    Array.prototype.slice.call(lg.querySelectorAll('[data-series]')).forEach(function(sp){
      sp.addEventListener('click', function(){
        if(!CH.B) return;
        CH.B._hidden = CH.B._hidden || {};
        var k = sp.getAttribute('data-series');
        CH.B._hidden[k] = !CH.B._hidden[k];
        if(CH.B._hidden[k]) sp.className += ' off';
        else sp.className = String(sp.className).replace(/\s*\boff\b\s*/g,' ').trim();
        drawAll(cur);
      });
    });
  })();

  /* §41 ~ §43 —— 历史区间控件（只改变历史图 X 轴与区间统计，不动评分） */
  if(el('hist-apply')) el('hist-apply').addEventListener('click', applyRange);
  if(el('hist-reset')) el('hist-reset').addEventListener('click', function(){ presetRange(0); });
  if(el('hist-1y')) el('hist-1y').addEventListener('click', function(){ presetRange(1); });
  if(el('hist-3y')) el('hist-3y').addEventListener('click', function(){ presetRange(3); });
  if(el('hist-5y')) el('hist-5y').addEventListener('click', function(){ presetRange(5); });
  if(el('hist-all')) el('hist-all').addEventListener('click', function(){ presetRange(0); });
  /* V4 —— 五柱历史图的 1Y / 3Y / ALL 预设（只改 X 轴区间，不动任何分数） */
  if(el('v4-hist-1y')) el('v4-hist-1y').addEventListener('click', function(){ v4Preset(252); });
  if(el('v4-hist-3y')) el('v4-hist-3y').addEventListener('click', function(){ v4Preset(756); });
  if(el('v4-hist-all')) el('v4-hist-all').addEventListener('click', function(){ v4Preset(0); });
  /* ISSUE-06 —— 单日定位（previous-or-equal 回退）与区间选择（不静默反转） */
  if(el('v4-single-apply')) el('v4-single-apply').addEventListener('click', v4Locate);
  if(el('v4-single-date')) el('v4-single-date').addEventListener('change', v4Locate);
  if(el('v4-hist-apply')) el('v4-hist-apply').addEventListener('click', v4ApplyRange);
  if(el('v4-hist-reset')) el('v4-hist-reset').addEventListener('click', v4ResetRange);
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
    /* ---- 三模型分支：V4 = 五柱独立评分，V2 / V3 保持原路径 ---- */
    ISV4 = MODEL_META.model_id === 'CMB_SCORE_MODEL_V4';
    V4P = DATA.pillar_meta || [];
    V4M = DATA.member_meta || {};
    V4RANGE = null;
    /* ISSUE-05 —— 勾选状态每次 boot 归零：Fresh Page 恒为全部未选，
       不读 / 不写 localStorage，切换模型也不继承上一次勾选。 */
    V4_CHK = {};
    V4_HOVER = null;
    V4_LG_BUILT = false;
    window.__CMB_V4_HOVER_DATE__ = null;
    /* ④ 的额外元数据（序列清单 / 主轴 / 各序列最早合法日 / 释义 / 阈值表） */
    V4_SM = DATA.series_meta || [];
    V4_AXIS = DATA.master_axis || {};
    V4_EARLIEST = DATA.earliest_legal_date || {};
    V4_BAND = DATA.score_band_return || {};
    /* §36 —— 展示字符串来自 Python 预计算的查找表，浏览器不自己格式化。 */
    DMAP = DATA.display_map || {};
    DMAP_PCT = DATA.display_map_pct || {};
    RAW_META = DATA.raw_precision || {};
    SCOPE = DATA.section_scope || {};
    PRICE = DATA.chart_b_price || {};
    TIMING = DATA.chart_b_entry_timing || {};
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

    applyModelSections();
    bindEvents();
    /* ---- V6 初始化（全部只读渲染，不触发任何模型重算 / 外部调用） ---- */
    renderTopIdentity();
    /* V4 没有阈值收益验证 / 动态阈值研究区块（section_scope 已显式说明），
       跳过这两个 V2/V3 渲染器，避免它们去查 V4 payload 里不存在的展示键。 */
    if(!ISV4){ renderThreshold(); renderDynamicShell(); }
    if(el('hist-start') && dates.length) el('hist-start').value = dates[0];
    if(el('hist-end') && dates.length) el('hist-end').value = dates[dates.length-1];
    /* ④ 的单日定位 / 区间控件随模型一起重置到全轴，不继承任何上次的输入。 */
    if(ISV4 && dates.length){
      V4_SEL = dates[dates.length-1];
      if(el('v4-single-date')) el('v4-single-date').value = V4_SEL;
      if(el('v4-hist-start')) el('v4-hist-start').value = dates[0];
      if(el('v4-hist-end')) el('v4-hist-end').value = dates[dates.length-1];
      /* ⑦ —— 101 行 × 2 张表与模型无关地在 boot 时渲染一次。 */
      renderV4ScoreBand();
    }
    gotoDate(dates.length ? dates[dates.length-1] : null);
    fitSignals();
    window.__CMB_SHELL_READY__ = true;
    /* 只读导出：供本地 / 线上门禁核对 master 交易日轴（不参与任何渲染逻辑）。 */
    window.__CMB_SHELL_DATES__ = dates.slice();
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
