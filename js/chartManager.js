/**
 * Chart.js Manager for 2D Bathymetry Cross-Section Profile Graph
 */

class ChartManager {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.chart = null;
    this.initChart();
  }

  initChart() {
    const ctx = this.canvas.getContext('2d');

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Mặt nước biển (Z = 0m)',
            data: [],
            borderColor: '#1e3a8a',
            borderWidth: 1.5,
            borderDash: [5, 5],
            pointRadius: 0,
            fill: false,
            tension: 0
          },
          {
            label: 'Địa hình lòng sông (Z)',
            data: [],
            borderColor: '#ea580c',
            borderWidth: 2.5,
            backgroundColor: 'rgba(234, 88, 12, 0.12)',
            fill: 'start',
            pointRadius: 0,
            pointHoverRadius: 6,
            pointHoverBackgroundColor: '#ea580c',
            pointHoverBorderColor: '#ffffff',
            pointHoverBorderWidth: 2,
            tension: 0.3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              color: '#475569',
              font: { family: 'Inter', size: 11, weight: 'bold' }
            }
          },
          tooltip: {
            backgroundColor: '#ffffff',
            borderColor: '#ea580c',
            borderWidth: 1.5,
            titleColor: '#0f172a',
            bodyColor: '#ea580c',
            titleFont: { family: 'Inter', weight: 'bold' },
            bodyFont: { family: 'Inter', size: 12 },
            padding: 10,
            callbacks: {
              title: (items) => `Khoảng cách từ A: ${items[0].label} m`,
              label: (context) => {
                const sample = context.raw ? context.raw.rawSample : null;
                if (!sample) return `Độ cao: ${context.parsed.y.toFixed(2)} m`;
                return [
                  `Độ sâu: ${(-sample.z).toFixed(2)} m (Z = ${sample.z.toFixed(2)}m)`,
                  `Tọa độ X: ${sample.x.toFixed(2)} m`,
                  `Tọa độ Y: ${sample.y.toFixed(2)} m`
                ];
              }
            }
          }
        },
        scales: {
          x: {
            title: {
              display: true,
              text: 'Khoảng cách dọc theo đường cắt A-B (m)',
              color: '#64748b',
              font: { family: 'Inter', size: 11, weight: 'bold' }
            },
            ticks: { color: '#64748b', font: { family: 'Inter', size: 10 }, maxTicksLimit: 12 },
            grid: { color: '#e2e8f0' }
          },
          y: {
            title: {
              display: true,
              text: 'Độ cao Z / Mực chuẩn (m)',
              color: '#64748b',
              font: { family: 'Inter', size: 11, weight: 'bold' }
            },
            ticks: { color: '#64748b', font: { family: 'Inter', size: 10 } },
            grid: { color: '#e2e8f0' }
          }
        }
      }
    });
  }

  /**
   * Update cross-section chart data from profile samples
   */
  updateChart(samples) {
    if (!this.chart || !samples || samples.length === 0) return;

    const labels = samples.map(s => s.distance.toFixed(1));
    const waterData = samples.map(s => 0); // Z = 0 water line
    const terrainData = samples.map(s => ({
      x: s.distance.toFixed(1),
      y: s.z,
      rawSample: s
    }));

    this.chart.data.labels = labels;
    this.chart.data.datasets[0].data = waterData;
    this.chart.data.datasets[1].data = terrainData;
    this.chart.update('none'); // Update without full animation for performance
  }
}

window.ChartManager = ChartManager;
