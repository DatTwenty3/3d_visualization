/**
 * Satellite + labels basemap at water level — plane centered on survey mean,
 * texture stitched from CORS-safe tiles (Esri imagery + Carto/Esri label overlays)
 * with an alpha hole over valid IDW survey cells so riverbed mesh stays visible.
 * (Google Hybrid tiles lack CORS and cannot be used as WebGL textures.)
 */

const Basemap3D = {
  MAX_TILES_AXIS: 12,
  PAD: 3.06, // 1.8 × 1.7 (~70% wider again)
  /** Slightly below water mesh to avoid z-fighting when water is visible */
  WATER_Y_BIAS: 0.35,
  MAX_CANVAS: 2048,
  FEATHER_RADIUS: 3,
  /** Shrink hole by this many grid cells so basemap overlaps skirt rim */
  HOLE_ERODE: 1,

  imageryUrl(x, y, z) {
    return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  },

  /** Label overlays on imagery (hybrid-like: places, roads, POI) */
  labelUrls(x, y, z) {
    const s = ['a', 'b', 'c', 'd'][(x + y) % 4];
    return [
      `https://${s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/${z}/${x}/${y}@2x.png`,
      `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/${z}/${y}/${x}`,
      `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/${z}/${y}/${x}`
    ];
  },

  latLngToTile(lat, lng, z) {
    const n = 2 ** z;
    const x = Math.floor(((lng + 180) / 360) * n);
    const latRad = (lat * Math.PI) / 180;
    const y = Math.floor(
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
    );
    return {
      x: Math.max(0, Math.min(n - 1, x)),
      y: Math.max(0, Math.min(n - 1, y))
    };
  },

  tileLatLngBounds(x, y, z) {
    const n = 2 ** z;
    const lngW = (x / n) * 360 - 180;
    const lngE = ((x + 1) / n) * 360 - 180;
    const latN = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
    const latS = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;
    return { latN, latS, lngW, lngE };
  },

  chooseZoom(latMin, latMax, lngMin, lngMax) {
    const maxA = this.MAX_TILES_AXIS;
    for (let z = 18; z >= 12; z--) {
      const nw = this.latLngToTile(latMax, lngMin, z);
      const se = this.latLngToTile(latMin, lngMax, z);
      const nx = Math.abs(se.x - nw.x) + 1;
      const ny = Math.abs(se.y - nw.y) + 1;
      if (nx <= maxA && ny <= maxA) return z;
    }
    return 12;
  },

  dispose(group) {
    if (!group) return;
    if (group.userData._abortPaint) group.userData._abortPaint = true;
    group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (obj.material.map) obj.material.map.dispose();
        obj.material.dispose();
      }
    });
  },

  _loadImage(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  },

  /**
   * Symmetric half-extents around mean so the plane is centered on mesh origin.
   */
  _halfExtents(bounds) {
    const halfX = Math.max(bounds.meanX - bounds.minX, bounds.maxX - bounds.meanX) * this.PAD;
    const halfY = Math.max(bounds.meanY - bounds.minY, bounds.maxY - bounds.meanY) * this.PAD;
    return {
      halfX: Math.max(halfX, 1),
      halfY: Math.max(halfY, 1)
    };
  },

  /**
   * Box-blur a single-channel Uint8 alpha buffer (soft hole edge).
   */
  _featherAlpha(alpha, w, h, radius) {
    if (!radius || radius < 1) return alpha;
    const out = new Uint8ClampedArray(alpha.length);
    const r = radius | 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let count = 0;
        for (let dy = -r; dy <= r; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            sum += alpha[yy * w + xx];
            count++;
          }
        }
        out[y * w + x] = count ? Math.round(sum / count) : alpha[y * w + x];
      }
    }
    return out;
  },

  /**
   * Punch alpha hole where IDW grid cells are valid (survey corridor).
   * Hole is eroded by HOLE_ERODE cells so satellite overlaps the terrain skirt rim.
   */
  _applySurveyHole(ctx, cw, ch, cfg) {
    const { bounds, grid, east0, east1, north0, north1 } = cfg;
    if (!grid || !grid.length || !grid[0] || !grid[0].length || !bounds) return;

    const rows = grid.length;
    const cols = grid[0].length;
    const { minX, maxX, minY, maxY } = bounds;
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const stepX = spanX / Math.max(rows - 1, 1);
    const stepY = spanY / Math.max(cols - 1, 1);
    const eastSpan = east1 - east0 || 1;
    const northSpan = north1 - north0 || 1;
    const erode = this.HOLE_ERODE | 0;

    const cellOpen = (i, j) => {
      if (i < 0 || j < 0 || i >= rows || j >= cols) return false;
      const cell = grid[i][j];
      return !!(cell && cell.valid !== false && cell.z != null);
    };

    /** Interior of corridor only (eroded rim stays opaque under basemap) */
    const cellHole = (i, j) => {
      if (!cellOpen(i, j)) return false;
      if (erode <= 0) return true;
      for (let di = -erode; di <= erode; di++) {
        for (let dj = -erode; dj <= erode; dj++) {
          if (di === 0 && dj === 0) continue;
          if (!cellOpen(i + di, j + dj)) return false;
        }
      }
      return true;
    };

    const alpha = new Uint8ClampedArray(cw * ch);
    for (let cy = 0; cy < ch; cy++) {
      const v = 1 - cy / ch;
      const northing = north0 + v * northSpan;
      for (let cx = 0; cx < cw; cx++) {
        const u = cx / cw;
        const easting = east0 + u * eastSpan;
        const idx = cy * cw + cx;

        // Outside survey AABB → keep basemap opaque (do not clamp into edge cells)
        if (northing < minX || northing > maxX || easting < minY || easting > maxY) {
          alpha[idx] = 255;
          continue;
        }

        let i = Math.round((northing - minX) / stepX);
        let j = Math.round((easting - minY) / stepY);
        i = Math.max(0, Math.min(rows - 1, i));
        j = Math.max(0, Math.min(cols - 1, j));
        alpha[idx] = cellHole(i, j) ? 0 : 255;
      }
    }

    const feathered = this._featherAlpha(alpha, cw, ch, this.FEATHER_RADIUS);
    const img = ctx.getImageData(0, 0, cw, ch);
    const data = img.data;
    for (let i = 0, p = 0; i < feathered.length; i++, p += 4) {
      data[p + 3] = feathered[i];
    }
    ctx.putImageData(img, 0, 0);
  },

  /**
   * Build group: plane at local y=0 (scene places it at water level), async textured.
   */
  build(opts) {
    const { bounds, utmToLatLng, latLngToUtm, grid } = opts;
    if (!bounds || !utmToLatLng || !latLngToUtm || typeof THREE === 'undefined') {
      return null;
    }

    const { halfX, halfY } = this._halfExtents(bounds);
    // PlaneGeometry(width=X/east, height→Z/north after rotate). Center = mesh origin.
    const geo = new THREE.PlaneGeometry(2 * halfY, 2 * halfX, 1, 1);
    geo.rotateX(-Math.PI / 2);

    const mat = new THREE.MeshBasicMaterial({
      color: 0x3d4a52,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1,
      depthWrite: true,
      alphaTest: 0.12
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'basemapPlane';
    mesh.userData.isBasemap = true;
    mesh.renderOrder = -2;

    const group = new THREE.Group();
    group.name = 'basemapGroup';
    group.userData.isBasemap = true;
    group.userData._abortPaint = false;
    group.position.y = 0;
    group.add(mesh);

    // Geographic box centered on mean (same as plane)
    const east0 = bounds.meanY - halfY;
    const east1 = bounds.meanY + halfY;
    const north0 = bounds.meanX - halfX;
    const north1 = bounds.meanX + halfX;

    const corners = [
      utmToLatLng(north0, east0),
      utmToLatLng(north0, east1),
      utmToLatLng(north1, east0),
      utmToLatLng(north1, east1)
    ];

    let latMin = Infinity;
    let latMax = -Infinity;
    let lngMin = Infinity;
    let lngMax = -Infinity;
    corners.forEach(([lat, lng]) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      if (lat < latMin) latMin = lat;
      if (lat > latMax) latMax = lat;
      if (lng < lngMin) lngMin = lng;
      if (lng > lngMax) lngMax = lng;
    });

    if (!Number.isFinite(latMin)) return group;

    const z = this.chooseZoom(latMin, latMax, lngMin, lngMax);
    const nw = this.latLngToTile(latMax, lngMin, z);
    const se = this.latLngToTile(latMin, lngMax, z);
    const x0 = Math.min(nw.x, se.x);
    const x1 = Math.max(nw.x, se.x);
    const y0 = Math.min(nw.y, se.y);
    const y1 = Math.max(nw.y, se.y);

    const aspect = (2 * halfY) / (2 * halfX);
    let cw;
    let ch;
    if (aspect >= 1) {
      cw = this.MAX_CANVAS;
      ch = Math.max(256, Math.round(this.MAX_CANVAS / aspect));
    } else {
      ch = this.MAX_CANVAS;
      cw = Math.max(256, Math.round(this.MAX_CANVAS * aspect));
    }

    const toCanvasXY = (northing, easting) => {
      const u = (easting - east0) / (east1 - east0);
      const v = (northing - north0) / (north1 - north0); // 0=south … 1=north
      return {
        cx: u * cw,
        cy: (1 - v) * ch // canvas y down → north at top
      };
    };

    this._paintStitched(group, mesh, {
      z,
      x0,
      x1,
      y0,
      y1,
      cw,
      ch,
      latLngToUtm,
      toCanvasXY,
      withLabels: true,
      bounds,
      grid,
      east0,
      east1,
      north0,
      north1
    });

    return group;
  },

  async _paintStitched(group, mesh, cfg) {
    const { z, x0, x1, y0, y1, cw, ch, latLngToUtm, toCanvasXY, withLabels } = cfg;
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#2a3540';
    ctx.fillRect(0, 0, cw, ch);

    const jobs = [];
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        jobs.push({ tx, ty, url: this.imageryUrl(tx, ty, z), label: false });
        if (withLabels) {
          this.labelUrls(tx, ty, z).forEach((url) => {
            jobs.push({ tx, ty, url, label: true });
          });
        }
      }
    }

    const images = await Promise.all(jobs.map((j) => this._loadImage(j.url).then((img) => ({ ...j, img }))));

    if (group.userData._abortPaint) return;

    // Imagery first, then labels
    const drawJob = (job) => {
      if (!job.img) return;
      const bb = this.tileLatLngBounds(job.tx, job.ty, z);
      const cNW = latLngToUtm(bb.latN, bb.lngW);
      const cNE = latLngToUtm(bb.latN, bb.lngE);
      const cSE = latLngToUtm(bb.latS, bb.lngE);
      const cSW = latLngToUtm(bb.latS, bb.lngW);

      const pts = [
        toCanvasXY(cNW.x, cNW.y),
        toCanvasXY(cNE.x, cNE.y),
        toCanvasXY(cSE.x, cSE.y),
        toCanvasXY(cSW.x, cSW.y)
      ];
      const xs = pts.map((p) => p.cx);
      const ys = pts.map((p) => p.cy);
      const left = Math.min(...xs);
      const right = Math.max(...xs);
      const top = Math.min(...ys);
      const bottom = Math.max(...ys);
      const w = right - left;
      const h = bottom - top;
      if (w < 1 || h < 1) return;

      try {
        ctx.drawImage(job.img, left, top, w, h);
      } catch (e) {
        /* skip */
      }
    };

    images.filter((j) => !j.label).forEach(drawJob);
    images.filter((j) => j.label).forEach(drawJob);

    if (group.userData._abortPaint || !mesh.material) return;

    this._applySurveyHole(ctx, cw, ch, cfg);

    if (group.userData._abortPaint || !mesh.material) return;

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.flipY = true;
    if (mesh.material.map) mesh.material.map.dispose();
    mesh.material.map = tex;
    mesh.material.color.setHex(0xffffff);
    mesh.material.transparent = true;
    mesh.material.depthWrite = true;
    mesh.material.alphaTest = 0.12;
    mesh.material.needsUpdate = true;
  }
};

window.Basemap3D = Basemap3D;
