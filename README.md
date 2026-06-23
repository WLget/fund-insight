# 基金洞察 - GitHub Pages 部署指南

## 项目简介

全市场基金数据汇总与分析平台，数据来源于天天基金网公开接口。

## 技术栈

- 前端：原生 HTML + CSS + JavaScript + ECharts
- 数据：天天基金网公开 API（前端通过 CORS 代理直接请求）
- 部署：GitHub Pages（纯静态托管）

## 部署步骤（超简单）

### 1. 确认代码已在仓库

确保 `index.html`、`assets/app.js`、`assets/charts.js` 等文件已推送到 GitHub 仓库。

### 2. 开启 GitHub Pages

1. 打开 https://github.com/WLget/fund-insight/settings/pages
2. **Source** 选择 **Deploy from a branch**
3. **Branch** 选择 **master**，文件夹选 **/(root)**
4. 点击 **Save**

### 3. 等待部署完成

- 大约 1-2 分钟后，页面会显示访问地址：
  ```
  https://wlget.github.io/fund-insight/
  ```

### 4. 访问网站

打开上面的链接即可使用。

## 项目结构

```
fund-insight/
├── index.html              # 首页
├── assets/
│   ├── app.js              # 前端业务逻辑（直接请求天天基金网 API）
│   ├── charts.js           # ECharts 图表配置
├── _shared/                # 共享资源（字体、JS库）
└── README.md               # 本文件
```

## 数据说明

| 项目 | 说明 |
|------|------|
| 数据来源 | 天天基金网公开 API |
| 获取方式 | 前端通过公共 CORS 代理直接请求 |
| 自动刷新 | 每5分钟 |
| 数据类型 | 今日/一周/一月/三月/半年/一年涨跌幅 |

## 注意事项

1. 公共 CORS 代理可能有访问频率限制，如遇加载失败请稍后再试
2. 基金净值数据为交易日收盘后发布，非交易日数据不变
3. 投资有风险，数据仅供参考，不构成投资建议
