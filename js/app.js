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

  // Callback when profile cut line(s) change on 2D map
  const crossSection = new CrossSection('map2dCanvas', dataLoader, (profiles) => {
    scene3D.drawCutLines3D(profiles);
    const stats = chartManager.updateChart(profiles);
    if (stats) {
      document.getElementById('csWidth').textContent = `${stats.width} m`;
      document.getElementById('csMaxDepth').textContent = `${stats.maxDepth} m`;
      document.getElementById('csArea').textContent = `${stats.area} m²`;
    }
  });

  window.crossSection = crossSection;

  function renderCutList(cuts, activeId) {
    const list = document.getElementById('cutList');
    if (!list) return;
    list.innerHTML = '';
    cuts.forEach((c) => {
      const row = document.createElement('div');
      row.className = 'cut-list-item' + (c.id === activeId ? ' active' : '');
      row.innerHTML = `
        <button type="button" class="cut-list-select" data-cut-id="${c.id}" title="Chọn đường cắt ${c.label}">
          <span class="cut-swatch" style="background:${c.colorCss}"></span>
          <span>Cắt ${c.label}</span>
        </button>
        <button type="button" class="cut-list-remove icon-btn" data-cut-remove="${c.id}" title="Xóa đường cắt" ${cuts.length <= 1 ? 'disabled' : ''}>
          <i class="fa-solid fa-xmark"></i>
        </button>
      `;
      list.appendChild(row);
    });
  }

  crossSection.onCutsListChanged = renderCutList;

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
        document.getElementById('fileNameLabel').title = filename;

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

  // Water Level Elevation Input
  const waterLevelInput = document.getElementById('waterLevelInput');
  waterLevelInput.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    const level = Number.isFinite(val) ? val : 0;
    scene3D.setWaterLevel(level);
    const stats = chartManager.setWaterLevel(level);
    if (stats) {
      document.getElementById('csWidth').textContent = `${stats.width} m`;
      document.getElementById('csMaxDepth').textContent = `${stats.maxDepth} m`;
      document.getElementById('csArea').textContent = `${stats.area} m²`;
    }
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

  // Contour Interval Input (0.5–1.0 m)
  const contourIntervalInput = document.getElementById('contourIntervalInput');
  if (contourIntervalInput) {
    contourIntervalInput.addEventListener('input', (e) => {
      let val = parseFloat(e.target.value);
      if (!Number.isFinite(val)) val = 1;
      val = Math.min(1, Math.max(0.5, val));
      scene3D.setContourInterval(val);
      crossSection.setContourInterval(val);
    });
  }

  // Cut mode: Tự do / Cắt ngang / Cắt dọc (Ngang/Dọc cần tim tuyến)
  const cutModeBtns = document.querySelectorAll('.toggle-btn[data-cut-mode]');

  function setCutModeButtonsEnabled(hasCenterline) {
    cutModeBtns.forEach((btn) => {
      const mode = btn.dataset.cutMode;
      if (mode === 'free') return;
      btn.disabled = !hasCenterline;
      if (hasCenterline) {
        btn.title = mode === 'transverse'
          ? 'Cắt ngang vuông góc tim tuyến'
          : 'Cắt dọc theo tim tuyến';
      } else {
        btn.title = 'Cần tải tim tuyến KML/KMZ';
        if (btn.classList.contains('active')) {
          btn.classList.remove('active');
          const freeBtn = document.querySelector('.toggle-btn[data-cut-mode="free"]');
          if (freeBtn) freeBtn.classList.add('active');
        }
      }
    });
  }

  cutModeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const ok = crossSection.setCutMode(btn.dataset.cutMode);
      if (ok === false) return;
      cutModeBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Centerline (tim tuyến) KML/KMZ
  const centerlineFileInput = document.getElementById('centerlineFileInput');
  const btnUploadCenterline = document.getElementById('btnUploadCenterline');
  const centerlineFileLabel = document.getElementById('centerlineFileLabel');
  const btnClearCenterline = document.getElementById('btnClearCenterline');

  function updateCenterlineUI(hasCenterline, filename) {
    setCutModeButtonsEnabled(hasCenterline);
    if (centerlineFileLabel) {
      centerlineFileLabel.textContent = hasCenterline ? (filename || 'Đã tải') : 'Chưa có';
      centerlineFileLabel.title = hasCenterline ? (filename || '') : '';
    }
    if (btnClearCenterline) btnClearCenterline.disabled = !hasCenterline;
  }

  crossSection.onCenterlineChanged = (has) => {
    updateCenterlineUI(has, centerlineFileLabel ? centerlineFileLabel.textContent : '');
    if (!has) {
      updateCenterlineUI(false);
      const freeBtn = document.querySelector('.toggle-btn[data-cut-mode="free"]');
      if (freeBtn) {
        cutModeBtns.forEach((b) => b.classList.remove('active'));
        freeBtn.classList.add('active');
      }
    }
  };

  if (btnUploadCenterline && centerlineFileInput) {
    btnUploadCenterline.addEventListener('click', () => centerlineFileInput.click());
    centerlineFileInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const latLngs = await loadKmlKmz(file);
        crossSection.setCenterline(latLngs);
        updateCenterlineUI(true, file.name);
      } catch (err) {
        alert(`Lỗi tải tim tuyến: ${err.message}`);
      }
    });
  }

  if (btnClearCenterline) {
    btnClearCenterline.addEventListener('click', () => {
      crossSection.clearCenterline();
      updateCenterlineUI(false);
    });
  }

  // Snap to survey points
  const chkSnapPoints = document.getElementById('chkSnapPoints');
  if (chkSnapPoints) {
    chkSnapPoints.addEventListener('change', (e) => {
      crossSection.setSnapEnabled(e.target.checked);
    });
  }

  // Multi-cut: add / select / remove
  const btnAddCut = document.getElementById('btnAddCut');
  if (btnAddCut) {
    btnAddCut.addEventListener('click', () => crossSection.addCut());
  }
  const cutList = document.getElementById('cutList');
  if (cutList) {
    cutList.addEventListener('click', (e) => {
      const selectBtn = e.target.closest('[data-cut-id]');
      if (selectBtn) {
        crossSection.setActiveCut(Number(selectBtn.dataset.cutId));
        return;
      }
      const removeBtn = e.target.closest('[data-cut-remove]');
      if (removeBtn) {
        crossSection.removeCut(Number(removeBtn.dataset.cutRemove));
      }
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

  // Expand / collapse cross-section chart panel
  const btnToggleCsSize = document.getElementById('btnToggleCsSize');
  const csPanel = document.querySelector('.cross-section-panel');
  btnToggleCsSize.addEventListener('click', () => {
    const isExpanded = csPanel.classList.toggle('expanded');
    const icon = btnToggleCsSize.querySelector('i');
    if (icon) {
      icon.className = isExpanded ? 'fa-solid fa-compress' : 'fa-solid fa-expand';
    }
    btnToggleCsSize.title = isExpanded ? 'Thu nhỏ mặt cắt' : 'Phóng to mặt cắt';
    setTimeout(() => {
      if (chartManager.chart) chartManager.chart.resize();
      scene3D.onWindowResize();
      crossSection.resizeMap();
    }, 360);
  });

  // Distance origin for hover depth label (from A or from B)
  const originBtns = document.querySelectorAll('.cs-origin-toggle .toggle-btn');
  originBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      originBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      chartManager.distanceOrigin = btn.dataset.origin === 'B' ? 'B' : 'A';
      if (chartManager.chart) chartManager.chart.draw();
    });
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
