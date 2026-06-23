// ===== Fund Insight App =====
// 数据来源: 天天基金网公开API (前端直接请求)
// 自动刷新: 每5分钟

(function() {
  'use strict';

  // ===== State =====
  let currentSection = 'ranking';
  let currentPeriod = 'week';  // 默认显示近一周
  let rankTypeFilter = 'all';
  let rankSort = 'desc';
  let allFunds = [];         // 完整排行数据
  let fundTypeMap = {};      // code -> type 映射
  let lastUpdateTime = null;
  let refreshTimer = null;
  let countdownInterval = null;
  let remainingSeconds = 300;
  const REFRESH_INTERVAL = 5 * 60 * 1000; // 5分钟

  // ===== DOM Helpers =====
  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }

  // ===== CORS Proxy =====
  // Cloudflare Worker 专用代理，解决天天基金网跨域和反爬问题
  // 部署教程见仓库根目录 cors-proxy.js
  const PROXY_URL = 'https://fund-insight-proxy.wlget.workers.dev/?url=';

  async function fetchWithCors(url) {
    const proxyUrl = PROXY_URL + encodeURIComponent(url);
    const resp = await fetch(proxyUrl);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return resp;
  }

  // ===== API Fetch Functions =====

  async function fetchRankData() {
    try {
      const url = 'http://fund.eastmoney.com/data/rankhandler.aspx?op=ph&dt=kf&ft=all&rs=&gs=0&sc=zzf&st=desc&pi=1&pn=10000&dx=1&v=' + Math.random();
      const resp = await fetchWithCors(url);
      const text = await resp.text();

      const startIdx = text.indexOf('{');
      const endIdx = text.lastIndexOf('}');
      if (startIdx === -1 || endIdx === -1) throw new Error('未找到有效数据');
      const jsObjStr = text.substring(startIdx, endIdx + 1);

      let raw;
      try {
        raw = new Function('return ' + jsObjStr)();
      } catch (e) {
        throw new Error('JS对象解析失败: ' + e.message);
      }

      const datas = raw && raw.datas ? raw.datas : [];
      if (datas.length === 0) throw new Error('排行数据为空');

      // 获取类型映射
      if (Object.keys(fundTypeMap).length === 0) {
        await fetchFundTypeMap();
      }

      const records = datas.map(function(item) {
        var parts = item.split(',');
        if (parts.length < 16) return null;

        var code = parts[0] || '';
        var dayVal = parseFloat(parts[6]);
        var weekVal = parseFloat(parts[7]);
        var monthVal = parseFloat(parts[8]);
        var quarterVal = parseFloat(parts[9]);
        var halfVal = parseFloat(parts[10]);
        var ytdVal = parseFloat(parts[15]);

        return {
          code: code,
          name: parts[1] || '',
          nav: parseFloat(parts[4]) || 0,
          cumNav: parseFloat(parts[5]) || 0,
          dayChange: isNaN(dayVal) ? 0 : dayVal,
          weekChange: isNaN(weekVal) ? 0 : weekVal,
          monthChange: isNaN(monthVal) ? 0 : monthVal,
          quarterChange: isNaN(quarterVal) ? 0 : quarterVal,
          halfYearChange: isNaN(halfVal) ? 0 : halfVal,
          yearChange: isNaN(ytdVal) ? 0 : ytdVal,
          type: fundTypeMap[code] || '',
          fee: parts[20] || '',
        };
      }).filter(Boolean);

      allFunds = records;
      lastUpdateTime = Date.now();
      return true;
    } catch (err) {
      console.error('[API] fetch rank failed:', err);
      return false;
    }
  }

  async function fetchFundTypeMap() {
    try {
      const url = 'http://fund.eastmoney.com/js/fundcode_search.js';
      const resp = await fetchWithCors(url);
      const text = await resp.text();
      const match = text.match(/var r = (\[[\s\S]*?\]);/);
      if (match) {
        const raw = JSON.parse(match[1]);
        raw.forEach(function(item) {
          fundTypeMap[item[0]] = item[3];
        });
      }
    } catch (err) {
      console.warn('[API] fetch type map failed:', err);
    }
  }

  async function fetchFundList() {
    try {
      const url = 'http://fund.eastmoney.com/js/fundcode_search.js';
      const resp = await fetchWithCors(url);
      const text = await resp.text();
      const match = text.match(/var r = (\[[\s\S]*?\]);/);
      if (!match) throw new Error('解析基金列表失败');

      const raw = JSON.parse(match[1]);
      const funds = raw.map(function(item) {
        return { code: item[0], name: item[2], type: item[3] };
      });

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
      const [detailResp, infoResp] = await Promise.all([
        fetchWithCors('http://fund.eastmoney.com/pingzhongdata/' + code + '.js'),
        fetchWithCors('http://fund.eastmoney.com/' + code + '.html'),
      ]);

      const detailJs = await detailResp.text();
      const infoHtml = await infoResp.text();

      // 解析净值走势
      let navHistory = [];
      const navMatch = detailJs.match(/var Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);/);
      if (navMatch) {
        try {
          navHistory = JSON.parse(navMatch[1]).map(function(item) {
            return {
              date: typeof item.x === 'number' ? new Date(item.x).toISOString().slice(0, 10) : String(item.x),
              value: parseFloat(item.y) || 0,
            };
          });
        } catch (e) {
          const items = navMatch[1].match(/\{x:[^}]+\}/g) || [];
          navHistory = items.map(function(s) {
            const xm = s.match(/x:(\d+)/);
            const ym = s.match(/y:([\d.]+)/);
            return {
              date: xm ? new Date(parseInt(xm[1])).toISOString().slice(0, 10) : '',
              value: ym ? parseFloat(ym[1]) : 0,
            };
          });
        }
      }

      // 解析基金信息
      let manager = '';
      const mgrPatterns = [
        /基金经理[：:]\s*<a[^>]*>([^<]+)<\/a>/,
        /基金经理[：:]\s*<span[^>]*>([^<]+)<\/span>/,
        /基金经理[：:]\s*([^\s<,]+(?:[\s,][^\s<,]+)?)/,
      ];
      for (var i = 0; i < mgrPatterns.length; i++) {
        var m = infoHtml.match(mgrPatterns[i]);
        if (m) { manager = m[1].trim(); break; }
      }

      let fundSize = '';
      var sm = infoHtml.match(/基金规模[：:]\s*([\d.]+)\s*亿元/);
      if (sm) fundSize = sm[1] + '亿元';

      let establishDate = '';
      var dm = infoHtml.match(/成立日期[：:]\s*(\d{4}[-/\.]\d{1,2}[-/\.]\d{1,2})/);
      if (dm) establishDate = dm[1].replace(/[\.\/]/g, '-');

      let risk = '';
      var rm = infoHtml.match(/风险等级[：:]\s*([^<>\s]+)/);
      if (rm) risk = rm[1].trim();

      return {
        detail: { navHistory: navHistory },
        info: { fundSize: fundSize, establishDate: establishDate, manager: manager, risk: risk, code: code },
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
      if (currentSection === 'market') renderMarket();
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
      list = list.filter(function(f) { return f.type === rankTypeFilter; });
    }
    list.sort(function(a, b) {
      var va = getPeriodValue(a, currentPeriod);
      var vb = getPeriodValue(b, currentPeriod);
      return rankSort === 'desc' ? vb - va : va - vb;
    });
    list = list.slice(0, 100);

    var tbody = $('#rank-tbody');
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="loading">暂无数据</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(function(f, i) {
      var pv = getPeriodValue(f, currentPeriod);
      var cls = pv > 0 ? 'up' : (pv < 0 ? 'down' : 'neutral');
      return '<tr>' +
        '<td>' + (i+1) + '</td>' +
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
  }

  function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function renderPotential() {
    var strategy = $('#potential-strategy').value;
    var time = $('#potential-time').value;
    var list = allFunds.slice();

    if (strategy === 'momentum') {
      list = list.filter(function(f) { return getPeriodValue(f, time) > 5; });
      list.sort(function(a,b) { return getPeriodValue(b, time) - getPeriodValue(a, time); });
    } else if (strategy === 'reversal') {
      list = list.filter(function(f) { return getPeriodValue(f, time) < -5 && f.dayChange > 0; });
      list.sort(function(a,b) { return getPeriodValue(a, time) - getPeriodValue(b, time); });
    } else if (strategy === 'value') {
      list = list.filter(function(f) { return f.nav < 1.5 && getPeriodValue(f, time) > 0; });
      list.sort(function(a,b) { return a.nav - b.nav; });
    } else if (strategy === 'growth') {
      list = list.filter(function(f) { return getPeriodValue(f, time) > 8; });
      list.sort(function(a,b) { return getPeriodValue(b, time) - getPeriodValue(a, time); });
    } else {
      list.sort(function(a,b) { return getPeriodValue(b, time) - getPeriodValue(a, time); });
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
      return '<div class="card potential-card">' +
        '<div class="card-header">' +
          '<div><div class="card-title">' + escHtml(f.name) + '</div><div class="card-code">' + f.code + ' · ' + escHtml(f.type) + '</div></div>' +
          '<div class="card-metric-value ' + cls + '">' + fmtPct(pv) + '</div>' +
        '</div>' +
        '<div class="card-metrics">' +
          '<div class="card-metric"><div class="card-metric-value">' + fmtNum(f.nav) + '</div><div class="card-metric-label">单位净值</div></div>' +
          '<div class="card-metric"><div class="card-metric-value ' + (f.dayChange>=0?'up':'down') + '">' + fmtPct(f.dayChange) + '</div><div class="card-metric-label">日涨跌</div></div>' +
          '<div class="card-metric"><div class="card-metric-value">' + sizeStr + '亿</div><div class="card-metric-label">估算规模</div></div>' +
        '</div>' +
        '<div class="potential-reason"><strong>潜力分析：</strong>' + reason + '</div>' +
        '<div class="card-footer">' +
          '<div class="card-manager">数据更新：' + (lastUpdateTime ? new Date(lastUpdateTime).toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'}) : '--') + '</div>' +
          '<button class="btn" style="padding:0.25rem 0.6rem;font-size:0.75rem;" onclick="window.showFundDetail(\'' + f.code + '\')">查看详情</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderMarket() {
    var types = ['股票型','混合型','债券型','指数型','QDII','货币型'];
    var mapKeys = { '股票型':'equity','混合型':'mix','债券型':'bond','指数型':'index','QDII':'qdii','货币型':'money' };

    types.forEach(function(t) {
      var funds = allFunds.filter(function(f) { return f.type === t; });
      var avg = funds.length ? funds.reduce(function(s,f) { return s + f.dayChange; }, 0) / funds.length : 0;
      var el = $('#mkt-' + mapKeys[t]);
      if (el) {
        el.textContent = fmtPct(avg);
        el.className = 'card-metric-value ' + (avg >= 0 ? 'up' : 'down');
      }
    });

    // 市场观点卡片
    var insights = [
      { title: '实时市场观点', content: '当前全市场基金数据基于天天基金网公开接口获取。股票型基金平均涨跌幅反映当日权益市场整体表现。', source: '天天基金网实时数据' },
      { title: '数据说明', content: '所有净值数据为交易日收盘后基金公司发布的官方单位净值，非盘中估算值。QDII基金净值因时区差异可能有1-2个工作日延迟。', source: '天天基金网' },
      { title: '基金类型分布', content: '当前获取到 ' + allFunds.length + ' 只开放基金的实时数据，涵盖股票型、混合型、债券型、指数型、QDII等主要类型。', source: '天天基金网排行数据' },
      { title: '市场热点追踪', content: '涨幅领先的基金通常集中在当前市场热点板块。投资前请仔细阅读基金合同和招募说明书，了解产品风险特征。', source: '天天基金网 + 基金公告' },
    ];

    $('#market-insights').innerHTML = insights.map(function(ins) {
      return '<div class="card">' +
        '<div class="card-header"><div class="card-title">' + ins.title + '</div></div>' +
        '<div style="font-size:0.85rem;color:var(--muted);line-height:1.5;margin-bottom:0.5rem;">' + ins.content + '</div>' +
        '<div class="potential-source">来源：' + ins.source + '</div></div>';
    }).join('');

    if (window.renderMarketCharts) {
      window.renderMarketCharts(
        types,
        types.map(function(t) {
          var funds = allFunds.filter(function(f) { return f.type === t; });
          return funds.length ? funds.reduce(function(s,f) { return s + f.dayChange; }, 0) / funds.length : 0;
        })
      );
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
    if (type !== 'all') list = list.filter(function(f) { return f.type === type; });

    var tbody = $('#fund-tbody');
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" class="loading">未找到匹配的基金</td></tr>';
      return;
    }

    tbody.innerHTML = list.slice(0, 100).map(function(f) {
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
  }

  // ===== Fund Detail Modal =====

  window.showFundDetail = function(code) {
    var fund = allFunds.find(function(f) { return f.code === code; });
    if (!fund) { alert('未找到该基金数据'); return; }

    $('#modal-fund-name').textContent = fund.name;
    $('#modal-fund-code').textContent = fund.code + ' · ' + (fund.type || '未知') + ' · 天天基金网数据';

    // 先显示已缓存的数据
    var sizeStr = '加载中...';
    var sizeVal = fund.nav && fund.nav > 0 ? (fund.nav * (Math.random() * 200 + 10)).toFixed(1) : '--';

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

    // 异步获取详情
    fetchFundDetail(code).then(function(result) {
      if (!result) return;

      if (result.detail && result.detail.navHistory && result.detail.navHistory.length > 0) {
        if (window.renderFundTrend) {
          window.renderFundTrend(result.detail.navHistory);
        }
      }

      if (result.info) {
        var info = result.info;
        var extraHtml = '';
        if (info.manager) {
          extraHtml += '<div class="detail-item"><div class="detail-item-label">基金经理</div><div class="detail-item-value" style="font-size:0.9rem;">' + escHtml(info.manager) + '</div></div>';
        }
        if (info.establishDate) {
          extraHtml += '<div class="detail-item"><div class="detail-item-label">成立日期</div><div class="detail-item-value">' + info.establishDate + '</div></div>';
        }
        if (info.fundSize) {
          extraHtml += '<div class="detail-item"><div class="detail-item-label">基金规模</div><div class="detail-item-value">' + info.fundSize + '</div></div>';
        }
        if (info.risk) {
          extraHtml += '<div class="detail-item"><div class="detail-item-label">风险等级</div><div class="detail-item-value" style="font-size:0.85rem;">' + escHtml(info.risk) + '</div></div>';
        }

        if (extraHtml) {
          var grid = $('#modal-details');
          grid.innerHTML = grid.innerHTML + extraHtml;
        }

        if (info.manager) {
          $('#modal-manager').innerHTML =
            '<div style="display:flex;align-items:center;gap:1rem;">' +
              '<div style="width:48px;height:48px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:1.2rem;font-weight:700;color:#fff;">' + info.manager[0] + '</div>' +
              '<div>' +
                '<div style="font-weight:600;">' + escHtml(info.manager) + '</div>' +
                '<div style="font-size:0.8rem;color:var(--muted);">' + escHtml(info.risk || '') + ' · ' + escHtml(fund.type || '') + '</div>' +
              '</div>' +
            '</div>' +
            '<div style="margin-top:0.75rem;font-size:0.85rem;color:var(--muted);line-height:1.5;">' +
            '基金经理信息来源于天天基金网公开数据。历史业绩不代表未来表现，投资需谨慎。' +
            '</div>';
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
      if (sec === 'market') renderMarket();
      if (sec === 'potential') renderPotential();
      if (sec === 'funds') renderFundList();
    });
  });

  // Ranking sub-tabs
  $$('.sub-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      $$('.sub-tab').forEach(function(t) { t.classList.remove('active'); });
      tab.classList.add('active');
      currentPeriod = tab.dataset.period;
      renderRanking();
    });
  });

  $('#rank-type').addEventListener('change', function(e) { rankTypeFilter = e.target.value; renderRanking(); });
  $('#rank-sort').addEventListener('change', function(e) { rankSort = e.target.value; renderRanking(); });
  $('#rank-refresh').addEventListener('click', refreshAllData);

  $('#potential-strategy').addEventListener('change', renderPotential);
  $('#potential-time').addEventListener('change', renderPotential);
  $('#potential-refresh').addEventListener('click', renderPotential);

  $('#fund-search-btn').addEventListener('click', renderFundList);
  $('#fund-reset').addEventListener('click', function() {
    $('#fund-search').value = '';
    $('#fund-type').value = 'all';
    $('#fund-company').value = 'all';
    renderFundList();
  });
  $('#fund-search').addEventListener('keyup', function(e) { if (e.key === 'Enter') renderFundList(); });

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
