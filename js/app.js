/**
 * Main Application Entry Point & UI Controller
 */

document.addEventListener('DOMContentLoaded', async () => {
  const loadingOverlay = document.getElementById('loadingOverlay');

  // 1. Initialize Modules
  const dataLoader = new DataLoader();
  const scene3D = new Scene3D('viewport3d');
  window.scene3D = scene3D;

  const chartManager = new ChartManager('crossSectionChart');

  // Callback when profile cut line changes on 2D map
  const crossSection = new CrossSection('map2dCanvas', dataLoader, (samples, pA, pB) => {
    // 1. Update 3D cut line
    scene3D.drawCutLine3D(samples);

    // 2. Update 2D profile chart
    const stats = chartManager.updateChart(samples);

    // 3. Update stats UI panel
    if (stats) {
      document.getElementById('csWidth').textContent = `${stats.width} m`;
      document.getElementById('csMaxDepth').textContent = `${stats.maxDepth} m`;
      document.getElementById('csArea').textContent = `${stats.area} m²`;
    }
  });

  window.crossSection = crossSection;

  /**
   * Load and process data string
   */
  function loadDataString(rawText, filename = "Travinh - HS_L0002_2026-03-06-sang.txt") {
    try {
      loadingOverlay.classList.remove('hidden');

      setTimeout(() => {
        dataLoader.parseText(rawText);

        // Update 3D Scene
        scene3D.updateData(dataLoader);

        // Update Stats UI
        const b = dataLoader.bounds;
        document.getElementById('statTotalPoints').textContent = dataLoader.points.length.toLocaleString();
        document.getElementById('statMinDepth').textContent = `${(-b.maxZ).toFixed(2)} m`; // maxZ elevation is min depth
        document.getElementById('statMaxDepth').textContent = `${(-b.minZ).toFixed(2)} m`; // minZ elevation is max depth
        document.getElementById('statAvgDepth').textContent = `${(-b.meanZ).toFixed(2)} m`;
        document.getElementById('fileNameLabel').textContent = filename;

        // Set default cross-section preset
        crossSection.setPreset('transverse-mid');

        loadingOverlay.classList.add('hidden');
      }, 50);

    } catch (err) {
      alert(`Lỗi khi đọc file dữ liệu: ${err.message}`);
      loadingOverlay.classList.add('hidden');
    }
  }

  // 2. Load Default Trà Vinh Bathymetry Dataset
  const defaultText = await SampleData.fetchDefaultData();
  if (defaultText) {
    loadDataString(defaultText, "Travinh - HS_L0002_2026-03-06-sang.txt");
  } else {
    loadingOverlay.classList.add('hidden');
  }

  // 3. UI Event Listeners

  // File Upload
  const fileInput = document.getElementById('fileInput');
  document.getElementById('btnUpload').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      loadDataString(evt.target.result, file.name);
    };
    reader.readAsText(file);
  });

  // Z-Scale Exaggeration Slider
  const zScaleInput = document.getElementById('zScaleInput');
  const zScaleValue = document.getElementById('zScaleValue');
  zScaleInput.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    zScaleValue.textContent = `${val}x`;
    scene3D.setZScale(val);
    if (crossSection.pointA && crossSection.pointB) {
      crossSection.updateProfile();
    }
  });

  // Color Palette Selector
  const paletteSelect = document.getElementById('paletteSelect');
  paletteSelect.addEventListener('change', (e) => {
    const palette = e.target.value;
    scene3D.setColorPalette(palette);
    crossSection.drawMap();

    // Update legend bar style
    document.getElementById('colorLegendBar').style.background = ColorRamps.getLegendGradientCSS(palette);
  });
  document.getElementById('colorLegendBar').style.background = ColorRamps.getLegendGradientCSS('bathymetry');



  // Render Mode Toggles (Surface, Wireframe, Point Cloud, Both)
  const toggleBtns = document.querySelectorAll('.toggle-btn[data-mode]');
  toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      toggleBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      scene3D.updateRenderMode(btn.dataset.mode);
    });
  });

  // Water Surface Checkbox Toggle
  const chkWater = document.getElementById('chkWater');
  chkWater.addEventListener('change', (e) => {
    scene3D.setWaterVisible(e.target.checked);
  });

  // Contour Lines Checkbox Toggle
  const chkContours = document.getElementById('chkContours');
  if (chkContours) {
    chkContours.addEventListener('change', (e) => {
      const visible = e.target.checked;
      scene3D.setContoursVisible(visible);
      crossSection.showContours = visible;
      crossSection.updateLeafletElements();
    });
  }



  // Reset Camera View
  document.getElementById('btnResetCamera').addEventListener('click', () => {
    scene3D.resetCamera();
  });

  // Maximize 2D Map Window Toggle
  const btnToggleMapSize = document.getElementById('btnToggleMapSize');
  const map2dWindow = document.getElementById('map2dWindow');
  btnToggleMapSize.addEventListener('click', () => {
    const isMaximized = map2dWindow.classList.toggle('maximized');
    const icon = btnToggleMapSize.querySelector('i');
    if (icon) {
      icon.className = isMaximized ? 'fa-solid fa-compress' : 'fa-solid fa-expand';
    }
    setTimeout(() => {
      crossSection.resizeMap();
      crossSection.drawMap();
    }, 320);
  });

  // Export Cross-Section Profile to CSV
  document.getElementById('btnExportCSV').addEventListener('click', () => {
    if (!crossSection.pointA || !crossSection.pointB) return;
    const samples = dataLoader.sampleProfile(crossSection.pointA.x, crossSection.pointA.y, crossSection.pointB.x, crossSection.pointB.y, 100);

    let csvContent = "Distance_m,UTM_X,UTM_Y,Elevation_Z,Depth_m\n";
    samples.forEach(s => {
      csvContent += `${s.distance.toFixed(2)},${s.x.toFixed(3)},${s.y.toFixed(3)},${s.z.toFixed(3)},${(-s.z).toFixed(3)}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `mat_cat_long_song_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });
});
