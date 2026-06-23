// Cloudflare Pages Function - API Proxy
// 将 /api/* 请求转发到 Worker，解决移动端跨域问题
const WORKER_URL = 'https://fund-insight-api.angusliuwenling.workers.dev';

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // OPTIONS 预检
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

  const targetUrl = WORKER_URL + url.pathname + url.search;

  try {
    const proxyReq = new Request(targetUrl, {
      method: request.method,
      headers: request.headers,
    });

    const workerResp = await fetch(proxyReq);

    const respHeaders = new Headers(workerResp.headers);
    respHeaders.set('Access-Control-Allow-Origin', '*');

    return new Response(workerResp.body, {
      status: workerResp.status,
      statusText: workerResp.statusText,
      headers: respHeaders,
    });
  } catch (err) {
    return new Response(JSON.stringify({ code: -1, msg: 'API proxy error: ' + err.message }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}
