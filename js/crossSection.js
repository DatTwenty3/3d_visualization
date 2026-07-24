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

    // Line A-B in geo UTM coordinates (x, y) — mirrors active cut
    this.pointA = null;
    this.pointB = null;

    // Multi-cut registry
    this.CUT_PALETTE = [
      { hex: 0xea580c, css: '#ea580c' },
      { hex: 0x0071e3, css: '#0071e3' },
      { hex: 0x34c759, css: '#34c759' },
      { hex: 0xaf52de, css: '#af52de' },
      { hex: 0xff9f0a, css: '#ff9f0a' }
    ];
    this.cuts = []; // { id, label, colorHex, colorCss, pointA, pointB }
    this.activeCutId = null;
    this._nextCutId = 1;
    this.onCutsListChanged = null; // UI refresh callback

    // Ortho + snap (AutoCAD-like) — Ngang/Dọc require centerline
    this.cutMode = 'free'; // 'free' | 'transverse' | 'longitudinal'
    this.snapEnabled = true;
    this.snapToleranceM = 8;
    this.defaultHalfWidth = 60; // m — default transverse half-length each side

    // Centerline (tim tuyến) from KML/KMZ — VN-2000 {x,y,s}
    this.centerline = null;
    this.centerlineLayer = null;
    this.onCenterlineChanged = null; // UI callback(hasCenterline)

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
    this.markerMid = null;
    this.cutPolyline = null; // active cut line
    this.inactiveCutLayerGroup = null;
    this.mapFitDone = false;
    this._isMovingCut = false;
    this._moveCutStart = null;

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

    // Inactive cut polylines
    this.inactiveCutLayerGroup = L.layerGroup().addTo(this.map);

    // Centerline layer (drawn under cuts)
    this.centerlineLayerGroup = L.layerGroup().addTo(this.map);

    // Map Click event to relocate line endpoints (with snap + ortho)
    this.map.on('click', (e) => {
      if (this._isMovingCut || this._suppressMapClick) return;
      let geo = this.latLngToUtm(e.latlng.lat, e.latlng.lng);

      if (this.cutMode === 'transverse' && this.centerline) {
        this.applyTransverseAtGeo(geo);
        this.updateLeafletElements();
        this.updateProfile();
        return;
      }
      if (this.cutMode === 'longitudinal' && this.centerline) {
        this.dragLongitudinalEndpoint(geo, null);
        this.updateLeafletElements();
        this.updateProfile();
        return;
      }

      if (!this.pointA || !this.pointB) {
        geo = this.constrainCutPoint(geo, null);
        this.pointA = geo;
        this.pointB = { ...geo };
      } else {
        const dA = Math.hypot(geo.x - this.pointA.x, geo.y - this.pointA.y);
        const dB = Math.hypot(geo.x - this.pointB.x, geo.y - this.pointB.y);
        if (dA < dB) {
          this.pointA = this.constrainCutPoint(geo, this.pointB);
        } else {
          this.pointB = this.constrainCutPoint(geo, this.pointA);
        }
      }
      this.updateLeafletElements();
      this.updateProfile();
    });

    // Translate whole cut line while dragging mid-handle or polyline
    this.map.on('mousemove', (e) => {
      if (!this._isMovingCut || !this._moveCutStart) return;
      const cur = this.latLngToUtm(e.latlng.lat, e.latlng.lng);
      this.translateCutByDelta(
        cur.x - this._moveCutStart.cursor.x,
        cur.y - this._moveCutStart.cursor.y
      );
    });
    this.map.on('mouseup', () => this.endMoveCutLine());
  }

  /**
   * Translate A–B by (dx, dy) in VN-2000 meters.
   * With centerline modes: slide along centerline instead of free translate.
   */
  translateCutByDelta(dx, dy, syncOpts = {}) {
    if (!this._moveCutStart) return;

    if (this.cutMode === 'transverse' && this.centerline) {
      const mid = {
        x: (this._moveCutStart.a.x + this._moveCutStart.b.x) / 2 + dx,
        y: (this._moveCutStart.a.y + this._moveCutStart.b.y) / 2 + dy
      };
      this.applyTransverseAtGeo(mid, this._moveCutStart.offsetA, this._moveCutStart.offsetB);
      this.syncCutGraphics(syncOpts);
      this.updateProfile();
      return;
    }

    if (this.cutMode === 'longitudinal' && this.centerline) {
      const mid = {
        x: (this._moveCutStart.a.x + this._moveCutStart.b.x) / 2 + dx,
        y: (this._moveCutStart.a.y + this._moveCutStart.b.y) / 2 + dy
      };
      const proj = this.projectToCenterline(mid);
      if (!proj) return;
      const half = (this._moveCutStart.sB - this._moveCutStart.sA) / 2;
      const total = this.getCenterlineLength();
      let sMid = proj.station;
      let sA = Math.max(0, Math.min(total, sMid - half));
      let sB = Math.max(0, Math.min(total, sMid + half));
      // Preserve window width when hitting ends
      const width = this._moveCutStart.sB - this._moveCutStart.sA;
      if (sB - sA < width - 1e-6) {
        if (sA <= 1e-6) sB = Math.min(total, sA + width);
        else if (sB >= total - 1e-6) sA = Math.max(0, sB - width);
      }
      this.applyLongitudinalStations(sA, sB);
      this.syncCutGraphics(syncOpts);
      this.updateProfile();
      return;
    }

    this.pointA = {
      x: this._moveCutStart.a.x + dx,
      y: this._moveCutStart.a.y + dy
    };
    this.pointB = {
      x: this._moveCutStart.b.x + dx,
      y: this._moveCutStart.b.y + dy
    };
    this.syncCutGraphics(syncOpts);
    this.updateProfile();
  }

  /**
   * Midpoint along a polyline path (half chainage), in VN-2000 {x,y}
   */
  midpointAlongPath(pts) {
    if (!pts || pts.length === 0) return null;
    if (pts.length === 1) return { x: pts[0].x, y: pts[0].y };
    if (pts.length === 2) {
      return {
        x: (pts[0].x + pts[1].x) / 2,
        y: (pts[0].y + pts[1].y) / 2
      };
    }
    let total = 0;
    const segLens = [];
    for (let i = 1; i < pts.length; i++) {
      const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      segLens.push(len);
      total += len;
    }
    if (total < 1e-9) return { x: pts[0].x, y: pts[0].y };
    let target = total / 2;
    for (let i = 0; i < segLens.length; i++) {
      if (target <= segLens[i] + 1e-9) {
        const t = segLens[i] > 1e-9 ? target / segLens[i] : 0;
        return {
          x: pts[i].x + t * (pts[i + 1].x - pts[i].x),
          y: pts[i].y + t * (pts[i + 1].y - pts[i].y)
        };
      }
      target -= segLens[i];
    }
    const last = pts[pts.length - 1];
    return { x: last.x, y: last.y };
  }

  /**
   * Update polyline + markers A/B/mid without full Leaflet rebuild
   */
  syncCutGraphics(opts = {}) {
    if (!this.pointA || !this.pointB) return;
    const activeCut = this.getActiveCut();
    const polyPts = (activeCut && activeCut.polyline && activeCut.polyline.length >= 2)
      ? activeCut.polyline
      : [this.pointA, this.pointB];
    const latLngs = polyPts.map((p) => this.utmToLatLng(p.x, p.y));
    const latLngA = latLngs[0];
    const latLngB = latLngs[latLngs.length - 1];
    const mid = this.midpointAlongPath(polyPts);
    const midLatLng = mid ? this.utmToLatLng(mid.x, mid.y) : latLngs[0];
    if (this.cutPolyline) this.cutPolyline.setLatLngs(latLngs);
    if (this.markerA) this.markerA.setLatLng(latLngA);
    if (this.markerB) this.markerB.setLatLng(latLngB);
    if (this.markerMid && !opts.skipMid) this.markerMid.setLatLng(midLatLng);
  }

  beginMoveCutLine(cursorGeo) {
    if (!this.pointA || !this.pointB) return;
    const c = this.getActiveCut();
    this._isMovingCut = true;
    this._moveCutStart = {
      a: { x: this.pointA.x, y: this.pointA.y },
      b: { x: this.pointB.x, y: this.pointB.y },
      cursor: { x: cursorGeo.x, y: cursorGeo.y },
      offsetA: c && c.offsetA != null ? c.offsetA : -this.defaultHalfWidth,
      offsetB: c && c.offsetB != null ? c.offsetB : this.defaultHalfWidth,
      sA: c && c.sA != null ? c.sA : 0,
      sB: c && c.sB != null ? c.sB : this.getCenterlineLength()
    };
    if (this.map) this.map.dragging.disable();
  }

  endMoveCutLine() {
    if (!this._isMovingCut) return;
    this._isMovingCut = false;
    this._moveCutStart = null;
    this._suppressMapClick = true;
    if (this.map) this.map.dragging.enable();
    this.persistActivePoints();
    this.updateLeafletElements();
    this.updateProfile();
    setTimeout(() => { this._suppressMapClick = false; }, 50);
  }

  /**
   * Snap cursor to nearest survey point within snapToleranceM
   */
  snapToNearestPoint(geo) {
    if (!geo || !this.dataLoader || !this.dataLoader.points || this.dataLoader.points.length === 0) {
      return geo;
    }
    let best = null;
    let bestDist = Infinity;
    const pts = this.dataLoader.points;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const d = Math.hypot(p.x - geo.x, p.y - geo.y);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    if (best && bestDist <= this.snapToleranceM) {
      return { x: best.x, y: best.y };
    }
    return geo;
  }

  // ─── Centerline geometry ───────────────────────────────────────────

  hasCenterline() {
    return !!(this.centerline && this.centerline.length >= 2);
  }

  getCenterlineLength() {
    if (!this.hasCenterline()) return 0;
    return this.centerline[this.centerline.length - 1].s;
  }

  /**
   * Build VN-2000 centerline with cumulative station from [lat,lng][]
   */
  setCenterline(latLngs) {
    if (!latLngs || latLngs.length < 2) {
      throw new Error('Tim tuyến cần ít nhất 2 điểm.');
    }
    const pts = [];
    let s = 0;
    for (let i = 0; i < latLngs.length; i++) {
      const lat = latLngs[i][0];
      const lng = latLngs[i][1];
      const utm = this.latLngToUtm(lat, lng);
      if (i > 0) {
        s += Math.hypot(utm.x - pts[i - 1].x, utm.y - pts[i - 1].y);
      }
      pts.push({ x: utm.x, y: utm.y, s });
    }
    this.centerline = pts;
    this._drawCenterlineLayer();
    if (this.map) {
      const ll = pts.map((p) => this.utmToLatLng(p.x, p.y));
      try {
        this.map.fitBounds(L.latLngBounds(ll), { padding: [40, 40], maxZoom: 17 });
      } catch (_) { /* ignore */ }
    }
    if (typeof this.onCenterlineChanged === 'function') {
      this.onCenterlineChanged(true);
    }
  }

  clearCenterline() {
    this.centerline = null;
    if (this.centerlineLayerGroup) this.centerlineLayerGroup.clearLayers();
    if (this.cutMode !== 'free') {
      this.cutMode = 'free';
      // Strip polyline/station metadata from cuts
      this.cuts.forEach((c) => {
        delete c.polyline;
        delete c.station;
        delete c.sA;
        delete c.sB;
        delete c.offsetA;
        delete c.offsetB;
      });
    }
    if (typeof this.onCenterlineChanged === 'function') {
      this.onCenterlineChanged(false);
    }
    this.updateLeafletElements();
    this.updateProfile();
  }

  _drawCenterlineLayer() {
    if (!this.centerlineLayerGroup || !this.map) return;
    this.centerlineLayerGroup.clearLayers();
    if (!this.hasCenterline()) return;
    const latLngs = this.centerline.map((p) => this.utmToLatLng(p.x, p.y));
    L.polyline(latLngs, {
      color: '#dc2626',
      weight: 2.1,
      opacity: 0.9,
      interactive: false
    }).addTo(this.centerlineLayerGroup);
  }

  /**
   * Project geo onto nearest centerline segment.
   * @returns {{ point:{x,y}, station:number, tangent:{x,y}, normal:{x,y}, dist:number }}
   */
  projectToCenterline(geo) {
    if (!this.hasCenterline() || !geo) return null;
    let best = null;
    for (let i = 1; i < this.centerline.length; i++) {
      const a = this.centerline[i - 1];
      const b = this.centerline[i];
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const lenSq = abx * abx + aby * aby;
      if (lenSq < 1e-12) continue;
      let t = ((geo.x - a.x) * abx + (geo.y - a.y) * aby) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const px = a.x + t * abx;
      const py = a.y + t * aby;
      const dist = Math.hypot(geo.x - px, geo.y - py);
      if (!best || dist < best.dist) {
        const len = Math.sqrt(lenSq);
        const tx = abx / len;
        const ty = aby / len;
        best = {
          point: { x: px, y: py },
          station: a.s + t * (b.s - a.s),
          tangent: { x: tx, y: ty },
          normal: { x: -ty, y: tx },
          dist
        };
      }
    }
    return best;
  }

  pointAtStation(station) {
    if (!this.hasCenterline()) return null;
    const total = this.getCenterlineLength();
    const s = Math.max(0, Math.min(total, station));
    if (s <= 0) {
      const p = this.centerline[0];
      const t = this._tangentAtIndex(0);
      return { x: p.x, y: p.y, station: 0, tangent: t, normal: { x: -t.y, y: t.x } };
    }
    for (let i = 1; i < this.centerline.length; i++) {
      const a = this.centerline[i - 1];
      const b = this.centerline[i];
      if (s <= b.s + 1e-9) {
        const segLen = b.s - a.s;
        const t = segLen > 1e-9 ? (s - a.s) / segLen : 0;
        const tx = segLen > 1e-9 ? (b.x - a.x) / Math.hypot(b.x - a.x, b.y - a.y) : this._tangentAtIndex(i - 1).x;
        const ty = segLen > 1e-9 ? (b.y - a.y) / Math.hypot(b.x - a.x, b.y - a.y) : this._tangentAtIndex(i - 1).y;
        return {
          x: a.x + t * (b.x - a.x),
          y: a.y + t * (b.y - a.y),
          station: s,
          tangent: { x: tx, y: ty },
          normal: { x: -ty, y: tx }
        };
      }
    }
    const p = this.centerline[this.centerline.length - 1];
    const t = this._tangentAtIndex(this.centerline.length - 2);
    return { x: p.x, y: p.y, station: total, tangent: t, normal: { x: -t.y, y: t.x } };
  }

  _tangentAtIndex(i) {
    const a = this.centerline[Math.max(0, i)];
    const b = this.centerline[Math.min(this.centerline.length - 1, i + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  }

  centerlineSubPath(s0, s1) {
    if (!this.hasCenterline()) return [];
    let a = Math.min(s0, s1);
    let b = Math.max(s0, s1);
    const start = this.pointAtStation(a);
    const end = this.pointAtStation(b);
    const pts = [{ x: start.x, y: start.y }];
    for (let i = 0; i < this.centerline.length; i++) {
      const p = this.centerline[i];
      if (p.s > a + 1e-6 && p.s < b - 1e-6) {
        pts.push({ x: p.x, y: p.y });
      }
    }
    pts.push({ x: end.x, y: end.y });
    return pts;
  }

  // ─── Transverse (vuông góc tim tuyến) ──────────────────────────────

  applyTransverseAtGeo(geo, offsetA, offsetB) {
    if (!this.hasCenterline()) return;
    let p = geo;
    if (this.snapEnabled) p = this.snapToNearestPoint(p);
    const proj = this.projectToCenterline(p);
    if (!proj) return;
    const c = this.getActiveCut();
    const oA = offsetA != null ? offsetA : (c && c.offsetA != null ? c.offsetA : -this.defaultHalfWidth);
    const oB = offsetB != null ? offsetB : (c && c.offsetB != null ? c.offsetB : this.defaultHalfWidth);
    this._setTransverseFromStation(proj.station, oA, oB);
  }

  _setTransverseFromStation(station, offsetA, offsetB) {
    const at = this.pointAtStation(station);
    if (!at) return;
    const nx = at.normal.x;
    const ny = at.normal.y;
    this.pointA = { x: at.x + nx * offsetA, y: at.y + ny * offsetA };
    this.pointB = { x: at.x + nx * offsetB, y: at.y + ny * offsetB };
    const c = this.getActiveCut();
    if (c) {
      c.station = station;
      c.offsetA = offsetA;
      c.offsetB = offsetB;
      c.pointA = { ...this.pointA };
      c.pointB = { ...this.pointB };
      delete c.polyline;
      delete c.sA;
      delete c.sB;
    }
  }

  dragTransverseEndpoint(geo, which) {
    if (!this.hasCenterline()) return;
    const c = this.getActiveCut();
    const station = (c && c.station != null)
      ? c.station
      : (this.projectToCenterline({
          x: (this.pointA.x + this.pointB.x) / 2,
          y: (this.pointA.y + this.pointB.y) / 2
        }) || {}).station;
    if (station == null) return;
    const at = this.pointAtStation(station);
    if (!at) return;
    let p = geo;
    if (this.snapEnabled) p = this.snapToNearestPoint(p);
    const offset = (p.x - at.x) * at.normal.x + (p.y - at.y) * at.normal.y;
    let oA = c && c.offsetA != null ? c.offsetA : -this.defaultHalfWidth;
    let oB = c && c.offsetB != null ? c.offsetB : this.defaultHalfWidth;
    if (which === 'A') oA = offset;
    else oB = offset;
    // Keep a minimum separation
    if (Math.abs(oB - oA) < 2) {
      if (which === 'A') oA = oB - 2 * Math.sign(oB - oA || 1);
      else oB = oA + 2 * Math.sign(oB - oA || 1);
    }
    this._setTransverseFromStation(station, oA, oB);
  }

  // ─── Longitudinal (bám tim tuyến) ──────────────────────────────────

  applyLongitudinalStations(sA, sB) {
    if (!this.hasCenterline()) return;
    const total = this.getCenterlineLength();
    let a = Math.max(0, Math.min(total, sA));
    let b = Math.max(0, Math.min(total, sB));
    if (Math.abs(b - a) < 1) {
      if (b >= a) b = Math.min(total, a + 1);
      else a = Math.min(total, b + 1);
    }
    const poly = this.centerlineSubPath(a, b);
    if (poly.length < 2) return;
    // Ensure pointA is at lower station end visually consistent with sA
    const start = this.pointAtStation(a);
    const end = this.pointAtStation(b);
    this.pointA = { x: start.x, y: start.y };
    this.pointB = { x: end.x, y: end.y };
    const c = this.getActiveCut();
    if (c) {
      c.sA = a;
      c.sB = b;
      c.polyline = poly;
      c.pointA = { ...this.pointA };
      c.pointB = { ...this.pointB };
      delete c.station;
      delete c.offsetA;
      delete c.offsetB;
    }
  }

  initLongitudinalFromCurrent() {
    if (!this.hasCenterline()) return;
    const total = this.getCenterlineLength();
    let sA = 0;
    let sB = total;
    if (this.pointA && this.pointB) {
      const pA = this.projectToCenterline(this.pointA);
      const pB = this.projectToCenterline(this.pointB);
      if (pA && pB) {
        sA = pA.station;
        sB = pB.station;
      }
    }
    if (Math.abs(sB - sA) < 1) {
      sA = 0;
      sB = total;
    }
    this.applyLongitudinalStations(sA, sB);
  }

  initTransverseFromCurrent() {
    if (!this.hasCenterline()) return;
    const mid = this.pointA && this.pointB
      ? { x: (this.pointA.x + this.pointB.x) / 2, y: (this.pointA.y + this.pointB.y) / 2 }
      : this.centerline[Math.floor(this.centerline.length / 2)];
    let half = this.defaultHalfWidth;
    if (this.pointA && this.pointB) {
      half = Math.hypot(this.pointB.x - this.pointA.x, this.pointB.y - this.pointA.y) / 2;
      if (half < 5) half = this.defaultHalfWidth;
    }
    this.applyTransverseAtGeo(mid, -half, half);
  }

  dragLongitudinalEndpoint(geo, which) {
    if (!this.hasCenterline()) return;
    let p = geo;
    if (this.snapEnabled) p = this.snapToNearestPoint(p);
    const proj = this.projectToCenterline(p);
    if (!proj) return;
    const c = this.getActiveCut();
    let sA = c && c.sA != null ? c.sA : 0;
    let sB = c && c.sB != null ? c.sB : this.getCenterlineLength();

    if (which === 'A') {
      sA = proj.station;
    } else if (which === 'B') {
      sB = proj.station;
    } else {
      // nearer endpoint
      if (Math.abs(proj.station - sA) <= Math.abs(proj.station - sB)) sA = proj.station;
      else sB = proj.station;
    }
    this.applyLongitudinalStations(sA, sB);
  }

  /**
   * Free-mode snap only (Ngang/Dọc no longer lock to VN-2000 axes)
   */
  constrainCutPoint(geo, anchor) {
    let p = geo;
    if (this.snapEnabled) {
      p = this.snapToNearestPoint(p);
    }
    return p;
  }

  setCutMode(mode) {
    const allowed = ['free', 'transverse', 'longitudinal'];
    if (!allowed.includes(mode)) mode = 'free';
    if ((mode === 'transverse' || mode === 'longitudinal') && !this.hasCenterline()) {
      return false;
    }
    this.cutMode = mode;

    if (mode === 'transverse') {
      this.initTransverseFromCurrent();
    } else if (mode === 'longitudinal') {
      this.initLongitudinalFromCurrent();
    } else {
      // free — drop polyline metadata but keep A/B
      const c = this.getActiveCut();
      if (c) {
        delete c.polyline;
        delete c.station;
        delete c.sA;
        delete c.sB;
        delete c.offsetA;
        delete c.offsetB;
      }
    }
    this.updateLeafletElements();
    this.updateProfile();
    return true;
  }

  setSnapEnabled(on) {
    this.snapEnabled = !!on;
  }

  getActiveCut() {
    return this.cuts.find((c) => c.id === this.activeCutId) || null;
  }

  persistActivePoints() {
    const c = this.getActiveCut();
    if (!c) return;
    if (this.pointA) c.pointA = { x: this.pointA.x, y: this.pointA.y };
    if (this.pointB) c.pointB = { x: this.pointB.x, y: this.pointB.y };
  }

  syncPointsFromActive() {
    const c = this.getActiveCut();
    if (!c) {
      this.pointA = null;
      this.pointB = null;
      return;
    }
    this.pointA = c.pointA ? { ...c.pointA } : null;
    this.pointB = c.pointB ? { ...c.pointB } : null;
  }

  _notifyCutsListChanged() {
    if (typeof this.onCutsListChanged === 'function') {
      this.onCutsListChanged(this.cuts, this.activeCutId);
    }
  }

  addCut() {
    this.persistActivePoints();
    const palette = this.CUT_PALETTE[(this._nextCutId - 1) % this.CUT_PALETTE.length];
    const id = this._nextCutId++;
    let pointA;
    let pointB;
    const newCut = {
      id,
      label: String(id),
      colorHex: palette.hex,
      colorCss: palette.css
    };

    if (this.cutMode === 'transverse' && this.hasCenterline()) {
      const active = this.getActiveCut();
      let station = (active && active.station != null)
        ? active.station + 30
        : this.getCenterlineLength() / 2;
      station = Math.max(0, Math.min(this.getCenterlineLength(), station));
      const half = this.defaultHalfWidth;
      const at = this.pointAtStation(station);
      pointA = { x: at.x + at.normal.x * (-half), y: at.y + at.normal.y * (-half) };
      pointB = { x: at.x + at.normal.x * half, y: at.y + at.normal.y * half };
      newCut.station = station;
      newCut.offsetA = -half;
      newCut.offsetB = half;
    } else if (this.cutMode === 'longitudinal' && this.hasCenterline()) {
      const total = this.getCenterlineLength();
      const sA = 0;
      const sB = total;
      const poly = this.centerlineSubPath(sA, sB);
      const start = this.pointAtStation(sA);
      const end = this.pointAtStation(sB);
      pointA = { x: start.x, y: start.y };
      pointB = { x: end.x, y: end.y };
      newCut.sA = sA;
      newCut.sB = sB;
      newCut.polyline = poly;
    } else if (this.pointA && this.pointB) {
      const dx = this.pointB.x - this.pointA.x;
      const dy = this.pointB.y - this.pointA.y;
      const len = Math.hypot(dx, dy) || 1;
      const ox = (-dy / len) * 25;
      const oy = (dx / len) * 25;
      pointA = { x: this.pointA.x + ox, y: this.pointA.y + oy };
      pointB = { x: this.pointB.x + ox, y: this.pointB.y + oy };
    } else if (this.dataLoader && this.dataLoader.bounds) {
      const { minX, maxX, minY, maxY } = this.dataLoader.bounds;
      const midY = (minY + maxY) / 2;
      const shift = this.cuts.length * ((maxY - minY) * 0.08);
      pointA = { x: minX + (maxX - minX) * 0.1, y: midY - shift };
      pointB = { x: maxX - (maxX - minX) * 0.1, y: midY - shift };
    } else {
      pointA = { x: 0, y: 0 };
      pointB = { x: 100, y: 0 };
    }

    newCut.pointA = pointA;
    newCut.pointB = pointB;
    this.cuts.push(newCut);
    this.activeCutId = id;
    this.syncPointsFromActive();
    this._notifyCutsListChanged();
    this.updateLeafletElements();
    this.updateProfile();
  }

  removeCut(id) {
    if (this.cuts.length <= 1) return false;
    this.persistActivePoints();
    this.cuts = this.cuts.filter((c) => c.id !== id);
    if (this.activeCutId === id) {
      this.activeCutId = this.cuts[0].id;
    }
    this.syncPointsFromActive();
    this._notifyCutsListChanged();
    this.updateLeafletElements();
    this.updateProfile();
    return true;
  }

  setActiveCut(id) {
    if (this.activeCutId === id) return;
    if (!this.cuts.some((c) => c.id === id)) return;
    this.persistActivePoints();
    this.activeCutId = id;
    this.syncPointsFromActive();
    this._notifyCutsListChanged();
    this.updateLeafletElements();
    this.updateProfile();
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

    // Inactive cut polylines
    if (this.inactiveCutLayerGroup) this.inactiveCutLayerGroup.clearLayers();
    this.cuts.forEach((cut) => {
      if (cut.id === this.activeCutId || !cut.pointA || !cut.pointB) return;
      const polyPts = (cut.polyline && cut.polyline.length >= 2)
        ? cut.polyline
        : [cut.pointA, cut.pointB];
      const latLngs = polyPts.map((p) => this.utmToLatLng(p.x, p.y));
      const poly = L.polyline(latLngs, {
        color: cut.colorCss,
        weight: 4,
        opacity: 0.55,
        dashArray: '6 4'
      });
      poly.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        this.setActiveCut(cut.id);
      });
      poly.addTo(this.inactiveCutLayerGroup);
    });

    // Active Cut Line A-B and Draggable Markers
    if (this.pointA && this.pointB) {
      const activeCut = this.getActiveCut();
      const activeColor = (activeCut && activeCut.colorCss) || '#ea580c';
      const polyPts = (activeCut && activeCut.polyline && activeCut.polyline.length >= 2)
        ? activeCut.polyline
        : [this.pointA, this.pointB];
      const latLngs = polyPts.map((p) => this.utmToLatLng(p.x, p.y));
      const latLngA = latLngs[0];
      const latLngB = latLngs[latLngs.length - 1];
      const mid = this.midpointAlongPath(polyPts);
      const midLatLng = mid ? this.utmToLatLng(mid.x, mid.y) : latLngs[0];

      // Polyline — drag to move whole cut line
      if (this.cutPolyline) this.map.removeLayer(this.cutPolyline);
      this.cutPolyline = L.polyline(latLngs, {
        color: activeColor,
        weight: 6,
        opacity: 0.95,
        interactive: true,
        className: 'cut-line-draggable'
      }).addTo(this.map);
      this.cutPolyline.on('mousedown', (e) => {
        L.DomEvent.stopPropagation(e);
        L.DomEvent.preventDefault(e);
        const cursor = this.latLngToUtm(e.latlng.lat, e.latlng.lng);
        this.beginMoveCutLine(cursor);
      });

      // Custom Icons for A and B
      const iconA = L.divIcon({
        className: 'leaflet-custom-marker',
        html: '<div style="background:#1e3a8a; color:#fff; font-weight:bold; border-radius:50%; width:22px; height:22px; text-align:center; line-height:22px; border:2px solid #fff; box-shadow:0 2px 6px rgba(0,0,0,0.3);">A</div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });

      const iconB = L.divIcon({
        className: 'leaflet-custom-marker',
        html: `<div style="background:${activeColor}; color:#fff; font-weight:bold; border-radius:50%; width:22px; height:22px; text-align:center; line-height:22px; border:2px solid #fff; box-shadow:0 2px 6px rgba(0,0,0,0.3);">B</div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });

      const iconMid = L.divIcon({
        className: 'leaflet-custom-marker',
        html: `<div title="Kéo để dời đường cắt" style="background:${activeColor}; width:14px; height:14px; border-radius:3px; border:2px solid #fff; box-shadow:0 2px 6px rgba(0,0,0,0.35); cursor:move;"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7]
      });

      // Marker A
      if (this.markerA) this.map.removeLayer(this.markerA);
      this.markerA = L.marker(latLngA, { draggable: true, icon: iconA }).addTo(this.map);
      this.markerA.on('drag', (e) => {
        const pos = e.target.getLatLng();
        let geo = this.latLngToUtm(pos.lat, pos.lng);
        if (this.cutMode === 'transverse' && this.hasCenterline()) {
          this.dragTransverseEndpoint(geo, 'A');
        } else if (this.cutMode === 'longitudinal' && this.hasCenterline()) {
          this.dragLongitudinalEndpoint(geo, 'A');
        } else {
          geo = this.constrainCutPoint(geo, this.pointB);
          this.pointA = geo;
        }
        this.syncCutGraphics();
        this.updateProfile();
      });
      this.markerA.on('dragend', () => this.persistActivePoints());

      // Marker B
      if (this.markerB) this.map.removeLayer(this.markerB);
      this.markerB = L.marker(latLngB, { draggable: true, icon: iconB }).addTo(this.map);
      this.markerB.on('drag', (e) => {
        const pos = e.target.getLatLng();
        let geo = this.latLngToUtm(pos.lat, pos.lng);
        if (this.cutMode === 'transverse' && this.hasCenterline()) {
          this.dragTransverseEndpoint(geo, 'B');
        } else if (this.cutMode === 'longitudinal' && this.hasCenterline()) {
          this.dragLongitudinalEndpoint(geo, 'B');
        } else {
          geo = this.constrainCutPoint(geo, this.pointA);
          this.pointB = geo;
        }
        this.syncCutGraphics();
        this.updateProfile();
      });
      this.markerB.on('dragend', () => this.persistActivePoints());

      // Mid grip — translate whole A–B segment
      if (this.markerMid) this.map.removeLayer(this.markerMid);
      this.markerMid = L.marker(midLatLng, {
        draggable: true,
        icon: iconMid,
        zIndexOffset: 600
      }).addTo(this.map);
      this.markerMid.on('dragstart', (e) => {
        const pos = e.target.getLatLng();
        const mid = this.latLngToUtm(pos.lat, pos.lng);
        const c = this.getActiveCut();
        this._moveCutStart = {
          a: { x: this.pointA.x, y: this.pointA.y },
          b: { x: this.pointB.x, y: this.pointB.y },
          cursor: mid,
          offsetA: c && c.offsetA != null ? c.offsetA : -this.defaultHalfWidth,
          offsetB: c && c.offsetB != null ? c.offsetB : this.defaultHalfWidth,
          sA: c && c.sA != null ? c.sA : 0,
          sB: c && c.sB != null ? c.sB : this.getCenterlineLength()
        };
      });
      this.markerMid.on('drag', (e) => {
        if (!this._moveCutStart) return;
        const pos = e.target.getLatLng();
        const cur = this.latLngToUtm(pos.lat, pos.lng);
        const dx = cur.x - this._moveCutStart.cursor.x;
        const dy = cur.y - this._moveCutStart.cursor.y;
        this.translateCutByDelta(dx, dy, { skipMid: true });
      });
      this.markerMid.on('dragend', () => {
        this._moveCutStart = null;
        this.persistActivePoints();
        this.updateLeafletElements();
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

    const geo = this.constrainCutPoint(this.pixelToGeo(px, py), null);
    this.pointA = geo;
    this.pointB = { ...geo };
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
      this.pointB = this.constrainCutPoint(this.hoverPos, this.pointA);
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

    let pointA;
    let pointB;
    if (presetKey === 'transverse-mid') {
      pointA = { x: minX + (maxX - minX) * 0.1, y: midY - dy * 0.2 };
      pointB = { x: maxX - (maxX - minX) * 0.1, y: midY + dy * 0.2 };
    } else if (presetKey === 'transverse-north') {
      pointA = { x: minX + (maxX - minX) * 0.1, y: maxY - (maxY - minY) * 0.2 };
      pointB = { x: maxX - (maxX - minX) * 0.1, y: maxY - (maxY - minY) * 0.15 };
    } else if (presetKey === 'transverse-south') {
      pointA = { x: minX + (maxX - minX) * 0.1, y: minY + (maxY - minY) * 0.2 };
      pointB = { x: maxX - (maxX - minX) * 0.1, y: minY + (maxY - minY) * 0.15 };
    } else if (presetKey === 'longitudinal') {
      pointA = { x: midX - dx * 0.2, y: minY + (maxY - minY) * 0.1 };
      pointB = { x: midX + dx * 0.2, y: maxY - (maxY - minY) * 0.1 };
    } else {
      return;
    }

    // Reset to a single cut from preset
    const palette = this.CUT_PALETTE[0];
    this.cuts = [{
      id: 1,
      label: '1',
      colorHex: palette.hex,
      colorCss: palette.css,
      pointA,
      pointB
    }];
    this._nextCutId = 2;
    this.activeCutId = 1;
    this.syncPointsFromActive();
    this._notifyCutsListChanged();
    this.drawMap();
    this.updateLeafletElements();
    this.updateProfile();
  }

  updateProfile() {
    this.persistActivePoints();
    if (!this.dataLoader || this.cuts.length === 0) return;

    const profiles = this.cuts.map((c) => {
      let samples = [];
      if (c.polyline && c.polyline.length >= 2) {
        samples = this.dataLoader.sampleProfilePolyline(c.polyline, 120);
      } else if (c.pointA && c.pointB) {
        samples = this.dataLoader.sampleProfile(c.pointA.x, c.pointA.y, c.pointB.x, c.pointB.y, 120);
      }
      return {
        id: c.id,
        label: c.label,
        colorHex: c.colorHex,
        colorCss: c.colorCss,
        active: c.id === this.activeCutId,
        samples,
        pointA: c.pointA,
        pointB: c.pointB,
        polyline: c.polyline || null
      };
    });

    if (typeof this.onProfileChanged === 'function') {
      this.onProfileChanged(profiles);
    }
  }
}

window.CrossSection = CrossSection;
