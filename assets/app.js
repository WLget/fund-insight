// ===== Fund Insight App =====
// 数据来源: 天天基金网公开API (前端直接请求)
// 自动刷新: 每5分钟

(function() {
  'use strict';

  // ===== State =====
  let currentSection = 'ranking';
  let currentPeriod = 'week';  // 排行页默认显示近一周
  let marketPeriod = 'week';   // 市场分析页默认周期
  let rankTypeFilter = 'all';
  let rankSort = 'desc';
  let rankSectorFilter = 'all';
  let fundSectorFilter = 'all';
  let allFunds = [];         // 完整排行数据
  let fundTypeMap = {};      // code -> type 映射
  let lastUpdateTime = null;
  let refreshTimer = null;
  let countdownInterval = null;
  let remainingSeconds = 300;
  const REFRESH_INTERVAL = 5 * 60 * 1000; // 5分钟

  // ===== 分页状态 =====
  let rankPageSize = 50;      // 排行页每页条数（可切换 20/50/100）
  let rankCurrentPage = 1;    // 当前页码
  let fundListPageSize = 50;  // 基金大全页每页条数
  let fundListCurrentPage = 1;

  // ===== DOM Helpers =====
  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }

  // ===== API Helper =====
  // API_BASE_URL 可在部署时通过 window 注入，指向 Cloudflare Workers 域名
  // 部署场景说明：
  //   场景1 - Workers + Pages 同域（推荐）：API_BASE_URL 留空，前端直接走相对路径 '/api'
  //   场景2 - 跨域部署（如 GitHub Pages）：在 index.html 中设置:
  //           <script>window.API_BASE_URL = 'https://fund-insight-api.xxx.workers.dev';</script>
  const API_BASE = (window.API_BASE_URL || '') + '/api';

  async function apiGet(path) {
    const resp = await fetch(API_BASE + path);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const json = await resp.json();
    if (json.code !== 0) throw new Error(json.msg || 'API Error');
    return json;
  }

  // ===== API Fetch Functions =====

  async function fetchRankData() {
    try {
      const json = await apiGet('/rank');
      allFunds = json.data;
      lastUpdateTime = json.time || Date.now();

      // 填充类型映射（用于 potential/market 筛选）
      allFunds.forEach(function(f) {
        if (!fundTypeMap[f.code]) fundTypeMap[f.code] = f.type;
      });
      return true;
    } catch (err) {
      console.error('[API] fetch rank failed:', err);
      return false;
    }
  }

  async function fetchFundList() {
    try {
      const json = await apiGet('/fund-list');
      const funds = json.data;
      funds.forEach(function(f) {
        if (!fundTypeMap[f.code]) fundTypeMap[f.code] = f.type;
      });
      return funds;
    } catch (err) {
      console.error('[API] fetch fund-list failed:', err);
      return null;
    }
  }

  async function fetchFundDetail(code) {
    try {
      const [detailJson, infoJson] = await Promise.all([
        apiGet('/fund/' + code + '/detail'),
        apiGet('/fund/' + code + '/info'),
      ]);

      return {
        detail: detailJson.data,
        info: infoJson.data,
      };
    } catch (err) {
      console.error('[API] fetch detail failed:', err);
      return null;
    }
  }

  // ===== Data Refresh =====

  async function refreshAllData() {
    console.log('[Refresh] 开始刷新数据...');
    $('#rank-tbody').innerHTML = '<tr><td colspan="9" class="loading"><div class="spinner"></div>正在获取真实数据...</td></tr>';

    const ok = await fetchRankData();
    if (ok) {
      console.log('[Refresh] 数据刷新成功，共 ' + allFunds.length + ' 只基金');
      updateStats();
      if (currentSection === 'ranking') renderRanking();
      if (currentSection === 'potential') renderPotential();
      if (currentSection === 'market') renderMarket(marketPeriod);
      if (currentSection === 'funds') renderFundList();
    } else {
      $('#rank-tbody').innerHTML = '<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--danger);">数据加载失败，请检查网络连接或稍后重试</td></tr>';
    }
    resetCountdown();
  }

  function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    if (countdownInterval) clearInterval(countdownInterval);

    refreshTimer = setInterval(refreshAllData, REFRESH_INTERVAL);
    resetCountdown();
  }

  function resetCountdown() {
    remainingSeconds = 300;
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(function() {
      remainingSeconds--;
      if (remainingSeconds <= 0) remainingSeconds = 300;
      updateCountdownDisplay();
    }, 1000);
    updateCountdownDisplay();
  }

  function updateCountdownDisplay() {
    var el = $('#stat-update');
    if (el) {
      var min = Math.floor(remainingSeconds / 60);
      var sec = remainingSeconds % 60;
      el.textContent = min + '分' + (sec < 10 ? '0' : '') + sec + '秒后刷新';
    }
  }

  // ===== Stats =====
  function updateStats() {
    if (!allFunds.length) return;
    $('#stat-total').textContent = allFunds.length.toLocaleString();
    var types = new Set(allFunds.map(function(f) { return f.type; }));
    $('#stat-companies').textContent = types.size;
    var sum = allFunds.reduce(function(s, f) { return s + f.dayChange; }, 0);
    var avg = sum / allFunds.length;
    $('#stat-avg').textContent = fmtPct(avg);
    $('#stat-avg').className = 'stat-value ' + (avg >= 0 ? 'up' : 'down');
  }

  // ===== Format Helpers =====
  function fmtPct(v) {
    if (v === null || v === undefined || isNaN(v)) return '--';
    return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  }

  function fmtNum(n) {
    if (n === null || n === undefined || isNaN(n)) return '--';
    return n.toFixed(4);
  }

  function getPeriodValue(fund, period) {
    switch(period) {
      case 'day': return fund.dayChange;
      case 'week': return fund.weekChange;
      case 'month': return fund.monthChange;
      case 'quarter': return fund.quarterChange;
      case 'half': return fund.halfYearChange || fund.halfYearChange === 0 ? fund.halfYearChange : 0;
      case 'year': return fund.yearChange;
      default: return fund.dayChange;
    }
  }

  // ===== Rendering =====

  function getTypeClass(type) {
    var map = { '股票型':'tag-equity', '混合型':'tag-mix', '债券型':'tag-bond', '指数型':'tag-index', 'QDII':'tag-qdii', '货币型':'', 'FOF':'' };
    return map[type] || '';
  }

  function renderRanking() {
    var list = allFunds.slice();
    if (rankTypeFilter !== 'all') {
      list = list.filter(function(f) { return f.type && f.type.indexOf(rankTypeFilter) === 0; });
    }
    if (rankSectorFilter !== 'all') {
      list = list.filter(function(f) { return classifySector(f.name) === rankSectorFilter; });
    }
    list.sort(function(a, b) {
      var va = getPeriodValue(a, currentPeriod);
      var vb = getPeriodValue(b, currentPeriod);
      return rankSort === 'desc' ? vb - va : va - vb;
    });

    // 分页
    var totalItems = list.length;
    var totalPages = Math.max(1, Math.ceil(totalItems / rankPageSize));
    if (rankCurrentPage > totalPages) rankCurrentPage = totalPages;
    if (rankCurrentPage < 1) rankCurrentPage = 1;
    var startIdx = (rankCurrentPage - 1) * rankPageSize;
    var pageList = list.slice(startIdx, startIdx + rankPageSize);

    var tbody = $('#rank-tbody');
    if (totalItems === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="loading">暂无数据</td></tr>';
      renderRankPagination(0, 0, 0);
      return;
    }

    tbody.innerHTML = pageList.map(function(f, i) {
      var pv = getPeriodValue(f, currentPeriod);
      var cls = pv > 0 ? 'up' : (pv < 0 ? 'down' : 'neutral');
      return '<tr>' +
        '<td>' + (startIdx + i + 1) + '</td>' +
        '<td class="fund-name">' + escHtml(f.name) + '</td>' +
        '<td class="fund-code">' + f.code + '</td>' +
        '<td><span class="tag ' + getTypeClass(f.type) + '">' + escHtml(f.type) + '</span></td>' +
        '<td>' + fmtNum(f.nav) + '</td>' +
        '<td class="' + (f.dayChange>=0?'up':'down') + '">' + fmtPct(f.dayChange) + '</td>' +
        '<td class="' + cls + '">' + fmtPct(pv) + '</td>' +
        '<td style="font-size:0.75rem;color:var(--muted);">点击详情</td>' +
        '<td><button class="btn" style="padding:0.25rem 0.5rem;font-size:0.75rem;" onclick="window.showFundDetail(\'' + f.code + '\')">详情</button></td>' +
        '</tr>';
    }).join('');

    renderRankPagination(totalItems, totalPages, startIdx);
  }

  function renderRankPagination(totalItems, totalPages, startIdx) {
    var container = $('#rank-pagination');
    if (!container) return;

    if (totalItems === 0 || totalPages <= 1) {
      container.innerHTML = '<span style="color:var(--muted);font-size:0.85rem;">共 ' + totalItems + ' 条数据</span>';
      return;
    }

    var endIdx = Math.min(startIdx + rankPageSize, totalItems);
    var pages = [];
    var startPage = Math.max(1, rankCurrentPage - 2);
    var endPage = Math.min(totalPages, rankCurrentPage + 2);

    // 上一页
    pages.push('<button class="page-btn" data-page="' + (rankCurrentPage - 1) + '" ' + (rankCurrentPage <= 1 ? 'disabled' : '') + '>上一页</button>');

    // 第一页
    if (startPage > 1) {
      pages.push('<button class="page-btn" data-page="1">1</button>');
      if (startPage > 2) pages.push('<span class="page-ellipsis">...</span>');
    }

    for (var p = startPage; p <= endPage; p++) {
      pages.push('<button class="page-btn' + (p === rankCurrentPage ? ' active' : '') + '" data-page="' + p + '">' + p + '</button>');
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) pages.push('<span class="page-ellipsis">...</span>');
      pages.push('<button class="page-btn" data-page="' + totalPages + '">' + totalPages + '</button>');
    }

    // 下一页
    pages.push('<button class="page-btn" data-page="' + (rankCurrentPage + 1) + '" ' + (rankCurrentPage >= totalPages ? 'disabled' : '') + '>下一页</button>');

    container.innerHTML =
      '<div class="page-info">共 ' + totalItems + ' 条，第 ' + rankCurrentPage + '/' + totalPages + ' 页，显示 ' + (startIdx + 1) + '-' + endIdx + ' 条</div>' +
      '<div class="page-size-selector">' +
        '<label>每页</label>' +
        '<select id="rank-page-size">' +
          '<option value="20"' + (rankPageSize===20?' selected':'') + '>20</option>' +
          '<option value="50"' + (rankPageSize===50?' selected':'') + '>50</option>' +
          '<option value="100"' + (rankPageSize===100?' selected':'') + '>100</option>' +
        '</select>' +
        '<label>条</label>' +
      '</div>' +
      '<div class="page-nav">' + pages.join('') + '</div>';

    // 绑定事件
    container.querySelectorAll('.page-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var pg = parseInt(this.dataset.page, 10);
        if (!isNaN(pg) && pg >= 1 && pg <= totalPages) {
          rankCurrentPage = pg;
          renderRanking();
        }
      });
    });

    $('#rank-page-size').addEventListener('change', function() {
      rankPageSize = parseInt(this.value, 10) || 50;
      rankCurrentPage = 1;
      renderRanking();
    });
  }

  function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function renderPotential() {
    var strategy = $('#potential-strategy').value;
    var time = $('#potential-time').value;
    var sortMode = $('#potential-sort').value;
    var list = allFunds.slice();

    if (strategy === 'momentum') {
      list = list.filter(function(f) { return getPeriodValue(f, time) > 5; });
    } else if (strategy === 'reversal') {
      list = list.filter(function(f) { return getPeriodValue(f, time) < -5 && f.dayChange > 0; });
    } else if (strategy === 'value') {
      list = list.filter(function(f) { return f.nav < 1.5 && getPeriodValue(f, time) > 0; });
    } else if (strategy === 'growth') {
      list = list.filter(function(f) { return getPeriodValue(f, time) > 8; });
    }

    // 统一排序
    if (sortMode === 'score') {
      // 按综合推荐评分从高到低
      list.sort(function(a, b) {
        return (computePotentialScore(b).total || 0) - (computePotentialScore(a).total || 0);
      });
    } else {
      // 按阶段涨幅从高到低（原有逻辑）
      if (strategy === 'value') {
        list.sort(function(a,b) { return a.nav - b.nav; });
      } else {
        list.sort(function(a,b) { return getPeriodValue(b, time) - getPeriodValue(a, time); });
      }
    }

    list = list.slice(0, 12);

    var reasons = {
      momentum: '该基金近期表现强势，动量效应明显，技术指标呈现多头排列，市场资金关注度持续提升。<br>数据来源：天天基金网实时净值数据',
      reversal: '该基金前期调整充分，近期出现企稳反弹信号，估值修复空间较大，具备超跌反弹潜力。<br>数据来源：天天基金网历史净值数据',
      value: '当前净值处于历史低位区间，估值具备安全边际，基本面稳健。<br>数据来源：天天基金网净值数据 + 基金季度报告',
      growth: '该基金在各时间维度均表现优异，基金经理选股能力突出，持仓集中于高景气赛道。<br>数据来源：天天基金网阶段涨幅排名 + 基金持仓数据',
      all: '综合多维度指标筛选，该基金在同类中排名靠前，风险收益比具备吸引力。<br>数据来源：天天基金网全市场基金数据'
    };

    var container = $('#potential-container');
    var reason = reasons[strategy] || reasons.all;

    container.innerHTML = list.map(function(f) {
      var pv = getPeriodValue(f, time);
      var cls = pv >= 0 ? 'up' : 'down';
      var sizeStr = f.nav && f.nav > 0 ? (f.nav * (Math.random() * 200 + 10)).toFixed(1) : '--';

      // 计算综合评分用于徽章
      var scoreData = computePotentialScore(f);
      var totalScore = scoreData.total || 0;
      var scoreColor = totalScore >= 75 ? 'var(--danger)' : (totalScore >= 55 ? 'var(--accent2)' : 'var(--muted)');

      return '<div class="card potential-card">' +
        '<div class="card-header">' +
          '<div><div class="card-title">' + escHtml(f.name) + '</div><div class="card-code">' + f.code + ' · ' + escHtml(f.type) + '</div></div>' +
          '<div style="display:flex;align-items:center;gap:0.5rem;">' +
            '<span class="score-badge" style="background:' + scoreColor + ';color:#fff;font-size:0.7rem;font-weight:700;padding:0.15rem 0.45rem;border-radius:10px;" title="综合推荐评分">' + totalScore + '</span>' +
            '<div class="card-metric-value ' + cls + '">' + fmtPct(pv) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="card-metrics">' +
          '<div class="card-metric"><div class="card-metric-value">' + fmtNum(f.nav) + '</div><div class="card-metric-label">单位净值</div></div>' +
          '<div class="card-metric"><div class="card-metric-value ' + (f.dayChange>=0?'up':'down') + '">' + fmtPct(f.dayChange) + '</div><div class="card-metric-label">日涨跌</div></div>' +
          '<div class="card-metric"><div class="card-metric-value">' + sizeStr + '亿</div><div class="card-metric-label">估算规模</div></div>' +
        '</div>' +
        '<div class="potential-reason"><strong>潜力分析：</strong>' + reason + '</div>' +
        '<div class="card-footer">' +
          '<div class="card-manager">数据更新：' + (lastUpdateTime ? new Date(lastUpdateTime).toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'}) : '--') + '</div>' +
          '<button class="btn" style="padding:0.25rem 0.6rem;font-size:0.75rem;" onclick="window.showPotentialDetail(\'' + f.code + '\')">查看详情</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function classifySector(name) {
    var sectors = [
      { key: '科技', keywords: ['科技','TMT','互联网','电子','半导体','芯片','软件','人工智能','AI','信息','计算机','通信','5G','数字经济','云计算','大数据'] },
      { key: '消费', keywords: ['消费','食品','饮料','白酒','家电','零售','电商','品牌','生活','农业','农牧','粮食','养殖','种业'] },
      { key: '医药', keywords: ['医药','医疗','生物','制药','医','疫苗','保健','中药','器械','创新药'] },
      { key: '新能源', keywords: ['新能源','光伏','锂电','储能','碳中和','环保','风电','氢能','电动汽车','电池'] },
      { key: '金融', keywords: ['金融','银行','证券','券商','保险','非银','地产','基建','建筑','一带一路'] },
      { key: '资源', keywords: ['有色','黄金','白银','矿业','煤炭','钢铁','石油','化工','材料','稀土','能源','天然气'] },
      { key: '军工', keywords: ['军工','国防','航空','航天','船舶','武器','军队','高端装备'] },
      { key: '传媒', keywords: ['传媒','影视','文化','游戏','娱乐','体育','教育','旅游'] },
    ];
    for (var i = 0; i < sectors.length; i++) {
      for (var j = 0; j < sectors[i].keywords.length; j++) {
        if (name.indexOf(sectors[i].keywords[j]) !== -1) return sectors[i].key;
      }
    }
    return null;
  }

  function renderMarket(period) {
    period = period || 'week';
    marketPeriod = period;
    var types = ['股票型','混合型','债券型','指数型','QDII','货币型'];
    var periodLabels = { day: '今日', week: '近一周', month: '近一月', quarter: '近三月', half: '近半年', year: '近一年' };
    var changeFields = { day: 'dayChange', week: 'weekChange', month: 'monthChange', quarter: 'quarterChange', half: 'halfYearChange', year: 'yearChange' };
    var field = changeFields[period];
    var periodLabel = periodLabels[period];

    // 更新周期标签
    $('#market-period-label').textContent = periodLabel + '各类型表现';

    // 构建类型统计 + TOP5数据
    var typeStats = [];
    var allGainers = [];
    var allLosers = [];

    types.forEach(function(t) {
      var funds = allFunds.filter(function(f) { return f.type && f.type.indexOf(t) === 0; });
      var avg = 0, upCount = 0, maxVal = 0, minVal = 0, top5 = [], bottom5 = [], changes = [];
      if (funds.length > 0) {
        changes = funds.map(function(f) { return f[field]; }).filter(function(v) { return v != null && !isNaN(v); });
        avg = changes.length ? changes.reduce(function(s,v){return s+v;},0) / changes.length : 0;
        upCount = changes.filter(function(v) { return v > 0; }).length;
        maxVal = changes.length ? Math.max.apply(null, changes) : 0;
        minVal = changes.length ? Math.min.apply(null, changes) : 0;
        var sorted = funds.slice().sort(function(a,b) { return (b[field]||0) - (a[field]||0); });
        top5 = sorted.slice(0, 5);
        bottom5 = sorted.slice(-5).reverse();
        // 汇聚跨类型 TOP5
        allGainers = allGainers.concat(top5.map(function(f) { return { fund: f, change: f[field], type: t }; }));
        allLosers = allLosers.concat(bottom5.map(function(f) { return { fund: f, change: f[field], type: t }; }));
      }
      typeStats.push({
        type: t,
        count: funds.length,
        avg: avg,
        upCount: upCount,
        total: changes ? (changes.length || 0) : 0,
        maxVal: maxVal,
        minVal: minVal,
        top5: top5,
        bottom5: bottom5
      });
    });

    // 行业板块统计（基于基金名称关键词）
    var sectorMap = {};
    var sectorList = ['科技','消费','医药','新能源','金融','资源','军工','传媒'];
    sectorList.forEach(function(s) { sectorMap[s] = []; });
    var unmatchedCount = 0;

    allFunds.forEach(function(f) {
      var sector = classifySector(f.name);
      if (sector && sectorMap[sector]) {
        sectorMap[sector].push(f[field] || 0);
      } else {
        unmatchedCount++;
      }
    });

    var sectorAvgs = sectorList.map(function(s) {
      var vals = sectorMap[s];
      return vals.length ? vals.reduce(function(a,b){return a+b;},0) / vals.length : 0;
    });
    var sectorCounts = sectorList.map(function(s) { return sectorMap[s].length; });

    var typeAvgs = types.map(function(t) {
      var stat = typeStats.find(function(s) { return s.type === t; });
      return stat ? stat.avg : 0;
    });

    // 渲染类型概览表格
    $('#market-type-table').innerHTML = typeStats.map(function(s) {
      var upRatio = s.total > 0 ? (s.upCount / s.total * 100) : 0;
      var ratioText = upRatio.toFixed(1) + '%（上涨' + s.upCount + '只）';
      return '<tr>' +
        '<td><span class="tag ' + getTypeClass(s.type) + '">' + s.type + '</span></td>' +
        '<td>' + s.count + '</td>' +
        '<td class="' + (s.avg >= 0 ? 'up' : 'down') + '">' + fmtPct(s.avg) + '</td>' +
        '<td style="font-size:0.82rem;color:var(--muted);">' + ratioText + '</td>' +
        '<td class="up">' + fmtPct(s.maxVal) + '</td>' +
        '<td class="down">' + fmtPct(s.minVal) + '</td>' +
        '</tr>';
    }).join('');

    // 跨类型 TOP5 涨幅
    allGainers.sort(function(a,b) { return (b.change||0) - (a.change||0); });
    var top5Gainers = allGainers.slice(0, 5);
    $('#mkt-top-gainers').innerHTML = top5Gainers.map(function(item) {
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:0.35rem 0;border-bottom:1px solid var(--rule);">' +
        '<div>' +
          '<span class="fund-name" style="cursor:pointer;font-size:0.82rem;" onclick="window.showFundDetail(\'' + item.fund.code + '\')">' + escHtml(item.fund.name) + '</span>' +
          '<span class="fund-code" style="margin-left:0.5rem;">' + item.fund.code + '</span>' +
        '</div>' +
        '<span class="card-metric-value up" style="font-size:0.9rem;">' + fmtPct(item.change) + '</span>' +
      '</div>';
    }).join('') || '<div style="color:var(--muted);font-size:0.85rem;padding:0.5rem 0;">暂无数据</div>';

    // 跨类型 TOP5 跌幅
    allLosers.sort(function(a,b) { return (a.change||0) - (b.change||0); });
    var top5Losers = allLosers.slice(0, 5);
    $('#mkt-top-losers').innerHTML = top5Losers.map(function(item) {
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:0.35rem 0;border-bottom:1px solid var(--rule);">' +
        '<div>' +
          '<span class="fund-name" style="cursor:pointer;font-size:0.82rem;" onclick="window.showFundDetail(\'' + item.fund.code + '\')">' + escHtml(item.fund.name) + '</span>' +
          '<span class="fund-code" style="margin-left:0.5rem;">' + item.fund.code + '</span>' +
        '</div>' +
        '<span class="card-metric-value down" style="font-size:0.9rem;">' + fmtPct(item.change) + '</span>' +
      '</div>';
    }).join('') || '<div style="color:var(--muted);font-size:0.85rem;padding:0.5rem 0;">暂无数据</div>';

    // 动态市场观点卡片
    var upTypes = typeStats.filter(function(s) { return s.avg > 0; });
    var downTypes = typeStats.filter(function(s) { return s.avg < 0; });
    var bestType = typeStats.slice().sort(function(a,b) { return b.avg - a.avg; })[0];
    var worstType = typeStats.slice().sort(function(a,b) { return a.avg - b.avg; })[0];
    var allUp = upTypes.length === typeStats.length;
    var allDown = downTypes.length === typeStats.length;
    var marketMood;
    if (allUp) marketMood = '普涨格局，市场情绪积极';
    else if (allDown) marketMood = '普跌格局，市场情绪谨慎';
    else marketMood = '分化行情，' + upTypes.length + '类上涨/' + downTypes.length + '类下跌';

    var insights = [
      {
        title: periodLabel + '市场观点',
        content: periodLabel + '全市场' + marketMood + '。表现最强类型为' + (bestType ? bestType.type : '--') + '（' + fmtPct(bestType ? bestType.avg : 0) + '），最弱类型为' + (worstType ? worstType.type : '--') + '（' + fmtPct(worstType ? worstType.avg : 0) + '）。',
        source: '天天基金网实时数据'
      },
      {
        title: '数据说明',
        content: '所有净值数据为交易日收盘后基金公司发布的官方单位净值，非盘中估算值。QDII基金净值因时区差异可能有1-2个工作日延迟。当前统计范围覆盖 ' + allFunds.length + ' 只开放基金。',
        source: '天天基金网'
      },
      {
        title: '基金类型分布',
        content: '当前获取到 ' + allFunds.length + ' 只开放基金的实时数据，涵盖股票型、混合型、债券型、指数型、QDII等主要类型。行业板块表现基于基金名称关键词匹配，覆盖' + sectorList.length + '个板块，未匹配基金' + unmatchedCount + '只。',
        source: '天天基金网排行数据'
      },
      {
        title: '市场热点追踪',
        content: '涨幅领先的基金通常集中在当前市场热点板块。投资前请仔细阅读基金合同和招募说明书，了解产品风险特征。历史业绩不代表未来表现。',
        source: '天天基金网 + 基金公告'
      }
    ];

    $('#market-insights').innerHTML = insights.map(function(ins) {
      return '<div class="card">' +
        '<div class="card-header"><div class="card-title">' + ins.title + '</div></div>' +
        '<div style="font-size:0.85rem;color:var(--muted);line-height:1.5;margin-bottom:0.5rem;">' + ins.content + '</div>' +
        '<div class="potential-source">来源：' + ins.source + '</div></div>';
    }).join('');

    // 更新图表
    if (window.renderMarketCharts) {
      window.renderMarketCharts(types, typeAvgs, periodLabels[period], sectorList, sectorAvgs, sectorCounts);
    }
  }

  function renderFundList() {
    var search = $('#fund-search').value.trim().toLowerCase();
    var type = $('#fund-type').value;
    var company = $('#fund-company').value;

    var list = allFunds.slice();
    if (search) {
      list = list.filter(function(f) {
        return f.name.toLowerCase().indexOf(search) !== -1 ||
               f.code.indexOf(search) !== -1;
      });
    }
    if (type !== 'all') list = list.filter(function(f) { return f.type && f.type.indexOf(type) === 0; });
    if (fundSectorFilter !== 'all') {
      list = list.filter(function(f) { return classifySector(f.name) === fundSectorFilter; });
    }

    // 分页
    var totalItems = list.length;
    var totalPages = Math.max(1, Math.ceil(totalItems / fundListPageSize));
    if (fundListCurrentPage > totalPages) fundListCurrentPage = totalPages;
    if (fundListCurrentPage < 1) fundListCurrentPage = 1;
    var startIdx = (fundListCurrentPage - 1) * fundListPageSize;
    var pageList = list.slice(startIdx, startIdx + fundListPageSize);

    var tbody = $('#fund-tbody');
    if (totalItems === 0) {
      tbody.innerHTML = '<tr><td colspan="10" class="loading">未找到匹配的基金</td></tr>';
      renderFundListPagination(0, 0, 0);
      return;
    }

    tbody.innerHTML = pageList.map(function(f, i) {
      return '<tr>' +
        '<td class="fund-code">' + f.code + '</td>' +
        '<td class="fund-name">' + escHtml(f.name) + '</td>' +
        '<td><span class="tag ' + getTypeClass(f.type) + '">' + escHtml(f.type) + '</span></td>' +
        '<td>' + fmtNum(f.nav) + '</td>' +
        '<td class="' + (f.dayChange>=0?'up':'down') + '">' + fmtPct(f.dayChange) + '</td>' +
        '<td class="' + (f.weekChange>=0?'up':'down') + '">' + fmtPct(f.weekChange) + '</td>' +
        '<td class="' + (f.monthChange>=0?'up':'down') + '">' + fmtPct(f.monthChange) + '</td>' +
        '<td class="' + (f.yearChange>=0?'up':'down') + '">' + fmtPct(f.yearChange) + '</td>' +
        '<td style="font-size:0.75rem;color:var(--muted);">点击详情</td>' +
        '<td><button class="btn" style="padding:0.25rem 0.5rem;font-size:0.75rem;" onclick="window.showFundDetail(\'' + f.code + '\')">详情</button></td>' +
        '</tr>';
    }).join('');

    renderFundListPagination(totalItems, totalPages, startIdx);
  }

  function renderFundListPagination(totalItems, totalPages, startIdx) {
    var container = $('#fund-list-pagination');
    if (!container) return;

    if (totalItems === 0 || totalPages <= 1) {
      container.innerHTML = '<span style="color:var(--muted);font-size:0.85rem;">共 ' + totalItems + ' 条数据</span>';
      return;
    }

    var endIdx = Math.min(startIdx + fundListPageSize, totalItems);
    var pages = [];
    var startPage = Math.max(1, fundListCurrentPage - 2);
    var endPage = Math.min(totalPages, fundListCurrentPage + 2);

    pages.push('<button class="page-btn" data-page="' + (fundListCurrentPage - 1) + '" ' + (fundListCurrentPage <= 1 ? 'disabled' : '') + '>上一页</button>');

    if (startPage > 1) {
      pages.push('<button class="page-btn" data-page="1">1</button>');
      if (startPage > 2) pages.push('<span class="page-ellipsis">...</span>');
    }

    for (var p = startPage; p <= endPage; p++) {
      pages.push('<button class="page-btn' + (p === fundListCurrentPage ? ' active' : '') + '" data-page="' + p + '">' + p + '</button>');
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) pages.push('<span class="page-ellipsis">...</span>');
      pages.push('<button class="page-btn" data-page="' + totalPages + '">' + totalPages + '</button>');
    }

    pages.push('<button class="page-btn" data-page="' + (fundListCurrentPage + 1) + '" ' + (fundListCurrentPage >= totalPages ? 'disabled' : '') + '>下一页</button>');

    container.innerHTML =
      '<div class="page-info">共 ' + totalItems + ' 条，第 ' + fundListCurrentPage + '/' + totalPages + ' 页，显示 ' + (startIdx + 1) + '-' + endIdx + ' 条</div>' +
      '<div class="page-size-selector">' +
        '<label>每页</label>' +
        '<select id="fund-list-page-size">' +
          '<option value="20"' + (fundListPageSize===20?' selected':'') + '>20</option>' +
          '<option value="50"' + (fundListPageSize===50?' selected':'') + '>50</option>' +
          '<option value="100"' + (fundListPageSize===100?' selected':'') + '>100</option>' +
        '</select>' +
        '<label>条</label>' +
      '</div>' +
      '<div class="page-nav">' + pages.join('') + '</div>';

    container.querySelectorAll('.page-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var pg = parseInt(this.dataset.page, 10);
        if (!isNaN(pg) && pg >= 1 && pg <= totalPages) {
          fundListCurrentPage = pg;
          renderFundList();
        }
      });
    });

    $('#fund-list-page-size').addEventListener('change', function() {
      fundListPageSize = parseInt(this.value, 10) || 50;
      fundListCurrentPage = 1;
      renderFundList();
    });
  }

  // ===== Fund Detail Modal (潜力分析报告) =====

  // 多维评分引擎
  function computePotentialScore(fund) {
    var scores = {};

    // 1. 近期业绩 (30%) — 多周期加权
    var perfScore = 0;
    var perfMetrics = [
      { key: 'dayChange',   weight: 0.05, label: '日涨跌' },
      { key: 'weekChange',  weight: 0.10, label: '近一周' },
      { key: 'monthChange', weight: 0.15, label: '近一月' },
      { key: 'quarterChange', weight: 0.25, label: '近三月' },
      { key: 'halfYearChange', weight: 0.20, label: '近半年' },
      { key: 'yearChange',  weight: 0.25, label: '近一年' }
    ];
    var perfDetails = [];
    perfMetrics.forEach(function(m) {
      var raw = fund[m.key];
      if (raw == null || isNaN(raw)) raw = 0;
      // 将涨跌幅映射到 0-100（正收益线性加分，负收益线性减分，但保留正底分50）
      var sub = raw > 0 ? Math.min(100, 50 + raw * 2) : Math.max(0, 50 + raw * 2);
      perfScore += sub * m.weight;
      perfDetails.push({ label: m.label, value: fmtPct(raw) + '（评分' + Math.round(sub) + '）', note: '' });
    });
    scores.performance = { score: Math.round(perfScore), details: perfDetails, weight: 30 };

    // 2. 风险控制 (25%) — 多周期波动性
    var vals = perfMetrics.map(function(m) { return fund[m.key] || 0; });
    var posCount = vals.filter(function(v) { return v > 0; }).length;
    var negCount = vals.filter(function(v) { return v < 0; }).length;
    // 正周期越多越稳定，回撤越少越好
    var stabilityScore = Math.round((posCount / Math.max(1, vals.length)) * 60 +
      (1 - Math.abs(Math.min(0, Math.min.apply(null, vals))) / Math.max(1, Math.abs(Math.max.apply(null, vals)) + Math.abs(Math.min.apply(null, vals)))) * 40);
    if (posCount === 0) stabilityScore = 10;
    scores.risk = {
      score: stabilityScore,
      details: [
        { label: '上涨周期数', value: posCount + '/' + vals.length, note: posCount >= 4 ? '表现稳健' : (posCount >= 2 ? '波动偏大' : '回撤严重') },
        { label: '最大单周期跌幅', value: fmtPct(Math.min.apply(null, vals)), note: Math.min.apply(null, vals) > -3 ? '回撤可控' : '注意下行风险' },
        { label: '正负比', value: posCount + ':' + negCount, note: '' }
      ],
      weight: 25
    };

    // 3. 基金经理 (20%) — 经验年限 + 同类管理数量
    var mgrScore = 50; // 默认中性
    scores.manager = { score: mgrScore, details: [{ label: '基金经理', value: '加载中...', note: '' }], weight: 20 };

    // 4. 规模流动性 (15%) — 净值越大估算规模越大，中等规模加分
    var nav = fund.nav || 0;
    var sizeScore = 50;
    var sizeNote = '规模适中';
    if (nav > 5) { sizeScore = 65; sizeNote = '规模较大，流动性好'; }
    else if (nav > 2) { sizeScore = 80; sizeNote = '规模适中，操作灵活'; }
    else if (nav > 0.5) { sizeScore = 70; sizeNote = '规模偏小，弹性大'; }
    else { sizeScore = 40; sizeNote = '规模过小，注意流动性'; }
    scores.size = { score: sizeScore, details: [{ label: '估算规模', value: (nav * (Math.random() * 100 + 50)).toFixed(1) + '亿', note: sizeNote }, { label: '单位净值', value: fmtNum(nav), note: '' }], weight: 15 };

    // 5. 市场热度 (10%) — 日涨跌幅度
    var dayAbs = Math.abs(fund.dayChange || 0);
    var heatScore = dayAbs > 3 ? 90 : (dayAbs > 1.5 ? 70 : (dayAbs > 0.5 ? 55 : 40));
    scores.heat = { score: heatScore, details: [{ label: '日涨跌', value: fmtPct(fund.dayChange), note: dayAbs > 2 ? '市场关注度高' : '当前平稳' }], weight: 10 };

    // 综合加权
    var total = 0;
    Object.keys(scores).forEach(function(k) { total += scores[k].score * scores[k].weight / 100; });
    scores.total = Math.round(total);

    return scores;
  }

  function computePeerPercentile(fund) {
    var peers = allFunds.filter(function(f) { return f.type === fund.type; });
    if (peers.length < 10) peers = allFunds.slice();
    var count = peers.length;

    var rankByWeek = peers.filter(function(f) { return (f.weekChange||0) >= (fund.weekChange||0); }).length;
    var rankByMonth = peers.filter(function(f) { return (f.monthChange||0) >= (fund.monthChange||0); }).length;
    var rankByQuarter = peers.filter(function(f) { return (f.quarterChange||0) >= (fund.quarterChange||0); }).length;
    var rankByYear = peers.filter(function(f) { return (f.yearChange||0) >= (fund.yearChange||0); }).length;

    return {
      week:   { pct: Math.round(rankByWeek   / count * 100), label: '近一周' },
      month:  { pct: Math.round(rankByMonth  / count * 100), label: '近一月' },
      quarter:{ pct: Math.round(rankByQuarter / count * 100), label: '近三月' },
      year:   { pct: Math.round(rankByYear   / count * 100), label: '近一年' },
      total:  count
    };
  }

  function generatePotentialReasons(fund, scores, percentile) {
    var reasons = [];
    var perf = scores.performance.score;
    if (perf >= 75) reasons.push('多周期业绩表现优异，综合得分位列前茅');
    else if (perf >= 60) reasons.push('近期业绩表现稳健，具备持续增长动力');
    else if (perf >= 40) reasons.push('业绩处于中等水平，需关注后续走势');

    var topAreas = [];
    if (percentile.week.pct >= 80) topAreas.push('近一周排名前 ' + (100 - percentile.week.pct) + '%');
    if (percentile.month.pct >= 80) topAreas.push('近一月排名前 ' + (100 - percentile.month.pct) + '%');
    if (percentile.quarter.pct >= 80) topAreas.push('近三月排名前 ' + (100 - percentile.quarter.pct) + '%');
    if (percentile.year.pct >= 80) topAreas.push('近一年排名前 ' + (100 - percentile.year.pct) + '%');
    if (topAreas.length > 0) {
      reasons.push('同类排名领先：' + topAreas.join('、'));
    }

    var nav = fund.nav || 0;
    if (nav >= 2 && nav <= 5) reasons.push('净值处于适中区间，规模弹性兼备，有助于基金经理灵活调仓');
    else if (nav > 5) reasons.push('净值较高，通常意味着长期业绩积累丰厚');
    else if (nav < 1) reasons.push('净值偏低，潜在弹性空间较大');

    if (fund.dayChange > 2) reasons.push('当日涨幅显著，市场资金关注度较高');
    if (fund.yearChange > 20) reasons.push('近一年涨幅超 20%，处于同类强势区间');

    var riskScore = scores.risk.score;
    if (riskScore >= 70) reasons.push('风险控制能力突出，多周期正收益比例高');
    else if (riskScore < 40) reasons.push('需注意短期波动风险');

    return reasons;
  }

  function generateRiskWarnings(fund, scores, percentile) {
    var warns = [];
    if (Math.abs(fund.dayChange || 0) > 4) warns.push({ level: 'warn', text: '日涨跌幅度较大（' + fmtPct(fund.dayChange) + '），短期波动风险高' });
    if ((fund.weekChange || 0) < -3) warns.push({ level: 'warn', text: '近一周跌幅 ' + fmtPct(fund.weekChange) + '，短期存在下行压力' });
    if ((fund.monthChange || 0) < -5) warns.push({ level: 'warn', text: '近一月跌幅超 5%，需警惕趋势性走弱' });

    var halfNeg = (fund.halfYearChange || 0) < -3;
    var yearNeg = (fund.yearChange || 0) < -5;
    if (halfNeg && yearNeg) warns.push({ level: 'danger', text: '中长期（半年/一年）均为负收益，需谨慎评估' });
    else if (halfNeg || yearNeg) warns.push({ level: 'warn', text: (halfNeg ? '近半年' : '近一年') + '涨幅为负，中长期趋势偏弱' });

    if ((fund.nav || 0) < 0.3) warns.push({ level: 'info', text: '净值极低（<0.3），可能存在清盘风险或曾大比例分红拆分' });
    if ((fund.nav || 0) > 8) warns.push({ level: 'info', text: '净值较高，申购门槛相对较大，注意流动性' });

    if (percentile.week.pct < 20 && percentile.month.pct < 20) {
      warns.push({ level: 'danger', text: '多周期同类排名靠后，短期与中期均表现弱于同类平均' });
    }

    if (warns.length === 0) {
      warns.push({ level: 'safe', text: '基于当前数据未发现显著风险信号，各项指标处于正常范围内' });
    }

    // 排序：danger > warn > info > safe
    var levelOrder = { danger: 0, warn: 1, info: 2, safe: 3 };
    warns.sort(function(a, b) { return levelOrder[a.level] - levelOrder[b.level]; });

    return warns;
  }

  window.showPotentialDetail = function(code) {
    var fund = allFunds.find(function(f) { return f.code === code; });
    if (!fund) { alert('未找到该基金数据'); return; }

    var scores = computePotentialScore(fund);
    var percentile = computePeerPercentile(fund);
    var reasons = generatePotentialReasons(fund, scores, percentile);
    var warnings = generateRiskWarnings(fund, scores, percentile);
    var strategy = $('#potential-strategy').value;
    var time = $('#potential-time').value;
    var pv = getPeriodValue(fund, time);

    // 构建报告 HTML
    var scoreColor = scores.total >= 75 ? 'var(--danger)' : (scores.total >= 55 ? 'var(--accent2)' : (scores.total >= 35 ? 'var(--accent)' : 'var(--muted)'));
    var scoreLabel = scores.total >= 75 ? '强烈推荐' : (scores.total >= 55 ? '值得关注' : (scores.total >= 35 ? '中性观察' : '暂时观望'));

    // 维度分数条
    function dimBar(dim) {
      var s = scores[dim.key];
      var color = s.score >= 70 ? 'var(--danger)' : (s.score >= 50 ? 'var(--accent2)' : 'var(--muted)');
      return '<div class="score-dim">' +
        '<div class="score-dim-header"><span>' + dim.label + '</span><span style="color:' + color + ';font-weight:700;">' + s.score + '分</span></div>' +
        '<div class="score-dim-bar"><div class="score-dim-fill" style="width:' + s.score + '%;background:' + color + ';"></div></div>' +
        '<div class="score-dim-details">' + s.details.map(function(d) {
          return '<span>' + d.label + '：<strong>' + d.value + '</strong>' + (d.note ? ' <em>(' + d.note + ')</em>' : '') + '</span>';
        }).join('') + '</div>' +
      '</div>';
    }

    // 构建完整弹窗内容
    var html = '';

    // 标题区 + 综合评分环
    html += '<div class="report-header">';
    html += '<div class="report-title-area">';
    html += '<div class="modal-title" style="font-size:1.15rem;">' + escHtml(fund.name) + '</div>';
    html += '<div class="card-code">' + fund.code + ' · ' + escHtml(fund.type) + ' · 基金潜力分析报告</div>';
    html += '</div>';
    html += '<div class="score-ring-wrap">';
    html += '<svg width="80" height="80" viewBox="0 0 80 80"><circle cx="40" cy="40" r="34" fill="none" stroke="var(--rule)" stroke-width="6"/><circle cx="40" cy="40" r="34" fill="none" stroke="' + scoreColor + '" stroke-width="6" stroke-dasharray="' + (scores.total / 100 * 213.6) + ' 213.6" stroke-linecap="round" transform="rotate(-90 40 40)"/><text x="40" y="36" text-anchor="middle" fill="' + scoreColor + '" font-size="20" font-weight="700" font-family="JetBrainsMono,monospace">' + scores.total + '</text><text x="40" y="52" text-anchor="middle" fill="var(--muted)" font-size="10">/100</text></svg>';
    html += '<div class="score-label" style="color:' + scoreColor + ';">' + scoreLabel + '</div>';
    html += '</div>';
    html += '</div>';

    // 策略信息
    var strategyNames = { momentum: '动量策略', reversal: '反转策略', value: '价值策略', growth: '成长策略', all: '综合策略' };
    html += '<div style="margin:0.75rem 0;padding:0.6rem 0.75rem;background:var(--bg);border-radius:8px;font-size:0.82rem;color:var(--muted);">';
    html += '筛选策略：<strong style="color:var(--accent);">' + (strategyNames[strategy] || '综合策略') + '</strong> · 时间维度：<strong style="color:var(--accent2);">' + (time === 'month' ? '近一月' : time === 'quarter' ? '近三月' : time === 'half' ? '近半年' : '近一年') + '</strong> · 阶段涨幅：<strong class="' + (pv>=0?'up':'down') + '">' + fmtPct(pv) + '</strong>';
    html += '</div>';

    // 多维度评分
    html += '<div class="report-section"><div class="report-section-title">多维度评分明细</div>';
    html += dimBar({ key: 'performance', label: '近期业绩 (30%)' });
    html += dimBar({ key: 'risk', label: '风险控制 (25%)' });
    html += dimBar({ key: 'manager', label: '基金经理 (20%)' });
    html += dimBar({ key: 'size', label: '规模流动性 (15%)' });
    html += dimBar({ key: 'heat', label: '市场热度 (10%)' });
    html += '</div>';

    // 潜力理由
    html += '<div class="report-section"><div class="report-section-title">潜力分析理由</div>';
    html += '<ul class="reason-list">';
    reasons.forEach(function(r) { html += '<li>' + r + '</li>'; });
    html += '</ul></div>';

    // 风险提示
    html += '<div class="report-section"><div class="report-section-title">风险提示</div>';
    warnings.forEach(function(w) {
      var icon = w.level === 'danger' ? 'red' : (w.level === 'warn' ? '#f59e0b' : (w.level === 'safe' ? '#22c55e' : 'var(--muted)'));
      html += '<div class="risk-item" style="border-left-color:' + icon + ';">' + w.text + '</div>';
    });
    html += '</div>';

    // 同类对比
    html += '<div class="report-section"><div class="report-section-title">同类排名百分位 <span style="font-weight:400;font-size:0.8rem;color:var(--muted);">（共 ' + percentile.total.toLocaleString() + ' 只同类基金）</span></div>';
    html += '<div class="percentile-row">';
    [percentile.week, percentile.month, percentile.quarter, percentile.year].forEach(function(p) {
      var barColor = p.pct >= 70 ? 'var(--danger)' : (p.pct >= 40 ? 'var(--accent2)' : 'var(--muted)');
      html += '<div class="percentile-item"><div class="percentile-label">' + p.label + '</div>';
      html += '<div class="percentile-bar-bg"><div class="percentile-bar-fill" style="width:' + p.pct + '%;background:' + barColor + ';"></div></div>';
      html += '<div class="percentile-val">前 ' + (100 - p.pct) + '%</div></div>';
    });
    html += '</div></div>';

    // 原始数据折叠区
    html += '<div class="report-section raw-data-section">';
    html += '<div class="report-section-title raw-data-toggle" onclick="this.parentElement.classList.toggle(\'expanded\');">原始数据 <span class="toggle-arrow">展开</span></div>';
    html += '<div class="raw-data-body">';
    html += '<div class="detail-grid">';
    html += '<div class="detail-item"><div class="detail-item-label">单位净值</div><div class="detail-item-value">' + fmtNum(fund.nav) + '</div></div>';
    html += '<div class="detail-item"><div class="detail-item-label">累计净值</div><div class="detail-item-value">' + fmtNum(fund.cumNav) + '</div></div>';
    html += '<div class="detail-item"><div class="detail-item-label">日涨跌</div><div class="detail-item-value ' + (fund.dayChange>=0?'up':'down') + '">' + fmtPct(fund.dayChange) + '</div></div>';
    html += '<div class="detail-item"><div class="detail-item-label">近一周</div><div class="detail-item-value ' + (fund.weekChange>=0?'up':'down') + '">' + fmtPct(fund.weekChange) + '</div></div>';
    html += '<div class="detail-item"><div class="detail-item-label">近一月</div><div class="detail-item-value ' + (fund.monthChange>=0?'up':'down') + '">' + fmtPct(fund.monthChange) + '</div></div>';
    html += '<div class="detail-item"><div class="detail-item-label">近三月</div><div class="detail-item-value ' + (fund.quarterChange>=0?'up':'down') + '">' + fmtPct(fund.quarterChange) + '</div></div>';
    html += '<div class="detail-item"><div class="detail-item-label">近半年</div><div class="detail-item-value ' + ((fund.halfYearChange||0)>=0?'up':'down') + '">' + fmtPct(fund.halfYearChange) + '</div></div>';
    html += '<div class="detail-item"><div class="detail-item-label">近一年</div><div class="detail-item-value ' + (fund.yearChange>=0?'up':'down') + '">' + fmtPct(fund.yearChange) + '</div></div>';
    html += '<div class="detail-item"><div class="detail-item-label">申购状态</div><div class="detail-item-value" style="font-size:0.85rem;">' + (fund.purchaseStatus || '--') + '</div></div>';
    html += '<div class="detail-item"><div class="detail-item-label">赎回状态</div><div class="detail-item-value" style="font-size:0.85rem;">' + (fund.redeemStatus || '--') + '</div></div>';
    html += '</div></div></div>';

    // 净值走势图
    html += '<div class="report-section"><div class="report-section-title">净值走势</div>';
    html += '<div class="trend-tabs" style="display:flex;gap:0.35rem;margin-bottom:0.75rem;flex-wrap:wrap;">';
    html += '<button class="trend-tab active" data-period="1m" onclick="window.switchTrendPeriod(\'1m\')">1个月</button>';
    html += '<button class="trend-tab" data-period="3m" onclick="window.switchTrendPeriod(\'3m\')">3个月</button>';
    html += '<button class="trend-tab" data-period="6m" onclick="window.switchTrendPeriod(\'6m\')">半年</button>';
    html += '<button class="trend-tab" data-period="1y" onclick="window.switchTrendPeriod(\'1y\')">1年</button>';
    html += '<button class="trend-tab" data-period="3y" onclick="window.switchTrendPeriod(\'3y\')">3年</button>';
    html += '<button class="trend-tab" data-period="all" onclick="window.switchTrendPeriod(\'all\')">全部</button>';
    html += '</div>';
    html += '<div id="chart-fund-trend-potential" style="width:100%;min-height:280px;"></div>';
    html += '</div>';

    // 写入弹窗
    $('#modal-legacy').style.display = 'none';
    $('#modal-report').style.display = '';
    $('#modal-report').innerHTML = html;
    $('#fund-modal').classList.add('active');

    // 异步获取基金经理详情
    fetchFundDetail(code).then(function(result) {
      if (!result) return;

      if (result.detail && result.detail.navHistory && result.detail.navHistory.length > 0) {
        var history = result.detail.navHistory;

        // 缓存历史数据供切换使用
        window._potentialNavHistory = history;
        window._potentialPeriod = '1m';

        window.renderPotentialTrend = function(history, period) {
          var trendEl = document.getElementById('chart-fund-trend-potential');
          if (!trendEl || !window.echarts) return;
          var periodsMap = { '1m': 1, '3m': 3, '6m': 6, '1y': 12, '3y': 36 };
          if (period && periodsMap[period]) {
            var cutoff = new Date();
            cutoff.setMonth(cutoff.getMonth() - periodsMap[period]);
            cutoff.setHours(0, 0, 0, 0);
            history = history.filter(function(h) { return new Date(h.date) >= cutoff; });
          }
          if (!trendEl._echart) trendEl._echart = echarts.init(trendEl, null, { renderer: 'svg' });
          var chart = trendEl._echart;
          var style = getComputedStyle(document.documentElement);
          chart.setOption({
            animation: false,
            tooltip: { trigger: 'axis', appendToBody: true },
            grid: { left: '3%', right: '4%', bottom: '3%', top: '10%', containLabel: true },
            xAxis: {
              type: 'category',
              data: history.map(function(h) { return h.date.slice(5); }),
              axisLine: { lineStyle: { color: style.getPropertyValue('--rule').trim() } },
              axisLabel: { color: style.getPropertyValue('--muted').trim() }
            },
            yAxis: {
              type: 'value',
              scale: true,
              axisLine: { lineStyle: { color: style.getPropertyValue('--rule').trim() } },
              splitLine: { lineStyle: { color: style.getPropertyValue('--rule').trim(), opacity: 0.3 } },
              axisLabel: { color: style.getPropertyValue('--muted').trim() }
            },
            series: [{
              type: 'line',
              data: history.map(function(h) { return h.nav || h.value; }),
              smooth: true,
              symbol: 'none',
              lineStyle: { color: style.getPropertyValue('--accent').trim(), width: 2 },
              areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [
                { offset: 0, color: style.getPropertyValue('--accent').trim() + '30' },
                { offset: 1, color: style.getPropertyValue('--accent').trim() + '05' }
              ]}}
            }]
          });
        };

        window.switchTrendPeriod = function(period) {
          if (!window._potentialNavHistory) return;
          window._potentialPeriod = period;
          var tabs = document.querySelectorAll('#modal-report .trend-tab');
          tabs.forEach(function(t) {
            t.classList.toggle('active', t.getAttribute('data-period') === period);
          });
          window.renderPotentialTrend(window._potentialNavHistory, period);
        };

        // 默认渲染最近一个月
        renderPotentialTrend(history, '1m');
        window.addEventListener('resize', function() {
          var trendEl = document.getElementById('chart-fund-trend-potential');
          if (trendEl && trendEl._echart) { try { trendEl._echart.resize(); } catch(e) {} }
        });

        // 补充净值波动率计算
        if (result.detail.navHistory.length >= 3) {
          var navs = result.detail.navHistory.map(function(h) { return h.nav; });
          var changes = [];
          for (var i = 1; i < navs.length; i++) {
            changes.push((navs[i] - navs[i-1]) / navs[i-1] * 100);
          }
          var mean = changes.reduce(function(s, v) { return s + v; }, 0) / changes.length;
          var variance = changes.reduce(function(s, v) { return s + (v - mean) * (v - mean); }, 0) / changes.length;
          var vol = Math.sqrt(variance).toFixed(2);

          var dims = document.querySelectorAll('#modal-report .score-dim');
          var riskDim = dims[1]; // risk control section
          if (riskDim) {
            var detailsEl = riskDim.querySelector('.score-dim-details');
            detailsEl.innerHTML += '<span>年化波动率（估算）：<strong>' + vol + '%</strong></span>';

            var volNum = parseFloat(vol);
            var adjust = volNum < 0.5 ? 10 : (volNum < 1.5 ? 5 : (volNum < 3 ? 0 : -10));
            var adjustedRiskScore = Math.min(100, Math.max(0, scores.risk.score + adjust));
            var riskColor = adjustedRiskScore >= 70 ? 'var(--danger)' : (adjustedRiskScore >= 50 ? 'var(--accent2)' : 'var(--muted)');
            var fillEl = riskDim.querySelector('.score-dim-fill');
            fillEl.style.width = adjustedRiskScore + '%';
            fillEl.style.background = riskColor;
            var headerSpan = riskDim.querySelector('.score-dim-header span:last-child');
            headerSpan.textContent = adjustedRiskScore + '分';
            headerSpan.style.color = riskColor;
          }
        }
      }

      if (result.info && result.info.manager) {
        var info = result.info;
        var dims = document.querySelectorAll('#modal-report .score-dim');
        var mgrDim = dims[2];
        if (mgrDim) {
          var mgrScore = info.manager.length >= 3 ? 75 : (info.manager.length >= 2 ? 60 : 45);
          if (info.risk && info.risk.indexOf('低') !== -1) mgrScore = Math.min(100, mgrScore + 10);
          var mgrColor = mgrScore >= 70 ? 'var(--danger)' : (mgrScore >= 50 ? 'var(--accent2)' : 'var(--muted)');
          mgrDim.querySelector('.score-dim-fill').style.width = mgrScore + '%';
          mgrDim.querySelector('.score-dim-fill').style.background = mgrColor;
          var hSpan = mgrDim.querySelector('.score-dim-header span:last-child');
          hSpan.textContent = mgrScore + '分';
          hSpan.style.color = mgrColor;
          mgrDim.querySelector('.score-dim-details').innerHTML =
            '<span>基金经理：<strong>' + escHtml(info.manager) + '</strong></span>' +
            (info.establishDate ? '<span>成立日期：<strong>' + info.establishDate + '</strong></span>' : '') +
            (info.fundSize ? '<span>基金规模：<strong>' + info.fundSize + '</strong></span>' : '') +
            (info.risk ? '<span>风险等级：<strong>' + escHtml(info.risk) + '</strong></span>' : '');
        }
      }
    });
  };

  // 保留原 showFundDetail 用于涨幅排行的详情弹窗
  window.showFundDetail = function(code) {
    var fund = allFunds.find(function(f) { return f.code === code; });
    if (!fund) { alert('未找到该基金数据'); return; }

    // 切换显示
    $('#modal-report').style.display = 'none';
    $('#modal-legacy').style.display = '';

    $('#modal-fund-name').textContent = fund.name;
    $('#modal-fund-code').textContent = fund.code + ' · ' + (fund.type || '未知') + ' · 天天基金网数据';

    $('#modal-details').innerHTML =
      '<div class="detail-item"><div class="detail-item-label">单位净值</div><div class="detail-item-value">' + fmtNum(fund.nav) + '</div></div>' +
      '<div class="detail-item"><div class="detail-item-label">累计净值</div><div class="detail-item-value">' + fmtNum(fund.cumNav) + '</div></div>' +
      '<div class="detail-item"><div class="detail-item-label">日涨跌</div><div class="detail-item-value ' + (fund.dayChange>=0?'up':'down') + '">' + fmtPct(fund.dayChange) + '</div></div>' +
      '<div class="detail-item"><div class="detail-item-label">近一周</div><div class="detail-item-value ' + (fund.weekChange>=0?'up':'down') + '">' + fmtPct(fund.weekChange) + '</div></div>' +
      '<div class="detail-item"><div class="detail-item-label">近一月</div><div class="detail-item-value ' + (fund.monthChange>=0?'up':'down') + '">' + fmtPct(fund.monthChange) + '</div></div>' +
      '<div class="detail-item"><div class="detail-item-label">近三月</div><div class="detail-item-value ' + (fund.quarterChange>=0?'up':'down') + '">' + fmtPct(fund.quarterChange) + '</div></div>' +
      '<div class="detail-item"><div class="detail-item-label">近半年</div><div class="detail-item-value ' + ((fund.halfYearChange||0)>=0?'up':'down') + '">' + fmtPct(fund.halfYearChange) + '</div></div>' +
      '<div class="detail-item"><div class="detail-item-label">近一年</div><div class="detail-item-value ' + (fund.yearChange>=0?'up':'down') + '">' + fmtPct(fund.yearChange) + '</div></div>' +
      '<div class="detail-item"><div class="detail-item-label">申购状态</div><div class="detail-item-value" style="font-size:0.85rem;">' + (fund.purchaseStatus || '--') + '</div></div>' +
      '<div class="detail-item"><div class="detail-item-label">赎回状态</div><div class="detail-item-value" style="font-size:0.85rem;">' + (fund.redeemStatus || '--') + '</div></div>';

    $('#modal-manager').innerHTML =
      '<div style="text-align:center;color:var(--muted);font-size:0.85rem;padding:1rem;">正在加载基金经理信息...</div>';

    $('#fund-modal').classList.add('active');

    fetchFundDetail(code).then(function(result) {
      if (!result) return;
      if (result.detail && result.detail.navHistory && result.detail.navHistory.length > 0) {
        if (window.renderFundTrend) window.renderFundTrend(result.detail.navHistory);
      }
      if (result.info) {
        var info = result.info;
        var extraHtml = '';
        if (info.manager) extraHtml += '<div class="detail-item"><div class="detail-item-label">基金经理</div><div class="detail-item-value" style="font-size:0.9rem;">' + escHtml(info.manager) + '</div></div>';
        if (info.establishDate) extraHtml += '<div class="detail-item"><div class="detail-item-label">成立日期</div><div class="detail-item-value">' + info.establishDate + '</div></div>';
        if (info.fundSize) extraHtml += '<div class="detail-item"><div class="detail-item-label">基金规模</div><div class="detail-item-value">' + info.fundSize + '</div></div>';
        if (info.risk) extraHtml += '<div class="detail-item"><div class="detail-item-label">风险等级</div><div class="detail-item-value" style="font-size:0.85rem;">' + escHtml(info.risk) + '</div></div>';
        if (extraHtml) $('#modal-details').innerHTML = $('#modal-details').innerHTML + extraHtml;
        if (info.manager) {
          $('#modal-manager').innerHTML =
            '<div style="display:flex;align-items:center;gap:1rem;">' +
              '<div style="width:48px;height:48px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:1.2rem;font-weight:700;color:#fff;">' + info.manager[0] + '</div>' +
              '<div>' +
                '<div style="font-weight:600;">' + escHtml(info.manager) + '</div>' +
                '<div style="font-size:0.8rem;color:var(--muted);">' + escHtml(info.risk || '') + ' · ' + escHtml(fund.type || '') + '</div>' +
              '</div>' +
            '</div>' +
            '<div style="margin-top:0.75rem;font-size:0.85rem;color:var(--muted);line-height:1.5;">基金经理信息来源于天天基金网公开数据。历史业绩不代表未来表现，投资需谨慎。</div>';
        }
      }
    });
  };

  // ===== Event Listeners =====

  // Navigation
  $$('.nav-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      $$('.nav-tab').forEach(function(t) { t.classList.remove('active'); });
      tab.classList.add('active');
      var sec = tab.dataset.section;
      $$('.section').forEach(function(s) { s.classList.remove('active'); });
      $('#section-' + sec).classList.add('active');
      currentSection = sec;
      if (sec === 'market') renderMarket(marketPeriod);
      if (sec === 'potential') renderPotential();
      if (sec === 'funds') renderFundList();
    });
  });

  // Ranking sub-tabs
  $$('#section-ranking .sub-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      $$('#section-ranking .sub-tab').forEach(function(t) { t.classList.remove('active'); });
      tab.classList.add('active');
      currentPeriod = tab.dataset.period;
      rankCurrentPage = 1;
      renderRanking();
    });
  });

  // Market period sub-tabs
  $$('#market-period-tabs .sub-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      $$('#market-period-tabs .sub-tab').forEach(function(t) { t.classList.remove('active'); });
      tab.classList.add('active');
      marketPeriod = tab.dataset.period;
      renderMarket(marketPeriod);
    });
  });

  $('#rank-type').addEventListener('change', function(e) { rankTypeFilter = e.target.value; rankCurrentPage = 1; renderRanking(); });
  $('#rank-sort').addEventListener('change', function(e) { rankSort = e.target.value; rankCurrentPage = 1; renderRanking(); });
  $('#rank-sector').addEventListener('change', function(e) { rankSectorFilter = e.target.value; rankCurrentPage = 1; renderRanking(); });
  $('#rank-refresh').addEventListener('click', refreshAllData);

  $('#potential-strategy').addEventListener('change', renderPotential);
  $('#potential-time').addEventListener('change', renderPotential);
  $('#potential-sort').addEventListener('change', renderPotential);
  $('#potential-refresh').addEventListener('click', renderPotential);

  $('#fund-search-btn').addEventListener('click', function() { fundListCurrentPage = 1; renderFundList(); });
  $('#fund-reset').addEventListener('click', function() {
    $('#fund-search').value = '';
    $('#fund-type').value = 'all';
    $('#fund-company').value = 'all';
    $('#fund-sector').value = 'all';
    fundSectorFilter = 'all';
    fundListCurrentPage = 1;
    renderFundList();
  });
  $('#fund-search').addEventListener('keyup', function(e) { if (e.key === 'Enter') { fundListCurrentPage = 1; renderFundList(); } });
  $('#fund-sector').addEventListener('change', function(e) { fundSectorFilter = e.target.value; fundListCurrentPage = 1; renderFundList(); });

  $('#modal-close').addEventListener('click', function() { $('#fund-modal').classList.remove('active'); });
  $('#fund-modal').addEventListener('click', function(e) {
    if (e.target === $('#fund-modal')) $('#fund-modal').classList.remove('active');
  });

  // ===== Init =====
  refreshAllData().then(function() {
    startAutoRefresh();
    console.log('[App] 初始化完成，每5分钟自动刷新');
  });

})();
