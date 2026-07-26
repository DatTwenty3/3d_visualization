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
    updateCsMeters(stats);
  });

  window.crossSection = crossSection;

  // Bind VN-2000 projectors for 3D Google Hybrid ground basemap
  scene3D.setBasemapProjectors(
    (x, y) => crossSection.utmToLatLng(x, y),
    (lat, lng) => crossSection.latLngToUtm(lat, lng)
  );

  /** Sync depth ribbon + legend labels from dataset bounds */
  function updateDepthInstruments(palette) {
    const paletteName = palette || (document.getElementById('paletteSelect')?.value) || 'rainbow';
    // Display LTR: nông (shallow) → sâu (deep) — reverse of ColorRamps stop order
    const gradient = ColorRamps.getLegendGradientCSS(paletteName).replace('to right', 'to left');
    const ribbon = document.getElementById('quickStats');
    if (ribbon) ribbon.style.setProperty('--depth-ribbon-gradient', gradient);

    const legendBar = document.getElementById('colorLegendBar');
    if (legendBar) legendBar.style.background = gradient;

    const hud = document.getElementById('hoverInfoHUD');
    if (hud) hud.style.setProperty('--hud-meter-gradient', gradient);

    const b = dataLoader.bounds;
    if (!b || !Number.isFinite(b.minZ)) return;

    const shallowEl = document.getElementById('legendShallowZ');
    const deepEl = document.getElementById('legendDeepZ');
    if (shallowEl) shallowEl.textContent = `${b.maxZ.toFixed(2)} m`;
    if (deepEl) deepEl.textContent = `${b.minZ.toFixed(2)} m`;
  }

  /** Update cross-section inline meters */
  function updateCsMeters(stats) {
    if (!stats) return;
    const widthEl = document.getElementById('csWidth');
    const depthEl = document.getElementById('csMaxDepth');
    const areaEl = document.getElementById('csArea');
    const barEl = document.getElementById('csWidthBar');
    if (widthEl) widthEl.textContent = `${stats.width} m`;
    if (depthEl) depthEl.textContent = `${stats.maxDepth} m`;
    if (areaEl) areaEl.textContent = `${stats.area} m²`;
    if (barEl) {
      const w = parseFloat(stats.width);
      // Scale bar: ~200 m full; clamp 8–100%
      const pct = Number.isFinite(w) ? Math.min(100, Math.max(8, (w / 200) * 100)) : 0;
      barEl.style.width = `${pct}%`;
    }
  }

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

  // EPSG CRS selector (VN-2000 TM-3 zones)
  const epsgSelect = document.getElementById('epsgSelect');
  if (epsgSelect) {
    epsgSelect.value = crossSection.getEpsg();
    epsgSelect.addEventListener('change', () => {
      crossSection.setEpsg(epsgSelect.value);
      scene3D.rebuildBasemap();
    });
  }

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

        // Update Stats UI — depth ribbon (nông / TB / sâu) + điểm đo
        const b = dataLoader.bounds;
        const minDepthTxt = `${b.maxZ.toFixed(2)} m`; // nông nhất = Z cao nhất
        const maxDepthTxt = `${b.minZ.toFixed(2)} m`; // sâu nhất = Z thấp nhất
        const avgDepthTxt = `${b.meanZ.toFixed(2)} m`;
        document.getElementById('statTotalPoints').textContent = dataLoader.points.length.toLocaleString();
        document.getElementById('statMinDepth').textContent = minDepthTxt;
        document.getElementById('statMaxDepth').textContent = maxDepthTxt;
        document.getElementById('statAvgDepth').textContent = avgDepthTxt;
        const quickStats = document.getElementById('quickStats');
        if (quickStats) {
          quickStats.title = `Nông: ${minDepthTxt} · TB: ${avgDepthTxt} · Sâu: ${maxDepthTxt}`;
        }
        updateDepthInstruments();
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
    chartManager.setColorPalette(palette);
    crossSection.drawMap();
    updateDepthInstruments(palette);
  });
  updateDepthInstruments('rainbow');
  chartManager.setColorPalette('rainbow');



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

  // 3D Google Hybrid ground basemap toggle
  const chkBasemap3D = document.getElementById('chkBasemap3D');
  if (chkBasemap3D) {
    scene3D.setBasemapVisible(chkBasemap3D.checked);
    chkBasemap3D.addEventListener('change', (e) => {
      scene3D.setBasemapVisible(e.target.checked);
    });
  }

  // Water Level Elevation Input
  const waterLevelInput = document.getElementById('waterLevelInput');
  waterLevelInput.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    const level = Number.isFinite(val) ? val : 0;
    scene3D.setWaterLevel(level);
    const stats = chartManager.setWaterLevel(level);
    updateCsMeters(stats);
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

  // ——— Layout shell: drawer, accordion, map, chart, workspace modes ———
  const map2dWindow = document.getElementById('map2dWindow');
  const btnToggleMapSize = document.getElementById('btnToggleMapSize');
  const btnMinimizeMap = document.getElementById('btnMinimizeMap');
  const csPanel = document.getElementById('crossSectionPanel') || document.querySelector('.cross-section-panel');
  const btnToggleCsSize = document.getElementById('btnToggleCsSize');
  const appSidebar = document.getElementById('appSidebar');
  const sidebarBackdrop = document.getElementById('sidebarBackdrop');
  const btnOpenSidebar = document.getElementById('btnOpenSidebar');
  const btnCloseSidebar = document.getElementById('btnCloseSidebar');
  const workspaceBtns = document.querySelectorAll('.workspace-mode-btn');

  let mapUserMinimized = false;
  let suppressWorkspaceSync = false;

  function scheduleLayoutResize(delay = 320) {
    setTimeout(() => {
      scene3D.onWindowResize();
      if (chartManager.chart) chartManager.chart.resize();
      crossSection.resizeMap();
      crossSection.drawMap();
    }, delay);
  }

  function updateMapChrome() {
    const maximized = map2dWindow.classList.contains('maximized');
    const minimized = map2dWindow.classList.contains('minimized');
    const expandIcon = btnToggleMapSize && btnToggleMapSize.querySelector('i');
    if (expandIcon) {
      expandIcon.className = maximized ? 'fa-solid fa-compress' : 'fa-solid fa-expand';
    }
    if (btnToggleMapSize) {
      btnToggleMapSize.title = maximized ? 'Thu về inset' : 'Phóng to bản đồ 2D';
    }
    if (btnMinimizeMap) {
      const minIcon = btnMinimizeMap.querySelector('i');
      if (minIcon) {
        minIcon.className = minimized ? 'fa-solid fa-window-maximize' : 'fa-solid fa-minus';
      }
      btnMinimizeMap.title = minimized ? 'Mở lại bản đồ' : 'Thu nhỏ bản đồ 2D';
    }
  }

  function updateCsChrome() {
    if (!btnToggleCsSize || !csPanel) return;
    const expanded = csPanel.classList.contains('expanded');
    const icon = btnToggleCsSize.querySelector('i');
    if (expanded) {
      if (icon) icon.className = 'fa-solid fa-compress';
      btnToggleCsSize.title = 'Thu về tổng quan';
    } else {
      if (icon) icon.className = 'fa-solid fa-expand';
      btnToggleCsSize.title = 'Phóng to mặt cắt';
    }
  }

  function setMapState({ maximized = false, minimized = false } = {}) {
    map2dWindow.classList.toggle('maximized', maximized);
    map2dWindow.classList.toggle('minimized', minimized && !maximized);
    updateMapChrome();
  }

  function setChartState(state) {
    // state: 'collapsed' | 'normal' | 'expanded'
    csPanel.classList.remove('collapsed', 'expanded', 'hidden-by-mode');
    if (state === 'collapsed') csPanel.classList.add('collapsed');
    else if (state === 'expanded') csPanel.classList.add('expanded');
    updateCsChrome();
  }

  function openDrawer() {
    appSidebar.classList.add('open');
    appSidebar.setAttribute('aria-hidden', 'false');
    document.body.classList.add('drawer-open');
    if (sidebarBackdrop) {
      sidebarBackdrop.hidden = false;
      requestAnimationFrame(() => sidebarBackdrop.classList.add('visible'));
    }
    if (btnOpenSidebar) btnOpenSidebar.setAttribute('aria-expanded', 'true');
  }

  function closeDrawer() {
    appSidebar.classList.remove('open');
    appSidebar.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('drawer-open');
    if (sidebarBackdrop) {
      sidebarBackdrop.classList.remove('visible');
      setTimeout(() => { sidebarBackdrop.hidden = true; }, 220);
    }
    if (btnOpenSidebar) btnOpenSidebar.setAttribute('aria-expanded', 'false');
  }

  function applyWorkspace(mode) {
    document.body.dataset.workspace = mode;
    workspaceBtns.forEach((btn) => {
      const active = btn.dataset.workspace === mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    if (mode === 'overview') {
      setChartState('normal');
      setMapState({ maximized: false, minimized: mapUserMinimized });
    } else if (mode === '3d') {
      setChartState('collapsed');
      csPanel.classList.add('hidden-by-mode');
      setMapState({ maximized: false, minimized: true });
    } else if (mode === 'map') {
      setChartState('collapsed');
      csPanel.classList.add('hidden-by-mode');
      setMapState({ maximized: true, minimized: false });
    } else if (mode === 'section') {
      setChartState('expanded');
      setMapState({ maximized: false, minimized: true });
    }

    scheduleLayoutResize(360);
  }

  if (btnOpenSidebar) btnOpenSidebar.addEventListener('click', openDrawer);
  if (btnCloseSidebar) btnCloseSidebar.addEventListener('click', closeDrawer);
  if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeDrawer);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && appSidebar.classList.contains('open')) {
      closeDrawer();
    }
  });

  // Accordion sections
  document.querySelectorAll('.sidebar-section .section-title').forEach((titleBtn) => {
    titleBtn.addEventListener('click', () => {
      const section = titleBtn.closest('.sidebar-section');
      const body = section.querySelector('.section-body');
      const willOpen = !section.classList.contains('open');

      document.querySelectorAll('.sidebar-section').forEach((s) => {
        s.classList.remove('open');
        const b = s.querySelector('.section-body');
        const t = s.querySelector('.section-title');
        if (b) b.hidden = true;
        if (t) t.setAttribute('aria-expanded', 'false');
      });

      if (willOpen) {
        section.classList.add('open');
        if (body) body.hidden = false;
        titleBtn.setAttribute('aria-expanded', 'true');
      }
    });
  });

  // Ensure default accordion: only Hiển thị open
  document.querySelectorAll('.sidebar-section').forEach((s) => {
    const isOpen = s.classList.contains('open');
    const body = s.querySelector('.section-body');
    const title = s.querySelector('.section-title');
    if (body) body.hidden = !isOpen;
    if (title) title.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });

  workspaceBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (suppressWorkspaceSync) return;
      applyWorkspace(btn.dataset.workspace);
    });
  });

  btnToggleMapSize.addEventListener('click', () => {
    const willMaximize = !map2dWindow.classList.contains('maximized');
    if (willMaximize) {
      mapUserMinimized = false;
      setMapState({ maximized: true, minimized: false });
      if (document.body.dataset.workspace !== 'map') {
        suppressWorkspaceSync = true;
        document.body.dataset.workspace = 'map';
        workspaceBtns.forEach((b) => {
          const active = b.dataset.workspace === 'map';
          b.classList.toggle('active', active);
          b.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        csPanel.classList.add('hidden-by-mode');
        suppressWorkspaceSync = false;
      }
    } else {
      setMapState({ maximized: false, minimized: mapUserMinimized });
      if (document.body.dataset.workspace === 'map') {
        applyWorkspace('overview');
        return;
      }
    }
    scheduleLayoutResize(320);
  });

  if (btnMinimizeMap) {
    btnMinimizeMap.addEventListener('click', () => {
      if (map2dWindow.classList.contains('minimized')) {
        mapUserMinimized = false;
        setMapState({ maximized: false, minimized: false });
      } else {
        mapUserMinimized = true;
        setMapState({ maximized: false, minimized: true });
      }
      scheduleLayoutResize(280);
    });
  }

  // Chart on overview: normal ↔ expanded (no collapsed on overview)
  btnToggleCsSize.addEventListener('click', () => {
    if (csPanel.classList.contains('hidden-by-mode') ||
        document.body.dataset.workspace === '3d' ||
        document.body.dataset.workspace === 'map') {
      applyWorkspace('section');
      return;
    }
    if (csPanel.classList.contains('expanded')) {
      setChartState('normal');
      if (document.body.dataset.workspace === 'section') {
        suppressWorkspaceSync = true;
        document.body.dataset.workspace = 'overview';
        workspaceBtns.forEach((b) => {
          const active = b.dataset.workspace === 'overview';
          b.classList.toggle('active', active);
          b.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        suppressWorkspaceSync = false;
      }
    } else {
      // normal or collapsed → expand (focus)
      setChartState('expanded');
      if (document.body.dataset.workspace === 'overview') {
        suppressWorkspaceSync = true;
        document.body.dataset.workspace = 'section';
        workspaceBtns.forEach((b) => {
          const active = b.dataset.workspace === 'section';
          b.classList.toggle('active', active);
          b.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        suppressWorkspaceSync = false;
      }
    }
    scheduleLayoutResize(360);
  });

  // Initial chrome + layout for default overview
  updateMapChrome();
  updateCsChrome();
  applyWorkspace(document.body.dataset.workspace || 'overview');

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
