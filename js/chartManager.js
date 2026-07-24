/**
 * Chart.js Manager for 2D Bathymetry Cross-Section Profile Graph
 * Visual: water body fill, A/B endpoints, deepest-point callout
 */

class ChartManager {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.chart = null;
    this._samples = [];
    this._maxDepthIdx = -1;
    this.distanceOrigin = 'A'; // 'A' | 'B' — user-selectable origin for hover distance
    this.waterLevel = 0; // Visual water surface elevation (m)
    this.initChart();
  }

  initChart() {
    const ctx = this.canvas.getContext('2d');
    const self = this;
    const fontStack = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif';

    const crossSectionVizPlugin = {
      id: 'crossSectionViz',
      afterDatasetsDraw(chart) {
        const samples = self._samples;
        if (!samples || samples.length < 2) return;

        const { ctx: c, chartArea, scales } = chart;
        const xScale = scales.x;
        const yScale = scales.y;
        if (!xScale || !yScale) return;

        const meta = chart.getDatasetMeta(1);
        if (!meta || !meta.data || meta.data.length === 0) return;

        c.save();

        // Vertical guides at A and B
        const ptA = meta.data[0];
        const ptB = meta.data[meta.data.length - 1];
        [
          { pt: ptA, label: 'A', color: '#1e3a8a' },
          { pt: ptB, label: 'B', color: '#ea580c' }
        ].forEach(({ pt, label, color }) => {
          if (!pt) return;
          c.beginPath();
          c.setLineDash([4, 4]);
          c.strokeStyle = color;
          c.globalAlpha = 0.45;
          c.lineWidth = 1.25;
          c.moveTo(pt.x, chartArea.top);
          c.lineTo(pt.x, chartArea.bottom);
          c.stroke();
          c.setLineDash([]);
          c.globalAlpha = 1;

          // Endpoint badge
          const r = 9;
          c.beginPath();
          c.arc(pt.x, pt.y, r, 0, Math.PI * 2);
          c.fillStyle = color;
          c.fill();
          c.lineWidth = 2;
          c.strokeStyle = '#ffffff';
          c.stroke();

          c.fillStyle = '#ffffff';
          c.font = `700 11px ${fontStack}`;
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.fillText(label, pt.x, pt.y + 0.5);

          // Caption above chart area
          c.fillStyle = color;
          c.font = `600 10px ${fontStack}`;
          c.textBaseline = 'bottom';
          c.fillText(label, pt.x, chartArea.top - 4);
        });

        // Deepest point callout
        const di = self._maxDepthIdx;
        if (di >= 0 && meta.data[di]) {
          const pt = meta.data[di];
          const sample = samples[di];
          const depth = sample.depth != null ? sample.depth : -sample.z;

          c.beginPath();
          c.setLineDash([3, 3]);
          c.strokeStyle = '#0071e3';
          c.globalAlpha = 0.5;
          c.lineWidth = 1;
          c.moveTo(pt.x, pt.y);
          c.lineTo(pt.x, yScale.getPixelForValue(self.waterLevel));
          c.stroke();
          c.setLineDash([]);
          c.globalAlpha = 1;

          // Diamond marker
          const s = 5;
          c.beginPath();
          c.moveTo(pt.x, pt.y - s);
          c.lineTo(pt.x + s, pt.y);
          c.lineTo(pt.x, pt.y + s);
          c.lineTo(pt.x - s, pt.y);
          c.closePath();
          c.fillStyle = '#0071e3';
          c.fill();
          c.strokeStyle = '#ffffff';
          c.lineWidth = 1.5;
          c.stroke();

          const label = `Sâu nhất ${depth.toFixed(2)} m`;
          c.font = `600 10px ${fontStack}`;
          const tw = c.measureText(label).width;
          let lx = pt.x + 10;
          let ly = pt.y - 8;
          if (lx + tw + 12 > chartArea.right) lx = pt.x - tw - 14;
          if (ly < chartArea.top + 14) ly = pt.y + 18;

          c.fillStyle = 'rgba(255, 255, 255, 0.92)';
          c.strokeStyle = 'rgba(0, 113, 227, 0.35)';
          c.lineWidth = 1;
          const padX = 6;
          const padY = 3;
          const bw = tw + padX * 2;
          const bh = 16;
          const bx = lx - padX;
          const by = ly - bh + 2;
          c.beginPath();
          if (typeof c.roundRect === 'function') {
            c.roundRect(bx, by, bw, bh, 6);
          } else {
            c.rect(bx, by, bw, bh);
          }
          c.fill();
          c.stroke();

          c.fillStyle = '#0071e3';
          c.textAlign = 'left';
          c.textBaseline = 'middle';
          c.fillText(label, lx, by + bh / 2);
        }

        // Hover: dashed connector from water surface → riverbed
        const active = chart.getActiveElements();
        const hoverTerrain = active.find((a) => a.datasetIndex === 1);
        if (hoverTerrain && hoverTerrain.element) {
          const pt = hoverTerrain.element;
          const idx = hoverTerrain.index;
          const sample = samples[idx];
          const yWater = yScale.getPixelForValue(self.waterLevel);
          const yBed = pt.y;
          const x = pt.x;
          const depth = sample
            ? (sample.depth != null ? sample.depth : -sample.z)
            : Math.abs(yScale.getValueForPixel(yBed));

          // Dashed depth stem
          c.beginPath();
          c.setLineDash([5, 4]);
          c.strokeStyle = '#0071e3';
          c.lineWidth = 1.75;
          c.globalAlpha = 0.9;
          c.moveTo(x, yWater);
          c.lineTo(x, yBed);
          c.stroke();
          c.setLineDash([]);
          c.globalAlpha = 1;

          // Point on water surface
          c.beginPath();
          c.arc(x, yWater, 4.5, 0, Math.PI * 2);
          c.fillStyle = '#0071e3';
          c.fill();
          c.lineWidth = 1.5;
          c.strokeStyle = '#ffffff';
          c.stroke();

          // Point on riverbed
          c.beginPath();
          c.arc(x, yBed, 4.5, 0, Math.PI * 2);
          c.fillStyle = '#ea580c';
          c.fill();
          c.lineWidth = 1.5;
          c.strokeStyle = '#ffffff';
          c.stroke();

          // Depth + distance label beside the stem
          if (sample && Number.isFinite(depth)) {
            const totalW = samples[samples.length - 1].distance;
            const distFromA = sample.distance;
            const distFromB = Math.max(0, totalW - distFromA);
            const origin = self.distanceOrigin === 'B' ? 'B' : 'A';
            const dist = origin === 'B' ? distFromB : distFromA;
            const depthLabel = `Từ ${origin} ${dist.toFixed(1)} m · sâu ${depth.toFixed(2)} m`;

            c.font = `600 10px ${fontStack}`;
            const tw = c.measureText(depthLabel).width;
            const midY = Math.abs(yBed - yWater) > 12
              ? (yWater + yBed) / 2
              : Math.min(yWater, yBed) - 14;
            let lx = x + 10;
            if (lx + tw + 10 > chartArea.right) lx = x - tw - 12;

            c.fillStyle = 'rgba(255, 255, 255, 0.94)';
            c.strokeStyle = 'rgba(0, 113, 227, 0.4)';
            c.lineWidth = 1;
            const bw = tw + 12;
            const bh = 16;
            const bx = lx - 6;
            let by = midY - bh / 2;
            if (by < chartArea.top) by = chartArea.top + 2;
            if (by + bh > chartArea.bottom) by = chartArea.bottom - bh - 2;

            c.beginPath();
            if (typeof c.roundRect === 'function') c.roundRect(bx, by, bw, bh, 6);
            else c.rect(bx, by, bw, bh);
            c.fill();
            c.stroke();

            c.fillStyle = '#0071e3';
            c.textAlign = 'left';
            c.textBaseline = 'middle';
            c.fillText(depthLabel, lx, by + bh / 2);
          }
        }

        // Water level caption
        const y0 = yScale.getPixelForValue(self.waterLevel);
        if (y0 >= chartArea.top && y0 <= chartArea.bottom) {
          c.fillStyle = '#0071e3';
          c.font = `500 9px ${fontStack}`;
          c.textAlign = 'left';
          c.textBaseline = 'bottom';
          c.globalAlpha = 0.85;
          const wl = self.waterLevel;
          const wlLabel = Number.isFinite(wl)
            ? `Mực nước Z = ${wl.toFixed(1)} m`
            : 'Mực nước Z = 0 m';
          c.fillText(wlLabel, chartArea.left + 4, y0 - 3);
          c.globalAlpha = 1;
        }

        c.restore();
      }
    };

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Mặt nước (Z = 0 m)',
            data: [],
            borderColor: '#0071e3',
            borderWidth: 1.75,
            borderDash: [6, 4],
            pointRadius: 0,
            fill: false,
            tension: 0,
            order: 1
          },
          {
            label: 'Địa hình lòng sông',
            data: [],
            borderColor: '#c2410c',
            borderWidth: 2.5,
            backgroundColor: 'rgba(0, 113, 227, 0.25)',
            fill: {
              target: 0,
              above: 'rgba(212, 165, 116, 0.4)',
              below: 'rgba(0, 113, 227, 0.28)'
            },
            pointRadius: 0,
            pointHoverRadius: 6,
            pointHoverBackgroundColor: '#ea580c',
            pointHoverBorderColor: '#ffffff',
            pointHoverBorderWidth: 2,
            tension: 0.25,
            order: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 320, easing: 'easeOutQuart' },
        layout: {
          padding: { top: 14, right: 8, bottom: 2, left: 2 }
        },
        interaction: {
          mode: 'index',
          intersect: false
        },
        onHover(event, elements, chart) {
          const next = elements.map((e) => ({
            datasetIndex: e.datasetIndex,
            index: e.index
          }));
          const prev = chart.getActiveElements();
          const changed =
            next.length !== prev.length ||
            next.some((n, i) => !prev[i] || n.datasetIndex !== prev[i].datasetIndex || n.index !== prev[i].index);
          if (changed) {
            chart.setActiveElements(next);
            chart.draw();
          }
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'end',
            labels: {
              color: '#6e6e73',
              font: { family: fontStack, size: 11, weight: '500' },
              boxWidth: 14,
              boxHeight: 3,
              padding: 10,
              usePointStyle: false
            }
          },
          tooltip: {
            enabled: false
          }
        },
        scales: {
          x: {
            title: {
              display: true,
              text: 'Khoảng cách từ A → B (m)',
              color: '#86868b',
              font: { family: fontStack, size: 11, weight: '500' },
              padding: { top: 4 }
            },
            ticks: {
              color: '#86868b',
              font: { family: fontStack, size: 10 },
              maxTicksLimit: 12
            },
            grid: { color: 'rgba(210, 210, 215, 0.7)', lineWidth: 0.5 }
          },
          y: {
            title: {
              display: true,
              text: 'Cao độ Z (m)  ·  âm = dưới mực nước',
              color: '#86868b',
              font: { family: fontStack, size: 11, weight: '500' }
            },
            ticks: {
              color: '#86868b',
              font: { family: fontStack, size: 10 },
              callback: (value) => (value === 0 ? '0 (nước)' : value)
            },
            grid: {
              color: (ctx) => (ctx.tick.value === 0 ? 'rgba(0, 113, 227, 0.35)' : 'rgba(210, 210, 215, 0.7)'),
              lineWidth: (ctx) => (ctx.tick.value === 0 ? 1.5 : 0.5)
            }
          }
        }
      },
      plugins: [crossSectionVizPlugin]
    });
  }

  /**
   * Update cross-section chart data from profile samples
   * @returns {{ width: string, maxDepth: string, area: string } | undefined}
   */
  updateChart(samples) {
    if (!this.chart || !samples || samples.length === 0) return;

    this._samples = samples;
    this._maxDepthIdx = this.findMaxDepthIndex(samples);

    const labels = samples.map(s => s.distance.toFixed(1));
    const waterData = samples.map(() => this.waterLevel);
    const terrainData = samples.map(s => ({
      x: s.distance.toFixed(1),
      y: s.z,
      rawSample: s
    }));

    // Padding Y so profile + water read clearly
    let minZ = Infinity;
    let maxZ = -Infinity;
    samples.forEach(s => {
      if (s.z < minZ) minZ = s.z;
      if (s.z > maxZ) maxZ = s.z;
    });
    const wl = this.waterLevel;
    if (Number.isFinite(wl)) {
      if (wl < minZ) minZ = wl;
      if (wl > maxZ) maxZ = wl;
    }
    const span = Math.max(maxZ - minZ, 1);
    const pad = span * 0.12;
    this.chart.options.scales.y.min = Math.min(minZ - pad, wl - 0.5);
    this.chart.options.scales.y.max = Math.max(maxZ + pad, wl + 0.8);

    // Water column + bank fills relative to waterLevel dataset
    const waterFill = this.createWaterFill();
    this.chart.data.datasets[1].fill = {
      target: 0,
      above: 'rgba(212, 165, 116, 0.4)',
      below: waterFill
    };
    this.chart.data.datasets[1].backgroundColor = waterFill;

    this.chart.data.labels = labels;
    this.chart.data.datasets[0].label = `Mặt nước (Z = ${wl.toFixed(1)} m)`;
    this.chart.data.datasets[0].data = waterData;
    this.chart.data.datasets[1].data = terrainData;
    this.chart.update('none');

    return this.computeProfileStats(samples);
  }

  /**
   * Set visual water surface elevation and redraw chart
   */
  setWaterLevel(level) {
    this.waterLevel = Number.isFinite(level) ? level : 0;
    if (this._samples && this._samples.length > 0) {
      this.updateChart(this._samples);
    } else if (this.chart) {
      this.chart.data.datasets[0].label = `Mặt nước (Z = ${this.waterLevel.toFixed(1)} m)`;
      this.chart.update('none');
    }
  }

  createWaterFill() {
    const chart = this.chart;
    if (!chart || !chart.chartArea) {
      return 'rgba(0, 113, 227, 0.28)';
    }
    const { ctx, chartArea } = chart;
    const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    gradient.addColorStop(0, 'rgba(100, 180, 255, 0.18)');
    gradient.addColorStop(0.4, 'rgba(0, 113, 227, 0.32)');
    gradient.addColorStop(1, 'rgba(10, 40, 90, 0.42)');
    return gradient;
  }

  findMaxDepthIndex(samples) {
    let maxDepth = -Infinity;
    let idx = -1;
    for (let i = 0; i < samples.length; i++) {
      const depth = samples[i].depth != null ? samples[i].depth : -samples[i].z;
      if (depth > maxDepth) {
        maxDepth = depth;
        idx = i;
      }
    }
    return idx;
  }

  /**
   * Cross-section width, max depth, and submerged area under Z = 0
   */
  computeProfileStats(samples) {
    const width = samples[samples.length - 1].distance;

    let maxDepth = 0;
    let area = 0;

    for (let i = 0; i < samples.length; i++) {
      const depth = samples[i].depth != null ? samples[i].depth : -samples[i].z;
      if (depth > maxDepth) maxDepth = depth;

      if (i > 0) {
        const prev = samples[i - 1];
        const prevDepth = Math.max(0, prev.depth != null ? prev.depth : -prev.z);
        const curDepth = Math.max(0, depth);
        const dx = samples[i].distance - prev.distance;
        area += 0.5 * (prevDepth + curDepth) * dx;
      }
    }

    return {
      width: width.toFixed(1),
      maxDepth: maxDepth.toFixed(2),
      area: area.toFixed(1)
    };
  }
}

window.ChartManager = ChartManager;
