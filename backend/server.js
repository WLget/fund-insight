// ===== 基金洞察 后端代理服务 =====
// 对接天天基金网公开 API 获取真实数据
// 每5分钟自动刷新缓存，避免对源站发起过多请求

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const vm = require('vm');

const app = express();
const PORT = 3000;
const CACHE_TTL = 4 * 60 * 1000; // 缓存有效期4分钟（配合前端5分钟刷新）

// ===== 缓存系统 =====
const cache = {};

function getCache(key) {
  if (cache[key] && Date.now() - cache[key].time < CACHE_TTL) {
    return cache[key].data;
  }
  return null;
}

function setCache(key, data) {
  cache[key] = { data, time: Date.now() };
}

// HTTP 客户端通用配置
const http = axios.create({
  timeout: 30000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Referer': 'http://fund.eastmoney.com/',
  }
});

// ===== 中间件 =====
app.use(cors());
app.use(express.json());

// 静态文件服务 - 直接托管前端页面
app.use(express.static(path.join(__dirname, '..')));

// ===== 类型映射缓存（由 fund-list 接口填充） =====
let typeMap = {};

/**
 * 刷新类型映射
 */
async function refreshTypeMap() {
  try {
    const cached = getCache('type-map');
    if (cached) { typeMap = cached; return; }

    const resp = await http.get('http://fund.eastmoney.com/js/fundcode_search.js');
    const match = resp.data.match(/var r = (\[[\s\S]*?\]);/);
    if (match) {
      const raw = JSON.parse(match[1]);
      const map = {};
      raw.forEach(item => { map[item[0]] = item[3]; });
      typeMap = map;
      setCache('type-map', map);
    }
  } catch (err) {
    console.error('[TypeMap] 刷新失败:', err.message);
  }
}
// 启动时刷新一次
refreshTypeMap();

// ===== API 路由 =====

/**
 * GET /api/fund-list
 * 获取全市场基金列表（代码、名称、类型）
 */
app.get('/api/fund-list', async (req, res) => {
  try {
    const cached = getCache('fund-list');
    if (cached) return res.json({ code: 0, data: cached });

    const resp = await http.get('http://fund.eastmoney.com/js/fundcode_search.js');
    const match = resp.data.match(/var r = (\[[\s\S]*?\]);/);
    if (!match) throw new Error('解析基金列表失败');

    const raw = JSON.parse(match[1]);
    const funds = raw.map(item => ({
      code: item[0],
      name: item[2],
      type: item[3],
    }));

    setCache('fund-list', funds);
    res.json({ code: 0, data: funds });
  } catch (err) {
    console.error('[API Error] /api/fund-list:', err.message);
    res.json({ code: -1, msg: '获取基金列表失败: ' + err.message });
  }
});

/**
 * GET /api/rank
 * 获取基金排行数据
 * 来源: 天天基金网 rankhandler.aspx
 *
 * rankhandler 返回 JSONP 格式:
 * var rankData = {datas:[...], allRecords:N, ...};
 * datas 中的每条数据是 CSV 格式:
 *   0:code,1:name,2:pinyin,3:date,4:unitNav,5:cumNav,6:day%,7:1w%,8:1m%,9:3m%,10:6m%,
 *   11-14:(空),15:今年来%,16:成立来%,17:成立日,18:状态,19:值,20:费率,21:折扣,22:状态,23-24:其他
 */
app.get('/api/rank', async (req, res) => {
  try {
    const cacheKey = 'rank';
    const cached = getCache(cacheKey);
    if (cached) return res.json({ code: 0, data: cached, time: cache[cacheKey].time });

    const url = 'http://fund.eastmoney.com/data/rankhandler.aspx?op=ph&dt=kf&ft=all&rs=&gs=0&sc=zzf&st=desc&pi=1&pn=10000&dx=1&v=' + Math.random();
    const resp = await http.get(url);
    // rankhandler 返回的是 JS 对象字面量（非 JSON），使用 vm 模块安全解析
    const startIdx = resp.data.indexOf('{');
    const endIdx = resp.data.lastIndexOf('}');
    if (startIdx === -1 || endIdx === -1) throw new Error('未找到有效数据');
    const jsObjStr = resp.data.substring(startIdx, endIdx + 1);

    let raw;
    try {
      const ctx = vm.createContext({});
      const script = new vm.Script('raw = ' + jsObjStr);
      script.runInContext(ctx);
      raw = ctx.raw;
    } catch (e) {
      throw new Error('JS对象解析失败: ' + e.message);
    }

    const datas = raw && raw.datas ? raw.datas : [];
    if (datas.length === 0) throw new Error('排行数据为空');
    // 异步补充类型映射
    if (Object.keys(typeMap).length === 0) await refreshTypeMap();

    const records = datas.map(item => {
      const parts = item.split(',');
      if (parts.length < 16) return null;

      const code = parts[0] || '';
      const dayVal = parseFloat(parts[6]);
      const weekVal = parseFloat(parts[7]);
      const monthVal = parseFloat(parts[8]);
      const quarterVal = parseFloat(parts[9]);
      const halfVal = parseFloat(parts[10]);
      const ytdVal = parseFloat(parts[15]); // 今年来

      return {
        code,
        name: parts[1] || '',
        nav: parseFloat(parts[4]) || 0,
        cumNav: parseFloat(parts[5]) || 0,
        dayChange: isNaN(dayVal) ? 0 : dayVal,
        weekChange: isNaN(weekVal) ? 0 : weekVal,
        monthChange: isNaN(monthVal) ? 0 : monthVal,
        quarterChange: isNaN(quarterVal) ? 0 : quarterVal,
        halfYearChange: isNaN(halfVal) ? 0 : halfVal,
        yearChange: isNaN(ytdVal) ? 0 : ytdVal, // 今年来作为年涨幅参考
        type: typeMap[code] || '',
        fee: parts[20] || '',
      };
    }).filter(Boolean);

    setCache(cacheKey, records);
    res.json({ code: 0, data: records, time: Date.now() });
  } catch (err) {
    console.error('[API Error] /api/rank:', err.message);
    res.json({ code: -1, msg: '获取排行数据失败: ' + err.message, data: [] });
  }
});

