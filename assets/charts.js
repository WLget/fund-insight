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
  window.renderMarketCharts = function(types, avgs) {
    // Type distribution bar chart
    var chartType = echarts.init(document.getElementById('chart-type-dist'), null, { renderer: 'svg' });
    chartType.setOption({
      animation: false,
      tooltip: { trigger: 'axis', appendToBody: true, axisPointer: { type: 'shadow' } },
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

    // Sector heat/radar simulation
    var sectors = ['科技','消费','医药','新能源','金融','地产','军工','有色','农业','传媒'];
    var sectorData = sectors.map(function() { return rand(-5, 8); });
    var chartSector = echarts.init(document.getElementById('chart-sector'), null, { renderer: 'svg' });
    chartSector.setOption({
      animation: false,
      tooltip: { trigger: 'axis', appendToBody: true },
      grid: { left: '3%', right: '4%', bottom: '3%', top: '10%', containLabel: true },
      xAxis: {
        type: 'category',
        data: sectors,
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
        type: 'line',
        data: sectorData,
        smooth: true,
        symbol: 'circle',
        symbolSize: 8,
        lineStyle: { color: accent2, width: 2 },
        itemStyle: { color: accent2 },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [
          { offset: 0, color: accent2 + '40' },
          { offset: 1, color: accent2 + '05' }
        ]}}
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

  function rand(min, max) { return Math.random() * (max - min) + min; }

})();
