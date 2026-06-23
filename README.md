# 基金洞察 - GitHub Pages 部署指南

## 项目简介

全市场基金数据汇总与分析平台，数据来源于天天基金网公开接口。

## 技术栈

- 前端：原生 HTML + CSS + JavaScript + ECharts
- 代理：Cloudflare Worker（转发天天基金网 API）
- 部署：GitHub Pages（前端）+ Cloudflare Worker（API 代理）

## 部署步骤

### 第一步：部署 Cloudflare Worker 代理

1. 登录 https://dash.cloudflare.com
2. 左侧菜单点击 **Workers & Pages**
3. 点击 **Create application** → **Create Worker**
4. 给 Worker 起个名字，比如 `fund-insight-proxy`
5. 点击 **Deploy**，然后点击 **Edit code**
6. 删除默认代码，粘贴 `cors-proxy.js` 文件中的全部内容
7. 点击 **Save and deploy**
8. 复制 Worker 的 URL（如 `https://fund-insight-proxy.xxx.workers.dev`）

### 第二步：修改前端代理地址

1. 打开仓库中的 `assets/app.js`
2. 找到这一行：
   ```javascript
   const PROXY_URL = 'https://fund-insight-proxy.wlget.workers.dev/?url=';
   ```
3. 把地址改成你刚才创建的 Worker URL（**注意末尾保留 `?url=`**）
4. 提交修改到 master 分支

### 第三步：开启 GitHub Pages

1. 打开 https://github.com/WLget/fund-insight/settings/pages
2. **Source** 选择 **Deploy from a branch**
3. **Branch** 选 **master**，文件夹选 **/(root)**
4. 点击 **Save**
5. 等待 1-2 分钟，访问显示的地址（如 `https://wlget.github.io/fund-insight/`）

## 项目结构

```
fund-insight/
├── index.html              # 首页
├── assets/
│   ├── app.js              # 前端业务逻辑
│   ├── charts.js           # ECharts 图表配置
├── cors-proxy.js           # Cloudflare Worker 代理代码
├── _shared/                # 共享资源（字体、JS库）
└── README.md               # 本文件
```

## 数据说明

| 项目 | 说明 |
|------|------|
| 数据来源 | 天天基金网公开 API |
| 获取方式 | 前端 → Cloudflare Worker → 天天基金网 |
| 自动刷新 | 每5分钟 |
| 数据类型 | 今日/一周/一月/三月/半年/一年涨跌幅 |

## 注意事项

1. Cloudflare Worker 免费版每日有 10 万次请求限制，个人使用足够
2. 基金净值数据为交易日收盘后发布，非交易日数据不变
3. 投资有风险，数据仅供参考，不构成投资建议
