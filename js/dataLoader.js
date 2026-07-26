/**
 * Bathymetry Data Parser & Normalizer
 * Reads point data in format: PointID  X  Y  Z
 */

class DataLoader {
  constructor() {
    this.points = [];
    this.bounds = {
      minX: Infinity, maxX: -Infinity,
      minY: Infinity, maxY: -Infinity,
      minZ: Infinity, maxZ: -Infinity,
      meanX: 0, meanY: 0, meanZ: 0,
      spanX: 0, spanY: 0, spanZ: 0
    };
    this.grid = null;
    this.gridResolution = 80; // Grid resolution for mesh interpolation
    this._idwSearchRadius = 50; // meters; updated in buildGrid from point density
  }

  /**
   * Median nearest-neighbor distance from a subsample of survey points (meters).
   * Used to size IDW search radius so gaps between survey lines fill without
   * extrapolating far outside the point cloud.
   */
  _estimateMedianNearestNeighbor(maxSamples = 400) {
    const points = this.points;
    if (!points || points.length < 2) return 10;

    const n = points.length;
    const sampleCount = Math.min(n, maxSamples);
    const step = Math.max(1, Math.floor(n / sampleCount));
    const sample = [];
    for (let i = 0; i < n && sample.length < sampleCount; i += step) {
      sample.push(points[i]);
    }

    const nnDists = [];
    for (let i = 0; i < sample.length; i++) {
      const a = sample[i];
      let best = Infinity;
      for (let j = 0; j < sample.length; j++) {
        if (i === j) continue;
        const dx = a.x - sample[j].x;
        const dy = a.y - sample[j].y;
        const dSq = dx * dx + dy * dy;
        if (dSq > 0 && dSq < best) best = dSq;
      }
      if (Number.isFinite(best) && best < Infinity) {
        nnDists.push(Math.sqrt(best));
      }
    }

    if (nnDists.length === 0) return 10;
    nnDists.sort((a, b) => a - b);
    const mid = Math.floor(nnDists.length / 2);
    return nnDists.length % 2 === 0
      ? 0.5 * (nnDists[mid - 1] + nnDists[mid])
      : nnDists[mid];
  }

