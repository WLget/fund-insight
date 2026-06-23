// ===== Cloudflare Pages Function: 基金数据代理 =====
// 路径: /api/*  ->  转发到天天基金网获取真实数据
// 部署: 放入 Cloudflare Pages 项目的 functions/api/[[path]].js

// ===== 缓存工具 =====
const CACHE_TTL = 240; // 4分钟 (秒)

async function getCache(env, key) {
  if (!env.FUND_CACHE) return null;
  try {
    const val = await env.FUND_CACHE.get(key);
    if (val) {
      const parsed = JSON.parse(val);
      if (Date.now() - parsed.time < CACHE_TTL * 1000) {
        return parsed.data;
      }
    }
  } catch (e) {}
  return null;
}

async function setCache(env, key, data) {
  if (!env.FUND_CACHE) return;
  try {
    await env.FUND_CACHE.put(key, JSON.stringify({ data, time: Date.now() }), { expirationTtl: CACHE_TTL });
  } catch (e) {}
}

// ===== HTTP 请求工具 =====
async function fetchEastMoney(url) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Referer': 'http://fund.eastmoney.com/',
    },
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return resp;
}

// ===== 类型映射缓存 =====
let typeMap = {};

async function refreshTypeMap(env) {
  const cached = await getCache(env, 'type-map');
  if (cached) { typeMap = cached; return; }

  const resp = await fetchEastMoney('http://fund.eastmoney.com/js/fundcode_search.js');
  const text = await resp.text();
  const match = text.match(/var r = (\[[\s\S]*?\]);/);
  if (match) {
    const raw = JSON.parse(match[1]);
    const map = {};
    raw.forEach(item => { map[item[0]] = item[3]; });
    typeMap = map;
    await setCache(env, 'type-map', map);
  }
}

// ===== 路由处理 =====

async function handleRank(request, env) {
  const cacheKey = 'rank';
  const cached = await getCache(env, cacheKey);
  if (cached) return jsonResponse({ code: 0, data: cached, time: Date.now() });

  const url = 'http://fund.eastmoney.com/data/rankhandler.aspx?op=ph&dt=kf&ft=all&rs=&gs=0&sc=zzf&st=desc&pi=1&pn=10000&dx=1&v=' + Math.random();
  const resp = await fetchEastMoney(url);
  const text = await resp.text();

  const startIdx = text.indexOf('{');
  const endIdx = text.lastIndexOf('}');
  if (startIdx === -1 || endIdx === -1) throw new Error('未找到有效数据');
  const jsObjStr = text.substring(startIdx, endIdx + 1);

  let raw;
  try {
    // 使用 Function 构造器安全解析 JS 对象字面量
    raw = new Function('return ' + jsObjStr)();
  } catch (e) {
    throw new Error('JS对象解析失败: ' + e.message);
  }

  const datas = raw && raw.datas ? raw.datas : [];
  if (datas.length === 0) throw new Error('排行数据为空');

  if (Object.keys(typeMap).length === 0) await refreshTypeMap(env);

  const records = datas.map(item => {
    const parts = item.split(',');
    if (parts.length < 16) return null;

    const code = parts[0] || '';
    const dayVal = parseFloat(parts[6]);
    const weekVal = parseFloat(parts[7]);
    const monthVal = parseFloat(parts[8]);
    const quarterVal = parseFloat(parts[9]);
    const halfVal = parseFloat(parts[10]);
    const ytdVal = parseFloat(parts[15]);

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
      yearChange: isNaN(ytdVal) ? 0 : ytdVal,
      type: typeMap[code] || '',
      fee: parts[20] || '',
    };
  }).filter(Boolean);

  await setCache(env, cacheKey, records);
  return jsonResponse({ code: 0, data: records, time: Date.now() });
}

async function handleFundList(request, env) {
  const cached = await getCache(env, 'fund-list');
  if (cached) return jsonResponse({ code: 0, data: cached });

  const resp = await fetchEastMoney('http://fund.eastmoney.com/js/fundcode_search.js');
  const text = await resp.text();
  const match = text.match(/var r = (\[[\s\S]*?\]);/);
  if (!match) throw new Error('解析基金列表失败');

  const raw = JSON.parse(match[1]);
  const funds = raw.map(item => ({ code: item[0], name: item[2], type: item[3] }));

  await setCache(env, 'fund-list', funds);
  return jsonResponse({ code: 0, data: funds });
}

async function handleFundDetail(code, env) {
  const cacheKey = 'detail-' + code;
  const cached = await getCache(env, cacheKey);
  if (cached) return jsonResponse({ code: 0, data: cached });

  const resp = await fetchEastMoney('http://fund.eastmoney.com/pingzhongdata/' + code + '.js');
  const js = await resp.text();

  let navHistory = [];
  const navMatch = js.match(/var Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);/);
  if (navMatch) {
    try {
      navHistory = JSON.parse(navMatch[1]).map(item => ({
        date: typeof item.x === 'number' ? new Date(item.x).toISOString().slice(0, 10) : String(item.x),
        value: parseFloat(item.y) || 0,
      }));
    } catch (e) {
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
  await setCache(env, cacheKey, result);
  return jsonResponse({ code: 0, data: result });
}

async function handleFundInfo(code, env) {
  const cacheKey = 'info-' + code;
  const cached = await getCache(env, cacheKey);
  if (cached) return jsonResponse({ code: 0, data: cached });

  const resp = await fetchEastMoney('http://fund.eastmoney.com/' + code + '.html');
  const html = await resp.text();

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

  let fundSize = '';
  const sm = html.match(/基金规模[：:]\s*([\d.]+)\s*亿元/);
  if (sm) fundSize = sm[1] + '亿元';

  let establishDate = '';
  const dm = html.match(/成立日期[：:]\s*(\d{4}[-/\.]\d{1,2}[-/\.]\d{1,2})/);
  if (dm) establishDate = dm[1].replace(/[\.\/]/g, '-');

  let risk = '';
  const rm = html.match(/风险等级[：:]\s*([^<>\s]+)/);
  if (rm) risk = rm[1].trim();

  const result = { fundSize, establishDate, manager, risk, code };
  await setCache(env, cacheKey, result);
  return jsonResponse({ code: 0, data: result });
}

// ===== 辅助函数 =====
function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    },
  });
}

function errorResponse(msg, status = 500) {
  return jsonResponse({ code: -1, msg }, status);
}

// ===== 入口 =====
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // CORS 预检
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  try {
    if (path === '/api/rank' || path === '/api/rank/') {
      return await handleRank(request, env);
    }
    if (path === '/api/fund-list' || path === '/api/fund-list/') {
      return await handleFundList(request, env);
    }
    if (path.startsWith('/api/fund/') && path.endsWith('/detail')) {
      const code = path.split('/')[3];
      return await handleFundDetail(code, env);
    }
    if (path.startsWith('/api/fund/') && path.endsWith('/info')) {
      const code = path.split('/')[3];
      return await handleFundInfo(code, env);
    }
    if (path === '/api/health' || path === '/api/health/') {
      return jsonResponse({ status: 'ok', time: new Date().toISOString() });
    }

    return errorResponse('接口不存在: ' + path, 404);
  } catch (err) {
    console.error('[Worker Error]', path, err.message);
    return errorResponse(err.message);
  }
}
