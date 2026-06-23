// ===== Charts for Fund Insight =====
(function() {
  'use strict';

  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var bg2 = style.getPropertyValue('--bg2').trim();

  // ----- Market Charts -----
  window.renderMarketCharts = function(types, avgs, periodLabel, sectorNames, sectorAvgs, sectorCounts) {
    periodLabel = periodLabel || '近一周';
    // Type distribution bar chart
    var chartType = echarts.init(document.getElementById('chart-type-dist'), null, { renderer: 'svg' });
    chartType.setOption({
      animation: false,
      tooltip: {
        trigger: 'axis',
        appendToBody: true,
        axisPointer: { type: 'shadow' },
        formatter: function(params) {
          return params[0].name + '<br/>' + periodLabel + '平均涨跌：' + params[0].value.toFixed(2) + '%';
        }
      },
      grid: { left: '3%', right: '4%', bottom: '3%', top: '10%', containLabel: true },
      xAxis: {
        type: 'category',
        data: types,
        axisLine: { lineStyle: { color: rule } },
        axisLabel: { color: muted }
      },
      yAxis: {
        type: 'value',
        axisLine: { lineStyle: { color: rule } },
        splitLine: { lineStyle: { color: rule, opacity: 0.3 } },
        axisLabel: { color: muted, formatter: '{value}%' }
      },
      series: [{
        type: 'bar',
        data: avgs.map(function(v) { return { value: v, itemStyle: { color: v >= 0 ? accent : '#ef4444' } }; }),
        barWidth: '50%',
        label: { show: true, position: 'top', color: ink, formatter: function(p) { return p.value.toFixed(2) + '%'; } }
      }]
    });
    window.addEventListener('resize', function() { chartType.resize(); });

    // Sector bar chart (基于基金名称关键词匹配)
    var chartSector = echarts.init(document.getElementById('chart-sector'), null, { renderer: 'svg' });
    chartSector.setOption({
      animation: false,
      tooltip: {
        trigger: 'axis',
        appendToBody: true,
        axisPointer: { type: 'shadow' },
        formatter: function(params) {
          var idx = params[0].dataIndex;
          return sectorNames[idx] + '<br/>' + periodLabel + '平均涨跌：' + params[0].value.toFixed(2) + '%<br/>匹配基金：' + sectorCounts[idx] + '只';
        }
      },
      grid: { left: '3%', right: '4%', bottom: '3%', top: '10%', containLabel: true },
      xAxis: {
        type: 'category',
        data: sectorNames,
        axisLine: { lineStyle: { color: rule } },
        axisLabel: { color: muted }
      },
      yAxis: {
        type: 'value',
        axisLine: { lineStyle: { color: rule } },
        splitLine: { lineStyle: { color: rule, opacity: 0.3 } },
        axisLabel: { color: muted, formatter: '{value}%' }
      },
      series: [{
        type: 'bar',
        data: sectorAvgs.map(function(v) { return { value: v, itemStyle: { color: v >= 0 ? accent : '#ef4444' } }; }),
        barWidth: '50%',
        label: { show: true, position: 'top', color: ink, formatter: function(p) { return p.value.toFixed(2) + '%'; } }
      }]
    });
    window.addEventListener('resize', function() { chartSector.resize(); });
  };

  // ----- Fund Trend Chart -----
  window.renderFundTrend = function(history) {
    var el = document.getElementById('chart-fund-trend');
    if (!el) return;
    var chart = echarts.init(el, null, { renderer: 'svg' });
    var dates = history.map(function(h) { return h.date.slice(5); });
    var values = history.map(function(h) { return h.value; });
    chart.setOption({
      animation: false,
      tooltip: { trigger: 'axis', appendToBody: true },
      grid: { left: '3%', right: '4%', bottom: '3%', top: '10%', containLabel: true },
      xAxis: {
        type: 'category',
        data: dates,
        axisLine: { lineStyle: { color: rule } },
        axisLabel: { color: muted }
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLine: { lineStyle: { color: rule } },
        splitLine: { lineStyle: { color: rule, opacity: 0.3 } },
        axisLabel: { color: muted }
      },
      series: [{
        type: 'line',
        data: values,
        smooth: true,
        symbol: 'none',
        lineStyle: { color: accent, width: 2 },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [
          { offset: 0, color: accent + '30' },
          { offset: 1, color: accent + '05' }
        ]}}
      }]
    });
    window.addEventListener('resize', function() { chart.resize(); });
  };

})();