  /**
   * Parse text data string
   */
  parseText(textData) {
    const lines = textData.split(/\r?\n/);
    const parsedPoints = [];

    let sumX = 0, sumY = 0, sumZ = 0;
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#') || line.startsWith('//')) continue;

      // Split by tab, space or comma
      const tokens = line.split(/[\s,]+/);
      if (tokens.length >= 4) {
        const id = tokens[0];
        const x = parseFloat(tokens[1]);
        const y = parseFloat(tokens[2]);
        const z = parseFloat(tokens[3]);

        if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
          parsedPoints.push({ id, x, y, z });

          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          if (z < minZ) minZ = z;
          if (z > maxZ) maxZ = z;

          sumX += x;
          sumY += y;
          sumZ += z;
        }
      }
    }

    if (parsedPoints.length === 0) {
      throw new Error("Không tìm thấy dữ liệu điểm đo hợp lệ trong file!");
    }

    const count = parsedPoints.length;
    const meanX = sumX / count;
    const meanY = sumY / count;
    const meanZ = sumZ / count;

    this.points = parsedPoints;
    this.bounds = {
      minX, maxX,
      minY, maxY,
      minZ, maxZ,
      meanX, meanY, meanZ,
      spanX: maxX - minX,
      spanY: maxY - minY,
      spanZ: maxZ - minZ
    };

    // Calculate normalized 3D local coordinates
    // Three.js: +X = East (Easting Y), +Y = Up (elevation Z), +Z = South (−Northing X)
    this.points.forEach(p => {
      p.localX = p.y - meanY; // Easting → East
      p.localY = p.z; // Elevation as 3D Y
      p.localZ = -(p.x - meanX); // −Northing → South (+Z), North (−Z)
      p.normZ = (p.z - minZ) / (maxZ - minZ || 1); // 0.0 (deepest) to 1.0 (shallowest)
    });

    // Build regular grid interpolation for 3D terrain surface mesh
    this.buildGrid();

    return {
      points: this.points,
      bounds: this.bounds,
      grid: this.grid
    };
  }

  /**
   * Interpolate unstructured points onto a regular 2D grid (Inverse Distance Weighting IDW).
   * Cells farther than adaptive searchRadius from any survey point are marked invalid.
   */
  buildGrid() {
    const res = this.gridResolution;
    const { minX, maxX, minY, maxY } = this.bounds;
    const stepX = (maxX - minX) / (res - 1);
    const stepY = (maxY - minY) / (res - 1);
    const medianNN = this._estimateMedianNearestNeighbor();
    const searchRadius = Math.max(medianNN * 3.5, Math.max(stepX, stepY) * 1.5);
    this._idwSearchRadius = searchRadius;
    const searchRadiusSq = searchRadius * searchRadius;

    const grid = [];
    const points = this.points;

    for (let i = 0; i < res; i++) {
      const row = [];
      const gx = minX + i * stepX;
      for (let j = 0; j < res; j++) {
        const gy = minY + j * stepY;

        let totalWeight = 0;
        let weightedZ = 0;

        for (let k = 0; k < points.length; k++) {
          const p = points[k];
          const dx = p.x - gx;
          const dy = p.y - gy;
          const distSq = dx * dx + dy * dy;

          if (distSq <= searchRadiusSq) {
            const dist = Math.sqrt(distSq) || 0.0001;
            const weight = 1 / (dist * dist);
            totalWeight += weight;
            weightedZ += p.z * weight;
          }
        }

        const localX = gy - this.bounds.meanY; // Easting → East
        const localZ = -(gx - this.bounds.meanX); // −Northing → South

        if (totalWeight > 0) {
          const interpolatedZ = weightedZ / totalWeight;
          row.push({
            x: gx,
            y: gy,
            z: interpolatedZ,
            valid: true,
            localX,
            localY: interpolatedZ,
            localZ,
            normZ: (interpolatedZ - this.bounds.minZ) / (this.bounds.maxZ - this.bounds.minZ || 1)
          });
        } else {
          row.push({
            x: gx,
            y: gy,
            z: null,
            valid: false,
            localX,
            localY: 0,
            localZ,
            normZ: 0
          });
        }
      }
      grid.push(row);
    }

    this.grid = grid;
  }

  /**
   * Sample depth Z along line segment (x1, y1) to (x2, y2).
   * Skips locations outside the IDW search radius (no data).
   */
  sampleProfile(x1, y1, x2, y2, numSamples = 100) {
    if (!this.points || this.points.length === 0) return [];

    const dx = x2 - x1;
    const dy = y2 - y1;
    const totalDistance = Math.sqrt(dx * dx + dy * dy);

    const samples = [];
    for (let i = 0; i <= numSamples; i++) {
      const frac = i / numSamples;
      const curX = x1 + frac * dx;
      const curY = y1 + frac * dy;
      const sample = this._makeSample(curX, curY, frac * totalDistance);
      if (sample) samples.push(sample);
    }
    return samples;
  }

  /**
   * IDW Z at (x, y). Returns null when no survey point is within adaptive search radius.
   */
  interpolateZ(curX, curY) {
    if (!this.points || this.points.length === 0) return null;
    let totalWeight = 0;
    let weightedZ = 0;
    const radius = this._idwSearchRadius > 0 ? this._idwSearchRadius : 50;
    const searchRadiusSq = radius * radius;

    for (let k = 0; k < this.points.length; k++) {
      const p = this.points[k];
      const pdx = p.x - curX;
      const pdy = p.y - curY;
      const dSq = pdx * pdx + pdy * pdy;

      if (dSq <= searchRadiusSq) {
        const dist = Math.sqrt(dSq) || 0.0001;
        const weight = 1 / (dist * dist);
        totalWeight += weight;
        weightedZ += p.z * weight;
      }
    }

    return totalWeight > 0 ? (weightedZ / totalWeight) : null;
  }

  /**
   * @returns {object|null} sample record, or null if no data nearby
   */
  _makeSample(curX, curY, distFromStart) {
    const { minZ, maxZ, meanX, meanY } = this.bounds;
    const z = this.interpolateZ(curX, curY);
    if (z == null || !Number.isFinite(z)) return null;
    return {
      distance: distFromStart,
      x: curX,
      y: curY,
      z: z,
      depth: -z,
      valid: true,
      localX: curY - meanY, // Easting → East
      localY: z,
      localZ: -(curX - meanX), // −Northing → South
      normZ: (z - minZ) / (maxZ - minZ || 1)
    };
  }

  /**
   * Sample profile along a polyline (array of {x,y}), evenly by chainage.
   * Skips locations outside the IDW search radius.
   */
  sampleProfilePolyline(points, numSamples = 100) {
    if (!this.points || this.points.length === 0) return [];
    if (!points || points.length < 2) return [];

    const segs = [];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      const len = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      segs.push({ a: points[i - 1], b: points[i], len, s0: total });
      total += len;
    }
    if (total < 1e-9) {
      const only = this._makeSample(points[0].x, points[0].y, 0);
      return only ? [only] : [];
    }

    const samples = [];
    for (let i = 0; i <= numSamples; i++) {
      const target = (i / numSamples) * total;
      let seg = segs[segs.length - 1];
      for (let s = 0; s < segs.length; s++) {
        if (target <= segs[s].s0 + segs[s].len + 1e-9) {
          seg = segs[s];
          break;
        }
      }
      const t = seg.len > 1e-9 ? (target - seg.s0) / seg.len : 0;
      const curX = seg.a.x + t * (seg.b.x - seg.a.x);
      const curY = seg.a.y + t * (seg.b.y - seg.a.y);
      const sample = this._makeSample(curX, curY, target);
      if (sample) samples.push(sample);
    }
    return samples;
  }

  /**
   * Marching Squares Contour Line Generator for Bathymetric Isobaths
   * @param {number} interval Contour spacing in meters (clamped to 0.5–1.0)
   */
  generateContours(interval = 1) {
    if (!this.grid || this.grid.length < 2) return [];

    let step = Number(interval);
    if (!Number.isFinite(step)) step = 1;
    step = Math.min(1, Math.max(0.5, step));

    const levels = [];
    const minZ = this.bounds.minZ;
    const maxZ = this.bounds.maxZ;
    let z = Math.ceil(minZ / step) * step;
    // Guard against floating-point drift
    while (z <= maxZ + 1e-9) {
      levels.push(Number(z.toFixed(3)));
      z += step;
    }

    const contours = [];
    const rows = this.grid.length;
    const cols = this.grid[0].length;

    const cellValid = (p) => p && p.valid !== false && p.z != null && Number.isFinite(p.z);

    levels.forEach(level => {
      const lineSegments = [];

      for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols - 1; c++) {
          const p0 = this.grid[r][c];       // Top-Left
          const p1 = this.grid[r][c + 1];   // Top-Right
          const p2 = this.grid[r + 1][c + 1]; // Bottom-Right
          const p3 = this.grid[r + 1][c];   // Bottom-Left

          if (!cellValid(p0) || !cellValid(p1) || !cellValid(p2) || !cellValid(p3)) continue;

          let config = 0;
          if (p0.z >= level) config |= 8;
          if (p1.z >= level) config |= 4;
          if (p2.z >= level) config |= 2;
          if (p3.z >= level) config |= 1;

          if (config === 0 || config === 15) continue;

          const interp = (nA, nB) => {
            if (Math.abs(nB.z - nA.z) < 1e-6) {
              return { x: nA.x, y: nA.y, localX: nA.localX, localZ: nA.localZ };
            }
            const t = (level - nA.z) / (nB.z - nA.z);
            return {
              x: nA.x + t * (nB.x - nA.x),
              y: nA.y + t * (nB.y - nA.y),
              localX: nA.localX + t * (nB.localX - nA.localX),
              localZ: nA.localZ + t * (nB.localZ - nA.localZ)
            };
          };

          const edgeTop = interp(p0, p1);
          const edgeRight = interp(p1, p2);
          const edgeBottom = interp(p3, p2);
          const edgeLeft = interp(p0, p3);

          switch (config) {
            case 1: case 14: lineSegments.push([edgeLeft, edgeBottom]); break;
            case 2: case 13: lineSegments.push([edgeBottom, edgeRight]); break;
            case 3: case 12: lineSegments.push([edgeLeft, edgeRight]); break;
            case 4: case 11: lineSegments.push([edgeTop, edgeRight]); break;
            case 5: lineSegments.push([edgeLeft, edgeTop], [edgeBottom, edgeRight]); break;
            case 6: case 9:  lineSegments.push([edgeTop, edgeBottom]); break;
            case 7: case 8:  lineSegments.push([edgeLeft, edgeTop]); break;
            case 10: lineSegments.push([edgeTop, edgeRight], [edgeBottom, edgeLeft]); break;
          }
        }
      }

      contours.push({
        level: level,
        segments: lineSegments
      });
    });

    return contours;
  }
}

window.DataLoader = DataLoader;
