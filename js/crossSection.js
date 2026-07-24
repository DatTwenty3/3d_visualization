/**
 * 2D Bathymetry GIS Map & Cross-Section Interactive Tool
 * Supports VN-2000 Trà Vinh Coordinate System (+lon_0=105.5, +k=0.9999) & Leaflet Basemaps
 */

class CrossSection {
  constructor(canvasId, dataLoader, onProfileChanged) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.dataLoader = dataLoader;
    this.onProfileChanged = onProfileChanged;

    // Line A-B in geo UTM coordinates (x, y)
    this.pointA = null;
    this.pointB = null;

    // Interaction state
    this.isDrawing = false;
    this.hoverPos = null;

    // Leaflet GIS components
    this.map = null;
    this.activeBasemap = 'satellite';
    this.tileLayers = {};
    this.pointLayerGroup = null;
    this.markerA = null;
    this.markerB = null;
    this.cutPolyline = null;
    this.mapFitDone = false;

    this.registerVN2000();
    this.initLeaflet();
    this.initEvents();
  }

  /**
   * Register official VN-2000 Trà Vinh projection definition in Proj4
   * Central Meridian: 105°30' (105.5°), Scale factor k = 0.9999, 3° zone
   */
  registerVN2000() {
    if (window.proj4) {
      proj4.defs("VN2000_TRAVINH", "+proj=tmerc +lat_0=0 +lon_0=105.5 +k=0.9999 +x_0=500000 +y_0=0 +ellps=WGS84 +towgs84=-191.9044,-39.3032,-111.4503,-0.00928836,0.00975459,-0.01175049,-0.00000127 +units=m +no_defs");
    }
  }

  /**
   * Convert VN-2000 Trà Vinh (X Northing, Y Easting) to WGS84 [Lat, Lng]
   */
  utmToLatLng(x, y) {
    if (window.proj4) {
      try {
        // In VN-2000: y is Easting (~580,000), x is Northing (~1,109,000)
        const [lng, lat] = proj4("VN2000_TRAVINH", "EPSG:4326", [y, x]);
        return [lat, lng];
      } catch (e) {
        console.warn("Proj4 VN-2000 conversion error", e);
      }
    }
    // Accurate mathematical fallback for Trà Vinh
    const refLat = 10.0335;
    const refLng = 106.2307;
    const refX = 1109271.482;
    const refY = 579996.786;
    const lat = refLat + (x - refX) / 110800;
    const lng = refLng + (y - refY) / (110800 * Math.cos(refLat * Math.PI / 180));
    return [lat, lng];
  }

  /**
   * Convert WGS84 [Lat, Lng] to VN-2000 Trà Vinh {x, y}
   */
  latLngToUtm(lat, lng) {
    if (window.proj4) {
      try {
        const [y, x] = proj4("EPSG:4326", "VN2000_TRAVINH", [lng, lat]);
        return { x, y };
      } catch (e) {
        console.warn("Proj4 VN-2000 reverse conversion error", e);
      }
    }
    const refLat = 10.0335;
    const refLng = 106.2307;
    const refX = 1109271.482;
    const refY = 579996.786;
    const x = refX + (lat - refLat) * 110800;
    const y = refY + (lng - refLng) * (110800 * Math.cos(refLat * Math.PI / 180));
    return { x, y };
  }

  /**
   * Initialize Leaflet GIS Map Container
   */
  initLeaflet() {
    const leafletContainer = document.getElementById('leafletMap');
    if (!leafletContainer || typeof L === 'undefined') return;

    // Initial center in Trà Vinh river basin
    this.map = L.map('leafletMap', {
      zoomControl: false,
      attributionControl: false
    }).setView([10.0335, 106.2307], 15);

    // Zoom Control Top Right
    L.control.zoom({ position: 'topright' }).addTo(this.map);

    this.activeBasemap = 'googleHybrid';

    // Tile Layers
    this.tileLayers = {
      googleHybrid: L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        subdomains: ['0', '1', '2', '3']
      }),
      googleSatellite: L.tileLayer('https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        subdomains: ['0', '1', '2', '3']
      }),
      satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19
      }),
      dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd'
      }),
      osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
      })
    };

    // Add initial Google Hybrid Satellite tile layer
    this.tileLayers.googleHybrid.addTo(this.map);

    // Point layer group using Canvas Renderer
    this.pointLayerGroup = L.layerGroup().addTo(this.map);

    // Contour lines layer group
    this.contourLayerGroup = L.layerGroup().addTo(this.map);
    this.showContours = true;
    this.contourInterval = 1; // Contour spacing (m), range 0.5–1

    // Map Click event to relocate line endpoints
    this.map.on('click', (e) => {
      const geo = this.latLngToUtm(e.latlng.lat, e.latlng.lng);
      if (!this.pointA || !this.pointB) {
        this.pointA = geo;
        this.pointB = geo;
      } else {
        const dA = Math.hypot(geo.x - this.pointA.x, geo.y - this.pointA.y);
        const dB = Math.hypot(geo.x - this.pointB.x, geo.y - this.pointB.y);
        if (dA < dB) {
          this.pointA = geo;
        } else {
          this.pointB = geo;
        }
      }
      this.updateLeafletElements();
      this.updateProfile();
    });
  }

  /**
   * Switch GIS Basemap Layer
   */
  setBasemap(type) {
    this.activeBasemap = type;
    const leafletElem = document.getElementById('leafletMap');
    const canvasElem = this.canvas;

    if (type === 'none') {
      if (leafletElem) leafletElem.style.display = 'none';
      if (canvasElem) canvasElem.style.pointerEvents = 'auto';
      this.drawMap();
    } else {
      if (leafletElem) leafletElem.style.display = 'block';
      if (canvasElem) canvasElem.style.pointerEvents = 'none';

      if (this.map) {
        Object.values(this.tileLayers).forEach(layer => {
          if (this.map.hasLayer(layer)) this.map.removeLayer(layer);
        });

        if (this.tileLayers[type]) {
          this.tileLayers[type].addTo(this.map);
        }

        setTimeout(() => this.resizeMap(), 200);
      }
    }
  }

  /**
   * Invalidate Leaflet Map Size & Fit Bounds when window resizes or maximizes
   */
  resizeMap() {
    if (this.map) {
      this.map.invalidateSize();
      if (this.dataLoader && this.dataLoader.points && this.dataLoader.points.length > 0) {
        const latLngs = this.dataLoader.points.map(p => this.utmToLatLng(p.x, p.y));
        this.map.fitBounds(L.latLngBounds(latLngs), { padding: [35, 35] });
      }
    }
  }

  /**
   * Set contour spacing (meters) and redraw isobaths on the 2D map
   */
  setContourInterval(interval) {
    let step = Number(interval);
    if (!Number.isFinite(step)) step = 1;
    this.contourInterval = Math.min(1, Math.max(0.5, step));
    this.updateLeafletElements();
  }

  /**
   * Update Leaflet Points, Markers A/B & Cut Line
   */
  updateLeafletElements() {
    if (!this.map || !this.dataLoader || this.activeBasemap === 'none') return;

    // 1. Draw Points on Leaflet Map
    this.pointLayerGroup.clearLayers();
    const { points } = this.dataLoader;
    const paletteName = window.scene3D ? window.scene3D.colorPalette : 'bathymetry';

    const canvasRenderer = L.canvas({ padding: 0.5 });

    points.forEach(p => {
      const latLng = this.utmToLatLng(p.x, p.y);
      const colorStr = ColorRamps.getColorCSS(p.normZ, paletteName);

      const marker = L.circleMarker(latLng, {
        renderer: canvasRenderer,
        radius: 3.5,
        fillColor: colorStr,
        fillOpacity: 0.95,
        stroke: false
      });

      marker.bindTooltip(`
        <div style="font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif; font-size:11px; padding:2px;">
          <b>${p.id}</b><br/>
          X: ${p.x.toFixed(2)}m<br/>
          Y: ${p.y.toFixed(2)}m<br/>
          <b style="color:#ea580c">Z: ${p.z.toFixed(2)}m (${(-p.z).toFixed(2)}m sâu)</b>
        </div>
      `, { sticky: true, opacity: 0.9 });

      marker.addTo(this.pointLayerGroup);
    });

    // 2. Draw 2D Contour Lines (Isobaths)
    this.contourLayerGroup.clearLayers();
    if (this.showContours && this.dataLoader.generateContours) {
      const contours = this.dataLoader.generateContours(this.contourInterval);
      contours.forEach(c => {
        const level = c.level;
        c.segments.forEach(seg => {
          const latLng1 = this.utmToLatLng(seg[0].x, seg[0].y);
          const latLng2 = this.utmToLatLng(seg[1].x, seg[1].y);

          L.polyline([latLng1, latLng2], {
            color: '#1e3a8a',
            weight: 1.5,
            opacity: 0.75
          }).addTo(this.contourLayerGroup);
        });
      });
    }

    // 2. Draw Cut Line A-B and Draggable Markers
    if (this.pointA && this.pointB) {
      const latLngA = this.utmToLatLng(this.pointA.x, this.pointA.y);
      const latLngB = this.utmToLatLng(this.pointB.x, this.pointB.y);

      // Polyline
      if (this.cutPolyline) this.map.removeLayer(this.cutPolyline);
      this.cutPolyline = L.polyline([latLngA, latLngB], {
        color: '#ea580c',
        weight: 4,
        opacity: 0.95
      }).addTo(this.map);

      // Custom Icons for A and B
      const iconA = L.divIcon({
        className: 'leaflet-custom-marker',
        html: '<div style="background:#1e3a8a; color:#fff; font-weight:bold; border-radius:50%; width:22px; height:22px; text-align:center; line-height:22px; border:2px solid #fff; box-shadow:0 2px 6px rgba(0,0,0,0.3);">A</div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });

      const iconB = L.divIcon({
        className: 'leaflet-custom-marker',
        html: '<div style="background:#ea580c; color:#fff; font-weight:bold; border-radius:50%; width:22px; height:22px; text-align:center; line-height:22px; border:2px solid #fff; box-shadow:0 2px 6px rgba(0,0,0,0.3);">B</div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });

      // Marker A
      if (this.markerA) this.map.removeLayer(this.markerA);
      this.markerA = L.marker(latLngA, { draggable: true, icon: iconA }).addTo(this.map);
      this.markerA.on('drag', (e) => {
        const pos = e.target.getLatLng();
        this.pointA = this.latLngToUtm(pos.lat, pos.lng);
        this.cutPolyline.setLatLngs([pos, this.utmToLatLng(this.pointB.x, this.pointB.y)]);
        this.updateProfile();
      });

      // Marker B
      if (this.markerB) this.map.removeLayer(this.markerB);
      this.markerB = L.marker(latLngB, { draggable: true, icon: iconB }).addTo(this.map);
      this.markerB.on('drag', (e) => {
        const pos = e.target.getLatLng();
        this.pointB = this.latLngToUtm(pos.lat, pos.lng);
        this.cutPolyline.setLatLngs([this.utmToLatLng(this.pointA.x, this.pointA.y), pos]);
        this.updateProfile();
      });

      // Fit map bounds to points data
      if (points.length > 0 && !this.mapFitDone) {
        const bounds = points.map(p => this.utmToLatLng(p.x, p.y));
        this.map.fitBounds(L.latLngBounds(bounds), { padding: [30, 30] });
        this.mapFitDone = true;
      }
    }
  }

  initEvents() {
    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
    this.canvas.addEventListener('mouseleave', () => {
      this.hoverPos = null;
      this.drawMap();
    });

    window.addEventListener('resize', () => this.drawMap());
  }

  resizeCanvas() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    this.canvas.width = parent.clientWidth;
    this.canvas.height = parent.clientHeight;
  }

  getScaleAndOffsets() {
    if (!this.dataLoader || !this.dataLoader.bounds) return { scale: 1, offsetX: 0, offsetY: 0 };
    const { minX, maxX, minY, maxY, spanX, spanY } = this.dataLoader.bounds;
    const padding = 28;
    const availW = this.canvas.width - padding * 2;
    const availH = this.canvas.height - padding * 2;

    const scaleX = availW / (spanX || 1);
    const scaleY = availH / (spanY || 1);
    const scale = Math.min(scaleX, scaleY);

    const drawW = spanX * scale;
    const drawH = spanY * scale;
    const offsetX = padding + (availW - drawW) / 2;
    const offsetY = padding + (availH - drawH) / 2;

    return { scale, offsetX, offsetY, drawW, drawH };
  }

  geoToPixel(x, y) {
    if (!this.dataLoader || !this.dataLoader.bounds) return { px: 0, py: 0 };
    const { scale, offsetX, offsetY } = this.getScaleAndOffsets();
    const { minX, minY } = this.dataLoader.bounds;

    const px = offsetX + (x - minX) * scale;
    const py = (this.canvas.height - offsetY) - (y - minY) * scale;

    return { px, py };
  }

  pixelToGeo(px, py) {
    if (!this.dataLoader || !this.dataLoader.bounds) return { x: 0, y: 0 };
    const { scale, offsetX, offsetY } = this.getScaleAndOffsets();
    const { minX, minY } = this.dataLoader.bounds;

    const x = minX + (px - offsetX) / scale;
    const y = minY + ((this.canvas.height - offsetY) - py) / scale;

    return { x, y };
  }

  drawMap() {
    if (this.activeBasemap !== 'none') {
      this.updateLeafletElements();
      return;
    }

    this.resizeCanvas();
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;

    ctx.clearRect(0, 0, width, height);

    if (!this.dataLoader || !this.dataLoader.points || this.dataLoader.points.length === 0) return;

    const { points } = this.dataLoader;
    const paletteName = window.scene3D ? window.scene3D.colorPalette : 'bathymetry';

    ctx.fillStyle = '#080c14';
    ctx.fillRect(0, 0, width, height);

    const pointSize = Math.max(3, Math.min(8, width / 70));
    points.forEach(p => {
      const { px, py } = this.geoToPixel(p.x, p.y);
      const colorStr = ColorRamps.getColorCSS(p.normZ, paletteName);

      ctx.fillStyle = colorStr;
      ctx.beginPath();
      ctx.arc(px, py, pointSize / 2, 0, Math.PI * 2);
      ctx.fill();
    });

    if (this.pointA && this.pointB) {
      const pA = this.geoToPixel(this.pointA.x, this.pointA.y);
      const pB = this.geoToPixel(this.pointB.x, this.pointB.y);

      ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(pA.px, pA.py);
      ctx.lineTo(pB.px, pB.py);
      ctx.stroke();

      ctx.strokeStyle = '#ff3366';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(pA.px, pA.py);
      ctx.lineTo(pB.px, pB.py);
      ctx.stroke();

      ctx.fillStyle = '#00f2fe';
      ctx.beginPath();
      ctx.arc(pA.px, pA.py, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif';
      ctx.fillText('A', pA.px + 10, pA.py - 10);

      ctx.fillStyle = '#ff3366';
      ctx.beginPath();
      ctx.arc(pB.px, pB.py, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      ctx.fillText('B', pB.px + 10, pB.py - 10);
    }

    this.drawCompass(ctx);
    this.drawScaleBar(ctx);

    if (this.hoverPos) {
      this.drawHoverInfo(ctx);
    }
  }

  drawCompass(ctx) {
    const cx = 35;
    const cy = 40;

    ctx.save();
    ctx.fillStyle = 'rgba(18, 26, 43, 0.85)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ff5252';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 14);
    ctx.lineTo(cx - 5, cy + 2);
    ctx.lineTo(cx, cy - 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 14);
    ctx.lineTo(cx + 5, cy + 2);
    ctx.lineTo(cx, cy - 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', cx, cy - 17);
    ctx.restore();
  }

  drawScaleBar(ctx) {
    const { scale } = this.getScaleAndOffsets();
    if (!scale || scale <= 0) return;

    const targetPx = 80;
    const approxMeters = targetPx / scale;
    const niceMeters = [10, 20, 50, 100, 200, 500, 1000].reduce((prev, curr) => {
      return Math.abs(curr - approxMeters) < Math.abs(prev - approxMeters) ? curr : prev;
    });

    const barPx = niceMeters * scale;
    const marginX = 16;
    const marginY = this.canvas.height - 18;

    ctx.save();
    ctx.strokeStyle = '#00f2fe';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(marginX, marginY);
    ctx.lineTo(marginX + barPx, marginY);
    ctx.stroke();

    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(marginX, marginY - 4);
    ctx.lineTo(marginX, marginY + 4);
    ctx.moveTo(marginX + barPx, marginY - 4);
    ctx.lineTo(marginX + barPx, marginY + 4);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = '10px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${niceMeters} m`, marginX + barPx + 6, marginY + 3);
    ctx.restore();
  }

  drawHoverInfo(ctx) {
    const { x, y } = this.hoverPos;
    ctx.save();
    ctx.fillStyle = 'rgba(11, 15, 25, 0.9)';
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.4)';
    ctx.lineWidth = 1;
    ctx.fillRect(this.canvas.width - 145, 8, 137, 36);
    ctx.strokeRect(this.canvas.width - 145, 8, 137, 36);

    ctx.fillStyle = '#00f2fe';
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillText(`X: ${x.toFixed(2)}`, this.canvas.width - 138, 22);
    ctx.fillText(`Y: ${y.toFixed(2)}`, this.canvas.width - 138, 36);
    ctx.restore();
  }

  onMouseDown(e) {
    if (this.activeBasemap !== 'none') return;
    const rect = this.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const geo = this.pixelToGeo(px, py);
    this.pointA = geo;
    this.pointB = geo;
    this.isDrawing = true;
    this.activePreset = 'custom';

    this.drawMap();
  }

  onMouseMove(e) {
    if (this.activeBasemap !== 'none') return;
    const rect = this.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    this.hoverPos = this.pixelToGeo(px, py);

    if (this.isDrawing) {
      this.pointB = this.hoverPos;
      this.updateProfile();
    }

    this.drawMap();
  }

  onMouseUp(e) {
    if (this.activeBasemap !== 'none' || !this.isDrawing) return;
    this.isDrawing = false;
    this.updateProfile();
  }

  setPreset(presetKey) {
    if (!this.dataLoader || !this.dataLoader.bounds) return;
    const { minX, maxX, minY, maxY } = this.dataLoader.bounds;
    this.activePreset = presetKey;

    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const dx = (maxX - minX) * 0.4;
    const dy = (maxY - minY) * 0.4;

    if (presetKey === 'transverse-mid') {
      this.pointA = { x: minX + (maxX - minX) * 0.1, y: midY - dy * 0.2 };
      this.pointB = { x: maxX - (maxX - minX) * 0.1, y: midY + dy * 0.2 };
    } else if (presetKey === 'transverse-north') {
      this.pointA = { x: minX + (maxX - minX) * 0.1, y: maxY - (maxY - minY) * 0.2 };
      this.pointB = { x: maxX - (maxX - minX) * 0.1, y: maxY - (maxY - minY) * 0.15 };
    } else if (presetKey === 'transverse-south') {
      this.pointA = { x: minX + (maxX - minX) * 0.1, y: minY + (maxY - minY) * 0.2 };
      this.pointB = { x: maxX - (maxX - minX) * 0.1, y: minY + (maxY - minY) * 0.15 };
    } else if (presetKey === 'longitudinal') {
      this.pointA = { x: midX - dx * 0.2, y: minY + (maxY - minY) * 0.1 };
      this.pointB = { x: midX + dx * 0.2, y: maxY - (maxY - minY) * 0.1 };
    }

    this.drawMap();
    this.updateProfile();
  }

  updateProfile() {
    if (!this.pointA || !this.pointB) return;

    const profileSamples = this.dataLoader.sampleProfile(
      this.pointA.x, this.pointA.y,
      this.pointB.x, this.pointB.y,
      120
    );

    if (typeof this.onProfileChanged === 'function') {
      this.onProfileChanged(profileSamples, this.pointA, this.pointB);
    }
  }
}

window.CrossSection = CrossSection;
