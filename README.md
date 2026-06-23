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

### 2. 连接 GitHub 仓库

1. 登录 Cloudflare Dashboard
2. 左侧菜单点击 **Pages**
3. 点击 **Create a project**
4. 选择 **Connect to Git**
5. 授权 Cloudflare 访问你的 GitHub
6. 选择 `WLget/fund-insight` 仓库
7. 点击 **Begin setup**

### 3. 构建设置

在设置页面填写：

| 设置项 | 填写内容 |
|--------|---------|
| Project name | `fund-insight` |
| Production branch | `master` |
| Framework preset | **None** |
| Build command | 留空 |
| Deploy command | `npx wrangler pages deploy . --project-name=fund-insight` |
| Build output directory | 留空 |
| Root directory | `/` |

点击 **Save and Deploy**

### 4. 创建 KV 命名空间（缓存用）

这一步需要 Wrangler CLI：

```bash
npm install -g wrangler
wrangler login
wrangler kv:namespace create "FUND_CACHE"
```

执行后会输出：
```
{ binding = "FUND_CACHE", id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }
```

### 5. 绑定 KV 到项目

1. 在 Cloudflare Dashboard 进入你的 Pages 项目
2. 点击 **Settings** → **Functions**
3. 找到 **KV namespace bindings**
4. 点击 **Add binding**
5. Variable name 填 `FUND_CACHE`
6. KV namespace 选择你刚才创建的
7. 点击 **Save**

### 6. 重新部署

回到项目页面，点击 **Retry deployment**。

部署成功后访问：
```
https://fund-insight.pages.dev
```

## 项目结构

```
fund-insight/
├── index.html              # 首页
├── assets/
│   ├── app.js              # 前端业务逻辑
│   ├── charts.js           # ECharts 图表配置
│   └── ...
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
