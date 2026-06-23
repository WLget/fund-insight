// ===== Cloudflare Worker: 专用 CORS 代理 =====
// 用于 fund-insight 项目转发天天基金网 API 请求
// 部署步骤：
// 1. 登录 https://dash.cloudflare.com
// 2. 左侧 Workers & Pages → Create application → Create Worker
// 3. 粘贴此代码，保存
// 4. 复制 Worker 的 URL（如 https://fund-proxy.xxx.workers.dev）
// 5. 填入 assets/app.js 的 PROXY_URL 中

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');

    if (!targetUrl) {
      return new Response('Missing ?url= parameter', { status: 400 });
    }

    // 只允许天天基金网域名
    if (!targetUrl.includes('fund.eastmoney.com')) {
      return new Response('Only fund.eastmoney.com is allowed', { status: 403 });
    }

    try {
      const resp = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Referer': 'http://fund.eastmoney.com/',
        },
      });

      const body = await resp.text();

      return new Response(body, {
        status: resp.status,
        headers: {
          'Content-Type': resp.headers.get('Content-Type') || 'text/plain',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    } catch (err) {
      return new Response('Proxy error: ' + err.message, { status: 500 });
    }
  },
};
