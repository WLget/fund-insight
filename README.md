# 基金洞察 - Cloudflare Pages 部署指南

## 项目简介

全市场基金数据汇总与分析平台，数据来源于天天基金网公开接口。

## 技术栈

- 前端：原生 HTML + CSS + JavaScript + ECharts
- 后端：Cloudflare Pages Functions（Workers）
- 缓存：Cloudflare KV

## 部署步骤

### 1. 注册 Cloudflare 账号

访问 https://dash.cloudflare.com/sign-up 注册账号

### 2. 安装 Wrangler CLI

```bash
npm install -g wrangler
```

### 3. 登录 Cloudflare

```bash
wrangler login
```

### 4. 创建 KV 命名空间（用于缓存数据）

```bash
wrangler kv:namespace create "FUND_CACHE"
```

执行后会输出类似：
```
{ binding = "FUND_CACHE", id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }
```

### 5. 更新 wrangler.toml

将上一步输出的 id 填入 `wrangler.toml`：

```toml
[[kv_namespaces]]
binding = "FUND_CACHE"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

### 6. 部署到 Cloudflare Pages

```bash
wrangler pages deploy .
```

### 7. 绑定自定义域名（可选）

在 Cloudflare Dashboard -> Pages -> 你的项目 -> Custom domains 中添加域名

## 项目结构

```
fund-insight/
├── index.html              # 首页
├── assets/
│   ├── app.js              # 前端业务逻辑
│   ├── charts.js           # ECharts 图表配置
│   └── ...                 # 其他资源
├── functions/
│   └── api/
│       └── [[path]].js     # Cloudflare Pages Functions API
├── _shared/                # 共享资源（字体、JS库）
├── wrangler.toml           # Cloudflare 部署配置
└── README.md               # 本文件
```

## API 接口

| 接口 | 说明 |
|------|------|
| GET /api/rank | 获取全市场基金排行数据 |
| GET /api/fund-list | 获取全市场基金列表 |
| GET /api/fund/:code/detail | 获取单只基金净值走势 |
| GET /api/fund/:code/info | 获取单只基金基本信息 |
| GET /api/health | 健康检查 |

## 数据刷新机制

- 后端缓存：4分钟（Cloudflare KV）
- 前端自动刷新：每5分钟
- 手动刷新：点击页面"刷新数据"按钮

## 注意事项

1. 天天基金网 API 可能有访问频率限制，请勿过度刷新
2. 基金净值数据为交易日收盘后发布，非交易日数据不变
3. 投资有风险，数据仅供参考，不构成投资建议