/**
 * GET /api/fund/:code/detail
 * 获取单只基金详情（净值走势）
 * 来源: 天天基金网 pingzhongdata/{code}.js
 */
app.get('/api/fund/:code/detail', async (req, res) => {
  try {
    const { code } = req.params;
    const cacheKey = `detail-${code}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json({ code: 0, data: cached });

    const resp = await http.get(`http://fund.eastmoney.com/pingzhongdata/${code}.js`);
    const js = resp.data;

    // 解析净值走势
    let navHistory = [];
    const navMatch = js.match(/var Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);/);
    if (navMatch) {
      try {
        navHistory = JSON.parse(navMatch[1]).map(item => ({
          date: typeof item.x === 'number' ? new Date(item.x).toISOString().slice(0, 10) : String(item.x),
          value: parseFloat(item.y) || 0,
        }));
      } catch (e) {
        // 净值数据可能很大，尝试用正则逐条提取
        const items = navMatch[1].match(/\{x:[^}]+\}/g) || [];
        navHistory = items.map(s => {
          const xm = s.match(/x:(\d+)/);
          const ym = s.match(/y:([\d.]+)/);
          return {
            date: xm ? new Date(parseInt(xm[1])).toISOString().slice(0, 10) : '',
            value: ym ? parseFloat(ym[1]) : 0,
          };
        });
      }
    }

    const result = { navHistory };
    setCache(cacheKey, result);
    res.json({ code: 0, data: result });
  } catch (err) {
    console.error(`[API Error] /api/fund/${req.params.code}/detail:`, err.message);
    res.json({ code: -1, msg: '获取基金详情失败: ' + err.message });
  }
});

/**
 * GET /api/fund/:code/info
 * 获取基金基本信息（规模、成立日期、基金经理等）
 * 来源: 天天基金网 fund.html 页面抓取
 */
app.get('/api/fund/:code/info', async (req, res) => {
  try {
    const { code } = req.params;
    const cacheKey = `info-${code}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json({ code: 0, data: cached });

    const resp = await http.get(`http://fund.eastmoney.com/${code}.html`);
    const html = resp.data;

    // 提取基金经理 (多种正则匹配方式)
    let manager = '';
    const mgrPatterns = [
      /基金经理[：:]\s*<a[^>]*>([^<]+)<\/a>/,
      /基金经理[：:]\s*<span[^>]*>([^<]+)<\/span>/,
      /基金经理[：:]\s*([^\s<,]+(?:[\s,][^\s<,]+)?)/,
    ];
    for (const pat of mgrPatterns) {
      const m = html.match(pat);
      if (m) { manager = m[1].trim(); break; }
    }

    // 提取基金规模（单位：亿元）
    let fundSize = '';
    const sizePat = /基金规模[：:]\s*([\d.]+)\s*亿元/;
    const sm = html.match(sizePat);
    if (sm) fundSize = sm[1] + '亿元';

    // 提取成立日期
    let establishDate = '';
    const datePat = /成立日期[：:]\s*(\d{4}[-/\.]\d{1,2}[-/\.]\d{1,2})/;
    const dm = html.match(datePat);
    if (dm) establishDate = dm[1].replace(/[\.\/]/g, '-');

    // 提取风险等级
    let risk = '';
    const riskPat = /风险等级[：:]\s*([^<>\s]+)/;
    const rm = html.match(riskPat);
    if (rm) risk = rm[1].trim();

    const result = { fundSize, establishDate, manager, risk, code };
    setCache(cacheKey, result);
    res.json({ code: 0, data: result });
  } catch (err) {
    console.error(`[API Error] /api/fund/${req.params.code}/info:`, err.message);
    res.json({ code: -1, msg: '获取基金信息失败: ' + err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), funds: Object.keys(typeMap).length });
});

// ===== 启动 =====
app.listen(PORT, '0.0.0.0', () => {
  console.log('=================================');
  console.log('  基金洞察 后端代理服务已启动');
  console.log(`  端口: ${PORT}`);
  console.log(`  访问: http://localhost:${PORT}/`);
  console.log(`  数据: 天天基金网实时数据 (5分钟刷新)`);
  console.log('=================================');
});